import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../gfx/textures.js';
import { pick, rand, chance, clamp, smoothstep } from '../core/utils.js';

/**
 * Procedural vehicles. Bodies are lofted from side-profile and plan-width
 * curves, with wheel arches carved into the sills, a tumblehome glasshouse,
 * clear-coat paint with dust, and lights/plates/mirrors/trim.
 * Local frame: +X forward, +Y up, +Z = right side.
 */
export const CAR_TYPES = {
  sedan: { L: 4.7, W: 1.84, wb: 2.78, fo: 0.95, R: 0.335, sill: 0.3, nose: 0.66, hood: 0.9, belt: 0.96, trunk: 0.95, tail: 0.78, roof: 1.44, ws: 1.75, rf: 2.45, rr: 3.4, rw: 3.95, fuel: 'diesel|regular', w: 4 },
  hatch: { L: 4.15, W: 1.76, wb: 2.56, fo: 0.82, R: 0.32, sill: 0.3, nose: 0.66, hood: 0.88, belt: 0.95, trunk: 1.0, tail: 0.98, roof: 1.48, ws: 1.5, rf: 2.2, rr: 3.75, rw: 4.05, fuel: 'regular', w: 4 },
  suv: { L: 4.85, W: 1.94, wb: 2.88, fo: 0.95, R: 0.38, sill: 0.45, nose: 0.85, hood: 1.08, belt: 1.12, trunk: 1.2, tail: 1.12, roof: 1.8, ws: 1.75, rf: 2.45, rr: 4.45, rw: 4.75, fuel: 'regular|diesel', w: 3 },
  pickup: { L: 5.45, W: 1.98, wb: 3.35, fo: 0.95, R: 0.4, sill: 0.5, nose: 0.95, hood: 1.15, belt: 1.18, trunk: 1.15, tail: 1.12, roof: 1.88, ws: 1.9, rf: 2.45, rr: 3.15, rw: 3.3, fuel: 'diesel|regular', bed: true, w: 3 },
  muscle: { L: 4.85, W: 1.9, wb: 2.8, fo: 1.0, R: 0.35, sill: 0.28, nose: 0.62, hood: 0.86, belt: 0.88, trunk: 0.9, tail: 0.8, roof: 1.3, ws: 2.0, rf: 2.65, rr: 3.2, rw: 4.0, fuel: 'premium|regular', w: 2 },
  van: { L: 5.15, W: 1.98, wb: 3.2, fo: 0.85, R: 0.36, sill: 0.4, nose: 0.85, hood: 1.05, belt: 1.12, trunk: 1.12, tail: 1.1, roof: 2.15, ws: 1.1, rf: 1.75, rr: 5.05, rw: 5.12, fuel: 'diesel', w: 2 },
  wagon: { L: 5.05, W: 1.86, wb: 2.95, fo: 0.95, R: 0.34, sill: 0.3, nose: 0.68, hood: 0.88, belt: 0.95, trunk: 0.98, tail: 0.95, roof: 1.43, ws: 1.8, rf: 2.45, rr: 4.75, rw: 4.95, fuel: 'regular', w: 2 },
  sports: { L: 4.5, W: 1.95, wb: 2.65, fo: 1.05, R: 0.34, sill: 0.22, nose: 0.5, hood: 0.78, belt: 0.86, trunk: 0.88, tail: 0.86, roof: 1.18, ws: 1.85, rf: 2.45, rr: 2.95, rw: 4.05, fuel: 'premium', w: 1 },
};

