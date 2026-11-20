import * as THREE from 'three';

/**
 * Lightweight 2.5D collision: oriented boxes in XZ with a vertical span.
 * Used by the player, NPC steering and to rasterize the nav grid. Each box
 * can also be mirrored into the physics world as a static body.
 */
export class Colliders {
  constructor(physics) {
    this.physics = physics;
    this.boxes = [];
    this.platforms = []; // raised floors: {minX,maxX,minZ,maxZ,h}
    this.dynamic = new Set(); // moving boxes (cars) - objects with getOBB()
    this.terrainHeight = null;
  }

  addBox(cx, cz, hx, hz, rot = 0, y0 = 0, y1 = 3, { nav = true, physics = true, tag = null, player = true } = {}) {
    const b = { cx, cz, hx, hz, rot, c: Math.cos(rot), s: Math.sin(rot), y0, y1, nav, tag, player, enabled: true };
    this.boxes.push(b);
    if (physics && this.physics) b.body = this.physics.addStaticBox(cx, (y0 + y1) / 2, cz, hx, Math.max(0.02, (y1 - y0) / 2), hz, rot);
    return b;
  }

  /** Box from a mesh-like spec: center vector and full size. */
  addBoxFromSize(center, size, rot = 0, opts) {
    return this.addBox(center.x, center.z, size.x / 2, size.z / 2, rot, center.y - size.y / 2, center.y + size.y / 2, opts);
  }

  setEnabled(box, on) {
    box.enabled = on;
    if (box.body) {
      if (on && !this.physics.world.bodies.includes(box.body)) this.physics.world.addBody(box.body);
      if (!on) this.physics.world.removeBody(box.body);
    }
  }

  addPlatform(minX, maxX, minZ, maxZ, h) {
    this.platforms.push({ minX, maxX, minZ, maxZ, h });
    // raised floors (shop, sidewalk, islands, curbs) also exist in the physics world,
    // otherwise dropped boxes and ragdolls sink to y=0 under the floor
    if (this.physics) this.physics.addStaticBox((minX + maxX) / 2, h / 2, (minZ + maxZ) / 2, (maxX - minX) / 2, h / 2, (maxZ - minZ) / 2, 0);
  }

  groundHeight(x, z) {
    let h = 0, onPlatform = false;
    for (const p of this.platforms) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) { if (p.h > h || !onPlatform) h = Math.max(h, p.h); onPlatform = true; }
    }
    if (!onPlatform && this.terrainHeight) h = this.terrainHeight(x, z);
    return h;
  }

  /** Push a circle out of all boxes. pos is a Vector3 (x,z used). Returns true if hit. */
  resolveCircle(pos, r, feetY, height, { includeDynamic = true, ignore = null, isPlayer = false } = {}) {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.boxes) {
        if (!b.enabled) continue;
        if (isPlayer && !b.player) continue;
        if (feetY + 0.32 >= b.y1 || feetY + height <= b.y0) continue; // step over / walk under
        if (this._pushOut(pos, r, b)) hit = true;
      }
      if (includeDynamic) {
        for (const d of this.dynamic) {
          if (d === ignore || !d.obb) continue;
          if (this._pushOut(pos, r, d.obb)) { hit = true; if (d.onBump) d.onBump(pos); }
        }
      }
    }
    return hit;
  }

  _pushOut(pos, r, b) {
    const dx = pos.x - b.cx, dz = pos.z - b.cz;
    if (Math.abs(dx) > b.hx + b.hz + r + 0.5 && Math.abs(dz) > b.hx + b.hz + r + 0.5) return false;
    const lx = dx * b.c - dz * b.s;
    const lz = dx * b.s + dz * b.c;
    const qx = Math.max(-b.hx, Math.min(b.hx, lx));
    const qz = Math.max(-b.hz, Math.min(b.hz, lz));
    let ex = lx - qx, ez = lz - qz;
    const d2 = ex * ex + ez * ez;
    if (d2 >= r * r) return false;
    let px, pz;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2), k = (r - d) / d;
      px = ex * k; pz = ez * k;
    } else {
      // centre inside: push along axis of least penetration
      const penX = b.hx - Math.abs(lx), penZ = b.hz - Math.abs(lz);
      if (penX < penZ) { px = (penX + r) * Math.sign(lx || 1); pz = 0; } else { px = 0; pz = (penZ + r) * Math.sign(lz || 1); }
    }
    pos.x += px * b.c + pz * b.s;
    pos.z += -px * b.s + pz * b.c;
    return true;
  }

  /** Is a point inside any box (with margin)? */
  pointBlocked(x, z, margin = 0, maxY = 1.6) {
    for (const b of this.boxes) {
      if (!b.enabled || b.y0 > maxY) continue;
      const dx = x - b.cx, dz = z - b.cz;
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      if (Math.abs(lx) <= b.hx + margin && Math.abs(lz) <= b.hz + margin) return true;
    }
    return false;
  }
}

/** Build an OBB record for a moving object (cars). */
export function makeOBB() { return { cx: 0, cz: 0, hx: 1, hz: 1, rot: 0, c: 1, s: 0, y0: 0, y1: 2, enabled: true }; }
export function setOBB(obb, x, z, hx, hz, rot) {
  obb.cx = x; obb.cz = z; obb.hx = hx; obb.hz = hz; obb.rot = rot; obb.c = Math.cos(rot); obb.s = Math.sin(rot);
}

export const _v = new THREE.Vector3();
