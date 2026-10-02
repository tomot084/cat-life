// Safe floor area for the cats. Furniture occupies the edges of the room.
export type FloorPoint = { x: number; z: number };
// The middle deck was measured from the upward-facing triangles of cat-tree.glb
// after its production scale and placement are applied.
export const TOWER_PERCH = { x: -2.66, z: -2.01, y: 2.05, dropRadius: 1.22 } as const;
export const TOWER_APPROACH: FloorPoint = { x: -1.92, z: -1.24 };
export const TOWER_STEP = { x: -2.52, z: -1.68, y: 1.12 } as const;
export const WINDOW_PERCH = { x: .12, z: -2.93, y: 1.17 } as const;
export const WINDOW_APPROACH: FloorPoint = { x: .12, z: -1.45 };
export const LIFE_SPOTS = {
  bed: { x: 1.94, z: -.55 },
  food: { x: 2.78, z: 1.72 },
  water: { x: 3.62, z: 1.72 },
  ball: { x: -1.70, z: 1.57 },
  mouse: { x: -1.78, z: .82 },
  wander: [{ x: -.8, z: -.7 }, { x: .7, z: -1.25 }, { x: .8, z: 1.55 }, { x: -1.3, z: .55 }],
} as const;
const furniture = [
  { x: -3.05, z: -2.25, radius: 1.0 }, // cat tree
  { x: 3.15, z: -.45, radius: 1.05 }, // bed
  { x: 2.85, z: -2.97, radius: 1.0 }, // bookcase
  { x: 3.2, z: 2.35, radius: .68 }, // leave room for a cat's muzzle at either bowl
  { x: -3.15, z: .1, radius: .75 }, // scratching pad
];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const obstacles = (other?: FloorPoint) => other ? [...furniture, { ...other, radius: .88 }] : furniture;

export function isFloorSafe(x: number, z: number, other?: FloorPoint): boolean {
  if (x < -3.82 || x > 3.82 || z < -2.82 || z > 2.82) return false;
  return obstacles(other).every(item => Math.hypot(x - item.x, z - item.z) >= item.radius);
}

export function floorSegmentClear(a: FloorPoint, b: FloorPoint, other?: FloorPoint): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .12);
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    if (!isFloorSafe(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, other)) return false;
  }
  return true;
}

export function safeFloorPoint(x: number, z: number, other?: FloorPoint): FloorPoint {
  const blockers = obstacles(other);
  let point = { x: clamp(x, -3.82, 3.82), z: clamp(z, -2.82, 2.82) };
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const item of blockers) {
      let dx = point.x - item.x, dz = point.z - item.z;
      let distance = Math.hypot(dx, dz);
      if (distance >= item.radius) continue;
      if (distance < .0001) { dx = item.x > 0 ? -1 : 1; dz = item.z > 0 ? -1 : 1; distance = Math.SQRT2; }
      let px = item.x + dx * (item.radius + .015) / distance;
      let pz = item.z + dz * (item.radius + .015) / distance;
      if (px < -3.82 || px > 3.82 || pz < -2.82 || pz > 2.82) {
        const inward = Math.hypot(item.x, item.z) || 1;
        px = item.x - item.x / inward * (item.radius + .015);
        pz = item.z - item.z / inward * (item.radius + .015);
      }
      point = { x: clamp(px, -3.82, 3.82), z: clamp(pz, -2.82, 2.82) };
      changed = true;
    }
    if (!changed) break;
  }
  return point;
}

// A small grid finds a clear route around the tree, bed and feeding station.
// The result is smoothed so walking stays natural rather than following grid corners.
export function planFloorRoute(from: FloorPoint, destination: FloorPoint, other?: FloorPoint): FloorPoint[] {
  const start = safeFloorPoint(from.x, from.z, other);
  const goal = safeFloorPoint(destination.x, destination.z, other);
  if (floorSegmentClear(start, goal, other)) return [goal];
  const step = .38, cols = 21, rows = 15;
  const nodes = Array.from({ length: cols * rows }, (_, id) => ({
    x: -3.8 + (id % cols) * step, z: -2.66 + Math.floor(id / cols) * step,
  }));
  const nearest = (point: FloorPoint) => {
    let best = -1, distance = Infinity;
    nodes.forEach((node, id) => {
      const d = Math.hypot(node.x - point.x, node.z - point.z);
      if (d < distance && isFloorSafe(node.x, node.z, other) && floorSegmentClear(point, node, other)) {
        best = id; distance = d;
      }
    });
    return best;
  };
  const source = nearest(start), target = nearest(goal);
  if (source < 0 || target < 0) return [];
  const scores = Array(nodes.length).fill(Infinity) as number[];
  const parents = Array(nodes.length).fill(-1) as number[];
  const open = new Set<number>([source]); scores[source] = 0;
  while (open.size) {
    let current = -1, best = Infinity;
    for (const id of open) {
      const score = scores[id] + Math.hypot(nodes[id].x - nodes[target].x, nodes[id].z - nodes[target].z);
      if (score < best) { best = score; current = id; }
    }
    if (current === target) break;
    open.delete(current);
    const col = current % cols, row = Math.floor(current / cols);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const x = col + dx, z = row + dz;
      if (x < 0 || x >= cols || z < 0 || z >= rows) continue;
      const next = z * cols + x;
      if (!isFloorSafe(nodes[next].x, nodes[next].z, other) || !floorSegmentClear(nodes[current], nodes[next], other)) continue;
      const score = scores[current] + Math.hypot(dx, dz) * step;
      if (score < scores[next]) { scores[next] = score; parents[next] = current; open.add(next); }
    }
  }
  if (source !== target && parents[target] < 0) return [];
  const raw: FloorPoint[] = [goal];
  for (let id = target; id !== source; id = parents[id]) raw.push(nodes[id]);
  raw.push(nodes[source], start); raw.reverse();
  const route: FloorPoint[] = [];
  for (let at = 0; at < raw.length - 1;) {
    let next = raw.length - 1;
    while (next > at + 1 && !floorSegmentClear(raw[at], raw[next], other)) next--;
    route.push(raw[next]); at = next;
  }
  return route;
}
