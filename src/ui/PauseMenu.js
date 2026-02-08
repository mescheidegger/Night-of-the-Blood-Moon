const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 300;
const PANEL_DEPTH = 240;
const BUTTON_WIDTH = 200;
const BUTTON_HEIGHT = 48;
const PANEL_PADDING = 24;
const BUTTON_SPACING = 16;

export class PauseMenu {
  /**
   * @param {Phaser.Scene} scene
   * @param {{ onResume?: Function, onMainMenu?: Function, onSettings?: Function }} config
   */
  constructor(scene, { onResume, onMainMenu, onSettings, depthBase = 0 } = {}) {
    this.scene = scene;
    this.onResume = onResume;
    this.onMainMenu = onMainMenu;
    this.onSettings = onSettings;
    this.depthBase = depthBase;
    this.destroyed = false;
    this.keyListeners = [];

    this.build();
  }

  /** Handle build so this system stays coordinated. */
  build() {
    const { width, height } = this.scene.scale;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const baseDepth = Number.isFinite(this.depthBase) ? this.depthBase : 0;
    const panelDepth = baseDepth + PANEL_DEPTH;

    this.backdrop = this.scene.add.rectangle(0, 0, width, height, 0x050208, 0.5)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(panelDepth)
      .setInteractive({ cursor: 'default' });

    this.panel = this.scene.add.container(centerX, centerY)
      .setDepth(panelDepth + 1)
      .setScrollFactor(0)
      .setAlpha(0);

    const panelBg = this.scene.add.rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 0x1a0c1f, 0.94)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0xff5d88, 0.9);

    const title = this.scene.add.text(0, 0, 'PAUSED', {
      font: '28px monospace',
      color: '#ff6b81',
      align: 'center'
    }).setOrigin(0.5);

    const subtitle = this.scene.add.text(0, 0, 'Night of the Blood Moon', {
      font: '16px monospace',
      color: '#f7cfe3',
      align: 'center'
    }).setOrigin(0.5);

    // Layout from the top inside edge of the panel
    const halfHeight = PANEL_HEIGHT / 2;
    let cursorY = -halfHeight + PANEL_PADDING;

    const placeText = (text, spacingAfter) => {
      const textHeight = text.height;
      text.setY(cursorY + textHeight / 2);
      cursorY += textHeight + spacingAfter;
    };

    // Title + subtitle
    placeText(title, 8);
    placeText(subtitle, 16);

    // Now place buttons below subtitle
    const resumeButton = this._createButton('Resume', 0, () => this.handleResume(), panelDepth);
    const settingsButton = this._createButton('Settings', 0, () => this.handleSettings(), panelDepth);
    const menuButton = this._createButton('Main Menu', 0, () => this.handleMainMenu(), panelDepth);

    // First button position
    const buttonTopMargin = 8; // gap between subtitle and first button
    const firstButtonCenterY = cursorY + buttonTopMargin + BUTTON_HEIGHT / 2;
    resumeButton.setY(firstButtonCenterY);

    // Second button positioned relative to first
    const secondButtonCenterY = firstButtonCenterY + BUTTON_HEIGHT + BUTTON_SPACING;
    settingsButton.setY(secondButtonCenterY);

    const thirdButtonCenterY = secondButtonCenterY + BUTTON_HEIGHT + BUTTON_SPACING;
    menuButton.setY(thirdButtonCenterY);

    this.panel.add([panelBg, title, subtitle, resumeButton, settingsButton, menuButton]);

    this.scene.tweens.add({
      targets: this.panel,
      alpha: 1,
      duration: 160,
      ease: 'Sine.easeOut'
    });

    this._bindKeys();
  }

  /** Handle _createButton so this system stays coordinated. */
  _createButton(label, y, handler, panelDepth) {
    const container = this.scene.add.container(0, y)
      .setScrollFactor(0)
      .setDepth(panelDepth + 2)
      .setSize(BUTTON_WIDTH, BUTTON_HEIGHT)
      .setInteractive({ useHandCursor: true });

    const bg = this.scene.add.rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 0x2c112d, 0.92)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0xff759b, 0.9);

    const text = this.scene.add.text(0, 0, label, {
      font: '20px monospace',
      color: '#ffe9f2'
    }).setOrigin(0.5);

    const reset = () => bg.setFillStyle(0x2c112d, 0.92);

    container.on('pointerover', () => {
      bg.setFillStyle(0x3b1a42, 0.98);
    });

    container.on('pointerout', reset);

    container.on('pointerdown', () => {
      bg.setFillStyle(0x1d071f, 1);
    });

    container.on('pointerup', () => {
      reset();
      handler();
    });

    container.on('pointerupoutside', reset);

    container.add([bg, text]);
    return container;
  }

  /** Handle _bindKeys so this system stays coordinated. */
  _bindKeys() {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;

    const resumeHandler = (event) => {
      event?.stopPropagation?.();
      event?.preventDefault?.();
      this.handleResume();
    };

    const mainMenuHandler = (event) => {
      event?.stopPropagation?.();
      event?.preventDefault?.();
      this.handleMainMenu();
    };

    // Resume: Esc, P, Enter, Space
    ['keydown-ESC', 'keydown-P', 'keydown-ENTER', 'keydown-SPACE'].forEach((evt) => {
      keyboard.on(evt, resumeHandler);
      this.keyListeners.push({ evt, handler: resumeHandler });
    });

    // Main menu: M
    keyboard.on('keydown-M', mainMenuHandler);
    this.keyListeners.push({ evt: 'keydown-M', handler: mainMenuHandler });
  }

  /** Handle handleResume so this system stays coordinated. */
  handleResume() {
    if (this.destroyed || this.scene?.settingsMenu) return;
    this.onResume?.();
  }

  /** Handle handleMainMenu so this system stays coordinated. */
  handleMainMenu() {
    if (this.destroyed || this.scene?.settingsMenu) return;
    this.onMainMenu?.();
  }

  /** Handle handleSettings so this system stays coordinated. */
  handleSettings() {
    if (this.destroyed) return;
    this.onSettings?.();
  }

  /** Handle destroy so this system stays coordinated. */
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
  }
}
