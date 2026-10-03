import { Vector3 } from '@babylonjs/core';

export type TraversalKind = 'climb' | 'step-down' | 'jump-up' | 'jump-down';
export type CatSurface = {
  id: string; y: number; center: { x: number; z: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  approach: { x: number; z: number }; exit: { x: number; z: number }; yaw: number;
};
// Measured from the rendered condo-cat-tree.stl, after room placement and widening.
// The 1.10 circular lip is too shallow for four paws; the box interior is not a route.
export const TOWER_SURFACES: CatSurface[] = [
  { id: 'floor', y: 0, center: { x: -3.83, z: -.91 }, bounds: { minX: -4.35, maxX: -3.1, minZ: -1.43, maxZ: -.35 }, approach: { x: -3.83, z: -.91 }, exit: { x: -3.83, z: -.91 }, yaw: 0 },
  { id: 'side-shelf', y: 1.6771, center: { x: -3.50, z: -2.72 }, bounds: { minX: -4.13, maxX: -3.10, minZ: -3.33, maxZ: -2.57 }, approach: { x: -3.50, z: -2.72 }, exit: { x: -3.45, z: -2.72 }, yaw: Math.PI / 2 },
  { id: 'box-roof', y: 1.829, center: { x: -2.39, z: -2.10 }, bounds: { minX: -2.94, maxX: -1.97, minZ: -3.16, maxZ: -1.57 }, approach: { x: -2.39, z: -2.10 }, exit: { x: -2.69, z: -2.10 }, yaw: Math.PI / 2 },
  { id: 'top-bed', y: 2.6505, center: { x: -3.05, z: -2.87 }, bounds: { minX: -3.85, maxX: -2.12, minZ: -3.19, maxZ: -2.54 }, approach: { x: -3.05, z: -2.87 }, exit: { x: -3.05, z: -2.87 }, yaw: -Math.PI / 2 },
];
export function traversalKind(from: CatSurface, to: CatSurface, height: number): TraversalKind {
  const delta = to.y - from.y;
  return Math.abs(delta) <= height * .72 ? (delta >= 0 ? 'climb' : 'step-down') : delta >= 0 ? 'jump-up' : 'jump-down';
}
export function surfacePoint(surface: CatSurface, x: number, z: number, toeHeight: number) {
  const b = surface.bounds;
  return new Vector3(Math.max(b.minX, Math.min(b.maxX, x)), surface.y + toeHeight,
    Math.max(b.minZ, Math.min(b.maxZ, z)));
}
export function towerSurfaceAt(y: number) {
  return TOWER_SURFACES.reduce((best, s) => Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best);
}
