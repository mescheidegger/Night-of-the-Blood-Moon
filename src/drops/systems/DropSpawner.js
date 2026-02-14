import { DEFAULT_DROP_TYPE } from '../DropRegistry.js';
import { weightedPick } from '../utils/WeightedTable.js';

/**
 * DropSpawner
 *
 * Uses a drop table to spawn loot for a mob. This version prioritizes
 * weighted selection per roll by default. Tables can opt into sequential
 * mode for scripted drop order when needed.
 */
export class DropSpawner {
  /**
   * @param {Phaser.Scene} scene
   * @param {DropManager} dropManager - Responsible for pooled spawn.
   * @param {Record<string, { rolls: number, selectionMode?: 'weighted' | 'sequential', entries: Array<object> }>} tables
   */
  constructor(scene, dropManager, tables) {
    this.scene = scene;
    this.dropManager = dropManager;
    this.tables = tables;

    // Optional: let callers inject a seeded RNG for deterministic tests
    // this.rng = Math.random;
  }

  /**
   * Spawns drop(s) for a given mob.
   *
   * Resolution per roll:
   *  1) Try weightedPick(entries)  ← ensures weights are actually used
   *  2) Fallback to entries[i]     ← supports fixed/sequential scripting if desired
   *  3) Fallback to entries[0]     ← last resort
   */
  spawnFromTable(mobKey, x, y, overrides = {}) {
    const table = this.tables?.[mobKey] ?? this.tables?.default;
    const rolls = Number(table?.rolls ?? 1) | 0;
    const entries = table?.entries ?? [];
    if (!entries.length || rolls <= 0) return;

    const selectionMode = table?.selectionMode ?? 'weighted';

    for (let i = 0; i < rolls; i++) {
      let entry = null;

      if (selectionMode === 'sequential') {
        entry = entries[i] || entries[0] || null;
      } else {
        // Weighted mode: if all weights are <= 0, skip this roll.
        entry = weightedPick(entries /*, this.rng */);
      }

      if (!entry) continue;

      // Resolve final drop type: entry > caller overrides > default
      const type = entry.type ?? overrides.type ?? DEFAULT_DROP_TYPE;

      // Avoid passing `type` down inside overrides after we resolved it
      const { type: _ignore, ...restOverrides } = overrides;

      // Merge per-entry overrides (lowest precedence) then caller overrides (highest)
      const mergedOverrides = {
        ...(entry.overrides ?? {}),
        ...restOverrides,
      };

      const spawnPoint = this._resolveSpawnPoint(x, y);
      this.dropManager?.spawn(spawnPoint.x, spawnPoint.y, type, mergedOverrides);
    }
  }

  _resolveSpawnPoint(x, y) {
    const runtime = this.scene?.mapRuntime;
    // Infinite maps can spawn drops at the exact kill location.
    if (!runtime?.isBounded?.()) {
      return { x, y };
    }

    // Bounded maps clamp drops into the playable rectangle.
    const bounds = runtime.getWorldBounds?.();
    if (!bounds) return { x, y };

    const clamped = runtime.clampPoint?.({ x, y }) ?? { x, y };
    if (!this._isBlocked(clamped.x, clamped.y)) {
      return clamped;
    }

    const offsets = [16, 32, 48, 64, 80, 96];
    for (const offset of offsets) {
      const candidates = [
        { x: clamped.x + offset, y: clamped.y },
        { x: clamped.x - offset, y: clamped.y },
        { x: clamped.x, y: clamped.y + offset },
        { x: clamped.x, y: clamped.y - offset },
        { x: clamped.x + offset, y: clamped.y + offset },
        { x: clamped.x - offset, y: clamped.y + offset },
        { x: clamped.x + offset, y: clamped.y - offset },
        { x: clamped.x - offset, y: clamped.y - offset },
      ];

      for (const candidate of candidates) {
        const inside = candidate.x >= bounds.left && candidate.x <= bounds.right
          && candidate.y >= bounds.top && candidate.y <= bounds.bottom;
        if (!inside) continue;
        if (!this._isBlocked(candidate.x, candidate.y)) {
          return candidate;
        }
      }
    }

    const hero = this.scene?.hero?.sprite;
    const fallback = runtime.clampPoint?.({
      x: hero?.x ?? bounds.centerX,
      y: hero?.y ?? bounds.centerY,
    });
    return fallback ?? { x: bounds.centerX, y: bounds.centerY };
  }

  _isBlocked(x, y) {
    const mapQuery = this.scene?.mapQuery;
    if (!mapQuery?.isWalkableWorldXY) return false;
    return !mapQuery.isWalkableWorldXY(x, y);
  }
}
