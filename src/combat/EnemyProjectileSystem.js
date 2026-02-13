import Phaser from 'phaser';

/**
 * EnemyProjectileSystem
 * ---------------------
 * Lightweight, pooled projectile manager for **enemy-fired** shots (e.g., boss fireballs).
 * - Owns a Physics.Arcade group of sprites (pooled).
 * - Exposes `fire(...)` to spawn a projectile with angle/speed/lifetime.
 * - Handles overlap vs the hero, applies damage, and recycles the projectile.
 * - Auto-releases projectiles when they go off-screen or after a lifetime.
 *
 * Notes:
 * - This is intentionally separate from your player `WeaponManager` / `DamagePipeline`
 *   so we don't entangle "player→enemy" logic with "enemy→player" logic.
 * - Projectiles use ADD blend and a small depth bump to sit above mobs.
 */
export class EnemyProjectileSystem {
  /**
   * @param {Phaser.Scene} scene
   * @param {Object} [opts]
   * @param {Phaser.GameObjects.Sprite|null} [opts.hero]              Optional hero sprite to wire initial overlap to.
   * @param {string} [opts.texture='fireball']                         Texture key for projectile sprite.
   * @param {string|null} [opts.animKey='fireball-loop']               Optional animation key to play while active.
   * @param {number} [opts.defaultDamage=1]                            Damage applied to the hero per hit.
   * @param {number} [opts.defaultSpeed=200]                           Default movement speed in px/s.
   * @param {number} [opts.defaultLifetimeMs=3000]                     Auto-despawn delay in ms.
   * @param {boolean} [opts.ignoreHeroIFrames=false]                   If true, projectile damage bypasses hero i-frames.
   * @param {{width:number,height:number}} [opts.body={width:24,height:24}]  Physics body size (offset auto-centered).
   * @param {number} [opts.maxSize=24]                                 Max pooled projectile instances.
   */
  constructor(scene, {
    hero = null,
    texture = 'fireball',
    animKey = 'fireball-loop',
    defaultDamage = 1,
    defaultSpeed = 200,
    defaultLifetimeMs = 3000,
    ignoreHeroIFrames = false,
    body = { width: 24, height: 24 },
    maxSize = 24,
  } = {}) {
    this.scene = scene;
    this.texture = texture;
    this.defaultAnimKey = animKey;
    this.defaultDamage = defaultDamage;
    this.defaultSpeed = defaultSpeed;
    this.defaultLifetimeMs = defaultLifetimeMs;
    this.ignoreHeroIFrames = ignoreHeroIFrames;
    this.bodyConfig = body;

    // Single pooled group for all enemy projectiles.
    // We use the stock Arcade Sprite class; metadata is attached per-instance.
    this.group = scene.physics.add.group({
      classType: Phaser.Physics.Arcade.Sprite,
      maxSize: Math.max(1, maxSize),
      runChildUpdate: false,
      createCallback: (projectile) => {
        // Visual/physics one-time setup for new pool members
        projectile.setBlendMode(Phaser.BlendModes.NORMAL);
        projectile.setDepth(6);
        projectile.body?.setAllowGravity(false);

        // Per-instance metadata bucket for this system.
        projectile._enemyProjectile = {
          releaseTimer: null,      // delayedCall handle for lifetime cleanup
          damage: this.defaultDamage,
        };

        // Normalize the hitbox to the configured size and center the offset.
        const width = this.bodyConfig?.width ?? projectile.width;
        const height = this.bodyConfig?.height ?? projectile.height;
        projectile.body?.setSize(width, height);
        const ox = (projectile.width - width) * 0.5;
        const oy = (projectile.height - height) * 0.5;
        projectile.body?.setOffset(ox, oy);
      }
    });

    this._isDestroyed = false;
    this._onSceneDestroy = () => this.destroy();
    scene.events.once(Phaser.Scenes.Events.DESTROY, this._onSceneDestroy);

    // Optional hero overlap wiring on construction
    this.heroCollider = null;
    if (hero) {
      this.setHero(hero);
    }
  }

