import * as THREE from 'three';
import { buildCar, buildTruck, CAR_TYPES } from './vehicles.js';
import { makeOBB, setOBB } from '../world/colliders.js';
import { LAYOUT } from '../world/station.js';
import { ROAD_Z } from '../world/terrain.js';
import { clamp, rand, pick, weightedPick, chance, dampAngle, wrapAngle } from '../core/utils.js';

export const LANE_EB = ROAD_Z + 1.8;   // eastbound (+X)
export const LANE_WB = ROAD_Z - 1.8;   // westbound (-X)

/** Polyline path with arc-length parametrisation (from a Catmull-Rom curve). */
export class Path {
  constructor(points, { speed = 8, tension = 0.5, samples = null } = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], 0, p[1]))), false, 'centripetal', tension);
    const len = curve.getLength();
    const n = samples || Math.max(8, Math.ceil(len / 0.5));
    this.pts = curve.getSpacedPoints(n);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
    this.speed = speed;
    this.marks = {}; // named distances (e.g. hold points)
    // highway speed zones: start of entry routes / end of exit routes
    const first = this.pts[0], last = this.pts[this.pts.length - 1];
    if (Math.abs(first.z - (-42 + 1.8)) < 0.5 && first.x < -100) this.fastUntil = this.closestDist(new THREE.Vector3(-75, 0, -40.2));
    if (Math.abs(last.z - (-42 + 1.8)) < 0.5 && last.x > 100) this.fastAfter = this.closestDist(new THREE.Vector3(70, 0, -40.2));
  }
  _seg(d) {
    d = clamp(d, 0, this.length);
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= d) lo = m; else hi = m; }
    return [lo, hi, (d - this.cum[lo]) / Math.max(1e-6, this.cum[hi] - this.cum[lo])];
  }
  pointAt(d, out = new THREE.Vector3()) { const [a, b, t] = this._seg(d); return out.lerpVectors(this.pts[a], this.pts[b], t); }
  tangentAt(d, out = new THREE.Vector3()) { const [a, b] = this._seg(d); return out.subVectors(this.pts[b], this.pts[a]).normalize(); }
  /** Distance along path of the closest point to p (search window). */
  closestDist(p) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.pts.length; i++) { const d = this.pts[i].distanceToSquared(p); if (d < bd) { bd = d; best = this.cum[i]; } }
    return best;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _f = new THREE.Vector3();

/** A driving vehicle (car or truck) following Paths. */
export class CarAgent {
  constructor(traffic, model, { through = false } = {}) {
    this.traffic = traffic;
    this.game = traffic.game;
    this.m = model;
    this.group = model.group;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.maxSpeed = 10;
    this.path = null; this.dist = 0; this.reverse = false;
    this.holdAt = null; // stop at this path distance until released
    this.through = through;
    this.obb = makeOBB();
    this.obb.y1 = model.dims.H;
    this.halfL = model.dims.L / 2; this.halfW = model.dims.W / 2;
    this.parked = false;
    this.blockedTime = 0;
    this.honkCooldown = 0;
    this.brakeLight = 0;
    this.pitch = 0; this.roll = 0; this.bob = 0;
    this.wheelSpin = 0;
    this.steer = 0;
    this.alive = true;
    this.onArrive = null;
    this.extraY = 0; this.hop = 0; this.hopV = 0;
    this.lightsOn = false;
    this.body = this.game.physics.addKinematicBox(this.halfL * 0.95, model.dims.H * 0.42, this.halfW * 0.95);
    this.game.scene.add(this.group);
    this.game.colliders.dynamic.add(this);
    this.navStamped = false;
    this.engine = null;
  }

  setPath(path, { reverse = false, startDist = 0, hold = null, maxSpeed = null } = {}) {
    this.path = path; this.dist = startDist; this.reverse = reverse; this.holdAt = hold;
    if (maxSpeed) this.maxSpeed = maxSpeed; else this.maxSpeed = path.speed;
    this.arrived = false;
    this.setParked(false);
  }

  place(p, yaw) { this.pos.copy(p); this.yaw = yaw; this._apply(0); }

