import Phaser from 'phaser';

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 200;
const PANEL_DEPTH = 360;
const BUTTON_WIDTH = 160;
const BUTTON_HEIGHT = 42;
const BUTTON_SPACING = 16;

export class SettingsMenu {
  /** Initialize SettingsMenu state so runtime dependencies are ready. */
  constructor(scene, { soundManager, onClose, depthBase = 0 } = {}) {
    this.scene = scene;
    this.soundManager = soundManager;
    this.onClose = onClose;
    this.depthBase = depthBase;
    this.destroyed = false;
    this.keyListeners = [];

    this.sfxVolume = Phaser.Math.Clamp(this.soundManager?.getBusVolume?.('sfx') ?? 1.0, 0, 1);
    this.musicVolume = Phaser.Math.Clamp(this.soundManager?.getBusVolume?.('music') ?? 1.0, 0, 1);

    this._build();
  }

  /** Handle _build so this system stays coordinated. */
  _build() {
    const { width, height } = this.scene.scale;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const baseDepth = Number.isFinite(this.depthBase) ? this.depthBase : 0;
    const panelDepth = baseDepth + PANEL_DEPTH;

    this.backdrop = this.scene.add.rectangle(0, 0, width, height, 0x050208, 0.55)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(panelDepth)
      .setInteractive({ cursor: 'default' });

    this.panel = this.scene.add.container(centerX, centerY)
      .setDepth(panelDepth + 1)
      .setScrollFactor(0)
      .setAlpha(0);

    const panelBg = this.scene.add.rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 0x0f1424, 0.96)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0xff5d88, 0.9)
      .setInteractive({ cursor: 'default' });

    // ---------------------------
    // Title (top anchored)
    // ---------------------------
    const titleY = -PANEL_HEIGHT / 2 + 28;
    const title = this.scene.add.text(0, titleY, 'SETTINGS', {
      font: '24px monospace',
      color: '#ffbed8',
      align: 'center'
    }).setOrigin(0.5);

    // ---------------------------
    // Volume Rows (top anchored)
    // ---------------------------
    const sfxRowY = -PANEL_HEIGHT / 2 + 72;   // relative-to-top placement
    const musicRowY = sfxRowY + 48;

    const sfxRowParts = this._createVolumeRow({
      y: sfxRowY,
      labelText: this._formatSfxLabel(),
      onMinus: () => this._bumpSfx(-0.1),
      onPlus: () => this._bumpSfx(0.1),
      panelDepth
    });
    const { container: sfxRow, label: sfxLabel } = sfxRowParts;
    this.sfxLabel = sfxLabel;
    this.sfxRowParts = sfxRowParts;

    const musicRowParts = this._createVolumeRow({
      y: musicRowY,
      labelText: this._formatMusicLabel(),
      onMinus: () => this._bumpMusic(-0.1),
      onPlus: () => this._bumpMusic(0.1),
      panelDepth
    });
    const { container: musicRow, label: musicLabel } = musicRowParts;
    this.musicLabel = musicLabel;
    this.musicRowParts = musicRowParts;

    // ---------------------------
    // Back button (bottom anchored)
    // ---------------------------
    const backButtonY = PANEL_HEIGHT / 2 - BUTTON_HEIGHT / 2 - BUTTON_SPACING;

    const backButton = this._createButton(
      'Back (Esc)',
      0,
      backButtonY,
      () => this.close(),
      BUTTON_WIDTH,
      BUTTON_HEIGHT,
      panelDepth
    );

    this.panel.add([panelBg, title, sfxRow, musicRow, backButton]);

    this.scene.tweens.add({
      targets: this.panel,
      alpha: 1,
      duration: 140,
      ease: 'Sine.easeOut'
    });

    this.backdrop.once('pointerup', () => this.close());

    this._bindKeys();
  }


  /** Handle _createButton so this system stays coordinated. */
  _createButton(label, x, y, handler, widthOverride = BUTTON_WIDTH, heightOverride = BUTTON_HEIGHT, panelDepth = PANEL_DEPTH) {
    const container = this.scene.add.container(x, y)
      .setScrollFactor(0)
      .setDepth(panelDepth + 2)
      .setSize(widthOverride, heightOverride)
      .setInteractive({ useHandCursor: true });

    const bg = this.scene.add.rectangle(0, 0, widthOverride, heightOverride, 0x2c112d, 0.94)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0xff759b, 0.92);

    const text = this.scene.add.text(0, 0, label, {
      font: '18px monospace',
      color: '#ffe9f2'
    }).setOrigin(0.5);

    const reset = () => bg.setFillStyle(0x2c112d, 0.94);

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

  /** Handle _createVolumeRow so this system stays coordinated. */
  _createVolumeRow({ y, labelText, onMinus, onPlus, panelDepth = PANEL_DEPTH }) {
    const container = this.scene.add.container(0, y).setDepth(panelDepth + 2);

    const label = this.scene.add.text(0, 0, labelText, {
      font: '18px monospace',
      color: '#ffe7f5',
      align: 'left'
    }).setOrigin(0.5);

    const SMALL_WIDTH = 40;
    const SMALL_HEIGHT = 32;
    const INNER_SPACING = 8;

    const minusButton = this._createButton(
      '−',
      0,
      0,
      onMinus,
      SMALL_WIDTH,
      SMALL_HEIGHT,
      panelDepth
    );

    const plusButton = this._createButton(
      '+',
      0,
      0,
      onPlus,
      SMALL_WIDTH,
      SMALL_HEIGHT,
      panelDepth
    );

    container.add([label, minusButton, plusButton]);

    const row = { container, label, minusButton, plusButton, innerSpacing: INNER_SPACING, smallWidth: SMALL_WIDTH };
    this._layoutVolumeRow(row);
    return row;
  }

  /** Handle _layoutVolumeRow so this system stays coordinated. */
  _layoutVolumeRow(row) {
    if (!row?.label || !row.minusButton || !row.plusButton) return;

    const labelWidth = row.label.width;
    const totalWidth = labelWidth + row.innerSpacing + row.smallWidth + row.innerSpacing + row.smallWidth;
    const startX = -totalWidth / 2;

    const labelX = startX + labelWidth / 2;
    const minusX = labelX + labelWidth / 2 + row.innerSpacing + row.smallWidth / 2;
    const plusX = minusX + row.smallWidth + row.innerSpacing;

    row.label.setPosition(labelX, 0);
    row.minusButton.setPosition(minusX, 0);
    row.plusButton.setPosition(plusX, 0);
  }

  /** Handle _bindKeys so this system stays coordinated. */
  _bindKeys() {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;

    const escHandler = (event) => {
      event?.stopPropagation?.();
      event?.preventDefault?.();
      this.close();
    };

    keyboard.on('keydown-ESC', escHandler);
    this.keyListeners.push({ evt: 'keydown-ESC', handler: escHandler });
  }

  /** Handle _bumpSfx so this system stays coordinated. */
  _bumpSfx(delta) {
    if (!this.soundManager) return;
    this.sfxVolume = Phaser.Math.Clamp(this.sfxVolume + delta, 0, 1);
    this.soundManager.setBusVolume('sfx', this.sfxVolume);
    this.soundManager.saveToStorage();
    this.sfxLabel.setText(this._formatSfxLabel());
    this._layoutVolumeRow(this.sfxRowParts);
  }

  /** Handle _formatSfxLabel so this system stays coordinated. */
  _formatSfxLabel() {
    const pct = Math.round(this.sfxVolume * 100);
    return `SFX Volume: ${pct}%`;
  }

  /** Handle _bumpMusic so this system stays coordinated. */
  _bumpMusic(delta) {
    if (!this.soundManager) return;
    this.musicVolume = Phaser.Math.Clamp(this.musicVolume + delta, 0, 1);
    this.soundManager.setBusVolume('music', this.musicVolume);
    this.soundManager.saveToStorage();
    this.musicLabel.setText(this._formatMusicLabel());
    this._layoutVolumeRow(this.musicRowParts);
  }

  /** Handle _formatMusicLabel so this system stays coordinated. */
  _formatMusicLabel() {
    const pct = Math.round(this.musicVolume * 100);
    return `Music Volume: ${pct}%`;
  }

  /** Handle close so this system stays coordinated. */
  close() {
    if (this.destroyed) return;
    this.onClose?.();
    this.destroy();
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
