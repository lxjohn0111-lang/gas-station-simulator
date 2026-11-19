/**
 * Day-1 onboarding as a chain of objectives that react to gameplay events.
 * Never blocks play; the station runs from second one.
 */
const STEPS = [
  { id: 'wait', title: 'WELCOME TO YOUR STATION', text: 'You just bought <b>Last Chance Gas</b>. A car is pulling up to the pumps — walk over (<b>WASD</b>).', done: 'carAtPump' },
  { id: 'nozzle', title: 'FUEL UP', text: 'Look at the pump and press <b>E</b> to grab the nozzle with the <b>matching fuel colour</b> (see the bubble above the car).', done: 'nozzleTaken' },
  { id: 'insert', title: 'FUEL UP', text: 'Look at the car\'s <b>fuel cap</b> and click <b>LMB</b> to insert the nozzle.', done: 'nozzleIn' },
  { id: 'pump', title: 'FUEL UP', text: '<b>Hold LMB</b> to pump. Release as close to the white target line as you can — perfect fills earn big tips!', done: 'fuelDone', hint: 'Then press <b>E</b> on the nozzle to remove it.' },
  { id: 'hang', title: 'FUEL UP', text: 'Hang the nozzle back on the pump (<b>E</b> at the pump, or <b>Q</b> to let the hose retract).', done: 'nozzleHome' },
  { id: 'register', title: 'RING THEM UP', text: 'Some customers pay inside. When someone waits at the counter, walk behind it and press <b>E</b> at the register.', done: 'registerOpen' },
  { id: 'pay', title: 'RING THEM UP', text: 'Click every item to <b>scan</b> it, then give the correct change or key in the card amount.', done: 'registerPaid' },
  { id: 'order', title: 'KEEP SHELVES FULL', text: 'Open the station tablet with <b>TAB</b> and order some stock boxes.', done: 'orderPlaced' },
  { id: 'box', title: 'KEEP SHELVES FULL', text: 'The truck drops boxes by the <b>side door</b> (west of the shop). Pick one up with <b>E</b>.', done: 'boxPicked' },
  { id: 'restock', title: 'KEEP SHELVES FULL', text: 'Look at an empty shelf slot and hold <b>LMB</b> to stock it. Throw empty boxes in the dumpster (<b>RMB</b>).', done: 'restocked' },
  { id: 'free', title: 'YOU\'RE THE BOSS NOW', text: 'Mop oil spills (hold <b>E</b>) before someone eats pavement… or don\'t 😈. Earn cash, level up and buy upgrades on the tablet!', done: null, timeout: 18 },
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.i = 0;
    this.active = true;
    this.timer = 0;
    this.seen = new Set();
  }
  get step() { return STEPS[this.i]; }

  start(skip) {
    if (skip) { this.active = false; this.game.ui.setObjectives([]); return; }
    this.render();
  }

  event(name) {
    this.seen.add(name);
    if (!this.active) return;
    // allow out-of-order completion
    let advanced = false;
    while (this.active && this.step && this.step.done && this.seen.has(this.step.done)) { this.i++; advanced = true; }
    if (advanced) {
      this.game.audio.play('perfect', { vol: 0.5 });
      this.game.economy.addXP(10);
      if (!this.step) { this.finish(); return; }
      this.render();
    }
  }

  finish() {
    this.active = false;
    this.game.ui.setObjectives([]);
    this.game.ui.toast('🎓 Tutorial complete! +$100 bonus', 'good', 4);
    this.game.economy.earn(100, 'Bonus');
    this.game.save();
  }

  render() {
    const s = this.step;
    if (!s) return;
    this.game.ui.setObjectives([{ title: s.title, text: s.text + (s.hint ? `<br><span style="opacity:.75">${s.hint}</span>` : '') }]);
  }

  update(dt) {
    if (!this.active) return;
    const s = this.step;
    if (s && s.timeout) {
      this.timer += dt;
      if (this.timer > s.timeout) { this.i++; if (!this.step) this.finish(); else this.render(); }
    }
    // nozzle back home detection
    if (s && s.done === 'nozzleHome') {
      const held = this.game.player.held;
      if (!held || held.kind !== 'nozzle') this.event('nozzleHome');
    }
  }
}
