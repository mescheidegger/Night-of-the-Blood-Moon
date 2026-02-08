/**
 * Normalizes and resolves render-related configuration for a bounded map.
 *
 * This function reads the optional `mapConfig.render` block and computes
 * a fully-populated render config object with sensible defaults.
 *
 * It centralizes all render-layer decisions (depth bands, hidden layers, etc.)
 * so the rest of the scene does not need to know about raw map config shape.
 *
 * @param {Object} mapConfig - The map configuration entry from MapRegistry.
 * @returns {Object} A normalized render configuration object.
 */
export function resolveMapRenderConfig(mapConfig = {}) {
  // Extract the optional render block from the map config.
  const render = mapConfig?.render ?? {};

  // Determine whether the map explicitly defines a base depth band for actors
  // (player + enemies). If not provided, we fall back to 0.
  const hasActorBaseDepth = Number.isFinite(render.actorBaseDepth);
  const actorBaseDepth = hasActorBaseDepth ? render.actorBaseDepth : 0;

  // Explicit per-layer depth overrides (e.g. { Grass: 0, Walls: 300 }).
  // If omitted, layers retain whatever depth they were given elsewhere.
  const layerDepths = render.layerDepths ?? {};

  // List of layer names that should be hidden entirely (visual only).
  const hiddenLayers = Array.isArray(render.hiddenLayers) ? render.hiddenLayers : [];

  // Whether tile collision layers should automatically be hidden.
  // Defaults to true unless explicitly set to false.
  const hideCollisionLayers = render.hideCollisionLayers !== false;

  /**
   * Overlay depth (for things like BloodMoonOverlay, screen tint, etc.).
   *
   * If explicitly defined, use it.
   * Otherwise:
   *   - If actorBaseDepth exists, place overlays well above actors using
   *     overlayDepthOffset (default 500).
   *   - If no actor base band exists, use a small fallback depth (10).
   */
  const overlayDepth = Number.isFinite(render.overlayDepth)
    ? render.overlayDepth
    : (hasActorBaseDepth ? actorBaseDepth + (render.overlayDepthOffset ?? 500) : 10);

  /**
   * UI base depth (for HUD, menus, etc.).
   *
   * If explicitly defined, use it.
   * Otherwise:
   *   - If actorBaseDepth exists, place UI safely above everything using
   *     uiDepthOffset (default 1000).
   *   - If not, fall back to 1000.
   */
  const uiBaseDepth = Number.isFinite(render.uiBaseDepth)
    ? render.uiBaseDepth
    : (hasActorBaseDepth ? actorBaseDepth + (render.uiDepthOffset ?? 1000) : 1000);

  return {
    actorBaseDepth,
    hasActorBaseDepth,
    layerDepths,
    hiddenLayers,
    hideCollisionLayers,
    overlayDepth,
    uiBaseDepth,
  };
}

/**
 * Applies map-specific render ordering rules to the current scene.
 *
 * This function:
 *  - Resolves (or reuses) the scene's mapRender config.
 *  - Applies explicit depth overrides to tile layers.
 *  - Hides layers configured as hidden.
 *  - Optionally hides collision-only tile layers.
 *
 * It does NOT control sprite (player/enemy) depth — that should be handled
 * separately using `actorBaseDepth` or Y-sorting logic.
 *
 * @param {Phaser.Scene} scene - The active GameScene.
 */
export function applyMapRenderOrder(scene) {
  if (!scene) return;

  // Resolve and cache the normalized render configuration for this scene.
  const mapRender = scene.mapRender ?? resolveMapRenderConfig(scene.mapConfig);
  scene.mapRender = mapRender;

  const layers = scene.mapLayers ?? [];
  if (!layers.length) return;

  // Build a set of layer names that should be hidden.
  const hidden = new Set(mapRender.hiddenLayers ?? []);

  // If configured, automatically hide tile layers marked as collision-only
  // in mapConfig.collision.tileLayerRules.
  if (mapRender.hideCollisionLayers) {
    const tileLayerRules = scene.mapConfig?.collision?.tileLayerRules ?? {};
    Object.entries(tileLayerRules).forEach(([layerName, isCollision]) => {
      if (isCollision) {
        hidden.add(layerName);
      }
    });
  }

  // Apply depth overrides and visibility rules per tile layer.
  layers.forEach((layer) => {
    // Support both Phaser TilemapLayer and fallback naming.
    const layerName = layer?.layer?.name ?? layer?.name;
    if (!layerName) return;

    // If a specific depth override exists for this layer, apply it.
    const depth = mapRender.layerDepths?.[layerName];
    if (Number.isFinite(depth)) {
      layer.setDepth(depth);
    }

    // Hide the layer if configured to do so.
    if (hidden.has(layerName)) {
      layer.setVisible(false);
    }
  });
}
