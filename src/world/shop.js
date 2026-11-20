import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxGeo, planeGeo } from '../gfx/materials.js';
import { canvasTexture } from '../gfx/textures.js';
import { LAYOUT } from './station.js';

const FY = LAYOUT.shop.floor;

export const SHOP = {
  counter: { x: -4.0, z0: 2.0, z1: 7.0, w: 0.75, h: 1.0 },
  playerRegSpot: new THREE.Vector3(-5.0, FY, 4.1),
  payerSpot: new THREE.Vector3(-3.05, FY, 3.9),
  queueDir: new THREE.Vector3(0, 0, 1),
  gondolas: [{ x0: -0.5, x1: 4.5, z: 5.0 }, { x0: -0.5, x1: 4.5, z: 8.6 }],
  fridges: { x0: 0.6, x1: 7.6, z: 12.55, doors: 5 },
  wallShelf: { x: 9.55, z0: 2.4, z1: 10.8 },
  coffee: new THREE.Vector3(-7.8, FY, 12.3),
  hotdog: new THREE.Vector3(-3.95, FY + 1.0, 6.3),
  radio: new THREE.Vector3(-9.5, FY + 1.25, 3.0),
  entranceInside: new THREE.Vector3(2.5, FY, 2.6),
  entranceOutside: new THREE.Vector3(2.5, 0.15, -1.2),
  restroom: new THREE.Vector3(-5.0, FY, 12.4),
};

export function queueSpot(i, out = new THREE.Vector3()) {
  if (i === 0) return out.copy(SHOP.payerSpot);
  return out.set(-2.6, FY, 3.9 + i * 0.95);
}

/**
 * Shop interior: floor, ceiling, counter, gondolas with product slots,
 * fridges, wall shelf, decor. Returns slot definitions for inventory.
 */