  setParked(on) {
    if (on === this.parked) return;
    this.parked = on;
    const nav = this.game.nav;
    if (on && !this.navStamped) { nav.rasterOBB(this.obb, 0.35, 'dyn', 1); this.navStamped = true; }
    if (!on && this.navStamped) { nav.rasterOBB(this.obb, 0.35, 'dyn', -1); this.navStamped = false; }
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  worldPoint(local, out = new THREE.Vector3()) { return out.copy(local).applyAxisAngle(UP, this.yaw).add(this.pos).setY(local.y + this.pos.y + this.extraY); }

  /** Looks ahead for things to brake for; returns free distance. */
  freeDistance() {
    const fwd = this.forward(_f);
    if (this.reverse) fwd.negate();
    const look = 5 + this.speed * 1.6;
    let free = Infinity;
    const check = (p, rad, dirDot = null) => {
      _v.subVectors(p, this.pos); _v.y = 0;
      const f = _v.dot(fwd);
      // only things ahead of the front half count (someone standing beside the car doesn't block it)
      if (f <= this.halfL * 0.5 || f > look + this.halfL) return;
      const lat = Math.abs(_v.x * fwd.z - _v.z * fwd.x);
      if (lat > this.halfW + rad + 0.25) return;
      if (dirDot !== null && dirDot < -0.3) return; // oncoming
      free = Math.min(free, f - this.halfL - rad);
    };
    for (const o of this.traffic.cars) {
      if (o === this || !o.alive) continue;
      if (Math.abs(o.pos.x - this.pos.x) > 40 || Math.abs(o.pos.z - this.pos.z) > 40) continue;
      const od = Math.cos(o.yaw - this.yaw);
      check(o.pos, Math.min(o.halfL, o.halfW + (1 - Math.abs(od)) * (o.halfL - o.halfW)), this.through ? od : null);
    }
    if (!this.through || Math.abs(this.pos.z - ROAD_Z) > 6) {
      for (const c of this.game.customers.list) {
        if (c.inCar || !c.char) continue;
        check(c.char.root.position, 0.4);
      }
      check(this.game.player.pos, 0.4);
    }
    return free;
  }

  update(dt) {
    if (!this.path) return;
    // target speed
    let target = this.maxSpeed;
    if ((this.path.fastUntil && this.dist < this.path.fastUntil) || (this.path.fastAfter && this.dist > this.path.fastAfter)) target = Math.max(target, 19);
    const remaining = (this.holdAt != null ? this.holdAt : this.path.length) - this.dist;
    target = Math.min(target, Math.sqrt(Math.max(0, 2 * 3.2 * Math.max(0, remaining - 0.05))));
    // slow in curves
    if (!this.through) {
      const look = 6 + this.speed * 1.6;
      const t1 = this.path.tangentAt(this.dist, _t), t2 = this.path.tangentAt(this.dist + look, _v);
      const curv = 1 - t1.dot(t2);
      if (curv > 0.02) target = Math.min(target, Math.max(4, this.maxSpeed * (1 - curv * 3.5)));
    }
    if (this.reverse) target = Math.min(target, 2.2);
    const free = this.freeDistance();
    if (free < Infinity) {
      const stopGap = this.through ? 4 : 1.2;
      target = Math.min(target, Math.max(0, Math.sqrt(Math.max(0, 2 * 5 * (free - stopGap)))));
      if (free < stopGap + 0.3) target = 0;
    }
    if (this.stunned > 0) { this.stunned -= dt; target = 0; }
    const accel = target > this.speed ? 2.6 : 7.5;
    const prev = this.speed;
    this.speed += clamp(target - this.speed, -accel * dt, accel * dt);
    const a = (this.speed - prev) / Math.max(dt, 1e-4);
    this.brakeLight = a < -1 || (this.speed < 0.1 && remaining < 1) ? 1 : 0;
    // blocked → honk
    if (target === 0 && remaining > 1.5 && free < Infinity) {
      this.blockedTime += dt;
      this.honkCooldown -= dt;
      if (this.blockedTime > 2.5 && this.honkCooldown <= 0 && !this.through) {
        this.game.audio.play('honk', { pos: this.pos, vol: 0.9, pitch: this.m.big ? 0.7 : rand(0.9, 1.15) });
        this.honkCooldown = rand(3, 6);
        if (this.onBlockedHonk) this.onBlockedHonk();
      }
    } else this.blockedTime = 0;
    this.dist += this.speed * dt;
    // arrival
    if (this.holdAt != null && this.dist >= this.holdAt - 0.05) { this.dist = Math.min(this.dist, this.holdAt); }
    if (!this.arrived && (this.dist >= this.path.length - 0.02 || (this.holdAt == null && this.path.length - this.dist < 0.25 && this.speed < 0.6))) {
      this.dist = this.path.length; this.arrived = true; this.speed = 0;
      if (this.onArrive) this.onArrive(this);
    }
    // pose
    const p = this.path.pointAt(this.dist, _v);
    const tan = this.path.tangentAt(Math.min(this.dist + 0.8, this.path.length), _t);
    let yaw = Math.atan2(-tan.z, tan.x);
    if (this.reverse) yaw += Math.PI;
    const prevYaw = this.yaw;
    this.pos.copy(p);
    this.yaw = this.speed > 0.05 || this.dist < 0.1 ? dampAngle(this.yaw, yaw, 8, dt) : this.yaw;
    const yawRate = wrapAngle(this.yaw - prevYaw) / Math.max(dt, 1e-4);
    this.steer = THREE.MathUtils.lerp(this.steer, clamp((yawRate * (this.m.T ? this.m.T.wb || 2.7 : 2.7)) / Math.max(1, this.speed) * (this.reverse ? -1 : 1), -0.6, 0.6), 1 - Math.exp(-8 * dt));
    this.pitch = THREE.MathUtils.lerp(this.pitch, clamp(-a * 0.006, -0.03, 0.03), 1 - Math.exp(-6 * dt));
    this.roll = THREE.MathUtils.lerp(this.roll, clamp(yawRate * this.speed * 0.004, -0.04, 0.04), 1 - Math.exp(-6 * dt));
    this._apply(dt);
  }

  _apply(dt) {
    const g = this.group;
    // comedic hop (backfire etc.)
    if (this.hop > 0 || this.extraY > 0) {
      this.hopV -= 25 * dt; this.extraY += this.hopV * dt;
      if (this.extraY <= 0) { this.extraY = 0; this.hopV = this.hop > 0.5 ? this.hopV * -0.35 : 0; this.hop *= 0.5; if (this.hop < 0.1) this.hop = 0; }
    }
    this.bob += dt * (2 + this.speed * 0.6);
    const idleShake = this.engine ? Math.sin(this.bob * 9) * 0.002 : 0;
    g.position.set(this.pos.x, this.pos.y + this.extraY + idleShake, this.pos.z);
    g.rotation.set(this.roll, this.yaw, this.pitch, 'YXZ');
    const R = this.m.T ? this.m.T.R : 0.35;
    this.wheelSpin -= (this.speed / R) * dt * (this.reverse ? -1 : 1);
    for (const w of this.m.wheels) {
      w.spin.rotation.z = w.side < 0 ? -this.wheelSpin : this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steer;
    }
    setOBB(this.obb, this.pos.x, this.pos.z, this.halfL, this.halfW, this.yaw);
    this.body.position.set(this.pos.x, this.m.dims.H * 0.45 + this.extraY, this.pos.z);
    this.body.quaternion.setFromEuler(0, this.yaw, 0);
    const fwd = this.forward(_f);
    const sv = this.speed * (this.reverse ? -1 : 1);
    this.body.velocity.set(fwd.x * sv, 0, fwd.z * sv);
    // lights
    const night = this.game.sky ? this.game.sky.nightFactor : 0;
    const on = night > 0.35;
    for (const h of this.m.lights.head) h.material.emissiveIntensity = on ? 3.5 : 0;
    for (const t of this.m.lights.tail) t.material.emissiveIntensity = this.brakeLight ? 3.2 : (on ? 1.4 : 0.1);
    if (this.m.lights.beam) this.m.lights.beam.visible = on && !this.parked;
  }

  dispose() {
    this.alive = false;
    this.setParked(false);
    this.game.scene.remove(this.group);
    this.game.colliders.dynamic.delete(this);
    this.game.physics.world.removeBody(this.body);
    if (this.engine) { this.engine.stop(); this.engine = null; }
    this.group.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshPhysicalMaterial && o.material.vertexColors) o.material.dispose(); });
  }
}

