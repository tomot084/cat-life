import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { AnimationGroup, NullEngine, Scene, TransformNode } from '@babylonjs/core';
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
