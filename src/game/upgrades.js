import * as THREE from 'three';
import { SHOP } from '../world/shop.js';
import { LAYOUT } from '../world/station.js';
import { boxGeo } from '../gfx/materials.js';
import { canvasTexture } from '../gfx/textures.js';

/**
 * Upgrade catalogue + their effects on the world.
 * wage = $ per day charged at closing.
 */
export const UPGRADES = [
  { id: 'radio', cat: 'Shop', icon: '📻', name: 'Boombox Radio', cost: 150, level: 1, desc: 'Country tunes in the shop. Customers are more patient… and some can\'t resist dancing.' },
  { id: 'island2', cat: 'Station', icon: '⛽', name: 'Repair Pump Island 2', cost: 1100, level: 2, desc: 'Fix the busted pumps east of the canopy. +2 fuelling spots, more customers.' },
  { id: 'billboard', cat: 'Marketing', icon: '🪧', name: 'Highway Billboard', cost: 450, level: 2, desc: 'Rent the billboard down the road. +25% customers.' },
  { id: 'highflow', cat: 'Station', icon: '💨', name: 'High-Flow Pumps', cost: 650, level: 2, desc: 'Pumps dispense 50% faster. Harder to stop on target, way faster service.' },
  { id: 'lights', cat: 'Station', icon: '💡', name: 'LED Lot Lights', cost: 400, level: 2, desc: 'Brighter nights attract more late drivers (+15% at night).' },
  { id: 'premium', cat: 'Station', icon: '🏁', name: 'Premium Fuel', cost: 850, level: 3, desc: 'Unlocks premium nozzles (higher margins). Sports cars will come by. Includes 500 L.' },
  { id: 'neon', cat: 'Marketing', icon: '✨', name: 'Neon Sign Restoration', cost: 700, level: 3, desc: 'Fix the flickering FOOD MART sign. +0.3★ and +30% customers at night.' },
  { id: 'camera', cat: 'Shop', icon: '📹', name: 'Security Cameras', cost: 800, level: 3, desc: 'Shoplifters think twice. Thief chance drops by 60%.' },
  { id: 'coffee', cat: 'Shop', icon: '☕', name: 'Coffee Machine', cost: 600, level: 2, desc: 'Customers grab a coffee ($2.49) at the register. Pure margin.' },
  { id: 'janitor', cat: 'Staff', icon: '🧹', name: 'Hire Janitor (Earl)', cost: 900, level: 4, wage: 45, desc: 'Cleans spills and litter automatically. $45/day.' },
  { id: 'hotdog', cat: 'Shop', icon: '🌭', name: 'Hot Dog Roller', cost: 1100, level: 4, desc: 'Customers add a hot dog ($3.49). Smells amazing. Probably.' },
  { id: 'island3', cat: 'Station', icon: '⛽', name: 'Repair Pump Island 3', cost: 2600, level: 4, desc: 'Fix the west island. +2 more fuelling spots.' },
  { id: 'bigtanks', cat: 'Station', icon: '🛢️', name: 'Bigger Fuel Tanks', cost: 1600, level: 5, desc: 'Underground tank capacity 3,000 L → 6,000 L.' },
  { id: 'cashier', cat: 'Staff', icon: '🧑‍💼', name: 'Hire Cashier (Rosa)', cost: 1500, level: 5, wage: 70, desc: 'Rings up customers when you\'re not at the register. $70/day.' },
  { id: 'stocker', cat: 'Staff', icon: '📦', name: 'Hire Stock Clerk (Gus)', cost: 1800, level: 6, wage: 55, desc: 'Puts delivered boxes on the shelves automatically. $55/day.' },
  { id: 'carwash', cat: 'Station', icon: '🫧', name: 'Splash-O-Matic Car Wash', cost: 5200, level: 6, desc: 'Automatic car wash next to the shop. $8 per wash, fully passive.' },
  { id: 'autostop', cat: 'Station', icon: '🎯', name: 'Smart Auto-Stop Nozzles', cost: 2400, level: 7, desc: 'One click and the pump stops exactly on target. Perfect every time.' },
  { id: 'attendant', cat: 'Staff', icon: '⛑️', name: 'Hire Pump Attendant (Dale)', cost: 3000, level: 8, wage: 90, desc: 'Serves waiting cars at the pumps on his own (slowly). $90/day.' },
];

export class Upgrades {
  constructor(game) {
    this.game = game;
    this.owned = new Set();
    this.list = UPGRADES;
    this.extraItems = [];
  }
  has(id) { return this.owned.has(id); }
  get(id) { return this.list.find((u) => u.id === id); }
  washPrice() { return 8; }
  wages() { return this.list.filter((u) => u.wage && this.has(u.id)).reduce((a, u) => a + u.wage, 0); }

