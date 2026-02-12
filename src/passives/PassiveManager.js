import { CONFIG } from '../config/gameConfig.js';
import { LEVEL_UP } from '../config/gameConfig.js';
import { PassiveRegistry, isValidPassive } from './PassiveRegistry.js';
import { canGrantNextStack } from './passiveStackGate.js';

/**
 * Clamp requested stack counts to each passive's max so upgrades stay within limits.
 */
function clampStacks(key, count) {
  const entry = PassiveRegistry[key];
  const maxStacks = Math.max(1, entry?.maxStacks ?? 1);
  return Math.min(maxStacks, count);
}

/**
 * Expand the stack map into a flat list so loadouts can be rebuilt deterministically.
 */
function toStackArray(countMap) {
  const keys = [];
  for (const [key, count] of countMap.entries()) {
    for (let i = 0; i < count; i += 1) {
      keys.push(key);
    }
  }
  return keys;
}

export class PassiveManager {
  /**
   * Own passive loadout state and derived stat aggregates for the current hero.
   */
  constructor(scene, { hero, events } = {}) {
    this.scene = scene;
    this.hero = hero ?? null;
    this.events = events ?? scene?.events;
    this.maxSlots = CONFIG?.PASSIVES?.maxSlots ?? Infinity;

    this.whitelist = new Set();
    this.loadout = [];
    this.stackCounts = new Map();
    this.aggregate = {};
  }

  /**
   * Release references and clear state when the scene shuts down.
   */
  destroy() {
    this.scene = null;
    this.hero = null;
    this.events = null;
    this.whitelist.clear();
    this.stackCounts.clear();
    this.loadout = [];
    this.aggregate = {};
  }

  /**
   * Apply a whitelist of allowed passives and rebuild the loadout accordingly.
   */
  setWhitelist(keys = []) {
    const valid = Array.isArray(keys)
      ? keys.filter((key) => isValidPassive(key))
      : [];
    this.whitelist = new Set(valid);

    const currentStacks = toStackArray(this.stackCounts);
    this.setLoadout(currentStacks);
  }

  /**
   * Replace the loadout with a validated, stack-limited set of passive keys.
   */
  setLoadout(keys = []) {
    const allowlist = this.whitelist;
    const hasAllowlist = allowlist && allowlist.size > 0;
    const nextCounts = new Map();
    const displayOrder = [];

    const arrayKeys = Array.isArray(keys) ? keys : [];
    const maxSlots = Number.isFinite(this.maxSlots) ? this.maxSlots : Infinity;
    let totalSlots = 0;

    for (const key of arrayKeys) {
      if (totalSlots >= maxSlots) break;
      if (!isValidPassive(key)) continue;
      if (hasAllowlist && !allowlist.has(key)) continue;

      const clampedCount = clampStacks(key, (nextCounts.get(key) ?? 0) + 1);
      const previousCount = nextCounts.get(key) ?? 0;
      if (clampedCount === previousCount) continue;

      nextCounts.set(key, clampedCount);
      totalSlots += 1;
      if (previousCount === 0) {
        displayOrder.push(key);
      }
    }

    const changed =
      displayOrder.length !== this.loadout.length ||
      displayOrder.some((key, idx) => key !== this.loadout[idx]) ||
      displayOrder.some((key) => (nextCounts.get(key) ?? 0) !== (this.stackCounts.get(key) ?? 0)) ||
      this.loadout.some((key) => !nextCounts.has(key));

    if (!changed) {
      return;
    }

    this.loadout = displayOrder;
    this.stackCounts = nextCounts;
    this._recomputeAggregate();
    this._emitChanged();
  }

  /**
   * Add a passive stack if possible and emit change events.
   */
  addPassive(key, options = {}) {
    if (!isValidPassive(key)) return false;
    if (this.whitelist.size > 0 && !this.whitelist.has(key)) return false;

    const currentCount = this.stackCounts.get(key) ?? 0;

    const bypassStackGate = options?.bypassStackLevelGate === true;
    const shouldEnforceStackGate =
      (LEVEL_UP?.enforcePassiveStackLevelGate ?? true) && !bypassStackGate;
    if (shouldEnforceStackGate) {
      const currentLevel = Number(this.scene?.levelSystem?.level ?? 1);
      const canGrant = canGrantNextStack({
        level: currentLevel,
        currentCount,
        config: LEVEL_UP
      });
      if (!canGrant) return false;
    }

    const nextCount = clampStacks(key, currentCount + 1);
    if (nextCount === currentCount) return false;

    const totalStacks = Array.from(this.stackCounts.values()).reduce((sum, val) => sum + val, 0);
    const maxSlots = Number.isFinite(this.maxSlots) ? this.maxSlots : Infinity;
    const newTotal = totalStacks - currentCount + nextCount;
    if (newTotal > maxSlots) {
      return false;
    }

    this.stackCounts.set(key, nextCount);
    if (!this.loadout.includes(key)) {
      this.loadout.push(key);
    }

    this._recomputeAggregate();
    this._emitChanged();
    this.events?.emit?.('passive:applied', { key });
    return true;
  }

