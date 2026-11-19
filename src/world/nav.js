import * as THREE from 'three';

/**
 * Grid navigation (A* on 0.5 m cells) for pedestrians, rasterized from the
 * static colliders plus a dynamic layer for parked cars.
 */
export class NavGrid {
  constructor(minX, maxX, minZ, maxZ, cell = 0.5) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.w = Math.ceil((maxX - minX) / cell);
    this.h = Math.ceil((maxZ - minZ) / cell);
    this.blocked = new Uint8Array(this.w * this.h);
    this.dyn = new Uint8Array(this.w * this.h);
    this.cost = new Float32Array(this.w * this.h).fill(1);
    // A* scratch
    this.g = new Float32Array(this.w * this.h);
    this.f = new Float32Array(this.w * this.h);
    this.parent = new Int32Array(this.w * this.h);
    this.stamp = new Uint32Array(this.w * this.h);
    this.closed = new Uint32Array(this.w * this.h);
    this.curStamp = 1;
    this.heap = new Int32Array(this.w * this.h);
  }

  idx(ix, iz) { return iz * this.w + ix; }
  toCell(x, z) { return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)]; }
  cellCenter(ix, iz, out = new THREE.Vector3()) { return out.set(this.minX + (ix + 0.5) * this.cell, 0, this.minZ + (iz + 0.5) * this.cell); }
  inside(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h; }
  isFree(ix, iz) { if (!this.inside(ix, iz)) return false; const i = this.idx(ix, iz); return !this.blocked[i] && !this.dyn[i]; }
  freeAt(x, z) { const [ix, iz] = this.toCell(x, z); return this.isFree(ix, iz); }

  /** Mark cells covered by an OBB (inflated by margin). layer: 'static' | 'dyn' */
  rasterOBB(b, margin, layer = 'static', value = 1) {
    const arr = layer === 'static' ? this.blocked : this.dyn;
    const ext = Math.max(b.hx, b.hz) * 1.5 + margin;
    const [x0, z0] = this.toCell(b.cx - ext, b.cz - ext);
    const [x1, z1] = this.toCell(b.cx + ext, b.cz + ext);
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    for (let iz = Math.max(0, z0); iz <= Math.min(this.h - 1, z1); iz++) {
      for (let ix = Math.max(0, x0); ix <= Math.min(this.w - 1, x1); ix++) {
        const px = this.minX + (ix + 0.5) * this.cell - b.cx, pz = this.minZ + (iz + 0.5) * this.cell - b.cz;
        const lx = px * c - pz * s, lz = px * s + pz * c;
        if (Math.abs(lx) <= b.hx + margin && Math.abs(lz) <= b.hz + margin) {
          const i = this.idx(ix, iz);
          if (layer === 'dyn') arr[i] = Math.max(0, arr[i] + value); else arr[i] = value;
        }
      }
    }
  }

  buildFrom(colliders, margin = 0.3) {
    this.blocked.fill(0);
    for (const b of colliders.boxes) if (b.enabled && b.nav && b.y0 < 1.6 && b.y1 > 0.08) this.rasterOBB(b, margin, 'static', 1);
  }

  nearestFree(ix, iz, maxR = 12) {
    if (this.isFree(ix, iz)) return [ix, iz];
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        if (this.isFree(ix + dx, iz + dz)) return [ix + dx, iz + dz];
      }
    }
    return null;
  }

  /** A* path from a to b (Vector3). Returns array of Vector3 (smoothed) or null. */
  findPath(a, b) {
    let [sx, sz] = this.toCell(a.x, a.z);
    let [tx, tz] = this.toCell(b.x, b.z);
    const s = this.nearestFree(sx, sz, 6); const t = this.nearestFree(tx, tz, 10);
    if (!s || !t) return null;
    [sx, sz] = s; [tx, tz] = t;
    const W = this.w;
    const st = ++this.curStamp;
    const start = sz * W + sx, goal = tz * W + tx;
    const heur = (i) => { const x = i % W, z = (i / W) | 0; const dx = Math.abs(x - tx), dz = Math.abs(z - tz); return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz); };
    let hn = 0;
    const heap = this.heap, f = this.f, g = this.g;
    const push = (i) => { let k = hn++; heap[k] = i; while (k > 0) { const p = (k - 1) >> 1; if (f[heap[p]] <= f[heap[k]]) break; const tmp = heap[p]; heap[p] = heap[k]; heap[k] = tmp; k = p; } };
    const pop = () => { const top = heap[0]; heap[0] = heap[--hn]; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hn && f[heap[l]] < f[heap[m]]) m = l; if (r < hn && f[heap[r]] < f[heap[m]]) m = r; if (m === k) break; const tmp = heap[m]; heap[m] = heap[k]; heap[k] = tmp; k = m; } return top; };
    g[start] = 0; f[start] = heur(start); this.stamp[start] = st; this.parent[start] = -1;
    push(start);
    let found = false, iters = 0;
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (hn > 0 && iters++ < 40000) {
      const cur = pop();
      if (this.closed[cur] === st) continue;
      this.closed[cur] = st;
      if (cur === goal) { found = true; break; }
      const cx = cur % W, cz = (cur / W) | 0;
      for (const [dx, dz, c] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.isFree(nx, nz)) continue;
        if (dx && dz && (!this.isFree(cx + dx, cz) || !this.isFree(cx, cz + dz))) continue;
        const ni = nz * W + nx;
        if (this.closed[ni] === st) continue;
        const ng = g[cur] + c * this.cost[ni];
        if (this.stamp[ni] !== st || ng < g[ni]) {
          this.stamp[ni] = st; g[ni] = ng; f[ni] = ng + heur(ni); this.parent[ni] = cur; push(ni);
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = this.parent[i]) cells.push(i);
    cells.reverse();
    // string pulling
    const pts = [];
    let anchor = 0;
    pts.push(cells[0]);
    for (let i = 2; i < cells.length; i++) {
      if (!this.lineFree(cells[anchor], cells[i])) { anchor = i - 1; pts.push(cells[anchor]); }
    }
    if (cells.length > 1) pts.push(cells[cells.length - 1]);
    const out = pts.map((i) => this.cellCenter(i % W, (i / W) | 0));
    out[out.length - 1].set(b.x, 0, b.z);
    if (!this.freeAt(b.x, b.z)) this.cellCenter(tx, tz, out[out.length - 1]);
    return out;
  }

  lineFree(a, b) {
    const W = this.w;
    let x0 = a % W, z0 = (a / W) | 0; const x1 = b % W, z1 = (b / W) | 0;
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    for (;;) {
      if (!this.isFree(x0, z0)) return false;
      // thick line: also check neighbours to keep clearance
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
      if (!this.isFree(x0, z0)) return false;
    }
  }

  /** Direct segment check in world coords. */
  segmentFree(a, b) {
    const [ax, az] = this.toCell(a.x, a.z), [bx, bz] = this.toCell(b.x, b.z);
    if (!this.inside(ax, az) || !this.inside(bx, bz)) return false;
    return this.lineFree(az * this.w + ax, bz * this.w + bx);
  }
}
