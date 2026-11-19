import * as THREE from 'three';
import { FUELS } from './products.js';
import { LAYOUT } from '../world/station.js';
import { canvasTexture, grime } from '../gfx/textures.js';
import { boxGeo } from '../gfx/materials.js';
import { clamp, rand, pick, money } from '../core/utils.js';

const FUEL_ORDER = ['regular', 'diesel', 'premium'];
const HOSE_LEN = 5.2;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/**
 * Pumps, nozzles, hoses, fuel tanks and the fuelling mini-game.
 */
export class FuelSystem {
  constructor(game) {
    this.game = game;
    this.pumps = [];
    this.nozzles = [];
    this.services = new Set();
    this.tanks = { regular: 1400, diesel: 800, premium: 0 };
    this.capacity = 3000;
    this.prices = { regular: FUELS.regular.price, diesel: FUELS.diesel.price, premium: FUELS.premium.price };
    this.market = { regular: 1, diesel: 1, premium: 1 };
    this.flowBase = 2.4;
    this.autoStop = false;
    this.pumping = null; // nozzle being pumped this frame
    this.pumpLoop = null;
    this.screenTimer = 0;
  }

  build() {
    for (let i = 0; i < LAYOUT.islandXs.length; i++) this.pumps.push(this.buildPump(i));
    this.refreshActive();
  }

  refreshActive() {
    const st = this.game.station;
    for (const p of this.pumps) {
      const active = st.islands[p.island].active;
      p.group.visible = active;
      p.collider.enabled !== active && this.game.colliders.setEnabled(p.collider, active);
      for (const n of p.nozzles) {
        const unlocked = n.fuelType !== 'premium' || this.game.upgrades.has('premium');
        n.enabled = active && unlocked;
        n.group.visible = active && unlocked;
        n.hose.visible = active && unlocked;
        n.lockCap.visible = active && !unlocked;
      }
    }
    this.game.traffic.setupSlots(st.islands.map((i) => i.active));
  }

