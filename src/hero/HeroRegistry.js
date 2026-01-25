import Phaser from 'phaser';
import { WeaponRegistry } from '../weapons/WeaponRegistry.js';
import { PassiveRegistry } from '../passives/PassiveRegistry.js';
import { buildHeroSheetKey } from './HeroAtlasConfig.js';

/**
 * Default hero selection when no explicit choice is provided (e.g., brand new game).
 */
export const DEFAULT_HERO_KEY = 'knight';

/**
 * Legacy starter loadout used before per-hero loadouts existed.  Kept as a
 * fallback so older content continues to work if a hero omits overrides.
 */
export const LEGACY_DEFAULT_STARTER_LOADOUT = Object.freeze([
  'bolt',
  'vikingaxe',
  'shuriken',
  'xbow',
  'fireball',
  'lightning',
  'chainlightning',
  'deathray',
  'bazooka',
  'clusterbomb',
  'sparkcross'
]);

/**
 * Determine the legal weapon list for a hero so loadouts respect registry limits.
 */
function resolveAllowedWeapons(entry) {
  const allRegistered = Object.keys(WeaponRegistry);
  const provided = entry?.weapons?.allowed;
  if (!Array.isArray(provided)) {
    return { allowed: allRegistered, explicit: false };
  }
  const deduped = [...new Set(provided)].filter((key) => WeaponRegistry[key]);
  return { allowed: deduped, explicit: true };
}

/**
 * Filter the starter loadout against allowed weapons to avoid invalid unlocks.
 */
function resolveStarterLoadout(entry, allowedKeys, allowlistExplicit) {
  const base = entry?.weapons?.starter ?? LEGACY_DEFAULT_STARTER_LOADOUT;
  const allowedSet = new Set(allowedKeys);
  return (Array.isArray(base) ? base : []).filter((key) => {
    if (!WeaponRegistry[key]) return false;
    if (!allowlistExplicit) return true;
    return allowedSet.has(key);
  });
}

/**
 * Compute passive allowlists so hero-specific builds stay consistent.
 */
function resolveAllowedPassives(entry) {
  const allRegistered = Object.keys(PassiveRegistry);
  const provided = entry?.passives?.allowed;
  if (!Array.isArray(provided)) {
    return { allowed: allRegistered, explicit: false };
  }
  const deduped = [...new Set(provided)].filter((key) => PassiveRegistry[key]);
  return { allowed: deduped, explicit: true };
}

/**
 * Ensure starter passives are valid for the hero and current allowlist policy.
 */
function resolveStarterPassives(entry, allowedKeys, allowlistExplicit) {
  const base = entry?.passives?.starter ?? [];
  const allowedSet = new Set(allowedKeys);
  return (Array.isArray(base) ? base : []).filter((key) => {
    if (!PassiveRegistry[key]) return false;
    if (!allowlistExplicit) return true;
    return allowedSet.has(key);
  });
}

/**
 * Fill in missing sheet keys so asset and animation helpers can rely on them.
 */
function decorateSheets(entry) {
  const sheets = entry?.sheets ?? {};
  return Object.fromEntries(
    Object.entries(sheets).map(([name, sheet]) => {
      const key = sheet?.key ?? buildHeroSheetKey(entry.key, name);
      return [name, { ...sheet, key }];
    })
  );
}

/**
 * Apply registry defaults and derived metadata so consumers get a full hero config.
 */
function applyHeroDefaults(entry) {
  const { allowed, explicit } = resolveAllowedWeapons(entry);
  const starter = resolveStarterLoadout(entry, allowed, explicit);
  const passiveAllowed = resolveAllowedPassives(entry);
  const passiveStarter = resolveStarterPassives(entry, passiveAllowed.allowed, passiveAllowed.explicit);
  const sheets = decorateSheets(entry);
  const defaultIconKey = sheets?.idle?.key ?? buildHeroSheetKey(entry.key, 'idle');
  const shouldApplyDefaultIcon = !entry.ui?.icon && defaultIconKey;
  const ui = {
    ...(entry.ui ?? {}),
    ...(shouldApplyDefaultIcon ? { icon: { key: defaultIconKey, frame: 0 } } : {})
  };
  return {
    ...entry,
    hidden: entry.hidden ?? false,
    weapons: {
      ...(entry.weapons ?? {}),
      allowed,
      starter
    },
    passives: {
      ...(entry.passives ?? {}),
      allowed: passiveAllowed.allowed,
      starter: passiveStarter
    },
    sheets,
    ui
  };
}

