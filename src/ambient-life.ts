import { Color3, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { footTargets, plantFeet, reachFrontFeet, jumpTiming, jumpPose, type FootTarget, type JumpTiming } from './cat-motion';
import { createSurfaceTraversal } from './surface-traversal';
import { TOWER_SURFACES, towerSurfaceAt, type CatSurface } from './tower-surfaces';
import { catProportions } from './cat-proportions';
import type { Companion } from './interactions';
import { LIFE_SPOTS, floorSegmentClear, planFloorRoute, safeFloorPoint, TOWER_APPROACH, TOWER_PERCH, WINDOW_APPROACH, WINDOW_PERCH, type FloorPoint } from './placement';

export type DailyActivity = 'rest' | 'wander' | 'sit' | 'doze' | 'eat' | 'drink' | 'ball' | 'mouse' | 'tower' | 'window';
type Stage = 'manual' | 'wait' | 'walk' | 'act' | 'jump-up' | 'jump-down';
type JointPose = { node: TransformNode; rotation: Quaternion; scale: Vector3 };
type Actor = {
  stage: Stage; activity: DailyActivity; time: number; duration: number; sequence: number;
  route: FloorPoint[]; waypoint: number; pose?: Map<string, JointPose>;
  actOrigin?: Vector3;
  jumpFrom?: Vector3; jumpTo?: Vector3; jumpTiming?: JumpTiming; jumpFeet?: FootTarget[]; landingFeet?: FootTarget[];
  afterLanding?: () => void; blocked: number; traversal?: ReturnType<typeof createSurfaceTraversal>; surfacePath?: CatSurface[];
  toyPhase?: 'observe' | 'aim' | 'strike' | 'track' | 'chase' | 'recover';
  toyPattern?: number; strikeOrigin?: Vector3; toyTime?: number; strikes?: number; paw?: string; contact?: boolean; jumpYaw?: number; landingYaw?: number; jumpFacingFrom?: number; prepOrigin?: Vector3; poseWeight?: number; jumpSupport?: number;
};
const routines: DailyActivity[][] = [
  ['wander', 'eat', 'tower', 'doze', 'ball', 'drink', 'window', 'mouse', 'sit'],
  ['sit', 'ball', 'drink', 'mouse', 'wander', 'window', 'doze', 'tower', 'eat'],
];
const labels: Record<DailyActivity, string> = {
  rest: 'のんびり', wander: 'おさんぽ', sit: 'おすわり', doze: 'うとうと',
  eat: 'ごはん', drink: 'お水', ball: 'ボール遊び', mouse: 'ねずみ遊び', tower: 'タワーの上', window: '窓辺でひなたぼっこ',
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const unit = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => smooth(unit(t));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const angle = (from: FloorPoint, to: FloorPoint) => Math.atan2(to.x - from.x, to.z - from.z);

export function createAmbientLife(scene: Scene, cats: Companion[],
  play: (cat: Companion, action: string) => void,
  onMoved: (index: number, x: number, z: number) => void,
  onActivity: (index: number, activity: DailyActivity, label: string) => void,
  isInteracting: (index: number) => boolean) {
  const actors: Actor[] = cats.map(() => ({ stage: 'manual', activity: 'rest', time: 0,
    duration: 0, sequence: 0, route: [], waypoint: 0, blocked: 0 }));
  const ball = scene.getMeshByName('toy-ball'), stripe = scene.getMeshByName('ball-stripe');
  const mouse = scene.getMeshByName('felt-mouse');
  const mouseParts = scene.meshes.filter(mesh => ['felt-mouse', 'mouse-ear', 'mouse-tail'].includes(mesh.name));
  const ballHome = ball?.position.clone();
  const mouseHome = mouse?.position.clone();
  const mousePartHomes = mouseParts.map(part => part.position.clone());
  const rippleMaterial = new StandardMaterial('water ripple', scene);
  rippleMaterial.emissiveColor = Color3.FromHexString('#b9e0dc');
  rippleMaterial.diffuseColor = Color3.FromHexString('#b9e0dc');
  rippleMaterial.alpha = .55;
  const ripples = cats.map(cat => {
    const ripple = MeshBuilder.CreateTorus(`${cat.key}-water-ripple`, { diameter: .34, thickness: .008, tessellation: 28 }, scene);
    ripple.position.set(3.62, .18, 2.35); ripple.material = rippleMaterial;
    ripple.isPickable = false; ripple.setEnabled(false);
    return ripple;
  });
  const toyVelocity = { ball: Vector3.Zero(), mouse: Vector3.Zero() };
  const toyFriction = { ball: 1.35, mouse: 4.2 };
  if (ball) ball.metadata = { ...ball.metadata, velocity: toyVelocity.ball, friction: toyFriction.ball };
  if (mouse) mouse.metadata = { ...mouse.metadata, velocity: toyVelocity.mouse, friction: toyFriction.mouse };
  let enabled = false, paused = false, towerOwner = -1, windowOwner = -1, ballOwner = -1, mouseOwner = -1;
  const elevatedActivity = (cat: Companion): 'tower' | 'window' =>
    Math.hypot(cat.root.position.x - WINDOW_PERCH.x, cat.root.position.z - WINDOW_PERCH.z) < 1.1 ? 'window' : 'tower';
  const announce = (index: number, activity: DailyActivity, label = labels[activity]) => onActivity(index, activity, label);
  const group = (cat: Companion) => cat.groups.find(g => g.name === cat.action)!;
  function restoreBall(index: number) {
    if (ballOwner !== index) return;
    ballOwner = -1;
  }
  function restoreMouse(index: number) {
    if (mouseOwner !== index) return;
    mouseOwner = -1;
  }
  function restoreAction(index: number) {
    const actor = actors[index];
    // Keep the position reached by tracking and chasing; no snap back.
    actor.actOrigin = undefined;
    ripples[index].setEnabled(false);
  }
  function restorePose(actor: Actor) {
    if (!actor.pose) return;
    for (const pose of actor.pose.values()) {
      pose.node.rotationQuaternion = pose.rotation.clone(); pose.node.scaling.copyFrom(pose.scale);
    }
    actor.pose = undefined;
  }
  function capturePose(index: number) {
    const pose = new Map<string, JointPose>();
    for (const name of ['spine.008', 'spine.009', 'spine.010', 'Head', 'Eye.L', 'Eye.R',
      'Ear.L', 'Ear.R', 'TailBase', 'Tail2', 'Tail3', 'TailTip', 'shoulder.L', 'shoulder.R',
      'front_thigh.L', 'front_thigh.R', 'front_shin.L', 'front_shin.R',
      'front_foot.L', 'front_foot.R', 'pelvis.L', 'pelvis.R',
      'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R']) {
      const node = cats[index].nodes.find(n => n.name === name);
      if (node) pose.set(name, { node, rotation: node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(node.rotation), scale: node.scaling.clone() });
    }
    actors[index].pose = pose;
  }
  function bend(actor: Actor, name: string, yaw = 0, pitch = 0, roll = 0, eye = 1) {
    const pose = actor.pose?.get(name); if (!pose) return;
    pose.node.rotationQuaternion = pose.rotation.multiply(Quaternion.RotationYawPitchRoll(yaw * (actor.poseWeight ?? 1), pitch * (actor.poseWeight ?? 1), roll * (actor.poseWeight ?? 1)));
    pose.node.scaling.copyFrom(pose.scale); pose.node.scaling.y *= 1 + (eye - 1) * (actor.poseWeight ?? 1);
  }
  function interrupt(index: number) {
    const actor = actors[index]; actor.traversal?.restore(); actor.traversal = undefined; actor.surfacePath = undefined; restorePose(actor); restoreAction(index); restoreBall(index); restoreMouse(index);
    cats[index].root.rotation.x = 0; cats[index].root.rotation.z = 0;
    if (actor.stage === 'walk') play(cats[index], 'IdleNorm');
    actor.stage = 'manual'; actor.time = 0; actor.route = []; actor.waypoint = 0; actor.afterLanding = undefined;
    if (cats[index].supportY < .1 && cats[index].root.position.y < cats[index].baseY + .15) {
      if (towerOwner === index) towerOwner = -1;
      if (windowOwner === index) windowOwner = -1;
    }
  }
  function wait(index: number, duration: number) {
    const actor = actors[index]; restorePose(actor); restoreAction(index); restoreBall(index); restoreMouse(index);
    actor.stage = 'wait'; actor.activity = 'rest'; actor.time = 0; actor.duration = duration;
    play(cats[index], 'IdleNorm'); announce(index, 'rest');
  }
  function startAct(index: number) {
    const actor = actors[index], cat = cats[index], activity = actor.activity;
    actor.time = 0;
    if (activity === 'tower' || activity === 'window') { beginElevationTransfer(index, true); return; }
    actor.stage = 'act';
    actor.duration = ({ wander: 2.6, sit: 4.2, doze: 7.5, eat: 4.7, drink: 4.2, ball: 11.5, mouse: 10.8, rest: 2 } as Partial<Record<DailyActivity, number>>)[activity]!;
    play(cat, activity === 'sit' || activity === 'doze' ? 'IdleSit' : 'IdleNorm');
    if (activity === 'doze' || activity === 'eat' || activity === 'drink' || activity === 'ball' || activity === 'mouse') {
      group(cat).goToFrame(group(cat).from); group(cat).pause(); capturePose(index);
    }
    if (activity === 'ball') {
      ballOwner = index; actor.toyPhase = 'observe'; actor.toyTime = 0; actor.strikes = 0;
      if (ballHome) cat.root.rotation.y = angle(cat.root.position, ballHome);
    }
    if (activity === 'mouse') {
      mouseOwner = index; actor.toyPhase = 'observe'; actor.toyTime = 0; actor.strikes = 0;
      if (mouseHome) cat.root.rotation.y = angle(cat.root.position, mouseHome);
    }
    if (activity === 'eat' || activity === 'drink') {
      const bowl = activity === 'eat' ? { x: 2.78, z: 2.35 } : { x: 3.62, z: 2.35 };
      cat.root.rotation.y = angle(cat.root.position, bowl);
    }
    if (activity === 'drink') ripples[index].setEnabled(true);
    announce(index, activity);
  }
  function startActivity(index: number, activity: DailyActivity) {
    const actor = actors[index], cat = cats[index]; interrupt(index);
    actor.activity = activity; actor.time = 0;
    if (activity === 'sit') { startAct(index); return; }
    if (activity === 'tower') towerOwner = index;
    if (activity === 'ball') ballOwner = index;
    if (activity === 'mouse') mouseOwner = index;
    if (activity === 'window') windowOwner = index;
    const destination: FloorPoint = activity === 'tower' ? TOWER_APPROACH :
      activity === 'window' ? WINDOW_APPROACH :
      activity === 'doze' ? LIFE_SPOTS.bed : activity === 'eat' ? LIFE_SPOTS.food :
      activity === 'drink' ? LIFE_SPOTS.water : activity === 'ball' && ball ? { x: ball.position.x, z: ball.position.z - .64 } :
      activity === 'mouse' && mouse ? { x: mouse.position.x + .64, z: mouse.position.z } :
      LIFE_SPOTS.wander[(actor.sequence + index) % LIFE_SPOTS.wander.length];
    const other = cats[1 - index].root.position;
    actor.route = planFloorRoute(cat.root.position, destination, { x: other.x, z: other.z });
    actor.waypoint = 0; actor.blocked = 0;
    if (!actor.route.length) { wait(index, 1.5); return; }
    actor.stage = 'walk'; play(cat, 'WalkCycle'); announce(index, activity, 'おさんぽ中');
  }
  function nextActivity(index: number) {
    const actor = actors[index], routine = routines[index];
    for (let attempt = 0; attempt < routine.length; attempt++) {
      const activity = routine[actor.sequence++ % routine.length];
      if ((activity === 'tower' && towerOwner >= 0 && towerOwner !== index) ||
          (activity === 'window' && windowOwner >= 0 && windowOwner !== index) ||
          (activity === 'ball' && ballOwner >= 0 && ballOwner !== index) ||
          (activity === 'mouse' && mouseOwner >= 0 && mouseOwner !== index)) continue;
      startActivity(index, activity); return;
    }
    wait(index, 2);
  }
  function finish(index: number) {
    restorePose(actors[index]); restoreAction(index); restoreBall(index); restoreMouse(index); wait(index, 1.4);
    if (!enabled) actors[index].stage = 'manual';
  }
  function beginTowerTransfer(index: number, up: boolean, afterLanding?: () => void) {
    const actor=actors[index],cat=cats[index];restorePose(actor);
    actor.activity='tower';actor.stage=up?'jump-up':'jump-down';actor.afterLanding=afterLanding;
    const surface=towerSurfaceAt(cat.supportY), n=TOWER_SURFACES.indexOf(surface);
    actor.surfacePath=up?TOWER_SURFACES.slice(n+1):TOWER_SURFACES.slice(0,n).reverse();
    play(cat,'IdleNorm');group(cat).goToFrame(group(cat).from);group(cat).pause();
    announce(index,'tower',up?'タワーをのぼる':'タワーからジャンプ');
    startTowerLeg(index);
  }
  function startTowerLeg(index: number) {
    const actor=actors[index],cat=cats[index],next=actor.surfacePath?.shift();
    if(!next) {
      actor.traversal=undefined;
      if(actor.stage==='jump-up') {
        towerOwner=index;actor.stage='act';actor.time=0;actor.duration=8;play(cat,'IdleSit');announce(index,'tower');
      } else {
        towerOwner=-1;cat.supportY=0;onMoved(index,cat.root.position.x,cat.root.position.z);
        const callback=actor.afterLanding;actor.afterLanding=undefined;
        if(callback){actor.stage='manual';callback();}else finish(index);
      }
      return;
    }
    const source=towerSurfaceAt(cat.supportY);
    const previousFeet=footTargets(cat.nodes);
    play(cat,'IdleNorm');group(cat).goToFrame(group(cat).from);group(cat).pause();
    cat.root.rotation.x=0;cat.root.rotation.z=0;
    actor.traversal=createSurfaceTraversal(cat,source,next,catProportions[cat.key as keyof typeof catProportions]?.displayBodyHeight??1.25,previousFeet);
  }
  function tickTower(index: number, dt: number) {
    const actor=actors[index],traversal=actor.traversal;
    if(traversal?.update(dt)) startTowerLeg(index);
    const info=actor.traversal?.debug();
    if(info)scene.getEngine().getRenderingCanvas()?.setAttribute(`data-${cats[index].key}-traversal`,JSON.stringify(info));
  }
  function beginElevationTransfer(index: number, up: boolean, afterLanding?: () => void) {
    const actor = actors[index], cat = cats[index]; restorePose(actor); actor.poseWeight = 1;
    const destination = up ? actor.activity : elevatedActivity(cat);
    if(destination==='tower') {beginTowerTransfer(index,up,afterLanding);return;}
    actor.activity = destination;
    const perch = WINDOW_PERCH;
    const approach = WINDOW_APPROACH;
    const other = cats[1 - index].root.position;
    const floor = safeFloorPoint(approach.x, approach.z, { x: other.x, z: other.z });
    actor.stage = up ? 'jump-up' : 'jump-down'; actor.time = 0;
    const landingSurface = perch;
    actor.jumpSupport = up ? landingSurface.y : 0;
    actor.jumpFrom = cat.root.position.clone(); actor.jumpTo = up ?
      new Vector3(landingSurface.x, cat.baseY + landingSurface.y, landingSurface.z) :
      new Vector3(floor.x, cat.baseY, floor.z);
    actor.afterLanding = afterLanding;

    play(cat, 'IdleNorm'); group(cat).goToFrame(group(cat).from); group(cat).pause(); capturePose(index);
    actor.jumpFacingFrom = cat.root.rotation.y;
    actor.jumpYaw = angle(actor.jumpFrom, actor.jumpTo);
    actor.landingYaw = actor.jumpYaw;
    actor.prepOrigin = actor.jumpFrom.clone();
    const savedPosition = cat.root.position.clone(), savedYaw = cat.root.rotation.y;
    cat.root.rotation.y = actor.jumpYaw; actor.jumpFeet = footTargets(cat.nodes);
    cat.root.position.copyFrom(actor.jumpTo); cat.root.rotation.y = actor.landingYaw;
    actor.landingFeet = footTargets(cat.nodes);
    cat.root.position.copyFrom(savedPosition); cat.root.rotation.y = savedYaw;
    if (!up && cat.supportY > .1) {
      const direction = actor.jumpTo.subtract(actor.jumpFrom); direction.y = 0; direction.normalize();
      actor.jumpFrom.addInPlace(direction.scale(.09));
    }
    actor.jumpTiming = jumpTiming(actor.jumpTo.y - actor.jumpFrom.y, cat.key === 'kokoro');
    actor.duration = actor.jumpTiming.duration;
    announce(index, destination, up ? (destination === 'window' ? '窓辺へジャンプ' : 'タワーをのぼる') :
      (destination === 'window' ? '窓辺からジャンプ' : 'タワーからジャンプ'));
  }
  function tickWindowJump(index: number, dt: number) {
    const actor = actors[index], cat = cats[index];
    actor.time += dt;
    restorePose(actor); capturePose(index);
    const up = actor.stage === 'jump-up';
    const timing = actor.jumpTiming!;
    const pose = jumpPose(actor.time, timing, up);
    const { prep, p, land, air, compress, launch, tuck, reach, frontAbsorb, hindAbsorb, look } = pose;
    const start = actor.jumpFrom!, end = actor.jumpTo!;
    const size = cat.key === 'kokoro' ? 1 : .87;
    const facing = Math.atan2(Math.sin(actor.jumpYaw! - actor.jumpFacingFrom!), Math.cos(actor.jumpYaw! - actor.jumpFacingFrom!));
    const turn = Math.atan2(Math.sin(actor.landingYaw! - actor.jumpYaw!), Math.cos(actor.landingYaw! - actor.jumpYaw!));
    if (actor.time < timing.prep) {
      cat.root.rotation.y = actor.jumpFacingFrom! + facing * ease(prep / .34);
      cat.root.position.copyFrom(Vector3.Lerp(actor.prepOrigin ?? start, start, ease(prep / .65)));
      cat.root.position.y -= (up ? .16 : .085) * compress * size;
    } else if (air) {
      cat.root.rotation.y = actor.jumpYaw! + turn * ease((p - .28) / .62);
      cat.root.position.x = mix(start.x, end.x, p);
      cat.root.position.z = mix(start.z, end.z, p);
      const flightTime = pose.p * timing.flight;
      cat.root.position.y = start.y + timing.velocity * flightTime - .5 * timing.gravity * flightTime * flightTime;
    } else {
      cat.root.rotation.y = actor.landingYaw!;
      cat.root.position.copyFrom(end); cat.supportY = actor.jumpSupport ?? 0;
      cat.root.position.y -= size * (.082 * frontAbsorb + .047 * hindAbsorb);
    }
    // Head leads a descending jump; hindquarters drive an ascending jump.
    cat.root.rotation.x = up ? -.27 * launch - .10 * tuck + .15 * reach + .075 * frontAbsorb
      : .15 * look + .17 * launch - .035 * tuck + .19 * reach + .08 * frontAbsorb;
    if (!air && actor.time >= timing.prep) cat.root.rotation.x *= 1 - ease(land / .72);
    const asymmetry = (cat.key === 'kokoro' ? -1 : 1) * .022;
    cat.root.rotation.z = air ? asymmetry * Math.sin(Math.PI * p) : 0;
    bend(actor, 'spine.008', 0, .11 * compress - .055 * launch + .07 * tuck + .04 * hindAbsorb);
    bend(actor, 'spine.009', 0, .17 * compress - .15 * launch + .12 * tuck + .095 * frontAbsorb);
    bend(actor, 'spine.010', 0, up ? -.15 * look + .10 * reach : .25 * look - .10 * reach);
    bend(actor, 'Head', 0, up ? -.20 * look + .12 * reach : .30 * look - .12 * reach);
    for (const side of ['L', 'R']) {
      const lead = side === (cat.key === 'kokoro' ? 'R' : 'L') ? 1 : .91;
      bend(actor, `Ear.${side}`, 0, -.06 * launch, (side === 'L' ? 1 : -1) * (.045 * compress + .10 * tuck));
      bend(actor, `shoulder.${side}`, 0, -.13 * launch + .08 * reach + .09 * frontAbsorb);
      bend(actor, `front_thigh.${side}`, 0, .22 * compress + .67 * launch + .47 * tuck + .66 * reach * lead - .25 * frontAbsorb);
      bend(actor, `front_shin.${side}`, 0, -.38 * compress - .24 * launch - .74 * tuck + .30 * reach + .48 * frontAbsorb);
      bend(actor, `front_foot.${side}`, 0, .14 * compress + .24 * tuck + .12 * reach - .20 * frontAbsorb);
      bend(actor, `pelvis.${side}`, 0, .10 * compress - .06 * launch + .07 * tuck);
      bend(actor, `thigh.${side}`, 0, -.56 * compress + .62 * launch - .60 * tuck - .19 * reach - .19 * hindAbsorb);
      bend(actor, `shin.${side}`, 0, .73 * compress - .46 * launch + .74 * tuck + .16 * reach + .53 * hindAbsorb);
      bend(actor, `foot.${side}`, 0, -.23 * compress + .22 * launch - .15 * tuck - .15 * hindAbsorb);
    }
    // The tail trails the spine with a phase delay rather than staying rigidly upright.
    const balance = air ? Math.sin(Math.PI * p) : 0;
    const flick = Math.sin(p * Math.PI * 2.2) * balance;
    bend(actor, 'TailBase', 0, -.54 * launch - .42 * balance + .15 * reach, .14 * flick);
    bend(actor, 'Tail2', 0, -.19 * launch - .25 * balance + .10 * reach, .11 * Math.sin(p * 6 - .45) * balance);
    bend(actor, 'Tail3', 0, .09 * balance, .10 * Math.sin(p * 6 - .95) * balance);
    bend(actor, 'TailTip', 0, .18 * balance, .10 * Math.sin(p * 6 - 1.45) * balance);
    if (air) reachFrontFeet(cat.nodes, cat.root.rotation.y, reach);
    if (actor.time < timing.prep && actor.jumpFeet) plantFeet(cat.nodes, actor.jumpFeet, .85 * ease((prep - .3) / .25), ease((prep - .3) / .25));
    if (!air && actor.time >= timing.prep && actor.landingFeet) plantFeet(cat.nodes, actor.landingFeet, 1, ease(land / .22));
    if (actor.time < actor.duration) return;
    restorePose(actor); cat.root.position.copyFrom(end); cat.root.rotation.x = 0; cat.root.rotation.z = 0;
    if (up) {
      cat.supportY = actor.activity === 'window' ? WINDOW_PERCH.y : TOWER_PERCH.y;
      if (actor.activity === 'window') windowOwner = index; else towerOwner = index;
      actor.stage = 'act'; actor.time = 0; actor.duration = actor.activity === 'window' ? 9 : 8;
      play(cat, 'IdleSit'); announce(index, actor.activity);
    } else {
      cat.supportY = 0;
      if (towerOwner === index) towerOwner = -1;
      if (windowOwner === index) windowOwner = -1;
      onMoved(index, end.x, end.z);
      const callback = actor.afterLanding; actor.afterLanding = undefined;
      if (callback) { actor.stage = 'manual'; callback(); } else finish(index);
    }
  }
  function tickWalk(index: number, dt: number) {
    const actor = actors[index], cat = cats[index];
    const last = actor.route.at(-1);
    const remaining = last ? Math.hypot(last.x - cat.root.position.x, last.z - cat.root.position.z) : 0;
    const speed = Math.min(.95, .18 + remaining * 1.7);
    group(cat).speedRatio = speed / .95;
    let distanceLeft = dt * speed;
    while (distanceLeft > 0 && actor.waypoint < actor.route.length) {
      const target = actor.route[actor.waypoint];
      const distance = Math.hypot(target.x - cat.root.position.x, target.z - cat.root.position.z);
      if (distance < .001) { actor.waypoint++; continue; }
      const portion = Math.min(distanceLeft, distance);
      const x = cat.root.position.x + (target.x - cat.root.position.x) * portion / distance;
      const z = cat.root.position.z + (target.z - cat.root.position.z) * portion / distance;
      const other = cats[1 - index].root.position;
      if (Math.hypot(x - other.x, z - other.z) < .75) {
        actor.blocked += dt;
        if (actor.blocked > 1.5) {
          actor.route = planFloorRoute(cat.root.position, actor.route.at(-1)!, { x: other.x, z: other.z });
          actor.waypoint = 0; actor.blocked = 0;
          if (!actor.route.length) wait(index, 1.5);
        }
        return;
      }
      actor.blocked = 0;
      const heading = angle(cat.root.position, target);
      cat.root.rotation.y += Math.atan2(Math.sin(heading - cat.root.rotation.y), Math.cos(heading - cat.root.rotation.y)) * Math.min(1, dt * 8);
      cat.root.position.set(x, cat.baseY, z); distanceLeft -= portion;
      if (portion >= distance - .001) actor.waypoint++;
    }
    if (actor.waypoint >= actor.route.length) {
      onMoved(index, cat.root.position.x, cat.root.position.z); startAct(index);
    }
  }
  function tickToy(index: number, dt: number) {
    const actor = actors[index], cat = cats[index];
    const kind = actor.activity === 'ball' ? 'ball' : 'mouse';
    const toy = kind === 'ball' ? ball : mouse;
    if (!toy) return;
    actor.toyTime = (actor.toyTime ?? 0) + dt;
    const delta = toy.position.subtract(cat.root.position); delta.y = 0;
    const distance = delta.length(), yaw = angle(cat.root.position, toy.position);
    const difference = Math.atan2(Math.sin(yaw - cat.root.rotation.y), Math.cos(yaw - cat.root.rotation.y));
    const localSide = delta.x * Math.cos(cat.root.rotation.y) - delta.z * Math.sin(cat.root.rotation.y);
    const phase = actor.toyPhase ?? 'observe', t = actor.toyTime;
    const transition = (next: NonNullable<Actor['toyPhase']>) => { actor.toyPhase = next; actor.toyTime = 0; actor.contact = false; };
    cat.root.rotation.y += difference * Math.min(1, dt * (phase === 'strike' ? 1 : 4));
    const remaining = ease((actor.duration - actor.time) / .7);
    const crouch = (phase === 'aim' ? ease(t / .3) : phase === 'strike' ? 1 : .35) * remaining;
    const reach = phase === 'strike' ? Math.sin(Math.PI * unit(t / .48)) * remaining : 0;
    const side = actor.paw ?? (localSide >= 0 ? 'R' : 'L');
    bend(actor, 'Head', Math.max(-.4, Math.min(.4, difference)), .17 + .1 * crouch);
    for (const ear of ['Ear.L', 'Ear.R']) bend(actor, ear, difference * .3, -.06 * crouch);
    for (const eye of ['Eye.L', 'Eye.R']) bend(actor, eye, difference * .12);
    bend(actor, 'spine.009', 0, .10 * crouch, (side === 'R' ? -.035 : .035) * reach);
    bend(actor, 'spine.010', difference * .1, .08 * crouch);
    bend(actor, `shoulder.${side}`, 0, -.07 * reach);
    bend(actor, `front_thigh.${side}`, 0, .54 * reach);
    bend(actor, `front_shin.${side}`, 0, -.32 * reach);
    bend(actor, `front_foot.${side}`, 0, .22 * reach, actor.toyPattern === 1 ? (side === 'R' ? -.15 : .15) * reach : 0);
    if (phase === 'strike' && actor.toyPattern === 2 && actor.strikeOrigin) {
      const advance = .13 * ease(t / .3);
      const origin = actor.strikeOrigin, other = cats[1 - index].root.position;
      const next = safeFloorPoint(origin.x + Math.sin(cat.root.rotation.y) * advance, origin.z + Math.cos(cat.root.rotation.y) * advance, other);
      cat.root.position.set(next.x, cat.baseY + .045 * reach, next.z);
      for (const leg of ['L', 'R']) bend(actor, `front_thigh.${leg}`, 0, .35 * reach);
    } else cat.root.position.y = cat.baseY;
    for (const leg of ['L', 'R']) { bend(actor, `thigh.${leg}`, 0, -.10 * crouch); bend(actor, `shin.${leg}`, 0, .12 * crouch); }
    bend(actor, 'TailBase', 0, -.07 * crouch, .10 * Math.sin(actor.time * 4));
    bend(actor, 'Tail2', 0, 0, .08 * Math.sin(actor.time * 4 - .6));
    if (phase === 'observe' && t > .65) transition(distance > .9 || distance < .4 ? 'chase' : 'aim');
    if (phase === 'aim' && t > .32 + ((actor.sequence + (actor.strikes ?? 0)) % 3) * .12) {
      if (distance > .9) transition('chase'); else { actor.paw = localSide >= 0 ? 'R' : 'L'; actor.toyPattern = ((actor.strikes ?? 0) + actor.sequence) % 3; actor.strikeOrigin = cat.root.position.clone(); transition('strike'); }
    }
    if (phase === 'strike') {
      if (t >= .24 && !actor.contact && distance < .98) {
        actor.contact = true;
        const direction = delta.normalize();
        // Side of contact determines the impulse, with three strengths/patterns.
        const pattern = ((actor.strikes ?? 0) + actor.sequence) % 3;
        direction.x += (side === 'R' ? -.3 : .3);
        direction.normalize(); toyVelocity[kind].copyFrom(direction.scale(kind === 'ball' ? 1.05 + pattern * .25 : .45 + pattern * .12));
        actor.strikes = (actor.strikes ?? 0) + 1;
      }
      if (t > .48) transition('track');
    }
    if (phase === 'track' && t > .48) transition(distance > .88 ? 'chase' : (actor.strikes ?? 0) >= 3 ? 'recover' : 'aim');
    if (phase === 'chase') {
      if (distance > .67 || distance < .42) {
        const forward = distance < .42 ? -.35 : Math.min(.8, (distance - .64) * 2);
        const other = cats[1 - index].root.position;
        const next = safeFloorPoint(cat.root.position.x + Math.sin(yaw) * dt * forward, cat.root.position.z + Math.cos(yaw) * dt * forward, other);
        cat.root.position.x = next.x; cat.root.position.z = next.z;
        // Alternating limbs and spine accompany the few tracking steps.
        for (const leg of ['L', 'R']) {
          const step = Math.sin(t * 12 + (leg === 'L' ? 0 : Math.PI));
          bend(actor, `front_thigh.${leg}`, 0, .16 * step);
          bend(actor, `front_shin.${leg}`, 0, -.10 * Math.max(0, step));
          bend(actor, `thigh.${leg}`, 0, -.14 * step);
          bend(actor, `shin.${leg}`, 0, .12 * Math.max(0, -step));
        }
      } else transition('aim');
      if (t > 2.2) transition('recover');
    }
    if (phase === 'recover' && t > 1.0 && (actor.strikes ?? 0) < 4) transition('observe');
    onMoved(index, cat.root.position.x, cat.root.position.z);
    scene.getEngine().getRenderingCanvas()?.setAttribute(`data-${cat.key}-toy-phase`, phase);
  }
  function tickToyPhysics(dt: number) {
    for (const kind of ['ball', 'mouse'] as const) {
      const toy = kind === 'ball' ? ball : mouse; if (!toy) continue;
      const before = toy.position.clone(), velocity = toyVelocity[kind];
      toy.position.addInPlace(velocity.scale(dt));
      if (!floorSegmentClear(before, toy.position)) { toy.position.copyFrom(before); velocity.scaleInPlace(-.4); }
      velocity.scaleInPlace(Math.exp(-toyFriction[kind] * dt));
      if (Math.abs(toy.position.x) > 3.6) { toy.position.x = Math.sign(toy.position.x) * 3.6; velocity.x *= -.5; }
      if (Math.abs(toy.position.z) > 2.65) { toy.position.z = Math.sign(toy.position.z) * 2.65; velocity.z *= -.5; }
      const movement = toy.position.subtract(before);
      if (kind === 'ball') { toy.rotation.x += movement.z / .12; toy.rotation.z -= movement.x / .12; if (stripe) { stripe.position.copyFrom(toy.position); stripe.rotation.copyFrom(toy.rotation); } }
      else mouseParts.forEach(part => { if (part !== mouse) part.position.addInPlace(movement); });
    }
  }
  function tickAct(index: number, dt: number) {
    const actor = actors[index]; actor.time += dt;
    if (actor.pose) {
      restorePose(actor); capturePose(index);
      const t = actor.time;
      actor.poseWeight = ease(t / .4) * ease((actor.duration - t) / .6);
      if (actor.activity === 'doze') {
        bend(actor, 'Head', 0, .22 + .025 * Math.sin(t * 1.7), .08);
        bend(actor, 'Eye.L', 0, 0, 0, .32); bend(actor, 'Eye.R', 0, 0, 0, .32);
        bend(actor, 'TailBase', 0, 0, .12 * Math.sin(t * 1.5));
      } else if (actor.activity === 'eat' || actor.activity === 'drink') {
        const drinking = actor.activity === 'drink';
        const rhythm = Math.sin(t * (drinking ? 11 : 6.5));
        const lean = smooth(Math.min(1, t / .45)) * (1 - smooth(Math.max(0, (t - actor.duration + .55) / .55)));
        bend(actor, 'spine.008', 0, .12 * lean);
        bend(actor, 'spine.009', 0, .19 * lean);
        bend(actor, 'spine.010', 0, .28 * lean);
        bend(actor, 'Head', 0, (.55 + (drinking ? .1 : .07) * rhythm) * lean);
        bend(actor, 'shoulder.L', 0, -.13 * lean); bend(actor, 'shoulder.R', 0, -.13 * lean);
        bend(actor, 'front_thigh.L', 0, .24 * lean); bend(actor, 'front_thigh.R', 0, .24 * lean);
        bend(actor, 'front_shin.L', 0, -.22 * lean); bend(actor, 'front_shin.R', 0, -.22 * lean);
        bend(actor, 'Ear.L', 0, 0, .035 * rhythm * lean);
        bend(actor, 'Ear.R', 0, 0, -.035 * rhythm * lean);
        if (drinking) {
          const ripple = ripples[index], phase = (t * 3.5) % 1;
          ripple.scaling.setAll(.45 + phase * .9);
          ripple.visibility = (1 - phase) * .7 * lean;
        }
      } else if (actor.activity === 'ball' || actor.activity === 'mouse') {
        tickToy(index, dt);
      }
    }
    if (actor.time < actor.duration) return;
    if (actor.activity === 'tower' || actor.activity === 'window') beginElevationTransfer(index, false);
    else finish(index);
  }
  function tick(dt: number) {
    if (paused) return;
    tickToyPhysics(dt);
    cats.forEach((cat, index) => {
      const actor = actors[index];
      if (actor.stage === 'manual') {
        if (enabled && !isInteracting(index)) {
          actor.time += dt;
          if (actor.time > 2.2) {
            if (cat.supportY > .1) {
              actor.stage = 'act'; actor.activity = elevatedActivity(cat); actor.time = 0; actor.duration = 4;
              play(cat, 'IdleSit'); announce(index, actor.activity);
            } else wait(index, .1);
          }
        }
      } else if (actor.stage === 'wait') {
        actor.time += dt;
        if (enabled && actor.time >= actor.duration) nextActivity(index);
      } else if (actor.stage === 'walk') tickWalk(index, dt);
      else if (actor.stage === 'act') tickAct(index, dt);
      else if (actor.traversal) tickTower(index, dt);
      else tickWindowJump(index, dt);
    });
  }
  function startRelax() {
    enabled = true; paused = false;
    cats.forEach((cat, index) => {
      interrupt(index);
      if (cat.supportY > .1) {
        actors[index].activity = elevatedActivity(cat); actors[index].stage = 'act';
        if (actors[index].activity === 'window') windowOwner = index; else towerOwner = index;
        actors[index].duration = 7; actors[index].time = 0;
        play(cat, 'IdleSit'); announce(index, actors[index].activity);
      } else if (cat.root.position.y > cat.baseY + .15) {
        beginElevationTransfer(index, false, () => wait(index, 1.5));
      } else wait(index, index ? 2.8 : 1.2);
    });
  }
  function stopForMode(onGround: (index: number) => void) {
    enabled = false; paused = false;
    cats.forEach((cat, index) => {
      const elevated = cat.supportY > .1 || cat.root.position.y > cat.baseY + .15;
      interrupt(index);
      if (elevated) beginElevationTransfer(index, false, () => onGround(index));
      else { cat.supportY = 0; cat.root.position.y = cat.baseY; onMoved(index, cat.root.position.x, cat.root.position.z); onGround(index); }
    });
  }
  function placed(index: number) {
    interrupt(index);
    const cat = cats[index];
    if (cat.supportY > .1) {
      actors[index].stage = 'act'; actors[index].activity = elevatedActivity(cat);
      if (actors[index].activity === 'window') windowOwner = index; else towerOwner = index;
      actors[index].time = 0; actors[index].duration = 8;
      play(cat, 'IdleSit'); announce(index, actors[index].activity);
    } else if (enabled) wait(index, 2.2);
  }
  function commandTower(index: number): boolean {
    if (towerOwner >= 0 && towerOwner !== index) return false;
    if (cats[index].supportY > .1) return true;
    startActivity(index, 'tower'); return true;
  }
  function commandWindow(index: number): boolean {
    if (windowOwner >= 0 && windowOwner !== index) return false;
    if (cats[index].supportY > .1 && elevatedActivity(cats[index]) === 'window') return true;
    if (cats[index].supportY > .1) return false;
    startActivity(index, 'window'); return true;
  }
  function commandBall(index: number): boolean {
    if (ballOwner >= 0 && ballOwner !== index || cats[index].supportY > .1) return false;
    startActivity(index, 'ball'); return true;
  }
  function commandMouse(index: number): boolean {
    if (mouseOwner >= 0 && mouseOwner !== index) return false;
    if (cats[index].supportY > .1) return false;
    startActivity(index, 'mouse'); return true;
  }
  function returnToFloor(index: number, done: () => void) {
    const cat = cats[index]; interrupt(index);
    if (cat.supportY > .1 || cat.root.position.y > cat.baseY + .15) beginElevationTransfer(index, false, done);
    else done();
  }
  function resetImmediate() {
    enabled = false; paused = false;
    cats.forEach((cat, index) => {
      interrupt(index); cat.supportY = 0; cat.root.position.y = cat.baseY; cat.root.rotation.x = 0; cat.root.rotation.z = 0;
    });
    towerOwner = -1; windowOwner = -1; ballOwner = -1; mouseOwner = -1;
    toyVelocity.ball.setAll(0); toyVelocity.mouse.setAll(0);
    if (ball && ballHome) ball.position.copyFrom(ballHome);
    if (stripe && ballHome) stripe.position.copyFrom(ballHome);
    mouseParts.forEach((part, i) => part.position.copyFrom(mousePartHomes[i]));
  }
  function pause(value: boolean) {
    paused = value;
    if (!value) actors.forEach((actor, index) => {
      if (actor.pose) group(cats[index]).pause();
    });
  }
  return { tick, startRelax, stopForMode, interrupt, placed, commandTower, commandWindow, commandMouse, commandBall, returnToFloor,
    resetImmediate, pause, canPerch: (index: number) => towerOwner < 0 || towerOwner === index,
    isTransitioning: (index: number) => actors[index].stage === 'jump-up' || actors[index].stage === 'jump-down',
    traversalDebug: (index: number) => actors[index].traversal?.debug(),
    isBusy: (index: number) => actors[index].stage !== 'manual',
    isEnabled: () => enabled };
}
