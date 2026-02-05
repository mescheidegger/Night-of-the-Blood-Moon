import { resolveAttempt, resolveValue } from '../utils.js';
import { getBodySpawnBuffer, resolveMobConfig } from '../../mob/MobRegistry.js';

// Tracks per-scene cooldown timestamps for wall spawns keyed by mob type.
// WeakMap ensures we don't prevent Scene instances from being GC'd.
const lastWallByScene = new WeakMap();

/**
 * Custom spawner: emits a solid "wall" (full line/row) of mobs just off-screen,
 * then relies on their AI (e.g., seekPlayer) to advance toward the player.
 *
 * Tunable via `SpawnRegistry.byMob[mobKey].wall`:
 *   - orientation: 'vertical' | 'horizontal' | [...options]
 *   - spacing: px between units along the wall
 *   - thickness: number of parallel rows (>=1)
 *   - rowSpacing: px between parallel rows
 *   - offset: extra distance beyond the collider buffer for spawn placement
 *   - speed: optional runtime speed override
 *   - cooldownMs: min ms between wall spawns for this mobKey
 *   - ai: behavior assigned to spawned mobs (e.g., 'seekPlayer')
 *
 * @param {Object} ctx            Spawner context ({ scene, enemyPools })
 * @param {string} mobKey         Mob key (e.g., 'crawlybones')
 * @param {number} t              Elapsed run time in seconds
 * @param {Object} [mobEntry={}]  Spawn registry row for the mob
 * @returns {boolean}             True if at least one enemy spawned
 */
