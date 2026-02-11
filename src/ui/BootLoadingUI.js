import Phaser from 'phaser';

export const buildLoadingUI = (scene) => {
  const container = scene.add.container(0, 0).setDepth(9999);

  // Fullscreen dark + subtle blood tint (like MenuScene)
  const overlay = scene.add.rectangle(0, 0, 10, 10, 0x05060a, 0.92).setOrigin(0);

  const tint = scene.add
    .rectangle(0, 0, 10, 10, 0x8a143a, 0.10)
    .setOrigin(0)
    .setBlendMode(Phaser.BlendModes.MULTIPLY);

  // Title text: same palette + stroke as menu title
  const titleText = scene.add
    .text(0, 0, 'NIGHT OF THE\nENDLESS MOON', {
      fontFamily: 'monospace',
      fontSize: '40px',
      align: 'center',
      color: '#e9e2ff',
      stroke: '#8a143a',
      strokeThickness: 4,
    })
    .setOrigin(0.5);

  // Moon is NOT available yet at UI creation time (it is queued later in preload).
  // We'll attach it the moment the loader finishes that specific file.
  let moon = null;

  // Glow that brightens as progress increases
  const glow = scene.add
    .image(0, 0, 'player_glow')
    .setAlpha(0.0)
    .setScale(3.2)
    .setBlendMode(Phaser.BlendModes.ADD);

  // Status + file: same monospace body styling as modals
  const statusText = scene.add
    .text(0, 0, 'Preparing assets…', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#c8d0ff',
    })
    .setOrigin(0.5);

  const fileText = scene.add
    .text(0, 0, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#9aa0a6',
    })
    .setOrigin(0.5);

  // Bar: same button/panel treatment
  const barBg = scene.add
    .rectangle(0, 0, 10, 14, 0x111522, 0.95)
    .setOrigin(0.5)
    .setStrokeStyle(2, 0x8a143a, 1);

  const barFill = scene.add
    .rectangle(0, 0, 10, 14, 0xe9e2ff, 1)
    .setOrigin(0, 0.5);

  // Small % indicator
  const pctText = scene.add
    .text(0, 0, '0%', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ffd6e7',
    })
    .setOrigin(0.5);

  // Subtle motion: drift the glow a tiny bit so it feels “alive”
  const pulse = scene.tweens.add({
    targets: glow,
    alpha: 0.35,
    duration: 650,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.inOut',
  });

  // Note order: we will insert moon behind title later.
  container.add([
    overlay,
    tint,
    glow,
    titleText,
    statusText,
    barBg,
    barFill,
    pctText,
    fileText,
  ]);

  const layout = (width, height) => {
    overlay.setSize(width, height);
    tint.setSize(width, height);

    const centerX = width / 2;

    const barWidth = Math.min(Math.floor(width * 0.62), 560);
    const barHeight = 14;

    // Title sits above center similar to menu
    const titleY = Math.floor(height * 0.30);
    titleText.setPosition(centerX, titleY);

    if (moon) {
      moon.setPosition(centerX, titleY + 8);
      // scale moon relative to title width like MenuScene
      const tex = scene.textures.get('menumoon')?.getSourceImage?.();
      if (tex?.width) {
        moon.setScale((titleText.width * 1.0) / tex.width);
      }
    }

    const statusY = Math.floor(height * 0.50) - 34;
    statusText.setPosition(centerX, statusY);

    barBg.setSize(barWidth, barHeight);
    barBg.setPosition(centerX, Math.floor(height * 0.50));

    // barFill anchored to left edge of bg
    barFill.setPosition(centerX - barWidth / 2, barBg.y);

    pctText.setPosition(centerX, barBg.y + 28);
    fileText.setPosition(centerX, barBg.y + 50);

    glow.setPosition(centerX, barBg.y);
  };

  layout(scene.scale.width, scene.scale.height);

  // Smooth progress to avoid jumpy file-count weighting
  let shown = 0;

  const setProgress = (value) => {
    const clamped = Phaser.Math.Clamp(value ?? 0, 0, 1);
    shown = Math.max(shown, clamped);

    const w = barBg.width;
    barFill.width = Math.floor(w * shown);
    pctText.setText(`${Math.floor(shown * 100)}%`);

    // Glow grows with progress
    glow.setAlpha(0.10 + shown * 0.35);
    glow.setScale(3.0 + shown * 0.7);
  };

  const setFile = (label) => {
    fileText.setText(label || '');
    fileText.setPosition(scene.scale.width / 2, fileText.y); // keep centered
  };

  const setStatus = (label) => {
    statusText.setText(label || '');
    statusText.setPosition(scene.scale.width / 2, statusText.y);
  };

  const resize = (width, height) => {
    layout(width, height);
    // re-center after text changes
    setStatus(statusText.text);
    setFile(fileText.text);
  };

  const attachMoonIfReady = () => {
    if (moon) return;
    if (!scene.textures.exists('menumoon')) return;

    moon = scene.add
      .image(0, 0, 'menumoon')
      .setOrigin(0.5)
      .setAlpha(0.85)
      .setBlendMode(Phaser.BlendModes.NORMAL);

    // Insert behind title (container indices: 0 overlay, 1 tint, 2 glow, 3 title...)
    container.addAt(moon, 3);
    // Re-layout so scale/position is correct immediately.
    resize(scene.scale.width, scene.scale.height);
  };

  const destroy = () => {
    pulse?.stop();
    container.destroy(true);
  };

  return { setProgress, setFile, setStatus, resize, attachMoonIfReady, destroy };
};
