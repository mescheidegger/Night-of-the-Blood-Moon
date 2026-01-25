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
import { DEV_RUN } from '../config/gameConfig.js';
import { WerewolfEncounter } from '../encounters/WerewolfEncounter.js';
import { resetRunState } from './game/resetRunState.js';
import { PauseController } from './game/PauseController.js';
import { wireGameSceneEvents } from './game/wireEvents.js';
import { cleanupGameScene } from './game/cleanup.js';
import { applyDevRun } from './game/applyDevRun.js';
import { updateArenaLock } from './game/arenaLock.js';
import { stepSimulation } from './game/stepSimulation.js';

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
    resetRunState(this);

    // Compose the scene via small focused helpers. Each method sets up a
    // specific slice of responsibility so future changes have a clear home.
    this.pause = new PauseController(this);
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
    this._disposeEvents = wireGameSceneEvents(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => cleanupGameScene(this));
    applyDevRun(this, DEV_RUN);
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
    this.cameras.main.startFollow(this.hero.sprite, true, 0.12, 0.12);
    //this.cameras.main.startFollow(this.hero.sprite, true, 1, 1);


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

  _acquireSimulationPause(source = 'unknown') {
    this.pause?.acquire?.(source);
  }

  _releaseSimulationPause(source = 'unknown') {
    this.pause?.release?.(source);
  }

  _markRunStarted() {
    this.pause?.markRunStarted?.();
  }

  getRunElapsedMs() {
    return this.pause?.getRunElapsedMs?.() ?? 0;
  }

  getRunElapsedSeconds() {
    return this.pause?.getRunElapsedSeconds?.() ?? 0;
  }

  togglePauseMenu() {
    return this.pause?.toggleMenu?.() ?? false;
  }

  /** Handle update so this system stays coordinated. */
  update(time, dt) {
    // 🔑 Once game over, stop advancing the world. HUD timer is already baked into stats.
    if (this.isGameOver) {
      return;
    }

    updateArenaLock(this);

    // 🔑 Shared pause (level-up, pause menu, etc.)
    if (this.pause?.isPaused?.()) {
      return;
    }

    this._bossControllers?.forEach?.((controller) => controller.update(dt));

    // Lazily mark run start when the hero is actually spawned into the world
    if (this._runStartedAt == null && this.hero?.sprite?.body) {
      this._markRunStarted();
    }

    stepSimulation(this, dt);
  }
}
