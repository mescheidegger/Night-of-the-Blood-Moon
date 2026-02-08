import Phaser from 'phaser';
import { evaluateWeight, weightedPick } from './utils.js';
import { SpawnerRegistry } from './spawners/index.js';

/**
 * SpawnDirector
 *
 * Central orchestrator that determines:
 *  • WHEN enemies spawn (via a repeating timer)
 *  • WHICH mob type spawns (via weighted probability & spawn caps)
 *  • HOW that mob is spawned (default ring pattern or a custom spawner)
 *
 * This class does NOT care about animation, AI behavior, or stats—
 * those are all resolved in MobRegistry and Enemy.reset().
 *
 * Spawn patterns are delegated to functions in SpawnerRegistry
 * (e.g., `ring`, `batWave`).
 *
 * ---------------------------------------------------------------------------
 * ✅ Pace knob (10-minute runs without rewriting your registry)
 * ---------------------------------------------------------------------------
 * Spawn configs are typically authored against a "design run" length (ex: 15 min).
 * If your actual run is shorter (ex: 10 min), we map runtime seconds -> design seconds:
 *
 *   tDesign = tRun * (designSeconds / runSeconds) * pressure
 *
 * Then we use `tDesign` everywhere the config is evaluated:
 * - mode windows (from/to)
 * - appearAt / timeline gating (if timeline exists in the same config)
 * - weight curves
 * - spawnsPerTick curves
 * - dynamic caps (entry.max as fn(t))
 * - spawner functions (they receive tDesign by default)
 *
 * This keeps the registry declarative and lets you change pacing with ONE knob.
 */
