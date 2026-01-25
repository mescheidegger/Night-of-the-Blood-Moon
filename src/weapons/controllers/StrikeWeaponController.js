import { WeaponControllerBase } from './WeaponControllerBase.js';
import * as Cooldown from '../core/Cooldown.js';
import * as AnimSafe from '../core/AnimSafe.js';
import * as AoeTiming from '../core/AoeTiming.js';
import * as TargetSelect from '../targeting/TargetSelect.js';
import { runAoe } from '../AoeUtils.js';

/**
 * Strike-style weapon controller.
 * 
 * This covers weapons like lightning strikes that:
 *  - target a single enemy instantly (not a projectile)
 *  - optionally play an animation at the target position
 *  - optionally trigger an AoE at a specific animation frame or event
 *  - respect cooldown timing and global modifier changes
 */
export class StrikeWeaponController extends WeaponControllerBase {
  /** Initialize StrikeWeaponController state so runtime dependencies are ready. */
  constructor(scene, owner, weaponConfig, options = {}) {
    super(scene, owner, weaponConfig, options);

    // Compute jittered initial fire time so multiple strike weapons don't sync perfectly
    const now = scene?.time?.now ?? Date.now();
    const delay = this.getEffectiveDelayMs();
    this.nextFireAtMs = this._scheduleInitial(now, delay);
  }

  /**
   * Returns the cooldown for this strike weapon, with a minimum clamp
   * to avoid extremely rapid blinking effects if delayMs modifiers go negative.
   */
  getEffectiveDelayMs() {
    return Math.max(40, this._effectiveDelayMs(1200));
  }

  /**
   * Called every frame:
   *  - Check whether it's time to fire
   *  - Ensure the owner is allowed to fire
   *  - Acquire a target via nearest-enemy targeting
   *  - Execute the strike + AoE trigger workflow
   */
  update(_dt) {
    const now = this.scene?.time?.now ?? Date.now();

    // If next fire timestamp was never set, compute initial schedule.
    if (!Number.isFinite(this.nextFireAtMs)) {
      this.nextFireAtMs = this._scheduleInitial(now, this.getEffectiveDelayMs());
    }

    // Not time yet → return early
    if (!Cooldown.shouldFire(now, this.nextFireAtMs)) return;

    // If hero is stunned or otherwise cannot fire → do nothing
    if (typeof this.owner?.canFire === 'function' && !this.owner.canFire()) return;

    // Determine strike origin (usually the hero)
    const origin = this.owner?.getPos?.();
    if (!origin) return;

    // Acquire nearest valid target within range
    const range = this.effectiveConfig?.targeting?.range ?? 0;
    const target = TargetSelect.nearest(this.enemyGroup, origin, range);
    if (!target) return;

    // Execute the actual strike logic
    this._strike(target);

    // Reschedule next cooldown
    const delayMs = this.getEffectiveDelayMs();
    this.nextFireAtMs = this._scheduleNext(now, delayMs);

    // Emit events for HUD / SFX hooks
    this.events.emit('controller:fired', { delayMs, nextFireAt: this.nextFireAtMs });
    this.bus?.emit('weapons:fired', this.baseConfig?.key);
  }

  /**
   * Performs the actual strike on the target.
   * Handles:
   *  - creating the strike sprite at the enemy position
   *  - applying single-target damage
   *  - scheduling or synchronizing AoE timing (based on animation)
   *  - cleanup after animation completes or timeout
   */
  _strike(enemy) {
    if (!enemy) return;

    // The strike visual uses the weapon's projectile.texture as a sprite
    const projectileCfg = this.effectiveConfig?.projectile ?? {};
    const textureKey = projectileCfg.texture ?? 'lightning';
    const animKey = projectileCfg.animKey ?? null;

    let sprite = null;

    // Spawn a temporary sprite effect on the enemy
    if (this.scene?.add && textureKey) {
      sprite = this.scene.add.sprite(enemy.x, enemy.y, textureKey)
        .setDepth(7)
        .setOrigin(0.5, 1);
    }

    // Compute how much damage this strike should apply
    const payload = this.buildDamagePayload();

    // Apply direct single-target damage
    this.damagePipeline?.applyHit(enemy, payload);

    // Configure AOE trigger logic (may trigger on animation frame or instantly)
    const aoeConfig = this.effectiveConfig?.aoe;
    const aoeState = AoeTiming.attach(sprite, aoeConfig, {
      trigger: () => {
        // Execute area-of-effect damage centered on the struck enemy
        runAoe({
          scene: this.scene,
          enemyGroup: this.enemyGroup,
          origin: { x: enemy.x, y: enemy.y },
          baseDamage: payload.damage,
          cfg: aoeConfig,
          damagePipeline: this.damagePipeline,
          sourceKey: this.baseConfig?.key,
          exclude: enemy, // don't double-damage the struck target,
          payload
        });
      },
      defaultFrameIndex: 0
    });

    const handlers = aoeState.listeners || {};

    // Cleanup logic to run after animation finishes or fallback timeout
    const cleanup = () => {
      aoeState.detach();          // detach AoE timing tracking
      AnimSafe.detach(sprite, handlers); // remove frame/complete listeners
      if (!aoeState.triggered) {
        aoeState.trigger();       // ensure AoE runs if animation never triggered it
      }
      if (sprite?.scene) {
        sprite.destroy();         // remove temporary visual
      }
    };

    // Ensure cleanup runs after animation completes
    const originalComplete = handlers.onComplete;
    handlers.onComplete = (...args) => {
      originalComplete?.(...args);
      cleanup();
    };

    // Try playing strike animation if defined
    let played = false;
    if (sprite) {
      const result = AnimSafe.playIfExists(sprite, animKey, handlers);
      played = result.played;
    }

    // Fallback: If no animation exists, trigger AoE immediately and cleanup quickly
    if (!played) {
      if (aoeConfig?.timing !== 'expire') {
        aoeState.trigger();
      }
      const timer = this.scene?.time?.delayedCall?.(200, cleanup);
      if (!timer) {
        cleanup();
      }
    }
  }
}
