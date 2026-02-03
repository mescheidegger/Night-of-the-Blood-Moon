import { ENEMY_BEHAVIORS } from '../mob/MobAI.js';

/**
 * EnemyBehaviorSystem keeps the per-frame AI loop out of GameScene. The runner
 * simply iterates the active enemy pool and invokes the appropriate behaviour
 * function defined in `MobAI`.
 */
export class EnemyBehaviorSystem {
  /**
   * Create a lightweight runner that decouples AI iteration from the scene.
   * Centralizing the loop here keeps mob updates consistent and testable.
   */
  constructor(scene, { enemyGroup, hero } = {}) {
    this.scene = scene;
    this.enemyGroup = enemyGroup ?? null;
    this.hero = hero ?? null;

    // Default behavior keys (kept as constants so typos don't silently break).
    this._defaultSeekKey = 'seekPlayer';
    this._boundedSeekKey = 'seekPlayerBoundedFlow';
  }

  /** Swap the hero target at runtime. */
  setHero(hero) {
    this.hero = hero;
  }

  /** Allow the scene to hot-swap the enemy group. */
  setEnemyGroup(group) {
    this.enemyGroup = group;
  }

  /**
   * Resolve the behavior function for an enemy, taking bounded-map overrides
   * into account so missing/legacy aiBehavior values don't degrade pathing.
   */
  _resolveBehavior(enemy) {
    const behaviors = ENEMY_BEHAVIORS;

    const isBounded = this.scene?.mapRuntime?.isBounded?.() ?? false;

    // Enemy may have no aiBehavior (legacy spawns) or a typo; treat as default seek.
    const requestedKey =
      typeof enemy?.aiBehavior === 'string' && enemy.aiBehavior.length
        ? enemy.aiBehavior
        : this._defaultSeekKey;

    // On bounded maps, swap the "basic chaser" (and legacy/missing behavior) to flow-field.
    // We only auto-swap the *default seek* so specialty patterns (flySine, circlePlayer, etc.)
    // keep working exactly as authored.
    if (isBounded && requestedKey === this._defaultSeekKey) {
      const boundedFn = behaviors[this._boundedSeekKey];
      if (typeof boundedFn === 'function') return boundedFn;
      // If not wired yet, fall back gracefully.
      return behaviors[this._defaultSeekKey];
    }

    // Normal resolution path.
    return behaviors[requestedKey] ?? behaviors[this._defaultSeekKey];
  }

  /** Iterate every active enemy and run its configured AI behaviour. */
  update(dt) {
    const group = this.enemyGroup;
    const heroSprite = this.hero ?? this.scene?.player ?? this.scene?.hero?.sprite;
    if (!group || !heroSprite) return;

    group.children?.iterate?.((enemy) => {
      if (!enemy || !enemy.active || enemy._isDying) return;
      if (enemy._bossController) return;

      const behavior = this._resolveBehavior(enemy);
      behavior(enemy, heroSprite, this.scene, dt);
    });
  }

  /** Clear references so the garbage collector can reclaim the runner during scene shutdown. */
  destroy() {
    this.scene = null;
    this.enemyGroup = null;
    this.hero = null;
  }
}
