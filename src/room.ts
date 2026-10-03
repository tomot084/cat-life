import { Color3, DynamicTexture, ImportMeshAsync, Mesh, MeshBuilder, PBRMaterial, Ray, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import treeUrl from './assets/room/cat-tree.glb?url';
import perchUrl from './assets/room/cat-perch.glb?url';
import scratcherUrl from './assets/room/cat-scratcher.glb?url';
import bedUrl from './assets/room/cat-bed.glb?url';
import shelfUrl from './assets/room/bookcaseOpenLow.glb?url';
import booksUrl from './assets/room/books.glb?url';
import pillowUrl from './assets/room/pillow.glb?url';
import plantUrl from './assets/room/plantSmall1.glb?url';
import { TOWER_PERCH, WINDOW_PERCH } from './placement';

export function material(scene: Scene, name: string, hex: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor.setAll(.06);
  return mat;
}

// Small, deterministic, code-drawn surfaces; no photo or remote texture requests.
function surface(scene: Scene, kind: 'wood' | 'linen'): DynamicTexture {
  const texture = new DynamicTexture(kind, { width: 512, height: 512 }, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  let seed = 37;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.fillStyle = kind === 'wood' ? '#cfb58c' : '#c4c9b4';
  ctx.fillRect(0, 0, 512, 512);
  if (kind === 'wood') {
    for (let row = 0; row < 8; row++) {
      ctx.fillStyle = `rgba(102,69,36,${.02 + random() * .08})`;
      ctx.fillRect(0, row * 64, 512, 64);
      ctx.fillStyle = 'rgba(89,68,44,.22)';
      ctx.fillRect(0, row * 64, 512, 1);
      ctx.fillRect((row % 3) * 170, row * 64, 1, 64);
      for (let j = 0; j < 40; j++) {
        ctx.strokeStyle = `rgba(109,74,42,${random() * .13})`;
        ctx.beginPath();
        const y = row * 64 + random() * 64;
        ctx.moveTo(0, y); ctx.bezierCurveTo(170, y + 2, 340, y - 2, 512, y); ctx.stroke();
      }
    }
  } else {
    for (let i = 0; i < 512; i += 3) {
      ctx.fillStyle = `rgba(255,255,241,${.08 + random() * .1})`;
      ctx.fillRect(i, 0, 1, 512); ctx.fillRect(0, i, 512, 1);
    }
    ctx.strokeStyle = '#e0dfca'; ctx.lineWidth = 10; ctx.strokeRect(14, 14, 484, 484);
    ctx.lineWidth = 2; ctx.strokeRect(25, 25, 462, 462);
  }
  texture.update();
  return texture;
}

export async function createRoom(scene: Scene, shadows: ShadowGenerator): Promise<void> {
  const wood = material(scene, 'warm oak', '#ffffff'); wood.diffuseTexture = surface(scene, 'wood');
  const wall = material(scene, 'warm plaster', '#eee7da');
  wall.emissiveColor.set(.12, .11, .09);
  const trim = material(scene, 'ivory joinery', '#f4ecdf');
  const linen = material(scene, 'woven sage', '#ffffff'); linen.diffuseTexture = surface(scene, 'linen');
  const ceramic = material(scene, 'cream ceramic', '#e8dfcd'); ceramic.specularColor.setAll(.25);
  const rope = material(scene, 'sisal', '#b99b74');
  const peach = material(scene, 'terracotta', '#c88e72');
  const finish = (mesh: Mesh, position: number[], mat: StandardMaterial, cast = true) => {
    mesh.position.set(position[0], position[1], position[2]); mesh.material = mat;
    mesh.receiveShadows = true; mesh.isPickable = false;
    if (cast) shadows.addShadowCaster(mesh);
    return mesh;
  };
  const box = (name: string, size: number[], position: number[], mat = wood, cast = true) =>
    finish(MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene), position, mat, cast);
  const cylinder = (name: string, diameter: number, height: number, position: number[], mat = ceramic) =>
    finish(MeshBuilder.CreateCylinder(name, { diameter, height, tessellation: 32 }, scene), position, mat);
  box('floor', [9, .18, 7], [0, -.1, 0], wood, false);
  box('back-wall', [9, 3.25, .14], [0, 1.53, -3.5], wall, false);
  box('side-wall', [.14, 3.25, 7], [-4.5, 1.53, 0], wall, false);
  box('back-skirting', [9, .15, .06], [0, .075, -3.4], trim);
  box('side-skirting', [.06, .15, 7], [-4.4, .075, 0], trim);
  box('rug', [4.7, .026, 3.6], [.1, .005, .45], linen, false);
  // Window, deep sill and gently folded curtains frame the cats without a photo backdrop.
  box('window-frame', [3, 1.72, .16], [.1, 2.02, -3.35], trim);
  const outdoors = new DynamicTexture('window view', { width: 512, height: 320 }, scene, false);
  const view = outdoors.getContext() as CanvasRenderingContext2D;
  const horizon = view.createLinearGradient(0, 0, 0, 320);
  horizon.addColorStop(0, '#b7d8dd'); horizon.addColorStop(.63, '#ecdfc7'); horizon.addColorStop(1, '#9ba991');
  view.fillStyle = horizon; view.fillRect(0, 0, 512, 320);
  view.fillStyle = '#e8e7d0'; view.beginPath(); view.arc(380, 68, 30, 0, Math.PI * 2); view.fill();
  for (let layer = 0; layer < 3; layer++) {
    view.fillStyle = ['#c1cbb4', '#92a899', '#6f8e7b'][layer];
    const base = 235 + layer * 22;
    view.beginPath(); view.moveTo(0, 320); view.lineTo(0, base);
    for (let x = 0; x <= 512; x += 16) view.lineTo(x, base - 8 - 13 * Math.sin(x * .018 + layer * 2) - 7 * Math.sin(x * .053 + layer));
    view.lineTo(512, 320); view.fill();
  }
  outdoors.update();
  const sky = material(scene, 'garden through window', '#ffffff'); sky.diffuseTexture = outdoors;
  sky.emissiveColor.set(.19, .19, .17);
  box('window', [2.8, 1.52, .035], [.1, 2.02, -3.25], sky, false);
  for (const x of [-.62, .82]) box('window-mullion', [.045, 1.56, .07], [x, 2.02, -3.2], trim);
  box('window-crossbar', [2.85, .05, .07], [.1, 2.0, -3.2], trim);
  // A shallow sill and one small padded cat perch sit within the window width.
  box('window-sill', [3.05, .09, .29], [.1, 1.085, -3.24], wood);
  box('window-perch-base', [1.55, .08, .78], [WINDOW_PERCH.x, 1.085, WINDOW_PERCH.z], wood);
  const bracket = box('window-perch-bracket', [1.1, .1, .42], [WINDOW_PERCH.x, .9, -3.17], trim);
  bracket.rotation.x = -.55;
  const cushion = material(scene, 'window cushion', '#b4bca8');
  box('window-cushion', [1.38, .05, .69], [WINDOW_PERCH.x, 1.145, WINDOW_PERCH.z], cushion);
  const curtain = material(scene, 'curtain linen', '#f6efdf');
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
    const fold = cylinder('curtain-fold', .15, 1.93, [.1 + side * (1.37 + i * .07), 1.95, -3.05], curtain);
    fold.scaling.z = .65;
  }
  box('curtain-rail', [3.85, .045, .045], [.1, 2.97, -3.06], rope);

  // All furniture stays outside both existing walking circles and the interaction space.
  async function prop(url: string, name: string, height: number, position: number[], yaw = 0) {
    const result = await ImportMeshAsync(url, scene, { pluginExtension: '.glb' });
    const root = new TransformNode(name, scene);
    for (const node of [...result.meshes, ...result.transformNodes]) if (!node.parent) node.parent = root;
    const bounds = root.getHierarchyBoundingVectors(true);
    const scale = height / (bounds.max.y - bounds.min.y);
    const center = bounds.min.add(bounds.max).scale(.5);
    // Center the model in its own coordinates before applying its room orientation.
    const placement = new TransformNode(`${name}-placement`, scene);
    root.parent = placement; root.scaling.setAll(scale);
    root.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    placement.position.set(...position as [number, number, number]); placement.rotation.y = yaw;
    for (const mesh of result.meshes) {
      mesh.isPickable = false; mesh.receiveShadows = true;
      if (mesh.getTotalVertices()) shadows.addShadowCaster(mesh);
    }
    // Soften the original saturated palette. Geometry and downloaded files remain intact.
    for (const mesh of result.meshes) if (mesh.material instanceof PBRMaterial) {
      const mat = mesh.material;
      const palette: Record<string, string> = { mint: '#a6b69a', blush: '#c99680', wool: '#eee1ca' };
      if (palette[mat.name]) mat.albedoColor = Color3.FromHexString(palette[mat.name]);
      mat.roughness = .92;
    }
    return placement;
  }
  const tree = await prop(treeUrl, 'cat-tree', 2.7, [-3.05, 0, -2.25]);
  // Widen the source furniture for the cats' paw spread; keep its original height.
  tree.scaling.set(1.4, 1, 1.4);
  const treeMeshes = tree.getChildMeshes(false);
  for (const mesh of treeMeshes) {
    mesh.isPickable = true; mesh.metadata = { catLanding: 'tower' };
    mesh.computeWorldMatrix(true);
  }
  const landing = scene.pickWithRay(new Ray(new Vector3(TOWER_PERCH.x, 4, TOWER_PERCH.z), new Vector3(0, -1, 0)), mesh => treeMeshes.includes(mesh));
  if (!landing?.hit || !landing.pickedPoint || Math.abs(landing.pickedPoint.y - TOWER_PERCH.y) > .015)
    throw new Error(`Cat tree landing does not match its visible surface: ${landing?.pickedPoint?.y}`);
  // Visible, supported approach steps keep the cats out of the cramped side shelf.
  for (const [name, x, y, z] of [
    ['tower-low-step', -.23, .48, -1.72],
    ['tower-middle-step', -1.35, 1.04, -1.94],
  ] as const) {
    const board = box(name, [1.12, .075, 1.08], [x, y - .0375, z], trim);
    board.isPickable = true; board.metadata = { catLanding: 'tower' };
    for (const dx of [-.36, .36]) {
      const post = cylinder(`${name}-support`, .12, y - .075, [x + dx, (y - .075) / 2, z], rope);
      post.metadata = { towerSupport: true };
    }
  }
  await prop(perchUrl, 'round-cat-bed', 1.15, [3.85, .015, -1.65]);
  await prop(scratcherUrl, 'cat-scratcher', .32, [-3.15, .015, .1], Math.PI / 2);
  await prop(bedUrl, 'cat-bed', .43, [3.15, .015, -.45]);
  await prop(shelfUrl, 'bookcase', 1.1, [2.85, 0, -2.97]);
  await prop(booksUrl, 'books', .33, [2.6, 1.1, -2.93], -.1);
  await prop(plantUrl, 'plant', .42, [1.48, 1.14, -3.12]);
  await prop(pillowUrl, 'pillow', .38, [3.15, .10, -.6], .25);

  // A feeding corner with visibly recessed bowls and separate water and kibble.
  box('feeding-mat', [1.7, .018, .9], [3.2, .005, 2.35], linen, false);
  const water = material(scene, 'water', '#81b1b4'); water.specularColor.setAll(.65);
  const food = material(scene, 'kibble', '#725237');
  for (const [i, x] of [2.78, 3.62].entries()) {
    cylinder(i ? 'water-bowl' : 'food-bowl', .63, .12, [x, .09, 2.35]);
    finish(MeshBuilder.CreateTorus('bowl-rim', { diameter: .54, thickness: .1, tessellation: 32 }, scene), [x, .16, 2.35], ceramic);
    cylinder('bowl-interior', .45, .01, [x, .152, 2.35], i ? water : food);
    if (!i) for (let n = 0; n < 13; n++) {
      const angle = n * 2.4, radius = .04 + .12 * ((n % 4) / 3);
      const bit = finish(MeshBuilder.CreateSphere('kibble', { diameter: .055, segments: 6 }, scene), [x + Math.cos(angle) * radius, .178, 2.35 + Math.sin(angle) * radius], food, false);
      bit.scaling.y = .65;
    }
  }
  const ball = finish(MeshBuilder.CreateSphere('toy-ball', { diameter: .24, segments: 16 }, scene), [-1.7, .13, 2.03], peach);
  const stripe = finish(MeshBuilder.CreateTorus('ball-stripe', { diameter: .237, thickness: .018, tessellation: 24 }, scene), [-1.7, .13, 2.03], ceramic, false);
  stripe.rotation.z = .7; ball.rotation.z = .7;
  const wand = box('toy-wand', [.035, .035, .85], [-2.8, .04, 1.7], wood);
  wand.rotation.y = -.6;
  const string = MeshBuilder.CreateTube('toy-string', { path: [new Vector3(-2.55,.03,1.35), new Vector3(-2.28,.03,1.2), new Vector3(-2.15,.03,1.38)], radius: .009, tessellation: 6 }, scene);
  string.material = rope; string.isPickable = false;
  const feather = finish(MeshBuilder.CreateSphere('toy-feather', { diameter: .15, segments: 8 }, scene), [-2.14, .06, 1.4], peach);
  feather.scaling.set(.7, .5, 2);
  // A soft tunnel, felt mouse and crinkle box make the floor read as a lived-in play space.
  const tunnel = material(scene, 'tunnel canvas', '#b9aa8c');
  const tunnelInside = material(scene, 'tunnel lining', '#9c937b');
  tunnelInside.backFaceCulling = false;
  for (const z of [1.45, 1.73, 2.01]) {
    const ring = finish(MeshBuilder.CreateTorus('play-tunnel-ring', { diameter: .72, thickness: .075, tessellation: 20 }, scene), [-3.42, .38, z], tunnel);
    ring.rotation.x = Math.PI / 2;
  }
  const tunnelBody = finish(MeshBuilder.CreateCylinder('play-tunnel', { diameter: .68, height: .56, tessellation: 20, cap: 0 }, scene), [-3.42, .38, 1.73], tunnelInside);
  tunnelBody.rotation.x = Math.PI / 2;
  const mouse = finish(MeshBuilder.CreateSphere('felt-mouse', { diameter: .18, segments: 12 }, scene), [-2.56, .095, .82], cushion);
  mouse.scaling.set(1.25, .68, .75);
  for (const x of [-2.61, -2.51]) finish(MeshBuilder.CreateSphere('mouse-ear', { diameter: .08, segments: 8 }, scene), [x, .19, .83], peach);
  const mouseTail = MeshBuilder.CreateTube('mouse-tail', { path: [new Vector3(-2.44,.08,.83), new Vector3(-2.25,.06,.89), new Vector3(-2.15,.07,1.04)], radius: .014 }, scene);
  mouseTail.material = rope; mouseTail.isPickable = false;
}
