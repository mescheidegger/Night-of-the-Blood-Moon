import Phaser from 'phaser';
import { getOrCreateSoundManager } from '../audio/SoundManager.js';
import { AUDIO_MANIFEST } from '../audio/audioManifest.js';
import { SettingsMenu } from '../ui/SettingsMenu.js';

export class MenuScene extends Phaser.Scene {
  /** Initialize MenuScene state so runtime dependencies are ready. */
  constructor() {
    super('menu');
  }

  /** Handle create so this system stays coordinated. */
  create() {
    // ------- Background -------
    this.ground = this.add.tileSprite(0, 0, 4096, 4096, 'ground')
      .setOrigin(0.5)
      .setDepth(0)
      .setScrollFactor(0);

    // subtle motion so menu feels alive
    this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        this.ground.tilePositionX += 0.15;
        this.ground.tilePositionY += 0.10;
      }
    });

    this.tintOverlay = this.add.rectangle(0, 0, 4000, 4000, 0x8a143a, 0.12)
      .setScrollFactor(0)
      .setDepth(1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    this.soundManager = getOrCreateSoundManager(this);
    this.settingsMenu = null;

    const startMusicIfReady = () => {
      this.soundManager?.loadFromStorage();
      this.soundManager?.playMusic('music.game.loop', { bus: 'music', volume: 1.0 });
    };

    // ------- Audio unlock -------
    if (this.sound.locked) {

      const unlock = () => {
        this.sound.unlock();
        startMusicIfReady();
      };

      this.input.once('pointerdown', unlock);
      this.input.keyboard?.once('keydown', unlock);
    } else {
      startMusicIfReady();
    }

    // Load audio files in background lazily
    this.time.delayedCall(0, () => {
      const missingAudio = AUDIO_MANIFEST.filter(({ key }) => !this.cache.audio.exists(key));

      if (!missingAudio.length) {
        // If everything is already cached, still try starting music (unlocked permitting)
        if (!this.sound.locked) this.soundManager?.tryPlayPendingMusic();
        return;
      }

      this.load.once('complete', () => {
        if (!this.sound.locked) this.soundManager?.tryPlayPendingMusic();
      });

      this.load.on('loaderror', (file) => {
        console.error('[MenuScene] audio loaderror:', file?.key, file?.src);
      });

      missingAudio.forEach(({ key, url }) => {
        // Tip: keep url as-is; but log it so you can confirm it’s correct
        this.load.audio(key, url);
      });

      this.load.start();
    });

    // ------- Title -------
    const title = this.add.text(this.scale.width / 2, this.scale.height * 0.25,
      'NIGHT OF THE\nENDLESS MOON',
      {
        fontFamily: 'monospace',
        fontSize: '48px',
        align: 'center',
        color: '#e9e2ff',
        stroke: '#8a143a',
        strokeThickness: 4
      }
    )
      .setOrigin(0.5)
      .setDepth(5);

    const moon = this.add.image(title.x, title.y + 8, 'menumoon')
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(4)
      .setAlpha(0.9) // adjust to taste
      .setBlendMode(Phaser.BlendModes.NORMAL); // <- no tinting of background

    // size moon relative to title width (instead of a hard scale)
    const tex = this.textures.get('menumoon').getSourceImage();
    moon.setScale((title.width * 1) / tex.width);


    // ------- Buttons -------
    const btnsY = this.scale.height * 0.6;
    const spacing = 60;

    this.activeModal = null;

    const startBtn = this._makeButton(this.scale.width/2, btnsY + 0 * spacing, 'Start', () => {
      // Persisted hero key lets us highlight the last selection when returning
      // to the hero-select scene (nice quality-of-life when testing).
      let lastHero = null;
      if (typeof window !== 'undefined') {
        try {
          lastHero = window.localStorage?.getItem('NOTBM:lastHero');
        } catch (err) {
          console.warn('[MenuScene] Failed to read last hero from storage:', err);
        }
      }
      this.scene.start('hero-select', { heroKey: lastHero });
    }, 6);

    const howBtn = this._makeButton(this.scale.width/2, btnsY + 1 * spacing, 'How to Play', () => {
      if (this.activeModal) {
        return;
      }
      this._openModal('How to Play', [
        'Controls:',
        '• Desktop: Move with WASD or Arrow Keys',
        '• Mobile: Use the on-screen joystick',
        '• Pause: Press Esc or tap the button in the top-right corner',
        '',
        'Combat:',
        '• Your weapon fires automatically at nearby enemies',
        '• Positioning and movement are your primary defense',
        '',
        'Progression:',
        '• Collect blue and green shards to gain XP',
        '• Level up to choose new weapons or powerful passives',
        '• Build synergies to survive the rising difficulty',
        '',
        'Objective:',
        '• Survive the night',
        '• Defeat the boss that awaits at dawn'
      ]);
    }, 6);

    const settingsBtn = this._makeButton(this.scale.width/2, btnsY + 2 * spacing, 'Settings', () => {
      if (this.activeModal) {
        return;
      }
      this._openSettingsModal();
    }, 6);

    const aboutBtn = this._makeButton(this.scale.width/2, btnsY + 3 * spacing, 'About', () => {
      if (this.activeModal) {
        return;
      }
      this._openModal('About', [
        'When the blood moon rises, the dead answer its call.',
        'Night of the Endless Moon is a dark-fantasy survival game set on a cursed battlefield of graves and ruin.',
        'Fight through relentless hordes, collect blue shards to grow stronger, and forge a build powerful enough to last until dawn.',
        'If you survive the night, a final boss awaits.',
        '',
        'Assets & Credits:',
        'Art and audio are sourced from itch.io, OpenGameArt, Mixkit, and Pixabay.',
        'All assets are CC0 or free-to-use.'
      ]);
    }, 6);

    // Keyboard shortcuts (simulate click)
    this.input.keyboard.on('keydown-ENTER', () => {
      if (this.activeModal) {
        return;
      }
      startBtn.emit('click');
    });
    this.input.keyboard.on('keydown-SPACE', () => {
      if (this.activeModal) {
        return;
      }
      startBtn.emit('click');
    });
    this.input.keyboard.on('keydown-H', () => {
      if (this.activeModal) {
        return;
      }
      howBtn.emit('click');
    });
    this.input.keyboard.on('keydown-A', () => {
      if (this.activeModal) {
        return;
      }
      aboutBtn.emit('click');
    });
  }

  /**
   * Button as a Container. The CONTAINER is interactive (most reliable).
   * - container.setSize(w,h).setInteractive({ useHandCursor:true })
   * - hover/press styles applied by mutating bg / label / glow
   */
  _makeButton(x, y, label, onClick, depth=6) {
    const w = 280, h = 44;

    const container = this.add.container(x, y).setDepth(depth);
    container.setSize(w, h).setInteractive({ useHandCursor: true });

    const glow = this.add.image(0, 0, 'player_glow')
      .setScale(2.6)
      .setAlpha(0.0)
      .setBlendMode(Phaser.BlendModes.ADD);

    const bg = this.add.rectangle(0, 0, w, h, 0x111522, 0.9)
      .setStrokeStyle(2, 0x8a143a, 1);

    const txt = this.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#e9e2ff'
    }).setOrigin(0.5);

    container.add([glow, bg, txt]);

    container
      .on('pointerover', () => {
        bg.setFillStyle(0x171c2b, 1);
        txt.setColor('#ffffff');
        glow.setAlpha(0.45);
      })
      .on('pointerout', () => {
        bg.setFillStyle(0x111522, 0.9);
        txt.setColor('#e9e2ff');
        glow.setAlpha(0.0);
        container.setScale(1);
      })
      .on('pointerdown', () => {
        container.setScale(0.98);
      })
      .on('pointerup', () => {
        container.setScale(1);
        onClick?.();
      })
      // allow keyboard simulation
      .on('click', () => onClick?.());

    return container;
  }

  /** Handle _openModal so this system stays coordinated. */
  _openModal(title, lines) {
    // Modal depths
    const D_BACK = 20, D_PANEL = 21, D_TEXT = 22, D_BTN = 23;

    const w = Math.min(600, this.scale.width - 80);
    const h = Math.min(480, this.scale.height - 120);
    const x = this.scale.width / 2;
    const y = this.scale.height / 2;

    // Backdrop to catch clicks (must be interactive to block buttons beneath)
    const block = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.35)
      .setOrigin(0).setDepth(D_BACK).setInteractive();

    const panel = this.add.rectangle(x, y, w, h, 0x0e1422, 0.95)
      .setDepth(D_PANEL)
      .setStrokeStyle(2, 0x8a143a, 1);

    const head = this.add.text(x, y - h/2 + 30, title, {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#ffd6e7'
    }).setOrigin(0.5).setDepth(D_TEXT);

    const body = this.add.text(x - w/2 + 24, y - h/2 + 70, lines.join('\n'), {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#c8d0ff',
      wordWrap: { width: w - 48 }
    }).setDepth(D_TEXT);

    // Close button (container) above panel/text
    let closeBtn;
    const dismiss = () => {
      [block, panel, head, body, closeBtn].forEach(o => o?.destroy());
      this.input.keyboard.off('keydown-ESC', onEsc);
      this.input.keyboard.off('keydown-ENTER', onEsc);
      this.input.keyboard.off('keydown-SPACE', onEsc);
      if (this.activeModal?.dismiss === dismiss) {
        this.activeModal = null;
      }
    };

    const onEsc = () => dismiss();

    closeBtn = this._makeButton(x, y + h/2 - 32, 'Close (Esc)', () => dismiss(), D_BTN);

    // One-shot listeners; backdrop also dismisses
    this.input.keyboard.once('keydown-ESC', onEsc);
    this.input.keyboard.once('keydown-ENTER', onEsc);
    this.input.keyboard.once('keydown-SPACE', onEsc);
    block.once('pointerup', onEsc);

    this.activeModal = { dismiss };
  }

  /** Handle _openSettingsModal so this system stays coordinated. */
  _openSettingsModal() {
    if (this.settingsMenu) {
      return;
    }

    const dismiss = () => {
      this.settingsMenu?.destroy();
      this.settingsMenu = null;
      if (this.activeModal?.dismiss === dismiss) {
        this.activeModal = null;
      }
    };

    this.settingsMenu = new SettingsMenu(this, {
      soundManager: this.soundManager,
      onClose: dismiss
    });

    this.activeModal = { dismiss };
  }
}
