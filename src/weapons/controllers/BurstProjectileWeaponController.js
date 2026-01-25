import Phaser from 'phaser';
import { WeaponControllerBase } from './WeaponControllerBase.js';
import * as Cooldown from '../core/Cooldown.js';
import * as Facing from '../core/Facing.js';
import * as Salvo from '../core/Salvo.js';
import { runAoe } from '../AoeUtils.js';
import { orientSingleFrameThrow } from '../core/ThrowVisuals.js';
import * as TargetSelect from '../targeting/TargetSelect.js';
import { attachSpinWhileFlying } from '../core/SpinWhileFlying.js';

/**
 * BurstProjectileWeaponController
 * -------------------------------
 * Controller for “burst-style” weapons — those that emit multiple projectiles
 * at once in a fan, arc, or full 360° ring. Each projectile is a straight-line
 * single-frame shot (e.g. Venus's Revenge).
 *
 * This provides:
 * - Cadence handling (delay, salvo, spread)
 * - Burst patterns (fan, ring)
 * - Targeting modes (self, facing, auto)
 * - Full projectile config passthrough (speed, gravity, pierce, explosion, etc.)
 * - Reusable visual orientation helper for single-frame projectiles
 */
export class BurstProjectileWeaponController extends WeaponControllerBase {
  /** Initialize BurstProjectileWeaponController state so runtime dependencies are ready. */
  constructor(scene, owner, weaponConfig, options = {}) {
    super(scene, owner, weaponConfig, options);

    // Provided by WeaponManager; used to spawn/recycle projectile sprites
    this.projectilePool = options.projectilePool ?? null;

    // Optional pool for muzzle/impact FX callbacks
    this.fxPool = options.fxPool ?? null;

    // Schedule first available fire time
    const delay = this.getEffectiveDelayMs();
    const now = this.scene?.time?.now ?? Date.now();
    this.nextFireAtMs = this._scheduleInitial(now, delay);
  }

  /**
   * Default cooldown for burst weapons unless overridden by modifiers/config.
   */
  getEffectiveDelayMs() {
    return this._effectiveDelayMs(1600);
  }

  /**
   * Main update loop — triggers firing when allowed.
   */
  update(_dt) {
    const now = this.scene?.time?.now ?? Date.now();

    // Initialize the next fire time if missing
    if (!Number.isFinite(this.nextFireAtMs)) {
      this.nextFireAtMs = this._scheduleInitial(now, this.getEffectiveDelayMs());
    }

    // Check cooldown
    if (!Cooldown.shouldFire(now, this.nextFireAtMs)) return;

    // If owner implements canFire(), respect it
    if (typeof this.owner?.canFire === 'function' && !this.owner.canFire()) return;

    const origin = this.owner?.getPos?.();
    if (!origin) return;

    // Prune target reservations (auto-aim)
    this.targetingCoordinator?.prune(now);

    // Handle salvos (multi-shot bursts)
    const salvoCount = Math.max(1, this.effectiveConfig?.cadence?.salvo ?? 1);
    const salvoSpread = (this.effectiveConfig?.cadence?.spreadDeg ?? 0) * Phaser.Math.DEG_TO_RAD;

    // Fire each salvo using its offset
    for (let salvoIndex = 0; salvoIndex < salvoCount; salvoIndex += 1) {
      const salvoOffset = Salvo.spreadOffset(salvoIndex, salvoCount, salvoSpread);
      this._fireBurst(origin, salvoOffset);
    }

    // Schedule next shot
    const delayMs = this.getEffectiveDelayMs();
    this.nextFireAtMs = this._scheduleNext(now, delayMs);

    // Events for UI / analytics / debugging
    this.events.emit('controller:fired', { delayMs, nextFireAt: this.nextFireAtMs });
    this.bus?.emit('weapons:fired', this.baseConfig?.key);
  }

  /**
   * Determine the aiming base angle:
   * - 'facing' → use owner's facing direction
   * - 'auto' → target nearest enemy in range
   * - 'self' (default) → forward/right (0 rad)
   */
  _resolveAimAngle(origin) {
    const arch = this.effectiveConfig?.archetype || {};
    const aimMode = arch.aim ?? 'self';

    // Aim in direction hero is facing
    if (aimMode === 'facing') {
      return Facing.resolve(this.owner) ?? 0;
    }

    // Auto-target nearest enemy
    if (aimMode === 'auto') {
      const range = this.effectiveConfig?.targeting?.range ?? 420;
      const target = TargetSelect.nearest(this.enemyGroup, origin, range);
      if (target) {
        return Phaser.Math.Angle.Between(origin.x, origin.y, target.x, target.y);
      }
    }

    // Default orientation (to the right)
    return 0;
  }

