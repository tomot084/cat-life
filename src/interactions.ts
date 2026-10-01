import { AbstractMesh, AnimationGroup, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { material } from './room';

export type InteractionKind = 'treat' | 'pet';
export interface Companion {
  key: string;
  name: string;
  root: TransformNode;
  meshes: AbstractMesh[];
  groups: AnimationGroup[];
  baseX: number;
  baseY: number;
  baseZ: number;
  action: string;
  angle: number;
}

export function createInteractions(scene: Scene, cats: Companion[], announce: (text: string) => void) {
  const pink = material(scene, 'treat packet', '#ce866e');
  const cream = material(scene, 'treat label', '#fff3d9');
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
    const heart = MeshBuilder.CreatePlane('affection-heart', { size: .25 }, scene);
    heart.material = heartMat; heart.billboardMode = Mesh.BILLBOARDMODE_ALL; heart.isPickable = false;
    heart.setEnabled(false);
    return { packet, heart };
  });
  let active: { cat: Companion; index: number; kind: InteractionKind; time: number; position: Vector3; yaw: number; group: AnimationGroup; frame: number } | undefined;
  const currentGroup = (cat: Companion) => cat.groups.find(g => g.name === cat.action)!;

  function cancel(paused: boolean) {
    if (!active) return;
    const { cat, index, position, yaw, group, frame } = active;
    cat.root.position.copyFrom(position); cat.root.rotation.y = yaw;
    effects[index].packet.setEnabled(false); effects[index].heart.setEnabled(false);
    for (const g of cat.groups) g.stop();
    group.start(true); group.goToFrame(frame); if (paused) group.pause();
    active = undefined;
  }
  function start(index: number, kind: InteractionKind, paused: boolean) {
    if (paused) { announce('再生すると、またふれあえます。'); return; }
    cancel(false);
    const cat = cats[index], group = currentGroup(cat);
    active = { cat, index, kind, time: 0, position: cat.root.position.clone(), yaw: cat.root.rotation.y, group, frame: group.getCurrentFrame() };
    for (const g of cat.groups) g.stop();
    const reaction = cat.groups.find(g => g.name === (cat.action === 'IdleSit' ? 'IdleSit' : 'IdleNorm'))!;
    reaction.start(true);
    effects[index].heart.setEnabled(true);
    effects[index].packet.setEnabled(kind === 'treat');
    announce(kind === 'treat' ? `${cat.name}にちゅーる。おいしそうだね。` : `${cat.name}をなでなで。うれしいね。`);
  }
  function tick(dt: number, paused: boolean) {
    if (!active || paused) return;
    active.time += dt;
    const { cat, index, kind, time, position, yaw } = active;
    const duration = kind === 'treat' ? 3.2 : 2.6;
    if (time >= duration) { cancel(false); announce('ふたりの時間に、もどりました。'); return; }
    const envelope = Math.sin(Math.PI * time / duration);
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    cat.root.position.copyFrom(position).addInPlace(forward.scale(kind === 'treat' ? .07 * envelope : 0));
    cat.root.position.y += .014 * envelope * Math.sin(time * 7);
    cat.root.rotation.y = yaw + (kind === 'pet' ? .055 * envelope * Math.sin(time * 4) : 0);
    const { packet, heart } = effects[index];
    packet.position.copyFrom(position).addInPlace(forward.scale(.82));
    packet.position.y = .86 + .025 * Math.sin(time * 3);
    packet.rotation.set(-.4, yaw, .15);
    heart.position.copyFrom(position).addInPlace(forward.scale(.55)); heart.position.y = 1.58 + .15 * Math.sin(Math.PI * time / duration);
    heart.scaling.setAll(.85 + .2 * Math.sin(time * 5)); heart.visibility = Math.min(1, envelope * 3);
  }
  function pause(value: boolean) {
    for (const cat of cats) {
      for (const g of cat.groups) if (g.isStarted) { if (value) g.pause(); else g.play(true); }
    }
  }
  return { start, cancel, tick, pause, isActive: (cat: Companion) => active?.cat === cat };
}
