import * as THREE from 'three';
import { makeCone } from '../world/station.js';
import { rand, pick, chance, clamp } from '../core/utils.js';

const _v = new THREE.Vector3();

/**
 * Pickable / throwable physics props (boxes, cones, junk, tumbleweeds) and
 * the "hit a customer with it" detection.
 */
export class Props {
  constructor(game) {
    this.game = game;
    this.list = new Set();
    this.tumbleweeds = [];
    game.physics.onImpact = (prop, v) => this.onImpact(prop, v);
  }

  register(prop, data) {
    prop.data = { pickable: true, ...prop.data, ...data };
    prop.mesh.traverse((o) => { if (o.isMesh) o.userData.interact = { system: this, kind: 'prop', prop }; });
    if (!prop.mesh.isMesh) prop.mesh.userData.interact = { system: this, kind: 'prop', prop };
    this.game.interact.add(prop.mesh);
    this.list.add(prop);
    return prop;
  }

  remove(prop) {
    this.game.interact.remove(prop.mesh);
    this.game.physics.removeProp(prop);
    prop.mesh.removeFromParent();
    this.list.delete(prop);
    this.game.inventory.boxes.delete(prop);
  }

  spawnDecor() {
    // a few traffic cones and a loose tyre around the lot
    const g = this.game;
    for (const [x, z] of [[-14, -27], [-13.2, -27.4], [15, -26.5], [-30, -14], [24, -2]]) {
      const c = makeCone(g.mats); c.position.set(x, 0.4, z); c.rotation.y = rand(0, 6);
      g.scene.add(c);
      const p = g.physics.addProp(c, { size: new THREE.Vector3(0.4, 0.66, 0.4), mass: 1.2 });
      this.register(p, { kind: 'cone', name: 'Traffic cone' });
    }
    const tyreGeo = new THREE.TorusGeometry(0.3, 0.12, 10, 20);
    for (const [x, z] of [[-18, 12], [-17.2, 12.4]]) {
      const t = new THREE.Mesh(tyreGeo, g.mats.rubber); t.position.set(x, 0.2, z); t.rotation.x = Math.PI / 2; t.castShadow = true;
      g.scene.add(t);
      const p = g.physics.addProp(t, { shape: 'cylinder', radius: 0.42, height: 0.24, mass: 8 });
      p.body.quaternion.setFromEuler(Math.PI / 2, 0, 0);
      this.register(p, { kind: 'junk', name: 'Old tyre' });
    }
  }

  prompt(it, player) {
    const p = it.prop;
    if (!p.data.pickable || p.held) return null;
    if (player.held) return { text: p.data.name || 'Object', sub: 'Hands full' };
    const extra = p.data.kind === 'box' ? ` (${p.data.count} items)` : '';
    return { key: 'E', text: `Pick up ${p.data.name || 'object'}${extra}`, sub: p.data.kind === 'box' ? 'Carry it to the matching shelf' : 'RMB to throw it' };
  }

  interact(it, player, action) {
    if (action !== 'E' || player.held) return false;
    const p = it.prop;
    if (!p.data.pickable || p.held) return false;
    this.pick(p, player);
    return true;
  }

  pick(p, player) {
    p.held = true;
    this.game.physics.world.removeBody(p.body);
    player.hold({ kind: 'prop', prop: p, system: this });
    this.game.audio.play('swing', { vol: 0.4 });
    if (p.data.kind === 'box') this.game.tutorial.event('boxPicked');
  }

  /** Release a held prop. throwSpeed=0 → gentle drop. */
  release(p, player, throwSpeed = 0) {
    const g = this.game;
    p.held = false;
    const cam = player.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const start = player.eye.clone().addScaledVector(dir, 0.75);
    start.y -= 0.25;
    // keep inside walls: step back if blocked
    p.mesh.removeFromParent();
    g.scene.add(p.mesh);
    p.mesh.position.copy(start);
    p.mesh.quaternion.copy(cam.quaternion);
    p.body.position.set(start.x, start.y, start.z);
    p.body.quaternion.set(cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w);
    const v = dir.multiplyScalar(throwSpeed).add(player.vel.clone().multiplyScalar(0.8));
    if (throwSpeed > 0) v.y += 2.2;
    p.body.velocity.set(v.x, v.y, v.z);
    p.body.angularVelocity.set(rand(-4, 4), rand(-4, 4), rand(-4, 4));
    g.physics.world.addBody(p.body);
    p.body.wakeUp();
    p.thrownAt = performance.now();
    if (throwSpeed > 0) g.audio.play('whoosh', { vol: 0.6 });
    // thrown into dumpster / bin?
    if (p.data.kind === 'box' && p.data.count <= 0) p.data.trash = true;
  }

