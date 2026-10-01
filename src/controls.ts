import { ArcRotateCamera, Matrix, Scene } from '@babylonjs/core';
import type { Companion } from './interactions';

type PointerState = { x: number; y: number; startX: number; startY: number; cat: number; moved: boolean };
type ControlEvents = {
  select: (index: number) => void;
  grab: (index: number) => void;
  move: (index: number, x: number, z: number) => void;
  drop: (index: number) => void;
};
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));

export function attachRoomControls(canvas: HTMLCanvasElement, scene: Scene, camera: ArcRotateCamera,
  cats: Companion[], events: ControlEvents) {
  const pointers = new Map<number, PointerState>();
  let holdTimer: number | undefined, grabbed = -1, pinchDistance = 0;
  let grabOffsetX = 0, grabOffsetZ = 0;
  const clearHold = () => { if (holdTimer !== undefined) clearTimeout(holdTimer); holdTimer = undefined; };
  const local = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  function pickCat(x: number, y: number) {
    const hit = scene.pick(x, y, mesh => cats.some(cat => cat.meshes.includes(mesh)));
    return cats.findIndex(cat => cat.meshes.includes(hit?.pickedMesh!));
  }
  function floorPoint(x: number, y: number) {
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
    if (ray.direction.y >= -.001) return undefined;
    const distance = -ray.origin.y / ray.direction.y;
    if (distance < 0) return undefined;
    return ray.origin.add(ray.direction.scale(distance));
  }
  function distanceBetweenPointers() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    const point = local(event);
    const cat = pointers.size ? -1 : pickCat(point.x, point.y);
    pointers.set(event.pointerId, { ...point, startX: point.x, startY: point.y, cat, moved: false });
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 1 && cat >= 0) {
      clearHold();
      holdTimer = window.setTimeout(() => {
        const state = pointers.get(event.pointerId);
        if (!state || state.moved || pointers.size !== 1) return;
        grabbed = cat;
        const ground = floorPoint(state.x, state.y);
        grabOffsetX = ground ? cats[cat].root.position.x - ground.x : 0;
        grabOffsetZ = ground ? cats[cat].root.position.z - ground.z : 0;
        events.select(cat); events.grab(cat);
      }, 380);
    } else if (pointers.size === 2) {
      clearHold();
      if (grabbed >= 0) { events.drop(grabbed); grabbed = -1; }
      for (const state of pointers.values()) state.moved = true;
      pinchDistance = distanceBetweenPointers();
    }
  });
  canvas.addEventListener('pointermove', event => {
    const state = pointers.get(event.pointerId); if (!state) return;
    event.preventDefault();
    const point = local(event), dx = point.x - state.x, dy = point.y - state.y;
    state.x = point.x; state.y = point.y;
    if (pointers.size >= 2) {
      const distance = distanceBetweenPointers();
      if (pinchDistance > 0 && distance > 0) camera.radius = clamp(camera.radius * pinchDistance / distance, camera.lowerRadiusLimit ?? 4, camera.upperRadiusLimit ?? 16);
      pinchDistance = distance; return;
    }
    if (grabbed >= 0) {
      const floor = floorPoint(point.x, point.y);
      if (floor) events.move(grabbed, floor.x + grabOffsetX, floor.z + grabOffsetZ);
      return;
    }
    if (Math.hypot(point.x - state.startX, point.y - state.startY) > 7) {
      state.moved = true; clearHold();
    }
    if (state.moved) {
      camera.alpha -= dx * .006;
      camera.beta = clamp(camera.beta + dy * .006, camera.lowerBetaLimit ?? .25, camera.upperBetaLimit ?? 1.5);
    }
  });
  function end(event: PointerEvent) {
    const state = pointers.get(event.pointerId); if (!state) return;
    event.preventDefault(); clearHold();
    if (grabbed >= 0) { events.drop(grabbed); grabbed = -1; }
    else if (!state.moved && pointers.size === 1 && state.cat >= 0 && event.type === 'pointerup') events.select(state.cat);
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (pointers.size === 1) {
      const remaining = [...pointers.values()][0];
      remaining.startX = remaining.x; remaining.startY = remaining.y;
      remaining.moved = true;
    }
    pinchDistance = 0;
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    camera.radius = clamp(camera.radius * Math.exp(event.deltaY * .001), camera.lowerRadiusLimit ?? 4, camera.upperRadiusLimit ?? 16);
  }, { passive: false });
  addEventListener('blur', () => {
    clearHold();
    if (grabbed >= 0) events.drop(grabbed);
    grabbed = -1; pointers.clear(); pinchDistance = 0;
  });
  return { floorPoint, selectedAt: pickCat };
}
