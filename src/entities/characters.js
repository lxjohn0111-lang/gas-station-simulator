import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Ragdoll } from '../physics/ragdoll.js';
import { pick, rand, chance, easeInOut, clamp } from '../core/utils.js';

const canon = (name) => name.replace(/^mixamorig[:_]?/, '');

function collectBones(root) {
  const map = {};
  root.traverse((o) => { if (o.isBone && !map[canon(o.name)]) map[canon(o.name)] = o; });
  return map;
}

/** Samples world rotations of a source rig while playing a clip. */
function sampleSource(scene, clip, fps = 30) {
  const bones = collectBones(scene);
  scene.updateMatrixWorld(true);
  const rest = {};
  for (const [n, b] of Object.entries(bones)) rest[n] = { wq: b.getWorldQuaternion(new THREE.Quaternion()), wp: b.getWorldPosition(new THREE.Vector3()), lq: b.quaternion.clone(), lp: b.position.clone() };
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(n);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(clip.duration, i / fps);
    times[i] = t;
    mixer.setTime(t);
    scene.updateMatrixWorld(true);
    const f = {};
    for (const [nm, b] of Object.entries(bones)) f[nm] = b.getWorldQuaternion(new THREE.Quaternion());
    f.__hips = bones.Hips ? bones.Hips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    frames.push(f);
  }
  action.stop();
  mixer.uncacheRoot(scene);
  for (const [nm, b] of Object.entries(bones)) { b.quaternion.copy(rest[nm].lq); b.position.copy(rest[nm].lp); }
  scene.updateMatrixWorld(true);
  return { name: clip.name, times, frames, rest, hipsY: rest.Hips ? rest.Hips.wp.y : 1 };
}

/** Bakes a sampled source animation onto a target rig (world-delta retargeting). */
function bakeToTarget(sample, scene, name, { hipsMotion = true, inPlace = true } = {}) {
  const bones = collectBones(scene);
  scene.updateMatrixWorld(true);
  const rest = new Map();
  for (const b of Object.values(bones)) rest.set(b, { wq: b.getWorldQuaternion(new THREE.Quaternion()), lq: b.quaternion.clone() });
  const order = [];
  scene.traverse((o) => { if (o.isBone && sample.rest[canon(o.name)] && bones[canon(o.name)] === o) order.push(o); });
  const hips = bones.Hips;
  const tgtHipsY = hips ? hips.getWorldPosition(new THREE.Vector3()).y : 1;
  const scale = tgtHipsY / Math.max(0.01, sample.hipsY);
  const parentRestWorld = hips ? hips.parent.matrixWorld.clone() : null;
  const parentInv = parentRestWorld ? parentRestWorld.clone().invert() : null;
  const hipsRestWorld = hips ? hips.getWorldPosition(new THREE.Vector3()) : null;
  const values = new Map(order.map((b) => [b, new Float32Array(sample.frames.length * 4)]));
  const hipVals = new Float32Array(sample.frames.length * 3);
  const tmp = new THREE.Quaternion(), inv = new THREE.Quaternion();
  const sceneQ = scene.getWorldQuaternion(new THREE.Quaternion());
  for (let i = 0; i < sample.frames.length; i++) {
    const f = sample.frames[i];
    const world = new Map();
    const worldOf = (o) => {
      if (world.has(o)) return world.get(o);
      if (!o.isBone) { const q = o.getWorldQuaternion(new THREE.Quaternion()); world.set(o, q); return q; }
      const r = rest.get(o);
      const q = worldOf(o.parent).clone().multiply(r ? r.lq : o.quaternion);
      world.set(o, q);
      return q;
    };
    for (const b of order) {
      const nm = canon(b.name);
      const sr = sample.rest[nm];
      const delta = tmp.copy(f[nm]).multiply(inv.copy(sr.wq).invert());
      const wt = delta.clone().multiply(rest.get(b).wq);
      world.set(b, wt);
      const pw = worldOf(b.parent);
      const local = pw.clone().invert().multiply(wt);
      values.get(b).set([local.x, local.y, local.z, local.w], i * 4);
    }
    if (hips) {
      const d = f.__hips.clone().sub(sample.rest.Hips.wp).multiplyScalar(scale);
      if (inPlace) { d.x = 0; d.z = 0; }
      if (!hipsMotion) d.set(0, 0, 0);
      const wp = hipsRestWorld.clone().add(d).applyMatrix4(parentInv);
      hipVals.set([wp.x, wp.y, wp.z], i * 3);
    }
  }
  const tracks = [];
  for (const b of order) tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', sample.times, values.get(b)));
  if (hips) tracks.push(new THREE.VectorKeyframeTrack(hips.name + '.position', sample.times, hipVals));
  void sceneQ;
  return new THREE.AnimationClip(name, sample.times[sample.times.length - 1], tracks);
}

