import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { rand, pick, chance, dampAngle } from '../core/utils.js';

/**
 * Ambient wildlife: vultures circling overhead and a cheeky fox that raids
 * the trash and steals snacks.
 */
export class Animals {
  constructor(game, lib) {
    this.game = game;
    this.birds = [];
    this.fox = null;
    const birdGltf = lib.raw.bird;
    if (birdGltf) {
      for (let i = 0; i < 4; i++) {
        const m = birdGltf.scene.clone(true);
        m.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color(0x2a221c); o.castShadow = true; } });
        m.scale.setScalar(0.035);
        const mixer = new THREE.AnimationMixer(m);
        const a = mixer.clipAction(birdGltf.animations[0]); a.play(); a.time = Math.random(); a.timeScale = 0.6;
        game.scene.add(m);
        this.birds.push({ m, mixer, r: rand(30, 70), h: rand(35, 60), speed: rand(0.08, 0.14), t: rand(0, 6), cx: rand(-30, 30), cz: rand(-40, 30) });
      }
    }
    this.foxGltf = lib.raw.fox;
  }

  foxRaid() {
    const g = this.game;
    if (!this.foxGltf || this.fox) return;
    const m = SkeletonUtils.clone(this.foxGltf.scene);
    m.scale.setScalar(0.011);
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    const root = new THREE.Group(); root.add(m);
    const side = chance(0.5) ? -1 : 1;
    root.position.set(side * 50, 0, rand(-10, 10));
    g.scene.add(root);
    const mixer = new THREE.AnimationMixer(m);
    const clips = Object.fromEntries(this.foxGltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
    clips.Run && clips.Run.play();
    const targets = [g.station.dumpster.position.clone().add(new THREE.Vector3(1.3, 0, -1)), new THREE.Vector3(2.5, 0.15, -1.5), ...g.station.trashCans.map((t) => t.clone().setY(0).add(new THREE.Vector3(0.6, 0, 0.6)))];
    this.fox = { root, mixer, clips, target: pick(targets), state: 'in', t: 0, side, loot: false };
    g.ui.toast('🦊 A fox snuck in! Shoo it away (F) before it steals something', 'fun', 3.5);
  }

  update(dt) {
    const g = this.game;
    for (const b of this.birds) {
      b.t += dt * b.speed;
      b.mixer.update(dt);
      const x = b.cx + Math.cos(b.t) * b.r, z = b.cz + Math.sin(b.t) * b.r;
      b.m.position.set(x, b.h + Math.sin(b.t * 3) * 2, z);
      b.m.rotation.set(0.15, -b.t - Math.PI, 0.25);
    }
    const f = this.fox;
    if (!f) return;
    f.mixer.update(dt);
    f.t += dt;
    const p = f.root.position;
    const toT = f.target.clone().sub(p); toT.y = 0;
    const d = toT.length();
    const play = (n) => { if (f.cur === n) return; if (f.cur && f.clips[f.cur]) f.clips[f.cur].fadeOut(0.2); f.clips[n].reset().fadeIn(0.2).play(); f.cur = n; };
    const pd = g.player.pos.distanceTo(p);
    if (f.state === 'in') {
      play('Run');
      if (d > 0.4) { p.addScaledVector(toT.normalize(), Math.min(d, 6.5 * dt)); f.root.rotation.y = dampAngle(f.root.rotation.y, Math.atan2(toT.x, toT.z), 10, dt); }
      else { f.state = 'dig'; f.t = 0; }
    } else if (f.state === 'dig') {
      play('Survey');
      if (Math.random() < dt * 5) g.particles.dust(p.clone().add(new THREE.Vector3(0, 0.2, 0)), { count: 1, size: 0.3, sizeEnd: 0.7 });
      if (f.t > 5) {
        f.loot = true;
        g.cleaning.spawnLitter(p.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0.5))));
        g.cleaning.spawnLitter(p.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0.5))));
        g.funny.report('fox', p.clone(), null);
        f.state = 'out'; f.target = new THREE.Vector3(f.side * -60, 0, rand(-30, 30));
      }
    } else if (f.state === 'out' || f.state === 'flee') {
      play('Run');
      p.addScaledVector(toT.normalize(), (f.state === 'flee' ? 9 : 6.5) * dt);
      f.root.rotation.y = dampAngle(f.root.rotation.y, Math.atan2(toT.x, toT.z), 10, dt);
      if (d < 1 || Math.abs(p.x) > 70) { g.scene.remove(f.root); this.fox = null; return; }
    }
    // player scares it
    if (pd < 2.2 && f.state !== 'flee' && f.state !== 'out') {
      f.state = 'flee'; f.target = p.clone().add(p.clone().sub(g.player.pos).setY(0).normalize().multiplyScalar(80));
      g.ui.toast('🦊 Fox scared off! +XP', 'good', 2); g.economy.addXP(12);
      g.audio.play('whoosh', { pos: p });
    }
    p.y = g.colliders.groundHeight(p.x, p.z);
  }

  scare(pos) {
    const f = this.fox;
    if (f && f.root.position.distanceTo(pos) < 3.5 && f.state !== 'flee') {
      f.state = 'flee'; f.target = f.root.position.clone().add(f.root.position.clone().sub(pos).setY(0).normalize().multiplyScalar(80));
      this.game.economy.addXP(12);
      return true;
    }
    return false;
  }
}
