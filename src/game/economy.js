import { clamp, money } from '../core/utils.js';

export const xpForLevel = (l) => Math.round(120 * Math.pow(l, 1.45));

/**
 * Money, XP/levels, reputation (0-5 stars), hype (viral fame) and stats.
 */
export class Economy {
  constructor(game) {
    this.game = game;
    this.money = 650;
    this.xp = 0;
    this.level = 1;
    this.reputation = 2.4;
    this.hype = 0;
    this.day = 1;
    this.stats = this.freshStats();
    this.lifetime = { earned: 0, customers: 0, funny: 0, perfect: 0, days: 0 };
  }

  freshStats() {
    return { revenue: 0, fuelRevenue: 0, shopRevenue: 0, tips: 0, expenses: 0, spendUpgrades: 0, spendStock: 0, spendOther: 0, fuelCustomers: 0, registerCustomers: 0, itemsSold: 0, litres: 0, lost: 0, funny: 0, perfect: 0, wrongFuel: 0, thievesCaught: 0, stolen: 0, washes: 0, repStart: this.reputation ?? 2.4 };
  }

  earn(amount, reason, pos = null, meta = {}) {
    if (!(amount > 0)) return;
    amount = Math.round(amount * 100) / 100;
    this.money += amount;
    this.stats.revenue += amount;
    this.lifetime.earned += amount;
    if (meta.tip) this.stats.tips += amount;
    else if (meta.sale === 'fuel' || reason === 'Fuel') this.stats.fuelRevenue += amount;
    else this.stats.shopRevenue += amount;
    const g = this.game;
    if (pos) { g.ui.float('+' + money(amount), pos, meta.tip ? 'xp' : ''); g.particles.money(pos, meta.tip ? 2 : 4); }
    g.audio.play('coin', { vol: 0.5, pitch: meta.tip ? 1.3 : 1 });
    g.ui.updateMoney(true);
  }

  /** Spend money. If `force`, allow going negative (penalties). */
  spend(amount, reason, force = false) {
    if (!(amount > 0)) return true;
    if (this.money < amount && !force && !['Hose repair', 'Fuel refund', 'Wages', 'Bills'].includes(reason)) {
      this.game.ui.toast(`Not enough cash! Need ${money(amount)}`, 'bad');
      this.game.audio.play('error');
      return false;
    }
    this.money -= amount;
    this.stats.expenses += amount;
    if (reason === 'Upgrade') this.stats.spendUpgrades += amount;
    else if (reason === 'Stock order' || reason === 'Fuel order') this.stats.spendStock += amount;
    else if (reason !== 'Wages' && reason !== 'Bills') this.stats.spendOther += amount;
    this.game.ui.updateMoney(true, true);
    return true;
  }

  addXP(n) {
    this.xp += n;
    let need = xpForLevel(this.level);
    while (this.xp >= need) {
      this.xp -= need;
      this.level++;
      need = xpForLevel(this.level);
      this.onLevelUp();
    }
    this.game.ui.updateLevel();
  }

  onLevelUp() {
    const g = this.game;
    g.ui.bigMessage(`LEVEL ${this.level}!`, 'New upgrades available on the tablet [TAB]');
    g.audio.play('levelup');
    g.particles.confetti(g.player.eye.clone().add(g.player.forward().multiplyScalar(2)));
    g.sdk.happytime();
    const unlocked = g.upgrades.list.filter((u) => u.level === this.level).map((u) => u.icon + ' ' + u.name);
    const prods = Object.values(g.productsCatalog).filter((p) => p.level === this.level).map((p) => p.icon + ' ' + p.name);
    if (unlocked.length) g.ui.toast('🔓 Unlocked: ' + unlocked.join(', '), 'good', 5);
    if (prods.length) g.ui.toast('🛒 New products to order: ' + prods.join(', '), 'good', 5);
    g.save();
  }

  rep(delta, pos) {
    this.reputation = clamp(this.reputation + delta, 0, 5);
    if (pos && Math.abs(delta) >= 0.03) this.game.ui.float(delta > 0 ? '★+' : '★−', pos.clone().setY(pos.y + 0.6), delta > 0 ? 'xp' : 'neg');
    this.game.ui.updateRep();
  }

  addHype(n) { this.hype = clamp(this.hype + n, 0, 100); this.game.ui.updateRep(); }

  /** Customers per minute. */
  customerRate() {
    const u = this.game.upgrades;
    let r = 2.4;
    r *= 0.45 + this.reputation / 4.2;
    r *= 1 + this.hype / 110;
    r *= 1 + (this.level - 1) * 0.06;
    if (u.has('billboard')) r *= 1.25;
    if (u.has('neon') && this.game.sky.nightFactor > 0.4) r *= 1.3;
    if (u.has('lights') && this.game.sky.nightFactor > 0.4) r *= 1.15;
    return r;
  }
  maxCustomers() { return Math.min(14, 5 + Math.floor(this.level * 0.9) + (this.game.upgrades.has('island2') ? 1 : 0) + (this.game.upgrades.has('island3') ? 1 : 0)); }
  patienceMul() { return 0.8 + this.reputation * 0.08 + (this.game.upgrades.has('radio') ? 0.1 : 0); }

  update(dt) {
    // hype decays slowly
    if (this.hype > 0) { this.hype = Math.max(0, this.hype - dt * 0.06); }
    this._uiT = (this._uiT || 0) + dt;
    if (this._uiT > 1) { this._uiT = 0; this.game.ui.updateRep(); }
    // cleanliness slowly nudges reputation
    this._cleanT = (this._cleanT || 0) + dt;
    if (this._cleanT > 20) {
      this._cleanT = 0;
      const c = this.game.cleaning.cleanliness();
      if (c < 0.6) this.rep(-0.02, null);
      else if (c > 0.92) this.rep(0.01, null);
      if (this.game.inventory.emptySlotsShare() > 0.6) this.rep(-0.015, null);
    }
  }

  serialize() { return { money: this.money, xp: this.xp, level: this.level, reputation: this.reputation, hype: this.hype, day: this.day, lifetime: this.lifetime }; }
  load(d) { if (!d) return; Object.assign(this, { money: d.money, xp: d.xp, level: d.level, reputation: d.reputation, hype: d.hype || 0, day: d.day }); if (d.lifetime) this.lifetime = d.lifetime; this.stats = this.freshStats(); }
}
