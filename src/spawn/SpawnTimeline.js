const mins = (m) => m * 60;

// ---------------------------
// Timeline pacing knob
// ---------------------------
// Original timeline was authored for a 15:00 run (events at 1..15 minutes).
// Set TARGET_RUN_MINUTES to re-pace the whole schedule proportionally.
export const ORIGINAL_RUN_MINUTES = 15;
export const TARGET_RUN_MINUTES = 10;

// Multiply any "original minute mark" by this to get the repaced minute mark.
// Example: 9min event in original becomes 9 * (10/15) = 6min in a 10min run.
export const PACE_FACTOR = TARGET_RUN_MINUTES / ORIGINAL_RUN_MINUTES;

const paceMin = (originalMinuteMark) => originalMinuteMark * PACE_FACTOR;

// ---------------------------
// Spawn entry helpers
// ---------------------------
const ring = (mobKey, spawnsPerTick, entry = {}) => ({
  spawner: 'ring',
  mobKey,
  entry: { spawnsPerTick, ...entry },
});

const batWave = (mobKey, spawnsPerTick, wave) => ({
  spawner: 'batWave',
  mobKey,
  entry: { spawnsPerTick, wave },
});

const wallLine = (mobKey, spawnsPerTick, wall) => ({
  spawner: 'wallLine',
  mobKey,
  entry: { spawnsPerTick, wall },
});

const boneLegion = (mobKey, legion) => ({
  spawner: 'boneLegion',
  mobKey,
  entry: { legion },
});

const bossSpawn = (mobKey, entry) => ({
  spawner: 'bossSpawn',
  mobKey,
  entry,
});

// ---------------------------
// Shared config builders
// ---------------------------
const wallConfig = ({
  orientation,
  spacing,
  thickness,
  rowSpacing,
  offset,
  speed,
  ai,
  sides,
}) => ({
  orientation,
  spacing,
  thickness,
  rowSpacing,
  offset,
  speed,
  ...(ai ? { ai } : {}),
  sides,
});

const legionConfig = ({
  count,
  radius,
  moveSpeed,
  angularSpeed = 0,
  shrinkPerSecond,
  maxAngularRadPerSec = 6,
  radialStepFactor = 1.5,
  breakDistance = 140,
  cooldownMs,
  centers,
  ai,
}) => ({
  count,
  radius,
  moveSpeed,
  angularSpeed,
  shrinkPerSecond,
  maxAngularRadPerSec,
  radialStepFactor,
  breakDistance,
  ...(cooldownMs !== undefined ? { cooldownMs } : {}),
  ...(centers ? { centers } : {}),
  ...(ai ? { ai } : {}),
});

const timelineEvent = ({
  id,
  atMin,
  duration,
  behavior,
  once = true,
  spawns,
  control,
}) => ({
  id,
  at: mins(atMin),
  duration,
  ...(behavior ? { behavior } : {}),
  once,
  ...(spawns ? { spawns } : {}),
  ...(control ? { control } : {}),
});

