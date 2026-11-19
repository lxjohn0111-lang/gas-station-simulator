import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Renderer } from '../gfx/renderer.js';
import { TextureLib } from '../gfx/textures.js';
import { createMaterials } from '../gfx/materials.js';
import { DayNight } from '../gfx/sky.js';
import { Particles } from '../gfx/particles.js';
import { Physics } from '../physics/physics.js';
import { Colliders } from '../world/colliders.js';
import { NavGrid } from '../world/nav.js';
import { buildTerrain } from '../world/terrain.js';
import { Station, LAYOUT } from '../world/station.js';
import { buildShopInterior, SHOP } from '../world/shop.js';
import { CharacterLibrary } from '../entities/characters.js';
import { Traffic } from '../entities/traffic.js';
import { CustomerManager } from '../entities/customers.js';
import { Player } from '../entities/player.js';
import { Animals } from '../entities/animals.js';
import { buildWreck } from '../entities/vehicles.js';
import { FuelSystem } from './fuel.js';
import { Register } from './register.js';
import { Inventory } from './inventory.js';
import { Deliveries } from './deliveries.js';
import { Props } from './props.js';
import { Cleaning } from './cleaning.js';
import { Economy } from './economy.js';
import { Upgrades } from './upgrades.js';
import { Funny } from './funny.js';
import { Tutorial } from './tutorial.js';
import { PRODUCTS, FUELS } from './products.js';
import { HUD } from '../ui/hud.js';
import { Labels } from '../ui/labels.js';
import { Tablet } from '../ui/tablet.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { CrazyGames } from '../core/sdk.js';
import { loadSave, writeSave, clearSave, loadSettings, writeSettings } from '../core/save.js';
import { clamp, rand, pick, money, chance } from '../core/utils.js';

const OPEN_HOUR = 7, CLOSE_HOUR = 22, HARD_END = 23.6;
const SECONDS_PER_HOUR = 30;

/** Registry of meshes the player can interact with (raycast targets). */
class Interactables {
  constructor() { this.objects = []; }
  add(obj) { obj.traverse((o) => { if (o.isMesh && o.userData.interact && !this.objects.includes(o)) this.objects.push(o); }); }
  remove(obj) { obj.traverse((o) => { const i = this.objects.indexOf(o); if (i >= 0) this.objects.splice(i, 1); }); }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.sdk = CrazyGames;
    this.settings = loadSettings();
    this.input = new Input(canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume; this.audio.musicVolume = this.settings.music;
    this.renderer = new Renderer(canvas);
    this.renderer.setQuality(this.settings.quality);
    this.scene = new THREE.Scene();
    this.interact = new Interactables();
    this.clock = { day: 1, hour: OPEN_HOUR - 0.25, open: true };
    this.state = 'loading';
    this.productsCatalog = PRODUCTS;
    this.time = 0;
    this._saveT = 0;
    this.timers = [];
  }

