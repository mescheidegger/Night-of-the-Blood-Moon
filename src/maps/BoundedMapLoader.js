// Handles loading/rendering of tiled maps and object colliders for bounded map layouts.
export class BoundedMapLoader {
  constructor(scene, mapConfig) {
    this.scene = scene;
    this.mapConfig = mapConfig ?? {};
  }

  build() {
    // Bounded maps rely on a tilemap JSON config that defines layers + tilesets.
    const tilemapConfig = this.mapConfig.tilemap ?? {};
    if (!tilemapConfig.jsonKey) {
      console.warn('[BoundedMapLoader] Missing tilemap config');
      return {
        map: null,
        layersByName: {},
        objectLayersByName: {},
        collisionLayers: [],
        objectColliderGroup: null,
        obstacleRects: [],
      };
    }

    // Build the Phaser tilemap so the runtime can derive world bounds and colliders.
    const map = this.scene.make.tilemap({ key: tilemapConfig.jsonKey });

    const tilesets = (tilemapConfig.tilesets ?? [])
      .map((tileset) => {
        const name = tileset?.name ?? tileset?.key;
        const key = tileset?.key;
        if (!name || !key) return null;

        // Phaser returns null if it can't find the image key or the tileset name doesn't match.
        return map.addTilesetImage(name, key);
      })
      .filter(Boolean);

    const layersByName = {};
    const objectLayersByName = {};
    const collisionLayers = [];

    const collisionConfig = this.mapConfig.collision ?? {};
    const tileLayerRules = collisionConfig.tileLayerRules ?? {};
    const objectLayerRules = collisionConfig.objectLayerRules ?? {};

    // Create render layers and opt-in collision based on map config rules.
    (map.layers ?? []).forEach((layerData, index) => {
      if (!layerData) return;
      if (layerData.type && layerData.type !== 'tilelayer') return;

      const layerName = layerData.name;
      if (!layerName) return;

      const layer = map.createLayer(layerName, tilesets, 0, 0);
      if (!layer) return;

      layer.setDepth(index);
      layersByName[layerName] = layer;

      if (tileLayerRules[layerName]) {
        layer.setCollisionByExclusion([-1]);
        collisionLayers.push(layer);
      } else {
        // ensure collisions are disabled on non-collision layers
        layer.setCollisionByExclusion([-1], false);
      }
    });

    // Cache object layers for optional static collider construction.
    (map.objects ?? []).forEach((layerData) => {
      if (!layerData?.name) return;
      objectLayersByName[layerData.name] = layerData;
    });

    // Build static physics bodies from object layers for bounded maps.
    const { group: objectColliderGroup, obstacleRects } = this._buildObjectColliders(
      objectLayersByName,
      objectLayerRules
    );

    return {
      map,
      layersByName,
      objectLayersByName,
      collisionLayers,
      objectColliderGroup,
      obstacleRects,
    };
  }

  _buildObjectColliders(objectLayersByName, objectLayerRules) {
    const obstacleRects = [];

    // Only layers opted-in by rules are converted into physics rectangles.
    const eligibleLayerNames = Object.keys(objectLayersByName).filter(
      (name) => objectLayerRules?.[name]
    );

    if (!eligibleLayerNames.length) {
      return { group: null, obstacleRects };
    }

    const physics = this.scene?.physics;
    const canMakeBodies = Boolean(physics?.add?.staticGroup && physics?.add?.existing);

    // If physics isn't available, still return obstacleRects so pathing can work,
    // but skip creating Arcade bodies.
    const group = canMakeBodies ? physics.add.staticGroup() : null;

    eligibleLayerNames.forEach((layerName) => {
      const layerData = objectLayersByName[layerName];
      const objects = layerData?.objects ?? [];
      if (!objects.length) return;

      objects.forEach((obj) => {
        if (!obj) return;

        // Tiled uses top-left (x,y) for rectangles.
        const x = Number(obj.x);
        const y = Number(obj.y);
        const w = Number(obj.width);
        const h = Number(obj.height);

        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
        if (w <= 0.5 || h <= 0.5) return; // skip degenerate rectangles

        // Record for pathing (stamp these into walkable grid).
        obstacleRects.push({ x, y, w, h, layerName, id: obj.id });

        // Build a static physics rect for Arcade collisions (if enabled).
        if (!canMakeBodies) return;

        // Rectangle is centered; object coords are top-left.
        const rect = this.scene.add
          .rectangle(x + w / 2, y + h / 2, w, h, 0xff0000, 0)
          .setOrigin(0.5);

        physics.add.existing(rect, true);
        group.add(rect);
      });
    });

    return { group, obstacleRects };
  }
}
