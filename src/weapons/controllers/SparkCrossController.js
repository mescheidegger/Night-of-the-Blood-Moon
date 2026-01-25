/**
 * SparkCrossController
 * --------------------
 * Animation-driven “cross” weapon that alternates firing along horizontal and vertical axes.
 * Each shot spawns two synced sprites (visual only) and, for each animation frame (or simulated frame),
 * applies two symmetric AoE ticks away from the origin (hero) along the current axis.
 *
 * Key behaviors:
 * - Alternates axis per completed shot: H → V → H → V …
 * - Backfill-safe per-frame AoE application (no missed ticks when frames are skipped).
 * - Robust cleanup on completion/destroy (destroys sprites, detaches listeners, clears timers).
 * - Preserves current axis across modifier updates so live flips aren’t reset mid-run.
 */

import { WeaponControllerBase } from './WeaponControllerBase.js';
import * as Cooldown from '../core/Cooldown.js';
import * as AnimSafe from '../core/AnimSafe.js';
import { runAoe } from '../AoeUtils.js';

const AXIS_HORIZONTAL = 'h';
const AXIS_VERTICAL = 'v';

/**
 * Normalize an axis string to a known constant; default to horizontal if invalid.
 */
function normalizeAxis(axis) {
  if (axis === AXIS_HORIZONTAL || axis === AXIS_VERTICAL) return axis;
  return AXIS_HORIZONTAL;
}

export class SparkCrossController extends WeaponControllerBase {
  /** Initialize SparkCrossController state so runtime dependencies are ready. */
  constructor(scene, owner, weaponConfig, options = {}) {
    super(scene, owner, weaponConfig, options);

    // Seed the first fire time with a jittered initial schedule (from base utilities).
    const delay = this.getEffectiveDelayMs();
    const now = this.scene?.time?.now ?? Date.now();
    this.nextFireAtMs = this._scheduleInitial(now, delay);

    // Current axis; initialized from config and then flipped per shot.
    this._axis = normalizeAxis(this.effectiveConfig?.archetype?.cross?.startAxis);

    // Tracks the active shot state (sprites/timers/handlers). Ensures only one is live.
    this._activeShot = null;
  }

  /**
   * Recompute effective config and preserve the current axis across modifier changes.
   * This avoids resetting to startAxis and breaking the H↔V alternation mid-run.
   */
  setModifiers(modifiers) {
    const currentAxis = this._axis;
    super.setModifiers(modifiers);
    if (currentAxis == null) {
      // If axis was never established, initialize from config.
      this._axis = normalizeAxis(this.effectiveConfig?.archetype?.cross?.startAxis);
    } else {
      // Otherwise, keep the current live axis (don’t reset).
      this._axis = currentAxis;
    }
  }

  /**
   * Base cadence (ms) for this weapon. Modifiers can override via _effectiveDelayMs.
   */
  getEffectiveDelayMs() {
    return this._effectiveDelayMs(3200);
  }

  /**
   * Ensure any active shot is finalized before destruction to prevent leaks.
   */
  destroy() {
    this._cleanupActiveShot();
    super.destroy?.();
  }

  /**
   * Main tick:
   * - Maintain/verify the next scheduled fire time.
   * - Respect cooldown + owner fire gating.
   * - Fire a shot and reschedule next time.
   * - Emit telemetry/UI events.
   */
  update(_dt) {
    const now = this.scene?.time?.now ?? Date.now();
    if (!Number.isFinite(this.nextFireAtMs)) {
      this.nextFireAtMs = this._scheduleInitial(now, this.getEffectiveDelayMs());
    }

    if (!Cooldown.shouldFire(now, this.nextFireAtMs)) return;
    if (typeof this.owner?.canFire === 'function' && !this.owner.canFire()) return;

    const origin = this.owner?.getPos?.();
    if (!origin) return;

    this._fireShot(origin);

    const delayMs = this.getEffectiveDelayMs();
    this.nextFireAtMs = this._scheduleNext(now, delayMs);

    // Signals for UI/telemetry integrations.
    this.events.emit('controller:fired', { delayMs, nextFireAt: this.nextFireAtMs });
    this.bus?.emit('weapons:fired', this.baseConfig?.key);
  }

