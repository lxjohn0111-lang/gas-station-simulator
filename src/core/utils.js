import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = invLerp(a, b, v); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function weightedPick(items, weightFn) {
  let total = 0;
  for (const it of items) total += Math.max(0, weightFn(it));
  let r = Math.random() * total;
  for (const it of items) { r -= Math.max(0, weightFn(it)); if (r <= 0) return it; }
  return items[items.length - 1];
}

export function money(v, decimals = 2) {
  const neg = v < 0;
  const s = Math.abs(v).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + s;
}
export function moneyShort(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function timeStr(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** Distance from point to segment in XZ plane. */
export function distXZ(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const tmpV = [...Array(16)].map(() => new THREE.Vector3());
export const tmpQ = [...Array(8)].map(() => new THREE.Quaternion());
export const tmpM = [...Array(4)].map(() => new THREE.Matrix4());

/** Seeded RNG (mulberry32) for deterministic world decoration. */
export function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D value noise (smooth), deterministic. */
export function makeNoise2D(seed = 1) {
  const r = seeded(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), w);
  };
  n.fbm = (x, y, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += n(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  };
  return n;
}

export class EventBus {
  constructor() { this.map = new Map(); }
  on(ev, fn) { if (!this.map.has(ev)) this.map.set(ev, []); this.map.get(ev).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { const l = this.map.get(ev); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  emit(ev, ...args) { const l = this.map.get(ev); if (l) for (const fn of [...l]) fn(...args); }
}

export const NAMES_F = ['Darla', 'Rosa', 'Marge', 'Tina', 'Jolene', 'Peggy', 'Wanda', 'Lucy', 'Bea', 'Dot', 'Gloria', 'Nina', 'Rita', 'Sue', 'Vera', 'Yolanda'];
export const NAMES_M = ['Hank', 'Dusty', 'Earl', 'Buck', 'Cletus', 'Rusty', 'Walt', 'Gus', 'Dale', 'Vince', 'Lou', 'Moe', 'Otis', 'Ray', 'Skip', 'Tex', 'Bubba', 'Clint'];
