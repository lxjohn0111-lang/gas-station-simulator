import * as THREE from 'three';
import { SHOP } from '../world/shop.js';
import { LAYOUT } from '../world/station.js';
import { PRODUCTS, FUELS, productMesh } from './products.js';
import { canvasTexture, roundRect } from '../gfx/textures.js';
import { boxGeo } from '../gfx/materials.js';
import { clamp, rand, pick, money, chance, easeOutCubic } from '../core/utils.js';

const FY = LAYOUT.shop.floor;
const TOP = FY + SHOP.counter.h;
const DENOMS = [20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01];
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Checkout: queue management + the 3D cash register mini-game.
 */
export class Register {
  constructor(game) {
    this.game = game;
    this.queue = [];
    this.current = null;     // customer being served
    this.items = [];         // counter items {mesh, line, scanned}
    this.lines = [];         // scanned lines
    this.state = 'idle';     // idle | scanning | cash | card | done
    this.active = false;     // player in register mode
    this.targets = [];
    this.given = 0;
    this.keyed = '';
    this.cashier = null;     // hired employee
    this.cashierTimer = 0;
    this.build();
  }

  get busy() { return this.state !== 'idle'; }

  // ------------------------------------------------------------ 3D build
  build() {
    const g = this.game, M = g.mats;
    const grp = new THREE.Group(); g.scene.add(grp); this.group = grp;
    const X = SHOP.counter.x;
    // monitor
    this.screenTex = canvasTexture(512, 400, () => {}, { mipmaps: false });
    const mon = new THREE.Group();
    const bez = new THREE.Mesh(boxGeo(0.06, 0.34, 0.44, 0), M.blackPlastic); mon.add(bez);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.31), new THREE.MeshStandardMaterial({ map: this.screenTex, emissiveMap: this.screenTex, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.25 }));
    scr.rotation.y = -Math.PI / 2; scr.position.x = -0.031; mon.add(scr);
    const stand = new THREE.Mesh(boxGeo(0.05, 0.22, 0.06, 0), M.darkMetal); stand.position.set(0.02, -0.25, 0); mon.add(stand);
    mon.position.set(X + 0.2, TOP + 0.38, 4.2); mon.rotation.z = -0.12;
    grp.add(mon);
    this.monitor = mon;
    scr.userData.reg = { type: 'monitor' };
    // register body / printer
    const body = new THREE.Mesh(boxGeo(0.4, 0.12, 0.5, 0), M.paint(0x2a2c30, 0.5, 0.3)); body.position.set(X - 0.1, TOP + 0.06, 4.2); body.castShadow = true; grp.add(body);
    // scanner
    const scanner = new THREE.Mesh(boxGeo(0.26, 0.03, 0.26, 0), M.blackPlastic); scanner.position.set(X - 0.05, TOP + 0.015, 3.45); grp.add(scanner);
    this.scanGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.18), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.6 }));
    this.scanGlow.rotation.x = -Math.PI / 2; this.scanGlow.position.set(X - 0.05, TOP + 0.032, 3.45); grp.add(this.scanGlow);
    // paper bag
    const bag = new THREE.Mesh(boxGeo(0.22, 0.3, 0.16, 0), new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.95 }));
    bag.position.set(X - 0.05, TOP + 0.15, 2.75); bag.castShadow = true; grp.add(bag); this.bagPos = bag.position.clone().add(new THREE.Vector3(0, 0.12, 0));
    // cash drawer
    const drawer = new THREE.Group();
    const tray = new THREE.Mesh(boxGeo(0.42, 0.08, 0.5, 0), M.paint(0x1d1f22, 0.6, 0.4)); drawer.add(tray);
    this.denomMeshes = [];
    DENOMS.forEach((d, i) => {
      const isBill = d >= 1;
      const col = isBill ? i : i - 4;
      let m;
      if (isBill) {
        const tex = billTexture(d);
        m = new THREE.Mesh(boxGeo(0.08, 0.03, 0.11, 0), [M.whitePlastic, M.whitePlastic, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), M.whitePlastic, M.whitePlastic, M.whitePlastic]);
        m.position.set(0.08, 0.05, -0.18 + col * 0.12);
      } else {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 18), new THREE.MeshStandardMaterial({ color: d === 0.01 ? 0xb87333 : 0xd8d8d8, metalness: 0.9, roughness: 0.3 }));
        m.position.set(-0.1, 0.05, -0.18 + col * 0.12);
      }
      m.userData.reg = { type: 'denom', value: d };
      drawer.add(m); this.denomMeshes.push(m); this.targets.push(m);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.035), new THREE.MeshBasicMaterial({ map: labelTex(d >= 1 ? '$' + d : Math.round(d * 100) + '¢'), transparent: true }));
      lbl.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); lbl.position.set(m.position.x + (isBill ? -0.0 : 0), 0.072, m.position.z - 0.0); lbl.position.x += isBill ? -0.0 : 0; lbl.position.y = isBill ? 0.07 : 0.07;
      lbl.position.x = m.position.x + (isBill ? 0 : 0); lbl.position.z = m.position.z; lbl.position.y = 0.068;
      lbl.renderOrder = 3; lbl.position.x += isBill ? 0 : 0;
      drawer.add(lbl);
    });
    drawer.position.set(X - 0.45, TOP - 0.1, 4.15);
    this.drawerClosedX = drawer.position.x; this.drawerOpen = 0;
    grp.add(drawer); this.drawer = drawer;
    // keypad (for card amounts) + clear/ok
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '.'];
    const pad = new THREE.Group();
    const base = new THREE.Mesh(boxGeo(0.26, 0.02, 0.3, 0), M.blackPlastic); pad.add(base);
    keys.forEach((k, i) => {
      const row = Math.floor(i / 3), col = i % 3;
      const key = new THREE.Mesh(boxGeo(0.06, 0.02, 0.06, 0), new THREE.MeshStandardMaterial({ map: labelTex(k, '#e8e8e8', '#111'), roughness: 0.5 }));
      key.position.set(0.09 - row * 0.065 + 0.0, 0.018, -0.08 + col * 0.075);
      key.rotation.y = -Math.PI / 2;
      key.userData.reg = { type: 'key', key: k };
      pad.add(key); this.targets.push(key);
    });
    const ok = new THREE.Mesh(boxGeo(0.21, 0.02, 0.06, 0), new THREE.MeshStandardMaterial({ map: labelTex('OK', '#2fbf5a', '#fff'), roughness: 0.5 }));
    ok.position.set(-0.17, 0.018, 0); ok.rotation.y = -Math.PI / 2; ok.userData.reg = { type: 'ok' }; pad.add(ok); this.targets.push(ok);
    pad.position.set(X - 0.2, TOP + 0.01, 4.82);
    grp.add(pad); this.pad = pad;
    // "given change" counter and clear button
    const giveBtn = new THREE.Mesh(boxGeo(0.12, 0.03, 0.12, 0), new THREE.MeshStandardMaterial({ map: labelTex('GIVE', '#ffb52e', '#111'), roughness: 0.5 }));
    giveBtn.position.set(X - 0.12, TOP + 0.015, 3.85); giveBtn.rotation.y = -Math.PI / 2; giveBtn.userData.reg = { type: 'give' }; grp.add(giveBtn); this.targets.push(giveBtn);
    const clr = new THREE.Mesh(boxGeo(0.12, 0.03, 0.12, 0), new THREE.MeshStandardMaterial({ map: labelTex('UNDO', '#ff6b6b', '#111'), roughness: 0.5 }));
    clr.position.set(X - 0.12, TOP + 0.015, 3.68); clr.rotation.y = -Math.PI / 2; clr.userData.reg = { type: 'clear' }; grp.add(clr); this.targets.push(clr);
    this.targets.push(scr);
    // interaction hook to enter register mode
    for (const m of [bez, body, scr]) { m.userData.interact = { system: this, kind: 'register' }; }
    g.interact.add(mon); g.interact.add(body);
    this.hover = null;
    this.drawScreen();
  }

  // ------------------------------------------------------------ queue
  join(c) { if (!this.queue.includes(c)) this.queue.push(c); }
  indexOf(c) { return this.queue.indexOf(c); }
  leave(c) {
    const i = this.queue.indexOf(c);
    if (i < 0) return;
    this.queue.splice(i, 1);
    if (c === this.current) this.reset();
    for (const o of this.queue) this.game.customers.onQueueAdvance(o);
  }
  arrived(c) {
    if (this.queue[0] !== c || this.current) return;
    this.current = c;
    this.state = 'scanning';
    this.lines = []; this.given = 0; this.givenStack = []; this.keyed = '';
    this.startTime = performance.now();
    this.placeItems(c);
    this.drawScreen();
    c.say('neutral');
    this.game.audio.play('chime', { pos: SHOP.payerSpot, vol: 0.25 });
    this.game.tutorial.event('customerAtRegister', c);
  }

  placeItems(c) {
    const X = SHOP.counter.x;
    const n = c.basket.length;
    c.basket.forEach((b, i) => {
      let mesh;
      if (b.kind === 'product') { mesh = productMesh(b.id); mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone(); }
      else if (b.kind === 'extra') mesh = extraMesh(b.id);
      else mesh = fuelTicketMesh(b);
      const row = Math.floor(i / 4), col = i % 4;
      const target = new THREE.Vector3(X + 0.22 - row * 0.12, TOP + 0.005, 3.1 + col * 0.14 + (n < 3 ? 0.15 : 0));
      mesh.position.copy(c.pos).setY(TOP + 0.3);
      mesh.rotation.y = rand(-0.4, 0.4);
      this.game.scene.add(mesh);
      const idx = this.items.length;
      const clickable = mesh.userData.hit || mesh;
      clickable.userData.reg = { type: 'item', index: idx };
      mesh.userData.reg = { type: 'item', index: idx };
      const it = { mesh, line: b, scanned: false, target, t: 0, clickable };
      this.items.push(it);
      this.targets.push(clickable);
    });
  }

  reset() {
    for (const it of this.items) { it.mesh.removeFromParent(); const k = this.targets.indexOf(it.clickable || it.mesh); if (k >= 0) this.targets.splice(k, 1); }
    this.items = []; this.lines = [];
    this.current = null; this.state = 'idle'; this.given = 0; this.keyed = ''; this.givenStack = [];
    this.drawScreen();
  }

  get total() { return r2(this.lines.reduce((a, l) => a + l.price, 0)); }

  // ------------------------------------------------------------ interaction (enter mode)
  prompt(it, player) {
    if (this.active) return null;
    if (player.held) return { text: 'Register', sub: 'Put down what you carry first (Q)' };
    const c = this.queue[0];
    return { key: 'E', text: 'Use register', sub: c ? `${this.queue.length} customer${this.queue.length > 1 ? 's' : ''} waiting` : 'No customers yet' };
  }
  interact(it, player, action) {
    if (action === 'E' && !player.held) { this.enter(); return true; }
    return false;
  }

  enter() {
    const g = this.game;
    this.active = true;
    g.player.enterFixedView(new THREE.Vector3(SHOP.counter.x - 1.45, FY + 1.63, 4.1), new THREE.Vector3(SHOP.counter.x - 0.2, TOP - 0.2, 4.08));
    g.input.cursorMode = true;
    g.input.exitLock();
    g.ui.registerMode(true);
    this.updateHelp();
    g.tutorial.event('registerOpen');
  }
  exit() {
    const g = this.game;
    this.active = false;
    g.player.exitFixedView();
    g.input.cursorMode = false;
    g.ui.registerMode(false);
    g.input.requestLock(); g.lockHint && g.lockHint();
  }

  // ------------------------------------------------------------ click handling
  click(obj) {
    const g = this.game;
    const r = obj && obj.userData.reg;
    if (!r) return;
    if (r.type === 'item' && this.state === 'scanning') {
      const it = this.items[r.index];
      if (!it || it.scanned) return;
      it.scanned = true; it.flyT = 0; it.from = it.mesh.position.clone();
      this.lines.push(it.line);
      g.audio.play('beep', { pos: it.mesh.position });
      this.scanGlow.material.color.set(0x2aff6a); setTimeout(() => this.scanGlow.material.color.set(0xff2a1a), 150);
      if (this.items.every((x) => x.scanned)) this.startPayment();
      this.drawScreen(); this.updateHelp();
      return;
    }
    if (r.type === 'denom' && this.state === 'cash') {
      this.given = r2(this.given + r.value); this.givenStack.push(r.value);
      g.audio.play(r.value >= 1 ? 'paper' : 'coin', { pos: obj.getWorldPosition(new THREE.Vector3()), vol: 0.7 });
      this.drawScreen(); this.updateHelp();
      return;
    }
    if (r.type === 'clear') {
      if (this.state === 'cash' && this.givenStack.length) { const v = this.givenStack.pop(); this.given = r2(this.given - v); }
      if (this.state === 'card') this.keyed = this.keyed.slice(0, -1);
      g.audio.play('key'); this.drawScreen(); this.updateHelp();
      return;
    }
    if (r.type === 'give' && this.state === 'cash') { this.confirmCash(); return; }
    if (r.type === 'key' && this.state === 'card') {
      g.audio.play('key');
      if (r.key === 'C') this.keyed = '';
      else if (r.key === '.') { if (!this.keyed.includes('.')) this.keyed += this.keyed ? '.' : '0.'; }
      else if (this.keyed.length < 7) { const parts = this.keyed.split('.'); if (!(parts[1] && parts[1].length >= 2)) this.keyed += r.key; }
      this.drawScreen(); this.updateHelp();
      return;
    }
    if (r.type === 'ok') {
      if (this.state === 'card') this.confirmCard();
      else if (this.state === 'cash') this.confirmCash();
      return;
    }
    if (r.type === 'key' && this.state === 'cash') { g.audio.play('error'); return; }
  }

  startPayment() {
    const c = this.current;
    const total = this.total;
    const cash = chance(0.6);
    if (cash) {
      this.state = 'cash';
      // customer pays with a sensible amount
      const opts = [Math.ceil(total), Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 20) * 20, Math.ceil(total / 50) * 50].filter((v) => v >= total);
      let paid = pick(opts.slice(0, 4));
      if (paid === total && chance(0.7)) paid = Math.ceil(total / 10) * 10 + (total % 10 === 0 ? 10 : 0);
      this.paid = paid; this.changeDue = r2(paid - total);
      this.drawerTarget = 1;
      this.game.audio.play('drawer');
      if (this.changeDue === 0) { this.game.after(0.5, () => this.finish(true, 0)); }
    } else {
      this.state = 'card';
      this.paid = total; this.changeDue = 0;
    }
    c.char.reach = 1.0;
    this.drawScreen(); this.updateHelp();
  }

  confirmCash() {
    const g = this.game, c = this.current;
    const diff = r2(this.given - this.changeDue);
    if (diff < 0) {
      g.audio.play('error');
      c.say('angry', `Hey! That's short ${money(-diff)}!`);
      c.setMood(-0.08);
      this.mistakes = (this.mistakes || 0) + 1;
      return;
    }
    this.finish(true, diff);
  }

  confirmCard() {
    const g = this.game, c = this.current;
    const v = parseFloat(this.keyed || '0');
    if (Math.abs(v - this.total) < 0.005) { this.finish(true, 0); return; }
    g.audio.play('error');
    c.say(v > this.total ? 'angry' : 'question', v > this.total ? `That's ${money(v)}?! No way!` : 'Uh, that\'s not the total...');
    c.setMood(-0.08);
    this.keyed = '';
    this.mistakes = (this.mistakes || 0) + 1;
    this.drawScreen(); this.updateHelp();
  }

  finish(ok, overpaid = 0) {
    const g = this.game, c = this.current;
    if (!c) return;
    const secs = (performance.now() - this.startTime) / 1000;
    const total = this.total;
    // fuel lines settle with accuracy
    let tip = 0, rep = 0.02, xp = 6 + this.lines.length * 3, perfectFuel = false;
    for (const l of this.lines) {
      if (l.kind === 'fuel' && l.service) {
        const res = g.fuel.settle(l.service);
        tip += res.tip; rep += res.rep; xp += res.xp;
        if (res.billLiters < l.liters) { const refund = (l.liters - res.billLiters) * g.fuel.prices[l.fuelType]; tip -= refund; }
        perfectFuel = perfectFuel || res.perfect;
      }
    }
    const fast = secs < 8 + this.lines.length * 2.5;
    if (fast && !this.mistakes) { tip += total * rand(0.03, 0.1); rep += 0.01; }
    if (c.traits.generous) tip *= 1.5;
    if (c.mood < 0.35) tip *= 0.3;
    tip = Math.max(-total, r2(tip));
    const earned = r2(total - overpaid);
    g.economy.earn(earned, 'Register', SHOP.payerSpot.clone().setY(2), { sale: 'register', items: this.lines.filter((l) => l.kind === 'product').length });
    if (tip > 0.009) g.economy.earn(tip, 'Tip', SHOP.payerSpot.clone().setY(2.4), { tip: true });
    else if (tip < -0.009) g.economy.spend(-tip, 'Fuel refund');
    g.economy.addXP(xp);
    g.economy.rep(this.mistakes ? rep - 0.02 * this.mistakes : rep, null);
    g.economy.stats.registerCustomers++;
    g.audio.play('cash', { pos: SHOP.payerSpot });
    const happy = !this.mistakes && c.mood > 0.3;
    const line = overpaid > 0.009 ? pick(['Ooh, extra change? Thanks!', 'Sweet, free money.']) : happy ? pick(['Thanks, partner!', 'Have a good one!', 'Fast service, love it.', 'See ya!']) : pick(['Finally.', 'About time...', 'Whatever.']);
    if (perfectFuel) g.ui.toast('⛽ Perfect fuel amount bonus!', 'good');
    this.drawerTarget = 0;
    this.state = 'done';
    this.drawScreen(this.lastReceipt = { total, tip, paid: this.paid });
    g.after(0.45, () => {
      this.queue.shift();
      this.reset();
      g.customers.onPaid(c, { happy, line });
      for (const o of this.queue) g.customers.onQueueAdvance(o);
      this.updateHelp();
    });
    this.mistakes = 0;
    g.tutorial.event('registerPaid');
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    // animate counter items
    for (const it of this.items) {
      it.t = Math.min(1, it.t + dt * 2.2);
      if (!it.scanned) {
        const k = easeOutCubic(it.t);
        const p = it.mesh.position;
        p.lerp(it.target, k * 0.35 + 0.05);
        if (it.t >= 1) p.copy(it.target);
      } else {
        it.flyT = Math.min(1, it.flyT + dt * 3.5);
        const k = easeOutCubic(it.flyT);
        it.mesh.position.lerpVectors(it.from, this.bagPos, k);
        it.mesh.position.y += Math.sin(k * Math.PI) * 0.18;
        it.mesh.scale.setScalar(1 - k * 0.6);
        if (it.flyT >= 1) it.mesh.visible = false;
      }
    }
    // drawer slide
    this.drawerOpen = THREE.MathUtils.lerp(this.drawerOpen, this.drawerTarget || 0, 1 - Math.exp(-10 * dt));
    this.drawer.position.x = this.drawerClosedX - this.drawerOpen * 0.24;
    // hover highlight in register mode
    if (this.active) {
      const hit = g.player.pointerPick(this.targets);
      const obj = hit ? hit.object : null;
      if (obj !== this.hover) {
        if (this.hover && this.hover.material && this.hover.material.emissive) this.hover.material.emissive.setHex(this.hover.userData.prevEm || 0);
        this.hover = obj;
        if (obj && obj.material && obj.material.emissive && obj.userData.reg && obj.userData.reg.type !== 'monitor') { obj.userData.prevEm = obj.material.emissive.getHex(); obj.material.emissive.setHex(0x553300); }
      }
      document.body.style.cursor = obj && obj.userData.reg && obj.userData.reg.type !== 'monitor' ? 'pointer' : 'default';
      if (g.input.mousePressed(0) && obj) this.click(obj);
      if (g.input.pressed('KeyE') || g.input.pressed('Escape')) this.exit();
      // keyboard shortcuts for card amounts
      if (this.state === 'card') {
        for (let d = 0; d <= 9; d++) if (g.input.pressed('Digit' + d) || g.input.pressed('Numpad' + d)) this.click({ userData: { reg: { type: 'key', key: String(d) } } });
        if (g.input.pressed('Period') || g.input.pressed('NumpadDecimal')) this.click({ userData: { reg: { type: 'key', key: '.' } } });
        if (g.input.pressed('Backspace')) this.click({ userData: { reg: { type: 'clear' } } });
        if (g.input.pressed('Enter') || g.input.pressed('NumpadEnter')) this.confirmCard();
      }
      if (this.state === 'cash' && (g.input.pressed('Enter') || g.input.pressed('Space'))) this.confirmCash();
      if (this.state === 'scanning' && g.input.pressed('Space')) { const it = this.items.find((x) => !x.scanned); if (it) this.click(it.mesh); }
    }
    // hired cashier auto-serves when the player isn't at the register
    if (this.cashier && !this.active && this.current && this.state !== 'done') {
      this.cashierTimer += dt;
      if (this.cashierTimer > 2.2) {
        this.cashierTimer = 0;
        if (this.state === 'scanning') { const it = this.items.find((x) => !x.scanned); if (it) this.click(it.mesh); }
        else if (this.state === 'cash') { this.given = this.changeDue; this.finish(true, 0); }
        else if (this.state === 'card') { this.keyed = this.total.toFixed(2); this.finish(true, 0); }
      }
    }
  }

  updateHelp() {
    const g = this.game;
    if (!this.active) return;
    let html;
    if (!this.current) html = this.queue.length ? 'Waiting for the next customer to step up…' : 'No customers at the counter. <b>E</b> to leave.';
    else if (this.state === 'scanning') html = `Click the items on the counter to <b>SCAN</b> them (${this.items.filter((i) => i.scanned).length}/${this.items.length})  <span style="opacity:.6">[SPACE]</span>`;
    else if (this.state === 'cash') html = `💵 Customer paid <b>${money(this.paid)}</b> — give <b>${money(this.changeDue)}</b> change. Given: <b style="color:${Math.abs(this.given - this.changeDue) < 0.005 ? '#5f5' : '#fff'}">${money(this.given)}</b> → click bills/coins, then <b>GIVE</b>`;
    else if (this.state === 'card') html = `💳 Card payment — type <b>${money(this.total)}</b> on the keypad and press <b>OK</b>. Entered: <b>$${this.keyed || '0'}</b>`;
    else html = 'Done! ✔';
    g.ui.registerHelp(html);
  }

  drawScreen() {
    const ctx = this.screenTex.userData.ctx, w = 512, h = 400;
    ctx.fillStyle = '#0b1e2e'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d6fd1'; ctx.fillRect(0, 0, w, 44);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'left'; ctx.fillText('LAST CHANCE POS', 14, 30);
    ctx.textAlign = 'right'; ctx.fillText(this.state.toUpperCase(), w - 14, 30);
    ctx.font = '20px "Courier New", monospace'; ctx.textAlign = 'left';
    let y = 74;
    for (const l of this.lines.slice(-7)) {
      const name = l.kind === 'fuel' ? `FUEL ${FUELS[l.fuelType].short} ${l.liters.toFixed(2)}L` : l.kind === 'extra' ? l.name : PRODUCTS[l.id].name;
      ctx.fillStyle = '#cfe8ff'; ctx.fillText(name.slice(0, 26), 14, y);
      ctx.textAlign = 'right'; ctx.fillText(l.price.toFixed(2), w - 14, y); ctx.textAlign = 'left';
      y += 28;
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(14, h - 128, w - 28, 2);
    ctx.font = 'bold 34px "Courier New", monospace';
    ctx.fillStyle = '#7dff9e'; ctx.fillText('TOTAL', 14, h - 88); ctx.textAlign = 'right'; ctx.fillText('$' + this.total.toFixed(2), w - 14, h - 88); ctx.textAlign = 'left';
    ctx.font = 'bold 24px "Courier New", monospace';
    if (this.state === 'cash') {
      ctx.fillStyle = '#ffd36b'; ctx.fillText(`PAID $${this.paid.toFixed(2)}  CHANGE $${this.changeDue.toFixed(2)}`, 14, h - 52);
      ctx.fillStyle = Math.abs(this.given - this.changeDue) < 0.005 ? '#7dff9e' : '#ffffff'; ctx.fillText(`GIVEN $${this.given.toFixed(2)}`, 14, h - 18);
    } else if (this.state === 'card') {
      ctx.fillStyle = '#ffd36b'; ctx.fillText('CARD: ENTER AMOUNT', 14, h - 52);
      ctx.fillStyle = '#fff'; ctx.fillText(`$${this.keyed || '0'}_`, 14, h - 18);
    } else if (this.state === 'done') {
      ctx.fillStyle = '#7dff9e'; ctx.fillText('APPROVED ✔  THANK YOU!', 14, h - 40);
    } else if (!this.current) {
      ctx.fillStyle = '#8fb3d9'; ctx.fillText(this.queue.length ? 'NEXT CUSTOMER…' : 'READY', 14, h - 40);
    }
    this.screenTex.needsUpdate = true;
  }

  serialize() { return {}; }
}

