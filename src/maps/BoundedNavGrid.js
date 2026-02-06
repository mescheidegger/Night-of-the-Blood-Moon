// BoundedNavGrid: cell-resolution walkability mask for bounded maps (tiles + object obstacle rects).
export class BoundedNavGrid {
  constructor(scene, {
    tilemap,
    collisionLayers = [],
    obstacleRects = [],
    cellSize = 8,

    // If your tilemap/layers are positioned in world space, set these to match.
    // Default assumes map origin at world (0,0) unless deriveOriginFromTilemap kicks in.
    originX = null,
    originY = null,

    // Inflate blocked geometry so an enemy's BODY can fit around corners.
    // NOTE: this expands blocked shapes outward; keep modest.
    paddingPx = null,

    // Shrink colliding tile rects BEFORE applying padding.
    // Example: tileErodePx=1 turns a 32x32 blocked tile into 30x30 blocked (shrunk by 1px on each side).
    // For "shrink by 2px total", set tileErodePx=1.
    tileErodePx = 1,

    // If obstacleRects are authored in MAP-LOCAL pixels (common with Tiled object layers),
    // set this true to automatically offset them by (originX, originY) into WORLD space.
    // If your obstacleRects are already WORLD coordinates, leave false.
    obstacleRectsAreMapLocal = false,

    // If your tilemap is placed in world space (tilemap/layers have x/y offsets),
    // this will derive originX/originY from tilemap.x/y when originX/originY are not explicitly set.
    // Leave true unless you know your map is always at (0,0).
    deriveOriginFromTilemap = true,
  } = {}) {
    this.scene = scene;
    this.map = tilemap;

    this.collisionLayers = Array.isArray(collisionLayers) ? collisionLayers : [];
    this.obstacleRects = Array.isArray(obstacleRects) ? obstacleRects : [];
    this.obstacleRectsAreMapLocal = !!obstacleRectsAreMapLocal;

    this.cellSize = Math.max(1, Number(cellSize) || 8);

    // -----------------------------
    // Origin handling
    // - originX/originY default to null; only considered explicit if finite.
    // -----------------------------
    const tmx = Number(tilemap?.x);
    const tmy = Number(tilemap?.y);

    const explicitX = Number.isFinite(Number(originX)) ? Number(originX) : null;
    const explicitY = Number.isFinite(Number(originY)) ? Number(originY) : null;

    const useTilemapOrigin =
      !!deriveOriginFromTilemap &&
      explicitX == null &&
      explicitY == null &&
      Number.isFinite(tmx) &&
      Number.isFinite(tmy);

    this.originX = explicitX != null ? explicitX : (useTilemapOrigin ? tmx : 0);
    this.originY = explicitY != null ? explicitY : (useTilemapOrigin ? tmy : 0);

    // Tile erosion (shrink colliding tile bounds before stamping)
    this.tileErodePx = Math.max(0, Number(tileErodePx) || 0);

    // Padding in WORLD pixels to expand blocked rects when stamping.
    const autoPad = Math.ceil(this.cellSize * 0.75); // e.g., cellSize 8 => 6px
    this.paddingPx = Number.isFinite(Number(paddingPx))
      ? Math.max(0, Number(paddingPx))
      : autoPad;

    // Back-compat: older debug/UI code may still read nav.tileSize.
    this.tileSize = this.cellSize;

    // Map pixel extents (MAP-LOCAL)
    const pixelW =
      tilemap?.widthInPixels ??
      (tilemap?.width ?? 0) * (tilemap?.tileWidth ?? 0);

    const pixelH =
      tilemap?.heightInPixels ??
      (tilemap?.height ?? 0) * (tilemap?.tileHeight ?? 0);

    this.pixelW = Number(pixelW) || 0;
    this.pixelH = Number(pixelH) || 0;

    this.w = Math.ceil(this.pixelW / this.cellSize);
    this.h = Math.ceil(this.pixelH / this.cellSize);
    this.walkable = new Uint8Array(this.w * this.h); // 1 walkable, 0 blocked

    this._buildWalkableFromCollisionLayers();
    this._applyObstacleRects();
    this._blockOutsideMapPixels();
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
    // Convert world pixels -> cell coords, accounting for nav origin.
    const tx = Math.floor((x - this.originX) / this.cellSize);
    const ty = Math.floor((y - this.originY) / this.cellSize);
    return { tx, ty };
  }

  tileToWorldCenter(tx, ty) {
    // Convert cell coords -> world pixels, accounting for nav origin.
    return {
      x: this.originX + tx * this.cellSize + this.cellSize * 0.5,
      y: this.originY + ty * this.cellSize + this.cellSize * 0.5
    };
  }

