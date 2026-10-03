import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { AnimationGroup, MeshBuilder, NullEngine, Scene, TransformNode } from '@babylonjs/core';
import { createAmbientLife, type DailyActivity } from '../src/ambient-life';
import type { Companion } from '../src/interactions';
import { TOWER_SURFACES } from '../src/tower-surfaces';
import { TOWER_PERCH, WINDOW_PERCH } from '../src/placement';

test('both cats complete the full daily routine without getting stuck', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const cats = [-1.15, 1.15].map((x, index) => {
    const root = new TransformNode(index ? 'kokoro' : 'purin', scene);
    root.position.set(x, 0, .5);
    const groups = ['IdleNorm', 'IdleSit', 'WalkCycle'].map(name => ({
      name, from: 0, start() { return this; }, stop() { return this; },
      goToFrame() { return this; }, pause() { return this; },
    })) as unknown as AnimationGroup[];
    return { key: root.name, name: root.name, root, meshes: [], nodes: [], groups,
      homeX: x, homeZ: .5, baseX: x, baseY: 0, baseZ: .5, supportY: 0,
      walkX: x, walkZ: .5, action: 'IdleNorm', angle: 0 } satisfies Companion;
  });
  const reached = [new Set<DailyActivity>(), new Set<DailyActivity>()];
  const life = createAmbientLife(scene, cats, (cat, action) => { cat.action = action; },
    (index, x, z) => { cats[index].baseX = x; cats[index].baseZ = z; },
    (index, activity, label) => {
      if (label !== 'おさんぽ中' && !label.includes('ジャンプ')) reached[index].add(activity);
      if (label === 'タワーの上') assert.equal(cats[index].supportY, TOWER_PERCH.y);
    }, () => false);
  life.startRelax();
  for (let i = 0; i < 6000; i++) life.tick(.05);
  for (const [index, activities] of reached.entries()) {
    for (const activity of ['wander', 'sit', 'doze', 'eat', 'drink', 'ball', 'mouse', 'tower', 'window'] as DailyActivity[]) {
      assert(activities.has(activity), `${cats[index].name} did not reach ${activity}: ${[...activities]}`);
    }
  }
  scene.dispose(); engine.dispose();
});

test('the ball rolls only after a forepaw reaches to bat it', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const ball = MeshBuilder.CreateSphere('toy-ball', { diameter: .24 }, scene);
  const stripe = MeshBuilder.CreateTorus('ball-stripe', { diameter: .24 }, scene);
  ball.position.set(-1.7, .13, 2.03); stripe.position.copyFrom(ball.position);
  const cats = [-1.15, 1.15].map((x, index) => {
    const root = new TransformNode(index ? 'kokoro' : 'purin', scene);
    root.position.set(x, 0, .5);
    const paw = new TransformNode('front_foot.L', scene); paw.parent = root;
    const right = new TransformNode('front_foot.R', scene); right.parent = root;
    const groups = ['IdleNorm', 'IdleSit', 'WalkCycle'].map(name => ({
      name, from: 0, start() { return this; }, stop() { return this; },
      goToFrame() { return this; }, pause() { return this; },
    })) as unknown as AnimationGroup[];
    return { key: root.name, name: root.name, root, meshes: [], nodes: [paw, right], groups,
      homeX: x, homeZ: .5, baseX: x, baseY: 0, baseZ: .5, supportY: 0,
      walkX: x, walkZ: .5, action: 'IdleNorm', angle: 0 } satisfies Companion;
  });
  let ballStarted = false;
  const life = createAmbientLife(scene, cats, (cat, action) => { cat.action = action; },
    () => {}, (index, activity, label) => {
      if (index === 1 && activity === 'ball' && label === 'ボール遊び') ballStarted = true;
    }, () => false);
  life.startRelax();
  for (let i = 0; i < 2000 && !ballStarted; i++) life.tick(.05);
  assert(ballStarted, 'Kokoro did not reach the ball');
  const home = ball.position.x;
  for (let i = 0; i < 12; i++) life.tick(.05);
  assert.equal(ball.position.x, home, 'Ball moved before the bat');
  let reached = false, rolled = false;
  for (let i = 0; i < 100; i++) {
    life.tick(.05);
    assert(cats.every(cat => cat.root.position.asArray().every(Number.isFinite)), 'Tracking must keep finite positions');
    reached ||= cats[1].nodes.some(node => Math.abs(node.rotationQuaternion?.x ?? 0) > .01);
    if (ball.position.x !== home) { assert(reached, 'Motion needs a preceding paw reach'); rolled = true; break; }
  }
  assert(rolled, 'Contact should impart velocity');
  const previous = ball.position.clone(); life.tick(.05);
  assert(ball.position.subtract(previous).length() > 0, 'Ball must retain momentum after contact');
  life.pause(true); const frozen = ball.position.clone(); life.tick(1); assert(ball.position.equals(frozen));
  scene.dispose(); engine.dispose();
});

