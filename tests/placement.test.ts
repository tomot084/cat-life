import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { floorSegmentClear, LIFE_SPOTS, planFloorRoute, safeFloorPoint, TOWER_APPROACH } from '../src/placement';

test('dragged cats remain on floor and outside furniture', () => {
  const other = { x: 1.1, z: .5 };
  for (const [x, z] of [[-99, -99], [99, 99], [-3.05, -2.25], [3.15, -.45], [3.2, 2.35], [1.1, .5], [0, 0]]) {
    const p = safeFloorPoint(x, z, other);
    assert(p.x >= -3.82 && p.x <= 3.82 && p.z >= -2.82 && p.z <= 2.82);
    assert(Math.hypot(p.x - other.x, p.z - other.z) >= .88);
    for (const [cx, cz, radius] of [[-3.05, -2.25, 1], [3.15, -.45, 1.05], [2.85, -2.97, 1], [3.2, 2.35, .68], [-3.15, .1, .75]]) {
      assert(Math.hypot(p.x - cx, p.z - cz) >= radius, `${x}, ${z} overlapped furniture`);
    }
  }
});

test('daily routes stay clear of furniture and the other cat', () => {
  const destinations = [TOWER_APPROACH, LIFE_SPOTS.bed, LIFE_SPOTS.food, LIFE_SPOTS.water,
    LIFE_SPOTS.ball, ...LIFE_SPOTS.wander];
  const other = { x: .9, z: .45 };
  for (const from of destinations) for (const to of destinations) {
    const start = safeFloorPoint(from.x, from.z, other);
    const route = planFloorRoute(start, to, other);
    assert(route.length > 0, `No route from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
    let previous = start;
    for (const point of route) {
      assert(floorSegmentClear(previous, point, other), `Blocked segment ${JSON.stringify(previous)} to ${JSON.stringify(point)}`);
      previous = point;
    }
  }
});