const PAINTS = [0xf2f2f0, 0xc9cdd2, 0x8d9399, 0x2a2c30, 0x111214, 0x8f1a1a, 0xb3261e, 0x1f3f7a, 0x2c5d8a, 0x234d2e, 0x6b5b3e, 0xd8c7a2, 0xe0a21a, 0x5c2a5e, 0x2d6e6e, 0xe8e2d0, 0x7a3f1f];

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const treadNormal = new THREE.TextureLoader().load('./assets/tex/tread_n.jpg');
  treadNormal.wrapS = treadNormal.wrapT = THREE.RepeatWrapping; treadNormal.repeat.set(1, 8);
  SHARED = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0f13, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.82, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.8 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92, normalMap: treadNormal, normalScale: new THREE.Vector2(1, 1) }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.22 }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.9, roughness: 0.35 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.14 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.6 }),
    under: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 1 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.9 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, emissive: 0xfff6e0, emissiveIntensity: 0.0, metalness: 0.4, roughness: 0.08 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x5a0606, emissive: 0xff1a10, emissiveIntensity: 0.15, roughness: 0.2 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x5a0606, emissive: 0xff1a10, emissiveIntensity: 2.5, roughness: 0.2 }),
    indicator: new THREE.MeshStandardMaterial({ color: 0x7a4a06, emissive: 0xff9a10, emissiveIntensity: 0.1, roughness: 0.2 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x101112, metalness: 0.5, roughness: 0.5 }),
    fuelCapDark: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x7a3f1f, roughness: 0.95, metalness: 0.3 }),
  };
  SHARED.wheel = makeWheelGeos();
  return SHARED;
}

function makeWheelGeos() {
  // tyre: lathe profile around Y then rotate to X axis (wheel axle = Z)
  const prof = [];
  const R = 1, w = 0.62, ri = 0.62;
  prof.push(new THREE.Vector2(ri, -w / 2));
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; prof.push(new THREE.Vector2(R - 0.12 + Math.cos(a) * 0.12, Math.sin(a) * (w / 2))); }
  prof.push(new THREE.Vector2(ri, w / 2));
  const tire = new THREE.LatheGeometry(prof, 28);
  tire.rotateX(Math.PI / 2);
  // rim: dish + spokes
  const parts = [];
  const dish = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 24, 1, true); dish.rotateX(Math.PI / 2); parts.push(dish.toNonIndexed());
  const face = new THREE.CylinderGeometry(0.6, 0.6, 0.04, 24); face.rotateX(Math.PI / 2); face.translate(0, 0, 0.16);
  const hub = new THREE.CylinderGeometry(0.16, 0.18, 0.12, 12); hub.rotateX(Math.PI / 2); hub.translate(0, 0, 0.2); parts.push(hub.toNonIndexed());
  for (let i = 0; i < 5; i++) {
    const s = new THREE.BoxGeometry(0.12, 0.5, 0.06); s.translate(0, 0.33, 0.2); s.rotateZ((i / 5) * Math.PI * 2); parts.push(s.toNonIndexed());
  }
  const lip = new THREE.TorusGeometry(0.6, 0.03, 6, 24); lip.translate(0, 0, 0.21); parts.push(lip.toNonIndexed());
  const rim = mergeGeometries(parts);
  const back = new THREE.CircleGeometry(0.6, 20); back.translate(0, 0, -0.05);
  return { tire, rim, back, face };
}

// ---------------------------------------------------------------- body loft
function interp(pts, s) {
  if (s <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (s <= pts[i][0]) {
      const [s0, y0] = pts[i - 1], [s1, y1] = pts[i];
      const t = (s - s0) / (s1 - s0);
      const k = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * k;
    }
  }
  return pts[pts.length - 1][1];
}

