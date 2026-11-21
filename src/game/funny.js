import * as THREE from 'three';
import { SHOP } from '../world/shop.js';
import { LAYOUT } from '../world/station.js';
import { rand, pick, chance } from '../core/utils.js';

const CAPTIONS = {
  slip: ['SLIPPED ON OIL! 🛢️', 'GRAVITY CHECK FAILED', 'WIPEOUT!', 'THE FLOOR IS LAVA… AND OIL', 'BALLET? NO. OIL.'],
  banana: ['BANANA PEEL CLASSIC 🍌', 'CARTOON PHYSICS ACTIVATED', 'PEEL-ED OUT!'],
  shove: ['RUDE!! 😂', 'CUSTOMER SERVICE (AGGRESSIVE)', 'YEET!'],
  throw: ['HEADSHOT! 🎯', 'DELIVERED… TO THE FACE', 'BOX TO THE DOME'],
  tumbleweed: ['TUMBLEWEED ATTACK!', 'DESERT NATURE STRIKES', 'ROLLED BY A BUSH'],
  bonk: ['BONK! 🚪', 'DOOR 1 — HUMAN 0', 'GLASS IS HARD'],
  pole: ['WALKED INTO A POLE 📱', 'EYES UP, BUDDY', 'PHONE ZOMBIE DOWN'],
  backfire: ['KABOOM! WRONG FUEL 💥', 'THAT\'S NOT DIESEL…', 'ENGINE SAYS NO'],
  driveoff: ['DROVE OFF WITH THE NOZZLE', 'HOSE-ZILLA'],
  dustdevil: ['DUST DEVIL! 🌪️', 'GONE WITH THE WIND', 'YEETED BY NATURE'],
  dance: ['DANCE BREAK 💃', 'SAMBA AT THE GAS STATION'],
  fox: ['A FOX STOLE A SNACK 🦊', 'WILDLIFE SHOPLIFTER'],
  trip: ['TRIPPED OVER NOTHING', 'ANKLES: DESTROYED'],
  car: ['HIT BY A CAR (GENTLY) 🚗', 'PARKING LOT PINBALL'],
};

/**
 * Funny-moment director: schedules comedic events so something silly
 * happens regularly, and rewards them with hype ("going viral").
 */
export class Funny {
  constructor(game) {
    this.game = game;
    this.timer = 22;
    this.cooldown = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.doorJamTimer = 0;
  }

  report(type, pos, customer) {
    const g = this.game;
    g.economy.stats.funny++;
    g.economy.lifetime.funny++;
    this.combo++; this.comboTimer = 12;
    const hype = type === 'shove' || type === 'throw' ? 2 : 4;
    g.economy.addHype(hype * (1 + (this.combo - 1) * 0.5));
    g.economy.addXP(4);
    if (this.cooldown <= 0) {
      this.cooldown = 1.2;
      if (pos && g.player.pos.distanceTo(pos) < 22) g.slowmo = 0.55;
      const cap = pick(CAPTIONS[type] || CAPTIONS.trip);
      g.ui.funnyCam(cap, this.combo);
      g.audio.play('laugh', { vol: 0.55, delay: 0.25 });
      if (pos) g.particles.stars(pos.clone().setY(pos.y + 1.4), 6);
    }
    if (this.combo === 3) { g.ui.bigMessage('GOING VIRAL! 🔥', 'Chaos brings customers… +hype'); g.economy.addHype(10); }
  }

