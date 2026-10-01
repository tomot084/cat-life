import { AbstractMesh, AnimationGroup, ArcRotateCamera, DynamicTexture, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { material } from './room';
import { safeFloorPoint } from './placement';

export type InteractionKind = 'treat' | 'pet' | 'toy' | 'call';
export interface Companion {
  key: string;
  name: string;
  root: TransformNode;
  meshes: AbstractMesh[];
  nodes: TransformNode[];
  groups: AnimationGroup[];
  homeX: number;
  homeZ: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  walkX: number;
  walkZ: number;
  action: string;
  angle: number;
}
type RigState = { node: TransformNode; rotation: Quaternion; scale: Vector3 };
type Active = {
  cat: Companion; index: number; kind: InteractionKind; time: number;
  origin: Vector3; yaw: number; targetYaw: number; target: Vector3;
  group: AnimationGroup; frame: number; rig: Map<string, RigState>;
};
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const smooth = (t: number) => t * t * (3 - 2 * t);
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function createInteractions(scene: Scene, cats: Companion[], camera: ArcRotateCamera,
  announce: (text: string) => void, onMoved: (index: number, x: number, z: number) => void) {
  const pink = material(scene, 'treat packet', '#ce866e');
  const cream = material(scene, 'treat label', '#fff3d9');
  const toyMat = material(scene, 'play ball', '#ddae70');
  const texture = new DynamicTexture('affection', 64, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 64, 64); ctx.fillStyle = '#d48278';
  ctx.beginPath(); ctx.moveTo(32, 56); ctx.bezierCurveTo(-12, 27, 10, 0, 32, 18);
  ctx.bezierCurveTo(54, 0, 76, 27, 32, 56); ctx.fill(); texture.hasAlpha = true; texture.update();
  const heartMat = new StandardMaterial('heart', scene);
  heartMat.diffuseTexture = texture; heartMat.useAlphaFromDiffuseTexture = true;
  heartMat.disableLighting = true; heartMat.emissiveColor.setAll(1); heartMat.backFaceCulling = false;
  const effects = cats.map(cat => {
    const packet = new TransformNode(`${cat.key}-treat`, scene);
    const body = MeshBuilder.CreateBox('treat-packet', { width: .13, height: .4, depth: .035 }, scene);
    body.parent = packet; body.material = pink; body.isPickable = false;
    const label = MeshBuilder.CreateBox('packet-label', { width: .135, height: .15, depth: .04 }, scene);
    label.parent = packet; label.material = cream; label.isPickable = false;
    const tip = MeshBuilder.CreateSphere('treat-tip', { diameter: .065, segments: 8 }, scene);
    tip.parent = packet; tip.position.y = .22; tip.material = cream; tip.isPickable = false;
    packet.setEnabled(false);
    const heart = MeshBuilder.CreatePlane('affection-heart', { size: .32 }, scene);
    heart.material = heartMat; heart.billboardMode = Mesh.BILLBOARDMODE_ALL; heart.isPickable = false;
    heart.setEnabled(false);
    const toy = MeshBuilder.CreateSphere('play-ball', { diameter: .23, segments: 12 }, scene);
    toy.material = toyMat; toy.isPickable = false; toy.setEnabled(false);
    return { packet, heart, toy };
  });
  let active: Active | undefined;
  const currentGroup = (cat: Companion) => cat.groups.find(g => g.name === cat.action)!;
  const rigNames = ['Head', 'Ear.L', 'Ear.R', 'Eye.L', 'Eye.R', 'TailBase', 'front_foot.L'];
  function capture(cat: Companion): Map<string, RigState> {
    const rig = new Map<string, RigState>();
    for (const name of rigNames) {
      const node = cat.nodes.find(n => n.name === name);
      if (node) rig.set(name, { node, rotation: node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(node.rotation), scale: node.scaling.clone() });
    }
    return rig;
  }
  function resetRig(rig: Map<string, RigState>) {
    for (const { node, rotation, scale } of rig.values()) {
      node.rotationQuaternion = rotation.clone(); node.scaling.copyFrom(scale);
    }
  }
  function bend(rig: Map<string, RigState>, name: string, yaw: number, pitch: number, roll: number, eye = 1) {
    const joint = rig.get(name); if (!joint) return;
    joint.node.rotationQuaternion = joint.rotation.multiply(Quaternion.RotationYawPitchRoll(yaw, pitch, roll));
    joint.node.scaling.copyFrom(joint.scale); joint.node.scaling.y *= eye;
  }
  function hide(index: number) {
    effects[index].packet.setEnabled(false); effects[index].heart.setEnabled(false); effects[index].toy.setEnabled(false);
  }
  function cancel(paused: boolean, keepPosition = false) {
    if (!active) return;
    const { cat, index, origin, yaw, group, frame, rig } = active;
    resetRig(rig); hide(index);
    if (!keepPosition) { cat.root.position.copyFrom(origin); cat.root.rotation.y = yaw; }
    for (const g of cat.groups) g.stop();
    group.start(true); group.goToFrame(frame); if (paused) group.pause();
    active = undefined;
  }
  function start(index: number, kind: InteractionKind, paused: boolean) {
    if (paused) { announce('再生すると、またふれあえます。'); return; }
    cancel(false);
    const cat = cats[index], group = currentGroup(cat);
    const origin = cat.root.position.clone(), yaw = cat.root.rotation.y;
    const cameraDirection = camera.position.subtract(origin); cameraDirection.y = 0; cameraDirection.normalize();
    const targetYaw = Math.atan2(cameraDirection.x, cameraDirection.z);
    const other = cats[1 - index].root.position;
    const destination = safeFloorPoint(origin.x + cameraDirection.x * .9, origin.z + cameraDirection.z * .9, { x: other.x, z: other.z });
    const target = new Vector3(destination.x, cat.baseY, destination.z);
    const frame = group.getCurrentFrame();
    for (const g of cat.groups) g.stop();
    const reaction = cat.groups.find(g => g.name === (kind === 'call' ? 'WalkCycle' : cat.action === 'IdleSit' ? 'IdleSit' : 'IdleNorm'))!;
    reaction.start(true);
    if (kind !== 'call') { reaction.goToFrame(reaction.from); reaction.pause(); }
    active = { cat, index, kind, time: 0, origin, yaw, targetYaw, target, group, frame, rig: capture(cat) };
    effects[index].packet.setEnabled(kind === 'treat');
    effects[index].heart.setEnabled(kind === 'treat' || kind === 'pet');
    effects[index].toy.setEnabled(kind === 'toy');
    const message: Record<InteractionKind, string> = {
      treat: `${cat.name}にちゅーる。顔を寄せて、ぺろり。`,
      pet: `${cat.name}をなでなで。目を細めて、うれしそう。`,
      toy: `${cat.name}とボールで遊ぼう。`,
      call: `${cat.name}、おいで。`,
    };
    announce(message[kind]);
  }
  function tick(dt: number, paused: boolean) {
    if (!active || paused) return;
    active.time += dt;
    const { cat, index, kind, time, origin, yaw, targetYaw, target, rig } = active;
    const duration = kind === 'treat' ? 3.6 : kind === 'pet' ? 2.8 : kind === 'toy' ? 3.4 : 2.6;
    if (time >= duration) {
      if (kind === 'call') {
        cat.root.position.copyFrom(target); cat.root.rotation.y = targetYaw;
        onMoved(index, target.x, target.z); cancel(false, true);
      } else cancel(false);
      announce(kind === 'call' ? `${cat.name}がそばに来ました。` : 'ふたりの時間に、もどりました。');
      return;
    }
    const phase = time / duration, envelope = Math.sin(Math.PI * phase);
    const toward = new Vector3(Math.sin(targetYaw), 0, Math.cos(targetYaw));
    if (kind === 'call') {
      const t = smooth(phase);
      cat.root.position.copyFrom(Vector3.Lerp(origin, target, t));
      cat.root.rotation.y = yaw + angleDifference(yaw, targetYaw) * Math.min(1, t * 2);
      return;
    }
    resetRig(rig);
    const offset = kind === 'treat' ? .22 * envelope : kind === 'pet' ? .07 * envelope : 0;
    cat.root.position.copyFrom(origin).addInPlace(toward.scale(offset));
    cat.root.position.y = origin.y + (kind === 'toy' ? .018 * envelope * Math.sin(time * 9) : .01 * envelope * Math.sin(time * 7));
    cat.root.rotation.y = yaw + angleDifference(yaw, targetYaw) * (kind === 'treat' ? .86 * envelope : kind === 'toy' ? .55 * envelope : .1 * envelope);
    const nod = kind === 'treat' ? .14 * envelope + .075 * envelope * Math.sin(time * 11) : 0;
    const tilt = kind === 'pet' ? .15 * envelope : kind === 'toy' ? .09 * envelope * Math.sin(time * 5) : 0;
    bend(rig, 'Head', kind === 'toy' ? .1 * envelope * Math.sin(time * 4) : .05 * envelope, nod, tilt);
    bend(rig, 'Ear.L', 0, 0, .07 * envelope * Math.sin(time * 9));
    bend(rig, 'Ear.R', 0, 0, -.07 * envelope * Math.sin(time * 9));
    bend(rig, 'TailBase', 0, 0, .16 * envelope * Math.sin(time * 7));
    const squint = kind === 'pet' ? 1 - .16 * envelope : 1;
    bend(rig, 'Eye.L', 0, 0, 0, squint); bend(rig, 'Eye.R', 0, 0, 0, squint);
    if (kind === 'toy') bend(rig, 'front_foot.L', 0, .16 * envelope * Math.sin(time * 6), 0);
    const { packet, heart, toy } = effects[index];
    packet.position.copyFrom(origin).addInPlace(new Vector3(Math.sin(targetYaw), 0, Math.cos(targetYaw)).scale(.73));
    packet.position.y = .82 + .025 * Math.sin(time * 3); packet.rotation.set(-.4, targetYaw, .15);
    heart.position.copyFrom(cat.root.position).addInPlace(new Vector3(Math.sin(targetYaw), 0, Math.cos(targetYaw)).scale(.53));
    heart.position.y = cat.root.position.y + 1.55 + .12 * envelope;
    heart.visibility = clamp(.45 + envelope * 2, 0, 1);
    toy.position.copyFrom(origin).addInPlace(new Vector3(Math.sin(targetYaw), 0, Math.cos(targetYaw)).scale(.8));
    toy.position.x += .38 * Math.sin(time * 4) * envelope;
    toy.position.y = .14 + .16 * Math.abs(Math.sin(time * 7)) * envelope;
    toy.rotation.y += dt * 5;
  }
  function pause(value: boolean) {
    for (const cat of cats) for (const g of cat.groups) if (g.isStarted) {
      if (value || (active?.cat === cat && active.kind !== 'call')) g.pause(); else g.play(true);
    }
  }
  return { start, cancel, tick, pause, isActive: (cat: Companion) => active?.cat === cat };
}
