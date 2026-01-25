import { WeaponControllerBase } from './WeaponControllerBase.js';
import * as Cooldown from '../core/Cooldown.js';
import * as Facing from '../core/Facing.js';
import { runAoe } from '../AoeUtils.js';
import { spawnExplosionFxAndAoe } from '../ExplosionFx.js';

/**
 * BazookaWeaponController
 * ----------------------
 * Fires a projectile that detonates either on impact or when its lifetime expires.
 * Detonation can optionally "pulse" (spawn repeated explosion sprites) for a duration,
 * applying AoE damage via runAoe() on a timing strategy (AoeTiming).
 *
 * Key runtime concerns:
 * - Uses a projectile pool for the rocket.
 * - Uses an FX pool for muzzle/impact visuals.
 * - Carefully avoids double-detonation (bazookaDetonated flag).
 * - Tracks active detonation loops so they can be cancelled on destroy().
 */
export class BazookaWeaponController extends WeaponControllerBase {
  /** Initialize BazookaWeaponController state so runtime dependencies are ready. */
  constructor(scene, owner, weaponConfig, options = {}) {
    super(scene, owner, weaponConfig, options);

    // Pool used to acquire/release the bazooka projectile entities.
    this.projectilePool = options.projectilePool ?? null;

    // Optional effects helpers (muzzle flash, impact burst, etc).
    this.fxPool = options.fxPool ?? null;

    // Track ongoing "detonation loops" so we can cancel/cleanup on controller destroy.
    this._activeDetonations = new Set();

    // Schedule the first shot.
    const delay = this.getEffectiveDelayMs();
    const now = this.scene?.time?.now ?? Date.now();
    this.nextFireAtMs = this._scheduleInitial(now, delay);
  }

  /**
   * Base cadence for this weapon (before progression, rarity, global modifiers, etc).
   * WeaponControllerBase._effectiveDelayMs() applies scaling/overrides.
   */
  getEffectiveDelayMs() {
    return this._effectiveDelayMs(1600);
  }

  /**
   * Per-frame update: decide whether we should fire this tick.
   * Uses Cooldown helpers + owner gating + targeting pruning.
   */
  update(_dt) {
    const now = this.scene?.time?.now ?? Date.now();

    // If we somehow got an invalid schedule, recover gracefully.
    if (!Number.isFinite(this.nextFireAtMs)) {
      this.nextFireAtMs = this._scheduleInitial(now, this.getEffectiveDelayMs());
    }

    // Not ready yet.
    if (!Cooldown.shouldFire(now, this.nextFireAtMs)) return;

    // Owner can veto firing (stunned, paused, dead, etc).
    if (typeof this.owner?.canFire === 'function' && !this.owner.canFire()) return;

    // Need an origin point to fire from.
    const origin = this.owner?.getPos?.();
    if (!origin) return;

    // Let the targeting system clean up stale reservations/entries.
    this.targetingCoordinator?.prune?.(now);

    // Resolve the owner’s facing angle (usually based on movement/aim).
    const angle = Facing.resolve(this.owner);

    // Spawn and launch the projectile.
    this._fireProjectile(origin, angle);

    // Schedule the next shot.
    const delayMs = this.getEffectiveDelayMs();
    this.nextFireAtMs = this._scheduleNext(now, delayMs);

    // Emit telemetry/events for UI, audio, etc.
    this.events.emit('controller:fired', { delayMs, nextFireAt: this.nextFireAtMs });
    this.bus?.emit('weapons:fired', this.baseConfig?.key);
  }