  update(dt) {
    const g = this.game;
    this.cooldown -= dt;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    // door jam auto-fixes
    if (this.doorJamTimer > 0) {
      this.doorJamTimer -= dt;
      if (this.doorJamTimer <= 0) { g.station.doorJammed = false; }
      // a customer walking into the closed door bonks
      for (const c of g.customers.list) {
        if (c.inCar || c.char.isRagdoll || c.speed < 0.5) continue;
        const dx = c.pos.x - LAYOUT.door.x, dz = c.pos.z - LAYOUT.shop.minZ;
        if (Math.abs(dx) < 1.0 && Math.abs(dz) < 0.45) {
          const back = new THREE.Vector3(0, 0, dz < 0 ? -1 : 1);
          g.audio.play('bonk', { pos: c.pos });
          g.audio.play('impact', { pos: c.pos, pitch: 1.5 });
          c.knock(back.clone().multiplyScalar(1.5).setY(0.5), back.clone().multiplyScalar(45).setY(10), 'bonk', 'head');
        }
      }
    }
    // phone zombies walk into things
    for (const c of g.customers.list) {
      if (!c.traits.phone || c.inCar || c.char.isRagdoll || c.state !== 'walk' || c.speed < 0.8 || c.slipImmune > 0) continue;
      if (c.char.root.position.y > 0.1) continue;
      const fwd = new THREE.Vector3(Math.sin(c.char.root.rotation.y), 0, Math.cos(c.char.root.rotation.y));
      const ahead = c.pos.clone().addScaledVector(fwd, 0.45);
      if (g.colliders.pointBlocked(ahead.x, ahead.z, 0, 3) && chance(dt * 1.5)) {
        g.audio.play('bonk', { pos: c.pos, pitch: 0.8 });
        c.knock(fwd.clone().multiplyScalar(-1).setY(0.4), fwd.clone().multiplyScalar(-35).setY(8), 'pole', 'head');
        c.slipImmune = 10;
      }
    }
    if (!g.clock.open || g.tutorial.active) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = rand(26, 52);
      this.trigger();
    }
  }

  trigger(force = null) {
    const g = this.game;
    const walking = g.customers.list.filter((c) => !c.inCar && !c.char.isRagdoll);
    const options = [
      ['oil', 3, () => { const p = new THREE.Vector3(rand(-12, 12), 0, pick([-19.6, -14.4, -12, -22]) + rand(-1, 1)); g.cleaning.addHazard('oil', p, 1.8); }],
      ['banana', 2.5, () => { const c = walking.length ? pick(walking) : null; const p = c ? c.pos.clone() : SHOP.entranceOutside.clone(); p.x += rand(-1, 1); p.z += rand(-1, 1); if (c) c.say('neutral', '*drops banana peel*'); g.cleaning.addHazard('banana', p); }],
      ['tumbleweed', 3, () => { g.props.spawnTumbleweed(chance(0.35)); g.ui.toast('🌵 Tumbleweed incoming!', 'fun', 2); }],
      ['doorjam', walking.length ? 1.5 : 0, () => { g.station.doorJammed = true; this.doorJamTimer = 30; g.ui.toast('🚪 The automatic door jammed! Kick it (F) to fix', 'fun', 3.5); }],
      ['dustdevil', 1.2, () => this.dustDevil()],
      ['dance', g.upgrades.has('radio') && walking.length ? 2 : 0, () => this.danceParty(walking)],
      ['fox', 1.2, () => g.animals.foxRaid()],
      ['soda', 1.5, () => { const p = new THREE.Vector3(rand(-2, 7), LAYOUT.shop.floor, rand(2.5, 11)); if (!g.colliders.pointBlocked(p.x, p.z, 0.4)) g.cleaning.addHazard('soda', p); }],
    ];
    let opt = force ? options.find((o) => o[0] === force) : null;
    if (!opt) {
      const total = options.reduce((a, o) => a + o[1], 0);
      let r = Math.random() * total;
      for (const o of options) { r -= o[1]; if (r <= 0) { opt = o; break; } }
    }
    if (opt) opt[2]();
  }

  danceParty(walking) {
    const g = this.game;
    const ds = walking.filter((c) => c.traits.dancer && (c.state === 'queue' || c.state === 'waitCar' || c.state === 'browse' || c.state === 'idle' || c.state === 'arrived')).slice(0, 3);
    if (!ds.length) return;
    g.ui.toast('🎶 Somebody started a dance-off!', 'fun', 2.5);
    for (const c of ds) {
      const prev = c.state;
      c.state = 'dance';
      g.particles.icon('note', c.pos.clone().setY(c.pos.y + 2));
      g.after(rand(5, 9), () => { if (c.state === 'dance') { c.state = prev; c.char.play('idle', 0.4); c.setMood(0.15); } });
    }
    this.report('dance', ds[0].pos.clone(), ds[0]);
  }

  dustDevil() {
    const g = this.game;
    g.ui.toast('🌪️ DUST DEVIL! Hold onto your hats!', 'fun', 3);
    const start = new THREE.Vector3(-55, 0, rand(-30, -5));
    const dir = new THREE.Vector3(1, 0, rand(-0.2, 0.2)).normalize();
    const pos = start.clone();
    let t = 0;
    const hitSet = new Set();
    const step = () => {
      t += 0.05;
      pos.addScaledVector(dir, 0.6 + Math.sin(t * 3) * 0.2);
      pos.z += Math.sin(t * 1.7) * 0.25;
      for (let i = 0; i < 4; i++) {
        const a = t * 9 + i * 1.6, r = 0.5 + i * 0.5;
        g.particles.dust(pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + i * 1.2, Math.sin(a) * r)), { count: 1, vel: { x: -Math.sin(a) * 4, y: 2.5, z: Math.cos(a) * 4 }, size: 1.4, sizeEnd: 3.5, life: 1.2, alpha: 0.45 });
      }
      g.physics.blast(pos.clone().setY(0.5), 3.5, 1.5);
      for (const c of g.customers.list) {
        if (c.inCar || hitSet.has(c)) continue;
        if (c.pos.distanceTo(pos) < 2.6) {
          hitSet.add(c);
          c.knock(new THREE.Vector3(dir.x * 3, 6, dir.z * 3), new THREE.Vector3(dir.x * 40 + rand(-20, 20), 120, dir.z * 40 + rand(-20, 20)), 'dustdevil', 'pelvis');
        }
      }
      const pd = g.player.pos.distanceTo(pos);
      if (pd < 3) g.player.knockback(new THREE.Vector3(dir.x * 6, 5, dir.z * 6));
      if (pd < 25) g.player.shake = Math.max(g.player.shake, (25 - pd) / 60);
      if (pos.x < 60) g.after(0.05, step);
    };
    g.audio.play('whoosh', { vol: 1 });
    step();
  }
}