// ---------------------------
// Spawn timeline
//
// Re-paced so the final werewolf boss event kicks off at TARGET_RUN_MINUTES.
// All "original minute marks" (1..14) are converted via paceMin().
// Any bossSpawn "appearAt" values are aligned to the repaced event time.
// ---------------------------
export const SpawnTimeline = [
  // 1: Early mixed fodder ring burst (evileye + littlescary)
  timelineEvent({
    id: 'evileye_littlescary_ring_mix_1min',
    atMin: paceMin(1),
    duration: 12,
    behavior: 'blend',
    spawns: [ring('evileye', 10), ring('littlescary', 6)],
  }),

  // 2: Cross-screen spookybat waves from multiple directions
  timelineEvent({
    id: 'spookybat_cross_waves_2min',
    atMin: paceMin(2),
    duration: 15,
    behavior: 'blend',
    spawns: [
      batWave('spookybat', 2, {
        groupSize: 4,
        groupsPerTick: 2,
        direction: ['L2R', 'R2L', 'T2B', 'B2T'],
        speed: 135,
        spacing: 26,
        ai: 'flySine',
      }),
    ],
  }),

  // 3: First elite showcase — cocodemon legions on the corners (suspends weighted once)
  timelineEvent({
    id: 'cocodemon_quad_legion_3min',
    atMin: paceMin(3),
    duration: 20,
    behavior: 'suspendWeighted',
    spawns: [
      boneLegion(
        'cocodemon_elite',
        legionConfig({
          count: 80,
          radius: 180,
          moveSpeed: 100,
          angularSpeed: 0,
          shrinkPerSecond: 10,
          maxAngularRadPerSec: 6,
          radialStepFactor: 1.5,
          breakDistance: 140,
          centers: 'viewportCorners',
        })
      ),
    ],
  }),

  // 4: Nightman elite quad walls from all sides (kept from original, pure elites)
  timelineEvent({
    id: 'nightman_quad_wall_4min',
    atMin: paceMin(4),
    duration: 20,
    behavior: 'blend',
    spawns: [
      wallLine(
        'nightman_elite',
        undefined,
        wallConfig({
          spacing: 24,
          thickness: 2,
          rowSpacing: 16,
          offset: 40,
          speed: 75,
          ai: 'seekPlayer',
          sides: ['top', 'bottom', 'left', 'right'],
        })
      ),
    ].map((s) => ({ ...s, entry: { wall: s.entry.wall } })),
  }),

  // 5: Plant + vampire elite pincer rings
  timelineEvent({
    id: 'audrey_vlad_ring_squeeze_5min',
    atMin: paceMin(5),
    duration: 18,
    behavior: 'blend',
    spawns: [ring('audrey1', 30), ring('vlad', 30)],
  }),

  // 6: Crawlybones elite-style walls plus plant backline (all elites)
  timelineEvent({
    id: 'audrey_all_wall_lines_6min',
    atMin: paceMin(6),
    duration: 18,
    behavior: 'blend',
    spawns: [
      wallLine(
        'audrey1',
        3,
        wallConfig({
          orientation: ['vertical', 'horizontal'],
          spacing: 16,
          thickness: 2,
          rowSpacing: 14,
          offset: 42,
          speed: 82,
          ai: 'seekPlayer',
          sides: ['top', 'bottom', 'left', 'right'],
        })
      ),
      wallLine(
        'audrey2',
        3,
        wallConfig({
          orientation: ['vertical', 'horizontal'],
          spacing: 14,
          thickness: 2,
          rowSpacing: 12,
          offset: 42,
          speed: 86,
          ai: 'seekPlayer',
          sides: ['top', 'bottom', 'left', 'right'],
        })
      ),
      wallLine(
        'audrey3',
        3,
        wallConfig({
          orientation: ['vertical', 'horizontal'],
          spacing: 14,
          thickness: 2,
          rowSpacing: 12,
          offset: 44,
          speed: 88,
          ai: 'seekPlayer',
          sides: ['top', 'bottom', 'left', 'right'],
        })
      ),
    ],
  }),

  // 7: Quad-corner elite legions (plants / vamps mix)
  timelineEvent({
    id: 'elite_quad_legion_7min',
    atMin: paceMin(7),
    duration: 22,
    behavior: 'suspendWeighted',
    spawns: [
      boneLegion(
        'audrey3',
        legionConfig({
          count: 120,
          radius: 220,
          moveSpeed: 110,
          angularSpeed: 0,
          shrinkPerSecond: 12,
          maxAngularRadPerSec: 6,
          radialStepFactor: 1.5,
          breakDistance: 140,
          centers: 'viewportCorners',
        })
      ),
      boneLegion(
        'barnabas',
        legionConfig({
          count: 80,
          radius: 200,
          moveSpeed: 110,
          angularSpeed: 0,
          shrinkPerSecond: 10,
          maxAngularRadPerSec: 6,
          radialStepFactor: 1.5,
          breakDistance: 140,
          centers: 'viewportCorners',
        })
      ),
    ],
  }),

  // 8: Elite storm — plants and vamps in alternating rings
  timelineEvent({
    id: 'elite_storm_rings_8min',
    atMin: paceMin(8),
    duration: 20,
    behavior: 'blend',
    spawns: [ring('orlok', 50), ring('audrey2', 50), ring('cocodemon_elite', 50)],
  }),

  // 9: First boss spotlight — Evil Wizard arrives (boss only event)
  timelineEvent({
    id: 'evilwizard_wall_assault_9min',
    atMin: paceMin(9),
    duration: 15,
    behavior: 'blend',
    spawns: [
      wallLine(
        'evilwizard_boss',
        6,
        wallConfig({
          orientation: ['vertical'],
          spacing: 26,
          thickness: 2,
          rowSpacing: 18,
          offset: 46,
          speed: 95,
          sides: ['left', 'right'],
        })
      ),
    ],
  }),

  // 10: Twin caster bosses — Evil Wizard + Dark Wizard
  timelineEvent({
    id: 'wizard_legion_dual_10min',
    atMin: paceMin(10),
    duration: 18,
    behavior: 'suspendWeighted',
    spawns: [
      boneLegion(
        'evilwizard_boss',
        legionConfig({
          count: 120,
          radius: 260,
          moveSpeed: 115,
          angularSpeed: 0.42,
          shrinkPerSecond: 14,
          maxAngularRadPerSec: 6,
          radialStepFactor: 1.5,
          breakDistance: 140,
          cooldownMs: 0,
          ai: 'circlePlayer',
        })
      ),
      boneLegion(
        'darkwizard_boss',
        legionConfig({
          count: 110,
          radius: 250,
          moveSpeed: 115,
          angularSpeed: 0.38,
          shrinkPerSecond: 12,
          maxAngularRadPerSec: 6,
          radialStepFactor: 1.5,
          breakDistance: 140,
          cooldownMs: 0,
          ai: 'circlePlayer',
        })
      ),
      boneLegion(
        'evilwizard_boss',
        legionConfig({
          count: 120,
          radius: 260,
          moveSpeed: 115,
          angularSpeed: 0.48,
          shrinkPerSecond: 16,
          maxAngularRadPerSec: 6,
          radialStepFactor: 1.5,
          breakDistance: 140,
          cooldownMs: 0,
          ai: 'circlePlayer',
        })
      ),
      boneLegion(
        'darkwizard_boss',
        legionConfig({
          count: 110,
          radius: 250,
          moveSpeed: 115,
          angularSpeed: 0.44,
          shrinkPerSecond: 14,
          maxAngularRadPerSec: 6,
          radialStepFactor: 1.5,
          breakDistance: 140,
          cooldownMs: 0,
          ai: 'circlePlayer',
        })
      ),
    ],
  }),

  // 11: Bringer of Death pressure phase
  timelineEvent({
    id: 'bringer_wall_crush_11min',
    atMin: paceMin(11),
    duration: 18,
    behavior: 'blend',
    spawns: [
      wallLine(
        'bringerofdeath_boss',
        8,
        wallConfig({
          orientation: ['vertical', 'horizontal'],
          spacing: 22,
          thickness: 2,
          rowSpacing: 18,
          offset: 52,
          speed: 88,
          ai: 'seekPlayer',
          sides: ['top', 'bottom', 'left', 'right'],
        })
      ),
    ],
  }),

  // 12: Demon Knight arena duel (boss only, suspends weighted this tick)
  timelineEvent({
    id: 'demonknight_ring_flood_12min',
    atMin: paceMin(12),
    duration: 20,
    behavior: 'suspendWeighted',
    spawns: [ring('demonknight_boss', 80)],
  }),

  // 13: Boss chaos — repaced
  timelineEvent({
    id: 'all_bosses_everywhere_13min',
    atMin: paceMin(13),
    duration: 22,
    behavior: 'suspendWeighted',
    spawns: [
      ring('evilwizard_boss', 40),
      wallLine(
        'darkwizard_boss',
        10,
        wallConfig({
          orientation: ['vertical', 'horizontal'],
          spacing: 24,
          thickness: 2,
          rowSpacing: 20,
          offset: 52,
          speed: 92,
          sides: ['top', 'bottom', 'left', 'right'],
        })
      ),
      boneLegion(
        'bringerofdeath_boss',
        legionConfig({
          count: 150,
          radius: 320,
          moveSpeed: 115,
          angularSpeed: 0,
          shrinkPerSecond: 18,
          maxAngularRadPerSec: 6,
          radialStepFactor: 1.5,
          breakDistance: 140,
          cooldownMs: 0,
          centers: 'viewportCorners',
        })
      ),
      bossSpawn('demonknight_boss', {
        // align with this event's start (originally mins(13))
        appearAt: mins(paceMin(13)),
        cooldownMs: 12000,
        spawn: { radius: 580 },
      }),
    ],
  }),

  // 14: Final gauntlet — repaced
  timelineEvent({
    id: 'final_boss_overload_14min',
    atMin: paceMin(14),
    duration: 25,
    behavior: 'suspendWeighted',
    spawns: [
      ring('bringerofdeath_boss', 50),
      wallLine(
        'demonknight_boss',
        12,
        wallConfig({
          orientation: ['vertical', 'horizontal'],
          spacing: 24,
          thickness: 3,
          rowSpacing: 22,
          offset: 58,
          speed: 96,
          ai: 'seekPlayer',
          sides: ['top', 'bottom', 'left', 'right'],
        })
      ),
      boneLegion(
        'evilwizard_boss',
        legionConfig({
          count: 160,
          radius: 320,
          moveSpeed: 115,
          angularSpeed: 0,
          shrinkPerSecond: 18,
          maxAngularRadPerSec: 6,
          radialStepFactor: 1.5,
          breakDistance: 140,
          cooldownMs: 0,
          centers: 'viewportCorners',
          ai: 'circlePlayer',
        })
      ),
      bossSpawn('darkwizard_boss', {
        // align with this event's start (originally mins(14))
        appearAt: mins(paceMin(14)),
        cooldownMs: 10000,
        spawn: { radius: 600 },
      }),
    ],
  }),

  // 15: Werewolf finale (control-only). Encounter module will handle lead-in + spawn.
  timelineEvent({
    id: 'werewolf_finale_control',
    atMin: TARGET_RUN_MINUTES,
    duration: 25,
    control: {
      encounter: 'werewolf',
      phase: 'start',

      // telegraph lead-in
      leadInMs: 10000,
      telegraphSfx: { key: 'sfx.boss.howl', bus: 'sfx', volume: 5.5, maxSimultaneous: 1, minIntervalMs: 2000 },

      //Boss death
      winSfx: 'sfx.boss.death', 
      leadOutMs: 5000, 

      // your existing finale controls
      disableWeightedSpawns: true,
      cleanupMs: 10000,
      arena: { width: 1800, height: 1000 },
    },
  }),
];