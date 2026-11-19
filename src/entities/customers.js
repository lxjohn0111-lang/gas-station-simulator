import * as THREE from 'three';
import { makeCap, makeSunglasses, makePhone } from './characters.js';
import { LAYOUT } from '../world/station.js';
import { Path } from './traffic.js';
import { SHOP, queueSpot } from '../world/shop.js';
import { PRODUCTS, FUELS } from '../game/products.js';
import { clamp, rand, randInt, pick, chance, dampAngle, NAMES_F, NAMES_M, weightedPick } from '../core/utils.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
let NEXT_ID = 1;

/**
 * One customer: a character plus an optional car, driven by a small
 * state machine (drive → pump/park → walk/shop → queue → pay → leave),
 * with ragdoll interruptions and mood.
 */
export class Customer {
  constructor(mgr, opts) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.id = NEXT_ID++;
    const kinds = this.game.chars.kinds;
    this.kind = opts.kind || pick(kinds);
    this.char = this.game.chars.create(this.kind);
    this.female = this.char.female;
    this.name = pick(this.female ? NAMES_F : NAMES_M);
    this.traits = {
      phone: chance(0.18), clumsy: chance(0.25), dancer: chance(0.35), grumpy: chance(0.2),
      thief: opts.thief || false, generous: chance(0.25), hurried: chance(0.25),
    };
    this.patienceMax = (this.traits.hurried ? 55 : 85) * (this.traits.grumpy ? 0.8 : 1) * rand(0.9, 1.2) * this.game.economy.patienceMul();
    this.patience = this.patienceMax;
    this.mood = 0.75;
    this.basket = [];          // {kind:'product', id, price} | {kind:'fuel', fuelType, liters, price}
    this.wants = 0;
    this.state = 'idle';
    this.path = null; this.pathI = 0;
    this.speed = 0;
    this.walkSpeed = this.traits.hurried ? 1.75 : rand(1.25, 1.5);
    this.vel = new THREE.Vector3();
    this.car = null; this.inCar = false;
    this.slot = null;           // pump slot or parking spot
    this.service = null;        // fuel service
    this.timer = 0;
    this.onDone = null;
    this.angryShown = false;
    this.accessories();
    this.game.scene.add(this.char.root);
    this.labelId = 'c' + this.id;
    this.stuckTime = 0;
    this.lastPos = new THREE.Vector3();
    this.slipImmune = 0;
    this.knockCount = 0;
  }

  accessories() {
    const c = this.char;
    if (this.kind !== 'biker') {
      if (chance(0.35) && !(this.kind === 'cowboy' && c.meshes.some((m) => /headwear/i.test(m.material.name || '') && m.visible))) {
        c.attach('Head', makeCap(pick([0xb3261e, 0x1f3f7a, 0x222222, 0xe8e2d0, 0x2f5d3a, 0xf2b705])), new THREE.Vector3(0, 0.15, 0.01));
      }
      if (chance(0.3)) c.attach('Head', makeSunglasses(), new THREE.Vector3(0, 0.075, 0.09));
    }
    if (this.traits.phone) this.phone = c.attach('RightHand', makePhone(), new THREE.Vector3(0, 0.08, 0.03), new THREE.Euler(0.3, 0, 0));
  }

  get pos() { return this.char.root.position; }

  // ------------------------------------------------------------- car handling
  sitInCar(car) {
    this.car = car; this.inCar = true;
    car.group.add(this.char.root);
    this.char.root.position.copy(car.m.driverLocal);
    this.char.root.rotation.set(0, Math.PI / 2, 0);
    this.char.play('idle', 0);
    this.char.root.visible = !car.m.big;
  }
  exitCar() {
    if (!this.car) return;
    const p = this.car.worldPoint(this.car.m.doorLocal, new THREE.Vector3());
    p.y = this.game.colliders.groundHeight(p.x, p.z);
    this.game.scene.add(this.char.root);
    this.char.root.visible = true;
    this.char.root.position.copy(p);
    this.char.root.rotation.set(0, Math.atan2(-Math.sin(this.car.yaw + Math.PI / 2), Math.cos(this.car.yaw + Math.PI / 2)), 0);
    this.inCar = false;
    this.game.audio.play('carDoor', { pos: p, vol: 0.8 });
  }
  enterCar() {
    this.game.audio.play('carDoor', { pos: this.pos, vol: 0.8 });
    this.sitInCar(this.car);
  }

  // ------------------------------------------------------------- movement
  walkTo(target, onArrive, { run = false, near = 0.25 } = {}) {
    const from = this.pos;
    const path = this.game.nav.findPath(from, target);
    this.path = path || [target.clone()];
    this.pathI = 0;
    this.moveTarget = target.clone();
    this.onArrive = onArrive;
    this.running = run;
    this.arriveNear = near;
    this.state = 'walk';
    this.stuckTime = 0;
  }

  faceTowards(p, dt, rate = 8) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (dx * dx + dz * dz < 1e-4) return;
    this.char.root.rotation.y = dampAngle(this.char.root.rotation.y, Math.atan2(dx, dz), rate, dt);
  }

  stepWalk(dt) {
    const root = this.char.root;
    if (!this.path || this.pathI >= this.path.length) { this.speed = 0; return true; }
    const wp = this.path[this.pathI];
    _v.set(wp.x - root.position.x, 0, wp.z - root.position.z);
    const d = _v.length();
    const last = this.pathI === this.path.length - 1;
    if (d < (last ? this.arriveNear : 0.45)) { this.pathI++; if (this.pathI >= this.path.length) { this.speed = 0; return true; } return false; }
    const target = this.running ? 3.9 : this.walkSpeed * (this.traits.phone ? 0.8 : 1);
    this.speed = THREE.MathUtils.lerp(this.speed, last && d < 1 ? Math.max(0.5, target * d) : target, 1 - Math.exp(-6 * dt));
    _v.normalize();
    // separation from others & player
    for (const o of this.mgr.list) {
      if (o === this || o.inCar || o.char.isRagdoll) continue;
      _w.subVectors(root.position, o.pos); _w.y = 0;
      const dd = _w.length();
      if (dd < 0.75 && dd > 1e-3) _v.addScaledVector(_w.normalize(), (0.75 - dd) * 1.5);
    }
    _w.subVectors(root.position, this.game.player.pos); _w.y = 0;
    const pd = _w.length();
    if (pd < 0.8 && pd > 1e-3) _v.addScaledVector(_w.normalize(), (0.8 - pd) * 2);
    _v.normalize();
    root.position.addScaledVector(_v, this.speed * dt);
    this.game.colliders.resolveCircle(root.position, 0.28, root.position.y, 1.7);
    root.position.y = this.game.colliders.groundHeight(root.position.x, root.position.z);
    this.faceTowards(_w.copy(root.position).add(_v), dt, 10);
    // stuck detection → repath
    if (root.position.distanceToSquared(this.lastPos) < (this.speed * dt * 0.2) ** 2) this.stuckTime += dt; else this.stuckTime = 0;
    this.lastPos.copy(root.position);
    if (this.stuckTime > 1.5) {
      this.stuckTime = 0;
      const p = this.game.nav.findPath(root.position, this.moveTarget);
      if (p) { this.path = p; this.pathI = 0; } else this.pathI++;
    }
    return false;
  }

  animate(dt) {
    if (this.char.isRagdoll || this.char.blend) return;
    if (this.state === 'dance') { this.char.play('dance', 0.4); return; }
    if (this.speed > 2.4) { this.char.play('run', 0.2, this.speed / 3.8); }
    else if (this.speed > 0.15) this.char.play('walk', 0.25, clamp(this.speed / 1.35, 0.6, 1.5));
    else if (this.mood < 0.3 && this.char.actions.sad && !this.traits.phone) this.char.play('sad', 0.4);
    else this.char.play('idle', 0.35);
  }

  // ------------------------------------------------------------- reactions
  say(mood, text = null) {
    this.game.audio.voice(this.pos.clone().setY(this.pos.y + 1.6), mood, this.female, (this.id * 0.137) % 1);
    this.char.speak(0.9);
    if (text) this.game.labels.say(this, text, mood);
  }

  setMood(delta) {
    this.mood = clamp(this.mood + delta, 0, 1);
  }

  /** Knock over: velocity of the hit, impulse, reason for funny tracking. */
  knock(vel, impulse, reason = 'shove', part = 'torso') {
    if (this.inCar) return;
    const wasRagdoll = this.char.isRagdoll;
    this.char.startRagdoll(this.game.physics, vel, impulse, part);
    if (!wasRagdoll) {
      this.prevState = this.state === 'ragdoll' ? this.prevState : this.state;
      this.state = 'ragdoll';
      this.speed = 0;
      this.knockCount++;
      this.say('scared');
      this.game.funny.report(reason, this.pos.clone(), this);
      if (this.phone && chance(0.7)) this.dropPhone();
    }
  }

  dropPhone() {
    const ph = this.phone; if (!ph) return;
    const wp = ph.getWorldPosition(new THREE.Vector3());
    ph.removeFromParent();
    this.phone = null;
    const m = makePhone(); m.position.copy(wp); this.game.scene.add(m);
    const prop = this.game.physics.addProp(m, { size: new THREE.Vector3(0.07, 0.14, 0.01), mass: 0.2 });
    prop.body.velocity.set(rand(-2, 2), 3, rand(-2, 2));
    prop.data = { kind: 'junk', pickable: true, name: 'Lost phone' };
    this.game.props.register(prop, { name: "Someone's phone", junk: true });
  }

  slip(hazard) {
    const fwd = new THREE.Vector3(Math.sin(this.char.root.rotation.y), 0, Math.cos(this.char.root.rotation.y));
    const vel = fwd.clone().multiplyScalar(this.speed + 1.5).setY(1.5);
    this.game.audio.play('slip', { pos: this.pos });
    // legs fly forward, upper body backward
    this.knock(vel, new THREE.Vector3(-fwd.x * 30, 25, -fwd.z * 30), hazard.kind === 'banana' ? 'banana' : 'slip', 'torso');
    if (this.char.ragdoll) {
      this.char.ragdoll.applyImpulse(new THREE.Vector3(fwd.x * 40, 30, fwd.z * 40), 'lShin');
      this.char.ragdoll.applyImpulse(new THREE.Vector3(fwd.x * 40, 35, fwd.z * 40), 'rShin');
    }
    this.slipImmune = 6;
  }

  // ------------------------------------------------------------- main update
  update(dt) {
    const c = this.char;
    this.slipImmune = Math.max(0, this.slipImmune - dt);
    if (this.state === 'ragdoll') {
      c.update(dt);
      if (c.ragdoll && c.ragdoll.settled) {
        const p = c.ragdoll.pelvisPos(new THREE.Vector3());
        c.endRagdoll(this.game.colliders.groundHeight(p.x, p.z));
        this.state = 'gettingUp'; this.timer = 1.0;
        this.game.audio.play('boing', { pos: this.pos, vol: 0.5, pitch: rand(0.8, 1.2) });
      }
      return;
    }
    if (this.state === 'gettingUp') {
      this.timer -= dt;
      c.update(dt);
      if (this.timer <= 0) {
        this.setMood(-0.25);
        this.mgr.game.economy.rep(-0.02, null);
        this.say('angry', pick(['MY BACK!', 'Who left that there?!', 'I\'m calling my lawyer!', 'OW!', 'Unbelievable!', 'Not again...']));
        if (c.actions.headShake) { c.play('headShake', 0.2); this.state = 'shake'; this.timer = 1.8; }
        else this.resume();
      }
      return;
    }
    if (this.state === 'shake') {
      this.timer -= dt; c.update(dt);
      if (this.timer <= 0) this.resume();
      return;
    }
    if (this.inCar) { c.update(dt); this.tick(dt); return; }

    // hazard check (oil, banana, wet floor)
    if (this.speed > 0.6 && this.slipImmune <= 0) {
      const h = this.game.cleaning.hazardAt(this.pos);
      if (h && chance(h.kind === 'banana' ? 1 : (this.traits.clumsy ? 0.85 : 0.55) * dt * 8)) { this.slip(h); this.game.cleaning.onSlip(h); return; }
    }
    if (this.state === 'walk') {
      if (this.stepWalk(dt)) {
        this.state = 'arrived';
        const cb = this.onArrive; this.onArrive = null;
        if (cb) cb();
      }
    } else this.speed = THREE.MathUtils.lerp(this.speed, 0, 1 - Math.exp(-8 * dt));
    this.animate(dt);
    c.update(dt);
    this.tick(dt);
  }

  resume() {
    // after a knock-down, continue whatever we were doing
    if (this.resumeFn) { const f = this.resumeFn; f(); return; }
    this.state = 'idle';
  }

  /** Per-frame behaviour hook set by the manager script. */
  tick(dt) { if (this.script) this.script(dt); }

  dispose() {
    this.game.labels.remove(this.labelId);
    this.char.dispose();
  }
}

