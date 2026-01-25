import Phaser from 'phaser';
import { FXSystem } from '../fx/FXSystem.js';
import { PropSystem } from '../prop/PropSystem.js';
import { PropRegistry } from '../prop/PropRegistry.js';
import { EndRunMenu } from '../ui/GameOverMenu.js';
import { registerMobAnimations } from '../mob/MobAnimations.js';
import { DEFAULT_HERO_KEY, getHeroEntry, LEGACY_DEFAULT_STARTER_LOADOUT } from '../hero/HeroRegistry.js';
import { registerHeroAnimations } from '../hero/HeroAnimations.js';
import { HeroFactory } from '../hero/HeroFactory.js';
import { WeaponManager } from '../weapons/WeaponManager.js';
import { DamagePipeline } from '../combat/DamagePipeline.js';
import { WeaponRegistry } from '../weapons/WeaponRegistry.js';
import { DropManager } from '../drops/systems/DropManager.js';
import { DropTables } from '../drops/DropTable.js';
import { DropSpawner } from '../drops/systems/DropSpawner.js';
import { EnemyPools } from '../combat/EnemyPools.js';
import { SpawnDirector } from '../spawn/SpawnDirector.js';
import { SpawnRegistry } from '../spawn/SpawnRegistry.js';
import { SpawnTimeline } from '../spawn/SpawnTimeline.js';
import { GroundLayer } from '../world/GroundLayer.js';
import { BloodMoonOverlay } from '../world/BloodMoonOverlay.js';
import { LevelUpFlow } from '../progression/LevelUpFlow.js';
import { PickupController } from '../drops/controllers/PickupController.js';
import { EnemyBehaviorSystem } from '../combat/EnemyBehaviorSystem.js';
import { EnemyProjectileSystem } from '../combat/EnemyProjectileSystem.js';
import { PlayerDerivedStatsApplier } from '../combat/PlayerDerivedStatsApplier.js';
import { HUDManager } from '../ui/HUDManager.js';
import { resolveMobConfig } from '../mob/MobRegistry.js';
import { PassiveManager } from '../passives/PassiveManager.js';
import { PassiveRegistry } from '../passives/PassiveRegistry.js';
import { DamageNumberSystem } from '../combat/DamageNumberSystem.js';
import { getOrCreateSoundManager } from '../audio/SoundManager.js';
import { setupAudioSystem } from '../audio/AudioSystem.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { SettingsMenu } from '../ui/SettingsMenu.js';
import { DEV_RUN } from '../config/gameConfig.js';
import { WerewolfBossController } from '../mob/boss/WerewolfBossController.js';
import { WerewolfEncounter } from '../encounters/WerewolfEncounter.js';

/**
 * Main gameplay scene.
 *
 * GameScene primarily coordinates reusable helper classes that encapsulate the 
 * heavy lifting (ground layer, overlay, pickups, AI, HUD, etc.). The scene focuses 
 * on lifecycle orchestration so the update loop stays readable and easy to extend.
 */
export class GameScene extends Phaser.Scene {
  /** Initialize GameScene state so runtime dependencies are ready. */
  constructor() {
    super('game');
    this._runStartedAt = null;
    this._totalPausedMs = 0;
    this._pausedAt = null;
    this.isGameOver = false;
    this._pauseSnapshot = null;
    this._pauseSources = new Set();
    this.isSimulationPaused = false;
    this._isShuttingDown = false;
  }

  /** Handle create so this system stays coordinated. */
  create() {
    // Reset transient run state before we instantiate any subsystems. Keeping
    // these flags centralised helps the helper classes observe the canonical
    // source of truth for player status and run timing.
    this.time.timeScale = 1;
    this.playerInputDisabled = false;
    this.playerCombatDisabled = false;
    this.endRunMenu = null;
    this.pauseMenu = null;
    this.settingsMenu = null;
    this.playerXP = 0;
    this._runStartedAt = null;
    this._totalPausedMs = 0;
    this._pausedAt = null;
    this.isGameOver = false;
    this._pauseSnapshot = null;
    this._pauseSources = new Set();
    this.isSimulationPaused = false;
    this.legionFormations = new Map();
    this._nextLegionId = 0;
    this._isShuttingDown = false;
    this._finale = null;
    this._arenaLocked = false;
    this._bossControllers = new Set();

    // Compose the scene via small focused helpers. Each method sets up a
    // specific slice of responsibility so future changes have a clear home.
    this._setupWorld();
    this._setupHero();
    this._setupSystems();
    this._setupWeapons();
    this._setupHUD();
    this._setupAudio();
    this.werewolfEncounter = new WerewolfEncounter(this, {
      mobKey: 'werewolf_boss',
      telegraphSfx: 'sfx.boss.howl',
      deathSfx: null, // add later when you have it
      defaultLeadInMs: 2500,
    });
    this._wireEvents();
    this._applyDevOverrides();
  }

