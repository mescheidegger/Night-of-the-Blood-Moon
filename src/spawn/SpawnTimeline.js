const mins = (m) => m * 60;

export const SpawnTimeline = [
  // 1: Early mixed fodder ring burst (evileye + littlescary)
  {
    id: 'evileye_littlescary_ring_mix_1min',
    at: mins(1),
    duration: 12,
    behavior: 'blend',
    once: true,
    spawns: [
      {
        spawner: 'ring',
        mobKey: 'evileye',
        entry: {
          spawnsPerTick: 10,
        },
      },
      {
        spawner: 'ring',
        mobKey: 'littlescary',
        entry: {
          spawnsPerTick: 6,
        },
      },
    ],
  },

  // 2: Cross-screen spookybat waves from multiple directions
  {
    id: 'spookybat_cross_waves_2min',
    at: mins(2),
    duration: 15,
    behavior: 'blend',
    once: true,
    spawns: [
      {
        spawner: 'batWave',
        mobKey: 'spookybat',
        entry: {
          spawnsPerTick: 2,
          wave: {
            groupSize: 4,
            groupsPerTick: 2,
            direction: ['L2R', 'R2L', 'T2B', 'B2T'],
            speed: 135,
            spacing: 26,
            ai: 'flySine',
          },
        },
      },
    ],
  },

  // 3: First elite showcase — cocodemon legions on the corners (suspends weighted once)
  {
    id: 'cocodemon_quad_legion_3min',
    at: mins(3),
    duration: 20,
    behavior: 'suspendWeighted',
    once: true,
    spawns: [
      {
        spawner: 'boneLegion',
        mobKey: 'cocodemon_elite',
        entry: {
          legion: {
            count: 80,
            radius: 180,
            moveSpeed: 105,
            angularSpeed: 0,
            shrinkPerSecond: 10,
            maxAngularRadPerSec: 6,
            radialStepFactor: 1.5,
            breakDistance: 140,
            centers: 'viewportCorners',
          },
        },
      },
    ],
  },

  // 4: Nightman elite quad walls from all sides (kept from original, pure elites)
  {
    id: 'nightman_quad_wall_4min',
    at: mins(4),
    duration: 20,
    behavior: 'blend',
    once: true,
    spawns: [
      {
        spawner: 'wallLine',
        mobKey: 'nightman_elite',
        entry: {
          wall: {
            spacing: 24,
            thickness: 2,
            rowSpacing: 16,
            offset: 40,
            speed: 75,
            ai: 'seekPlayer',
            sides: ['top', 'bottom', 'left', 'right'],
          },
        },
      },
    ],
  },

  // 5: Plant + vampire elite pincer rings
  {
    id: 'audrey_vlad_ring_squeeze_5min',
    at: mins(5),
    duration: 18,
    behavior: 'blend',
    once: true,
    spawns: [
      {
        spawner: 'ring',
        mobKey: 'audrey1',
        entry: {
          spawnsPerTick: 30,
        },
      },
      {
        spawner: 'ring',
        mobKey: 'vlad',
        entry: {
          spawnsPerTick: 30,
        },
      },
    ],
  },

  // 6: Crawlybones elite-style walls plus plant backline (all elites)
  {
    id: 'audrey_all_wall_lines_6min',
    at: mins(6),
    duration: 18,
    behavior: 'blend',
    once: true,
    spawns: [
      {
        spawner: 'wallLine',
        mobKey: 'audrey1',
        entry: {
          spawnsPerTick: 3,
          wall: {
            orientation: ['vertical', 'horizontal'],
            spacing: 16,
            thickness: 2,
            rowSpacing: 14,
            offset: 42,
            speed: 82,
            ai: 'seekPlayer',
            sides: ['top', 'bottom', 'left', 'right'],
          },
        },
      },
      {
        spawner: 'wallLine',
        mobKey: 'audrey2',
        entry: {
          spawnsPerTick: 3,
          wall: {
            orientation: ['vertical', 'horizontal'],
            spacing: 14,
            thickness: 2,
            rowSpacing: 12,
            offset: 42,
            speed: 86,
            ai: 'seekPlayer',
            sides: ['top', 'bottom', 'left', 'right'],
          },
        },
      },
      {
        spawner: 'wallLine',
        mobKey: 'audrey3',
        entry: {
          spawnsPerTick: 3,
          wall: {
            orientation: ['vertical', 'horizontal'],
            spacing: 14,
            thickness: 2,
            rowSpacing: 12,
            offset: 44,
            speed: 88,
            ai: 'seekPlayer',
            sides: ['top', 'bottom', 'left', 'right'],
          },
        },
      },
    ],
  },

  // 7: Quad-corner elite legions (plants / vamps mix)
  {
    id: 'elite_quad_legion_7min',
    at: mins(7),
    duration: 22,
    behavior: 'suspendWeighted',
    once: true,
    spawns: [
      {
        spawner: 'boneLegion',
        mobKey: 'audrey3',
        entry: {
          legion: {
            count: 120,
            radius: 220,
            moveSpeed: 110,
            angularSpeed: 0,
            shrinkPerSecond: 12,
            maxAngularRadPerSec: 6,
            radialStepFactor: 1.5,
            breakDistance: 140,
            centers: 'viewportCorners',
          },
        },
      },
      {
        spawner: 'boneLegion',
        mobKey: 'barnabas',
        entry: {
          legion: {
            count: 80,
            radius: 200,
            moveSpeed: 60,
            angularSpeed: 0,
            shrinkPerSecond: 10,
            maxAngularRadPerSec: 6,
            radialStepFactor: 1.5,
            breakDistance: 140,
            centers: 'viewportCorners',
          },
        },
      },
    ],
  },

  // 8: Elite storm — plants and vamps in alternating rings
  {
    id: 'elite_storm_rings_8min',
    at: mins(8),
    duration: 20,
    behavior: 'blend',
    once: true,
    spawns: [
      {
        spawner: 'ring',
        mobKey: 'orlok',
        entry: {
          spawnsPerTick: 50,
        },
      },
      {
        spawner: 'ring',
        mobKey: 'audrey2',
        entry: {
          spawnsPerTick: 50,
        },
      },
      {
        spawner: 'ring',
        mobKey: 'cocodemon_elite',
        entry: {
          spawnsPerTick: 50,
        },
      },
    ],
  },

  // 9: First boss spotlight — Evil Wizard arrives (boss only event)
  {
    id: 'evilwizard_wall_assault_9min',
    at: mins(9),
    duration: 15,
    behavior: 'blend',
    once: true,
    spawns: [
      {
        spawner: 'wallLine',
        mobKey: 'evilwizard_boss',
        entry: {
          spawnsPerTick: 6,
          wall: {
            orientation: ['vertical'],
            spacing: 26,
            thickness: 2,
            rowSpacing: 18,
            offset: 46,
            speed: 95,
            sides: ['left', 'right'],
          },
        },
      },
    ],
  },

  // 10: Twin caster bosses — Evil Wizard + Dark Wizard
  {
    id: 'wizard_legion_dual_10min',
    at: mins(10),
    duration: 18,
    behavior: 'suspendWeighted',
    once: true,
    spawns: [
      {
        spawner: 'boneLegion',
        mobKey: 'evilwizard_boss',
        entry: {
          legion: {
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
          },
        },
      },
      {
        spawner: 'boneLegion',
        mobKey: 'darkwizard_boss',
        entry: {
          legion: {
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
          },
        },
      },
      {
        spawner: 'boneLegion',
        mobKey: 'evilwizard_boss',
        entry: {
          legion: {
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
          },
        },
      },
      {
        spawner: 'boneLegion',
        mobKey: 'darkwizard_boss',
        entry: {
          legion: {
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
          },
        },
      },
    ],
  },

  // 11: Bringer of Death pressure phase
  {
    id: 'bringer_wall_crush_11min',
    at: mins(11),
    duration: 18,
    behavior: 'blend',
    once: true,
    spawns: [
      {
        spawner: 'wallLine',
        mobKey: 'bringerofdeath_boss',
        entry: {
          spawnsPerTick: 8,
          wall: {
            orientation: ['vertical', 'horizontal'],
            spacing: 22,
            thickness: 2,
            rowSpacing: 18,
            offset: 52,
            speed: 88,
            ai: 'seekPlayer',
            sides: ['top', 'bottom', 'left', 'right'],
          },
        },
      },
    ],
  },

  // 12: Demon Knight arena duel (boss only, suspends weighted this tick)
  {
    id: 'demonknight_ring_flood_12min',
    at: mins(12),
    duration: 20,
    behavior: 'suspendWeighted',
    once: true,
    spawns: [
      {
        spawner: 'ring',
        mobKey: 'demonknight_boss',
        entry: {
          spawnsPerTick: 80,
        },
      },
    ],
  },

  // 13: Werewolf enrages — plus a supporting caster
  {
    id: 'all_bosses_everywhere_13min',
    at: mins(13),
    duration: 22,
    behavior: 'suspendWeighted',
    once: true,
    spawns: [
      {
        spawner: 'ring',
        mobKey: 'evilwizard_boss',
        entry: {
          spawnsPerTick: 40,
        },
      },
      {
        spawner: 'wallLine',
        mobKey: 'darkwizard_boss',
        entry: {
          spawnsPerTick: 10,
          wall: {
            orientation: ['vertical', 'horizontal'],
            spacing: 24,
            thickness: 2,
            rowSpacing: 20,
            offset: 52,
            speed: 92,
            sides: ['top', 'bottom', 'left', 'right'],
          },
        },
      },
      {
        spawner: 'boneLegion',
        mobKey: 'bringerofdeath_boss',
        entry: {
          legion: {
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
          },
        },
      },
      {
        spawner: 'bossSpawn',
        mobKey: 'demonknight_boss',
        entry: {
          appearAt: mins(13),
          cooldownMs: 12000,
          spawn: {
            radius: 580,
          },
        },
      },
    ],
  },

  // 14: Final gauntlet — multi-boss onslaught, hardest event
  {
    id: 'final_boss_overload_14min',
    at: mins(14),
    duration: 25,
    behavior: 'suspendWeighted',
    once: true,
    spawns: [
      {
        spawner: 'ring',
        mobKey: 'bringerofdeath_boss',
        entry: {
          spawnsPerTick: 50,
        },
      },
      {
        spawner: 'wallLine',
        mobKey: 'demonknight_boss',
        entry: {
          spawnsPerTick: 12,
          wall: {
            orientation: ['vertical', 'horizontal'],
            spacing: 24,
            thickness: 3,
            rowSpacing: 22,
            offset: 58,
            speed: 96,
            ai: 'seekPlayer',
            sides: ['top', 'bottom', 'left', 'right'],
          },
        },
      },
      {
        spawner: 'boneLegion',
        mobKey: 'evilwizard_boss',
        entry: {
          legion: {
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
          },
        },
      },
      {
        spawner: 'bossSpawn',
        mobKey: 'darkwizard_boss',
        entry: {
          appearAt: mins(14),
          cooldownMs: 10000,
          spawn: {
            radius: 600,
          },
        },
      },
    ],
  },

  // 15: Lone werewolf curtain call
  {
    id: 'finale_control_15min',
    at: mins(15),
    duration: 0,
    once: true,
    control: {
      disableWeightedSpawns: true,
      cleanupMs: 15000,
      arena: { width: 1800, height: 1000 }
    }
  },
  {
    id: 'werewolf_finale_15min',
    at: mins(15.3),
    duration: 20,
    behavior: 'suspendWeighted',
    once: true,
    spawns: [
      {
        spawner: 'bossSpawn',
        mobKey: 'werewolf_boss',
        entry: {
          appearAt: mins(15),
          cooldownMs: 60000,
          spawn: {
            radius: 620,
          },
        },
      },
    ],
  },
];