function buildBodyGeometry(T) {
  const L = T.L, hw0 = T.W / 2;
  const wheels = [T.fo, T.fo + T.wb]; // distances from front
  const archR = T.R + 0.06;
  const wheelY = T.R;
  const beltPts = [[0, T.nose], [0.25, (T.nose + T.hood) / 2 + 0.03], [T.ws * 0.6, T.hood], [T.ws, T.belt], [T.rw, T.trunk], [L - 0.2, T.trunk - 0.02], [L, T.tail]];
  if (T.bed) { beltPts.splice(4); beltPts.push([T.rw, T.belt], [L - 0.05, T.belt], [L, T.belt - 0.05]); }
  const belt = (s) => interp(beltPts, s);
  const halfW = (s) => {
    const e = Math.min(s, L - s);
    const round = Math.sqrt(clamp(e / 0.55, 0, 1));
    return hw0 * (0.82 + 0.18 * round);
  };
  const bottom = (s) => {
    let y = T.sill;
    const ends = Math.min(s, L - s);
    y += (1 - smoothstep(0, 0.6, ends)) * 0.12;
    for (const wx of wheels) {
      const d = s - wx;
      if (Math.abs(d) < archR) y = Math.max(y, wheelY + Math.sqrt(archR * archR - d * d) * 1.0);
    }
    return y;
  };
  // stations along length (dense near arches)
  const S = [];
  const N = 56;
  for (let i = 0; i <= N; i++) S.push((i / N) * L);
  for (const wx of wheels) for (let k = -6; k <= 6; k++) S.push(wx + (k / 6) * archR);
  S.sort((a, b) => a - b);
  const stations = S.filter((s, i) => i === 0 || s - S[i - 1] > 0.01);
  // ring: from bottom-right, up right side, over top, down left side, along bottom
  const ring = (s) => {
    const hw = halfW(s), yb = bottom(s), yt = belt(s);
    const h = Math.max(0.05, yt - yb);
    const rt = Math.min(0.16, h * 0.4), rb = Math.min(0.08, h * 0.3);
    const pts = [];
    const tuck = 0.04;
    // right side bottom corner
    for (let i = 0; i <= 3; i++) { const a = -Math.PI / 2 + (i / 3) * (Math.PI / 2); pts.push([hw - tuck - rb + Math.cos(a) * rb + tuck * (i / 3), yb + rb + Math.sin(a) * rb]); }
    // right side mid (slight bulge)
    pts.push([hw + 0.015, yb + h * 0.45]);
    // right top corner
    for (let i = 0; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); pts.push([hw - rt + Math.cos(a) * rt, yt - rt + Math.sin(a) * rt]); }
    // left top corner
    for (let i = 0; i <= 4; i++) { const a = Math.PI / 2 + (i / 4) * (Math.PI / 2); pts.push([-hw + rt + Math.cos(a) * rt, yt - rt + Math.sin(a) * rt]); }
    pts.push([-hw - 0.015, yb + h * 0.45]);
    for (let i = 0; i <= 3; i++) { const a = Math.PI + (i / 3) * (Math.PI / 2); pts.push([-hw + tuck + rb + Math.cos(a) * rb - tuck * (1 - i / 3), yb + rb + Math.sin(a) * rb]); }
    return pts;
  };
  const R0 = ring(0).length;
  const pos = [], col = [], idx = [];
  for (const s of stations) {
    const r = ring(s);
    const x = L / 2 - s;
    for (const [z, y] of r) {
      pos.push(x, y, z);
      const dirt = 1 - smoothstep(0.15, 0.75, y);
      col.push(1 - dirt * 0.28, 1 - dirt * 0.34, 1 - dirt * 0.42);
    }
  }
  const ns = stations.length;
  for (let i = 0; i < ns - 1; i++) {
    for (let j = 0; j < R0; j++) {
      const a = i * R0 + j, b = i * R0 + ((j + 1) % R0), c = (i + 1) * R0 + j, d = (i + 1) * R0 + ((j + 1) % R0);
      idx.push(a, b, c, b, d, c);
    }
  }
  // end caps (fan)
  for (const [i, flip] of [[0, false], [ns - 1, true]]) {
    const r = ring(stations[i]);
    let cy = 0; r.forEach(([, y]) => { cy += y; }); cy /= r.length;
    const ci = pos.length / 3;
    pos.push(L / 2 - stations[i], cy, 0); col.push(1, 1, 1);
    for (let j = 0; j < R0; j++) {
      const a = i * R0 + j, b = i * R0 + ((j + 1) % R0);
      if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, belt, halfW, bottom, wheels };
}