test('tower visits actual shelves, pauses on the bed, and descends through the shelves', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const cats = [-1.15, 1.15].map((x, index) => {
    const root = new TransformNode(index ? 'kokoro' : 'purin', scene);
    root.position.set(x, 0, .5);
    const head = new TransformNode('Head', scene); head.parent = root;
    const hind = new TransformNode('thigh.L', scene); hind.parent = root;
    const groups = ['IdleNorm', 'IdleSit', 'WalkCycle'].map(name => ({
      name, from: 0, start() { return this; }, stop() { return this; },
      goToFrame() { return this; }, pause() { return this; },
    })) as unknown as AnimationGroup[];
    return { key: root.name, name: root.name, root, meshes: [], nodes: [head, hind], groups,
      homeX: x, homeZ: .5, baseX: x, baseY: 0, baseZ: .5, supportY: 0,
      walkX: x, walkZ: .5, action: 'IdleNorm', angle: 0 } satisfies Companion;
  });
  let label = '';
  const life = createAmbientLife(scene, cats, (cat, action) => { cat.action = action; },
    () => {}, (index, _activity, value) => { if (index === 0) label = value; }, () => false);
  life.startRelax();
  assert(life.commandTower(0));
  for (let i = 0; i < 1000 && label !== 'タワーをのぼる'; i++) life.tick(.05);
  assert.equal(label, 'タワーをのぼる');
  const visited=new Set<number>(); const kinds=new Set<string>();
  for(let i=0;i<300&&label!=='タワーの上';i++) {
    life.tick(.05);visited.add(cats[0].supportY);
    const debug=life.traversalDebug(0);if(debug)kinds.add(debug.kind);
    assert(cats[0].root.position.asArray().every(Number.isFinite));
  }
  for(const surface of TOWER_SURFACES)assert(visited.has(surface.y),`Missing ${surface.id}`);
  assert(kinds.has('climb'));assert(kinds.has('jump-up'));
  assert.equal(label, 'タワーの上');
  assert.equal(cats[0].root.position.y, TOWER_PERCH.y);
  assert.equal(cats[0].root.rotation.x, 0);
  life.pause(true);
  life.tick(3);
  assert.equal(cats[0].root.position.y, TOWER_PERCH.y, 'Pause should freeze the cat on the perch');
  life.pause(false);
  for (let i = 0; i < 200 && label !== 'タワーからジャンプ'; i++) life.tick(.05);
  assert.equal(label, 'タワーからジャンプ');
  const descending=new Set<number>();const downKinds=new Set<string>();
  for(let i=0;i<300&&cats[0].supportY>0;i++) {
    life.tick(.05);descending.add(cats[0].supportY);
    const debug=life.traversalDebug(0);if(debug)downKinds.add(debug.kind);
  }
  for(const surface of TOWER_SURFACES)assert(descending.has(surface.y),`Descent skipped ${surface.id}`);
  assert(downKinds.has('step-down'));assert(downKinds.has('jump-down'));
  assert.equal(cats[0].supportY, 0);
  assert.equal(cats[0].root.position.y, 0);
  scene.dispose(); engine.dispose();
});

test('window command lands on the sill and returns to the floor', () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  const cats = [-1.15, 1.15].map((x, index) => {
    const root = new TransformNode(index ? 'kokoro' : 'purin', scene); root.position.set(x, 0, .5);
    const groups = ['IdleNorm', 'IdleSit', 'WalkCycle'].map(name => ({
      name, from: 0, start() { return this; }, stop() { return this; },
      goToFrame() { return this; }, pause() { return this; },
    })) as unknown as AnimationGroup[];
    return { key: root.name, name: root.name, root, meshes: [], nodes: [], groups,
      homeX: x, homeZ: .5, baseX: x, baseY: 0, baseZ: .5, supportY: 0,
      walkX: x, walkZ: .5, action: 'IdleNorm', angle: 0 } satisfies Companion;
  });
  let label = '';
  const life = createAmbientLife(scene, cats, (cat, action) => { cat.action = action; },
    () => {}, (index, _, value) => { if (index === 0) label = value; }, () => false);
  life.startRelax(); assert(life.commandWindow(0));
  for (let i = 0; i < 500 && label !== '窓辺でひなたぼっこ'; i++) life.tick(.05);
  assert.equal(label, '窓辺でひなたぼっこ');
  assert.equal(cats[0].supportY, WINDOW_PERCH.y);
  assert.equal(cats[0].root.position.z, WINDOW_PERCH.z);
  let landed = false;
  life.returnToFloor(0, () => { landed = true; });
  for (let i = 0; i < 100 && !landed; i++) life.tick(.05);
  assert(landed); assert.equal(cats[0].supportY, 0);
  scene.dispose(); engine.dispose();
});
