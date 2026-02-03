// Draws bounded map debug overlays (world bounds, collision tiles, object colliders, nav/flow-field).
export class MapDebugOverlay {
  constructor(
    scene,
    {
      depth = 40,
      showCollisionTiles = true,
      showObjectColliders = false,

      // Nav / flow:
      showNavBlockedTiles = false,
      showFlowField = true,
      flowStride = 2,

      // Diagnostics:
      showUnreachableTiles = true,     // walkable but dist === -1
      showHeroTile = true,             // highlight current target tile
      showFlowDistances = false,       // keep off by default (text is expensive)
    } = {}
  ) {
    this.scene = scene;

    this.showCollisionTiles = showCollisionTiles;
    this.showObjectColliders = showObjectColliders;

    this.showNavBlockedTiles = showNavBlockedTiles;
    this.showFlowField = showFlowField;
    this.flowStride = Math.max(1, flowStride | 0);

    this.showUnreachableTiles = showUnreachableTiles;
    this.showHeroTile = showHeroTile;
    this.showFlowDistances = showFlowDistances;

    this.visible = false;

    this.graphics = scene.add.graphics().setDepth(depth);
    this.graphics.setVisible(false);

    // NOTE: If you later want numeric distances, use a pooled BitmapText layer.
  }

  setVisible(isVisible) {
    this.visible = !!isVisible;
    this.graphics.setVisible(this.visible);
    if (this.visible) this.refresh();
    else this.graphics.clear();
  }

  toggle() {
    this.setVisible(!this.visible);
  }

  refresh() {
    this.graphics.clear();
    if (!this.visible) return;

    const scene = this.scene;
    const runtime = scene?.mapRuntime;

    // Bounds exist only for bounded maps, so guard for null.
    const bounds = runtime?.getWorldBounds?.();
    if (bounds) {
      this.graphics.lineStyle(2, 0x44ff77, 1);
      this.graphics.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    if (this.showObjectColliders) {
      const objectGroup = scene?.mapObjectColliders;
      const children = objectGroup?.getChildren?.() ?? [];
      this.graphics.lineStyle(1, 0xff5555, 0.9);
      children.forEach((obj) => {
        const rect = obj?.getBounds?.();
        if (!rect) return;
        this.graphics.strokeRect(rect.x, rect.y, rect.width, rect.height);
      });
    }

    if (this.showCollisionTiles) {
      const layers = scene?.mapCollisionLayers ?? [];
      this.graphics.lineStyle(1, 0xffd24d, 0.6);
      layers.forEach((layer) => {
        const data = layer?.layer?.data;
        if (!data) return;
        data.forEach((row) => {
          row.forEach((tile) => {
            if (!tile?.collides) return;
            const rect = tile.getBounds?.();
            if (!rect) return;
            this.graphics.strokeRect(rect.x, rect.y, rect.width, rect.height);
          });
        });
      });
    }

    // -----------------------------
    // Nav / Flow-field overlay
    // -----------------------------
    if (!runtime?.isBounded?.()) return;

    const nav = scene?.navGrid;
    const flow = scene?.flowField;
    const heroSprite = scene?.player ?? scene?.hero?.sprite ?? null;

    if (!nav) return;

    const tileSize = nav.tileSize ?? 32;
    const w = nav.w ?? 0;
    const h = nav.h ?? 0;
    if (!w || !h) return;

    // Nav-blocked tiles (nav mask).
    if (this.showNavBlockedTiles && nav.walkable) {
      this.graphics.lineStyle(1, 0x3aa0ff, 0.35);
      for (let ty = 0; ty < h; ty += 1) {
        for (let tx = 0; tx < w; tx += 1) {
          if (nav.walkable[nav.idx(tx, ty)] === 1) continue;
          this.graphics.strokeRect(tx * tileSize, ty * tileSize, tileSize, tileSize);
        }
      }
    }

    // Unreachable tiles: walkable tiles where BFS did not reach (dist === -1).
    // This is the best signal when mobs "far away" still face-plant:
    // those mobs are on unreachable tiles and their AI is likely falling back.
    if (this.showUnreachableTiles && nav.walkable && flow?.dist) {
      this.graphics.lineStyle(1, 0xaa66ff, 0.35);
      for (let ty = 0; ty < h; ty += 1) {
        for (let tx = 0; tx < w; tx += 1) {
          const i = nav.idx(tx, ty);
          if (nav.walkable[i] !== 1) continue;
          if (flow.dist[i] !== -1) continue;
          this.graphics.strokeRect(tx * tileSize, ty * tileSize, tileSize, tileSize);
        }
      }
    }

    // Flow arrows (dir grid).
    if (this.showFlowField && flow?.dir && nav.walkable) {
      const stride = this.flowStride;
      const arrowLen = tileSize * 0.32;
      const headLen = Math.max(3, tileSize * 0.12);

      this.graphics.lineStyle(1, 0x66e7ff, 0.7);

      for (let ty = 0; ty < h; ty += stride) {
        for (let tx = 0; tx < w; tx += stride) {
          const i = nav.idx(tx, ty);
          if (nav.walkable[i] !== 1) continue;

          const d = flow.dir[i];
          if (!d) continue;

          const cx = tx * tileSize + tileSize * 0.5;
          const cy = ty * tileSize + tileSize * 0.5;

          let dx = 0, dy = 0;
          if (d === 1) dy = -1;
          else if (d === 2) dx = 1;
          else if (d === 3) dy = 1;
          else if (d === 4) dx = -1;
          else continue;

          const ex = cx + dx * arrowLen;
          const ey = cy + dy * arrowLen;

          // main shaft
          this.graphics.beginPath();
          this.graphics.moveTo(cx, cy);
          this.graphics.lineTo(ex, ey);
          this.graphics.strokePath();

          // arrow head
          const px = -dy;
          const py = dx;

          const hx1 = ex - dx * headLen + px * (headLen * 0.5);
          const hy1 = ey - dy * headLen + py * (headLen * 0.5);
          const hx2 = ex - dx * headLen - px * (headLen * 0.5);
          const hy2 = ey - dy * headLen - py * (headLen * 0.5);

          this.graphics.beginPath();
          this.graphics.moveTo(ex, ey);
          this.graphics.lineTo(hx1, hy1);
          this.graphics.moveTo(ex, ey);
          this.graphics.lineTo(hx2, hy2);
          this.graphics.strokePath();
        }
      }
    }

    // Highlight hero tile (target tile) so you know what the field is aimed at.
    if (this.showHeroTile && heroSprite) {
      const { tx, ty } = nav.worldToTile(heroSprite.x, heroSprite.y);
      if (nav.inBounds(tx, ty)) {
        this.graphics.lineStyle(2, 0xffffff, 0.9);
        this.graphics.strokeRect(tx * tileSize, ty * tileSize, tileSize, tileSize);
      }
    }
  }

  destroy() {
    this.graphics?.destroy();
    this.graphics = null;
    this.scene = null;
  }
}