  /**
   * Find a nearby walkable nav cell around (tx,ty) via a ring scan.
   * Useful if physics places an enemy in a blocked nav cell (corner pushes, spawn overlap, etc).
   */
  findNearestWalkableTile(tx, ty, maxR = 6) {
    if (!this.inBounds(tx, ty)) return null;
    if (this.isWalkable(tx, ty)) return { tx, ty };

    const R = Math.max(0, (Number(maxR) || 0) | 0);
    for (let r = 1; r <= R; r += 1) {
      // Top/bottom edges
      for (let dx = -r; dx <= r; dx += 1) {
        const nxTop = tx + dx;
        const nyTop = ty - r;
        if (this.inBounds(nxTop, nyTop) && this.isWalkable(nxTop, nyTop)) return { tx: nxTop, ty: nyTop };

        const nxBot = tx + dx;
        const nyBot = ty + r;
        if (this.inBounds(nxBot, nyBot) && this.isWalkable(nxBot, nyBot)) return { tx: nxBot, ty: nyBot };
      }

      // Left/right edges (excluding corners)
      for (let dy = -r + 1; dy <= r - 1; dy += 1) {
        const nxLeft = tx - r;
        const nyLeft = ty + dy;
        if (this.inBounds(nxLeft, nyLeft) && this.isWalkable(nxLeft, nyLeft)) return { tx: nxLeft, ty: nyLeft };

        const nxRight = tx + r;
        const nyRight = ty + dy;
        if (this.inBounds(nxRight, nyRight) && this.isWalkable(nxRight, nyRight)) return { tx: nxRight, ty: nyRight };
      }
    }

    return null;
  }

  _stampBlockedRect(worldX, worldY, rw, rh) {
    const { w, cellSize, originX, originY, paddingPx } = this;

    // Inflate by padding so the center-point flow field respects body radius.
    const pad = Number.isFinite(paddingPx) ? paddingPx : 0;

    // Convert world pixels -> nav-local pixels for stamping (with padding).
    const x = (worldX - originX) - pad;
    const y = (worldY - originY) - pad;
    const ww = rw + pad * 2;
    const hh = rh + pad * 2;

    const minTx = Math.max(0, Math.floor(x / cellSize));
    const maxTx = Math.min(this.w - 1, Math.ceil((x + ww) / cellSize) - 1);
    const minTy = Math.max(0, Math.floor(y / cellSize));
    const maxTy = Math.min(this.h - 1, Math.ceil((y + hh) / cellSize) - 1);

    if (maxTx < minTx || maxTy < minTy) return;

    for (let ty = minTy; ty <= maxTy; ty += 1) {
      const rowBase = ty * w;
      for (let tx = minTx; tx <= maxTx; tx += 1) {
        this.walkable[rowBase + tx] = 0;
      }
    }
  }

  _applyObstacleRects() {
    if (!this.w || !this.h) return;

    for (const rect of this.obstacleRects) {
      let x = Number(rect?.x);
      let y = Number(rect?.y);
      const rw = Number(rect?.w);
      const rh = Number(rect?.h);

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(rw) || !Number.isFinite(rh)) continue;
      if (rw <= 0 || rh <= 0) continue;

      // If rects came from a map-local object layer, shift into WORLD coords by origin.
      if (this.obstacleRectsAreMapLocal) {
        x += this.originX;
        y += this.originY;
      }

      // Obstacle rects are expected in WORLD coordinates at this point.
      this._stampBlockedRect(x, y, rw, rh);
    }
  }

  _buildWalkableFromCollisionLayers() {
    if (!this.w || !this.h) return;

    // Start as walkable everywhere.
    this.walkable.fill(1);

    const er = this.tileErodePx || 0;

    // Apply colliding tile geometry at cell resolution by stamping each colliding tile bounds.
    // tile.getBounds() is in WORLD coordinates -> stamp expects WORLD coordinates.
    for (const layer of this.collisionLayers) {
      const data = layer?.layer?.data;
      if (!data) continue;

      for (const row of data) {
        if (!row) continue;

        for (const tile of row) {
          if (!tile?.collides) continue;

          const rect = tile.getBounds?.();
          if (!rect) continue;

          if (er > 0) {
            const x = rect.x + er;
            const y = rect.y + er;
            const w = rect.width - er * 2;
            const h = rect.height - er * 2;

            if (w > 0 && h > 0) {
              this._stampBlockedRect(x, y, w, h);
            } else {
              this._stampBlockedRect(rect.x, rect.y, rect.width, rect.height);
            }
          } else {
            this._stampBlockedRect(rect.x, rect.y, rect.width, rect.height);
          }
        }
      }
    }
  }

  _blockOutsideMapPixels() {
    const { w, h, cellSize, pixelW, pixelH } = this;
    if (!w || !h || !pixelW || !pixelH) return;

    // pixelW/pixelH are MAP-LOCAL extents.
    // Since the nav grid’s indices are ALSO map-local (origin handled in worldToTile/tileToWorldCenter),
    // the bounds test must stay map-local too.
    for (let ty = 0; ty < h; ty += 1) {
      const cy = (ty + 0.5) * cellSize; // nav-local
      const rowBase = ty * w;
      for (let tx = 0; tx < w; tx += 1) {
        const cx = (tx + 0.5) * cellSize; // nav-local
        if (cx >= pixelW || cy >= pixelH) {
          this.walkable[rowBase + tx] = 0;
        }
      }
    }
  }
}
