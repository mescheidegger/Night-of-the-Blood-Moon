// BoundedNavGrid: tile-only walkability mask for bounded maps (32x32 tiles).
export class BoundedNavGrid {
  constructor(scene, {
    tilemap,
    collisionLayers = [],
    tileSize = 32
  } = {}) {
    this.scene = scene;
    this.map = tilemap;
    this.collisionLayers = collisionLayers;
    this.tileSize = tileSize;

    const w = tilemap?.width ?? 0;
    const h = tilemap?.height ?? 0;

    this.w = w;
    this.h = h;
    this.walkable = new Uint8Array(w * h); // 1 walkable, 0 blocked

    this._buildWalkableFromCollisionLayers();
  }

  idx(tx, ty) {
    return ty * this.w + tx;
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  isWalkable(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    return this.walkable[this.idx(tx, ty)] === 1;
  }

  worldToTile(x, y) {
    // Assumes tilemap at (0,0). If you offset the tilemap later, subtract it here.
    const tx = Math.floor(x / this.tileSize);
    const ty = Math.floor(y / this.tileSize);
    return { tx, ty };
  }

  tileToWorldCenter(tx, ty) {
    return {
      x: tx * this.tileSize + this.tileSize * 0.5,
      y: ty * this.tileSize + this.tileSize * 0.5
    };
  }

  _buildWalkableFromCollisionLayers() {
    const { w, h } = this;
    if (!w || !h) return;

    // Start as walkable everywhere.
    this.walkable.fill(1);

    // If any collision layer reports collides at (tx,ty) => blocked.
    for (const layer of this.collisionLayers) {
      const data = layer?.layer?.data;
      if (!data) continue;

      for (let ty = 0; ty < h; ty += 1) {
        const row = data[ty];
        if (!row) continue;

        for (let tx = 0; tx < w; tx += 1) {
          const tile = row[tx];
          if (tile?.collides) {
            this.walkable[this.idx(tx, ty)] = 0;
          }
        }
      }
    }
  }
}