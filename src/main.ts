import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, DirectionalLight, ShadowGenerator, Color3, Color4, ImportMeshAsync, TransformNode } from '@babylonjs/core';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/loaders/glTF/index.js';
import { createRoom } from './room';
import purinUrl from './assets/models/purin.glb?url';
import kokoroUrl from './assets/models/kokoro.glb?url';
import './production.css';
(async () => {
  const canvas = document.querySelector('canvas')!;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
  engine.setHardwareScalingLevel(Math.max(1, devicePixelRatio / 1.5));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(.92,.91,.87,1);
  const camera = new ArcRotateCamera('room-camera', 1.20, 1.12, 8.8, new Vector3(0,.65,.0), scene);
  camera.lowerRadiusLimit=4; camera.upperRadiusLimit=16; camera.upperBetaLimit=1.5; camera.lowerBetaLimit=.25;
  camera.wheelDeltaPercentage=.015; camera.attachControl(canvas,true); camera.storeState();
  const fill=new HemisphericLight('fill',new Vector3(0,1,0),scene); fill.intensity=.65; fill.groundColor=new Color3(.45,.40,.34);
  const sun=new DirectionalLight('sun',new Vector3(-.5,-1,-.5),scene); sun.position.set(3,7,4); sun.intensity=.5;
  const shadows=new ShadowGenerator(1024,sun); shadows.usePoissonSampling=true; shadows.bias=.001; shadows.normalBias=.02;
  createRoom(scene,shadows);
  const cats:any[]=[];
  for (const [index,[key,data]] of Object.entries({purin:purinUrl,kokoro:kokoroUrl}).entries()) {
    const r=await ImportMeshAsync(data,scene,{pluginExtension:'.glb'});
    const root=new TransformNode(key,scene);
    for(const node of [...r.meshes,...r.transformNodes]) if(!node.parent) node.parent=root;
    for(const g of r.animationGroups) g.stop();
    const idle=r.animationGroups.find(g=>g.name==='IdleNorm')!; idle.start(true); idle.goToFrame(idle.from); idle.pause();
    scene.render();
    let lo=new Vector3(Infinity,Infinity,Infinity),hi=lo.negate();
    for(const m of r.meshes.filter(m=>m.getTotalVertices())) {m.computeWorldMatrix(true);m.refreshBoundingInfo({applySkeleton:true}); const b=m.getBoundingInfo().boundingBox; lo=Vector3.Minimize(lo,b.minimumWorld);hi=Vector3.Maximize(hi,b.maximumWorld);shadows.addShadowCaster(m);m.receiveShadows=true;}
    const scale=(index ? 1.65*1.08 : 1.65)/(hi.y-lo.y);root.scaling.setAll(scale);root.position.set(index?1.15:-1.15,.02-lo.y*scale,.5);root.rotation.y=index?-.18:.18;
    cats.push({key,r,root,baseX:root.position.x,baseZ:.5,baseY:root.position.y,scale,action:'',angle:index?Math.PI:0});
  }
  let mode='relax',paused=false;
  function play(cat:any,action:string) {for(const g of cat.r.animationGroups)g.stop();const g=cat.r.animationGroups.find((g:any)=>g.name===action);g.start(true);cat.action=action;}
  const setMode=(next:string)=>{mode=next;cats.forEach((c,i)=>{c.root.position.set(c.baseX,c.baseY,c.baseZ);c.root.rotation.y=i?-.18:.18;play(c,next==='walk'?'WalkCycle':next==='sit'?'IdleSit':i?'IdleSit':'IdleNorm');});paused=false;update();};
  function update(){document.querySelectorAll('[data-mode]').forEach((b:any)=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));document.querySelector('#pause')!.textContent=paused?'再生':'一時停止';}
  document.querySelectorAll('[data-mode]').forEach((b:any)=>b.onclick=()=>setMode(b.dataset.mode));
  document.querySelector('#pause')!.addEventListener('click',()=>{paused=!paused;cats.forEach(c=>{const g=c.r.animationGroups.find((g:any)=>g.name===c.action);paused?g.pause():g.play(true)});update();});
  document.querySelector('#reset')!.addEventListener('click',()=>camera.restoreState());
  setMode('relax');await scene.whenReadyAsync();document.querySelector('#loading')!.remove();
  engine.runRenderLoop(()=>{if(mode==='walk'&&!paused){const dt=Math.min(engine.getDeltaTime()/1000,.05);cats.forEach(c=>{c.angle+=dt*.45;c.root.position.x=c.baseX+.42*Math.sin(c.angle);c.root.position.z=c.baseZ+.42*Math.cos(c.angle);c.root.rotation.y=Math.atan2(Math.cos(c.angle),-Math.sin(c.angle));});}scene.render();});
  addEventListener('resize',()=>engine.resize());canvas.dataset.ready='true';
})().catch(e=>{document.querySelector('#loading')!.textContent='読み込みに失敗しました';console.error(e);});