  /**
   * Acquire a projectile from the pool, configure its movement + metadata,
   * and set up an expiry timer that triggers detonation if it never hit anything.
   */
  _fireProjectile(origin, angle) {
    if (!this.projectilePool) return;

    const projectile = this.projectilePool.acquire();
    if (!projectile) return;

    // Pull effective tuning from the computed config.
    const speed = this.effectiveConfig?.projectile?.speed ?? 0;
    const lifetime = this.effectiveConfig?.projectile?.lifetimeMs ?? 1000;
    const pierce = this.effectiveConfig?.projectile?.pierce ?? 0;

    // Ensure weapon data exists for pooled projectiles.
    projectile._weaponData = projectile._weaponData || {};

    // Fire initializes the projectile's trajectory and behavior.
    projectile.fire({
      x: origin.x,
      y: origin.y,
      angle,
      speed,
      lifetimeMs: lifetime,
      controller: this,
      pierce,
      // Explosion config is used later by detonation spawn logic.
      explosion: this.effectiveConfig?.projectile?.explosion ?? null,
      // Optional projectile animation.
      animKey: this.effectiveConfig?.projectile?.animKey ?? null,
      // If true, projectile rotates to face its velocity vector.
      rotateToVelocity: !!this.effectiveConfig?.projectile?.rotateToVelocity
    });

    // Guard flag: prevents double-detonation (impact + expiry, etc).
    projectile._weaponData.bazookaDetonated = false;

    // If this pooled projectile had an old release timer, remove it.
    if (projectile._weaponData.releaseTimer) {
      projectile._weaponData.releaseTimer.remove(false);
      projectile._weaponData.releaseTimer = null;
    }

    // Schedule "expire" detonation (only if Phaser time is available).
    if (this.scene?.time) {
      projectile._weaponData.releaseTimer = this.scene.time.delayedCall(lifetime, () => {
        this._handleProjectileExpire(projectile);
      });
    }

    // Cosmetic muzzle FX at fire time.
    this.fxPool?.muzzle?.(origin, angle);
  }

  /**
   * Called when the projectile's lifetime elapses.
   * If it already detonated, just release it; otherwise detonate at its current position.
   */
  _handleProjectileExpire(projectile) {
    if (!projectile) return;

    // Already detonated via impact (or earlier expiry handling).
    if (projectile._weaponData?.bazookaDetonated) {
      this.projectilePool?.release(projectile);
      return;
    }

    // Force detonation at current position.
    this._triggerDetonation(projectile, { x: projectile.x, y: projectile.y });
  }

  /**
   * Called by the projectile when it overlaps/hits an enemy.
   * Records the hit (for pierce / hit dedupe) and triggers detonation.
   */
  onProjectileImpact(projectile, enemy) {
    if (!projectile || projectile._weaponData?.bazookaDetonated) return;

    // Track which enemies have been hit (if the projectile supports hitSet).
    projectile._weaponData?.hitSet?.add?.(enemy);

    // Detonate at point of impact.
    this._triggerDetonation(projectile, { x: projectile.x, y: projectile.y });
  }

  /**
   * Central detonation handler:
   * - marks projectile as detonated (idempotence)
   * - consumes any targeting reservation
   * - spawns impact FX
   * - starts the optional detonation "loop" that spawns explosion sprites
   * - releases projectile back to pool immediately (explosions are separate sprites)
   */
  _triggerDetonation(projectile, position) {
    if (!projectile || projectile._weaponData?.bazookaDetonated) return;

    // Idempotence: from here onward, any further triggers no-op.
    projectile._weaponData.bazookaDetonated = true;

    // If the projectile was reserving a target/slot, consume it now.
    const reservation = projectile?._weaponData?.reservation;
    if (reservation) {
      this.targetingCoordinator?.consumeReservation?.(reservation);
      projectile._weaponData.reservation = null;
    }

    const impactPos = position || { x: projectile.x, y: projectile.y };

    // Cosmetic impact burst.
    this.fxPool?.impact?.(impactPos.x, impactPos.y);

    // Immediate impact AoE hit (one-shot)
    const payload = this.buildDamagePayload();
    const aoeCfg = this.effectiveConfig?.aoe;

    runAoe({
      scene: this.scene,
      enemyGroup: this.enemyGroup,
      origin: { x: impactPos.x, y: impactPos.y },
      baseDamage: payload.damage,
      cfg: aoeCfg,
      damagePipeline: this.damagePipeline,
      sourceKey: this.baseConfig?.key,
      payload
    });

    // Begin spawning explosion visuals / AoE pulses.
    this._startDetonationLoop(impactPos);

    // Rocket is done; return to pool.
    this.projectilePool?.release(projectile);
  }

