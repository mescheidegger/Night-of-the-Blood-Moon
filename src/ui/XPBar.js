/**
 * Fixed-position HUD element that displays the player's current level and XP progress.
 * Stays anchored to the top of the screen and updates automatically when XP/level changes.
 */
export class XPBar {
  /**
   * @param {Phaser.Scene} scene - Scene the HUD element is drawn in.
   * @param {Object} options
   * @param {number} options.width - Width of the XP bar.
   * @param {number} options.height - Height of the XP bar.
   */
  constructor(scene, { width = 320, height = 16, depth = 20 } = {}) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.events = scene?.events; // Used to listen to level/xp change events.

    // Root container for all HUD elements, anchored at top center of screen.
    this.container = scene.add
      .container(scene.scale.width / 2, 32)
      .setScrollFactor(0) // Do not move with camera
      .setDepth(depth); // Render above gameplay elements

    // Inner "fill" area is slightly smaller to leave border padding.
    const innerWidth = Math.max(0, width - 8);
    const innerHeight = Math.max(2, height - 6);

    // Background bar (outer frame)
    this.background = scene.add.rectangle(0, 0, width, height, 0x04030b, 0.85)
      .setOrigin(0.5) // Center anchor
      .setStrokeStyle(2, 0x6b73a6, 0.9); // Outline color

    // Fill bar (represents XP progress). Left-anchored so it grows horizontally.
    this.fill = scene.add.rectangle(-innerWidth / 2, 0, innerWidth, innerHeight, 0x6be3ff, 0.95)
      .setOrigin(0, 0.5);

    // Level label text displayed above the bar.
    this.label = scene.add.text(0, -(height / 2) - 6, 'Lv. 1', {
      font: '16px monospace',
      color: '#dfe9ff',
      align: 'center'
    }).setOrigin(0.5, 1);

    // Add all elements to the container for easy movement/scaling.
    this.container.add([this.background, this.fill, this.label]);

    // Adjust bar position when window is resized.
    this._onResize = (size) => {
      if (!size) return;
      this.container.setPosition(size.width / 2, 32);
      this.background.setSize(this.width, this.height);
      this.fill.setPosition(-innerWidth / 2, 0);
    };

    // Event listeners for XP and level updates.
    this._onXPChanged = () => this._updateFill();
    this._onLevelChanged = ({ level }) => this._updateLabel(level);

    scene.scale.on('resize', this._onResize);
    this.events?.on?.('xp:changed', this._onXPChanged);
    this.events?.on?.('level:changed', this._onLevelChanged);

    // Initialize label and progress to match current game state.
    this._updateLabel(scene.levelSystem?.level ?? 1);
    this._updateFill();
  }

  /**
   * Update displayed level text.
   */
  _updateLabel(level) {
    const lvl = Number(level) || 1;
    this.label.setText(`Lv. ${lvl}`);
  }

  /**
   * Update fill bar width based on XP percent progress (0.0 → 1.0).
   */
  _updateFill() {
    const system = this.scene.levelSystem;
    const progress = system ? Math.max(0, Math.min(1, system.progress ?? 0)) : 0;

    const innerWidth = Math.max(0, this.width - 8);
    const innerHeight = Math.max(2, this.height - 6);

    const width = innerWidth * progress;
    this.fill.setDisplaySize(width, innerHeight);
  }

  /**
   * Clean up listeners and destroy display objects.
   */
  destroy() {
    this.scene.scale.off('resize', this._onResize);
    this.events?.off?.('xp:changed', this._onXPChanged);
    this.events?.off?.('level:changed', this._onLevelChanged);
    this.container?.destroy();
    this.background?.destroy();
    this.fill?.destroy();
    this.label?.destroy();
  }
}
