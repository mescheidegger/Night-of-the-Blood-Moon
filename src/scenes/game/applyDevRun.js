export function applyDevRun(scene, cfg) {
  // Dev-only fast-forward + loadout override hook. Safe no-op in production runs.
  const config = cfg ?? {};
  if (!config.enabled) return;

  // Visible on-screen indicator so you never forget you're in a modified test run.
  scene.add.text(16, 48, 'DEV_RUN ACTIVE', {
    font: '14px monospace',
    color: '#ff4d4d'
  }).setScrollFactor(0).setDepth(9999);

  // Pretend the run already started earlier so timers, spawns, and scaling kick in immediately.
  const startSeconds = Math.max(0, Number(config.startElapsedSeconds) || 0);
  const now = scene.time?.now ?? 0;

  scene._runStartedAt = now - (startSeconds * 1000);
  scene._totalPausedMs = 0;
  scene._pausedAt = null;

  // Keep HUD timer and spawn pacing in sync with the artificial run start.
  scene.hud?.setStartTime?.(scene._runStartedAt);
  scene.spawnDirector?.seekToTime?.(startSeconds);

  // Jump the player to a higher level without triggering normal level-up UI flow.
  if ((config.startLevel ?? 0) > 0) {
    scene.levelFlow?.debugSetLevel?.(config.startLevel, { snapToFloor: !!config.snapXPToLevelFloor });
  }

  // Override weapon loadout deterministically for balance testing or feature work.
  if (Array.isArray(config.weapons)) {
    const whitelist = Array.isArray(scene.weaponWhitelist)
      ? scene.weaponWhitelist
      : Array.from(scene.weaponWhitelist ?? []);
    const normalizedWeapons = [];

    config.weapons.forEach((entry) => {
      if (!entry) return;
      const isObj = typeof entry === 'object';
      const key = isObj ? entry.key : entry;

      // Never grant weapons the hero isn't allowed to use.
      if (!key || (whitelist.length > 0 && !whitelist.includes(key))) return;

      const levelRaw = isObj ? entry.level : undefined;
      const fallbackLevel = Number(config.weaponLevelDefault);
      const effectiveLevel = Number.isFinite(levelRaw)
        ? levelRaw
        : (Number.isFinite(fallbackLevel) ? fallbackLevel : undefined);

      normalizedWeapons.push({ key, level: effectiveLevel });
    });

    if (normalizedWeapons.length > 0) {
      // Clear existing weapons first to avoid stacking unintended defaults.
      scene.weaponManager?.setLoadout?.([]);

      normalizedWeapons.forEach(({ key, level }) => {
        const opts = {};
        if (Number.isFinite(level)) {
          opts.level = level; // Start weapon at a specific upgrade level for testing scaling.
        }
        scene.weaponManager?.grantWeapon?.(key, opts);
      });
    }
  }

  // Apply passive loadout overrides after weapons so derived stats recalc correctly.
  if (Array.isArray(config.passives)) {
    scene.passiveManager?.setLoadout?.(config.passives);
  }
}
