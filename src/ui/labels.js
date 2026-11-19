import * as THREE from 'three';
import { FUELS } from '../game/products.js';

const _v = new THREE.Vector3();

/** DOM labels anchored to world positions (customer bubbles, floating money). */
export class Labels {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('world-labels');
    this.items = new Map();  // id -> {el, getPos, ttl}
    this.floats = [];
  }

  _ensure(id, getPos) {
    let it = this.items.get(id);
    if (!it) {
      const el = document.createElement('div');
      el.className = 'wl';
      this.root.appendChild(el);
      it = { el, getPos, ttl: null, html: '' };
      this.items.set(id, it);
    }
    it.getPos = getPos;
    return it;
  }
  _set(it, html) { if (it.html !== html) { it.el.innerHTML = html; it.html = html; } }

  /** Request bubble above a fuelling customer's car. */
  setCar(c, mode) {
    const car = c.car;
    if (!car) return;
    const it = this._ensure(c.labelId, () => _v.copy(car.pos).setY(car.m.dims.H + 0.9 + car.extraY));
    if (it.ttl != null && it.ttl > 0) return; // a speech line is showing
    const s = c.service;
    const f = mode === 'queue' ? c.fuelReq : s;
    const type = (f && (f.type || f.fuelType)) || 'regular';
    const F = FUELS[type];
    let what = mode === 'queue' ? 'Waiting…' : s ? (s.full ? 'FILL IT UP' : s.dollars ? `$${s.dollars}` : `${s.target} L`) : '';
    if (s && s.state === 'fueling') what += ` <span style="opacity:.6">${s.dispensed.toFixed(1)}L</span>`;
    const pat = Math.max(0, c.patience / c.patienceMax);
    const col = pat > 0.5 ? '#44e08a' : pat > 0.25 ? '#ffb52e' : '#ff4d5e';
    const mood = pat < 0.3 ? 'angry' : '';
    this._set(it, `<div class="bubble ${mood}"><span class="fuelchip" style="background:${F.color};color:#111">${F.short}</span>${what}</div><div class="patience"><div style="width:${pat * 100}%;background:${col}"></div></div>`);
    it.ttl = null;
  }

  /** Temporary speech bubble above a customer's head. */
  say(c, text, mood = 'neutral') {
    const it = this._ensure(c.labelId, () => (c.inCar && c.car ? _v.copy(c.car.pos).setY(c.car.m.dims.H + 0.9) : _v.copy(c.pos).setY(c.pos.y + c.char.height + 0.35)));
    this._set(it, `<div class="bubble ${mood === 'angry' ? 'angry' : mood === 'happy' ? 'happy' : ''}">${text}</div>`);
    it.ttl = 2.8;
  }

  remove(id) {
    const it = this.items.get(id);
    if (it && it.ttl && it.ttl > 0) { it.removeAfter = true; return; }
    if (it) { it.el.remove(); this.items.delete(id); }
  }

  float(text, pos, cls = '') {
    const el = document.createElement('div');
    el.className = 'float-text ' + cls;
    el.textContent = text;
    this.root.appendChild(el);
    this.floats.push({ el, pos: pos.clone(), t: 0 });
  }

  update(dt) {
    const cam = this.game.player.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const camPos = cam.position;
    for (const [id, it] of this.items) {
      if (it.ttl != null) {
        it.ttl -= dt;
        if (it.ttl <= 0) { it.ttl = null; if (it.removeAfter) { it.el.remove(); this.items.delete(id); continue; } it.html = ''; it.el.innerHTML = ''; }
      }
      const p = it.getPos();
      const dist = p.distanceTo(camPos);
      _v.copy(p).project(cam);
      const vis = _v.z < 1 && _v.z > -1 && dist < 45 && it.el.innerHTML;
      if (!vis) { it.el.style.opacity = '0'; continue; }
      const sc = Math.max(0.55, Math.min(1.1, 9 / dist));
      it.el.style.opacity = '1';
      it.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%) scale(${sc})`;
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt; f.pos.y += dt * 0.7;
      _v.copy(f.pos).project(cam);
      if (f.t > 1.6 || _v.z > 1) { f.el.remove(); this.floats.splice(i, 1); continue; }
      f.el.style.opacity = String(Math.min(1, (1.6 - f.t) * 2));
      f.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.3 - f.t)})`;
    }
  }

  clear() { for (const it of this.items.values()) it.el.remove(); this.items.clear(); }
}
