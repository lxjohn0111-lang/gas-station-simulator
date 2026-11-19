import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxGeo, planeGeo, StaticBatcher } from '../gfx/materials.js';
import { canvasTexture, roundRect, grime } from '../gfx/textures.js';
import { seeded } from '../core/utils.js';

export const LAYOUT = {
  islandXs: [0, 10, -10],          // island 0 starts active, others unlock
  islandZ: -17,
  laneZ: { S: -19.45, N: -14.55 },
  canopy: { minX: -16, maxX: 16, minZ: -24.5, maxZ: -9.5, y: 5.5 },
  shop: { minX: -10, maxX: 10, minZ: 1, maxZ: 13, floor: 0.15, wallH: 4.0 },
  door: { x: 2.5, z: 1, width: 2.0 },
  sideDoor: { x: -10, z: 8.3, width: 1.4 },
  delivery: { x: -13.2, z: 8.3 },
  carwash: { minX: 20, maxX: 27, minZ: -4, maxZ: 8 },
};

/**
 * Builds the static gas station: lot, canopy, islands, shop shell, signage,
 * exterior props and the night lighting rig.
 */
export class Station {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.M = game.mats;
    this.colliders = game.colliders;
    this.batch = new StaticBatcher();
    this.nightMats = [];   // emissive materials scaled by night factor
    this.lights = [];      // {light, base, onlyNight}
    this.islands = [];
    this.parking = [];
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.rng = seeded(4242);
  }

  // ------------------------------------------------------------ helpers
  box(w, h, d, mat, x, y, z, { rotY = 0, tile = 1, batch = true, cast = true, receive = true, collide = false, nav = true, player = true, parent = null } = {}) {
    const geo = boxGeo(w, h, d, tile);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = rotY;
    m.castShadow = cast; m.receiveShadow = receive;
    if (collide) this.colliders.addBox(x, z, w / 2, d / 2, rotY, y - h / 2, y + h / 2, { nav, player });
    if (batch && !parent) { this.batch.addMesh(m, { cast, receive }); return m; }
    (parent || this.group).add(m);
    return m;
  }
  cyl(rt, rb, h, mat, x, y, z, { seg = 16, batch = true, cast = true, collide = false, parent = null, rotX = 0, rotZ = 0 } = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z); m.rotation.x = rotX; m.rotation.z = rotZ;
    m.castShadow = cast; m.receiveShadow = true;
    if (collide) this.colliders.addBox(x, z, rb, rb, 0, y - h / 2, y + h / 2);
    if (batch && !parent) { this.batch.addMesh(m, { cast, receive: true }); return m; }
    (parent || this.group).add(m);
    return m;
  }
  plane(w, d, mat, x, y, z, { tile = 1, rotY = 0, batch = true } = {}) {
    const m = new THREE.Mesh(planeGeo(w, d, tile), mat);
    m.position.set(x, y, z); m.rotation.y = rotY; m.receiveShadow = true;
    if (batch) { this.batch.addMesh(m, { cast: false, receive: true }); return m; }
    this.group.add(m); return m;
  }
  nightMat(mat, base) { this.nightMats.push({ mat, base: base ?? mat.emissiveIntensity }); return mat; }

  build() {
    this.buildLot();
    this.buildCanopy();
    for (let i = 0; i < LAYOUT.islandXs.length; i++) this.buildIsland(i);
    this.buildShopShell();
    this.buildPylon();
    this.buildExteriorProps();
    this.buildCarwash();
    this.buildLightingRig();
  }

  /** Merge all batched static geometry (call after every builder ran). */
  finalize() {
    const merged = this.batch.build(mergeGeometries);
    this.scene.add(merged);
    this.staticMerged = merged;
  }

  // ------------------------------------------------------------ lot surfaces
  buildLot() {
    const M = this.M;
    // main asphalt lot (in 4 strips to keep UVs sane)
    this.plane(84, 37, M.asphalt, 0, 0.004, -18.5, { tile: 6 });
    this.plane(84, 22, M.asphalt, 0, 0.004, 9, { tile: 6 });
    // concrete pad under the canopy
    this.plane(34, 17, M.concrete, 0, 0.012, -17, { tile: 4 });
    // sidewalk in front of the shop (raised)
    this.box(24, 0.15, 3.2, M.sidewalk, 0, 0.075, -0.6, { tile: 4, cast: false });
    this.colliders.addPlatform(-12, 12, -2.2, 1, 0.15);
    // curb faces painted yellow at the edge
    this.box(24, 0.155, 0.12, M.yellowPaint, 0, 0.077, -2.21, { cast: false });
    // shop floor platform (interior floor built in shop.js)
    this.colliders.addPlatform(LAYOUT.shop.minX, LAYOUT.shop.maxX, LAYOUT.shop.minZ, LAYOUT.shop.maxZ, 0.15);
    // delivery pad
    this.plane(8, 9, M.concrete, -14.5, 0.014, 8, { tile: 4 });
    // road-side curb islands defining entrance & exit
    const curb = (x0, x1) => {
      const w = x1 - x0;
      this.box(w, 0.2, 1.4, M.sidewalk, (x0 + x1) / 2, 0.1, -36.3, { tile: 3, collide: false });
      this.box(w - 0.4, 0.02, 1.0, M.dirt, (x0 + x1) / 2, 0.21, -36.3, { tile: 3, cast: false });
      this.colliders.addPlatform(x0, x1, -37, -35.6, 0.2);
    };
    curb(-24, -3); curb(3, 24);
    // painted markings: parking stalls in front of shop
    const stallXs = [-16.5, -13.5, 13.5, 16.5];
    for (const x of stallXs) {
      this.box(0.12, 0.01, 5, M.paintLine, x - 1.5, 0.012, -5.2, { cast: false });
      this.box(0.12, 0.01, 5, M.paintLine, x + 1.5, 0.012, -5.2, { cast: false });
      this.parking.push({ x, z: -4.8, rot: 0, taken: null });
      // wheel stop
      this.box(1.8, 0.14, 0.25, M.sidewalk, x, 0.07, -2.6, { cast: true, tile: 2 });
    }
    // lane arrows & stop lines under canopy
    for (const z of [LAYOUT.laneZ.S, LAYOUT.laneZ.N]) {
      for (const ax of [-21, 21]) {
        this.box(2.2, 0.01, 0.18, M.paintLine, ax, 0.016, z, { cast: false });
        const tri = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 3), M.paintLine);
        tri.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); tri.scale.set(1, 1, 0.01); tri.position.set(ax + 1.4, 0.016, z);
        this.batch.addMesh(tri, { cast: false });
      }
    }
    // oil stains & tyre marks decals scattered (static)
    const rng = this.rng;
    for (let i = 0; i < 40; i++) {
      const x = (rng() - 0.5) * 70, z = -36 + rng() * 34;
      const s = 0.6 + rng() * 1.8;
      const m = new THREE.Mesh(planeGeo(s, s, 0), rng() < 0.6 ? this.M.stain : this.M.oil);
      m.position.set(x, 0.02 + i * 0.0001, z); m.rotation.y = rng() * 6;
      m.receiveShadow = true;
      this.group.add(m);
    }
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(planeGeo(6 + rng() * 6, 0.45, 0), this.M.skid);
      m.position.set(-30 + rng() * 60, 0.021, -33 + rng() * 26); m.rotation.y = (rng() - 0.5) * 0.6;
      this.group.add(m);
    }
  }

  // ------------------------------------------------------------ canopy
  buildCanopy() {
    const M = this.M, C = LAYOUT.canopy;
    const w = C.maxX - C.minX, d = C.maxZ - C.minZ, cx = (C.minX + C.maxX) / 2, cz = (C.minZ + C.maxZ) / 2;
    // roof deck
    this.box(w, 0.35, d, M.canopyWhite, cx, C.y + 0.75, cz, { tile: 2 });
    // underside soffit panels (slightly lower)
    this.box(w - 0.3, 0.05, d - 0.3, M.paint(0xdcdad4, 0.7, 0.2), cx, C.y + 0.05, cz, { cast: false, tile: 1 });
    // fascia band with branding (canvas textured, separate mesh so it can glow)
    const fasciaTex = canvasTexture(2048, 128, (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#d23a24'); g.addColorStop(1, '#a8261a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffb52e'; ctx.fillRect(0, H * 0.78, W, H * 0.1);
      ctx.fillStyle = '#fff8ea'; ctx.font = 'bold 84px Impact, Arial Black'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const x of [W * 0.25, W * 0.75]) ctx.fillText('LAST CHANCE GAS', x, H * 0.42, W * 0.4);
      ctx.font = 'bold 60px Impact'; ctx.fillText('⛽', W * 0.5, H * 0.42);
      grime(ctx, W, H, 0.18, '40,20,10');
    });
    fasciaTex.wrapS = THREE.RepeatWrapping;
    const fasciaMat = this.nightMat(new THREE.MeshStandardMaterial({ map: fasciaTex, emissiveMap: fasciaTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5, metalness: 0.1 }), 0.55);
    const sides = [
      [w + 0.3, cx, C.minZ - 0.15, 0], [w + 0.3, cx, C.maxZ + 0.15, Math.PI],
      [d + 0.3, C.maxX + 0.15, cz, -Math.PI / 2], [d + 0.3, C.minX - 0.15, cz, Math.PI / 2],
    ];
    for (const [len, x, z, r] of sides) {
      const geo = new THREE.BoxGeometry(len, 1.05, 0.3);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 16);
      const m = new THREE.Mesh(geo, fasciaMat);
      m.position.set(x, C.y + 0.6, z); m.rotation.y = r; m.castShadow = true;
      this.group.add(m);
    }
    // recessed light panels under canopy
    this.canopyLightMat = this.nightMat(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 0.2, roughness: 0.3 }), 2.6);
    const panelGeo = new THREE.BoxGeometry(1.1, 0.04, 1.1);
    const panels = [];
    for (let x = C.minX + 2.5; x < C.maxX - 1; x += 4.5) for (let z = C.minZ + 2; z < C.maxZ - 1; z += 3.6) {
      const g = panelGeo.clone(); g.translate(x, C.y + 0.02, z); panels.push(g);
    }
    const pm = new THREE.Mesh(mergeGeometries(panels), this.canopyLightMat);
    this.group.add(pm);
  }

  // ------------------------------------------------------------ islands
  buildIsland(i) {
    const M = this.M;
    const x = LAYOUT.islandXs[i], z = LAYOUT.islandZ;
    const isl = { index: i, x, z, active: i === 0, group: new THREE.Group(), brokenGroup: new THREE.Group() };
    // raised island curb
    const L = 5.4, W = 1.4;
    this.box(L, 0.18, W, M.sidewalk, x, 0.09, z, { tile: 2 });
    this.box(L + 0.08, 0.06, W + 0.08, M.yellowPaint, x, 0.03, z, { cast: false });
    this.colliders.addPlatform(x - L / 2, x + L / 2, z - W / 2, z + W / 2, 0.18);
    // NPC nav should avoid islands; player can step up
    this.colliders.addBox(x, z, L / 2, W / 2, 0, 0, 0.18, { physics: false, player: false });
    // canopy columns
    for (const cxo of [-2.1, 2.1]) {
      this.box(0.42, LAYOUT.canopy.y - 0.18, 0.42, M.canopyWhite, x + cxo, 0.18 + (LAYOUT.canopy.y - 0.18) / 2, z, { collide: true, tile: 1 });
      this.box(0.5, 0.9, 0.5, M.redPaint, x + cxo, 0.63, z, { tile: 1 });
    }
    // yellow bollards at the ends
    for (const bx of [-2.55, 2.55]) {
      this.cyl(0.09, 0.09, 1.0, M.yellowPaint, x + bx, 0.68, z + 0.35, { collide: true });
      this.cyl(0.09, 0.09, 1.0, M.yellowPaint, x + bx, 0.68, z - 0.35, { collide: true });
    }
    this.group.add(isl.group); this.group.add(isl.brokenGroup);
    // broken old pump (shown until repaired)
    const rust = M.rust;
    const body = new THREE.Mesh(boxGeo(0.9, 1.5, 0.5, 1), rust); body.position.set(x, 0.93, z); body.rotation.z = 0.08; body.castShadow = true;
    const head = new THREE.Mesh(boxGeo(1.0, 0.35, 0.55, 1), rust); head.position.set(x + 0.08, 1.85, z); head.rotation.z = 0.12; head.castShadow = true;
    const tapeTex = canvasTexture(256, 32, (ctx, W, H) => {
      for (let k = 0; k < W; k += 32) { ctx.fillStyle = (k / 32) % 2 ? '#111' : '#ffd400'; ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + 32, 0); ctx.lineTo(k + 16, H); ctx.lineTo(k - 16, H); ctx.fill(); }
      ctx.fillStyle = '#ffd400'; ctx.fillRect(60, 6, 140, 20); ctx.fillStyle = '#111'; ctx.font = 'bold 16px Arial'; ctx.fillText('OUT OF ORDER', 68, 22);
    });
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.12), new THREE.MeshStandardMaterial({ map: tapeTex, side: THREE.DoubleSide, roughness: 0.6 }));
    tape.position.set(x, 1.0, z + 0.75);
    const tape2 = tape.clone(); tape2.position.z = z - 0.75;
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), M.trashBag); bag.scale.set(1, 0.7, 1.1); bag.position.set(x - 1.2, 0.42, z);
    const cone = makeCone(M); cone.position.set(x + 1.3, 0.18, z + 0.2);
    isl.brokenGroup.add(body, head, tape, tape2, bag, cone);
    isl.brokenCollider = this.colliders.addBox(x, z, 0.5, 0.3, 0, 0.18, 2.2);
    isl.brokenGroup.visible = !isl.active;
    this.colliders.setEnabled(isl.brokenCollider, !isl.active);
    // trash can + squeegee bucket (decor)
    const can = this.cyl(0.24, 0.22, 0.85, M.paint(0x2f5d50, 0.5, 0.3), x - 1.5, 0.6, z, { collide: true });
    this.cyl(0.26, 0.26, 0.06, M.darkMetal, x - 1.5, 1.05, z);
    this.cyl(0.13, 0.11, 0.3, M.blackPlastic, x + 1.4, 0.33, z - 0.15);
    this.islands.push(isl);
    return isl;
  }

  setIslandActive(i, on) {
    const isl = this.islands[i];
    isl.active = on;
    isl.brokenGroup.visible = !on;
    this.colliders.setEnabled(isl.brokenCollider, !on);
  }

  // ------------------------------------------------------------ shop shell
  buildShopShell() {
    const M = this.M, S = LAYOUT.shop, D = LAYOUT.door;
    const H = S.wallH, fy = S.floor, t = 0.25;
    const wallMat = M.stucco;
    const midY = fy + H / 2;
    // back wall
    this.box(S.maxX - S.minX + t, H, t, wallMat, 0, midY, S.maxZ + t / 2, { collide: true, tile: 3 });
    // east wall (with a small high window)
    this.box(t, H, S.maxZ - S.minZ, wallMat, S.maxX + t / 2, midY, (S.minZ + S.maxZ) / 2, { collide: true, tile: 3 });
    // west wall with side door gap
    const sd = LAYOUT.sideDoor;
    const z0 = S.minZ, z1 = sd.z - sd.width / 2, z2 = sd.z + sd.width / 2, z3 = S.maxZ;
    this.box(t, H, z1 - z0, wallMat, S.minX - t / 2, midY, (z0 + z1) / 2, { collide: true, tile: 3 });
    this.box(t, H, z3 - z2, wallMat, S.minX - t / 2, midY, (z2 + z3) / 2, { collide: true, tile: 3 });
    this.box(t, H - 2.3, sd.width, wallMat, S.minX - t / 2, fy + 2.3 + (H - 2.3) / 2, sd.z, { tile: 3 });
    // side door (metal, opens when used)
    const sdoor = new THREE.Mesh(boxGeo(0.06, 2.25, sd.width - 0.05, 1), M.paint(0x6b7a80, 0.5, 0.4));
    sdoor.geometry.translate(0, 0, (sd.width - 0.05) / 2);
    sdoor.position.set(S.minX - 0.05, fy + 1.125, sd.z - sd.width / 2 + 0.02);
    sdoor.castShadow = true; this.group.add(sdoor);
    this.sideDoorMesh = sdoor; this.sideDoorOpen = 0;
    const sdKnob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), M.chrome); sdKnob.position.set(-0.06, 0, sd.width - 0.2); sdoor.add(sdKnob);
    const sdSign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.25), new THREE.MeshStandardMaterial({ map: canvasTexture(256, 100, (ctx, w, h) => { ctx.fillStyle = '#c22a1f'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.fillText('DELIVERIES', w / 2, 62); }) }));
    sdSign.position.set(S.minX - t - 0.01, fy + 2.6, sd.z); sdSign.rotation.y = -Math.PI / 2; this.group.add(sdSign);

    // front wall: knee wall + glass + mullions, door opening
    const fz = S.minZ - t / 2;
    const left0 = S.minX, left1 = D.x - D.width / 2 - 0.15, right0 = D.x + D.width / 2 + 0.15, right1 = S.maxX;
    const kneeH = 0.55;
    for (const [a, b] of [[left0, left1], [right0, right1]]) {
      this.box(b - a, kneeH, t, M.stuccoRed, (a + b) / 2, fy + kneeH / 2, fz, { collide: true, tile: 2 });
      // glass
      const gw = b - a, gh = 2.65;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), M.glass);
      glass.position.set((a + b) / 2, fy + kneeH + gh / 2, fz); glass.renderOrder = 2;
      this.group.add(glass);
      this.colliders.addBox((a + b) / 2, fz, gw / 2, 0.06, 0, fy + kneeH, fy + kneeH + gh);
      // mullions
      const n = Math.max(2, Math.round(gw / 2.2));
      for (let k = 0; k <= n; k++) {
        const x = a + (gw * k) / n;
        this.box(0.09, gh, 0.14, M.aluminum, x, fy + kneeH + gh / 2, fz, { cast: false });
      }
      this.box(gw, 0.09, 0.16, M.aluminum, (a + b) / 2, fy + kneeH + 0.04, fz, { cast: false });
      this.box(gw, 0.09, 0.16, M.aluminum, (a + b) / 2, fy + kneeH + gh, fz, { cast: false });
    }
    // header above glass + door
    const headerY0 = fy + kneeH + 2.65;
    this.box(S.maxX - S.minX + t, H - (headerY0 - fy), t, M.stuccoRed, 0, (headerY0 + fy + H) / 2, fz, { tile: 2 });
    // door frame
    this.box(0.15, 2.4, 0.2, M.aluminum, D.x - D.width / 2 - 0.075, fy + 1.2, fz);
    this.box(0.15, 2.4, 0.2, M.aluminum, D.x + D.width / 2 + 0.075, fy + 1.2, fz);
    this.box(D.width + 0.3, 0.32, 0.22, M.aluminum, D.x, fy + 2.45, fz);
    this.box(0.3, headerY0 - fy - 2.6, t, M.stuccoRed, D.x - D.width / 2 - 0.15 - 0.0, fy + 2.6 + (headerY0 - fy - 2.6) / 2, fz);
    this.box(D.width + 0.3, headerY0 - fy - 2.6, t, M.stuccoRed, D.x, fy + 2.6 + (headerY0 - fy - 2.6) / 2, fz);
    // sliding door leaves
    this.doorLeaves = [];
    for (const side of [-1, 1]) {
      const leaf = new THREE.Group();
      const g = new THREE.Mesh(new THREE.PlaneGeometry(D.width / 2, 2.2), M.glass); g.renderOrder = 2; leaf.add(g);
      const fr = new THREE.Mesh(boxGeo(D.width / 2, 2.25, 0.05, 1), M.aluminum);
      // frame as 4 thin bars
      const bars = [[D.width / 2, 0.07, 0, 1.1], [D.width / 2, 0.07, 0, -1.1], [0.07, 2.25, D.width / 4 - 0.035, 0], [0.07, 2.25, -D.width / 4 + 0.035, 0]];
      for (const [bw, bh, bx, by] of bars) { const b = new THREE.Mesh(boxGeo(bw, bh, 0.06, 1), M.aluminum); b.position.set(bx, by, 0); b.castShadow = true; leaf.add(b); }
      const handle = new THREE.Mesh(boxGeo(0.03, 0.5, 0.06, 1), M.chrome); handle.position.set(-side * (D.width / 4 - 0.12), 0, 0.05); leaf.add(handle);
      fr.visible = false;
      leaf.position.set(D.x + side * D.width / 4, fy + 1.15, fz);
      leaf.userData.side = side;
      this.group.add(leaf);
      this.doorLeaves.push(leaf);
    }
    // "OPEN" decal on door glass
    this.doorOpen = 0; // 0 closed .. 1 open
    this.doorCollider = this.colliders.addBox(D.x, fz, D.width / 2, 0.08, 0, fy, fy + 2.3, { nav: false, physics: true });
    this.doorJammed = false;

    // roof + parapet
    const roofY = fy + H;
    this.box(S.maxX - S.minX + 0.6, 0.3, S.maxZ - S.minZ + 0.6, M.roofTar, 0, roofY + 0.15, (S.minZ + S.maxZ) / 2, { tile: 4 });
    const parH = 0.9;
    this.box(S.maxX - S.minX + 0.6, parH, 0.22, M.stucco, 0, roofY + parH / 2 + 0.1, S.maxZ + 0.3, { tile: 3 });
    this.box(0.22, parH, S.maxZ - S.minZ + 0.6, M.stucco, S.maxX + 0.3, roofY + parH / 2 + 0.1, (S.minZ + S.maxZ) / 2, { tile: 3 });
    this.box(0.22, parH, S.maxZ - S.minZ + 0.6, M.stucco, S.minX - 0.3, roofY + parH / 2 + 0.1, (S.minZ + S.maxZ) / 2, { tile: 3 });
    // big sign band on front
    const signTex = canvasTexture(2048, 256, (ctx, W, Hh) => {
      ctx.fillStyle = '#1b1b1f'; ctx.fillRect(0, 0, W, Hh);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#ff8a2a'; ctx.shadowBlur = 24;
      ctx.fillStyle = '#ffb52e'; ctx.font = 'bold 150px Impact, Arial Black';
      ctx.fillText('LAST CHANCE', W * 0.3, Hh * 0.52, W * 0.5);
      ctx.shadowColor = '#ff3a2a'; ctx.fillStyle = '#ff5a36'; ctx.fillText('FOOD MART', W * 0.77, Hh * 0.52, W * 0.38);
      ctx.shadowBlur = 0; ctx.fillStyle = '#ffffff'; ctx.font = 'bold 60px Impact'; ctx.fillText('★', W * 0.565, Hh * 0.5);
    });
    this.signMat = this.nightMat(new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.4 }), 1.6);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 0.3), [M.darkMetal, M.darkMetal, M.darkMetal, M.darkMetal, M.darkMetal, this.signMat]);
    sign.position.set(-1.5, roofY + 0.75, S.minZ - 0.35); sign.castShadow = true;
    this.group.add(sign);
    // awning over the sidewalk
    this.box(24, 0.18, 2.6, M.canopyWhite, 0, fy + 3.05, -0.9, { tile: 2 });
    this.box(24, 0.35, 0.08, M.redPaint, 0, fy + 3.05, -2.2, { tile: 2 });
    for (const x of [-11.5, -5, 7, 11.5]) this.cyl(0.07, 0.07, 3.0, M.steel, x, fy + 1.5, -2.0, { collide: true });
    this.awningLightMat = this.nightMat(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe6c4, emissiveIntensity: 0.1 }), 3);
    for (let x = -10; x <= 10; x += 4) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 12), this.awningLightMat); l.position.set(x, fy + 2.95, -0.9); this.group.add(l); }
    // HVAC units on roof
    for (const [x, z] of [[-5, 9], [4, 10]]) {
      this.box(2.2, 1.1, 1.6, M.aluminum, x, roofY + 0.85, z);
      this.cyl(0.5, 0.5, 0.08, M.darkMetal, x + 0.4, roofY + 1.44, z);
    }
    // posters in windows
    const poster = (txt, sub, col, x) => {
      const tex = canvasTexture(256, 360, (ctx, w, h) => {
        ctx.fillStyle = col; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 54px Impact'; ctx.fillText(txt, w / 2, 120);
        ctx.font = 'bold 30px Arial'; ctx.fillText(sub, w / 2, 190);
        ctx.font = 'bold 80px Impact'; ctx.fillStyle = '#ffe14a'; ctx.fillText('$1.99', w / 2, 300);
      });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.05), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
      p.position.set(x, fy + 1.6, S.minZ + 0.03); p.rotation.y = Math.PI;
      this.group.add(p);
    };
    poster('ICE COLD', 'FIZZ COLA', '#c22a1f', -8.5); poster('HOT DOGS', '2 FOR', '#d27a12', -6.8); poster('JERKY', 'SAGUARO BRAND', '#5b3a1e', 7.2); poster('COFFEE', 'ANY SIZE', '#2f6f73', 8.8);
  }

  // ------------------------------------------------------------ pylon price sign
  buildPylon() {
    const M = this.M;
    const x = -6, z = -33.2;
    for (const px of [-1.2, 1.2]) this.box(0.35, 9, 0.35, M.darkMetal, x + px, 4.5, z, { collide: true });
    this.box(0.9, 0.5, 0.9, M.sidewalk, x - 1.2, 0.25, z, { tile: 1 });
    this.box(0.9, 0.5, 0.9, M.sidewalk, x + 1.2, 0.25, z, { tile: 1 });
    const logoTex = canvasTexture(512, 512, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#e3442a'); g.addColorStop(1, '#a8261a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ffb52e'; ctx.lineWidth = 16; ctx.strokeRect(14, 14, w - 28, h - 28);
      ctx.fillStyle = '#fff4dd'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 92px Impact, Arial Black'; ctx.fillText('LAST', w / 2, 120); ctx.fillText('CHANCE', w / 2, 220);
      ctx.fillStyle = '#ffb52e'; ctx.font = 'bold 190px Impact, Arial Black'; ctx.fillText('GAS', w / 2, 370);
      grime(ctx, w, h, 0.15, '60,20,10');
    });
    const logoMat = this.nightMat(new THREE.MeshStandardMaterial({ map: logoTex, emissiveMap: logoTex, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.45 }), 1.3);
    const side = M.paint(0x1f1f22, 0.5, 0.3);
    const logo = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 0.5), [side, side, side, side, logoMat, logoMat]);
    logo.position.set(x, 9.7, z); logo.castShadow = true; this.group.add(logo);
    // price board (texture updated by fuel system)
    this.priceTex = canvasTexture(512, 512, () => {});
    this.priceMat = this.nightMat(new THREE.MeshStandardMaterial({ map: this.priceTex, emissiveMap: this.priceTex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.5 }), 1.4);
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 0.4), [side, side, side, side, this.priceMat, this.priceMat]);
    board.position.set(x, 6.1, z); board.castShadow = true; this.group.add(board);
  }

  updatePriceBoard(prices, premiumUnlocked) {
    const ctx = this.priceTex.userData.ctx, w = 512, h = 512;
    ctx.fillStyle = '#111214'; ctx.fillRect(0, 0, w, h);
    const rows = [['REGULAR', prices.regular, '#3fdc6c'], ['DIESEL', prices.diesel, '#ffcf3a'], ['PREMIUM', premiumUnlocked ? prices.premium : null, '#5aa8ff']];
    rows.forEach(([name, p, col], i) => {
      const y = 40 + i * 160;
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(16, y, w - 32, 50);
      ctx.fillStyle = '#111'; ctx.font = 'bold 42px Arial Black, Arial'; ctx.textAlign = 'center'; ctx.fillText(name, w / 2, y + 42);
      ctx.fillStyle = col; ctx.font = 'bold 96px "Courier New", monospace'; ctx.shadowColor = col; ctx.shadowBlur = 18;
      ctx.fillText(p == null ? '--.--' : p.toFixed(2), w / 2 - 10, y + 140);
      ctx.shadowBlur = 0; ctx.font = 'bold 30px Arial'; ctx.fillText('9/10', w - 50, y + 105);
    });
    this.priceTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ exterior props
  buildExteriorProps() {
    const M = this.M, S = LAYOUT.shop;
    // dumpster behind the shop (west-back)
    const dump = new THREE.Group();
    const dbody = new THREE.Mesh(boxGeo(2.0, 1.3, 1.3, 1), M.paint(0x2c5a3e, 0.6, 0.4)); dbody.position.y = 0.75; dbody.castShadow = true; dbody.receiveShadow = true;
    const lid = new THREE.Mesh(boxGeo(2.05, 0.08, 1.4, 1), M.blackPlastic); lid.position.set(0, 1.44, 0); lid.rotation.x = -0.08; lid.castShadow = true;
    dump.add(dbody, lid);
    for (const wx of [-0.8, 0.8]) for (const wz of [-0.5, 0.5]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10), M.rubber); w.rotation.x = Math.PI / 2; w.position.set(wx, 0.08, wz); dump.add(w); }
    dump.position.set(-15.5, 0, 14.2); this.group.add(dump);
    this.dumpster = dump;
    this.colliders.addBox(-15.5, 14.2, 1.05, 0.7, 0, 0, 1.5);
    // ice chest
    const iceTex = canvasTexture(256, 128, (ctx, w, h) => { ctx.fillStyle = '#e8f4ff'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#1d6fd1'; ctx.font = 'bold 64px Impact'; ctx.textAlign = 'center'; ctx.fillText('ICE', w / 2, 80); ctx.font = 'bold 22px Arial'; ctx.fillText('PURE DESERT ICE', w / 2, 112); });
    const ice = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.25, 0.8), [M.whitePlastic, M.whitePlastic, M.whitePlastic, M.whitePlastic, new THREE.MeshStandardMaterial({ map: iceTex, roughness: 0.5 }), M.whitePlastic]);
    ice.position.set(-8.4, 0.15 + 0.63, -1.1); ice.rotation.y = Math.PI; ice.castShadow = true; this.group.add(ice);
    this.colliders.addBox(-8.4, -1.1, 0.9, 0.4, 0, 0.15, 1.4);
    // propane cage
    const cageMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.4, wireframe: false });
    const cage = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.8), new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.35 }));
    frame.position.y = 0.95; cage.add(frame);
    for (let k = 0; k < 6; k++) { const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.55, 12), M.paint(0xf4f4f0, 0.4, 0.2)); tank.position.set(-0.55 + (k % 3) * 0.55, 0.45 + Math.floor(k / 3) * 0.75, 0); tank.castShadow = true; cage.add(tank); }
    for (let k = 0; k < 5; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.6, 0.03), cageMat); bar.position.set(-0.8 + k * 0.4, 0.95, 0.4); cage.add(bar); }
    cage.position.set(6.6, 0.15, -1.2); this.group.add(cage);
    this.colliders.addBox(6.6, -1.2, 0.8, 0.4, 0, 0.15, 1.8);
    // air/water machine
    const air = new THREE.Group();
    const ab = new THREE.Mesh(boxGeo(0.6, 1.4, 0.45, 1), M.paint(0x1f63b8, 0.4, 0.3)); ab.position.y = 0.7; ab.castShadow = true; air.add(ab);
    const airTex = canvasTexture(128, 128, (ctx, w, h) => { ctx.fillStyle = '#1f63b8'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = 'bold 40px Impact'; ctx.textAlign = 'center'; ctx.fillText('AIR', w / 2, 55); ctx.font = 'bold 22px Arial'; ctx.fillText('& WATER', w / 2, 90); });
    const ap = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardMaterial({ map: airTex })); ap.position.set(0, 1.05, 0.231); air.add(ap);
    air.position.set(-37, 0, -8); air.rotation.y = Math.PI / 2; this.group.add(air);
    this.colliders.addBox(-37, -8, 0.25, 0.32, 0, 0, 1.4);
    // benches & trash cans by the shop
    for (const x of [-6.2, 5.2]) {
      this.box(1.6, 0.06, 0.45, M.wood, x, 0.6, -0.4, { tile: 1 });
      this.box(1.6, 0.4, 0.05, M.wood, x, 0.85, -0.15, { tile: 1 });
      this.box(0.06, 0.45, 0.4, M.darkMetal, x - 0.7, 0.37, -0.4, { cast: false });
      this.box(0.06, 0.45, 0.4, M.darkMetal, x + 0.7, 0.37, -0.4, { cast: false });
      this.colliders.addBox(x, -0.4, 0.8, 0.25, 0, 0.15, 1.0, { physics: true });
    }
    this.trashCans = [];
    for (const [x, z] of [[-1.0, -1.5], [4.6, -1.5], [-21, -24]]) {
      this.cyl(0.3, 0.27, 0.95, M.paint(0x3a3a3a, 0.6, 0.4), x, x === -21 ? 0.48 : 0.62, z, { collide: true });
      this.trashCans.push(new THREE.Vector3(x, 1.0, z));
    }
    // lot light poles
    this.lotLampMat = this.nightMat(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 0.1 }), 5);
    this.lampPositions = [];
    for (const [x, z] of [[-40, -28], [40, -28], [-40, 4], [40, 4], [-22, 13.6], [16, 13.6]]) {
      this.cyl(0.11, 0.15, 8, M.darkMetal, x, 4, z, { collide: true });
      this.box(1.6, 0.14, 0.14, M.darkMetal, x + (x < 0 ? 0.7 : -0.7), 7.9, z);
      const head = new THREE.Mesh(boxGeo(0.7, 0.18, 0.4, 1), M.darkMetal); head.position.set(x + (x < 0 ? 1.4 : -1.4), 7.85, z); this.group.add(head);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.32), this.lotLampMat); lens.rotation.x = Math.PI / 2; lens.position.set(x + (x < 0 ? 1.4 : -1.4), 7.75, z); this.group.add(lens);
      this.lampPositions.push(new THREE.Vector3(x + (x < 0 ? 1.4 : -1.4), 7.7, z));
    }
    // fuel tank fill caps (underground tanks) & vent pipes
    for (let k = 0; k < 3; k++) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), [M.paint(0x3fdc6c, 0.5, 0.3), M.paint(0xffcf3a, 0.5, 0.3), M.paint(0x3a7bd5, 0.5, 0.3)][k]);
      cap.position.set(-24 + k * 1.2, 0.02, -8.2); this.group.add(cap);
    }
    for (let k = 0; k < 3; k++) this.cyl(0.04, 0.04, 4.5, M.steel, S.minX - 0.4 + k * 0.15, 2.25, S.maxZ + 0.3);
    // water tower & windmill out back for silhouette
    const tower = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 24), M.paint(0xc9c2b4, 0.6, 0.5)); tank.position.y = 11; tank.castShadow = true;
    const roofc = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 24), M.paint(0xa8261a, 0.6, 0.3)); roofc.position.y = 13.2; roofc.castShadow = true;
    tower.add(tank, roofc);
    for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 9.6, 6), M.darkMetal); leg.position.set(lx, 4.8, lz); leg.castShadow = true; tower.add(leg); }
    const ttex = canvasTexture(512, 128, (ctx, w, h) => { ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#a8261a'; ctx.font = 'bold 80px Impact'; ctx.textAlign = 'center'; ctx.fillText('LAST CHANCE', w / 2, 95); });
    const tl = new THREE.Mesh(new THREE.CylinderGeometry(2.42, 2.42, 1.0, 24, 1, true, -0.9, 1.8), new THREE.MeshStandardMaterial({ map: ttex, transparent: true }));
    tl.position.y = 11; tl.rotation.y = Math.PI; tower.add(tl);
    tower.position.set(30, 0, 30); this.scene.add(tower);
    // old wrecked car in the sand (silhouette)
    // (added by vehicles module later)
  }

  // ------------------------------------------------------------ car wash (unlockable)
  buildCarwash() {
    const M = this.M, C = LAYOUT.carwash;
    const g = new THREE.Group();
    const w = C.maxX - C.minX, d = C.maxZ - C.minZ, cx = (C.minX + C.maxX) / 2, cz = (C.minZ + C.maxZ) / 2;
    for (const x of [C.minX, C.maxX]) { const p = new THREE.Mesh(boxGeo(0.35, 4.2, d, 3), M.stucco); p.position.set(x, 2.1, cz); p.castShadow = true; p.receiveShadow = true; g.add(p); }
    for (const z of [C.minZ, C.maxZ]) { const b = new THREE.Mesh(boxGeo(w + 0.35, 1.1, 0.35, 3), M.stucco); b.position.set(cx, 3.65, z); b.castShadow = true; g.add(b); }
    const roof = new THREE.Mesh(boxGeo(w + 0.8, 0.3, d + 0.6, 3), M.canopyWhite); roof.position.set(cx, 4.35, cz); roof.castShadow = true; g.add(roof);
    const tex = canvasTexture(1024, 200, (ctx, W, H) => { const gr = ctx.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#0d4aa8'); gr.addColorStop(1, '#2a9dff'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = 'bold 96px Impact'; ctx.textAlign = 'center'; ctx.fillText('SPLASH-O-MATIC', W / 2, 105); ctx.font = 'bold 54px Impact'; ctx.fillText('CAR WASH  •  $8', W / 2, 175); });
    const signMat = this.nightMat(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.1 }), 1.2);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.2, 1.1), signMat); sign.position.set(cx, 3.65, C.minZ - 0.19); sign.rotation.y = Math.PI; g.add(sign);
    this.washBrushes = [];
    const bm = [new THREE.MeshStandardMaterial({ color: 0x2a7bff, roughness: 1 }), new THREE.MeshStandardMaterial({ color: 0xff4a7a, roughness: 1 })];
    for (const z of [cz - 2, cz + 2]) {
      for (const x of [C.minX + 0.9, C.maxX - 0.9]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.6, 14, 1), bm[z > cz ? 1 : 0]);
        b.position.set(x, 1.5, z); g.add(b); this.washBrushes.push(b);
      }
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, w - 1.2, 14), bm[0]); top.rotation.z = Math.PI / 2; top.position.set(cx, 3.0, cz); g.add(top); this.washBrushes.push(top);
    const floor = new THREE.Mesh(planeGeo(w, d, 2), M.concrete); floor.position.set(cx, 0.016, cz); floor.receiveShadow = true; g.add(floor);
    g.visible = false;
    this.scene.add(g);
    this.carwashGroup = g;
    this.carwashColliders = [
      this.colliders.addBox(C.minX, cz, 0.18, d / 2, 0, 0, 4.2),
      this.colliders.addBox(C.maxX, cz, 0.18, d / 2, 0, 0, 4.2),
    ];
    this.carwashColliders.forEach((b) => this.colliders.setEnabled(b, false));
  }
  setCarwash(on) {
    this.carwashGroup.visible = on;
    this.carwashColliders.forEach((b) => this.colliders.setEnabled(b, on));
  }

  // ------------------------------------------------------------ night lighting
  buildLightingRig() {
    const q = this.game.renderer.qualityName;
    const C = LAYOUT.canopy, S = LAYOUT.shop;
    const add = (light, base) => { this.scene.add(light); this.lights.push({ light, base }); return light; };
    // canopy floods (spot lights pointing down)
    const xs = q === 'low' ? [0] : [-9, 0, 9];
    for (const x of xs) {
      const s = new THREE.SpotLight(0xfff1dc, 0, 22, Math.PI / 2.4, 0.6, 1.4);
      s.position.set(x, C.y - 0.05, -17); s.target.position.set(x, 0, -17);
      this.scene.add(s.target);
      add(s, q === 'low' ? 110 : 42);
    }
    // shop interior
    const shopPts = q === 'low' ? [[0, 7]] : [[-5, 4.5], [4, 9]];
    for (const [x, z] of shopPts) {
      const p = new THREE.PointLight(0xfff4e6, 0, 16, 1.6);
      p.position.set(x, S.floor + 3.4, z);
      add(p, q === 'low' ? 60 : 32).userData.indoor = true;
    }
    // awning wash light
    const aw = new THREE.PointLight(0xffe2bc, 0, 12, 1.8); aw.position.set(0, 2.9, -1.4); add(aw, 18);
    // lot lamps (two strongest)
    if (q !== 'low') {
      for (const p of [this.lampPositions[0], this.lampPositions[1]]) {
        const s = new THREE.SpotLight(0xffd9a0, 0, 30, Math.PI / 3, 0.7, 1.5);
        s.position.copy(p); s.target.position.set(p.x, 0, p.z); this.scene.add(s.target);
        add(s, 90);
      }
    }
  }

  /** night: 0 day .. 1 night. shopLights: interior lights on/off */
  updateLighting(night, dt, time) {
    const k = Math.min(1, night * 1.3);
    for (const { light, base } of this.lights) {
      const indoor = light.userData.indoor;
      light.intensity = indoor ? base * (0.35 + 0.65 * k) : base * k;
    }
    for (const nm of this.nightMats) nm.mat.emissiveIntensity = nm.base * (0.08 + 0.92 * k);
    // slight neon flicker on the shop sign before full restoration
    if (this.signFlicker && k > 0.3) {
      const f = Math.sin(time * 37) > 0.97 || Math.sin(time * 13.3) > 0.995 ? 0.25 : 1;
      this.signMat.emissiveIntensity *= f;
    }
  }

  // ------------------------------------------------------------ doors
  updateDoors(dt, actors) {
    const D = LAYOUT.door, fz = LAYOUT.shop.minZ;
    let want = 0;
    if (!this.doorJammed) {
      for (const a of actors) {
        const dx = a.x - D.x, dz = a.z - fz;
        if (Math.abs(dx) < 1.8 && Math.abs(dz) < 2.6) { want = 1; break; }
      }
    }
    const prev = this.doorOpen;
    this.doorOpen += Math.sign(want - this.doorOpen) * Math.min(Math.abs(want - this.doorOpen), dt * 2.4);
    for (const leaf of this.doorLeaves) leaf.position.x = D.x + leaf.userData.side * (D.width / 4 + this.doorOpen * D.width * 0.48);
    this.colliders.setEnabled(this.doorCollider, this.doorOpen < 0.6);
    if (prev < 0.05 && this.doorOpen >= 0.05 && this.onDoorOpen) this.onDoorOpen();
    // side door eases closed
    if (this.sideDoorOpen > 0) {
      this.sideDoorOpen = Math.max(0, this.sideDoorOpen - dt * 0.35);
      this.sideDoorMesh.rotation.y = -Math.min(1, this.sideDoorOpen * 2) * 1.4;
    }
  }
}

export function makeCone(M) {
  const g = new THREE.Group();
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.55 });
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.62, 16, 1, true), coneMat); c.position.y = 0.33; c.castShadow = true;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.115, 0.1, 16, 1, true), M.whitePlastic); stripe.position.y = 0.38;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.8 })); base.position.y = 0.02; base.castShadow = true;
  g.add(c, stripe, base);
  return g;
}

export { roundRect };
