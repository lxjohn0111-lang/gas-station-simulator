#!/usr/bin/env bash
# Downloads the third-party 3D assets used by the game and optimizes them
# (quantized geometry + WebP textures; no WASM decoder needed) into public/assets/models.
# The optimized results are committed, so this only needs to run to refresh them.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets-src
OUT=public/assets/models
mkdir -p "$SRC" "$OUT"
T=https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf
K=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models
get() { [ -f "$SRC/$2" ] || curl -sSfL -m 120 -o "$SRC/$2" "$1"; }
get "$T/Michelle.glb"          michelle.glb
get "$T/readyplayer.me.glb"    cowboy.glb
get "$T/Soldier.glb"           biker.glb
get "$T/Xbot.glb"              xbot.glb
get "$K/Fox/glTF-Binary/Fox.glb" fox.glb
GT=node_modules/.bin/gltf-transform
for f in michelle cowboy biker; do
  $GT optimize "$SRC/$f.glb" "$OUT/$f.glb" --compress quantize --texture-compress webp --texture-size 1024 --simplify false --join false --instance false --flatten false --palette false
done
# Animation library: skeleton + clips only (meshes/skins stripped).
node scripts/make-anims.mjs "$SRC/xbot.glb" "$OUT/anims.glb"
$GT optimize "$SRC/fox.glb" "$OUT/fox.glb" --compress quantize --texture-compress webp --simplify false --join false --flatten false --palette false
ls -la "$OUT"
