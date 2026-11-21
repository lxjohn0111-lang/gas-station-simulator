import * as THREE from 'three';
import { LAYOUT } from '../world/station.js';
import { SHOP } from '../world/shop.js';
import { PRODUCTS } from './products.js';

const $ = (id) => document.getElementById(id);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _cam = new THREE.Vector3();
const _p = new THREE.Vector3();

const HIRES = ['cashier', 'attendant', 'janitor', 'stocker'];
const HIRE_INFO = {
  cashier: 'Rings up customers at the register while you do other jobs.',
  attendant: 'Fuels waiting cars at the pumps by himself.',
  janitor: 'Mops oil spills and picks up litter before anyone slips.',
  stocker: 'Carries delivery boxes in and fills the shelves.',
};

/**
 * Interactive tutorial. A bouncing 3D arrow (+ ground ring) marks where to go,
 * an edge pointer shows the direction when it is off-screen, and a card at the
 * top says in one or two short sentences what to do once you are there.
 *
 * Texts use {LMB} {E} {TAB} {F} {Q} {WASD} tokens, shown as keys (or touch buttons).
 */
export class Guide {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.i = 0;
    this.counts = {};
    this.buildMarker();
    this.steps = this.makeSteps();
    $('guide-skip').addEventListener('click', () => this.skip());
    $('hire-later').addEventListener('click', () => this.chooseHire(null));
    $('hire-grid').addEventListener('click', (e) => { const b = e.target.closest('[data-hire]'); if (b) this.chooseHire(b.dataset.hire); });
    $('final-go').addEventListener('click', () => this.event('finalDone'));
  }

  // ------------------------------------------------------------------ 3D marker
  buildMarker() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc23a, fog: false, transparent: true, opacity: 0.95, depthWrite: false });
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.46, 4), mat); head.rotation.x = Math.PI; head.position.y = 0.23;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.13), mat); shaft.position.y = 0.66;
    g.add(head, shaft);
    g.traverse((o) => { o.renderOrder = 20; });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 40), ringMat); ring.rotation.x = -Math.PI / 2;
    this.arrow = g; this.ring = ring;
    this.marker = new THREE.Group(); this.marker.add(g, ring); this.marker.visible = false;
    this.game.scene.add(this.marker);
  }

  // ------------------------------------------------------------------ helpers
  /** Replace {KEY} tokens with key caps (or the touch button names on phones). */
  keys(text) {
    const touch = this.game.input.isTouch;
    const map = touch
      ? { LMB: 'USE', E: 'E', TAB: 'SHOP', F: 'PUSH', Q: 'THROW', WASD: 'left stick' }
      : { LMB: 'Left Click', E: 'E', TAB: 'TAB', F: 'F', Q: 'Q', WASD: 'WASD' };
    return text.replace(/\{(\w+)\}/g, (m, k) => `<kbd>${map[k] || k}</kbd>`);
  }
  svc() { const c = this.carCust; return c && c.service; }
  regularNozzle() { return this.game.fuel.nozzles.find((n) => n.pump.island === 0 && n.face.name === 'S' && n.fuelType === 'regular'); }
  holding(kind) { const h = this.game.player.held; return !!(h && h.kind === kind); }
  holdingBox() { const h = this.game.player.held; return !!(h && h.kind === 'prop' && h.prop.data.kind === 'box'); }
  freeBox() {
    let best = null, bd = 1e9;
    const p = this.game.player.pos;
    for (const b of this.game.inventory.boxes) {
      if (b.held || b.data.count <= 0) continue;
      const d = b.mesh.position.distanceToSquared(p);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  makeSteps() {
    const g = this.game;
    const GREEN = '<b style="color:#3fdc6c">GREEN</b>';
    return [
      {
        id: 'walk', title: 'Welcome to Last Chance Gas!',
        far: 'You just bought this dusty roadside station. Move with {WASD} and follow the <b>yellow arrow</b> onto the pump island.',
        target: () => V(LAYOUT.islandXs[0] + 1.5, 0.18, LAYOUT.islandZ), radius: 1.5,
        enter: () => {
          const slot = g.traffic.pumpSlots.find((s) => s.island === 0 && s.lane === 'S');
          if (slot && !slot.reservedBy) this.carCust = g.customers.spawnFuel(slot, null, { fuelType: 'regular', liters: 20, payInside: false, stayInCar: true, tutorial: true });
          else this.carCust = slot && slot.reservedBy;
        },
        doneWhenArrived: true,
      },
      {
        id: 'nozzle', title: 'Grab the right nozzle',
        far: () => `${this.svc() ? 'This car needs' : 'A car is pulling up. It needs'} <b style="color:#3fdc6c">REGULAR</b> fuel. Look at the ${GREEN} nozzle and press {E}.`,
        target: () => this.regularNozzle().home,
        on: { nozzleTaken: (n) => { if (n.fuelType !== 'regular') { g.ui.toast(`Wrong colour! Press ${g.input.isTouch ? 'THROW' : 'Q'} to hang it back, then take the GREEN one.`, 'bad', 4); return false; } return true; } },
        check: () => this.holding('nozzle') && g.player.held.nozzle.fuelType === 'regular',
      },
      {
        id: 'insert', title: 'Put it in the car',
        far: () => (this.svc() ? 'Walk up to the car.' : 'Wait a moment for the car to stop at the pump.'),
        near: 'Now press {LMB} to put the nozzle in. No need to aim!',
        target: () => (this.svc() ? this.svc().car.pos.clone().setY(0) : this.regularNozzle().home), radius: 3.6, h: 1.9,
        on: { nozzleIn: () => true },
        lost: () => (!this.holding('nozzle') && !(this.svc() && this.svc().nozzle) ? `You put the nozzle down. Take the ${GREEN} nozzle again with {E}.` : null),
      },
      {
        id: 'pump', title: 'Pump the fuel',
        far: 'HOLD {LMB} to pump. Look wherever you want. It slows down near the target and <b>stops by itself</b>.',
        target: () => (this.svc() ? this.svc().car.pos.clone().setY(0) : null), h: 1.9, radius: 99,
        on: { fuelDone: () => true },
      },
      {
        id: 'shop', title: 'Ka-ching! 💰',
        far: 'The customer paid at the pump. <b>Fast service = bigger tips.</b> Now walk into your shop.',
        target: () => SHOP.entranceInside, radius: 2.2,
        doneWhenArrived: true,
      },
      {
        id: 'register', title: 'Run the cash register',
        far: 'A customer wants to pay. Go behind the counter to the cash register.',
        near: 'Look at the register and press {E}.',
        target: () => SHOP.playerRegSpot, radius: 1.7,
        enter: () => { this.walkIn = g.customers.spawnWalkIn(['cola', 'chips']); },
        on: { registerOpen: () => true },
      },
      {
        id: 'ring', title: 'Ring up the customer',
        far: 'Just follow the register menu on the right: <b>scan the items</b>, then <b>give the change</b> (or type the card amount).',
        target: () => null,
        on: { registerPaid: () => true },
        lost: () => (!g.register.active ? 'Press {E} at the register to open it again.' : null),
      },
      {
        id: 'close', title: 'Close the register',
        far: 'Nice work! Press {E} to close the register.',
        target: () => null,
        check: () => !g.register.active,
      },
      {
        id: 'order', title: 'Order new stock',
        far: 'Empty shelves = lost sales. Press {TAB} to open the station tablet, tap <b>+</b> on <b>Fizz Cola</b>, then press <b>ORDER</b>.',
        target: () => null,
        on: { orderPlaced: () => true },
      },
      {
        id: 'box', title: 'Grab the delivery',
        far: 'Your boxes were dropped at the <b>side door</b> of the shop. Follow the arrow.',
        near: 'Look at a box and press {E} to pick it up.',
        target: () => { const b = this.freeBox(); return b ? b.mesh.position.clone() : V(LAYOUT.delivery.x, 0, LAYOUT.delivery.z); },
        radius: 2.6,
        on: { boxPicked: () => true },
        check: () => this.holdingBox(),
      },
      {
        id: 'stock', title: 'Fill the shelf',
        far: () => (this.holdingBox() ? 'Carry the box to the shelf the arrow shows.' : 'Pick up a box first ({E}).'),
        near: () => (this.holdingBox() ? 'Look at the shelf and HOLD {LMB} to put the items on it.' : 'Pick up a box first ({E}).'),
        target: () => this.stockTarget(), radius: 2.2,
        on: { restocked: () => { this.counts.stock = (this.counts.stock || 0) + 1; return this.counts.stock >= 4; } },
        check: () => !this.holdingBox() && !this.freeBox(),
      },
      {
        id: 'mop', title: 'Clean up spills',
        far: 'Uh-oh, an <b>oil spill</b>! Customers slip on these. Funny… but bad for business. Go over there.',
        near: 'Look down at the spill and HOLD {E} to mop it up.',
        enter: () => { this.spill = g.cleaning.addHazard('oil', V(-1.4, 0, -2.2), 1.4); },
        target: () => (this.spill ? this.spill.pos.clone() : null), radius: 2.6,
        on: { mopped: () => true },
        check: () => !g.cleaning.hazards.includes(this.spill),
      },
      {
        id: 'shove', title: 'Deal with troublemakers',
        far: 'This guy is dancing in your doorway and blocking customers. Walk up to him.',
        near: 'Look at him and press {F} to <b>shove</b> him! Works on shoplifters too.',
        enter: () => { this.dancer = g.customers.spawnDancer(V(4.4, 0.15, -2.0)); },
        target: () => (this.dancer && g.customers.list.includes(this.dancer) && !this.dancer.char.isRagdoll ? this.dancer.pos.clone() : null),
        radius: 2.6, h: 2.35,
        on: { shove: () => { g.ui.toast('Ha! Shoving regular customers costs reputation, so save it for thieves.', 'fun', 4.5); return true; } },
      },
      {
        id: 'hire', title: 'Hire some help',
        far: 'Running a station alone is hard work. Pick your <b>first employee</b>. It\'s free!',
        target: () => null,
        enter: () => this.openHire(),
        on: { hireDone: () => true },
      },
      {
        id: 'final', title: 'You\'re ready!',
        far: 'Read the tips, then open the station.',
        target: () => null,
        enter: () => this.openFinal(),
        on: { finalDone: () => true },
      },
    ];
  }

  stockTarget() {
    const g = this.game;
    if (!this.holdingBox()) { const b = this.freeBox(); return b ? b.mesh.position.clone() : SHOP.entranceInside; }
    const id = g.player.held.prop.data.product;
    const shelf = PRODUCTS[id] ? PRODUCTS[id].shelf : 'cold';
    const inv = g.inventory;
    const slot = inv.slots.find((s) => s.product === id && s.count < inv.capacity(s, id)) || inv.slots.find((s) => s.shelf === shelf && (!s.product || s.count === 0));
    return slot ? inv.standPoint(slot) : SHOP.entranceInside;
  }

  // ------------------------------------------------------------------ flow
  get step() { return this.active ? this.steps[this.i] : null; }

  start(skip) {
    const g = this.game;
    this.closeHire(); this.closeFinal();
    if (skip) { this.active = false; $('guide').classList.add('hidden'); g.goals.show(true); return; }
    this.active = true;
    this.i = 0; this.counts = {}; this.carCust = null; this.walkIn = null; this.dancer = null; this.spill = null;
    g.goals.show(false);
    $('guide').classList.remove('hidden');
    $('guide-skip').textContent = g.input.isTouch ? 'Skip ✕' : 'Skip: Esc menu';
    this.enterStep();
  }

  enterStep() {
    const s = this.steps[this.i];
    if (!s) { this.finish(); return; }
    this.arrived = false;
    this._last = null;
    if (s.enter) s.enter();
    this.render(true);
  }

  next() {
    const g = this.game;
    g.audio.play('perfect', { vol: 0.5 });
    g.economy.addXP(8);
    this.i++;
    if (!this.steps[this.i]) { this.finish(); return; }
    this.enterStep();
  }

  /** Gameplay events (also forwarded to the goal tracker). */
  event(name, data) {
    const g = this.game;
    if (g.goals) g.goals.event(name, data);
    const s = this.step;
    if (s && s.on && s.on[name]) {
      if (s.on[name](data) !== false) this.next();
    }
  }

  skip() { if (this.active) this.finish(true); }

  finish(skipped = false) {
    const g = this.game;
    this.active = false;
    this.marker.visible = false;
    $('guide').classList.add('hidden');
    $('guide-edge').classList.add('hidden');
    this.closeHire(); this.closeFinal();
    for (const c of [...g.customers.list]) {
      if (!c.tutorial) continue;
      c.tutorial = false; c.patienceMax = 80; c.patience = 80;
      if (c.state === 'dance') { c.state = 'idle'; g.customers.walkAway(c); }
    }
    g.customers.spawnTimer = Math.min(g.customers.spawnTimer, 4);
    g.goals.show(true);
    g.tutorialDone = true;
    if (!skipped) {
      g.economy.earn(100, 'Bonus');
      g.ui.bigMessage('TUTORIAL COMPLETE!', '+$100 bonus • follow the NEXT GOAL card');
      g.particles.confetti(g.player.eye.clone().add(g.player.forward().multiplyScalar(2)));
    } else g.ui.toast('Tutorial skipped. Follow the 🎯 NEXT GOAL card (top left).', 'good', 4);
    g.save();
  }

  // ------------------------------------------------------------------ overlays
  modal(on, relock = true) {
    const g = this.game;
    g.ui.modalOpen = on;
    g.input.cursorMode = on;
    if (on) { g.input.exitLock(); document.body.style.cursor = 'default'; }
    else { document.body.style.cursor = 'none'; if (relock && !g.input.isTouch) g.input.requestLock(); }
  }

  openHire() {
    const g = this.game, U = g.upgrades;
    const avail = HIRES.filter((id) => !U.has(id));
    if (!avail.length) { g.after(0.1, () => this.event('hireDone')); return; }
    $('hire-grid').innerHTML = HIRES.map((id) => {
      const u = U.get(id), owned = U.has(id);
      return `<button class="hire-card ${owned ? 'owned' : ''}" data-hire="${id}">
        ${owned ? '' : '<span class="h-free">FREE</span>'}
        <span class="h-icon">${u.icon}</span>
        <span><div class="h-name">${u.name.replace('Hire ', '')}</div><div class="h-desc">${HIRE_INFO[id]}</div><div class="h-wage">${owned ? 'Already hired' : `Wage $${u.wage}/day`}</div></span>
      </button>`;
    }).join('');
    $('hire').classList.remove('hidden');
    this.modal(true);
    g.audio.play('chime');
  }
  closeHire(relock = true) {
    const el = $('hire');
    if (el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    this.modal(false, relock);
  }
  chooseHire(id) {
    const g = this.game;
    this.closeHire(false); // the "you're ready" screen opens next
    if (id && g.upgrades.grant(id)) {
      const u = g.upgrades.get(id);
      g.ui.bigMessage(u.icon + ' ' + u.name.replace('Hire ', '').toUpperCase(), 'joined your team!');
    } else if (!id) g.ui.toast('No problem: you can hire staff any time on the tablet (UPGRADES → Staff).', 'good', 4);
    this.event('hireDone');
  }

  openFinal() {
    const tips = [
      '🎯 Follow the <b>NEXT GOAL</b> card (top left). Every goal pays cash.',
      '⛽ Serve cars <b>fast</b>: quick service earns bigger tips and more stars.',
      '📦 Keep shelves full: order stock on the tablet ({TAB}).',
      '🔧 Spend your money on <b>upgrades</b>: more pumps bring more customers.',
      '🧹 Mop spills ({E}) and shove shoplifters ({F}).',
      '🌙 The shop closes at 22:00. Then you pay wages & bills and see your profit.',
    ];
    $('final-list').innerHTML = tips.map((t) => `<div>${this.keys(t)}</div>`).join('');
    $('final').classList.remove('hidden');
    this.modal(true);
    this.game.audio.play('levelup', { vol: 0.5 });
  }
  closeFinal() {
    const el = $('final');
    if (el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    this.modal(false);
  }

  // ------------------------------------------------------------------ per-frame
  render(force = false) {
    const s = this.step; if (!s) return;
    const val = (v) => (typeof v === 'function' ? v() : v);
    let text = this.arrived && s.near ? val(s.near) : val(s.far);
    const lost = s.lost && s.lost();
    if (lost) text = lost;
    const html = this.keys(text);
    if (!force && html === this._last) return;
    this._last = html;
    $('guide-step').textContent = `TUTORIAL ${this.i + 1}/${this.steps.length}`;
    $('guide-title').textContent = s.title;
    $('guide-text').innerHTML = html;
    const card = $('guide').querySelector('.guide-card');
    card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
  }

  update() {
    if (!this.active) return;
    const g = this.game, s = this.step;
    if (!s) return;
    let t = s.target ? s.target() : null;
    const lost = s.lost && s.lost();
    if (lost && s.id === 'insert') t = this.regularNozzle().home;
    if (lost && s.id === 'ring') t = SHOP.playerRegSpot;
    if (t && !g.register.active && !g.tablet.isOpen) {
      const d = Math.hypot(t.x - g.player.pos.x, t.z - g.player.pos.z);
      const was = this.arrived;
      this.arrived = d < (s.radius || 2);
      if (this.arrived && !was && s.near) g.audio.play('pop', { vol: 0.6 });
      if (this.arrived && s.doneWhenArrived) { this.next(); return; }
      this.placeMarker(t, d, s.h);
    } else { this.marker.visible = false; $('guide-edge').classList.add('hidden'); }
    if (s.check && s.check()) { this.next(); return; }
    this.render();
  }

  placeMarker(t, dist, h = 1.35) {
    const g = this.game, time = performance.now() / 1000;
    this.marker.visible = true;
    const groundY = g.colliders.groundHeight(t.x, t.z);
    const raised = t.y > groundY + 0.45;
    this.marker.position.set(t.x, groundY + 0.06, t.z);
    this.arrow.position.y = (raised ? t.y - groundY + 0.3 : h) + Math.sin(time * 4) * 0.15;
    this.arrow.rotation.y = time * 2;
    const k = 1 + Math.sin(time * 5) * 0.12;
    this.ring.scale.set(k, k, k);
    this.ring.visible = !raised && dist > 1.0;
    // screen-space pointer: distance under the arrow, or an edge arrow when off-screen
    const el = $('guide-edge');
    const cam = g.player.camera;
    _p.set(t.x, groundY + this.arrow.position.y + 0.8, t.z);
    _cam.copy(_p).applyMatrix4(cam.matrixWorldInverse);
    const W = window.innerWidth, H = window.innerHeight, m = 40;
    _p.project(cam);
    let x = (_p.x * 0.5 + 0.5) * W, y = (-_p.y * 0.5 + 0.5) * H;
    const behind = _cam.z > 0;
    const off = behind || x < m || x > W - m || y < m || y > H - m;
    el.classList.remove('hidden');
    el.classList.toggle('off', off);
    if (off) {
      const cx = W / 2, cy = H / 2;
      const ang = behind ? (_cam.x >= 0 ? 0.35 : Math.PI - 0.35) : Math.atan2(y - cy, x - cx);
      const ux = Math.cos(ang), uy = Math.sin(ang);
      const r = Math.min((cx - m) / Math.max(Math.abs(ux), 1e-4), (cy - m) / Math.max(Math.abs(uy), 1e-4));
      x = cx + ux * r; y = cy + uy * r;
      el.querySelector('.ge-arrow').style.transform = `rotate(${ang}rad)`;
    }
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    const txt = dist > 2.5 ? Math.round(dist) + ' m' : '';
    if (txt !== this._dist) { this._dist = txt; $('ge-dist').textContent = txt; }
  }
}
