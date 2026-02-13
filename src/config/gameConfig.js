// Central tuning knobs that gameplay systems read during setup/reset flows.
// Keeping them in one place makes later upgrades (magnet boosts, rarities,
// etc.) trivial — content just pulls from CONFIG and overrides selectively.
export const CONFIG = {
  XP: {
    // Registry key for the default gem.  Pooled XP orbs fall back to this when
    // callers pass an unknown type.
    DEFAULT_TYPE: 'xpgem',
    // Base XP payout when the registry does not provide a custom value.
    VALUE_DEFAULT: 1,
    // Distance (in px) where gems start accelerating toward the player.
    MAGNET_RADIUS: 160,
    // Distance (in px) where we instantly collect the orb to avoid tight
    // orbital motion while the player is moving away.
    SNAP_RADIUS: 18,
    // Lifetime for drops (ms). Prevents long runs from accumulating infinite orbs.
    DROP_TTL_MS: 25000,
    // Optional culling distance from the player (px). Set to 0 to disable.
    MAX_KEEP_DISTANCE: 1600,
    // Delay after spawn before the magnet force activates (lets death sprays
    // breathe for a brief moment).
    MAGNET_DELAY_MS: 250,
    // Acceleration magnitude applied per second once the magnet engages.
    ACCEL: 300,
    // Velocity cap while magnetized so we avoid tunneling or camera stutter.
    MAX_SPEED: 220,
    // Default Arcade Physics circle radius applied to the orb body.
    BODY_RADIUS: 5,
    // Render depth and scale defaults (registry can override per type).
    DEPTH: 3,
    SCALE: 1,
    // Tiny random impulse so drops fan out before the magnet reels them back
    // in — keeps death piles legible without bespoke animations.
    SPAWN_IMPULSE: {
      MIN: 10,
      MAX: 40
    }
  },
  PASSIVES: {
    maxSlots: 10,
    mergePolicy: 'weapons-first'
  },

  WEAPONS: {
    MAX_LEVEL: 10,
    DEFAULT_LEVEL: 1,
    SCALING: {
      projectile: {
        damagePctPerLevel: 0.25,
        cooldownPctPerLevel: -0.05
      },
      bazooka: {
        damagePctPerLevel: 0.35,
        cooldownPctPerLevel: -0.02
      },
      default: {
        damagePctPerLevel: 0.2,
        cooldownPctPerLevel: 0
      }
    }
  },

  DIFFICULTY: {
    playerDamageMult: 1.0,
    enemyHealthMult: 1.0,
    xpRateMult: 1.0
  },

  COMBAT: {
    // If true, enemy projectile damage bypasses the hero's invulnerability frames.
    ENEMY_PROJECTILES_IGNORE_IFRAMES: false
  }
};

// Shared tuning for the level-up modal (choices, restore, and passive cadence).
export const LEVEL_UP = Object.freeze({
  // How many upgrade options to show (restore is added separately).
  choicesPerLevel: 3,

  // Restore option amount:
  // - 'full'        => heal to max
  // - 'percent:25'  => heal 25% of max
  // - 50            => heal 50 HP
  restoreHealthAmount: 'full',

  // --- Passive appearance tuning ---

  // Only allow passives to appear every N levels.
  // 1 = every level (old behavior), 2 = every other level, 3 = every third, etc.
  passiveInterval: 2,

  // Level at which interval gating begins.
  // Before this level, passives can always appear.
  passiveStartLevel: 2,

  // Specific milestone levels where passives are always allowed,
  // even if they don't match the interval rule.
  passiveMilestones: [7, 9, 10, 15, 20],

  // --- Passive stack gating ---

  // Require additional passive stacks to unlock every N levels globally.
  // Example: 10 => stack 2 at level 10, stack 3 at level 20, stack 4 at 30.
  passiveStackLevelInterval: 10,

  // Stack index where level gating starts.
  // 2 means the first stack is always allowed and stack 2+ are gated.
  passiveStackGateStartAtStack: 2,

  // Defensive runtime enforcement in PassiveManager.addPassive.
  // Keep enabled for gameplay, disable temporarily for debug tooling if needed.
  enforcePassiveStackLevelGate: true
});

// Dev-only helpers for fast-forwarding runs and booting with predefined loadouts.
// This block is gated via import.meta.env.DEV, so production builds ignore it.
export const DEV_RUN = Object.freeze({
  enabled: false,

  // jump to late game
  startElapsedSeconds: 8 * 60,

  // optional
  startLevel: 50,
  snapXPToLevelFloor: true,

  // Option A: simple list (all get weaponLevelDefault)
  weapons: ['spear', 'windsummon', 'xbow'], //, 'spearthrow', 'spearcross', 'greenfire'
  weaponLevelDefault: 8,

  // Passives: duplicates = stacks (your PassiveManager supports this)
  passives: [
    'might',
    'vampiresKiss',
    'vampiresKiss',
    'vampiresKiss',
    'multiShot',
    'multiShot',
    'bloodwindtreads',
    'shield',
    'shield',
    'shield'
  ]
});
