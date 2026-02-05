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

    // IMPORTANT: infinite-map behavior is the canonical baseline.
    // These overrides apply only when mapRuntime reports a bounded map.
    this._boundedBehaviorMap = {
      seekPlayer: 'seekPlayerBoundedFlow',
      seekAndMelee: 'seekAndMeleeBounded',
      seekAndFire: 'seekAndFireBounded',
      circlePlayer: 'circlePlayerBounded',
      legionMember: 'legionMemberBounded',
    };
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

    // Infinite maps always use the originally requested behavior.
    // On bounded maps we optionally remap to path-aware variants, but only when
    // the variant exists so legacy behavior keys remain safe.
    const boundedKey = isBounded ? this._boundedBehaviorMap[requestedKey] : null;
    const resolvedKey = boundedKey && typeof behaviors[boundedKey] === 'function'
      ? boundedKey
      : requestedKey;

    // Unknown/legacy behavior keys fall back to default seek behavior.
    return behaviors[resolvedKey] ?? behaviors[this._defaultSeekKey];
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
