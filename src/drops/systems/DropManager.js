import Phaser from 'phaser';
import { CONFIG } from '../../config/gameConfig.js';
import { Pool } from '../../core/Pool.js';
import { DropFactory } from '../DropFactory.js';
import { BaseDrop } from '../entities/BaseDrop.js';
import { DEFAULT_DROP_TYPE } from '../DropRegistry.js';

/**
 * DropManager
 *
 * High-level orchestrator for drops:
 *  - Uses a Pool to reuse drop instances (avoids allocations + GC churn)
 *  - Uses a DropFactory to configure/reset a drop when spawning
 *  - Applies an optional random "spawn impulse" so drops scatter outward slightly
 *
 * This cleanly separates: spawning, pooling, configuration, and physics.
 */
export class DropManager {
  /**
   * Initialize pooling and factory helpers for all runtime drop spawns.
   * Centralizing setup here keeps drop spawning predictable and performant.
   */
  constructor(scene) {
    this.scene = scene;

    // Factory resolves drop config via DropRegistry + overrides.
    this.factory = new DropFactory(scene);

    // Large object pool to reuse BaseDrop instances.
    // Arguments:
    //   scene, class, defaultTextureKey, poolSize, runPrewarm
    this.pool = new Pool(scene, BaseDrop, 'xpgem', 4000, true);
  }

  /**
   * Exposes the underlying group used for physics or iteration systems
   * (MagnetSystem, CollectSystem, etc, rely on this).
   */
  getGroup() {
    return this.pool.group;
  }

  /**
   * Spawn or reuse a drop at the given position.
   * Applies type configuration (from registry) and optional per-instance overrides.
   */
  spawn(x, y, type = DEFAULT_DROP_TYPE, overrides = {}) {
    // Request an available drop from the pool.
    const drop = this.pool.get(x, y);
    if (!drop) {
      return null; // No available pooled drop (should not happen unless pool too small).
    }

    // Apply resolved config (sets sprite, body shape, magnet behavior, XP value, etc).
    this.factory.createOrReset(drop, x, y, type, overrides);

    // Add a small outward push so drops don't stack visually unless disabled by the drop config.
    if (drop.spawnImpulseEnabled === false) {
      drop.body?.setVelocity(0, 0);
    } else {
      this._applySpawnImpulse(drop);
    }

    return drop;
  }

  /**
   * Return drop to pool after being collected or removed.
   */
  release(drop) {
    this.pool.release(drop);
  }

  /**
   * Applies a slight random velocity so drops scatter when spawned.
   * Makes pickup fields visually readable and prevents pile-up.
   */
  _applySpawnImpulse(drop) {
    const body = drop?.body;
    if (!body) return;

    // Safe config extraction with fallback.
    const impulse = CONFIG.XP.SPAWN_IMPULSE ?? {};
    const min = Math.max(0, impulse.MIN ?? 0);
    const max = Math.max(min, impulse.MAX ?? min);

    // If no impulse configured, ensure drop is stationary.
    if (max <= 0) {
      body.setVelocity(0, 0);
      return;
    }

    // Pick a random direction and a random speed between MIN → MAX.
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const speed = Phaser.Math.FloatBetween(min, max);

    // Apply as initial velocity.
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }
}
