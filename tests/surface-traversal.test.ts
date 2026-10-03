import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { NullEngine, Scene, TransformNode, Quaternion, Vector3 } from '@babylonjs/core';
import type { Companion } from '../src/interactions';
import { createSurfaceTraversal } from '../src/surface-traversal';
import { traversalKind, type CatSurface } from '../src/tower-surfaces';

const surface=(id:string,y:number,x:number):CatSurface=>({id,y,center:{x,z:0},bounds:{minX:-3,maxX:3,minZ:-3,maxZ:3},approach:{x,z:0},exit:{x,z:0},yaw:Math.PI/2});
function rig(scene:Scene) {
 const root=new TransformNode('cat',scene),nodes:TransformNode[]=[];
 for(const front of [true,false])for(const side of ['L','R']) {
  let parent=root;
  for(const [i,name] of (front?['front_thigh','front_shin','front_foot','front_toe']:['thigh','shin','foot','toe']).entries()) {
   const n=new TransformNode(`${name}.${side}`,scene);n.parent=parent;n.rotationQuaternion=Quaternion.Identity();
   n.position.copyFrom(i===0?new Vector3(side==='L'?-.12:.12,.6,front?.2:-.40):i===1?new Vector3(0,-.26,-.04):i===2?new Vector3(0,-.24,.07):new Vector3(0,-.06,.10));
   nodes.push(n);parent=n;
  }
 }
 root.rotation.y=Math.PI/2;
 return {key:'purin',root,nodes,baseY:0,supportY:0} as Companion;
}

test('low transfers keep forepaw contacts fixed while hind paws remain on the previous support',()=>{
 for(const up of [true,false]) {
  const engine=new NullEngine(),scene=new Scene(engine),cat=rig(scene);
  const from=surface('source',up?0:.2,0),to=surface('destination',up?.2:0,.50);
  cat.root.position.y=from.y;cat.supportY=from.y;
  const lengths=cat.nodes.map(n=>n.position.asArray()),motion=createSurfaceTraversal(cat,from,to,1.25);
  assert.equal(motion.kind,up?'climb':'step-down');
  const contacts:ReturnType<typeof motion.debug>[]=[];let elapsed=0;
  while(elapsed<motion.duration) {
   motion.update(1/120);elapsed+=1/120;const debug=motion.debug();
   if(debug.phase===(up?'weight-forward':'lower-chest'))contacts.push(debug);
   assert(cat.root.position.asArray().every(Number.isFinite));
  }
  assert(contacts.length>20);
  const reference=contacts[0];
  for(const debug of contacts)for(const foot of debug.feet) {
   assert(foot.locked,'Weight transfer must have stationary forepaws and rear support');
   const original=reference.feet.find(f=>f.front===foot.front&&f.side===foot.side)!;
   assert.deepEqual(foot.target,original.target,'A planted target must not slide with the root');
   assert(Math.abs(foot.surfaceY-(foot.front?to.y:from.y))<1e-6);
  }
  assert.deepEqual(cat.nodes.map(n=>n.position.asArray()),lengths,'IK must not stretch bones');
  assert.equal(cat.supportY,to.y);
  scene.dispose();engine.dispose();
 }
});

test('height selects contact steps in both directions and reserves flight for high transfers',()=>{
 const floor=surface('floor',0,0);
 assert.equal(traversalKind(floor,surface('low',.15,1),1.25),'climb');
 assert.equal(traversalKind(surface('low',.15,1),floor,1.25),'step-down');
 assert.equal(traversalKind(floor,surface('high',1.67,1),1.25),'jump-up');
 assert.equal(traversalKind(surface('high',1.67,1),floor,1.25),'jump-down');
});
