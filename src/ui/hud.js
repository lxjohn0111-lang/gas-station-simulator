import * as THREE from 'three';
import { money, moneyShort, timeStr, clamp } from '../core/utils.js';
import { xpForLevel } from '../game/economy.js';
import { FUELS } from '../game/products.js';

const $ = (id) => document.getElementById(id);

/** HTML HUD: money, clock, level, prompts, toasts, gauges, banners. */
export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), money: $('hud-money'), day: $('hud-day'), time: $('hud-time'), weather: $('hud-weather'),
      level: $('hud-level'), xp: $('hud-xp'), stars: $('hud-stars'), hype: $('hud-hype'),
      prompt: $('prompt'), cross: $('crosshair'), toasts: $('toasts'), big: $('big-msg'), objectives: $('objectives'),
      hold: $('hold-info'), gauge: $('fuel-gauge'), fgType: $('fg-type'), fgTarget: $('fg-target'), fgFill: $('fg-fill'), fgMark: $('fg-mark'), fgLiters: $('fg-liters'), fgCost: $('fg-cost'),
      funny: $('funny-cam'), tanks: $('tank-levels'), reg: $('register-ui'), regHelp: $('reg-help'),
    };
    this.tabletOpen = false;
    this.lastPrompt = '';
    this.displayMoney = game.economy.money;
    this._tankT = 0;
  }

  show() { this.el.hud.classList.remove('hidden'); this.updateMoney(); this.updateLevel(); this.updateRep(); }

  updateMoney(bump = false, neg = false) {
    const m = this.game.economy.money;
    this.el.money.textContent = moneyShort(m);
    const pill = this.el.money.parentElement;
    pill.classList.toggle('neg', m < 0);
    if (bump) { pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump'); }
    void neg;
    if (this.game.tablet && this.tabletOpen) this.game.tablet.updateMoney();
  }
  updateLevel() {
    const e = this.game.economy;
    this.el.level.textContent = e.level;
    this.el.xp.style.width = clamp((e.xp / xpForLevel(e.level)) * 100, 0, 100) + '%';
  }
  updateRep() {
    const e = this.game.economy;
    const r = e.reputation;
    let s = '';
    for (let i = 1; i <= 5; i++) s += r >= i - 0.25 ? '★' : r >= i - 0.75 ? '⯪' : '<span class="off">★</span>';
    this.el.stars.innerHTML = s;
    this.el.hype.textContent = '🔥 ' + Math.round(e.hype);
  }
  updateClock(day, hour, weather) {
    this.el.day.textContent = 'DAY ' + day;
    this.el.time.textContent = timeStr(hour);
    this.el.weather.textContent = weather === 'dust' ? '🌪️' : weather === 'cloudy' ? '⛅' : hour > 20 || hour < 6 ? '🌙' : '☀️';
  }

  setPrompt(p) {
    const key = p ? (p.key || '') + p.text + (p.sub || '') + (p.progress != null ? Math.round(p.progress * 10) : '') : '';
    this.el.cross.classList.toggle('active', !!(p && p.key));
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    if (!p) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.classList.remove('hidden');
    const kb = p.key ? `<span class="key">${this.game.input.isTouch ? ({ E: 'E', LMB: 'USE', RMB: '⤴' }[p.key] || p.key) : p.key}</span>` : '';
    const col = p.color ? `style="color:${p.color}"` : '';
    const prog = p.progress != null ? `<div style="height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin-top:5px"><div style="height:100%;width:${Math.round(p.progress * 100)}%;background:#ffb52e;border-radius:2px"></div></div>` : '';
    this.el.prompt.innerHTML = `${kb}<span ${col}>${p.text}</span>${p.sub ? `<span class="sub">${p.sub}</span>` : ''}${prog}`;
  }

  updateHeld(h) {
    const el = this.el.hold;
    if (!h) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (h.kind === 'nozzle') el.innerHTML = `Holding <b style="color:${FUELS[h.nozzle.fuelType].color}">${FUELS[h.nozzle.fuelType].name}</b> nozzle<br><span style="opacity:.7">LMB at fuel cap • Q to hang up</span>`;
    else if (h.kind === 'prop') {
      const d = h.prop.data;
      el.innerHTML = d.kind === 'box' ? `📦 <b>${d.name}</b> — ${d.count} left<br><span style="opacity:.7">LMB on a shelf slot • RMB throw • Q drop</span>` : `Holding <b>${d.name}</b><br><span style="opacity:.7">RMB throw • Q drop</span>`;
    }
  }

  toast(text, kind = '', life = 3) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.style.setProperty('--life', life + 's');
    t.innerHTML = text;
    this.el.toasts.appendChild(t);
    setTimeout(() => t.remove(), (life + 0.5) * 1000);
    while (this.el.toasts.children.length > 6) this.el.toasts.firstChild.remove();
  }

  bigMessage(title, sub = '') {
    const b = this.el.big;
    b.innerHTML = title + (sub ? `<small>${sub}</small>` : '');
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  funnyCam(caption, combo) {
    const f = this.el.funny;
    f.innerHTML = `<span>📸 ${caption}${combo > 1 ? ` <b style="color:#c22">x${combo}</b>` : ''}</span>`;
    f.classList.remove('hidden'); f.style.animation = 'none'; void f.offsetWidth; f.style.animation = '';
    clearTimeout(this._funnyT);
    this._funnyT = setTimeout(() => f.classList.add('hidden'), 2600);
    this.game.renderer.final.material.uniforms.flash.value = 0.35;
  }

  setObjectives(list) {
    this.el.objectives.innerHTML = list.map((o) => `<div class="obj"><div class="obj-title">${o.title}</div>${o.text}</div>`).join('');
  }

  float(text, pos, cls = '') { this.game.labels.float(text, pos, cls); }

  registerMode(on) {
    document.body.classList.toggle('register-mode', on);
    this.el.reg.classList.toggle('hidden', !on);
    this.el.cross.classList.toggle('hidden', on);
    if (on) this.setPrompt(null);
    document.body.style.cursor = on ? 'default' : 'none';
  }
  registerHelp(html) { this.el.regHelp.innerHTML = html; }

  updateGauge(info) {
    const el = this.el.gauge;
    if (!info) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const max = Math.max(info.target * 1.25, info.liters * 1.05, 5);
    this.el.fgType.textContent = FUELS[info.type].name.toUpperCase() + (info.type !== info.wantType ? ' ⚠ WRONG FUEL?' : '');
    this.el.fgType.style.color = info.type !== info.wantType ? '#ff6b6b' : FUELS[info.type].color;
    this.el.fgTarget.textContent = info.full ? 'FILL IT UP' : info.dollars ? `TARGET $${info.dollars.toFixed(2)}` : `TARGET ${info.target.toFixed(1)} L`;
    this.el.fgFill.style.width = clamp(info.liters / max * 100, 0, 100) + '%';
    this.el.fgFill.classList.toggle('over', info.liters > info.target + 0.25);
    this.el.fgMark.style.left = clamp(info.target / max * 100, 0, 100) + '%';
    this.el.fgLiters.textContent = info.liters.toFixed(2) + ' L';
    this.el.fgCost.textContent = '$' + info.cost.toFixed(2);
  }

  updateTanks(dt) {
    this._tankT -= dt;
    if (this._tankT > 0) return;
    this._tankT = 0.5;
    const f = this.game.fuel;
    let html = '';
    for (const t of ['regular', 'diesel', 'premium']) {
      if (t === 'premium' && !this.game.upgrades.has('premium')) continue;
      const pct = clamp(f.tanks[t] / f.capacity, 0, 1);
      html += `<div class="tank ${pct < 0.12 ? 'low' : ''}"><div class="tbar"><div class="tfill" style="height:${pct * 100}%;background:${FUELS[t].color}"></div></div>${FUELS[t].short}<br>${Math.round(f.tanks[t])}L</div>`;
    }
    if (html !== this._tanksHtml) { this.el.tanks.innerHTML = html; this._tanksHtml = html; }
  }
}
