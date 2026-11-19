import * as THREE from 'three';
import { canvasTexture } from './textures.js';

const NOISE_GLSL = /* glsl */`
  float mvHash(vec2 p){ p = fract(p*vec2(234.34,435.345)); p += dot(p, p+34.23); return fract(p.x*p.y); }
  float mvNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(mvHash(i),mvHash(i+vec2(1,0)),u.x), mix(mvHash(i+vec2(0,1)),mvHash(i+vec2(1,1)),u.x), u.y); }
  float mvFbm(vec2 p){ return mvNoise(p)*0.55 + mvNoise(p*2.13)*0.3 + mvNoise(p*4.7)*0.15; }
`;

/**
 * Adds world-space low-frequency colour variation to break visible tiling
 * (and optional dirt tint), a cheap trick that sells large surfaces.
 */
export function macroVariation(mat, { scale = 0.05, amount = 0.22, tint = null, tintAmount = 0, tintScale = 0.02 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.mvTint = { value: tint ? new THREE.Color(tint) : new THREE.Color(1, 1, 1) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMvW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 mvw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvw = instanceMatrix * mvw;
        #endif
        vMvW = (modelMatrix * mvw).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMvW;\nuniform vec3 mvTint;\n' + NOISE_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float mvn = mvFbm(vMvW.xz * ${scale.toFixed(4)});
        diffuseColor.rgb *= mix(${(1 - amount).toFixed(3)}, ${(1 + amount * 0.6).toFixed(3)}, mvn);
        ${tint ? `float mvt = smoothstep(0.45, 0.8, mvFbm(vMvW.xz * ${tintScale.toFixed(4)} + 17.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mvTint, mvt * ${tintAmount.toFixed(3)});` : ''}`);
  };
  mat.customProgramCacheKey = () => `mv${scale}_${amount}_${tint}_${tintAmount}`;
  return mat;
}

/** Building-ish materials get grime on lower parts. */
export function verticalGrime(mat, { height = 1.2, amount = 0.35, color = 0x5a4632 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.vgColor = { value: new THREE.Color(color) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVgW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vVgW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVgW;\nuniform vec3 vgColor;\n' + (shader.fragmentShader.includes('mvHash') ? '' : NOISE_GLSL))
      .replace('#include <map_fragment>', `#include <map_fragment>
        float vg = (1.0 - smoothstep(0.0, ${height.toFixed(3)}, vVgW.y)) * (0.6 + 0.4 * mvNoise(vVgW.xz * 3.0 + vVgW.y * 2.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vgColor, vg * ${amount.toFixed(3)});`);
  };
  mat.customProgramCacheKey = () => `vg${height}_${amount}_${color}`;
  return mat;
}

const std = (p) => new THREE.MeshStandardMaterial(p);

export function createMaterials(tex) {
  const M = {};
  // ---------------------------------------------------------------- ground
  M.asphalt = macroVariation(std({ ...tex.set('asphalt'), color: 0xd8d4cf, roughness: 1, envMapIntensity: 0.6 }), { scale: 0.03, amount: 0.25, tint: 0xb59a7a, tintAmount: 0.5, tintScale: 0.015 });
  M.asphalt.normalScale = new THREE.Vector2(0.8, 0.8);
  M.road = macroVariation(std({ ...tex.set('asphalt'), color: 0xbab6b2, roughness: 1, envMapIntensity: 0.6 }), { scale: 0.02, amount: 0.2, tint: 0xc2a27f, tintAmount: 0.6, tintScale: 0.01 });
  M.concrete = macroVariation(std({ ...tex.set('concrete'), color: 0xf2eee8, roughness: 1, envMapIntensity: 0.7 }), { scale: 0.06, amount: 0.18, tint: 0xa28a6c, tintAmount: 0.35, tintScale: 0.03 });
  M.sidewalk = macroVariation(std({ ...tex.set('concrete'), color: 0xe9e3d9, roughness: 1, envMapIntensity: 0.7 }), { scale: 0.1, amount: 0.15 });
  M.sand = macroVariation(std({ map: tex.get('sand_c.jpg'), normalMap: tex.get('sand_n.jpg', { srgb: false }), color: 0xffffff, roughness: 0.97, envMapIntensity: 0.5 }), { scale: 0.008, amount: 0.3, tint: 0x9a6a48, tintAmount: 0.45, tintScale: 0.004 });
  M.dirt = macroVariation(std({ map: tex.get('dirt_c.jpg'), normalMap: tex.get('dirt_n.jpg', { srgb: false }), roughness: 1, envMapIntensity: 0.5 }), { scale: 0.03, amount: 0.25 });
  M.rock = macroVariation(std({ map: tex.get('rock_c.jpg'), normalMap: tex.get('rock_n.jpg', { srgb: false }), roughness: 0.95, envMapIntensity: 0.5 }), { scale: 0.01, amount: 0.3 });
  M.mesa = std({ map: tex.get('rock_c.jpg'), normalMap: tex.get('rock_n.jpg', { srgb: false }), roughness: 1, envMapIntensity: 0.4, color: 0xf0d0c0 });

  // ---------------------------------------------------------------- building
  M.stucco = verticalGrime(std({ map: tex.get('stucco_c.jpg'), normalMap: tex.get('stucco_n.jpg', { srgb: false }), color: 0xf3e2c6, roughness: 0.95 }), { height: 1.0, amount: 0.45 });
  M.stuccoRed = verticalGrime(std({ map: tex.get('stucco_c.jpg'), normalMap: tex.get('stucco_n.jpg', { srgb: false }), color: 0xb5452e, roughness: 0.9 }), { height: 0.8, amount: 0.4 });
  M.interiorWall = std({ map: tex.get('stucco_c.jpg'), normalMap: tex.get('stucco_n.jpg', { srgb: false }), normalScale: new THREE.Vector2(0.3, 0.3), color: 0xf5efe3, roughness: 0.9, envMapIntensity: 0.3 });
  M.interiorWallAccent = std({ color: 0x2f6f73, roughness: 0.8, envMapIntensity: 0.3 });
  M.tiles = std({ ...tex.set('tiles'), roughness: 1, envMapIntensity: 0.45 });
  M.ceiling = std({ map: tex.get('ceiling_c.jpg'), normalMap: tex.get('ceiling_n.jpg', { srgb: false }), roughness: 0.95, envMapIntensity: 0.15, emissive: 0xfff6ea, emissiveIntensity: 0.18 });
  M.wood = std({ map: tex.get('wood_c.jpg'), normalMap: tex.get('wood_n.jpg', { srgb: false }), roughness: 0.85 });
  M.corrugated = std({ map: tex.get('corrugated_c.jpg'), normalMap: tex.get('corrugated_n.jpg', { srgb: false }), metalness: 0.6, roughness: 0.55 });
  M.roofTar = macroVariation(std({ ...tex.set('asphalt'), color: 0x8a847c, roughness: 1 }), { scale: 0.1, amount: 0.2 });

  // ---------------------------------------------------------------- metals & plastics
  const metalR = tex.get('metal_r.jpg', { srgb: false });
  const metalN = tex.get('metal_n.jpg', { srgb: false });
  M.paint = (color, rough = 0.45, metal = 0.2) => std({ color, roughness: rough, metalness: metal, roughnessMap: metalR, normalMap: metalN, normalScale: new THREE.Vector2(0.3, 0.3) });
  M.steel = std({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.38, roughnessMap: metalR });
  M.chrome = std({ color: 0xffffff, metalness: 1, roughness: 0.14 });
  M.aluminum = std({ color: 0xd4d7da, metalness: 0.85, roughness: 0.3 });
  M.darkMetal = std({ color: 0x2b2d30, metalness: 0.7, roughness: 0.5, roughnessMap: metalR });
  M.rust = std({ map: tex.get('corrugated_c.jpg'), color: 0x9a5a36, metalness: 0.4, roughness: 0.85 });
  M.rubber = std({ color: 0x141414, roughness: 0.9, metalness: 0 });
  M.blackPlastic = std({ color: 0x1b1c1e, roughness: 0.55, metalness: 0 });
  M.whitePlastic = std({ color: 0xeeeeea, roughness: 0.4, metalness: 0 });
  M.greyPlastic = std({ color: 0x7c8085, roughness: 0.5 });
  M.redPaint = M.paint(0xc22a1f, 0.4, 0.1);
  M.yellowPaint = M.paint(0xf2b705, 0.5, 0.05);
  M.canopyWhite = M.paint(0xf2f0eb, 0.6, 0.1);
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb8c2, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.22, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1 });
  M.glassDirty = new THREE.MeshPhysicalMaterial({ color: 0xa8a090, metalness: 0, roughness: 0.25, transparent: true, opacity: 0.32, envMapIntensity: 1.0, depthWrite: false, side: THREE.DoubleSide });
  M.fridgeGlass = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.1, transparent: true, opacity: 0.16, envMapIntensity: 0.8, depthWrite: false });
  M.hose = std({ color: 0x111111, roughness: 0.65 });

  // ---------------------------------------------------------------- emissive / lights
  M.lightPanel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2.0, roughness: 0.4 });
  M.lightPanelCool = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f2ff, emissiveIntensity: 2.0, roughness: 0.4 });
  M.neonRed = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 3 });
  M.neonBlue = new THREE.MeshStandardMaterial({ color: 0x000822, emissive: 0x2a9dff, emissiveIntensity: 3 });
  M.neonYellow = new THREE.MeshStandardMaterial({ color: 0x221800, emissive: 0xffb52e, emissiveIntensity: 3 });
  M.neonGreen = new THREE.MeshStandardMaterial({ color: 0x002208, emissive: 0x2aff7a, emissiveIntensity: 3 });

  // ---------------------------------------------------------------- shop goods / misc
  M.cardboard = std({ map: cardboardTex(), roughness: 0.95 });
  M.trashBag = std({ color: 0x151515, roughness: 0.35, metalness: 0.1 });
  M.foliage = std({ color: 0x5a6b3a, roughness: 0.9 });
  M.cactus = std({ color: 0x4f6b39, roughness: 0.75, normalMap: cactusNormal(), normalScale: new THREE.Vector2(1.2, 1.2) });
  M.blob = new THREE.MeshBasicMaterial({ map: tex.get('blob.png'), transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -2 });
  M.oil = new THREE.MeshStandardMaterial({ map: tex.get('oil.png'), transparent: true, depthWrite: false, roughness: 0.14, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -3, envMapIntensity: 1.5 });
  M.stain = new THREE.MeshStandardMaterial({ map: tex.get('stain.png'), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
  M.skid = new THREE.MeshStandardMaterial({ map: tex.get('skid.png'), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
  M.paintLine = std({ color: 0xf1ede3, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 });
  M.paintYellow = std({ color: 0xe8b81a, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 });
  M.tread = tex.get('tread_n.jpg', { srgb: false });
  return M;
}

function cardboardTex() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b98e5a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2000; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '90,60,30' : '230,200,150'},${Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 6, 1);
    }
    ctx.fillStyle = 'rgba(200,170,120,0.6)'; ctx.fillRect(0, h * 0.46, w, h * 0.08); // tape
    ctx.strokeStyle = 'rgba(60,40,20,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
  });
}

function cactusNormal() {
  const t = canvasTexture(128, 128, (ctx, w, h) => {
    for (let x = 0; x < w; x++) {
      const s = Math.sin((x / w) * Math.PI * 2 * 8);
      const r = Math.floor(128 + s * 100);
      ctx.fillStyle = `rgb(${r},128,255)`; ctx.fillRect(x, 0, 1, h);
    }
  }, { srgb: false, repeat: true });
  return t;
}

// ------------------------------------------------------------------ geometry helpers
/** Box with UVs scaled to real-world size (tile = metres per texture repeat). */
export function boxGeo(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) {
    const uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
      let su, sv;
      if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
      uv.setXY(i, uv.getX(i) * su / tile, uv.getY(i) * sv / tile);
    }
  }
  return g;
}

export function planeGeo(w, d, tile = 1, segX = 1, segZ = 1) {
  const g = new THREE.PlaneGeometry(w, d, segX, segZ);
  g.rotateX(-Math.PI / 2);
  if (tile) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
  }
  return g;
}

/** Collects static meshes and merges them per material to keep draw calls low. */
export class StaticBatcher {
  constructor() { this.groups = new Map(); }
  add(geometry, material, matrix, { cast = true, receive = true } = {}) {
    const key = material.uuid + (cast ? 'c' : '') + (receive ? 'r' : '');
    if (!this.groups.has(key)) this.groups.set(key, { material, cast, receive, geos: [] });
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    // keep only common attributes for merge compatibility
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    this.groups.get(key).geos.push(g);
  }
  addMesh(mesh, opts) { mesh.updateMatrixWorld(true); this.add(mesh.geometry, mesh.material, mesh.matrixWorld, opts); }
  build(mergeFn) {
    const out = new THREE.Group();
    for (const { material, cast, receive, geos } of this.groups.values()) {
      const merged = mergeFn(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, material);
      m.castShadow = cast; m.receiveShadow = receive;
      m.matrixAutoUpdate = false;
      out.add(m);
      geos.forEach((g) => g.dispose());
    }
    return out;
  }
}