export function buildShopInterior(station) {
  const M = station.M, S = LAYOUT.shop, col = station.colliders;
  const g = new THREE.Group();
  station.scene.add(g);
  const slots = [];
  const hitboxes = [];
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  // floor & ceiling
  const floor = new THREE.Mesh(planeGeo(S.maxX - S.minX, S.maxZ - S.minZ, 2.4), M.tiles);
  floor.position.set(0, FY, (S.minZ + S.maxZ) / 2); floor.receiveShadow = true; g.add(floor);
  // floor slab side faces
  station.box(S.maxX - S.minX - 0.02, FY - 0.03, S.maxZ - S.minZ - 0.02, M.sidewalk, 0, (FY - 0.03) / 2, (S.minZ + S.maxZ) / 2, { cast: false, tile: 4 });
  const ceilY = FY + 3.55;
  const ceil = new THREE.Mesh(planeGeo(S.maxX - S.minX, S.maxZ - S.minZ, 1.2), M.ceiling);
  ceil.rotation.x = Math.PI; ceil.position.set(0, ceilY, (S.minZ + S.maxZ) / 2); g.add(ceil);
  // interior wall finish panels (accent lower band)
  const wallIn = [
    [S.maxX - S.minX - 0.02, 0, S.maxZ - 0.02, Math.PI],
    [S.maxZ - S.minZ - 0.04, S.maxX - 0.02, (S.minZ + S.maxZ) / 2, -Math.PI / 2],
  ];
  for (const [len, x, z, r] of wallIn) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, ceilY - FY), M.interiorWall); p.position.set(x, (ceilY + FY) / 2, z); p.rotation.y = r; p.receiveShadow = true; g.add(p);
    const a = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.0), M.interiorWallAccent); a.position.set(x + (r === Math.PI ? 0 : -0.018), FY + 0.5, z + (r === Math.PI ? -0.018 : 0)); a.rotation.y = r; g.add(a);
  }
  // west interior wall (two pieces around side door)
  const sd = LAYOUT.sideDoor;
  for (const [za, zb] of [[S.minZ, sd.z - sd.width / 2], [sd.z + sd.width / 2, S.maxZ]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(zb - za, ceilY - FY), M.interiorWall);
    p.position.set(S.minX + 0.02, (ceilY + FY) / 2, (za + zb) / 2); p.rotation.y = Math.PI / 2; p.receiveShadow = true; g.add(p);
  }
  // ceiling light panels
  const lightMat = station.nightMat(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8ee, emissiveIntensity: 2.4, roughness: 0.3 }), 2.6);
  station.nightMats[station.nightMats.length - 1].indoor = true;
  const lp = [];
  for (let x = -8; x <= 8; x += 4) for (let z = 3; z <= 12; z += 3) { const b = new THREE.BoxGeometry(1.2, 0.04, 0.6); b.translate(x, ceilY - 0.02, z); lp.push(b); }
  g.add(new THREE.Mesh(mergeGeometries(lp), lightMat));

  // ---------------------------------------------------------- counter
  const C = SHOP.counter;
  const counterLen = C.z1 - C.z0, ccz = (C.z0 + C.z1) / 2;
  const frontTex = canvasTexture(512, 128, (ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2f6f73'); gr.addColorStop(1, '#1f4c50');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffb52e'; ctx.fillRect(0, 10, w, 6);
    for (let x = 0; x < w; x += 64) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, 20, 2, h); }
  });
  const counterSide = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.6 });
  const counterTop = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.5, metalness: 0.05 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(C.w, C.h - 0.05, counterLen), [counterSide, counterSide, counterTop, counterTop, counterSide, counterSide]);
  counter.position.set(C.x, FY + (C.h - 0.05) / 2, ccz); counter.castShadow = true; counter.receiveShadow = true; g.add(counter);
  const top = new THREE.Mesh(boxGeo(C.w + 0.1, 0.05, counterLen + 0.1, 1), new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.45, metalness: 0.05 }));
  top.position.set(C.x, FY + C.h - 0.025, ccz); top.receiveShadow = true; top.castShadow = true; g.add(top);
  col.addBox(C.x, ccz, C.w / 2 + 0.05, counterLen / 2 + 0.05, 0, FY, FY + C.h);
  // back counter behind cashier (with radio, cigarettes-like shelf of candy)
  station.box(0.6, 1.0, 4.6, M.wood, S.minX + 0.35, FY + 0.5, 3.6, { collide: true, tile: 1 });
  station.box(0.62, 0.04, 4.62, M.blackPlastic, S.minX + 0.35, FY + 1.02, 3.6);
  // shelving above back counter with display boxes
  station.box(0.35, 0.03, 4.4, M.wood, S.minX + 0.2, FY + 1.85, 3.6);
  station.box(0.35, 0.03, 4.4, M.wood, S.minX + 0.2, FY + 2.35, 3.6);
  const rng = Math.random;
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Color().setHSL(rng(), 0.6, 0.45);
    const b = new THREE.Mesh(boxGeo(0.2, 0.28, 0.22, 0), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    b.position.set(S.minX + 0.22, FY + 1.87 + 0.14 + (i % 2) * 0.5, 1.8 + Math.floor(i / 2) * 0.48);
    station.batch.addMesh(b);
  }
  // CCTV monitor on wall (decor)
  const cctvTex = canvasTexture(256, 192, (ctx, w, h) => { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#3a4'; ctx.font = '14px monospace'; ctx.fillText('CAM 01  PUMPS', 10, 20); ctx.fillText('● REC', w - 60, 20); for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(120,160,130,${Math.random() * 0.2})`; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 2); } });
  const cctv = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.5), [M.blackPlastic, new THREE.MeshStandardMaterial({ map: cctvTex, emissiveMap: cctvTex, emissive: 0xffffff, emissiveIntensity: 0.6 }), M.blackPlastic, M.blackPlastic, M.blackPlastic, M.blackPlastic]);
  cctv.position.set(S.minX + 0.05, FY + 2.9, 2.2); g.add(cctv);

  // ---------------------------------------------------------- gondolas (double sided)
  const levels = [0.18, 0.62, 1.06];
  const shelfMat = M.paint(0xe9e6df, 0.5, 0.2);
  const shelfEdge = M.paint(0xc22a1f, 0.5, 0.1);
  let slotId = 0;
  for (const go of SHOP.gondolas) {
    const len = go.x1 - go.x0, cx = (go.x0 + go.x1) / 2;
    station.box(len, 1.5, 0.12, shelfMat, cx, FY + 0.75, go.z, { tile: 1 });              // spine
    station.box(len + 0.04, 0.14, 0.95, M.paint(0x3a3a3c, 0.6, 0.3), cx, FY + 0.07, go.z); // kick plate
    station.box(0.05, 1.55, 0.95, shelfMat, go.x0, FY + 0.775, go.z);
    station.box(0.05, 1.55, 0.95, shelfMat, go.x1, FY + 0.775, go.z);
    col.addBox(cx, go.z, len / 2 + 0.03, 0.48, 0, FY, FY + 1.6);
    // category header sign
    const hdr = canvasTexture(512, 96, (ctx, w, h) => { ctx.fillStyle = '#c22a1f'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = 'bold 60px Impact'; ctx.textAlign = 'center'; ctx.fillText('SNACKS & CANDY', w / 2, 70); });
    const hm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.05), new THREE.MeshStandardMaterial({ map: hdr, roughness: 0.6 }));
    hm.position.set(cx, FY + 1.85, go.z); g.add(hm);
    for (const side of [-1, 1]) {
      for (let li = 0; li < levels.length; li++) {
        const y = FY + levels[li];
        station.box(len - 0.06, 0.03, 0.4, shelfMat, cx, y, go.z + side * 0.27, { cast: true });
        station.box(len - 0.06, 0.05, 0.015, shelfEdge, cx, y + 0.01, go.z + side * 0.475, { cast: false });
        const nSlots = 4, sw = (len - 0.1) / nSlots;
        for (let si = 0; si < nSlots; si++) {
          const sx = go.x0 + 0.05 + sw * (si + 0.5);
          const slot = makeSlot(slotId++, 'snack', new THREE.Vector3(sx, y + 0.015, go.z + side * 0.44), new THREE.Vector3(0, 0, side), sw - 0.04, 0.36, 0.4);
          slots.push(slot);
        }
      }
    }
  }

  // ---------------------------------------------------------- wall shelf (auto)
  const W = SHOP.wallShelf;
  const wlen = W.z1 - W.z0, wcz = (W.z0 + W.z1) / 2;
  station.box(0.08, 2.0, wlen, shelfMat, W.x + 0.25, FY + 1.0, wcz);
  col.addBox(W.x, wcz, 0.3, wlen / 2, 0, FY, FY + 2.0);
  const hdr2 = canvasTexture(512, 96, (ctx, w, h) => { ctx.fillStyle = '#1b1b1f'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffb52e'; ctx.font = 'bold 60px Impact'; ctx.textAlign = 'center'; ctx.fillText('AUTO CARE', w / 2, 70); });
  const hm2 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.45), new THREE.MeshStandardMaterial({ map: hdr2 })); hm2.position.set(W.x + 0.2, FY + 2.35, wcz); hm2.rotation.y = -Math.PI / 2; g.add(hm2);
  for (const ly of [0.25, 0.8, 1.35]) {
    station.box(0.42, 0.03, wlen, shelfMat, W.x, FY + ly, wcz);
    station.box(0.015, 0.05, wlen, shelfEdge, W.x - 0.21, FY + ly + 0.01, wcz, { cast: false });
    const n = 5, sw = wlen / n;
    for (let si = 0; si < n; si++) {
      const sz = W.z0 + sw * (si + 0.5);
      slots.push(makeSlot(slotId++, 'auto', new THREE.Vector3(W.x - 0.19, FY + ly + 0.015, sz), new THREE.Vector3(-1, 0, 0), sw - 0.06, 0.36, 0.45));
    }
  }

  // ---------------------------------------------------------- fridges (back wall)
  const F = SHOP.fridges;
  const fw = (F.x1 - F.x0) / F.doors;
  const fridgeBody = M.paint(0x2a2c30, 0.4, 0.5);
  station.box(F.x1 - F.x0 + 0.1, 2.3, 0.8, fridgeBody, (F.x0 + F.x1) / 2, FY + 1.15, F.z + 0.05);
  col.addBox((F.x0 + F.x1) / 2, F.z, (F.x1 - F.x0) / 2 + 0.05, 0.45, 0, FY, FY + 2.3);
  const fridgeTop = canvasTexture(1024, 96, (ctx, w, h) => { const gr = ctx.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#0d4aa8'); gr.addColorStop(1, '#2a9dff'); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = 'bold 64px Impact'; ctx.textAlign = 'center'; ctx.fillText('❄ ICE COLD DRINKS ❄', w / 2, 70); });
  const ftm = station.nightMat(new THREE.MeshStandardMaterial({ map: fridgeTop, emissiveMap: fridgeTop, emissive: 0xffffff, emissiveIntensity: 1.0 }), 1.2);
  station.nightMats[station.nightMats.length - 1].indoor = true;
  const ft = new THREE.Mesh(new THREE.PlaneGeometry(F.x1 - F.x0, 0.4), ftm); ft.position.set((F.x0 + F.x1) / 2, FY + 2.12, F.z - 0.36); ft.rotation.y = Math.PI; g.add(ft);
  const fridgeLight = station.nightMat(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f4ff, emissiveIntensity: 2.0 }), 2.2);
  station.nightMats[station.nightMats.length - 1].indoor = true;
  const fridgeInside = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.4, metalness: 0.3, emissive: 0x7088a0, emissiveIntensity: 0.25 });
  for (let d = 0; d < F.doors; d++) {
    const x = F.x0 + fw * (d + 0.5);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.06, 1.9), fridgeInside); back.position.set(x, FY + 1.05, F.z + 0.3); back.rotation.y = Math.PI; g.add(back);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.8, 0.03), fridgeLight); strip.position.set(x - fw / 2 + 0.06, FY + 1.05, F.z - 0.28); g.add(strip);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.04, 1.95), M.fridgeGlass); glass.position.set(x, FY + 1.05, F.z - 0.36); glass.rotation.y = Math.PI; glass.renderOrder = 2; g.add(glass);
    station.box(0.05, 1.95, 0.06, M.aluminum, x - fw / 2 + 0.02, FY + 1.05, F.z - 0.36, { cast: false });
    const handle = new THREE.Mesh(boxGeo(0.025, 0.6, 0.04, 0), M.chrome); handle.position.set(x + fw / 2 - 0.1, FY + 1.1, F.z - 0.4); g.add(handle);
    for (let li = 0; li < 4; li++) {
      const y = FY + 0.18 + li * 0.46;
      station.box(fw - 0.08, 0.02, 0.55, M.aluminum, x, y, F.z + 0.02, { cast: false });
      slots.push(makeSlot(slotId++, 'cold', new THREE.Vector3(x, y + 0.012, F.z - 0.22), new THREE.Vector3(0, 0, -1), fw - 0.14, 0.4, 0.42));
    }
  }

  // ---------------------------------------------------------- coffee counter (machine added by upgrade)
  station.box(2.6, 0.95, 0.65, M.wood, SHOP.coffee.x, FY + 0.475, SHOP.coffee.z + 0.25, { collide: true, tile: 1 });
  station.box(2.62, 0.04, 0.68, M.blackPlastic, SHOP.coffee.x, FY + 0.97, SHOP.coffee.z + 0.25);
  // restroom door (decor + funny events)
  const rr = new THREE.Mesh(boxGeo(1.0, 2.15, 0.06, 1), M.paint(0x6b4a2e, 0.6, 0.1)); rr.position.set(SHOP.restroom.x, FY + 1.075, S.maxZ - 0.04); g.add(rr);
  const rrSign = canvasTexture(256, 128, (ctx, w, h) => { ctx.fillStyle = '#1d6fd1'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.fillText('RESTROOM', w / 2, 55); ctx.font = 'bold 22px Arial'; ctx.fillText('ask for key (good luck)', w / 2, 95); });
  const rrs = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshStandardMaterial({ map: rrSign })); rrs.position.set(SHOP.restroom.x, FY + 1.7, S.maxZ - 0.08); rrs.rotation.y = Math.PI; g.add(rrs);
  // ATM & newspaper box near entrance
  const atmTex = canvasTexture(128, 256, (ctx, w, h) => { ctx.fillStyle = '#1b2a44'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#5ad1ff'; ctx.fillRect(14, 30, w - 28, 70); ctx.fillStyle = '#fff'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center'; ctx.fillText('ATM', w / 2, 140); ctx.fillStyle = '#888'; for (let i = 0; i < 12; i++) ctx.fillRect(24 + (i % 3) * 28, 160 + Math.floor(i / 3) * 20, 20, 14); });
  const atm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.55), [M.darkMetal, M.darkMetal, M.darkMetal, M.darkMetal, M.darkMetal, new THREE.MeshStandardMaterial({ map: atmTex, emissiveMap: atmTex, emissive: 0xffffff, emissiveIntensity: 0.4 })]);
  atm.position.set(8.9, FY + 0.8, 1.6); atm.rotation.y = Math.PI; atm.castShadow = true; g.add(atm);
  col.addBox(8.9, 1.6, 0.3, 0.28, 0, FY, FY + 1.6);
  // mop bucket & wet floor sign by the restroom
  const sign = new THREE.Group();
  const signTex = canvasTexture(128, 160, (ctx, w, h) => { ctx.fillStyle = '#ffd400'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#111'; ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.fillText('CAUTION', w / 2, 30); ctx.font = 'bold 18px Arial'; ctx.fillText('WET FLOOR', w / 2, 130); ctx.beginPath(); ctx.arc(w / 2, 80, 22, 0, 7); ctx.fill(); });
  const sMat = new THREE.MeshStandardMaterial({ map: signTex, side: THREE.DoubleSide, roughness: 0.5 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.6), sMat); p.position.set(0, 0.3, s * 0.08); p.rotation.x = s * 0.25; sign.add(p); }
  sign.position.set(-3.5, FY, 12.2); g.add(sign);

  // ---------------------------------------------------------- slot hitboxes (for restocking raycasts)
  for (const s of slots) {
    const hb = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hitMat);
    const right = new THREE.Vector3(s.normal.z, 0, -s.normal.x);
    hb.scale.set(s.width, s.height, s.depth);
    hb.position.copy(s.pos).addScaledVector(s.normal, -s.depth / 2).add(new THREE.Vector3(0, s.height / 2, 0));
    hb.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), s.normal));
    hb.userData.slot = s;
    s.hitbox = hb; s.right = right;
    g.add(hb);
    hitboxes.push(hb);
  }
  return { group: g, slots, hitboxes };
}

function makeSlot(id, shelf, pos, normal, width, height, depth) {
  return { id, shelf, pos, normal, width, height, depth, product: null, count: 0 };
}
