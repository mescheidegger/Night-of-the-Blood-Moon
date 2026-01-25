export function resetRunState(scene) {
  // Ensure the scene starts in a fully "live" state even after a restart.
  scene.time.timeScale = 1;

  // Player control flags must be reset so input/combat aren't stuck disabled.
  scene.playerInputDisabled = false;
  scene.playerCombatDisabled = false;

  // Clear any leftover UI from a previous run (menus are scene-level overlays).
  scene.endRunMenu = null;
  scene.pauseMenu = null;
  scene.settingsMenu = null;

  // Reset run progression + timers.
  scene.playerXP = 0;
  scene._runStartedAt = null;
  scene._totalPausedMs = 0;
  scene._pausedAt = null;
  scene.isGameOver = false;

  // Pause system bookkeeping — multiple systems can acquire pause simultaneously.
  scene._pauseSnapshot = null;
  scene._pauseSources = new Set();
  scene.isSimulationPaused = false;

  // Runtime encounter/spawn state that should not persist between runs.
  scene.legionFormations = new Map();
  scene._nextLegionId = 0;

  // Lifecycle guards so helpers know this is a fresh scene instance.
  scene._isShuttingDown = false;
  scene._finale = null;
  scene._arenaLocked = false;

  // Boss controllers are attached dynamically; must start empty each run.
  scene._bossControllers = new Set();
}
