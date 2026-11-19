/**
 * Asset resolution. In the single-file build every texture/model is embedded
 * as a data URI in window.__LCG_ASSETS__ (keyed by 'assets/...'); otherwise
 * assets are loaded from the relative ./assets folder.
 */
const EMBED = (typeof window !== 'undefined' && window.__LCG_ASSETS__) || null;

export function assetURL(path) {
  if (EMBED && EMBED[path]) return EMBED[path];
  return './' + path;
}

function decodeDataURI(uri) {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Load a GLB without network access when it is embedded (no fetch of data: URIs). */
export function loadGLB(loader, path, onLoad, onError) {
  if (EMBED && EMBED[path]) {
    try { loader.parse(decodeDataURI(EMBED[path]), '', onLoad, onError); } catch (e) { onError(e); }
    return;
  }
  loader.load('./' + path, onLoad, undefined, onError);
}
