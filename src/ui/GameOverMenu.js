// Tunable layout constants that roughly mirror the main menu styling.  The
// height value acts as a minimum; the panel expands when content requires
// additional vertical space to keep the buttons from overlapping the stats.
const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 280;
const PANEL_DEPTH = 260;
const BUTTON_WIDTH = 200;
const BUTTON_HEIGHT = 48;
const PANEL_PADDING = 24;
const BUTTON_SPACING = 16;
const MIN_CONTENT_BUTTON_GAP = 12;

/**
 * Simple overlay presented after the end-of-run flow wraps.  Blocks all
 * gameplay input, displays the run stats, and exposes callbacks for the
 * supported actions (primary + main menu).
 */
export class EndRunMenu {
  /**
   * @param {Phaser.Scene} scene
   * @param {{
   *   stats?: {
   *     timeSurvived?: number,            // seconds (legacy)
   *     kills?: number,
   *     xpEarned?: number,
   *     damageDealt?: number,
   *     // or RunStatsTracker snapshot shape:
   *     timeSurvivedSeconds?: number,
   *     timeSurvivedMs?: number,
   *   },
   *   title?: string,
   *   subtitle?: string,
   *   primaryLabel?: string,
   *   onPrimary?: Function,
   *   onRetry?: Function,
   *   onMainMenu?: Function
   * }} [config]
   */
  constructor(scene, {
    stats = {},
    title = 'YOU DIED',
    subtitle = 'Night of the Blood Moon',
    primaryLabel = 'Retry',
    depthBase = 0,
    onPrimary,
    onRetry,
    onMainMenu
  } = {}) {
    this.scene = scene;
    this.stats = stats ?? {};
    this.title = title;
    this.subtitle = subtitle;
    this.primaryLabel = primaryLabel;
    this.depthBase = depthBase;
    this.onPrimary = onPrimary ?? onRetry;
    this.onMainMenu = onMainMenu;
    this.destroyed = false;
    this.keyListeners = [];

    this.build();
  }

  /**
   * Constructs the overlay immediately during instantiation.  Everything is
   * screen-space with scroll factor 0 so it never drifts with the camera, and
   * every object is tracked for teardown in `destroy()`.
   */
  build() {
    const { width, height } = this.scene.scale;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const baseDepth = Number.isFinite(this.depthBase) ? this.depthBase : 0;
    const panelDepth = baseDepth + PANEL_DEPTH;
    this.panelDepth = panelDepth;

    // Backdrop swallows pointer input so gameplay never receives clicks.  We
    // intentionally avoid hooking events here; its sole job is to block
    // propagation into the game scene while letting button interactions pass
    // through.
    this.backdrop = this.scene.add.rectangle(0, 0, width, height, 0x050208, 0.78)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(panelDepth)
      .setInteractive({ cursor: 'default' });

    this.panel = this.scene.add.container(centerX, centerY)
      .setDepth(panelDepth + 1)
      .setScrollFactor(0)
      .setAlpha(0);

    let panelHeight = PANEL_HEIGHT;
    const panelBg = this.scene.add.rectangle(0, 0, PANEL_WIDTH, panelHeight, 0x1a0c1f, 0.94)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0xff5d88, 0.9);

    // Static text blocks: title + subtitle are fixed strings, whereas stats may
    // grow based on run data.  We measure everything during layout so the
    // spacing responds to the actual rendered height.
    const title = this.scene.add.text(0, 0, this.title, {
      font: '32px monospace',
      color: '#ff6b81',
      align: 'center'
    }).setOrigin(0.5);

    const subtitle = this.scene.add.text(0, 0, this.subtitle, {
      font: '16px monospace',
      color: '#f7cfe3',
      align: 'center'
    }).setOrigin(0.5);

    const statsLines = this.composeStats();
    const statsText = this.scene.add.text(0, 0, statsLines.join('\n'), {
      font: '16px monospace',
      color: '#cfd6ff',
      align: 'center',
      wordWrap: {
        width: PANEL_WIDTH - PANEL_PADDING * 2,
        useAdvancedWrap: true
      }
    }).setOrigin(0.5);

