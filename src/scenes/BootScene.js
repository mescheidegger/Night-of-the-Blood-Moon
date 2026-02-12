import Phaser from 'phaser';
import { HERO_ATLAS_IMAGE_PATH, HERO_ATLAS_JSON_PATH, HERO_ATLAS_KEY } from '../hero/HeroAtlasConfig.js';
import { ensureHeroSheetTextures, loadHeroAssets } from '../hero/HeroAssets.js';
import { HeroRegistry, listHeroes } from '../hero/HeroRegistry.js';
import { MobRegistry } from '../mob/MobRegistry.js';
import { loadMobAssets } from '../mob/MobAssets.js';
import { PROP_ATLASES } from '../prop/PropRegistry.js';
import { loadPropAssets } from '../prop/PropAssets.js';
import { WeaponRegistry } from '../weapons/WeaponRegistry.js';
import { loadWeaponAssets } from '../weapons/WeaponAssets.js';
import { registerWeaponAnimations } from '../weapons/registerWeaponAnimations.js';
import { PassiveRegistry } from '../passives/PassiveRegistry.js';
import { MapRegistry, listMaps } from '../maps/MapRegistry.js';
import { buildLoadingUI } from '../ui/BootLoadingUI.js';

export class BootScene extends Phaser.Scene {
  /** Initialize BootScene state so runtime dependencies are ready. */
  constructor() {
    super('boot');
  }

