export class RunStatsTracker {
  constructor(scene, { events, startTime = null } = {}) {
    this.scene = scene;
    this.events = events ?? scene?.events ?? null;

    this.startTime = startTime;

    // Core counters
    this.kills = 0;
    this.damageDealt = 0;

    // --- Event handlers (bound once) ---
    this._onEnemyDied = () => {
      this.kills = (this.kills | 0) + 1;
    };

    this._onCombatHit = (payload = {}) => {
      // DamagePipeline emits: { damage: effectiveDamage, weaponKey, mobKey, enemy, wasCrit }
      const dmg = Number(payload?.damage) || 0;
      if (dmg <= 0) return;

      // total confirmed damage dealt to enemies
      this.damageDealt += dmg;
    };

    // --- Subscriptions ---
    this.events?.on?.('enemy:died', this._onEnemyDied);
    this.events?.on?.('combat:hit', this._onCombatHit);
  }

  setStartTime(startTime) {
    this.startTime = startTime;
  }

  reset({ startTime = null } = {}) {
    this.kills = 0;
    this.damageDealt = 0;
    this.startTime = startTime;
  }

  getElapsedMs(now = null) {
    if (typeof this.scene?.getRunElapsedMs === 'function') {
      return Math.max(0, Number(this.scene.getRunElapsedMs()) || 0);
    }

    const nowMs = Number.isFinite(now) ? now : (this.scene?.time?.now ?? 0);
    const effectiveStart = Number.isFinite(this.startTime) ? this.startTime : nowMs;
    return Math.max(0, nowMs - effectiveStart);
  }

  getSnapshot(now = null) {
    const elapsedMs = this.getElapsedMs(now);
    const xpEarned = Math.max(0, Number(this.scene?.playerXP ?? 0) || 0);

    return {
      timeSurvivedSeconds: elapsedMs / 1000,
      timeSurvivedMs: elapsedMs,

      kills: Math.max(0, this.kills | 0),
      xpEarned,

      // New: total damage dealt to enemies (confirmed via combat:hit)
      damageDealt: Math.max(0, Number(this.damageDealt) || 0),
    };
  }

  destroy() {
    this.events?.off?.('enemy:died', this._onEnemyDied);
    this.events?.off?.('combat:hit', this._onCombatHit);

    this._onEnemyDied = null;
    this._onCombatHit = null;

    this.scene = null;
    this.events = null;
  }
}
