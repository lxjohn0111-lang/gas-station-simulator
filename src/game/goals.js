import { money } from '../core/utils.js';

const $ = (id) => document.getElementById(id);
const STAFF = ['cashier', 'attendant', 'janitor', 'stocker'];

/**
 * "Next goal" chain: one clear goal at a time (top-left card) with a progress
 * bar and a cash reward, so the player always knows what to do next.
 *   ev:   counts gameplay events (fuelDone, registerPaid, restocked, ...)
 *   has:  owns an upgrade
 *   prog: polled function returning [current, needed]
 */
const CHAIN = [
  { id: 'fill3', icon: '⛽', text: 'Fill up 3 cars at the pumps', ev: 'fuelDone', n: 3, reward: 60 },
  { id: 'ring3', icon: '🧾', text: 'Ring up 3 customers at the register', ev: 'registerPaid', n: 3, reward: 60 },
  { id: 'radio', icon: '📻', text: 'Buy the Boombox Radio<br><small>{TAB} → UPGRADES</small>', has: 'radio', reward: 40 },
  { id: 'stock20', icon: '📦', text: 'Put 20 items on the shelves', ev: 'restocked', n: 20, reward: 50 },
  { id: 'lvl2', icon: '⭐', text: 'Reach level 2<br><small>every job gives XP</small>', prog: (g) => [Math.min(g.economy.level, 2) - 1, 1], reward: 100 },
  { id: 'island2', icon: '⛽', text: 'Repair Pump Island 2<br><small>more pumps = more customers</small>', has: 'island2', reward: 150 },
  { id: 'staff2', icon: '🧑‍🔧', text: 'Build a team: have 2 employees<br><small>{TAB} → UPGRADES → Staff</small>', prog: (g) => [STAFF.filter((s) => g.upgrades.has(s)).length, 2], reward: 100 },
  { id: 'day800', icon: '💵', text: 'Earn $800 in a single day', prog: (g) => [Math.floor(g.economy.stats.revenue), 800], money: true, reward: 150 },
  { id: 'mop5', icon: '🧽', text: 'Mop up 5 spills', ev: 'mopped', n: 5, reward: 80 },
  { id: 'premium', icon: '🏁', text: 'Unlock Premium fuel', has: 'premium', reward: 150 },
  { id: 'thief', icon: '👮', text: 'Tackle a shoplifter ({F})', ev: 'thiefCaught', n: 1, reward: 100 },
  { id: 'rep4', icon: '⭐', text: 'Reach a 4★ reputation<br><small>fast, friendly service</small>', prog: (g) => [Math.min(4, Math.floor(g.economy.reputation * 10) / 10), 4], reward: 250 },
  { id: 'island3', icon: '⛽', text: 'Repair Pump Island 3', has: 'island3', reward: 300 },
  { id: 'carwash', icon: '🫧', text: 'Build the car wash', has: 'carwash', reward: 500 },
];

export class Goals {
  constructor(game) {
    this.game = game;
    this.i = 0;
    this.count = 0;
    this.visible = false;
    this.cooldown = 0;
    this.dynamic = null;
    this.el = { box: $('goal'), num: $('goal-num'), icon: $('goal-icon'), text: $('goal-text'), fill: $('goal-fill'), prog: $('goal-prog'), reward: $('goal-reward') };
  }

  serialize() { return { i: this.i, count: this.count }; }
  load(d) { if (d) { this.i = d.i || 0; this.count = d.count || 0; } }

  /** Current goal (fixed chain, then "buy the next upgrade" goals). */
  current() {
    if (this.i < CHAIN.length) return CHAIN[this.i];
    const g = this.game;
    if (!this.dynamic || g.upgrades.has(this.dynamic.has)) {
      const next = g.upgrades.list.filter((u) => !g.upgrades.has(u.id)).sort((a, b) => a.level - b.level || a.cost - b.cost)[0];
      if (next) this.dynamic = { id: 'up_' + next.id, icon: next.icon, text: `Buy: ${next.name}${next.level > g.economy.level ? `<br><small>unlocks at level ${next.level}</small>` : ''}`, has: next.id, reward: Math.round(next.cost * 0.12 / 5) * 5 };
      else {
        const target = Math.ceil((g.economy.lifetime.earned + 1) / 5000) * 5000;
        this.dynamic = { id: 'earn' + target, icon: '🏆', text: `Legendary owner: earn ${money(target, 0)} in total`, prog: (gg) => [Math.floor(gg.economy.lifetime.earned), target], money: true, reward: 250 };
      }
    }
    return this.dynamic;
  }

  show(on) {
    this.visible = on;
    this.el.box.classList.toggle('hidden', !on);
    if (on) this.render(true);
  }

  progress(goal) {
    const g = this.game;
    if (goal.ev) return [this.count, goal.n];
    if (goal.has) return [g.upgrades.has(goal.has) ? 1 : 0, 1];
    if (goal.prog) return goal.prog(g);
    return [0, 1];
  }

  event(name) {
    const g = this.game;
    if (g.tutorial && g.tutorial.active) return;
    const goal = this.current();
    if (goal && goal.ev === name) { this.count++; this.render(); }
  }

  complete(goal) {
    const g = this.game;
    g.economy.earn(goal.reward, 'Goal reward', g.player.eye.clone().add(g.player.forward().multiplyScalar(1.5)));
    g.economy.addXP(15);
    g.audio.play('levelup', { vol: 0.6 });
    g.ui.toast(`🎯 GOAL COMPLETE! <b>+${money(goal.reward, 0)}</b>`, 'good', 3.5);
    this.el.box.classList.remove('done'); void this.el.box.offsetWidth; this.el.box.classList.add('done');
    if (this.i < CHAIN.length) this.i++;
    else this.dynamic = null;
    this.count = 0;
    this.cooldown = 1.6;
    g.save();
  }

  update(dt) {
    if (!this.visible) return;
    if (this.cooldown > 0) { this.cooldown -= dt; if (this.cooldown <= 0) this.render(true); return; }
    this._t = (this._t || 0) - dt;
    if (this._t > 0) return;
    this._t = 0.4;
    const goal = this.current();
    if (!goal) return;
    const [cur, need] = this.progress(goal);
    if (cur >= need) { this.render(); this.complete(goal); return; }
    this.render();
  }

  render(force = false) {
    const goal = this.current();
    if (!goal) return;
    const [cur, need] = this.progress(goal);
    const keys = this.game.tutorial.keys.bind(this.game.tutorial);
    const html = keys(goal.text);
    const pct = Math.max(0, Math.min(1, cur / need));
    const progTxt = goal.has ? (cur ? 'Done!' : 'Not yet') : goal.money ? `${money(cur, 0)} / ${money(need, 0)}` : `${Math.min(cur, need)} / ${need}`;
    const key = goal.id + html + progTxt;
    if (!force && key === this._last) return;
    if (this._lastId !== goal.id) {
      this._lastId = goal.id;
      this.el.box.classList.remove('new'); void this.el.box.offsetWidth; this.el.box.classList.add('new');
    }
    this._last = key;
    this.el.num.textContent = this.i < CHAIN.length ? `${this.i + 1}/${CHAIN.length}` : '';
    this.el.icon.textContent = goal.icon;
    this.el.text.innerHTML = html;
    this.el.fill.style.width = (pct * 100).toFixed(1) + '%';
    this.el.prog.textContent = progTxt;
    this.el.reward.textContent = '+' + money(goal.reward, 0);
  }
}
