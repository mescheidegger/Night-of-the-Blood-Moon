import Phaser from 'phaser';
import { getBodySpawnBuffer, resolveMobConfig } from '../../mob/MobRegistry.js';
import { pickOne, resolveAttempt, resolveValue } from '../utils.js';

/**
 * Custom spawner: emits one or more "bat waves" (formation lines) that travel
 * straight across the screen from a screen edge. Reads its knobs from:
 *   - mobEntry.wave.* (groupSize, groupsPerTick, direction, speed, spacing, ai, amplitude, frequency)
 *   - mobEntry.spawnsPerTick (optional multiplier for total groups)
 *
 * @param {Object} ctx                    - Spawner context ({ scene, enemyPools, ... })
 * @param {string} mobKey                 - Mob key (e.g., 'spookybat')
 * @param {number} t                      - Elapsed run time in seconds
 * @param {Object} [mobEntry={}]          - SpawnRegistry.byMob[mobKey] row
 * @returns {boolean}                     - True if at least one enemy spawned
 */
export function batWave(ctx, mobKey, t, mobEntry = {}) {
  const { scene, enemyPools, heroSprite, modeKey = null } = ctx ?? {};
  if (!scene) return false;

  // Acquire the pool for this mob type; if missing, we can't spawn.
  const pool = enemyPools?.getPool?.(mobKey);
  if (!pool) return false;

  const mobConfig = resolveMobConfig(mobKey);
  const camera = scene.cameras?.main;
  const view = camera?.worldView;

  // Wave-specific config (functions or constants), resolved below against `t`.
  const waveConfig = mobEntry.wave ?? {};

  // How many formation lines to emit this tick:
  // - groupsPerTick: base wave count
  // - spawnsPerTick: optional multiplier (documented policy)
  const waveGroups = resolveAttempt(waveConfig.groupsPerTick, t, 1);
  const additionalBursts = resolveAttempt(mobEntry.spawnsPerTick, t, 1); // multiplies wave count.
  const totalGroups = waveGroups * additionalBursts;

  // Formation geometry/tuning
  const groupSize = resolveAttempt(waveConfig.groupSize, t, 1);                 // bats per line
  const spacingRaw = resolveValue(waveConfig.spacing, t, 24);                   // px between bats
  const spacing = Math.max(4, Number(spacingRaw) || 24);
  const speedRaw = resolveValue(waveConfig.speed, t, mobConfig.stats?.speed ?? 80);
  const speed = Math.max(30, Number(speedRaw) || 80);

  // Direction(s) can be a single string or an array (randomly sampled per group).
  const directionConfig = resolveValue(waveConfig.direction, t, 'L2R');
  const directions = Array.isArray(directionConfig) ? directionConfig : [directionConfig];
  if (directions.length === 0) directions.push('L2R');

  // Behavior each bat will use once spawned (e.g., 'flyStraight' or 'flySine').
  const ai = resolveValue(waveConfig.ai, t, mobConfig.ai ?? 'flyStraight');

  // Keep spawns offscreen by at least the collider radius plus margin.
  const buffer = getBodySpawnBuffer(mobConfig.body);
  const margin = buffer + 32;

  let spawnedCount = 0;

  const runtime = scene.mapRuntime;
  const spawnKey = mobEntry?.spawn?.key ?? mobEntry?.spawn?.group;
  // Bounded maps skip offscreen spawning and instead use arena-contained points.
  if (runtime?.isBounded?.()) {
    const totalCount = totalGroups * groupSize;
    const isFlyingAi = ai === 'flyStraight' || ai === 'flySine';
    for (let i = 0; i < totalCount; i += 1) {
      if (!enemyPools?.canSpawn?.(mobKey)) break;
      const direction = pickOne(directions) ?? 'L2R';
      const velocityX = direction === 'R2L' ? -speed : direction === 'L2R' ? speed : 0;
      const velocityY = direction === 'T2B' ? speed : direction === 'B2T' ? -speed : 0;

      let spawnPoint = null;
      for (let attempt = 0; attempt < 3 && !spawnPoint; attempt += 1) {
        const candidate = scene.spawnDirector?.getSpawnPoint?.({
          heroSprite,
          margin: 32,
          attempts: 12,
          spawnKey,
        });
        if (!candidate) continue;
        if (!isFlyingAi && scene.spawnDirector?.isPointBlocked?.(candidate.x, candidate.y)) continue;
        spawnPoint = candidate;
      }
      if (!spawnPoint) continue;
      const enemy = pool.get(spawnPoint.x, spawnPoint.y);
      if (!enemy) continue;
      enemy.reset(spawnPoint.x, spawnPoint.y, mobKey, {
        ai,
        stats: { speed, maxSpeed: speed },
      });
      enemy._spawnModeKey = modeKey;
      enemy._baseVel = { x: velocityX, y: velocityY };
      enemy._waveMargin = margin * 1.2;
      enemy._aiTime = 0;
      if (ai === 'flySine') {
        let amplitude = spacing * 0.8;
        if (waveConfig.amplitude !== undefined) {
          const resolved = resolveValue(waveConfig.amplitude, t, amplitude);
          const numeric = Number(resolved);
          if (Number.isFinite(numeric)) {
            amplitude = Math.max(0, numeric);
          }
        }

        let frequency = 0.0055;
        if (waveConfig.frequency !== undefined) {
          const resolvedFreq = resolveValue(waveConfig.frequency, t, frequency);
          const numericFreq = Number(resolvedFreq);
          if (Number.isFinite(numericFreq)) {
            frequency = Math.max(0.0005, numericFreq);
          }
        }

        enemy._waveAmplitude = amplitude;
        enemy._waveFrequency = frequency;
      }
      enemy.setVelocity(velocityX, velocityY);
      spawnedCount += 1;
    }
    return spawnedCount;
  }

  if (!view) return false;

  // Emit `totalGroups` formation lines this tick.
  for (let g = 0; g < totalGroups; g++) {
    // Respect per-mob/global caps each loop.
    if (!enemyPools?.canSpawn?.(mobKey)) break;

    // Choose an edge travel direction for this group.
    const direction = pickOne(directions) ?? 'L2R';

    // Base spawn anchor + travel velocity for the group,
    // and which axis is perpendicular for stacking the formation.
    let baseX = view.x;
    let baseY = view.y;
    let velocityX = 0;
    let velocityY = 0;
    let axis = 'vertical';

    // Compute a start point just beyond the corresponding screen edge,
    // with a little randomness along the edge ("lane" choice).
    switch (direction) {
      case 'R2L':
        baseX = view.x + view.width + margin;
        baseY = Phaser.Math.FloatBetween(view.y - margin * 0.5, view.y + view.height + margin * 0.5);
        velocityX = -speed;
        velocityY = 0;
        axis = 'vertical';   // stack bats vertically for a horizontal travel line
        break;
      case 'T2B':
        baseX = Phaser.Math.FloatBetween(view.x - margin * 0.5, view.x + view.width + margin * 0.5);
        baseY = view.y - margin;
        velocityX = 0;
        velocityY =  speed;
        axis = 'horizontal'; // stack bats horizontally for a vertical travel line
        break;
      case 'B2T':
        baseX = Phaser.Math.FloatBetween(view.x - margin * 0.5, view.x + view.width + margin * 0.5);
        baseY = view.y + view.height + margin;
        velocityX = 0;
        velocityY = -speed;
        axis = 'horizontal';
        break;
      case 'L2R':
      default:
        baseX = view.x - margin;
        baseY = Phaser.Math.FloatBetween(view.y - margin * 0.5, view.y + view.height + margin * 0.5);
        velocityX =  speed;
        velocityY = 0;
        axis = 'vertical';
        break;
    }

    // Center line for perpendicular stacking (keeps formation centered).
    const perpCenter = axis === 'vertical' ? baseY : baseX;

    // Spawn each bat in the formation line, offset along the perpendicular axis.
    for (let i = 0; i < groupSize; i++) {
      if (!enemyPools?.canSpawn?.(mobKey)) break;

      // Offset so the group is centered on `perpCenter`.
      const offset = (i - (groupSize - 1) / 2) * spacing;

      // Convert offset into world coordinates based on travel axis.
      const spawnX = axis === 'vertical' ? baseX : perpCenter + offset;
      const spawnY = axis === 'vertical' ? perpCenter + offset : baseY;

      // Acquire an instance from the pool; skip if exhausted.
      const enemy = pool.get(spawnX, spawnY);
      if (!enemy) continue;

      // Hydrate mob visuals/physics and stamp AI + runtime speed caps.
      enemy.reset(spawnX, spawnY, mobKey, {
        ai,
        stats: { speed, maxSpeed: speed },
      });

      enemy._spawnModeKey = modeKey;

      // Seed the wave-specific ephemeral state that AI behaviors read:
      //  - constant forward velocity
      //  - despawn margin
      //  - time accumulator for sine phase
      enemy._baseVel = { x: velocityX, y: velocityY };
      enemy._waveMargin = margin * 1.2;
      enemy._aiTime = 0;

      // Optional wobble parameters if using sine behavior; allow config overrides.
      if (ai === 'flySine') {
        let amplitude = spacing * 0.8; // default wobble amplitude scales with spacing
        if (waveConfig.amplitude !== undefined) {
          const resolved = resolveValue(waveConfig.amplitude, t, amplitude);
          const numeric = Number(resolved);
          if (Number.isFinite(numeric)) {
            amplitude = Math.max(0, numeric);
          }
        }

        let frequency = 0.0055; // radians/ms default (gentle wobble)
        if (waveConfig.frequency !== undefined) {
          const resolvedFreq = resolveValue(waveConfig.frequency, t, frequency);
          const numericFreq = Number(resolvedFreq);
          if (Number.isFinite(numericFreq)) {
            frequency = Math.max(0.0005, numericFreq);
          }
        }

        enemy._waveAmplitude = amplitude;
        enemy._waveFrequency = frequency;
      }

      // Kick the bat forward; subsequent frames will be steered by its AI.
      enemy.setVelocity(velocityX, velocityY);
      spawnedCount += 1;
    }
  }

  // Return how many enemies were spawned (handy for tests/telemetry).
  return spawnedCount;
}
