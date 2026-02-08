import Phaser from 'phaser';

// Modal panel dimensions + depth layering
const PANEL_WIDTH = 680;
const PANEL_HEIGHT = 260;
const PANEL_DEPTH = 50;
const CARD_WIDTH = 150;
const CARD_HEIGHT = 260;
const CARD_SPACING = 18;

export class LevelUpModal {
  /**
   * Displays a blocking "Level Up" modal that pauses gameplay visually and
   * lets the player choose between weapon unlocks or a health restore.
   */
  constructor(scene, { level = 1, choices = null, onSelect, onClose, depthBase = 0 } = {}) {
    this.scene = scene;
    this.level = level;
    this.onSelect = onSelect;
    this.onClose = onClose;
    this._closed = false;
    this.choices = Array.isArray(choices) ? choices.slice() : null;
    this.choiceCards = [];
    this.focusIndex = 0;

    this._capturedKeys = [
      Phaser.Input.Keyboard.KeyCodes.ENTER,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.A,
      Phaser.Input.Keyboard.KeyCodes.D,
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.W,
      Phaser.Input.Keyboard.KeyCodes.S
    ];

    const { width, height } = scene.scale;
    const baseDepth = Number.isFinite(depthBase) ? depthBase : 0;
    const panelDepth = baseDepth + PANEL_DEPTH;

    this.backdrop = scene.add.rectangle(0, 0, width, height, 0x050208, 0.65)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(panelDepth)
      .setInteractive({ cursor: 'default' });

    this.backdrop.disableInteractive(); // <- important: let clicks pass through

    this.container = scene.add.container(width / 2, height / 2)
      .setScrollFactor(0)
      .setDepth(panelDepth + 1);

    this.container.setDepth(panelDepth + 1);

    this._buildPanel();

    this._onResize = (size) => {
      if (!size) return;
      this.backdrop.setSize(size.width, size.height);
      this.container.setPosition(size.width / 2, size.height / 2);
    };
    scene.scale.on('resize', this._onResize);

    this._onKeyDown = (event) => this._handleKeyDown(event);
    this.scene.input.keyboard.on('keydown', this._onKeyDown);

    this._capturedKeys.forEach((code) => {
      this.scene.input.keyboard.addCapture(code);
    });

    if (this.choiceCards.length > 0) {
      this._setFocus(Math.min(this.focusIndex, this.choiceCards.length - 1));
    }
  }

  /** Handle _buildPanel so this system stays coordinated. */
  _buildPanel() {
    const hasChoices = Array.isArray(this.choices) && this.choices.length > 0;

    const panelHeight = hasChoices
      ? CARD_HEIGHT + 200 // dynamic spacing for title + subtitle + prompt
      : 160;

    const panel = this.scene.add.rectangle(0, 0, PANEL_WIDTH, panelHeight, 0x1a0c1f, 0.94)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x6be3ff, 0.9);

    const title = this.scene.add.text(0, -panelHeight / 2 + 32, 'LEVEL UP', {
      font: '28px monospace',
      color: '#6be3ff',
      align: 'center'
    }).setOrigin(0.5);

    const subtitle = this.scene.add.text(0, -panelHeight / 2 + 70, `You reached level ${this.level}`, {
      font: '18px monospace',
      color: '#f0f4ff',
      align: 'center'
    }).setOrigin(0.5);

    this.container.add([panel, title, subtitle]);

    if (!hasChoices) {
      const prompt = this.scene.add.text(0, 28, 'Press Enter to continue', {
        font: '14px monospace',
        color: '#c4c9f5',
        align: 'center'
      }).setOrigin(0.5);
      this.container.add(prompt);
      return;
    }

    const prompt = this.scene.add.text(0, panelHeight / 2 - 34, 'Choose a reward (Enter to confirm)', {
      font: '14px monospace',
      color: '#c4c9f5',
      align: 'center'
    }).setOrigin(0.5);

    this.container.add(prompt);

