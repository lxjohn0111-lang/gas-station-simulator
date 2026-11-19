import * as THREE from 'three';
import { canvasTexture } from '../gfx/textures.js';

/**
 * Product catalogue. Prices in dollars. `shelf` decides where it can be
 * stocked: 'cold' (fridge), 'snack' (gondola), 'auto' (wall shelf).
 */
export const PRODUCTS = {
  cola: { name: 'Fizz Cola', icon: '🥤', shelf: 'cold', cost: 0.42, price: 1.59, box: 24, slotCap: 18, level: 1, popularity: 1.4, shape: 'can', color: '#c8102e', accent: '#ffffff' },
  water: { name: 'Aqua Mirage', icon: '💧', shelf: 'cold', cost: 0.30, price: 1.29, box: 18, slotCap: 14, level: 1, popularity: 1.2, shape: 'bottle', color: '#2a8bd6', accent: '#e8f6ff' },
  energy: { name: 'VOLT Energy', icon: '⚡', shelf: 'cold', cost: 0.95, price: 2.99, box: 24, slotCap: 18, level: 2, popularity: 0.9, shape: 'tallcan', color: '#1b1b1b', accent: '#b6ff2e' },
  tea: { name: 'Sweet Sun Tea', icon: '🧃', shelf: 'cold', cost: 0.60, price: 2.19, box: 18, slotCap: 14, level: 4, popularity: 0.7, shape: 'bottle', color: '#c97a1a', accent: '#ffe5a8' },
  chips: { name: 'Cactus Crisps', icon: '🥔', shelf: 'snack', cost: 0.65, price: 2.29, box: 12, slotCap: 10, level: 1, popularity: 1.2, shape: 'bag', color: '#2e9e4f', accent: '#ffe14a' },
  candy: { name: 'Choco Dune Bar', icon: '🍫', shelf: 'snack', cost: 0.35, price: 1.49, box: 30, slotCap: 24, level: 1, popularity: 1.3, shape: 'bar', color: '#5a2d16', accent: '#ffcf3a' },
  jerky: { name: 'Saguaro Jerky', icon: '🥩', shelf: 'snack', cost: 1.60, price: 4.99, box: 12, slotCap: 10, level: 2, popularity: 0.7, shape: 'pouch', color: '#7a2a12', accent: '#f2d7a0' },
  cookies: { name: 'Tumble Cookies', icon: '🍪', shelf: 'snack', cost: 0.80, price: 2.79, box: 12, slotCap: 10, level: 3, popularity: 0.8, shape: 'boxsnack', color: '#2557a8', accent: '#ffd9a0' },
  oil: { name: 'MotorMax 10W-40', icon: '🛢️', shelf: 'auto', cost: 4.20, price: 11.99, box: 8, slotCap: 8, level: 2, popularity: 0.35, shape: 'jug', color: '#f2b705', accent: '#1b1b1b' },
  washer: { name: 'ClearView Fluid', icon: '🧴', shelf: 'auto', cost: 1.80, price: 5.49, box: 8, slotCap: 8, level: 3, popularity: 0.35, shape: 'jug', color: '#2fa8e0', accent: '#ffffff' },
  freshener: { name: 'Pine Breeze Tree', icon: '🌲', shelf: 'auto', cost: 0.40, price: 2.99, box: 20, slotCap: 16, level: 2, popularity: 0.5, shape: 'card', color: '#2e7d32', accent: '#ffffff' },
  sunglasses: { name: 'Desert Shades', icon: '🕶️', shelf: 'auto', cost: 3.0, price: 14.99, box: 8, slotCap: 8, level: 5, popularity: 0.3, shape: 'card', color: '#111111', accent: '#ffb52e' },
};

export const FUELS = {
  regular: { name: 'Regular', short: 'REG', color: '#3fdc6c', hex: 0x2fbf5a, cost: 1.08, price: 1.59 },
  diesel: { name: 'Diesel', short: 'DSL', color: '#ffcf3a', hex: 0xf2b705, cost: 1.15, price: 1.69 },
  premium: { name: 'Premium', short: 'PRM', color: '#5aa8ff', hex: 0x2f6fd8, cost: 1.32, price: 1.95 },
};

function labelTexture(p, w = 256, h = 128, kind = 'wrap') {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = p.color; ctx.fillRect(0, 0, w, h);
    // stylised graphics
    ctx.fillStyle = p.accent; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.5, w * 0.28, h * 0.32, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const words = p.name.split(' ');
    ctx.font = `bold ${Math.floor(h * 0.26)}px Impact, Arial Black`;
    ctx.fillText(words[0].toUpperCase(), w * 0.5, h * 0.42);
    ctx.font = `bold ${Math.floor(h * 0.15)}px Arial`;
    ctx.fillText((words.slice(1).join(' ') || '').toUpperCase(), w * 0.5, h * 0.66);
    if (kind === 'wrap') {
      ctx.fillStyle = p.accent; ctx.fillRect(0, 0, w, h * 0.07); ctx.fillRect(0, h * 0.93, w, h * 0.07);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(w * 0.1, 0, w * 0.06, h);
    }
  });
}

const geoCache = new Map();
const matCache = new Map();

