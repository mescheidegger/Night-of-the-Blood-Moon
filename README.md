Night of the Endless Moon
=======================================

A dark-fantasy, top-down survivor-lite inspired by Vampire Survivors and
classic roguelikes. Fight endless waves of monsters under a cursed endless
moon, collect upgrades, and push your build as far as it can go before
the night consumes you.

The project is a highly modular, registry-driven prototype built with
Phaser 3 and Vite, focused on deterministic simulation, pooled entities,
and data-driven gameplay systems.

Play the game: https://www.endlessmoon.io/

------------------------------------------------------------------------

Night of the Endless Moon — System Overview
=======================================

Concise, code-facing notes for working inside the Night of the Endless Moon prototype. The project uses Vite to bundle a Phaser 3 top-down survivor-lite with Arcade Physics and pixel-art rendering.

----------------------------------------------------------------

0) Runtime & Entry Points
------------------------

Entry:
- index.html hosts a fullscreen #app container and forces crisp sprites (canvas { image-rendering: pixelated; }).
- main.js instantiates Phaser.Game (960×540 internal resolution, pixelArt: true, Arcade physics with gravity disabled, Scale.FIT + CENTER_BOTH).

PWA bootstrap:
- index.html links manifest.webmanifest, theme color, and iOS install metadata.
- main.js registers public/sw.js after window load when service workers are available.
- Service worker pre-caches a small shell, tolerates missing hashed bundles, uses network-first for navigation and cache-first for assets.

Scene order:
- BootScene → MenuScene → HeroSelectScene → GameScene
- Scene keys: 'boot', 'menu', 'hero-select', 'game'

Asset roots:
- Vite serves /public from /
- Runtime textures live under /public/assets/

----------------------------------------------------------------

1) Scene Responsibilities
-------------------------

BootScene (src/scenes/BootScene.js)
- Generates procedural textures (player_glow, bolt, spark)
- Loads static art (ground, menumoon, xpgem)
- Delegates registry-driven asset queues:
  - loadPropAssets
  - loadHeroAssets
  - loadMobAssets
  - loadWeaponAssets
- Conditionally loads weaponanimations_atlas when required by weapons
- Preloads AUDIO_MANIFEST
- Verifies all required textures exist before transitioning

MenuScene (src/scenes/MenuScene.js)
- Animated tile background with multiply tint overlay
- Title + moon composition with proportional scaling
- Interactive container buttons with shared UI styling
- Keyboard shortcuts mirror pointer input
- Modal overlays block background input
- Reads NOTBM:lastHero from localStorage

HeroSelectScene (src/scenes/HeroSelectScene.js)
- Shared menu background visuals
- Hero grid built from HeroRegistry
- Mouse + keyboard navigation with focus highlighting
- Detail panel mirrors focused hero metadata
- Persists hero choice to localStorage
- Transition guard to prevent duplicate launches

GameScene (src/scenes/GameScene.js)
Coordinator scene that bootstraps all subsystems. Update loop runs:
  hero controller → weapons → pickups → enemy AI → enemy projectiles → spawns → render helpers → HUD

World setup:
- GroundLayer: infinite scrolling ground
- PropSystem: chunked deterministic decorative props
- BloodMoonOverlay: pulsing multiply tint overlay

Hero bootstrap:
- Resolves hero entry from HeroRegistry
- Registers hero + mob animations
- HeroFactory returns hero bundle (sprite, controller, HealthSystem, health bar, death controller)
- Camera follows hero with smoothing

Simulation systems:
- EnemyPools: pooled enemies with unified physics group and caps
- SpawnDirector: weighted spawn pacing and scripted timeline
- DropManager / DropSpawner: XP and loot
- DamagePipeline: central damage + death routing
- FXSystem: lightweight impact FX
- LevelUpFlow: XP, level-ups, pause control
- PickupController: XP collection and magnet logic
- EnemyBehaviorSystem: AI dispatcher
- EnemyProjectileSystem: pooled enemy projectiles
- DamageNumberSystem: floating combat text

Collisions:
- Player ↔ props (solid obstacles)
- Player ↔ enemies (damage + camera shake)
- Player ↔ drops (XP pickup)

Weapons:
- WeaponManager owns hero loadout
- Registry-driven weapon controllers
- HUD icons from weaponicons_atlas
- Enemy AI reuses weapon registry projectiles via EnemyProjectileWeaponController

Audio:
- SoundManager listens for weapon:fired, combat:hit, enemy:died
- Weapon fire SFX + hit SFX are registry-driven
- Mob death SFX optional per entry