// --------------------------------------------------------------------------
const SKIN_TONES = [0xffe0c4, 0xf1c7a1, 0xd9a07a, 0xb07650, 0x8a5a3a, 0x5e3b24];
const CLOTH = [0x2b4c7e, 0x7a1f1f, 0x2f5d3a, 0x444444, 0xd8c8a8, 0x6a3e8a, 0xc96a1a, 0x1f1f1f, 0xe8e8e8, 0x3a8fb7, 0xb03060, 0x8c7a5a];

export class CharacterLibrary {
  async load(loader, onProgress) {
    const base = './assets/models/';
    const files = ['michelle', 'cowboy', 'biker', 'anims', 'fox', 'bird'];
    const res = {};
    let done = 0;
    await Promise.all(files.map((f) => new Promise((resolve, reject) => {
      loader.load(base + f + '.glb', (g) => { res[f] = g; done++; onProgress && onProgress(done / files.length); resolve(); }, undefined, (e) => { console.error('model load failed', f, e); res[f] = null; done++; resolve(); });
    })));
    this.raw = res;
    this.templates = {};
    const xbot = res.anims;
    const srcSamples = {};
    if (xbot) {
      for (const clip of xbot.animations) srcSamples[clip.name] = sampleSource(xbot.scene, clip);
    }
    const michelleSamba = res.michelle && res.michelle.animations.find((a) => a.name === 'SambaDance');
    const sambaSample = michelleSamba ? sampleSource(res.michelle.scene, michelleSamba) : null;

    const mk = (key, gltf, female, height) => {
      if (!gltf) return;
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const h = box.max.y - box.min.y;
      const clips = {};
      const map = { idle: 'idle', walk: 'walk', run: 'run', agree: 'agree', headShake: 'headShake', sad: 'sad_pose', sneak: 'sneak_pose' };
      for (const [k, src] of Object.entries(map)) if (srcSamples[src]) clips[k] = bakeToTarget(srcSamples[src], scene, k, { inPlace: true });
      if (key === 'michelle' && michelleSamba) clips.dance = michelleSamba;
      else if (sambaSample) clips.dance = bakeToTarget(sambaSample, scene, 'dance', { inPlace: false });
      this.templates[key] = { scene, clips, female, scale: height / h, minY: box.min.y };
    };
    mk('michelle', res.michelle, true, 1.66);
    mk('cowboy', res.cowboy, false, 1.83);
    mk('biker', res.biker, false, 1.8);
    this.kinds = Object.keys(this.templates);
    return this;
  }

  create(kind, opts = {}) {
    if (!this.templates[kind]) kind = this.kinds[0];
    return new Character(this.templates[kind], kind, opts);
  }
}

