import { PauseMenu } from '../../ui/PauseMenu.js';
import { SettingsMenu } from '../../ui/SettingsMenu.js';

export class PauseController {
  constructor(scene) {
    // Pause logic is centralized here so GameScene stays orchestration-only.
    this.scene = scene;
  }

  _getHeroIdleAnimKey() {
    const scene = this.scene;
    const heroEntry = scene.heroEntry ?? null;
    const heroKey = scene.hero?.key ?? heroEntry?.key ?? null;

    // Animation prefix needs to match how HeroAnimations registers keys.
    const prefix = heroEntry?.animationPrefix ?? heroKey ?? heroEntry?.key ?? 'hero';
    const dir = scene.playerFacing ?? heroEntry?.defaultFacing ?? 'down';

    // Prefer direction-aware idle so pause doesn't show the hero "snapping" to down.
    const preferred = `${prefix}:idle-${dir}`;
    if (scene.anims?.exists?.(preferred)) return preferred;

    // Fallback keeps pause safe even if some heroes only ship a single idle.
    const fallback = `${prefix}:idle-down`;
    if (scene.anims?.exists?.(fallback)) return fallback;

    return null;
  }

  isPaused() {
    // Single source of truth for update-loop early-outs.
    return !!this.scene.isSimulationPaused;
  }

  acquire(source = 'unknown') {
    const scene = this.scene;
    if (!scene._pauseSources) {
      // Multiple systems can "own" the pause; we only resume when all release.
      scene._pauseSources = new Set();
    }

    if (scene._pauseSources.has(source)) return;

    const wasEmpty = scene._pauseSources.size === 0;
    scene._pauseSources.add(source);

    if (!wasEmpty) {
      // Someone else already paused; we don't want to stomp their snapshot.
      return;
    }

    // Pause modes:
    // - pauseMenu: hard pause time + physics
    // - levelup: pause time only, but freeze bodies to prevent drift
    // - bossDeath: keep time running for cinematics, but pause physics + freeze bodies
    const pausePhysics = (source === 'pauseMenu' || source === 'bossDeath');
    const freezeBodies = (source === 'levelup' || source === 'bossDeath');
    const pauseTime = (source === 'pauseMenu' || source === 'levelup');
    const pauseHeroAnim = (source === 'pauseMenu' || source === 'bossDeath');

    const heroSprite = scene.hero?.sprite ?? null;
    const heroBody = heroSprite?.body ?? null;

    // Snapshot hero animation state so we can restore the exact run/move pose later.
    const heroWasAnimPlaying = !!heroSprite?.anims?.isPlaying;
    const heroAnimKey = heroSprite?.anims?.currentAnim?.key ?? null;
    const heroAnimProgress = heroSprite?.anims?.getProgress?.() ?? 0;

    // Store a single snapshot when the first pause source is acquired.
    scene._pauseSnapshot = {
      source,
      timeScale: scene.time?.timeScale ?? 1,
      physicsTimeScale: scene.physics?.world?.timeScale ?? 1,
      pausedPhysics: pausePhysics,
      freezeBodies,
      heroBodyWasEnabled: heroBody ? !!heroBody.enable : undefined,
      heroAnim: {
        pauseHeroAnim,
        wasPlaying: heroWasAnimPlaying,
        key: heroAnimKey,
        progress: heroAnimProgress,
        timeScale: heroSprite?.anims?.timeScale ?? 1,
      },
      frozenEnemyBodies: [],
    };

    // Used for "run time" accounting (excludes pauses).
    scene._pausedAt = scene.time?.now ?? 0;

    // Pause timers/tweens that respect TimeScale; GameScene.update() also early-outs.
    if (pauseTime) {
      scene.time.timeScale = 0;
    }

    // Hard pause physics for pause menu and boss cinematics so bodies don't integrate.
    if (pausePhysics && scene.physics?.world) {
      scene.physics.world.timeScale = 0;
      scene.physics.world.pause();
    }

    // Disable player actions while paused (even if time isn't paused during bossDeath).
    scene.playerInputDisabled = true;
    scene.playerCombatDisabled = true;
    scene.isSimulationPaused = true;

    // Stop hero momentum immediately to avoid sliding when bodies are later disabled.
    if (heroBody) {
      heroBody.setVelocity?.(0, 0);
      heroBody.setAcceleration?.(0, 0);
    }

    // For pauseMenu/bossDeath, force an idle so we don't "run in place" during pause.
    if (pauseHeroAnim && heroSprite?.anims) {
      heroSprite.anims.stop();

      const idleKey = this._getHeroIdleAnimKey?.();
      if (idleKey) {
        heroSprite.play(idleKey, true);
        heroSprite.anims.timeScale = 1;
      }
    }

    if (freezeBodies) {
      // Disable hero body so Arcade won't integrate/collide it during the pause window.
      if (heroBody) {
        heroBody.enable = false;
      }

      const group = scene.enemyPools?.getAllGroup?.();
      group?.children?.iterate?.((enemy) => {
        if (!enemy?.active) return;

        // Boss death sequences sometimes keep their own motion/FX timing — don't hard-disable them.
        if (source === 'bossDeath' && (enemy.mobKey === 'werewolf_boss' || enemy._deathSequenceLock)) {
          enemy.body?.setVelocity?.(0, 0);
          enemy.body?.setAcceleration?.(0, 0);
          return;
        }

        const body = enemy?.body;
        if (!body) return;

        body.setVelocity?.(0, 0);
        body.setAcceleration?.(0, 0);

        // Disabling bodies prevents subtle drift while timeScale is paused.
        body.enable = false;
        scene._pauseSnapshot.frozenEnemyBodies.push(enemy);
      });
    } else {
      // Non-freeze pause: stop any currently moving enemies, but keep physics enabled.
      scene.enemyPools?.getAllGroup?.()?.children?.iterate?.((enemy) => {
        if (!enemy?.active) return;
        enemy?.body?.setVelocity?.(0, 0);
        enemy?.body?.setAcceleration?.(0, 0);
      });
    }
  }

