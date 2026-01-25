import Phaser from 'phaser';
import { WeaponControllerBase } from './WeaponControllerBase.js';
import * as Cooldown from '../core/Cooldown.js';
import * as Facing from '../core/Facing.js';
import * as Salvo from '../core/Salvo.js';
import { runAoe } from '../AoeUtils.js';
import * as TargetSelect from '../targeting/TargetSelect.js';
import { attachSpinWhileFlying } from '../core/SpinWhileFlying.js';

/**
 * Projectile-style weapon controller.
 *
 * Responsibilities:
 *  - Manages firing cadence / cooldown
 *  - Chooses targets (auto-aim or use facing direction)
 *  - Handles spread, multi-shot, and salvo spacing
 *  - Spawns / recycles projectiles from the pool
 *  - Applies projectile-based damage + optional AoE on impact
 *  - Uses TargetingCoordinator for overkill prevention (optional)
 */
export class ProjectileWeaponController extends WeaponControllerBase {
  /** Initialize ProjectileWeaponController state so runtime dependencies are ready. */
  constructor(scene, owner, weaponConfig, options = {}) {
    super(scene, owner, weaponConfig, options);

    // Pool providing projectile instances (recycled, not created each shot)
    this.projectilePool = options.projectilePool ?? null;

    // Optional effects pool (e.g., muzzle flash, hit sparks)
    this.fxPool = options.fxPool ?? null;

    // Schedule the first shot (with jitter from Cooldown utils)
    const delay = this.getEffectiveDelayMs();
    const now = this.scene?.time?.now ?? Date.now();
    this.nextFireAtMs = this._scheduleInitial(now, delay);

    this._readyAnnounced = false;
  }

  /**
   * Returns the effective cooldown delay, optionally modified by buffs.
   */
  getEffectiveDelayMs() {
    return this._effectiveDelayMs(600);
  }

  /**
   * Resolve player's facing angle when in "facing" mode.
   * We delegate to a shared Facing utility, so we don't duplicate logic here.
   */
  _resolveFacingAngle() {
    return Facing.resolve(this.owner);
  }

  /**
   * Called every frame. Determines whether it is time to fire, selects target,
   * computes salvo + spread, and issues one or more projectiles.
   */
  update(_dt) {
    const now = this.scene?.time?.now ?? Date.now();

    // If first fire was never scheduled, initialize it
    if (!Number.isFinite(this.nextFireAtMs)) {
      this.nextFireAtMs = this._scheduleInitial(now, this.getEffectiveDelayMs());
    }

    // If not cooled down yet, skip firing
    if (!Cooldown.shouldFire(now, this.nextFireAtMs)) return;

    // Check if weapon owner (hero) is allowed to fire this frame
    if (typeof this.owner?.canFire === 'function' && !this.owner.canFire()) return;

    // Get firing origin (usually hero position)
    const origin = this.owner?.getPos?.();
    if (!origin) return;

    // Determine mode: auto-target, or fire in facing direction
    const arch = this.effectiveConfig?.archetype || {};
    const aimMode = arch.aim || 'auto';

    // Prune expired targeting reservations if used
    this.targetingCoordinator?.prune(now);

    let targetData = null;
    let target = null;
    let baseAngleOverride = null;

    // Auto-aim: pick a target
    if (aimMode === 'auto') {
      targetData = this._selectTarget(origin, now);
      target = targetData?.target;
      if (!target) return; // If no target is in range → do nothing
    }
    // Facing: fire in the direction the hero is moving/facing
    else if (aimMode === 'facing') {
      baseAngleOverride = this._resolveFacingAngle();
    }

    // Determine how many shots per trigger and how wide the spread is
    const baseSalvo = Math.max(1, this.effectiveConfig?.cadence?.salvo ?? 1);
    const passiveManager = this.scene?.passiveManager;
    const passiveBonus = passiveManager?.getProjectileSalvoBonus?.() ?? 0;
    const salvo = Math.max(1, baseSalvo + passiveBonus);
    const spread = (this.effectiveConfig?.cadence?.spreadDeg ?? 0) * Phaser.Math.DEG_TO_RAD;

    // Time spacing between salvo shots, if configured
    const spacing = targetData?.salvoSpacingMs ?? Salvo.spacingMs(this.effectiveConfig);

    // Fire each projectile in the salvo
    for (let i = 0; i < salvo; i += 1) {
      const impactTime = (targetData?.impactTime ?? now) + (i * spacing);
      this._fireProjectile(origin, target, salvo, spread, i, impactTime, baseAngleOverride);
    }

    // Cooldown reset for the next firing window
    const delayMs = this.getEffectiveDelayMs();
    this.nextFireAtMs = this._scheduleNext(now, delayMs);

    // Emit local + global events (for UI HUD / analytics / SFX)
    this.events.emit('controller:fired', { delayMs, nextFireAt: this.nextFireAtMs });
    this.bus?.emit('weapons:fired', this.baseConfig?.key);
  }

