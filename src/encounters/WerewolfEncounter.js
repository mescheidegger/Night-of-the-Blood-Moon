// src/encounters/WerewolfEncounter.js
import Phaser from 'phaser';

export class WerewolfEncounter {
  constructor(scene, {
    mobKey = 'werewolf_boss',
    telegraphSfx = 'sfx.boss.howl',

    // Optional later (e.g., 'sfx.boss.werewolf.death')
    deathSfx = null,

    // Lead-in before boss spawn (telegraph happens immediately on start()).
    defaultLeadInMs = 2500,

    // Lead-out after boss dies (lets death anim + optional win stinger breathe).
    defaultLeadOutMs = 1000,

    // Optional win/kill stinger SFX when boss dies (before endRun).
    winSfx = null,
  } = {}) {
    this.scene = scene;
    this.mobKey = mobKey;
    this.telegraphSfx = telegraphSfx;
    this.deathSfx = deathSfx;
    this.winSfx = winSfx;

    this.defaultLeadInMs = defaultLeadInMs;
    this.defaultLeadOutMs = defaultLeadOutMs;

    this._started = false;
    this._finishing = false;

    this._boss = null;
    this._spawnTimer = null;

    // IMPORTANT: bossDeath pause sets scene.time.timeScale = 0, so Phaser delayedCall will stall.
    // Use real-time timers for anything that must complete during the cinematic.
    this._leadOutTimeoutId = null;
    this._animFallbackTimeoutId = null;

    // Keep the encounter's control payload so death sequence can use it.
    this._control = null;

    // bind so we can remove listeners cleanly
    this._onEnemyDied = (payload) => this._handleEnemyDied(payload);
  }

  destroy() {
    this._clearSpawnTimer();
    this._clearLeadOutTimeout();
    this._clearAnimFallbackTimeout();
    this.scene?.events?.off('enemy:died', this._onEnemyDied);

    this._boss = null;
    this._started = false;
    this._finishing = false;
    this._control = null;
  }

  start(control = {}) {
    if (this._started) return;
    this._started = true;
    this._control = control ?? {};

    // Listen for death globally; we’ll filter by mobKey.
    this.scene?.events?.on('enemy:died', this._onEnemyDied);

    const leadInMs = Math.max(0, Number(control.leadInMs ?? this.defaultLeadInMs) || 0);
    const telegraphSfx = control.telegraphSfx ?? this.telegraphSfx;

    // Enhancement #1: play telegraph/howl (through SoundManager so bus volume applies)
    this._playSfx(telegraphSfx);

    // Spawn after lead-in (normal run time; not paused yet)
    this._spawnTimer = this.scene?.time?.delayedCall?.(leadInMs, () => {
      this._spawnTimer = null;
      this._spawnBoss(control);
    });
  }

  _spawnBoss(control = {}) {
    if (!this.scene || this.scene.isGameOver) return;
    if (this._boss && this._boss.active) return;

    const radius = Number(control?.spawnRadius ?? control?.spawn?.radius ?? 620) || 620;

    const hero = this.scene.hero?.sprite;
    if (!hero) return;

    const pool = this.scene.enemyPools?.getPool?.(this.mobKey);
    if (!pool?.get) return;

    // pick a point around the hero
    const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const x = hero.x + Math.cos(ang) * radius;
    const y = hero.y + Math.sin(ang) * radius;

    // grab a pooled Enemy
    const enemy = pool.get(x, y);
    if (!enemy) return;

    // hydrate the enemy (your Enemy.reset signature supports mobKey + overrides)
    enemy.reset?.(x, y, this.mobKey, {
      ...(control?.mobOverrides ?? {}),
    });

    // ensure it’s active in physics
    enemy.setActive?.(true);
    enemy.setVisible?.(true);
    enemy.enableBody?.(true, x, y, true, true);

    // let the rest of the game know a boss spawned (so your WerewolfBossController attaches)
    this.scene.events.emit('enemy:spawned', { enemy });

    this._boss = enemy;

    // allow pooling normally until we enter the death cinematic
    enemy._deathSequenceLock = false;
  }

  _handleEnemyDied(payload) {
    if (!payload || payload.mobKey !== this.mobKey) return;
    if (this._finishing) return;

    this._finishing = true;

    const enemy = payload.enemy ?? this._boss;
    if (!enemy) {
      this._finishWin();
      return;
    }

    this._runDeathSequence(enemy);
  }

