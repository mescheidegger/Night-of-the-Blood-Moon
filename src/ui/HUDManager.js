import Phaser from 'phaser';
import { LoadoutBar } from './LoadoutBar.js';
import { PassiveLoadoutBar } from './PassiveLoadoutBar.js';
import { VirtualJoystick } from './VirtualJoystick.js';
import { PauseButton } from './PauseButton.js';
import { DebugOverlay } from './DebugOverlay.js';
import { PlayerHUD } from './PlayerHUD.js';
import { DEV_RUN } from '../config/gameConfig.js';

/** Provide shouldUseTouchUI so callers can reuse shared logic safely. */
export function shouldUseTouchUI() {
  const hasTouchPoints = (navigator.maxTouchPoints ?? 0) > 0;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)')?.matches ?? false;

  return coarse || (hasTouchPoints && noHover);
}

/**
 * HUDManager owns the on-screen UI for the run (player HUD, loadout bars, debug stats, touch controls).
 * Run timing is based on the scene clock (`scene.time.now`) and/or a clock helper
 * provided by GameScene via `getRunElapsedMs`.
 */
export class HUDManager {
  /** Initialize HUDManager state so runtime dependencies are ready. */
  constructor(
    scene,
    {
      events,
      initialLoadout = [],
      initialPassives = [],
      onPauseRequested,
      startTime = null,
      showDebug = DEV_RUN?.enabled === true,
    } = {}
  ) {
    this.scene = scene;
    this.events = events ?? scene.events;
    this.onPauseRequested = onPauseRequested;

    // May be null until GameScene calls setStartTime()
    this.startTime = startTime;

    // -----------------------------
    // Run stats tracked by HUDManager
    // -----------------------------
    this.totalKills = 0;
    this._onEnemyDied = () => {
      this.totalKills += 1;
    };
    this.events?.on?.('enemy:died', this._onEnemyDied);

    // -----------------------------
    // Bars
    // -----------------------------
    this.loadoutBar = new LoadoutBar(scene, {
      events: this.events,
      cooldownColor: 0xff3b3b,
      cooldownAlpha: 0.35,
      cooldownBlend: Phaser.BlendModes.MULTIPLY,
    });

    if (Array.isArray(initialLoadout) && initialLoadout.length > 0) {
      this.loadoutBar.render(initialLoadout);
    }

    this.passiveBar = new PassiveLoadoutBar(scene, {
      events: this.events,
      getStackCount: (key) => this.scene.passiveManager?.getStackCount?.(key) ?? 0
    });

    this.passiveBar.render(initialPassives ?? []);

    // -----------------------------
    // Player-facing HUD (new)
    // -----------------------------
    this.playerHUD = new PlayerHUD(scene, { depth: 70 });
    this.playerHUD.setVisible(true);

    // -----------------------------
    // Debug overlay (existing, kept separate)
    // -----------------------------
    this.isDebugVisible = !!showDebug;
    this.debugOverlay = new DebugOverlay(scene, { depth: 75 });
    this.debugOverlay.setVisible(this.isDebugVisible);

    // -----------------------------
    // Touch controls
    // -----------------------------
    this.joystick = null;
    this.pauseButton = null;
    this._onHybridTouchStart = null;

    this._createTouchControls = () => {
      if (!this.joystick) {
        this.joystick = new VirtualJoystick(scene, { depth: 60, radius: 52 });
      }
      if (!this.pauseButton && typeof this.onPauseRequested === 'function') {
        this.pauseButton = new PauseButton(scene, { depth: 65, size: 44, onPause: this.onPauseRequested });
      }
    };

    if (shouldUseTouchUI()) {
      this._createTouchControls();
    } else {
      this._onHybridTouchStart = (pointer) => {
        if (this.joystick) return;
        if (pointer?.pointerType !== 'touch') return;

        this._createTouchControls();
        this._onResize({ width: scene.scale.width, height: scene.scale.height });

        this.scene.input?.off('pointerdown', this._onHybridTouchStart);
        this._onHybridTouchStart = null;
      };
      this.scene.input?.on('pointerdown', this._onHybridTouchStart);
    }

    // -----------------------------
    // Debug toggles
    // -----------------------------
    this._onToggleDebug = () => {
      this.isDebugVisible = !this.isDebugVisible;
      this.debugOverlay?.setVisible(this.isDebugVisible);
    };

    this.scene.input?.keyboard?.on('keydown-F3', this._onToggleDebug);
    this.scene.input?.keyboard?.on('keydown-BACKTICK', this._onToggleDebug);

    // -----------------------------
    // Layout helper (run now + on real resizes)
    // -----------------------------
    this._onResize = (gameSize) => {
      const width = (gameSize?.width ?? this.scene.scale.width);
      const height = (gameSize?.height ?? this.scene.scale.height);

      const loadoutScale = this.loadoutBar?.scale ?? 1;
      const passiveScale = this.passiveBar?.scale ?? 1;
      const iconSize = 36 * loadoutScale;

      const loadoutSlots = Math.min(this.loadoutBar?._lastLoadout?.length ?? 0, this.loadoutBar?.maxSlots ?? 0);
      const passiveSlots = Math.min(this.passiveBar?._lastLoadout?.length ?? 0, this.passiveBar?.maxSlots ?? 0);

      const padding = 8;
      const rowGap = 4;
      const pauseButtonSize = this.pauseButton?.size ?? 0;
      const pausePadding = 12;

      const loadoutWidth = loadoutSlots > 0
        ? (loadoutSlots - 1) * (this.loadoutBar?.spacing ?? 40) + iconSize
        : iconSize;

      const passiveWidth = passiveSlots > 0
        ? (passiveSlots - 1) * (this.passiveBar?.spacing ?? 40) + 36 * passiveScale
        : 36 * passiveScale;

      const loadoutX = width - padding - loadoutWidth + 2 * loadoutScale;
      const passiveX = width - padding - passiveWidth + 2 * passiveScale;

      const loadoutY = height - (iconSize * 0.5 + padding);
      const passiveY = loadoutY - iconSize - rowGap;

      this.loadoutBar?.setPosition(loadoutX, loadoutY);
      this.passiveBar?.setPosition(passiveX, passiveY);

      // Top-left overlays
      this.playerHUD?.setPosition(padding, padding);

      // Keep debug separate (slightly lower) so both can coexist when debug is enabled
      const debugOffsetY = 64; // enough to clear PlayerHUD height
      this.debugOverlay?.setPosition(padding, padding + debugOffsetY);

      if (this.joystick) {
        this.joystick.setPosition(80, height - 80);
      }

      if (this.pauseButton) {
        this.pauseButton.setPosition(
          width - pausePadding - pauseButtonSize * 0.5,
          pausePadding + pauseButtonSize * 0.5
        );
      }
    };

    scene.scale.on('resize', this._onResize);
    this._onResize({ width: scene.scale.width, height: scene.scale.height });

    // -----------------------------
    // Update cadence control
    // -----------------------------
    this._nextStatsAt = 0;
  }

