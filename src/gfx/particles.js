import * as THREE from 'three';
import { canvasTexture } from './textures.js';
import { rand } from '../core/utils.js';

const VERT = /* glsl */`
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aRot;
  varying float vAlpha; varying vec3 vColor; varying float vRot;
  uniform float uScale;
  #include <fog_pars_vertex>
  void main() {
    vAlpha = aAlpha; vColor = aColor; vRot = aRot;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FRAG = /* glsl */`
  uniform sampler2D map;
  varying float vAlpha; varying vec3 vColor; varying float vRot;
  #include <fog_pars_fragment>
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
    vec4 t = texture2D(map, uv);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.004) discard;
    #include <fog_fragment>
  }`;

class Pool {
  constructor(scene, tex, max, blending, depthTest = true) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.rot = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: tex }, uScale: { value: 600 } }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest, blending, fog: true,
    });
    this.mat.uniforms.map.value = tex;
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.parts = [];
  }
  spawn(p) {
    if (this.parts.length >= this.max) this.parts.shift();
    this.parts.push(p);
  }
  update(dt) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) { ps.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.p.addScaledVector(p.vel, dt);
      if (p.floor !== undefined && p.p.y < p.floor) { p.p.y = p.floor; p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; }
      p.r += p.spin * dt;
    }
    const n = ps.length;
    for (let i = 0; i < n; i++) {
      const p = ps[i], t = p.age / p.life;
      this.pos[i * 3] = p.p.x; this.pos[i * 3 + 1] = p.p.y; this.pos[i * 3 + 2] = p.p.z;
      this.size[i] = p.size0 + (p.size1 - p.size0) * t;
      const fadeIn = Math.min(1, p.age / Math.max(0.001, p.fadeIn));
      this.alpha[i] = p.alpha * fadeIn * (1 - Math.pow(t, p.fadePow));
      this.color[i * 3] = p.c.r; this.color[i * 3 + 1] = p.c.g; this.color[i * 3 + 2] = p.c.b;
      this.rot[i] = p.r;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor', 'aRot']) this.geo.attributes[k].needsUpdate = true;
  }
}

export class Particles {
  constructor(scene) {
    const smoke = canvasTexture(128, 128, (ctx, w) => {
      for (let i = 0; i < 16; i++) {
        const x = w / 2 + (Math.random() - 0.5) * w * 0.3, y = w / 2 + (Math.random() - 0.5) * w * 0.3, r = w * (0.18 + Math.random() * 0.18);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      }
    });
    const spark = canvasTexture(32, 32, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    });
    const icons = (txt, color) => canvasTexture(64, 64, (ctx, w) => {
      ctx.font = 'bold 50px Impact, Arial Black, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(txt, w / 2, w / 2 + 2);
      ctx.fillStyle = color; ctx.fillText(txt, w / 2, w / 2 + 2);
    });
    const star = canvasTexture(64, 64, (ctx, w) => {
      ctx.translate(w / 2, w / 2); ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 12 : 28, a = i * Math.PI / 5 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
    });
    const drop = canvasTexture(32, 32, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.6, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2, w / 2, w / 2, 0, 7); ctx.fill();
    });
    this.pools = {
      smoke: new Pool(scene, smoke, 500, THREE.NormalBlending),
      add: new Pool(scene, spark, 400, THREE.AdditiveBlending),
      money: new Pool(scene, icons('$', '#7dff9e'), 60, THREE.NormalBlending),
      star: new Pool(scene, star, 120, THREE.NormalBlending),
      drop: new Pool(scene, drop, 300, THREE.NormalBlending),
      heart: new Pool(scene, icons('♥', '#ff5d7a'), 40, THREE.NormalBlending),
      angry: new Pool(scene, icons('!', '#ff3b3b'), 40, THREE.NormalBlending),
      note: new Pool(scene, icons('♪', '#ffe27a'), 60, THREE.NormalBlending),
      zzz: new Pool(scene, icons('?', '#ffffff'), 30, THREE.NormalBlending),
    };
  }

  setScale(px) { for (const p of Object.values(this.pools)) p.mat.uniforms.uScale.value = px; }

  emit(type, pos, o = {}) {
    const count = o.count ?? 1;
    const pool = this.pools[o.pool || ({ smoke: 'smoke', dust: 'smoke', spark: 'add', glow: 'add', money: 'money', star: 'star', drop: 'drop', heart: 'heart', angry: 'angry', note: 'note', question: 'zzz', confetti: 'add', fuel: 'drop' }[type] || 'smoke')];
    for (let i = 0; i < count; i++) {
      const sp = o.spread ?? 0.2;
      const p = {
        p: new THREE.Vector3(pos.x + rand(-sp, sp), pos.y + rand(-sp, sp) * (o.flatY ? 0.1 : 1), pos.z + rand(-sp, sp)),
        vel: new THREE.Vector3(
          (o.vel ? o.vel.x : 0) + rand(-1, 1) * (o.velSpread ?? 0.5),
          (o.vel ? o.vel.y : 0) + rand(-1, 1) * (o.velSpread ?? 0.5) * (o.velYSpread ?? 1),
          (o.vel ? o.vel.z : 0) + rand(-1, 1) * (o.velSpread ?? 0.5)),
        age: 0, life: (o.life ?? 1.5) * rand(0.75, 1.25),
        size0: (o.size ?? 0.5) * rand(0.8, 1.2), size1: (o.sizeEnd ?? o.size ?? 0.5) * rand(0.8, 1.2),
        alpha: o.alpha ?? 1, fadeIn: o.fadeIn ?? 0.05, fadePow: o.fadePow ?? 1.5,
        gravity: o.gravity ?? 0, drag: o.drag ?? 0.5,
        c: new THREE.Color(o.color ?? 0xffffff),
        r: rand(0, 6.28), spin: o.spin ?? rand(-1, 1),
        floor: o.floor,
      };
      if (type === 'confetti') p.c.setHSL(Math.random(), 0.9, 0.6);
      pool.spawn(p);
    }
  }

  // convenience presets
  smoke(pos, o = {}) { this.emit('smoke', pos, { count: 1, size: 0.6, sizeEnd: 2.2, life: 2.2, vel: o.vel || { x: 0, y: 0.6, z: 0 }, velSpread: 0.2, alpha: 0.35, color: o.color ?? 0x9a9a9a, drag: 0.6, fadeIn: 0.2, ...o }); }
  dust(pos, o = {}) { this.emit('dust', pos, { count: 4, size: 0.5, sizeEnd: 1.8, life: 1.4, vel: { x: 0, y: 0.25, z: 0 }, velSpread: 0.7, velYSpread: 0.3, alpha: 0.35, color: 0xc4a07a, drag: 1.5, fadeIn: 0.1, ...o }); }
  sparks(pos, o = {}) { this.emit('spark', pos, { count: 14, size: 0.08, sizeEnd: 0.02, life: 0.5, velSpread: 4, gravity: 9, color: 0xffb040, drag: 0.5, ...o }); }
  money(pos, n = 4) { this.emit('money', pos, { count: n, size: 0.45, sizeEnd: 0.35, life: 1.3, vel: { x: 0, y: 2.2, z: 0 }, velSpread: 0.8, gravity: 2.5, drag: 0.6, spin: 0 }); }
  stars(pos, n = 6) { this.emit('star', pos, { count: n, size: 0.25, sizeEnd: 0.1, life: 0.9, vel: { x: 0, y: 1.5, z: 0 }, velSpread: 2, gravity: 4, color: 0xffe14a }); }
  fuelDrip(pos, o = {}) { this.emit('fuel', pos, { count: 2, size: 0.05, sizeEnd: 0.04, life: 0.6, velSpread: 0.25, gravity: 9.8, color: o.color ?? 0xc9a440, alpha: 0.7, floor: 0.02, spread: 0.02, ...o }); }
  confetti(pos) { this.emit('confetti', pos, { count: 60, size: 0.12, sizeEnd: 0.08, life: 2.5, vel: { x: 0, y: 4, z: 0 }, velSpread: 3, gravity: 5, drag: 1.2 }); }
  icon(type, pos) { this.emit(type, pos, { count: 1, size: 0.6, sizeEnd: 0.5, life: 1.2, vel: { x: 0, y: 1.0, z: 0 }, velSpread: 0.15, drag: 1, spin: 0, spread: 0.05 }); }

  update(dt) { for (const p of Object.values(this.pools)) p.update(dt); }
}
