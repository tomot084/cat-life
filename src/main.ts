import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, DirectionalLight, ShadowGenerator, Color3, Color4, ImportMeshAsync, TransformNode, PointerEventTypes, DynamicTexture, StandardMaterial, MeshBuilder } from '@babylonjs/core';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/loaders/glTF/index.js';
import { createRoom } from './room';
import { createInteractions, type Companion } from './interactions';
import purinUrl from './assets/models/purin.glb?url';
import kokoroUrl from './assets/models/kokoro.glb?url';
import './production.css';

(async () => {
  const canvas = document.querySelector('canvas')!;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
  engine.setHardwareScalingLevel(Math.max(1, devicePixelRatio / 1.5));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(.94, .925, .89, 1);
  scene.ambientColor = new Color3(.12, .1, .08);
  const camera = new ArcRotateCamera('room-camera', 1.20, 1.12, canvas.clientWidth < 600 ? 13.4 : 9.6, new Vector3(0, .85, 0), scene);
  camera.lowerRadiusLimit = 4; camera.upperRadiusLimit = 16;
  camera.upperBetaLimit = 1.5; camera.lowerBetaLimit = .25;
  camera.wheelDeltaPercentage = .015; camera.attachControl(canvas, true); camera.storeState();
  const fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene);
  fill.intensity = .95; fill.groundColor = new Color3(.56, .50, .42);
  const sun = new DirectionalLight('sun', new Vector3(-.5, -1, .7), scene);
  sun.position.set(3, 7, -4); sun.intensity = .65;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePoissonSampling = true;
  shadows.bias = .001; shadows.normalBias = .02; shadows.setDarkness(.22);
  await createRoom(scene, shadows);
  const cats: Companion[] = [];
  for (const [index, [key, name, url]] of [['purin', 'ぷーたん', purinUrl], ['kokoro', 'こころ', kokoroUrl]].entries()) {
    const result = await ImportMeshAsync(url, scene, { pluginExtension: '.glb' });
    const root = new TransformNode(key, scene);
    for (const node of [...result.meshes, ...result.transformNodes]) if (!node.parent) node.parent = root;
    for (const g of result.animationGroups) g.stop();
    const idle = result.animationGroups.find(g => g.name === 'IdleNorm')!;
    idle.start(true); idle.goToFrame(idle.from); idle.pause(); scene.render();
    let lo = new Vector3(Infinity, Infinity, Infinity), hi = lo.negate();
    for (const mesh of result.meshes.filter(m => m.getTotalVertices())) {
      mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo({ applySkeleton: true });
      const bounds = mesh.getBoundingInfo().boundingBox;
      lo = Vector3.Minimize(lo, bounds.minimumWorld); hi = Vector3.Maximize(hi, bounds.maximumWorld);
      shadows.addShadowCaster(mesh); mesh.receiveShadows = true;
    }
    const scale = (index ? 1.65 * 1.08 : 1.65) / (hi.y - lo.y);
    root.scaling.setAll(scale); root.position.set(index ? 1.15 : -1.15, .025 - lo.y * scale, .5);
    cats.push({ key, name, root, meshes: result.meshes, groups: result.animationGroups,
      baseX: root.position.x, baseY: root.position.y, baseZ: .5, action: '', angle: index ? Math.PI : 0 });
  }
  // A small soft contact shadow keeps the paws visually grounded at every camera angle.
  const contactTexture = new DynamicTexture('contact-shadow', 64, scene, false);
  const contactContext = contactTexture.getContext() as CanvasRenderingContext2D;
  const gradient = contactContext.createRadialGradient(32, 32, 3, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(62,49,34,.24)'); gradient.addColorStop(1, 'rgba(62,49,34,0)');
  contactContext.fillStyle = gradient; contactContext.fillRect(0, 0, 64, 64);
  contactTexture.hasAlpha = true; contactTexture.update();
  const contactMaterial = new StandardMaterial('soft contact', scene);
  contactMaterial.diffuseTexture = contactTexture; contactMaterial.useAlphaFromDiffuseTexture = true;
  contactMaterial.disableLighting = true; contactMaterial.emissiveColor.setAll(1);
  cats.forEach(cat => {
    const contact = MeshBuilder.CreateGround(`${cat.key}-contact`, { width: .85, height: 1.1 }, scene);
    contact.material = contactMaterial; contact.isPickable = false;
    scene.onBeforeRenderObservable.add(() => {
      contact.position.set(cat.root.position.x, .021, cat.root.position.z);
      contact.rotation.y = cat.root.rotation.y;
    });
  });
  let mode = 'relax', paused = false, selected = 0;
  const status = document.querySelector<HTMLOutputElement>('#interaction-status')!;
  const interactions = createInteractions(scene, cats, text => { status.textContent = text; });
  const play = (cat: Companion, action: string) => {
    for (const group of cat.groups) group.stop();
    cat.groups.find(g => g.name === action)!.start(true); cat.action = action;
  };
  function update() {
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    document.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.cat) === selected)));
    document.querySelector('#pause')!.textContent = paused ? '再生' : '一時停止';
    document.querySelectorAll<HTMLButtonElement>('[data-interaction]').forEach(b => { b.disabled = paused; });
  }
  const setMode = (next: string) => {
    interactions.cancel(paused); mode = next; paused = false;
    cats.forEach((cat, i) => {
      cat.root.position.set(cat.baseX, cat.baseY, cat.baseZ); cat.root.rotation.y = i ? -.18 : .18;
      cat.angle = i ? Math.PI : 0;
      play(cat, next === 'walk' ? 'WalkCycle' : next === 'sit' ? 'IdleSit' : i ? 'IdleSit' : 'IdleNorm');
    });
    status.textContent = 'ふたりの、いつものひととき。'; update();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode!); });
  document.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach(b => { b.onclick = () => { selected = Number(b.dataset.cat); update(); }; });
  document.querySelectorAll<HTMLButtonElement>('[data-interaction]').forEach(b => {
    b.onclick = () => interactions.start(selected, b.dataset.interaction as 'treat' | 'pet', paused);
  });
  // POINTERTAP excludes a drag, so orbiting the camera never accidentally pets a cat.
  scene.onPointerObservable.add(event => {
    if (event.type !== PointerEventTypes.POINTERTAP) return;
    const index = cats.findIndex(cat => cat.meshes.includes(event.pickInfo?.pickedMesh!));
    if (index < 0) return;
    selected = index; update(); interactions.start(index, 'pet', paused);
  });
  document.querySelector('#pause')!.addEventListener('click', () => {
    paused = !paused; interactions.pause(paused);
    status.textContent = paused ? 'ひとやすみ中。再生すると、またふれあえます。' : 'ふたりの時間が、また動きはじめました。'; update();
  });
  document.querySelector('#reset')!.addEventListener('click', () => camera.restoreState());
  setMode('relax'); await scene.whenReadyAsync();
  document.querySelector('#loading')!.remove();
  document.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = false; });
  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, .05);
    if (mode === 'walk' && !paused) cats.forEach(cat => {
      if (interactions.isActive(cat)) return;
      cat.angle += dt * .45;
      cat.root.position.x = cat.baseX + .42 * Math.sin(cat.angle);
      cat.root.position.z = cat.baseZ + .42 * Math.cos(cat.angle);
      cat.root.rotation.y = Math.atan2(Math.cos(cat.angle), -Math.sin(cat.angle));
    });
    interactions.tick(dt, paused); scene.render();
  });
  addEventListener('resize', () => engine.resize()); canvas.dataset.ready = 'true';
})().catch(error => {
  const loading = document.querySelector('#loading');
  if (loading) loading.textContent = 'お部屋を読み込めませんでした。ページを再読み込みしてください。';
  console.error(error);
});
