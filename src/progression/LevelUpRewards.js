import { WeaponRegistry } from '../weapons/WeaponRegistry.js';
import { PassiveRegistry, isValidPassive } from '../passives/PassiveRegistry.js';
import { CONFIG, LEVEL_UP } from '../config/gameConfig.js';
import { canGrantNextStack } from '../passives/passiveStackGate.js';
import * as WeaponProgression from '../weapons/WeaponProgression.js';

const PASSIVE_SEED_OFFSET = 0x9e3779b9;
const WEAPON_RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * Collect all keys in a progression table that unlock at or before `level`.
 *
 * progression example:
 * {
 *   2: ["fireball"],
 *   4: ["shuriken", "bolt"]
 * }
 */
function collectProgressionKeys(progression, level) {
  if (!progression || typeof progression !== 'object') return [];

  const keys = [];
  for (const [lvlKey, list] of Object.entries(progression)) {
    const unlockLevel = Number.parseInt(lvlKey, 10);
    if (!Number.isFinite(unlockLevel) || unlockLevel > level) continue;
    if (!Array.isArray(list)) continue;
    keys.push(...list);
  }
  return keys;
}

/**
 * Creates a deterministic pseudo-random generator from a given numeric seed.
 * This ensures that level-up choices are stable per run.
 */
function makeSeededRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle an array deterministically using a seeded RNG.
 */
