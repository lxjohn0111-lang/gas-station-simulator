import { CrazyGames } from './sdk.js';

const KEY = 'lastchancegas_save_v1';
const SETTINGS_KEY = 'lastchancegas_settings_v1';

export function loadSave() {
  try {
    const raw = CrazyGames.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch (e) {
    console.warn('save corrupt, starting fresh', e);
    return null;
  }
}

export function writeSave(data) {
  try { CrazyGames.setItem(KEY, JSON.stringify({ ...data, version: 1, savedAt: Date.now() })); } catch (e) { console.warn('save failed', e); }
}

export function clearSave() { CrazyGames.removeItem(KEY); }

export function loadSettings() {
  const def = { quality: 'auto', sensitivity: 1, volume: 0.8, music: 0.5, fov: 72, invertY: false };
  try {
    const raw = CrazyGames.getItem(SETTINGS_KEY);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch (e) { return def; }
}
export function writeSettings(s) { try { CrazyGames.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* noop */ } }