  onImpact(prop, v) {
    const g = this.game;
    const pos = prop.body.position;
    g.audio.play(prop.data && prop.data.kind === 'box' ? 'thud' : 'impact', { pos: new THREE.Vector3(pos.x, pos.y, pos.z), vol: clamp(v / 8, 0.15, 1), pitch: prop.data && prop.data.kind === 'cone' ? 1.6 : 1 });
  }

  update(dt) {
    const g = this.game;
    for (const p of this.list) {
      if (p.held) continue;
      const b = p.body;
      const sp = b.velocity.length();
      // hit customers with fast props
      if (sp > 4.5) {
        _v.set(b.position.x, b.position.y, b.position.z);
        for (const c of g.customers.list) {
          if (c.inCar || c.char.isRagdoll) continue;
          const cp = c.pos;
          const dx = cp.x - _v.x, dz = cp.z - _v.z;
          if (dx * dx + dz * dz < 0.5 * 0.5 && _v.y > cp.y + 0.2 && _v.y < cp.y + 1.95) {
            const imp = new THREE.Vector3(b.velocity.x, Math.max(1, b.velocity.y) + 2, b.velocity.z).multiplyScalar(b.mass * 1.2 + 6);
            const part = _v.y > cp.y + 1.45 ? 'head' : 'torso';
            g.audio.play('bonk', { pos: _v });
            g.particles.stars(_v.clone(), 8);
            c.knock(new THREE.Vector3(b.velocity.x * 0.3, 0.5, b.velocity.z * 0.3), imp, p.data.kind === 'tumbleweed' ? 'tumbleweed' : 'throw', part);
            b.velocity.scale(-0.3, b.velocity);
            if (p.data.kind !== 'tumbleweed') g.economy.rep(-0.03, null);
          }
        }
      }
      // trash disposal: empty boxes / junk landing in dumpster or bins
      if (p.data.trash || p.data.kind === 'litter') {
        const dumpster = g.station.dumpster.position;
        const nearDump = Math.abs(b.position.x - dumpster.x) < 1.1 && Math.abs(b.position.z - dumpster.z) < 0.8 && b.position.y < 2.2;
        let nearBin = false;
        for (const t of g.station.trashCans) if (Math.hypot(b.position.x - t.x, b.position.z - t.z) < 0.45 && b.position.y < 1.4) nearBin = true;
        if (nearDump || nearBin) {
          g.audio.play('trash', { pos: new THREE.Vector3(b.position.x, b.position.y, b.position.z) });
          g.economy.addXP(2);
          g.ui.float('+🧹', new THREE.Vector3(b.position.x, b.position.y + 0.5, b.position.z), 'xp');
          this.remove(p);
          if (p.data.kind === 'box') g.economy.stats.boxesBinned = (g.economy.stats.boxesBinned || 0) + 1;
          continue;
        }
      }
      // tumbleweed wind
      if (p.data.kind === 'tumbleweed') {
        p.life -= dt;
        const w = g.sky.weather.wind;
        b.applyForce(new (b.velocity.constructor)(4.5 * w * p.windDir.x, 0, 4.5 * w * p.windDir.z), b.position);
        if (b.position.y < 0.6 && Math.random() < dt * 1.5) b.applyImpulse(new (b.velocity.constructor)(0, rand(2, 5), 0), b.position);
        if (p.life <= 0 || Math.abs(b.position.x) > 120 || Math.abs(b.position.z) > 120) { this.remove(p); this.tumbleweeds.splice(this.tumbleweeds.indexOf(p), 1); }
      }
    }
  }

  spawnTumbleweed(big = false) {
    const g = this.game;
    const r = big ? 0.9 : rand(0.35, 0.6);
    const geo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 260; i++) {
      const a = new THREE.Vector3().randomDirection().multiplyScalar(r * rand(0.6, 1));
      const b = a.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(r * 0.6)).clampLength(0, r);
      pts.push(a, b);
    }
    geo.setFromPoints(pts);
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8a6a42 }));
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.75, 1), new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false }));
    core.castShadow = true;
    const grp = new THREE.Group(); grp.add(lines, core);
    const side = chance(0.5) ? -1 : 1;
    grp.position.set(side * -60, r + 0.5, rand(-34, 8));
    g.scene.add(grp);
    const p = g.physics.addProp(grp, { shape: 'sphere', radius: r, mass: big ? 8 : 2.5, damping: 0.05, angDamping: 0.05, sleep: false });
    p.body.velocity.set(side * rand(4, 7), 0, rand(-1, 1));
    this.register(p, { kind: 'tumbleweed', name: 'Tumbleweed', pickable: !big });
    p.windDir = new THREE.Vector3(side, 0, rand(-0.25, 0.25)).normalize();
    p.life = 60;
    this.tumbleweeds.push(p);
    return p;
  }
}