  /**
   * (Re)bind the projectile-hit overlap to a hero sprite.
   * Safe to call multiple times (cleans up the old collider).
   * @param {Phaser.GameObjects.Sprite|null} heroSprite
   */
  setHero(heroSprite) {
    if (this.heroCollider) {
      this.heroCollider.destroy();
      this.heroCollider = null;
    }

    if (!heroSprite) return;

    // Overlap: when a projectile touches the hero, apply damage and recycle.
    this.heroCollider = this.scene.physics.add.overlap(
      heroSprite,
      this.group,
      (_hero, projectile) => this._handleHit(projectile),
      null,
      this
    );
  }

  /**
   * Spawn (or reuse) a projectile at (x,y) moving at `angle` with optional overrides.
   * @param {Object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} [opts.angle=0]          Radians; 0 = +X (to the right).
   * @param {number} [opts.speed]            px/s; defaults to `defaultSpeed`.
   * @param {number} [opts.lifetimeMs]       ms; defaults to `defaultLifetimeMs`.
   * @param {number} [opts.damage]           Damage per hit; defaults to `defaultDamage`.
   * @param {string} [opts.animKey]          Optional anim override.
   * @param {string} [opts.texture]          Optional texture override.
   * @param {string} [opts.atlas]            Optional atlas key override.
   * @param {string|number} [opts.atlasFrame] Optional atlas frame for the projectile.
   * @param {{width:number,height:number}} [opts.body] Physics body size override.
   * @param {Object|null} [opts.explosion]   Optional explosion visual config.
   * @param {Object|null} [opts.aoe]         Optional AoE damage config.
   * @returns {Phaser.Physics.Arcade.Sprite|null}
   */
  fire({
    x,
    y,
    angle = 0,
    speed,
    lifetimeMs,
    damage,
    animKey,
    texture,
    atlas,
    atlasFrame,
    body,
    explosion,
    aoe,
    repeat,
    rotateToVelocity = true, 
  } = {}) {
    const projectile = this.group.get(x, y, this.texture);
    if (!projectile) return null;

    const meta = projectile._enemyProjectile ?? (projectile._enemyProjectile = {});
    if (meta.releaseTimer) {
      meta.releaseTimer.remove(false);
      meta.releaseTimer = null;
    }

    projectile.setActive(true);
    projectile.setVisible(true);
    projectile.body?.setEnable(true);
    projectile.body?.setAllowGravity(false);
    projectile.body?.reset(x, y);
    projectile.setPosition(x, y);

    const bodyCfg = body ?? this.bodyConfig;
    if (bodyCfg) {
      const width = bodyCfg.width ?? projectile.width;
      const height = bodyCfg.height ?? projectile.height;
      projectile.body?.setSize(width, height);
      const ox = (projectile.width - width) * 0.5;
      const oy = (projectile.height - height) * 0.5;
      projectile.body?.setOffset(ox, oy);
    }

    const speedValue = Number.isFinite(speed) ? speed : this.defaultSpeed;

    projectile.body?.setVelocity(
      Math.cos(angle) * speedValue,
      Math.sin(angle) * speedValue
    );

    // Only rotate if told to
    if (rotateToVelocity) {
      projectile.rotation = angle;
    } else {
      projectile.setRotation(0); // or leave as-is
    }

    const key = animKey ?? this.defaultAnimKey;

    if (key) {
      projectile.anims?.stop?.();
      const hasRepeat = Number.isFinite(repeat);

      if (hasRepeat && projectile.anims?.animationManager) {
        // Enemy projectiles: loop forever while in flight
        projectile.anims.play({ key, repeat: -1 }, true);
      } else {
        projectile.play(key, true);
      }
    } else {
      if (atlas && atlasFrame) {
        projectile.setTexture(atlas, atlasFrame);
      } else if (texture) {
        projectile.setTexture(texture);
      }
    }

    meta.damage = Number.isFinite(damage) ? damage : this.defaultDamage;
    meta.explosionCfg = explosion ?? null;
    meta.aoeCfg = aoe ?? null;

    const lifetime = Math.max(250, Number.isFinite(lifetimeMs) ? lifetimeMs : this.defaultLifetimeMs);

    // use expiry handler instead of direct release
    meta.releaseTimer = this.scene.time.delayedCall(lifetime, () => this._handleExpiry(projectile));

    return projectile;
  }

