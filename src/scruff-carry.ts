import { Matrix, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { Companion } from './interactions';
import { footTargets, plantFeet, relaxLegs, motionEase as ease, motionUnit as unit, type FootTarget } from './cat-motion';

type Joint = { node: TransformNode; rest: Quaternion };
type Carry = {
  cat: Companion; joints: Map<string, Joint>; anchor: Vector3; target: Vector3;
  velocity: Vector3; previousVelocity: Vector3; offset: Vector3; initialYaw: number;
  sway: number; swayVelocity: number; pitch: number; pitchVelocity: number;
  headSway: number; headPitch: number; legSway: number; legPitch: number; tailSway: number;
  time: number; initialAnchorY: number; liftFeet: FootTarget[]; initialSupport: number; liftY: number; size: number;
  phase: 'lift' | 'carry' | 'land'; landTime: number; floor: Vector3;
  landFrom?: Vector3; landingFeet?: FootTarget[]; complete?: () => void;
};
const names = ['spine.008', 'spine.009', 'spine.010', 'Head', 'Ear.L', 'Ear.R',
  'shoulder.L', 'shoulder.R', 'front_thigh.L', 'front_thigh.R', 'front_shin.L', 'front_shin.R',
  'front_foot.L', 'front_foot.R', 'pelvis.L', 'pelvis.R', 'thigh.L', 'thigh.R',
  'shin.L', 'shin.R', 'foot.L', 'foot.R', 'TailBase', 'Tail2', 'Tail3', 'TailTip'];
const clamp = (v: number, bound: number) => Math.max(-bound, Math.min(bound, v));

export function createScruffCarry() {
  let active: Carry | undefined;
  function resetJoints(a: Carry) {
    for (const joint of a.joints.values()) joint.node.rotationQuaternion = joint.rest.clone();
  }
  function grab(cat: Companion) {
    if (active) finish();
    const joints = new Map<string, Joint>();
    for (const name of names) {
      const node = cat.nodes.find(n => n.name === name);
      if (node) joints.set(name, { node, rest: node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(node.rotation) });
    }
    const neck = joints.get('spine.010')?.node;
    neck?.computeWorldMatrix(true);
    const anchor = neck?.getAbsolutePosition().clone() ?? cat.root.position.add(new Vector3(0, .85, 0));
    const size = cat.key === 'kokoro' ? 1 : .86;
    const liftY = anchor.y + .99 * size;
    active = { cat, joints, anchor, target: new Vector3(anchor.x, liftY, anchor.z),
      velocity: Vector3.Zero(), previousVelocity: Vector3.Zero(), offset: anchor.subtract(cat.root.position), initialYaw: cat.root.rotation.y,
      sway: 0, swayVelocity: 0, pitch: 0, pitchVelocity: 0, headSway: 0, headPitch: 0,
      legSway: 0, legPitch: 0, tailSway: 0, time: 0, phase: 'lift', landTime: 0, size,
      floor: cat.root.position.clone(), initialAnchorY: anchor.y, liftFeet: footTargets(cat.nodes), initialSupport: cat.supportY, liftY };
    return anchor.clone();
  }
  function move(x: number, z: number, supportY: number) {
    if (!active || active.phase === 'land') return;
    const a = active;
    const offset = Vector3.TransformNormal(a.offset, Matrix.RotationY(a.cat.root.rotation.y - a.initialYaw));
    a.target.set(x + offset.x, a.liftY + supportY - a.initialSupport, z + offset.z);
    a.floor.set(x, a.cat.baseY + supportY, z);
  }
  function drop(done: () => void) {
    if (!active) { done(); return; }
    const a = active, cat = a.cat;
    a.floor.y = cat.baseY + cat.supportY;
    a.landFrom = cat.root.position.clone();
    // Capture the paw positions of the standing landing pose on the actual support plane.
    const rotations = new Map([...a.joints].map(([name, j]) => [name, j.node.rotationQuaternion!.clone()]));
    const rootRotation = cat.root.rotation.clone();
    resetJoints(a); cat.root.rotation.x = 0; cat.root.rotation.z = 0; cat.root.position.copyFrom(a.floor);
    a.landingFeet = footTargets(cat.nodes);
    cat.root.position.copyFrom(a.landFrom); cat.root.rotation.copyFrom(rootRotation);
    for (const [name, q] of rotations) a.joints.get(name)!.node.rotationQuaternion = q;
    a.phase = 'land'; a.landTime = 0; a.complete = done;
  }
  function finish() {
    if (!active) return;
    const a = active; resetJoints(a);
    a.cat.root.rotation.x = 0; a.cat.root.rotation.z = 0;
    a.cat.root.position.copyFrom(a.floor);
    active = undefined; a.complete?.();
  }
  function tick(dt: number) {
    if (!active || dt <= 0) return;
    const a = active, cat = a.cat;
    dt = Math.min(dt, .05); a.time += dt;
    const liftDuration = cat.key === 'kokoro' ? .45 : .38;
    if (a.phase === 'lift' && a.time > liftDuration) a.phase = 'carry';
    const lift = ease(a.time / liftDuration);
    if (a.phase === 'land') a.landTime += dt;
    const lowering = a.phase === 'land' ? ease(a.landTime / .40) : 0;
    let hanging = a.phase === 'land' ? 1 - ease(a.landTime / .31) : lift;
    if (a.phase !== 'land') {
      const target = a.target.clone();
      if (a.phase === 'lift') target.y = a.initialAnchorY + (target.y - a.initialAnchorY) * lift;
      const frequency = cat.key === 'kokoro' ? 76 : 94;
      const acceleration = target.subtract(a.anchor).scale(frequency).subtract(a.velocity.scale(Math.sqrt(frequency) * 1.8));
      a.previousVelocity.copyFrom(a.velocity);
      a.velocity.addInPlace(acceleration.scale(dt)); a.anchor.addInPlace(a.velocity.scale(dt));
    } else {
      a.previousVelocity.copyFrom(a.velocity); a.velocity.scaleInPlace(Math.exp(-10 * dt));
    }
    if (a.phase !== 'land') hanging = ease((a.anchor.y - a.initialAnchorY - .14 * a.size) / (.63 * a.size));
    // Inertia is measured in the cat's heading, so orbiting the camera cannot change the response.
    const localVelocity = Vector3.TransformNormal(a.velocity, Matrix.RotationY(-cat.root.rotation.y));
    const localAcceleration = Vector3.TransformNormal(a.velocity.subtract(a.previousVelocity).scale(1 / dt), Matrix.RotationY(-cat.root.rotation.y));
    const desiredSway = clamp(-localVelocity.x * .09 - localAcceleration.x * .005, .22);
    const desiredPitch = clamp(localVelocity.z * .075 + localAcceleration.z * .004, .18);
    const spring = (target: number, value: number, velocity: number) => {
      velocity += ((target - value) * 42 - velocity * 8.5) * dt;
      return [clamp(value + velocity * dt, .26), clamp(velocity, 1.5)];
    };
    [a.sway, a.swayVelocity] = spring(desiredSway, a.sway, a.swayVelocity);
    [a.pitch, a.pitchVelocity] = spring(desiredPitch, a.pitch, a.pitchVelocity);
    const lag = (value: number, target: number, speed: number) => value + (target - value) * (1 - Math.exp(-dt * speed));
    a.headSway = lag(a.headSway, a.sway, 13); a.headPitch = lag(a.headPitch, a.pitch, 13);
    a.legSway = lag(a.legSway, a.sway, 6); a.legPitch = lag(a.legPitch, a.pitch, 6);
    a.tailSway = lag(a.tailSway, a.sway, 3.6);
    const sway = a.sway, head = a.headSway, leg = a.legSway, tail = a.tailSway;
    const breath = Math.sin(a.time * 2.8) * .013;
    const glance = Math.sin(a.time * .95) * .06 * ease((a.time - .65) / .7);
    const pawAdjust = Math.sin(a.time * 2.1) * .024;
    const absorb = a.phase === 'land' ? Math.sin(Math.PI * unit((a.landTime - .40) / .38)) : 0;
    const hindAbsorb = a.phase === 'land' ? Math.sin(Math.PI * unit((a.landTime - .47) / .33)) : 0;
    const reach = a.phase === 'land' ? Math.sin(Math.PI * unit(a.landTime / .50)) : 0;
    const rotations: Record<string, [number, number, number]> = {
      'spine.008': [.12 + breath, 0, sway * .26], 'spine.009': [.19 + breath, 0, sway * .33],
      'spine.010': [.12, 0, -head * .55], Head: [.76 - a.headPitch * .65, glance, -head * .85],
      'Ear.L': [-.035, .045, .19], 'Ear.R': [-.035, -.045, -.19],
      'shoulder.L': [-.16, 0, -.085], 'shoulder.R': [-.16, 0, .085],
      'front_thigh.L': [.40 + a.legPitch * .6, 0, -.06 + leg * .8],
      'front_thigh.R': [.44 + a.legPitch * .6 + pawAdjust, 0, .06 + leg * .8],
      'front_shin.L': [-.72, 0, 0], 'front_shin.R': [-.68, 0, 0],
      'front_foot.L': [.30, 0, .025], 'front_foot.R': [.28, 0, -.025],
      'pelvis.L': [.09, 0, -.04], 'pelvis.R': [.09, 0, .04],
      'thigh.L': [-.11 + a.legPitch * .65, 0, -.075 + leg * .65],
      'thigh.R': [-.08 + a.legPitch * .65, 0, .075 + leg * .65],
      'shin.L': [.06, 0, 0], 'shin.R': [.09, 0, 0],
      'foot.L': [-.19, 0, 0], 'foot.R': [-.17, 0, 0],
      TailBase: [-.61, 0, tail * .55], Tail2: [-.31, 0, tail * .8],
      Tail3: [.10, 0, tail], TailTip: [.17, 0, tail * 1.15],
    };
    for (const [name, joint] of a.joints) {
      let [pitch, yaw, roll] = rotations[name]; pitch *= hanging; yaw *= hanging; roll *= hanging;
      if (name.startsWith('front_thigh')) pitch += .43 * reach - .20 * absorb;
      if (name.startsWith('front_shin')) pitch += .31 * absorb;
      if (name.startsWith('thigh.')) pitch -= .20 * hindAbsorb;
      if (name.startsWith('shin.')) pitch += .39 * hindAbsorb;
      if (name === 'Head') pitch += .08 * absorb;
      joint.node.rotationQuaternion = joint.rest.multiply(Quaternion.RotationYawPitchRoll(yaw, pitch, roll));
    }
    cat.root.rotation.x = (-1.17 + a.pitch * .8) * hanging + .075 * absorb;
    cat.root.rotation.z = sway * hanging;
    relaxLegs(cat.nodes, cat.root.rotation.y, hanging, leg, a.legPitch);
    if (a.phase === 'land') {
      cat.root.position.copyFrom(Vector3.Lerp(a.landFrom!, a.floor, lowering));
      cat.root.position.y -= a.size * (.085 * absorb + .035 * hindAbsorb);
      if (a.landTime >= .40 && a.landingFeet) plantFeet(cat.nodes, a.landingFeet, 1, ease((a.landTime - .40) / .10));
      if (a.landTime >= .80) finish();
    } else {
      const neck = a.joints.get('spine.010')?.node;
      if (neck) {
        neck.computeWorldMatrix(true);
        cat.root.position.addInPlace(a.anchor.subtract(neck.getAbsolutePosition()));
        const unloading = 1 - ease((a.anchor.y - a.initialAnchorY - .07 * a.size) / (.20 * a.size));
        if (unloading > 0) plantFeet(cat.nodes, a.liftFeet, unloading, unloading);
      }
    }
  }
  return { grab, move, drop, finish, tick, isActive: () => !!active };
}
