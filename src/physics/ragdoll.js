import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G } from './physics.js';

// part, start bone, end bone, radius, parent part, cone angle, twist angle, mass
const PARTS = [
  ['pelvis', 'Hips', 'Spine1', 0.14, null, 0, 0, 10],
  ['torso', 'Spine1', 'Neck', 0.15, 'pelvis', 0.45, 0.35, 14],
  ['head', 'Head', 'HeadTop_End', 0.11, 'torso', 0.7, 0.7, 4.5],
  ['lUpperArm', 'LeftArm', 'LeftForeArm', 0.055, 'torso', 1.5, 0.9, 2.5],
  ['lForeArm', 'LeftForeArm', 'LeftHand', 0.045, 'lUpperArm', 1.35, 0.4, 1.6],
  ['rUpperArm', 'RightArm', 'RightForeArm', 0.055, 'torso', 1.5, 0.9, 2.5],
  ['rForeArm', 'RightForeArm', 'RightHand', 0.045, 'rUpperArm', 1.35, 0.4, 1.6],
  ['lThigh', 'LeftUpLeg', 'LeftLeg', 0.08, 'pelvis', 1.1, 0.35, 7],
  ['lShin', 'LeftLeg', 'LeftFoot', 0.06, 'lThigh', 1.25, 0.2, 4],
  ['rThigh', 'RightUpLeg', 'RightLeg', 0.08, 'pelvis', 1.1, 0.35, 7],
  ['rShin', 'RightLeg', 'RightFoot', 0.06, 'rThigh', 1.25, 0.2, 4],
];

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Builds a cannon-es ragdoll that matches the current pose of a skinned
 * character and drives the skeleton from the simulated bodies.
 */
export class Ragdoll {
  constructor(physics, bones) {
    this.physics = physics;
    this.bones = bones; // canonical name -> THREE.Bone
    this.parts = [];
    this.constraints = [];
    this.active = false;
  }

  start(velocity, impulse = null, impulsePart = 'torso', spin = null) {
    const world = this.physics.world;
    const byName = {};
    for (const [name, sb, eb, r, parent, cone, twist, mass] of PARTS) {
      const bone = this.bones[sb];
      if (!bone) continue;
      const a = bone.getWorldPosition(new THREE.Vector3());
      let b;
      if (this.bones[eb]) b = this.bones[eb].getWorldPosition(new THREE.Vector3());
      else {
        // fallback: extend along bone direction (e.g. missing HeadTop_End)
        const parentPos = bone.parent.getWorldPosition(new THREE.Vector3());
        b = a.clone().add(a.clone().sub(parentPos).normalize().multiplyScalar(0.2));
      }
      const dir = b.clone().sub(a);
      let len = dir.length();
      if (len < 0.04) { len = 0.1; dir.set(0, 1, 0); }
      dir.normalize();
      const half = Math.max(0.05, len / 2);
      const shape = name === 'head' ? new CANNON.Sphere(r) : new CANNON.Box(new CANNON.Vec3(r, half, r * (name === 'torso' || name === 'pelvis' ? 0.75 : 1)));
      const body = new CANNON.Body({
        mass, shape, material: this.physics.mats.body,
        linearDamping: 0.08, angularDamping: 0.25,
        collisionFilterGroup: G.RAGDOLL, collisionFilterMask: G.STATIC | G.PROP | G.CAR | G.GROUND | G.RAGDOLL,
        allowSleep: true, sleepSpeedLimit: 0.2, sleepTimeLimit: 0.6,
      });
      const center = a.clone().addScaledVector(dir, half);
      body.position.set(center.x, center.y, center.z);
      const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
      body.quaternion.set(q.x, q.y, q.z, q.w);
      if (velocity) body.velocity.set(velocity.x, velocity.y, velocity.z);
      const boneWorldQ = bone.getWorldQuaternion(new THREE.Quaternion());
      const offsetQ = q.clone().invert().multiply(boneWorldQ);
      const offsetP = a.clone().sub(center).applyQuaternion(q.clone().invert());
      world.addBody(body);
      const part = { name, bone, body, offsetQ, offsetP, start: a, dir, half };
      this.parts.push(part);
      byName[name] = part;
      if (parent && byName[parent]) {
        const pb = byName[parent].body;
        const pivotA = pb.pointToLocalFrame(new CANNON.Vec3(a.x, a.y, a.z));
        const pivotB = body.pointToLocalFrame(new CANNON.Vec3(a.x, a.y, a.z));
        const axisA = pb.vectorToLocalFrame(new CANNON.Vec3(dir.x, dir.y, dir.z));
        const c = new CANNON.ConeTwistConstraint(pb, body, { pivotA, pivotB, axisA, axisB: new CANNON.Vec3(0, 1, 0), angle: cone, twistAngle: twist, collideConnected: false, maxForce: 1e6 });
        world.addConstraint(c);
        this.constraints.push(c);
      }
    }
    this.byName = byName;
    if (impulse && byName[impulsePart]) {
      const b = byName[impulsePart].body;
      b.applyImpulse(new CANNON.Vec3(impulse.x, impulse.y, impulse.z));
    }
    if (spin) for (const p of this.parts) p.body.angularVelocity.set(spin.x, spin.y, spin.z);
    this.active = true;
    this.time = 0;
    this.restTime = 0;
  }

  applyImpulse(imp, partName = 'torso') {
    const p = this.byName && this.byName[partName];
    if (p) { p.body.wakeUp(); p.body.applyImpulse(new CANNON.Vec3(imp.x, imp.y, imp.z)); }
  }

  /** Writes body transforms back to the skeleton. */
  sync() {
    for (const p of this.parts) {
      const b = p.body;
      _q1.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      const worldQ = _q2.copy(_q1).multiply(p.offsetQ);
      const parent = p.bone.parent;
      parent.updateWorldMatrix(true, false);
      const pq = parent.getWorldQuaternion(new THREE.Quaternion());
      p.bone.quaternion.copy(pq.invert().multiply(worldQ));
      if (p.name === 'pelvis') {
        _v1.copy(p.offsetP).applyQuaternion(_q1).add(_v2.set(b.position.x, b.position.y, b.position.z));
        p.bone.position.copy(parent.worldToLocal(_v1));
      }
      p.bone.updateMatrix();
    }
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.sync();
    let maxV = 0;
    for (const p of this.parts) maxV = Math.max(maxV, p.body.velocity.length());
    if (maxV < 0.35) this.restTime += dt; else this.restTime = 0;
  }

  get settled() { return this.active && ((this.restTime > 0.9 && this.time > 1.4) || this.time > 7); }

  pelvisPos(out = new THREE.Vector3()) {
    const b = this.byName.pelvis.body; return out.set(b.position.x, b.position.y, b.position.z);
  }
  headPos(out = new THREE.Vector3()) {
    const b = (this.byName.head || this.byName.torso).body; return out.set(b.position.x, b.position.y, b.position.z);
  }
  speed() { const b = this.byName.pelvis.body; return b.velocity.length(); }

  stop() {
    const world = this.physics.world;
    for (const c of this.constraints) world.removeConstraint(c);
    for (const p of this.parts) world.removeBody(p.body);
    this.parts = []; this.constraints = []; this.active = false;
  }
}
