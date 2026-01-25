import Phaser from 'phaser';
import { WeaponControllerBase } from './WeaponControllerBase.js';
import * as Cooldown from '../core/Cooldown.js';
import * as Facing from '../core/Facing.js';
import * as AnimSafe from '../core/AnimSafe.js';
import * as AoeTiming from '../core/AoeTiming.js';
import { runAoe } from '../AoeUtils.js';

/**
 * SlashWeaponController
 * ---------------------
 * Directional, melee-style “slash” attack:
 * - On cooldown expiry, spawns a short-lived slash sprite in front of the owner,
 *   rotated to the facing angle.
 * - Uses AoeTiming to trigger damage once (usually at a specific animation frame).
 * - Can optionally keep the VFX glued to the owner during the animation (followOwner).
 *
 * Notes:
 * - Damage is applied via runAoe() (area hit), not via the sprite’s physics body.
 * - Visual animation is played through AnimSafe helpers (gracefully no-op if missing).
 */
export class SlashWeaponController extends WeaponControllerBase {
  /** Initialize SlashWeaponController state so runtime dependencies are ready. */
  constructor(scene, owner, weaponConfig, options = {}) {
    super(scene, owner, weaponConfig, options);

    // Seed first fire time with jitter to desync same-type weapons.
    const now = this.scene?.time?.now ?? Date.now();
    const delay = this.getEffectiveDelayMs();
    this.nextFireAtMs = this._scheduleInitial(now, delay);

    // Pointer to a cleanup function for the currently active slash (if any).
    this._activeCleanup = null;
  }

  /**
   * Effective cooldown for slashes.
   * Clamp to a small minimum to avoid “strobe” effects on heavy buffs.
   */
  getEffectiveDelayMs() {
    return Math.max(120, this._effectiveDelayMs(700));
  }

  /**
   * Ensure any in-flight VFX/listeners are removed on destroy.
   */
  destroy() {
    this._cleanupActive();
    super.destroy();
  }

  /**
   * Per-frame tick:
   * - Honor cooldown & owner fire gating.
   * - Resolve facing angle and execute a single slash.
   * - Reschedule next fire.
   */
  update(_dt) {
    const now = this.scene?.time?.now ?? Date.now();

    // If not scheduled yet (e.g., controller hot-added), create initial schedule.
    if (!Number.isFinite(this.nextFireAtMs)) {
      this.nextFireAtMs = this._scheduleInitial(now, this.getEffectiveDelayMs());
    }

    // Cooldown not ready → skip.
    if (!Cooldown.shouldFire(now, this.nextFireAtMs)) return;

    // Owner temporarily cannot fire (stun, menu, etc.) → skip.
    if (typeof this.owner?.canFire === 'function' && !this.owner.canFire()) return;

    // Owner position needed to spawn the slash.
    const origin = this.owner?.getPos?.();
    if (!origin) return;

    // Compute directional angle and fire the slash.
    const facingAngle = this._resolveFacingAngle();
    this._fireSlash(origin, facingAngle);

    // Schedule next trigger window.
    const delayMs = this.getEffectiveDelayMs();
    this.nextFireAtMs = this._scheduleNext(now, delayMs);

    // Local + global hooks (HUD, analytics, SFX).
    this.events.emit('controller:fired', { delayMs, nextFireAt: this.nextFireAtMs });
    this.bus?.emit('weapons:fired', this.baseConfig?.key);
  }

  /**
   * Resolve a numeric facing angle (radians) for the owner.
   * Falls back to 0 (facing right) if unavailable.
   */
  _resolveFacingAngle() {
    const angle = Facing.resolve(this.owner);
    return Number.isFinite(angle) ? angle : 0;
  }

  /**
   * If a prior slash is still active, cleanly end it (detach + destroy).
   */
  _cleanupActive() {
    if (typeof this._activeCleanup === 'function') {
      this._activeCleanup();
      this._activeCleanup = null;
    }
  }

