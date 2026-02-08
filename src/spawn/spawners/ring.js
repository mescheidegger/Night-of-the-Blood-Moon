import { getBodySpawnBuffer, resolveMobConfig } from '../../mob/MobRegistry.js';
import { resolveAttempt } from '../utils.js';
import { resolveSpawnKey } from './spawnKey.js';

/**
 * Default ring-style spawner.
 *
 * Places enemies *just outside* the player's current view by spawning them
 * around the hero in a circular ring. This creates the "horde forming around
 * you" pressure without popping mobs visibly into the screen.
 *
 * This is used whenever a mob does **not** define a `customSpawner` in
 * SpawnRegistry. It respects per-mob and global spawn caps automatically.
 */
export function ring(ctx, mobKey, t, mobEntry = {}) {
  const { scene, enemyPools, heroSprite, modeKey = null } = ctx ?? {};
  if (!scene || !heroSprite) return false;

  // Fetch or create the appropriate pool for this mob type.
  const pool = enemyPools?.getPool?.(mobKey);
  if (!pool) return false;

  // How many enemies to spawn in this ring tick (can be fn(t) or constant).
  const burst = resolveAttempt(mobEntry.spawnsPerTick, t, 1);

  // Look up sprite/body config for spawn radius sizing.
  const mobConfig = resolveMobConfig(mobKey);

  // Determine how far from the hero to spawn:
  // - Base radius based on viewport size (keeps ring just off-screen).
  // - Add collider buffer so large sprites don’t visibly pop in.
  const camera = scene.cameras?.main;
  const radiusBase = camera ? Math.max(camera.width, camera.height) * 0.75 : 300;
  const radius = radiusBase + getBodySpawnBuffer(mobConfig.body);

  let spawned = 0;

  // Spawn `burst` enemies in random angles around the ring.
  for (let b = 0; b < burst; b++) {
    // Respect per-mob/global active caps at spawn time.
    if (!enemyPools?.canSpawn?.(mobKey)) break;

    // Choose a random direction around the hero.
    const spawnKey = resolveSpawnKey(ctx, mobEntry);
    const spawnPoint = scene.spawnDirector?.getSpawnPoint?.({
      heroSprite,
      radius,
      attempts: 12,
      spawnKey,
    })
      ?? { x: heroSprite.x, y: heroSprite.y };
    const x = spawnPoint.x;
    const y = spawnPoint.y;

    // Retrieve pooled enemy; if pool is empty, skip gracefully.
    const enemy = pool.get(x, y);
    if (!enemy) break;

    // Apply mob visuals, physics, and AI defaults.
    enemy.reset(x, y, mobKey);
    enemy._spawnModeKey = modeKey;
    spawned += 1;
  }

  return spawned;
}
