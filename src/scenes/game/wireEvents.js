import Phaser from 'phaser';
import { WerewolfBossController } from '../../mob/boss/WerewolfBossController.js';

export function wireGameSceneEvents(scene) {
  // Debug keys are scene-owned so they're easy to delete later without touching core systems.
  scene.debugWeaponKeys = scene.input.keyboard.addKeys({
    addBolt: Phaser.Input.Keyboard.KeyCodes.ONE,
    removeBolt: Phaser.Input.Keyboard.KeyCodes.TWO,
    buffBolt: Phaser.Input.Keyboard.KeyCodes.THREE
  });

  // Player death is handled via an event so the death controller can run its full animation first.
  const onPlayerDeathFinished = () => scene.handlePlayerDeathFinished();
  scene.events.on('player:death:finished', onPlayerDeathFinished);

  // SpawnDirector / timeline can push control messages (encounters, arena lock, etc.) without tight coupling.
  const onSpawnControl = (payload) => scene._handleSpawnControl(payload);
  scene.events.on('spawn:control', onSpawnControl);

  // Attach per-boss logic at spawn time so pooled enemies stay generic.
  const onEnemySpawned = ({ enemy } = {}) => {
    if (!enemy || enemy.mobKey !== 'werewolf_boss') return;
    if (enemy._bossController) return; // Defensive: pooling can re-emit spawn events.

    const controller = new WerewolfBossController(scene, enemy);
    enemy._bossController = controller;
    scene._bossControllers.add(controller);
  };
  scene.events.on('enemy:spawned', onEnemySpawned);

  // Always detach boss controllers when enemies are released back to pools to prevent leaking updates.
  const onEnemyReleased = ({ enemy } = {}) => {
    const controller = enemy?._bossController;
    if (!controller) return;

    controller.destroy();
    scene._bossControllers.delete(controller);
    enemy._bossController = null;
  };
  scene.events.on('enemy:released', onEnemyReleased);

  // Global pause keys (Esc/P) must stop propagation so UI overlays don't double-handle the same press.
  const onPauseKey = (event) => {
    const toggled = scene.pause?.toggleMenu?.() ?? scene.togglePauseMenu?.();
    if (toggled) {
      event?.stopPropagation?.();
      event?.preventDefault?.();
    }
  };

  scene.input.keyboard.on('keydown-ESC', onPauseKey);
  scene.input.keyboard.on('keydown-P', onPauseKey);

  // Return a disposer so GameScene shutdown can remove listeners in one place.
  return () => {
    scene.events.off('player:death:finished', onPlayerDeathFinished);
    scene.events.off('spawn:control', onSpawnControl);
    scene.events.off('enemy:spawned', onEnemySpawned);
    scene.events.off('enemy:released', onEnemyReleased);

    scene.input.keyboard?.off('keydown-ESC', onPauseKey);
    scene.input.keyboard?.off('keydown-P', onPauseKey);
  };
}