  /**
   * Handles the actual spawning + configuring of a projectile instance.
   */
  _fireProjectile(origin, target, salvo, spreadRad, index, projectedImpactTime, baseAngleOverride = null) {
    if (!this.projectilePool) return;

    const projectile = this.projectilePool.acquire();
    if (!projectile) return; // Pool exhausted → skip

    const pos = this.owner?.getPos?.();
    const facing = this._resolveFacingAngle();
    const arch = this.effectiveConfig?.archetype || {};
    const trajectory = arch.trajectory || 'straight';

    let angle = baseAngleOverride;

    // **Straight-line projectile** (e.g., arrows, bolts, bullets)
    if (trajectory === 'straight') {
      // Determine the primary firing angle: target or facing direction
      if (!Number.isFinite(angle)) {
        angle = target
          ? Phaser.Math.Angle.Between(pos.x, pos.y, target.x, target.y)
          : facing;
      }

      // Apply spread offset for multi-shot patterns
      angle += Salvo.spreadOffset(index, salvo, spreadRad);

      // Initialize projectile flight
      projectile.fire({
        x: pos.x,
        y: pos.y,
        angle,
        speed: this.effectiveConfig?.projectile?.speed ?? 0,
        gravity: this.effectiveConfig?.projectile?.gravity ?? 0,
        acceleration: this.effectiveConfig?.projectile?.acceleration ?? 0,
        rotateToVelocity: !!this.effectiveConfig?.projectile?.rotateToVelocity,
        maxDistance: this.effectiveConfig?.projectile?.maxDistance ?? 0,
        lifetimeMs: this.effectiveConfig?.projectile?.lifetimeMs ?? 500,
        damage: this.effectiveConfig?.damage,
        controller: this,
        pierce: this.effectiveConfig?.projectile?.pierce ?? 0,
        explosion: this.effectiveConfig?.projectile?.explosion ?? null,
        animKey: this.effectiveConfig?.projectile?.animKey ?? null
      });
    }

    // **Circular/orbital trajectory** (requires projectile.fireCircular support)
    else if (trajectory === 'circular') {
      const circ = arch.circular || {};
      const radius = Number.isFinite(circ.radius) ? circ.radius : 48;
      const angularVel = Number.isFinite(circ.angularVel) ? circ.angularVel : 7.0;
      const loops = Number.isFinite(circ.loops) ? circ.loops : 1.0;
      const startPhase = Number.isFinite(circ.startPhase) ? circ.startPhase : 0;
      const radiusInMs = Number.isFinite(circ.radiusInMs) ? circ.radiusInMs : 100;

      // Fire a stationary projectile and drive the orbit manually.
      projectile.fire({
        x: origin.x,
        y: origin.y,
        angle: 0,
        speed: 0,
        lifetimeMs: this.effectiveConfig?.projectile?.lifetimeMs ?? 1000,
        controller: this,
        damage: this.effectiveConfig?.damage,
        pierce: this.effectiveConfig?.projectile?.pierce ?? 0,
        explosion: this.effectiveConfig?.projectile?.explosion ?? null,
        animKey: this.effectiveConfig?.projectile?.animKey ?? null
      });
      projectile.body?.setVelocity(0, 0);

      // Owner-centered orbit; re-sample owner position every frame.
      const startTime = this.scene.time.now;
      projectile._weaponData.flight = {
        update: (p, dt) => {
          const t = this.scene.time.now - startTime;
          const r = radiusInMs > 0 ? Math.min(1, t / radiusInMs) * radius : radius;
          const ang = startPhase + (angularVel * (t / 1000))
                    + Salvo.spreadOffset(index, salvo, spreadRad);
          const ownerPos = this.owner?.getPos?.() || origin;
          p.setPosition(ownerPos.x + r * Math.cos(ang), ownerPos.y + r * Math.sin(ang));

          // Auto-finish after N loops
          if ((angularVel > 0 && (ang - startPhase) >= loops * Math.PI * 2) ||
              (angularVel < 0 && (startPhase - ang) >= loops * Math.PI * 2)) {
            this.projectilePool?.release(p);
          }
        },
        onRelease: () => {}
      };
    }

    // Attach optional spin behaviour when configured on the projectile
    const projectileCfg = this.effectiveConfig?.projectile ?? {};
    const archSpin = this.effectiveConfig?.archetype?.spin;
    const spinSpeed = Number.isFinite(projectileCfg.spinSpeedRadPerSec)
      ? projectileCfg.spinSpeedRadPerSec
      : Number.isFinite(archSpin?.spinSpeedRadPerSec)
        ? archSpin.spinSpeedRadPerSec
        : 0;

    if (spinSpeed) {
      const resetOnRelease = projectileCfg.resetSpinOnRelease ?? true;
      attachSpinWhileFlying(projectile, { spinSpeedRadPerSec: spinSpeed, resetOnRelease });
    }

    // If using overkill-prevention logic, assign a "reservation" to this projectile
    if (arch.aim === 'auto' && trajectory === 'straight' && this.targetingCoordinator && projectile?._weaponData) {
      const damagePerProjectile = this.computeShotDamage();
      projectile._weaponData.reservation = this.targetingCoordinator.reserve(
        this.baseConfig?.key,
        target,
        projectedImpactTime,
        damagePerProjectile
      );
    } else if (projectile?._weaponData) {
      projectile._weaponData.reservation = null;
    }

    // Optional muzzle FX (flash, sound cue, etc.)
    if (this.fxPool?.muzzle) {
      this.fxPool.muzzle(origin, angle, facing);
    }
  }

