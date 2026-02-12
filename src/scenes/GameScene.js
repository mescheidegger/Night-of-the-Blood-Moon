import Phaser from 'phaser';
import { FXSystem } from '../fx/FXSystem.js';
import { PropSystem } from '../prop/PropSystem.js';
import { PropRegistries } from '../prop/PropRegistry.js';
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
import { DEFAULT_SPAWN_TIMELINE_KEY, SpawnTimeline, SpawnTimelineRegistry } from '../spawn/SpawnTimeline.js';
import { GroundLayer } from '../world/GroundLayer.js';
import { BloodMoonOverlay } from '../world/BloodMoonOverlay.js';
import { LevelUpFlow } from '../progression/LevelUpFlow.js';
import { PickupController } from '../drops/controllers/PickupController.js';
import { EnemyBehaviorSystem } from '../combat/EnemyBehaviorSystem.js';
import { EnemyProjectileSystem } from '../combat/EnemyProjectileSystem.js';
import { PlayerDerivedStatsApplier } from '../combat/PlayerDerivedStatsApplier.js';
import { HUDManager } from '../ui/HUDManager.js';
import { resolveMobCollisionFlags, resolveMobConfig } from '../mob/MobRegistry.js';
import { PassiveManager } from '../passives/PassiveManager.js';
import { PassiveRegistry } from '../passives/PassiveRegistry.js';
import { DamageNumberSystem } from '../combat/DamageNumberSystem.js';
import { getOrCreateSoundManager } from '../audio/SoundManager.js';
import { setupAudioSystem } from '../audio/AudioSystem.js';
import { DEV_RUN } from '../config/gameConfig.js';
import { WerewolfEncounter } from '../encounters/WerewolfEncounter.js';
import { DEFAULT_MAP_KEY, MapRegistry } from '../maps/MapRegistry.js';
import { BoundedMapLoader } from '../maps/BoundedMapLoader.js';
import { BoundedNavGrid } from '../maps/BoundedNavGrid.js';
import { FlowField } from '../maps/FlowField.js';
import { MapDebugOverlay } from '../maps/MapDebugOverlay.js';
import { MapRuntime } from '../maps/MapRuntime.js';
import { MapQuery } from '../maps/MapQuery.js';
import { resetRunState } from './game/resetRunState.js';
import { PauseController } from './game/PauseController.js';
import { wireGameSceneEvents } from './game/wireEvents.js';
import { cleanupGameScene } from './game/cleanup.js';
import { applyDevRun } from './game/applyDevRun.js';
import { updateArenaLock } from './game/arenaLock.js';
import { stepSimulation } from './game/stepSimulation.js';
import { applyMapRenderOrder, resolveMapRenderConfig } from './game/applyMapRenderOrder.js';

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
    applyMapRenderOrder(this);
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

    const mapKey = this.scene?.settings?.data?.mapKey ?? DEFAULT_MAP_KEY;
    this.mapKey = mapKey;
    this.mapConfig = MapRegistry[mapKey] ?? MapRegistry[DEFAULT_MAP_KEY];
    this.mapRender = resolveMapRenderConfig(this.mapConfig);
    const mapType = this.mapConfig?.type ?? 'infinite';
    const propMode = this.mapConfig?.props?.mode ?? 'procedural';

    this.mapTilemap = null;
    this.mapLayers = [];
    this.mapCollisionLayers = [];
    this.mapObjectColliders = null;
    this.mapObstacleRects = [];
    this.mapSpawnPoints = {
      all: [],
      byName: {},
      byKey: {},
      layerNames: [],
      areas: { all: [], byName: {}, byKey: {}, layerNames: [] },
    };

    // Bounded maps load a tilemap + colliders instead of infinite ground tiling.
    if (mapType === 'bounded') {
      this.groundLayer = new GroundLayer(this, { ...this.mapConfig.ground, mode: 'disabled' });

      const loader = new BoundedMapLoader(this, this.mapConfig);
      const {
        map,
        layersByName,
        collisionLayers,
        objectColliderGroup,
        obstacleRects,
        spawnPoints,
      } = loader.build();
      this.mapTilemap = map;
      this.mapLayers = Object.values(layersByName);
      this.mapCollisionLayers = collisionLayers;
      this.mapObjectColliders = objectColliderGroup;
      this.mapObstacleRects = obstacleRects ?? [];
      this.mapSpawnPoints = spawnPoints ?? this.mapSpawnPoints;
      this.navGridSmall = new BoundedNavGrid(this, {
        tilemap: this.mapTilemap,
        collisionLayers: this.mapCollisionLayers,
        obstacleRects: this.mapObstacleRects,
        cellSize: 8,
        paddingPx: 2,
        tileErodePx: 0,
      });

      this.navGridBig = new BoundedNavGrid(this, {
        tilemap: this.mapTilemap,
        collisionLayers: this.mapCollisionLayers,
        obstacleRects: this.mapObstacleRects,
        cellSize: 8,
        paddingPx: 24,
        tileErodePx: 0,
      });

      this.flowFieldSmall = new FlowField(this.navGridSmall);
      this.flowFieldBig = new FlowField(this.navGridBig);

      this.navGrid = this.navGridSmall;
      this.flowField = this.flowFieldSmall;
    } else {
      // Tile the ground texture independently of camera scroll/zoom.
      this.groundLayer = new GroundLayer(this, { ...this.mapConfig.ground, mode: 'infinite' });
    }

    // Props still live in the scene because they couple closely with physics
    // colliders and spawn state. The registry keeps decoration data-driven.
    if (propMode !== 'procedural') {
      this.props = null;
    } else {
      const registryKey = this.mapConfig.props?.registryKey ?? 'all';
      const registry = PropRegistries[registryKey] ?? PropRegistries.all;
      this.props = new PropSystem(this, {
        ...this.mapConfig.props,
        registry,
      });
    }

    // MapRuntime drives bounded helper logic (bounds, clamping, inside tests).
    this.mapRuntime = new MapRuntime(this.mapConfig, { tilemap: this.mapTilemap });
    this.mapQuery = new MapQuery(this);
    const worldBounds = this.mapRuntime.getWorldBounds();
    // Clamp physics + camera to the bounded map rectangle.
    if (this.mapRuntime.isBounded() && worldBounds) {
      this.physics.world.setBounds(worldBounds.x, worldBounds.y, worldBounds.width, worldBounds.height);
      this.cameras.main.setBounds(worldBounds.x, worldBounds.y, worldBounds.width, worldBounds.height);
    }

    const isDevMode = import.meta.env.DEV && DEV_RUN?.enabled === true;
    this.mapDebugOverlay = isDevMode ? new MapDebugOverlay(this) : null;

    // Screen-space overlay that handles the blood moon pulse animation.
    this.bloodMoon = new BloodMoonOverlay(this, { depth: this.mapRender?.overlayDepth });
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

    let spawnPoint = null;
    const spawnKey = this.mapConfig?.spawns?.heroKey ?? 'player';
    const spawnPoints = this.mapSpawnPoints?.byKey?.[spawnKey] ?? [];
    if (spawnPoints.length) {
      spawnPoint = Phaser.Utils.Array.GetRandom(spawnPoints);
    } else if (this.mapRuntime?.isBounded?.()) {
      const bounds = this.mapRuntime.getWorldBounds?.();
      if (bounds) {
        spawnPoint = { x: bounds.centerX, y: bounds.centerY };
      }
    }

    // HeroFactory returns a fully-initialised bundle (sprite, controller,
    // health, glow, death controller, etc.). We keep a reference on the scene
    // so subsystems can consume it without tight coupling.
    this.hero = HeroFactory.create(this, heroEntry.key, {
      x: spawnPoint?.x ?? 0,
      y: spawnPoint?.y ?? 0,
      onFacingChange: (dir) => { this.playerFacing = dir; }
    });

    const actorBaseDepth = this.mapRender?.actorBaseDepth ?? 0;
    const heroDepthOffset = heroEntry?.depth?.sprite ?? 2;
    const heroDepth = actorBaseDepth + heroDepthOffset;
    this.hero.sprite?.setDepth?.(heroDepth);
    const glowDepth = actorBaseDepth + (heroEntry?.cosmetics?.glowDepth ?? (heroDepthOffset - 1));
    this.hero.glow?.setDepth?.(glowDepth);
    if (this.hero.healthBar?.background && this.hero.healthBar?.fill) {
      this.hero.healthBar.background.setDepth(heroDepth + 2);
      this.hero.healthBar.fill.setDepth(heroDepth + 3);
    }

    // Bounded maps keep the hero from leaving the world rectangle.
    if (this.mapRuntime?.isBounded?.()) {
      this.hero.sprite?.setCollideWorldBounds?.(true);
    }

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
    this.damageNumbers = new DamageNumberSystem(this, { fontKey: 'pixeloperator', size: 16 });

    const propColliders = this.props?.getColliderGroup?.() ?? null;
    const enemyGroup = this.enemyPools.getAllGroup();
    // Ensure bounded maps keep enemy bodies inside world bounds as they spawn.
    if (this.mapRuntime?.isBounded?.()) {
      enemyGroup.children?.iterate?.((enemy) => {
        const flags = enemy?.collisionFlags ?? resolveMobCollisionFlags(enemy?.mobKey);
        enemy?.body?.setCollideWorldBounds?.(flags.worldBounds !== false);
      });
      enemyGroup.on?.('add', (enemy) => {
        const flags = enemy?.collisionFlags ?? resolveMobCollisionFlags(enemy?.mobKey);
        enemy?.body?.setCollideWorldBounds?.(flags.worldBounds !== false);
      });
    }
    if (propColliders) {
      this.physics.add.collider(this.hero.sprite, propColliders);
      this.physics.add.collider(
        enemyGroup,
        propColliders,
        /* collideCallback */ undefined,
        /* processCallback */ (enemy /* from enemyGroup */, _prop /* from propColliders */) => {
          const flags = enemy?.collisionFlags ?? resolveMobCollisionFlags(enemy?.mobKey);
          return flags.props !== false;
        }
      );
    }

    if (this.mapCollisionLayers?.length) {
      this.mapCollisionLayers.forEach((layer) => {
        this.physics.add.collider(this.hero.sprite, layer);
        this.physics.add.collider(
          enemyGroup,
          layer,
          /* collideCallback */ undefined,
          /* processCallback */ (enemy) => {
            const flags = enemy?.collisionFlags ?? resolveMobCollisionFlags(enemy?.mobKey);
            return flags.mapLayers !== false;
          }
        );
      });
    }

    if (this.mapObjectColliders) {
      this.physics.add.collider(this.hero.sprite, this.mapObjectColliders);
      this.physics.add.collider(
        enemyGroup,
        this.mapObjectColliders,
        /* collideCallback */ undefined,
        /* processCallback */ (enemy) => {
          const flags = enemy?.collisionFlags ?? resolveMobCollisionFlags(enemy?.mobKey);
          return flags.mapObjects !== false;
        }
      );
    }

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
    const spawnTimelineKey = this.mapConfig?.spawnTimelineKey ?? DEFAULT_SPAWN_TIMELINE_KEY;
    const resolvedTimeline = SpawnTimelineRegistry[spawnTimelineKey] ?? SpawnTimeline;
    const spawnConfig = { ...SpawnRegistry, timeline: resolvedTimeline };
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
      onPauseRequested: () => this.togglePauseMenu(),
      depthBase: this.mapRender?.uiBaseDepth
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
    const snapshot = this.hud?.runStats?.getSnapshot?.();
    if (snapshot) {
      return {
        timeSurvived: snapshot.timeSurvivedSeconds,
        kills: snapshot.kills,
        xpEarned: snapshot.xpEarned,
        damageDealt: snapshot.damageDealt,
      };
    }

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
      depthBase: this.mapRender?.uiBaseDepth,
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