function buildCabinGeometry(T, belt, halfW) {
  const s0 = T.ws, s3 = T.rw, s1 = T.rf, s2 = T.rr;
  const roofY = (s) => {
    if (s <= s1) return belt(s0) + (T.roof - belt(s0)) * smoothstep(s0, s1, s) ** 0.85;
    if (s >= s2) return belt(s3) + (T.roof - belt(s3)) * (1 - smoothstep(s2, s3, s)) ** 0.9;
    return T.roof + Math.sin(((s - s1) / (s2 - s1)) * Math.PI) * 0.015;
  };
  const N = 30;
  const st = []; for (let i = 0; i <= N; i++) st.push(s0 + (i / N) * (s3 - s0));
  const pos = [], paintIdx = [], glassIdx = [];
  const ringN = 12;
  for (const s of st) {
    const yb = belt(s) - 0.01, yt = Math.max(yb + 0.005, roofY(s));
    const hwB = halfW(s) - 0.05, hwT = halfW(s) * 0.74;
    const x = T.L / 2 - s;
    const pts = [];
    // right belt -> right roof edge (side window), corner, across roof, corner, left side down to belt
    const ye = yt - Math.min(0.1, (yt - yb) * 0.3);
    for (let i = 0; i <= 3; i++) { const t = i / 3; pts.push([hwB + (hwT - hwB) * t, yb + (ye - yb) * t]); }      // 0..3
    for (let i = 0; i <= 4; i++) { const t = i / 4; pts.push([hwT - 0.07 - (2 * hwT - 0.14) * t, yt + Math.sin(t * Math.PI) * 0.025]); } // 4..8
    for (let i = 0; i <= 3; i++) { const t = i / 3; pts.push([-hwT - (hwB - hwT) * t, ye + (yb - ye) * t]); }    // 9..12
    for (const [z, y] of pts) pos.push(x, y, z);
  }
  const R0 = 13;
  const bS = (s1 + s2) / 2;
  const van = T.ws < 1.3;
  for (let i = 0; i < st.length - 1; i++) {
    const sm = (st[i] + st[i + 1]) / 2;
    for (let j = 0; j < R0 - 1; j++) {
      const a = i * R0 + j, b = i * R0 + j + 1, c = (i + 1) * R0 + j, d = (i + 1) * R0 + j + 1;
      const corner = j === 3 || j === 8;
      const top = j >= 4 && j <= 7;
      let paint;
      if (corner) paint = true;
      else if (top) paint = sm > s1 + 0.02 && sm < s2 - 0.02;
      else {
        paint = Math.abs(sm - bS) < 0.07 || i === 0 || i === st.length - 2 || j === 0 || j === 11;
        if (van && sm > T.rf + 1.3) paint = true; // panel van: solid sides at the back
      }
      (paint ? paintIdx : glassIdx).push(a, b, c, b, d, c);
    }
  }
  // front & rear caps of the van-like boxes are open: fine (covered by body)
  const mk = (index) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };
  return { paint: mk(paintIdx), glass: mk(glassIdx), roofY };
}

const templateCache = new Map();
function getTemplate(type) {
  if (templateCache.has(type)) return templateCache.get(type);
  const T = CAR_TYPES[type];
  const body = buildBodyGeometry(T);
  const cabin = buildCabinGeometry(T, body.belt, body.halfW);
  const tpl = { T, body, cabin };
  templateCache.set(type, tpl);
  return tpl;
}

function plateTexture() {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const txt = `${pick(letters)}${pick(letters)}${pick(letters)}-${Math.floor(rand(100, 999))}`;
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1b3a6b'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#b5452e'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.fillText('DESERT STATE', w / 2, 30);
    ctx.fillStyle = '#1b3a6b'; ctx.font = 'bold 62px "Courier New", monospace'; ctx.fillText(txt, w / 2, 96);
  });
}

/**
 * Create a car instance.
 * returns { group, wheels:[{pivot, spin, front}], dims, fuelCap:{local, side}, lights, paint, type, ... }
 */
