/**
 * Central, data-driven spawn configuration consumed by SpawnDirector.
 *
 * This module is **intentionally declarative** — no logic, only knobs.
 * Designers/tuning passes should happen here, not in code.
 *
 * Top-level controls:
 *   • `totalMax`      — Global ceiling for ALL active enemies across every type.
 *   • `delayMs`       — SpawnDirector tick frequency (lower = more frequent).
 *   • `spawnsPerTick` — Global spawn attempts per tick (can be Number | (t)=>Number).
 *   • `pace`          — OPTIONAL pacing mapping (design timeline -> runtime).
 *   • `byMob`         — Per-mob definitions keyed by `mobKey` (see MobRegistry).
 *
 * Each mob entry uses **modes** to describe how it spawns over time:
 *   • `max`                Hard limit on simultaneous active mobs of this type.
 *   • `modes`              Array of mode entries that fully describe spawn behavior.
 *
 * Each mode supports:
 *   • `key`           String identifier for tracking / debugging.
 *   • `from` / `to`   Time window in seconds (inclusive / exclusive).
 *                     If `to` is omitted, mode is treated as open-ended.
 *   • `spawner`       SpawnerRegistry key to use (`ring`, `batWave`, `wallLine`,
 *                     `boneLegion`, `bossSpawn`, etc.).
 *   • `weight`        Number | (t)=>Number — influences weighted selection
 *                     when multiple modes/mobs are eligible.
 *   • `spawnsPerTick` Number | (t)=>Number — burst size for **ring** and as a
 *                     multiplier for some custom spawners (e.g., `batWave`).
 *   • Custom config blocks (`wave`, `wall`, `legion`, `spawn`, ...) — interpreted
 *                     only by the corresponding custom spawner.
 *   • `cooldownMs`    Per-mode cooldown in ms between successful spawns.
 *   • `maxConcurrent` Max enemies alive for this mob *from this mode*.
 *
 * Time parameter `t` is the elapsed run time in **seconds**.
 *
 * ---------------------------------------------------------------------------
 * ✅ 10-minute pacing knob (clean version)
 * ---------------------------------------------------------------------------
 * This file is authored in "design time" (defaults to a 15-minute run = 900s).
 * SpawnDirector owns the runtime mapping and will evaluate ALL timing/curves in
 * design time by converting:
 *
 *   tDesign = tRun * (pace.designSeconds / pace.runSeconds) * pace.pressure
 *
 * Meaning:
 * - You DO NOT scale `from/to/appearAt` here.
 * - You keep writing curves as if the run were 15 minutes.
 * - You set `pace.runSeconds` to 600 for a 10-minute run, and everything ramps sooner.
 *
 * If you omit `pace`, SpawnDirector behaves exactly like before (tDesign === tRun).
 */
