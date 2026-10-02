import { ArcRotateCamera, Matrix, Ray, Scene, Vector3 } from '@babylonjs/core';
import { TOWER_PERCH } from './placement';
import type { Companion } from './interactions';

type PointerState = { x: number; y: number; startX: number; startY: number; cat: number; moved: boolean };
type ControlEvents = {
  select: (index: number) => void;
  dismiss: () => void;
  canGrab: () => boolean;
  grab: (index: number) => void;
  canPerch: (index: number) => boolean;
  move: (index: number, x: number, z: number, surface: 'floor' | 'tower') => void;
  drop: (index: number) => void;
};
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));

export function attachRoomControls(canvas: HTMLCanvasElement, scene: Scene, camera: ArcRotateCamera,
  cats: Companion[], events: ControlEvents) {
  const room = canvas.closest('.room-view') ?? canvas;
  for (const eventName of ['contextmenu', 'dragstart', 'selectstart']) {
    room.addEventListener(eventName, event => event.preventDefault());
  }
  const pointers = new Map<number, PointerState>();
  let holdTimer: number | undefined, grabbed = -1, pinchDistance = 0;
  let grabOffsetX = 0, grabOffsetZ = 0;
  type Gesture = 'idle' | 'cat-pending' | 'cat-selected' | 'cat-carry' | 'camera-orbit' | 'pinch-zoom';
  let gesture: Gesture = 'idle';
  const setGesture = (next: Gesture) => { gesture = next; canvas.dataset.gesture = next; };
  setGesture('idle');
  const clearHold = () => { if (holdTimer !== undefined) clearTimeout(holdTimer); holdTimer = undefined; };
  const local = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  function pickCat(x: number, y: number) {
    // GPU skinning leaves Babylon's default triangle picking in the bind pose.
    // Hit-test the rendered bone deformation on pointer down, not every frame.
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
    let selected = -1, closest = Infinity;
    const a = Vector3.Zero(), b = Vector3.Zero(), c = Vector3.Zero();
    cats.forEach((cat, index) => {
      for (const mesh of cat.meshes) {
        if (!mesh.getTotalVertices()) continue;
        mesh.computeWorldMatrix(true);
        const vertices = mesh.getPositionData(true, true), indices = mesh.getIndices();
        if (!vertices || !indices) continue;
        const world = mesh.getWorldMatrix(), localRay = Ray.Transform(ray, Matrix.Invert(world));
        for (let triangle = 0; triangle < indices.length; triangle += 3) {
          Vector3.FromArrayToRef(vertices, indices[triangle] * 3, a);
          Vector3.FromArrayToRef(vertices, indices[triangle + 1] * 3, b);
          Vector3.FromArrayToRef(vertices, indices[triangle + 2] * 3, c);
          const hit = localRay.intersectsTriangle(a, b, c); if (!hit || hit.distance < 0) continue;
          const point = Vector3.TransformCoordinates(localRay.origin.add(localRay.direction.scale(hit.distance)), world);
          const distance = Vector3.DistanceSquared(ray.origin, point);
          if (distance < closest) { closest = distance; selected = index; }
        }
      }
    });
    return selected;
  }
  function floorPoint(x: number, y: number, height = 0) {
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
    if (ray.direction.y >= -.001) return undefined;
    const distance = (height - ray.origin.y) / ray.direction.y;
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
    if (pointers.size === 1) setGesture(cat >= 0 ? 'cat-pending' : 'idle');
    if (pointers.size === 1 && cat >= 0) {
      clearHold();
      holdTimer = window.setTimeout(() => {
        const state = pointers.get(event.pointerId);
        if (!state || !events.canGrab() || gesture !== 'cat-pending' || pointers.size !== 1) return;
        grabbed = cat; setGesture('cat-carry');
        const ground = floorPoint(state.x, state.y, Math.max(0, cats[cat].root.position.y - cats[cat].baseY));
        grabOffsetX = ground ? cats[cat].root.position.x - ground.x : 0;
        grabOffsetZ = ground ? cats[cat].root.position.z - ground.z : 0;
        events.select(cat); events.grab(cat);
      }, event.pointerType === 'touch' ? 420 : 380);
    } else if (pointers.size === 2) {
      clearHold(); setGesture('pinch-zoom');
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
      const perch = scene.pick(point.x, point.y, mesh => mesh.metadata?.catLanding === 'tower');
      if (perch?.hit && Math.abs(perch.pickedPoint!.y - TOWER_PERCH.y) < .035 && events.canPerch(grabbed)) {
        events.move(grabbed, perch.pickedPoint!.x, perch.pickedPoint!.z, 'tower'); return;
      }
      const floor = floorPoint(point.x, point.y);
      if (floor) events.move(grabbed, floor.x + grabOffsetX, floor.z + grabOffsetZ, 'floor');
      return;
    }
    // A cat owns its pointer for the whole gesture, including finger drift.
    if (state.cat >= 0 || gesture === 'pinch-zoom') return;
    if (Math.hypot(point.x - state.startX, point.y - state.startY) > 8) {
      if (gesture !== 'camera-orbit') events.dismiss();
      setGesture('camera-orbit');
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
    else if (!state.moved && pointers.size === 1 && event.type === 'pointerup') {
      if (state.cat >= 0) { events.select(state.cat); setGesture('cat-selected'); }
      else events.dismiss();
    }
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (pointers.size === 1) {
      const remaining = [...pointers.values()][0];
      remaining.startX = remaining.x; remaining.startY = remaining.y;
      remaining.moved = true;
    }
    pinchDistance = 0;
    if (!pointers.size) setGesture('idle');
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (gesture === 'cat-carry' || gesture === 'cat-pending') return;
    camera.radius = clamp(camera.radius * Math.exp(event.deltaY * .001), camera.lowerRadiusLimit ?? 4, camera.upperRadiusLimit ?? 16);
  }, { passive: false });
  addEventListener('blur', () => {
    clearHold();
    if (grabbed >= 0) events.drop(grabbed);
    grabbed = -1; pointers.clear(); pinchDistance = 0; setGesture('idle');
  });
  return { floorPoint, selectedAt: pickCat };
}