function deterministicShuffle(array, seed) {
  const result = array.slice();
  const rnd = makeSeededRandom(seed);

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/**
 * Get a human-readable name for a registry entry.
 */
function toDisplayName(entry, key) {
  const uiName = entry?.ui?.name;
  return (typeof uiName === 'string' && uiName.trim().length > 0) ? uiName : key;
}

/**
 * Filter + dedupe weapon candidates:
 * - Must be allowed
 * - Must exist in registry
 * - Must not already be owned
 */
function normalizeWeaponCandidates(candidates, allowedSet, ownedSet) {
  const unique = new Set();
  const filtered = [];

  candidates.forEach((key) => {
    if (unique.has(key)) return;
    unique.add(key);

    if (!allowedSet.has(key)) return;
    if (!WeaponRegistry[key]) return;
    if (ownedSet.has(key)) return;

    filtered.push(key);
  });

  return filtered;
}

/**
 * Filter + dedupe passive candidates while respecting stack caps and allowlists.
 */
function normalizePassiveCandidates(candidates, allowedSet, ownedCounts) {
  const unique = new Set();
  const filtered = [];

  candidates.forEach((key) => {
    if (unique.has(key)) return;
    if (!allowedSet.has(key)) return;
    if (!PassiveRegistry[key]) return;

    const maxStacks = Math.max(1, PassiveRegistry[key]?.maxStacks ?? 1);
    const owned = ownedCounts.get(key) ?? 0;
    if (owned >= maxStacks) return;

    unique.add(key);
    filtered.push(key);
  });

  return filtered;
}

/**
 * Filter passive candidates by global stack-level gating knobs.
 */
function filterPassiveCandidatesByStackGate(candidates, ownedCounts, level) {
  return candidates.filter((key) => {
    const currentCount = ownedCounts.get(key) ?? 0;
    return canGrantNextStack({
      level,
      currentCount,
      config: LEVEL_UP
    });
  });
}

/**
 * Build a passive stack count map using the loadout and optional resolver.
 */
function buildOwnedPassiveCounts(currentPassives, resolver) {
  const counts = new Map();
  const keys = Array.isArray(currentPassives) ? currentPassives : [];
  const getCount = typeof resolver === 'function' ? resolver : null;

  keys.forEach((key) => {
    if (!isValidPassive(key)) return;

    // If a resolver exists (e.g., PassiveManager stack map),
    // prefer it on first sighting for correctness.
    if (!counts.has(key) && getCount) {
      const resolved = getCount(key);
      if (Number.isFinite(resolved) && resolved > 0) {
        counts.set(key, resolved);
        return;
      }
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return counts;
}

/**
 * Build a deterministic seed from run start time and level.
 */
function buildSeed(scene, level, offset = 0) {
  const base = Number(scene?._runStartedAt ?? 0);
  const levelSeed = Number.isFinite(base) ? base + level : level;
  return (levelSeed + offset) >>> 0;
}

/**
 * Passive offering gate: controls whether passives are allowed to appear
 * on a given level based on CONFIG.LEVEL_UP tuning:
 *  - passiveInterval: only offer every N levels (<=1 means every level)
 *  - passiveStartLevel: begin gating at/after this level (before it, allow)
 *  - passiveMilestones: always allow on these levels
 */
function shouldOfferPassives(level) {
  const interval = Number(LEVEL_UP?.passiveInterval ?? 1);
  const startLevel = Number(LEVEL_UP?.passiveStartLevel ?? 1);
  const milestones = LEVEL_UP?.passiveMilestones;

  if (!Number.isFinite(level) || level <= 0) return true;
  if (!Number.isFinite(interval) || interval <= 1) return true;

  if (Number.isFinite(startLevel) && level < startLevel) return true;

  if (Array.isArray(milestones) && milestones.includes(level)) return true;

  return (level % interval) === 0;
}

/**
 * Given a list of new weapon keys, gate by rarity so only the lowest rarity tier
 * with any candidates is eligible.
 */
function gateNewWeaponsByRarity(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const buckets = new Map();

  candidates.forEach((key) => {
    const entry = WeaponRegistry[key];
    const rarityRaw = entry?.ui?.rarity ?? 'common';
    const rarity = typeof rarityRaw === 'string' ? rarityRaw.toLowerCase() : 'common';
    if (!buckets.has(rarity)) buckets.set(rarity, []);
    buckets.get(rarity).push(key);
  });

  for (const rarity of WEAPON_RARITY_ORDER) {
    const bucket = buckets.get(rarity);
    if (bucket && bucket.length > 0) return bucket;
  }

  const firstEntry = buckets.entries().next();
  if (!firstEntry.done) {
    const [, bucket] = firstEntry.value;
    return bucket || [];
  }

  return [];
}

/**
 * Create weapon reward choices, mixing new items and upgrades deterministically.
 */
function getWeaponChoicesInternal({
  scene,
  heroEntry,
  level,
  currentLoadout = [],
  maxChoices = 3,
  getWeaponLevel
}) {
  const allowedKeys = Array.isArray(heroEntry?.weapons?.allowed)
    ? heroEntry.weapons.allowed
    : Object.keys(WeaponRegistry);

  const allowedSet = new Set(allowedKeys.filter((key) => WeaponRegistry[key]));
  const ownedSet = new Set(currentLoadout);

  const ownedLevels = new Map();
  currentLoadout.forEach((key) => {
    const lvl = getWeaponLevel ? getWeaponLevel(key) : CONFIG.WEAPONS.DEFAULT_LEVEL;
    ownedLevels.set(key, lvl);
  });

  const maxLevel = CONFIG.WEAPONS.MAX_LEVEL ?? 5;

  const hasProgressionTable =
    heroEntry?.progression &&
    typeof heroEntry.progression === 'object' &&
    Object.keys(heroEntry.progression).length > 0;

  let candidates = collectProgressionKeys(heroEntry?.progression, level);

  if (!candidates.length && !hasProgressionTable) {
    candidates = allowedKeys.slice();
  }

  const newFiltered = normalizeWeaponCandidates(candidates, allowedSet, ownedSet);
  const gatedNew = gateNewWeaponsByRarity(newFiltered);

  const upgradeCandidates = [];
  ownedSet.forEach((key) => {
    const lvl = ownedLevels.get(key) ?? CONFIG.WEAPONS.DEFAULT_LEVEL;
    if (lvl < maxLevel && allowedSet.has(key) && WeaponRegistry[key]) {
      upgradeCandidates.push(key);
    }
  });

  const seedBase = buildSeed(scene, level, 0);
  const shuffledNew = deterministicShuffle(gatedNew, seedBase);
  const shuffledUpgrade = deterministicShuffle(upgradeCandidates, seedBase + 1337);

  const picks = [];
  const want = Math.max(0, maxChoices);

  // Prefer NEW weapons first, then upgrades as filler.
  shuffledNew.slice(0, want).forEach((key) => {
    const entry = WeaponRegistry[key];
    picks.push({
      type: 'weapon',
      subtype: 'new',
      key,
      name: toDisplayName(entry, key),
      rarity: entry?.ui?.rarity ?? 'common',
      description: entry?.ui?.description ?? '',
      ui: entry?.ui ?? null
    });
  });

  if (picks.length < want) {
    const remaining = want - picks.length;
    shuffledUpgrade.slice(0, remaining).forEach((key) => {
      const entry = WeaponRegistry[key];
      const curLevel = ownedLevels.get(key) ?? CONFIG.WEAPONS.DEFAULT_LEVEL;
      const nextLevel = curLevel + 1;
      const description = WeaponProgression.describeLevelUpgrade(entry, curLevel, nextLevel);

      picks.push({
        type: 'weapon',
        subtype: 'upgrade',
        key,
        nextLevel,
        name: toDisplayName(entry, key),
        rarity: entry?.ui?.rarity ?? 'common',
        description,
        ui: entry?.ui ?? null
      });
    });
  }

  return picks;
}

/**
 * Build passive reward choices based on hero allowlists and current stacks.
 * Honors the passive cadence gate (interval/start/milestones) via CONFIG.LEVEL_UP.
 */
export function getPassiveChoices({
  scene,
  heroEntry,
  level,
  currentPassives = [],
  getStackCount,
  maxChoices = 3
}) {
  // NEW: passive cadence gate
  if (!shouldOfferPassives(level)) {
    return [];
  }

  const allowedKeys = Array.isArray(heroEntry?.passives?.allowed)
    ? heroEntry.passives.allowed
    : Object.keys(PassiveRegistry);

  const allowedSet = new Set(allowedKeys.filter((key) => PassiveRegistry[key]));
  const ownedCounts = buildOwnedPassiveCounts(currentPassives, getStackCount);

  const maxSlots = CONFIG?.PASSIVES?.maxSlots ?? Infinity;
  const ownedTotal = Array.from(ownedCounts.values()).reduce((sum, value) => sum + value, 0);
  if (Number.isFinite(maxSlots) && ownedTotal >= maxSlots) {
    return [];
  }

  const hasPassiveProgressionTable =
    heroEntry?.passives?.progression &&
    typeof heroEntry.passives.progression === 'object' &&
    Object.keys(heroEntry.passives.progression).length > 0;

  let candidates = collectProgressionKeys(heroEntry?.passives?.progression, level);

  if (!candidates.length && !hasPassiveProgressionTable) {
    candidates = allowedKeys.slice();
  }

  const filtered = normalizePassiveCandidates(candidates, allowedSet, ownedCounts);
  if (!filtered.length) return [];

  const stackGateFiltered = filterPassiveCandidatesByStackGate(filtered, ownedCounts, level);
  if (!stackGateFiltered.length) return [];

  const seed = buildSeed(scene, level, PASSIVE_SEED_OFFSET);
  const shuffled = deterministicShuffle(stackGateFiltered, seed);
  const picks = shuffled.slice(0, Math.max(0, maxChoices));

  return picks.map((key) => {
    const entry = PassiveRegistry[key];
    return {
      type: 'passive',
      key,
      name: toDisplayName(entry, key),
      rarity: entry?.ui?.rarity ?? 'common',
      description: entry?.ui?.description ?? '',
      ui: entry?.ui ?? null
    };
  });
}

/**
 * Combine weapon and passive choices into a final level-up reward set.
 */
export function getLevelUpChoices({
  scene,
  heroEntry,
  level,
  currentLoadout = [],
  currentPassives = [],
  getPassiveStackCount,
  maxChoices = 3
}) {
  const total = Math.max(0, maxChoices);
  if (total === 0) return [];

  const weaponChoices = getWeaponChoicesInternal({
    scene,
    heroEntry,
    level,
    currentLoadout,
    maxChoices: total,
    getWeaponLevel: (key) => scene.weaponManager?.getWeaponLevel?.(key)
  });

  // NEW: passive choices already include gating, but we also short-circuit here
  // to avoid extra work on levels where passives aren't allowed.
  const passiveChoices = shouldOfferPassives(level)
    ? getPassiveChoices({
        scene,
        heroEntry,
        level,
        currentPassives,
        getStackCount: getPassiveStackCount,
        maxChoices: total
      })
    : [];

  const upgrades = weaponChoices.filter((c) => c.subtype === 'upgrade');
  const newWeapons = weaponChoices.filter((c) => c.subtype !== 'upgrade');
  const passives = passiveChoices.slice();

  const weaponsAvailable = () => (upgrades.length + newWeapons.length) > 0;
  const passivesAvailable = () => passives.length > 0;

  const takeWeapon = () => {
    if (newWeapons.length) return newWeapons.shift();
    if (upgrades.length) return upgrades.shift();
    return null;
  };

  const takePassive = () => (passives.length ? passives.shift() : null);

  if (!weaponsAvailable() && !passivesAvailable()) return [];

  if (!weaponsAvailable()) return passives.slice(0, total);

  if (!passivesAvailable()) {
    const allWeaponsOrdered = [...newWeapons, ...upgrades];
    return allWeaponsOrdered.slice(0, total);
  }

  const rng = makeSeededRandom(buildSeed(scene, level, 0x1234abcd));

  if (total === 1) {
    const roll = rng();
    if (roll < 0.5) {
      const w = takeWeapon();
      if (w) return [w];
      const pFallback = takePassive();
      return pFallback ? [pFallback] : [];
    }
    const p = takePassive();
    if (p) return [p];
    const wFallback = takeWeapon();
    return wFallback ? [wFallback] : [];
  }

  // total >= 2, both categories available:
  let weaponSlots = 1;
  let passiveSlots = 1;
  let remaining = total - 2;

  while (remaining > 0 && (weaponsAvailable() || passivesAvailable())) {
    const roll = rng();
    if (!weaponsAvailable()) {
      passiveSlots += 1;
    } else if (!passivesAvailable()) {
      weaponSlots += 1;
    } else if (roll < 0.5) {
      weaponSlots += 1;
    } else {
      passiveSlots += 1;
    }
    remaining -= 1;
  }

  const picks = [];

  for (let i = 0; i < weaponSlots; i += 1) {
    const w = takeWeapon();
    if (!w) break;
    picks.push(w);
  }

  for (let i = 0; i < passiveSlots; i += 1) {
    const p = takePassive();
    if (!p) break;
    picks.push(p);
  }

  return picks.slice(0, total);
}