Death flow:
- PlayerDeathController plays directional death animation
- Time slow-mo and player:death:finished event
- GameOverMenu overlay

Shared pause:
- Simulation pause snapshot system
- Used by pause menu and level-up modals
- Esc/P toggles pause overlay
- Logical run clock excludes pauses

HUD:
- HUDManager owns loadout bar and debug text
- XPBar via LevelUpFlow

----------------------------------------------------------------

2) Content Registries & Asset Loading
------------------------------------

Heroes (src/hero/HeroRegistry.js)
- Declarative hero definitions (stats, spritesheets, UI metadata, physics)
- DEFAULT_HERO_KEY = knight
- Assets and animations auto-registered

Mobs (src/mob/MobRegistry.js)
- Enemy archetypes (mobs, elites, bosses)
- Sheet metadata, physics bodies, stats, rewards, AI, audio hooks
- Idempotent animation registration
- Boss entries support full idle/move/attack/hit/death sets

Drops (src/drops/DropRegistry.js)
- Drop textures, magnet tuning, physics body, TTL

Drop Tables
- Weighted tables mapping mob keys to drop entries

Props (src/prop/PropRegistry.js)
- Decorative props from atlases
- Weight, scale, rotation, tint, collider config

Weapons (src/weapons/WeaponRegistry.js)
- Registry-driven weapons with:
  - projectile config
  - AoE
  - audio.fire / audio.hit
  - progression curves
  - UI metadata

Registries keep gameplay fully data-driven.

----------------------------------------------------------------

3) Entity & Hero Domain Layer
-----------------------------

Enemy (src/mob/entities/Enemy.js)
- Pooled Arcade Sprite
- reset() hydrates texture, stats, body, animation

BaseDrop (src/drops/entities/BaseDrop.js)
- Pooled XP/loot entity
- Magnet metadata + circular physics

HeroFactory
- Creates hero sprite, glow, controller, health system, UI

HeroController
- Keyboard input, diagonal normalization, facing, animation

HeroHealthBar
- World-space health meter

HeroDeathController
- Death animation and time-slow orchestration

----------------------------------------------------------------

4) Core Systems
----------------

World:
- GroundLayer
- PropSystem
- BloodMoonOverlay

Combat:
- EnemyPools
- EnemyBehaviorSystem
- EnemyProjectileSystem
- DamagePipeline
- HealthSystem
- DamageNumberSystem
- PlayerDeathController

Spawn:
- SpawnDirector
- SpawnTimeline
- SpawnRegistry
- SpawnSystem (legacy)

Drops:
- DropManager
- DropSpawner
- CollectSystem
- MagnetSystem

Progression:
- LevelSystem
- LevelUpFlow
- PickupController
- LevelUpRewards

Weapons:
- WeaponManager
- Weapon controllers
- WeaponProgression

FX:
- FXSystem

Core:
- Pool

----------------------------------------------------------------

5) UI Systems
--------------

- Menu buttons and modal overlays
- SettingsMenu with persisted audio settings
- GameOverMenu overlay
- PauseMenu overlay
- HUDManager
- LevelUpFlow modals

----------------------------------------------------------------

6) Input, Camera, Rendering
----------------------------

Input:
- Arrow keys + WASD
- Contextual shortcuts per scene

Camera:
- Smooth follow camera
- Infinite ground UV scrolling
- setRoundPixels(true)

Rendering:
- Pixel art pipeline
- ADD blend for FX
- MULTIPLY blend for blood moon overlay

----------------------------------------------------------------

7) Physics & Gameplay Invariants
--------------------------------

- Arcade physics only, gravity disabled
- Enemy bodies driven from registry
- Drops use circular magnet bodies
- Props use immovable AABBs
- Pooling contract: reset() hydrates, release() fully disables

----------------------------------------------------------------

8) Directory Layout
-------------------

/public
  assets/
/docs
  system.md
/index.html
/main.js
/src
  world/
  combat/
  spawn/
  progression/
  weapons/
  drops/
  hero/
  mob/
  fx/
  core/
  scenes/
  ui/
  prop/
  config/

----------------------------------------------------------------

9) Configuration Knobs
----------------------

- src/config/gameConfig.js: global tuning
- CONFIG.WEAPONS: weapon defaults
- CONFIG.DIFFICULTY: scaling
- DEV_RUN: dev-only overrides

----------------------------------------------------------------

Assets & Licensing
------------------

All game art and audio assets are sourced from:
- itch.io
- OpenGameArt
- Mixkit
- Pixabay

Assets are not included in this repository to prevent conflicts with distribution requirements.
All referenced assets are CC0 or free-to-use.

----------------------------------------------------------------