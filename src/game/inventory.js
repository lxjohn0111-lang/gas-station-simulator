import * as THREE from 'three';
import { PRODUCTS, productVisual, deliveryBoxMesh } from './products.js';
import { LAYOUT } from '../world/station.js';
import { clamp, rand, pick, weightedPick, chance } from '../core/utils.js';

const FY = LAYOUT.shop.floor;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

/**
 * Shelf stock with instanced product visuals, delivery boxes and restocking.
 */
export class Inventory {
  constructor(game, slots, hitboxes) {
    this.game = game;
    this.slots = slots;
    this.hitboxes = hitboxes;
    this.prices = {};
    for (const [id, p] of Object.entries(PRODUCTS)) this.prices[id] = p.price;
    this.meshes = {};
    this.boxes = new Set();
    // instanced meshes per product
    for (const id of Object.keys(PRODUCTS)) {
      const v = productVisual(id);
      const shelfSlots = slots.filter((s) => s.shelf === PRODUCTS[id].shelf).length;
      const cap = Math.max(1, shelfSlots * PRODUCTS[id].slotCap);
      const im = new THREE.InstancedMesh(v.geometry, v.material, cap);
      im.count = 0; im.castShadow = true; im.receiveShadow = true;
      im.frustumCulled = false;
      game.scene.add(im);
      this.meshes[id] = im;
    }
    for (const hb of hitboxes) {
      hb.userData.interact = { system: this, kind: 'slot', slot: hb.userData.slot };
      game.interact.add(hb);
    }
    this.dirty = new Set();
  }

  /** Default starting stock layout. */
  initialStock() {
    const plan = { cold: ['cola', 'cola', 'water', 'water', 'cola', 'water', 'energy', 'cola'], snack: ['chips', 'candy', 'chips', 'candy', 'chips', 'candy', 'jerky', 'chips', 'candy'], auto: ['oil', 'freshener'] };
    const used = { cold: 0, snack: 0, auto: 0 };
    for (const s of this.slots) {
      const list = plan[s.shelf];
      if (used[s.shelf] < list.length && chance(0.75)) {
        const id = list[used[s.shelf]++];
        if (PRODUCTS[id].level > 2) continue;
        s.product = id; s.count = Math.floor(this.capacity(s, id) * rand(0.4, 1));
      }
    }
    this.rebuildAll();
  }

  capacity(slot, id) {
    const p = PRODUCTS[id], sz = productVisual(id).size;
    const gap = 0.012;
    const cols = Math.max(1, Math.floor(slot.width / (sz.x + gap)));
    const rows = Math.max(1, Math.floor(slot.depth / (sz.z + gap)));
    const layers = Math.max(1, Math.min(3, Math.floor((slot.height - 0.02) / (sz.y + 0.005))));
    return Math.min(p.slotCap, cols * rows * (p.shape === 'bar' || p.shape === 'card' ? layers : 1));
  }

  /** Item transforms for a slot. */
  layout(slot, i, out) {
    const id = slot.product, sz = productVisual(id).size;
    const gap = 0.012;
    const cols = Math.max(1, Math.floor(slot.width / (sz.x + gap)));
    const rows = Math.max(1, Math.floor(slot.depth / (sz.z + gap)));
    const per = cols * rows;
    const layer = Math.floor(i / per), k = i % per;
    const row = Math.floor(k / cols), col = k % cols;
    const usedW = cols * (sz.x + gap);
    const x = -usedW / 2 + (col + 0.5) * (sz.x + gap);
    const z = -0.03 - (row + 0.5) * (sz.z + gap);
    out.copy(slot.pos).addScaledVector(slot.right, x).addScaledVector(slot.normal, z);
    out.y += layer * (sz.y + 0.004);
    return out;
  }

