import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, DirectionalLight, ShadowGenerator, Color3, Color4, ImportMeshAsync, TransformNode, DynamicTexture, StandardMaterial, MeshBuilder } from '@babylonjs/core';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/loaders/glTF/index.js';
import { createRoom } from './room';
import { createInteractions, type Companion, type InteractionKind } from './interactions';
import { attachRoomControls } from './controls';
import { safeFloorPoint } from './placement';
import { TOWER_PERCH } from './placement';
import { createAmbientLife } from './ambient-life';
import purinUrl from './assets/models/purin.glb?url';
import kokoroUrl from './assets/models/kokoro.glb?url';
import './production.css';

(async () => {
  const canvas = document.querySelector('canvas')!;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
  const setRenderResolution = () => {
    const cssPixels = Math.max(1, canvas.clientWidth * canvas.clientHeight);
    const scale = Math.max(1, Math.min(devicePixelRatio || 1, 2, Math.sqrt(2_000_000 / cssPixels)));
    engine.setHardwareScalingLevel(1 / scale);
  };
  setRenderResolution();
  const scene = new Scene(engine);
  scene.clearColor = new Color4(.94, .925, .89, 1);
  scene.ambientColor = new Color3(.12, .1, .08);
  const camera = new ArcRotateCamera('room-camera', 1.20, 1.12, canvas.clientWidth < 600 ? 13.4 : 9.6, new Vector3(0, .85, 0), scene);
  camera.lowerRadiusLimit = 4; camera.upperRadiusLimit = 16;
  camera.upperBetaLimit = 1.5; camera.lowerBetaLimit = .25;
  camera.storeState();
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
    const x = index ? 1.15 : -1.15, z = .5;
    root.scaling.setAll(scale); root.position.set(x, .025 - lo.y * scale, z);
    cats.push({ key, name, root, meshes: result.meshes, nodes: result.transformNodes, groups: result.animationGroups,
      homeX: x, homeZ: z, baseX: x, baseY: root.position.y, supportY: 0, baseZ: z, walkX: x, walkZ: z,
      action: '', angle: index ? Math.PI : 0 });
  }
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
      contact.position.set(cat.root.position.x, cat.supportY + .021, cat.root.position.z);
      contact.rotation.y = cat.root.rotation.y;
    });
  });
  const selectionMat = new StandardMaterial('selection ring', scene);
  selectionMat.diffuseColor = Color3.FromHexString('#e9bd80');
  selectionMat.emissiveColor = Color3.FromHexString('#c0925b'); selectionMat.alpha = .7;
  const selection = MeshBuilder.CreateTorus('selected-cat-ring', { diameter: .92, thickness: .027, tessellation: 40 }, scene);
  selection.material = selectionMat; selection.isPickable = false;
  const towerMarker = MeshBuilder.CreateTorus('tower-landing-ring', { diameter: 1.08, thickness: .042, tessellation: 40 }, scene);
  towerMarker.position.set(TOWER_PERCH.x, TOWER_PERCH.y + .035, TOWER_PERCH.z);
  towerMarker.material = selectionMat; towerMarker.isPickable = false; towerMarker.setEnabled(false);
  let mode = 'relax', paused = false, selected = 0, grabbed = -1;
  const status = document.querySelector<HTMLOutputElement>('#interaction-status')!;
  const profile = document.querySelector<HTMLElement>('#cat-profile')!;
  const dailyLife = document.querySelector<HTMLElement>('#daily-life')!;
  const dailyLabels = ['のんびり', 'のんびり'];
  const setBase = (index: number, x: number, z: number) => {
    const cat = cats[index]; cat.baseX = x; cat.baseZ = z;
    cat.walkX = x - .42 * Math.sin(cat.angle); cat.walkZ = z - .42 * Math.cos(cat.angle);
  };
  const interactions = createInteractions(scene, cats, camera, text => { status.textContent = text; }, setBase);
  const play = (cat: Companion, action: string) => {
    for (const group of cat.groups) group.stop();
    cat.groups.find(g => g.name === action)!.start(true); cat.action = action;
    if (paused) cat.groups.find(g => g.name === action)!.pause();
  };
  const ambient = createAmbientLife(scene, cats, play, setBase, (index, activity, label) => {
    dailyLabels[index] = label;
    dailyLife.textContent = `ぷーたん：${dailyLabels[0]} · こころ：${dailyLabels[1]}`;
    canvas.dataset[index ? 'kokoroActivity' : 'purinActivity'] = activity;
    if (activity === 'tower' && label === 'タワーの上' && status.textContent === `${cats[index].name}がタワーへ向かいます。`) {
      status.textContent = `${cats[index].name}がタワーにのぼりました。`;
    }
  }, index => interactions.isActive(cats[index]));
  function update() {
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    document.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.cat) === selected)));
    document.querySelector('#pause')!.textContent = paused ? '再生' : '一時停止';
    document.querySelectorAll<HTMLButtonElement>('[data-interaction]').forEach(b => { b.disabled = paused; });
    profile.textContent = selected ? 'こころ · 黒灰白' : 'ぷーたん · 茶白';
    dailyLife.hidden = mode !== 'relax';
  }
  function select(index: number) {
    selected = index; update();
    status.textContent = `${cats[index].name}を選びました。`;
  }
  const applyModeCat = (i: number) => {
      const cat = cats[i];
      cat.angle = i ? Math.PI : 0;
      cat.walkX = cat.baseX - .42 * Math.sin(cat.angle);
      cat.walkZ = cat.baseZ - .42 * Math.cos(cat.angle);
      cat.root.position.set(cat.baseX, cat.baseY, cat.baseZ);
      cat.supportY = 0; cat.root.rotation.x = 0;
      const next = mode;
      cat.root.rotation.y = next === 'walk' ? Math.atan2(Math.cos(cat.angle), -Math.sin(cat.angle)) : i ? -.18 : .18;
      play(cat, next === 'walk' ? 'WalkCycle' : next === 'sit' ? 'IdleSit' : i ? 'IdleSit' : 'IdleNorm');
  };
  const setMode = (next: string) => {
    interactions.cancel(paused); mode = next; paused = false;
    if (next === 'relax') ambient.startRelax();
    else ambient.stopForMode(applyModeCat);
    status.textContent = 'ふたりの、いつものひととき。'; update();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode!); });
  document.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach(b => { b.onclick = () => select(Number(b.dataset.cat)); });
  document.querySelectorAll<HTMLButtonElement>('[data-interaction]').forEach(b => {
    b.onclick = () => {
      const kind = b.dataset.interaction as InteractionKind;
      if (!paused) {
        if (ambient.isTransitioning(selected) || (kind === 'call' && cats[selected].supportY > .1)) {
          ambient.returnToFloor(selected, () => interactions.start(selected, kind, paused));
        } else {
          ambient.interrupt(selected);
          interactions.start(selected, kind, paused);
        }
      }
      document.querySelector<HTMLDetailsElement>('#more-actions')!.open = false;
    };
  });
  document.querySelectorAll<HTMLButtonElement>('[data-extra]').forEach(b => {
    b.onclick = () => {
      const extra = b.dataset.extra;
      if (extra === 'focus') {
        camera.setTarget(cats[selected].root.position.add(new Vector3(0, .8, 0)));
        camera.radius = 5.6; status.textContent = `${cats[selected].name}の近くへ。`;
      } else if (extra === 'reset-all') {
        ambient.resetImmediate();
        cats.forEach((cat, index) => {
          setBase(index, cat.homeX, cat.homeZ);
          cat.root.position.set(cat.homeX, cat.baseY, cat.homeZ);
        });
        setMode('relax'); camera.restoreState(); status.textContent = 'ふたりも視点も、元の場所へ。';
      } else if (extra === 'tower') {
        if (mode !== 'relax') setMode('relax');
        interactions.cancel(false);
        status.textContent = ambient.commandTower(selected) ? `${cats[selected].name}がタワーへ向かいます。` : 'タワーは今、順番待ちです。';
      } else if (extra === 'hide') {
        document.body.classList.add('ui-hidden');
        document.querySelector<HTMLButtonElement>('#show-ui')!.hidden = false;
      }
      document.querySelector<HTMLDetailsElement>('#more-actions')!.open = false;
    };
  });
  document.querySelector<HTMLButtonElement>('#show-ui')!.onclick = () => {
    document.body.classList.remove('ui-hidden');
    document.querySelector<HTMLButtonElement>('#show-ui')!.hidden = true;
  };
  document.querySelector('#pause')!.addEventListener('click', () => {
    paused = !paused; interactions.pause(paused);
    ambient.pause(paused);
    status.textContent = paused ? 'ひとやすみ中。再生すると、またふれあえます。' : 'ふたりの時間が、また動きはじめました。'; update();
  });
  document.querySelector('#reset')!.addEventListener('click', () => camera.restoreState());
  let grabState: { index: number; group: Companion['groups'][number]; frame: number } | undefined;
  let grabSurface: 'floor' | 'tower' = 'floor';
  attachRoomControls(canvas, scene, camera, cats, {
    select,
    canPerch: index => ambient.canPerch(index),
    grab(index) {
      interactions.cancel(paused); ambient.interrupt(index);
      const cat = cats[index], group = cat.groups.find(g => g.name === cat.action)!;
      grabState = { index, group, frame: group.getCurrentFrame() };
      for (const g of cat.groups) g.stop();
      const idle = cat.groups.find(g => g.name === (cat.action === 'IdleSit' ? 'IdleSit' : 'IdleNorm'))!;
      idle.start(true); idle.goToFrame(idle.from); idle.pause();
      grabbed = index; cat.root.position.y = cat.baseY + cat.supportY + .035;
      towerMarker.setEnabled(ambient.canPerch(index)); grabSurface = cat.supportY > .1 ? 'tower' : 'floor';
      status.textContent = `${cat.name}をつかみました。床の好きな場所へ。`;
    },
    move(index, x, z, surface) {
      const cat = cats[index];
      if (surface === 'tower') {
        cat.supportY = TOWER_PERCH.y;
        cat.root.position.set(TOWER_PERCH.x, cat.baseY + TOWER_PERCH.y + .035, TOWER_PERCH.z);
      } else {
        const other = cats[1 - index].root.position;
        const point = safeFloorPoint(x, z, { x: other.x, z: other.z });
        cat.supportY = 0; cat.root.position.set(point.x, cat.baseY + .035, point.z);
      }
      if (grabSurface !== surface) {
        grabSurface = surface;
        status.textContent = surface === 'tower' ? 'ここに離すとタワーの上にのせられます。' : '床の好きな場所に置けます。';
      }
    },
    drop(index) {
      if (grabbed !== index || !grabState) return;
      const cat = cats[index]; cat.root.position.y = cat.baseY + cat.supportY;
      setBase(index, cat.root.position.x, cat.root.position.z);
      for (const g of cat.groups) g.stop();
      grabState.group.start(true); grabState.group.goToFrame(grabState.frame);
      if (paused) grabState.group.pause();
      if (cat.supportY > .1 && mode !== 'relax') setMode('relax');
      ambient.placed(index); towerMarker.setEnabled(false);
      grabbed = -1; grabState = undefined;
      status.textContent = cat.supportY > .1 ? `${cat.name}をタワーの上にのせました。` : `${cat.name}をここに置きました。`;
    },
  });
  setMode('relax'); await scene.whenReadyAsync();
  document.querySelector('#loading')!.remove();
  document.querySelectorAll<HTMLButtonElement>('button').forEach(b => { if (b.id !== 'show-ui') b.disabled = false; });
  engine.runRenderLoop(() => {
    const elapsed = engine.getDeltaTime() / 1000;
    const dt = Math.min(elapsed, .05);
    if (mode === 'walk' && !paused) cats.forEach((cat, index) => {
      if (grabbed === index || cat.supportY > .1 || ambient.isTransitioning(index) || interactions.isActive(cat)) return;
      cat.angle += dt * .45;
      cat.root.position.x = cat.walkX + .42 * Math.sin(cat.angle);
      cat.root.position.z = cat.walkZ + .42 * Math.cos(cat.angle);
      cat.root.rotation.y = Math.atan2(Math.cos(cat.angle), -Math.sin(cat.angle));
    });
    ambient.tick(Math.min(elapsed, .25));
    interactions.tick(Math.min(elapsed, .25), paused);
    selection.position.set(cats[selected].root.position.x, cats[selected].supportY + .05, cats[selected].root.position.z);
    selection.visibility = grabbed === selected ? 1 : .6;
    scene.render();
  });
  addEventListener('resize', setRenderResolution);
  new ResizeObserver(setRenderResolution).observe(canvas);
  canvas.dataset.ready = 'true';
})().catch(error => {
  const loading = document.querySelector('#loading');
  if (loading) loading.textContent = 'お部屋を読み込めませんでした。ページを再読み込みしてください。';
  console.error(error);
});