export function buildCar(type = 'sedan', opts = {}) {
  const S = shared();
  const { T, body, cabin } = getTemplate(type);
  const color = opts.color ?? pick(PAINTS);
  const metallic = chance(0.55);
  const old = opts.old ?? chance(0.18);
  const paint = new THREE.MeshPhysicalMaterial({
    color, vertexColors: true, metalness: metallic ? 0.55 : 0.08, roughness: old ? 0.55 : (metallic ? 0.32 : 0.25),
    clearcoat: old ? 0.15 : 1, clearcoatRoughness: old ? 0.4 : 0.09, envMapIntensity: 1.25,
  });
  const g = new THREE.Group();
  const bodyMesh = new THREE.Mesh(body.geo, paint); bodyMesh.castShadow = true; bodyMesh.receiveShadow = true; g.add(bodyMesh);
  const cabPaint = new THREE.Mesh(cabin.paint, paint); cabPaint.castShadow = true; g.add(cabPaint);
  const glass = new THREE.Mesh(cabin.glass, S.glass); glass.castShadow = true; glass.renderOrder = 1; g.add(glass);
  const L = T.L, W = T.W;
  const front = L / 2, rear = -L / 2;
  const add = (geo, mat, x, y, z, { cast = true, rx = 0, ry = 0, rz = 0 } = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = cast; g.add(m); return m;
  };
  // undercarriage (hides see-through under arches)
  add(new THREE.BoxGeometry(L - 0.5, Math.max(0.1, T.sill - 0.1), W - 0.5), S.under, 0, 0.12 + (T.sill - 0.1) / 2, 0, { cast: false });
  // interior: seats & dash (visible through glass)
  const beltF = body.belt(T.ws + 0.4);
  add(new THREE.BoxGeometry(0.4, 0.15, W - 0.35), S.interior, front - T.ws - 0.3, beltF - 0.05, 0, { cast: false });
  for (const zz of [-0.4, 0.4]) {
    add(new THREE.BoxGeometry(0.5, 0.55, 0.48), S.interior, front - T.ws - 1.05, body.bottom(T.ws + 1) + 0.25, zz * (W / 1.84), { cast: false });
  }
  // steering wheel (driver = left = -Z)
  const sw = add(new THREE.TorusGeometry(0.18, 0.025, 6, 16), S.plastic, front - T.ws - 0.55, beltF + 0.08, -0.38 * (W / 1.84), { ry: Math.PI / 2, rx: 0.4, cast: false });
  void sw;
  // bumpers
  const bumpY = T.sill + 0.12;
  const bumperMat = old ? S.chrome : (chance(0.5) ? S.plastic : paint);
  add(new THREE.BoxGeometry(0.22, 0.18, W - 0.16), bumperMat, front - 0.1, bumpY, 0);
  add(new THREE.BoxGeometry(0.22, 0.18, W - 0.16), bumperMat, rear + 0.1, bumpY, 0);
  // grille
  const noseY = T.nose;
  add(new THREE.BoxGeometry(0.06, Math.max(0.1, noseY - bumpY - 0.12), W * 0.5), S.grille, front + 0.01, (noseY + bumpY) / 2 + 0.02, 0, { cast: false });
  // headlights / taillights
  const hl = [], tl = [];
  for (const side of [-1, 1]) {
    const h = add(new THREE.BoxGeometry(0.08, 0.13, 0.36), S.headlight.clone(), front - 0.04, noseY - 0.1, side * (W / 2 - 0.3), { cast: false });
    hl.push(h);
    const t = add(new THREE.BoxGeometry(0.06, 0.12, 0.38), S.taillight.clone(), rear + 0.02, T.tail - 0.14, side * (W / 2 - 0.28), { cast: false });
    tl.push(t);
  }
  // plates
  const plate = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.4, metalness: 0.2 });
  add(new THREE.PlaneGeometry(0.52, 0.12), plate, rear - 0.1, bumpY + 0.16, 0, { ry: -Math.PI / 2, cast: false });
  add(new THREE.PlaneGeometry(0.52, 0.12), plate, front + 0.13, bumpY, 0, { ry: Math.PI / 2, cast: false });
  // mirrors
  const mirY = body.belt(T.ws) + 0.08;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.16, 0.12, 0.1), paint, front - T.ws - 0.1, mirY, side * (body.halfW(T.ws) + 0.08));
    add(new THREE.BoxGeometry(0.04, 0.03, 0.12), S.plastic, front - T.ws - 0.05, mirY - 0.05, side * (body.halfW(T.ws) + 0.0), { cast: false });
  }
  // door seams & handles
  const seamMat = S.under;
  const doorXs = T.ws < 1.3 ? [front - T.rf - 0.1] : [front - T.ws - 0.05, front - (T.rf + T.rr) / 2, front - T.rr + (type === 'pickup' ? 0.0 : 0.15)];
  for (const side of [-1, 1]) {
    for (const dx of doorXs) {
      const s = front - dx;
      const yb = body.bottom(s), yt = body.belt(s);
      add(new THREE.BoxGeometry(0.012, Math.max(0.05, yt - yb - 0.12), 0.01), seamMat, dx, (yb + yt) / 2, side * (body.halfW(s) + 0.012), { cast: false });
    }
    for (let k = 0; k < doorXs.length - 1; k++) {
      const hx = doorXs[k] - 0.25;
      const s = front - hx;
      add(new THREE.BoxGeometry(0.14, 0.03, 0.03), S.chrome, hx - 0.05, body.belt(s) - 0.13, side * (body.halfW(s) + 0.02), { cast: false });
    }
  }
  // pickup bed
  if (T.bed) {
    const bedS0 = T.rw + 0.05, bedLen = L - bedS0 - 0.05;
    const bx = front - bedS0 - bedLen / 2;
    const floorY = T.sill + 0.25;
    add(new THREE.BoxGeometry(bedLen, 0.04, W - 0.2), S.plastic, bx, floorY, 0, { cast: false });
    // body there is filled to belt; place a dark liner on top to suggest the bed
    add(new THREE.BoxGeometry(bedLen - 0.1, 0.02, W - 0.3), S.under, bx, T.belt + 0.001, 0, { cast: false });
  }
  // exhaust
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), S.chrome, rear - 0.02, 0.25, W / 2 - 0.45, { rz: Math.PI / 2, cast: false });
  // roof rack for suv / wagon
  if ((type === 'suv' || type === 'wagon') && chance(0.5)) {
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(L * 0.45, 0.04, 0.04), S.plastic, front - (T.rf + T.rr) / 2, T.roof + 0.06, side * (W * 0.32));
  }
  // wheels
  const wheels = [];
  for (const [i, s] of body.wheels.entries()) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(L / 2 - s, T.R, side * (W / 2 - 0.2));
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(S.wheel.tire, S.tire); tire.scale.set(T.R, T.R, T.R * 0.62); tire.castShadow = true;
      const rim = new THREE.Mesh(S.wheel.rim, chance(0.3) ? S.rimDark : S.rim); rim.scale.set(T.R, T.R, T.R * 0.62);
      const back = new THREE.Mesh(S.wheel.back, S.under); back.scale.setScalar(T.R);
      spin.add(tire, rim, back);
      if (side < 0) spin.rotation.y = Math.PI; // rim faces outward
      pivot.add(spin);
      g.add(pivot);
      wheels.push({ pivot, spin, front: i === 0, side });
    }
  }
  // fuel door on rear quarter (right side by default; 40% left)
  const fuelSide = opts.fuelSide ?? (chance(0.6) ? 1 : -1);
  const fs = T.fo + T.wb - (T.bed ? 0.85 : 0.55) - T.R * 0.2;
  const fuelY = clamp(body.belt(fs) - 0.18, body.bottom(fs) + 0.25, 2);
  const fuelLocal = new THREE.Vector3(L / 2 - fs - 0.25, fuelY, fuelSide * (body.halfW(fs + 0.25) + 0.012));
  const fuelDoor = new THREE.Group();
  fuelDoor.position.copy(fuelLocal);
  const fdoor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.012), paint); fdoor.position.x = -0.085; fdoor.castShadow = false;
  fuelDoor.add(fdoor);
  const fhole = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), S.fuelCapDark); fhole.position.set(fuelLocal.x, fuelLocal.y, fuelLocal.z - fuelSide * 0.004); fhole.rotation.y = fuelSide > 0 ? 0 : Math.PI;
  g.add(fhole);
  fuelDoor.position.x += 0.085;
  if (fuelSide < 0) fuelDoor.rotation.y = Math.PI;
  g.add(fuelDoor);

  // fuel type preference
  const fuels = T.fuel.split('|');
  const fuelType = opts.fuelType ?? (chance(0.8) ? fuels[0] : pick(fuels));

  // headlight beam glow planes (visible at night)
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), beamMaterial());
  beam.rotation.x = -Math.PI / 2; beam.position.set(front + 4.6, 0.03, 0);
  beam.visible = false; g.add(beam);

  // rust/old car styling
  if (old) { paint.color.lerp(new THREE.Color(0x8a7a66), 0.25); }

  mergeStaticParts(g, new Set([...hl, ...tl, beam, fhole]));
  return {
    group: g, type, T, wheels, paint, body: bodyMesh,
    dims: { L, W, H: T.roof },
    fuelCap: { local: fuelLocal, side: fuelSide, door: fuelDoor },
    fuelType, tank: T.L > 5 ? 90 : type === 'hatch' ? 45 : type === 'sports' ? 60 : 60,
    lights: { head: hl, tail: tl, beam },
    driverLocal: new THREE.Vector3(front - T.ws - 1.05, body.bottom(T.ws + 1) - 0.42, -0.4 * (W / 1.84)),
    doorLocal: new THREE.Vector3(front - T.ws - 1.05, 0, -(W / 2 + 0.55)),
    big: T.L > 5,
  };
}