function billTexture(d) {
  return canvasTexture(128, 160, (ctx, w, h) => {
    ctx.fillStyle = '#9fc79a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3d6b3a'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#2b4f29'; ctx.font = 'bold 54px Georgia'; ctx.textAlign = 'center'; ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('$' + d, 0, 18); ctx.restore();
  });
}
const labelCache = new Map();
function labelTex(txt, bg = 'rgba(0,0,0,0)', fg = '#fff') {
  const k = txt + bg + fg;
  if (labelCache.has(k)) return labelCache.get(k);
  const t = canvasTexture(128, 64, (ctx, w, h) => {
    if (bg !== 'rgba(0,0,0,0)') { ctx.fillStyle = bg; roundRect(ctx, 2, 2, w - 4, h - 4, 10); ctx.fill(); }
    ctx.fillStyle = fg; ctx.font = 'bold 38px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (bg === 'rgba(0,0,0,0)') { ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.strokeText(txt, w / 2, h / 2 + 2); }
    ctx.fillText(txt, w / 2, h / 2 + 2);
  });
  labelCache.set(k, t);
  return t;
}
function extraMesh(id) {
  const g = new THREE.Group();
  if (id === 'coffee') {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.034, 0.13, 14), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.6 }));
    cup.position.y = 0.065;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.015, 14), new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.5 }));
    lid.position.y = 0.135;
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.039, 0.05, 14), new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.9 }));
    sleeve.position.y = 0.07;
    g.add(cup, lid, sleeve);
  } else {
    const bun = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.12, 4, 8), new THREE.MeshStandardMaterial({ color: 0xd9a05a, roughness: 0.8 }));
    bun.rotation.z = Math.PI / 2; bun.scale.set(1, 1, 1.4); bun.position.y = 0.03;
    const dog = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.15, 4, 8), new THREE.MeshStandardMaterial({ color: 0xa8402a, roughness: 0.4 }));
    dog.rotation.z = Math.PI / 2; dog.position.y = 0.055;
    const mustard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.006, 0.008), new THREE.MeshStandardMaterial({ color: 0xf2c200 }));
    mustard.position.y = 0.075;
    g.add(bun, dog, mustard);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.reg = null; } });
  // clickable proxy covering the group
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.07; g.add(hit);
  g.userData.hit = hit;
  return g;
}

function fuelTicketMesh(b) {
  const tex = canvasTexture(128, 192, (ctx, w, h) => {
    ctx.fillStyle = '#fbfaf5'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = FUELS[b.fuelType].color; ctx.fillRect(0, 0, w, 36);
    ctx.fillStyle = '#111'; ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.fillText('PUMP', w / 2, 26);
    ctx.font = 'bold 20px "Courier New"'; ctx.fillText(FUELS[b.fuelType].name.toUpperCase(), w / 2, 70);
    ctx.fillText(b.liters.toFixed(2) + ' L', w / 2, 110); ctx.font = 'bold 28px "Courier New"'; ctx.fillText('$' + b.price.toFixed(2), w / 2, 160);
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.004, 0.13), [new THREE.MeshStandardMaterial({ color: 0xffffff }), new THREE.MeshStandardMaterial({ color: 0xffffff }), new THREE.MeshStandardMaterial({ map: tex, emissive: 0x222222 }), new THREE.MeshStandardMaterial({ color: 0xffffff }), new THREE.MeshStandardMaterial({ color: 0xffffff }), new THREE.MeshStandardMaterial({ color: 0xffffff })]);
  m.castShadow = true;
  return m;
}
