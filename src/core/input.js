/**
 * Unified keyboard / mouse / pointer-lock / touch input.
 * Gameplay reads polled state; edges (pressed/released) are cleared by endFrame().
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.kPressed = new Set();
    this.kReleased = new Set();
    this.buttons = new Set();
    this.bPressed = new Set();
    this.bReleased = new Set();
    this.lookX = 0; this.lookY = 0;
    this.wheel = 0;
    this.locked = false;
    this.cursorMode = false; // true when UI wants a free cursor (register, tablet)
    this.pointer = { x: 0, y: 0, nx: 0, ny: 0 }; // css px + NDC
    this.isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    this.joy = { x: 0, y: 0, active: false };
    this.sensitivity = 1;
    this.invertY = false;
    this.onLockChange = null;
    this.enabled = true;
    this._bind();
  }

  _bind() {
    const prevent = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace']);
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (prevent.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.kPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.kReleased.add(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.isTouch && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      this._setPointer(e.clientX, e.clientY);
      this.buttons.add(e.button); this.bPressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (this.buttons.has(e.button)) this.bReleased.add(e.button);
      this.buttons.delete(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      this._setPointer(e.clientX, e.clientY);
      if (this.locked || (this.freeLook && !this.cursorMode)) {
        // Clamp absurd spikes some browsers produce on lock.
        const mx = Math.max(-300, Math.min(300, e.movementX || 0));
        const my = Math.max(-300, Math.min(300, e.movementY || 0));
        this.lookX += mx; this.lookY += my;
      }
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      // a lock that was granted after the UI asked for a free cursor (register, tablet, dialogs) is dropped right away
      if (this.locked && this.cursorMode) { document.exitPointerLock(); return; }
      if (this.locked) { this._everLocked = true; this._lockFails = 0; this.freeLook = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    // A lock error right after Esc (browser cooldown) is normal: just ask for another click.
    // Only fall back to free-look when the embed never grants pointer lock at all.
    document.addEventListener('pointerlockerror', () => this._lockFailed());

    if (this.isTouch) this._bindTouch();
  }

  _lockFailed() {
    this.locked = false;
    this._lockFails = (this._lockFails || 0) + 1;
    if (!this._everLocked && this._lockFails >= 2) {
      this.freeLook = true;
      if (this.onLockChange) this.onLockChange(false, true);
    } else if (this.onLockError) this.onLockError();
  }

  _setPointer(x, y) {
    this.pointer.x = x; this.pointer.y = y;
    this.pointer.nx = (x / window.innerWidth) * 2 - 1;
    this.pointer.ny = -(y / window.innerHeight) * 2 + 1;
  }

  requestLock() {
    if (this.isTouch) return;
    // If the page is embedded somewhere that refuses pointer lock, fall back to
    // "free look" (raw mouse movement while the cursor is over the game).
    const fail = () => this._lockFailed();
    if (!this.canvas.requestPointerLock) { fail(); return; }
    const plain = () => { try { const p2 = this.canvas.requestPointerLock(); if (p2 && p2.catch) p2.catch(fail); } catch (e) { fail(); } };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch((e) => { if (e && e.name === 'NotSupportedError') plain(); else if (e && e.name === 'SecurityError') fail(); });
    } catch (e) { plain(); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ---------------- touch ----------------
  _bindTouch() {
    const joy = document.getElementById('joy');
    const knob = document.getElementById('joy-knob');
    let joyId = null, joyCx = 0, joyCy = 0;
    const R = 55;
    joy.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0]; joyId = t.identifier;
      const r = joy.getBoundingClientRect(); joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2;
      this.joy.active = true; move(t);
    }, { passive: false });
    const move = (t) => {
      let dx = t.clientX - joyCx, dy = t.clientY - joyCy;
      const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy.x = dx / R; this.joy.y = dy / R;
    };
    joy.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === joyId) move(t);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === joyId) {
        joyId = null; this.joy.active = false; this.joy.x = 0; this.joy.y = 0; knob.style.transform = '';
      }
    };
    joy.addEventListener('touchend', end); joy.addEventListener('touchcancel', end);

    // look / tap on canvas
    const looks = new Map();
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) looks.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now() });
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const l = looks.get(t.identifier); if (!l) continue;
        if (!this.cursorMode) { this.lookX += (t.clientX - l.x) * 3.0; this.lookY += (t.clientY - l.y) * 2.6; }
        l.x = t.clientX; l.y = t.clientY;
      }
    }, { passive: false });
    const lend = (e) => {
      for (const t of e.changedTouches) {
        const l = looks.get(t.identifier); if (!l) continue;
        looks.delete(t.identifier);
        const moved = Math.hypot(t.clientX - l.sx, t.clientY - l.sy);
        if (moved < 12 && performance.now() - l.t < 350) {
          // a tap = click at that position
          this._setPointer(t.clientX, t.clientY);
          this.tapAt = { x: t.clientX, y: t.clientY };
          this.bPressed.add(0); this.bReleased.add(0);
        }
      }
    };
    this.canvas.addEventListener('touchend', lend); this.canvas.addEventListener('touchcancel', lend);

    // buttons → virtual keys / mouse buttons
    const bindBtn = (id, onDown, onUp) => {
      const el = document.getElementById(id); if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('on'); onDown(); }, { passive: false });
      const up = (e) => { e.preventDefault(); el.classList.remove('on'); onUp && onUp(); };
      el.addEventListener('touchend', up, { passive: false }); el.addEventListener('touchcancel', up, { passive: false });
    };
    const vkey = (code) => [() => { if (!this.keys.has(code)) this.kPressed.add(code); this.keys.add(code); }, () => { this.keys.delete(code); this.kReleased.add(code); }];
    const vbtn = (b) => [() => { this.buttons.add(b); this.bPressed.add(b); this._touchCenter(); }, () => { this.buttons.delete(b); this.bReleased.add(b); }];
    bindBtn('t-use', ...vbtn(0));
    bindBtn('t-throw', ...vbtn(2));
    bindBtn('t-e', ...vkey('KeyE'));
    bindBtn('t-jump', ...vkey('Space'));
    bindBtn('t-shove', ...vkey('KeyF'));
    bindBtn('t-tab', ...vkey('Tab'));
    bindBtn('t-pause', ...vkey('Escape'));
  }
  _touchCenter() { this._setPointer(window.innerWidth / 2, window.innerHeight / 2); }

  // ---------------- polling API ----------------
  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { return this.enabled && this.kPressed.has(code); }
  released(code) { return this.kReleased.has(code); }
  mouseDown(b = 0) { return this.enabled && this.buttons.has(b); }
  mousePressed(b = 0) { return this.enabled && this.bPressed.has(b); }
  mouseReleased(b = 0) { return this.bReleased.has(b); }
  consumeLook() {
    const s = 0.0022 * this.sensitivity;
    const r = { dx: this.lookX * s, dy: this.lookY * s * (this.invertY ? -1 : 1) };
    this.lookX = 0; this.lookY = 0;
    return r;
  }
  moveAxes() {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp') || this.down('KeyZ')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft') || this.down('KeyQ_AZERTY')) x -= 1;
    if (this.joy.active) { x += this.joy.x; y -= this.joy.y; }
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y, analog: this.joy.active ? Math.hypot(this.joy.x, this.joy.y) : 0 };
  }
  endFrame() {
    this.kPressed.clear(); this.kReleased.clear();
    this.bPressed.clear(); this.bReleased.clear();
    this.wheel = 0; this.tapAt = null;
  }
}
