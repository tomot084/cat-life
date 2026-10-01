// Safe floor area for the cats. Furniture occupies the edges of the room.
export type FloorPoint = { x: number; z: number };
const furniture = [
  { x: -3.05, z: -2.25, radius: 1.0 }, // cat tree
  { x: 3.15, z: -.45, radius: 1.05 }, // bed
  { x: 2.85, z: -2.97, radius: 1.0 }, // bookcase
  { x: 3.2, z: 2.35, radius: 1.05 }, // feeding station
  { x: -3.15, z: .1, radius: .75 }, // scratching pad
];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function safeFloorPoint(x: number, z: number, other?: FloorPoint): FloorPoint {
  const blockers = other ? [...furniture, { ...other, radius: .88 }] : furniture;
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
