import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, seeded, smoothstep, clamp } from '../core/utils.js';
import { canvasTexture, grime } from '../gfx/textures.js';
import { planeGeo, boxGeo } from '../gfx/materials.js';

export const ROAD_Z = -42;      // highway centreline
export const ROAD_HALF = 5;     // asphalt half width
export const LOT = { minX: -42, maxX: 42, minZ: -37, maxZ: 16 };

/** Desert terrain, highway, mesas, vegetation and roadside dressing. */
export function buildTerrain(scene, M, colliders) {
  const noise = makeNoise2D(7);
  const rng = seeded(99);

  // ---------------------------------------------------------------- height function
  const flatMask = (x, z) => {
    // 0 inside the station + road corridor, ramps to 1 outside
    const dLot = Math.max(LOT.minX - 18 - x, x - LOT.maxX - 18, LOT.minZ - z, z - LOT.maxZ - 20, 0);
    const dRoad = Math.max(Math.abs(z - ROAD_Z) - ROAD_HALF - 6, 0);
    return smoothstep(0, 40, Math.min(dLot, dRoad));
  };
  const height = (x, z) => {
    const m = flatMask(x, z);
    if (m <= 0) return -0.02;
    const dunes = noise.fbm(x * 0.006, z * 0.006, 4) * 14 + noise.fbm(x * 0.03 + 5, z * 0.03, 3) * 2.5;
    const far = smoothstep(150, 700, Math.hypot(x, z)) * (noise.fbm(x * 0.002 + 9, z * 0.002, 3) * 55);
    return (dunes - 4) * m + far * m - 0.02;
  };
  colliders.terrainHeight = height;

  // ---------------------------------------------------------------- ground mesh (radial density)
  const ground = new THREE.PlaneGeometry(3000, 3000, 220, 220);
  ground.rotateX(-Math.PI / 2);
  const pos = ground.attributes.position, uv = ground.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    // squash vertices toward the centre for more detail near the station
    const r = Math.hypot(x, z), rr = r / 1500;
    const k = rr > 0 ? (Math.pow(rr, 1.8) * 1500) / r : 0;
    x *= k; z *= k;
    pos.setXYZ(i, x, height(x, z), z);
    uv.setXY(i, x / 9, z / 9);
  }
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(ground, M.sand);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ---------------------------------------------------------------- highway
  const roadLen = 2600;
  const road = new THREE.Mesh(planeGeo(roadLen, ROAD_HALF * 2, 7), M.road);
  road.position.set(0, 0.0, ROAD_Z);
  road.receiveShadow = true;
  scene.add(road);
  // gravel shoulders
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(planeGeo(roadLen, 3, 6), M.dirt);
    sh.position.set(0, -0.01, ROAD_Z + side * (ROAD_HALF + 1.4));
    sh.receiveShadow = true;
    if (side < 0) scene.add(sh);
  }
  // lane markings
  const dashGeo = planeGeo(3, 0.14, 0);
  const dashes = new THREE.InstancedMesh(dashGeo, M.paintYellow, 300);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 300; i++) { m4.makeTranslation(-1300 + i * 9, 0.012, ROAD_Z); dashes.setMatrixAt(i, m4); }
  dashes.receiveShadow = true;
  scene.add(dashes);
  for (const z of [ROAD_Z - ROAD_HALF + 0.35, ROAD_Z + ROAD_HALF - 0.35]) {
    const l = new THREE.Mesh(planeGeo(roadLen, 0.15, 0), M.paintLine);
    l.position.set(0, 0.012, z); l.receiveShadow = true; scene.add(l);
  }

  // ---------------------------------------------------------------- mesas on the horizon
  const mesaGeos = [];
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2 + rng() * 0.3;
    const dist = 650 + rng() * 650;
    const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
    if (Math.abs(cz - ROAD_Z) < 120) continue; // keep road corridor open
    const radius = 60 + rng() * 140, h = 40 + rng() * 110;
    const g = new THREE.CylinderGeometry(radius * 0.8, radius * 1.25, h, 28, 8, false);
    const p = g.attributes.position;
    const seed = rng() * 100;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
      const a = Math.atan2(z, x);
      const yn = (y + h / 2) / h;
      const ring = 1 + (noise(a * 3 + seed, yn * 4) - 0.5) * 0.35 + (noise(a * 9 + seed, yn * 10) - 0.5) * 0.12;
      const terrace = Math.floor(yn * 5) / 5;
      const r2 = ring * (1 + (1 - terrace) * 0.15);
      p.setXYZ(v, x * r2, y + (noise(x * 0.05 + seed, z * 0.05) - 0.5) * (yn > 0.98 ? 4 : 0), z * r2);
    }
    g.translate(cx, h / 2 - 8, cz);
    // UVs: wrap around for strata
    const uvA = g.attributes.uv;
    for (let v = 0; v < uvA.count; v++) uvA.setXY(v, uvA.getX(v) * radius * 0.08, (p.getY(v) + 8) / 30);
    mesaGeos.push(g.toNonIndexed());
  }
  const mesas = new THREE.Mesh(mergeGeometries(mesaGeos.map((g) => { g.computeVertexNormals(); return g; })), M.mesa);
  mesas.receiveShadow = false;
  scene.add(mesas);

  // ---------------------------------------------------------------- cacti (instanced)
  const saguaro = makeSaguaroGeo();
  const cactusCount = 160;
  const cacti = new THREE.InstancedMesh(saguaro, M.cactus, cactusCount);
  let placed = 0;
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
  for (let tries = 0; tries < 2000 && placed < cactusCount; tries++) {
    const x = (rng() - 0.5) * 900, z = (rng() - 0.5) * 900;
    if (flatMask(x, z) < 0.6 && !(Math.abs(z - ROAD_Z) > 14 && (x < LOT.minX - 10 || x > LOT.maxX + 10 || z > LOT.maxZ + 14))) continue;
    if (Math.abs(z - ROAD_Z) < 10) continue;
    if (x > LOT.minX - 6 && x < LOT.maxX + 6 && z > LOT.minZ - 4 && z < LOT.maxZ + 6) continue;
    const s = 0.7 + rng() * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    pp.set(x, height(x, z) - 0.2, z); sc.set(s, s * (0.8 + rng() * 0.5), s);
    cacti.setMatrixAt(placed++, m4.compose(pp, q, sc));
  }
  cacti.count = placed;
  cacti.castShadow = true; cacti.receiveShadow = true;
  scene.add(cacti);

  // ---------------------------------------------------------------- rocks & bushes
  const rockGeo = new THREE.IcosahedronGeometry(1, 2);
  const rp = rockGeo.attributes.position;
  for (let v = 0; v < rp.count; v++) {
    const x = rp.getX(v), y = rp.getY(v), z = rp.getZ(v);
    const n = 1 + (noise(x * 2 + 3, z * 2 + y) - 0.5) * 0.6;
    rp.setXYZ(v, x * n, y * n * 0.6, z * n);
  }
  rockGeo.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rockGeo, M.rock, 260);
  placed = 0;
  for (let tries = 0; tries < 3000 && placed < 260; tries++) {
    const x = (rng() - 0.5) * 700, z = (rng() - 0.5) * 700;
    if (Math.abs(z - ROAD_Z) < 9) continue;
    if (x > LOT.minX - 2 && x < LOT.maxX + 2 && z > LOT.minZ - 2 && z < LOT.maxZ + 2) continue;
    const s = rng() < 0.9 ? 0.15 + rng() * 0.5 : 1 + rng() * 2.5;
    q.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * 6.28, rng() * 0.4));
    pp.set(x, height(x, z) - s * 0.2, z); sc.set(s * (0.8 + rng() * 0.6), s, s * (0.8 + rng() * 0.6));
    rocks.setMatrixAt(placed++, m4.compose(pp, q, sc));
  }
  rocks.count = placed; rocks.castShadow = true; rocks.receiveShadow = true;
  scene.add(rocks);

  const bushGeo = makeBushGeo(rng);
  const bushes = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ color: 0x7d7448, roughness: 1, side: THREE.DoubleSide }), 400);
  placed = 0;
  for (let tries = 0; tries < 4000 && placed < 400; tries++) {
    const x = (rng() - 0.5) * 500, z = (rng() - 0.5) * 500;
    if (Math.abs(z - ROAD_Z) < 7.5) continue;
    if (x > LOT.minX - 1 && x < LOT.maxX + 1 && z > LOT.minZ - 1 && z < LOT.maxZ + 1) continue;
    const s = 0.35 + rng() * 0.6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    pp.set(x, height(x, z), z); sc.set(s, s * (0.7 + rng() * 0.5), s);
    bushes.setMatrixAt(placed++, m4.compose(pp, q, sc));
  }
  bushes.count = placed; bushes.castShadow = true; bushes.receiveShadow = true;
  scene.add(bushes);

  // ---------------------------------------------------------------- power line along the road
  const poleGeos = [], wireGeos = [];
  const poleZ = ROAD_Z - ROAD_HALF - 6;
  const poles = [];
  for (let x = -640; x <= 640; x += 42) {
    const lean = (rng() - 0.5) * 0.05;
    const pole = new THREE.CylinderGeometry(0.13, 0.17, 10, 8);
    pole.translate(0, 5, 0);
    const arm = new THREE.BoxGeometry(0.14, 0.14, 2.6); arm.translate(0, 9.2, 0);
    const insul = [-1.1, 0, 1.1].map((o) => { const g = new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6); g.translate(0, 9.4, o); return g; });
    const g = mergeGeometries([pole, arm, ...insul].map((x) => x.toNonIndexed()));
    g.rotateZ(lean);
    g.translate(x, height(x, poleZ) - 0.2, poleZ);
    poleGeos.push(g);
    poles.push(new THREE.Vector3(x, height(x, poleZ) + 9.45, poleZ));
  }
  for (let i = 0; i < poles.length - 1; i++) {
    for (const off of [-1.1, 0, 1.1]) {
      const a = poles[i].clone().add(new THREE.Vector3(0, 0, off)), b = poles[i + 1].clone().add(new THREE.Vector3(0, 0, off));
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 1.1;
        pts.push(p);
      }
      wireGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.018, 3, false).toNonIndexed());
    }
  }
  const poleMat = new THREE.MeshStandardMaterial({ map: canvasTexture(64, 256, (ctx, w, h) => { ctx.fillStyle = '#5c4632'; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '30,20,10' : '120,100,80'},0.25)`; ctx.fillRect(Math.random() * w, Math.random() * h, 1, 10 + Math.random() * 30); } }), roughness: 0.95 });
  const polesMesh = new THREE.Mesh(mergeGeometries(poleGeos), poleMat);
  polesMesh.castShadow = true; scene.add(polesMesh);
  const wires = new THREE.Mesh(mergeGeometries(wireGeos), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }));
  scene.add(wires);

  // ---------------------------------------------------------------- billboards & road signs
  addBillboard(scene, M, -170, ROAD_Z + ROAD_HALF + 14, Math.PI + 0.15, height, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1d3557'); g.addColorStop(1, '#0b1a2e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffb52e'; ctx.font = 'bold 120px Impact, Arial Black'; ctx.textAlign = 'center';
    ctx.fillText('LAST CHANCE GAS', w / 2, 150, w - 60);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 64px Impact, Arial Black';
    ctx.fillText('NEXT 140 MILES: NOTHING. SERIOUSLY.', w / 2, 250, w - 60);
    ctx.fillStyle = '#ff5a36'; ctx.font = 'bold 80px Impact'; ctx.fillText('EXIT NOW ➜', w / 2, 360);
    grime(ctx, w, h, 0.25, '60,40,20');
  });
  addBillboard(scene, M, 210, ROAD_Z - ROAD_HALF - 16, -0.1, height, (ctx, w, h) => {
    ctx.fillStyle = '#f2e6c9'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b5452e'; ctx.font = 'bold 96px Impact, Arial Black'; ctx.textAlign = 'center';
    ctx.fillText('HOT COFFEE • COLD DRINKS', w / 2, 140, w - 60);
    ctx.fillStyle = '#222'; ctx.font = 'bold 72px Impact';
    ctx.fillText('CLEAN* RESTROOMS', w / 2, 250);
    ctx.font = 'italic 40px Arial'; ctx.fillText('*mostly', w / 2 + 330, 250);
    ctx.fillStyle = '#2f6f73'; ctx.font = 'bold 70px Impact'; ctx.fillText('LAST CHANCE GAS  ⛽  1 MILE', w / 2, 360, w - 60);
    grime(ctx, w, h, 0.3, '80,50,20');
  });
  // speed limit sign
  const signTex = canvasTexture(128, 160, (ctx, w, h) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#111'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.font = 'bold 22px Arial'; ctx.fillText('SPEED', w / 2, 40); ctx.fillText('LIMIT', w / 2, 64);
    ctx.font = 'bold 72px Arial'; ctx.fillText('65', w / 2, 136);
  });
  for (const [x, z, r] of [[-90, ROAD_Z + ROAD_HALF + 2.5, 0], [110, ROAD_Z - ROAD_HALF - 2.5, Math.PI]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), M.steel); post.position.set(x, 1.3, z); scene.add(post);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.95), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6, side: THREE.DoubleSide }));
    s.position.set(x, 2.3, z + (r ? 0.03 : -0.03)); s.rotation.y = r + Math.PI; s.castShadow = true; scene.add(s);
  }

  return { height, flatMask, ground: groundMesh };
}

function addBillboard(scene, M, x, z, rotY, height, draw) {
  const g = new THREE.Group();
  const tex = canvasTexture(1024, 400, draw);
  const board = new THREE.Mesh(new THREE.BoxGeometry(12, 4.7, 0.25), [M.darkMetal, M.darkMetal, M.darkMetal, M.darkMetal, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }), M.darkMetal]);
  board.position.y = 6.5; board.castShadow = true; g.add(board);
  for (const px of [-4, 0, 4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6.5, 0.25), M.wood); leg.position.set(px, 3.25, -0.3); leg.castShadow = true; g.add(leg);
  }
  const walk = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 0.8), M.darkMetal); walk.position.set(0, 4.0, 0.35); g.add(walk);
  // spot lights fixtures (emissive)
  for (const px of [-4, 0, 4]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.25), M.lightPanel); lamp.position.set(px, 9.0, 0.9); g.add(lamp);
  }
  g.position.set(x, height(x, z), z);
  g.rotation.y = rotY;
  scene.add(g);
}

function makeSaguaroGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.32, 0.38, 5, 14, 6); trunk.translate(0, 2.5, 0); parts.push(trunk);
  const top = new THREE.SphereGeometry(0.32, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); top.translate(0, 5, 0); parts.push(top);
  const arm = (side, y, len, up) => {
    const h = new THREE.CylinderGeometry(0.22, 0.22, len, 12); h.rotateZ(Math.PI / 2); h.translate(side * (0.3 + len / 2), y, 0); parts.push(h);
    const elbow = new THREE.SphereGeometry(0.22, 12, 8); elbow.translate(side * (0.3 + len), y, 0); parts.push(elbow);
    const v = new THREE.CylinderGeometry(0.22, 0.24, up, 12, 3); v.translate(side * (0.3 + len), y + up / 2, 0); parts.push(v);
    const cap = new THREE.SphereGeometry(0.22, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(side * (0.3 + len), y + up, 0); parts.push(cap);
  };
  arm(1, 2.4, 0.6, 1.6); arm(-1, 3.1, 0.5, 1.2);
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  // cylindrical uv for ribs
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI * 2) * 2, p.getY(i) * 0.5);
  return g;
}

function makeBushGeo(rng) {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.ConeGeometry(0.06, 0.9 + rng() * 0.5, 4, 1, true);
    c.translate(0, 0.45, 0);
    c.rotateZ((rng() - 0.5) * 1.4); c.rotateY(rng() * 6.28);
    parts.push(c.toNonIndexed());
  }
  const blob = new THREE.IcosahedronGeometry(0.45, 1); blob.scale(1, 0.55, 1); blob.translate(0, 0.25, 0);
  parts.push(blob.toNonIndexed());
  return mergeGeometries(parts);
}

export { boxGeo };
