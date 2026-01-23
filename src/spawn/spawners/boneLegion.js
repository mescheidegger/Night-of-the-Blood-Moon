import Phaser from 'phaser';
import { resolveAttempt, resolveValue } from '../utils.js';
import { resolveMobConfig } from '../../mob/MobRegistry.js';

// Tracks per-scene cooldown timestamps for legion spawns keyed by mob type.
const lastLegionByScene = new WeakMap();

/**
 * Custom spawner: creates a circular "legion" formation that advances toward
 * the player as a cohesive ring. Formation metadata is stored on the scene so
 * member AI can steer toward their assigned slots.
 *
 * @param {Object} ctx            Spawner context ({ scene, enemyPools })
 * @param {string} mobKey         Mob key (e.g., 'crawlybones')
 * @param {number} t              Elapsed run time in seconds
 * @param {Object} [mobEntry={}]  Spawn registry row for the mob
 * @returns {boolean}             True if at least one enemy spawned
 */
export function boneLegion(ctx, mobKey, t, mobEntry = {}) {
  const { scene, enemyPools, modeKey = null } = ctx ?? {};
  if (!scene || !enemyPools) return false;

  const pool = enemyPools.getPool?.(mobKey);
  if (!pool) return false;

  const legionConfig = mobEntry.legion ?? {};

  const now = scene.time?.now ?? 0;
  const cooldownMs = Number(resolveValue(legionConfig.cooldownMs, t, 45000)) || 45000;

  let byMob = lastLegionByScene.get(scene);
  if (!byMob) {
    byMob = new Map();
    lastLegionByScene.set(scene, byMob);
  }

  const last = byMob.get(mobKey) ?? -Infinity;
  if (now - last < cooldownMs) return false;

  if (!scene.legionFormations) {
    scene.legionFormations = new Map();
  }

  // How many enemies per legion (per center).
  let countPerLegion = Math.max(0, resolveAttempt(legionConfig.count, t, 60));

  const mobConfig = resolveMobConfig(mobKey) ?? {};
  const body = mobConfig.body ?? {};
  const bodyWidth =
    body.type === 'circle'
      ? (body.radius ?? 8) * 2
      : (body.width ?? 12);

  const gap = 2;
  const circumference = countPerLegion * (bodyWidth + gap);
  const baseRadius = circumference / (2 * Math.PI);
  const radiusValue = resolveValue(legionConfig.radius, t, baseRadius);
  const resolvedRadius = Number.isFinite(Number(radiusValue))
    ? Number(radiusValue)
    : baseRadius;

  const moveSpeed =
    Number(resolveValue(legionConfig.moveSpeed, t, mobConfig.stats?.speed ?? 40)) ||
    (mobConfig.stats?.speed ?? 40);
  const angularSpeed = Number(resolveValue(legionConfig.angularSpeed, t, 0)) || 0;
  const shrinkPerSecond = Number(resolveValue(legionConfig.shrinkPerSecond, t, 0)) || 0;

  const legionAi = resolveValue(legionConfig.ai, t, 'legionMember');
  const legionAiParams = legionConfig.aiParams ?? null;

  // Optional tuning value retained for timeline configs.
  const breakDistance =
    Number(resolveValue(legionConfig.breakDistance, t, 140)) || 140;
  const maxAngularRadPerSec =
    Number(resolveValue(legionConfig.maxAngularRadPerSec, t, 6)) || 6;
  const radialStepFactor =
    Number(resolveValue(legionConfig.radialStepFactor, t, 1.5)) || 1.5;
  const separationRadius =
    Number(resolveValue(legionConfig.separationRadius, t, 28)) || 28;
  const separationStrength =
    Number(resolveValue(legionConfig.separationStrength, t, 1)) || 1;
  const maxSeparationChecks = Math.max(
    0,
    Math.floor(Number(resolveValue(legionConfig.maxSeparationChecks, t, 14)) || 14)
  );
  const radialGain =
    Number(resolveValue(legionConfig.radialGain, t, 0.03)) || 0.03;

  const camera = scene.cameras?.main;
  const view = camera?.worldView;
  if (!view) return false;

  let spawnedTotal = 0;

  const centers = legionConfig.centers;
  const margin = 64;
  let centerPoints = [];

  if (centers === 'viewportCorners') {
    if (import.meta.env.DEV) {
      countPerLegion = Math.min(countPerLegion, 120);
    }
    const inset = Number(legionConfig.viewportInset) || 32;
    centerPoints = [
      { x: view.left + inset, y: view.top + inset },
      { x: view.right - inset, y: view.top + inset },
      { x: view.left + inset, y: view.bottom - inset },
      { x: view.right - inset, y: view.bottom - inset },
    ];
  } else {
    // Original random side behavior (single legion)
    const side = Math.floor(Math.random() * 4);
    switch (side) {
      case 0: {
        centerPoints = [
          {
            x: Phaser.Math.Between(view.left + resolvedRadius, view.right - resolvedRadius),
            y: view.top - resolvedRadius - margin,
          },
        ];
        break;
      }
      case 1: {
        centerPoints = [
          {
            x: Phaser.Math.Between(view.left + resolvedRadius, view.right - resolvedRadius),
            y: view.bottom + resolvedRadius + margin,
          },
        ];
        break;
      }
      case 2: {
        centerPoints = [
          {
            x: view.left - resolvedRadius - margin,
            y: Phaser.Math.Between(view.top + resolvedRadius, view.bottom - resolvedRadius),
          },
        ];
        break;
      }
      default: {
        centerPoints = [
          {
            x: view.right + resolvedRadius + margin,
            y: Phaser.Math.Between(view.top + resolvedRadius, view.bottom - resolvedRadius),
          },
        ];
        break;
      }
    }
  }

  const ringSpacing = bodyWidth + gap;
  const minRingRadius = ringSpacing * 0.5;

  const spawnLegionAtCenter = (center, targetCount) => {
    const id = (scene._nextLegionId = (scene._nextLegionId ?? 0) + 1);
    const formation = {
      id,
      cx: center.x,
      cy: center.y,
      radius: resolvedRadius,
      moveSpeed,
      angularOffset: 0,
      angularSpeed,
      shrinkPerSecond,
      breakDistance,
      maxAngularRadPerSec,
      radialStepFactor,
      separationRadius,
      separationStrength,
      maxSeparationChecks,
      radialGain,
      members: new Set(),
      lastUpdatedAt: 0,
    };
    scene.legionFormations.set(id, formation);

    let localSpawned = 0;

    for (
      let ringRadius = minRingRadius;
      ringRadius <= resolvedRadius && localSpawned < targetCount;
      ringRadius += ringSpacing
    ) {
      if (!enemyPools.canSpawn?.(mobKey)) break;

      const ringCircumference = 2 * Math.PI * ringRadius;
      let slotsInRing = Math.max(1, Math.floor(ringCircumference / ringSpacing));

      if (localSpawned + slotsInRing > targetCount) {
        slotsInRing = targetCount - localSpawned;
      }

      for (let i = 0; i < slotsInRing; i++) {
        if (!enemyPools.canSpawn?.(mobKey) || localSpawned >= targetCount) break;

        const theta = (i / slotsInRing) * Math.PI * 2;

        const x = center.x + Math.cos(theta) * ringRadius;
        const y = center.y + Math.sin(theta) * ringRadius;

        const enemy = pool.get(x, y);
        if (!enemy) continue;

        const resetConfig = {
          ai: legionAi,
          stats: {
            ...mobConfig.stats,
            speed: moveSpeed,
          },
        };

        if (legionAiParams) {
          resetConfig.aiParams = legionAiParams;
        }

        enemy.reset(x, y, mobKey, resetConfig);

        enemy._spawnModeKey = modeKey;

        enemy._formationId = id;
        enemy._formationAngle = theta;
        enemy._formationRadius = ringRadius;
        formation.members.add(enemy);

        localSpawned += 1;
        spawnedTotal += 1;
      }
    }
  };

  // For normal random legions: centerPoints.length === 1 → one legion of countPerLegion.
  // For viewportCorners: each corner gets a full legion of countPerLegion.
  centerPoints.forEach((center) => spawnLegionAtCenter(center, countPerLegion));

  if (spawnedTotal) {
    byMob.set(mobKey, now);
  }

  return spawnedTotal;
}