  rebuild(id) {
    const im = this.meshes[id];
    let n = 0;
    for (const s of this.slots) {
      if (s.product !== id || s.count <= 0) continue;
      const yaw = Math.atan2(s.normal.x, s.normal.z);
      for (let i = 0; i < s.count && n < im.instanceMatrix.count; i++) {
        this.layout(s, i, _p);
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + ((i * 7919) % 7 - 3) * 0.015);
        _m.compose(_p, _q, _s);
        im.setMatrixAt(n++, _m);
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  }
  rebuildAll() { for (const id of Object.keys(PRODUCTS)) this.rebuild(id); }
  markDirty(id) { this.dirty.add(id); }

  // ---------------------------------------------------------------- customers
  chooseSlotFor(c) {
    const lvl = this.game.economy.level;
    const cands = this.slots.filter((s) => s.product && s.count > 0 && !(c.basket || []).some((b) => b.id === s.product && chance(0.6)));
    if (!cands.length) return null;
    return weightedPick(cands, (s) => {
      const p = PRODUCTS[s.product];
      const priceF = clamp(1.6 - (this.prices[s.product] / p.price - 1) * 2.5, 0.05, 1.6);
      return p.popularity * priceF * (s.count > 2 ? 1 : 0.6);
    });
    void lvl;
  }
  standPoint(slot) {
    const p = slot.pos.clone().addScaledVector(slot.normal, 0.62);
    p.y = FY;
    return p;
  }
  take(slot) {
    if (!slot.product || slot.count <= 0) return null;
    slot.count--;
    const id = slot.product;
    this.markDirty(id);
    this.game.economy.stats.itemsSold++;
    return id;
  }
  priceOf(id) { return this.prices[id]; }
  restockReturned(id) {
    const s = this.slots.find((x) => x.product === id && x.count < this.capacity(x, id)) || this.slots.find((x) => x.shelf === PRODUCTS[id].shelf && (!x.product || x.count === 0));
    if (s) { s.product = id; s.count++; this.markDirty(id); }
  }
  totalStock(id) { return this.slots.reduce((a, s) => a + (s.product === id ? s.count : 0), 0); }
  boxStock(id) { let n = 0; for (const b of this.boxes) if (b.data.product === id) n += b.data.count; return n; }
  emptySlotsShare() { const n = this.slots.filter((s) => !s.product || s.count === 0).length; return n / this.slots.length; }

  // ---------------------------------------------------------------- boxes
  spawnBox(id, pos) {
    const g = this.game;
    const mesh = deliveryBoxMesh(id, g.mats);
    mesh.position.copy(pos);
    mesh.rotation.y = rand(-0.2, 0.2);
    g.scene.add(mesh);
    const prop = g.physics.addProp(mesh, { size: new THREE.Vector3(0.5, 0.36, 0.4), mass: 4 });
    const p = g.props.register(prop, { kind: 'box', name: PRODUCTS[id].name + ' box', product: id, count: PRODUCTS[id].box });
    this.boxes.add(p);
    return p;
  }

  // ---------------------------------------------------------------- restock interaction
  prompt(it, player) {
    const s = it.slot;
    const h = player.held;
    const label = s.product ? `${PRODUCTS[s.product].icon} ${PRODUCTS[s.product].name} (${s.count}/${this.capacity(s, s.product)})` : `Empty ${s.shelf === 'cold' ? 'fridge' : s.shelf === 'auto' ? 'auto shelf' : 'shelf'} slot`;
    if (h && h.kind === 'prop' && h.prop.data.kind === 'box') {
      const b = h.prop.data;
      if (b.count <= 0) return { text: label, sub: 'Box is empty — toss it (RMB) into the dumpster' };
      if (PRODUCTS[b.product].shelf !== s.shelf) return { text: label, sub: `${PRODUCTS[b.product].name} doesn't go here (${PRODUCTS[b.product].shelf === 'cold' ? 'fridge' : PRODUCTS[b.product].shelf === 'auto' ? 'auto care wall' : 'snack aisle'})` };
      if (s.product && s.count > 0 && s.product !== b.product) return { text: label, sub: 'Slot holds a different product' };
      const cap = this.capacity(s, b.product);
      if (s.product === b.product && s.count >= cap) return { text: label, sub: 'Slot is full' };
      return { key: 'LMB', text: `Stock ${PRODUCTS[b.product].name}`, sub: `${label} • box: ${b.count} left • hold to fill` };
    }
    return { text: label, sub: s.product ? `Price $${this.prices[s.product].toFixed(2)}` : 'Bring a delivery box to restock' };
  }

  interact(it, player, action) {
    if (action !== 'useStart' && action !== 'useHold') return false;
    const h = player.held;
    if (!h || h.kind !== 'prop' || h.prop.data.kind !== 'box') return false;
    const s = it.slot, b = h.prop.data;
    if (b.count <= 0 || PRODUCTS[b.product].shelf !== s.shelf) return false;
    if (s.product && s.count > 0 && s.product !== b.product) return false;
    const cap = this.capacity(s, b.product);
    if (s.product === b.product && s.count >= cap) return false;
    if (s.product !== b.product) { if (s.product) this.markDirty(s.product); s.product = b.product; s.count = 0; }
    s.count++; b.count--;
    this.markDirty(b.product);
    this.game.audio.play('pop', { pos: s.pos, vol: 0.5, pitch: rand(0.9, 1.2) });
    this.game.economy.addXP(0.5);
    this.game.tutorial.event('restocked');
    if (b.count <= 0) { this.game.ui.toast('📦 Box empty! Throw it away (RMB at the dumpster / trash)', 'good', 2.5); h.prop.data.empty = true; }
    player.viewKick(0.4);
    return true;
  }

  update() {
    if (this.dirty.size) { for (const id of this.dirty) this.rebuild(id); this.dirty.clear(); }
  }

  serialize() {
    return { slots: this.slots.map((s) => [s.product, s.count]), prices: this.prices, boxes: [...this.boxes].filter((b) => b.data.count > 0).map((b) => [b.data.product, b.data.count]) };
  }
  load(d) {
    if (!d) return false;
    if (d.slots) d.slots.forEach(([p, c], i) => { if (this.slots[i]) { this.slots[i].product = PRODUCTS[p] ? p : null; this.slots[i].count = c || 0; } });
    if (d.prices) Object.assign(this.prices, d.prices);
    this.rebuildAll();
    if (d.boxes) d.boxes.forEach(([p, c], i) => { if (PRODUCTS[p]) { const b = this.spawnBox(p, this.game.deliveries.palletPos(i)); b.data.count = c; } });
    return true;
  }
}
