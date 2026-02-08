import { LevelSystem } from './LevelSystem.js';
import { XPBar } from '../ui/XPBar.js';
import { LevelUpModal } from '../ui/LevelUpModal.js';
import { LEVEL_UP } from '../config/gameConfig.js';
import { getLevelUpChoices } from './LevelUpRewards.js';

/**
 * LevelUpFlow centralises XP progression, modal presentation, and the shared
 * simulation pause while the player chooses upgrades.
 */
export class LevelUpFlow {
  /**
   * Wire together level tracking, XP UI, and level-up modal handling.
   */
  constructor(scene) {
    this.scene = scene;

    // LevelSystem tracks levels and XP thresholds. GameScene still exposes it
    // on `scene.levelSystem` for backwards compatibility with UI consumers.
    this.levelSystem = new LevelSystem(scene, { startLevel: 1, startXP: 0 });
    this.scene.levelSystem = this.levelSystem;

    // HUD element that mirrors progression along the bottom of the screen.
    const uiDepthBase = scene?.mapRender?.uiBaseDepth ?? 0;
    this.xpBar = new XPBar(scene, { depth: uiDepthBase + 20 });

    this._pendingLevelUps = 0;
    this._modalActive = false;

    this._onLevelUp = this._onLevelUp.bind(this);
    this._onModalClosed = this._onModalClosed.bind(this);

    scene.events.on('level:up', this._onLevelUp);
    scene.events.on('level:modal:closed', this._onModalClosed);
  }

  /**
   * Expose paused state so GameScene can early-out its update loop.
   */
  isPaused() {
    return this._modalActive;
  }

  /**
   * Public hook used by PickupController (and any future XP sources).
   */
  addXP(amount) {
    this.levelSystem?.addXP?.(amount);
  }

  /**
   * Debug helper to force level without opening modal flows.
   */
  debugSetLevel(level, opts = {}) {
    this.levelSystem?.setLevel?.(level, opts);
  }

  /**
   * Resume gameplay if the flow was paused (e.g., after player death).
   */
  resume() {
    this._releasePause();
  }

  /**
   * Clean up listeners and UI when the scene shuts down.
   */
  destroy() {
    this._releasePause();

    this.scene.events.off('level:up', this._onLevelUp);
    this.scene.events.off('level:modal:closed', this._onModalClosed);

    this.levelUpModal?.destroy?.();
    this.levelUpModal = null;

    this.xpBar?.destroy();
    this.xpBar = null;

    if (this.scene?.levelSystem === this.levelSystem) {
      this.scene.levelSystem = null;
    }

    this.scene = null;
    this.levelSystem = null;
  }

  /**
   * Queue modal displays; supports multiple level ups in a single frame.
   */
  _onLevelUp({ level }) {
    this._pendingLevelUps += 1;
    if (this._pendingLevelUps === 1) {
      this._showModal(level);
    }
  }

  /**
   * Called when the modal signals that the player made a selection.
   */
  _onModalClosed() {
    this.levelUpModal = null;
    this._pendingLevelUps = Math.max(0, this._pendingLevelUps - 1);

    if (this._pendingLevelUps > 0) {
      const level = this.levelSystem?.level ?? 1;
      this._showModal(level);
      return;
    }

    this._releasePause();
  }

  /**
   * Instantiate the level up modal and freeze the world while it is open.
   */
  _showModal(level) {
    this._applyPause();
    const loadout = this.scene.weaponManager?.getLoadout?.() ?? [];
    const heroEntry = this.scene.heroEntry ?? null;
    const passiveManager = this.scene.passiveManager ?? null;
    const currentPassives = passiveManager?.getLoadout?.() ?? [];
    const getStackCount = passiveManager?.getStackCount?.bind(passiveManager);

    const upgradeChoices = getLevelUpChoices({
      scene: this.scene,
      heroEntry,
      level,
      currentLoadout: loadout,
      currentPassives,
      getPassiveStackCount: getStackCount,
      maxChoices: LEVEL_UP.choicesPerLevel
    });

    const choices = [...upgradeChoices];
    choices.push({ type: 'restore', amount: LEVEL_UP.restoreHealthAmount });

    this.levelUpModal?.destroy?.();
    this.levelUpModal = new LevelUpModal(this.scene, {
      level,
      choices,
      depthBase: this.scene?.mapRender?.uiBaseDepth ?? 0,
      onSelect: (choice) => this._handleChoice(choice)
    });
  }

  /**
   * Apply a selected level-up choice and emit the relevant reward events.
   */
  _handleChoice(choice) {
    if (!choice) return;

    if (choice.type === 'weapon' && choice.key) {
      if (choice.subtype === 'upgrade') {
        const upgraded = this.scene.weaponManager?.upgradeWeapon?.(choice.key);
        if (upgraded) {
          this.scene.events?.emit?.('level:reward:selected', {
            type: 'weapon-upgrade',
            key: choice.key
          });
        }
      } else {
        this.scene.weaponManager?.addWeapon?.(choice.key);
        this.scene.events?.emit?.('level:reward:selected', { type: 'weapon', key: choice.key });
      }
      return;
    }

    if (choice.type === 'passive' && choice.key) {
      const applied = this.scene.passiveManager?.addPassive?.(choice.key);
      if (applied) {
        this.scene.events?.emit?.('level:reward:selected', { type: 'passive', key: choice.key });
      }
      return;
    }

    if (choice.type === 'restore') {
      this.scene.events?.emit?.('level:reward:selected', { type: 'restore' });
      this._applyRestore(choice.amount);
    }
  }

  /**
   * Restore hero health based on the configured amount or percent string.
   */
  _applyRestore(amount) {
    const health = this.scene.hero?.health ?? this.scene.playerHealth;
    if (!health?.heal) return;

    if (amount === 'full') {
      health.heal(health.maxHealth ?? 0);
      return;
    }

    if (typeof amount === 'string' && amount.startsWith('percent:')) {
      const percent = Number.parseFloat(amount.split(':')[1] ?? '0');
      if (!Number.isNaN(percent) && percent > 0) {
        const max = health.maxHealth ?? 0;
        const healAmount = Math.ceil((max * percent) / 100);
        health.heal(healAmount);
      }
      return;
    }

    if (Number.isFinite(amount) && amount > 0) {
      health.heal(amount);
    }
  }

  /**
   * Snapshot and pause all time sources so gameplay stops while choosing perks.
   */
  _applyPause() {
    if (this._modalActive) return;
    this._modalActive = true;

    // delegate to scene-wide pause, tagged by reason
    this.scene?._acquireSimulationPause?.('levelup');
  }

  /**
   * Restore the snapshot so the world resumes exactly where it left off.
   */
  _releasePause() {
    if (!this._modalActive) return;
    this._modalActive = false;

    this.scene?._releaseSimulationPause?.('levelup');
  }
}