/**
 * Declarative description for every playable hero.  The registry keeps sprite
 * metadata, physics tuning, cosmetics, and other config in a single place so
 * new heroes can be added without rewriting scene logic.
 */
const HEROES = {
  sirsmite: {
    key: 'sirsmite',
    defaultFacing: 'right',
    progression: {
      3: ['bow'],
      7: ['magicpotion'],
      12: ['daggerthrow'],
      18: ['smite'],
      24: ['holyhammer']
    },
    weapons: {
      allowed: [
        'sword',
        'daggerthrow',
        'magicpotion',
        'bow',
        'smite',
        'holyhammer'
      ],
      starter: ['sword'],
      starterlabel: 'Sword'
    },
    passives: {
      allowed: ['might', 'vampiresKiss', 'multiShot', 'bloodrush', 'bloodwindtreads', 'reapersReach', 'shield'],
      //starter: ['might']
    },
    ui: {
      name: 'Sir Smite',
      blurb: 'King of the North.'
    },
    sheets: {
      idle: {
        atlasFrame: 'sirsmiteidle.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 11
      },
      walk: {
        atlasFrame: 'sirsmiterun.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 8
      },
      die: {
        atlasFrame: 'sirsmitedeath.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 11
      }
    },
    animations: {
      singleDirection: true,
      framesPerRow: 11,
      framesPerRowBySheet: {
        idle: 11,
        walk: 8,
        die: 11
      },
      rowByDirection: {
        right: 0
      },
      frameRate: {
        walk: 8,
        die: 10
      }
    },
    body: {
      circle: {
        radius: 12,
        offsetX: 4,
        offsetY: 4
      }
    },
    stats: {
      speed: 105,
      maxVelocity: 160,
      maxHealth: 200,
      iframeMs: 200,
      drag: 0,
      damping: false
    },
    cosmetics: {
      glowKey: 'player_glow',
      glowBlend: Phaser.BlendModes.ADD,
      glowDepth: 1,
      healthBarWidth: 30,
      healthBarOffsetY: 8
    },
    depth: {
      sprite: 2
    }
  },
  viking: {
    key: 'viking',
    defaultFacing: 'right',
    progression: {
      3: ['vikinghammer'],
      7: ['icebow'],
      12: ['whirlwind'],
      18: ['lightning'],
      24: ['ragnarok']
    },
    weapons: {
      allowed: [
        'whirlwind',
        'vikinghammer',
        'cleaver',
        'icebow',
        'lightning',
        'ragnarok',
      ],
      starter: ['cleaver'],
      starterlabel: 'Nordic Cleaver'
    },
    passives: {
      allowed: ['might', 'vampiresKiss', 'multiShot', 'bloodrush', 'bloodwindtreads', 'reapersReach', 'shield'],
      starter: []
    },
    ui: {
      name: 'Viking',
      blurb: 'Ruthless warlord. Descendent of Odin.'
    },
    sheets: {
      idle: {
        atlasFrame: 'vikingidle.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 6
      },
      walk: {
        atlasFrame: 'vikingrun.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 8
      },
      die: {
        atlasFrame: 'vikingdeath.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 12
      }
    },
    animations: {
      singleDirection: true,
      framesPerRow: 12,
      framesPerRowBySheet: {
        idle: 6,
        walk: 8,
        die: 12
      },
      rowByDirection: {
        right: 0
      },
      frameRate: {
        walk: 12,
        die: 10
      }
    },
    body: {
      circle: {
        radius: 12,
        offsetX: 4,
        offsetY: 4
      }
    },
    stats: {
      speed: 110,
      maxVelocity: 160,
      maxHealth: 175,
      iframeMs: 150,
      drag: 0,
      damping: false
    },
    cosmetics: {
      glowKey: 'player_glow',
      glowBlend: Phaser.BlendModes.ADD,
      glowDepth: 1,
      healthBarWidth: 30,
      healthBarOffsetY: 8
    },
    depth: {
      sprite: 2
    }
  },
  hunk: {
    key: 'hunk',
    defaultFacing: 'right',
    progression: {
      3: ['flamethrower'],
      7: ['bazooka'],
      12: ['ak47'],
      18: ['uavstrike'],
      24: ['deathray']
    },
    weapons: {
      allowed: [
        'flamethrower',
        'ak47',
        'hammer',
        'bazooka',
        'deathray',
        'uavstrike',
      ],
      starter: ['hammer'],
      starterlabel: 'Hammer Swing'
    },
    passives: {
      allowed: ['might', 'vampiresKiss', 'multiShot', 'bloodrush', 'bloodwindtreads', 'reapersReach', 'shield'],
      starter: []
    },
    ui: {
      name: 'Hunk',
      blurb: 'Conventional weapons. Heavy explosions. Unknown motives.'
    },
    sheets: {
      idle: {
        atlasFrame: 'hunkidle.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 5
      },
      walk: {
        atlasFrame: 'hunkrun.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 8
      },
      die: {
        atlasFrame: 'hunkdeath.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 6
      }
    },
    animations: {
      singleDirection: true,
      framesPerRow: 8,
      framesPerRowBySheet: {
        idle: 5,
        walk: 8,
        die: 6
      },
      rowByDirection: {
        right: 0
      },
      frameRate: {
        walk: 12,
        die: 10
      }
    },
    body: {
      circle: {
        radius: 12,
        offsetX: 4,
        offsetY: 4
      }
    },
    stats: {
      speed: 105,
      maxVelocity: 160,
      maxHealth: 200,
      iframeMs: 200,
      drag: 0,
      damping: false
    },
    cosmetics: {
      glowKey: 'player_glow',
      glowBlend: Phaser.BlendModes.ADD,
      glowDepth: 1,
      healthBarWidth: 30,
      healthBarOffsetY: 8
    },
    depth: {
      sprite: 2
    }
  },
  ladydame: {
    key: 'ladydame',
    defaultFacing: 'right',
    progression: {
      3: ['piercingstar'],
      7: ['bow'],
      12: ['venusrevenge'],
      18: ['deathskiss'],
      24: ['clusterpotion']
    },
    weapons: {
      allowed: [
        'girlsword',
        'bow',
        'deathskiss',
        'piercingstar',
        'clusterpotion',
        'venusrevenge',
      ],
      starter: ['girlsword'],
      starterlabel: 'Crimson Slash'
    },
    passives: {
      allowed: ['might', 'vampiresKiss', 'multiShot', 'bloodrush', 'bloodwindtreads', 'reapersReach', 'shield'],
      starter: []
    },
    ui: {
      name: 'Lady Dame',
      blurb: 'Queen of the North.'
    },
    sheets: {
      idle: {
        atlasFrame: 'ladydameidle.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 6
      },
      walk: {
        atlasFrame: 'ladydamerun.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 8
      },
      die: {
        atlasFrame: 'ladydamedeath.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 11
      }
    },
    animations: {
      singleDirection: true,
      framesPerRow: 8,
      framesPerRowBySheet: {
        idle: 6,
        walk: 8,
        die: 11
      },
      rowByDirection: {
        right: 0
      },
      frameRate: {
        walk: 12,
        die: 10
      }
    },
    body: {
      circle: {
        radius: 12,
        offsetX: 4,
        offsetY: 4
      }
    },
    stats: {
      speed: 115,
      maxVelocity: 165,
      maxHealth: 150,
      iframeMs: 100,
      drag: 0,
      damping: false
    },
    cosmetics: {
      glowKey: 'player_glow',
      glowBlend: Phaser.BlendModes.ADD,
      glowDepth: 1,
      healthBarWidth: 28,
      healthBarOffsetY: 8
    },
    depth: {
      sprite: 2
    }
  },
  huntress: {
    key: 'huntress',
    defaultFacing: 'right',
    progression: {
      3: ['windsummon'],
      7: ['xbow'],
      12: ['spearthrow'],
      18: ['spearcross'],
      24: ['greenfire']
    },
    weapons: {
      allowed: [
        'spear',
        'windsummon',
        'xbow',
        'spearthrow',
        'spearcross',
        'greenfire'
      ],
      starter: ['spear'],
      starterlabel: 'Spear'
    },
    passives: {
      allowed: ['might', 'vampiresKiss', 'multiShot', 'bloodrush', 'bloodwindtreads', 'reapersReach', 'shield'],
      starter: []
    },
    ui: {
      name: 'Huntress',
      blurb: 'Goddess of the wood.'
    },
    sheets: {
      idle: {
        atlasFrame: 'huntressidle.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 8
      },
      walk: {
        atlasFrame: 'huntressrun.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 8
      },
      die: {
        atlasFrame: 'huntressdeath.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 8
      }
    },
    animations: {
      singleDirection: true,
      framesPerRow: 8,
      rowByDirection: {
        right: 0
      },
      frameRate: {
        walk: 12,
        die: 10
      }
    },
    body: {
      circle: {
        radius: 12,
        offsetX: 4,
        offsetY: 4
      }
    },
    stats: {
      speed: 115,
      maxVelocity: 165,
      maxHealth: 150,
      iframeMs: 100,
      drag: 0,
      damping: false
    },
    cosmetics: {
      glowKey: 'player_glow',
      glowBlend: Phaser.BlendModes.ADD,
      glowDepth: 1,
      healthBarWidth: 28,
      healthBarOffsetY: 8
    },
    depth: {
      sprite: 2
    }
  },
  wizard: {
    key: 'wizard',
    defaultFacing: 'right',
    progression: {
      3: ['fireblast'],
      7: ['vanquish'],
      12: ['sparkcross'],
      18: ['chainlightning'],
      24: ['lifeeraser']
    },
    weapons: {
      allowed: [
        'fireblast',
        'vanquish',
        'chainlightning',
        'sparkcross',
        'lifeeraser',
        'staff'
      ],
      starter: ['staff'],
      starterlabel: 'Arcane Swipe'
    },
    passives: {
      allowed: ['might', 'vampiresKiss', 'multiShot', 'bloodrush', 'bloodwindtreads', 'reapersReach', 'shield'],
      starter: []
    },
    ui: {
      name: 'Wizard',
      blurb: 'Glass cannon the Grey.'
    },
    sheets: {
      idle: {
        atlasFrame: 'wizardidle.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 6
      },
      walk: {
        atlasFrame: 'wizardrun.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 8
      },
      die: {
        atlasFrame: 'wizarddeath.png',
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 7
      }
    },
    animations: {
      singleDirection: true,
      framesPerRow: 8,
      framesPerRowBySheet: {
        idle: 6,
        die: 7
      },
      rowByDirection: {
        right: 0
      },
      frameRate: {
        walk: 12,
        die: 10
      }
    },
    body: {
      circle: {
        radius: 12,
        offsetX: 4,
        offsetY: 4
      }
    },
    stats: {
      speed: 115,
      maxVelocity: 160,
      maxHealth: 150,
      iframeMs: 100,
      drag: 0,
      damping: false
    },
    cosmetics: {
      glowKey: 'player_glow',
      glowBlend: Phaser.BlendModes.ADD,
      glowDepth: 1,
      healthBarWidth: 28,
      healthBarOffsetY: 8
    },
    depth: {
      sprite: 2
    }
  }
};

export const HeroRegistry = HEROES;

/**
 * Retrieve a hero config by key, falling back to the default hero so gameplay
 * always boots even if an invalid key is passed in from saved state/UI.
 */
export function getHeroEntry(key) {
  const base = HeroRegistry[key] ?? HeroRegistry[DEFAULT_HERO_KEY];
  return applyHeroDefaults(base);
}

/**
 * Convenience helper used by asset loading to iterate every hero definition.
 */
export function listHeroes() {
  return Object.values(HeroRegistry).map((entry) => applyHeroDefaults(entry));
}
