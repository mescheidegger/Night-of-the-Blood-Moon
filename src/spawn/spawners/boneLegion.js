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
  // Spawner context gives us the active scene and pooled enemies.
  const { scene, enemyPools, modeKey = null } = ctx ?? {};
  if (!scene || !enemyPools) return false;

  // Pull the pool for this mob type; if it's missing we cannot spawn anything.
  const pool = enemyPools.getPool?.(mobKey);
  if (!pool) return false;

  // Legion-specific configuration lives on the spawn registry entry.
  const legionConfig = mobEntry.legion ?? {};

  // Cooldown logic is per scene + per mob type to avoid repeated formation spam.
  const now = scene.time?.now ?? 0;
  const cooldownMs = Number(resolveValue(legionConfig.cooldownMs, t, 45000)) || 45000;

  let byMob = lastLegionByScene.get(scene);
  if (!byMob) {
    byMob = new Map();
    lastLegionByScene.set(scene, byMob);
  }

  const last = byMob.get(mobKey) ?? -Infinity;
  if (now - last < cooldownMs) return false;

  // Cache of active formations is stored on the scene for legion AI to read.
  if (!scene.legionFormations) {
    scene.legionFormations = new Map();
  }

  // How many enemies per legion (per center).
  let countPerLegion = Math.max(0, resolveAttempt(legionConfig.count, t, 60));

  // Body sizing informs the ring radius calculations so spacing feels consistent.
  const mobConfig = resolveMobConfig(mobKey) ?? {};
  const body = mobConfig.body ?? {};
  const bodyWidth =
    body.type === 'circle'
      ? (body.radius ?? 8) * 2
      : (body.width ?? 12);

  // Compute a default radius based on desired ring circumference and slot spacing.
  const gap = 2;
  const circumference = countPerLegion * (bodyWidth + gap);
  const baseRadius = circumference / (2 * Math.PI);
  const radiusValue = resolveValue(legionConfig.radius, t, baseRadius);
  const resolvedRadius = Number.isFinite(Number(radiusValue))
    ? Number(radiusValue)
    : baseRadius;

  // Resolve movement and formation tuning options (allow per-wave overrides).
  const moveSpeed =
    Number(resolveValue(legionConfig.moveSpeed, t, mobConfig.stats?.speed ?? 40)) ||
    (mobConfig.stats?.speed ?? 40);
  const angularSpeed = Number(resolveValue(legionConfig.angularSpeed, t, 0)) || 0;
  const shrinkPerSecond = Number(resolveValue(legionConfig.shrinkPerSecond, t, 0)) || 0;

  // Allow alternate AI behaviors or parameters for the legion members.
  const legionAi = resolveValue(legionConfig.ai, t, 'legionMember');
  const legionAiParams = legionConfig.aiParams ?? null;

  // Optional tuning values retained for timeline configs (all consumed by legionMember AI).
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

  const runtime = scene.mapRuntime;
  const isBounded = runtime?.isBounded?.() ?? false;
  const bounds = runtime?.getWorldBounds?.();
  const camera = scene.cameras?.main;
  const view = camera?.worldView;
  if (!isBounded && !view) return false;

  let spawnedTotal = 0;

  // Determine formation centers.
  // - Infinite maps retain camera-edge/offscreen entry behavior.
  // - Bounded maps choose arena-contained, walkable centers.
  const centers = legionConfig.centers;
  const margin = 64;
  let centerPoints = [];

  if (isBounded && bounds) {
    const inset = Number(legionConfig.viewportInset) || 32;
    if (centers === 'viewportCorners') {
      centerPoints = [
        { x: bounds.left + inset, y: bounds.top + inset },
        { x: bounds.right - inset, y: bounds.top + inset },
        { x: bounds.left + inset, y: bounds.bottom - inset },
        { x: bounds.right - inset, y: bounds.bottom - inset },
      ];
    } else {
      const spawnKey = mobEntry?.spawn?.key ?? mobEntry?.spawn?.group;
      const picked = scene.spawnDirector?.getSpawnPoint?.({
        heroSprite: scene.hero?.sprite ?? scene.player,
        margin: Math.max(24, resolvedRadius * 0.4),
        attempts: 24,
        spawnKey,
      });
      if (picked) centerPoints = [picked];
    }

    centerPoints = centerPoints.filter((point) => {
      if (!point) return false;
      if (scene.spawnDirector?.isPointBlocked?.(point.x, point.y)) return false;
      return true;
    });
  } else if (centers === 'viewportCorners') {
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
    // Infinite map behavior: single legion enters from a random camera edge.
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

  if (!centerPoints.length) return false;

  const ringSpacing = bodyWidth + gap;
  const minRingRadius = ringSpacing * 0.5;

  // Helper to spawn a legion formation around a given center point.
  const spawnLegionAtCenter = (center, targetCount) => {
    // Assign a unique formation id so members can reference shared metadata.
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
    // Store the formation on the scene for MobAI.legionMember to read every frame.
    scene.legionFormations.set(id, formation);

    let localSpawned = 0;

    // Iterate ring by ring, filling slots until we hit the requested count.
    for (
      let ringRadius = minRingRadius;
      ringRadius <= resolvedRadius && localSpawned < targetCount;
      ringRadius += ringSpacing
    ) {
      if (!enemyPools.canSpawn?.(mobKey)) break;

      // Compute how many slots fit around the ring given the spacing.
      const ringCircumference = 2 * Math.PI * ringRadius;
      let slotsInRing = Math.max(1, Math.floor(ringCircumference / ringSpacing));

      if (localSpawned + slotsInRing > targetCount) {
        // Clamp to remaining budget so we don't exceed targetCount.
        slotsInRing = targetCount - localSpawned;
      }

      for (let i = 0; i < slotsInRing; i++) {
        if (!enemyPools.canSpawn?.(mobKey) || localSpawned >= targetCount) break;

        // Evenly distribute members around the ring.
        const theta = (i / slotsInRing) * Math.PI * 2;

        const x = center.x + Math.cos(theta) * ringRadius;
        const y = center.y + Math.sin(theta) * ringRadius;

        // Pull a mob from the pool and configure it with formation metadata.
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

        // Tag the enemy for analytics or spawn-mode debugging.
        enemy._spawnModeKey = modeKey;

        // Per-member slot assignment used by the legionMember AI.
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