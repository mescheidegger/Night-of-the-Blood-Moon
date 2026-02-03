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
      scene.weaponManager?.setModifiersForWeapon('bolt', [{ type: 'delayMs%', value: -0.1 }]);
    }
  }

  // Systems are stepped in dependency order: movement/collect → AI/projectiles → spawns → visuals/UI.
  scene.props?.update?.();
  scene.pickups?.update?.(dt);

  // --- NAVIGATION FIELD UPDATE (bounded maps only) ---
  // NOTE: In this codebase `scene.hero` is a bundle; position lives on `scene.hero.sprite`
  // (and `scene.player` getter points to that sprite too).
  if (scene.mapRuntime?.isBounded?.() && scene.flowField && scene.navGrid) {
    const heroSprite = scene.player ?? scene.hero?.sprite ?? null;
    if (heroSprite) {
      const now = scene.time?.now ?? 0;
      scene.flowField.updateTargetWorld(heroSprite.x, heroSprite.y, now);

      // If the debug overlay is visible, refresh so flow arrows update as the hero moves.
      // (If you later return a boolean from updateTargetWorld when it actually rebuilds,
      // you can refresh only on rebuild.)
      if (scene.mapDebugOverlay?.visible) {
        scene.mapDebugOverlay.refresh();
      }
    }
  }

  scene.enemyAI?.update?.(dt);
  scene.enemyProjectiles?.update?.(dt);
  scene.spawnDirector?.update?.(dt);
  scene.groundLayer?.update?.();
  scene.bloodMoon?.update?.(dt);
  scene.hud?.update?.();
}