  /** Handle preload so this system stays coordinated. */
  preload() {

    const g = this.add.graphics();

    // Player glow (used as an additive halo in GameScene)
    g.clear();
    g.fillStyle(0xd9d4ff, 0.35); // pale lavender, semi-transparent
    g.fillCircle(8, 8, 8);
    g.generateTexture('player_glow', 16, 16);

    // Bolt + spark
    g.clear();
    g.fillStyle(0xe9e2ff, 1);
    g.fillRect(0, 0, 12, 2);
    g.generateTexture('bolt', 12, 2);

    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(1, 1, 1);
    g.generateTexture('spark', 2, 2);

    g.destroy();
    
    const ui = buildLoadingUI(this);
    this._bootLoadingUI = ui;

    let shownProgress = 0;

    const onProgress = (value) => {
      shownProgress = Math.max(shownProgress, value ?? 0);
      ui.setProgress(shownProgress);
    };

    const onFileProgress = (fileObj) => {
      // Nicer label than raw URL, but still informative
      const type = fileObj?.type ? String(fileObj.type) : '';
      const key = fileObj?.key ? String(fileObj.key) : '';
      const label = type && key ? `${type}: ${key}` : (key || fileObj?.src || '');
      ui.setFile(label);
    };

    const onLoadError = (fileObj) => {
      console.error('[BootScene] Load error:', fileObj?.key, fileObj?.src);
      ui.setStatus('Load error. Retrying…');
    };

    const onComplete = () => {
      ui.setProgress(1);
      ui.setStatus('Starting…');
    };

    const onResize = (gameSize) => {
      if (!gameSize) return;
      ui.resize(gameSize.width, gameSize.height);
    };

    // As soon as menumoon finishes, attach it to the UI.
    const onMoonReady = () => {
      ui.attachMoonIfReady?.();
    };

    this.load.on('progress', onProgress);
    this.load.on('fileprogress', onFileProgress);
    this.load.on('loaderror', onLoadError);
    this.load.once('complete', onComplete);
    this.load.once('filecomplete-image-menumoon', onMoonReady);
    this.scale.on('resize', onResize);

    this._bootLoadingHandlers = {
      onProgress,
      onFileProgress,
      onLoadError,
      onComplete,
      onResize,
      onMoonReady,
    };

    // Ensure we clean up listeners even if the scene is stopped unexpectedly.
    this.events.once('shutdown', () => {
      this.load.off('progress', onProgress);
      this.load.off('fileprogress', onFileProgress);
      this.load.off('loaderror', onLoadError);
      this.load.off('complete', onComplete);
      this.load.off('filecomplete-image-menumoon', onMoonReady);
      this.scale.off('resize', onResize);
      ui.destroy();
      this._bootLoadingUI = null;
      this._bootLoadingHandlers = null;
    });

    // --- Procedural gameplay textures (minimal set we still need)


    // --- Real art from /public/assets (Vite serves /public from '/')
    // World tiles / props
    this.load.image('ground', '/assets/tiles/largegrass.png');

    // Packed hero atlas containing every animation strip.
    this.load.atlas(HERO_ATLAS_KEY, HERO_ATLAS_IMAGE_PATH, HERO_ATLAS_JSON_PATH);

    // Pull every prop atlas defined in the registry so scene logic never has
    // to stay in sync with loader calls manually.
    loadPropAssets(this);

    // Hero spritesheets/images described in the registry; keeps boot logic data-driven.
    loadHeroAssets(this, HeroRegistry);

    // Enemy mobs described in the MobRegistry.
    loadMobAssets(this, MobRegistry);

    // Weapon art + FX described in the registry.
    loadWeaponAssets(this, WeaponRegistry);

    // XP gems + UI art
    this.load.image('xpgem', '/assets/sprites/gems/xpgem.png');
    this.load.image('largexpgem', '/assets/sprites/gems/largexpgem.png');
    this.load.image('minorhealth', '/assets/sprites/gems/minorhealth.png');
    this.load.image('majorhealth', '/assets/sprites/gems/majorhealth.png');

    // Menu moon (used in MenuScene; attached to boot UI once loaded)
    this.load.image('menumoon', '/assets/blood_moon_transparent.png');

    this.load.bitmapFont('damage', '/assets/fonts/damage.png', '/assets/fonts/damage.xml');
    this.load.bitmapFont('pixeloperator', '/assets/fonts/pixeloperator8_0.png', '/assets/fonts/pixeloperator8.fnt');

    // --- Passive icons: now packed into a single texture atlas
    this.load.atlas(
      'passives_atlas',
      '/assets/sprites/passives/passives.png',
      '/assets/sprites/passives/passives.json'
    );

    // --- Weapon icons: packed into a single atlas
    this.load.atlas(
      'weaponicons_atlas',
      '/assets/sprites/weapons/weaponicons.png',
      '/assets/sprites/weapons/weaponicons.json'
    );

    // --- Weapon animation atlas (slash strips, etc.)
    this.load.atlas(
      'weaponanimations_atlas',
      '/assets/sprites/weapons/weaponanimations.png',
      '/assets/sprites/weapons/weaponanimations.json'
    );

    Object.values(MapRegistry).forEach((mapEntry) => {
      const tilemap = mapEntry?.tilemap;
      if (!tilemap?.jsonKey || !tilemap?.jsonPath) return;

      this.load.tilemapTiledJSON(tilemap.jsonKey, tilemap.jsonPath);

      (tilemap.tilesets ?? []).forEach((tileset) => {
        if (!tileset?.key || !tileset?.path) return;
        this.load.image(tileset.key, tileset.path);
      });
    });

    listMaps().forEach((mapEntry) => {
      const thumbnailKey = mapEntry?.ui?.thumbnailKey;
      const thumbnailPath = mapEntry?.ui?.thumbnailPath;
      if (thumbnailKey && thumbnailPath) {
        this.load.image(thumbnailKey, thumbnailPath);
      }
    });

  }