  /**
   * Selects the best target:
   * - If no TargetingCoordinator: choose nearest enemy in range
   * - If coordinator is active: choose best predicted kill opportunity
   */
  _selectTarget(origin, now) {
    const range = this.effectiveConfig?.targeting?.range ?? 0;
    const speed = this.effectiveConfig?.projectile?.speed ?? 0;

    // Simple mode: nearest enemy in range
    if (!this.targetingCoordinator) {
      const target = TargetSelect.nearest(this.enemyGroup, origin, range);
      if (!target) return null;
      const distance = Phaser.Math.Distance.Between(origin.x, origin.y, target.x, target.y);
      const etaMs = speed > 1 ? (distance / speed) * 1000 : 0;
      return {
        target,
        distance,
        etaMs,
        impactTime: now + etaMs,
        salvoSpacingMs: Salvo.spacingMs(this.effectiveConfig)
      };
    }

    // Advanced mode: scoring model to avoid overkill
    const config = this.targetingCoordinator.getConfig?.() ?? {};
    const rangeSq = Number.isFinite(range) && range > 0 ? range * range : Infinity;
    const entries = [];

    // Collect eligible enemies
    this.enemyGroup?.children?.iterate?.((enemy) => {
      if (!enemy || !enemy.active) return;
      const dx = enemy.x - origin.x;
      const dy = enemy.y - origin.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > rangeSq) return;
      entries.push({ enemy, distSq });
    });

    if (entries.length === 0) return null;

    // Sort by nearest first
    entries.sort((a, b) => a.distSq - b.distSq);

    const candidateCount = Math.max(1, config.candidateCount ?? 6);
    const etaTolerance = config.etaToleranceMs ?? 120;
    const overkillTolerance = config.overkillTolerance ?? 0;
    const overkillWeight = config.overkillPenaltyWeight ?? 40;
    const killshotWindow = Math.max(config.killshotWindow ?? 3, this.effectiveConfig?.damage?.base ?? 1);
    const killshotBonus = config.killshotBonus ?? 120;
    const spacing = Salvo.spacingMs(this.effectiveConfig);