/**
 * Traffic manager: highway flow, routes into the station, slot/queue
 * reservation for pump lanes and parking, engine audio pooling.
 */
export class Traffic {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.spawnTimer = 2;
    this.pumpSlots = [];   // {island, lane, x, z, reservedBy}
    this.queue = { S: null, N: null };
    this.routes = {};
    this.buildRoutes();
  }

  buildRoutes() {
    const L = LAYOUT;
    // highway through paths
    this.routes.ebThrough = new Path([[-1300, LANE_EB], [1300, LANE_EB]], { speed: 24, samples: 400 });
    this.routes.wbThrough = new Path([[1300, LANE_WB], [-1300, LANE_WB]], { speed: 24, samples: 400 });
    this.entryHead = [[-170, LANE_EB], [-120, LANE_EB], [-60, LANE_EB], [-48, LANE_EB + 0.3], [-41, ROAD_Z + 4.6], [-35.5, -33.2], [-31.5, -28]];
    this.exitTail = [[34.5, -24], [36, -33.5], [43, ROAD_Z + 4.2], [52, LANE_EB - 0.1], [90, LANE_EB], [400, LANE_EB]];
  }

  setupSlots(islandsActive) {
    const L = LAYOUT;
    const prev = this.pumpSlots;
    this.pumpSlots = [];
    for (let i = 0; i < L.islandXs.length; i++) {
      if (!islandsActive[i]) continue;
      for (const lane of ['S', 'N']) {
        const old = prev.find((s) => s.island === i && s.lane === lane);
        this.pumpSlots.push({ island: i, lane, x: L.islandXs[i], z: L.laneZ[lane], reservedBy: old ? old.reservedBy : null, side: lane === 'S' ? 1 : -1 });
      }
    }
  }

  /** Free slot reachable from the west in a lane (all slots west of it empty). */
  findSlot(fuelOK = () => true) {
    const opts = [];
    for (const lane of ['S', 'N']) {
      const ls = this.pumpSlots.filter((s) => s.lane === lane).sort((a, b) => a.x - b.x);
      let best = null;
      for (const s of ls) { if (s.reservedBy) break; if (fuelOK(s)) best = s; }
      if (best) opts.push(best);
    }
    if (!opts.length) return null;
    return pick(opts);
  }

  routeToSlot(slot) {
    const z = slot.z;
    const pts = [...this.entryHead, [-27, z + (z < -17 ? -1.5 : 1.5) * 0], [-21, z], [slot.x - 3, z], [slot.x, z]];
    return new Path(pts, { speed: 9 });
  }
  routeToLaneHold(lane) {
    const z = LAYOUT.laneZ[lane];
    const pts = [...this.entryHead, [-27, z], [-21.5, z]];
    return new Path(pts, { speed: 9 });
  }
  routeFromHold(lane, slot) { return new Path([[-21.5, slot.z], [-17, slot.z], [slot.x - 2, slot.z], [slot.x, slot.z]], { speed: 6 }); }
  routeSlotExit(slot) {
    return new Path([[slot.x, slot.z], [slot.x + 4, slot.z], [20, slot.z], [27, slot.z + (slot.z < -17 ? -1 : 1) * 0.5], [32, -21], ...this.exitTail], { speed: 9 });
  }
  routeToParking(spot) {
    const x = spot.x;
    return new Path([...this.entryHead, [-30.5, -20], [-28, -12.5], [-23, -9.6], [x - 9, -9.6], [x - 4.2, -9.4], [x - 1.4, -8.0], [x, -6.0], [x, spot.z]], { speed: 8 });
  }
  routeParkingReverse(spot) { return new Path([[spot.x, spot.z], [spot.x, -6.6], [spot.x + 1.5, -8.6], [spot.x + 4, -9.6]], { speed: 2 }); }
  routeParkingExit(spot) { return new Path([[spot.x + 4, -9.6], [spot.x + 8, -9.6], [26, -9.6], [32, -12], [34, -18], ...this.exitTail.slice(0)], { speed: 8 }); }
  routeService(stopName) {
    // loop around the shop: delivery pad / tanker caps / back road
    const stopZ = stopName === 'tanker' ? -7.5 : 7.2;
    const p = new Path([...this.entryHead, [-30.5, -20], [-27.5, -12], [-26, stopZ - 3], [-26, stopZ], [-26, 13], [-22, 18.2], [0, 18.6], [26, 18.2], [33.5, 12], [35, 0], [35, -18], ...this.exitTail], { speed: 7 });
    p.marks.stop = p.closestDist(new THREE.Vector3(-26, 0, stopZ));
    return p;
  }
  routeCarwash() {
    const C = LAYOUT.carwash, cx = (C.minX + C.maxX) / 2;
    const p = new Path([...this.entryHead, [-30.5, -20], [-28, -12.5], [-23, -9.6], [12, -9.6], [19, -9.4], [cx, -6.2], [cx, -4], [cx, 2], [cx, 8.5], [cx + 3, 14], [33, 13], [35, 0], [35, -18], ...this.exitTail], { speed: 7 });
    p.marks.wash = p.closestDist(new THREE.Vector3(cx, 0, 2));
    return p;
  }

  spawnModel(type, opts = {}) {
    if (type === 'box' || type === 'tanker') return buildTruck(type);
    return buildCar(type, opts);
  }

  randomType() {
    const types = Object.keys(CAR_TYPES);
    return weightedPick(types, (t) => CAR_TYPES[t].w);
  }

  addCar(model, opts) {
    const c = new CarAgent(this, model, opts);
    this.cars.push(c);
    return c;
  }

  spawnThrough() {
    const eb = chance(0.5);
    const route = eb ? this.routes.ebThrough : this.routes.wbThrough;
    const big = chance(0.15);
    const model = big ? buildTruck(chance(0.5) ? 'box' : 'tanker', { color: pick([0xb3261e, 0x1f3f7a, 0xe8e8e4, 0x234d2e, 0x2a2c30]) }) : buildCar(this.randomType());
    const car = this.addCar(model, { through: true });
    car.setPath(route, { maxSpeed: big ? rand(18, 22) : rand(22, 30) });
    // start far from the player; avoid overlapping another car at spawn
    car.dist = rand(0, 60);
    for (const o of this.cars) if (o !== car && o.path === route && Math.abs(o.dist - car.dist) < 25) car.dist = Math.max(0, o.dist - 30);
    car.speed = car.maxSpeed;
    car.place(route.pointAt(car.dist), eb ? 0 : Math.PI);
    car.onArrive = () => this.remove(car);
  }

  remove(car) {
    car.dispose();
    const i = this.cars.indexOf(car); if (i >= 0) this.cars.splice(i, 1);
  }

  update(dt, hour) {
    // highway ambience
    this.spawnTimer -= dt;
    const rush = (hour > 7 && hour < 9.5) || (hour > 16.5 && hour < 19) ? 1.6 : hour > 22 || hour < 6 ? 0.4 : 1;
    if (this.spawnTimer <= 0) {
      const through = this.cars.filter((c) => c.through).length;
      if (through < 14) this.spawnThrough();
      this.spawnTimer = rand(2.5, 7) / rush;
    }
    for (const c of [...this.cars]) { try { c.update(dt); } catch (e) { console.error('car error', e); } }
    // engine sound pool: nearest moving cars
    const audio = this.game.audio;
    if (audio.ready) {
      const lp = this.game.player.pos;
      const sorted = this.cars.filter((c) => c.alive && (c.speed > 0.2 || c.engineIdle)).map((c) => [c, c.pos.distanceToSquared(lp)]).sort((a, b) => a[1] - b[1]);
      const keep = new Set(sorted.slice(0, 6).filter(([, d]) => d < 160 * 160).map(([c]) => c));
      for (const c of this.cars) {
        if (keep.has(c)) {
          if (!c.engine) c.engine = audio.createEngine(c.pos, c.m.big);
          if (c.engine) c.engine.set(c.pos, clamp(c.speed / 25, 0, 1.2) + (c.engineIdle ? 0.05 : 0), clamp(Math.abs(c.speed) / 10, 0.2, 1));
        } else if (c.engine) { c.engine.stop(); c.engine = null; }
      }
    }
  }
}
