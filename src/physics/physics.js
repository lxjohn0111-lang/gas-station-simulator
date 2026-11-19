import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const G = { STATIC: 1, PROP: 2, RAGDOLL: 4, CAR: 8, GROUND: 16 };

/**
 * cannon-es world: static colliders, dynamic props (with mesh sync and impact
 * callbacks), kinematic car bodies and ragdolls.
 */
export class Physics {
  constructor() {
    const w = new CANNON.World({ gravity: new CANNON.Vec3(0, -11, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.solver.iterations = 12;
    w.defaultContactMaterial.friction = 0.45;
    w.defaultContactMaterial.restitution = 0.12;
    w.defaultContactMaterial.contactEquationStiffness = 1e7;
    w.defaultContactMaterial.contactEquationRelaxation = 3;
    this.world = w;
    this.mats = {
      ground: new CANNON.Material('ground'),
      prop: new CANNON.Material('prop'),
      body: new CANNON.Material('body'),
      slick: new CANNON.Material('slick'),
    };
    w.addContactMaterial(new CANNON.ContactMaterial(this.mats.ground, this.mats.body, { friction: 0.6, restitution: 0.05 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.mats.ground, this.mats.prop, { friction: 0.5, restitution: 0.25 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.mats.prop, this.mats.body, { friction: 0.3, restitution: 0.2 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.mats.body, this.mats.body, { friction: 0.4, restitution: 0.0 }));

    const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: this.mats.ground, collisionFilterGroup: G.GROUND });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    w.addBody(ground);
    this.ground = ground;
    this.props = [];
    this.accum = 0;
    this.onImpact = null; // (prop, speed) => void
  }

  addStaticBox(cx, cy, cz, hx, hy, hz, rotY = 0) {
    const b = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), material: this.mats.ground, collisionFilterGroup: G.STATIC });
    b.position.set(cx, cy, cz);
    b.quaternion.setFromEuler(0, rotY, 0);
    this.world.addBody(b);
    return b;
  }

  addStaticCylinder(cx, cy, cz, r, h) {
    const b = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Cylinder(r, r, h, 10), material: this.mats.ground, collisionFilterGroup: G.STATIC });
    b.position.set(cx, cy, cz);
    this.world.addBody(b);
    return b;
  }

  /** Dynamic prop synced to a mesh. shape: 'box' | 'sphere' | 'cylinder' */
  addProp(mesh, { shape = 'box', size = null, mass = 2, radius = 0.2, height = 0.4, damping = 0.1, angDamping = 0.2, data = {}, sleep = true } = {}) {
    let s;
    if (shape === 'sphere') s = new CANNON.Sphere(radius);
    else if (shape === 'cylinder') s = new CANNON.Cylinder(radius, radius, height, 10);
    else {
      if (!size) { const bb = new THREE.Box3().setFromObject(mesh); size = bb.getSize(new THREE.Vector3()); }
      s = new CANNON.Box(new CANNON.Vec3(Math.max(0.02, size.x / 2), Math.max(0.02, size.y / 2), Math.max(0.02, size.z / 2)));
    }
    const b = new CANNON.Body({ mass, shape: s, material: this.mats.prop, linearDamping: damping, angularDamping: angDamping,
      collisionFilterGroup: G.PROP, collisionFilterMask: G.STATIC | G.PROP | G.RAGDOLL | G.CAR | G.GROUND, allowSleep: sleep, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.8 });
    b.position.copy(mesh.position);
    b.quaternion.copy(mesh.quaternion);
    const prop = { body: b, mesh, data, held: false, lastImpact: 0 };
    b.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const now = performance.now();
      if (v > 1.5 && now - prop.lastImpact > 120) { prop.lastImpact = now; if (this.onImpact) this.onImpact(prop, v, e); }
    });
    this.world.addBody(b);
    this.props.push(prop);
    return prop;
  }

  removeProp(prop) {
    this.world.removeBody(prop.body);
    const i = this.props.indexOf(prop); if (i >= 0) this.props.splice(i, 1);
  }

  /** Kinematic box for cars so ragdolls and props bounce off them. */
  addKinematicBox(hx, hy, hz) {
    const b = new CANNON.Body({ type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), collisionFilterGroup: G.CAR, collisionFilterMask: G.PROP | G.RAGDOLL });
    this.world.addBody(b);
    return b;
  }

  step(dt) {
    const fixed = 1 / 60;
    this.accum = Math.min(this.accum + dt, fixed * 4);
    while (this.accum >= fixed) { this.world.step(fixed); this.accum -= fixed; }
    for (const p of this.props) {
      if (p.held) continue;
      p.mesh.position.copy(p.body.position);
      p.mesh.quaternion.copy(p.body.quaternion);
      if (p.body.position.y < -20) { p.body.position.set(0, 2, -5); p.body.velocity.set(0, 0, 0); }
    }
  }

  /** Apply a radial push to props and ragdoll parts near a point. */
  blast(pos, radius, strength) {
    for (const b of this.world.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC) continue;
      const dx = b.position.x - pos.x, dy = b.position.y - pos.y, dz = b.position.z - pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius || d < 1e-4) continue;
      const f = strength * (1 - d / radius) * b.mass;
      b.wakeUp();
      b.applyImpulse(new CANNON.Vec3(dx / d * f, (dy / d * 0.5 + 0.5) * f, dz / d * f));
    }
  }
}

export { CANNON };
