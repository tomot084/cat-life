import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { Companion } from './interactions';

type Joint = { node: TransformNode; rest: Quaternion };
type Carry = {
  cat: Companion; joints: Map<string, Joint>; anchor: Vector3; target: Vector3;
  velocity: Vector3; sway: number; swayVelocity: number;
  headSway: number; legSway: number; tailSway: number; time: number;
  initialSupport: number; liftY: number;
  phase: 'lift' | 'carry' | 'land'; landTime: number; floor: Vector3;
  landFrom?: Vector3; complete?: () => void;
};
const names = ['spine.008', 'spine.009', 'spine.010', 'Head', 'shoulder.L', 'shoulder.R',
  'front_thigh.L', 'front_thigh.R', 'front_shin.L', 'front_shin.R', 'front_foot.L', 'front_foot.R',
  'pelvis.L', 'pelvis.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R',
  'TailBase', 'Tail2', 'Tail3', 'TailTip'];
const smooth = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };

export function createScruffCarry() {
  let active: Carry | undefined;
  function grab(cat: Companion) {
    if (active) finish();
    const joints = new Map<string, Joint>();
    for (const name of names) {
      const node = cat.nodes.find(n => n.name === name);
      if (node) joints.set(name, { node, rest: node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(node.rotation) });
    }
    // spine.010 is the short neck segment immediately behind the head.
    const neck = joints.get('spine.010')?.node;
    const anchor = neck?.getAbsolutePosition().clone() ?? cat.root.position.add(new Vector3(0, .85, 0));
    const liftY = anchor.y + .58;
    active = { cat, joints, anchor, target: new Vector3(anchor.x, liftY, anchor.z), velocity: Vector3.Zero(),
      sway: 0, swayVelocity: 0, headSway: 0, legSway: 0, tailSway: 0,
      time: 0, phase: 'lift', landTime: 0,
      floor: cat.root.position.clone(), initialSupport: cat.supportY, liftY };
    return anchor.clone();
  }
  function move(x: number, z: number, supportY: number) {
    if (!active || active.phase === 'land') return;
    const a = active, { cat, target, anchor } = a;
    // Keep the pointer over the nape. The lift stays modest for the room scale.
    target.set(x + anchor.x - cat.root.position.x, a.liftY + supportY - a.initialSupport, z + anchor.z - cat.root.position.z);
    a.floor.set(x, cat.baseY + supportY, z);
  }
  function drop(done: () => void) {
    if (!active) { done(); return; }
    active.floor.y = active.cat.baseY + active.cat.supportY;
    active.landFrom = active.cat.root.position.clone();
    active.phase = 'land'; active.landTime = 0; active.complete = done;
  }
  function finish() {
    if (!active) return;
    for (const joint of active.joints.values()) joint.node.rotationQuaternion = joint.rest.clone();
    active.cat.root.rotation.x = 0;
    active.cat.root.rotation.z = 0;
    active.cat.root.position.copyFrom(active.floor);
    const done = active.complete;
    active = undefined; done?.();
  }
  function tick(dt: number) {
    if (!active) return;
    const a = active, cat = a.cat;
    dt = Math.min(dt, .05); a.time += dt;
    if (a.phase === 'lift' && a.time > .34) a.phase = 'carry';
    const lift = smooth(a.time / .34);
    if (a.phase === 'land') a.landTime += dt;
    const pose = a.phase === 'land' ? 1 - smooth(a.landTime / .7) : lift;
    if (a.phase !== 'land') {
      const target = a.target.clone();
      if (a.phase === 'lift') target.y = a.anchor.y + (target.y - a.anchor.y) * lift;
      const acceleration = target.subtract(a.anchor).scale(90).subtract(a.velocity.scale(18));
      a.velocity.addInPlace(acceleration.scale(dt));
      a.anchor.addInPlace(a.velocity.scale(dt));
    } else {
      a.velocity.scaleInPlace(Math.exp(-12 * dt));
    }
    const desiredSway = Math.max(-.1, Math.min(.1, -a.velocity.x * .08 - a.velocity.z * .04));
    a.swayVelocity += ((desiredSway - a.sway) * 36 - a.swayVelocity * 10) * dt;
    a.swayVelocity = Math.max(-.65, Math.min(.65, a.swayVelocity));
    a.sway = Math.max(-.12, Math.min(.12, a.sway + a.swayVelocity * dt));
    a.headSway += (a.sway - a.headSway) * (1 - Math.exp(-dt * 11));
    a.legSway += (a.sway - a.legSway) * (1 - Math.exp(-dt * 7));
    a.tailSway += (a.sway - a.tailSway) * (1 - Math.exp(-dt * 4));
    const lag = a.sway * pose, headLag = a.headSway * pose;
    const legLag = a.legSway * pose, tailLag = a.tailSway * pose;
    const rotations: Record<string, [number, number, number]> = {
      'spine.008': [.08, 0, lag * .35], 'spine.009': [.1, 0, lag * .35],
      'spine.010': [.06, 0, -headLag * .3], Head: [.2, 0, -headLag * .45],
      'shoulder.L': [-.09, 0, -.04], 'shoulder.R': [-.09, 0, .04],
      'front_thigh.L': [.38, 0, -.04 + legLag * .35], 'front_thigh.R': [.38, 0, .04 + legLag * .35],
      'front_shin.L': [-.3, 0, 0], 'front_shin.R': [-.3, 0, 0],
      'front_foot.L': [.1, 0, 0], 'front_foot.R': [.1, 0, 0],
      'pelvis.L': [.04, 0, -.025], 'pelvis.R': [.04, 0, .025],
      'thigh.L': [-.27, 0, -.025 + legLag * .3], 'thigh.R': [-.27, 0, .025 + legLag * .3],
      'shin.L': [.28, 0, 0], 'shin.R': [.28, 0, 0],
      'foot.L': [-.08, 0, 0], 'foot.R': [-.08, 0, 0],
      TailBase: [.1, 0, tailLag * .4], Tail2: [.1, 0, tailLag * .65],
      Tail3: [.07, 0, tailLag * .85], TailTip: [.04, 0, tailLag],
    };
    for (const [name, joint] of a.joints) {
      const [pitch, yaw, roll] = rotations[name];
      const flutter = /front_thigh|thigh\./.test(name) ? .025 * Math.sin(a.time * 5 + (name.endsWith('.L') ? 0 : 1.4)) : 0;
      joint.node.rotationQuaternion = joint.rest.multiply(Quaternion.RotationYawPitchRoll(yaw, (pitch + flutter) * pose, roll * pose));
    }
    cat.root.rotation.x = -.46 * pose;
    cat.root.rotation.z = lag * .45;
    if (a.phase === 'land') {
      const t = smooth(a.landTime / .38);
      cat.root.position.copyFrom(Vector3.Lerp(a.landFrom!, a.floor, t));
      const absorb = Math.sin(Math.PI * Math.max(0, Math.min(1, (a.landTime - .38) / .32)));
      cat.root.position.y -= .045 * absorb;
      for (const side of ['L', 'R']) {
        for (const name of [`front_shin.${side}`, `shin.${side}`]) {
          const joint = a.joints.get(name);
          if (joint) joint.node.rotationQuaternion = joint.node.rotationQuaternion!.multiply(Quaternion.RotationYawPitchRoll(0, .14 * absorb, 0));
        }
      }
      if (a.landTime >= .7) finish();
    } else {
      const neck = a.joints.get('spine.010')?.node;
      if (neck) {
        neck.computeWorldMatrix(true);
        const error = a.anchor.subtract(neck.getAbsolutePosition());
        cat.root.position.addInPlace(error);
      }
    }
  }
  return { grab, move, drop, finish, tick, isActive: () => !!active };
}