/** A skinned, animated, ragdoll-capable person. */
export class Character {
  constructor(tpl, kind, opts) {
    this.kind = kind;
    this.female = tpl.female;
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(tpl.scene);
    const hs = opts.heightScale ?? rand(0.94, 1.06);
    this.model.scale.multiplyScalar(tpl.scale * hs);
    this.model.position.y = -tpl.minY * tpl.scale * hs;
    this.root.add(this.model);
    this.height = (this.female ? 1.66 : 1.82) * hs;
    this.meshes = [];
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        this.meshes.push(o);
      }
    });
    this.applyLook(opts);
    this.bones = collectBones(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [k, clip] of Object.entries(tpl.clips)) {
      const a = this.mixer.clipAction(clip);
      if (['agree', 'headShake'].includes(k)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; }
      this.actions[k] = a;
    }
    this.current = null;
    this.play('idle', 0);
    this.ragdoll = null;
    this.blend = null;
    this.speaking = 0;
    this.morphMeshes = this.meshes.filter((m) => m.morphTargetDictionary && m.morphTargetDictionary.mouthOpen !== undefined);
    this.mixer.addEventListener('finished', (e) => { if (this.onOneShotDone) this.onOneShotDone(e.action); });
    this.reach = 0; this.reachT = 0;
    this.lookAtTarget = null;
  }

  applyLook(opts) {
    const skin = new THREE.Color(opts.skin ?? pick(SKIN_TONES));
    const top = new THREE.Color(opts.top ?? pick(CLOTH));
    const bottom = new THREE.Color(opts.bottom ?? pick(CLOTH));
    for (const m of this.meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const n = (mat.name || '').toLowerCase();
        mat.envMapIntensity = 0.7;
        if (this.kind === 'cowboy') {
          if (n.includes('skin') || n.includes('body')) mat.color.copy(skin).multiplyScalar(1.05);
          else if (n.includes('top')) mat.color.copy(top).lerp(new THREE.Color(1, 1, 1), 0.35);
          else if (n.includes('bottom')) mat.color.copy(bottom).lerp(new THREE.Color(1, 1, 1), 0.3);
          else if (n.includes('headwear')) { mat.color.setHSL(0.08, 0.3, rand(0.35, 0.9)); if (chance(0.3)) m.visible = false; }
          else if (n.includes('beard')) { if (chance(0.4)) m.visible = false; }
        } else if (this.kind === 'biker') {
          if (!n.includes('visor')) mat.color.copy(top).lerp(new THREE.Color(1, 1, 1), 0.45);
        } else if (this.kind === 'michelle') {
          mat.color.setHSL(rand(0, 1), 0.12, rand(0.85, 1));
        }
      }
    }
  }

  /** Attach a prop (cap, sunglasses, phone) to a bone, sized in metres. */
  attach(boneName, obj, offset = new THREE.Vector3(), rot = new THREE.Euler()) {
    const b = this.bones[boneName];
    if (!b) return null;
    this.model.updateMatrixWorld(true);
    const ws = b.getWorldScale(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.scale.setScalar(1 / ws.x);
    holder.position.copy(offset).multiplyScalar(1 / ws.x);
    holder.rotation.copy(rot);
    holder.add(obj);
    b.add(holder);
    return holder;
  }

  play(name, fade = 0.25, timeScale = 1) {
    const a = this.actions[name] || this.actions.idle;
    if (!a) return;
    if (this.current === a) { a.timeScale = timeScale; return; }
    a.reset(); a.timeScale = timeScale; a.enabled = true; a.setEffectiveWeight(1);
    if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, false); else if (this.current) this.current.stop();
    a.play();
    this.current = a;
    this.currentName = name;
  }
  setTimeScale(s) { if (this.current) this.current.timeScale = s; }

  get isRagdoll() { return !!(this.ragdoll && this.ragdoll.active); }

  /** Go limp. velocity: current motion, impulse: extra kick (world). */
  startRagdoll(physics, velocity, impulse, part = 'torso', spin = null) {
    if (this.isRagdoll) { if (impulse) this.ragdoll.applyImpulse(impulse, part); return; }
    this.blend = null;
    this.model.updateMatrixWorld(true);
    this.ragdoll = new Ragdoll(physics, this.bones);
    this.ragdoll.start(velocity, impulse, part, spin);
    if (this.current) this.current.stop();
    this.current = null;
  }

  /** Finish ragdoll: move root to where the body lies and blend up to idle. */
  endRagdoll(groundY = 0) {
    if (!this.ragdoll) return;
    const pelvis = this.ragdoll.pelvisPos(new THREE.Vector3());
    const head = this.ragdoll.headPos(new THREE.Vector3());
    const hips = this.bones.Hips;
    this.model.updateMatrixWorld(true);
    const hipsWQ = hips.getWorldQuaternion(new THREE.Quaternion());
    const hipsWP = hips.getWorldPosition(new THREE.Vector3());
    this.ragdoll.stop();
    this.ragdoll = null;
    // new root transform
    const yaw = Math.atan2(head.x - pelvis.x, head.z - pelvis.z);
    this.root.position.set(pelvis.x, groundY, pelvis.z);
    this.root.rotation.y = yaw + Math.PI;
    this.root.updateMatrixWorld(true);
    hips.parent.updateWorldMatrix(true, false);
    const pq = hips.parent.getWorldQuaternion(new THREE.Quaternion());
    hips.quaternion.copy(pq.invert().multiply(hipsWQ));
    hips.position.copy(hips.parent.worldToLocal(hipsWP));
    const from = new Map();
    for (const b of Object.values(this.bones)) from.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
    this.blend = { from, t: 0, dur: 0.9 };
    this.play('idle', 0);
  }

  speak(sec = 0.8) { this.speaking = sec; }

  update(dt) {
    if (this.isRagdoll) { this.ragdoll.update(dt); return; }
    this.mixer.update(dt);
    if (this.blend) {
      this.blend.t += dt;
      const k = easeInOut(clamp(this.blend.t / this.blend.dur, 0, 1));
      for (const [b, f] of this.blend.from) {
        b.quaternion.slerpQuaternions(f.q, b.quaternion.clone(), k);
        if (b === this.bones.Hips) b.position.lerpVectors(f.p, b.position.clone(), k);
      }
      if (this.blend.t >= this.blend.dur) this.blend = null;
    }
    // procedural reach (taking items from shelves / paying)
    if (this.reach > 0 || this.reachT > 0) {
      this.reachT = Math.max(0, this.reachT + (this.reach > 0 ? dt * 4 : -dt * 3));
      this.reach = Math.max(0, this.reach - dt);
      const k = Math.min(1, this.reachT);
      const arm = this.bones.RightArm, fore = this.bones.RightForeArm;
      if (arm) arm.rotateX(-k * 1.1);
      if (fore) fore.rotateX(-k * 0.4);
    }
    // talking mouth
    if (this.speaking > 0) {
      this.speaking -= dt;
      const v = this.speaking > 0 ? (Math.sin(performance.now() * 0.03) * 0.5 + 0.5) * 0.8 : 0;
      for (const m of this.morphMeshes) m.morphTargetInfluences[m.morphTargetDictionary.mouthOpen] = v;
    }
    // head look-at (subtle)
    if (this.lookAtTarget && this.bones.Head) {
      const head = this.bones.Head;
      const hp = head.getWorldPosition(new THREE.Vector3());
      const dir = this.lookAtTarget.clone().sub(hp);
      const local = dir.applyQuaternion(this.root.quaternion.clone().invert());
      const yaw = clamp(Math.atan2(local.x, local.z), -0.9, 0.9);
      const pitch = clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.4, 0.4);
      head.rotateY(yaw * 0.6); head.rotateX(pitch * 0.5);
    }
  }

  dispose() {
    if (this.ragdoll) this.ragdoll.stop();
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    for (const m of this.meshes) { const mats = Array.isArray(m.material) ? m.material : [m.material]; mats.forEach((x) => x.dispose()); }
  }
}

// ---------------------------------------------------------------- accessories
export function makeCap(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.scale.set(1, 0.8, 1.1);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), mat);
  brim.scale.set(0.9, 1, 1.0); brim.position.set(0, 0.005, 0.075);
  g.add(dome, brim);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeSunglasses() {
  const g = new THREE.Group();
  const lens = new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.9, roughness: 0.05 });
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.03, 0.008), lens); l.position.set(s * 0.033, 0, 0); g.add(l); }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.006, 0.006), lens); bar.position.y = 0.012; g.add(bar);
  return g;
}
export function makePhone() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.009), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x3a7bd5, emissiveIntensity: 0.5, roughness: 0.2 }));
  return m;
}