/** Merge a vehicle's static child meshes per material to cut draw calls. */
function mergeStaticParts(g, keep) {
  const groups = new Map();
  for (const m of [...g.children]) {
    if (!m.isMesh || keep.has(m) || Array.isArray(m.material)) continue;
    const k = m.material.uuid;
    if (!groups.has(k)) groups.set(k, { mat: m.material, items: [] });
    groups.get(k).items.push(m);
  }
  for (const { mat, items } of groups.values()) {
    if (items.length < 2) continue;
    const geos = [];
    for (const m of items) {
      m.updateMatrix();
      let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      geo.applyMatrix4(m.matrix);
      for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) geo.deleteAttribute(a);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      if (mat.vertexColors && !geo.attributes.color) geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
      if (!mat.vertexColors && geo.attributes.color) geo.deleteAttribute('color');
      geos.push(geo);
      g.remove(m);
    }
    const merged = mergeGeometries(geos, false);
    if (!merged) { items.forEach((m) => g.add(m)); continue; }
    const mm = new THREE.Mesh(merged, mat);
    mm.castShadow = items.some((m) => m.castShadow); mm.receiveShadow = true;
    mm.renderOrder = items[0].renderOrder;
    g.add(mm);
  }
}

let beamMat = null;
function beamMaterial() {
  if (beamMat) return beamMat;
  const tex = canvasTexture(256, 128, (ctx, w, h) => {
    for (const cy of [h * 0.3, h * 0.7]) {
      const g = ctx.createRadialGradient(0, cy, 2, 0, cy, w);
      g.addColorStop(0, 'rgba(255,240,210,0.55)'); g.addColorStop(0.5, 'rgba(255,230,190,0.18)'); g.addColorStop(1, 'rgba(255,230,190,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, cy - 6); ctx.lineTo(w, cy - h * 0.38); ctx.lineTo(w, cy + h * 0.38); ctx.lineTo(0, cy + 6); ctx.fill();
    }
  });
  beamMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4 });
  return beamMat;
}

