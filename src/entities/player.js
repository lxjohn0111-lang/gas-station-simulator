import * as THREE from 'three';
import { LAYOUT } from '../world/station.js';
import { LOT } from '../world/terrain.js';
import { clamp, lerp, damp, rand } from '../core/utils.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const EYE = 1.66;

/**
 * First-person controller: movement with collisions, head-bob, footsteps,
 * interaction raycasts, holding/throwing items, shoving.
 */
export class Player {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 3000);
    game.scene.add(this.camera);
    this.pos = new THREE.Vector3(-3, 0, -24.5);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI * 0.95; this.pitch = -0.08;
    this.eye = new THREE.Vector3();
    this.onGround = true;
    this.vy = 0;
    this.bob = 0; this.bobAmp = 0; this.lastStep = 0;
    this.shake = 0;
    this.landDip = 0;
    this.held = null;
    this.viewmodel = new THREE.Group();
    this.camera.add(this.viewmodel);
    this.sway = new THREE.Vector2();
    this.kick = 0;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 3.0;
    this.target = null;
    this.fixed = null;
    this.fov = 72;
    this.useHoldT = 0;
    this.mopAnim = 0;
    this.knock = new THREE.Vector3();
    this.buildMop();
    this.updateCamera(0);
  }

  forward(out = new THREE.Vector3()) { return this.camera.getWorldDirection(out); }

  buildMop() {
    const M = this.game.mats;
    const g = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 8), M.wood); stick.position.y = 0.4; g.add(stick);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.06, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 1 })); head.position.y = -0.25; g.add(head);
    g.position.set(0.25, -0.45, -0.7); g.rotation.set(-0.6, 0, -0.3);
    g.visible = false;
    this.viewmodel.add(g);
    this.mop = g;
  }

  // ------------------------------------------------------------------ holding
  hold(item) {
    this.held = item;
    if (item.kind === 'nozzle') {
      const n = item.nozzle.group;
      this.viewmodel.add(n);
      n.position.set(0.24, -0.26, -0.5);
      n.rotation.set(0.15, Math.PI, 0);
      item.nozzle.state = 'held';
    } else if (item.kind === 'prop') {
      const m = item.prop.mesh;
      this.viewmodel.add(m);
      const isBox = item.prop.data.kind === 'box';
      m.position.set(isBox ? 0 : 0.28, isBox ? -0.36 : -0.3, isBox ? -0.72 : -0.6);
      m.quaternion.identity();
      if (item.prop.data.kind === 'cone') m.rotation.x = 0.3;
    }
    this.kick = 0.6;
    this.game.ui.updateHeld(this.held);
  }

  /** silent=true: caller handles the object (e.g. nozzle returning home). */
  drop(silent = false, throwSpeed = 0) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    if (!silent) {
      if (h.kind === 'nozzle') { h.system.returnNozzle(h.nozzle); this.game.audio.play('whoosh', { vol: 0.5 }); }
      else if (h.kind === 'prop') h.system.release(h.prop, this, throwSpeed);
    }
    this.game.ui.updateHeld(null);
  }

  viewKick(k) { this.kick = Math.max(this.kick, k); }

  knockback(v) { this.vel.add(v.clone().setY(0)); this.vy = Math.max(this.vy, v.y); this.onGround = false; this.shake = Math.max(this.shake, 0.4); }

  // ------------------------------------------------------------------ fixed view (register)
  enterFixedView(pos, look) {
    this.fixed = { pos, look, t: 0, fromPos: this.camera.position.clone(), fromQ: this.camera.quaternion.clone() };
    const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    this.fixed.q = new THREE.Quaternion().setFromRotationMatrix(m);
  }
  exitFixedView() {
    this.fixed = null;
    // sync yaw/pitch to current camera direction
    const d = this.forward(_v);
    this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.pos.set(this.camera.position.x, this.game.colliders.groundHeight(this.camera.position.x, this.camera.position.z), this.camera.position.z);
  }

  pointerPick(targets) {
    const p = this.input.pointer;
    this.raycaster.far = 6;
    this.raycaster.setFromCamera(new THREE.Vector2(p.nx, p.ny), this.camera);
    const hits = this.raycaster.intersectObjects(targets, false);
    this.raycaster.far = 3.0;
    return hits[0] || null;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game, inp = this.input;
    if (this.fixed) {
      const f = this.fixed;
      f.t = Math.min(1, f.t + dt * 3.5);
      const k = 1 - Math.pow(1 - f.t, 3);
      this.camera.position.lerpVectors(f.fromPos, f.pos, k);
      this.camera.quaternion.slerpQuaternions(f.fromQ, f.q, k);
      this.viewmodel.visible = false;
      return;
    }
    this.viewmodel.visible = true;
    const playing = g.state === 'play' && !g.ui.tabletOpen && (inp.locked || inp.isTouch || inp.freeLook);
    // look
    const look = inp.consumeLook();
    if (playing) {
      this.yaw -= look.dx; this.pitch -= look.dy;
      this.pitch = clamp(this.pitch, -1.45, 1.45);
      this.sway.x = damp(this.sway.x, clamp(look.dx * 6, -0.08, 0.08), 10, dt);
      this.sway.y = damp(this.sway.y, clamp(look.dy * 6, -0.08, 0.08), 10, dt);
    }
    // move
    const ax = playing ? inp.moveAxes() : { x: 0, y: 0 };
    const sprint = playing && (inp.down('ShiftLeft') || inp.down('ShiftRight') || (inp.joy.active && ax.analog > 0.95));
    const heldHeavy = this.held && this.held.kind === 'prop' && this.held.prop.data.kind === 'box';
    const maxSpeed = (sprint ? 6.0 : 3.4) * (heldHeavy ? 0.85 : 1);
    const fwd = _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = _w.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const want = new THREE.Vector3().addScaledVector(fwd, ax.y).addScaledVector(right, ax.x);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(maxSpeed);
    const accel = this.onGround ? 14 : 3;
    this.vel.x = damp(this.vel.x, want.x, accel, dt);
    this.vel.z = damp(this.vel.z, want.z, accel, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    // jump & gravity
    if (playing && inp.pressed('Space') && this.onGround) { this.vy = 4.6; this.onGround = false; g.audio.footstep(this.surface(), null, 0.6); }
    this.vy -= 13 * dt;
    this.pos.y += this.vy * dt;
    // collisions
    g.colliders.resolveCircle(this.pos, 0.32, this.pos.y, 1.8, { isPlayer: true });
    this.pos.x = clamp(this.pos.x, -120, 120); this.pos.z = clamp(this.pos.z, -95, 90);
    const gh = g.colliders.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gh) {
      if (!this.onGround && this.vy < -4) { this.landDip = Math.min(0.12, -this.vy * 0.015); g.audio.footstep(this.surface(), null, 0.9); }
      this.pos.y = gh; this.vy = 0; this.onGround = true;
    } else if (this.pos.y - gh < 0.36 && this.vy <= 0 && this.onGround) {
      this.pos.y = gh; // step down smoothly
    } else this.onGround = this.pos.y - gh < 0.02;
    // head bob & footsteps
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.bobAmp = damp(this.bobAmp, this.onGround ? clamp(sp / 5, 0, 1.2) : 0, 8, dt);
    this.bob += dt * (4.2 + sp * 1.25);
    const stepPhase = Math.floor(this.bob / Math.PI);
    if (stepPhase !== this.lastStep && this.onGround && sp > 0.6) { this.lastStep = stepPhase; g.audio.footstep(this.surface(), null, clamp(sp / 4, 0.3, 1)); }
    this.landDip = damp(this.landDip, 0, 6, dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.kick = Math.max(0, this.kick - dt * 3);
    // fov
    const targetFov = this.fov + (sprint && sp > 4 ? 7 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) { this.camera.fov = damp(this.camera.fov, targetFov, 6, dt); this.camera.updateProjectionMatrix(); }
    this.updateCamera(dt);
    if (playing) this.handleInteraction(dt);
    this.updateViewmodel(dt, sp);
  }

  surface() {
    const p = this.pos, S = LAYOUT.shop;
    if (p.x > S.minX && p.x < S.maxX && p.z > S.minZ && p.z < S.maxZ) return 'tile';
    if (p.x < LOT.minX || p.x > LOT.maxX || p.z > LOT.maxZ + 4 || (p.z < -37 && p.z > -47 && false)) return 'sand';
    if (p.y > 0.16 && p.y < 0.2) return 'concrete';
    return 'concrete';
  }

  updateCamera() {
    const bx = Math.cos(this.bob) * 0.035 * this.bobAmp;
    const by = Math.abs(Math.sin(this.bob)) * 0.05 * this.bobAmp;
    const sh = this.shake * this.shake;
    this.eye.set(this.pos.x, this.pos.y + EYE - this.landDip + by, this.pos.z);
    this.camera.position.copy(this.eye);
    const right = _w.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.camera.position.addScaledVector(right, bx);
    this.camera.rotation.set(this.pitch + (Math.random() - 0.5) * sh * 0.08, this.yaw + (Math.random() - 0.5) * sh * 0.08, bx * 0.15, 'YXZ');
  }

  updateViewmodel(dt, sp) {
    const vm = this.viewmodel;
    const bx = Math.cos(this.bob) * 0.012 * this.bobAmp, by = Math.abs(Math.sin(this.bob)) * 0.016 * this.bobAmp;
    vm.position.set(-this.sway.x * 0.6 + bx, this.sway.y * 0.6 - by - this.kick * 0.03, this.kick * 0.04);
    vm.rotation.set(this.sway.y * 0.8, this.sway.x * 0.8, 0);
    this.mopAnim = Math.max(0, this.mopAnim - dt);
    this.mop.visible = this.mopAnim > 0 && !this.held;
    if (this.mop.visible) { const t = performance.now() * 0.012; this.mop.position.x = 0.15 + Math.sin(t) * 0.15; this.mop.rotation.z = -0.3 + Math.sin(t) * 0.3; }
    void sp;
  }

  handleInteraction(dt) {
    const g = this.game, inp = this.input;
    // raycast from screen centre
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.raycaster.intersectObjects(g.interact.objects, false);
    let it = null, hitObj = null;
    for (const h of hits) {
      const u = h.object.userData.interact;
      if (!u) continue;
      if (u.kind === 'prop' && u.prop.held) continue;
      if (u.kind === 'nozzle' && u.nozzle.state === 'held') continue;
      it = u; hitObj = h; break;
    }
    // special: when holding a nozzle, look for fuel caps with a looser cone (they are small)
    if (this.held && this.held.kind === 'nozzle' && (!it || it.kind !== 'fuelcap')) {
      const f = this.forward(_v);
      let best = null, bd = 0.9;
      for (const s of g.fuel.services) {
        if (!s.capHit || s.nozzle || s.state === 'done') continue;
        const cp = s.capHit.getWorldPosition(_w);
        const d = cp.distanceTo(this.eye);
        if (d > 2.8) continue;
        const dot = cp.clone().sub(this.eye).normalize().dot(f);
        if (dot > bd) { bd = dot; best = s; }
      }
      if (best && bd > 0.93) it = best.capHit.userData.interact;
    }
    // forgiving targeting for nozzles sitting in cars (small meshes)
    if (!it && !this.held) {
      const f = this.forward(_v);
      for (const s of g.fuel.services) {
        if (!s.nozzle || s.nozzle.state !== 'inCar') continue;
        const np = s.nozzle.group.position;
        const d = np.distanceTo(this.eye);
        if (d > 3.2) continue;
        if (np.clone().sub(this.eye).normalize().dot(f) > 0.9) { it = s.nozzle.group.children[0].userData.interact; break; }
      }
    }
    this.target = it;
    const prompt = it ? it.system.prompt(it, this) : null;
    g.ui.setPrompt(prompt);
    // actions
    if (inp.pressed('KeyE')) {
      if (!(it && it.system.interact(it, this, 'E'))) {
        // fix jammed door by pressing E near it
        this.tryDoor();
      }
    } else if (inp.down('KeyE') && it && it.kind === 'hazard') it.system.interact(it, this, 'EHold');
    if (inp.mousePressed(0)) {
      this.useHoldT = 0;
      if (it) it.system.interact(it, this, 'useStart');
    } else if (inp.mouseDown(0) && it && it.kind === 'slot') {
      this.useHoldT += dt;
      if (this.useHoldT > 0.16) { this.useHoldT = 0; it.system.interact(it, this, 'useHold'); }
    }
    if (inp.mousePressed(2) && this.held) {
      if (this.held.kind === 'prop') { this.drop(false, 11); this.kick = 1; g.audio.play('swing'); }
      else this.drop(false);
    }
    if (inp.pressed('KeyQ') || inp.pressed('KeyG')) this.drop(false, 0);
    if (inp.pressed('KeyF')) this.shove();
    void hitObj;
  }

  tryDoor() {
    const g = this.game, D = LAYOUT.door;
    if (g.station.doorJammed && Math.abs(this.pos.x - D.x) < 2 && Math.abs(this.pos.z - LAYOUT.shop.minZ) < 2.2) {
      g.station.doorJammed = false; g.funny.doorJamTimer = 0;
      g.audio.play('impact', { pos: this.pos }); g.audio.play('chime', { vol: 0.4 });
      g.ui.toast('🦶 You kicked the door. It works again!', 'good', 2);
      this.shake = 0.3;
      return true;
    }
    return false;
  }

  shove() {
    const g = this.game;
    const f = this.forward(new THREE.Vector3()); f.y = 0; f.normalize();
    this.kick = 1;
    g.audio.play('swing', { vol: 0.6 });
    if (this.tryDoor()) return;
    let best = null, bd = 2.0;
    for (const c of g.customers.list) {
      if (c.inCar) continue;
      const d = _v.subVectors(c.pos, this.pos); d.y = 0;
      const dist = d.length();
      if (dist > 2.0) continue;
      const dot = d.normalize().dot(f);
      if (dot > 0.55 && dist < bd) { bd = dist; best = c; }
    }
    if (best) {
      g.audio.play('hit', { pos: best.pos });
      this.shake = 0.25;
      const imp = f.clone().multiplyScalar(110).setY(45);
      best.knock(f.clone().multiplyScalar(4.5).setY(2.2), imp, 'shove', 'torso');
      if (best.isFleeing) { g.ui.toast('👮 Tackled the shoplifter!', 'good'); }
      else { g.economy.rep(-0.04, best.pos); best.setMood(-0.4); }
      return;
    }
    if (g.animals.scare(this.pos)) { g.ui.toast('🦊 Shoo!', 'good', 1.5); return; }
    // kick props in front
    for (const p of g.props.list) {
      if (p.held) continue;
      const bp = p.body.position;
      _v.set(bp.x - this.pos.x, 0, bp.z - this.pos.z);
      const dist = _v.length();
      if (dist < 1.6 && _v.normalize().dot(f) > 0.5) {
        p.body.wakeUp();
        const k = 9 * p.body.mass;
        p.body.applyImpulse(new (p.body.velocity.constructor)(f.x * k, k * 0.45, f.z * k), p.body.position);
        g.audio.play('impact', { pos: new THREE.Vector3(bp.x, bp.y, bp.z), vol: 0.7 });
      }
    }
  }
}