    // Buttons mirror the interactive container approach used in MenuScene so
    // the behaviour feels identical between start and game-over menus.
    const menuButton = this.createButton('Main Menu', 0, () => this.handleMainMenu());
    const primaryButton = this.createButton(this.primaryLabel, 0, () => this.handlePrimary());

    const layoutPanel = () => {
      // Cursor begins at the top inside edge of the panel.  Each text element
      // bumps the cursor by its rendered height plus a configurable spacer so
      // multi-line stats never overlap the buttons further down.
      let cursorY = -(panelHeight / 2) + PANEL_PADDING;

      const placeText = (text, spacingAfter) => {
        const textHeight = text.height;
        text.setY(cursorY + textHeight / 2);
        cursorY += textHeight + spacingAfter;
      };

      placeText(title, 8);
      placeText(subtitle, 12);
      placeText(statsText, 0);

      // Buttons anchor from the panel bottom upward to guarantee a consistent
      // stack regardless of how tall the panel grows.
      const bottomY = (panelHeight / 2) - PANEL_PADDING - (BUTTON_HEIGHT / 2);
      menuButton.setY(bottomY);
      primaryButton.setY(bottomY - (BUTTON_HEIGHT + BUTTON_SPACING));

      const buttonsTopY = primaryButton.y - (BUTTON_HEIGHT / 2);
      return { cursorY, buttonsTopY };
    };

    let { cursorY, buttonsTopY } = layoutPanel();

    // If content and buttons collide we enlarge the panel background and rerun
    // the layout pass.  This keeps the gap stable even if future stats add
    // additional lines.
    if (cursorY + MIN_CONTENT_BUTTON_GAP > buttonsTopY) {
      const needed = (cursorY + MIN_CONTENT_BUTTON_GAP) - buttonsTopY;
      panelHeight += needed;
      panelBg.setSize(PANEL_WIDTH, panelHeight);
      ({ cursorY, buttonsTopY } = layoutPanel());
    }

    this.panel.add([panelBg, title, subtitle, statsText, primaryButton, menuButton]);

    // Alpha-only ease-in so the panel feels responsive without meddling with
    // container scale (important for reliable pointer hit testing).
    this.scene.tweens.add({
      targets: this.panel,
      alpha: 1,
      duration: 160,
      ease: 'Sine.easeOut'
    });