  /**
   * Expire a projectile and trigger any AoE/explosion side effects.
   * This centralizes cleanup so off-screen and timeout paths behave the same.
   */
  _handleExpiry(projectile) {
    if (!projectile) return;

    const meta = projectile._enemyProjectile ?? {};
    if (meta.releaseTimer) {
      meta.releaseTimer.remove(false);
      meta.releaseTimer = null;
    }

    if (!projectile.active) {
      // Already cleaned up by something else.
      return;
    }

    const baseDamage = meta.damage ?? this.defaultDamage;
    const aoeCfg = meta.aoeCfg;
    const explosionCfg = meta.explosionCfg;
    const heroHealth = this.scene.hero?.health;

    // Optional AoE damage on timeout
    if (aoeCfg) {
      const heroSprite = this.scene.hero?.sprite;
      const radius = aoeCfg.radius ?? 0;
      if (heroSprite && radius > 0) {
        const dx = heroSprite.x - projectile.x;
        const dy = heroSprite.y - projectile.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= radius) {
          const mult = aoeCfg.damageMult ?? 1;
          const falloff = aoeCfg.falloff ?? 0;

          let damageMult = mult;
          if (falloff > 0 && radius > 0) {
            const t = dist / radius;
            damageMult *= (1 - falloff * t);
          }

          const explosionDamage = Math.max(1, Math.round(baseDamage * damageMult));
          const tookDamage = heroHealth?.damage?.(explosionDamage, { ignoreIFrames: this.ignoreHeroIFrames });
          if (tookDamage) {
            this.scene.cameras?.main?.shake?.(150, 0.004);
          }
        }
      }
    }