  // ------------------------------------------------------------ pump model
  buildPump(island) {
    const g = this.game, M = g.mats;
    const x = LAYOUT.islandXs[island], z = LAYOUT.islandZ;
    const group = new THREE.Group();
    group.position.set(x, 0.18, z);
    g.scene.add(group);
    const add = (geo, mat, px, py, pz, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = cast; m.receiveShadow = true; group.add(m); return m; };
    add(boxGeo(1.35, 0.22, 0.85, 1), M.paint(0x3a3a3c, 0.6, 0.4), 0, 0.11, 0);
    const faceTex = canvasTexture(512, 860, (ctx, w, h) => {
      ctx.fillStyle = '#f2f0ea'; ctx.fillRect(0, 0, w, h);
      const gr = ctx.createLinearGradient(0, h * 0.62, 0, h); gr.addColorStop(0, '#c22a1f'); gr.addColorStop(1, '#8c1c14');
      ctx.fillStyle = gr; ctx.fillRect(0, h * 0.64, w, h * 0.36);
      ctx.fillStyle = '#ffb52e'; ctx.fillRect(0, h * 0.62, w, h * 0.025);
      ctx.fillStyle = '#1b1b1f'; ctx.fillRect(w * 0.12, h * 0.05, w * 0.76, h * 0.26); // screen bezel
      // fuel labels row
      FUEL_ORDER.forEach((f, i) => {
        const cx = w * (0.2 + i * 0.3);
        ctx.fillStyle = FUELS[f].color; ctx.fillRect(cx - 52, h * 0.36, 104, 56);
        ctx.fillStyle = '#111'; ctx.font = 'bold 30px Arial Black, Arial'; ctx.textAlign = 'center'; ctx.fillText(FUELS[f].short, cx, h * 0.36 + 40);
      });
      ctx.fillStyle = '#fff'; ctx.font = 'bold 44px Impact'; ctx.textAlign = 'center'; ctx.fillText('LAST CHANCE GAS', w / 2, h * 0.78);
      ctx.font = 'bold 26px Arial'; ctx.fillText('PAY AT PUMP OR INSIDE', w / 2, h * 0.84);
      ctx.fillStyle = '#ffd400'; ctx.fillRect(w * 0.08, h * 0.89, w * 0.84, h * 0.06); ctx.fillStyle = '#111'; ctx.font = 'bold 22px Arial'; ctx.fillText('⚠ NO SMOKING • STOP ENGINE', w / 2, h * 0.93);
      grime(ctx, w, h, 0.12, '60,40,20');
    });
    const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.45, metalness: 0.15 });
    const side = M.paint(0xe9e6df, 0.45, 0.2);
    add(new THREE.BoxGeometry(1.08, 1.85, 0.56), [side, side, side, side, faceMat, faceMat], 0, 0.22 + 0.925, 0);
    // header with glowing logo
    const hdrTex = canvasTexture(512, 192, (ctx, w, h) => {
      ctx.fillStyle = '#c22a1f'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffb52e'; ctx.fillRect(0, h - 18, w, 8);
      ctx.fillStyle = '#fff8ea'; ctx.font = 'bold 92px Impact'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('LCG ⛽', w / 2, h / 2);
    });
    const hdrMat = g.station.nightMat(new THREE.MeshStandardMaterial({ map: hdrTex, emissiveMap: hdrTex, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.4 }), 1.4);
    add(new THREE.BoxGeometry(1.18, 0.42, 0.62), [side, side, side, side, hdrMat, hdrMat], 0, 2.3, 0);
    const collider = g.colliders.addBox(x, z, 0.62, 0.32, 0, 0.18, 2.5);
    const pump = { island, group, x, z, faces: [], nozzles: [], collider };
    // faces: S (-Z side, serves lane S) and N (+Z side, serves lane N)
    for (const [faceName, sz] of [['S', -1], ['N', 1]]) {
      const screenTex = canvasTexture(256, 160, () => {}, { mipmaps: false });
      const screen = add(new THREE.PlaneGeometry(0.62, 0.39), new THREE.MeshStandardMaterial({ map: screenTex, emissiveMap: screenTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.2 }), 0, 0.22 + 1.6, sz * 0.285, false);
      screen.rotation.y = sz > 0 ? 0 : Math.PI;
      const face = { name: faceName, sz, screenTex, liters: 0, cost: 0, fuelType: null, dirty: true };
      pump.faces.push(face);
      this.drawScreen(face);
      FUEL_ORDER.forEach((ft, i) => {
        const hx = (i - 1) * 0.31 * -sz; // mirror so order reads left→right on each face
        const holster = add(boxGeo(0.14, 0.2, 0.1, 0), M.darkMetal, hx, 0.22 + 0.98, sz * 0.31);
        void holster;
        const n = this.makeNozzle(ft);
        const holsterLocal = new THREE.Vector3(hx, 0.22 + 1.02, sz * 0.38);
        n.group.position.copy(holsterLocal).add(group.position);
        n.homeRot = new THREE.Euler(0, sz > 0 ? 0 : Math.PI, 0);
        n.group.rotation.copy(n.homeRot);
        g.scene.add(n.group);
        const anchor = new THREE.Vector3(hx * 1.2, 0.22 + 1.85, sz * 0.29).add(group.position);
        const nozzle = Object.assign(n, { pump, face, fuelType: ft, state: 'holstered', home: n.group.position.clone(), anchor, car: null, service: null, enabled: true });
        nozzle.hose = new THREE.Mesh(new THREE.BufferGeometry(), g.mats.hose);
        nozzle.hose.castShadow = true;
        g.scene.add(nozzle.hose);
        // padlock cap for locked premium
        const lock = add(boxGeo(0.12, 0.12, 0.06, 0), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4 }), hx, 0.22 + 1.02, sz * 0.36);
        nozzle.lockCap = lock;
        nozzle.group.traverse((o) => { if (o.isMesh) o.userData.interact = { system: this, kind: 'nozzle', nozzle }; });
        g.interact.add(nozzle.group);
        this.updateHose(nozzle, true);
        pump.nozzles.push(nozzle);
        this.nozzles.push(nozzle);
      });
    }
    // little extinguisher & paper towel dispenser for detail
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 10), M.redPaint, 0.62, 0.42, 0.2);
    add(boxGeo(0.18, 0.3, 0.12, 0), M.whitePlastic, -0.62, 1.25, 0);
    return pump;
  }

  makeNozzle(ft) {
    const M = this.game.mats;
    const g = new THREE.Group();
    const col = new THREE.MeshStandardMaterial({ color: FUELS[ft].hex, roughness: 0.45, metalness: 0.1 });
    const grip = new THREE.Mesh(boxGeo(0.055, 0.2, 0.07, 0), col); grip.position.set(0, -0.02, 0); grip.rotation.x = 0.25;
    const body = new THREE.Mesh(boxGeo(0.06, 0.08, 0.16, 0), M.darkMetal); body.position.set(0, 0.08, 0.06);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.2, 8), M.steel); spout.rotation.x = Math.PI / 2 + 0.35; spout.position.set(0, 0.06, 0.2);
    const trig = new THREE.Mesh(boxGeo(0.02, 0.02, 0.1, 0), M.steel); trig.position.set(0, 0.0, 0.05);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 4, 10, Math.PI), M.darkMetal); guard.position.set(0, 0.0, 0.04); guard.rotation.y = Math.PI / 2;
    g.add(grip, body, spout, trig, guard);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { group: g, spoutTip: new THREE.Vector3(0, 0.02, 0.29) };
  }

  /** Hose: anchor → sag → nozzle tail. */
  updateHose(n, force = false) {
    const tail = _v.set(0, 0.0, -0.05).applyQuaternion(n.group.quaternion).add(n.group.position);
    if (!force && n._lastTail && n._lastTail.distanceToSquared(tail) < 1e-5) return;
    n._lastTail = (n._lastTail || new THREE.Vector3()).copy(tail);
    const a = n.anchor;
    const dist = a.distanceTo(tail);
    const slack = Math.max(0, HOSE_LEN - dist);
    const mid = a.clone().lerp(tail, 0.5);
    const sag = Math.min(1.6, slack * 0.45 + 0.15);
    mid.y = Math.max(0.05, Math.min(a.y, tail.y) - sag);
    const p1 = a.clone().lerp(mid, 0.5); p1.y = Math.max(0.06, p1.y - sag * 0.25);
    const p2 = tail.clone().lerp(mid, 0.5); p2.y = Math.max(0.06, p2.y - sag * 0.25);
    const curve = new THREE.CatmullRomCurve3([a.clone(), p1, mid, p2, tail.clone()]);
    n.hose.geometry.dispose();
    n.hose.geometry = new THREE.TubeGeometry(curve, 28, 0.016, 6, false);
  }

  drawScreen(face) {
    const ctx = face.screenTex.userData.ctx, w = 256, h = 160;
    ctx.fillStyle = '#0d1a0f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7dff9e'; ctx.font = 'bold 18px "Courier New", monospace'; ctx.textAlign = 'left';
    ctx.fillText('SALE $', 10, 30); ctx.fillText('LITRES', 10, 82); ctx.fillText('PRICE/L', 10, 132);
    ctx.textAlign = 'right'; ctx.font = 'bold 40px "Courier New", monospace';
    ctx.shadowColor = '#7dff9e'; ctx.shadowBlur = 8;
    ctx.fillText(face.cost.toFixed(2), w - 10, 44);
    ctx.fillText(face.liters.toFixed(2), w - 10, 96);
    ctx.font = 'bold 28px "Courier New", monospace';
    ctx.fillText(face.fuelType ? this.prices[face.fuelType].toFixed(2) : '-.--', w - 10, 140);
    ctx.shadowBlur = 0;
    face.screenTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ services
  beginService(customer, slot, car) {
    const req = customer.fuelReq;
    const s = { customer, slot, car, fuelType: req.type, target: req.liters, dollars: req.dollars, full: req.full, dispensed: 0, state: 'waiting', nozzle: null, wrongFuel: false, idle: 0, warned: 0, accuracy: 0 };
    // pump face that serves this slot's lane
    const pump = this.pumps[slot.island];
    s.face = pump.faces.find((f) => f.name === slot.lane);
    s.face.liters = 0; s.face.cost = 0; s.face.fuelType = null; this.drawScreen(s.face);
    // fuel cap hitbox on the car
    const capWorld = car.worldPoint(car.m.fuelCap.local, new THREE.Vector3());
    const hb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hb.position.copy(car.m.fuelCap.local);
    car.group.add(hb);
    hb.userData.interact = { system: this, kind: 'fuelcap', service: s };
    this.game.interact.add(hb);
    s.capHit = hb; s.capWorld = capWorld;
    // ensure the cap faces the pump: if not, the customer parked "wrong side" - nozzle reaches anyway
    this.services.add(s);
    this.game.tutorial.event('carAtPump', s);
    return s;
  }

  endService(s) {
    if (!s || !this.services.has(s)) return;
    if (s.nozzle) {
      const n = s.nozzle;
      if (n.state === 'inCar') {
        // drove off with the nozzle!
        this.ripNozzle(n);
      }
    }
    if (s.capHit) { this.game.interact.remove(s.capHit); s.capHit.removeFromParent(); }
    if (s.car && s.car.m.fuelCap.door) s.car.m.fuelCap.door.rotation.y = s.car.m.fuelCap.side < 0 ? Math.PI : 0;
    this.services.delete(s);
  }

  ripNozzle(n) {
    const g = this.game;
    g.audio.play('backfire', { pos: n.group.position, vol: 0.6 });
    g.audio.play('boing', { pos: n.group.position });
    g.particles.sparks(n.group.position, { count: 20 });
    g.ui.toast('💥 Customer drove off with the nozzle still in! Hose repair -$40', 'bad');
    g.economy.spend(40, 'Hose repair');
    g.funny.report('driveoff', n.group.position.clone(), null);
    this.returnNozzle(n);
  }

  serviceForCar(car) { for (const s of this.services) if (s.car === car) return s; return null; }

  // ------------------------------------------------------------ interaction API
  prompt(it, player) {
    if (it.kind === 'nozzle') {
      const n = it.nozzle;
      if (!n.enabled) return null;
      if (n.state === 'holstered') {
        if (player.held && player.held.kind === 'nozzle') return { key: 'E', text: 'Hang up nozzle' };
        if (player.held) return { text: 'Hands full', sub: 'Press Q to drop what you carry' };
        const tank = this.tanks[n.fuelType];
        return { key: 'E', text: `Take ${FUELS[n.fuelType].name.toUpperCase()} nozzle`, sub: `${Math.floor(tank)} L in tank • $${this.prices[n.fuelType].toFixed(2)}/L`, color: FUELS[n.fuelType].color };
      }
      if (n.state === 'inCar') {
        const s = n.service;
        return { key: 'LMB', text: this.autoStop ? 'Click: Auto-fill' : 'Hold: Pump fuel', sub: `E: Remove nozzle • ${s ? this.requestText(s) : ''}` };
      }
      return null;
    }
    if (it.kind === 'fuelcap') {
      const s = it.service;
      if (s.state === 'done') return null;
      if (player.held && player.held.kind === 'nozzle') {
        const n = player.held.nozzle;
        const wrong = n.fuelType !== s.fuelType;
        return { key: 'LMB', text: 'Insert nozzle', sub: `Wants ${this.requestText(s)}${wrong ? '  ⚠ check the fuel type!' : ''}`, color: FUELS[s.fuelType].color };
      }
      if (s.nozzle) return null;
      return { text: `Wants ${this.requestText(s)}`, sub: 'Grab the matching nozzle from the pump', color: FUELS[s.fuelType].color };
    }
    return null;
  }

  requestText(s) {
    const f = FUELS[s.fuelType].name.toUpperCase();
    if (s.full) return `${f} • FILL IT UP`;
    if (s.dollars) return `${f} • $${s.dollars} worth`;
    return `${f} • ${s.target} L`;
  }

  interact(it, player, action) {
    const g = this.game;
    if (it.kind === 'nozzle') {
      const n = it.nozzle;
      if (!n.enabled) return;
      if (action === 'E') {
        if (n.state === 'holstered' && !player.held) {
          n.state = 'held';
          player.hold({ kind: 'nozzle', nozzle: n, system: this });
          g.audio.play('click', { pos: n.group.position, pitch: 0.6 });
          g.tutorial.event('nozzleTaken', n);
          return true;
        }
        if (n.state === 'holstered' && player.held && player.held.kind === 'nozzle') {
          this.returnNozzle(player.held.nozzle); player.drop(true);
          return true;
        }
        if (n.state === 'inCar' && !player.held) {
          this.removeFromCar(n, player);
          return true;
        }
      }
      if (action === 'useStart' && n.state === 'inCar') { this.startPump(n); return true; }
    }
    if (it.kind === 'fuelcap' && action === 'useStart' && player.held && player.held.kind === 'nozzle') {
      const s = it.service;
      if (s.nozzle || s.state === 'done') return false;
      this.insert(player.held.nozzle, s, player);
      return true;
    }
    return false;
  }

  insert(n, s, player) {
    const g = this.game;
    player.drop(true);
    n.state = 'inCar'; n.service = s; n.car = s.car; s.nozzle = n;
    s.state = 'fueling';
    const door = s.car.m.fuelCap.door; const side = s.car.m.fuelCap.side;
    door.rotation.y = side > 0 ? -1.4 : Math.PI + 1.4;
    g.scene.attach(n.group);
    this.placeInCar(n);
    s.face.fuelType = n.fuelType; s.face.liters = s.dispensed; s.face.cost = s.dispensed * this.prices[n.fuelType]; this.drawScreen(s.face);
    g.audio.play('pumpClick', { pos: n.group.position });
    g.tutorial.event('nozzleIn', s);
    if (n.fuelType !== s.fuelType) s.customer.say('question');
  }

  placeInCar(n) {
    const car = n.car, side = car.m.fuelCap.side;
    const cap = car.worldPoint(car.m.fuelCap.local, _w);
    // nozzle sits sticking out of the car side, angled down
    const out = new THREE.Vector3(0, 0, side).applyAxisAngle(new THREE.Vector3(0, 1, 0), car.yaw);
    n.group.position.copy(cap).addScaledVector(out, 0.2).add(new THREE.Vector3(0, 0.08, 0));
    const yaw = Math.atan2(-out.x, -out.z);
    n.group.rotation.set(0.5, yaw, 0, 'YXZ');
    this.updateHose(n);
  }

  removeFromCar(n, player) {
    const g = this.game, s = n.service;
    n.state = 'held'; n.car = null; n.service = null;
    if (s) {
      s.nozzle = null;
      const door = s.car.m.fuelCap.door; door.rotation.y = s.car.m.fuelCap.side < 0 ? Math.PI : 0;
      if (s.dispensed > 0.2) this.finishService(s);
      else s.state = 'waiting';
    }
    player.hold({ kind: 'nozzle', nozzle: n, system: this });
    g.audio.play('pumpClick', { pos: n.group.position, pitch: 1.2 });
  }

  returnNozzle(n) {
    n.state = 'holstered';
    if (n.service) { n.service.nozzle = null; n.service = null; }
    n.car = null;
    n.group.position.copy(n.home);
    n.group.rotation.copy(n.homeRot);
    this.game.scene.add(n.group);
    this.updateHose(n, true);
    this.game.audio.play('pumpClick', { pos: n.home, pitch: 0.8 });
  }

  startPump(n) { this.pumpRequest = n; }

  finishService(s) {
    if (s.state === 'done') return;
    s.state = 'done';
    const target = s.target;
    const diff = s.dispensed - target;
    s.accuracy = Math.abs(diff);
    s.over = diff;
    if (s.dispensed > 0.5 && s.fuelType !== s.nozzleTypeUsed && s.nozzleTypeUsed) s.wrongFuel = true;
    this.game.tutorial.event('fuelDone', s);
  }

  /** Customer pays at the pump. Returns reaction. */
  payAtPump(customer, s) {
    const g = this.game, price = this.prices[s.fuelType];
    const res = this.settle(s);
    const total = res.billLiters * price;
    g.economy.earn(total, 'Fuel', s.car.pos.clone().setY(2.2), { sale: 'fuel', liters: s.dispensed });
    if (res.tip > 0) g.economy.earn(res.tip, 'Tip', s.car.pos.clone().setY(2.8), { tip: true });
    g.economy.addXP(res.xp);
    g.economy.rep(res.rep, s.car.pos);
    g.economy.stats.fuelCustomers++;
    if (res.perfect) { g.ui.bigMessage('PERFECT FILL!', `+${money(res.tip)} tip`); g.audio.play('perfect'); }
    return res;
  }

  /** Shared settlement logic: how much is billed, tip, reaction. */
  settle(s) {
    const diff = s.dispensed - s.target;
    const price = this.prices[s.fuelType];
    const fairness = clamp(1.35 - (price / FUELS[s.fuelType].price - 1) * 2.2, 0.2, 1.4); // high prices = fewer tips
    let tip = 0, rep = 0.01, xp = 10, happy = true, line = pick(['Thanks!', 'Much obliged.', 'Have a good one!', 'Cheers!']), perfect = false;
    let billLiters = s.dispensed;
    if (s.full) {
      perfect = Math.abs(diff) < 0.3; tip = perfect ? rand(1, 3) * fairness : 0; rep = 0.02;
    } else if (Math.abs(diff) <= 0.25) {
      perfect = true; tip = (s.dispensed * price) * rand(0.12, 0.22) * fairness; rep = 0.04; xp = 18; line = pick(['Spot on! Here, keep the change.', 'Wow, to the cent!', 'Now THAT is service.']);
    } else if (Math.abs(diff) <= 1) {
      tip = (s.dispensed * price) * rand(0.03, 0.08) * fairness; rep = 0.02; xp = 12;
    } else if (diff > 1) {
      billLiters = s.target; happy = false; rep = -0.03; xp = 4; line = pick(['I said ' + (s.dollars ? '$' + s.dollars : s.target + ' litres') + '! Not paying extra.', 'You overfilled it, genius.']);
    } else {
      happy = false; rep = -0.02; xp = 5; line = pick(['That\'s it? I wanted more.', 'Half empty, really?']);
    }
    if (s.customer && s.customer.traits.generous) tip *= 1.6;
    if (s.customer && s.customer.mood < 0.35) { tip *= 0.3; }
    tip = Math.round(tip * 100) / 100;
    return { tip, rep, xp, happy, line, perfect, billLiters };
  }

  // ------------------------------------------------------------ per-frame
  update(dt, player) {
    const g = this.game;
    // pumping
    let active = null;
    if (this.pumpRequest) {
      const n = this.pumpRequest;
      const s = n.service;
      const near = n.group.position.distanceTo(player.pos) < 3.6;
      const holding = player.input.mouseDown(0) || this.autoStop;
      if (s && n.state === 'inCar' && near && (holding || n.autoRun)) {
        if (this.autoStop && !n.autoRun) n.autoRun = true;
        active = n;
      } else { this.pumpRequest = null; n.autoRun = false; n.flowT = 0; }
    }
    if (active) {
      const n = active, s = n.service;
      n.flowT = Math.min(1, (n.flowT || 0) + dt * 0.9);
      let flow = this.flowBase * (0.35 + 0.65 * n.flowT);
      const remainingTank = this.tanks[n.fuelType];
      const carSpace = s.car.m.tank - s.dispensed;
      if (s.full || this.autoStop) {
        const stopAt = s.full ? s.target : s.target;
        if (s.dispensed + flow * dt >= stopAt) { flow = Math.max(0, (stopAt - s.dispensed) / dt); }
      }
      let amt = Math.min(flow * dt, remainingTank, Math.max(0, carSpace));
      if (amt <= 0) {
        if (remainingTank <= 0) g.ui.toast(`⛽ ${FUELS[n.fuelType].name} tank is EMPTY! Order fuel on the tablet (TAB)`, 'bad');
        else if ((s.full || this.autoStop) && s.dispensed >= s.target - 0.01) { g.audio.play('pumpClick', { pos: n.group.position, pitch: 1.4 }); g.ui.toast('*click* Auto shut-off', 'good', 1.5); }
        this.pumpRequest = null; n.autoRun = false;
      } else {
        s.dispensed += amt; this.tanks[n.fuelType] -= amt;
        s.nozzleTypeUsed = n.fuelType;
        s.idle = 0;
        if (n.fuelType !== s.fuelType && s.dispensed > 1 && !s.wrongWarned) { s.wrongWarned = true; s.customer.say('question', 'Uhh... is that the right fuel?'); }
        g.economy.stats.litres += amt;
        if (Math.random() < dt * 6) g.particles.fuelDrip(n.group.position.clone().add(new THREE.Vector3(0, -0.05, 0)), { color: FUELS[n.fuelType].hex });
      }
      this.pumping = n;
      this.screenTimer -= dt;
      if (this.screenTimer <= 0) { this.screenTimer = 0.08; s.face.liters = s.dispensed; s.face.cost = s.dispensed * this.prices[n.fuelType]; this.drawScreen(s.face); }
    } else this.pumping = null;
    // pump audio
    if (!this.pumpLoop && g.audio.ready) this.pumpLoop = g.audio.createPumpLoop(null);
    if (this.pumpLoop) {
      this.pumpLoop.setActive(!!this.pumping, this.pumping ? this.pumping.flowT : 0);
      if (this.pumping && g.audio.ctx) {
        // move loop to pump
      }
    }
    // held nozzle → update hose; yank back if too far
    for (const n of this.nozzles) {
      if (n.state === 'held') {
        const tail = n.group.getWorldPosition(_v);
        if (tail.distanceTo(n.anchor) > HOSE_LEN + 0.6) {
          player.drop(true);
          this.returnNozzle(n);
          g.audio.play('whoosh', { pos: n.anchor });
          g.ui.toast('The hose snapped back! Don\'t wander off with it 🙃', 'fun', 2);
          continue;
        }
        this.updateHoseFromWorld(n);
      } else if (n.state === 'inCar' && n.car) {
        this.placeInCar(n);
      }
    }
    // idle nozzle in car (player wandered off) → impatient customer
    for (const s of this.services) {
      if (s.state === 'fueling' && s.nozzle && this.pumping !== s.nozzle) {
        s.idle += dt;
        if (s.idle > 30 && !s.warned) { s.warned = 1; s.customer.say('angry', 'Hello?! Are we done here?'); s.customer.honk = true; g.audio.play('honk', { pos: s.car.pos }); }
        if (s.idle > 55 && s.dispensed > 0.5) {
          // they leave with the nozzle in the car...
          this.finishService(s);
        }
      }
      if (s.state === 'waiting' && s.customer.patience < s.customer.patienceMax * 0.35 && !s.honked) {
        s.honked = true; g.audio.play('honk', { pos: s.car.pos, long: true }); s.customer.say('angry', 'Can I get some service here?!');
      }
    }
  }

  updateHoseFromWorld(n) {
    // nozzle group is parented to the camera viewmodel; hose needs world-space tail
    const wq = n.group.getWorldQuaternion(new THREE.Quaternion());
    const wp = n.group.getWorldPosition(new THREE.Vector3());
    const tail = new THREE.Vector3(0, 0, -0.05).applyQuaternion(wq).add(wp);
    if (n._lastTail && n._lastTail.distanceToSquared(tail) < 1e-5) return;
    n._lastTail = tail.clone();
    const a = n.anchor, dist = a.distanceTo(tail), slack = Math.max(0, HOSE_LEN - dist);
    const mid = a.clone().lerp(tail, 0.5); const sag = Math.min(1.5, slack * 0.45 + 0.12); mid.y = Math.max(0.05, Math.min(a.y, tail.y) - sag);
    const p1 = a.clone().lerp(mid, 0.5); p1.y = Math.max(0.06, p1.y - sag * 0.25);
    const p2 = tail.clone().lerp(mid, 0.5); p2.y = Math.max(0.06, p2.y - sag * 0.25);
    n.hose.geometry.dispose();
    n.hose.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a.clone(), p1, mid, p2, tail]), 24, 0.016, 6, false);
  }

  /** Current active fuelling session (for the HUD gauge). */
  gaugeInfo(player) {
    let n = this.pumping;
    if (!n) {
      // show gauge when looking at / near a nozzle in a car
      for (const s of this.services) if (s.nozzle && s.nozzle.group.position.distanceTo(player.pos) < 3.2) { n = s.nozzle; break; }
    }
    if (!n || !n.service) return null;
    const s = n.service;
    return { type: n.fuelType, wantType: s.fuelType, liters: s.dispensed, target: s.target, cost: s.dispensed * this.prices[n.fuelType], dollars: s.dollars, full: s.full, active: this.pumping === n, price: this.prices[n.fuelType] };
  }

  orderFuel(type, liters, instant = false) {
    const g = this.game;
    const cost = liters * FUELS[type].cost * this.market[type];
    if (!g.economy.spend(cost, 'Fuel order')) return false;
    if (instant) { this.tanks[type] = Math.min(this.capacity, this.tanks[type] + liters); return true; }
    g.deliveries.scheduleTanker(type, liters);
    return true;
  }

  serialize() { return { tanks: this.tanks, prices: this.prices }; }
  load(d) { if (!d) return; Object.assign(this.tanks, d.tanks || {}); Object.assign(this.prices, d.prices || {}); }
}