  buy(id) {
    const g = this.game, u = this.get(id);
    if (!u || this.has(id)) return false;
    if (g.economy.level < u.level) { g.ui.toast(`Requires level ${u.level}`, 'bad'); return false; }
    if (!g.economy.spend(u.cost, 'Upgrade')) return false;
    this.owned.add(id);
    this.apply(id, true);
    g.audio.play('unlock');
    g.ui.bigMessage(u.icon + ' ' + u.name.toUpperCase(), 'Upgrade installed!');
    g.economy.addXP(Math.round(u.cost / 25));
    g.save();
    return true;
  }

  apply(id, fresh = false) {
    const g = this.game, st = g.station;
    switch (id) {
      case 'island2': st.setIslandActive(1, true); g.fuel.refreshActive(); break;
      case 'island3': st.setIslandActive(2, true); g.fuel.refreshActive(); break;
      case 'premium': g.fuel.refreshActive(); if (fresh) g.fuel.tanks.premium = Math.max(g.fuel.tanks.premium, 500); st.updatePriceBoard(g.fuel.prices, true); break;
      case 'highflow': g.fuel.flowBase = 3.6; break;
      case 'autostop': g.fuel.autoStop = true; break;
      case 'bigtanks': g.fuel.capacity = 6000; break;
      case 'neon': st.signFlicker = false; if (fresh) g.economy.rep(0.3, null); break;
      case 'carwash': st.setCarwash(true); break;
      case 'radio': this.buildRadio(); break;
      case 'coffee': this.buildCoffee(); break;
      case 'hotdog': this.buildHotdog(); break;
      case 'cashier': this.spawnStaff('cashier'); g.register.cashier = true; break;
      case 'janitor': this.spawnStaff('janitor'); break;
      case 'stocker': this.spawnStaff('stocker'); break;
      case 'attendant': this.spawnStaff('attendant'); break;
      case 'lights': for (const l of st.lights) l.base *= 1.6; break;
      case 'billboard': this.buildBillboard(); break;
      case 'camera': this.buildCameras(); break;
      default: break;
    }
  }

