import * as THREE from 'three';
import { planeGeo } from '../gfx/materials.js';
import { LAYOUT } from '../world/station.js';
import { SHOP } from '../world/shop.js';
import { rand, pick, chance, clamp } from '../core/utils.js';
import { canvasTexture } from '../gfx/textures.js';

const FY = LAYOUT.shop.floor;

/**
 * Slip hazards (oil, soda, banana peels) and litter. Mopping = hold E.
 */
export class Cleaning {
  constructor(game) {
    this.game = game;
    this.hazards = [];
    this.litter = [];
    this.timer = 20;
    this.litterTimer = 15;
    this.mopTarget = null;
    this.mopProgress = 0;
    const bananaTex = canvasTexture(64, 64, (ctx, w) => { ctx.fillStyle = '#f2d43a'; ctx.beginPath(); ctx.ellipse(w / 2, w / 2, w * 0.4, w * 0.18, 0.4, 0, 7); ctx.fill(); ctx.fillStyle = '#6b4a1a'; ctx.fillRect(w * 0.15, w * 0.2, 6, 6); });
    this.bananaMat = new THREE.MeshStandardMaterial({ map: bananaTex, roughness: 0.6 });
    this.sodaMat = new THREE.MeshStandardMaterial({ map: game.mats.oil.map, color: 0x6a2a10, transparent: true, depthWrite: false, roughness: 0.05, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -3, envMapIntensity: 1.5 });
  }

