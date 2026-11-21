import { PRODUCTS, FUELS } from '../game/products.js';
import { money, moneyShort, clamp } from '../core/utils.js';

const $ = (id) => document.getElementById(id);

/** The in-game "Station OS" tablet: orders, fuel, upgrades, prices, stats. */
export class Tablet {
  constructor(game) {
    this.game = game;
    this.el = $('tablet');
    this.body = $('tablet-body');
    this.tabsEl = $('tablet-tabs');
    this.tab = 'orders';
    this.cart = {};
    $('tablet-close').addEventListener('click', () => this.close());
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.close(); });
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('input', (e) => this.onInput(e));
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open(tab = null) {
    const g = this.game;
    if (tab) this.tab = tab;
    if (this.tutOrder()) this.tab = 'orders';
    this.el.classList.remove('hidden');
    document.body.classList.add('tablet-open');
    g.ui.tabletOpen = true;
    g.input.cursorMode = true;
    g.input.exitLock();
    document.body.style.cursor = 'default';
    this.render();
    g.audio.play('click');
  }
  close() {
    const g = this.game;
    if (!this.isOpen) return;
    this.el.classList.add('hidden');
    document.body.classList.remove('tablet-open');
    g.ui.tabletOpen = false;
    g.input.cursorMode = false;
    document.body.style.cursor = 'none';
    g.input.requestLock(); g.lockHint && g.lockHint();
    g.audio.play('click', { pitch: 0.8 });
  }

  tutOrder() { const t = this.game.tutorial; return !!(t && t.active && t.step && t.step.id === 'order'); }

  updateMoney() { $('tab-money').textContent = moneyShort(this.game.economy.money); }

  renderTabs() {
    const g = this.game;
    const lowStock = Object.keys(PRODUCTS).filter((id) => PRODUCTS[id].level <= g.economy.level && g.inventory.totalStock(id) < 4).length;
    const lowFuel = ['regular', 'diesel'].filter((t) => g.fuel.tanks[t] < 400).length;
    const affordable = g.upgrades.list.filter((u) => !g.upgrades.has(u.id) && u.level <= g.economy.level && u.cost <= g.economy.money).length;
    const tabs = [['orders', '📦 STOCK', lowStock], ['fuel', '⛽ FUEL', lowFuel], ['upgrades', '🔧 UPGRADES', affordable], ['prices', '🏷️ PRICES', 0], ['stats', '📊 STATS', 0]];
    this.tabsEl.innerHTML = tabs.map(([id, n, b]) => `<button class="tab-btn ${this.tab === id ? 'active' : ''}" data-tab="${id}">${n}${b ? `<span class="badge">${b}</span>` : ''}</button>`).join('');
    this.tabsEl.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.render(); this.game.audio.play('click'); }));
  }

  render() {
    this.updateMoney();
    this.renderTabs();
    const fn = { orders: () => this.renderOrders(), fuel: () => this.renderFuel(), upgrades: () => this.renderUpgrades(), prices: () => this.renderPrices(), stats: () => this.renderStats() }[this.tab];
    this.body.innerHTML = fn();
  }

  renderOrders() {
    const g = this.game, lvl = g.economy.level, tut = this.tutOrder();
    let total = 0, boxes = 0;
    for (const [id, n] of Object.entries(this.cart)) { total += PRODUCTS[id].cost * PRODUCTS[id].box * n; boxes += n; }
    const cards = Object.entries(PRODUCTS).map(([id, p]) => {
      const locked = p.level > lvl;
      const n = this.cart[id] || 0;
      const shelf = g.inventory.totalStock(id), inBox = g.inventory.boxStock(id);
      const where = p.shelf === 'cold' ? 'Fridge' : p.shelf === 'auto' ? 'Auto wall' : 'Snack aisle';
      const hl = tut && id === 'cola';
      return `<div class="card ${locked ? 'locked' : ''} ${hl ? 'tut-hl' : ''}">
        <div class="c-icon">${p.icon}</div><div class="c-name">${p.name}</div>
        <div class="c-desc">${where} • ${p.box} per box<br>Cost ${money(p.cost)} → sells ${money(g.inventory.prices[id])}</div>
        <div class="c-row"><span>On shelf <span class="c-stock">${shelf}</span>${inBox ? ` (+${inBox} boxed)` : ''}</span><span>${money(p.cost * p.box)}/box</span></div>
        ${locked ? `<div class="c-row">🔒 Level ${p.level}</div>` : `<div class="qty"><button class="btn small btn-ghost" data-act="dec" data-id="${id}">−</button><b style="min-width:22px;text-align:center">${n}</b><button class="btn small btn-ghost ${hl && !n ? 'tut-hl' : ''}" data-act="inc" data-id="${id}">+</button></div>`}
      </div>`;
    }).join('');
    const pend = g.deliveries.pending.filter((o) => o.kind === 'box').length + g.deliveries.trucks.filter((t) => t.order.kind === 'box').length;
    return `<div class="section-title">ORDER STOCK</div>
      <div class="note">Boxes are dropped at the <b>side door (west of the shop)</b>. Carry them in and stock shelves. Empty shelves annoy customers.</div>
      ${pend ? `<div class="delivery-list">🚚 ${pend} delivery truck(s) on the way…</div>` : ''}
      <div class="cards">${cards}</div>
      <div style="position:sticky;bottom:-24px;background:#0d0f14;padding:14px 0 4px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <b style="font-size:16px">Cart: ${boxes} box(es) — ${money(total)}</b>
        <button class="btn ${tut && boxes ? 'tut-hl' : ''}" data-act="order" ${boxes ? '' : 'disabled'}>🚚 ORDER ${tut ? '(instant in the tutorial)' : '(truck ~30s)'}</button>
        ${tut ? '' : `<button class="btn btn-reward" data-act="orderAd" ${boxes ? '' : 'disabled'}>▶ Watch ad: INSTANT delivery</button>`}
        <button class="btn small btn-ghost" data-act="autofill">Auto-fill empty shelves</button>
      </div>`;
  }

  renderFuel() {
    const g = this.game, f = g.fuel;
    const rows = Object.entries(FUELS).map(([t, F]) => {
      const locked = t === 'premium' && !g.upgrades.has('premium');
      const pct = clamp(f.tanks[t] / f.capacity, 0, 1);
      const cost = F.cost * f.market[t];
      return `<div class="card ${locked ? 'locked' : ''}" style="margin-bottom:10px">
        <div class="c-name" style="color:${F.color}">${F.name.toUpperCase()} ${locked ? '🔒 (upgrade)' : ''}</div>
        <div style="height:12px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden"><div style="height:100%;width:${pct * 100}%;background:${F.color}"></div></div>
        <div class="c-row"><span>Tank: <span class="c-stock">${Math.round(f.tanks[t])} / ${f.capacity} L</span></span><span>Wholesale ${money(cost, 3)}/L</span></div>
        ${locked ? '' : `<div class="qty">${[500, 1000, 2000].map((l) => `<button class="btn small" data-act="fuel" data-type="${t}" data-l="${l}">+${l}L (${money(l * cost, 0)})</button>`).join('')}</div>`}
      </div>`;
    }).join('');
    return `<div class="section-title">FUEL TANKS</div><div class="note">A tanker truck refills the underground tanks. If a tank runs dry, that pump stops working!</div>${rows}
      <button class="btn btn-reward" data-act="fuelAd">▶ Watch ad: +600 L of the emptiest fuel, free</button>`;
  }

  renderUpgrades() {
    const g = this.game, lvl = g.economy.level;
    const cats = ['Station', 'Shop', 'Staff', 'Marketing'];
    return cats.map((cat) => `<div class="section-title">${cat.toUpperCase()}</div><div class="cards">${g.upgrades.list.filter((u) => u.cat === cat).map((u) => {
      const owned = g.upgrades.has(u.id), locked = u.level > lvl;
      return `<div class="card ${owned ? 'owned' : ''} ${locked ? 'locked' : ''}">${owned ? '<span class="owned-tag">OWNED</span>' : ''}
        <div class="c-icon">${u.icon}</div><div class="c-name">${u.name}</div><div class="c-desc">${u.desc}</div>
        ${owned ? '' : locked ? `<div class="c-row">🔒 Requires level ${u.level}</div>` : `<button class="btn" data-act="buy" data-id="${u.id}" ${g.economy.money >= u.cost ? '' : 'disabled'}>BUY ${money(u.cost, 0)}</button>`}
      </div>`;
    }).join('')}</div>`).join('');
  }

  renderPrices() {
    const g = this.game;
    const fuelRows = Object.entries(FUELS).filter(([t]) => t !== 'premium' || g.upgrades.has('premium')).map(([t, F]) => `<div class="price-row"><span class="pr-name" style="color:${F.color}">⛽ ${F.name}</span><input type="range" min="${(F.price * 0.8).toFixed(2)}" max="${(F.price * 1.4).toFixed(2)}" step="0.01" value="${g.fuel.prices[t]}" data-fuel="${t}"><span class="pr-val" id="pv-f-${t}">$${g.fuel.prices[t].toFixed(2)}</span></div>`).join('');
    const prodRows = Object.entries(PRODUCTS).filter(([, p]) => p.level <= g.economy.level).map(([id, p]) => `<div class="price-row"><span class="pr-name">${p.icon} ${p.name} <span style="opacity:.5;font-weight:400">(cost ${money(p.cost)})</span></span><input type="range" min="${(p.price * 0.7).toFixed(2)}" max="${(p.price * 1.6).toFixed(2)}" step="0.01" value="${g.inventory.prices[id]}" data-prod="${id}"><span class="pr-val" id="pv-p-${id}">$${g.inventory.prices[id].toFixed(2)}</span></div>`).join('');
    return `<div class="section-title">PRICING</div><div class="note">Higher prices = more profit per sale, but fewer buyers and smaller tips. Find the sweet spot!</div>${fuelRows}<div style="height:10px"></div>${prodRows}`;
  }

  renderStats() {
    const g = this.game, s = g.economy.stats, L = g.economy.lifetime;
    const stat = (v, l) => `<div class="stat"><div class="s-val">${v}</div><div class="s-label">${l}</div></div>`;
    return `<div class="section-title">TODAY</div><div class="stat-grid">
      ${stat(money(s.revenue, 0), 'REVENUE')}${stat(money(s.tips, 0), 'TIPS')}${stat(s.fuelCustomers + s.registerCustomers, 'CUSTOMERS')}
      ${stat(Math.round(s.litres) + ' L', 'FUEL SOLD')}${stat(s.itemsSold, 'ITEMS SOLD')}${stat(s.funny, 'FUNNY MOMENTS')}
      ${stat(Math.round(g.cleaning.cleanliness() * 100) + '%', 'CLEANLINESS')}${stat(s.lost, 'CUSTOMERS LOST')}${stat(s.thievesCaught, 'THIEVES CAUGHT')}</div>
      <div class="section-title" style="margin-top:16px">ALL TIME</div><div class="stat-grid">
      ${stat(money(L.earned, 0), 'TOTAL EARNED')}${stat(L.days, 'DAYS SURVIVED')}${stat(L.funny, 'VIRAL MOMENTS')}${stat(g.economy.reputation.toFixed(1) + '★', 'REPUTATION')}</div>
      <div class="note" style="margin-top:14px">Daily costs at closing: staff wages ${money(g.upgrades.wages(), 0)} + electricity & bills ${money(this.game.dailyBills(), 0)}.</div>`;
  }

  onInput(e) {
    const g = this.game, t = e.target;
    if (t.dataset.fuel) { const v = parseFloat(t.value); g.fuel.prices[t.dataset.fuel] = v; $('pv-f-' + t.dataset.fuel).textContent = '$' + v.toFixed(2); g.station.updatePriceBoard(g.fuel.prices, g.upgrades.has('premium')); }
    if (t.dataset.prod) { const v = parseFloat(t.value); g.inventory.prices[t.dataset.prod] = v; $('pv-p-' + t.dataset.prod).textContent = '$' + v.toFixed(2); }
  }

  async onClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const g = this.game, act = b.dataset.act, id = b.dataset.id;
    g.audio.play('click');
    if (act === 'inc') { this.cart[id] = Math.min(9, (this.cart[id] || 0) + 1); this.render(); }
    if (act === 'dec') { this.cart[id] = Math.max(0, (this.cart[id] || 0) - 1); if (!this.cart[id]) delete this.cart[id]; this.render(); }
    if (act === 'autofill') {
      this.cart = {};
      for (const [pid, p] of Object.entries(PRODUCTS)) {
        if (p.level > g.economy.level) continue;
        const stock = g.inventory.totalStock(pid) + g.inventory.boxStock(pid);
        if (stock < p.slotCap * 1.5) this.cart[pid] = stock < p.slotCap * 0.5 ? 2 : 1;
      }
      this.render();
    }
    if (act === 'order') { if (g.deliveries.orderProducts(this.cart)) { this.cart = {}; this.render(); } }
    if (act === 'orderAd') {
      const cart = { ...this.cart };
      b.disabled = true;
      g.audio.setMuted(true);
      const ok = await g.sdk.rewarded();
      g.audio.setMuted(g.sdk.muted);
      if (ok) { if (g.deliveries.orderProducts(cart, true)) this.cart = {}; }
      else g.ui.toast('Ad not available right now — try the normal order', 'bad');
      this.render();
    }
    if (act === 'fuel') { if (g.fuel.orderFuel(b.dataset.type, parseInt(b.dataset.l, 10))) this.render(); }
    if (act === 'fuelAd') {
      g.audio.setMuted(true);
      const ok = await g.sdk.rewarded();
      g.audio.setMuted(g.sdk.muted);
      if (ok) {
        const types = ['regular', 'diesel'].concat(g.upgrades.has('premium') ? ['premium'] : []);
        const t = types.sort((a, c) => g.fuel.tanks[a] - g.fuel.tanks[c])[0];
        g.fuel.tanks[t] = Math.min(g.fuel.capacity, g.fuel.tanks[t] + 600);
        g.ui.toast(`⛽ +600 L ${FUELS[t].name}!`, 'good');
      }
      this.render();
    }
    if (act === 'buy') { if (g.upgrades.buy(id)) this.render(); }
  }
}
