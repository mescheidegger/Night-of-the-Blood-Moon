import Phaser from 'phaser';
import { WeaponControllerBase } from './WeaponControllerBase.js';
import * as Cooldown from '../core/Cooldown.js';
import * as AnimSafe from '../core/AnimSafe.js';
import * as AoeTiming from '../core/AoeTiming.js';
import * as TargetSelect from '../targeting/TargetSelect.js';
import { runAoe } from '../AoeUtils.js';

/**
 * ClusterBombWeaponController
 *
 * This controller now targets the **nearest enemy within range**, and creates a
 * "patch" centered on that enemy. Several clusterbomb explosions are spawned
 * within that patch (scattered around the target).
 *
 * The weapon does NOT use projectile physics — each explosion is spawned at a
 * location and plays an animation that triggers AoE damage.
 *
 * Things controlled here:
 *  - Cooldown timing
 *  - Nearest-enemy targeting within range
 *  - Number, spacing, and stagger timing of explosions
 *  - AoE damage application timing (via AoeTiming + AnimSafe helpers)
 */
export class ClusterBombWeaponController extends WeaponControllerBase {
  /** Initialize ClusterBombWeaponController state so runtime dependencies are ready. */
  constructor(scene, owner, weaponConfig, options = {}) {
    super(scene, owner, weaponConfig, options);

    // Schedule initial fire so the first volley doesn’t happen instantly.
    const delay = this.getEffectiveDelayMs();
    const now = this.scene?.time?.now ?? Date.now();
    this.nextFireAtMs = this._scheduleInitial(now, delay);
  }

  /**
   * Returns base cooldown duration, possibly modified by buffs.
   * Default = 3000ms between volleys.
   */
  getEffectiveDelayMs() {
    return this._effectiveDelayMs(3000);
  }

  /**
   * Main update tick called every frame.
   * Decides whether to fire and triggers cluster spawn when ready.
   */
  update(_dt) {
    const now = this.scene?.time?.now ?? Date.now();

    // Ensure an initial firing time is scheduled
    if (!Number.isFinite(this.nextFireAtMs)) {
      this.nextFireAtMs = this._scheduleInitial(now, this.getEffectiveDelayMs());
    }

    // Skip until cooldown expires
    if (!Cooldown.shouldFire(now, this.nextFireAtMs)) return;

    // If owner has "canFire()" logic, obey it
    if (typeof this.owner?.canFire === 'function' && !this.owner.canFire()) return;

    // Get firing origin (usually hero position)
    const origin = this.owner?.getPos?.();
    if (!origin) return;

    // Acquire nearest valid target within range
    const range = Math.max(0, this.effectiveConfig?.targeting?.range ?? 480);
    const target = TargetSelect.nearest(this.enemyGroup, origin, range);
    if (!target) return; // no enemy in range → do not consume cooldown

    // Spawn the actual clusterbomb patch centered on the target
    this._spawnPatch({ x: target.x, y: target.y });

    // Schedule next firing window
    const delayMs = this.getEffectiveDelayMs();
    this.nextFireAtMs = this._scheduleNext(now, delayMs);

    // Broadcast events (UI, analytics, HUD effects, etc.)
    this.events.emit('controller:fired', { delayMs, nextFireAt: this.nextFireAtMs });
    this.bus?.emit('weapons:fired', this.baseConfig?.key);
  }

  /**
   * Creates a "patch" centered on a provided location (usually the nearest enemy),
   * then spawns several clusterbomb explosions inside that patch,
   * optionally staggered over time.
   */
  _spawnPatch(center) {
    // Cluster configuration — how many explosions, how far apart, and how staggered in time
    const clusterCfg = this.effectiveConfig?.archetype?.cluster ?? {};
    const count = Math.max(1, Math.floor(clusterCfg.count ?? 3));
    const spread = Math.max(0, clusterCfg.spreadRadius ?? 72); // Max radius of scatter area
    const stagger = Math.max(0, clusterCfg.staggerMs ?? 60);    // Delay between bombs in ms

    const patch = {
      x: center.x,
      y: center.y
    };

    // Spawn each bomb, scattered around the patch center
    for (let i = 0; i < count; i += 1) {
      // Random offset inside the spread radius
      const bombAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dist = Phaser.Math.FloatBetween(0, spread);
      const x = patch.x + Math.cos(bombAngle) * dist;
      const y = patch.y + Math.sin(bombAngle) * dist;
      const delay = i * stagger;

      // If stagger applies, delay spawn; otherwise spawn immediately
      if (delay > 0 && this.scene?.time?.delayedCall) {
        this.scene.time.delayedCall(delay, () => this._spawnOne(x, y));
      } else {
        this._spawnOne(x, y);
      }
    }
  }

  /**
   * Spawn a single clusterbomb explosion sprite at (x, y),
   * trigger AoE based on animation frame timing using AoeTiming+AnimSafe.
   */
  _spawnOne(x, y) {
    if (!this.scene?.add) return;

    // Texture + animation come from weapon config
    const tex = this.effectiveConfig?.projectile?.texture ?? 'clusterbomb';
    const animKey = this.effectiveConfig?.projectile?.animKey ?? 'clusterbomb-explode';

    // Spawn effect sprite at target location
    const sprite = this.scene.add
      .sprite(x, y, tex)
      .setDepth(7)
      .setOrigin(0.5, 0.5);

    // Damage payload derived from config (crit, base damage, modifiers, etc.)
    const payload = this.buildDamagePayload();

    // AoE config tells us radius, maxTargets, falloff, timing, etc.
    const aoeCfg = this.effectiveConfig?.aoe;

    // Attach a state-tracker that triggers AoE at defined animation frame/time
    const aoeState = AoeTiming.attach(sprite, aoeCfg, {
      trigger: () => {
        runAoe({
          scene: this.scene,
          enemyGroup: this.enemyGroup,
          origin: { x, y },
          baseDamage: payload.damage,
          cfg: aoeCfg,
          damagePipeline: this.damagePipeline,
          sourceKey: this.baseConfig?.key,
          payload
        });
      },
      defaultFrameIndex: 10 // If animation not found, use this frame to trigger AoE
    });

    // Animation event handlers (for timing, complete, cleanup)
    const handlers = aoeState.listeners || {};

    /**
     * Cleanup routine:
     *  - detaches timing hooks
     *  - stops animation tracking
     *  - forces AoE trigger if not already fired
     *  - destroys sprite
     */
    const cleanup = () => {
      aoeState.detach();
      AnimSafe.detach(sprite, handlers);

      // Ensure AoE triggers once before removing sprite
      if (!aoeState.triggered) {
        aoeState.trigger();
      }

      // Remove sprite safely if still in a scene
      if (sprite.scene) {
        sprite.destroy();
      }
    };

    // Wrap the animation completion handler so we ensure cleanup always happens
    const originalComplete = handlers.onComplete;
    handlers.onComplete = (...args) => {
      originalComplete?.(...args);
      cleanup();
    };

    // Attempt to play the configured animation
    const result = AnimSafe.playIfExists(sprite, animKey, handlers);

    // If animation does not exist, fallback to timed cleanup + AoE trigger
    if (!result.played) {
      // If AoE is not tied to "expire", trigger immediately
      if (aoeCfg?.timing !== 'expire') {
        aoeState.trigger();
      }

      // Attempt a short fallback timer before cleanup
      const timer = this.scene?.time?.delayedCall?.(200, cleanup);

      // If no timer system exists, cleanup immediately
      if (!timer) {
        cleanup();
      }
    }
  }
}
