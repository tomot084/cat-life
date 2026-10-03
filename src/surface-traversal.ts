import { Matrix, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { Companion } from './interactions';
import { footTargets, motionEase, motionUnit, type FootTarget } from './cat-motion';
import { surfacePoint, traversalKind, type CatSurface, type TraversalKind } from './tower-surfaces';

type JointRest = { node: TransformNode; rotation: Quaternion };
type PawTrack = { front: boolean; side: 'L' | 'R'; local: Vector3; origin: Vector3; stance: Vector3; destination: Vector3; point: Vector3; bodyPoint: Vector3; locked: boolean };
export type TraversalDebug = { kind: TraversalKind; phase: string; from: string; to: string; feet: { front: boolean; side: string; target: number[]; actual: number[]; surfaceY: number; locked: boolean; error: number }[] };
const average = (points: Vector3[]) => points.reduce((a,p)=>a.add(p),Vector3.Zero()).scale(1/Math.max(1,points.length));
const heading = (from: Vector3, to: Vector3) => Math.atan2(to.x-from.x,to.z-from.z);
const turn = (from: number,to: number,t: number) => from+Math.atan2(Math.sin(to-from),Math.cos(to-from))*motionEase(t);
const rotate = (p:Vector3,yaw:number,pitch=0) => Vector3.TransformNormal(p,Matrix.RotationYawPitchRoll(yaw,pitch,0));

/** Contact-driven traversal. Root follows the supported feet; only high transfers have a flight. */
export function createSurfaceTraversal(cat: Companion, from: CatSurface, to: CatSurface, bodyHeight: number, previousFeet?: FootTarget[]) {
  const kind=traversalKind(from,to,bodyHeight), up=to.y>from.y, airborne=kind.startsWith('jump');
  const rests:JointRest[]=cat.nodes.filter(n=>n.rotationQuaternion).map(node=>({node,rotation:node.rotationQuaternion!.clone()}));
  const nodes=new Map(cat.nodes.map(n=>[n.name,n]));
  const startRoot=cat.root.position.clone(), initialYaw=cat.root.rotation.y;
  const endRoot=new Vector3(to.center.x,cat.baseY+to.y,to.center.z);
  const travelYaw=heading(startRoot,endRoot);
  const stanceYaw=travelYaw;
  // Top transfers face toward/away from the top bed rather than the previous route leg.
  const facing=stanceYaw;
  const endYaw=to.id==='box-roof' ? Math.PI/2 : to.y===0?travelYaw:to.y>2? -Math.PI/2 : Math.PI/2;
  const launchCenter=from.id==='box-roof' ? from.exit : from.approach;
  cat.root.computeWorldMatrix(true);
  const inverse=cat.root.getWorldMatrix().clone().invert();
  const feet=footTargets(cat.nodes);
  const tracks:PawTrack[]=feet.map(f=>{
    const unscaled=Vector3.TransformCoordinates(f.point,inverse);
    const local=unscaled.multiply(cat.root.scaling);
    const offset=rotate(local,facing), finalOffset=rotate(local,endYaw);
    const stance=surfacePoint(from,launchCenter.x+offset.x,launchCenter.z+offset.z,cat.baseY+local.y);
    const destination=surfacePoint(to,to.center.x+finalOffset.x,to.center.z+finalOffset.z,cat.baseY+local.y);
    const origin=previousFeet?.find(p=>p.front===f.front&&p.side===f.side)?.point??f.point;
    return {...f,local,origin:origin.clone(),stance,destination,point:origin.clone(),bodyPoint:origin.clone(),locked:true};
  });
  const localCenter=average(tracks.map(p=>p.local));
  const localFront=average(tracks.filter(p=>p.front).map(p=>p.local));
  const localHind=average(tracks.filter(p=>!p.front).map(p=>p.local));
  const restSpan=Math.abs(localFront.z-localHind.z)||.65;
  let time=0,phase='look',complete=false,debug:TraversalDebug;
  const orientDuration=1.12, inspectDuration=.26;
  const contactStart=orientDuration+inspectDuration;
  const gravity=cat.key==='kokoro'?13:15;
  const apex=Math.max(0,to.y-from.y)+.16;
  const velocity=up?Math.sqrt(2*gravity*apex):.15;
  const flight=(velocity+Math.sqrt(velocity*velocity-2*gravity*(to.y-from.y)))/gravity;
  const airStart=contactStart+.30, frontContact=airStart+flight;
  const duration=airborne?frontContact+.84:contactStart+1.85;
  let landingRear:Vector3[]|undefined;
  function restore() {for(const p of rests)p.node.rotationQuaternion=p.rotation.clone();}
  function bend(name:string,pitch=0,roll=0,yaw=0) {
    const rest=rests.find(p=>p.node.name===name);if(rest)rest.node.rotationQuaternion=rest.rotation.multiply(Quaternion.RotationYawPitchRoll(yaw,pitch,roll));
  }
  function swing(p:PawTrack,a:Vector3,b:Vector3,u:number,clearance=.12) {
    const t=motionUnit(u);p.locked=t===0||t===1;
    // Lift clear of the taller board before crossing its edge; do not drag through it.
    p.bodyPoint.copyFrom(Vector3.Lerp(a,b,motionEase(t)));
    if(b.y<a.y-.08) {
      p.point.copyFrom(Vector3.Lerp(a,b,motionEase(t)));
      p.point.y+=Math.sin(Math.PI*t)*.045;
      return;
    }
    const liftY=Math.max(a.y,b.y)+clearance;
    if(t<.28)p.point.copyFrom(Vector3.Lerp(a,new Vector3(a.x,liftY,a.z),motionEase(t/.28)));
    else if(t<.76)p.point.copyFrom(Vector3.Lerp(new Vector3(a.x,liftY,a.z),new Vector3(b.x,liftY,b.z),motionEase((t-.28)/.48)));
    else p.point.copyFrom(Vector3.Lerp(new Vector3(b.x,liftY,b.z),b,motionEase((t-.76)/.24)));
  }
  function solve() {
    for(const paw of tracks) {
      const end=nodes.get(`${paw.front?'front_toe':'toe'}.${paw.side}`);if(!end)continue;
      const chain=(paw.front?['front_foot','front_shin','front_thigh','shoulder']:['foot','shin','thigh','pelvis']).map(n=>nodes.get(`${n}.${paw.side}`)).filter((n):n is TransformNode=>!!n);
      for(let pass=0;pass<40;pass++) {
        end.computeWorldMatrix(true);if(Vector3.DistanceSquared(end.getAbsolutePosition(),paw.point)<.000004)break;
        for(const node of chain) {
          node.computeWorldMatrix(true);end.computeWorldMatrix(true);
          const pivot=node.getAbsolutePosition(), inv=node.getWorldMatrix().clone().invert();
          const a=Vector3.TransformNormal(end.getAbsolutePosition().subtract(pivot),inv),b=Vector3.TransformNormal(paw.point.subtract(pivot),inv);
          if(a.lengthSquared()<1e-9||b.lengthSquared()<1e-9)continue;
          a.normalize();b.normalize();const axis=Vector3.Cross(a,b),angle=Math.acos(Math.max(-1,Math.min(1,Vector3.Dot(a,b))));
          if(axis.lengthSquared()<1e-9)continue;
          node.rotationQuaternion=(node.rotationQuaternion??Quaternion.FromEulerVector(node.rotation)).multiply(Quaternion.RotationAxis(axis.normalize(),Math.min(.32,angle))).normalize();
        }
      }
    }
  }
  function supportedBody(yaw:number,crouch=0) {
    const front=average(tracks.filter(p=>p.front).map(p=>p.bodyPoint)),hind=average(tracks.filter(p=>!p.front).map(p=>p.bodyPoint));
    const delta=front.subtract(hind),horizontal=Math.hypot(delta.x,delta.z);
    const pitch=Math.max(-.80,Math.min(.80,-Math.atan2(delta.y-(localFront.y-localHind.y),Math.max(.25,horizontal))));
    cat.root.rotation.set(pitch,yaw,0);
    cat.root.position.copyFrom(average(tracks.map(p=>p.bodyPoint)).subtract(rotate(localCenter,yaw,pitch)));
    // Stretching between supports lowers the chest; it never stretches the bones.
    cat.root.position.y-=Math.min(.15,Math.max(0,horizontal-restSpan)*.22)+crouch;
  }
  function update(dt:number) {
    if(complete)return true;time=Math.min(duration,time+dt);restore();
    const orient=motionUnit((time-inspectDuration)/orientDuration),yaw=turn(initialYaw,facing,orient);
    for(const p of tracks) {p.point.copyFrom(p.stance);p.bodyPoint.copyFrom(p.stance);p.locked=true;}
    if(time<contactStart) {
      phase=time<inspectDuration?'look':'approach';
      for(const p of tracks) {
        const slot=p.front?(p.side==='L'?0:1):(p.side==='L'?2:3);
        swing(p,p.origin,p.stance,(orient*4-slot),.055);
      }
      supportedBody(yaw);
    } else if(!airborne) {
      const t=time-contactStart;phase=t<.62?(up?'forepaw-place':'forepaw-reach'):t<1.02?(up?'weight-forward':'lower-chest'):t<1.60?'hindpaw-follow':'stabilize';
      for(const p of tracks) {
        const begin=p.front?(p.side==='L'?0:.18):(p.side==='L'?1.02:1.22);
        const span=p.front?.44:.38;
        swing(p,p.stance,p.destination,(t-begin)/span,p.front?(up?.12:.07):.14);
      }
      supportedBody(facing);
      // A small chest articulation supports the contact-led body tilt, not a leg animation curve.
      bend('spine.009',up?-.06:.09);bend('spine.010',up?-.06:.12);
    } else if(time<airStart) {
      phase=up?'hindpaw-load':'edge-lower';supportedBody(facing,Math.sin(Math.PI*motionUnit((time-contactStart)/.30))*(up?.13:.05));
      bend('thigh.L',-.3);bend('thigh.R',-.3);bend('shin.L',.42);bend('shin.R',.42);
    } else if(time<frontContact) {
      phase=up?'jump-up':'jump-down';const t=time-airStart,u=t/flight;
      const launch=average(tracks.map(p=>p.stance)).subtract(rotate(localCenter,facing));
      cat.root.position.copyFrom(Vector3.Lerp(launch,endRoot,u));cat.root.position.y=launch.y+velocity*t-.5*gravity*t*t;
      const airYaw=turn(facing,endYaw,motionUnit((u-.15)/.70));cat.root.rotation.set(up?-.28*Math.sin(Math.PI*u):.28*Math.sin(Math.PI*u),airYaw,0);
      for(const p of tracks) {
        p.point.copyFrom(cat.root.position.add(rotate(p.local,airYaw,cat.root.rotation.x)));p.locked=false;
        if(p.front)p.point.copyFrom(Vector3.Lerp(p.point,p.destination,motionEase((u-.68)/.32)));
        else {p.point.y+=.15*Math.sin(Math.PI*u);}
      }
      // Last airborne rear pose is outside the arriving board. Forepaws make first contact.
      landingRear=tracks.filter(p=>!p.front).map(p=>p.point.clone());
    } else {
      const t=time-frontContact;phase=t<.43?'forepaw-support':t<.66?'hindpaw-land':'stabilize';
      let rearIndex=0;
      for(const p of tracks) {
        if(p.front){p.point.copyFrom(p.destination);p.bodyPoint.copyFrom(p.destination);p.locked=true;}
        else {
          const a=landingRear?.[rearIndex++]??p.stance;
          swing(p,a,p.destination,(t-(p.side==='L'?.04:.20))/.43,.15);
        }
      }
      supportedBody(endYaw,.035*Math.sin(Math.PI*motionUnit(t/.7)));
    }
    // Duck under the actual upper bed while using the side shelf. Exit on the front of the roof.
    const underBed=cat.root.position.y>1.25&&cat.root.position.y<2.15
      ? motionEase((-2.38-cat.root.position.z)/.28) : 0;
    cat.root.position.y-=.23*underBed;
    const lookWeight=1-motionEase((time-(duration-.25))/.25);
    bend('spine.010',.38*underBed);bend('Head',.72*underBed+(up?-.13:.26)*lookWeight);
    bend('Ear.L',0,.05*lookWeight);bend('Ear.R',0,-.05*lookWeight);
    bend('TailBase',-.30-.85*underBed,Math.sin(time*2)*.08);bend('Tail2',-.16-.24*underBed,Math.sin(time*2-.5)*.06);bend('Tail3',.05,Math.sin(time*2-1)*.05);bend('TailTip',.10,Math.sin(time*2-1.4)*.04);
    solve();
    // Small body corrections satisfy planted-paw constraints before a frame is presented.
    for(let iteration=0;iteration<8;iteration++) {
      const actual=footTargets(cat.nodes),errors=tracks.filter(p=>p.locked).map(p=>{
        const foot=actual.find(f=>f.front===p.front&&f.side===p.side);return foot?p.point.subtract(foot.point):Vector3.Zero();
      });
      const correction=average(errors).scale(.85);if(correction.length()<.001)break;
      if(correction.length()>.065)correction.normalize().scaleInPlace(.065);
      cat.root.position.addInPlace(correction);solve();
    }
    const actual=footTargets(cat.nodes);
    debug={kind,phase,from:from.id,to:to.id,feet:tracks.map(p=>{const a=actual.find(f=>f.front===p.front&&f.side===p.side)?.point??p.point;return {front:p.front,side:p.side,target:p.point.asArray(),actual:a.asArray(),surfaceY:p.point.y-cat.baseY-p.local.y,locked:p.locked,error:Vector3.Distance(a,p.point)};})};
    if(time>=duration) {complete=true;cat.supportY=to.y; if(to.id==='floor'||to.id==='top-bed') {restore();cat.root.rotation.set(0,endYaw,0);cat.root.position.copyFrom(endRoot);}}
    return complete;
  }
  return {update,restore,kind,duration,debug:()=>debug};
}