  release(source = 'unknown') {
    const scene = this.scene;
    if (!scene._pauseSources?.has?.(source)) return;

    // Only resume when the last pause owner releases.
    scene._pauseSources.delete(source);
    if (scene._pauseSources.size > 0) {
      return;
    }

    // Add this pause duration to the "excluded from run clock" accumulator.
    const now = scene.time?.now ?? 0;
    if (scene._pausedAt != null) {
      const pausedMs = Math.max(0, now - scene._pausedAt);
      scene._totalPausedMs += pausedMs;
      scene._pausedAt = null;
    }

    const snap = scene._pauseSnapshot ?? {};
    scene.time.timeScale = snap.timeScale ?? 1;

    // Restore physics exactly to the pre-pause state.
    if (snap.pausedPhysics && scene.physics?.world) {
      scene.physics.world.timeScale = snap.physicsTimeScale ?? 1;
      scene.physics.world.resume();
    }

    // If bodies were disabled, re-enable them and clear any stale velocities.
    if (snap.freezeBodies) {
      const heroSprite = scene.hero?.sprite ?? null;
      const heroBody = heroSprite?.body ?? null;

      if (heroBody) {
        heroBody.enable = snap.heroBodyWasEnabled ?? true;
        heroBody.setVelocity?.(0, 0);
        heroBody.setAcceleration?.(0, 0);
      }

      const frozen = snap.frozenEnemyBodies;
      if (Array.isArray(frozen)) {
        frozen.forEach((enemy) => {
          const body = enemy?.body;
          if (!body) return;
          body.enable = true;
          body.setVelocity?.(0, 0);
          body.setAcceleration?.(0, 0);
        });
      }
    }

    // Resume hero animation where it left off (best-effort; setProgress may not exist on all Phaser builds).
    const heroSprite = scene.hero?.sprite ?? null;
    const heroAnimSnap = snap.heroAnim ?? null;
    if (heroAnimSnap?.pauseHeroAnim && heroSprite?.anims) {
      if (heroAnimSnap.wasPlaying && heroAnimSnap.key && scene.anims?.exists?.(heroAnimSnap.key)) {
        heroSprite.play(heroAnimSnap.key, true);
        heroSprite.anims.setProgress?.(heroAnimSnap.progress ?? 0);
      } else {
        heroSprite.anims.stop();
      }
      heroSprite.anims.timeScale = heroAnimSnap.timeScale ?? 1;
    }

    // Allow player control again once all pause sources are cleared.
    scene.playerInputDisabled = false;
    scene.playerCombatDisabled = false;
    scene._pauseSnapshot = null;
    scene.isSimulationPaused = false;
  }

  toggleMenu() {
    const scene = this.scene;
    // Guard rails: don't allow pause to fight with shutdown, game over, or level-up modals.
    if (scene._isShuttingDown) return false;
    if (scene.isGameOver) return false;
    if (scene.levelFlow?._modalActive) return false;
    if (scene.settingsMenu) return false;

    if (scene.pauseMenu) {
      this.closeMenu();
    } else {
      this.openMenu();
    }

    return true;
  }

  openMenu() {
    const scene = this.scene;
    if (scene.pauseMenu) return;

    // pauseMenu is a "hard pause" mode, so acquire it before constructing UI.
    this.acquire('pauseMenu');

    scene.pauseMenu = new PauseMenu(scene, {
      onResume: () => this.closeMenu(),
      onMainMenu: () => {
        this.closeMenu();
        scene.time.timeScale = 1; // Defensive: ensure time scale is sane when leaving the run.
        scene.scene.start('menu');
      },
      onSettings: () => this.openSettingsFromPause()
    });
  }

  closeMenu() {
    const scene = this.scene;
    if (!scene.pauseMenu) return;

    scene.pauseMenu.destroy();
    scene.pauseMenu = null;
    this.release('pauseMenu');
  }

  openSettingsFromPause() {
    const scene = this.scene;
    if (scene.settingsMenu) return;

    // Settings is modal UI that should not allow the pause hotkey to reopen menus.
    scene.settingsMenu = new SettingsMenu(scene, {
      soundManager: scene.soundManager,
      onClose: () => {
        scene.settingsMenu?.destroy();
        scene.settingsMenu = null;
      }
    });
  }

  markRunStarted() {
    const scene = this.scene;
    if (scene._runStartedAt != null) return;

    // Run clock starts when the hero is actually spawned into the world.
    const now = scene.time?.now ?? 0;
    scene._runStartedAt = now;
    scene._totalPausedMs = 0;
    scene._pausedAt = null;
    scene.hud?.setStartTime?.(now); // HUD timer must match the same origin.
  }

  getRunElapsedMs() {
    const scene = this.scene;
    if (!Number.isFinite(scene._runStartedAt)) return 0;

    const now = scene.time?.now ?? 0;
    const inFlightPaused = scene._pausedAt != null
      ? Math.max(0, now - scene._pausedAt)
      : 0;
    const totalPaused = scene._totalPausedMs + inFlightPaused;

    // Elapsed time excludes pauses so scripted spawns and timers don't "jump" after resume.
    return Math.max(0, now - scene._runStartedAt - totalPaused);
  }

  getRunElapsedSeconds() {
    return this.getRunElapsedMs() / 1000;
  }
}
