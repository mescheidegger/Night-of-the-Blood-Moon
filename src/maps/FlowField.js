// FlowField: BFS distance + direction field toward a target tile/cell.
// Supports 8-way connectivity with optional "no corner cutting" rule.
//
// Dir codes (movement direction to get closer):
// 1 up, 2 right, 3 down, 4 left,
// 5 up-right, 6 down-right, 7 down-left, 8 up-left
export class FlowField {
  constructor(navGrid) {
    this.grid = navGrid;
    const n = (navGrid?.w ?? 0) * (navGrid?.h ?? 0);

    this.dist = new Int32Array(n);
    this.dir = new Int8Array(n);

    // Simple FIFO queue storage (indices into dist/dir arrays).
    this._queue = new Int32Array(n);

    // "Requested" vs "built" targets:
    // - requested = where the hero is (may be blocked)
    // - built     = walkable cell used for BFS seed
    this._lastRequestedTargetIdx = -1;
    this._lastBuiltTargetIdx = -1;

    this._nextAllowedRebuildMs = 0;

    // Tunables
    this.minRebuildGapMs = 200;

    // 8-way settings
    this.useDiagonals = true;

    // Prevent diagonal moves that "cut corners" through blocked orthogonals.
    // Recommended TRUE for most top-down games.
    this.noCornerCutting = true;

    // If the requested target cell is blocked, search for nearest walkable cell.
    // Increase if your padding can block larger areas around the hero.
    this.nearestWalkableMaxR = 24; // cells (24 * 8px = 192px at cellSize=8)

    // NEW: treat hero "cell" as a footprint in nav space (in pixels).
    // With cellSize=8, 32px => 4 cells wide/tall around hero.
    this.heroFootprintPx = 32;

    // When multiple walkable cells exist in the footprint, pick the closest to hero.
    this.heroFootprintPreferCenter = true;
  }

  updateTargetWorld(x, y, nowMs, opts = {}) {
    const { tx, ty } = this.grid.worldToTile(x, y);
    this.updateTargetTile(tx, ty, nowMs, opts);
  }

  /**
   * Update the flow field's target cell.
   * - If requested target cell isn't walkable, rebuild from the nearest walkable cell.
   * - If the field looks invalid (e.g., never built), rebuild even if the requested cell is unchanged.
   * - If force=true, bypass throttling and rebuild regardless of time gate.
   */
  updateTargetTile(tx, ty, nowMs, { force = false } = {}) {
    const g = this.grid;
    if (!g || !g.inBounds(tx, ty)) return;

    const requestedIdx = g.idx(tx, ty);

    const builtOk =
      this._lastBuiltTargetIdx >= 0 &&
      this._lastBuiltTargetIdx < this.dist.length &&
      this.dist[this._lastBuiltTargetIdx] === 0;

    if (!force && requestedIdx === this._lastRequestedTargetIdx && builtOk) return;

    if (!force) {
      const tNow = Number.isFinite(Number(nowMs)) ? Number(nowMs) : 0;
      if (tNow < this._nextAllowedRebuildMs) return;
      this._nextAllowedRebuildMs = tNow + (Number(this.minRebuildGapMs) || 0);
    }

    this._lastRequestedTargetIdx = requestedIdx;

    const builtIdx = this._resolveBuildTargetIdx(tx, ty);
    this._lastBuiltTargetIdx = builtIdx ?? -1;

    if (builtIdx == null) {
      this.dist.fill(-1);
      this.dir.fill(0);
      return;
    }

    this.rebuildFromTargetIdx(builtIdx);
  }

  // Convert (requested tx,ty) into a walkable cell to seed BFS.
  _resolveBuildTargetIdx(tx, ty) {
    const g = this.grid;
    if (!g?.w || !g?.h) return null;

    // 1) Prefer a walkable cell within the hero footprint (32x32 => 4x4 cells at cellSize=8).
    const fp = this._findWalkableInHeroFootprint(tx, ty);
    if (fp) return g.idx(fp.tx, fp.ty);

    // 2) Fall back to nearest walkable ring search.
    const found = this._findNearestWalkable(tx, ty, this.nearestWalkableMaxR);
    if (!found) return null;

    return g.idx(found.tx, found.ty);
  }

