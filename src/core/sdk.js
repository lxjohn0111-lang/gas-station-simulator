/**
 * Thin, defensive wrapper around the CrazyGames HTML5 SDK v3.
 * Every call is safe when the SDK is missing (offline dev, ad-blockers, other portals).
 * Docs: https://docs.crazygames.com/sdk/
 */
class CrazySDK {
  constructor() {
    this.sdk = null;
    this.available = false;
    this.environment = 'disabled';
    this._gameplay = false;
    this._loading = false;
    this.adPlaying = false;
    this.onMuteChange = null; // (muted:boolean) => void
    this.onAdStateChange = null; // (playing:boolean) => void
  }

  async init() {
    try {
      const sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (!sdk) return false;
      await sdk.init();
      this.sdk = sdk;
      this.environment = sdk.environment || 'local';
      this.available = this.environment !== 'disabled';
      try {
        sdk.game.addSettingsChangeListener?.((settings) => {
          if (this.onMuteChange) this.onMuteChange(!!settings.muteAudio);
        });
      } catch (e) { /* older SDK */ }
      return this.available;
    } catch (e) {
      console.warn('[CrazySDK] init failed, running standalone', e);
      this.available = false;
      return false;
    }
  }

  get muted() {
    try { return !!(this.available && this.sdk.game.settings && this.sdk.game.settings.muteAudio); } catch (e) { return false; }
  }

  loadingStart() {
    if (this._loading) return; this._loading = true;
    try { this.available && this.sdk.game.loadingStart(); } catch (e) { /* noop */ }
  }
  loadingStop() {
    if (!this._loading) return; this._loading = false;
    try { this.available && this.sdk.game.loadingStop(); } catch (e) { /* noop */ }
  }
  gameplayStart() {
    if (this._gameplay || this.adPlaying) return; this._gameplay = true;
    try { this.available && this.sdk.game.gameplayStart(); } catch (e) { /* noop */ }
  }
  gameplayStop() {
    if (!this._gameplay) return; this._gameplay = false;
    try { this.available && this.sdk.game.gameplayStop(); } catch (e) { /* noop */ }
  }
  happytime() {
    try { this.available && this.sdk.game.happytime(); } catch (e) { /* noop */ }
  }

  _ad(type) {
    return new Promise((resolve) => {
      if (!this.available) { resolve(type === 'rewarded' ? 'unavailable' : 'skipped'); return; }
      const wasGameplay = this._gameplay;
      let settled = false;
      const done = (result) => {
        if (settled) return; settled = true;
        this.adPlaying = false;
        this.onAdStateChange && this.onAdStateChange(false);
        if (wasGameplay) this.gameplayStart();
        resolve(result);
      };
      try {
        this.sdk.ad.requestAd(type, {
          adStarted: () => {
            this.adPlaying = true;
            this.gameplayStop();
            this.onAdStateChange && this.onAdStateChange(true);
          },
          adFinished: () => done('finished'),
          adError: (err) => { console.warn('[CrazySDK] ad error', err); done('error'); },
        });
      } catch (e) { done('error'); }
    });
  }
  /** Midgame ad at a natural break. Resolves when the game may continue. */
  midgame() { return this._ad('midgame'); }
  /** Rewarded ad. Resolves true only if the player watched it to the end. */
  async rewarded() {
    const r = await this._ad('rewarded');
    if (r === 'unavailable') return true; // standalone build: grant the reward
    return r === 'finished';
  }

  // ---- persistent data (CrazyGames data module, falls back to localStorage) ----
  getItem(key) {
    try {
      if (this.available && this.sdk.data) return this.sdk.data.getItem(key);
    } catch (e) { /* fall through */ }
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  setItem(key, value) {
    try {
      if (this.available && this.sdk.data) { this.sdk.data.setItem(key, value); return; }
    } catch (e) { /* fall through */ }
    try { window.localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
  }
  removeItem(key) {
    try { if (this.available && this.sdk.data) this.sdk.data.removeItem(key); } catch (e) { /* noop */ }
    try { window.localStorage.removeItem(key); } catch (e) { /* noop */ }
  }
}

export const CrazyGames = new CrazySDK();