    let best = null;

    // Score each candidate based on predicted HP at impact time
    for (let i = 0; i < entries.length && i < candidateCount; i += 1) {
      const { enemy, distSq } = entries[i];
      const distance = Math.sqrt(distSq);
      const etaMs = speed > 1 ? (distance / speed) * 1000 : 0;
      const impactTime = now + etaMs;

      // How much damage will *other* weapons have done before impact?
      const predictedDamage = this.targetingCoordinator.predictedDamageBefore(
        enemy,
        impactTime,
        etaTolerance
      );
      const currentHp = Number.isFinite(enemy.hp) ? enemy.hp : enemy.maxHp ?? 0;
      const predictedHp = currentHp - predictedDamage;

      // Score starts by preferring closer targets
      let score = -distance;

      // Penalize severe overkill
      if (predictedHp <= -overkillTolerance) {
        score -= overkillWeight * (Math.abs(predictedHp) + overkillTolerance);
      }
      // Light penalty if projected lethal but not significant overkill
      else if (predictedHp <= 0) {
        score -= overkillWeight * 0.5;
      }
      // Bonus if this shot could secure a kill soon
      else if (predictedHp <= killshotWindow) {
        const ratio = Phaser.Math.Clamp(1 - (predictedHp / killshotWindow), 0, 1);
        score += killshotBonus * ratio;
      }
      // Mild penalty if others are focusing this target already
      else if (predictedDamage > 0) {
        const incomingRatio = predictedDamage / Math.max(1, currentHp);
        score -= incomingRatio * (overkillWeight * 0.2);
      }

      // Select best-scoring candidate (tie-break with distance)
      if (!best || score > best.score || (score === best.score && distance < best.distance)) {
        best = {
          target: enemy,
          distance,
          etaMs,
          impactTime,
          score,
          salvoSpacingMs: spacing
        };
      }
    }

    if (best) return best;

    // Fallback: nearest if something went wrong
    const fallback = TargetSelect.nearest(this.enemyGroup, origin, range);
    if (!fallback) return null;
    const fallbackDistance = Phaser.Math.Distance.Between(origin.x, origin.y, fallback.x, fallback.y);
    const fallbackEta = speed > 1 ? (fallbackDistance / speed) * 1000 : 0;
    return {
      target: fallback,
      distance: fallbackDistance,
      etaMs: fallbackEta,
      impactTime: now + fallbackEta,
      salvoSpacingMs: spacing
    };
  }

  /**
   * Called when a projectile overlaps an enemy.
   * Applies damage, handles pierce+AoE, consumes reservations, and returns projectile to pool.
   */
  onProjectileImpact(projectile, enemy) {
    // Avoid double-hits from the same projectile on the same enemy
    const hitSet = projectile?._weaponData?.hitSet;
    if (hitSet && hitSet.has(enemy)) return;
    hitSet?.add(enemy);

    // Compute damage payload from config (includes crit, status, etc.)
    const payload = this.buildDamagePayload();

    // Apply damage to the enemy
    this.damagePipeline?.applyHit(enemy, payload);

    // Optional impact FX
    this.fxPool?.impact?.(projectile.x, projectile.y);

    // If this projectile had a targeting reservation, consume it now
    const reservation = projectile?._weaponData?.reservation;
    if (reservation && reservation.enemy === enemy) {
      this.targetingCoordinator?.consumeReservation(reservation);
      projectile._weaponData.reservation = null;
    }

    // Pierce: allow projectile to continue through more enemies
    let remaining = projectile?._weaponData?.pierceRemaining ?? 0;
    if (remaining > 0) {
      projectile._weaponData.pierceRemaining = remaining - 1;
      return; // keep projectile flying, no explosion, no release yet
    }

    // Optional explosion AoE on projectile expiration/impact
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
          maxTargets: Number.isFinite(explosionCfg.maxTargets) ? explosionCfg.maxTargets : Infinity,
          falloff: explosionCfg.falloff ?? 0,
          timing: 'impact'
        },
        damagePipeline: this.damagePipeline,
        sourceKey: this.baseConfig?.key,
        payload
      });
    }

    // Return projectile to pool for reuse
    this.projectilePool?.release(projectile);
  }
}