/** Big rigs: delivery box truck & fuel tanker (cab + body). */
export function buildTruck(kind = 'box', opts = {}) {
  const S = shared();
  const g = new THREE.Group();
  const cabColor = opts.color ?? (kind === 'tanker' ? 0xe8e8e4 : 0xb3261e);
  const paint = new THREE.MeshPhysicalMaterial({ color: cabColor, metalness: 0.3, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.05 });
  const add = (geo, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };
  const L = kind === 'tanker' ? 9.5 : 7.2, W = 2.4;
  const front = L / 2;
  // cab
  add(new THREE.BoxGeometry(2.0, 1.6, W), paint, front - 1.0, 1.75, 0);
  add(new THREE.BoxGeometry(1.0, 0.7, W - 0.05), paint, front - 0.5 + 0.05, 1.2, 0);
  const ws = add(new THREE.BoxGeometry(0.05, 0.75, W - 0.25), S.glass, front - 0.02, 2.1, 0, false);
  ws.rotation.z = 0.12;
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(1.0, 0.6, 0.05), S.glass, front - 1.0, 2.15, side * (W / 2 + 0.005), false);
  add(new THREE.BoxGeometry(0.1, 0.5, W - 0.3), S.grille, front + 0.03, 1.15, 0, false);
  add(new THREE.BoxGeometry(0.25, 0.25, W), S.chrome, front + 0.05, 0.7, 0);
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.08, 0.16, 0.4), S.headlight, front + 0.01, 1.0, side * (W / 2 - 0.35), false);
    add(new THREE.BoxGeometry(0.2, 0.35, 0.1), S.plastic, front - 0.3, 2.2, side * (W / 2 + 0.25));
  }
  // chassis
  add(new THREE.BoxGeometry(L - 0.4, 0.3, W - 0.6), S.under, 0, 0.7, 0);
  const bodyLen = L - 2.3;
  const bx = front - 2.2 - bodyLen / 2;
  if (kind === 'tanker') {
    const tank = add(new THREE.CylinderGeometry(1.1, 1.1, bodyLen, 28, 1), new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 0.9, roughness: 0.22 }), bx, 2.05, 0);
    tank.rotation.z = Math.PI / 2;
    const stripeTex = canvasTexture(1024, 128, (ctx, w, h) => { ctx.fillStyle = '#dfe3e6'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#b5452e'; ctx.fillRect(0, 30, w, 70); ctx.fillStyle = '#fff'; ctx.font = 'bold 56px Impact'; ctx.textAlign = 'center'; ctx.fillText('DUSTBOWL FUEL CO.  •  FLAMMABLE', w / 2, 84); });
    const band = add(new THREE.CylinderGeometry(1.115, 1.115, bodyLen * 0.8, 28, 1, true), new THREE.MeshStandardMaterial({ map: stripeTex, metalness: 0.4, roughness: 0.3 }), bx, 2.05, 0, false);
    band.rotation.z = Math.PI / 2;
    for (const ex of [-bodyLen / 2, bodyLen / 2]) { const cap = add(new THREE.SphereGeometry(1.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 0.9, roughness: 0.25 }), bx + ex, 2.05, 0); cap.scale.set(0.3, 1, 1); cap.rotation.z = ex > 0 ? -Math.PI / 2 : Math.PI / 2; }
  } else {
    const boxTex = canvasTexture(1024, 256, (ctx, w, h) => {
      ctx.fillStyle = '#f2efe8'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2f6f73'; ctx.fillRect(0, h - 50, w, 50);
      ctx.fillStyle = '#c22a1f'; ctx.font = 'bold 110px Impact'; ctx.textAlign = 'center'; ctx.fillText('ROADRUNNER', w / 2, 120);
      ctx.fillStyle = '#222'; ctx.font = 'bold 48px Arial'; ctx.fillText('WHOLESALE DELIVERIES', w / 2, 180);
    });
    const side = new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.6 });
    const plain = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6 });
    add(new THREE.BoxGeometry(bodyLen, 2.5, W), [plain, plain, plain, plain, side, side], bx, 2.15, 0);
  }
  const wheels = [];
  const R = 0.5;
  for (const wx of [front - 1.2, bx - bodyLen / 2 + 1.2, bx - bodyLen / 2 + 2.4]) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(wx, R, side * (W / 2 - 0.25));
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(S.wheel.tire, S.tire); tire.scale.set(R, R, R * 0.6); tire.castShadow = true;
      const rim = new THREE.Mesh(S.wheel.rim, S.rim); rim.scale.set(R, R, R * 0.6);
      spin.add(tire, rim); if (side < 0) spin.rotation.y = Math.PI;
      pivot.add(spin); g.add(pivot);
      wheels.push({ pivot, spin, front: wx === front - 1.2, side });
    }
  }
  const tl = [];
  for (const side of [-1, 1]) tl.push(add(new THREE.BoxGeometry(0.05, 0.15, 0.3), S.taillight.clone(), -L / 2 - 0.0, 0.9, side * (W / 2 - 0.3), false));
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), beamMaterial()); beam.rotation.x = -Math.PI / 2; beam.position.set(front + 5, 0.03, 0); beam.visible = false; g.add(beam);
  return { group: g, type: kind === 'tanker' ? 'tanker' : 'boxtruck', wheels, paint, dims: { L, W, H: 3.4 }, lights: { head: [], tail: tl, beam }, big: true, T: { R, L, W } };
}

/** Rusty abandoned car shell for scenery. */
export function buildWreck() {
  const car = buildCar('wagon', { color: 0x7a5a3a, old: true });
  car.paint.roughness = 0.95; car.paint.metalness = 0.2; car.paint.clearcoat = 0;
  car.group.rotation.z = 0.06;
  car.wheels.forEach((w, i) => { if (i % 2) w.pivot.visible = false; });
  return car;
}