  _runDeathSequence(enemy) {
    if (!this.scene || this.scene.isGameOver) return;

    // prevent pool cleanup until sequence completes
    enemy._deathSequenceLock = true;

    // Freeze the sim while the cinematic plays.
    // NOTE: this will set this.scene.time.timeScale = 0 in your current GameScene implementation.
    this.scene._acquireSimulationPause?.('bossDeath');

    // stop motion / damage
    enemy.body?.setVelocity?.(0, 0);
    enemy.body?.setAcceleration?.(0, 0);

    const control = this._control ?? {};
    const deathSfx = control.deathSfx ?? this.deathSfx;
    const winSfx = control.winSfx ?? this.winSfx;

    if (winSfx) this._playSfx(winSfx);
    if (deathSfx) this._playSfx(deathSfx);

    const deathAnimKey = control.deathAnimKey ?? 'werewolf:death';

    const finish = () => this._completeDeath(enemy);

    // If we can play the death anim, finish on completion.
    if (enemy.anims && this.scene.anims?.exists?.(deathAnimKey)) {
      enemy.play(deathAnimKey, true);

      let finished = false;
      const finishOnce = () => {
        if (finished) return;
        finished = true;
        this._clearAnimFallbackTimeout();
        finish();
      };

      // Phaser emits ANIMATION_COMPLETE_KEY + key (string concat)
      enemy.once(
        Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + deathAnimKey,
        finishOnce
      );

      // Defensive fallback MUST be real-time because scene.time may be paused.
      // Use a conservative duration; prefer currentAnim.duration if available.
      const animDurationMs = Number(enemy.anims?.currentAnim?.duration ?? 700) || 700;
      const fallbackMs = Math.max(150, animDurationMs + 250);

      this._clearAnimFallbackTimeout();
      this._animFallbackTimeoutId = window.setTimeout(() => {
        this._animFallbackTimeoutId = null;
        finishOnce();
      }, fallbackMs);

      return;
    }

    // If anim can’t play, just finish.
    finish();
  }

  _completeDeath(enemy) {
    if (!this.scene || this.scene.isGameOver) return;

    const control = this._control ?? {};
    const leadOutMs = Math.max(0, Number(control.leadOutMs ?? this.defaultLeadOutMs) || 0);

    // Lead-out MUST be real-time because bossDeath pause stops Phaser's clock.
    this._clearLeadOutTimeout();
    this._leadOutTimeoutId = window.setTimeout(() => {
      this._leadOutTimeoutId = null;

      if (!this.scene || this.scene.isGameOver) return;

      // 🔓 Allow pooling again now that the cinematic is done
      enemy._deathSequenceLock = false;

      // Now we can safely release the sprite back to the pool
      this.scene.enemyPools?.release(enemy);

      // Unpause the world if we paused it for the cinematic
      this.scene._releaseSimulationPause?.('bossDeath');

      // Finally trigger the win flow
      this.scene.endRun('win', { reason: 'bossKilled' });
    }, leadOutMs);
  }

  _finishWin() {
    // If something went wrong mid-cinematic, try to unpause defensively.
    this.scene?._releaseSimulationPause?.('bossDeath');
    this.scene?.endRun?.('win', { reason: 'bossKilled' });
  }

  _clearSpawnTimer() {
    if (this._spawnTimer) {
      this._spawnTimer.remove(false);
      this._spawnTimer = null;
    }
  }

  _clearLeadOutTimeout() {
    if (this._leadOutTimeoutId != null) {
      window.clearTimeout(this._leadOutTimeoutId);
      this._leadOutTimeoutId = null;
    }
  }

  _clearAnimFallbackTimeout() {
    if (this._animFallbackTimeoutId != null) {
      window.clearTimeout(this._animFallbackTimeoutId);
      this._animFallbackTimeoutId = null;
    }
  }

  _playSfx(sfx) {
    if (!sfx) return;

    const sm = this.scene?.soundManager;

    // allow passing a string key: 'sfx.boss.howl'
    if (typeof sfx === 'string') {
      // SoundManager.playSfx applies bus volume (sfx/ui/music) automatically.
      sm?.playSfx?.(sfx, { bus: 'sfx' });
      return;
    }

    // allow passing an object: { key, bus, volume, ... }
    const key = sfx?.key;
    if (!key) return;

    sm?.playSfx?.(key, sfx);
  }
}