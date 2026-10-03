import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { NullEngine, Scene, TransformNode, Vector3, Quaternion } from '@babylonjs/core';
import { jumpTiming, jumpPose, plantFeet } from '../src/cat-motion';
import { createScruffCarry } from '../src/scruff-carry';
import type { Companion } from '../src/interactions';

test('jump arcs clear the higher support and arrive with downward velocity', () => {
  for (const larger of [false,true]) for (const height of [1.829,.8215,-.8215,-1.829,1.17]) {
    const t=jumpTiming(height,larger);
    const y=(s:number)=>t.velocity*s-.5*t.gravity*s*s;
    assert(Math.abs(y(t.flight)-height)<1e-9);
    assert(t.velocity-t.gravity*t.flight<0,'Paws must approach the landing from above');
    assert(y(t.velocity/t.gravity)>Math.max(0,height)+.06);
    const start=jumpPose(0,t,height>0),end=jumpPose(t.duration,t,height>0);
    assert.equal(start.compress,0);assert.equal(end.compress,0);assert.equal(end.reach,0);
    assert(Math.abs(end.frontAbsorb)<1e-8);assert(Math.abs(end.hindAbsorb)<1e-8);
  }
});

test('paw planting reduces slip without changing joint lengths, including mirrored glTF roots', () => {
  for(const reflected of [false,true]) {
    const engine=new NullEngine(),scene=new Scene(engine);const root=new TransformNode('root',scene);root.scaling.set(1,1,reflected?-1:1);
    const thigh=new TransformNode('front_thigh.L',scene);thigh.parent=root;thigh.position.y=1;
    const shin=new TransformNode('front_shin.L',scene);shin.parent=thigh;shin.position.y=-.35;
    const foot=new TransformNode('front_foot.L',scene);foot.parent=shin;foot.position.set(0,-.32,.10);
    const toe=new TransformNode('front_toe.L',scene);toe.parent=foot;toe.position.set(0,-.12,.18);
    for(const n of [thigh,shin,foot,toe])n.rotationQuaternion=Quaternion.Identity();
    toe.computeWorldMatrix(true);const goal=toe.getAbsolutePosition().add(new Vector3(.08,.08,.045));const before=Vector3.Distance(goal,toe.getAbsolutePosition());
    const lengths=[shin.position.length(),foot.position.length(),toe.position.length()];
    plantFeet([thigh,shin,foot,toe],[{front:true,side:'L',point:goal}],1,0);
    toe.computeWorldMatrix(true);assert(Vector3.Distance(goal,toe.getAbsolutePosition())<before*.85);
    assert.deepEqual([shin.position.length(),foot.position.length(),toe.position.length()],lengths);
    scene.dispose();engine.dispose();
  }
});

test('carry keeps the nape attached, bends the body visibly, and restores after landing/cancel', () => {
 for(const key of ['purin','kokoro']) {
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode(key,scene);
  const neck=new TransformNode('spine.010',scene);neck.parent=root;neck.position.set(0,.85,.3);neck.rotationQuaternion=Quaternion.Identity();
  const head=new TransformNode('Head',scene);head.parent=neck;head.position.set(0,.15,.15);head.rotationQuaternion=Quaternion.Identity();
  const cat={key,root,nodes:[neck,head],baseY:0,supportY:0} as Companion;
  const carry=createScruffCarry();carry.grab(cat);
  for(let n=0;n<120;n++){carry.move(.4,0,0);carry.tick(1/60);}
  neck.computeWorldMatrix(true);assert(Math.abs(neck.getAbsolutePosition().x-.4)<.015);
  assert(root.rotation.x<-.85,'Held body needs to hang, not remain on all fours');
  const held=root.position.clone();assert(held.asArray().every(Number.isFinite));
  let completed=0;carry.drop(()=>completed++);for(let n=0;n<70;n++)carry.tick(1/60);
  assert.equal(completed,1);assert.equal(carry.isActive(),false);assert.equal(root.position.y,0);assert.equal(root.rotation.x,0);
  assert(head.rotationQuaternion!.equals(Quaternion.Identity()));
  carry.grab(cat);carry.tick(.05);carry.finish();assert.equal(carry.isActive(),false);assert.equal(root.rotation.x,0);
  scene.dispose();engine.dispose();
 }
});
