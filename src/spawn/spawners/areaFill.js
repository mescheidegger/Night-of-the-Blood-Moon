import { resolveAttempt, resolveValue } from '../utils.js';
import { resolveSpawnKey } from './spawnKey.js';

export function areaFill(ctx, mobKey, t, mobEntry = {}) {
  const { scene, enemyPools, heroSprite, modeKey = null } = ctx ?? {};
  if (!scene || !enemyPools) return false;

  const pool = enemyPools.getPool?.(mobKey);
  if (!pool) return false;

  const spawnKey = resolveSpawnKey(ctx, mobEntry);
  const count = resolveAreaFillCount(ctx, mobEntry, t);
  if (count <= 0) return false;

  let spawned = 0;

  for (let i = 0; i < count; i += 1) {
    if (!enemyPools?.canSpawn?.(mobKey)) break;
    const spawnPoint = scene.spawnDirector?.getSpawnPoint?.({
      heroSprite,
      attempts: 12,
      spawnKey,
    });
    if (!spawnPoint) continue;
    const enemy = pool.get(spawnPoint.x, spawnPoint.y);
    if (!enemy) break;
    enemy.reset(spawnPoint.x, spawnPoint.y, mobKey);
    enemy._spawnModeKey = modeKey;
    spawned += 1;
  }

  return spawned;
}

function resolveAreaFillCount(ctx, mobEntry, t) {
  const entry = mobEntry ?? {};
  if (entry.count !== undefined) {
    return Math.max(0, resolveAttempt(entry.count, t, 0));
  }

  const waveConfig = entry.wave;
  if (waveConfig) {
    const groupSize = resolveAttempt(waveConfig.groupSize, t, 1);
    const groupsPerTick = resolveAttempt(waveConfig.groupsPerTick, t, 1);
    const bursts = resolveAttempt(entry.spawnsPerTick, t, 1);
    return Math.max(0, groupSize * groupsPerTick * bursts);
  }

  const legionConfig = entry.legion;
  if (legionConfig) {
    let count = Math.max(0, resolveAttempt(legionConfig.count, t, 0));
    if (legionConfig.centers === 'viewportCorners') {
      count *= 4;
    }
    return count;
  }

  const wallConfig = entry.wall;
  if (wallConfig) {
    const view = ctx?.scene?.mapRuntime?.getWorldBounds?.()
      ?? ctx?.scene?.cameras?.main?.worldView;
    if (!view) return 0;
    const spacingValue = Number(resolveValue(wallConfig.spacing, t, 22));
    const spacing = Math.max(4, Number.isFinite(spacingValue) ? spacingValue : 22);
    const thickness = Math.max(1, resolveAttempt(wallConfig.thickness, t, 1));
    const sides = Array.isArray(wallConfig.sides)
      ? wallConfig.sides
      : [];
    const countPerHorizontal = Math.floor(view.width / spacing) + 1;
    const countPerVertical = Math.floor(view.height / spacing) + 1;

    let total = 0;
    sides.forEach((side) => {
      if (side === 'top' || side === 'bottom') {
        total += countPerHorizontal * thickness;
      } else if (side === 'left' || side === 'right') {
        total += countPerVertical * thickness;
      }
    });
    return total;
  }

  return 0;
}
