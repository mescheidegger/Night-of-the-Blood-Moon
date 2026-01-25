import Phaser from 'phaser';

export function stepSimulation(scene, dt) {
  // Fixed update order: keep this sequence stable so gameplay remains deterministic.
  scene.hero?.controller?.update?.(dt);
  scene.weaponManager?.update?.(dt);

  // Dev-only hotkeys for quickly poking weapon behavior without going through level-up flow.
  if (scene.debugWeaponKeys) {
    if (Phaser.Input.Keyboard.JustDown(scene.debugWeaponKeys.addBolt)) {
      scene.weaponManager?.addWeapon('bolt');
    }
    if (Phaser.Input.Keyboard.JustDown(scene.debugWeaponKeys.removeBolt)) {
      scene.weaponManager?.removeWeapon('bolt');
    }
    if (Phaser.Input.Keyboard.JustDown(scene.debugWeaponKeys.buffBolt)) {
      // Small cadence buff for rapid testing of fire-rate scaling and SFX spam controls.
      scene.weaponManager?.setModifiersForWeapon('bolt', [
        { type: 'delayMs%', value: -0.1 }
      ]);
    }
  }

  // Systems are stepped in dependency order: movement/collect → AI/projectiles → spawns → visuals/UI.
  scene.props?.update?.();
  scene.pickups?.update?.(dt);
  scene.enemyAI?.update?.(dt);
  scene.enemyProjectiles?.update?.(dt);
  scene.spawnDirector?.update?.(dt);
  scene.groundLayer?.update?.();
  scene.bloodMoon?.update?.(dt);
  scene.hud?.update?.();
}
