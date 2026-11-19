#!/usr/bin/env node
/**
 * Single-file build: one self-contained index.html with the JS bundle, CSS,
 * every texture (converted to WebP) and every model embedded as data URIs.
 *
 *   dist-single/index.html            -> CrazyGames upload (full document + SDK v3 tag)
 *   dist-single/last-chance-gas.zip   -> the same file zipped (zip contains only index.html)
 *   artifact/last-chance-gas.html     -> Claude Artifact page (no SDK tag, no document wrapper)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);
console.log('• vite build');
execSync('npx vite build --outDir dist --emptyOutDir', { stdio: 'inherit' });

let html = fs.readFileSync('dist/index.html', 'utf8');
const cssMatch = html.match(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/);
const jsMatch = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/);
if (!cssMatch || !jsMatch) throw new Error('could not find bundle tags in dist/index.html');
const css = fs.readFileSync(path.join('dist', cssMatch[1]), 'utf8');
const js = fs.readFileSync(path.join('dist', jsMatch[1]), 'utf8').replace(/<\/script/gi, '<\\/script');

// ---- embed assets
const assets = {};
let raw = 0;
for (const dir of ['assets/tex', 'assets/models']) {
  for (const f of fs.readdirSync(path.join('public', dir)).sort()) {
    const file = path.join('public', dir, f);
    const key = `${dir}/${f}`;
    let buf = fs.readFileSync(file), mime;
    if (/\.(jpe?g|png)$/i.test(f)) {
      const hasAlpha = /\.png$/i.test(f);
      buf = await sharp(buf).webp({ quality: hasAlpha ? 90 : 84, alphaQuality: 90, effort: 6 }).toBuffer();
      mime = 'image/webp';
    } else if (/\.glb$/i.test(f)) mime = 'model/gltf-binary';
    else continue;
    raw += buf.length;
    assets[key] = `data:${mime};base64,${buf.toString('base64')}`;
  }
}
const assetScript = `<script>window.__LCG_ASSETS__=${JSON.stringify(assets)};</script>`;

// CSS goes right after <title>; embedded assets + game script go at the end of <body>
html = html.replace(cssMatch[0], '').replace(jsMatch[0], '');
html = html.replace(/(<title>[^<]*<\/title>)/, (m) => `${m}\n<style>\n${css}\n</style>`);
html = html.replace(/<\/body>/i, () => `${assetScript}\n<script type="module">\n${js}\n</script>\n</body>`);
fs.rmSync('dist-single', { recursive: true, force: true });
fs.mkdirSync('dist-single', { recursive: true });
fs.writeFileSync('dist-single/index.html', html);

// ---- artifact variant: page content only (the host adds doctype/head/body), no CrazyGames SDK
let art = html
  .replace(/<script src="https:\/\/sdk\.crazygames\.com[^"]*"><\/script>\s*/, '')
  .replace(/<!-- CrazyGames SDK[^>]*-->\s*/, '')
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*$/i, '')
  .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8" \/>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
// title first so it is within the first 8KB
const titleTag = art.match(/<title>[^<]*<\/title>/)[0];
art = titleTag + '\n' + art.replace(titleTag, '');
fs.mkdirSync('artifact', { recursive: true });
fs.writeFileSync('artifact/last-chance-gas.html', art);

try { execSync('cd dist-single && rm -f last-chance-gas.zip && zip -q -9 last-chance-gas.zip index.html'); } catch (e) { console.warn('zip not available'); }
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log(`• embedded ${Object.keys(assets).length} assets (${mb(raw)} binary)`);
console.log(`• dist-single/index.html ${mb(fs.statSync('dist-single/index.html').size)}`);
console.log(`• artifact/last-chance-gas.html ${mb(fs.statSync('artifact/last-chance-gas.html').size)}`);