  /**
   * Spawn a shot:
   * - Clear any previous shot (defensive).
   * - Create two visual sprites (left/right or up/down) for the cross.
   * - Wire animation listeners to apply AoE each frame.
   * - If the animation isn’t registered, simulate frames via timers.
   */
  _fireShot(origin) {
    if (!this.scene?.add) return;

    // End any prior shot before starting a new one.
    this._cleanupActiveShot();

    // Visual configuration (purely VFX). AoE damage is applied separately.
    const projectileCfg = this.effectiveConfig?.projectile ?? {};
    const textureKey = projectileCfg.texture ?? 'sparkcross';
    const animKey = projectileCfg.animKey ?? 'sparkcross-play';

    // Visual orientation angles: horizontal vs vertical.
    const leftRightAngle = 0;
    const upDownAngle = -Math.PI / 2;

    // Create a pair of sprites that will march outward symmetrically.
    const sprites = [];
    for (let i = 0; i < 2; i += 1) {
      const s = this.scene.add
        .sprite(origin.x, origin.y, textureKey)
        .setDepth(7)
        .setOrigin(0.5, 0.5);
      sprites.push(s);
    }

    // Rotate visuals to match the current axis at shot start.
    if (this._axis === 'v') {
      sprites.forEach(s => s.setRotation(upDownAngle));
    } else {
      sprites.forEach(s => s.setRotation(leftRightAngle));
    }

    // Archetype knobs:
    // stepPxPerFrame: distance to move per animation frame
    // frameStride: apply AoE every Nth frame (skip for denser visuals but sparser hits)
    const crossCfg = this.effectiveConfig?.archetype?.cross ?? {};
    const step = Number.isFinite(crossCfg.stepPxPerFrame) ? crossCfg.stepPxPerFrame : 0;
    const frameStride = Math.max(1, Math.floor(crossCfg.frameStride ?? 1));

    // Pre-baked damage payload from config (avoid per-tick allocations).
    const payload = this.buildDamagePayload();

    // Common AoE config (radius, falloff, damageMult, etc.).
    const aoeCfg = this.effectiveConfig?.aoe;

    // Snapshot immutable state for this shot.
    const axis = normalizeAxis(this._axis);
    const handlers = {};
    const state = {
      sprites,
      handlers,
      axis,
      origin: { x: origin.x, y: origin.y },
      step,
      frameStride,
      lastAppliedFrame: -frameStride, // so frame 0 applies on first update
      payload,
      aoeCfg,
      timers: [],
      finished: false,
      frameCount: this._resolveFrameCount(textureKey),  // fallback handled internally
      frameRate: this._resolveFrameRate(animKey) || 20  // fallback FR for simulation
    };

    /**
     * finalize():
     * Single source of truth to end a shot. Safe to call multiple times.
     * - Stops timers
     * - Detaches animation handlers
     * - Destroys sprites
     * - Clears active pointer
     * - Toggles axis for the next shot
     */
    const finalize = () => {
      if (state.finished) return;
      state.finished = true;

      state.timers.forEach((t) => t?.remove?.());
      state.timers.length = 0;

      AnimSafe.detach(sprites[0], handlers);
      AnimSafe.detach(sprites[1], handlers);
      sprites.forEach(s => { if (s.scene) s.destroy(); });

      if (this._activeShot === state) this._activeShot = null;

      // Flip axis post-shot to alternate next fire.
      this._toggleAxis();
    };

    state.finalize = finalize;

    /**
     * onUpdate: per animation-frame callback.
     * - Backfills any skipped frames (lag-safe).
     * - Repositions the two sprites to reflect the distance marched this frame.
     */
    handlers.onUpdate = (_anim, frame) => {
      const idx = frame?.index ?? 0;
      this._applyFramesThrough(state, idx);

      const d = state.step * Math.max(0, Math.floor(idx));
      if (state.axis === 'v') {
        sprites[0].setPosition(state.origin.x, state.origin.y - d);
        sprites[1].setPosition(state.origin.x, state.origin.y + d);
      } else {
        sprites[0].setPosition(state.origin.x - d, state.origin.y);
        sprites[1].setPosition(state.origin.x + d, state.origin.y);
      }
    };

    /**
     * onComplete: animation finished.
     * - Apply through the last frame.
     * - Sync visuals to final pose.
     * - Delegate cleanup + axis toggle to finalize().
     *
     * NOTE: We intentionally do NOT set state.finished here; finalize() owns that flag.
     */
    handlers.onComplete = (_anim, frame) => {
      const lastIndex = typeof frame?.index === 'number' ? frame.index : state.frameCount - 1;
      this._applyFramesThrough(state, lastIndex);

      // Keep the sprites at the terminal offsets for a clean finish frame.
      const d = state.step * Math.max(0, Math.floor(lastIndex));
      if (state.axis === 'v') {
        sprites[0].setPosition(state.origin.x, state.origin.y - d);
        sprites[1].setPosition(state.origin.x, state.origin.y + d);
      } else {
        sprites[0].setPosition(state.origin.x - d, state.origin.y);
        sprites[1].setPosition(state.origin.x + d, state.origin.y);
      }

      // One path for cleanup and axis flip.
      state.finalize();
    };

    // Mark this shot as active before attempting to play animations/timers.
    this._activeShot = state;

    // Play anim on sprite A with handlers; sprite B plays without handlers to keep callbacks singular.
    const playedA = AnimSafe.playIfExists(sprites[0], animKey, handlers).played;
    const playedB = AnimSafe.playIfExists(sprites[1], animKey).played;
    const canAnimate = playedA || playedB;

    if (!canAnimate) {
      // Fallback: simulate frame ticks via timers when animation is missing/unregistered.
      const perFrameDelay = state.frameRate > 0 ? 1000 / state.frameRate : 50;
      const totalFrames = state.frameCount;

      for (let f = 0; f < totalFrames; f += 1) {
        const timer = this.scene?.time?.delayedCall?.(perFrameDelay * f, () => {
          this._applyFramesThrough(state, f);

          // Keep visuals in sync with simulated frame distance.
          const d = state.step * f;
          if (state.axis === 'v') {
            sprites[0].setPosition(state.origin.x, state.origin.y - d);
            sprites[1].setPosition(state.origin.x, state.origin.y + d);
          } else {
            sprites[0].setPosition(state.origin.x - d, state.origin.y);
            sprites[1].setPosition(state.origin.x + d, state.origin.y);
          }
        });
        if (timer) state.timers.push(timer);
      }

      // Final cleanup just after the last simulated frame.
      const cleanupTimer = this.scene?.time?.delayedCall?.(perFrameDelay * totalFrames + 16, () => {
        this._applyFramesThrough(state, totalFrames - 1);
        state.finalize();
      });
      if (cleanupTimer) state.timers.push(cleanupTimer);
    }
  }