  /** Handle _setupWorld so this system stays coordinated. */
  _setupWorld() {
    // Render settings that only touch the camera stay in the scene. All other
    // ground rendering logic lives inside the dedicated GroundLayer module.
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.setBackgroundColor(0x0b0f18);

    // Tile the ground texture independently of camera scroll/zoom.
    this.groundLayer = new GroundLayer(this);

    // Props still live in the scene because they couple closely with physics
    // colliders and spawn state. The registry keeps decoration data-driven.
    this.props = new PropSystem(this, {
      chunkSize: 384,
      seed: 12345,
      density: 3,
      registry: PropRegistry
    });

    // Screen-space overlay that handles the blood moon pulse animation.
    this.bloodMoon = new BloodMoonOverlay(this);
  }

  /** Handle _setupHero so this system stays coordinated. */
  _setupHero() {
    // Resolve the requested hero, falling back to the default if the scene was
    // started without data. Animation registration must happen before the hero
    // is instantiated so spritesheets can play back immediately.
    const requestedHeroKey = this.scene?.settings?.data?.heroKey;
    const heroEntry = getHeroEntry(requestedHeroKey ?? DEFAULT_HERO_KEY);
    this.heroEntry = heroEntry;
    registerHeroAnimations(this, heroEntry);
    registerMobAnimations(this);

    // Track facing so death animations and weapon firing can consult it.
    this.playerFacing = heroEntry.defaultFacing ?? 'down';

    // HeroFactory returns a fully-initialised bundle (sprite, controller,
    // health, glow, death controller, etc.). We keep a reference on the scene
    // so subsystems can consume it without tight coupling.
    this.hero = HeroFactory.create(this, heroEntry.key, {
      onFacingChange: (dir) => { this.playerFacing = dir; }
    });

    // Preserve backwards compatibility with older systems that expected
    // `scene.player` / `scene.playerHealth` instead of the hero bundle.
    Object.defineProperty(this, 'player', {
      configurable: true,
      enumerable: true,
      get: () => this.hero?.sprite
    });
    Object.defineProperty(this, 'playerHealth', {
      configurable: true,
      enumerable: true,
      get: () => this.hero?.health
    });

    this.playerDeathController = this.hero.deathController;

    // Smooth camera follow keeps the hero centred while still feeling weighty.
    //this.cameras.main.startFollow(this.hero.sprite, true, 0.12, 0.12);
    this.cameras.main.startFollow(this.hero.sprite, true, 1, 1);


    // Input bindings are still configured here so the controller remains a
    // reusable system. WASD + arrow keys mirror the previous behaviour.
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D');
    this.hero.controller.setInputSources({ cursors: this.cursors, wasd: this.keys });
  }