  /**
   * Spawn & manage a single slash instance:
   * - Places the sprite offset in front of the owner along 'angle'.
   * - Plays the configured animation if available.
   * - Uses AoeTiming to fire damage once (at target frame or fallback).
   * - Optionally keeps the sprite glued to the owner each anim frame.
   * - Auto-cleans at animation end or after a lifetime timeout.
   */
  _fireSlash(origin, angle) {
    // End any previous slash before starting a new one (defensive).
    this._cleanupActive();

    // Read archetype knobs from effective config.
    const slashCfg = this.effectiveConfig?.archetype?.slash ?? {};
    const offset = slashCfg.offsetPx ?? 0;                 // distance in front of owner
    const followOwner = slashCfg.followOwner !== false;    // true by default
    const triggerFrameIndex = slashCfg.triggerFrameIndex ?? 0; // frame to apply AoE

    // Compute initial spawn position for the VFX sprite.
    const spawnX = origin.x + Math.cos(angle) * offset;
    const spawnY = origin.y + Math.sin(angle) * offset;

    // Visual setup (texture/anim/lifetime).
    const projectileCfg = this.effectiveConfig?.projectile ?? {};
    const textureKey = projectileCfg.texture ?? 'whiteslash';
    const animKey = projectileCfg.animKey ?? 'sword-slash';
    const lifetimeMs = projectileCfg.lifetimeMs ?? 200;

    // Create the slash sprite; if creation fails, abort.
    const sprite = this.scene?.add?.sprite?.(spawnX, spawnY, textureKey);
    if (!sprite) return;

    // Depth above mobs and centered rotation around sprite middle.
    sprite.setDepth(7).setOrigin(0.5, 0.5).setRotation(angle);

    // Prebuild the damage payload (base, crits, statuses) from effective config.
    const payload = this.buildDamagePayload();

    // AoE config + a few extra knobs for slashes (radius/arc/aim angle).
    const aoeConfig = this.effectiveConfig?.aoe ?? {};
    // Use hero center for AoE origin; keep sprite offset purely visual.
    const ownerPosNow = this.owner?.getPos?.() ?? origin;
    
    const runConfig = {
      ...aoeConfig,
      // Ensure the cone reaches past the visual offset: (offset + slash length)
      radius: Math.max(aoeConfig.radius ?? 0, (slashCfg.lengthPx ?? 0) + Math.max(0, offset)),
      arcDeg: slashCfg.arcDeg ?? aoeConfig.arcDeg,
      angleRad: angle,
      // NEW: tiny near-body auto-hit forgiveness (see AoeUtils change)
      innerForgivenessPx: Math.max(aoeConfig.innerForgivenessPx ?? 0, 20)
    };

    const computeOrigin = () => ownerPosNow; // cone starts at the player, not the offset


    // Attach timing so we trigger AoE once (when the anim hits target frame).
    const aoeState = AoeTiming.attach(sprite, aoeConfig, {
      trigger: () => {
        const originPoint = computeOrigin();
        runAoe({
          scene: this.scene,
          enemyGroup: this.enemyGroup,
          origin: originPoint,
          baseDamage: payload.damage,
          cfg: runConfig,
          damagePipeline: this.damagePipeline,
          sourceKey: this.baseConfig?.key,
          payload
        });
      },
      defaultFrameIndex: triggerFrameIndex
    });

    // AnimSafe will store bound callbacks inside this holder.
    const handlers = aoeState.listeners || {};

    // If we want the slash to stay “glued” in front of the owner, move it on each anim frame.
    let followHandler = null;
    if (followOwner) {
      followHandler = () => {
        const ownerPos = this.owner?.getPos?.();
        if (!ownerPos) return;
        const nextX = ownerPos.x + Math.cos(angle) * offset;
        const nextY = ownerPos.y + Math.sin(angle) * offset;
        sprite.setPosition(nextX, nextY);
      };
      // Keep a single source of truth for follow updates — hang on the sprite anim update.
      sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, followHandler);
      // Snap once immediately so first frame is properly placed.
      followHandler();
    }

    // Safety timer in case the animation doesn't complete (or as a “kill after” cap).
    let timer = null;
    let cleaned = false;

    // Centralized cleanup (idempotent):
    // - removes timer & listeners
    // - ensures AoE fired at least once (unless told to skip)
    // - destroys sprite
    // - clears _activeCleanup pointer
    const cleanup = (skipForceTrigger = false) => {
      if (cleaned) return;
      cleaned = true;

      // Cancel timeout if pending.
      timer?.remove?.();
      timer = null;

      // Remove follow listener if installed.
      if (followHandler) {
        sprite.off(Phaser.Animations.Events.ANIMATION_UPDATE, followHandler);
      }

      // Detach AoE timing + anim hooks.
      aoeState.detach();
      AnimSafe.detach(sprite, handlers);

      // If animation never reached the trigger point, force the hit once.
      if (!skipForceTrigger && !aoeState.triggered) {
        aoeState.trigger();
      }

      // Destroy the visual if still alive in a scene.
      if (sprite.scene) {
        sprite.destroy();
      }

      // Clear active cleanup pointer if this is the current instance.
      if (this._activeCleanup === cleanup) {
        this._activeCleanup = null;
      }
    };

    // Ensure cleanup runs when animation completes (and still allow the original handler).
    const originalComplete = handlers.onComplete;
    handlers.onComplete = (...args) => {
      originalComplete?.(...args);
      cleanup();
    };

    // Try to play the configured animation (gracefully no-op if anim is missing).
    const result = AnimSafe.playIfExists(sprite, animKey, handlers);

    // If there’s no animation registered for this texture/key:
    // - optionally trigger AoE immediately (unless timing=expire)
    // - cleanup right away (skip force trigger since we just did it)
    if (!result.played) {
      if (aoeConfig?.timing !== 'expire') {
        aoeState.trigger();
      }
      cleanup(true);
      return;
    }

    // Fallback timeout: ensure we clean up even if COMPLETE never fires (e.g., repeat set elsewhere).
    timer = this.scene?.time?.delayedCall?.(lifetimeMs, () => cleanup());
    if (!timer) {
      // If timers not available, cleanup immediately.
      cleanup();
    }

    // Expose this instance’s cleanup so a new slash can cancel it before starting.
    this._activeCleanup = cleanup;
  }
}