export class SpawnDirector {
  /** Initialize SpawnDirector state so runtime dependencies are ready. */
  constructor(scene, enemyPools, spawnConfig) {
    this.scene = scene;
    this.enemyPools = enemyPools;
    this.spawnConfig = spawnConfig ?? { byMob: {} };

    this.timeline = Array.isArray(this.spawnConfig?.timeline)
      ? this.spawnConfig.timeline
          .slice()
          .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
          .map((evt, i) => ({
            ...evt,
            __eventId: evt?.id ?? `timeline-${i}`,
          }))
      : [];

    this._timelineIndex = 0;
    this._activeEvent = null;
    this._activeEventEndAt = 0;
    this._firedEvents = new Set();
    this._weightedEnabled = true;

    // Base interval between spawn attempts (ms)
    this.delayMs = this.spawnConfig?.delayMs ?? 300;

    // Global attempts per tick (can be a number or function(t))
    this.spawnsPerTick = this.spawnConfig?.spawnsPerTick ?? 1;

    // Map of mobKey → weight (value or function(t)).
    this.weightOverrides = new Map();

    // Track per-mode cooldown and active counts for mode-aware spawns.
    this._modeCooldowns = new Map();
    this._modeActiveCounts = new Map();

    // Lookup table that maps customSpawner names to actual spawn functions.
    this.spawners = SpawnerRegistry;

    // ---- Pace mapping (runtime seconds -> design seconds) ----
    this._pace = this._createPace(this.spawnConfig?.pace);

    // Apply per-mob caps & weights from config
    this._applyInitialCaps();

    // Track when enemies are released so we can decrement per-mode counts.
    this._onEnemyReleased = ({ enemy }) => {
      if (!enemy) return;
      const mobKey = enemy.mobKey ?? enemy.type;
      if (!mobKey) return;
      const modeKey = enemy._spawnModeKey ?? null;
      this._incrementModeActive(mobKey, modeKey, -1);
    };
    scene.events.on('enemy:released', this._onEnemyReleased);

    // Start repeating timer loop
    this._startTimer();

    // Clean up when scene shuts down
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this._timer?.remove?.();
      this._timer = null;
      this._modeCooldowns.clear();
      this._modeActiveCounts.clear();
      this.scene?.events?.off('enemy:released', this._onEnemyReleased);
    });
  }

  // ---------------------------------------------------------------------------
  // Pace
  // ---------------------------------------------------------------------------

  /**
   * Create a pace mapping object.
   * If no pace block is provided, behaves like identity (tDesign === tRun).
   */
  _createPace(pace) {
    const designSeconds = Math.max(1, Number(pace?.designSeconds ?? 0) || 0);
    const runSeconds = Math.max(1, Number(pace?.runSeconds ?? 0) || 0);
    const pressure = Math.max(0.1, Number(pace?.pressure ?? 1) || 1);

    // Back-compat: if pace block not provided, scale = 1.
    if (!pace || !Number.isFinite(designSeconds) || !Number.isFinite(runSeconds) || designSeconds <= 0 || runSeconds <= 0) {
      return Object.freeze({
        enabled: false,
        designSeconds: null,
        runSeconds: null,
        pressure: 1,
        scale: 1,
        toDesignTime: (tRun) => tRun,
      });
    }

    const scale = (designSeconds / runSeconds) * pressure;

    return Object.freeze({
      enabled: true,
      designSeconds,
      runSeconds,
      pressure,
      scale,
      toDesignTime: (tRun) => tRun * scale,
    });
  }

  /**
   * Update pacing at runtime.
   * Example:
   *   director.setPace({ designSeconds: 900, runSeconds: 600, pressure: 1.0 })
   */
  setPace(pace) {
    this._pace = this._createPace(pace);
  }

  /** Get current pace info for debugging/HUD. */
  getPace() {
    return this._pace;
  }

  /** Resolve both clocks for this tick. */
  _getTimes() {
    let tRun;

    if (typeof this.scene.getRunElapsedSeconds === 'function') {
      tRun = this.scene.getRunElapsedSeconds();
    } else {
      const now = this.scene.time?.now ?? 0;
      tRun = Math.max(0, (now - (this.scene._runStartedAt ?? now)) / 1000);
    }

    const tDesign = this._pace?.toDesignTime ? this._pace.toDesignTime(tRun) : tRun;
    return { tRun, tDesign };
  }

  // ---------------------------------------------------------------------------
  // Timeline helpers
  // ---------------------------------------------------------------------------

  /** Handle _peekNextTimelineEvent so this system stays coordinated. */
  _peekNextTimelineEvent(tSeconds) {
    if (!this.timeline || this._timelineIndex >= this.timeline.length) return null;
    return this.timeline[this._timelineIndex];
  }

  /** Handle _consumeTimelineEvent so this system stays coordinated. */
  _consumeTimelineEvent(evt) {
    if (!evt) return;
    const current = this.timeline[this._timelineIndex];
    if (current === evt) {
      this._timelineIndex += 1;
    }
  }

  /** Handle _runActiveScriptedEvent so this system stays coordinated. */
  _runActiveScriptedEvent(tRunSeconds, { tDesign } = {}) {
    const evt = this._activeEvent;
    if (!evt) return false;

    const evtId = this._getEventId(evt);
    if (evt.once && this._firedEvents.has(evtId)) return false;

    let didSpawn = false;

    if (evt.control) {
      this.scene?.events?.emit('spawn:control', { ...evt.control, _eventId: evtId });
      didSpawn = true;
      if (evt.once) this._firedEvents.add(evtId);
    }

    if (!Array.isArray(evt.spawns) || evt.spawns.length === 0) {
      return didSpawn;
    }

    const heroSprite = this.scene.hero?.sprite ?? this.scene.player;
    if (!heroSprite) return false;

    // Timeline is authored in RUN TIME (your SpawnTimeline is already repaced),
    // but we still expose both clocks for spawners/debugging.
    const tDesignSeconds = Number.isFinite(tDesign) ? tDesign : tRunSeconds;

    const isBounded = this.scene?.mapRuntime?.isBounded?.();
    const ctx = {
      scene: this.scene,
      enemyPools: this.enemyPools,
      heroSprite,
      modeKey: null,
      spawnKeyDefault: isBounded ? 'timeline' : null,
      spawnReason: 'timeline',

      // Helpful for spawners/debugging:
      tRun: tRunSeconds,
      tDesign: tDesignSeconds,
      pace: this._pace,
    };

    for (const spawnDef of evt.spawns) {
      if (!spawnDef) continue;

      const spawnerKey = spawnDef.spawner ?? 'ring';
      const spawnerFn = this.spawners?.[spawnerKey] ?? this.spawners?.ring;
      const mobKey = spawnDef.mobKey;
      const entry = spawnDef.entry ?? {};

      if (!mobKey || typeof spawnerFn !== 'function') continue;
      if (!this.enemyPools?.canSpawn?.(mobKey)) continue;

      try {
        // IMPORTANT: scripted timeline spawns should use RUN TIME seconds
        // so they don't get double-compressed when pace mapping is enabled.
        const handled = spawnerFn(ctx, mobKey, tRunSeconds, entry) || 0;
        if (handled > 0) didSpawn = true;
      } catch (err) {
        console.warn('[SpawnDirector] scripted spawner failed', spawnerKey, err);
      }
    }

    if (evt.once) this._firedEvents.add(evtId);

    return didSpawn;
  }

  /** Handle _modeKey so this system stays coordinated. */
  _modeKey(mobKey, modeKey) {
    return `${mobKey}:${modeKey || 'default'}`;
  }

  /** Handle _getModeActiveCount so this system stays coordinated. */
  _getModeActiveCount(mobKey, modeKey) {
    return this._modeActiveCounts.get(this._modeKey(mobKey, modeKey)) ?? 0;
  }

  /** Handle _incrementModeActive so this system stays coordinated. */
  _incrementModeActive(mobKey, modeKey, delta = 1) {
    const key = this._modeKey(mobKey, modeKey);
    const next = (this._modeActiveCounts.get(key) ?? 0) + delta;
    this._modeActiveCounts.set(key, Math.max(0, next));
  }

  /** Handle _setModeCooldownUntil so this system stays coordinated. */
  _setModeCooldownUntil(mobKey, modeKey, timestampMs) {
    this._modeCooldowns.set(this._modeKey(mobKey, modeKey), timestampMs);
  }

  /** Handle _isModeOnCooldown so this system stays coordinated. */
  _isModeOnCooldown(mobKey, modeKey, nowMs) {
    const next = this._modeCooldowns.get(this._modeKey(mobKey, modeKey)) ?? 0;
    return nowMs < next;
  }

  /**
   * Reads spawnConfig.byMob to:
   *  • Set per-mob max active counts
   *  • Register weight curves
   *  • Apply global enemy cap if provided
   */
  _applyInitialCaps() {
    if (!this.spawnConfig?.byMob) return;

    Object.entries(this.spawnConfig.byMob).forEach(([mobKey, entry]) => {
      if (entry?.max !== undefined) {
        // NOTE: If max is a function, it is applied dynamically each tick.
        if (typeof entry.max !== 'function') {
          this.enemyPools?.setMax?.(mobKey, entry.max);
        }
      }
    });

    if (this.spawnConfig.totalMax !== undefined) {
      this.enemyPools?.setTotalMax?.(this.spawnConfig.totalMax);
    }
  }

  /**
   * Resolve and apply per-mob max caps each tick.
   * Supports static numbers or functions of t (seconds).
   *
   * IMPORTANT: We evaluate against tDesign so caps authored for the old pacing
   * still "hit" at the intended relative points of the run.
   */
  _updateDynamicCaps(tDesignSeconds) {
    if (!this.spawnConfig?.byMob) return;

    Object.entries(this.spawnConfig.byMob).forEach(([mobKey, entry]) => {
      if (entry?.max === undefined) return;

      let resolvedMax = entry.max;
      if (typeof resolvedMax === 'function') {
        try {
          resolvedMax = resolvedMax(tDesignSeconds);
        } catch (err) {
          console.warn('[SpawnDirector] max resolver failed', mobKey, err);
          resolvedMax = undefined;
        }
      }

      if (Number.isFinite(resolvedMax)) {
        this.enemyPools?.setMax?.(mobKey, resolvedMax);
      }
    });
  }

  /**
   * Creates or restarts the internal repeating spawn timer.
   */
  _startTimer() {
    this._timer?.remove?.();
    this._timer = this.scene.time.addEvent({
      delay: this.delayMs,
      loop: true,
      callback: () => this.spawnTick(),
    });
  }

  /** Handle _getEventId so this system stays coordinated. */
  _getEventId(evt) {
    return evt?.__eventId ?? evt?.id;
  }

  /**
   * Fast-forward the timeline to the provided timestamp without replaying
   * already elapsed events. Used by debug/dev flows.
   *
   * NOTE: This expects the provided time to be in **runtime seconds** (tRun),
   * but we advance the timeline using tDesign so authored timeline pacing stays consistent.
   */
  seekToTime(tRunSeconds) {
    // Timeline is authored in RUN TIME seconds (your SpawnTimeline is already repaced),
    // so seeking should advance using tRun (not tDesign) to avoid double-compression.
    const tRun = Math.max(0, Number(tRunSeconds) || 0);

    this._activeEvent = null;
    this._activeEventEndAt = 0;

    if (!Array.isArray(this.timeline) || this.timeline.length === 0) {
      this._timelineIndex = 0;
      return;
    }

    this._timelineIndex = 0;
    while (this._timelineIndex < this.timeline.length) {
      const evt = this.timeline[this._timelineIndex];
      const at = evt?.at ?? 0;

      if (tRun < at) break;

      if (evt?.once) {
        const evtId = this._getEventId(evt, this._timelineIndex);
        this._firedEvents.add(evtId);
      }

      this._timelineIndex += 1;
    }
  }
  /**
   * Update the delay between spawn checks at runtime.
   */
  setDelayMs(ms) {
    const value = Math.max(16, Number(ms) || this.delayMs);
    this.delayMs = value;
    this._startTimer();
  }

  /**
   * Update global spawn attempts per tick (can be number or fn(t)).
   */
  setSpawnsPerTick(value) {
    this.spawnsPerTick = value;
  }

  /**
   * Replace weight logic for a given mob key.
   */
  setWeight(mobKey, weight) {
    if (!mobKey) return;
    this.weightOverrides.set(mobKey, weight);
  }

  /**
   * Update the per-mob active cap at runtime.
   */
  setMax(mobKey, max) {
    this.enemyPools?.setMax?.(mobKey, max);
  }

  /** Handle setWeightedEnabled so this system stays coordinated. */
  setWeightedEnabled(enabled) {
    this._weightedEnabled = !!enabled;
  }

  /**
   * Main spawn loop.
   * Runs every `delayMs` and may spawn multiple mobs depending on spawnsPerTick.
   */
  spawnTick() {
    const heroSprite = this.scene.hero?.sprite ?? this.scene.player;
    if (!heroSprite) return;

    // tRun = seconds since run start (what the player experiences)
    // tDesign = seconds mapped into the tuning "design run" timeline
    const { tRun, tDesign } = this._getTimes();

    // Caps/curves authored for design time
    this._updateDynamicCaps(tDesign);

    // --- Scripted timeline handling (evaluated in design-time seconds) ---
    // timeline evaluated in RUNTIME seconds (timeline is already repaced)
    if (this.timeline && this.timeline.length > 0) {
      if (this._activeEvent && tRun >= this._activeEventEndAt) {
        this._activeEvent = null;
      }

      if (!this._activeEvent) {
        const nextEvt = this._peekNextTimelineEvent(tRun);
        if (nextEvt && tRun >= (nextEvt.at ?? 0)) {
          this._activeEvent = nextEvt;
          this._activeEventEndAt = tRun + (nextEvt.duration ?? 0);
          this._consumeTimelineEvent(nextEvt);
        }
      }

      if (this._activeEvent) {
        const didSpawn = this._runActiveScriptedEvent(tRun, { tDesign });

        if (this._activeEvent.behavior === 'suspendWeighted' && didSpawn) {
          return;
        }
      }
    }
    // --- end timeline handling ---

    if (!this._weightedEnabled) {
      return;
    }

    // Resolve global spawn attempts for this tick (evaluate in design time)
    let attempts = this.spawnsPerTick;
    if (typeof attempts === 'function') {
      try {
        attempts = Number(attempts(tDesign));
      } catch (e) {
        console.warn('[SpawnDirector] spawnsPerTick function error', e);
        attempts = 1;
      }
    }
    attempts = Math.max(1, Math.floor(Number.isFinite(attempts) ? attempts : 1));

    const nowMs = this.scene.time?.now ?? 0;

    // Build weighted candidate list of mob types/modes that are allowed to spawn
    const candidates = [];
    Object.entries(this.spawnConfig?.byMob ?? {}).forEach(([mobKey, mobEntry = {}]) => {
      const modes = Array.isArray(mobEntry.modes) ? mobEntry.modes : null;
      const weightOverride = this.weightOverrides.get(mobKey);

      if (modes && modes.length > 0) {
        modes.forEach((modeEntry) => {
          if (!modeEntry) return;

          const from = modeEntry.from ?? 0;
          const to = modeEntry.to ?? Infinity;

          // Mode windows are authored in design time.
          // `to` is treated as exclusive.
          if (tDesign < from || tDesign >= to) return;

          const weightSource = weightOverride ?? modeEntry.weight ?? mobEntry.weight;
          const weight = Math.max(0, evaluateWeight(weightSource, tDesign));
          if (weight <= 0) return;
          if (!this.enemyPools?.canSpawn?.(mobKey)) return;

          const maxConcurrent = modeEntry.maxConcurrent;
          if (Number.isFinite(maxConcurrent)) {
            const active = this._getModeActiveCount(mobKey, modeEntry.key);
            if (active >= maxConcurrent) return;
          }

          const cooldownMs = Number(modeEntry.cooldownMs) || 0;
          if (cooldownMs > 0 && this._isModeOnCooldown(mobKey, modeEntry.key, nowMs)) return;

          candidates.push({
            mobKey,
            modeKey: modeEntry.key ?? null,
            mobEntry,
            modeEntry,
            weight,
          });
        });
      } else {
        const weightSource = weightOverride ?? mobEntry.weight;
        const weight = Math.max(0, evaluateWeight(weightSource, tDesign));
        if (weight <= 0) return;
        if (!this.enemyPools?.canSpawn?.(mobKey)) return;

        candidates.push({
          mobKey,
          modeKey: null,
          mobEntry,
          modeEntry: null,
          weight,
        });
      }
    });

    if (candidates.length === 0) return;

    // Shared spawn context passed to custom spawners
    const ctx = {
      scene: this.scene,
      enemyPools: this.enemyPools,
      heroSprite,
      modeKey: null,

      // Provide both clocks (spawners can opt into whichever they want).
      tRun,
      tDesign,
      pace: this._pace,
    };

    // Perform spawn attempts (each may spawn multiple mobs depending on spawner)
    for (let i = 0; i < attempts; i++) {
      const candidate = weightedPick(candidates);
      if (!candidate) break;

      const { mobKey, modeKey, mobEntry, modeEntry } = candidate;

      if (!this.enemyPools?.canSpawn?.(mobKey)) {
        candidate.weight = 0;
        if (candidates.every((entry) => Math.max(0, entry.weight) <= 0)) break;
        continue;
      }

      if (modeEntry) {
        const maxConcurrent = modeEntry.maxConcurrent;
        if (Number.isFinite(maxConcurrent) && this._getModeActiveCount(mobKey, modeKey) >= maxConcurrent) {
          candidate.weight = 0;
          if (candidates.every((entry) => Math.max(0, entry.weight) <= 0)) break;
          continue;
        }

        const cooldownMs = Number(modeEntry.cooldownMs) || 0;
        const loopNow = this.scene.time?.now ?? 0;
        if (cooldownMs > 0 && this._isModeOnCooldown(mobKey, modeKey, loopNow)) {
          candidate.weight = 0;
          if (candidates.every((entry) => Math.max(0, entry.weight) <= 0)) break;
          continue;
        }
      }

      const spawnerKey = modeEntry?.spawner ?? mobEntry.customSpawner ?? 'ring';
      const spawnerFn = this.spawners?.[spawnerKey] ?? this.spawners?.ring;
      if (typeof spawnerFn !== 'function') {
        candidate.weight = 0;
        continue;
      }

      const effectiveEntry = { ...mobEntry, ...(modeEntry || {}) };
      ctx.modeKey = modeKey ?? null;

      let handled = 0;
      try {
        // IMPORTANT: spawners receive tDesign so authored time scaling holds.
        handled = spawnerFn(ctx, mobKey, tDesign, effectiveEntry) || 0;
      } catch (err) {
        console.warn(`[SpawnDirector] spawner ${spawnerKey} failed`, err);
      }

      if (handled) {
        const loopNow = this.scene.time?.now ?? 0;
        if (modeEntry?.cooldownMs) {
          this._setModeCooldownUntil(mobKey, modeKey, loopNow + modeEntry.cooldownMs);
        }
        this._incrementModeActive(mobKey, modeKey, handled);
      } else {
        candidate.weight = 0;
      }

      if (candidates.every((entry) => Math.max(0, entry.weight) <= 0)) break;
    }
  }

  /** Handle update so this system stays coordinated. */
  update() {
    // SpawnDirector relies on internal timers; explicit update hook reserved for future use.
  }

  /**
   * Resolve a spawn point for the current map type.
   * - Infinite: uses a ring around the hero (existing behavior).
   * - Bounded: samples random points inside world bounds until unblocked.
   */
  getSpawnPoint({
    heroSprite,
    radius = 0,
    margin = 0,
    attempts = 12,
    spawnKey,
    spawnGroup,
    requireKey = false,
  } = {}) {
    const spawnPoints = this.scene?.mapSpawnPoints;
    const runtime = this.scene?.mapRuntime;
    // Only bounded maps should use grouped spawn points by default.
    const isBounded = runtime?.isBounded?.();
    let resolvedKey = spawnKey ?? spawnGroup;
    const spawnAreas = spawnPoints?.areas;

    if (!resolvedKey && isBounded) {
      // When no explicit key is provided, fall back to the configured enemy group.
      const defaultKey = this.scene?.mapConfig?.spawns?.defaultEnemyKey ?? 'enemy';
      if (spawnPoints?.byKey?.[defaultKey]?.length) {
        resolvedKey = defaultKey;
      }
    }

    const keyedPoints = resolvedKey
      ? (spawnPoints?.byKey?.[resolvedKey] ?? spawnPoints?.byName?.[resolvedKey])
      : null;
    const keyedAreas = resolvedKey && isBounded
      ? (spawnAreas?.byKey?.[resolvedKey] ?? spawnAreas?.byName?.[resolvedKey])
      : null;

    if (keyedPoints?.length) {
      const point = Phaser.Utils.Array.GetRandom(keyedPoints);
      if (point) {
        return { x: point.x, y: point.y };
      }
    }

    if (keyedAreas?.length) {
      const areaPoint = this._sampleSpawnAreaPoint(keyedAreas, attempts);
      if (areaPoint) {
        return areaPoint;
      }
    }

    // If a caller requires a keyed spawn, exit early when none are available.
    if (requireKey && resolvedKey) {
      return null;
    }

    // Bounded maps use world bounds for spawn sampling.
    const bounds = runtime?.getWorldBounds?.();

    if (runtime?.isBounded?.() && bounds) {
      // Keep spawns inside bounds and walkable tiles for bounded maps.
      const minX = bounds.left + margin;
      const maxX = bounds.right - margin;
      const minY = bounds.top + margin;
      const maxY = bounds.bottom - margin;

      for (let i = 0; i < attempts; i += 1) {
        const x = Phaser.Math.FloatBetween(minX, maxX);
        const y = Phaser.Math.FloatBetween(minY, maxY);
        const mapQuery = this.scene?.mapQuery;
        if (!mapQuery || mapQuery.isWalkableWorldXY(x, y)) {
          return { x, y };
        }
      }

      const fallback = runtime.clampPoint?.({
        x: heroSprite?.x ?? bounds.centerX,
        y: heroSprite?.y ?? bounds.centerY,
      });
      return fallback ?? { x: bounds.centerX, y: bounds.centerY };
    }

    if (heroSprite && Number.isFinite(radius) && radius > 0) {
      const angle = Math.random() * Math.PI * 2;
      return {
        x: heroSprite.x + Math.cos(angle) * radius,
        y: heroSprite.y + Math.sin(angle) * radius
      };
    }

    const view = this.scene?.cameras?.main?.worldView;
    if (view) {
      return { x: view.centerX, y: view.centerY };
    }

    return { x: heroSprite?.x ?? 0, y: heroSprite?.y ?? 0 };
  }

  _sampleSpawnAreaPoint(areas, attempts = 12) {
    if (!Array.isArray(areas) || areas.length === 0) return null;

    const validAreas = areas.filter((area) => {
      const width = Number(area?.width);
      const height = Number(area?.height);
      return Number.isFinite(area?.x)
        && Number.isFinite(area?.y)
        && Number.isFinite(width)
        && Number.isFinite(height)
        && width > 0
        && height > 0;
    });

    if (!validAreas.length) return null;

    const totalWeight = validAreas.reduce((sum, area) => sum + area.width * area.height, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;

    const pickArea = () => {
      let roll = Math.random() * totalWeight;
      for (const area of validAreas) {
        roll -= area.width * area.height;
        if (roll <= 0) return area;
      }
      return validAreas[validAreas.length - 1];
    };

    for (let i = 0; i < attempts; i += 1) {
      const area = pickArea();
      if (!area) return null;

      const x = Phaser.Math.FloatBetween(area.x, area.x + area.width);
      const y = Phaser.Math.FloatBetween(area.y, area.y + area.height);
      const mapQuery = this.scene?.mapQuery;
      if (!mapQuery || mapQuery.isWalkableWorldXY(x, y)) {
        return { x, y };
      }
    }

    return null;
  }

  isPointBlocked(x, y) {
    const mapQuery = this.scene?.mapQuery;
    if (!mapQuery?.isWalkableWorldXY) return false;
    return !mapQuery.isWalkableWorldXY(x, y);
  }
}