  buildRadio() {
    const g = this.game, M = g.mats;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(boxGeo(0.5, 0.26, 0.16, 0), M.paint(0x1b1b1f, 0.4, 0.4)); grp.add(body);
    for (const x of [-0.15, 0.15]) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 20), M.chrome); sp.rotation.x = Math.PI / 2; sp.position.set(x, 0, 0.085); grp.add(sp);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.022, 20), M.blackPlastic); cone.rotation.x = Math.PI / 2; cone.position.set(x, 0, 0.088); grp.add(cone);
    }
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.015, 6, 16, Math.PI), M.chrome); handle.position.y = 0.13; grp.add(handle);
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0x4aff8a })); disp.position.set(0, 0.07, 0.081); grp.add(disp);
    grp.position.copy(SHOP.radio); grp.rotation.y = Math.PI / 2;
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.scene.add(grp);
    this.radio = grp;
    g.audio.startRadio(SHOP.radio.clone());
  }

  buildCoffee() {
    const g = this.game, M = g.mats;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(boxGeo(0.6, 0.75, 0.45, 0), M.paint(0x2a2c30, 0.3, 0.6)); body.position.y = 0.375; grp.add(body);
    const tex = canvasTexture(256, 128, (ctx, w, h) => { ctx.fillStyle = '#5b3a1e'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffe5a8'; ctx.font = 'bold 54px Impact'; ctx.textAlign = 'center'; ctx.fillText('HOT JOE', w / 2, 70); ctx.font = 'bold 22px Arial'; ctx.fillText('FRESH-ISH COFFEE', w / 2, 105); });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.4 })); front.position.set(0, 0.6, -0.226); front.rotation.y = Math.PI; grp.add(front);
    for (const x of [-0.15, 0.15]) { const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.18, 14), new THREE.MeshPhysicalMaterial({ color: 0x2a1a0a, roughness: 0.05, transparent: true, opacity: 0.8 })); pot.position.set(x, 0.12, -0.3); grp.add(pot); }
    const cups = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.4, 12), M.whitePlastic); cups.position.set(0.45, 0.2, -0.1); grp.add(cups);
    grp.position.set(SHOP.coffee.x, LAYOUT.shop.floor + 0.99, SHOP.coffee.z + 0.25);
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.scene.add(grp);
    this.coffee = grp;
  }

  buildHotdog() {
    const g = this.game, M = g.mats;
    const grp = new THREE.Group();
    const base = new THREE.Mesh(boxGeo(0.5, 0.12, 0.35, 0), M.steel); base.position.y = 0.06; grp.add(base);
    const dogMat = new THREE.MeshStandardMaterial({ color: 0xb0482a, roughness: 0.35 });
    for (let i = 0; i < 7; i++) { const d = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.3, 4, 8), dogMat); d.rotation.z = Math.PI / 2; d.position.set(0, 0.14, -0.13 + i * 0.043); grp.add(d); }
    const hood = new THREE.Mesh(boxGeo(0.52, 0.2, 0.37, 0), M.glass); hood.position.y = 0.22; grp.add(hood);
    grp.position.copy(SHOP.hotdog); grp.rotation.y = Math.PI / 2;
    g.scene.add(grp);
    this.hotdog = grp; this.hotdogRollers = grp.children.filter((c) => c.geometry && c.geometry.type === 'CapsuleGeometry');
  }

  buildBillboard() { /* the existing billboards already advertise the station; effect is in Economy */ }
  buildCameras() {
    const g = this.game, M = g.mats;
    for (const [x, y, z, ry] of [[-9.5, 3.4, 1.5, -0.8], [9.5, 3.4, 12.5, 2.4], [-14.5, 5.2, -10, -0.5]]) {
      const cam = new THREE.Group();
      const b = new THREE.Mesh(boxGeo(0.12, 0.1, 0.25, 0), M.whitePlastic); b.position.z = 0.1; cam.add(b);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 })); led.position.set(0.04, 0.03, 0.23); cam.add(led);
      cam.position.set(x, y, z); cam.rotation.set(0.4, ry, 0);
      g.scene.add(cam);
    }
  }

  spawnStaff(role) {
    const g = this.game;
    const kind = role === 'cashier' ? 'michelle' : role === 'janitor' ? 'cowboy' : 'biker';
    const ch = g.chars.create(kind, { top: role === 'cashier' ? 0xc22a1f : role === 'janitor' ? 0x2f5d3a : 0x1f3f7a });
    const spots = {
      cashier: [SHOP.playerRegSpot.clone().add(new THREE.Vector3(-0.6, 0, -1.2)), Math.PI / 2],
      janitor: [new THREE.Vector3(-12.2, 0, 3.5), 0.6],
      stocker: [new THREE.Vector3(-12.5, 0, 10.2), 1.2],
      attendant: [new THREE.Vector3(3.2, 0.18, -17), Math.PI],
    };
    const [p, r] = spots[role];
    ch.root.position.copy(p); ch.root.rotation.y = r;
    g.scene.add(ch.root);
    ch.play(role === 'janitor' && Math.random() < 0.5 ? 'idle' : 'idle', 0);
    this.extraItems.push({ role, ch, base: p.clone(), t: Math.random() * 10 });
  }

  update(dt) {
    const g = this.game;
    for (const s of this.extraItems) {
      s.ch.update(dt);
      s.t += dt;
      if (s.role === 'janitor') {
        // pace around with the mop
        const k = Math.sin(s.t * 0.15);
        const target = s.base.clone().add(new THREE.Vector3(k * 6, 0, Math.cos(s.t * 0.11) * 3));
        const d = target.clone().sub(s.ch.root.position); d.y = 0;
        if (d.length() > 0.2) { s.ch.root.position.addScaledVector(d.normalize(), Math.min(1, d.length()) * dt * 1.1); s.ch.root.rotation.y = Math.atan2(d.x, d.z); s.ch.play('walk', 0.3, 0.8); }
        else s.ch.play('idle', 0.3);
      }
    }
    if (this.hotdogRollers) for (const r of this.hotdogRollers) r.rotation.x += dt * 2;
    if (this.has('carwash') && g.station.washBrushes) {
      const active = (g.station.washActive || 0) > 0;
      g.station.washActive = Math.max(0, (g.station.washActive || 0) - dt);
      for (const b of g.station.washBrushes) b.rotation.y += dt * (active ? 14 : 0.3);
    }
    // stock clerk: move items from boxes to shelves
    if (this.has('stocker')) {
      this._stockT = (this._stockT || 0) + dt;
      if (this._stockT > 1.2) {
        this._stockT = 0;
        const inv = g.inventory;
        for (const b of inv.boxes) {
          if (b.held || b.data.count <= 0) continue;
          const id = b.data.product;
          const slot = inv.slots.find((s) => s.product === id && s.count < inv.capacity(s, id)) || inv.slots.find((s) => s.shelf === g.productsCatalog[id].shelf && (!s.product || s.count === 0));
          if (!slot) continue;
          if (slot.product !== id) { if (slot.product) inv.markDirty(slot.product); slot.product = id; slot.count = 0; }
          const n = Math.min(4, b.data.count, inv.capacity(slot, id) - slot.count);
          slot.count += n; b.data.count -= n; inv.markDirty(id);
          if (b.data.count <= 0) g.props.remove(b);
          break;
        }
      }
    }
    // pump attendant: auto-fuel waiting cars
    if (this.has('attendant')) {
      for (const s of g.fuel.services) {
        if (s.state !== 'waiting' || s.nozzle) continue;
        s.attT = (s.attT || 0) + dt;
        if (s.attT > 14) {
          s.dispensed = s.target; s.nozzleTypeUsed = s.fuelType; g.fuel.tanks[s.fuelType] = Math.max(0, g.fuel.tanks[s.fuelType] - s.target);
          g.fuel.finishService(s);
          g.ui.toast('⛑️ Dale filled up a car', 'good', 1.5);
        }
      }
    }
  }

  serialize() { return [...this.owned]; }
  load(list) { if (!list) return; for (const id of list) { if (this.get(id) && !this.owned.has(id)) { this.owned.add(id); this.apply(id, false); } } }
}
