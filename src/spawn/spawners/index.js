import { batWave } from './batWave.js';
import { bossSpawn } from './bossSpawn.js';
import { ring } from './ring.js';
import { boneLegion } from './boneLegion.js';
import { wallLine } from './wallLine.js';
import { areaFill } from './areaFill.js';

// Re-export individual spawner functions for direct imports.
export { ring, batWave, bossSpawn, wallLine, boneLegion, areaFill };

/**
 * SpawnerRegistry
 *
 * Central lookup table for all supported mob spawning styles.
 * Keys in this object map to string values used in SpawnRegistry.mobEntry.customSpawner.
 *
 * Example:
 *   customSpawner: 'batWave'  →  use SpawnerRegistry.batWave()
 *   (default)                 →  use SpawnerRegistry.ring()
 *
 * Adding a new spawner pattern is as simple as:
 *   1) Writing a new function (e.g., swarmLine, bossDropIn)
 *   2) Exporting it here.
 */
export const SpawnerRegistry = {
  ring,
  batWave,
  bossSpawn,
  boneLegion,
  wallLine,
  areaFill,
};
