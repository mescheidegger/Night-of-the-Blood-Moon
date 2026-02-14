/**
 * DropTables
 *
 * Defines which drop(s) a mob should spawn when defeated.
 * Each mob key maps to:
 *   - `selectionMode`:
 *      - `'weighted'` (default): choose by entry `weight`. `weight: 0` means never spawn.
 *      - `'sequential'`: choose `entries[i]` per roll (falls back to `entries[0]`).
 *   - `entries`: possible drops the mob can produce
 *   - `rolls`: how many times to attempt spawning entries (multi-drop)
 */

const TREASURE_PROD_DISABLED_ENTRIES = [
  { type: 'treasure_1', weight: 0 },
  { type: 'treasure_2', weight: 0 },
  { type: 'treasure_3', weight: 0 },
  { type: 'treasure_4', weight: 0 },
  { type: 'treasure_5', weight: 0 },
];

export const DropTables = {
  /**
   * Baseline: mostly small XP, small chance at large XP, tiny chance at minor heal.
   */
  evileye: {
    selectionMode: 'weighted',
    rolls: 1,
    entries: [
      { type: 'xp_small', weight: 94 },
      { type: 'xp_large', weight: 5 },
      { type: 'health_minor', weight: 5 }
    ]
  },

  littlescary: {
    selectionMode: 'weighted',
    rolls: 1,
    entries: [
      { type: 'xp_small', weight: 94 },
      { type: 'xp_large', weight: 5 },
      { type: 'health_minor', weight: 5 }
    ]
  },

  /**
   * Fast but fragile → mostly small XP, tiny chance at large, tiny minor heal.
   */
  spookybat: {
    selectionMode: 'weighted',
    rolls: 1,
    entries: [
      { type: 'xp_small', weight: 96 },
      { type: 'xp_large', weight: 3 },
      { type: 'health_minor', weight: 5 }
    ]
  },

  /**
   * Tankier than evileye → slightly higher chance at a large, tiny minor heal.
   */
  crawlybones: {
    selectionMode: 'weighted',
    rolls: 1,
    entries: [
      { type: 'xp_small', weight: 89 },
      { type: 'xp_large', weight: 10 },
      { type: 'health_minor', weight: 5 }
    ]
  },

  /**
   * Elites: two rolls so they can drop multiple gems; higher large chance.
   * Small chance to include a minor heal.
   */
  cocodemon_elite: {
    selectionMode: 'weighted',
    rolls: 2,
    entries: [
      { type: 'xp_small', weight: 72 },
      { type: 'xp_large', weight: 25 },
      { type: 'health_minor', weight: 8 }
    ]
  },

  nightman_elite: {
    selectionMode: 'weighted',
    rolls: 2,
    entries: [
      { type: 'xp_small', weight: 68 },
      { type: 'xp_large', weight: 30 },
      { type: 'health_minor', weight: 8 }
    ]
  },

  /**
   * Bosses: multiple rolls, strong bias toward large XP.
   * Include minor heals, and reserve major heals for the toughest bosses.
   * Treasure is wired in but disabled in PROD via weight 0 entries.
   */
  evilwizard_boss: {
    selectionMode: 'weighted',
    rolls: 5,
    entries: [
      { type: 'xp_small', weight: 38 },
      { type: 'xp_large', weight: 60 },
      { type: 'health_minor', weight: 8 },
      ...TREASURE_PROD_DISABLED_ENTRIES,
    ]
  },

  darkwizard_boss: {
    selectionMode: 'weighted',
    rolls: 5,
    entries: [
      { type: 'xp_small', weight: 38 },
      { type: 'xp_large', weight: 60 },
      { type: 'health_minor', weight: 8 },
      ...TREASURE_PROD_DISABLED_ENTRIES,
    ]
  },

  werewolf_boss: {
    selectionMode: 'weighted',
    rolls: 5,
    entries: [
      { type: 'xp_small', weight: 33 },
      { type: 'xp_large', weight: 64 },
      { type: 'health_minor', weight: 2 },
      { type: 'health_major', weight: 8 },
      ...TREASURE_PROD_DISABLED_ENTRIES,
    ]
  },

  bringerofdeath_boss: {
    selectionMode: 'weighted',
    rolls: 5,
    entries: [
      { type: 'xp_small', weight: 33 },
      { type: 'xp_large', weight: 64 },
      { type: 'health_minor', weight: 2 },
      { type: 'health_major', weight: 8 },
      ...TREASURE_PROD_DISABLED_ENTRIES,
    ]
  },

  demonknight_boss: {
    selectionMode: 'weighted',
    rolls: 6,
    entries: [
      { type: 'xp_small', weight: 28 },
      { type: 'xp_large', weight: 69 },
      { type: 'health_minor', weight: 2 },
      { type: 'health_major', weight: 8 },
      ...TREASURE_PROD_DISABLED_ENTRIES,
    ]
  },

  /**
   * Fallback for any unspecified key.
   * Keep this conservative so unknown mobs don't flood potions.
   */
  default: {
    selectionMode: 'weighted',
    rolls: 1,
    entries: [
      { type: 'xp_small', weight: 99 },
      { type: 'health_minor', weight: 10 }
    ]
  }
};
