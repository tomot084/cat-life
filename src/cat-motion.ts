import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

export const motionUnit = (t: number) => Math.max(0, Math.min(1, t));
export const motionEase = (t: number) => { const u = motionUnit(t); return u * u * (3 - 2 * u); };
const pulse = (t: number, rise: number, fall: number, end: number) =>
  motionEase(t / rise) * (1 - motionEase((t - fall) / (end - fall)));
export type JumpTiming = { prep: number; flight: number; settle: number; velocity: number; gravity: number; duration: number };
export function jumpTiming(height: number, larger: boolean): JumpTiming {
  const gravity = larger ? 11.8 : 13.1;
  const apex = height > 0 ? .19 + Math.min(.13, height * .06) : .075;
  const velocity = Math.sqrt(2 * gravity * (Math.max(0, height) + apex));
  const flight = (velocity + Math.sqrt(velocity * velocity - 2 * gravity * height)) / gravity;
  const prep = height > 0 ? (larger ? .47 : .40) : (larger ? .38 : .32);
  const settle = larger ? .40 : .34;
  return { prep, flight, settle, velocity, gravity, duration: prep + flight + settle };
}
export function jumpPose(time: number, timing: JumpTiming, up: boolean) {
  const p = motionUnit((time - timing.prep) / timing.flight);
  const prep = motionUnit(time / timing.prep);
  const land = motionUnit((time - timing.prep - timing.flight) / timing.settle);
  const air = time >= timing.prep && time < timing.prep + timing.flight;
  const compress = motionEase((prep - .27) / .56) * (1 - motionEase((prep - .84) / .16));
  const launch = time < timing.prep ? motionEase((prep - .78) / .22) : pulse(p, .10, .14, .35);
  const tuck = air ? pulse(p, .37, .52, .82) : 0;
  const reach = air ? motionEase((p - (up ? .52 : .24)) / (up ? .32 : .35)) : 1 - motionEase(land / .74);
  const frontAbsorb = Math.sin(Math.PI * motionUnit(land / .76)) * (time >= timing.prep + timing.flight ? 1 : 0);
  const hindAbsorb = Math.sin(Math.PI * motionUnit((land - .16) / .84)) * (time >= timing.prep + timing.flight ? 1 : 0);
  const look = motionEase(prep / .28) * (1 - motionEase(land / .7));
  return { prep, p, land, air, compress, launch, tuck, reach, frontAbsorb, hindAbsorb, look };
}

export type FootTarget = { side: 'L' | 'R'; front: boolean; point: Vector3 };
export function footTargets(nodes: TransformNode[]): FootTarget[] {
  const result: FootTarget[] = [];
  for (const front of [true, false]) for (const side of ['L', 'R'] as const) {
    const node = nodes.find(n => n.name === `${front ? 'front_toe' : 'toe'}.${side}`);
    if (!node) continue;
    node.computeWorldMatrix(true);
    result.push({ side, front, point: node.getAbsolutePosition().clone() });
  }
  return result;
}

/** Small bounded CCD corrections hold paw pivots without stretching any bone. */
export function plantFeet(nodes: TransformNode[], targets: FootTarget[], frontWeight: number, hindWeight: number) {
  for (const target of targets) {
    const weight = target.front ? frontWeight : hindWeight;
    if (weight <= 0) continue;
    const end = nodes.find(n => n.name === `${target.front ? 'front_toe' : 'toe'}.${target.side}`);
    if (!end) continue;
    const chain = target.front ? ['front_foot', 'front_shin', 'front_thigh'] : ['foot', 'shin', 'thigh'];
    end.computeWorldMatrix(true);
    const goal = Vector3.Lerp(end.getAbsolutePosition(), target.point, motionUnit(weight));
    for (let pass = 0; pass < 5; pass++) for (const name of chain) {
      const node = nodes.find(n => n.name === `${name}.${target.side}`);
      if (!node) continue;
      node.computeWorldMatrix(true); end.computeWorldMatrix(true);
      const pivot = node.getAbsolutePosition();
      const inverse = node.getWorldMatrix().clone().invert();
      // Work in the joint frame: glTF's reflected root must not reverse the correction.
      const from = Vector3.TransformNormal(end.getAbsolutePosition().subtract(pivot), inverse);
      const to = Vector3.TransformNormal(goal.subtract(pivot), inverse);
      if (from.lengthSquared() < 1e-8 || to.lengthSquared() < 1e-8) continue;
      from.normalize(); to.normalize();
      const axis = Vector3.Cross(from, to), angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(from, to))));
      if (axis.lengthSquared() < 1e-10 || angle < .001) continue;
      const correction = Quaternion.RotationAxis(axis.normalize(), Math.min(.19, angle));
      const local = node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation);
      node.rotationQuaternion = local.multiply(correction).normalize();
      node.computeWorldMatrix(true); end.computeWorldMatrix(true);
    }
  }
}

function alignSegment(nodes: TransformNode[], name: string, childName: string, direction: Vector3, weight: number, limit = 1.25) {
  const node = nodes.find(n => n.name === name), child = nodes.find(n => n.name === childName);
  if (!node || !child) return;
  node.computeWorldMatrix(true); child.computeWorldMatrix(true);
  const inverse = node.getWorldMatrix().clone().invert();
  const from = Vector3.TransformNormal(child.getAbsolutePosition().subtract(node.getAbsolutePosition()), inverse).normalize();
  const to = Vector3.TransformNormal(direction, inverse).normalize(), axis = Vector3.Cross(from, to);
  if (axis.lengthSquared() < 1e-10) return;
  const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(from, to))));
  const correction = Quaternion.RotationAxis(axis.normalize(), Math.min(limit, angle) * motionUnit(weight));
  node.rotationQuaternion = (node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation)).multiply(correction).normalize();
}

/** Settle a free limb toward gravity while retaining the elbow bend and bone lengths. */
export function relaxLegs(nodes: TransformNode[], heading: number, weight: number, sway: number, pitch: number) {
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  const lateral = new Vector3(Math.cos(heading), 0, -Math.sin(heading));
  for (const front of [false, true]) for (const side of ['L', 'R']) {
    const segments = front ? [['front_thigh', 'front_shin', .23], ['front_shin', 'front_foot', -.40]] as const
      : [['thigh', 'shin', -.025], ['shin', 'foot', .085], ['foot', 'toe', .045]] as const;
    for (const [name, childName, offset] of segments) {
      const direction = new Vector3(0, -1, 0).add(forward.scale(offset + pitch * .55)).add(lateral.scale(sway * .60));
      alignSegment(nodes, `${name}.${side}`, `${childName}.${side}`, direction, weight * (front ? .78 : .94), front ? 1.25 : 1.9);
    }
  }
}

export function reachFrontFeet(nodes: TransformNode[], heading: number, weight: number) {
  const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  for (const side of ['L', 'R']) {
    alignSegment(nodes, `front_thigh.${side}`, `front_shin.${side}`, new Vector3(0, -1, 0).add(forward.scale(.62)), weight * .94);
    alignSegment(nodes, `front_shin.${side}`, `front_foot.${side}`, new Vector3(0, -1, 0).add(forward.scale(.16)), weight);
  }
}
