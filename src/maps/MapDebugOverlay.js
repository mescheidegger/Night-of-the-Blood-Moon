// Draws bounded map debug overlays (world bounds, collision tiles, object colliders, nav/flow-field).
export class MapDebugOverlay {
  constructor(
    scene,
    {
      depth = 40,
      showCollisionTiles = true,
      showObjectColliders = true,

      // Nav / flow:
      showNavBlockedTiles = true,
      showFlowField = true,
      flowStride = 2,
      showBigNavOverlay = true,

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
    this.showBigNavOverlay = showBigNavOverlay;

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
    // Redraw everything each refresh to keep overlays in sync with the scene state.
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
      this.graphics.lineStyle(1, 0xff5555, 0.9);

      const obstacleRects = scene?.mapObstacleRects ?? [];
      obstacleRects.forEach((rect) => {
        const x = Number(rect?.x);
        const y = Number(rect?.y);
        const w = Number(rect?.w);
        const h = Number(rect?.h);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
        if (w <= 0 || h <= 0) return;
        this.graphics.strokeRect(x, y, w, h);
      });

      // Backwards-compatible fallback for physics-only object colliders.
      if (!obstacleRects.length) {
        const objectGroup = scene?.mapObjectColliders;
        const children = objectGroup?.getChildren?.() ?? [];
        children.forEach((obj) => {
          const rect = obj?.getBounds?.();
          if (!rect) return;
          this.graphics.strokeRect(rect.x, rect.y, rect.width, rect.height);
        });
      }
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
    const navBig = scene?.navGridBig ?? null;
    const flowBig = scene?.flowFieldBig ?? null;
    const heroSprite = scene?.player ?? scene?.hero?.sprite ?? null;

    if (!nav && !navBig) return;

    const renderNavOverlay = ({
      navGrid,
      flowField,
      blockedColor,
      unreachableColor,
      flowColor,
      heroColor,
    }) => {
      if (!navGrid) return;

      const tileSize = navGrid.cellSize ?? navGrid.tileSize ?? 32;
      const w = navGrid.w ?? 0;
      const h = navGrid.h ?? 0;
      if (!w || !h) return;

      // Nav-blocked tiles (nav mask).
      if (this.showNavBlockedTiles && navGrid.walkable) {
        this.graphics.lineStyle(1, blockedColor, 0.35);
        for (let ty = 0; ty < h; ty += 1) {
          for (let tx = 0; tx < w; tx += 1) {
            if (navGrid.walkable[navGrid.idx(tx, ty)] === 1) continue;
            this.graphics.strokeRect(tx * tileSize, ty * tileSize, tileSize, tileSize);
          }
        }
      }

      // Unreachable tiles: walkable tiles where BFS did not reach (dist === -1).
      if (this.showUnreachableTiles && navGrid.walkable && flowField?.dist) {
        this.graphics.lineStyle(1, unreachableColor, 0.35);
        for (let ty = 0; ty < h; ty += 1) {
          for (let tx = 0; tx < w; tx += 1) {
            const i = navGrid.idx(tx, ty);
            if (navGrid.walkable[i] !== 1) continue;
            if (flowField.dist[i] !== -1) continue;
            this.graphics.strokeRect(tx * tileSize, ty * tileSize, tileSize, tileSize);
          }
        }
      }

      // Flow arrows (dir grid).
      if (this.showFlowField && flowField?.dir && navGrid.walkable) {
        const stride = this.flowStride;
        const arrowLen = tileSize * 0.32;
        const headLen = Math.max(3, tileSize * 0.12);

        this.graphics.lineStyle(1, flowColor, 0.7);

        for (let ty = 0; ty < h; ty += stride) {
          for (let tx = 0; tx < w; tx += stride) {
            const i = navGrid.idx(tx, ty);
            if (navGrid.walkable[i] !== 1) continue;

            const d = flowField.dir[i];
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
        const { tx, ty } = navGrid.worldToTile(heroSprite.x, heroSprite.y);
        if (navGrid.inBounds(tx, ty)) {
          this.graphics.lineStyle(2, heroColor, 0.9);
          this.graphics.strokeRect(tx * tileSize, ty * tileSize, tileSize, tileSize);
        }
      }
    };

    // Small nav/flow overlay.
    renderNavOverlay({
      navGrid: nav,
      flowField: flow,
      blockedColor: 0x3aa0ff,
      unreachableColor: 0xaa66ff,
      flowColor: 0x66e7ff,
      heroColor: 0xffffff,
    });

    // Optional big nav/flow overlay.
    if (this.showBigNavOverlay) {
      renderNavOverlay({
        navGrid: navBig,
        flowField: flowBig,
        blockedColor: 0xff9b4a,
        unreachableColor: 0xff6fb0,
        flowColor: 0xffd57a,
        heroColor: 0xffc866,
      });
    }
  }

  destroy() {
    this.graphics?.destroy();
    this.graphics = null;
    this.scene = null;
  }
}
