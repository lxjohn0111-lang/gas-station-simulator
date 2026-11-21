import * as THREE from 'three';
import { LAYOUT } from '../world/station.js';
import { PRODUCTS, FUELS } from './products.js';
import { rand } from '../core/utils.js';

/**
 * Stock orders: a box truck brings product boxes to the delivery pad,
 * a tanker refills the underground fuel tanks.
 */
export class Deliveries {
  constructor(game) {
    this.game = game;
    this.pending = [];   // {kind:'box'|'tanker', items, eta}
    this.trucks = [];
    this.palletIndex = 0;
  }

  palletPos(i) {
    const d = LAYOUT.delivery;
    const col = i % 3, row = Math.floor(i / 3) % 3, layer = Math.floor(i / 9);
    return new THREE.Vector3(d.x - 1.3 + col * 0.62, 0.35 + layer * 0.4, d.z - 1.2 + row * 0.55);
  }

  /** order: { productId: boxes } */
  orderProducts(order, instant = false) {
    const g = this.game;
    let cost = 0;
    for (const [id, n] of Object.entries(order)) cost += PRODUCTS[id].cost * PRODUCTS[id].box * n;
    if (cost <= 0) return false;
    if (!g.economy.spend(cost, 'Stock order')) return false;
    if (g.tutorial.active) instant = true;
    if (instant) { this.dropBoxes(order); g.ui.toast('📦 Express delivery dropped at the side door!', 'good'); }
    else {
      const eta = rand(25, 40);
      this.pending.push({ kind: 'box', items: order, eta });
      g.ui.toast(`🚚 Order placed — truck arriving in ~${Math.round(eta)}s`, 'good');
    }
    g.tutorial.event('orderPlaced');
    return true;
  }

  scheduleTanker(type, liters) {
    const eta = rand(30, 45);
    this.pending.push({ kind: 'tanker', fuel: type, liters, eta });
    this.game.ui.toast(`⛽ Tanker with ${liters}L ${FUELS[type].name} on the way (~${Math.round(eta)}s)`, 'good');
  }

  dropBoxes(order) {
    const g = this.game;
    let i = 0;
    for (const [id, n] of Object.entries(order)) {
      for (let k = 0; k < n; k++) {
        const p = this.palletPos(this.palletIndex++ % 18);
        p.y += 0.3;
        g.after(i * 0.18, () => { g.inventory.spawnBox(id, p); g.audio.play('thud', { pos: p, vol: 0.6 }); });
        i++;
      }
    }
  }

  update(dt) {
    const g = this.game, T = g.traffic;
    for (const o of [...this.pending]) {
      o.eta -= dt;
      if (o.eta <= 0) {
        this.pending.splice(this.pending.indexOf(o), 1);
        const model = T.spawnModel(o.kind === 'tanker' ? 'tanker' : 'box');
        const car = T.addCar(model);
        const path = T.routeService(o.kind === 'tanker' ? 'tanker' : 'delivery');
        car.setPath(path, { maxSpeed: 7, hold: path.marks.stop });
        car.speed = 12;
        car.place(path.pointAt(0), 0);
        this.trucks.push({ car, order: o, state: 'arriving', timer: 0 });
        g.audio.play('honk', { pos: car.pos, pitch: 0.7, long: true });
      }
    }
    for (const t of [...this.trucks]) {
      const car = t.car;
      if (t.state === 'arriving' && car.dist >= car.holdAt - 0.15 && car.speed < 0.1) {
        t.state = 'unloading'; t.timer = t.order.kind === 'tanker' ? 9 : 5;
        car.setParked(true);
        g.audio.play('honk', { pos: car.pos, pitch: 0.65 });
        if (t.order.kind === 'box') this.dropBoxes(t.order.items);
      }
      if (t.state === 'unloading') {
        t.timer -= dt;
        if (t.order.kind === 'tanker' && Math.random() < dt * 3) g.particles.smoke(car.pos.clone().add(new THREE.Vector3(0, 0.4, 1.4)), { color: 0xd8d0c0, alpha: 0.15, size: 0.3 });
        if (t.timer <= 0) {
          if (t.order.kind === 'tanker') {
            const f = g.fuel;
            f.tanks[t.order.fuel] = Math.min(f.capacity, f.tanks[t.order.fuel] + t.order.liters);
            g.ui.toast(`⛽ ${t.order.liters}L of ${FUELS[t.order.fuel].name} delivered!`, 'good');
          } else g.ui.toast('📦 Boxes delivered at the side door (west side of the shop)', 'good');
          t.state = 'leaving';
          car.holdAt = null; car.setParked(false);
          car.onArrive = () => { T.remove(car); };
          this.trucks.splice(this.trucks.indexOf(t), 1);
        }
      }
    }
  }

  serialize() { return { pending: this.pending.map((o) => ({ ...o, eta: Math.min(o.eta, 15) })) }; }
  load(d) { if (d && d.pending) this.pending = d.pending; }
}
