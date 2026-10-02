import { Color3, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { Companion } from './interactions';
import { LIFE_SPOTS, planFloorRoute, safeFloorPoint, TOWER_APPROACH, TOWER_PERCH, TOWER_STEP, WINDOW_APPROACH, WINDOW_PERCH, type FloorPoint } from './placement';

export type DailyActivity = 'rest' | 'wander' | 'sit' | 'doze' | 'eat' | 'drink' | 'ball' | 'mouse' | 'tower' | 'window';
type Stage = 'manual' | 'wait' | 'walk' | 'act' | 'jump-up' | 'jump-down';
type JointPose = { node: TransformNode; rotation: Quaternion; scale: Vector3 };
type Actor = {
  stage: Stage; activity: DailyActivity; time: number; duration: number; sequence: number;
  route: FloorPoint[]; waypoint: number; pose?: Map<string, JointPose>;
  actOrigin?: Vector3;
  jumpFrom?: Vector3; jumpTo?: Vector3; jumpPrep?: number;
  jumpStep?: number;
  afterLanding?: () => void; blocked: number;
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
const cubic = (a: number, b: number, c: number, d: number, t: number) =>
  a * (1 - t) ** 3 + 3 * b * (1 - t) ** 2 * t + 3 * c * (1 - t) * t ** 2 + d * t ** 3;
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
  const mousePartHomes = mouseParts.map(part => part.position.clone());
  const ballHome = ball?.position.clone(), stripeHome = stripe?.position.clone();
  const mouseHome = mouse?.position.clone();
  const ballRotation = ball?.rotation.clone(), stripeRotation = stripe?.rotation.clone();
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
  let enabled = false, paused = false, towerOwner = -1, windowOwner = -1, ballOwner = -1, mouseOwner = -1;
  const elevatedActivity = (cat: Companion): 'tower' | 'window' =>
    Math.hypot(cat.root.position.x - WINDOW_PERCH.x, cat.root.position.z - WINDOW_PERCH.z) < 1.1 ? 'window' : 'tower';
  const announce = (index: number, activity: DailyActivity, label = labels[activity]) => onActivity(index, activity, label);
  const group = (cat: Companion) => cat.groups.find(g => g.name === cat.action)!;
  function restoreBall(index: number) {
    if (ballOwner !== index) return;
    if (ball && ballHome) ball.position.copyFrom(ballHome);
    if (stripe && stripeHome) stripe.position.copyFrom(stripeHome);
    if (ball && ballRotation) ball.rotation.copyFrom(ballRotation);
    if (stripe && stripeRotation) stripe.rotation.copyFrom(stripeRotation);
    ballOwner = -1;
  }
  function restoreMouse(index: number) {
    if (mouseOwner !== index) return;
    mouseParts.forEach((part, i) => part.position.copyFrom(mousePartHomes[i]));
    mouseOwner = -1;
  }
  function restoreAction(index: number) {
    const actor = actors[index];
    if (actor.actOrigin) cats[index].root.position.copyFrom(actor.actOrigin);
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
      'Ear.L', 'Ear.R', 'TailBase', 'Tail2', 'Tail3', 'shoulder.L', 'shoulder.R',
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
    pose.node.rotationQuaternion = pose.rotation.multiply(Quaternion.RotationYawPitchRoll(yaw, pitch, roll));
    pose.node.scaling.copyFrom(pose.scale); pose.node.scaling.y *= eye;
  }
  function interrupt(index: number) {
    const actor = actors[index]; restorePose(actor); restoreAction(index); restoreBall(index); restoreMouse(index);
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
    if (activity === 'tower' || activity === 'window') { beginJump(index, true); return; }
    actor.stage = 'act';
    actor.duration = ({ wander: 2.6, sit: 4.2, doze: 7.5, eat: 4.7, drink: 4.2, ball: 5.2, mouse: 4.3, rest: 2 } as Partial<Record<DailyActivity, number>>)[activity]!;
    play(cat, activity === 'sit' || activity === 'doze' ? 'IdleSit' : 'IdleNorm');
    if (activity === 'doze' || activity === 'eat' || activity === 'drink' || activity === 'ball' || activity === 'mouse') {
      group(cat).goToFrame(group(cat).from); group(cat).pause(); capturePose(index);
    }
    if (activity === 'ball') {
      ballOwner = index; actor.actOrigin = cat.root.position.clone();
      if (ballHome) cat.root.rotation.y = angle(cat.root.position, ballHome);
    }
    if (activity === 'mouse') {
      mouseOwner = index;
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
    if (activity === 'window') windowOwner = index;
    const destination: FloorPoint = activity === 'tower' ? TOWER_APPROACH :
      activity === 'window' ? WINDOW_APPROACH :
      activity === 'doze' ? LIFE_SPOTS.bed : activity === 'eat' ? LIFE_SPOTS.food :
      activity === 'drink' ? LIFE_SPOTS.water : activity === 'ball' ? LIFE_SPOTS.ball :
      activity === 'mouse' ? LIFE_SPOTS.mouse :
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
  }
  function beginJump(index: number, up: boolean, afterLanding?: () => void, step = 0) {
    const actor = actors[index], cat = cats[index]; restorePose(actor);
    const destination = up ? actor.activity : elevatedActivity(cat);
    if (!up && destination === 'tower' && cat.root.position.y <= cat.baseY + TOWER_STEP.y + .3) step = 1;
    actor.activity = destination;
    const perch = destination === 'window' ? WINDOW_PERCH : TOWER_PERCH;
    const approach = destination === 'window' ? WINDOW_APPROACH : TOWER_APPROACH;
    const other = cats[1 - index].root.position;
    const floor = safeFloorPoint(approach.x, approach.z, { x: other.x, z: other.z });
    const usingStep = destination === 'tower';
    const target = usingStep && step === 0 ? TOWER_STEP : perch;
    actor.stage = up ? 'jump-up' : 'jump-down'; actor.time = 0; actor.duration = up ? (usingStep ? 1.15 : 1.55) : (usingStep ? 1.03 : 1.3);
    actor.jumpStep = step;
    actor.jumpPrep = up ? .23 : .18;
    actor.jumpFrom = cat.root.position.clone(); actor.jumpTo = up ?
      new Vector3(target.x, cat.baseY + target.y, target.z) :
      usingStep && step === 0 ? new Vector3(TOWER_STEP.x, cat.baseY + TOWER_STEP.y, TOWER_STEP.z) :
        new Vector3(floor.x, cat.baseY, floor.z);
    actor.afterLanding = afterLanding;
    if (up) cat.supportY = 0;
    play(cat, 'IdleNorm'); group(cat).goToFrame(group(cat).from); group(cat).pause(); capturePose(index);
    cat.root.rotation.y = angle(actor.jumpFrom, actor.jumpTo);
    announce(index, destination, up ? (destination === 'window' ? '窓辺へジャンプ' : 'タワーをのぼる') :
      (destination === 'window' ? '窓辺からジャンプ' : 'タワーからジャンプ'));
  }
  function tickJump(index: number, dt: number) {
    const actor = actors[index], cat = cats[index]; actor.time += dt;
    restorePose(actor); capturePose(index);
    const up = actor.stage === 'jump-up';
    // Separate the planted crouch, airborne travel, and landing recovery.
    const prep = actor.jumpPrep ?? 0, settle = .22, flightEnd = actor.duration - settle;
    const p = unit((actor.time - prep) / (flightEnd - prep));
    const landing = unit((actor.time - flightEnd) / settle);
    const coil = actor.time < prep ? ease(actor.time / prep) : 1 - ease(p / .18);
    const stretch = ease(p / .14) * (1 - ease((p - .42) / .2));
    const tuck = ease((p - .2) / .25) * (1 - ease((p - .72) / .18));
    const reach = ease((p - .48) / .29) * (1 - ease((p - .97) / .03));
    const absorb = actor.time >= flightEnd ? Math.sin(Math.PI * landing) : 0;
    const start = actor.jumpFrom!, end = actor.jumpTo!;
    if (actor.time < prep) {
      cat.root.position.copyFrom(start);
      cat.root.position.y -= (up ? .085 : .045) * coil;
    } else if (actor.time < flightEnd) {
      const travel = ease(p), launchY = start.y - (up ? .085 : .045) * (prep > 0 ? 1 : 0);
      cat.root.position.x = mix(start.x, end.x, travel);
      cat.root.position.z = mix(start.z, end.z, travel);
      // The asymmetric arcs lift toward the perch and drop away from its edge.
      cat.root.position.y = up
        ? cubic(launchY, launchY + 1.7, end.y + .52, end.y, p)
        : cubic(launchY, launchY + .12, end.y + .58, end.y, p);
    } else cat.root.position.copyFrom(end);
    cat.root.rotation.x = up ? -.13 * stretch + .07 * reach + .045 * absorb
      : .12 * stretch - .055 * tuck + .045 * absorb;
    const look = up ? -.16 * coil - .1 * stretch + .08 * reach : .2 * coil + .1 * stretch + .06 * reach;
    bend(actor, 'spine.009', 0, .08 * coil - .05 * stretch + .05 * absorb);
    bend(actor, 'spine.010', 0, .05 * coil - .08 * stretch + .06 * absorb);
    bend(actor, 'Head', 0, look + .07 * absorb);
    for (const side of ['L', 'R']) {
      bend(actor, `shoulder.${side}`, 0, -.06 * stretch + .04 * absorb);
      bend(actor, `front_thigh.${side}`, 0, .18 * coil + .46 * stretch + .2 * tuck + .36 * reach - .12 * absorb);
      bend(actor, `front_shin.${side}`, 0, -.24 * coil - .16 * stretch - .3 * tuck + .04 * reach + .22 * absorb);
      bend(actor, `front_foot.${side}`, 0, .1 * coil + .14 * stretch + .1 * reach - .09 * absorb);
      bend(actor, `thigh.${side}`, 0, -.25 * coil + .39 * stretch - .25 * tuck - .09 * reach - .1 * absorb);
      bend(actor, `shin.${side}`, 0, .36 * coil - .25 * stretch + .38 * tuck + .16 * reach + .27 * absorb);
      bend(actor, `foot.${side}`, 0, -.12 * coil + .12 * stretch - .09 * absorb);
    }
    bend(actor, 'TailBase', 0, -.12 * stretch + .13 * reach, .12 * Math.sin(actor.time * 6) * (stretch + tuck));
    bend(actor, 'Tail2', 0, -.08 * stretch + .11 * reach, .1 * Math.sin(actor.time * 6 - .6) * (stretch + tuck));
    bend(actor, 'Tail3', 0, 0, .07 * Math.sin(actor.time * 6 - 1.1) * (stretch + tuck));
    if (up && actor.time >= flightEnd) {
      const facing = angle(start, end), restYaw = actor.activity === 'window' ? 2.65 : .8;
      const difference = Math.atan2(Math.sin(restYaw - facing), Math.cos(restYaw - facing));
      cat.root.rotation.y = facing + difference * ease((landing - .1) / .9);
    }
    if (actor.time < actor.duration) return;
    restorePose(actor); cat.root.position.copyFrom(end); cat.root.rotation.x = 0;
    if (up && actor.activity === 'tower' && actor.jumpStep === 0) {
      cat.supportY = TOWER_STEP.y;
      beginJump(index, true, actor.afterLanding, 1);
    } else if (!up && actor.activity === 'tower' && actor.jumpStep === 0 && start.y > cat.baseY + TOWER_STEP.y + .3) {
      cat.supportY = TOWER_STEP.y;
      beginJump(index, false, actor.afterLanding, 1);
    } else if (up) {
      cat.supportY = actor.activity === 'window' ? WINDOW_PERCH.y : TOWER_PERCH.y;
      if (actor.activity === 'window') windowOwner = index; else towerOwner = index;
      actor.stage = 'act'; actor.time = 0; actor.duration = actor.activity === 'window' ? 9 : 8;
      cat.root.rotation.y = actor.activity === 'window' ? 2.65 : .8;
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
    let distanceLeft = dt * .95;
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
      actor.blocked = 0; cat.root.rotation.y = angle(cat.root.position, target);
      cat.root.position.set(x, cat.baseY, z); distanceLeft -= portion;
      if (portion >= distance - .001) actor.waypoint++;
    }
    if (actor.waypoint >= actor.route.length) {
      onMoved(index, cat.root.position.x, cat.root.position.z); startAct(index);
    }
  }
  function tickAct(index: number, dt: number) {
    const actor = actors[index], cat = cats[index]; actor.time += dt;
    if (actor.pose) {
      restorePose(actor); capturePose(index);
      const t = actor.time;
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
      } else if (actor.activity === 'ball') {
        const strikeL = Math.max(0, 1 - Math.abs(t - .95) / .43);
        const strikeR = Math.max(0, 1 - Math.abs(t - 3.0) / .43);
        const first = smooth(Math.max(0, Math.min(1, (t - .95) / .48)));
        const second = smooth(Math.max(0, Math.min(1, (t - 3.0) / .5)));
        const forward = .14 * smooth(Math.min(1, t / 1.8)) * (1 - smooth(Math.max(0, Math.min(1, (t - 4.15) / .8))));
        if (actor.actOrigin) {
          cat.root.position.copyFrom(actor.actOrigin);
          cat.root.position.x += Math.sin(cat.root.rotation.y) * forward;
          cat.root.position.z += Math.cos(cat.root.rotation.y) * forward;
        }
        bend(actor, 'spine.009', 0, .11);
        bend(actor, 'spine.010', 0, .09);
        bend(actor, 'Head', .1 + .14 * first - .12 * second, .14 + .13 * Math.max(strikeL, strikeR));
        bend(actor, 'shoulder.L', 0, -.2 * strikeL);
        bend(actor, 'front_thigh.L', 0, .48 * strikeL);
        bend(actor, 'front_shin.L', 0, -.27 * strikeL);
        bend(actor, 'front_foot.L', 0, .3 * strikeL);
        bend(actor, 'shoulder.R', 0, -.2 * strikeR);
        bend(actor, 'front_thigh.R', 0, .48 * strikeR);
        bend(actor, 'front_shin.R', 0, -.27 * strikeR);
        bend(actor, 'front_foot.R', 0, .3 * strikeR);
        bend(actor, 'TailBase', 0, 0, .12 * Math.sin(t * 4));
        if (ball && stripe && ballHome && stripeHome) {
          ball.position.copyFrom(ballHome); stripe.position.copyFrom(stripeHome);
          const dx = .42 * first - .37 * second, dz = .08 * first + .04 * second;
          ball.position.x += dx; ball.position.z += dz;
          stripe.position.x += dx; stripe.position.z += dz;
          if (ballRotation) ball.rotation.z = ballRotation.z - dx / .12;
          if (stripeRotation) stripe.rotation.z = stripeRotation.z - dx / .12;
        }
      } else if (actor.activity === 'mouse') {
        const reach = Math.max(0, 1 - Math.abs(t - .9) / .42);
        const secondReach = Math.max(0, 1 - Math.abs(t - 2.35) / .42);
        const first = ease((t - .9) / .35), second = ease((t - 2.35) / .35);
        bend(actor, 'spine.009', 0, .13);
        bend(actor, 'Head', .1 * Math.sin(t * 3), .19 + .1 * Math.max(reach, secondReach));
        bend(actor, 'front_thigh.L', 0, .45 * reach);
        bend(actor, 'front_shin.L', 0, -.28 * reach);
        bend(actor, 'front_foot.L', 0, .29 * reach);
        bend(actor, 'front_thigh.R', 0, .45 * secondReach);
        bend(actor, 'front_shin.R', 0, -.28 * secondReach);
        bend(actor, 'front_foot.R', 0, .29 * secondReach);
        bend(actor, 'TailBase', 0, 0, .14 * Math.sin(t * 4));
        mouseParts.forEach((part, i) => {
          part.position.copyFrom(mousePartHomes[i]);
          part.position.x -= .26 * first - .2 * second;
          part.position.y += .07 * Math.sin(Math.PI * ease((t - .9) / .55));
        });
      }
    }
    if (actor.time < actor.duration) return;
    if (actor.activity === 'tower' || actor.activity === 'window') beginJump(index, false);
    else finish(index);
  }
  function tick(dt: number) {
    if (paused) return;
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
      else tickJump(index, dt);
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
        beginJump(index, false, () => wait(index, 1.5));
      } else wait(index, index ? 2.8 : 1.2);
    });
  }
  function stopForMode(onGround: (index: number) => void) {
    enabled = false; paused = false;
    cats.forEach((cat, index) => {
      const elevated = cat.supportY > .1 || cat.root.position.y > cat.baseY + .15;
      interrupt(index);
      if (elevated) beginJump(index, false, () => onGround(index));
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
  function commandMouse(index: number): boolean {
    if (mouseOwner >= 0 && mouseOwner !== index) return false;
    if (cats[index].supportY > .1) return false;
    startActivity(index, 'mouse'); return true;
  }
  function returnToFloor(index: number, done: () => void) {
    const cat = cats[index]; interrupt(index);
    if (cat.supportY > .1 || cat.root.position.y > cat.baseY + .15) beginJump(index, false, done);
    else done();
  }
  function resetImmediate() {
    enabled = false; paused = false;
    cats.forEach((cat, index) => {
      interrupt(index); cat.supportY = 0; cat.root.position.y = cat.baseY; cat.root.rotation.x = 0;
    });
    towerOwner = -1; windowOwner = -1; ballOwner = -1; mouseOwner = -1;
  }
  function pause(value: boolean) {
    paused = value;
    if (!value) actors.forEach((actor, index) => {
      if (actor.pose) group(cats[index]).pause();
    });
  }
  return { tick, startRelax, stopForMode, interrupt, placed, commandTower, commandWindow, commandMouse, returnToFloor,
    resetImmediate, pause, canPerch: (index: number) => towerOwner < 0 || towerOwner === index,
    isTransitioning: (index: number) => actors[index].stage === 'jump-up' || actors[index].stage === 'jump-down',
    isEnabled: () => enabled };
}