  /** Handle _setupSystems so this system stays coordinated. */
  _setupSystems() {
    // Pools, managers, and other simulation systems are wired together here so
    // their responsibilities remain isolated from the render/input setup.
    this.enemyPools = new EnemyPools(this, SpawnRegistry);
    this.enemies = this.enemyPools;
    this.dropManager = new DropManager(this);
    this.fx = new FXSystem(this);
    this.damageNumbers = new DamageNumberSystem(this, { fontKey: 'damage', size: 16 });

    const propColliders = this.props.getColliderGroup();
    const enemyGroup = this.enemyPools.getAllGroup();
    this.physics.add.collider(this.hero.sprite, propColliders);
    this.physics.add.collider(
      enemyGroup,
      propColliders,
      /* collideCallback */ undefined,
      /* processCallback */ (enemy /* from enemyGroup */, _prop /* from propColliders */) => {
        const cfg = enemy?.mobKey ? resolveMobConfig(enemy.mobKey) : null;
        // Only non-boss mobs should collide with props
        return cfg?.tier !== 'boss';
      }
    );

    this.physics.add.overlap(
      this.hero.sprite,
      enemyGroup,
      (_player, enemy) => {
        const mobCfg = enemy?.mobKey ? resolveMobConfig(enemy.mobKey) : null;
        const isMeleeBoss = mobCfg?.tier === 'boss' && mobCfg?.ai === 'seekAndMelee';
        if (isMeleeBoss) return;

        // Prefer the runtime Enemy.damage field, fall back to registry stats, then 1.
        const damage =
          (typeof enemy?.damage === 'number' ? enemy.damage : undefined) ??
          (typeof mobCfg?.stats?.damage === 'number' ? mobCfg.stats.damage : undefined) ??
          1;

        const tookDamage = this.hero.health.damage(damage);
        if (tookDamage) {
          this.cameras.main.shake(120, 0.003);
        }
      }
    );


    // LevelUpFlow encapsulates XP accumulation and modal lifecycle. Pausing is
    // delegated to shared helpers so multiple systems can freeze the sim.
    this.levelFlow = new LevelUpFlow(this);

    // PickupController composes magnetism + overlap detection + XP bookkeeping
    // so the scene no longer needs to maintain collectXP manually.
    this.pickups = new PickupController(this, {
      dropManager: this.dropManager,
      player: this.hero.sprite,
      levelFlow: this.levelFlow
    });

    // Centralise enemy AI updates so GameScene.update can stay declarative.
    this.enemyAI = new EnemyBehaviorSystem(this, { enemyGroup, hero: this.hero.sprite });

    this.enemyProjectiles = new EnemyProjectileSystem(this, {
      hero: this.hero.sprite,
      texture: 'fireball',
      animKey: 'fireball-loop',
      defaultDamage: 2,
      defaultSpeed: 220,
      defaultLifetimeMs: 4000,
      body: { width: 24, height: 24 },
      maxSize: 250,
    });

    // SpawnDirector drives enemy spawn pacing; DropSpawner feeds deaths into
    // the pickup pool, and DamagePipeline routes damage events through FX.
    const spawnConfig = { ...SpawnRegistry, timeline: SpawnTimeline };
    this.spawnDirector = new SpawnDirector(this, this.enemyPools, spawnConfig);
    this.dropSpawner = new DropSpawner(this, this.dropManager, DropTables);
    this.damagePipeline = new DamagePipeline(this, {
      enemyPools: this.enemyPools,
      dropSpawner: this.dropSpawner,
      fxSystem: this.fx
    });

    this.passiveManager = new PassiveManager(this, { hero: this.hero, events: this.events });
    const passiveAllowed = Array.isArray(this.heroEntry?.passives?.allowed)
      ? this.heroEntry.passives.allowed
      : Object.keys(PassiveRegistry);
    const passiveStarter = Array.isArray(this.heroEntry?.passives?.starter)
      ? this.heroEntry.passives.starter
      : [];
    this.passiveManager.setWhitelist(passiveAllowed);
    this.passiveManager.setLoadout(passiveStarter);
    this.derivedStats = new PlayerDerivedStatsApplier(this, {
      events: this.events,
      hero: this.hero,
      heroEntry: this.heroEntry,
      passiveManager: this.passiveManager
    });
    this.derivedStats.applyNow();

    this.enemyGroup = enemyGroup;
  }

  /** Handle _setupWeapons so this system stays coordinated. */
  _setupWeapons() {
    // WeaponManager needs a light-weight owner object so each weapon can query
    // position/facing without referencing GameScene directly.
    const weaponOwner = {
      getPos: () => ({ x: this.hero.sprite.x, y: this.hero.sprite.y }),
      getFacing: () => this.playerFacing,
      getBody: () => this.hero.sprite.body,
      canFire: () => !this.playerCombatDisabled && !this.playerHealth?.isDead?.()
    };

    this.weaponManager = new WeaponManager(this, weaponOwner, {
      enemyGroup: this.enemyGroup,
      damagePipeline: this.damagePipeline,
      events: this.events
    });

    const allRegistered = Object.keys(WeaponRegistry);
    const allowed = (this.heroEntry?.weapons?.allowed ?? allRegistered)
      .filter((key) => WeaponRegistry[key]);
    const starter = (this.heroEntry?.weapons?.starter ?? LEGACY_DEFAULT_STARTER_LOADOUT)
      .filter((key) => allowed.includes(key) && WeaponRegistry[key]);

    this.defaultLoadout = starter;
    this.weaponWhitelist = allowed;
    this.weaponManager.setWhitelist(allowed);
    this.weaponManager.setLoadout(starter);
  }

