import Phaser from 'phaser';

/**
 * BloodMoonOverlay owns the screen-space multiply rectangle that gives the game
 * its red wash. Isolating the alpha pulse and lifetime management keeps
 * GameScene focused on orchestration.
 */
export class BloodMoonOverlay {
  constructor(scene, { depth = 10 } = {}) {
    this.scene = scene;
    this.elapsed = 0;

    // Large rectangle ensures the overlay still covers the viewport even when
    // the camera shakes or zooms. Scroll factor 0 anchors it to the screen.
    this.overlay = scene.add.rectangle(0, 0, 4000, 4000, 0x8a143a, 0)
      .setScrollFactor(0)
      .setDepth(depth)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
  }

  /**
   * Advance the pulse animation. dt comes from GameScene.update.
   */
  update(dt = 0) {
    if (!this.overlay) return;
    this.elapsed += dt;

    // Slow sine wave oscillates alpha between ~0 and ~0.16 for a gentle flicker.
    const pulse = (Math.sin(this.elapsed * 0.0015) + 1) * 0.08;
    this.overlay.setAlpha(pulse);
  }

  /**
   * Tear down display objects when the scene shuts down.
   */
  destroy() {
    this.overlay?.destroy();
    this.overlay = null;
    this.scene = null;
  }
}
