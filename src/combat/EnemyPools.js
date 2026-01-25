import { Pool } from '../core/Pool.js';
import { Enemy } from '../mob/entities/Enemy.js';
import { resolveMobConfig } from '../mob/MobRegistry.js';

/**
 * EnemyPools
 *
 * Manages **multiple enemy pools** while still exposing **one unified physics group**
 * (`allGroup`) that collision systems, targeting logic, and AI loops can reference.
 *
 * This lets the game:
 *   - Have separate caps for each mob type (e.g., 1 boss, 200 swarmers, 800 fodder).
 *   - Have a global cap across all mobs (`totalMax`).
 *   - Spawn enemies from different pools without adding extra collision wiring.
 */
export class EnemyPools {
  /**
   * Build the pooled enemy infrastructure and the unified collision group.
   * This ensures spawn caps and physics wiring stay centralized.
   */
  constructor(scene, spawnConfig = {}) {
    this.scene = scene;
    this.spawnConfig = spawnConfig;

    // Max enemies allowed across ALL pools combined
    this.totalMax = spawnConfig.totalMax ?? Infinity;

    // Map of mobKey → Pool instance
    this.pools = new Map();

    // Map of mobKey → per-type active cap
    this.mobCaps = new Map();

    // Map of mobKey → number of currently active enemies of that type
    this.activeByKey = new Map();

    // Cached total active enemies across all pools
    this.totalActive = 0;

    // **Single** Arcade Physics group all enemies are registered into.
    // Collision + overlap systems only need to point to this group.
    this.allGroup = scene.physics.add.group({
      runChildUpdate: false, // We drive AI manually in GameScene.update()
    });
  }

  /**
   * Getter for the unified physics group (equivalent to getAllGroup()).
   */
  get group() {
    return this.allGroup;
  }

  /**
   * Explicit getter for consistency with previous architecture.
   */
  getAllGroup() {
    return this.allGroup;
  }

  /**
   * Returns how many enemies of a specific mob type are active.
   */
  getActiveCount(mobKey) {
    return this.activeByKey.get(mobKey) ?? 0;
  }

  /**
   * Returns total active enemies across all mob types.
   */
  getTotalActive() {
    return this.totalActive;
  }

  /**
   * Adjusts the **global** max enemy limit.
   */
  setTotalMax(max) {
    this.totalMax = Number.isFinite(max) ? Math.max(0, max) : Infinity;
  }

  /**
   * Adjusts the **per-mob** max active count.
   * Also updates the corresponding pool's max size if applicable.
   */
  setMax(mobKey, max) {
    const value = Number.isFinite(max) ? Math.max(0, max) : Infinity;
    this.mobCaps.set(mobKey, value);
    const pool = this._ensurePool(mobKey);
    if (Number.isFinite(value)) {
      pool?.setMaxSize?.(value);
    }
  }

  /**
   * Determines if we are allowed to spawn another instance of this type.
   * Checks both per-mob caps and global caps.
   */
  canSpawn(mobKey) {
    if (!mobKey) return false;

    // Block if global cap is hit
    if (Number.isFinite(this.totalMax) && this.totalActive >= this.totalMax) {
      return false;
    }

    // Block if per-mob cap is hit
    const mobCap = this.mobCaps.get(mobKey);
    if (Number.isFinite(mobCap) && this.getActiveCount(mobKey) >= mobCap) {
      return false;
    }

    return true;
  }

  /**
   * Releases an enemy back into its pool.
   * If the pool is missing (unexpected), falls back to manual cleanup.
   */
  release(enemy) {
    if (!enemy) return;

    // 🔒 Boss death / cinematic sequences can temporarily "lock" an enemy
    // to prevent pooling cleanup while an animation/audio sequence plays.
    if (enemy._deathSequenceLock) return;

    const key = enemy.mobKey ?? enemy.type ?? null;
    const pool = key ? this.pools.get(key) : null;

    // If we know which pool it came from → return through pooling logic
    if (pool) {
      pool.release(enemy);
      return;
    }

    // Fallback clean-up when the pool is unknown (should be rare):
    if (this.allGroup.contains?.(enemy)) {
      this.allGroup.remove(enemy, false, false);
    }

    // Update counts
    if (key && this.activeByKey.has(key)) {
      const prev = this.activeByKey.get(key) ?? 0;
      if (prev <= 1) {
        this.activeByKey.delete(key);
      } else {
        this.activeByKey.set(key, prev - 1);
      }
    }

    this.totalActive = Math.max(0, this.totalActive - 1);

    this.scene?.events?.emit('enemy:released', { enemy });

    // Disable and let entity run its own reset hook if defined
    enemy.disableBody?.(true, true);
    enemy.onRelease?.();
  }

  /**
   * Public accessor to get (or create) the pool for a mob type.
   */
  getPool(mobKey) {
    return this._ensurePool(mobKey);
  }

  /**
   * Ensures a pool exists for the given mob type.
   * If not, create it using the mob's default config and register
   * hooks to track active counts and unified group membership.
   */
  _ensurePool(mobKey) {
    if (this.pools.has(mobKey)) {
      return this.pools.get(mobKey);
    }

    // Get per-mob cap from registry or fallback logic
    const config = this.spawnConfig.byMob?.[mobKey] ?? {};
    const declaredCap = this.mobCaps.has(mobKey)
      ? this.mobCaps.get(mobKey)
      : (Number.isFinite(config.max) ? Math.max(0, config.max) : Infinity);
    this.mobCaps.set(mobKey, declaredCap);

    // Look up mob texture / spritesheet information from MobRegistry
    const mobConfig = resolveMobConfig(mobKey);
    const textureKey = mobConfig.sheetKey ?? mobConfig.texture ?? 'evileye';

    // Pool size defaults: per-mob max → global max → reasonable fallback
    const poolMax = Number.isFinite(declaredCap)
      ? declaredCap
      : (Number.isFinite(this.totalMax) ? this.totalMax : 2000);

    // Construct the pool for this mob type
    const pool = new Pool(this.scene, Enemy, textureKey, poolMax, true);

    // Install hooks to maintain unified group + active counters
    pool.setHooks({
      onActivate: (entity) => {
        if (!entity) return;

        // Add the enemy instance to the unified collision/AI group if needed
        if (!this.allGroup.contains?.(entity)) {
          this.allGroup.add(entity);
        }

        // Increment per-type and global active counts
        const prev = this.activeByKey.get(mobKey) ?? 0;
        this.activeByKey.set(mobKey, prev + 1);
        this.totalActive += 1;

      },

      onRelease: (entity) => {
        if (!entity) return;

        // Remove from unified group if present
        if (this.allGroup.contains?.(entity)) {
          this.allGroup.remove(entity, false, false);
        }

        // Decrement per-type and global counts
        const prev = this.activeByKey.get(mobKey) ?? 0;
        if (prev <= 1) {
          this.activeByKey.delete(mobKey);
        } else {
          this.activeByKey.set(mobKey, prev - 1);
        }

        this.totalActive = Math.max(0, this.totalActive - 1);

        this.scene?.events?.emit('enemy:released', { enemy: entity });
      }
    });

    // Store pool reference and tag the pool with its mobKey
    pool.mobKey = mobKey;
    this.pools.set(mobKey, pool);
    return pool;
  }
}