/** Returns {geometry, material, size:Vector3} for a product (shared, for instancing). */
export function productVisual(id) {
  if (geoCache.has(id)) return geoCache.get(id);
  const p = PRODUCTS[id];
  let geo, mat, size;
  const label = labelTexture(p);
  switch (p.shape) {
    case 'can': {
      geo = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 18); size = new THREE.Vector3(0.066, 0.122, 0.066);
      mat = [new THREE.MeshStandardMaterial({ map: label, metalness: 0.6, roughness: 0.3 }), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.95, roughness: 0.25 }), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.95, roughness: 0.25 })];
      geo.translate(0, 0.061, 0); break;
    }
    case 'tallcan': {
      geo = new THREE.CylinderGeometry(0.029, 0.029, 0.165, 18); size = new THREE.Vector3(0.058, 0.165, 0.058);
      mat = [new THREE.MeshStandardMaterial({ map: label, metalness: 0.7, roughness: 0.25 }), new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 0.95, roughness: 0.25 }), new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 0.95, roughness: 0.25 })];
      geo.translate(0, 0.0825, 0); break;
    }
    case 'bottle': {
      const pts = [[0, 0], [0.032, 0], [0.034, 0.01], [0.034, 0.14], [0.03, 0.16], [0.014, 0.19], [0.013, 0.215], [0.015, 0.218], [0.015, 0.235], [0, 0.235]].map(([x, y]) => new THREE.Vector2(x, y));
      geo = new THREE.LatheGeometry(pts, 16); size = new THREE.Vector3(0.068, 0.235, 0.068);
      // label band uses UV v range; simple approach: single material with label texture on whole
      mat = new THREE.MeshPhysicalMaterial({ map: label, roughness: 0.15, metalness: 0, transmission: 0, clearcoat: 1, clearcoatRoughness: 0.1 });
      break;
    }
    case 'bag': {
      geo = new THREE.BoxGeometry(0.16, 0.23, 0.07, 4, 6, 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const puff = Math.cos((x / 0.08) * Math.PI / 2) * Math.cos((y / 0.115) * Math.PI / 2);
        pos.setZ(i, z * (0.25 + puff * 1.2));
        if (Math.abs(y) > 0.1) pos.setZ(i, pos.getZ(i) * 0.15);
      }
      geo.computeVertexNormals(); geo.translate(0, 0.115, 0); size = new THREE.Vector3(0.16, 0.23, 0.07);
      mat = new THREE.MeshStandardMaterial({ map: labelTexture(p, 256, 256, 'bag'), metalness: 0.5, roughness: 0.35 }); break;
    }
    case 'bar': {
      geo = new THREE.BoxGeometry(0.14, 0.025, 0.045); geo.translate(0, 0.0125, 0); size = new THREE.Vector3(0.14, 0.025, 0.045);
      mat = new THREE.MeshStandardMaterial({ map: label, metalness: 0.4, roughness: 0.4 }); break;
    }
    case 'pouch': {
      geo = new THREE.BoxGeometry(0.14, 0.2, 0.03); geo.translate(0, 0.1, 0); size = new THREE.Vector3(0.14, 0.2, 0.03);
      mat = new THREE.MeshStandardMaterial({ map: labelTexture(p, 256, 256, 'bag'), metalness: 0.2, roughness: 0.5 }); break;
    }
    case 'boxsnack': {
      geo = new THREE.BoxGeometry(0.17, 0.22, 0.05); geo.translate(0, 0.11, 0); size = new THREE.Vector3(0.17, 0.22, 0.05);
      mat = new THREE.MeshStandardMaterial({ map: labelTexture(p, 256, 256, 'bag'), roughness: 0.6 }); break;
    }
    case 'jug': {
      const body = new THREE.BoxGeometry(0.17, 0.24, 0.09); body.translate(0, 0.12, 0);
      geo = body; size = new THREE.Vector3(0.17, 0.27, 0.09);
      mat = new THREE.MeshStandardMaterial({ map: labelTexture(p, 256, 256, 'bag'), roughness: 0.35 }); break;
    }
    case 'card': default: {
      geo = new THREE.BoxGeometry(0.12, 0.2, 0.02); geo.translate(0, 0.1, 0); size = new THREE.Vector3(0.12, 0.2, 0.02);
      mat = new THREE.MeshStandardMaterial({ map: labelTexture(p, 256, 256, 'bag'), roughness: 0.6 }); break;
    }
  }
  const v = { geometry: geo, material: mat, size };
  geoCache.set(id, v);
  return v;
}

/** A single mesh of a product (for counter items, held items). */
export function productMesh(id) {
  const v = productVisual(id);
  const m = new THREE.Mesh(v.geometry, v.material);
  m.castShadow = true;
  return m;
}

/** Cardboard delivery box with a product sticker. */
export function deliveryBoxMesh(id, M) {
  const p = PRODUCTS[id];
  const key = 'box_' + id;
  let mats = matCache.get(key);
  if (!mats) {
    const sticker = canvasTexture(256, 256, (ctx, w, h) => {
      const base = M.cardboard.map.image;
      ctx.drawImage(base, 0, 0, w, h);
      ctx.fillStyle = '#fff'; ctx.fillRect(w * 0.15, h * 0.18, w * 0.7, h * 0.5);
      ctx.fillStyle = p.color; ctx.fillRect(w * 0.15, h * 0.18, w * 0.7, h * 0.12);
      ctx.fillStyle = '#111'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center';
      ctx.fillText(p.name.toUpperCase(), w / 2, h * 0.43);
      ctx.font = 'bold 60px Arial'; ctx.fillText(p.icon, w / 2, h * 0.62);
      ctx.font = 'bold 22px Arial'; ctx.fillText(`x${p.box}`, w / 2, h * 0.8);
    });
    const side = new THREE.MeshStandardMaterial({ map: sticker, roughness: 0.95 });
    mats = [M.cardboard, M.cardboard, M.cardboard, M.cardboard, side, side];
    matCache.set(key, mats);
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.4), mats);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
