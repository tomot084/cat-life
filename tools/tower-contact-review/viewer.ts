import { Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, TransformNode, ImportMeshAsync, MeshBuilder, StandardMaterial, ShadowGenerator, Ray } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { Companion } from '../../src/interactions';
import { createRoom } from '../../src/room';
import { createAmbientLife } from '../../src/ambient-life';
import { footTargets } from '../../src/cat-motion';
import { catProportions } from '../../src/cat-proportions';
import { TOWER_SURFACES } from '../../src/tower-surfaces';
import { TOWER_PERCH, TOWER_APPROACH } from '../../src/placement';
import purin from '../../src/assets/models/purin.glb?url';
import kokoro from '../../src/assets/models/kokoro.glb?url';
const w = window as any;
(async () => {
 const canvas = document.querySelector('canvas')!;
 const engine = new Engine(canvas,true,{preserveDrawingBuffer:true});
 const scene = new Scene(engine); scene.clearColor = new Color4(.92,.90,.86,1);
 const camera = new ArcRotateCamera('camera',0,1.3,6,new Vector3(0,.8,0),scene);
 const fill = new HemisphericLight('fill',new Vector3(0,1,0),scene); fill.intensity=.8;
 const sun = new DirectionalLight('sun',new Vector3(-.5,-1,.7),scene);sun.position.set(3,7,-4);sun.intensity=.65;
 const shadows=new ShadowGenerator(1024,sun);shadows.usePoissonSampling=true;shadows.bias=.001;shadows.normalBias=.02;shadows.setDarkness(.22); await createRoom(scene,shadows);
 scene.getMeshByName('back-wall')?.setEnabled(false);scene.getMeshByName('side-wall')?.setEnabled(false);
 const cats:Companion[]=[];
 for(const [i,[key,url]] of (Object.entries({purin,kokoro})).entries()) {
  const r=await ImportMeshAsync(url,scene,{pluginExtension:'.glb'});const root=new TransformNode(key,scene);
  for(const n of [...r.meshes,...r.transformNodes])if(!n.parent)n.parent=root;
  for(const g of r.animationGroups)g.stop();const idle=r.animationGroups.find(g=>g.name==='IdleNorm')!;idle.start(true);idle.goToFrame(idle.from);idle.pause();scene.render();
  let lo=Infinity;for(const m of r.meshes.filter(m=>m.getTotalVertices())) {m.computeWorldMatrix(true);m.refreshBoundingInfo({applySkeleton:true});lo=Math.min(lo,m.getBoundingInfo().boundingBox.minimumWorld.y);shadows.addShadowCaster(m);m.receiveShadows=true;}
  const prop=catProportions[key as keyof typeof catProportions];const scale=prop.displayBodyHeight/prop.bodyHeight;root.scaling.setAll(scale);const baseY=.025-lo*scale;
  cats.push({key,name:key,root,meshes:r.meshes,nodes:r.transformNodes,groups:r.animationGroups,homeX:i?1.15:-1.15,homeZ:.5,baseX:i?1.15:-1.15,baseY,supportY:0,baseZ:.5,walkX:0,walkZ:0,action:'IdleNorm',angle:0});
 }
 let labels=['',''];const play=(cat:Companion,action:string)=>{for(const g of cat.groups)g.stop();const g=cat.groups.find(g=>g.name===action)!;g.start(true);g.goToFrame(g.from);g.pause();cat.action=action;};
 const life=createAmbientLife(scene,cats,play,()=>{},(i,_,label)=>labels[i]=label,()=>false);
 function reset(i:number) {
  life.resetImmediate();labels=['',''];
  cats.forEach((c,j)=>{play(c,'IdleNorm');c.root.position.set(j===i?0:12,c.baseY,0);c.root.rotation.set(0,0,0);c.supportY=0;c.root.setEnabled(j===i);});
  scene.render();
 }
 function frame(i:number) {
  const c=cats[i];scene.render();const feet=footTargets(c.nodes);
  const joints=Object.fromEntries(c.nodes.filter(n=>['Head','spine.010','TailBase','TailTip','front_toe.L','toe.L','thigh.L','shin.L','foot.L'].includes(n.name)).map(n=>{n.computeWorldMatrix(true);return [n.name,n.getAbsolutePosition().asArray()];}));
  const surfaceSlabSamples=Object.fromEntries(TOWER_SURFACES.filter(s=>s.y>0).map(s=>[s.id,0]));
  let lo=Infinity,hi=-Infinity,skinMin=Infinity,skinMax=-Infinity,verticesFinite=true;for(const m of c.meshes.filter(m=>m.getTotalVertices())){m.refreshBoundingInfo({applySkeleton:true});const b=m.getBoundingInfo().boundingBox;lo=Math.min(lo,b.minimumWorld.y);hi=Math.max(hi,b.maximumWorld.y);
   const data=m.getPositionData(true)!;const world=m.getWorldMatrix();
   for(let n=0;n<data.length;n+=3){const p=Vector3.TransformCoordinates(Vector3.FromArray(data,n),world);verticesFinite&&=p.asArray().every(Number.isFinite);skinMin=Math.min(skinMin,p.y);skinMax=Math.max(skinMax,p.y);for(const s of TOWER_SURFACES)if(s.y>0&&p.y<s.y-.025&&p.y>s.y-.055&&p.x>s.bounds.minX+.03&&p.x<s.bounds.maxX-.03&&p.z>s.bounds.minZ+.03&&p.z<s.bounds.maxZ-.03)surfaceSlabSamples[s.id]++;}
  }
  const traversal=life.traversalDebug(i);
  const contactSurfaces=traversal?.feet.filter(f=>f.locked&&f.surfaceY>.1).map(f=>{
   const hit=scene.pickWithRay(new Ray(new Vector3(f.target[0],f.surfaceY+.08,f.target[2]),new Vector3(0,-1,0)),m=>m.metadata?.catLanding==='tower');
   return {side:f.side,front:f.front,expected:f.surfaceY,actual:hit?.pickedPoint?.y??null};
  });
  return {surfaceSlabSamples,contactSurfaces,position:c.root.position.asArray(),rotation:c.root.rotation.asArray(),feet:feet.map(f=>({front:f.front,side:f.side,point:f.point.asArray()})),joints,bounds:[lo,hi],deformedBounds:[skinMin,skinMax],verticesFinite,label:labels[i],traversal:life.traversalDebug(i)};
 }
 let seqTime=0;
 w.review = {
  start(i:number,mode:string) {
   reset(i);seqTime=0;const c=cats[i];
   if(mode==='up') {c.root.position.set(TOWER_APPROACH.x,c.baseY,TOWER_APPROACH.z);life.commandTower(i);for(let n=0;n<1200&&!life.isTransitioning(i);n++)life.tick(1/120);}
   else {c.root.position.set(TOWER_PERCH.x,c.baseY+TOWER_PERCH.y,TOWER_PERCH.z);c.root.rotation.y=-Math.PI/2;c.supportY=TOWER_PERCH.y;life.placed(i);life.returnToFloor(i,()=>{});}
   camera.target=new Vector3(-1.95,1.35,-2.05);camera.alpha=1.25;camera.beta=1.22;camera.radius=7.5;
   return frame(i);
  },
  advance(i:number,time:number) {
   while(seqTime<time-1e-8) {const dt=Math.min(1/120,time-seqTime);life.tick(dt);seqTime+=dt;}
   document.querySelector('#status')!.textContent=`${cats[i].key} t=${time.toFixed(2)} ${labels[i]}`;return frame(i);
  },
  geometry() {
   const meshes=scene.meshes.filter(m=>m.metadata?.catLanding==='tower');
   const points=[];
   for(let x=-4.2;x<-.1;x+=.12)for(let z=-3.4;z<-.25;z+=.12)for(const y of [2.8,2.0,1.8,1.2,.7]) {
    const hit=scene.pickWithRay(new Ray(new Vector3(x,y,z),new Vector3(0,-1,0)),m=>meshes.includes(m));
    if(hit?.hit&&hit.pickedPoint)points.push(hit.pickedPoint.asArray());
   }
   const triangles=[];
   for(const m of meshes) {const positions=m.getVerticesData('position'), indices=m.getIndices();if(!positions||!indices)continue;
    for(let k=0;k<indices.length;k+=3) {const v=[0,1,2].map(j=>Vector3.TransformCoordinates(Vector3.FromArray(positions,indices[k+j]*3),m.getWorldMatrix()));
     if(Math.max(...v.map(p=>p.y))-Math.min(...v.map(p=>p.y))<.003)triangles.push(v.map(p=>p.asArray()));}
   }
   return {points,triangles,meshes:meshes.map(m=>({name:m.name,bounds:[m.getBoundingInfo().boundingBox.minimumWorld.asArray(),m.getBoundingInfo().boundingBox.maximumWorld.asArray()]}))};
  },

 };
 await scene.whenReadyAsync();w.ready=true;
})().catch(e=>{w.failure=String(e);console.error(e);});