/**
 * Spawns customers and scripts their visits.
 */
export class CustomerManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.spawnTimer = 4;
    this.parking = [];
    this.servedToday = 0;
    this.forced = [];
  }

  get open() { return this.game.clock.open; }

  update(dt) {
    const g = this.game;
    if (this.open) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.nextInterval();
        this.trySpawn();
      }
    }
    for (const c of [...this.list]) {
      c.update(dt);
      // fell into the void / out of range safety
      if (!c.inCar && (c.pos.y < -5 || Math.abs(c.pos.x) > 400)) this.remove(c);
    }
    void g;
  }

  nextInterval() {
    const g = this.game, h = g.clock.hour;
    const rush = (h > 7.5 && h < 9.5) || (h > 12 && h < 13.5) || (h > 17 && h < 19) ? 1.45 : h > 20.5 ? 0.6 : 1;
    const rate = g.economy.customerRate() * rush; // customers per minute
    return clamp(60 / rate * rand(0.6, 1.4), 5, 60);
  }

  activeCount() { return this.list.length; }

  trySpawn(forceType = null) {
    const g = this.game;
    if (this.list.length >= g.economy.maxCustomers()) return null;
    let type = forceType;
    if (!type) {
      const r = Math.random();
      if (r < 0.62) type = 'fuel';
      else if (r < 0.92) type = 'shop';
      else type = g.upgrades.has('carwash') ? 'wash' : 'shop';
    }
    if (type === 'fuel') {
      const slot = g.traffic.findSlot();
      if (slot) return this.spawnFuel(slot);
      // queue in a lane hold if empty
      const lane = ['S', 'N'].find((l) => !g.traffic.queue[l] && g.traffic.pumpSlots.some((s) => s.lane === l));
      if (lane) return this.spawnFuel(null, lane);
      type = 'shop';
    }
    if (type === 'wash') return this.spawnWash();
    if (type === 'shop') {
      const spot = g.station.parking.find((p) => !p.taken);
      if (spot) return this.spawnShopper(spot);
    }
    return null;
  }

  carModelFor(cust) {
    const type = cust.kind === 'biker' && chance(0.3) ? 'muscle' : this.game.traffic.randomType();
    return this.game.traffic.spawnModel(type);
  }

  // ------------------------------------------------------------- fuel customer
  spawnFuel(slot, holdLane = null) {
    const g = this.game, T = g.traffic;
    const c = new Customer(this, {});
    const model = this.carModelFor(c);
    const car = T.addCar(model);
    c.sitInCar(car);
    this.list.push(c);
    const needsPremiumFallback = model.fuelType === 'premium' && !g.upgrades.has('premium');
    if (needsPremiumFallback) model.fuelType = 'regular';
    const fuelType = model.fuelType;
    const tank = model.tank;
    let liters;
    const r = Math.random();
    if (r < 0.35) liters = Math.round(rand(0.45, 0.85) * tank);              // "fill her up"
    else if (r < 0.75) liters = randInt(2, 8) * 5;                          // round litres
    else liters = Math.round(randInt(1, 6) * 10 / FUELS[fuelType].price * 10) / 10; // dollar amount
    liters = clamp(liters, 5, tank);
    c.fuelReq = { type: fuelType, liters, dollars: r >= 0.75 ? Math.round(liters * FUELS[fuelType].price) : null, full: r < 0.35 };
    c.payInside = chance(0.45);
    c.wants = c.payInside ? (chance(0.6) ? randInt(1, 3) : 0) : 0;
    const startPath = slot ? T.routeToSlot(slot) : T.routeToLaneHold(holdLane);
    if (slot) { slot.reservedBy = c; c.slot = slot; }
    else { T.queue[holdLane] = c; c.holdLane = holdLane; }
    car.setPath(startPath, { maxSpeed: 9 });
    car.dist = 0; car.speed = 16;
    car.place(startPath.pointAt(0), 0);
    c.state = 'driving';
    c.phase = slot ? 'toPump' : 'toHold';
    car.onArrive = () => this.onCarArrived(c);
    c.script = (dt) => this.fuelScript(c, dt);
    return c;
  }

  onCarArrived(c) {
    const g = this.game, T = g.traffic, car = c.car;
    if (c.phase === 'toHold') {
      c.phase = 'holding';
      car.engineIdle = true;
      g.labels.setCar(c, 'queue');
      return;
    }
    if (c.phase === 'toPump') {
      c.phase = 'atPump';
      car.setParked(true);
      car.engineIdle = false;
      c.service = g.fuel.beginService(c, c.slot, car);
      c.patience = c.patienceMax;
      c.timer = rand(1, 3);
      return;
    }
    if (c.phase === 'reversing') {
      car.setPath(T.routeParkingExit(c.slot), {});
      c.slot.taken = null;
      c.phase = 'leaving';
      car.onArrive = () => this.carLeft(c);
      return;
    }
    if (c.phase === 'toParking') {
      c.phase = 'parked';
      car.setParked(true);
      c.timer = rand(0.5, 1.5);
      return;
    }
    if (c.phase === 'leaving') this.carLeft(c);
  }

  carLeft(c) {
    this.remove(c);
  }

  fuelScript(c, dt) {
    const g = this.game, T = g.traffic, car = c.car;
    switch (c.phase) {
      case 'holding': {
        c.patience -= dt;
        const lane = c.holdLane;
        const slot = T.pumpSlots.filter((s) => s.lane === lane && !s.reservedBy).sort((a, b) => b.x - a.x)
          .find((s) => T.pumpSlots.filter((o) => o.lane === lane && o.x < s.x).every((o) => !o.reservedBy));
        if (slot) {
          slot.reservedBy = c; c.slot = slot; T.queue[lane] = null; c.holdLane = null;
          car.setPath(T.routeFromHold(lane, slot), { maxSpeed: 6 });
          car.onArrive = () => this.onCarArrived(c);
          c.phase = 'toPump';
          g.labels.remove(c.labelId);
        } else if (c.patience <= 0) {
          // gives up: drive through the lane & leave
          T.queue[lane] = null;
          g.economy.rep(-0.06, c.pos);
          g.ui.toast(`${c.name} got tired of waiting and left`, 'bad');
          c.phase = 'leaving';
          car.setPath(new Path([[-21.5, LAYOUT.laneZ[lane]], [-18, LAYOUT.laneZ[lane]], [20, LAYOUT.laneZ[lane]], [27, LAYOUT.laneZ[lane]], [32, -21], ...T.exitTail], { speed: 9 }), {});
          car.onArrive = () => this.carLeft(c);
          g.labels.remove(c.labelId);
        }
        break;
      }
      case 'atPump': {
        const s = c.service;
        if (s.state === 'waiting') c.patience -= dt * (c.traits.hurried ? 1.3 : 1);
        g.labels.setCar(c, 'fuel');
        // get out & stretch after a moment
        c.timer -= dt;
        if (c.timer <= 0 && c.inCar && !c.stayInCar) {
          if (chance(0.75)) {
            c.exitCar();
            const sideOffset = new THREE.Vector3(-1.8, 0, -(car.halfW + 0.7));
            const p = car.worldPoint(sideOffset, new THREE.Vector3());
            p.y = 0;
            c.walkTo(p, () => { c.state = 'waitCar'; });
            c.resumeFn = () => { c.walkTo(car.worldPoint(new THREE.Vector3(-1.8, 0, -(car.halfW + 0.7))).setY(0), () => { c.state = 'waitCar'; }); };
            // maybe pop into the shop while fuelling
            if (c.payInside && chance(0.35)) { c.phase = 'shopWhileFuel'; this.goShopping(c, () => { c.phase = 'returnAfterShop'; }); }
          } else c.stayInCar = true;
        }
        if (c.state === 'waitCar' && !c.inCar) {
          c.faceTowards(g.player.pos, dt, 3);
          if (c.traits.phone) c.char.lookAtTarget = null;
        }
        if (c.patience <= 0 && s.state === 'waiting') { this.angryLeave(c, 'Waited too long at the pump!'); break; }
        if (s.state === 'done') this.afterFuel(c);
        break;
      }
      case 'shopWhileFuel': {
        if (c.service.state === 'done') c.fuelDoneWhileAway = true;
        break;
      }
      case 'returnAfterShop': {
        if (c.service.state === 'done') { this.afterFuel(c, true); }
        else if (c.state !== 'walk' && c.state !== 'waitCar') {
          c.walkTo(car.worldPoint(new THREE.Vector3(-1.8, 0, -(car.halfW + 0.7))).setY(0), () => { c.state = 'waitCar'; });
          c.phase = 'atPump';
        }
        break;
      }
      case 'toCar': case 'drivingOff': case 'paying': case 'toPump': case 'toHold': case 'leaving': break;
      default: break;
    }
  }

  afterFuel(c, alreadyShopped = false) {
    const g = this.game, s = c.service;
    g.labels.remove(c.labelId);
    if (s.wrongFuel) {
      c.phase = 'drivingOff';
      this.wrongFuelDrama(c);
      return;
    }
    const bill = s.dispensed * FUELS[s.fuelType].price;
    if (!c.payInside || alreadyShopped) {
      if (c.payInside && alreadyShopped) {
        // they already paid for items; pay fuel at pump now
      }
      const res = g.fuel.payAtPump(c, s);
      c.say(res.happy ? 'happy' : 'angry', res.line);
      this.returnAndLeave(c, 1.2);
    } else {
      c.basket.push({ kind: 'fuel', fuelType: s.fuelType, liters: s.dispensed, price: bill, accuracy: s.accuracy, service: s });
      c.phase = 'paying';
      if (c.inCar) c.exitCar();
      this.goShopping(c, () => { this.returnAndLeave(c, 0.5); }, true);
    }
  }

  returnAndLeave(c, delay = 0.5) {
    const g = this.game, car = c.car;
    c.phase = 'toCar';
    const go = () => {
      if (c.inCar) { this.driveOff(c); return; }
      const door = car.worldPoint(car.m.doorLocal, new THREE.Vector3()); door.y = 0;
      c.walkTo(door, () => { c.enterCar(); g.after(0.6, () => this.driveOff(c)); });
      c.resumeFn = go;
    };
    g.after(delay, go);
  }

  driveOff(c) {
    const g = this.game, T = g.traffic, car = c.car;
    if (!car || c.phase === 'drivingOff' || c.phase === 'leaving') return;
    if (c.slot && c.slot.island !== undefined) {
      g.fuel.endService(c.service);
      const slot = c.slot;
      car.setPath(T.routeSlotExit(slot), { maxSpeed: 9 });
      car.onArrive = () => this.carLeft(c);
      c.phase = 'leaving';
      // free the slot once the car has rolled away
      const check = () => { if (!car.alive || car.dist > 6) { if (slot.reservedBy === c) slot.reservedBy = null; } else g.after(0.3, check); };
      check();
    } else if (c.slot) {
      car.setPath(T.routeParkingReverse(c.slot), { reverse: true });
      car.onArrive = () => this.onCarArrived(c);
      c.phase = 'reversing';
    }
    this.servedToday++;
  }

  angryLeave(c, msg) {
    const g = this.game;
    g.labels.remove(c.labelId);
    c.say('angry', pick(['Forget it!', 'Worst. Service. Ever.', 'I\'m leaving a 1-star review!', 'Ugh!']));
    g.economy.rep(-0.08, c.pos);
    g.ui.toast(`😡 ${c.name}: ${msg}`, 'bad');
    g.economy.stats.lost++;
    if (c.service) { c.service.cancelled = true; g.fuel.endService(c.service); }
    if (c.inCar) this.driveOff(c); else this.returnAndLeave(c, 0.3);
  }

  wrongFuelDrama(c) {
    const g = this.game, car = c.car;
    c.say('angry', 'YOU PUT THE WRONG FUEL IN!');
    g.ui.toast(`💥 Wrong fuel! ${c.name}'s car is not happy`, 'bad');
    g.economy.rep(-0.1, c.pos);
    g.economy.stats.wrongFuel++;
    const back = () => {
      if (!c.inCar) c.enterCar();
      car.engineIdle = true;
      let n = 0;
      const pop = () => {
        n++;
        const ex = car.worldPoint(new THREE.Vector3(-car.halfL - 0.2, 0.3, 0.5));
        g.audio.play('backfire', { pos: ex, vol: 1.2 });
        g.particles.smoke(ex, { count: 8, color: 0x222222, size: 0.8, sizeEnd: 3.5, alpha: 0.7, vel: { x: 0, y: 1.2, z: 0 }, velSpread: 1.2 });
        g.particles.sparks(ex, { count: 10 });
        car.hop = 1; car.hopV = 3.5 + Math.random() * 1.5;
        g.physics.blast(ex, 3, 6);
        if (n < 4) g.after(0.7 + Math.random() * 0.4, pop);
        else { g.funny.report('backfire', car.pos.clone(), c); g.after(0.8, () => this.driveOff(c)); }
      };
      g.after(0.8, pop);
    };
    if (c.inCar) back(); else c.walkTo(car.worldPoint(car.m.doorLocal).setY(0), back);
  }

  // ------------------------------------------------------------- shopping
  goShopping(c, after, mustPay = false) {
    const g = this.game;
    const inside = SHOP.entranceInside.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0, rand(0, 0.6)));
    const wantN = c.wants;
    c.picks = 0;
    const shopLoop = () => {
      if (c.picks < wantN) {
        const slot = g.inventory.chooseSlotFor(c);
        if (!slot) { c.picks = wantN; if (!mustPay && !c.basket.length) { c.say('neutral', pick(['Out of stock again?', 'Nothing I want...'])); c.setMood(-0.1); } shopLoop(); return; }
        const stand = g.inventory.standPoint(slot);
        c.walkTo(stand, () => {
          c.state = 'browse'; c.timer = rand(1.2, 2.8);
          c.script2 = (dt) => {
            c.timer -= dt; c.faceTowards(slot.pos, dt, 6);
            if (c.timer < 0.8 && !c.reached) { c.char.reach = 0.6; c.reached = true; }
            if (c.timer <= 0) {
              c.script2 = null; c.reached = false;
              const id = g.inventory.take(slot);
              if (id) {
                c.basket.push({ kind: 'product', id, price: g.inventory.priceOf(id) });
                g.audio.play('paper', { pos: c.pos, vol: 0.4 });
                if (c.traits.thief && c.basket.length >= 2) { this.thiefRun(c); return; }
              }
              c.picks++;
              shopLoop();
            }
          };
        });
        c.resumeFn = shopLoop;
        return;
      }
      if (c.traits.thief && c.basket.length) { this.thiefRun(c); return; }
      if (!c.basket.length && !mustPay) { after(); return; }
      // impulse buys at the counter (upgrades)
      if (!c._extras) {
        c._extras = true;
        if (g.upgrades.has('coffee') && chance(0.38)) c.basket.push({ kind: 'extra', id: 'coffee', name: 'Hot Joe Coffee', price: 2.49 });
        if (g.upgrades.has('hotdog') && chance(0.26)) c.basket.push({ kind: 'extra', id: 'hotdog', name: 'Roller Hot Dog', price: 3.49 });
      }
      // queue at register
      g.register.join(c);
      c.resumeFn = () => this.queueStep(c);
      this.queueStep(c);
      c.afterPay = after;
    };
    c.walkTo(inside, shopLoop);
    c.resumeFn = () => c.walkTo(inside, shopLoop);
    if (!c._shopWrapped) {
      c._shopWrapped = true;
      const prevScript = c.script;
      c.script = (dt) => { if (c.script2 && c.state === 'browse') c.script2(dt); prevScript && prevScript(dt); };
    }
  }

  queueStep(c) {
    const g = this.game;
    const i = g.register.indexOf(c);
    if (i < 0) return;
    c.queueIndex = i;
    const spot = queueSpot(Math.min(i, 7));
    c.walkTo(spot, () => {
      c.state = 'queue';
      if (i === 0) g.register.arrived(c);
    }, { near: 0.15 });
  }

  /** Called by register when the queue moves. */
  onQueueAdvance(c) { if (c.state !== 'ragdoll' && c.state !== 'gettingUp') this.queueStep(c); }

  /** Called by register after payment. result: {ok, tip} */
  onPaid(c, result) {
    const g = this.game;
    c.state = 'idle';
    c.basket = [];
    if (result.happy) c.say('happy', result.line); else c.say('angry', result.line);
    const after = c.afterPay; c.afterPay = null;
    const exit = SHOP.entranceOutside.clone().add(new THREE.Vector3(rand(-0.6, 0.6), 0, rand(-0.3, 0.3)));
    c.walkTo(exit, () => { after ? after() : this.walkAway(c); });
    c.resumeFn = () => c.walkTo(exit, () => { after ? after() : this.walkAway(c); });
  }

  thiefRun(c) {
    const g = this.game;
    c.traits.thief = true;
    c.isFleeing = true;
    c.say('scared', pick(['SEE YA, SUCKER!', '*sprints*', 'Five finger discount!']));
    g.ui.toast(`🚨 SHOPLIFTER! ${c.name} is running off with stuff — tackle them!`, 'bad', 4);
    g.audio.play('alarm', { pos: SHOP.entranceInside, vol: 0.7 });
    const target = new THREE.Vector3(rand(-30, 30) < 0 ? -45 : 45, 0, rand(-30, -20));
    c.walkTo(target, () => { this.thiefEscaped(c); }, { run: true });
    c.resumeFn = () => {
      // after being tackled: drop goods
      if (c.basket.length) {
        const back = c.basket.filter((b) => b.kind === 'product');
        for (const b of back) g.inventory.restockReturned(b.id);
        g.ui.toast(`👮 Caught the thief! ${back.length} item(s) recovered +$15 reward`, 'good');
        g.economy.earn(15, 'Thief bounty', c.pos.clone().setY(1.5));
        g.economy.addXP(25);
        g.economy.stats.thievesCaught++;
        c.basket = [];
      }
      c.isFleeing = false;
      c.say('scared', 'OK OK I\'m going!');
      this.walkAway(c, true);
    };
  }
  thiefEscaped(c) {
    const g = this.game;
    if (c.basket.length) {
      const loss = c.basket.reduce((a, b) => a + (b.price || 0), 0);
      g.ui.toast(`💸 The thief got away with $${loss.toFixed(2)} of stock`, 'bad');
      g.economy.rep(-0.03, null);
      g.economy.stats.stolen += loss;
    }
    this.remove(c);
  }

  walkAway(c, run = false) {
    const target = new THREE.Vector3(chance(0.5) ? -46 : 46, 0, rand(-34, -26));
    c.walkTo(target, () => this.remove(c), { run });
    c.resumeFn = () => c.walkTo(target, () => this.remove(c), { run });
  }

  // ------------------------------------------------------------- shopper (parking)
  spawnShopper(spot) {
    const g = this.game, T = g.traffic;
    const c = new Customer(this, { thief: chance(g.upgrades.has('camera') ? 0.03 : 0.08) && g.economy.level >= 2 });
    const car = T.addCar(this.carModelFor(c));
    c.sitInCar(car);
    this.list.push(c);
    spot.taken = c; c.slot = spot;
    c.wants = randInt(1, 4);
    const p = T.routeToParking(spot);
    car.setPath(p, { maxSpeed: 8 }); car.speed = 14;
    car.place(p.pointAt(0), 0);
    c.phase = 'toParking'; c.state = 'driving';
    car.onArrive = () => this.onCarArrived(c);
    c.script = (dt) => {
      if (c.phase === 'parked') {
        c.timer -= dt;
        if (c.timer <= 0) {
          c.exitCar();
          c.phase = 'shopping';
          this.goShopping(c, () => this.returnAndLeave(c, 0.3));
        }
      }
      if (c.state === 'queue' || c.state === 'browse' || c.state === 'idle') {
        if (c.state === 'queue') c.patience -= dt * (g.register.indexOf(c) === 0 && g.register.busy ? 0.4 : 1);
        if (c.patience <= 0 && c.state === 'queue') { g.register.leave(c); this.angryLeave(c, 'The line was too slow!'); }
      }
    };
    return c;
  }

  // ------------------------------------------------------------- car wash
  spawnWash() {
    const g = this.game, T = g.traffic;
    const c = new Customer(this, {});
    const car = T.addCar(this.carModelFor(c));
    c.sitInCar(car); this.list.push(c);
    const p = T.routeCarwash();
    car.setPath(p, { maxSpeed: 7, hold: p.marks.wash }); car.speed = 14;
    car.place(p.pointAt(0), 0);
    c.phase = 'toWash';
    c.script = (dt) => {
      if (c.phase === 'toWash' && car.dist >= p.marks.wash - 0.1 && car.speed < 0.1) {
        c.phase = 'washing'; c.timer = 9;
        g.station.washActive = 9;
        g.audio.play('splash', { pos: car.pos, vol: 1 });
      }
      if (c.phase === 'washing') {
        c.timer -= dt;
        if (Math.random() < dt * 20) g.particles.emit('drop', car.pos.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 2.5, rand(-2, 2))), { count: 3, size: 0.08, life: 0.6, gravity: 9, velSpread: 0.5, color: 0xbfe6ff, alpha: 0.7 });
        if (Math.random() < dt * 6) g.particles.emit('smoke', car.pos.clone().add(new THREE.Vector3(rand(-1, 1), 1.5, rand(-2, 2))), { count: 1, size: 0.6, sizeEnd: 1.4, life: 1.5, color: 0xffffff, alpha: 0.5 });
        if (c.timer <= 0) {
          c.phase = 'leaving'; car.holdAt = null;
          const price = g.upgrades.washPrice();
          g.economy.earn(price, 'Car wash', car.pos.clone().setY(2));
          g.economy.addXP(8);
          g.economy.stats.washes++;
          car.paint.clearcoatRoughness = 0.01;
          car.onArrive = () => this.carLeft(c);
          this.servedToday++;
        }
      }
    };
    car.onArrive = () => this.carLeft(c);
    return c;
  }

  remove(c) {
    const g = this.game;
    g.register.leave(c);
    if (c.slot && c.slot.reservedBy === c) c.slot.reservedBy = null;
    if (c.slot && c.slot.taken === c) c.slot.taken = null;
    if (c.holdLane && g.traffic.queue[c.holdLane] === c) g.traffic.queue[c.holdLane] = null;
    if (c.service) g.fuel.endService(c.service);
    if (c.car) g.traffic.remove(c.car);
    c.dispose();
    const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1);
  }

  clearAll() { for (const c of [...this.list]) this.remove(c); }

  /** Pick the walking customer nearest to a point (for shoves/throws). */
  nearestWalking(p, maxD) {
    let best = null, bd = maxD * maxD;
    for (const c of this.list) {
      if (c.inCar) continue;
      const d = c.pos.distanceToSquared(p);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}

export { weightedPick, PRODUCTS };
