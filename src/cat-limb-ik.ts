import { Matrix, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { Companion } from './interactions';

const rotate = (point: Vector3, yaw: number) => Vector3.TransformNormal(point, Matrix.RotationY(yaw));
export function alignCatJoint(node: TransformNode, localAxis: Vector3, worldDirection: Vector3) {
  node.computeWorldMatrix(true);
  const target = Vector3.TransformNormal(worldDirection, node.getWorldMatrix().clone().invert()).normalize();
  const source = localAxis.normalizeToNew();
  const axis = Vector3.Cross(source, target), angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(source, target))));
  if (axis.lengthSquared() < 1e-10 || angle < 1e-6) return;
  node.rotationQuaternion = (node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation))
    .multiply(Quaternion.RotationAxis(axis.normalize(), angle)).normalize();
}
function aim(node: TransformNode, child: TransformNode, target: Vector3) {
  node.computeWorldMatrix(true); child.computeWorldMatrix(true);
  const inverse = node.getWorldMatrix().clone().invert(), origin = node.getAbsolutePosition();
  const axis = Vector3.TransformNormal(child.getAbsolutePosition().subtract(origin), inverse);
  alignCatJoint(node, axis, target.subtract(origin));
}

/** Two-link limbs with a fixed elbow/knee plane and an independently level paw. */
export function createCatLimbIK(cat: Companion) {
  const nodes = new Map(cat.nodes.map(node => [node.name, node]));
  const limbs = new Map<string, {
    upper: TransformNode; knee: TransformNode; paw: TransformNode; toe: TransformNode;
    upperLength: number; lowerLength: number; pole: Vector3; toeOffset: Vector3;
    upAxis: Vector3; forwardAxis: Vector3;
  }>();
  for (const front of [true, false]) for (const side of ['L', 'R']) {
    const upper = nodes.get(`${front ? 'front_thigh' : 'thigh'}.${side}`);
    const knee = nodes.get(`${front ? 'front_shin' : 'shin'}.${side}`);
    const paw = nodes.get(`${front ? 'front_foot' : 'foot'}.${side}`);
    const toe = nodes.get(`${front ? 'front_toe' : 'toe'}.${side}`);
    if (!upper || !knee || !paw || !toe) continue;
    for (const node of [upper, knee, paw, toe]) node.computeWorldMatrix(true);
    const a = upper.getAbsolutePosition(), b = knee.getAbsolutePosition(), c = paw.getAbsolutePosition();
    const line = c.subtract(a).normalize();
    let pole = b.subtract(a).subtract(line.scale(Vector3.Dot(b.subtract(a), line)));
    if (pole.lengthSquared() < 1e-7) pole = rotate(new Vector3(0, 0, front ? -1 : 1), cat.root.rotation.y);
    const inverse = paw.getWorldMatrix().clone().invert();
    limbs.set(`${front}:${side}`, {
      upper, knee, paw, toe, upperLength: Vector3.Distance(a, b), lowerLength: Vector3.Distance(b, c),
      pole: rotate(pole.normalize(), -cat.root.rotation.y),
      toeOffset: rotate(toe.getAbsolutePosition().subtract(c), -cat.root.rotation.y),
      upAxis: Vector3.TransformNormal(Vector3.Up(), inverse).normalize(),
      forwardAxis: Vector3.TransformNormal(rotate(Vector3.Forward(), cat.root.rotation.y), inverse).normalize(),
    });
  }
  return {
    solve(front: boolean, side: string, target: Vector3, pawYaw: number, bodyYaw: number) {
      const limb = limbs.get(`${front}:${side}`); if (!limb) return 0;
      const { upper, knee, paw, toe, upperLength: l1, lowerLength: l2 } = limb;
      // The toe-to-ankle offset follows the contact orientation, not the current body twist.
      const ankleTarget = target.subtract(rotate(limb.toeOffset, pawYaw));
      upper.computeWorldMatrix(true);
      const hip = upper.getAbsolutePosition(), delta = ankleTarget.subtract(hip), rawDistance = delta.length();
      if (rawDistance < 1e-7) return 0;
      const distance = Math.max(Math.abs(l1 - l2) + .005, Math.min(l1 + l2 - .006, rawDistance));
      const direction = delta.scale(1 / rawDistance);
      let pole = rotate(limb.pole, bodyYaw);
      pole = pole.subtract(direction.scale(Vector3.Dot(pole, direction)));
      if (pole.lengthSquared() < 1e-7) pole = Vector3.Cross(direction, rotate(Vector3.Right(), bodyYaw));
      pole.normalize();
      const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
      const bend = Math.sqrt(Math.max(0, l1 * l1 - along * along));
      const kneeTarget = hip.add(direction.scale(along)).add(pole.scale(bend));
      const reachableTarget = hip.add(direction.scale(distance));
      aim(upper, knee, kneeTarget);
      aim(knee, paw, reachableTarget);
      alignCatJoint(paw, limb.upAxis, Vector3.Up());
      alignCatJoint(paw, limb.forwardAxis, rotate(Vector3.Forward(), pawYaw));
      toe.computeWorldMatrix(true);
      return Vector3.Distance(toe.getAbsolutePosition(), target);
    },
  };
}