    this.bindKeys();
  }

  /** Normalize stats so EndRunMenu accepts either legacy fields or RunStatsTracker snapshot shape. */
  _normalizeStats() {
    const s = this.stats ?? {};

    // Prefer RunStatsTracker snapshot shape
    const timeSecondsFromSnapshot = Number(s.timeSurvivedSeconds);
    const timeMsFromSnapshot = Number(s.timeSurvivedMs);

    let timeSurvivedSeconds;
    if (Number.isFinite(timeSecondsFromSnapshot)) {
      timeSurvivedSeconds = timeSecondsFromSnapshot;
    } else if (Number.isFinite(timeMsFromSnapshot)) {
      timeSurvivedSeconds = timeMsFromSnapshot / 1000;
    } else {
      // Legacy field: timeSurvived is already seconds
      const legacy = Number(s.timeSurvived);
      timeSurvivedSeconds = Number.isFinite(legacy) ? legacy : 0;
    }

    const kills = Number.isFinite(Number(s.kills)) ? Number(s.kills) : null;
    const xpEarned = Number.isFinite(Number(s.xpEarned)) ? Number(s.xpEarned) : null;
    const damageDealt = Number.isFinite(Number(s.damageDealt)) ? Number(s.damageDealt) : null;

    return {
      timeSurvivedSeconds: Math.max(0, timeSurvivedSeconds || 0),
      kills: kills == null ? null : Math.max(0, kills),
      xpEarned: xpEarned == null ? null : Math.max(0, xpEarned),
      damageDealt: damageDealt == null ? null : Math.max(0, damageDealt),
    };
  }

  /**
   * Generates the lines displayed in the stats block.  Additional metrics can
   * be appended here without touching layout code elsewhere.
   */
  composeStats() {
    const s = this._normalizeStats();

    const lines = [];
    const timeSurvived = s.timeSurvivedSeconds;

    const minutes = Math.floor(timeSurvived / 60);
    const seconds = timeSurvived - minutes * 60;
    const formatted = minutes > 0
      ? `${minutes}m ${seconds.toFixed(1)}s`
      : `${seconds.toFixed(1)}s`;

    lines.push(`Time Survived: ${formatted}`);

    if (typeof s.kills === 'number') {
      lines.push(`Enemies Defeated: ${s.kills}`);
    }

    if (typeof s.xpEarned === 'number') {
      lines.push(`XP Earned: ${s.xpEarned}`);
    }

    // Total Damage Dealt
    if (typeof s.damageDealt === 'number') {
      lines.push(`Damage Dealt: ${Math.round(s.damageDealt)}`);
    }

    return lines;
  }

  /**
   * Builds a button container matching the menu scene behaviour.  The
   * container itself is interactive, which keeps pointer coordinates stable if
   * the panel ever animates.
   */
  createButton(label, y, handler) {
    const container = this.scene.add.container(0, y)
      .setScrollFactor(0)
      .setDepth((this.panelDepth ?? PANEL_DEPTH) + 2)
      .setSize(BUTTON_WIDTH, BUTTON_HEIGHT)
      .setInteractive({ useHandCursor: true });

    const bg = this.scene.add.rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 0x2c112d, 0.92)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0xff759b, 0.9);

    const text = this.scene.add.text(0, 0, label, {
      font: '20px monospace',
      color: '#ffe9f2'
    }).setOrigin(0.5);

    const resetVisual = () => {
      bg.setFillStyle(0x2c112d, 0.92);
    };

    container.on('pointerover', () => {
      bg.setFillStyle(0x3b1a42, 0.98);
    });

    const restoreIdle = () => {
      resetVisual();
    };

    container.on('pointerout', () => {
      restoreIdle();
    });

    container.on('pointerdown', () => {
      bg.setFillStyle(0x1d071f, 1);
    });

    container.on('pointerup', () => {
      resetVisual();
      handler();
    });

    container.on('pointerupoutside', () => {
      restoreIdle();
    });

    container.add([bg, text]);
    return container;
  }

  /**
   * Mirrors the button callbacks with keyboard shortcuts so the menu is fully
   * operable via mouse, keyboard, or controller (mapped to key events).
   */
  bindKeys() {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;

    const primaryHandler = (event) => {
      event?.stopPropagation?.();
      event?.preventDefault?.();
      this.handlePrimary();
    };
    const mainMenuHandler = (event) => {
      event?.stopPropagation?.();
      event?.preventDefault?.();
      this.handleMainMenu();
    };

    const primaryEvents = ['keydown-R', 'keydown-ENTER', 'keydown-SPACE'];
    primaryEvents.forEach(evt => {
      keyboard.on(evt, primaryHandler);
      this.keyListeners.push({ evt, handler: primaryHandler });
    });

    keyboard.on('keydown-M', mainMenuHandler);
    this.keyListeners.push({ evt: 'keydown-M', handler: mainMenuHandler });
  }

  /** Forward the primary action if the overlay is still active. */
  handlePrimary() {
    if (this.destroyed) return;
    this.onPrimary?.();
  }

  /** Forward the main menu request if the overlay is still active. */
  handleMainMenu() {
    if (this.destroyed) return;
    this.onMainMenu?.();
  }

  /**
   * Cleans up overlay objects and key listeners.  Safe to call multiple times
   * and automatically invoked by the owning scene during shutdown.
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    const keyboard = this.scene?.input?.keyboard;
    if (keyboard) {
      this.keyListeners.forEach(({ evt, handler }) => {
        keyboard.off(evt, handler);
      });
    }
    this.keyListeners.length = 0;

    this.backdrop?.destroy();
    this.panel?.destroy(true);

    this.scene = null;
    this.stats = null;
  }
}

// Backwards-compatible export for existing imports.
export const GameOverMenu = EndRunMenu;
