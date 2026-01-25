// src/ui/PlayerHUD.js
import Phaser from 'phaser';

/**
 * PlayerHUD
 * Polished, player-facing run overlay (separate from DebugOverlay).
 *
 * Shows:
 *  - Time survived (MM:SS)
 *  - Kills
 *  - XP earned (total)
 *
 * Notes:
 *  - Screen-space (scrollFactor 0)
 *  - Responsive: supports setPosition + optional setScale
 *  - Dumb view: caller pushes data via setStats()
 *  - Styled to match PauseMenu palette (dark plum + pink accents, monospace)
 */
export class PlayerHUD {
  /** Initialize PlayerHUD state so runtime dependencies are ready. */
  constructor(
    scene,
    {
      x = 8,
      y = 8,
      width = 100,
      paddingX = 12,
      paddingY = 10,
      depth = 70,

      // Match PauseMenu vibe
      bgColor = 0x1a0c1f,
      bgAlpha = 0.90,
      borderColor = 0xff5d88,
      borderAlpha = 0.88,

      cornerRadius = 12,
      rowGap = 10,
      topAccentHeight = 3
    } = {}
  ) {
    this.scene = scene;
    this.width = width;
    this.paddingX = paddingX;
    this.paddingY = paddingY;

    this.container = scene.add.container(x, y)
      .setScrollFactor(0)
      .setDepth(depth);

    // ---- Styles (monospace like PauseMenu) ----
    this._labelStyle = { font: '11px monospace', color: '#f7cfe3' };
    this._valueBigStyle = { font: '18px monospace', color: '#ffe9f2' };
    this._valueStyle = { font: '15px monospace', color: '#ffe9f2' };

    // ---- Layout ----
    // 3 stat rows: TIME, KILLS, XP
    // Each row: label (left) + value (right)
    const labelYOffset = 0;
    const valueYOffset = 12;

    const row1Y = paddingY;
    const row2Y = row1Y + valueYOffset + 20 + rowGap;
    const row3Y = row2Y + valueYOffset + 18 + rowGap;

    // TIME
    this.timeLabel = scene.add.text(paddingX, row1Y + labelYOffset, 'TIME', this._labelStyle);
    this.timeValue = scene.add.text(width - paddingX, row1Y + valueYOffset, '00:00', this._valueBigStyle)
      .setOrigin(1, 0);

    // KILLS
    this.killsLabel = scene.add.text(paddingX, row2Y + labelYOffset, 'KILLS', this._labelStyle);
    this.killsValue = scene.add.text(width - paddingX, row2Y + valueYOffset, '0', this._valueStyle)
      .setOrigin(1, 0);

    // XP
    this.xpLabel = scene.add.text(paddingX, row3Y + labelYOffset, 'XP', this._labelStyle);
    this.xpValue = scene.add.text(width - paddingX, row3Y + valueYOffset, '0', this._valueStyle)
      .setOrigin(1, 0);

    // Panel height based on last row
    this.height = (row3Y + valueYOffset + 18 + paddingY);

    // ---- Background ----
    // Use Graphics so we can do rounded rect + accent strip easily.
    this.background = scene.add.graphics();
    this._drawBackground({
      cornerRadius,
      topAccentHeight,
      bgColor,
      bgAlpha,
      borderColor,
      borderAlpha
    });

    // Render order
    this.container.add([
      this.background,
      this.timeLabel,
      this.timeValue,
      this.killsLabel,
      this.killsValue,
      this.xpLabel,
      this.xpValue
    ]);

    this.setPosition(x, y);

    // Cache last stats so we can avoid redundant setText spam if you want later
    this._last = { time: '00:00', kills: '0', xp: '0' };
  }

  /** Redraw background. */
  _drawBackground({
    cornerRadius,
    topAccentHeight,
    bgColor,
    bgAlpha,
    borderColor,
    borderAlpha
  }) {
    this.background.clear();

    // main panel
    this.background.fillStyle(bgColor, bgAlpha);
    this.background.lineStyle(2, borderColor, borderAlpha);
    this.background.fillRoundedRect(0, 0, this.width, this.height, cornerRadius);
    this.background.strokeRoundedRect(0, 0, this.width, this.height, cornerRadius);

    // top accent strip (subtle glow bar)
    if (topAccentHeight > 0) {
      this.background.fillStyle(borderColor, 0.55);
      // small radius so strip hugs the top
      this.background.fillRoundedRect(2, 2, this.width - 4, topAccentHeight, 2);
    }

    // faint divider between rows (optional)
    this.background.lineStyle(1, 0xff759b, 0.25);
    // under TIME
    this.background.beginPath();
    this.background.moveTo(10, 46);
    this.background.lineTo(this.width - 10, 46);
    this.background.closePath();
    this.background.strokePath();
    // under KILLS
    this.background.beginPath();
    this.background.moveTo(10, 46 + 44);
    this.background.lineTo(this.width - 10, 46 + 44);
    this.background.closePath();
    this.background.strokePath();
  }

  /** Format milliseconds into MM:SS. */
  _formatTimeMMSS(elapsedMs) {
    const ms = Math.max(0, Number(elapsedMs) || 0);
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  /** Handle setPosition so this system stays coordinated. */
  setPosition(x, y) {
    this.container?.setPosition(x, y);
  }

  /** Optional: allow scaling the whole HUD. */
  setScale(scale = 1) {
    const s = Number.isFinite(scale) ? scale : 1;
    this.container?.setScale(s);
  }

  /** Handle setVisible so this system stays coordinated. */
  setVisible(isVisible) {
    this.container?.setVisible(!!isVisible);
  }

  /**
   * Update displayed values.
   * Caller should push:
   *  - elapsedMs OR elapsedSeconds
   *  - kills
   *  - xp (total earned)
   */
  setStats({ elapsedMs = null, elapsedSeconds = null, kills = 0, xp = 0 } = {}) {
    if (!this.container) return;

    let ms = elapsedMs;
    if (!Number.isFinite(ms)) {
      const s = Number(elapsedSeconds) || 0;
      ms = s * 1000;
    }

    const timeText = this._formatTimeMMSS(ms);
    const killsText = String(Math.max(0, Number(kills) || 0));
    const xpText = String(Math.max(0, Number(xp) || 0));

    // Avoid extra churn if nothing changed.
    if (timeText !== this._last.time) {
      this.timeValue?.setText(timeText);
      this._last.time = timeText;
    }
    if (killsText !== this._last.kills) {
      this.killsValue?.setText(killsText);
      this._last.kills = killsText;
    }
    if (xpText !== this._last.xp) {
      this.xpValue?.setText(xpText);
      this._last.xp = xpText;
    }
  }

  /** Handle destroy so this system stays coordinated. */
  destroy() {
    this.background?.destroy();
    this.timeLabel?.destroy();
    this.timeValue?.destroy();
    this.killsLabel?.destroy();
    this.killsValue?.destroy();
    this.xpLabel?.destroy();
    this.xpValue?.destroy();
    this.container?.destroy();

    this.scene = null;
    this.background = null;
    this.container = null;

    this.timeLabel = null;
    this.timeValue = null;
    this.killsLabel = null;
    this.killsValue = null;
    this.xpLabel = null;
    this.xpValue = null;

    this._last = null;
  }
}
