import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { AnimationGroup, MeshBuilder, NullEngine, Scene, TransformNode } from '@babylonjs/core';
import { createAmbientLife, type DailyActivity } from '../src/ambient-life';
import type { Companion } from '../src/interactions';

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
      if (label === 'タワーの上') assert(cats[index].supportY > 2);
    }, () => false);
  life.startRelax();
  for (let i = 0; i < 6000; i++) life.tick(.05);
  for (const [index, activities] of reached.entries()) {
    for (const activity of ['wander', 'sit', 'doze', 'eat', 'drink', 'ball', 'tower'] as DailyActivity[]) {
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
    const groups = ['IdleNorm', 'IdleSit', 'WalkCycle'].map(name => ({
      name, from: 0, start() { return this; }, stop() { return this; },
      goToFrame() { return this; }, pause() { return this; },
    })) as unknown as AnimationGroup[];
    return { key: root.name, name: root.name, root, meshes: [], nodes: [paw], groups,
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
  for (let i = 0; i < 7; i++) life.tick(.05);
  assert(Math.abs(cats[1].nodes[0].rotationQuaternion?.x ?? 0) > .01, 'Forepaw did not reach for the ball');
  for (let i = 0; i < 7; i++) life.tick(.05);
  assert(ball.position.x > home + .1, 'Ball did not roll after the bat');
  scene.dispose(); engine.dispose();
});