export function wallLine(ctx, mobKey, t, mobEntry = {}) {
  const { scene, enemyPools, heroSprite, modeKey = null } = ctx ?? {};
  if (!scene) return false;

  // Acquire pool for mob type; bail if unavailable.
  const pool = enemyPools?.getPool?.(mobKey);
  if (!pool) return false;

  const mobConfig = resolveMobConfig(mobKey);
  const camera = scene.cameras?.main;
  const runtime = scene.mapRuntime;
  // Bounded maps use world bounds to decide spawn edges.
  const bounds = runtime?.isBounded?.() ? runtime.getWorldBounds?.() : null;
  // For bounded maps, bounds are the "view" used for wall placement.
  const view = bounds ?? camera?.worldView;
  if (!view) return false;

  const wallConfig = mobEntry.wall ?? {};
  const baseAi = mobConfig.ai;
  const baseAiParams = mobConfig.aiParams;
  const spawnKey = mobEntry?.spawn?.key ?? mobEntry?.spawn?.group;
  const spawnAnchor = spawnKey
    ? scene.spawnDirector?.getSpawnPoint?.({ heroSprite, attempts: 1, spawnKey })
    : null;

  // Per-scene per-mob cooldown (prevents overly frequent walls).
  const now = scene.time?.now ?? 0;
  const cooldownMs = Number(resolveValue(wallConfig.cooldownMs, t, 60000)) || 60000;

  let byMob = lastWallByScene.get(scene);
  if (!byMob) {
    byMob = new Map();
    lastWallByScene.set(scene, byMob);
  }

  const last = byMob.get(mobKey) ?? -Infinity;
  if (now - last < cooldownMs) {
    // Still on cooldown — skip this tick.
    return false;
  }

  // Keep spawns clearly off-screen: collider buffer + optional offset.
  const bodyBuffer = getBodySpawnBuffer(mobConfig.body);
  const offsetRaw = resolveValue(wallConfig.offset, t, 32);
  const margin = bounds ? 0 : bodyBuffer + (Number(offsetRaw) || 0);

  // Orientation can be a single value or an array to randomize each wall.
  const orientationValue = resolveValue(wallConfig.orientation, t, 'vertical');
  const orientationOptions = Array.isArray(orientationValue) ? orientationValue : [orientationValue];
  const orientation = orientationOptions[Math.floor(Math.random() * orientationOptions.length)] || 'vertical';

  // Formation geometry: spacing along the wall, thickness (# parallel rows), and distance between rows.
  const spacingValue = Number(resolveValue(wallConfig.spacing, t, 22));
  const spacing = Math.max(4, Number.isFinite(spacingValue) ? spacingValue : 22);

  const thickness = Math.max(1, resolveAttempt(wallConfig.thickness, t, 1));
  const rowSpacingValue = Number(resolveValue(wallConfig.rowSpacing, t, 14));
  const rowSpacing = Number.isFinite(rowSpacingValue) ? Math.max(0, rowSpacingValue) : 14;

  // Runtime speed override (falls back to registry stats); AI to assign to each mob.
  const speedRaw = resolveValue(wallConfig.speed, t, mobConfig.stats?.speed ?? 60);
  const speed = Number.isFinite(Number(speedRaw)) ? Number(speedRaw) : (mobConfig.stats?.speed ?? 60);
  const aiOverride = resolveValue(wallConfig.ai, t, null);
  const aiParamsOverride = wallConfig.aiParams ?? null;

  let spawnedCount = 0;

  // Helper to spawn a single mob at (x,y) with runtime overrides.
  const attemptSpawn = (x, y) => {
    if (scene.spawnDirector?.isPointBlocked?.(x, y)) return false;
    if (!enemyPools?.canSpawn?.(mobKey)) return false;
    const enemy = pool.get(x, y);
    if (!enemy) return false;

    const resetConfig = {
      stats: { speed, maxSpeed: speed },
    };

    if (aiOverride != null) {
      resetConfig.ai = aiOverride;
      if (aiParamsOverride != null) {
        resetConfig.aiParams = aiParamsOverride;
      } else if (aiOverride === baseAi && baseAiParams != null) {
        resetConfig.aiParams = baseAiParams;
      }
    }

    enemy.reset(x, y, mobKey, resetConfig);
    enemy._spawnModeKey = modeKey;
    spawnedCount += 1;
    return true;
  };

  const buildWall = (horizontal, fixed) => {
    const spanStart = horizontal ? view.x - margin * 0.5 : view.y - margin * 0.5;
    const spanEnd = horizontal ? view.right + margin * 0.5 : view.bottom + margin * 0.5;
    const span = spanEnd - spanStart;
    if (span <= 0) return;

    for (let row = 0; row < thickness; row++) {
      if (!enemyPools?.canSpawn?.(mobKey)) break;

      const rowOffset = (row - (thickness - 1) / 2) * rowSpacing;

      for (let along = spanStart; along <= spanEnd + 1; along += spacing) {
        if (!enemyPools?.canSpawn?.(mobKey)) break;

        const x = horizontal ? along : fixed + rowOffset;
        const y = horizontal ? fixed + rowOffset : along;

        attemptSpawn(x, y);
      }
    }
  };

  const sides = Array.isArray(wallConfig.sides) ? wallConfig.sides : null;

  if (sides?.length) {
    sides.forEach((side) => {
      switch (side) {
        case 'top':
          buildWall(true, view.top - margin);
          break;
        case 'bottom':
          buildWall(true, view.bottom + margin);
          break;
        case 'left':
          buildWall(false, view.left - margin);
          break;
        case 'right':
          buildWall(false, view.right + margin);
          break;
        default:
          break;
      }
    });

    if (spawnedCount) {
      byMob.set(mobKey, now);
    }
    return spawnedCount;
  }

  // Choose which screen edge to build the wall outside of,
  // and compute the span we need to cover edge-to-edge.
  const horizontal = orientation === 'horizontal';
  let fixed;

  if (spawnAnchor && bounds) {
    if (horizontal) {
      const distTop = Math.abs(spawnAnchor.y - bounds.top);
      const distBottom = Math.abs(bounds.bottom - spawnAnchor.y);
      fixed = distTop <= distBottom ? view.y - margin : view.bottom + margin;
    } else {
      const distLeft = Math.abs(spawnAnchor.x - bounds.left);
      const distRight = Math.abs(bounds.right - spawnAnchor.x);
      fixed = distLeft <= distRight ? view.x - margin : view.right + margin;
    }
  } else {
    fixed = horizontal
      ? (Math.random() < 0.5 ? view.y - margin : view.bottom + margin)
      : (Math.random() < 0.5 ? view.x - margin : view.right + margin);
  }

  buildWall(horizontal, fixed);

  // Record successful spawn time to enforce cooldown for this mobKey in this scene.
  if (spawnedCount) {
    byMob.set(mobKey, now);
  }

  return spawnedCount;
}
