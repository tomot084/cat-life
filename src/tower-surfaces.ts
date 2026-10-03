import { Vector3 } from '@babylonjs/core';

export type TraversalKind = 'climb' | 'step-down' | 'jump-up' | 'jump-down';
export type CatSurface = {
  id: string; y: number; center: { x: number; z: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  approach: { x: number; z: number }; exit: { x: number; z: number }; yaw: number;
};
// Every route node is a visible board. The narrow, obstructed side shelf is excluded.
export const TOWER_SURFACES: CatSurface[] = [
  { id: 'floor', y: 0, center: { x: -.22, z: -.72 }, bounds: { minX: -.85, maxX: 1.0, minZ: -1.3, maxZ: .15 }, approach: { x: -.22, z: -.72 }, exit: { x: .32, z: -.84 }, yaw: -Math.PI / 2 },
  { id: 'lower-step', y: .48, center: { x: -.23, z: -1.72 }, bounds: { minX: -.75, maxX: .29, minZ: -2.22, maxZ: -1.22 }, approach: { x: -.23, z: -1.65 }, exit: { x: -.46, z: -1.72 }, yaw: -Math.PI },
  { id: 'middle-step', y: 1.04, center: { x: -1.35, z: -1.94 }, bounds: { minX: -1.87, maxX: -.83, minZ: -2.44, maxZ: -1.44 }, approach: { x: -1.30, z: -1.94 }, exit: { x: -1.47, z: -1.94 }, yaw: -Math.PI / 2 },
  { id: 'box-roof', y: 1.829, center: { x: -2.65, z: -1.99 }, bounds: { minX: -2.94, maxX: -1.97, minZ: -3.16, maxZ: -1.57 }, approach: { x: -2.62, z: -1.99 }, exit: { x: -2.65, z: -1.99 }, yaw: -Math.PI / 2 },
  { id: 'top-bed', y: 2.6505, center: { x: -3.05, z: -2.87 }, bounds: { minX: -3.85, maxX: -2.12, minZ: -3.19, maxZ: -2.54 }, approach: { x: -3.05, z: -2.87 }, exit: { x: -3.05, z: -2.87 }, yaw: -Math.PI / 2 },
];
export function traversalKind(from: CatSurface, to: CatSurface, height: number): TraversalKind {
  const delta = to.y - from.y;
  return Math.abs(delta) <= height * .48 ? (delta >= 0 ? 'climb' : 'step-down') : delta >= 0 ? 'jump-up' : 'jump-down';
}
export function surfacePoint(surface: CatSurface, x: number, z: number, toeHeight: number) {
  const b = surface.bounds;
  return new Vector3(Math.max(b.minX, Math.min(b.maxX, x)), surface.y + toeHeight,
    Math.max(b.minZ, Math.min(b.maxZ, z)));
}
export function towerSurfaceAt(y: number) {
  return TOWER_SURFACES.reduce((best, s) => Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best);
}
