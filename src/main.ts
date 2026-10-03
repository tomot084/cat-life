import { Matrix, Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, DirectionalLight, ShadowGenerator, Color3, Color4, ImportMeshAsync, TransformNode, DynamicTexture, StandardMaterial, MeshBuilder } from '@babylonjs/core';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/loaders/glTF/index.js';
import { createRoom } from './room';
import { createInteractions, type Companion, type InteractionKind } from './interactions';
import { attachRoomControls } from './controls';
import { safeFloorPoint } from './placement';
import { TOWER_PERCH, WINDOW_PERCH } from './placement';
import { createAmbientLife } from './ambient-life';
import { createScruffCarry } from './scruff-carry';
import { catProportions } from './cat-proportions';
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
  // All room input belongs to controls.ts, including multi-touch.
  scene.detachControl();
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
  for (const [index, [key, name, url]] of [['purin', 'ぷりん', purinUrl], ['kokoro', 'こころ', kokoroUrl]].entries()) {
    const result = await ImportMeshAsync(url, scene, { pluginExtension: '.glb' });
    const root = new TransformNode(key, scene);
    for (const node of [...result.meshes, ...result.transformNodes]) if (!node.parent) node.parent = root;
    for (const g of result.animationGroups) g.stop();
    const idle = result.animationGroups.find(g => g.name === 'IdleNorm')!;
    idle.start(true); idle.goToFrame(idle.from); idle.pause(); scene.render();
    let lo = new Vector3(Infinity, Infinity, Infinity);
    for (const mesh of result.meshes.filter(m => m.getTotalVertices())) {
      mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo({ applySkeleton: true });
      const bounds = mesh.getBoundingInfo().boundingBox;
      lo = Vector3.Minimize(lo, bounds.minimumWorld);
      shadows.addShadowCaster(mesh); mesh.receiveShadows = true;
    }
    // Tail length must not change body size. Proportions are baked into mesh and rig.
    const proportions = catProportions[key as keyof typeof catProportions];
    const scale = proportions.displayBodyHeight / proportions.bodyHeight;
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
  const towerMarker = MeshBuilder.CreateTorus('tower-landing-ring', { diameter: .72, thickness: .03, tessellation: 40 }, scene);
  towerMarker.position.set(TOWER_PERCH.x, TOWER_PERCH.y + .035, TOWER_PERCH.z);
  towerMarker.material = selectionMat; towerMarker.isPickable = false; towerMarker.setEnabled(false);
  let mode = 'relax', paused = false, selected = 0, grabbed = -1, hasSelection = false;
  const actionPanel = document.querySelector<HTMLElement>('#cat-actions')!;
  document.querySelector('#close-actions')!.addEventListener('click', () => { actionPanel.hidden = true; hasSelection = false; });
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
    const nextGroup = cat.groups.find(g => g.name === action)!;
    nextGroup.enableBlending = true; nextGroup.blendingSpeed = .12;
    nextGroup.speedRatio = 1;
    nextGroup.start(true); cat.action = action;
    if (paused) cat.groups.find(g => g.name === action)!.pause();
  };
  const ambient = createAmbientLife(scene, cats, play, setBase, (index, activity, label) => {
    dailyLabels[index] = label;
    dailyLife.textContent = `ぷりん：${dailyLabels[0]} · こころ：${dailyLabels[1]}`;
    canvas.dataset[index ? 'kokoroActivity' : 'purinActivity'] = activity;
    if (activity === 'tower' && label === 'タワーの上' && status.textContent === `${cats[index].name}がタワーへ向かいます。`) {
      status.textContent = `${cats[index].name}がタワーにのぼりました。`;
    }
    if (activity === 'window' && label === '窓辺でひなたぼっこ' && status.textContent === `${cats[index].name}が窓辺へ向かいます。`) {
      status.textContent = `${cats[index].name}が窓辺でひなたぼっこ。`;
    }
    if (activity === 'mouse' && label === 'ねずみ遊び' && status.textContent === `${cats[index].name}がねずみのおもちゃへ向かいます。`) {
      status.textContent = `${cats[index].name}がねずみのおもちゃに前足を伸ばしました。`;
    }
  }, index => interactions.isActive(cats[index]) || grabbed === index);
  const carry = createScruffCarry();
  function update() {
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    document.querySelector('#pause')!.textContent = paused ? '再生' : '一時停止';
    document.querySelectorAll<HTMLButtonElement>('[data-interaction]').forEach(b => { b.disabled = paused; });
    profile.textContent = cats[selected].name;
    dailyLife.hidden = mode !== 'relax';
  }
  function positionActionPanel() {
    if (!actionPanel.hidden && canvas.clientWidth > 600) {
      const projected = Vector3.Project(cats[selected].root.position.add(new Vector3(0, 1.25, 0)), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight));
      const width = actionPanel.offsetWidth, height = actionPanel.offsetHeight;
      const top = Math.max(12, Math.min(canvas.clientHeight - height - 12, projected.y - 30));
      const candidates = [projected.x + 42, projected.x - width - 42]
        .map(left => Math.max(12, Math.min(canvas.clientWidth - width - 12, left)));
      const overlap = (left: number) => cats.reduce((score, cat) => {
        const head = cat.nodes.find(node => node.name === 'Head'); head?.computeWorldMatrix(true);
        const point = Vector3.Project(head?.getAbsolutePosition() ?? cat.root.position,
          Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight));
        const x = Math.max(0, Math.min(left + width, point.x + 45) - Math.max(left, point.x - 45));
        const y = Math.max(0, Math.min(top + height, point.y + 85) - Math.max(top, point.y - 25));
        return score + x * y;
      }, 0);
      candidates.sort((a, b) => overlap(a) - overlap(b));
      actionPanel.style.left = `${candidates[0]}px`;
      actionPanel.style.top = `${top}px`;
    }
  }
  function select(index: number) {
    selected = index; hasSelection = true; canvas.dataset.selectedCat = cats[index].key; actionPanel.hidden = false; update(); positionActionPanel();
    status.textContent = `${cats[index].name}を選びました。`;
  }
  const applyModeCat = (i: number) => {
      const cat = cats[i];
      cat.angle = i ? Math.PI : 0;
      cat.walkX = cat.baseX - .42 * Math.sin(cat.angle);
      cat.walkZ = cat.baseZ - .42 * Math.cos(cat.angle);
      cat.root.position.set(cat.baseX, cat.baseY, cat.baseZ);
      cat.supportY = 0; cat.root.rotation.x = 0; cat.root.rotation.z = 0;
      const next = mode;
      cat.root.rotation.y = next === 'walk' ? Math.atan2(Math.cos(cat.angle), -Math.sin(cat.angle)) : i ? -.18 : .18;
      play(cat, next === 'walk' ? 'WalkCycle' : next === 'sit' ? 'IdleSit' : i ? 'IdleSit' : 'IdleNorm');
  };
  const setMode = (next: string) => {
    actionPanel.hidden = true;
    carry.finish();
    grabbed = -1; grabState = undefined; towerMarker.setEnabled(false);
    interactions.cancel(paused); mode = next; paused = false;
    if (next === 'relax') ambient.startRelax();
    else ambient.stopForMode(applyModeCat);
    status.textContent = 'ふたりの、いつものひととき。'; update();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode!); });
  document.querySelectorAll<HTMLButtonElement>('[data-interaction]').forEach(b => {
    b.onclick = () => {
      const index = selected;
      const kind = b.dataset.interaction as InteractionKind | 'toy';
      if (!paused) {
        if (kind === 'toy') {
          const go = () => { status.textContent = ambient.commandBall(index) ? `${cats[index].name}とボールで遊ぼう。` : 'ボールは今、順番待ちです。'; };
          interactions.cancel(false);
          if (cats[index].supportY > .1) ambient.returnToFloor(index, go); else go();
        } else if (ambient.isTransitioning(index) || (kind === 'call' && cats[index].supportY > .1)) {
          ambient.returnToFloor(index, () => interactions.start(index, kind, paused));
        } else {
          ambient.interrupt(index);
          interactions.start(index, kind, paused);
        }
      }
      document.querySelector<HTMLDetailsElement>('#more-actions')!.open = false;
      if (b.dataset.interaction === 'call' || b.dataset.interaction === 'toy' || ['mouse', 'tower', 'window', 'focus'].includes(b.dataset.extra ?? '')) actionPanel.hidden = true;
    };
  });
  document.querySelectorAll<HTMLButtonElement>('[data-extra]').forEach(b => {
    b.onclick = () => {
      const index = selected;
      const extra = b.dataset.extra;
      if (extra === 'focus') {
        camera.setTarget(cats[index].root.position.add(new Vector3(0, .8, 0)));
        camera.radius = 5.6; status.textContent = `${cats[index].name}の近くへ。`;
      } else if (extra === 'reset-all') {
        interactions.cancel(paused);
        carry.finish();
        grabbed = -1; grabState = undefined; towerMarker.setEnabled(false);
        ambient.resetImmediate();
        cats.forEach((cat, index) => {
          setBase(index, cat.homeX, cat.homeZ);
          cat.root.position.set(cat.homeX, cat.baseY, cat.homeZ);
        });
        setMode('relax'); camera.restoreState(); status.textContent = 'ふたりも視点も、元の場所へ。';
      } else if (extra === 'tower') {
        if (mode !== 'relax') setMode('relax');
        interactions.cancel(false);
        const go = () => { status.textContent = ambient.commandTower(index) ? `${cats[index].name}がタワーへ向かいます。` : 'タワーは今、順番待ちです。'; };
        if (cats[index].supportY > .1 && Math.hypot(cats[index].root.position.x - TOWER_PERCH.x, cats[index].root.position.z - TOWER_PERCH.z) > .9)
          ambient.returnToFloor(index, go);
        else go();
      } else if (extra === 'window') {
        if (mode !== 'relax') setMode('relax');
        interactions.cancel(false);
        const go = () => { status.textContent = ambient.commandWindow(index) ? `${cats[index].name}が窓辺へ向かいます。` : '窓辺は今、順番待ちです。'; };
        if (cats[index].supportY > .1 && Math.hypot(cats[index].root.position.x - WINDOW_PERCH.x, cats[index].root.position.z - WINDOW_PERCH.z) > .9)
          ambient.returnToFloor(index, go);
        else go();
      } else if (extra === 'mouse') {
        if (mode !== 'relax') setMode('relax');
        interactions.cancel(false);
        const go = () => { status.textContent = ambient.commandMouse(index) ? `${cats[index].name}がねずみのおもちゃへ向かいます。` : 'ねずみのおもちゃは今、順番待ちです。'; };
        if (cats[index].supportY > .1) ambient.returnToFloor(index, go);
        else go();
      } else if (extra === 'hide') {
        document.body.classList.add('ui-hidden');
        document.querySelector<HTMLButtonElement>('#show-ui')!.hidden = false;
      }
      document.querySelector<HTMLDetailsElement>('#more-actions')!.open = false;
      if (b.dataset.interaction === 'call' || b.dataset.interaction === 'toy' || ['mouse', 'tower', 'window', 'focus'].includes(b.dataset.extra ?? '')) actionPanel.hidden = true;
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
    dismiss: () => { actionPanel.hidden = true; hasSelection = false; },
    canGrab: () => !paused,
    canPerch: index => ambient.canPerch(index),
    grab(index) {
      carry.finish();
      interactions.cancel(paused); ambient.interrupt(index);
      const cat = cats[index], group = cat.groups.find(g => g.name === cat.action)!;
      grabState = { index, group, frame: group.getCurrentFrame() };
      for (const g of cat.groups) g.stop();
      const idle = cat.groups.find(g => g.name === 'IdleNorm')!;
      idle.start(true); idle.goToFrame(idle.from); idle.pause();
      carry.grab(cat); grabbed = index;
      towerMarker.setEnabled(ambient.canPerch(index)); grabSurface = cat.supportY > .1 ? 'tower' : 'floor';
      actionPanel.hidden = true;
      status.textContent = `${cat.name}をつかみました。床の好きな場所へ。`;
    },
    move(index, x, z, surface) {
      const cat = cats[index];
      if (surface === 'tower') {
        cat.supportY = TOWER_PERCH.y;
        cat.root.rotation.y = Math.PI / 2;
        carry.move(TOWER_PERCH.x, TOWER_PERCH.z, cat.supportY);
      } else {
        const other = cats[1 - index].root.position;
        const point = safeFloorPoint(x, z, { x: other.x, z: other.z });
        cat.supportY = 0; carry.move(point.x, point.z, 0);
      }
      if (grabSurface !== surface) {
        grabSurface = surface;
        status.textContent = surface === 'tower' ? 'ここに離すとタワーの上にのせられます。' : '床の好きな場所に置けます。';
      }
    },
    drop(index) {
      if (grabbed !== index || !grabState) return;
      const cat = cats[index], saved = grabState;
      towerMarker.setEnabled(false);
      carry.drop(() => {
        setBase(index, cat.root.position.x, cat.root.position.z);
        for (const g of cat.groups) g.stop();
        saved.group.start(true); saved.group.goToFrame(saved.frame);
        if (paused) saved.group.pause();
        if (cat.supportY > .1 && mode !== 'relax') setMode('relax');
        ambient.placed(index); grabState = undefined; grabbed = -1;
      });
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
      if (grabbed === index || cat.supportY > .1 || ambient.isBusy(index) || interactions.isActive(cat)) return;
      if (cat.action !== 'WalkCycle') play(cat, 'WalkCycle');
      cat.angle += dt * .45;
      cat.root.position.x = cat.walkX + .42 * Math.sin(cat.angle);
      cat.root.position.z = cat.walkZ + .42 * Math.cos(cat.angle);
      cat.root.rotation.y = Math.atan2(Math.cos(cat.angle), -Math.sin(cat.angle));
    });
    if (mode === 'sit' && !paused) cats.forEach((cat, index) => {
      if (grabbed !== index && !ambient.isBusy(index) && !interactions.isActive(cat) && cat.action !== 'IdleSit') play(cat, 'IdleSit');
    });
    ambient.tick(Math.min(elapsed, .25));
    interactions.tick(Math.min(elapsed, .25), paused);
    if (!paused) {
      let carryTime = Math.min(elapsed, .25);
      while (carryTime > 0) { const step = Math.min(carryTime, 1 / 60); carry.tick(step); carryTime -= step; }
    }
    selection.position.set(cats[selected].root.position.x, cats[selected].supportY + .05, cats[selected].root.position.z);
    selection.setEnabled(hasSelection || grabbed >= 0);
    selection.visibility = grabbed === selected ? 1 : .6;
    cats.forEach(cat => {
      const head = cat.nodes.find(node => node.name === 'Head');
      head?.computeWorldMatrix(true);
      const screen = Vector3.Project(head?.getAbsolutePosition() ?? cat.root.position.add(new Vector3(0, .75, 0)), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight));
      canvas.dataset[`${cat.key}Screen`] = JSON.stringify({ x: screen.x, y: screen.y });
      canvas.dataset[`${cat.key}Position`] = JSON.stringify(cat.root.position.asArray());
    });
    const perchScreen = Vector3.Project(new Vector3(TOWER_PERCH.x, TOWER_PERCH.y, TOWER_PERCH.z), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight));
    canvas.dataset.towerScreen = JSON.stringify({x: perchScreen.x, y: perchScreen.y});
    canvas.dataset.camera = JSON.stringify([camera.alpha, camera.beta, camera.radius]);
    scene.render();
  });
  addEventListener('resize', () => { setRenderResolution(); positionActionPanel(); });
  new ResizeObserver(setRenderResolution).observe(canvas);
  canvas.dataset.ready = 'true';
})().catch(error => {
  const loading = document.querySelector('#loading');
  if (loading) loading.textContent = 'お部屋を読み込めませんでした。ページを再読み込みしてください。';
  console.error(error);
});