  /** Handle create so this system stays coordinated. */
  create() {
    ensureHeroSheetTextures(this, HeroRegistry);

    // Assert textures exist (helps catch path/key issues immediately)
    const heroAtlas = this.textures.get(HERO_ATLAS_KEY);

    const heroTextures = listHeroes().flatMap((hero) => {
      const sheetKeys = Object.values(hero.sheets ?? {})
        .map((sheet) => sheet.key)
        .filter(Boolean);

      const uiKeys = [];
      if (hero.ui?.icon?.key && hero.ui.icon.key !== HERO_ATLAS_KEY) uiKeys.push(hero.ui.icon.key);
      if (hero.ui?.portrait?.key) uiKeys.push(hero.ui.portrait.key);

      return [...sheetKeys, ...uiKeys];
    });

    if (heroAtlas) {
      listHeroes().forEach((hero) => {
        const iconFrame = hero.ui?.icon?.frame;
        if (hero.ui?.icon?.key !== HERO_ATLAS_KEY || typeof iconFrame !== 'string') {
          return;
        }
        if (!heroAtlas.has(iconFrame)) {
          console.warn('[BootScene] Missing hero icon frame in atlas', {
            heroKey: hero.key,
            frame: iconFrame,
          });
        }
      });
    }

    const mobTextures = Object.values(MobRegistry)
      .map((mob) => mob.sheetKey)
      .filter(Boolean);

    // Include prop atlas keys so the assertion tracks registry-driven assets.
    const propTextures = PROP_ATLASES.map((atlas) => atlas.key);

    const needsWeaponAnimationsAtlas = Object.values(WeaponRegistry).some(
      (weapon) => weapon?.projectile?.atlas === 'weaponanimations_atlas'
    );

    const weaponTextures = Object.values(WeaponRegistry).flatMap((weapon) => {
      const textures = [];
      const projectile = weapon.projectile;
      const fromAtlas = projectile?.atlas && projectile?.atlasFrame;
      if (!fromAtlas && projectile?.texture) textures.push(projectile.texture);
      if (weapon.fx?.muzzle) textures.push(weapon.fx.muzzle);
      if (weapon.fx?.impact) textures.push(weapon.fx.impact);
      return textures;
    });

    const hasWeaponIcons = Object.values(WeaponRegistry).some((weapon) => weapon?.ui?.icon);
    const weaponIconTextures = hasWeaponIcons ? ['weaponicons_atlas'] : [];

    // Passive icons are now frames inside a single atlas; just assert the atlas exists.
    const passiveTextures = Object.values(PassiveRegistry).length > 0 ? ['passives_atlas'] : [];

    const weaponAnimationTextures = needsWeaponAnimationsAtlas ? ['weaponanimations_atlas'] : [];

    const mapTileTextures = Object.values(MapRegistry).flatMap((mapEntry) =>
      (mapEntry?.tilemap?.tilesets ?? []).map((tileset) => tileset.key)
    );

    const mapPreviewTextures = listMaps()
      .map((mapEntry) => mapEntry?.ui?.thumbnailKey)
      .filter(Boolean);

    const required = [
      'ground',
      'player_glow',
      'xpgem',
      'largexpgem',
      'minorhealth',
      'majorhealth',
      'menumoon',
      HERO_ATLAS_KEY,
      ...mobTextures,
      ...heroTextures,
      ...propTextures,
      ...weaponTextures,
      ...weaponIconTextures,
      ...passiveTextures,
      ...weaponAnimationTextures,
      ...mapTileTextures,
      ...mapPreviewTextures,
    ];

    const missing = required.filter((k) => !this.textures.exists(k));
    if (missing.length) {
      console.error('[BootScene] Missing textures:', missing);
    }

    registerWeaponAnimations(this);

    // Clean up loading UI + listeners (safe even if shutdown already ran)
    if (this._bootLoadingUI) {
      const handlers = this._bootLoadingHandlers;
      if (handlers) {
        this.load.off('progress', handlers.onProgress);
        this.load.off('fileprogress', handlers.onFileProgress);
        this.load.off('loaderror', handlers.onLoadError);
        this.load.off('complete', handlers.onComplete);
        this.load.off('filecomplete-image-menumoon', handlers.onMoonReady);
        this.scale.off('resize', handlers.onResize);
      }
      this._bootLoadingUI.destroy();
      this._bootLoadingUI = null;
      this._bootLoadingHandlers = null;
    }

    this.scene.start('menu');
  }
}