    this._buildChoiceGrid();
  }

  /** Handle _buildChoiceGrid so this system stays coordinated. */
  _buildChoiceGrid() {
    const total = this.choices.length;
    const usableWidth = (CARD_WIDTH + CARD_SPACING) * total - CARD_SPACING;
    const startX = -usableWidth / 2 + CARD_WIDTH / 2;
    const y = 40;

    this.choices.forEach((choice, index) => {
      const card = this._createChoiceCard(choice);
      card.setPosition(startX + index * (CARD_WIDTH + CARD_SPACING), y);
      card.choiceIndex = index;
      card.choice = choice;
      this.container.add(card);
      this.choiceCards.push(card);
    });
  }

  /** Handle _createChoiceCard so this system stays coordinated. */
  _createChoiceCard(choice) {
    const card = this.scene.add.container(0, 0).setSize(CARD_WIDTH, CARD_HEIGHT);

    card.setScrollFactor(0);

    card.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true
    });

    const bg = this.scene.add.rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, 0x24122a, 0.94)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0x6be3ff, 0.7);

    bg.setInteractive({ useHandCursor: true });

    const isItem = choice.type === 'weapon' || choice.type === 'passive';

    const titleText = isItem
      ? (choice.name ?? choice.key)
      : 'Restore Health';

    const rarityLabel = isItem
      ? `Rarity: ${(choice.rarity ?? 'unknown').toUpperCase()}`
      : this._formatRestoreLabel(choice.amount);

    const descriptionText = isItem
      ? (choice.description ?? choice.ui?.description ?? '')
      : '';

    // --- Icon (optional) --------------------------------------------------------
    let iconImg = null;
    const iconMeta = choice.ui?.icon ?? {};

    // Support both atlas-based icons and standalone textures:
    // - If iconMeta.atlas exists -> use that as texture key + iconMeta.frame as frame name
    // - Else fall back to iconMeta.key as a single texture
    const atlasKey = iconMeta.atlas ?? null;
    const textureKey = atlasKey || iconMeta.key || null;
    const frame = iconMeta.frame ?? undefined;

    if (textureKey) {
      iconImg = this.scene.add
        .image(0, -70, textureKey, frame)
        .setOrigin(0.5)
        .setScrollFactor(0);

      const maxIconWidth = CARD_WIDTH * 0.6;
      if (iconImg.width > maxIconWidth) {
        iconImg.setScale(maxIconWidth / iconImg.width);
      }
    }

    // --- Text layout ------------------------------------------------------------
    const title = this.scene.add.text(0, -24, titleText, {
      font: '18px monospace',
      color: '#f0f4ff',
      align: 'center',
      wordWrap: { width: CARD_WIDTH - 20 }
    }).setOrigin(0.5)
      .setScrollFactor(0);

    let description = null;
    let subtitle = null;

    if (isItem && descriptionText) {
      // Weapon / passive with description: show desc + rarity
      description = this.scene.add.text(0, 30, descriptionText, {
        font: '12px monospace',
        color: '#c4c9f5',
        align: 'center',
        wordWrap: { width: CARD_WIDTH - 20 }
      }).setOrigin(0.5)
        .setScrollFactor(0);

      subtitle = this.scene.add.text(0, 80, rarityLabel, {
        font: '12px monospace',
        color: '#9ea3d6',
        align: 'center',
        wordWrap: { width: CARD_WIDTH - 24 }
      }).setOrigin(0.5)
        .setScrollFactor(0);
    } else {
      // Restore-health or no description: single line at the bottom
      subtitle = this.scene.add.text(0, 34, rarityLabel, {
        font: '14px monospace',
        color: '#c4c9f5',
        align: 'center',
        wordWrap: { width: CARD_WIDTH - 24 }
      }).setOrigin(0.5)
        .setScrollFactor(0);
    }

    // Add all children in one go; filter out nulls
    const children = [bg, iconImg, title, description, subtitle].filter(Boolean);
    card.add(children);

    // keep references if you want focus tinting later
    card.bg = bg;
    card.iconImg = iconImg || null;

    card.on('pointerover', () => {
      if (this._closed) return;
      this._setFocus(card.choiceIndex);
    });

    card.on('pointerdown', () => {
      if (this._closed) return;
      this._setFocus(card.choiceIndex);
      this._selectFocusedChoice();
    });

    // Mirror events on bg too, in case the container misses due to z-order nuances:
    bg.on('pointerover', () => {
      if (this._closed) return;
      this._setFocus(card.choiceIndex);
    });
    bg.on('pointerdown', () => {
      if (this._closed) return;
      this._setFocus(card.choiceIndex);
      this._selectFocusedChoice();
    });

    return card;
  }

  /** Handle _formatRestoreLabel so this system stays coordinated. */
  _formatRestoreLabel(amount) {
    if (amount === 'full') {
      return 'Fully restore health';
    }
    if (typeof amount === 'string' && amount.startsWith('percent:')) {
      const pct = Number.parseFloat(amount.split(':')[1] ?? '0');
      if (!Number.isNaN(pct) && pct > 0) {
        return `Restore ${pct}% health`;
      }
    }
    if (Number.isFinite(amount)) {
      return `Restore +${amount} HP`;
    }
    return 'Restore health';
  }

  /** Handle _handleKeyDown so this system stays coordinated. */
  _handleKeyDown(event) {
    if (this._closed) return;

    const code = event.keyCode;

    const leftCodes = [
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.A
    ];
    const rightCodes = [
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.D
    ];

    if (leftCodes.includes(code)) {
      event.stopPropagation();
      this._moveFocus(-1);
      return;
    }

    if (rightCodes.includes(code)) {
      event.stopPropagation();
      this._moveFocus(1);
      return;
    }

    if (code === Phaser.Input.Keyboard.KeyCodes.UP || code === Phaser.Input.Keyboard.KeyCodes.W) {
      event.stopPropagation();
      return;
    }

    if (code === Phaser.Input.Keyboard.KeyCodes.DOWN || code === Phaser.Input.Keyboard.KeyCodes.S) {
      event.stopPropagation();
      return;
    }

    if (code === Phaser.Input.Keyboard.KeyCodes.ENTER || code === Phaser.Input.Keyboard.KeyCodes.SPACE) {
      event.stopPropagation();
      if (this.choiceCards.length > 0) {
        this._selectFocusedChoice();
      } else {
        this.close();
      }
    }
  }

  /** Handle _moveFocus so this system stays coordinated. */
  _moveFocus(delta) {
    if (!this.choiceCards.length) return;
    const nextIndex = (this.focusIndex + delta + this.choiceCards.length) % this.choiceCards.length;
    this._setFocus(nextIndex);
  }

  /** Handle _setFocus so this system stays coordinated. */
  _setFocus(index) {
    if (!this.choiceCards.length) return;
    this.choiceCards.forEach((card, idx) => {
      const isActive = idx === index;
      card.bg.setStrokeStyle(2, isActive ? 0xffdc7a : 0x6be3ff, isActive ? 1 : 0.7);
      card.bg.setFillStyle(isActive ? 0x35203b : 0x24122a, isActive ? 0.98 : 0.94);
    });
    this.focusIndex = Phaser.Math.Clamp(index, 0, this.choiceCards.length - 1);
  }

  /** Handle _selectFocusedChoice so this system stays coordinated. */
  _selectFocusedChoice() {
    const card = this.choiceCards[this.focusIndex];
    if (!card) return;
    const choice = card.choice;
    if (typeof this.onSelect === 'function') {
      this.onSelect(choice);
    }
    this.close();
  }

  /**
   * Close and clean up the modal. Calls onClose() if provided.
   */
  close() {
    if (this._closed) return;
    this._closed = true;

    this.scene.input.keyboard.off('keydown', this._onKeyDown);
    this.scene.scale.off('resize', this._onResize);
    this._capturedKeys.forEach((code) => {
      this.scene.input.keyboard.removeCapture(code);
    });

    this.backdrop?.destroy();
    this.container?.destroy();

    if (typeof this.onClose === 'function') {
      this.onClose();
    }

    this.scene.events?.emit?.('level:modal:closed', { level: this.level });
  }

  /**
   * Fully destroy the modal programmatically, same cleanup path as close()
   */
  destroy() {
    if (this._closed) {
      return;
    }
    this.scene.input.keyboard.off('keydown', this._onKeyDown);
    this.scene.scale.off('resize', this._onResize);
    this._capturedKeys.forEach((code) => {
      this.scene.input.keyboard.removeCapture(code);
    });
    this.backdrop?.destroy();
    this.container?.destroy();
    this._closed = true;
  }
}