  // NEW: Search within a hero "footprint" centered on (tx,ty).
  // For heroFootprintPx=32 and cellSize=8 => halfWidthCells=2 => spans 4 cells wide.
  _findWalkableInHeroFootprint(tx, ty) {
    const g = this.grid;
    if (!g) return null;

    const cellSize = Number(g.cellSize) || 8;
    const fpPx = Math.max(0, Number(this.heroFootprintPx) || 0);
    if (fpPx <= 0) return null;

    // half in cells; 32px @ 8px cell => 2 cells.
    const half = Math.max(0, Math.floor((fpPx * 0.5) / cellSize));

    // If half=0, this degenerates to just checking the requested cell.
    // (Still fine.)
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    // Score by distance-to-center so we pick closest-to-hero tile in the footprint.
    // This keeps the BFS seed stable as hero moves within their 32x32 body space.
    const preferCenter = !!this.heroFootprintPreferCenter;

    for (let dy = -half; dy <= (half - 1); dy += 1) {
      for (let dx = -half; dx <= (half - 1); dx += 1) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!g.inBounds(nx, ny)) continue;
        if (!g.isWalkable(nx, ny)) continue;

        if (!preferCenter) return { tx: nx, ty: ny };

        const score = (dx * dx) + (dy * dy);
        if (score < bestScore) {
          bestScore = score;
          best = { tx: nx, ty: ny };
        }
      }
    }

    return best;
  }

  // Ring scan outward to find a nearest walkable cell.
  // Fast enough for occasional rebuilds and avoids allocations.
  _findNearestWalkable(tx, ty, maxR = 24) {
    const g = this.grid;
    if (!g) return null;
    if (g.isWalkable(tx, ty)) return { tx, ty };

    const R = Math.max(0, (Number(maxR) || 0) | 0);
    for (let r = 1; r <= R; r += 1) {
      // Top/bottom edges of the ring
      for (let dx = -r; dx <= r; dx += 1) {
        const nxTop = tx + dx;
        const nyTop = ty - r;
        if (g.inBounds(nxTop, nyTop) && g.isWalkable(nxTop, nyTop)) return { tx: nxTop, ty: nyTop };

        const nxBot = tx + dx;
        const nyBot = ty + r;
        if (g.inBounds(nxBot, nyBot) && g.isWalkable(nxBot, nyBot)) return { tx: nxBot, ty: nyBot };
      }

      // Left/right edges (excluding corners already checked)
      for (let dy = -r + 1; dy <= r - 1; dy += 1) {
        const nxLeft = tx - r;
        const nyLeft = ty + dy;
        if (g.inBounds(nxLeft, nyLeft) && g.isWalkable(nxLeft, nyLeft)) return { tx: nxLeft, ty: nyLeft };

        const nxRight = tx + r;
        const nyRight = ty + dy;
        if (g.inBounds(nxRight, nyRight) && g.isWalkable(nxRight, nyRight)) return { tx: nxRight, ty: nyRight };
      }
    }

    return null;
  }

  rebuildFromTargetIdx(targetIdx) {
    const g = this.grid;
    const { w, h } = g;
    if (!w || !h) return;

    // Reset distance + direction fields before each BFS.
    this.dist.fill(-1);
    this.dir.fill(0);

    // If target tile itself isn't walkable, do nothing (should not happen if resolved).
    const tTx = targetIdx % w;
    const tTy = (targetIdx / w) | 0;
    if (!g.isWalkable(tTx, tTy)) return;

    // ------------------------------------------------------------
    // BFS flood fill (8-way optional)
    // ------------------------------------------------------------
    let head = 0;
    let tail = 0;

    this.dist[targetIdx] = 0;
    this._queue[tail++] = targetIdx;

    const allowDiag = !!this.useDiagonals;

    // Helper: is diagonal step from (cx,cy) -> (nx,ny) allowed?
    // If noCornerCutting: require BOTH adjacent orthogonal neighbors walkable.
    const canStepDiag = (cx, cy, nx, ny) => {
      if (!this.noCornerCutting) return true;

      const dx = nx - cx;
      const dy = ny - cy;
      const ox1x = cx + dx; // (cx+dx, cy)
      const ox1y = cy;
      const ox2x = cx;      // (cx, cy+dy)
      const ox2y = cy + dy;

      return g.isWalkable(ox1x, ox1y) && g.isWalkable(ox2x, ox2y);
    };

    while (head < tail) {
      const cur = this._queue[head++];
      const curD = this.dist[cur];

      const cx = cur % w;
      const cy = (cur / w) | 0;

      const visit = (nx, ny, isDiag) => {
        if (!g.inBounds(nx, ny)) return;
        if (!g.isWalkable(nx, ny)) return;
        if (isDiag && !canStepDiag(cx, cy, nx, ny)) return;

        const ni = g.idx(nx, ny);
        if (this.dist[ni] !== -1) return;

        this.dist[ni] = curD + 1;
        this._queue[tail++] = ni;
      };

      // 4-way
      visit(cx, cy - 1, false);
      visit(cx + 1, cy, false);
      visit(cx, cy + 1, false);
      visit(cx - 1, cy, false);

      // 8-way
      if (allowDiag) {
        visit(cx + 1, cy - 1, true);
        visit(cx + 1, cy + 1, true);
        visit(cx - 1, cy + 1, true);
        visit(cx - 1, cy - 1, true);
      }
    }

    // ------------------------------------------------------------
    // Build dir field: for each tile/cell, pick neighbor with smallest dist.
    // ------------------------------------------------------------
    for (let ty = 0; ty < h; ty += 1) {
      for (let tx = 0; tx < w; tx += 1) {
        if (!g.isWalkable(tx, ty)) continue;

        const i = g.idx(tx, ty);
        const dHere = this.dist[i];
        if (dHere < 0) continue;
        if (dHere === 0) continue;

        let bestD = dHere;
        let bestDir = 0;

        const consider = (nx, ny, dirCode, isDiag) => {
          if (!g.inBounds(nx, ny)) return;
          if (!g.isWalkable(nx, ny)) return;

          if (isDiag && allowDiag && this.noCornerCutting) {
            if (!canStepDiag(tx, ty, nx, ny)) return;
          }

          const ni = g.idx(nx, ny);
          const nd = this.dist[ni];
          if (nd >= 0 && nd < bestD) {
            bestD = nd;
            bestDir = dirCode;
          }
        };

        // 4-way
        consider(tx, ty - 1, 1, false);
        consider(tx + 1, ty, 2, false);
        consider(tx, ty + 1, 3, false);
        consider(tx - 1, ty, 4, false);

        // 8-way
        if (allowDiag) {
          consider(tx + 1, ty - 1, 5, true);
          consider(tx + 1, ty + 1, 6, true);
          consider(tx - 1, ty + 1, 7, true);
          consider(tx - 1, ty - 1, 8, true);
        }

        this.dir[i] = bestDir;
      }
    }
  }
}