  /**
   * Emit the configured number of projectiles according to the defined pattern.
   */
  _fireBurst(origin, salvoOffset = 0) {
    if (!this.projectilePool) return;

    const burstCfg = this.effectiveConfig?.burst || {};
    const count = Math.max(1, burstCfg.count ?? 1);
    const spreadRad = (burstCfg.spreadDeg ?? 0) * Phaser.Math.DEG_TO_RAD;
    const baseAngleDeg = burstCfg.baseAngleDeg ?? 0;
    const pattern = burstCfg.pattern || 'fan'; // 'fan' or 'ring'

    // Determine orientation for the whole burst
    const aimBase = this._resolveAimAngle(origin);
    const baseAngle = aimBase + (baseAngleDeg * Phaser.Math.DEG_TO_RAD) + salvoOffset;

    const projectileConfig = this.effectiveConfig?.projectile || {};
    const projectilesFired = [];

    // Create each projectile
    for (let i = 0; i < count; i += 1) {
      const projectile = this.projectilePool.acquire();
      if (!projectile) continue;

      // Determine actual angle for this projectile
      let angle = baseAngle;

      if (pattern === 'ring') {
        // Evenly distributed around full 360°
        angle = baseAngle + (i * ((Math.PI * 2) / count));
      } else {
        // Fan distribution using Salvo’s helper
        angle = baseAngle + Salvo.spreadOffset(i, count, spreadRad);
      }

      // Fire core projectile
      projectile.fire({
        x: origin.x,
        y: origin.y,
        angle,
        speed: projectileConfig.speed ?? 0,
        gravity: projectileConfig.gravity ?? 0,
        acceleration: projectileConfig.acceleration ?? 0,
        rotateToVelocity: !!projectileConfig.rotateToVelocity,
        maxDistance: projectileConfig.maxDistance ?? 0,
        lifetimeMs: projectileConfig.lifetimeMs ?? 600,
        damage: this.effectiveConfig?.damage,
        controller: this,
        pierce: projectileConfig.pierce ?? 0,
        explosion: projectileConfig.explosion ?? null,
        animKey: projectileConfig.animKey ?? null
      });

      // Orient the single-frame asset visually (rotation to travel direction + asset offset)
      orientSingleFrameThrow(projectile, {
        assetForwardDeg: projectileConfig.assetForwardDeg ?? 0,
        travelAngleRad: angle,
        resetOnRelease: projectileConfig.resetRotationOnRelease ?? false
      });

      // Attach optional spin behaviour when configured on the projectile/archetype
      const archSpin = this.effectiveConfig?.archetype?.spin;
      const spinSpeed = Number.isFinite(projectileConfig.spinSpeedRadPerSec)
        ? projectileConfig.spinSpeedRadPerSec
        : Number.isFinite(archSpin?.spinSpeedRadPerSec)
          ? archSpin.spinSpeedRadPerSec
          : 0;

      if (spinSpeed) {
        const resetOnRelease =
          projectileConfig.resetSpinOnRelease ??
          projectileConfig.resetRotationOnRelease ??
          true;
        attachSpinWhileFlying(projectile, {
          spinSpeedRadPerSec: spinSpeed,
          resetOnRelease
        });
      }

      projectilesFired.push({ projectile, angle });
    }

    // Optional muzzle flash / burst FX
    if (projectilesFired.length > 0) {
      this.fxPool?.muzzle?.(origin, baseAngle);
    }
  }

  /**
   * Called by projectile on hit. Handles:
   * - Deduping hits
   * - Applying damage pipeline
   * - Impact FX
   * - Piercing logic
   * - Explosion AOE if configured
   * - Pool recycling
   */
  onProjectileImpact(projectile, enemy) {
    // Prevent duplicate hits against same enemy
    const hitSet = projectile?._weaponData?.hitSet;
    if (hitSet && hitSet.has(enemy)) return;
    hitSet?.add(enemy);

    // Build the damage payload
    const payload = this.buildDamagePayload();

    // Apply single-target damage
    this.damagePipeline?.applyHit(enemy, payload);

    // Spawn impact visual
    this.fxPool?.impact?.(projectile.x, projectile.y);

    // If projectile had a reservation, consume it on hit
    const reservation = projectile?._weaponData?.reservation;
    if (reservation && reservation.enemy === enemy) {
      this.targetingCoordinator?.consumeReservation(reservation);
      projectile._weaponData.reservation = null;
    }

    // Handle pierce remaining
    let remaining = projectile?._weaponData?.pierceRemaining ?? 0;
    if (remaining > 0) {
      projectile._weaponData.pierceRemaining = remaining - 1;

      return; // keep projectile flying, no explosion / release yet
    }

    // Handle explosion-on-impact AOE
    const explosionCfg = projectile?._weaponData?.explosionCfg;
    if (explosionCfg && this.enemyGroup) {
      runAoe({
        scene: this.scene,
        enemyGroup: this.enemyGroup,
        origin: { x: projectile.x, y: projectile.y },
        baseDamage: payload.damage,
        cfg: {
          enabled: true,
          radius: explosionCfg.radius ?? 64,
          damageMult: explosionCfg.damageMult ?? 1,
          maxTargets: Number.isFinite(explosionCfg.maxTargets)
            ? explosionCfg.maxTargets
            : Infinity,
          falloff: explosionCfg.falloff ?? 0,
          timing: 'impact'
        },
        damagePipeline: this.damagePipeline,
        sourceKey: this.baseConfig?.key,
        payload
      });
    }

    // Return projectile to pool
    this.projectilePool?.release(projectile);
  }
}