  /** Run fn after `sec` seconds of game time (pauses with the game). */
  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  async load(onProgress) {
    const prog = { tex: 0, models: 0 };
    const report = (label) => onProgress && onProgress(prog.tex * 0.35 + prog.models * 0.45, label);
    const manager = new THREE.LoadingManager();
    manager.onProgress = (url, loaded, total) => { prog.tex = loaded / total; report('Painting the asphalt…'); };
    this.tex = new TextureLib(manager, this.renderer.renderer);
    this.mats = createMaterials(this.tex);
    const texDone = new Promise((res) => { manager.onLoad = res; manager.onError = () => {}; setTimeout(res, 15000); });

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.chars = new CharacterLibrary();
    const charsDone = this.chars.load(loader, (p) => { prog.models = p; report('Waking up the locals…'); });

    // core systems that don't need assets
    this.physics = new Physics();
    this.colliders = new Colliders(this.physics);
    this.particles = new Particles(this.scene);
    this.sky = new DayNight(this.scene, this.renderer.renderer, this.renderer.q);
    this.player = new Player(this);
    this.renderer.setup(this.scene, this.player.camera);
    this.renderer.onQualityChange = (q) => { this.sky.setShadowSize(q.shadow); };
    this.sky.setShadowSize(this.renderer.q.shadow);

    await Promise.all([texDone, charsDone]);
    onProgress && onProgress(0.85, 'Building the station…');
    await new Promise((r) => setTimeout(r, 30));

    // world
    this.terrain = buildTerrain(this.scene, this.mats, this.colliders);
    this.economy = new Economy(this);
    this.upgrades = new Upgrades(this);
    this.station = new Station(this);
    this.station.build();
    this.station.signFlicker = true;
    const shop = buildShopInterior(this.station);
    this.station.finalize();
    this.nav = new NavGrid(-48, 48, -40, 22, 0.5);
    this.nav.buildFrom(this.colliders, 0.32);
    // doors are walkable for NPCs (they open)
    const wreck = buildWreck(); wreck.group.position.set(-58, 0, 24); wreck.group.rotation.y = 0.7; this.scene.add(wreck.group);

    // gameplay systems
    this.labels = new Labels(this);
    this.ui = new HUD(this);
    this.traffic = new Traffic(this);
    this.fuel = new FuelSystem(this);
    this.props = new Props(this);
    this.inventory = new Inventory(this, shop.slots, shop.hitboxes);
    this.deliveries = new Deliveries(this);
    this.register = new Register(this);
    this.cleaning = new Cleaning(this);
    this.customers = new CustomerManager(this);
    this.funny = new Funny(this);
    this.tutorial = new Tutorial(this);
    this.animals = new Animals(this, this.chars);
    this.tablet = new Tablet(this);
    this.fuel.build();
    this.props.spawnDecor();
    onProgress && onProgress(0.93, 'Brewing coffee…');

    // restore save
    const save = loadSave();
    this.hadSave = !!save;
    if (save) this.applySave(save);
    else {
      this.inventory.initialStock();
      for (let i = 0; i < 4; i++) this.cleaning.spawnLitter(new THREE.Vector3(rand(-14, 14), 0, rand(-30, -6)));
      this.cleaning.addHazard('oil', new THREE.Vector3(6, 0, -21.5), 1.6);
    }
    this.station.updatePriceBoard(this.fuel.prices, this.upgrades.has('premium'));
    this.sky.setWeather('clear');
    this.sky.update(0.016, this.clock.hour, this.player.pos, this.renderer.renderer);
    this.sky.regenEnv();

    // warm up shaders (avoid first-frame hitch)
    try { this.renderer.renderer.compile(this.scene, this.player.camera); } catch (e) { /* noop */ }
    this.bindUI();
    onProgress && onProgress(1, 'Opening up!');
  }

  dailyBills() { return 25 + this.upgrades.owned.size * 6; }

  // ------------------------------------------------------------------ save / load
  serialize() {
    return {
      economy: this.economy.serialize(), fuel: this.fuel.serialize(), inventory: this.inventory.serialize(),
      upgrades: this.upgrades.serialize(), deliveries: this.deliveries.serialize(),
      tutorialDone: !this.tutorial.active, clock: { day: this.clock.day },
    };
  }
  applySave(s) {
    this.economy.load(s.economy);
    this.clock.day = s.economy.day || 1;
    this.fuel.load(s.fuel);
    this.upgrades.load(s.upgrades);
    if (!this.inventory.load(s.inventory)) this.inventory.initialStock();
    this.deliveries.load(s.deliveries);
    this.tutorialDone = !!s.tutorialDone;
  }
  save() {
    if (this.state === 'loading') return;
    this.economy.day = this.clock.day;
    writeSave(this.serialize());
  }

