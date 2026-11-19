// Builds public/assets/models/anims.glb: the X Bot skeleton + animation clips only
// (meshes, materials and skins removed), with resampled/quantized animation data.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, resample, dedup } from '@gltf-transform/functions';

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
for (const node of root.listNodes()) { node.setMesh(null); node.setSkin(null); }
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
for (const m of root.listMaterials()) m.dispose();
await doc.transform(resample({ tolerance: 1e-4 }), dedup(), prune({ keepLeaves: true }));
await io.write(out, doc);
console.log('wrote', out);
