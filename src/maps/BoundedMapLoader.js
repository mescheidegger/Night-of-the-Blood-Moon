// Handles loading/rendering of tiled maps and object colliders for bounded map layouts.
export class BoundedMapLoader {
  constructor(scene, mapConfig) {
    this.scene = scene;
    this.mapConfig = mapConfig ?? {};
  }

  build() {
    // Return a consistent payload so callers can safely destructure even on failure.
    // Bounded maps rely on a tilemap JSON config that defines layers + tilesets.
    const tilemapConfig = this.mapConfig.tilemap ?? {};
    if (!tilemapConfig.jsonKey) {
      console.warn('[BoundedMapLoader] Missing tilemap config');
      return {
        map: null,
        layersByName: {},
        objectLayersByName: {},
        spawnPoints: {
          all: [],
          byName: {},
          byKey: {},
          layerNames: [],
          areas: { all: [], byName: {}, byKey: {}, layerNames: [] },
        },
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

      // Preserve layer order from Tiled for predictable draw stacking.
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

    const spawnPoints = this._extractSpawnPoints(objectLayersByName, this.mapConfig?.spawns);

    return {
      map,
      layersByName,
      objectLayersByName,
      spawnPoints,
      collisionLayers,
      objectColliderGroup,
      obstacleRects,
    };
  }

  _extractSpawnPoints(objectLayersByName, spawnConfig) {
    if (!spawnConfig) {
      return {
        all: [],
        byName: {},
        byKey: {},
        layerNames: [],
        areas: { all: [], byName: {}, byKey: {}, layerNames: [] },
      };
    }

    const layerNames = Array.isArray(spawnConfig?.layers)
      ? spawnConfig.layers
      : (spawnConfig?.layer ? [spawnConfig.layer] : []);

    if (!layerNames.length) {
      return {
        all: [],
        byName: {},
        byKey: {},
        layerNames: [],
        areas: { all: [], byName: {}, byKey: {}, layerNames: [] },
      };
    }

    const all = [];
    const byName = {};

    layerNames.forEach((layerName) => {
      const layerData = objectLayersByName?.[layerName];
      if (!layerData) return;

      const points = this._extractPointObjects(layerData, layerName);
      points.forEach((point) => {
        all.push(point);
        if (point.name) {
          if (!byName[point.name]) {
            byName[point.name] = [];
          }
          byName[point.name].push(point);
        }
      });
    });

    const { byKey } = this._buildSpawnGroups({ all, byName }, spawnConfig);
    const areas = this._extractSpawnAreas(objectLayersByName, spawnConfig, layerNames);

    return {
      all,
      byName,
      byKey,
      layerNames,
      areas,
    };
  }

  _extractPointObjects(layerData, layerName) {
    const objects = Array.isArray(layerData?.objects) ? layerData.objects : [];

    return objects
      .filter((obj) => obj && (obj.point || (Number(obj.width) === 0 && Number(obj.height) === 0)))
      .map((obj) => {
        const properties = {};
        (obj.properties ?? []).forEach((property) => {
          if (!property?.name) return;
          properties[property.name] = property.value;
        });

        return {
          id: obj.id,
          name: obj.name ?? null,
          type: obj.type ?? null,
          x: Number(obj.x) || 0,
          y: Number(obj.y) || 0,
          properties,
          layerName,
        };
      });
  }

  _extractSpawnAreas(objectLayersByName, spawnConfig, layerNames) {
    const all = [];
    const byName = {};

    layerNames.forEach((layerName) => {
      const layerData = objectLayersByName?.[layerName];
      if (!layerData) return;

      const rects = this._extractRectObjects(layerData, layerName);
      rects.forEach((rect) => {
        all.push(rect);
        if (rect.name) {
          if (!byName[rect.name]) {
            byName[rect.name] = [];
          }
          byName[rect.name].push(rect);
        }
      });
    });

    const { byKey } = this._buildSpawnGroups({ all, byName }, spawnConfig);

    return {
      all,
      byName,
      byKey,
      layerNames,
    };
  }

  _extractRectObjects(layerData, layerName) {
    const objects = Array.isArray(layerData?.objects) ? layerData.objects : [];

    return objects
      .filter((obj) => {
        if (!obj) return false;
        if (obj.point) return false;
        const width = Number(obj.width);
        const height = Number(obj.height);
        return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
      })
      .map((obj) => {
        const properties = {};
        (obj.properties ?? []).forEach((property) => {
          if (!property?.name) return;
          properties[property.name] = property.value;
        });

        return {
          id: obj.id,
          name: obj.name ?? null,
          type: obj.type ?? null,
          x: Number(obj.x) || 0,
          y: Number(obj.y) || 0,
          width: Number(obj.width) || 0,
          height: Number(obj.height) || 0,
          properties,
          layerName,
        };
      });
  }

  _buildSpawnGroups({ all, byName }, spawnConfig) {
    const byKey = {};
    const keys = spawnConfig?.keys ?? {};
    Object.entries(keys).forEach(([key, name]) => {
      if (!name) return;
      const points = byName[name] ?? [];
      if (points.length) {
        byKey[key] = points;
      }
    });

    const groups = spawnConfig?.groups ?? {};
    Object.entries(groups).forEach(([key, group]) => {
      // Normalize string group definitions into a config object.
      if (!group) return;
      const normalized = typeof group === 'string' ? { key: group } : group;

      // Collect matched points while deduplicating across match rules.
      const matched = new Map();
      const addPoints = (points = []) => {
        points.forEach((point) => {
          if (!point) return;
          // Prefer the Tiled object id, fall back to a stable composite key.
          matched.set(point.id ?? `${point.layerName}:${point.name}:${point.x}:${point.y}`, point);
        });
      };

      // Exact-name matching (back-compat with older group configs).
      const name = normalized?.key ?? normalized?.name;
      if (name) {
        addPoints(byName[name] ?? []);
      }

      // Prefix matching for multi-point groupings like enemy_spawn1/2/3.
      const prefix = normalized?.prefix;
      if (prefix) {
        addPoints(all.filter((point) => point?.name?.startsWith(prefix)));
      }

      // Property matching for custom object metadata (e.g., spawnGroup=enemy).
      const property = normalized?.property;
      if (property) {
        const matchValue = normalized?.value;
        addPoints(
          all.filter((point) => {
            const propValue = point?.properties?.[property];
            // When no value is supplied, accept any defined property.
            if (matchValue === undefined) {
              return propValue !== undefined;
            }
            return propValue === matchValue;
          })
        );
      }

      const points = Array.from(matched.values());
      if (points.length) {
        byKey[key] = points;
      }
    });

    return { byKey };
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