  // ------------------------------------------------------------------ UI wiring
  bindUI() {
    const $ = (id) => document.getElementById(id);
    const ctp = $('click-to-play');
    const lockOrStart = () => {
      this.audio.unlock();
      if (this.state === 'paused') this.resume();
      if (!this.input.isTouch && !this.input.cursorMode) this.input.requestLock();
    };
    ctp.addEventListener('click', lockOrStart);
    this.canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (!this.input.locked && !this.input.cursorMode && this.state === 'play' && !this.input.isTouch) this.input.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (locked) { ctp.classList.add('hidden'); if (this.state === 'play') this.sdk.gameplayStart(); }
      else if (!this.input.cursorMode && this.state === 'play') this.pause();
    };
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'paused' && this.input.isTouch) this.resume();
      if (e.code === 'KeyP' && this.state === 'play') this.pause();
    });
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false });
    $('btn-resume').addEventListener('click', () => { this.resume(); if (!this.input.isTouch) this.input.requestLock(); });
    $('btn-reset').addEventListener('click', () => {
      if (confirm('Reset your station and start over?')) { clearSave(); location.reload(); }
    });
    const q = $('set-quality'), sens = $('set-sens'), vol = $('set-vol'), mus = $('set-music'), fov = $('set-fov'), inv = $('set-invert');
    q.value = this.settings.quality; sens.value = this.settings.sensitivity; vol.value = this.settings.volume; mus.value = this.settings.music; fov.value = this.settings.fov; inv.checked = this.settings.invertY;
    this.player.fov = this.settings.fov;
    const store = () => writeSettings(this.settings);
    q.addEventListener('change', () => { this.settings.quality = q.value; this.renderer.setQuality(q.value); store(); });
    sens.addEventListener('input', () => { this.settings.sensitivity = parseFloat(sens.value); this.input.sensitivity = this.settings.sensitivity; store(); });
    vol.addEventListener('input', () => { this.settings.volume = parseFloat(vol.value); this.audio.setVolume(this.settings.volume); store(); });
    mus.addEventListener('input', () => { this.settings.music = parseFloat(mus.value); this.audio.setMusicVolume(this.settings.music); store(); });
    fov.addEventListener('input', () => { this.settings.fov = parseFloat(fov.value); this.player.fov = this.settings.fov; store(); });
    inv.addEventListener('change', () => { this.settings.invertY = inv.checked; this.input.invertY = inv.checked; store(); });
    $('sum-next').addEventListener('click', () => this.nextDay());
    $('sum-double').addEventListener('click', () => this.doubleTips());
    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.save(); if (this.state === 'play' && !this.input.isTouch) this.pause(); } });
    window.addEventListener('beforeunload', () => this.save());
    this.sdk.onMuteChange = (m) => this.audio.setMuted(m);
    this.sdk.onAdStateChange = (playing) => this.audio.setMuted(playing || this.sdk.muted);
    if (this.input.isTouch) { $('touch').classList.remove('hidden'); document.body.classList.add('touch'); }
  }

  start() {
    this.state = 'play';
    this.ui.show();
    this.audio.setMuted(this.sdk.muted);
    const ctp = document.getElementById('click-to-play');
    if (!this.input.isTouch) ctp.classList.remove('hidden');
    else this.sdk.gameplayStart();
    document.body.style.cursor = 'none';
    this.tutorial.start(this.tutorialDone);
    // guarantee an early first customer at the pumps
    setTimeout(() => { if (this.customers.list.length === 0) this.customers.trySpawn('fuel'); }, this.hadSave ? 6000 : 1500);
    this.ui.bigMessage(`DAY ${this.clock.day}`, this.hadSave ? 'Welcome back, boss.' : 'Last Chance Gas is OPEN');
    this.ui.updateClock(this.clock.day, this.clock.hour, this.sky.weatherName);
    this.loop();
  }

  pause() {
    if (this.state !== 'play') return;
    if (this.tablet.isOpen || this.register.active) return;
    this.state = 'paused';
    document.getElementById('pause').classList.remove('hidden');
    document.body.style.cursor = 'default';
    this.sdk.gameplayStop();
    this.save();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'play';
    document.getElementById('pause').classList.add('hidden');
    document.body.style.cursor = 'none';
    if (this.input.isTouch) this.sdk.gameplayStart();
  }

  // ------------------------------------------------------------------ day cycle
  updateClock(dt) {
    const c = this.clock;
    c.hour += dt / SECONDS_PER_HOUR;
    if (c.open && c.hour >= CLOSE_HOUR) {
      c.open = false;
      this.ui.toast('🔒 Closing time! Finish serving the last customers.', 'good', 4);
      this.audio.play('chime');
    }
    if (!c.open && ((this.customers.list.length === 0 && c.hour >= CLOSE_HOUR + 0.2) || c.hour >= HARD_END)) this.endDay();
    this._clockUI = (this._clockUI || 0) + dt;
    if (this._clockUI > 0.5) { this._clockUI = 0; this.ui.updateClock(c.day, c.hour, this.sky.weatherName); }
  }

  endDay() {
    if (this.state !== 'play') return;
    this.state = 'summary';
    if (this.tablet.isOpen) this.tablet.close();
    if (this.register.active) this.register.exit();
    this.input.exitLock();
    document.body.style.cursor = 'default';
    this.sdk.gameplayStop();
    const e = this.economy, s = e.stats;
    const wages = this.upgrades.wages(), bills = this.dailyBills();
    e.spend(wages, 'Wages', true); e.spend(bills, 'Bills', true);
    e.lifetime.days++;
    const profit = s.revenue - s.expenses;
    const row = (k, v, cls = '') => `<span>${k}</span><span class="v ${cls}">${v}</span>`;
    document.getElementById('sum-title').textContent = `DAY ${this.clock.day} COMPLETE`;
    document.getElementById('sum-grid').innerHTML = [
      row('⛽ Fuel sales', money(s.fuelRevenue), 'pos'), row('🛒 Shop sales', money(s.shopRevenue), 'pos'), row('💰 Tips', money(s.tips), 'pos'),
      row('📦 Stock, fuel & repairs', '−' + money(s.expenses - wages - bills), 'neg'), row('🧑‍🔧 Staff wages', '−' + money(wages), 'neg'), row('💡 Electricity & bills', '−' + money(bills), 'neg'),
      row('👥 Customers served', s.fuelCustomers + s.registerCustomers), row('😂 Funny moments', s.funny), row('⭐ Reputation', `${s.repStart.toFixed(1)} → ${e.reputation.toFixed(1)}`),
    ].join('');
    const pEl = document.getElementById('sum-profit');
    pEl.textContent = (profit >= 0 ? '+' : '') + money(profit);
    pEl.style.color = profit >= 0 ? '#9cffbf' : '#ff9c9c';
    const dbl = document.getElementById('sum-double');
    dbl.disabled = s.tips < 1; dbl.textContent = `▶ Watch ad: DOUBLE today's tips (+${money(s.tips)})`;
    document.getElementById('day-summary').classList.remove('hidden');
    this.audio.play(profit >= 0 ? 'levelup' : 'fail');
    if (profit > 0) this.sdk.happytime();
    this.customers.clearAll();
    this.save();
  }

  async doubleTips() {
    const btn = document.getElementById('sum-double');
    btn.disabled = true;
    const ok = await this.sdk.rewarded();
    this.audio.setMuted(this.sdk.muted);
    if (ok) { this.economy.earn(this.economy.stats.tips, 'Tip bonus'); btn.textContent = '✔ Tips doubled!'; this.save(); }
    else btn.textContent = 'Ad unavailable';
  }

  async nextDay() {
    document.getElementById('day-summary').classList.add('hidden');
    await this.sdk.midgame();
    this.audio.setMuted(this.sdk.muted);
    const c = this.clock;
    c.day++; c.hour = OPEN_HOUR - 0.25; c.open = true;
    this.economy.day = c.day;
    this.economy.stats = this.economy.freshStats();
    for (const t of Object.keys(this.fuel.market)) this.fuel.market[t] = rand(0.88, 1.15);
    const w = c.day >= 2 && chance(0.12) ? 'dust' : chance(0.25) ? 'cloudy' : 'clear';
    this.sky.setWeather(w);
    if (w === 'dust') { this.ui.toast('🌪️ Dust storm warning today! Expect tumbleweeds & chaos', 'fun', 5); }
    this.state = 'play';
    this.ui.bigMessage(`DAY ${c.day}`, pick(['Rise and shine!', 'Another day, another dollar', 'The desert awaits', 'Coffee first.']));
    this.save();
    if (!this.input.isTouch) document.getElementById('click-to-play').classList.remove('hidden');
    else this.sdk.gameplayStart();
    document.body.style.cursor = 'none';
    setTimeout(() => this.customers.trySpawn('fuel'), 2500);
  }

  // ------------------------------------------------------------------ loop
  loop() {
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      const real = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      try { this.frame(real); } catch (err) { console.error(err); }
    };
    requestAnimationFrame(frame);
  }

  /** Debug/test helper: advance the simulation without rendering. */
  simulate(seconds, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) { this.frame(step, true); }
  }

  frame(real, noRender = false) {
    const dt = this.state === 'play' ? real : 0;
    this.time += dt;
    const inp = this.input;
    if (this.state === 'play') {
      if (inp.pressed('Tab') && !this.register.active) this.tablet.toggle();
      if (inp.pressed('Escape') && this.tablet.isOpen) this.tablet.close();
      this.updateClock(dt);
    }
    this.player.update(this.state === 'play' ? dt : 0);
    this.sky.update(real * (this.state === 'play' ? 1 : 0) + 0.0001, this.clock.hour, this.player.pos, this.renderer.renderer);
    if (dt > 0) {
      if (this.timers.length) {
        const due = [];
        for (const tm of this.timers) { tm.t -= dt; if (tm.t <= 0) due.push(tm); }
        if (due.length) { this.timers = this.timers.filter((tm) => tm.t > 0); for (const tm of due) { try { tm.fn(); } catch (e) { console.error(e); } } }
      }
      this.traffic.update(dt, this.clock.hour);
      this.customers.update(dt);
      this.physics.step(dt);
      this.fuel.update(dt, this.player);
      this.register.update(dt);
      this.inventory.update(dt);
      this.deliveries.update(dt);
      this.props.update(dt);
      this.cleaning.update(dt);
      this.funny.update(dt);
      this.upgrades.update(dt);
      this.animals.update(dt);
      this.tutorial.update(dt);
      this.economy.update(dt);
      this.particles.update(dt);
      // dusty weather spawns extra tumbleweeds
      if (this.sky.weather.dust > 0.5 && Math.random() < dt * 0.08) this.props.spawnTumbleweed(chance(0.2));
      const actors = [this.player.pos, ...this.customers.list.filter((c) => !c.inCar).map((c) => c.pos)];
      this.station.updateDoors(dt, actors);
      this._saveT += dt;
      if (this._saveT > 45) { this._saveT = 0; this.save(); }
    }
    this.station.updateLighting(this.sky.nightFactor, real, this.time);
    this.renderer.bloom.strength = 0.45 - this.sky.nightFactor * 0.17;
    // audio
    if (this.audio.ready) {
      this.audio.setListener(this.player.camera);
      const S = LAYOUT.shop, p = this.player.pos;
      const indoor = p.x > S.minX && p.x < S.maxX && p.z > S.minZ && p.z < S.maxZ ? 1 : 0;
      this.audio.setAmbience(this.sky.nightFactor, this.sky.weather.wind, indoor);
    }
    // HUD
    if (this.player.fixed || this.state !== 'play') this.ui.setPrompt(null);
    this.ui.updateGauge(this.state === 'play' && !this.player.fixed ? this.fuel.gaugeInfo(this.player) : null);
    this.ui.updateTanks(real);
    this.labels.update(real);
    // render
    const fl = this.renderer.final.material.uniforms.flash;
    if (fl.value > 0) fl.value = Math.max(0, fl.value - real * 1.8);
    if (noRender) return;
    this.renderer.adapt(real);
    this.particles.setScale(window.innerHeight * this.renderer.pixelRatio() * 0.6);
    this.renderer.render(real);
    inp.endFrame();
  }
}

export { SHOP, FUELS };
