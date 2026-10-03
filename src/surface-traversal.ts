import { Matrix, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { Companion } from './interactions';
import { footTargets, motionEase, motionUnit, type FootTarget } from './cat-motion';
import { alignCatJoint, createCatLimbIK } from './cat-limb-ik';
import { traversalKind, type CatSurface, type TraversalKind } from './tower-surfaces';

type Rest = { node: TransformNode; rotation: Quaternion };
type Paw = { front: boolean; side: 'L'|'R'; local: Vector3; origin: Vector3; catch: Vector3; destination: Vector3; point: Vector3; bodyPoint: Vector3; locked: boolean; yaw: number; originYaw: number };
export type TraversalDebug = { kind: TraversalKind; phase: string; from: string; to: string; feet: { front: boolean; side: string; target: number[]; actual: number[]; surfaceY: number; locked: boolean; error: number }[] };
const average=(points:Vector3[])=>points.reduce((sum,p)=>sum.add(p),Vector3.Zero()).scale(1/Math.max(1,points.length));
const rotate=(p:Vector3,yaw:number,pitch=0)=>Vector3.TransformNormal(p,Matrix.RotationYawPitchRoll(yaw,pitch,0));
const turn=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*motionEase(t);

/** Separate forepaw catch, weight transfer, rear step and forward stride.
 * Planted contacts drive the body. Knees retain their anatomical bend plane. */
export function createSurfaceTraversal(cat:Companion,from:CatSurface,to:CatSurface,bodyHeight:number,previousFeet?:FootTarget[]) {
  const kind=traversalKind(from,to,bodyHeight),up=to.y>from.y,airborne=kind.startsWith('jump');
  const rests:Rest[]=cat.nodes.filter(node=>node.rotationQuaternion).map(node=>({node,rotation:node.rotationQuaternion!.clone()}));
  const initialYaw=cat.root.rotation.y,endYaw=to.id==='floor'?Math.atan2(to.exit.x-cat.root.position.x,to.exit.z-cat.root.position.z):up?to.yaw:Math.PI/2;
  cat.root.computeWorldMatrix(true);const inverse=cat.root.getWorldMatrix().clone().invert();
  const tracks:Paw[]=footTargets(cat.nodes).map(foot=>{
    const local=Vector3.TransformCoordinates(foot.point,inverse).multiply(cat.root.scaling);
    const origin=(previousFeet?.find(p=>p.front===foot.front&&p.side===foot.side)?.point??foot.point).clone();
    return {...foot,local,origin,catch:origin.clone(),destination:origin.clone(),point:origin.clone(),bodyPoint:origin.clone(),locked:true,yaw:initialYaw,originYaw:initialYaw};
  });
  const localCenter=average(tracks.map(p=>p.local));
  const localFront=average(tracks.filter(p=>p.front).map(p=>p.local));
  const localRear=average(tracks.filter(p=>!p.front).map(p=>p.local));
  // Translate the entire footprint into the board, preserving normal paw spacing.
  const offsets=tracks.map(p=>rotate(p.local,endYaw)),b=to.bounds;
  const arrival=to.id==='floor'?to.exit:to.center;
  let x=arrival.x,z=arrival.z;
  if(offsets.length) {
    x=Math.max(b.minX-Math.min(...offsets.map(o=>o.x)),Math.min(b.maxX-Math.max(...offsets.map(o=>o.x)),x));
    z=Math.max(b.minZ-Math.min(...offsets.map(o=>o.z)),Math.min(b.maxZ-Math.max(...offsets.map(o=>o.z)),z));
  }
  const endRoot=new Vector3(x,cat.baseY+to.y,z);
  for(const p of tracks)p.destination.copyFrom(endRoot.add(rotate(p.local,endYaw)));
  const born=tracks.map(p=>p.origin.clone());
  const originalFront=average(tracks.filter(p=>p.front).map(p=>p.origin));
  const intended=average(tracks.filter(p=>p.front).map(p=>p.destination)).subtract(originalFront);
  const prepareYaw=Math.atan2(intended.x,intended.z);
  const angle=Math.atan2(Math.sin(prepareYaw-initialYaw),Math.cos(prepareYaw-initialYaw));
  const moveHeading=new Vector3(to.center.x-from.center.x,0,to.center.z-from.center.z).normalize();
  const approachCenter=new Vector3(cat.root.position.x,0,cat.root.position.z);
  if(!airborne||!up)approachCenter.addInPlace(moveHeading.scale(airborne?.34:from.id==='floor'?.10:.20));
  const needsApproach=Vector3.DistanceSquared(approachCenter,new Vector3(cat.root.position.x,0,cat.root.position.z))>.01;
  const prepare= Math.abs(angle)>.75||needsApproach;
  const steps:{paw:Paw;a:Vector3;b:Vector3;start:number;fromYaw:number;toYaw:number}[]=[];
  const stepSpan=.085,rounds=prepare?(Math.abs(angle)>.75?3:1):0;
  let prepareTime=0;
  for(let round=1;round<=rounds;round++) {
    const yaw=initialYaw+angle*round/rounds;
    const os=tracks.map(p=>rotate(p.local,yaw));const bound=from.bounds;
    const width=Math.max(...os.map(o=>o.x))-Math.min(...os.map(o=>o.x));
    const depth=Math.max(...os.map(o=>o.z))-Math.min(...os.map(o=>o.z));
    const tuck=Math.min(1,(bound.maxX-bound.minX-.03)/width,(bound.maxZ-bound.minZ-.03)/depth);
    for(const o of os){o.x*=tuck;o.z*=tuck;}
    const cx=Math.max(bound.minX-Math.min(...os.map(o=>o.x)),Math.min(bound.maxX-Math.max(...os.map(o=>o.x)),approachCenter.x));
    const cz=Math.max(bound.minZ-Math.min(...os.map(o=>o.z)),Math.min(bound.maxZ-Math.max(...os.map(o=>o.z)),approachCenter.z));
    for(const index of [0,3,1,2]) {
      const paw=tracks[index];if(!paw)continue;
      const target=new Vector3(cx+os[index].x,from.y+cat.baseY+paw.local.y,cz+os[index].z);
      steps.push({paw,a:paw.origin.clone(),b:target,start:prepareTime,fromYaw:paw.originYaw,toYaw:yaw});
      paw.origin=target.clone();paw.originYaw=yaw;prepareTime+=stepSpan;
    }
  }
  const originFront=average(tracks.filter(p=>p.front).map(p=>p.origin));
  const finalFront=average(tracks.filter(p=>p.front).map(p=>p.destination));
  // First contact is close to the receiving edge. Reaching directly to the final
  // front stance would stretch the animal across two boards.
  const direction=finalFront.subtract(originFront);direction.y=0;
  const entering=new Vector3(Math.max(b.minX+.11,Math.min(b.maxX-.11,originFront.x)),to.y,
    Math.max(b.minZ+.11,Math.min(b.maxZ-.11,originFront.z)));
  const entryYaw=direction.lengthSquared()>.001?Math.atan2(direction.x,direction.z):endYaw;
  const foreOffset=tracks.filter(p=>p.front).map(p=>rotate(p.local.subtract(localFront),entryYaw));
  if(foreOffset.length) {
    entering.x=Math.max(b.minX-Math.min(...foreOffset.map(o=>o.x)),Math.min(b.maxX-Math.max(...foreOffset.map(o=>o.x)),entering.x));
    entering.z=Math.max(b.minZ-Math.min(...foreOffset.map(o=>o.z)),Math.min(b.maxZ-Math.max(...foreOffset.map(o=>o.z)),entering.z));
  }
  const rearFinal=average(tracks.filter(p=>!p.front).map(p=>p.destination));
  const forward=rotate(Vector3.Forward(),endYaw);
  const ahead=Vector3.Dot(entering.subtract(rearFinal),forward);
  const minimumAhead=up?.27:.17;
  if(ahead<minimumAhead)entering.addInPlace(forward.scale(minimumAhead-ahead));
  for(const p of tracks) {
    const offset=rotate(p.local.subtract(localFront),entryYaw);
    p.catch.copyFrom(p.front?new Vector3(entering.x+offset.x,to.y+cat.baseY+p.local.y,entering.z+offset.z):p.destination);
  }
  const ik=createCatLimbIK(cat);
  const head=cat.nodes.find(node=>node.name==='Head');
  head?.computeWorldMatrix(true);
  const headInverse=head?.getWorldMatrix().clone().invert();
  const headForward=headInverse?Vector3.TransformNormal(rotate(Vector3.Forward(),initialYaw),headInverse):undefined;
  const headUp=headInverse?Vector3.TransformNormal(Vector3.Up(),headInverse):undefined;
  let time=0,phase='look',complete=false,debug:TraversalDebug;
  const look=.14,foreSpan=up?.30:.36,foreStagger=.09,weight=.22;
  const rearStart=look+foreSpan+foreStagger+weight,rearSpan=.30,rearStagger=up?.09:.06;
  const strideStart=rearStart+rearSpan+rearStagger,strideSpan=.28;
  const flightDuration=up?.50:.36,launchTime=.18,landingTime=launchTime+flightDuration;
  let airborneRear:Vector3[]|undefined;
  const transferDuration=airborne?landingTime+.38:strideStart+strideSpan+.09+.13;
  const duration=prepareTime+transferDuration;
  function restore(){for(const r of rests)r.node.rotationQuaternion=r.rotation.clone();}
  function bend(name:string,pitch:number,roll=0){const rest=rests.find(r=>r.node.name===name);if(rest)rest.node.rotationQuaternion=rest.rotation.multiply(Quaternion.RotationYawPitchRoll(0,pitch,roll));}
  function swing(p:Paw,a:Vector3,target:Vector3,u:number,startYaw:number,targetYaw:number) {
    const t=motionUnit(u),ease=motionEase(t);p.locked=t===0||t===1;
    p.yaw=turn(startYaw,targetYaw,t);
    p.bodyPoint.copyFrom(Vector3.Lerp(a,target,ease));
    // Body height reacts to contact, rather than rising with an airborne paw.
    if(t<1)p.bodyPoint.y=a.y;
    p.point.copyFrom(Vector3.Lerp(a,target,ease));
    const lift=up?.08:.045;
    if(!airborne&&target.y<a.y-.08) {
      // Clear the departing board before lowering the paw. A diagonal descent
      // would cut through the plate, especially when the rear pair follows.
      const delta=target.subtract(a),bounds=from.bounds;
      const crossings:number[]=[];
      if(delta.x>.001)crossings.push((bounds.maxX-a.x)/delta.x);
      if(delta.x<-.001)crossings.push((bounds.minX-a.x)/delta.x);
      if(delta.z>.001)crossings.push((bounds.maxZ-a.z)/delta.z);
      if(delta.z<-.001)crossings.push((bounds.minZ-a.z)/delta.z);
      const exit=motionUnit(Math.min(...crossings.filter(v=>v>=0))+.10/Math.max(.05,Math.hypot(delta.x,delta.z)));
      const edge=Vector3.Lerp(a,target,exit);edge.y=a.y+.075;
      if(t<.15)p.point.copyFrom(Vector3.Lerp(a,new Vector3(a.x,edge.y,a.z),motionEase(t/.15)));
      else if(t<.50)p.point.copyFrom(Vector3.Lerp(new Vector3(a.x,edge.y,a.z),edge,motionEase((t-.15)/.35)));
      else p.point.copyFrom(Vector3.Lerp(edge,target,motionEase((t-.50)/.50)));
    } else if(target.y>a.y+.05) {
      const clearance=target.y+lift;
      if(t<.42)p.point.copyFrom(Vector3.Lerp(a,new Vector3(a.x,clearance,a.z),motionEase(t/.42)));
      else p.point.copyFrom(Vector3.Lerp(new Vector3(a.x,clearance,a.z),target,motionEase((t-.42)/.58)));
    } else p.point.y+=Math.sin(Math.PI*t)*lift;
    // Smooth support height before landing avoids a root discontinuity.
    p.bodyPoint.y=a.y+(target.y-a.y)*motionEase((t-.35)/.65);
  }
  function supportedBody() {
    const front=average(tracks.filter(p=>p.front).map(p=>p.bodyPoint));
    const rear=average(tracks.filter(p=>!p.front).map(p=>p.bodyPoint));
    const delta=front.subtract(rear),horizontal=Math.hypot(delta.x,delta.z);
    const yaw=horizontal>.04?Math.atan2(delta.x,delta.z):initialYaw;
    const pitch=Math.max(-.72,Math.min(.72,-Math.atan2(delta.y-(localFront.y-localRear.y),Math.max(.22,horizontal))));
    cat.root.rotation.set(pitch,yaw,0);
    cat.root.position.copyFrom(average(tracks.map(p=>p.bodyPoint)).subtract(rotate(localCenter,yaw,pitch)));
    // A bent-knee stance permits a shorter footprint during the rear follow-through.
    const nativeSpan=localFront.subtract(localRear).length();
    const supportedSpan=delta.length();
    cat.root.position.y-=Math.min(.17,Math.max(0,nativeSpan-supportedSpan)*.40);
  }
  function update(dt:number) {
    if(complete)return true;time=Math.min(duration,time+dt);restore();
    const elapsed=time-prepareTime;
    for(const p of tracks){p.point.copyFrom(p.origin);p.bodyPoint.copyFrom(p.origin);p.locked=true;p.yaw=p.originYaw;}
    if(time<prepareTime) {
      phase=Math.abs(angle)>.75?'turn-with-steps':'approach-with-steps';
      for(const [index,p] of tracks.entries()){p.point.copyFrom(born[index]);p.bodyPoint.copyFrom(born[index]);p.yaw=initialYaw;}
      for(const step of steps)if(time>=step.start)swing(step.paw,step.a,step.b,(time-step.start)/stepSpan,step.fromYaw,step.toYaw);
      supportedBody();
    } else if(!airborne) {
      const frontDone=look+foreSpan+foreStagger;
      phase=elapsed<look?'look':elapsed<frontDone?(up?'forepaw-place':'forepaw-reach'):elapsed<rearStart?(up?'weight-forward':'lower-chest'):elapsed<strideStart?'hindpaw-follow':elapsed<transferDuration-.13?'forepaw-advance':'stabilize';
      for(const p of tracks) {
        const stagger=p.side==='L'?0:foreStagger;
        if(p.front) {
          swing(p,p.origin,p.catch,(elapsed-look-stagger)/foreSpan,p.originYaw,entryYaw);
          if(elapsed>=strideStart+stagger)swing(p,p.catch,p.destination,(elapsed-strideStart-stagger)/strideSpan,entryYaw,endYaw);
        } else swing(p,p.origin,p.destination,(elapsed-rearStart-(p.side==='L'?0:rearStagger))/rearSpan,p.originYaw,endYaw);
      }
      supportedBody();
    } else {
      // A short flight is reserved for upper boards that exceed supported reach.
      const t=motionUnit((elapsed-launchTime)/flightDuration);
      phase=elapsed<look?'look':elapsed<launchTime?(up?'hindpaw-load':'edge-lower'):elapsed<landingTime?kind:elapsed<landingTime+.26?'forepaw-support':'stabilize';
      if(elapsed<launchTime) {
        supportedBody();cat.root.position.y-=.09*motionEase((elapsed-look)/(launchTime-look));
      } else if(elapsed<landingTime) {
        const start=average(tracks.map(p=>p.origin)).subtract(rotate(localCenter,prepare?prepareYaw:initialYaw));start.y-=.09;
        const end=endRoot.clone();end.y-=.035;
        const seconds=t*flightDuration,gravity=14;
        const velocity=(end.y-start.y+.5*gravity*flightDuration*flightDuration)/flightDuration;
        cat.root.position.copyFrom(Vector3.Lerp(start,end,t));cat.root.position.y=start.y+velocity*seconds-.5*gravity*seconds*seconds;
        const yaw=turn(prepare?prepareYaw:initialYaw,endYaw,t);
        cat.root.rotation.set((up?-.20:.24)*Math.sin(Math.PI*t),yaw,0);
        for(const p of tracks) {
          p.point.copyFrom(cat.root.position.add(rotate(p.local,yaw,cat.root.rotation.x)));p.locked=false;p.yaw=yaw;
          if(p.front){if(up)p.point.y+=.30*Math.sin(Math.PI*t);p.point.copyFrom(Vector3.Lerp(p.point,p.destination,motionEase((t-.58)/.42)));}
          else {p.point.y+=.16*Math.sin(Math.PI*t*.78);p.point.subtractInPlace(rotate(new Vector3(0,0,.10*motionEase(t)),yaw));}
          if(!up) {
            // Tuck over the departing plate until the whole paw clears its edge.
            const bounds=from.bounds;
            const outside=Math.max(bounds.minX-p.point.x,p.point.x-bounds.maxX,bounds.minZ-p.point.z,p.point.z-bounds.maxZ);
            const clear=motionEase((outside-.06)/.14);
            p.point.y=Math.max(p.point.y,p.point.y*clear+(from.y+cat.baseY+p.local.y+.09)*(1-clear));
          }
        }
        airborneRear=tracks.filter(p=>!p.front).map(p=>p.point.clone());
      } else {
        let index=0;
        for(const p of tracks) {
          if(p.front){p.point.copyFrom(p.destination);p.bodyPoint.copyFrom(p.destination);p.yaw=endYaw;}
          else {const start=airborneRear?.[index++]??p.destination.add(new Vector3(0,.16,0));const u=(elapsed-landingTime-(p.side==='L'?0:.06))/.20;swing(p,start,p.destination,u,endYaw,endYaw);if(u<=0)p.locked=false;}
        }
        supportedBody();cat.root.position.y-=.025*Math.sin(Math.PI*motionUnit((elapsed-landingTime)/.30));
      }
    }
    const lookWeight=1-motionEase((time-(duration-.22))/.22);
    if(head&&headForward&&headUp) {
      const pitch=(up?-.13:.23)*lookWeight;
      alignCatJoint(head,headUp,rotate(Vector3.Up(),cat.root.rotation.y,pitch));
      alignCatJoint(head,headForward,rotate(Vector3.Forward(),cat.root.rotation.y,pitch));
    }
    bend('TailBase',-.35*lookWeight,Math.sin(time*3)*.06*lookWeight);bend('Tail2',-.12*lookWeight,Math.sin(time*3-.5)*.04*lookWeight);bend('Tail3',.06*lookWeight);bend('TailTip',.08*lookWeight);
    const solve=()=>{for(const p of tracks)ik.solve(p.front,p.side,p.point,p.yaw,cat.root.rotation.y);};
    solve();
    // Correct only support reach errors, without altering limb lengths or bend planes.
    for(let pass=0;pass<8;pass++) {
      const actual=footTargets(cat.nodes),locked=tracks.filter(p=>p.locked);
      const correction=average(locked.map(p=>p.point.subtract(actual.find(f=>f.front===p.front&&f.side===p.side)?.point??p.point)));
      if(correction.length()<.001)break;
      if(correction.length()>.035)correction.normalize().scaleInPlace(.035);
      cat.root.position.addInPlace(correction);solve();
    }
    const actual=footTargets(cat.nodes);
    debug={kind,phase,from:from.id,to:to.id,feet:tracks.map(p=>{const a=actual.find(f=>f.front===p.front&&f.side===p.side)?.point??p.point;return {front:p.front,side:p.side,target:p.point.asArray(),actual:a.asArray(),surfaceY:p.point.y-cat.baseY-p.local.y,locked:p.locked,error:Vector3.Distance(a,p.point)};})};
    if(time>=duration){complete=true;cat.supportY=to.y;if(to.id==='floor'||to.id==='top-bed'){restore();cat.root.rotation.set(0,endYaw,0);cat.root.position.copyFrom(endRoot);}}
    return complete;
  }
  return {update,restore,kind,duration,debug:()=>debug};
}