  addHazard(kind, pos, size = null) {
    const g = this.game;
    let mesh;
    if (kind === 'banana') {
      mesh = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const peel = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), this.bananaMat);
        peel.scale.set(0.5, 0.25, 1.4); peel.rotation.y = i * 2.1; peel.position.set(Math.sin(i * 2.1) * 0.06, 0.01, Math.cos(i * 2.1) * 0.06);
        peel.rotation.z = 0.5; mesh.add(peel);
      }
      mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    } else {
      const s = size || (kind === 'oil' ? rand(1.0, 1.8) : rand(0.8, 1.3));
      mesh = new THREE.Mesh(planeGeo(s, s, 0), kind === 'oil' ? g.mats.oil : this.sodaMat);
      mesh.rotation.y = rand(0, 6);
    }
    mesh.position.copy(pos); mesh.position.y = g.colliders.groundHeight(pos.x, pos.z) + 0.04 + this.hazards.length * 0.0004;
    g.scene.add(mesh);
    const h = { kind, pos: mesh.position.clone(), radius: kind === 'banana' ? 0.35 : (size || 1.2) * 0.42, mesh, grow: kind === 'oil' ? 0.2 : 0 };
    if (kind !== 'banana') mesh.scale.setScalar(0.3);
    mesh.traverse((o) => { o.userData.interact = { system: this, kind: 'hazard', hazard: h }; });
    g.interact.add(mesh);
    this.hazards.push(h);
    return h;
  }

  removeHazard(h) {
    const i = this.hazards.indexOf(h); if (i >= 0) this.hazards.splice(i, 1);
    this.game.interact.remove(h.mesh);
    h.mesh.removeFromParent();
  }

  hazardAt(p) {
    for (const h of this.hazards) {
      const dx = p.x - h.pos.x, dz = p.z - h.pos.z;
      if (dx * dx + dz * dz < h.radius * h.radius && Math.abs(p.y - h.pos.y) < 0.6) return h;
    }
    return null;
  }

  onSlip(h) {
    if (h.kind === 'banana') {
      // peel goes flying
      const g = this.game;
      g.particles.emit('star', h.pos.clone().setY(h.pos.y + 0.2), { count: 4, size: 0.15, life: 0.6, velSpread: 2, color: 0xffe14a });
      this.removeHazard(h);
    }
  }

  spawnLitter(pos) {
    const g = this.game;
    const kinds = [
      () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.12, 10), new THREE.MeshStandardMaterial({ color: pick([0xffffff, 0xd23a24, 0x2a8bd6]), roughness: 0.6 })); return [m, 'cylinder', 0.045, 0.12, 'Paper cup']; },
      () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 0.05), new THREE.MeshStandardMaterial({ color: pick([0x5a2d16, 0x2e9e4f, 0xc8102e]), roughness: 0.5, metalness: 0.4 })); return [m, 'box', 0, 0, 'Wrapper']; },
      () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.11, 10), new THREE.MeshStandardMaterial({ color: 0xc8102e, metalness: 0.7, roughness: 0.3 })); return [m, 'cylinder', 0.033, 0.11, 'Crushed can']; },
      () => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.9 })); m.scale.set(1, 0.8, 1.2); return [m, 'sphere', 0.07, 0, 'Crumpled paper']; },
    ];
    const [mesh, shape, radius, height, name] = pick(kinds)();
    mesh.castShadow = true;
    mesh.position.copy(pos); mesh.position.y = g.colliders.groundHeight(pos.x, pos.z) + 0.1;
    g.scene.add(mesh);
    const prop = g.physics.addProp(mesh, { shape, radius, height, mass: 0.15 });
    prop.body.angularVelocity.set(rand(-3, 3), 0, rand(-3, 3));
    g.props.register(prop, { kind: 'litter', name, trash: true });
    this.litter.push(prop);
    return prop;
  }

  // ------------------------------------------------------------ interaction
  prompt(it, player) {
    const h = it.hazard;
    if (h.kind === 'banana') return player.held ? null : { key: 'E', text: 'Pick up banana peel', sub: 'Or... leave it there 😈' };
    return { key: 'E', text: `Hold: Mop up ${h.kind === 'oil' ? 'oil spill' : 'sticky soda'}`, sub: 'Customers WILL slip on this', progress: this.mopTarget === h ? this.mopProgress : null };
  }
  interact(it, player, action) {
    const h = it.hazard;
    if (h.kind === 'banana' && action === 'E' && !player.held) {
      this.removeHazard(h);
      this.game.audio.play('trash', { pos: h.pos, vol: 0.5 });
      this.game.economy.addXP(3);
      return true;
    }
    if (h.kind !== 'banana' && (action === 'EHold' || action === 'E')) {
      if (this.mopTarget !== h) { this.mopTarget = h; this.mopProgress = 0; }
      this.mopping = 0.15;
      return true;
    }
    return false;
  }

  update(dt) {
    const g = this.game;
    // mop progress while E held on a hazard
    if (this.mopping > 0) {
      this.mopping -= dt;
      const h = this.mopTarget;
      if (h) {
        this.mopProgress += dt / 1.3;
        g.player.mopAnim = 0.3;
        if (Math.random() < dt * 4) g.audio.play('mop', { pos: h.pos, vol: 0.6 });
        h.mesh.scale.setScalar(Math.max(0.2, 1 - this.mopProgress * 0.8));
        if (this.mopProgress >= 1) {
          this.removeHazard(h);
          g.economy.addXP(6);
          g.ui.float('✨ CLEAN', h.pos.clone().setY(h.pos.y + 0.8), 'xp');
          g.audio.play('coin', { pos: h.pos, pitch: 1.3 });
          g.tutorial.event('mopped');
          this.mopTarget = null; this.mopProgress = 0;
        }
      }
    } else if (this.mopTarget) { this.mopTarget = null; this.mopProgress = 0; }
    // grow fresh puddles
    for (const h of this.hazards) {
      if (h.kind === 'banana') continue;
      const s = h.mesh.scale.x;
      if (s < 1 && this.mopTarget !== h) h.mesh.scale.setScalar(Math.min(1, s + dt * 0.4));
    }
    // ambient generation of hazards & litter while open
    if (!g.clock.open || g.tutorial.active) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = rand(35, 70) / (g.upgrades.has('janitor') ? 0.6 : 1);
      if (this.hazards.length < 5) {
        if (chance(0.6)) {
          // oil drip under a parked car at the pumps
          const cars = g.traffic.cars.filter((c) => c.parked && !c.m.big);
          const car = cars.length ? pick(cars) : null;
          const p = car ? car.pos.clone().add(new THREE.Vector3(rand(-1, 1), 0, rand(-0.5, 0.5))) : new THREE.Vector3(rand(-12, 12), 0, pick([-19.4, -14.6]) + rand(-1, 1));
          this.addHazard('oil', p);
        } else {
          const inside = new THREE.Vector3(rand(-2.5, 7), FY, rand(2.2, 11));
          if (!g.colliders.pointBlocked(inside.x, inside.z, 0.3)) this.addHazard('soda', inside);
        }
      }
    }
    this.litterTimer -= dt;
    if (this.litterTimer <= 0) {
      this.litterTimer = rand(12, 30);
      this.litter = this.litter.filter((p) => g.props.list.has(p));
      if (this.litter.length < 14) {
        const c = g.customers.list.filter((x) => !x.inCar);
        const p = c.length && chance(0.7) ? pick(c).pos.clone() : new THREE.Vector3(rand(-20, 20), 0, rand(-30, -2));
        this.spawnLitter(p.add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0.5))));
      }
    }
    // janitor auto-cleans slowly
    if (g.upgrades.has('janitor')) {
      this.janitorT = (this.janitorT || 0) + dt;
      if (this.janitorT > 18) {
        this.janitorT = 0;
        const h = this.hazards.find((x) => x.kind !== 'banana') || this.hazards[0];
        if (h) { this.removeHazard(h); g.ui.toast('🧹 Janitor cleaned a spill', 'good', 1.5); }
        else { const l = this.litter.find((p) => g.props.list.has(p)); if (l) g.props.remove(l); }
      }
    }
  }

  cleanliness() {
    const litter = this.litter.filter((p) => this.game.props.list.has(p)).length;
    return clamp(1 - litter * 0.035 - this.hazards.length * 0.07, 0, 1);
  }

  serialize() { return {}; }
}

export { SHOP };
