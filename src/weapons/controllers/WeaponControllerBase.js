import Phaser from 'phaser';
import { CONFIG } from '../../config/gameConfig.js';
import { computeEffective } from '../core/Config.js';
import * as Cooldown from '../core/Cooldown.js';
import * as DamagePayload from '../core/DamagePayload.js';

/**
 * Base class for all weapon controllers.
 * 
 * Each weapon controller manages:
 *  - How/when the weapon fires
 *  - Targeting behavior
 *  - Cadence timing / cooldowns
 *  - Application of per-weapon + global modifiers
 *
 * This class handles only the shared configuration and lifecycle. Subclasses
 * (e.g., Projectile, Strike, ChainLightning controllers) implement actual firing logic.
 */
export class WeaponControllerBase {
  /**
   * @param {Phaser.Scene} scene - The scene this weapon lives in.
   * @param {Object} owner - Lightweight object exposing position + capability (e.g., hero).
   * @param {Object} weaponConfig - Static data describing the weapon's damage/cadence/behavior.
   * @param {Object} options
   * @param {Phaser.Physics.Arcade.Group} options.enemyGroup - Group of enemies this weapon targets.
   * @param {Object} options.damagePipeline - Pipeline to apply damage when hits occur.
   * @param {Phaser.Events.EventEmitter} options.events - Shared event bus for UI/HUD notifications.
   * @param {Object} options.targetingCoordinator - Shared coordinator to reduce overkill.
   */
  constructor(
    scene,
    owner,
    weaponConfig,
    { enemyGroup, damagePipeline, events, targetingCoordinator, level } = {}
  ) {
    this.scene = scene;
    this.owner = owner;
    this.baseConfig = weaponConfig;
    this.level = Math.max(1, level ?? CONFIG.WEAPONS.DEFAULT_LEVEL ?? 1);

    // Systems shared across all weapons using this manager
    this.enemyGroup = enemyGroup;
    this.damagePipeline = damagePipeline;

    // UI + HUD event bus (GameScene or WeaponManager typically provides this)
    this.bus = events ?? scene?.events ?? null;

    // Internal event emitter for controller-scoped events (e.g., controller:fired)
    this.events = new Phaser.Events.EventEmitter();

    // Coordinator shared across all weapons to avoid overkill / duplicate targeting
    this.targetingCoordinator = targetingCoordinator ?? null;

    // Modifiers applied to this weapon (from registry + player buffs)
    this.modifiers = weaponConfig?.modifiers ? [...weaponConfig.modifiers] : [];

    // Combine base config + modifiers to produce the final live configuration
    this.effectiveConfig = computeEffective(this.baseConfig, this.modifiers);
  }

  /** Handle setLevel so this system stays coordinated. */
  setLevel(level) {
    this.level = Math.max(1, level | 0);
  }

  /**
   * Update tick called each frame.
   * Subclasses override this to implement firing logic.
   */
  update(_dt) {
    // no-op by default
  }

  /**
   * Replace current modifiers and recompute effective config.
   * Called when loadout changes or global buffs are applied.
   */
  setModifiers(modifiers) {
    this.modifiers = Array.isArray(modifiers) ? modifiers.slice() : [];
    this.effectiveConfig = computeEffective(this.baseConfig, this.modifiers);
  }

  /**
   * Cleanup hook for subclasses (pools/timers/listeners cleanup).
   */
  destroy() {
    // hook for subclasses
  }

  /**
   * Global attack-speed multiplier from passives (e.g., Bloodrush).
   * Returns 1 when no bonus is present.
   */
  _getAttackSpeedMultiplier() {
    const passiveManager = this.scene?.passiveManager;
    if (!passiveManager?.getAttackSpeedMultiplier) return 1;
    const mult = passiveManager.getAttackSpeedMultiplier();
    // Guard against weird or zero/negative values
    return mult > 0 ? mult : 1;
  }

  /**
   * Resolve the effective delay between shots (ms), falling back to default if unspecified.
   * Applies global attack-speed scaling from passives by shrinking the delay.
   */
  _effectiveDelayMs(defaultMs) {
    const baseDelay = this.effectiveConfig?.cadence?.delayMs ?? defaultMs;
    const atkSpeedMult = this._getAttackSpeedMultiplier();
    return baseDelay / atkSpeedMult;
  }

  /** Handle computeShotDamage so this system stays coordinated. */
  computeShotDamage() {
    const base = this.effectiveConfig?.damage?.base ?? this.baseConfig?.damage?.base ?? 0;
    let damage = base;

    if (this.scene?.passiveManager?.applyDamageModifiers) {
      const result = this.scene.passiveManager.applyDamageModifiers({ damage });
      damage = result?.damage ?? damage;
    }

    const diffMult = CONFIG.DIFFICULTY?.playerDamageMult ?? 1;
    return damage * diffMult;
  }

  /** Handle buildDamagePayload so this system stays coordinated. */
  buildDamagePayload() {
    const cfgDamage = this.effectiveConfig?.damage ?? {};

    // Your existing final damage (already includes passive modifiers + difficulty mult)
    const baseDamage = this.computeShotDamage();

    // Pull crit config from effective weapon config
    const critChance = Math.max(0, Number(cfgDamage?.crit?.chance ?? 0) || 0);
    const critMult = Math.max(1, Number(cfgDamage?.crit?.mult ?? 1.5) || 1.5);

    // Roll crit once per "attack instance" (per strike, per projectile fired, etc.)
    const isCrit = critChance > 0 ? (Math.random() < critChance) : false;

    // Apply crit multiplier to the already-computed base damage
    const finalDamage = isCrit ? (baseDamage * critMult) : baseDamage;

    // Keep DamagePayload helper for status, etc., but don't let it own crit logic yet
    const payload = DamagePayload.fromConfig({
      ...this.effectiveConfig,
      damage: {
        ...cfgDamage,
        base: finalDamage
      }
    });

    return {
      ...payload,
      damage: finalDamage,           // ensure we keep the numeric value we computed
      crit: isCrit,                  // ✅ what DamagePipeline checks
      critChance,
      critMult,
      sourceKey: this.baseConfig?.key
    };
  }

  /**
   * Compute first fire timestamp using cooldown jitter/spread rules.
   */
  _scheduleInitial(now, delayMs) {
    return Cooldown.scheduleInitial(now, delayMs);
  }

  /**
   * Compute next fire timestamp after a shot has been fired.
   */
  _scheduleNext(now, delayMs) {
    return Cooldown.scheduleNext(now, delayMs);
  }
}
