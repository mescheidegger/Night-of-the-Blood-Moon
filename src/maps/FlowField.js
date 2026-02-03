// FlowField: BFS distance + direction field toward a target tile.
export class FlowField {
  constructor(navGrid) {
    this.grid = navGrid;
    const n = (navGrid?.w ?? 0) * (navGrid?.h ?? 0);

    this.dist = new Int32Array(n);
    this.dir = new Int8Array(n);

    // Simple FIFO queue storage (indices into dist/dir arrays).
    this._queue = new Int32Array(n);

    this._lastTargetIdx = -1;
    this._nextAllowedRebuildMs = 0;

    // Tunables
    this.minRebuildGapMs = 200;
  }

  updateTargetWorld(x, y, nowMs) {
    const { tx, ty } = this.grid.worldToTile(x, y);
    this.updateTargetTile(tx, ty, nowMs);
  }

  updateTargetTile(tx, ty, nowMs) {
    if (!this.grid.inBounds(tx, ty)) return;

    const targetIdx = this.grid.idx(tx, ty);
    if (targetIdx === this._lastTargetIdx) return;

    if (nowMs < this._nextAllowedRebuildMs) return;
    this._nextAllowedRebuildMs = nowMs + this.minRebuildGapMs;

    this._lastTargetIdx = targetIdx;
    this.rebuildFromTargetIdx(targetIdx);
  }

  rebuildFromTargetIdx(targetIdx) {
    const g = this.grid;
    const { w, h } = g;
    if (!w || !h) return;

    this.dist.fill(-1);
    this.dir.fill(0);

    // If target tile itself isn't walkable, do nothing (or you can search nearest walkable).
    const tTx = targetIdx % w;
    const tTy = (targetIdx / w) | 0;
    if (!g.isWalkable(tTx, tTy)) return;

    // ------------------------------------------------------------
    // BFS flood fill (4-way) — FIXED
    // The previous implementation used an instance _tail that was
    // never reset per rebuild, causing the flood to stop early.
    // ------------------------------------------------------------
    let head = 0;
    let tail = 0;

    this.dist[targetIdx] = 0;
    this._queue[tail++] = targetIdx;

    while (head < tail) {
      const cur = this._queue[head++];
      const curD = this.dist[cur];

      const cx = cur % w;
      const cy = (cur / w) | 0;

      // Inline neighbor visit for speed + correctness.
      const visit = (nx, ny) => {
        if (!g.isWalkable(nx, ny)) return;
        const ni = g.idx(nx, ny);
        if (this.dist[ni] !== -1) return;
        this.dist[ni] = curD + 1;
        this._queue[tail++] = ni;
      };

      if (cy > 0) visit(cx, cy - 1);        // up
      if (cx + 1 < w) visit(cx + 1, cy);    // right
      if (cy + 1 < h) visit(cx, cy + 1);    // down
      if (cx > 0) visit(cx - 1, cy);        // left
    }

    // ------------------------------------------------------------
    // Build dir field: for each tile, pick neighbor with smallest dist.
    // 1 up, 2 right, 3 down, 4 left (direction to move to get closer)
    // ------------------------------------------------------------
    for (let ty = 0; ty < h; ty += 1) {
      for (let tx = 0; tx < w; tx += 1) {
        if (!g.isWalkable(tx, ty)) continue;

        const i = g.idx(tx, ty);
        const dHere = this.dist[i];
        if (dHere < 0) continue;     // unreachable
        if (dHere === 0) continue;   // target

        let bestD = dHere;
        let bestDir = 0;

        if (ty > 0) {
          const ni = g.idx(tx, ty - 1);
          const nd = this.dist[ni];
          if (nd >= 0 && nd < bestD) { bestD = nd; bestDir = 1; }
        }
        if (tx + 1 < w) {
          const ni = g.idx(tx + 1, ty);
          const nd = this.dist[ni];
          if (nd >= 0 && nd < bestD) { bestD = nd; bestDir = 2; }
        }
        if (ty + 1 < h) {
          const ni = g.idx(tx, ty + 1);
          const nd = this.dist[ni];
          if (nd >= 0 && nd < bestD) { bestD = nd; bestDir = 3; }
        }
        if (tx > 0) {
          const ni = g.idx(tx - 1, ty);
          const nd = this.dist[ni];
          if (nd >= 0 && nd < bestD) { bestD = nd; bestDir = 4; }
        }

        this.dir[i] = bestDir;
      }
    }
  }
}
