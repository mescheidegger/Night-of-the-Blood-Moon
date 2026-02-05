import Phaser from 'phaser';
import {
  applyBodyConfig,
  resolveMobConfig,
} from '../MobRegistry.js';
import { resolveMobStats } from '../MobStatsFactory.js';

/**
 * Pooled enemy sprite that hydrates itself from the MobRegistry on demand.
 *
 * Extending `Phaser.Physics.Arcade.Sprite` allows us to play animations while
 * retaining the same pooling contract the previous `Image` based enemy used.
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  /**
   * Create a pooled enemy sprite that can be reset with new mob data on demand.
   */
  constructor(scene, x, y, texture, frame = 0) {
    // Texture/frame here are effectively placeholders; reset() will reconfigure.
    super(scene, x, y, texture ?? '__enemy_placeholder__', frame);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setActive(false).setVisible(false);

    this.body?.setAllowGravity(false);
    this.body?.setMaxSpeed(200);

    // Runtime state populated during reset().
    this.speed = 0;
    this.hp = 0;
    this.maxHp = 0;
    this.damage = 0;
    this.mobKey = null;
    this.aiBehavior = 'seekPlayer';
    this.aiParams = null;
    this.rewards = { xp: 0 };
  }

  /**
   * Rehydrate the sprite from the given mob configuration and make it active
   * in the world. Called by Pool.get() immediately after acquisition.
   */
  reset(x, y, mobKey, overrides = {}) {
    if (!mobKey) {
      console.warn('[Enemy.reset] called without mobKey');
      return;
    }

    const config = resolveMobConfig(mobKey);
    if (!config) {
      console.warn('[Enemy.reset] no mob config for key:', mobKey);
      return;
    }

    this.mobKey = mobKey;
    this.tier = config.tier;
    this.animationKeys = config.animationKeys ?? {};

    this._isDying = false;
    this._isAttacking = false;
    this._bossNextAttack = null;
    this._deathHandled = false;
    this._attackDealt = false;

    // Swap to the correct spritesheet and default animation frame.
    const sheetKey = config.sheetKey ?? mobKey;
    const frame = config.defaultFrame ?? 0;
    this.setTexture(sheetKey, frame);

    // Origin / scale from config.
    if (config.origin) {
      this.setOrigin(config.origin.x ?? 0.5, config.origin.y ?? 0.5);
    }

    if (config.scale !== undefined) {
      this.setScale(config.scale);
    }

    // Centralised stats resolver (speed, hp, damage, maxSpeed, etc.)
    const stats = resolveMobStats({
      scene: this.scene,
      mobKey,
      config,
      overrides,
    });

    this.speed = stats.speed ?? 60;
    this.hp = stats.hp ?? 1;
    this.maxHp = stats.hp ?? 1;
    this.damage = stats.damage ?? 0;

    // Rewards (XP, drops) with overrides.
    this.rewards = {
      ...(config.rewards ?? {}),
      ...(overrides.rewards ?? {}),
    };

    this.aiBehavior = overrides.ai ?? config.ai ?? 'seekPlayer';
    this.aiParams = {
      ...(config.aiParams ?? {}),
      ...(overrides.aiParams ?? {}),
    };

    // Render depth from config so bosses can be layered above FX later.
    this.setDepth(config.depth ?? this.depth ?? 2);

    // Normalise the physics body to the mob definition.
    applyBodyConfig(this, config);

    if (this.body) {
      this.body.setEnable(true);
      this.body.setAllowGravity(false);
      this.body.stop?.();
      this.body.setVelocity(0, 0);

      const maxSpeed = stats.maxSpeed ?? Math.max(200, (this.speed || 0));
      this.body.setMaxSpeed(maxSpeed);
    }

    this.setPosition(x, y);
    this.clearTint();
    this.setAngle(0);
    this.setFlip(false, false);

    // Either play the configured animation or fall back to the static frame.
    const animKey = overrides.animation
      ?? config.defaultAnim
      ?? this.animationKeys?.idle;

    if (animKey && this.anims?.animationManager?.exists?.(animKey)) {
      this.play(animKey, true);
    } else {
      this.anims?.stop?.();
      this.setFrame(frame);
    }

    this.setActive(true).setVisible(true);

    // Now that mobKey/ai/stats are hydrated, this is the canonical "spawned" moment.
    this.scene?.events?.emit?.('enemy:spawned', { enemy: this });


    // Clear transient AI metadata so pooled instances don't leak state.
    this._baseVel = null;
    this._aiTime = 0;
    this._waveMargin = undefined;
    this._waveAmplitude = undefined;
    this._waveFrequency = undefined;
    this._theta = undefined;

    // Legion formation metadata (cleared each spawn)
    this._formationId = null;
    this._formationAngle = 0;
    this._formationRadius = undefined;
  }

  /**
   * Reset volatile runtime state before returning the enemy to its pool.
   */
  onRelease() {
    this.body?.setVelocity(0, 0);

    if (this._rangedWeapon) {
      this._rangedWeapon.destroy();
      this._rangedWeapon = null;
    }

    this._projectileCfg = null;
    this.aiParams = null;
  }
}