  /**
   * Starts a timed loop that periodically spawns explosion sprites at `position`.
   * The loop runs for detonateSeconds, with one spawn every tickMs.
   * After ending, it keeps checking until all spawned sprites have cleaned up.
   *
   * Returns a detonation handle (with cancel()) or null if the scene isn't ready.
   */
  _startDetonationLoop(position) {
    if (!this.scene?.time || !this.scene?.add) return null;

    const bazookaCfg = this.effectiveConfig?.archetype?.bazooka || {};
    const tickMs = Math.max(16, bazookaCfg.tickMs ?? 250);
    const detonateSeconds = Math.max(0, bazookaCfg.detonateSeconds ?? 0);
    const totalDurationMs = detonateSeconds * 1000;

    // Track all explosion sprites spawned by this loop so we can clean up safely.
    const detonation = {
      sprites: new Set(),
      timer: null,
      cancelled: false,
      endAt: (this.scene?.time?.now ?? Date.now()) + totalDurationMs,
      cancel: () => {},
      explodedEventEmitted: false
    };

    /**
     * After the spawning window ends, we continue checking until every spawned
     * explosion sprite has cleaned itself up. This prevents the detonation entry
     * from sticking around forever if animations are still running.
     */
    const cleanupCheck = () => {
      if (detonation.cancelled) return;
      if (detonation.sprites.size === 0) {
        detonation.timer = null;
        this._activeDetonations.delete(detonation);
      } else if (this.scene?.time) {
        detonation.timer = this.scene.time.delayedCall(80, cleanupCheck);
      }
    };

    /**
     * Spawn one explosion sprite now, then reschedule either another spawn
     * (while still within duration) or the cleanup checker (once done).
     */
    const spawnTick = () => {
      if (detonation.cancelled) return;

      // NEW: only the first pulse is allowed to emit the exploded event (impact sound).
      const emitExplodedEvent = !detonation.explodedEventEmitted;
      detonation.explodedEventEmitted = true;

      const entry = this._spawnExplosionSprite(position.x, position.y, detonation, emitExplodedEvent);
      if (entry) {
        detonation.sprites.add(entry);
      }

      const now = this.scene?.time?.now ?? Date.now();
      const shouldContinue = totalDurationMs > 0 && now < detonation.endAt;

      if (shouldContinue) {
        detonation.timer = this.scene.time.delayedCall(tickMs, spawnTick);
      } else {
        // Give the last explosion sprite(s) time to finish, then begin cleanup polling.
        detonation.timer = this.scene.time.delayedCall(Math.max(80, tickMs), cleanupCheck);
      }
    };

    /**
     * Public cancellation hook:
     * - stop timers
     * - clean any remaining explosion sprites
     * - remove from active set
     */
    detonation.cancel = () => {
      if (detonation.cancelled) return;
      detonation.cancelled = true;
      detonation.timer?.remove?.(false);
      detonation.timer = null;
      detonation.sprites.forEach((entry) => entry.cleanup?.());
      detonation.sprites.clear();
      this._activeDetonations.delete(detonation);
    };

    // Kick off immediately.
    spawnTick();
    this._activeDetonations.add(detonation);
    return detonation;
  }

  /**
   * Spawns a single explosion sprite and wires it to:
   * - play an explosion animation if present
   * - trigger AoE damage based on AoE timing rules
   * - clean itself up reliably (even if animation is missing)
   *
   * Returns an entry object tracked by the detonation loop.
   */
  _spawnExplosionSprite(x, y, detonation, emitExplodedEvent) {
    const explosionCfg = this.effectiveConfig?.projectile?.explosion ?? null;
    if (!explosionCfg) return null;

    const payload = this.buildDamagePayload();
    const aoeCfg = this.effectiveConfig?.aoe ?? null;

    const handle = spawnExplosionFxAndAoe({
      scene: this.scene,
      origin: { x, y },
      payload,
      explosionCfg,
      enemyGroup: this.enemyGroup,
      damagePipeline: this.damagePipeline,
      sourceKey: this.baseConfig?.key,
      onHit: null,
      aoeCfgOverride: aoeCfg,
      emitExplodedEvent
    });

    // spawnExplosionFxAndAoe returns a handle; still guard for safety.
    if (!handle) return null;

    const entry = {
      cleaned: false,
      cleanup: () => {
        if (entry.cleaned) return;
        entry.cleaned = true;
        handle.cleanup?.();
        detonation?.sprites?.delete?.(entry);
      }
    };

    return entry;
  }

  /**
   * Controller teardown: cancel all active detonation loops and clear tracking.
   * Important for scene shutdown / weapon swaps so timers don't keep running.
   */
  destroy() {
    this._activeDetonations.forEach((detonation) => detonation.cancel?.());
    this._activeDetonations.clear();
  }
}