  /**
   * Backfill-aware per-frame AoE application:
   * Applies frames from (lastAppliedFrame + stride) through target index,
   * ensuring no damage ticks are skipped if the animation jumps.
   */
  _applyFramesThrough(state, frameIndex) {
    if (!state || state.finished) return;
    if (!Number.isFinite(frameIndex)) return;

    const targetFrame = Math.max(0, Math.floor(frameIndex));
    const stride = Math.max(1, state.frameStride || 1);

    for (let f = state.lastAppliedFrame + stride; f <= targetFrame; f += stride) {
      if (f < 0) continue;
      this._applyFrame(state, f);
      state.lastAppliedFrame = f;
    }
  }

  /**
   * Apply a single frame’s pair of symmetric AoE ticks based on current axis.
   * - distance = stepPxPerFrame * frameIndex
   * - H: (x ± distance, y)
   * - V: (x, y ± distance)
   * - Frame 0 de-duplicates the center (only one AoE).
   */
  _applyFrame(state, frameIndex) {
    const { origin, step, axis, payload, aoeCfg } = state;
    const distance = step * frameIndex;

    const points = axis === AXIS_VERTICAL
      ? [{ x: origin.x, y: origin.y - distance }, { x: origin.x, y: origin.y + distance }]
      : [{ x: origin.x - distance, y: origin.y }, { x: origin.x + distance, y: origin.y }];

    // At distance 0 both points coincide; apply only once to avoid double damage.
    const uniquePoints = distance === 0 ? [points[0]] : points;

    uniquePoints.forEach((pt) => {
      runAoe({
        scene: this.scene,
        enemyGroup: this.enemyGroup,
        origin: pt,
        baseDamage: payload.damage,
        cfg: aoeCfg,
        damagePipeline: this.damagePipeline,
        sourceKey: payload.sourceKey,
        payload
      });
    });
  }

  /**
   * Clean up any active shot. Prefer calling the state.finalize() path (which flips axis).
   * If finalize is unavailable (defensive), perform best-effort cleanup and flip axis here.
   */
  _cleanupActiveShot() {
    const active = this._activeShot;
    if (!active) return;

    if (typeof active.finalize === 'function') {
      active.finalize();
    } else {
      active.finished = true;
      active.timers?.forEach((t) => t?.remove?.());
      active.timers = [];
      AnimSafe.detach(active.sprites?.[0], active.handlers);
      AnimSafe.detach(active.sprites?.[1], active.handlers);
      active.sprites?.forEach(s => { if (s?.scene) s.destroy(); });
      this._activeShot = null;
      this._toggleAxis();
    }
  }

  /**
   * Flip H <-> V after each shot completes.
   */
  _toggleAxis() {
    this._axis = this._axis === AXIS_VERTICAL ? AXIS_HORIZONTAL : AXIS_VERTICAL;
  }

  /**
   * Resolve total frames in the texture (falls back when metadata is absent).
   */
  _resolveFrameCount(textureKey) {
    const texture = this.scene?.textures?.get?.(textureKey);
    if (texture && Number.isFinite(texture.frameTotal)) {
      return Math.max(1, texture.frameTotal);
    }
    return 7;
  }

  /**
   * Resolve registered animation frameRate (null if missing to signal fallback).
   */
  _resolveFrameRate(animKey) {
    const anim = this.scene?.anims?.get?.(animKey);
    if (anim && Number.isFinite(anim.frameRate)) {
      return anim.frameRate;
    }
    return null;
  }
}