  /**
   * Return a shallow copy of the current loadout for UI/display use.
   */
  getLoadout() {
    return this.loadout.slice();
  }

  /**
   * Read the current stack count for a specific passive key.
   */
  getStackCount(key) {
    return this.stackCounts.get(key) ?? 0;
  }

  /**
   * Return a copy of the aggregate effects so callers can't mutate internal state.
   */
  getAggregate() {
    return { ...this.aggregate };
  }

  /**
   * Expose additive projectile salvo bonuses used by weapon fire controllers.
   */
  getProjectileSalvoBonus() {
    const agg = this.aggregate ?? {};
    const flat = agg.projectileSalvoFlat ?? 0;
    return flat;
  }

  /**
   * Compute a multiplier for movement speed based on stacked passives.
   */
  getMoveSpeedMultiplier() {
    const agg = this.aggregate ?? {};
    const pct = agg.moveSpeedPct ?? 0;
    return 1 + pct;
  }

  /**
   * Compute a multiplier for attack speed based on stacked passives.
   */
  getAttackSpeedMultiplier() {
    const agg = this.aggregate ?? {};
    const pct = agg.attackSpeedPct ?? 0;     // e.g. 0.10 = +10% attack speed
    return 1 + pct;
  }

  /**
   * Provide additive iframe duration bonuses for HealthSystem.
   */
  getIFrameDurationBonus() {
    const agg = this.aggregate ?? {};
    return agg.iframeMsBonus ?? 0;
  }

  /**
   * Provide XP magnet and snap radius multipliers for pickup systems.
   */
  getXpMagnetMultipliers() {
    const agg = this.aggregate ?? {};
    const radiusMult = 1 + (agg.xpMagnetRadiusPct ?? 0);
    const speedMult  = 1 + (agg.xpMagnetSpeedPct ?? 0);
    const snapMult   = 1 + (agg.xpSnapRadiusPct ?? 0);
    return { radiusMult, speedMult, snapMult };
  }

  /**
   * Apply flat and percentage damage bonuses to a damage payload.
   */
  applyDamageModifiers(payload = {}, _ctx = {}) {
    const aggregate = this.aggregate ?? {};

    const damageFlat = aggregate.damageFlat ?? 0;
    const damagePct  = aggregate.damagePct  ?? 0;  

    const next = { ...payload };
    const baseDamage = payload.damage ?? 0;

    // Add flat first, then apply % bonus
    const withFlat = baseDamage + damageFlat;
    next.damage = withFlat * (1 + damagePct);

    return next;
  }

  /**
   * Trigger on-kill passive effects like life steal when conditions are met.
   */
  applyOnKillEffects(ctx = {}) {
    const aggregate = this.aggregate ?? {};
    const chance = aggregate.lifeStealChance ?? 0;
    const amount = aggregate.lifeStealAmount ?? 0;

    if (chance <= 0 || amount <= 0) return;

    const rng = this.scene?.rng ?? Math.random;
    if (rng() >= chance) return;

    const healed = this.hero?.health?.heal?.(amount) || false;

    if (healed) {
      this.scene.events?.emit?.('passive:lifesteal:kill', {
        source: 'vampiresKiss',
        healed: amount,
        enemy: ctx.enemy ?? null,
        mobConfig: ctx.mobConfig ?? null
      });
    }
  }

  /**
   * Rebuild the aggregate stat map from current stacks and emit changes.
   */
  _recomputeAggregate() {
    const aggregate = {};
    for (const [key, count] of this.stackCounts.entries()) {
      const entry = PassiveRegistry[key];
      if (!entry) continue;
      const effects = entry.effects ?? {};
      const stacks = Math.max(0, count ?? 0);
      if (stacks <= 0) continue;

      for (const [effectKey, value] of Object.entries(effects)) {
        if (!Number.isFinite(value)) continue;
        aggregate[effectKey] = (aggregate[effectKey] ?? 0) + value * stacks;
      }
    }

    const changed = Object.keys(aggregate).length !== Object.keys(this.aggregate).length ||
      Object.entries(aggregate).some(([key, value]) => this.aggregate[key] !== value) ||
      Object.entries(this.aggregate).some(([key, value]) => aggregate[key] !== value);

    this.aggregate = aggregate;
    if (changed) {
      this.events?.emit?.('player:stats:changed', {
        source: 'passives',
        aggregate: { ...aggregate }
      });
    }
  }

  /**
   * Emit a loadout-changed event for UI refreshes.
   */
  _emitChanged() {
    this.events?.emit?.('passives:changed', this.getLoadout());
  }
}
