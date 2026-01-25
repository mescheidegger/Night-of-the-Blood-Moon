export function cleanupGameScene(scene) {
  // Flag used by helpers (pause/input) to stop responding during teardown.
  scene._isShuttingDown = true;

  // Damage numbers use pooled objects + tweens — must be destroyed explicitly to avoid leaks.
  const dn = scene.damageNumbers;
  scene.damageNumbers = null;
  dn?.destroy?.();

  // Remove all scene-level event + keyboard bindings installed during create().
  scene._disposeEvents?.();
  scene._disposeEvents = null;

  // Safety unbind in case any system registered extra listeners outside wireGameSceneEvents.
  scene.events.off('enemy:died', scene._onEnemyDied);

  // Tear down gameplay systems that own timers, tweens, or physics refs.
  scene.derivedStats?.destroy?.();
  scene.derivedStats = null;
  scene.levelFlow?.destroy?.();
  scene.pickups?.destroy?.();
  scene.enemyAI?.destroy?.();

  // Boss controllers are manually attached to enemies — must be cleaned or they keep updating.
  scene._bossControllers?.forEach?.((controller) => controller.destroy());
  scene._bossControllers?.clear?.();

  // Encounter controller owns timers, FX, and pause logic during finale.
  scene.werewolfEncounter?.destroy?.();
  scene.werewolfEncounter = null;

  // UI systems often register input + camera listeners — always destroy on shutdown.
  scene.hud?.destroy?.();
  scene.groundLayer?.destroy?.();
  scene.bloodMoon?.destroy?.();

  // Menus are scene-level overlays and can linger across restarts if not removed.
  scene.endRunMenu?.destroy();
  scene.endRunMenu = null;
  scene.pauseMenu?.destroy?.();
  scene.pauseMenu = null;
  scene.settingsMenu?.destroy?.();
  scene.settingsMenu = null;

  // Core player and loadout systems — ensures pools, events, and tweens are released.
  scene.hero?.destroy?.();
  scene.weaponManager?.destroy?.();
  scene.passiveManager?.destroy?.();
}