  /** Handle _setupHUD so this system stays coordinated. */
  _setupHUD() {
    // HUDManager encapsulates the loadout bar + debug text refresh cadence.
    this.hud = new HUDManager(this, {
      events: this.events,
      initialLoadout: this.weaponManager.getLoadout(),
      initialPassives: this.passiveManager?.getLoadout?.(),
      onPauseRequested: () => this.togglePauseMenu()
    });

    this.hero?.controller?.setMoveVectorProvider(() => this.hud?.getMoveVector?.() ?? { x: 0, y: 0 });
  }

  /** Handle _setupAudio so this system stays coordinated. */
  _setupAudio() {
    this.soundManager = getOrCreateSoundManager(this);
    this.soundManager?.loadFromStorage();
    setupAudioSystem(this, this.soundManager);
  }

  /** Handle _wireEvents so this system stays coordinated. */
  _wireEvents() {
    // Debug keys remain scene-owned so they stay easy to remove later.
    this.debugWeaponKeys = this.input.keyboard.addKeys({
      addBolt: Phaser.Input.Keyboard.KeyCodes.ONE,
      removeBolt: Phaser.Input.Keyboard.KeyCodes.TWO,
      buffBolt: Phaser.Input.Keyboard.KeyCodes.THREE
    });

    // Cache the bound handler so we can remove it from events during shutdown.
    this._onPlayerDeathFinished = () => this.handlePlayerDeathFinished();
    this.events.on('player:death:finished', this._onPlayerDeathFinished);
    this._onSpawnControl = (payload) => this._handleSpawnControl(payload);
    this.events.on('spawn:control', this._onSpawnControl);
    this._onEnemySpawned = ({ enemy } = {}) => {
      if (!enemy || enemy.mobKey !== 'werewolf_boss') return;
      if (enemy._bossController) return;

      const controller = new WerewolfBossController(this, enemy);
      enemy._bossController = controller;
      this._bossControllers.add(controller);
    };
    this.events.on('enemy:spawned', this._onEnemySpawned);
    this._onEnemyReleased = ({ enemy } = {}) => {
      const controller = enemy?._bossController;
      if (!controller) return;

      controller.destroy();
      this._bossControllers.delete(controller);
      enemy._bossController = null;
    };
    this.events.on('enemy:released', this._onEnemyReleased);

    // 🔑 Pause key handling (Esc / P)
    this._onPauseKey = (event) => {
      const toggled = this.togglePauseMenu();
      if (toggled) {
        event?.stopPropagation?.();
        event?.preventDefault?.();
      }
    };

    this.input.keyboard.on('keydown-ESC', this._onPauseKey);
    this.input.keyboard.on('keydown-P', this._onPauseKey);

    // Ensure helper classes tear themselves down gracefully when the scene
    // shuts down. Keeping the cleanup in one place prevents dangling listeners.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this._isShuttingDown = true;
      const dn = this.damageNumbers;
      this.damageNumbers = null;
      dn?.destroy?.();
      this.events.off('player:death:finished', this._onPlayerDeathFinished);
      this.events.off('spawn:control', this._onSpawnControl);
      this.events.off('enemy:spawned', this._onEnemySpawned);
      this.events.off('enemy:released', this._onEnemyReleased);
      this.events.off('enemy:died', this._onEnemyDied);
      this.derivedStats?.destroy?.();
      this.derivedStats = null;
      this.levelFlow?.destroy?.();
      this.pickups?.destroy?.();
      this.enemyAI?.destroy?.();
      this._bossControllers?.forEach?.((controller) => controller.destroy());
      this._bossControllers?.clear?.();
      this.werewolfEncounter?.destroy?.();
      this.werewolfEncounter = null;

      //this.enemyProjectiles?.destroy?.(); - updated to be destroyed in system file
      this.hud?.destroy?.();
      this.groundLayer?.destroy?.();
      this.bloodMoon?.destroy?.();
      this.endRunMenu?.destroy();
      this.endRunMenu = null;
      this.pauseMenu?.destroy?.();
      this.pauseMenu = null;
      this.settingsMenu?.destroy?.();
      this.settingsMenu = null;
      this.hero?.destroy?.();
      this.weaponManager?.destroy?.();
      this.passiveManager?.destroy?.();

      this.input.keyboard?.off('keydown-ESC', this._onPauseKey);
      this.input.keyboard?.off('keydown-P', this._onPauseKey);
    });
  }

  /** Handle _applyDevOverrides so this system stays coordinated. */
  _applyDevOverrides() {
    const cfg = DEV_RUN ?? {};
    if (!cfg.enabled) return;
    this.add.text(16, 48, 'DEV_RUN ACTIVE', {
      font: '14px monospace',
      color: '#ff4d4d'
    }).setScrollFactor(0).setDepth(9999);


    const startSeconds = Math.max(0, Number(cfg.startElapsedSeconds) || 0);
    const now = this.time?.now ?? 0;

    // Fast-forward the run clock
    this._runStartedAt = now - (startSeconds * 1000);
    this._totalPausedMs = 0;
    this._pausedAt = null;
    this.hud?.setStartTime?.(this._runStartedAt);
    this.spawnDirector?.seekToTime?.(startSeconds);

    // Apply starting level without triggering modals
    if ((cfg.startLevel ?? 0) > 0) {
      this.levelFlow?.debugSetLevel?.(cfg.startLevel, { snapToFloor: !!cfg.snapXPToLevelFloor });
    }

    // Replace weapon loadout deterministically (respecting whitelist)
    if (Array.isArray(cfg.weapons)) {
      const whitelist = Array.isArray(this.weaponWhitelist)
        ? this.weaponWhitelist
        : Array.from(this.weaponWhitelist ?? []);
      const normalizedWeapons = [];

      cfg.weapons.forEach((entry) => {
        if (!entry) return;
        const isObj = typeof entry === 'object';
        const key = isObj ? entry.key : entry;
        if (!key || (whitelist.length > 0 && !whitelist.includes(key))) return;

        const levelRaw = isObj ? entry.level : undefined;
        const fallbackLevel = Number(cfg.weaponLevelDefault);
        const effectiveLevel = Number.isFinite(levelRaw)
          ? levelRaw
          : (Number.isFinite(fallbackLevel) ? fallbackLevel : undefined);

        normalizedWeapons.push({ key, level: effectiveLevel });
      });

      if (normalizedWeapons.length > 0) {
        this.weaponManager?.setLoadout?.([]);
        normalizedWeapons.forEach(({ key, level }) => {
          const opts = {};
          if (Number.isFinite(level)) {
            opts.level = level;
          }
          this.weaponManager?.grantWeapon?.(key, opts);
        });
      }
    }

    // Apply passive stacks/loadout
    if (Array.isArray(cfg.passives)) {
      this.passiveManager?.setLoadout?.(cfg.passives);
    }
  }

  /** Handle _handleSpawnControl so this system stays coordinated. */
  _handleSpawnControl(payload) {
    if (payload?.disableWeightedSpawns) {
      this.spawnDirector?.setWeightedEnabled?.(false);
    }

    if (payload?.encounter === 'werewolf' && payload?.phase === 'start') {
      this.werewolfEncounter?.start(payload);
    }

    if (payload?.arena) {
      this._finale = {
        lockAtMs: this.time.now + (payload.cleanupMs ?? 15000),
        arena: payload.arena
      };
    }
  }

  /** Handle _collectRunStats so this system stays coordinated. */
  _collectRunStats() {
    const elapsedMs = this.getRunElapsedMs();
    return { timeSurvived: elapsedMs / 1000 };
  }

  /** Handle endRun so this system stays coordinated. */
  endRun(outcome, { reason, statsOverride } = {}) {
    if (this.isGameOver) return;

    // LevelUpFlow freezes the world; make sure we unpause before showing the
    // end-run UI so the menu remains responsive.
    this.levelFlow?.resume?.();

    this._pauseSources?.clear?.();
    this.isSimulationPaused = false;
    this._pauseSnapshot = null;
    this._pausedAt = null;

    this.playerInputDisabled = true;
    this.playerCombatDisabled = true;
    this.isGameOver = true;   // 🔑 freeze the simulation in update()

    const baseStats = this._collectRunStats();
    const stats = { ...baseStats, ...(statsOverride ?? {}) };

    const isWin = outcome === 'win';
    const title = isWin ? 'YOU WIN' : 'YOU DIED';
    const primaryLabel = isWin ? 'Play Again' : 'Retry';

    this.endRunMenu = new EndRunMenu(this, {
      stats,
      title,
      primaryLabel,
      onPrimary: () => {
        this.time.timeScale = 1;
        this.endRunMenu?.destroy();
        this.endRunMenu = null;
        this.scene.restart();
      },
      onMainMenu: () => {
        this.time.timeScale = 1;
        this.endRunMenu?.destroy();
        this.endRunMenu = null;
        this.scene.start('menu');
      }
    });
  }

  /** Handle handlePlayerDeathFinished so this system stays coordinated. */
  handlePlayerDeathFinished() {
    this.endRun('loss', { reason: 'playerDied' });
  }

  _getHeroIdleAnimKey() {
    const heroEntry = this.heroEntry ?? null;
    const heroKey = this.hero?.key ?? heroEntry?.key ?? null;
    const prefix = heroEntry?.animationPrefix ?? heroKey ?? heroEntry?.key ?? 'hero';
    const dir = this.playerFacing ?? heroEntry?.defaultFacing ?? 'down';

    // Common NOTBM keys: `${prefix}:idle-${dir}`
    const preferred = `${prefix}:idle-${dir}`;
    if (this.anims?.exists?.(preferred)) return preferred;

    // Graceful fallback
    const fallback = `${prefix}:idle-down`;
    if (this.anims?.exists?.(fallback)) return fallback;

    return null;
  }


  /** Handle _acquireSimulationPause so this system stays coordinated. */
  _acquireSimulationPause(source = 'unknown') {
    if (this._pauseSources.has(source)) return;

    const wasEmpty = this._pauseSources.size === 0;
    this._pauseSources.add(source);

    if (!wasEmpty) {
      // someone already has the world paused; nothing else to do
      return;
    }

    // ------------------------------------------------------------------
    // Pause modes
    // ------------------------------------------------------------------
    // pauseMenu: hard-pause time + physics (true pause)
    // levelup:   pause time (update loop early-outs), physics may keep stepping,
    //            so freeze bodies manually
    // bossDeath: keep time running (so boss death anim/tweens/delayedCall work),
    //            but pause physics + freeze bodies so nothing drifts
    const pausePhysics = (source === 'pauseMenu' || source === 'bossDeath');
    const freezeBodies = (source === 'levelup' || source === 'bossDeath');
    const pauseTime = (source === 'pauseMenu' || source === 'levelup'); // NOT bossDeath

    // NEW: for bossDeath + pauseMenu, pause hero animation so we don’t “run in place”
    const pauseHeroAnim = (source === 'pauseMenu' || source === 'bossDeath');

    const heroSprite = this.hero?.sprite ?? null;
    const heroBody = heroSprite?.body ?? null;

    const heroWasAnimPlaying = !!heroSprite?.anims?.isPlaying;
    const heroAnimKey = heroSprite?.anims?.currentAnim?.key ?? null;
    const heroAnimProgress = heroSprite?.anims?.getProgress?.() ?? 0;

    this._pauseSnapshot = {
      source,
      timeScale: this.time?.timeScale ?? 1,
      physicsTimeScale: this.physics?.world?.timeScale ?? 1,
      pausedPhysics: pausePhysics,

      freezeBodies,
      heroBodyWasEnabled: heroBody ? !!heroBody.enable : undefined,

      // NEW: animation snapshot for hero
      heroAnim: {
        pauseHeroAnim,
        wasPlaying: heroWasAnimPlaying,
        key: heroAnimKey,
        progress: heroAnimProgress,
        timeScale: heroSprite?.anims?.timeScale ?? 1,
      },

      frozenEnemyBodies: [],
    };

  this._pausedAt = this.time?.now ?? 0;

  // Pause timers/tweens that respect TimeScale; GameScene.update() also early-outs.
  if (pauseTime) {
    this.time.timeScale = 0;
  }

  // Hard-pause physics for pause menu AND bossDeath cinematic.
  if (pausePhysics && this.physics?.world) {
    this.physics.world.timeScale = 0;
    this.physics.world.pause();
  }

  this.playerInputDisabled = true;
  this.playerCombatDisabled = true;
  this.isSimulationPaused = true;

  // Stop hero movement immediately.
  if (heroBody) {
    heroBody.setVelocity?.(0, 0);
    heroBody.setAcceleration?.(0, 0);
  }

  // Pause hero animation for bossDeath/pauseMenu so we don’t “run in place”
  if (pauseHeroAnim && heroSprite?.anims) {
    heroSprite.anims.stop();

    const idleKey = this._getHeroIdleAnimKey?.();
    if (idleKey) {
      heroSprite.play(idleKey, true);
      heroSprite.anims.timeScale = 1;
    }
  }

  // Freeze bodies when needed (level-up and boss-death cinematic).
  if (freezeBodies) {
    if (heroBody) {
      // Disable body so Arcade won't integrate/collide it during the pause window.
      heroBody.enable = false;
    }

    const group = this.enemyPools?.getAllGroup?.();
    group?.children?.iterate?.((enemy) => {
      if (!enemy?.active) return;

      // IMPORTANT: during bossDeath, do NOT fully freeze/disable the boss body here.
      // The encounter already stops its motion and wants its anim/FX to complete.
      if (source === 'bossDeath' && (enemy.mobKey === 'werewolf_boss' || enemy._deathSequenceLock)) {
        enemy.body?.setVelocity?.(0, 0);
        enemy.body?.setAcceleration?.(0, 0);
        return;
      }

      const body = enemy?.body;
      if (!body) return;

      body.setVelocity?.(0, 0);
      body.setAcceleration?.(0, 0);

      body.enable = false;
      this._pauseSnapshot.frozenEnemyBodies.push(enemy);
    });
  } else {
    // Non-freeze pause: just stop any currently moving enemies (active only).
    this.enemyPools?.getAllGroup?.()?.children?.iterate?.((enemy) => {
      if (!enemy?.active) return;
      enemy?.body?.setVelocity?.(0, 0);
      enemy?.body?.setAcceleration?.(0, 0);
    });
  }
}

  /** Handle _releaseSimulationPause so this system stays coordinated. */
  _releaseSimulationPause(source = 'unknown') {
    if (!this._pauseSources.has(source)) return;

    this._pauseSources.delete(source);
    if (this._pauseSources.size > 0) {
      // another system still owns the pause
      return;
    }

    const now = this.time?.now ?? 0;
    if (this._pausedAt != null) {
      const pausedMs = Math.max(0, now - this._pausedAt);
      this._totalPausedMs += pausedMs;
      this._pausedAt = null;
    }

    const snap = this._pauseSnapshot ?? {};
    this.time.timeScale = snap.timeScale ?? 1;

    if (snap.pausedPhysics && this.physics?.world) {
      this.physics.world.timeScale = snap.physicsTimeScale ?? 1;
      this.physics.world.resume();
    }

    // If we froze bodies (level-up or bossDeath), re-enable them now.
    if (snap.freezeBodies) {
      const heroSprite = this.hero?.sprite ?? null;
      const heroBody = heroSprite?.body ?? null;

      if (heroBody) {
        heroBody.enable = snap.heroBodyWasEnabled ?? true;
        heroBody.setVelocity?.(0, 0);
        heroBody.setAcceleration?.(0, 0);
      }

      const frozen = snap.frozenEnemyBodies;
      if (Array.isArray(frozen)) {
        frozen.forEach((enemy) => {
          const body = enemy?.body;
          if (!body) return;
          body.enable = true;
          body.setVelocity?.(0, 0);
          body.setAcceleration?.(0, 0);
        });
      }
    }

    // NEW: resume hero animation if we paused it
    const heroSprite = this.hero?.sprite ?? null;
    const heroAnimSnap = snap.heroAnim ?? null;
    if (heroAnimSnap?.pauseHeroAnim && heroSprite?.anims) {
      // If you want to restore precisely:
      // - resume only if it was playing before
      // - restart the same anim at similar progress
      if (heroAnimSnap.wasPlaying && heroAnimSnap.key && this.anims?.exists?.(heroAnimSnap.key)) {
        heroSprite.play(heroAnimSnap.key, true);
        // Try to restore progress roughly (Phaser supports setProgress on AnimationState in recent versions)
        heroSprite.anims.setProgress?.(heroAnimSnap.progress ?? 0);
      } else {
        heroSprite.anims.stop();
      }
      heroSprite.anims.timeScale = heroAnimSnap.timeScale ?? 1;
    }

    this.playerInputDisabled = false;
    this.playerCombatDisabled = false;
    this._pauseSnapshot = null;
    this.isSimulationPaused = false;
  }

  /** Handle _markRunStarted so this system stays coordinated. */
  _markRunStarted() {
    if (this._runStartedAt != null) return; // already set

    const now = this.time?.now ?? 0;
    this._runStartedAt = now;
    this._totalPausedMs = 0;
    this._pausedAt = null;

    // Inform HUD so the on-screen timer uses the same timestamp.
    this.hud?.setStartTime?.(now);
  }

  /** Handle getRunElapsedMs so this system stays coordinated. */
  getRunElapsedMs() {
    if (!Number.isFinite(this._runStartedAt)) return 0;

    const now = this.time?.now ?? 0;
    const inFlightPaused = this._pausedAt != null
      ? Math.max(0, now - this._pausedAt)
      : 0;
    const totalPaused = this._totalPausedMs + inFlightPaused;

    return Math.max(0, now - this._runStartedAt - totalPaused);
  }

  /** Handle getRunElapsedSeconds so this system stays coordinated. */
  getRunElapsedSeconds() {
    return this.getRunElapsedMs() / 1000;
  }

  /** Handle togglePauseMenu so this system stays coordinated. */
  togglePauseMenu() {
    if (this._isShuttingDown) return false;
    if (this.isGameOver) return false;
    if (this.levelFlow?._modalActive) return false;
    if (this.settingsMenu) return false;

    this._togglePauseMenu();
    return true;
  }

  /** Handle _togglePauseMenu so this system stays coordinated. */
  _togglePauseMenu() {
    if (this.pauseMenu) {
      this._closePauseMenu();
    } else {
      this._openPauseMenu();
    }
  }

  /** Handle _openPauseMenu so this system stays coordinated. */
  _openPauseMenu() {
    if (this.pauseMenu) return;

    this._acquireSimulationPause('pauseMenu');

    this.pauseMenu = new PauseMenu(this, {
      onResume: () => this._closePauseMenu(),
      onMainMenu: () => {
        this._closePauseMenu();
        this.time.timeScale = 1;
        this.scene.start('menu');
      },
      onSettings: () => this._openSettingsFromPause()
    });
  }

  /** Handle _closePauseMenu so this system stays coordinated. */
  _closePauseMenu() {
    if (!this.pauseMenu) return;

    this.pauseMenu.destroy();
    this.pauseMenu = null;
    this._releaseSimulationPause('pauseMenu');
  }

  /** Handle _openSettingsFromPause so this system stays coordinated. */
  _openSettingsFromPause() {
    if (this.settingsMenu) return;

    this.settingsMenu = new SettingsMenu(this, {
      soundManager: this.soundManager,
      onClose: () => {
        this.settingsMenu?.destroy();
        this.settingsMenu = null;
      }
    });
  }

  /** Handle update so this system stays coordinated. */
  update(time, dt) {
    // 🔑 Once game over, stop advancing the world. HUD timer is already baked into stats.
    if (this.isGameOver) {
      return;
    }

    if (this._finale && !this._arenaLocked && (this.time?.now ?? 0) >= this._finale.lockAtMs) {
      const heroSprite = this.hero?.sprite;
      const body = heroSprite?.body;

      if (heroSprite && body) {
        const cam = this.cameras.main;

        // Current visible rectangle in world coords
        const view = cam.worldView; // { x, y, width, height }

        // Use the visible region as the arena bounds
        const x = view.x;
        const y = view.y;
        const arenaWidth = view.width;
        const arenaHeight = view.height;

        cam.setBounds(x, y, arenaWidth, arenaHeight);
        this.physics.world.setBounds(x, y, arenaWidth, arenaHeight);

        const heroSprite = this.hero?.sprite;
        const body = heroSprite?.body;
        if (heroSprite && body) {
          body.setCollideWorldBounds(true);
          body.setBounce(0, 0);

          // Ensure hero is inside bounds (defensive)
          heroSprite.x = Phaser.Math.Clamp(heroSprite.x, x, x + arenaWidth);
          heroSprite.y = Phaser.Math.Clamp(heroSprite.y, y, y + arenaHeight);
          body.reset(heroSprite.x, heroSprite.y);
        }

        this._arenaLocked = true;
      }
    }


    // 🔑 Shared pause (level-up, pause menu, etc.)
    if (this.isSimulationPaused) {
      return;
    }

    this._bossControllers?.forEach?.((controller) => controller.update(dt));

    // Lazily mark run start when the hero is actually spawned into the world
    if (this._runStartedAt == null && this.hero?.sprite?.body) {
      this._markRunStarted();
    }

    this.hero?.controller?.update?.(dt);
    this.weaponManager?.update?.(dt);

    if (this.debugWeaponKeys) {
      if (Phaser.Input.Keyboard.JustDown(this.debugWeaponKeys.addBolt)) {
        this.weaponManager?.addWeapon('bolt');
      }
      if (Phaser.Input.Keyboard.JustDown(this.debugWeaponKeys.removeBolt)) {
        this.weaponManager?.removeWeapon('bolt');
      }
      if (Phaser.Input.Keyboard.JustDown(this.debugWeaponKeys.buffBolt)) {
        this.weaponManager?.setModifiersForWeapon('bolt', [
          { type: 'delayMs%', value: -0.1 }
        ]);
      }
    }

    this.props?.update?.();
    this.pickups?.update?.(dt);
    this.enemyAI?.update?.(dt);
    this.enemyProjectiles?.update?.(dt);
    this.spawnDirector?.update?.(dt);
    this.groundLayer?.update?.();
    this.bloodMoon?.update?.(dt);
    this.hud?.update?.();
  }
}
