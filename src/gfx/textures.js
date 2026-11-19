import * as THREE from 'three';
import { assetURL } from '../core/assets.js';


/** Loads the generated PBR textures and creates canvas-based textures. */
export class TextureLib {
  constructor(manager, renderer) {
    this.loader = new THREE.TextureLoader(manager);
    this.renderer = renderer;
    this.cache = new Map();
    this.maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
  }

  get(name, { srgb = true, repeat = 1, aniso = 8 } = {}) {
    const key = name + '|' + srgb + '|' + repeat;
    if (this.cache.has(key)) return this.cache.get(key);
    const t = this.loader.load(assetURL('assets/tex/' + name));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(aniso, this.maxAniso);
    t.repeat.set(repeat, repeat);
    this.cache.set(key, t);
    return t;
  }

  /** PBR set: name_c / name_n / name_r (if exists) */
  set(name, { repeat = 1, rough = true } = {}) {
    return {
      map: this.get(`${name}_c.jpg`, { repeat }),
      normalMap: this.get(`${name}_n.jpg`, { srgb: false, repeat }),
      roughnessMap: rough ? this.get(`${name}_r.jpg`, { srgb: false, repeat }) : null,
    };
  }
}

export function canvasTexture(w, h, draw, { srgb = true, repeat = false, mipmaps = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (!mipmaps) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.userData.canvas = c; t.userData.ctx = ctx;
  return t;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

/** Simple noise speckle over a canvas region, for grime. */
export function grime(ctx, w, h, amount = 0.15, color = '0,0,0') {
  for (let i = 0; i < w * h * 0.002; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = Math.random() * 3 + 0.5;
    ctx.fillStyle = `rgba(${color},${Math.random() * amount})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(${color},${amount * 0.8})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

export function flareTexture(kind = 'glow', size = 256, color = [255, 240, 220]) {
  return canvasTexture(size, size, (ctx, w) => {
    const c = w / 2;
    if (kind === 'glow') {
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, `rgba(${color},1)`); g.addColorStop(0.08, `rgba(${color},0.8)`);
      g.addColorStop(0.3, `rgba(${color},0.15)`); g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      // streaks
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 2; i++) {
        ctx.save(); ctx.translate(c, c); ctx.rotate(i * Math.PI / 2);
        const s = ctx.createLinearGradient(-c, 0, c, 0);
        s.addColorStop(0, 'rgba(255,255,255,0)'); s.addColorStop(0.5, `rgba(${color},0.35)`); s.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = s; ctx.fillRect(-c, -1.5, w, 3); ctx.restore();
      }
    } else if (kind === 'hex') {
      ctx.translate(c, c);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(Math.cos(a) * c * 0.9, Math.sin(a) * c * 0.9); }
      ctx.closePath();
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
      g.addColorStop(0, `rgba(${color},0.25)`); g.addColorStop(0.8, `rgba(${color},0.35)`); g.addColorStop(1, `rgba(${color},0.05)`);
      ctx.fillStyle = g; ctx.fill();
    } else if (kind === 'ring') {
      const g = ctx.createRadialGradient(c, c, c * 0.6, c, c, c);
      g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(0.75, `rgba(${color},0.25)`); g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    }
  });
}

/** Soft radial sprite used for light glows and particles. */
export function softSprite(size = 64, inner = 0, falloff = 1) {
  return canvasTexture(size, size, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, inner, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35 * falloff, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  });
}

export function smokeSprite(size = 128) {
  return canvasTexture(size, size, (ctx, w) => {
    for (let i = 0; i < 14; i++) {
      const x = w / 2 + (Math.random() - 0.5) * w * 0.35, y = w / 2 + (Math.random() - 0.5) * w * 0.35;
      const r = w * (0.15 + Math.random() * 0.2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    }
  });
}
