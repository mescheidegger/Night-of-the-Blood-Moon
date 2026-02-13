import Phaser from 'phaser';

/**
 * Tracks and mutates the hit points for a single entity while handling
 * invincibility frames, hurt feedback, and lifecycle cleanup.  The system
 * stays intentionally small but emits rich events (`health:changed`,
 * `entity:died`) so other systems can subscribe without becoming tightly
 * coupled to the player sprite.
 */
export class HealthSystem {
  /**
   * @param {Phaser.Scene} scene - Owning scene used for timing + events.
   * @param {Phaser.GameObjects.GameObject} entity - The entity whose health we track.
   * @param {object} [config]
   * @param {number} [config.maxHealth=5] - Starting and maximum hit points.
   * @param {number} [config.iFrameDuration=800] - Duration of invincibility (ms) after taking damage.
   */
  constructor(scene, entity, {
    maxHealth = 5,
    iFrameDuration = 800
  } = {}) {
    this.scene = scene;
    this.entity = entity;
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.iFrameDuration = iFrameDuration;
    this.invincibleUntil = 0;
    this.dead = false;

    this._onShutdown = () => this.destroy();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown);
  }

  /**
   * Convenience getter that returns a 0..1 ratio for UI elements such as
   * the health bar.  The clamp guards against divide-by-zero if the max
   * health is changed at runtime.
   */
  get normalized() {
    return Phaser.Math.Clamp(this.health / this.maxHealth, 0, 1);
  }

  /**
   * Returns `true` when the entity has already been marked as dead.  The
   * explicit method keeps the scene code expressive (e.g. `if (health.isDead())`).
   */
  isDead() {
    return this.dead;
  }

  /**
   * Update the invincibility window (ms) used after taking damage.
   */
  setIFrameDurationMs(ms = this.iFrameDuration) {
    const next = Number(ms);
    if (!Number.isFinite(next)) return;
    this.iFrameDuration = Math.max(0, next);
  }

  /**
   * Restores the entity to full health and clears invincibility timers.
   * Used when the scene restarts or if the player obtains a full heal power-up.
   */
  reset(maxHealth = this.maxHealth) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.dead = false;
    this.invincibleUntil = 0;
    this._emitHealthChanged();
  }

  /**
   * Adds the given amount of health, clamped to the configured maximum.
   * Returns `true` if the value changed, allowing callers to gate SFX/FX.
   */
  heal(amount = 1) {
    if (this.dead || amount <= 0) return false;

    const prev = this.health;
    this.health = Phaser.Math.Clamp(this.health + amount, 0, this.maxHealth);
    if (this.health !== prev) {
      this._emitHealthChanged();
    }

    return this.health !== prev;
  }

  /**
   * Applies damage while respecting invincibility frames and dead state.
   * Emits the hurt flash, updates listeners, and fires `entity:died` when
   * health reaches zero.  Returns `true` only when damage was actually dealt.
   */
  damage(amount = 1, options = {}) {
    if (this.dead || amount <= 0) return false;

    const { ignoreIFrames = false } = options;

    const now = this.scene.time.now;
    if (!ignoreIFrames && now < this.invincibleUntil) return false;

    this.invincibleUntil = now + this.iFrameDuration;

    // Hurt flash
    if (this.entity?.setTintFill) {
      this.entity.setTintFill(0xffffff);
      this.scene.time.delayedCall(80, () => this.entity?.clearTint());
    }

    this.health = Math.max(0, this.health - amount);
    this._emitHealthChanged();
    this.scene.damageNumbers?.hitEntity(this.entity, amount, { tint: 0xffffff });

    if (this.health <= 0) {
      this.dead = true;
      this.scene.events.emit('entity:died', { entity: this.entity });
    }

    return true;
  }

  /**
   * Broadcast helper that normalizes the payload shared by heal/damage/reset.
   */
  _emitHealthChanged() {
    this.scene.events.emit('health:changed', {
      entity: this.entity,
      current: this.health,
      max: this.maxHealth
    });
  }

  /**
   * Removes listeners and breaks references so the system can be GC'd when
   * the scene shuts down or the entity is destroyed.
   */
  destroy() {
    if (!this.scene) return;

    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown);
    this.scene = null;
    this.entity = null;
  }
}