    if (explosionCfg) {
      this._playExplosion(projectile, explosionCfg);
    } else {
      this.release(projectile);
    }
  }

  /**
   * Swap the projectile into an explosion effect and release it when done.
   * Keeping this isolated prevents duplication between expiry and hit logic.
   */
  _playExplosion(projectile, explosionCfg) {
    if (!projectile) return;

    // Stop movement & further collisions
    projectile.body?.setEnable(false);
    projectile.body?.setVelocity(0, 0);

    // Reset rotation so explosion isn't rotated like the projectile
    projectile.setRotation(0);

    // Optional texture/atlas swap for explosion sheet
    if (explosionCfg.atlas && explosionCfg.atlasFrame) {
      projectile.setTexture(explosionCfg.atlas, explosionCfg.atlasFrame);
    } else if (explosionCfg.texture) {
      projectile.setTexture(explosionCfg.texture);
    }

    const animKey = explosionCfg.animKey;
    if (animKey && projectile.anims?.animationManager?.exists?.(animKey)) {
      projectile.anims?.stop?.();
      projectile.play(animKey, true);
      projectile.once(`animationcomplete-${animKey}`, () => this.release(projectile));
    } else {
      // No animation? Just release immediately.
      this.release(projectile);
    }
  }


  /**
   * Return a projectile to the pool and fully deactivate it.
   * @param {Phaser.Physics.Arcade.Sprite} projectile
   */
  release(projectile) {
    if (!projectile) return;
    const meta = projectile._enemyProjectile;
    if (meta?.releaseTimer) {
      meta.releaseTimer.remove(false);
      meta.releaseTimer = null;
    }

    projectile.body?.stop?.();
    projectile.body?.setEnable(false);
    this.group?.killAndHide?.(projectile);
    projectile.setActive(false);
    projectile.setVisible(false);
    projectile.anims?.stop?.();
  }

  /**
   * Per-frame maintenance:
   * - Recycle projectiles that drift far outside the camera view (with margin).
   */
  update() {
    const margin = 96;
    const mapRuntime = this.scene.mapRuntime;
    // Bounded maps recycle projectiles by world bounds; infinite uses camera view.
    const bounds = mapRuntime?.isBounded?.() ? mapRuntime.getWorldBounds?.() : null;
    const view = bounds ? null : this.scene.cameras?.main?.worldView;
    if (!bounds && !view) return;

    this.group.children?.iterate?.((projectile) => {
      if (!projectile?.active) return;
      const outsideBounds = bounds
        ? (projectile.x < bounds.left - margin ||
          projectile.x > bounds.right + margin ||
          projectile.y < bounds.top - margin ||
          projectile.y > bounds.bottom + margin)
        : (projectile.x < view.x - margin ||
          projectile.x > view.x + view.width + margin ||
          projectile.y < view.y - margin ||
          projectile.y > view.y + view.height + margin);

      if (outsideBounds) {
        // also go through expiry so offscreen shots can explode
        this._handleExpiry(projectile);
      }
    });
  }

  /**
   * Internal overlap handler: apply damage to hero, camera feedback, then recycle.
   * @param {Phaser.Physics.Arcade.Sprite} projectile
   * @private
   */
  _handleHit(projectile) {
    if (!projectile?.active) return;
    const meta = projectile._enemyProjectile ?? {};

    if (meta.releaseTimer) {
      meta.releaseTimer.remove(false);
      meta.releaseTimer = null;
    }

    const baseDamage = meta.damage ?? this.defaultDamage;
    const aoeCfg = meta.aoeCfg;
    const explosionCfg = meta.explosionCfg;
    const heroHealth = this.scene.hero?.health;

    let tookDamage = false;

    if (!aoeCfg) {
      // Direct impact only
      tookDamage = heroHealth?.damage?.(baseDamage, { ignoreIFrames: this.ignoreHeroIFrames });
    } else {
      // Explosion-style: damage if hero is inside radius
      const heroSprite = this.scene.hero?.sprite;
      const radius = aoeCfg.radius ?? 0;
      if (heroSprite && radius > 0) {
        const dx = heroSprite.x - projectile.x;
        const dy = heroSprite.y - projectile.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= radius) {
          const mult = aoeCfg.damageMult ?? 1;
          const falloff = aoeCfg.falloff ?? 0;

          let damageMult = mult;
          if (falloff > 0 && radius > 0) {
            const t = dist / radius;
            damageMult *= (1 - falloff * t);
          }

          const explosionDamage = Math.max(1, Math.round(baseDamage * damageMult));
          tookDamage = heroHealth?.damage?.(explosionDamage, { ignoreIFrames: this.ignoreHeroIFrames });
        }
      }
    }

    if (tookDamage) {
      this.scene.cameras?.main?.shake?.(150, 0.004);
    }

    if (explosionCfg) {
      this._playExplosion(projectile, explosionCfg);
      return;
    }

    this.release(projectile);
  }


  /**
   * Dispose of physics links and pooled objects.
   * Safe to call on scene shutdown.
   */
  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;

    // Unhook scene event
    this.scene?.events?.off?.(Phaser.Scenes.Events.DESTROY, this._onSceneDestroy);
    this._onSceneDestroy = null;

    // Remove hero overlap collider
    if (this.heroCollider) {
      this.heroCollider.destroy();
      this.heroCollider = null;
    }

    // Best-effort: release timers, then destroy the group
    if (this.group) {
      // Cancel any outstanding lifetime timers without touching Phaser internals
      this.group.children?.iterate?.(p => {
        const meta = p?._enemyProjectile;
        if (meta?.releaseTimer) {
          meta.releaseTimer.remove(false);
          meta.releaseTimer = null;
        }
      });

      // One call is enough; this also destroys children
      this.group.destroy(true);
      this.group = null;
    }

    this.scene = null;
  }
}
