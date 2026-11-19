import { clamp, rand, pick } from './utils.js';

/**
 * Fully procedural WebAudio engine: SFX synthesis, positional loops,
 * gibberish voices and a generative country/lo-fi "radio" track.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.8;
    this.musicVolume = 0.5;
    this.muted = false;
    this.loops = new Set();
    this._lastFoot = 0;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.005; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.55; this.amb.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.master);
    // noise buffers
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.ready = true;
    this.applyVolume();
    this._startAmbience();
  }

  applyVolume() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.05);
    this.music.gain.setTargetAtTime(this.musicVolume * 0.9, t, 0.05);
  }
  setMuted(m) { this.muted = m; this.applyVolume(); }
  setVolume(v) { this.volume = v; this.applyVolume(); }
  setMusicVolume(v) { this.musicVolume = v; this.applyVolume(); }

  setListener(cam) {
    if (!this.ready) return;
    const L = this.ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(this._fwd || (this._fwd = cam.position.clone()));
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  // ------------------------------------------------------------- routing
  _out(pos, bus, ref = 3, rolloff = 1.1) {
    const target = bus || this.sfx;
    if (!pos) return target;
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 400;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(target);
    return p;
  }
  _env(g, t, a, peak, dec, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + dec);
  }
  _osc(type, freq, t, dur, out, peak = 0.3, attack = 0.005, freqEnd = null) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, attack, peak, dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + attack + dur + 0.05);
    return o;
  }
  _noise(t, dur, out, { peak = 0.3, type = 'bandpass', freq = 1000, q = 1, freqEnd = null, attack = 0.003, brown = false } = {}) {
    const s = this.ctx.createBufferSource(); s.buffer = brown ? this.brown : this.noise;
    s.playbackRate.value = rand(0.9, 1.1);
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, attack, peak, dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + attack + 0.05);
  }

  // ------------------------------------------------------------- one shots
  play(name, opts = {}) {
    if (!this.ready || this.muted) return;
    const c = this.ctx, t = c.currentTime + (opts.delay || 0);
    const vol = opts.vol ?? 1;
    const p = opts.pitch ?? 1;
    const out = this._out(opts.pos, null, opts.ref || 3);
    const g = c.createGain(); g.gain.value = vol; g.connect(out);
    switch (name) {
      case 'click': this._osc('sine', 1400 * p, t, 0.04, g, 0.18); break;
      case 'tick': this._osc('square', 2400 * p, t, 0.015, g, 0.05); break;
      case 'beep': this._osc('square', 1850 * p, t, 0.09, g, 0.12); this._osc('sine', 3700 * p, t, 0.09, g, 0.05); break;
      case 'key': this._osc('square', 1200 * p, t, 0.05, g, 0.07); break;
      case 'error': this._osc('square', 220, t, 0.12, g, 0.12); this._osc('square', 160, t + 0.13, 0.2, g, 0.12); break;
      case 'coin': this._osc('square', 988 * p, t, 0.07, g, 0.08); this._osc('square', 1319 * p, t + 0.07, 0.25, g, 0.08); break;
      case 'cash': {
        this._noise(t, 0.08, g, { peak: 0.2, freq: 4000, q: 0.7, type: 'highpass' });
        [2093, 2637, 3136].forEach((f, i) => this._osc('sine', f, t + 0.05 + i * 0.03, 0.9, g, 0.12));
        this._osc('triangle', 1046, t + 0.05, 0.6, g, 0.08);
        break;
      }
      case 'chime': // shop door bell
        this._osc('sine', 1318, t, 1.0, g, 0.16); this._osc('sine', 2636, t, 0.5, g, 0.04);
        this._osc('sine', 1046, t + 0.32, 1.3, g, 0.16); this._osc('sine', 2092, t + 0.32, 0.6, g, 0.04);
        break;
      case 'thud':
        this._osc('sine', 120 * p, t, 0.25, g, 0.5, 0.002, 40);
        this._noise(t, 0.12, g, { peak: 0.35, freq: 400, type: 'lowpass', q: 0.5, brown: true });
        break;
      case 'impact':
        this._osc('sine', 90 * p, t, 0.18, g, 0.35, 0.002, 45);
        this._noise(t, 0.08, g, { peak: 0.25, freq: 900 * p, type: 'lowpass', q: 0.7 });
        break;
      case 'bonk':
        this._osc('triangle', 520 * p, t, 0.22, g, 0.35, 0.002, 180);
        this._osc('sine', 1200 * p, t, 0.05, g, 0.15);
        break;
      case 'slip': { // slide whistle
        const o = c.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(380, t); o.frequency.exponentialRampToValueAtTime(1600, t + 0.45);
        const lfo = c.createOscillator(); lfo.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 25; lfo.connect(lg); lg.connect(o.frequency);
        const og = c.createGain(); this._env(og, t, 0.02, 0.22, 0.5);
        o.connect(og); og.connect(g); o.start(t); lfo.start(t); o.stop(t + 0.6); lfo.stop(t + 0.6);
        break;
      }
      case 'fall': { // descending whistle
        const o = c.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.6);
        const og = c.createGain(); this._env(og, t, 0.02, 0.18, 0.62); o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.7);
        break;
      }
      case 'boing': {
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(160 * p, t);
        o.frequency.exponentialRampToValueAtTime(420 * p, t + 0.08); o.frequency.exponentialRampToValueAtTime(140 * p, t + 0.5);
        const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(28, t); lfo.frequency.linearRampToValueAtTime(8, t + 0.5);
        const lg = c.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(o.frequency);
        const og = c.createGain(); this._env(og, t, 0.005, 0.3, 0.55); o.connect(og); og.connect(g);
        o.start(t); lfo.start(t); o.stop(t + 0.6); lfo.stop(t + 0.6);
        break;
      }
      case 'whoosh': this._noise(t, 0.35, g, { peak: 0.25, freq: 400, freqEnd: 2400, q: 1.2 }); break;
      case 'pop': this._osc('sine', 700 * p, t, 0.06, g, 0.25, 0.002, 200); break;
      case 'pumpClick':
        this._noise(t, 0.04, g, { peak: 0.3, freq: 3000, q: 2 });
        this._osc('square', 140, t, 0.06, g, 0.12, 0.002, 70);
        break;
      case 'drawer':
        this._noise(t, 0.18, g, { peak: 0.2, freq: 1800, q: 0.8, freqEnd: 900 });
        this._osc('sine', 180, t + 0.16, 0.12, g, 0.3, 0.002, 70);
        break;
      case 'paper': this._noise(t, 0.12, g, { peak: 0.15, freq: 5000, q: 0.5, type: 'highpass' }); break;
      case 'trash': this._noise(t, 0.25, g, { peak: 0.2, freq: 2500, q: 0.6, freqEnd: 1200 }); break;
      case 'splash': this._noise(t, 0.4, g, { peak: 0.25, freq: 1400, q: 0.8, freqEnd: 500 }); break;
      case 'honk': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600; lp.connect(g);
        const d = opts.long ? 0.7 : 0.32;
        this._osc('square', 392 * p, t, d, lp, 0.13, 0.01); this._osc('square', 466 * p, t, d, lp, 0.11, 0.01);
        break;
      }
      case 'backfire':
        this._noise(t, 0.35, g, { peak: 0.9, freq: 300, type: 'lowpass', q: 0.4, brown: true });
        this._osc('sine', 70, t, 0.3, g, 0.6, 0.001, 30);
        this._noise(t, 0.1, g, { peak: 0.5, freq: 2000, type: 'highpass' });
        break;
      case 'carDoor':
        this._osc('sine', 140, t, 0.12, g, 0.4, 0.002, 60);
        this._noise(t, 0.06, g, { peak: 0.2, freq: 1500, type: 'bandpass', q: 1 });
        break;
      case 'levelup': [523, 659, 784, 1046, 1318].forEach((f, i) => { this._osc('triangle', f, t + i * 0.09, 0.4, g, 0.16); this._osc('sine', f * 2, t + i * 0.09, 0.2, g, 0.05); }); break;
      case 'unlock': [392, 523, 659, 784].forEach((f, i) => this._osc('triangle', f, t + i * 0.07, 0.35, g, 0.15)); break;
      case 'perfect': [880, 1175, 1568].forEach((f, i) => this._osc('sine', f, t + i * 0.06, 0.3, g, 0.14)); break;
      case 'fail': [392, 330, 262].forEach((f, i) => this._osc('triangle', f, t + i * 0.12, 0.3, g, 0.14)); break;
      case 'laugh': { // sitcom-ish laugh: bursts of noisy "ha"
        for (let i = 0; i < 7; i++) {
          const tt = t + i * 0.13 + rand(0, 0.03);
          this._noise(tt, 0.1, g, { peak: 0.1, freq: rand(700, 1100), q: 4 });
          this._osc('sawtooth', rand(170, 260), tt, 0.09, g, 0.03);
        }
        break;
      }
      case 'swing': this._noise(t, 0.18, g, { peak: 0.2, freq: 600, freqEnd: 2000, q: 2 }); break;
      case 'scrape': this._noise(t, 0.5, g, { peak: 0.15, freq: 800, q: 3, freqEnd: 500 }); break;
      case 'mop': this._noise(t, 0.3, g, { peak: 0.12, freq: 1200, q: 0.5, type: 'lowpass' }); break;
      case 'alarm': {
        for (let i = 0; i < 8; i++) {
          this._osc('square', i % 2 ? 900 : 1300, t + i * 0.25, 0.22, g, 0.06, 0.01);
        }
        break;
      }
      case 'hit':
        this._noise(t, 0.08, g, { peak: 0.4, freq: 1600, q: 0.9 });
        this._osc('sine', 160, t, 0.12, g, 0.4, 0.001, 60);
        break;
      default: break;
    }
  }

  footstep(surface = 'concrete', pos = null, vol = 1) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, null, 2);
    const g = this.ctx.createGain(); g.gain.value = vol; g.connect(out);
    if (surface === 'tile') {
      this._noise(t, 0.05, g, { peak: 0.12, freq: rand(2500, 3500), q: 1.5 });
      this._osc('sine', rand(140, 180), t, 0.05, g, 0.12, 0.002, 80);
    } else if (surface === 'sand') {
      this._noise(t, 0.12, g, { peak: 0.13, freq: rand(1600, 2400), q: 0.6, type: 'lowpass' });
    } else if (surface === 'metal') {
      this._osc('triangle', rand(300, 380), t, 0.08, g, 0.08);
      this._noise(t, 0.05, g, { peak: 0.08, freq: 3000, q: 2 });
    } else {
      this._noise(t, 0.07, g, { peak: 0.13, freq: rand(1100, 1600), q: 0.8 });
      this._osc('sine', rand(90, 120), t, 0.06, g, 0.1, 0.002, 50);
    }
  }

  /** Gibberish voice line. mood: 'happy' | 'angry' | 'neutral' | 'scared' | 'question' */
  voice(pos, mood = 'neutral', female = false, seed = Math.random()) {
    if (!this.ready || this.muted) return;
    const c = this.ctx;
    const out = this._out(pos, null, 2.5);
    const vowels = [[730, 1090], [270, 2290], [530, 1840], [570, 840], [300, 870], [660, 1720], [440, 1020]];
    const base = (female ? 215 : 120) * (0.88 + seed * 0.25);
    const syll = mood === 'angry' ? 5 + Math.floor(rand(0, 4)) : 3 + Math.floor(rand(0, 4));
    const speed = mood === 'angry' ? 0.085 : mood === 'scared' ? 0.07 : 0.11;
    let t = c.currentTime + 0.02;
    for (let i = 0; i < syll; i++) {
      const v = pick(vowels);
      const dur = speed * rand(0.8, 1.4);
      const o = c.createOscillator(); o.type = 'sawtooth';
      let f0 = base * (mood === 'angry' ? 0.9 : 1) * rand(0.92, 1.1);
      if (mood === 'question' && i === syll - 1) f0 *= 1.35;
      if (mood === 'happy') f0 *= 1 + i * 0.03;
      if (mood === 'scared') f0 *= 1.5;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * (mood === 'angry' ? 0.85 : rand(0.95, 1.12)), t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
      const pk = mood === 'angry' ? 0.22 : 0.14;
      g.gain.exponentialRampToValueAtTime(pk, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = v[0] * (female ? 1.15 : 1); f1.Q.value = 6;
      const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = v[1] * (female ? 1.15 : 1); f2.Q.value = 8;
      const mix = c.createGain(); mix.gain.value = 2.2;
      o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(mix); mix.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
      t += dur + rand(0.01, 0.05);
    }
  }

  // ------------------------------------------------------------- loops
  _startAmbience() {
    const c = this.ctx;
    // desert wind
    const s = c.createBufferSource(); s.buffer = this.brown; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 280;
    lfo.connect(lg); lg.connect(f.frequency);
    this.windGain = c.createGain(); this.windGain.gain.value = 0.25;
    s.connect(f); f.connect(this.windGain); this.windGain.connect(this.amb); s.start(); lfo.start();
    // crickets (night)
    const o = c.createOscillator(); o.frequency.value = 4400; o.type = 'sine';
    const am = c.createGain(); am.gain.value = 0;
    const chirp = c.createOscillator(); chirp.type = 'square'; chirp.frequency.value = 28;
    const chirpG = c.createGain(); chirpG.gain.value = 0.5; chirp.connect(chirpG); chirpG.connect(am.gain);
    const gate = c.createOscillator(); gate.type = 'square'; gate.frequency.value = 1.3;
    this.cricketGain = c.createGain(); this.cricketGain.gain.value = 0;
    const gateG = c.createGain(); gateG.gain.value = 0.5;
    const post = c.createGain(); post.gain.value = 0.5;
    gate.connect(gateG); gateG.connect(post.gain);
    o.connect(am); am.connect(post); post.connect(this.cricketGain); this.cricketGain.connect(this.amb);
    o.start(); chirp.start(); gate.start();
    // distant highway rumble
    const hs = c.createBufferSource(); hs.buffer = this.brown; hs.loop = true;
    const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 180;
    this.rumbleGain = c.createGain(); this.rumbleGain.gain.value = 0.08;
    hs.connect(hf); hf.connect(this.rumbleGain); this.rumbleGain.connect(this.amb); hs.start();
  }
  setAmbience(night, wind = 1, indoor = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.25 * wind * (1 - indoor * 0.75), t, 0.5);
    this.cricketGain.gain.setTargetAtTime(0.025 * night * (1 - indoor * 0.8), t, 1);
  }

  /** Continuous engine sound for a vehicle. */
  createEngine(pos, big = false) {
    if (!this.ready) return null;
    const c = this.ctx;
    const out = this._out(pos, null, 5, 1.3);
    const g = c.createGain(); g.gain.value = 0; g.connect(out);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2; lp.connect(g);
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = big ? 34 : 45;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = big ? 17.3 : 22.6;
    const g2 = c.createGain(); g2.gain.value = 0.5; o2.connect(g2); g2.connect(lp); o1.connect(lp);
    o1.start(); o2.start();
    const h = {
      panner: out, gain: g, o1, o2, lp, big,
      set: (p, rpm, load) => {
        const t = c.currentTime;
        if (out.positionX) { out.positionX.setTargetAtTime(p.x, t, 0.03); out.positionY.setTargetAtTime(p.y, t, 0.03); out.positionZ.setTargetAtTime(p.z, t, 0.03); }
        const base = big ? 30 : 42;
        o1.frequency.setTargetAtTime(base + rpm * (big ? 40 : 70), t, 0.08);
        o2.frequency.setTargetAtTime((base + rpm * (big ? 40 : 70)) * 0.503, t, 0.08);
        lp.frequency.setTargetAtTime(300 + rpm * 900 + load * 400, t, 0.1);
        g.gain.setTargetAtTime(this.muted ? 0 : (0.05 + load * 0.08) * (big ? 1.6 : 1), t, 0.1);
      },
      stop: () => {
        try { g.gain.setTargetAtTime(0, c.currentTime, 0.05); o1.stop(c.currentTime + 0.3); o2.stop(c.currentTime + 0.3); } catch (e) { /* noop */ }
        this.loops.delete(h);
      },
    };
    this.loops.add(h);
    return h;
  }

  /** Pump motor + flowing fuel. */
  createPumpLoop(pos) {
    if (!this.ready) return null;
    const c = this.ctx;
    const out = this._out(pos, null, 2);
    const g = c.createGain(); g.gain.value = 0; g.connect(out);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 58;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; o.connect(lp); lp.connect(g);
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 1.5;
    const lfo = c.createOscillator(); lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 200; lfo.connect(lg); lg.connect(bp.frequency);
    const ng = c.createGain(); ng.gain.value = 0.6; n.connect(bp); bp.connect(ng); ng.connect(g);
    o.start(); n.start(); lfo.start();
    const h = {
      setActive: (on, rate = 1) => { g.gain.setTargetAtTime(on && !this.muted ? 0.11 : 0, c.currentTime, 0.06); o.frequency.setTargetAtTime(52 + rate * 14, c.currentTime, 0.1); },
      stop: () => { try { g.gain.setTargetAtTime(0, c.currentTime, 0.03); o.stop(c.currentTime + 0.2); n.stop(c.currentTime + 0.2); lfo.stop(c.currentTime + 0.2); } catch (e) { /* noop */ } },
    };
    return h;
  }

  // ------------------------------------------------------------- radio music
  startRadio(pos) {
    if (!this.ready || this.radio) return;
    const c = this.ctx;
    const out = this._out(pos, this.music, 4, 1.0);
    // boombox colouring
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const ws = c.createWaveShaper(); const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 1.6); }
    ws.curve = curve;
    const bus = c.createGain(); bus.gain.value = 0.9;
    bus.connect(hp); hp.connect(lp); lp.connect(ws); ws.connect(out);
    this.radio = { bus, out, next: c.currentTime + 0.2, step: 0, bar: 0, song: 0, on: true };
    this._newSong();
    this._radioTimer = setInterval(() => this._scheduleRadio(), 90);
  }
  setRadioPos(pos) {
    if (!this.radio) return;
    const p = this.radio.out;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
  }
  _newSong() {
    const songs = [
      { bpm: 104, key: 55, prog: [0, 5, 7, 0, 0, 5, 7, 7], minor: false, swing: 0.18 },
      { bpm: 92, key: 52, prog: [0, 8, 3, 10, 0, 8, 3, 10], minor: true, swing: 0.1 },
      { bpm: 118, key: 57, prog: [0, 0, 5, 5, 7, 5, 0, 7], minor: false, swing: 0.22 },
      { bpm: 86, key: 50, prog: [0, 9, 5, 7, 0, 9, 5, 7], minor: false, swing: 0.15 },
    ];
    this.radio.cur = songs[this.radio.song % songs.length];
    this.radio.song++;
    this.radio.bar = 0; this.radio.step = 0;
  }
  _note(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  _pluck(freq, t, dur, vol, bright = 2200) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 1.003;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(bright, t); f.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.radio.bus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  _scheduleRadio() {
    if (!this.radio || !this.ready) return;
    const c = this.ctx, R = this.radio, S = R.cur;
    const stepDur = 60 / S.bpm / 2; // eighth notes
    while (R.next < c.currentTime + 0.35) {
      const t = R.next + (R.step % 2 ? S.swing * stepDur : 0);
      const chordRoot = S.key + S.prog[R.bar % S.prog.length];
      const third = S.minor && (S.prog[R.bar % S.prog.length] === 0) ? 3 : (S.prog[R.bar % S.prog.length] === 9 ? 3 : 4);
      const st = R.step % 8;
      if (!this.muted) {
        // bass: root / fifth
        if (st === 0 || st === 4) this._pluck(this._note(chordRoot - 24 + (st === 4 ? 7 : 0)), t, 0.45, 0.22, 700);
        // strum on 2 & 4 + offbeats
        if (st === 2 || st === 6 || (st === 7 && Math.random() < 0.5)) {
          [0, third, 7, 12].forEach((iv, k) => this._pluck(this._note(chordRoot + iv), t + k * 0.012, 0.35, 0.05, 2600));
        }
        // brushes
        if (st % 2 === 1) this._noise(t, 0.05, this.radio.bus, { peak: 0.025, freq: 7000, type: 'highpass' });
        if (st === 2 || st === 6) this._noise(t, 0.12, this.radio.bus, { peak: 0.06, freq: 2500, q: 0.6 });
        if (st === 0) this._osc('sine', 60, t, 0.15, this.radio.bus, 0.18, 0.002, 40);
        // lead melody (pentatonic)
        if (Math.random() < 0.38) {
          const pent = S.minor ? [0, 3, 5, 7, 10, 12] : [0, 2, 4, 7, 9, 12];
          const m = S.key + 12 + pick(pent) + (Math.random() < 0.2 ? 12 : 0);
          this._pluck(this._note(m), t, 0.3, 0.06, 3500);
        }
      }
      R.step++;
      R.next += stepDur;
      if (R.step % 8 === 0) { R.bar++; if (R.bar >= 32) this._newSong(); }
    }
  }
  setRadioOn(on) { if (this.radio) this.radio.bus.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.2); }
}