export const SpawnRegistry = {
  // ---------------------------------------------------------------------------
  // Global knobs
  // ---------------------------------------------------------------------------
  totalMax: 2000,
  delayMs: 450,

  /**
   * Pace mapping (design timeline → runtime).
   * SpawnDirector reads this block and applies the mapping centrally.
   *
   * - designSeconds: what THIS registry was tuned for
   * - runSeconds:    your actual run duration
   * - pressure:      extra difficulty knob (1.0 = pure compression)
   */
  pace: {
    designSeconds: 15 * 60, // 900
    runSeconds: 10 * 60, // 600
    pressure: 1.0,
  },

  /**
   * Global spawn attempts per tick.
   * Treated as a "tickrate multiplier" for enemy creation: a higher value means
   * more spawn rolls every `delayMs`.
   *
   * After the 3-minute mark, spawn pressure doubles every minute:
   *
   *  - 0–180s:  1x baseline
   *  - 180–240: 2x
   *  - 240–300: 4x
   *  - 300–360: 8x
   *  - 360–420: 16x
   *  - ...and so on, doubling each additional minute
   *
   * NOTE: SpawnDirector evaluates this in DESIGN TIME when pace is enabled.
   */
  spawnsPerTick: (t) => {
    if (t < 180) return 1; // onboarding, lighter density

    const minutesAfterThree = Math.floor((t - 180) / 60) + 1;
    return 2 ** minutesAfterThree;
  },

  // ---------------------------------------------------------------------------
  // Per-mob definitions
  // ---------------------------------------------------------------------------
  byMob: {
    // -------------------------------------------------------------------------
    // FODDER MOBS — phase out completely after ~12 minutes (t >= 720)
    // -------------------------------------------------------------------------
    evileye: {
      max: 500,
      modes: [
        {
          key: 'baselineHorde',
          from: 0,
          spawner: 'ring',
          weight: (t) => {
            if (t < 60) return 1.0; // gentle start
            if (t < 180) return 1.4; // early ramp
            if (t < 360) return 2.0; // solid mid horde
            if (t < 480) return 2.4; // peak fodder density
            return 0; // phased out once elites take over
          },
          spawnsPerTick: (t) => {
            if (t < 60) return 3;
            if (t < 180) return 6;
            if (t < 360) return 9;
            if (t < 480) return 12;
            return 0; // no new evileyes once elites fully take over
          },
          cooldownMs: 900,
          maxConcurrent: 500,
        },
      ],
    },

    littlescary: {
      max: 420,
      modes: [
        {
          key: 'midSwarm',
          from: 90,
          to: 300,
          spawner: 'ring',
          weight: (t) => {
            if (t < 120) return 0.8;
            if (t < 210) return 1.4;
            return 2.0;
          },
          spawnsPerTick: (t) => {
            if (t < 150) return 2;
            return 3;
          },
          cooldownMs: 1200,
          maxConcurrent: 180,
        },
        {
          key: 'lateSwarm',
          from: 300,
          spawner: 'ring',
          weight: (t) => {
            if (t < 480) return 2.4;
            return 0; // fully phased out once elites take over
          },
          spawnsPerTick: (t) => {
            if (t < 480) return 4;
            return 0;
          },
          cooldownMs: 900,
          maxConcurrent: 320,
        },
      ],
    },

    spookybat: {
      max: 200,
      modes: [
        {
          key: 'earlySweep',
          from: 45,
          to: 210,
          spawner: 'batWave',
          weight: (t) => {
            if (t < 120) return (t - 45) / 90; // ramp from ~0 to ~0.8
            return 1.2;
          },
          spawnsPerTick: (t) => (t < 150 ? 1 : 2),
          cooldownMs: 6000,
          maxConcurrent: 2,
          wave: {
            groupSize: (t) => (t < 150 ? 3 : 4),
            groupsPerTick: 1,
            direction: (t) => (t < 150 ? ['L2R', 'R2L'] : ['L2R', 'R2L', 'T2B']),
            speed: (t) => (t < 150 ? 110 : 135),
            spacing: () => 28,
            ai: (t) => (t >= 180 ? 'flySine' : 'flyStraight'),
          },
        },
        {
          key: 'midWaves',
          from: 210,
          to: 480,
          spawner: 'batWave',
          weight: (t) => {
            if (t < 330) return 1.6;
            if (t < 420) return 2.2;
            return 2.8;
          },
          spawnsPerTick: (t) => (t < 360 ? 2 : 3),
          cooldownMs: 900,
          maxConcurrent: 3,
          wave: {
            groupSize: (t) => {
              if (t < 330) return 4;
              if (t < 480) return 5;
              return 6;
            },
            groupsPerTick: (t) => (t < 420 ? 2 : 3),
            direction: ['L2R', 'R2L', 'T2B', 'B2T'],
            speed: (t) => (t < 420 ? 160 : 185),
            spacing: 26,
            ai: 'flySine',
          },
        },
      ],
    },

    crawlybones: {
      max: 240,
      modes: [
        {
          key: 'earlyDrip',
          from: 0,
          to: 210,
          spawner: 'ring',
          weight: (t) => {
            if (t < 60) return 0.5;
            if (t < 150) return 0.9;
            return 1.2;
          },
          spawnsPerTick: (t) => (t < 120 ? 1 : 2),
          cooldownMs: 1200,
          maxConcurrent: 80,
        },
        {
          key: 'midWall',
          from: 210,
          to: 480,
          spawner: 'wallLine',
          weight: (t) => {
            if (t < 330) return 1.4;
            if (t < 480) return 1.9;
            return 0;
          },
          wall: {
            orientation: ['vertical', 'horizontal'],
            spacing: (t) => (t < 360 ? 12 : 10),
            thickness: (t) => (t < 420 ? 2 : 3),
            rowSpacing: 10,
            offset: 32,
            speed: (t) => (t < 480 ? 70 : 88),
            cooldownMs: 1200,
            ai: 'seekPlayer',
          },
          cooldownMs: 1200,
          maxConcurrent: 140,
        },
      ],
    },

    // -------------------------------------------------------------------------
    // ELITES — start as spice, become the main dish late game
    // -------------------------------------------------------------------------
    cocodemon_elite: {
      max: 320,
      modes: [
        {
          key: 'eliteDrip',
          from: 120,
          to: 360,
          spawner: 'ring',
          weight: (t) => {
            if (t < 180) return 0.5;
            if (t < 300) return 1.0;
            return 1.6;
          },
          spawnsPerTick: 1,
          cooldownMs: 900,
          maxConcurrent: 6,
        },
        {
          key: 'eliteSurgeWall',
          from: 360,
          spawner: 'wallLine',
          weight: (t) => {
            if (t < 540) return 1.8; // midgame chunky checks
            if (t < 720) return 2.6; // big walls as fodder fades
            return 3.4; // late game: coco walls hurt
          },
          spawnsPerTick: (t) => (t < 540 ? 1 : 2),
          wall: {
            orientation: ['horizontal', 'vertical'],
            spacing: 26,
            thickness: (t) => (t < 540 ? 1 : 2),
            rowSpacing: 18,
            offset: 40,
            speed: (t) => (t < 540 ? 55 : 70),
            cooldownMs: 900,
            ai: 'seekPlayer',
          },
          cooldownMs: 900,
          maxConcurrent: 14,
        },
      ],
    },

    nightman_elite: {
      max: 320,
      modes: [
        {
          key: 'stalkerRing',
          from: 120,
          to: 480,
          spawner: 'ring',
          weight: (t) => {
            if (t < 180) return 0.7;
            if (t < 360) return 1.3;
            return 1.8;
          },
          spawnsPerTick: (t) => (t < 360 ? 1 : 2),
          cooldownMs: 900,
          maxConcurrent: 10,
        },
        {
          key: 'lateStalkerBurst',
          from: 480,
          spawner: 'ring',
          weight: (t) => {
            if (t < 720) return 2.6; // strong late-game presence
            return 3.4; // extremely common in the final minutes
          },
          spawnsPerTick: (t) => (t < 720 ? 3 : 4),
          cooldownMs: 900,
          maxConcurrent: 18,
        },
      ],
    },

    // Plants + vamps become the core elite horde by the end.
    audrey1: {
      max: 320,
      modes: [
        {
          key: 'elitePlant1',
          from: 150,
          spawner: 'ring',
          weight: (t) => {
            if (t < 300) return 0.5;
            if (t < 480) return 1.4;
            if (t < 720) return 2.2;
            return 3.0; // heavy late-game presence
          },
          spawnsPerTick: (t) => {
            if (t < 480) return 1;
            if (t < 720) return 3;
            return 4;
          },
          cooldownMs: 900,
          maxConcurrent: 10,
        },
      ],
    },

    audrey2: {
      max: 320,
      modes: [
        {
          key: 'elitePlant2',
          from: 180,
          spawner: 'ring',
          weight: (t) => {
            if (t < 360) return 0.6;
            if (t < 540) return 1.6;
            if (t < 720) return 2.4;
            return 3.2;
          },
          spawnsPerTick: (t) => {
            if (t < 540) return 1;
            if (t < 720) return 3;
            return 4;
          },
          cooldownMs: 900,
          maxConcurrent: 10,
        },
      ],
    },

    audrey3: {
      max: 320,
      modes: [
        {
          key: 'elitePlant3',
          from: 210,
          spawner: 'ring',
          weight: (t) => {
            if (t < 420) return 0.7;
            if (t < 600) return 1.8;
            if (t < 720) return 2.6;
            return 3.4;
          },
          spawnsPerTick: (t) => {
            if (t < 600) return 1;
            if (t < 720) return 3;
            return 4;
          },
          cooldownMs: 900,
          maxConcurrent: 12,
        },
      ],
    },

    vlad: {
      max: 320,
      modes: [
        {
          key: 'eliteVlad',
          from: 210,
          spawner: 'ring',
          weight: (t) => {
            if (t < 420) return 0.7;
            if (t < 600) return 1.7;
            if (t < 720) return 2.5;
            return 3.3;
          },
          spawnsPerTick: (t) => {
            if (t < 600) return 1;
            if (t < 720) return 3;
            return 4;
          },
          cooldownMs: 900,
          maxConcurrent: 12,
        },
      ],
    },

    barnabas: {
      max: 320,
      modes: [
        {
          key: 'eliteBarnabas',
          from: 240,
          spawner: 'ring',
          weight: (t) => {
            if (t < 480) return 0.8;
            if (t < 660) return 1.8;
            if (t < 720) return 2.6;
            return 3.4;
          },
          spawnsPerTick: (t) => {
            if (t < 660) return 1;
            if (t < 720) return 3;
            return 4;
          },
          cooldownMs: 900,
          maxConcurrent: 12,
        },
      ],
    },

    orlok: {
      max: 320,
      modes: [
        {
          key: 'eliteOrlok',
          from: 270,
          spawner: 'ring',
          weight: (t) => {
            if (t < 540) return 0.9;
            if (t < 720) return 2.2;
            return 3.2; // one of the nastiest late-game chasers
          },
          spawnsPerTick: (t) => {
            if (t < 720) return 3;
            return 4;
          },
          cooldownMs: 900,
          maxConcurrent: 14,
        },
      ],
    },

    // -------------------------------------------------------------------------
    // BOSSES — still mostly driven by timeline, but weights skew late
    // -------------------------------------------------------------------------
    evilwizard_boss: {
      max: (t) => (t < 480 ? 1 : 320),
      modes: [
        {
          key: 'wizardBoss',
          from: 120,
          spawner: 'bossSpawn',
          weight: (t) => {
            if (t < 120) return 0;
            if (t < 300) return 0.6; // first sightings
            if (t < 480) return 1.2; // shows up more often
            if (t < 720) return 1.6; // stable presence mid-run
            return 2.4; // a bit more likely in late chaos
          },
          appearAt: 120,
          spawn: {
            radius: 520,
          },
          spawnsPerTick: (t) => {
            if (t < 720) return 1;
            if (t < 900) return 2;
            return 3;
          },
          cooldownMs: 20000,
        },
      ],
    },

    darkwizard_boss: {
      max: (t) => (t < 480 ? 1 : 320),
      modes: [
        {
          key: 'darkWizardBoss',
          from: 90,
          spawner: 'bossSpawn',
          weight: (t) => {
            if (t < 90) return 0;
            if (t < 300) return 0.6;
            if (t < 480) return 1.2;
            if (t < 720) return 1.6;
            return 2.4;
          },
          appearAt: 90,
          spawn: {
            radius: 520,
          },
          spawnsPerTick: (t) => {
            if (t < 720) return 1;
            if (t < 900) return 2;
            return 3;
          },
          cooldownMs: 20000,
        },
      ],
    },

    bringerofdeath_boss: {
      max: (t) => (t < 480 ? 1 : 320),
      modes: [
        {
          key: 'bringerBoss',
          from: 480,
          spawner: 'bossSpawn',
          weight: (t) => {
            if (t < 480) return 0;
            if (t < 600) return 1.2;
            if (t < 720) return 1.8;
            if (t < 900) return 2.4;
            return 3.0; // hangs around heavily in late phase
          },
          appearAt: 480,
          spawn: {
            radius: 520,
          },
          spawnsPerTick: (t) => {
            if (t < 720) return 1;
            if (t < 900) return 2;
            return 3;
          },
          cooldownMs: 900,
        },
      ],
    },

    demonknight_boss: {
      max: (t) => (t < 480 ? 1 : 320),
      modes: [
        {
          key: 'demonKnightBoss',
          from: 720,
          spawner: 'bossSpawn',
          weight: (t) => {
            if (t < 720) return 0;
            if (t < 840) return 2.2;
            return 3.2; // very common in the final minutes
          },
          appearAt: 720,
          spawn: {
            radius: 520,
          },
          spawnsPerTick: (t) => (t < 900 ? 2 : 3),
          cooldownMs: 900,
        },
      ],
    },

    werewolf_boss: {
      max: 1,
      modes: [
        {
          key: 'werewolfBoss',
          from: 900,
          spawner: 'bossSpawn',
          weight: () => 0,
          appearAt: 900,
          spawn: {
            radius: 520,
          },
          cooldownMs: 45000,
        },
      ],
    },
  },
};