  /**
   * Called by GameScene when the run actually starts (first frame hero is live).
   */
  setStartTime(startTime) {
    this.startTime = startTime;
  }

  /** Compute run elapsed ms using the scene helper if available. */
  _getElapsedMs(now) {
    if (typeof this.scene.getRunElapsedMs === 'function') {
      return this.scene.getRunElapsedMs();
    }
    const effectiveStart = Number.isFinite(this.startTime) ? this.startTime : now;
    return Math.max(0, now - effectiveStart);
  }

  /**
   * Refresh HUD stats at a coarse cadence.
   * Uses the scene clock so it respects timeScale and scene lifecycle.
   */
  update() {
    const now = this.scene?.time?.now ?? 0;

    // ~4 times per second, stable cadence
    if (now < (this._nextStatsAt ?? 0)) return;
    this._nextStatsAt = now + 250;

    const elapsedMs = this._getElapsedMs(now);

    const xp = this.scene.playerXP ?? 0;

    this.playerHUD?.setStats({
      elapsedMs,
      kills: this.totalKills,
      xp,
    });


    // Debug overlay updates only if present (and can be toggled)
    if (this.debugOverlay) {
      const enemyGroup = this.scene.enemyPools?.getAllGroup?.();
      const enemies = enemyGroup?.countActive?.(true) ?? 0;
      const drops = this.scene.dropManager?.getGroup?.()?.countActive?.(true) ?? 0;
      const xp = this.scene.playerXP ?? 0;

      this.debugOverlay.setStats({
        elapsedSeconds: elapsedMs / 1000,
        enemies,
        drops,
        xp,
      });
    }
  }

  /** Handle getMoveVector so this system stays coordinated. */
  getMoveVector() {
    return this.joystick ? this.joystick.getVector() : { x: 0, y: 0 };
  }

  /**
   * Remove resize listeners and destroy HUD display objects.
   */
  destroy() {
    this.scene.scale.off('resize', this._onResize);

    if (this._onHybridTouchStart) {
      this.scene.input?.off('pointerdown', this._onHybridTouchStart);
      this._onHybridTouchStart = null;
    }

    this.scene.input?.keyboard?.off('keydown-F3', this._onToggleDebug);
    this.scene.input?.keyboard?.off('keydown-BACKTICK', this._onToggleDebug);

    this.events?.off?.('enemy:died', this._onEnemyDied);
    this._onEnemyDied = null;

    this.loadoutBar?.destroy();
    this.passiveBar?.destroy();
    this.playerHUD?.destroy();
    this.debugOverlay?.destroy();
    this.joystick?.destroy();
    this.pauseButton?.destroy();

    this.scene = null;
    this.events = null;
    this.onPauseRequested = null;

    this.loadoutBar = null;
    this.passiveBar = null;
    this.playerHUD = null;
    this.debugOverlay = null;
    this.joystick = null;
    this.pauseButton = null;

    this.totalKills = 0;
    this._nextStatsAt = 0;
  }
}
