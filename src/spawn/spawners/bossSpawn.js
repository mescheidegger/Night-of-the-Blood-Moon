import { getBodySpawnBuffer, resolveMobConfig } from '../../mob/MobRegistry.js';
import { resolveSpawnKey } from './spawnKey.js';

/**
 * Spawns bosses (Evil Wizard, Werewolf, etc.) off-screen once their appearAt
 * gate passes. Uses **per-mob caps and cooldowns** instead of a single global
 * "only one boss at a time" flag. This allows multiple different bosses to
 * exist concurrently (e.g., Werewolf + Wizard).
 *
 * Intended to be called every update tick by SpawnDirector.
 *
 * @param {object} ctx       - Runtime context containing scene, enemy pools, and hero sprite.
 * @param {string} mobKey    - Registry key of the boss to attempt to spawn.
 * @param {number} t         - Elapsed run time in seconds (scene._runStartedAt-based).
 * @param {object} mobEntry  - Spawn config entry resolved from SpawnRegistry.byMob[mobKey].
 * @returns {boolean}        - true if spawned this tick, false otherwise.
 */
export function bossSpawn(ctx, mobKey, t, mobEntry = {}) {
  const { scene, enemyPools, heroSprite, modeKey = null } = ctx ?? {};
  if (!scene || !heroSprite) return false;  // Cannot spawn without a valid scene or hero reference.

  /**
   * --- 1) Time Gate ---
   * Boss should not appear until a configured timestamp in the run.
   * appearAt defaults to 30 seconds if not provided.
   */
  const appearAt = Number.isFinite(mobEntry.appearAt) ? mobEntry.appearAt : 30;
  if (t < appearAt) return false;

  /**
   * --- 2) Capacity Check ---
   * Uses enemyPools.canSpawn(mobKey) which respects per-mob max caps.
   * If the mob type is at its max, we skip until capacity frees up.
   */
  if (!enemyPools?.canSpawn?.(mobKey)) return false;

  /**
   * --- 3) Optional Per-Mob Cooldown ---
   * Prevents continuous respawning every tick once eligible.
   * Note: This **does not** limit concurrent bosses — just how frequently
   * new spawns of the same type may occur.
   */
  const cooldownMs = Number.isFinite(mobEntry.cooldownMs) ? mobEntry.cooldownMs : 0;
  const now = scene.time?.now ?? 0;
  if (cooldownMs > 0) {
    // Create or reuse a cooldown map that tracks the next allowed spawn time per mobKey.
    scene._bossCooldownByKey = scene._bossCooldownByKey || new Map();
    const nextAt = scene._bossCooldownByKey.get(mobKey) ?? 0;
    if (now < nextAt) return false;  // Still in cooldown → skip this tick.
  }

  /**
   * --- 4) Retrieve Object Pool for This Mob Type ---
   * If no pool exists, we cannot spawn this enemy.
   */
  const pool = enemyPools?.getPool?.(mobKey);
  if (!pool) return false;

  /**
   * --- 5) Resolve Mob Config ---
   * We need body size and sheet config so we can safely position off-screen.
   */
  const mobConfig = resolveMobConfig(mobKey);

  /**
   * --- 6) Compute Off-Screen Spawn Radius ---
   * Default radius: ~75% of the visible camera size away from hero + collider padding.
   * Ensures the boss does not "pop into view" when spawning.
   */
  const camera = scene.cameras?.main;
  const baseRadius = Number.isFinite(mobEntry.spawn?.radius)
    ? mobEntry.spawn.radius
    : (camera ? Math.max(camera.width, camera.height) * 0.75 : 480);

  // Add collider size buffer so hitboxes never appear partially on-screen at spawn.
  const spawnRadius = baseRadius + getBodySpawnBuffer(mobConfig.body);

  /**
   * --- 7) Pick a Spawn Point ---
   * Bounded maps choose a valid point inside world bounds (not blocked).
   * Infinite maps keep the off-screen ring behavior.
   */
  const runtime = scene.mapRuntime;
  // Flag ensures boss spawn uses bounded sampling when the map is finite.
  const useBounded = runtime?.isBounded?.();
  const spawnKey = resolveSpawnKey(ctx, mobEntry);
  const spawnPoint = useBounded
    ? scene.spawnDirector?.getSpawnPoint?.({
        heroSprite,
        margin: 64,
        attempts: 20,
        spawnKey,
      })
    : null;
  const angle = Math.random() * Math.PI * 2;
  const x = spawnPoint?.x ?? (heroSprite.x + Math.cos(angle) * spawnRadius);
  const y = spawnPoint?.y ?? (heroSprite.y + Math.sin(angle) * spawnRadius);

  // Re-check capacity in case another system spawned something this tick.
  if (!enemyPools?.canSpawn?.(mobKey)) return false;

  /**
   * --- 8) Spawn Enemy via Pool ---
   * `pool.get(x, y)` returns a pooled instance and reactivates it.
   * If no instance is available, spawning is skipped.
   */
  const enemy = pool.get(x, y);
  if (!enemy) return false;

  /**
   * --- 9) Reset and Initialize Boss State ---
   * - Hydrates mob stats, animations, body, rewards, etc.
   * - Positions boss at computed coordinates.
   */
  enemy.reset(x, y, mobKey);
  enemy._spawnModeKey = modeKey;

  /**
   * --- 10) Seed Orbit Angle (if boss uses orbital AI) ---
   * circlePlayer and similar AIs rely on _theta to maintain stable orbits.
   * Even melee bosses can ignore this safely.
   */
  enemy._theta = Math.atan2(enemy.y - heroSprite.y, enemy.x - heroSprite.x);

  /**
   * --- 11) Ensure Boss Starts Stationary ---
   * Let AI apply initial movement immediately on the next frame.
   */
  enemy.body?.setVelocity(0, 0);

  /**
   * --- 12) Update Cooldown (if configured) ---
   * Schedules when the next spawn attempt for this mob type may succeed.
   */
  if (cooldownMs > 0) {
    scene._bossCooldownByKey.set(mobKey, now + cooldownMs);
  }

  return 1;
}
