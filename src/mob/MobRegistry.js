/**
 * Central, data-driven catalogue of every enemy ("mob") archetype.
 *
 * This registry is intentionally **configuration-only** so that:
 *  - The **Enemy** class stays generic.
 *  - The **SpawnDirector** and **spawners** do not need special cases.
 *  - Adding a new mob means **only adding an entry here** (plus art assets),
 *    with no runtime code changes required.
 *
 * Each mob entry defines:
 *  • Spritesheet (texture + frame dimensions)
 *  • Animation rules
 *  • Physics body shape + offsets
 *  • Base stats (speed / hp / etc.)
 *  • Rewards (XP, drops)
 *  • AI behavior key → resolved in ENEMY_BEHAVIORS
 */
export const MobRegistry = {
  evileye: {
    /** Phaser texture key (set by preload) backing this mob's spritesheet. */
    sheetKey: 'evileye',
    sheet: {
      path: '/assets/sprites/mobs/evileye.png',
      frameWidth: 16,
      frameHeight: 16,
    },

    /** Fallback frame when the mob has no animation running. */
    defaultFrame: 0,

    /** Default idle/movement animation played on spawn. */
    defaultAnim: 'evileye:float',

    /** Pixel scaling applied to the visual sprite. */
    scale: 1,

    /** Origin ensures centered rotation + consistent collision alignment. */
    origin: { x: 0.5, y: 0.5 },

    /** Depth relative to other render layers. */
    depth: 2,

    /**
     * Animation definitions automatically registered in registerMobAnimations().
     * Each entry here generates animation frames from the declared spritesheet.
     */
    animations: [
      {
        key: 'evileye:float',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      }
    ],

    /**
     * Physics hitbox (used by applyBodyConfig).
     * Circular bodies are useful for radial movement and swarm spacing.
     */
    body: {
      type: 'circle',
      radius: 6,
      offsetX: 2,
      offsetY: 2,
    },

    /** Base stats applied by Enemy.reset(). */
    stats: {
      speed: 70,
      hp: 10,
      damage: 10,
    },

    /** Drops / XP rewards the Mob awards when killed. */
    rewards: {
      xp: 1,
    },

    audio: {
      death: null
    },

    /**
     * Behavior key looked up in ENEMY_BEHAVIORS.
     * Defines how this mob moves/acts every tick.
     */
    ai: 'seekPlayer',
  },

  littlescary: {
    sheetKey: 'littlescary',
    sheet: {
      path: '/assets/sprites/mobs/littlescary.png',
      frameWidth: 16,
      frameHeight: 16,
    },

    defaultFrame: 0,
    defaultAnim: 'littlescary:float',

    scale: 1,
    origin: { x: 0.5, y: 0.5 },
    depth: 2,

    animations: [
      {
        key: 'littlescary:float',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      }
    ],

    body: {
      type: 'circle',
      radius: 6,
      offsetX: 2,
      offsetY: 2,
    },

    stats: {
      speed: 70,
      hp: 20,
      damage: 10,
    },

    rewards: { xp: 1 },

    audio: {
      death: null
    },

    ai: 'seekPlayer',
  },

  spookybat: {
    sheetKey: 'spookybat',
    sheet: {
      path: '/assets/sprites/mobs/spookybat.png',
      frameWidth: 16,
      frameHeight: 16,
    },
    defaultFrame: 0,
    defaultAnim: 'spookybat:float',
    scale: 1,
    origin: { x: 0.5, y: 0.5 },
    depth: 2,
    animations: [
      {
        key: 'spookybat:float',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      }
    ],
    body: {
      type: 'circle',
      radius: 6,
      offsetX: 2,
      offsetY: 2,
    },

    /** Faster than evileyes; plays into wave-formation pressure. */
    stats: {
      speed: 90,
      hp: 10,
      damage: 10,
    },

    rewards: { xp: 1 },

    audio: {
      death: null
    },

    /**
     * Default AI for bats (wave spawners may override dynamically).
     */
    ai: 'flyStraight',
  },

  crawlybones: {
    sheetKey: 'crawlybones',
    sheet: {
      path: '/assets/sprites/mobs/crawlybones.png',
      frameWidth: 16,
      frameHeight: 16,
    },
    defaultFrame: 0,
    defaultAnim: 'crawlybones:crawl',
    scale: 1,
    origin: { x: 0.5, y: 0.5 },
    depth: 2,
    animations: [
      {
        key: 'crawlybones:crawl',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      }
    ],

    /**
     * Slightly wider rectangular hitbox to match crawling silhouette.
     * Rect bodies work better for "wall" and "block" patterns.
     */
    body: {
      type: 'rect',
      width: 12,
      height: 10,
      offsetX: 2,
      offsetY: 3,
    },

    /** Tankier + slower: ideal for advancing wall pressure. */
    stats: {
      speed: 60,
      hp: 22,
      damage: 10,
    },

    rewards: { xp: 1 },

    audio: {
      death: null
    },

    /** Moves toward player unless overridden by spawner (e.g., wallLine). */
    ai: 'seekPlayer',
  },

  cocodemon_elite: {
    tier: 'elite',

    sheetKey: 'cocowalk',
    sheets: {
      walk: {
        key: 'cocowalk',
        path: '/assets/sprites/elites/cocowalk.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      attack: {
        key: 'cocoattack',
        path: '/assets/sprites/elites/cocoattack.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      death: {
        key: 'cocodeath',
        path: '/assets/sprites/elites/cocodeath.png',
        frameWidth: 64,
        frameHeight: 64,
      }
    },

    defaultFrame: 0,
    defaultAnim: 'coco:walk',
    depth: 3,
    scale: 1,
    origin: { x: 0.5, y: 0.6 },

    animations: [
      {
        key: 'coco:walk',
        sheet: 'walk',
        frames: { start: 0, end: 5 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'coco:attack',
        sheet: 'attack',
        frames: { start: 0, end: 5 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'coco:death',
        sheet: 'death',
        frames: { start: 0, end: 5 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'coco:walk',
      move: 'coco:walk',
      attack: 'coco:attack',
      death: 'coco:death',
    },

    body: {
      type: 'circle',
      radius: 12,
      offsetX: 20,
      offsetY: 20,
    },

    stats: {
      speed: 100,
      hp: 100,
      damage: 25,
      maxSpeed: 200,
    },

    rewards: { xp: 4 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 40,
      meleeDamage: 25,
      attackCooldownMs: 1000,
      windupMs: 120,
      lungeSpeed: 220,
    },
  },

  nightman_elite: {
    tier: 'elite',

    sheetKey: 'nightmanwalk',
    sheets: {
      walk: {
        key: 'nightmanwalk',
        path: '/assets/sprites/elites/nightmanwalk.png',
        frameWidth: 48,
        frameHeight: 48,
      },
      attack: {
        key: 'nightmanattack',
        path: '/assets/sprites/elites/nightmanattack.png',
        frameWidth: 48,
        frameHeight: 48,
      },
      death: {
        key: 'nightmandeath',
        path: '/assets/sprites/elites/nightmandeath.png',
        frameWidth: 64,
        frameHeight: 64,
      }
    },

    defaultFrame: 0,
    defaultAnim: 'nightman:walk',
    depth: 3,
    scale: 1,
    origin: { x: 0.5, y: 0.65 },

    animations: [
      {
        key: 'nightman:walk',
        sheet: 'walk',
        frames: { start: 0, end: 5 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'nightman:attack',
        sheet: 'attack',
        frames: { start: 0, end: 11 },
        frameRate: 14,
        repeat: 0,
      },
      {
        key: 'nightman:death',
        sheet: 'death',
        frames: { start: 0, end: 21 },
        frameRate: 12,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'nightman:walk',
      move: 'nightman:walk',
      attack: 'nightman:attack',
      death: 'nightman:death',
    },

    body: {
      type: 'circle',
      radius: 12,
      offsetX: 12,
      offsetY: 22,
    },

    stats: {
      speed: 105,
      hp: 100,
      damage: 25,
      maxSpeed: 220,
    },

    rewards: { xp: 5 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 42,
      meleeDamage: 25,
      attackCooldownMs: 900,
      windupMs: 100,
      lungeSpeed: 240,
    },
  },

  audrey1: {
    tier: 'elite',

    sheetKey: 'audrey1walk',
    sheets: {
      idle: {
        key: 'audrey1idle',
        path: '/assets/sprites/elites/plant1idle.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      walk: {
        key: 'audrey1walk',
        path: '/assets/sprites/elites/plant1walk.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      attack: {
        key: 'audrey1attack',
        path: '/assets/sprites/elites/plant1attack.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      hurt: {
        key: 'audrey1hurt',
        path: '/assets/sprites/elites/plant1hurt.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      death: {
        key: 'audrey1death',
        path: '/assets/sprites/elites/plant1death.png',
        frameWidth: 64,
        frameHeight: 64,
      },
    },

    defaultFrame: 0,
    defaultAnim: 'audrey1:idle',
    depth: 3,
    scale: 1,
    origin: { x: 0.5, y: 0.65 },

    animations: [
      {
        key: 'audrey1:idle',
        sheet: 'idle',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'audrey1:walk',
        sheet: 'walk',
        frames: { start: 0, end: 7 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'audrey1:attack',
        sheet: 'attack',
        frames: { start: 0, end: 6 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'audrey1:hurt',
        sheet: 'hurt',
        frames: { start: 0, end: 4 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'audrey1:death',
        sheet: 'death',
        frames: { start: 0, end: 9 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'audrey1:idle',
      move: 'audrey1:walk',
      attack: 'audrey1:attack',
      hit: 'audrey1:hurt',
      death: 'audrey1:death',
    },

    body: {
      type: 'circle',
      radius: 12,
      offsetX: 20,
      offsetY: 34,
    },

    stats: {
      speed: 90,
      hp: 100,
      damage: 30,
      maxSpeed: 180,
    },

    rewards: { xp: 6 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 44,
      meleeDamage: 30,
      attackCooldownMs: 1000,
      windupMs: 140,
      lungeSpeed: 210,
    },
  },

  vlad: {
    tier: 'elite',

    sheetKey: 'vampire1walk',
    sheets: {
      idle: {
        key: 'vampire1idle',
        path: '/assets/sprites/elites/vampire1idle.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      walk: {
        key: 'vampire1walk',
        path: '/assets/sprites/elites/vampire1walk.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      attack: {
        key: 'vampire1attack',
        path: '/assets/sprites/elites/vampire1attack.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      hurt: {
        key: 'vampire1hurt',
        path: '/assets/sprites/elites/vampire1hurt.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      death: {
        key: 'vampire1death',
        path: '/assets/sprites/elites/vampire1death.png',
        frameWidth: 64,
        frameHeight: 64,
      },
    },

    defaultFrame: 0,
    defaultAnim: 'vlad:idle',
    depth: 3,
    scale: 1,
    origin: { x: 0.5, y: 0.65 },

    animations: [
      {
        key: 'vlad:idle',
        sheet: 'idle',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'vlad:walk',
        sheet: 'walk',
        frames: { start: 0, end: 5 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'vlad:attack',
        sheet: 'attack',
        frames: { start: 0, end: 6 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'vlad:hurt',
        sheet: 'hurt',
        frames: { start: 0, end: 3 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'vlad:death',
        sheet: 'death',
        frames: { start: 0, end: 9 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'vlad:idle',
      move: 'vlad:walk',
      attack: 'vlad:attack',
      hit: 'vlad:hurt',
      death: 'vlad:death',
    },

    body: {
      type: 'circle',
      radius: 12,
      offsetX: 20,
      offsetY: 34,
    },

    stats: {
      speed: 90,
      hp: 100,
      damage: 30,
      maxSpeed: 180,
    },

    rewards: { xp: 6 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 44,
      meleeDamage: 30,
      attackCooldownMs: 1000,
      windupMs: 140,
      lungeSpeed: 210,
    },
  },

  audrey2: {
    tier: 'elite',

    sheetKey: 'audrey2walk',
    sheets: {
      idle: {
        key: 'audrey2idle',
        path: '/assets/sprites/elites/plant2idle.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      walk: {
        key: 'audrey2walk',
        path: '/assets/sprites/elites/plant2walk.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      attack: {
        key: 'audrey2attack',
        path: '/assets/sprites/elites/plant2attack.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      hurt: {
        key: 'audrey2hurt',
        path: '/assets/sprites/elites/plant2hurt.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      death: {
        key: 'audrey2death',
        path: '/assets/sprites/elites/plant2death.png',
        frameWidth: 64,
        frameHeight: 64,
      },
    },

    defaultFrame: 0,
    defaultAnim: 'audrey2:idle',
    depth: 3,
    scale: 1,
    origin: { x: 0.5, y: 0.65 },

    animations: [
      {
        key: 'audrey2:idle',
        sheet: 'idle',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'audrey2:walk',
        sheet: 'walk',
        frames: { start: 0, end: 7 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'audrey2:attack',
        sheet: 'attack',
        frames: { start: 0, end: 6 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'audrey2:hurt',
        sheet: 'hurt',
        frames: { start: 0, end: 4 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'audrey2:death',
        sheet: 'death',
        frames: { start: 0, end: 9 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'audrey2:idle',
      move: 'audrey2:walk',
      attack: 'audrey2:attack',
      hit: 'audrey2:hurt',
      death: 'audrey2:death',
    },

    body: {
      type: 'circle',
      radius: 12,
      offsetX: 20,
      offsetY: 34,
    },

    stats: {
      speed: 90,
      hp: 100,
      damage: 30,
      maxSpeed: 180,
    },

    rewards: { xp: 6 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 44,
      meleeDamage: 30,
      attackCooldownMs: 1000,
      windupMs: 140,
      lungeSpeed: 210,
    },
  },

  audrey3: {
    tier: 'elite',

    sheetKey: 'audrey3walk',
    sheets: {
      idle: {
        key: 'audrey3idle',
        path: '/assets/sprites/elites/plant3idle.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      walk: {
        key: 'audrey3walk',
        path: '/assets/sprites/elites/plant3walk.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      attack: {
        key: 'audrey3attack',
        path: '/assets/sprites/elites/plant3attack.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      hurt: {
        key: 'audrey3hurt',
        path: '/assets/sprites/elites/plant3hurt.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      death: {
        key: 'audrey3death',
        path: '/assets/sprites/elites/plant3death.png',
        frameWidth: 64,
        frameHeight: 64,
      },
    },

    defaultFrame: 0,
    defaultAnim: 'audrey3:idle',
    depth: 3,
    scale: 1,
    origin: { x: 0.5, y: 0.65 },

    animations: [
      {
        key: 'audrey3:idle',
        sheet: 'idle',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'audrey3:walk',
        sheet: 'walk',
        frames: { start: 0, end: 7 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'audrey3:attack',
        sheet: 'attack',
        frames: { start: 0, end: 6 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'audrey3:hurt',
        sheet: 'hurt',
        frames: { start: 0, end: 4 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'audrey3:death',
        sheet: 'death',
        frames: { start: 0, end: 9 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'audrey3:idle',
      move: 'audrey3:walk',
      attack: 'audrey3:attack',
      hit: 'audrey3:hurt',
      death: 'audrey3:death',
    },

    body: {
      type: 'circle',
      radius: 12,
      offsetX: 20,
      offsetY: 34,
    },

    stats: {
      speed: 88,
      hp: 100,
      damage: 32,
      maxSpeed: 176,
    },

    rewards: { xp: 6 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 44,
      meleeDamage: 32,
      attackCooldownMs: 950,
      windupMs: 140,
      lungeSpeed: 205,
    },
  },

  barnabas: {
    tier: 'elite',

    sheetKey: 'vampire2walk',
    sheets: {
      idle: {
        key: 'vampire2idle',
        path: '/assets/sprites/elites/vampire2idle.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      walk: {
        key: 'vampire2walk',
        path: '/assets/sprites/elites/vampire2walk.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      attack: {
        key: 'vampire2attack',
        path: '/assets/sprites/elites/vampire2attack.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      hurt: {
        key: 'vampire2hurt',
        path: '/assets/sprites/elites/vampire2hurt.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      death: {
        key: 'vampire2death',
        path: '/assets/sprites/elites/vampire2death.png',
        frameWidth: 64,
        frameHeight: 64,
      },
    },

    defaultFrame: 0,
    defaultAnim: 'barnabas:idle',
    depth: 3,
    scale: 1,
    origin: { x: 0.5, y: 0.65 },

    animations: [
      {
        key: 'barnabas:idle',
        sheet: 'idle',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'barnabas:walk',
        sheet: 'walk',
        frames: { start: 0, end: 5 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'barnabas:attack',
        sheet: 'attack',
        frames: { start: 0, end: 6 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'barnabas:hurt',
        sheet: 'hurt',
        frames: { start: 0, end: 3 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'barnabas:death',
        sheet: 'death',
        frames: { start: 0, end: 9 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'barnabas:idle',
      move: 'barnabas:walk',
      attack: 'barnabas:attack',
      hit: 'barnabas:hurt',
      death: 'barnabas:death',
    },

    body: {
      type: 'circle',
      radius: 12,
      offsetX: 20,
      offsetY: 34,
    },

    stats: {
      speed: 88,
      hp: 100,
      damage: 32,
      maxSpeed: 176,
    },

    rewards: { xp: 6 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 44,
      meleeDamage: 32,
      attackCooldownMs: 950,
      windupMs: 140,
      lungeSpeed: 205,
    },
  },

  orlok: {
    tier: 'elite',

    sheetKey: 'vampire3walk',
    sheets: {
      idle: {
        key: 'vampire3idle',
        path: '/assets/sprites/elites/vampire3idle.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      walk: {
        key: 'vampire3walk',
        path: '/assets/sprites/elites/vampire3walk.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      attack: {
        key: 'vampire3attack',
        path: '/assets/sprites/elites/vampire3attack.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      hurt: {
        key: 'vampire3hurt',
        path: '/assets/sprites/elites/vampire3hurt.png',
        frameWidth: 64,
        frameHeight: 64,
      },
      death: {
        key: 'vampire3death',
        path: '/assets/sprites/elites/vampire3death.png',
        frameWidth: 64,
        frameHeight: 64,
      },
    },

    defaultFrame: 0,
    defaultAnim: 'orlok:idle',
    depth: 3,
    scale: 1,
    origin: { x: 0.5, y: 0.65 },

    animations: [
      {
        key: 'orlok:idle',
        sheet: 'idle',
        frames: { start: 0, end: 3 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'orlok:walk',
        sheet: 'walk',
        frames: { start: 0, end: 5 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'orlok:attack',
        sheet: 'attack',
        frames: { start: 0, end: 6 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'orlok:hurt',
        sheet: 'hurt',
        frames: { start: 0, end: 3 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'orlok:death',
        sheet: 'death',
        frames: { start: 0, end: 9 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'orlok:idle',
      move: 'orlok:walk',
      attack: 'orlok:attack',
      hit: 'orlok:hurt',
      death: 'orlok:death',
    },

    body: {
      type: 'circle',
      radius: 12,
      offsetX: 20,
      offsetY: 34,
    },

    stats: {
      speed: 88,
      hp: 100,
      damage: 32,
      maxSpeed: 176,
    },

    rewards: { xp: 6 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 44,
      meleeDamage: 32,
      attackCooldownMs: 950,
      windupMs: 140,
      lungeSpeed: 205,
    },
  },

  demonknight_boss: {
    tier: 'boss',

    sheetKey: 'demonidle',
    sheets: {
      idle: {
        key: 'demonidle',
        path: '/assets/sprites/bosses/demonidle.png',
        frameWidth: 92,
        frameHeight: 107,
      },
      move: {
        key: 'demonwalk',
        path: '/assets/sprites/bosses/demonwalk.png',
        frameWidth: 85,
        frameHeight: 100,
      },
      attack: {
        key: 'demonattack',
        path: '/assets/sprites/bosses/demonattack.png',
        frameWidth: 198,
        frameHeight: 114,
      },
      hit: {
        key: 'demonhit',
        path: '/assets/sprites/bosses/demonhit.png',
        frameWidth: 109,
        frameHeight: 105,
      },
      death: {
        key: 'demondeath',
        path: '/assets/sprites/bosses/demondeath.png',
        frameWidth: 131,
        frameHeight: 124,
      }
    },

    defaultFrame: 0,
    defaultAnim: 'demonknight:idle',
    depth: 4,
    scale: 1,
    origin: { x: 0.5, y: 0.7 },

    animations: [
      {
        key: 'demonknight:idle',
        sheet: 'idle',
        frames: { start: 0, end: 5 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'demonknight:walk',
        sheet: 'move',
        frames: { start: 0, end: 11 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'demonknight:attack',
        sheet: 'attack',
        frames: { start: 0, end: 13 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'demonknight:hit',
        sheet: 'hit',
        frames: { start: 0, end: 4 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'demonknight:death',
        sheet: 'death',
        frames: { start: 0, end: 21 },
        frameRate: 12,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'demonknight:idle',
      move: 'demonknight:walk',
      attack: 'demonknight:attack',
      hit: 'demonknight:hit',
      death: 'demonknight:death',
    },

    body: {
      type: 'circle',
      radius: 16,
      offsetX: 83,
      offsetY: 86,
    },

    stats: {
      speed: 120,
      hp: 1000,
      damage: 50,
      maxSpeed: 240,
    },

    rewards: { xp: 18 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 50,
      meleeDamage: 50,
      attackCooldownMs: 1200,
      windupMs: 140,
      lungeSpeed: 260,
    },
  },

  bringerofdeath_boss: {
    tier: 'boss',

    sheetKey: 'bodidle',
    sheets: {
      idle: {
        key: 'bodidle',
        path: '/assets/sprites/bosses/bodidle.png',
        frameWidth: 47,
        frameHeight: 56,
      },
      move: {
        key: 'bodwalk',
        path: '/assets/sprites/bosses/bodwalk.png',
        frameWidth: 57,
        frameHeight: 55,
      },
      attack: {
        key: 'bodattack',
        path: '/assets/sprites/bosses/bodattack.png',
        frameWidth: 140,
        frameHeight: 85,
      },
      hit: {
        key: 'bodhurt',
        path: '/assets/sprites/bosses/bodhurt.png',
        frameWidth: 47,
        frameHeight: 55,
      },
      death: {
        key: 'boddeath',
        path: '/assets/sprites/bosses/boddeath.png',
        frameWidth: 54,
        frameHeight: 67,
      }
    },

    defaultFrame: 0,
    defaultAnim: 'bringerofdeath:idle',
    depth: 4,
    scale: 1,
    origin: { x: 0.5, y: 0.65 },

    animations: [
      {
        key: 'bringerofdeath:idle',
        sheet: 'idle',
        frames: { start: 0, end: 7 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'bringerofdeath:walk',
        sheet: 'move',
        frames: { start: 0, end: 7 },
        frameRate: 10,
        repeat: -1,
      },
      {
        key: 'bringerofdeath:attack',
        sheet: 'attack',
        frames: { start: 0, end: 9 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'bringerofdeath:hit',
        sheet: 'hit',
        frames: { start: 0, end: 2 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'bringerofdeath:death',
        sheet: 'death',
        frames: { start: 0, end: 9 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'bringerofdeath:idle',
      move: 'bringerofdeath:walk',
      attack: 'bringerofdeath:attack',
      hit: 'bringerofdeath:hit',
      death: 'bringerofdeath:death',
    },

    body: {
      type: 'circle',
      radius: 16,
      offsetX: 18,
      offsetY: 36,
    },

    stats: {
      speed: 150,
      hp: 500,
      damage: 50,
      maxSpeed: 240,
    },

    rewards: { xp: 14 },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 42,
      meleeDamage: 50,
      attackCooldownMs: 900,
      windupMs: 110,
      lungeSpeed: 250,
    },
  },

  evilwizard_boss: {
    tier: 'boss',

    sheetKey: 'evilwizardidle',
    sheets: {
      idle: {
        key: 'evilwizardidle',
        path: '/assets/sprites/bosses/evilwizardidle.png',
        frameWidth: 150,
        frameHeight: 150,
      },
      move: {
        key: 'evilwizardmove',
        path: '/assets/sprites/bosses/evilwizardmove.png',
        frameWidth: 150,
        frameHeight: 150,
      },
      attack: {
        key: 'evilwizardattack',
        path: '/assets/sprites/bosses/evilwizardattack.png',
        frameWidth: 150,
        frameHeight: 150,
      },
      hit: {
        key: 'evilwizardhit',
        path: '/assets/sprites/bosses/evilwizardhit.png',
        frameWidth: 150,
        frameHeight: 150,
      },
      death: {
        key: 'evilwizarddeath',
        path: '/assets/sprites/bosses/evilwizarddeath.png',
        frameWidth: 150,
        frameHeight: 100,
      }
    },

    defaultFrame: 0,
    defaultAnim: 'evilwizard:idle',
    scale: 1,
    origin: { x: 0.5, y: 0.5 },
    depth: 4,

    animations: [
      {
        key: 'evilwizard:idle',
        sheet: 'idle',
        sheetKey: 'evilwizardidle',
        frames: { start: 0, end: 7 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'evilwizard:move',
        sheet: 'move',
        sheetKey: 'evilwizardmove',
        frames: { start: 0, end: 7 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'evilwizard:attack',
        sheet: 'attack',
        sheetKey: 'evilwizardattack',
        frames: { start: 0, end: 7 },
        frameRate: 8,
        repeat: 0,
      },
      {
        key: 'evilwizard:hit',
        sheet: 'hit',
        sheetKey: 'evilwizardhit',
        frames: { start: 0, end: 3 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'evilwizard:death',
        sheet: 'death',
        sheetKey: 'evilwizarddeath',
        frames: { start: 0, end: 4 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'evilwizard:idle',
      move: 'evilwizard:move',
      attack: 'evilwizard:attack',
      hit: 'evilwizard:hit',
      death: 'evilwizard:death',
    },

    body: {
      type: 'circle',
      radius: 16,
      offsetX: 59,
      offsetY: 59,
    },

    stats: {
      speed: 180,
      hp: 200,
      damage: 50,
      maxSpeed: 220,
    },

    rewards: {
      xp: 12,
    },

    audio: {
      death: null
    },

    ai: 'circlePlayer',
    aiParams: {
      orbitRadius: 320,
      angularSpeed: 1.6,
      attackCooldownMs: 2500,
      initialAttackDelayMs: 500,
      attackRange: Infinity,
      projectileWeaponKey: 'fireblast',
      projectileOverrides: {
        speed: 200,          // slower enemy projectile than hero version
        lifetimeMs: 2200,    // travels longer before timing out
        aoe: {
          radius: 64,        // smaller blast when used by bosses
          damageMult: 0.7,
          // you can add your own "timing" flag if you want special rules
          timing: 'expiryOnly'
        }
      },
      salvo: 1,
      spreadDeg: 0,
    },
  },

  darkwizard_boss: {
    tier: 'boss',

    sheetKey: 'darkwizardidle',
    sheets: {
      idle: {
        key: 'darkwizardidle',
        path: '/assets/sprites/bosses/darkwizardidle.png',
        frameWidth: 140,
        frameHeight: 140,
      },
      move: {
        key: 'darkwizardwalk',
        path: '/assets/sprites/bosses/darkwizardwalk.png',
        frameWidth: 140,
        frameHeight: 140,
      },
      attack: {
        key: 'darkwizardattack',
        path: '/assets/sprites/bosses/darkwizardattack.png',
        frameWidth: 140,
        frameHeight: 140,
      },
      hit: {
        key: 'darkwizardhit',
        path: '/assets/sprites/bosses/darkwizardhit.png',
        frameWidth: 140,
        frameHeight: 140,
      },
      death: {
        key: 'darkwizarddeath',
        path: '/assets/sprites/bosses/darkwizarddeath.png',
        frameWidth: 140,
        frameHeight: 140,
      }
    },

    defaultFrame: 0,
    defaultAnim: 'darkwizard:idle',
    scale: 1,
    origin: { x: 0.5, y: 0.5 },
    depth: 4,

    animations: [
      {
        key: 'darkwizard:idle',
        sheet: 'idle',
        sheetKey: 'darkwizardidle',
        frames: { start: 0, end: 9 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'darkwizard:move',
        sheet: 'move',
        sheetKey: 'darkwizardwalk',
        frames: { start: 0, end: 7 },
        frameRate: 8,
        repeat: -1,
      },
      {
        key: 'darkwizard:attack',
        sheet: 'attack',
        sheetKey: 'darkwizardattack',
        frames: { start: 0, end: 12 },
        frameRate: 8,
        repeat: 0,
      },
      {
        key: 'darkwizard:hit',
        sheet: 'hit',
        sheetKey: 'darkwizardhit',
        frames: { start: 0, end: 2 },
        frameRate: 12,
        repeat: 0,
      },
      {
        key: 'darkwizard:death',
        sheet: 'death',
        sheetKey: 'darkwizarddeath',
        frames: { start: 0, end: 17 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'darkwizard:idle',
      move: 'darkwizard:move',
      attack: 'darkwizard:attack',
      hit: 'darkwizard:hit',
      death: 'darkwizard:death',
    },

    body: {
      type: 'circle',
      radius: 16,
      offsetX: 50,
      offsetY: 18,
    },

    stats: {
      speed: 80,
      hp: 200,
      damage: 50,
      maxSpeed: 220,
    },

    rewards: {
      xp: 12,
    },

    audio: {
      death: null
    },

    ai: 'seekAndFire',
    aiParams: {
      approachDurationMs: 1200,
      holdDistance: 180,
      resumeDistance: 128,
      attackCooldownMs: 2500,
      initialAttackDelayMs: 500,
      projectileWeaponKey: 'purplenado',
      projectileOverrides: {
        speed: 200,          // slower enemy projectile than hero version
        lifetimeMs: 2200,    // travels longer before timing out
        rotateToVelocity: false,
        aoe: {
          radius: 64,        // smaller blast when used by bosses
          damageMult: 0.7,
          // you can add your own "timing" flag if you want special rules
          timing: 'expiryOnly',
        }
      },
      attackRange: 520,
      salvo: 1,
      spreadDeg: 0
    },
  },

  werewolf_boss: {
    tier: 'boss',

    sheetKey: 'werewalk',
    sheets: {
      walk: {
        key: 'werewalk',
        path: '/assets/sprites/bosses/wolfiewalk.png',
        frameWidth: 240,
        frameHeight: 256,
      },
      attack: {
        key: 'wereattack',
        path: '/assets/sprites/bosses/wolfieattack.png',
        frameWidth: 240,
        frameHeight: 240,
      },
      death: {
        key: 'weredeath',
        path: '/assets/sprites/bosses/wolfiedeath.png',
        frameWidth: 240,
        frameHeight: 240,
      }
    },

    defaultFrame: 0,
    defaultAnim: 'werewolf:walk',
    depth: 4,
    scale: 1,
    origin: { x: 0.5, y: 0.85 },

    animations: [
      {
        key: 'werewolf:walk',
        sheet: 'walk',
        frames: { start: 0, end: 2 },
        frameRate: 3,
        repeat: -1,
      },
      {
        key: 'werewolf:attack',
        sheet: 'attack',
        frames: { start: 0, end: 2 },
        frameRate: 10,
        repeat: 0,
      },
      {
        key: 'werewolf:death',
        sheet: 'death',
        frames: { start: 0, end: 2 },
        frameRate: 10,
        repeat: 0,
      }
    ],

    animationKeys: {
      idle: 'werewolf:walk',
      move: 'werewolf:walk',
      attack: 'werewolf:attack',
      death: 'werewolf:death',
    },

    body: {
      type: 'circle',
      radius: 70,
      offsetX: 50,
      offsetY: 120,
    },

    stats: {
      speed: 220,
      hp: 9001,
      damage: 100,
      maxSpeed: 1000,
    },

    rewards: {
      xp: 15,
    },

    audio: {
      death: null
    },

    ai: 'seekAndMelee',
    aiParams: {
      meleeRange: 48,
      meleeDamage: 100,
      attackCooldownMs: 1400,
      windupMs: 120,
      lungeSpeed: 220,
      projectileWeaponKey: 'fireblast',
      projectileOverrides: {
        speed: 320,        // slower than 420
        lifetimeMs: 1200,  // longer than 500 so it travels farther overall
        // optional: smaller/larger hitbox, different aoe radius, etc.
        // aoe: { radius: 72, damageMult: 0.75, timing: 'expiryOnly' }
      },

      attackCooldownMs: 2500,
      initialAttackDelayMs: 600,
      attackRange: 700,
      salvo: 1,
      spreadDeg: 0,
    },
  }
};

/**
 * Legacy fallback table used by the *old* SpawnSystem (not SpawnDirector).
 * Still exported because some menus/debug utilities may reference it.
 */
export const DefaultMobSpawnTable = [
  { type: 'evileye', weight: 1 },
  { type: 'spookybat', weight: 1 }
];

/**
 * Weighted selection helper (used by the *old* SpawnSystem).
 * Modern SpawnDirector uses weightedPick in spawn/utils.js instead.
 */
export function pickMobKey(table = DefaultMobSpawnTable) {
  const totalWeight = table.reduce((sum, entry) => sum + (entry.weight ?? 0), 0);
  if (totalWeight <= 0) return 'evileye';

  const roll = Math.random() * totalWeight;
  let accum = 0;

  for (const entry of table) {
    accum += entry.weight ?? 0;
    if (roll <= accum) return entry.type;
  }

  return table.at(-1)?.type ?? 'evileye';
}

/**
 * Computes how much extra radius we must spawn outside camera to avoid pop-in.
 * Uses body hitbox size instead of sprite size for reliable occlusion.
 */
export function getBodySpawnBuffer(bodyConfig) {
  if (!bodyConfig) return 0;

  if (bodyConfig.type === 'circle') {
    return bodyConfig.radius ?? bodyConfig.r ?? 0;
  }

  if (bodyConfig.type === 'rect' || bodyConfig.type === 'rectangle') {
    const halfW = (bodyConfig.width ?? bodyConfig.w ?? 0) / 2;
    const halfH = (bodyConfig.height ?? bodyConfig.h ?? 0) / 2;
    return Math.max(halfW, halfH);
  }

  return 0;
}

/**
 * Applies the declared physics body to a pooled Enemy instance.
 * This allows mobs to swap spritesheets, scale, or body shapes without
 * requiring unique classes.
 */
export function applyBodyConfig(enemy, config) {
  const bodyConfig = config?.body;
  const body = enemy.body;
  if (!bodyConfig || !body) return;

  const allowGravity = body.allowGravity;
  body.setAllowGravity(false);

  if (bodyConfig.type === 'circle') {
    const radius = bodyConfig.radius ?? bodyConfig.r ?? 0;
    const offsetX = bodyConfig.offsetX ?? bodyConfig.offset?.x ?? bodyConfig.offset?.[0] ?? 0;
    const offsetY = bodyConfig.offsetY ?? bodyConfig.offset?.y ?? bodyConfig.offset?.[1] ?? 0;
    enemy.setCircle(radius, offsetX, offsetY);
  } else if (bodyConfig.type === 'rect' || bodyConfig.type === 'rectangle') {
    const width = bodyConfig.width ?? bodyConfig.w ?? enemy.width;
    const height = bodyConfig.height ?? bodyConfig.h ?? enemy.height;
    enemy.body.setSize(width, height);

    const offsetX = bodyConfig.offsetX ?? bodyConfig.offset?.x ?? bodyConfig.offset?.[0] ?? 0;
    const offsetY = bodyConfig.offsetY ?? bodyConfig.offset?.y ?? bodyConfig.offset?.[1] ?? 0;
    enemy.body.setOffset(offsetX, offsetY);
  }

  body.setAllowGravity(allowGravity ?? false);
}

/**
 * Safe registry lookup — falls back to evileye so invalid keys never crash.
 */
export function resolveMobConfig(mobKey) {
  return MobRegistry[mobKey] ?? MobRegistry.evileye;
}
