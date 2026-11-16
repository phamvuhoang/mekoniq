// A bounded display-only buffer. Every component comes from the same received,
// committed world pair. Never advances past the latest observation or across identity/gaps.
import type {TwinPoses} from '../viewer/twin3d';
import {SampleBuffer,lerpJoints,lerpPlace} from './sample-buffer';
const place=(a:NonNullable<TwinPoses['cups']>[string],b:NonNullable<TwinPoses['cups']>[string],u:number)=>{const p=lerpPlace([...a.positionM,...a.quaternionXyzw],[...b.positionM,...b.quaternionXyzw],u);return {positionM:p.slice(0,3) as [number,number,number],quaternionXyzw:p.slice(3) as [number,number,number,number]};};
const interpolate=(a:TwinPoses,b:TwinPoses,u:number):TwinPoses=>({
 arms:Object.fromEntries(Object.entries(a.arms).map(([id,p])=>[id,{jointsRad:lerpJoints(p.jointsRad,b.arms[id]!.jointsRad,u),gripperOpeningM:p.gripperOpeningM===null||b.arms[id]!.gripperOpeningM===null?p.gripperOpeningM:p.gripperOpeningM+(b.arms[id]!.gripperOpeningM!-p.gripperOpeningM)*u}])),
 bodies:Object.fromEntries(Object.entries(a.bodies).map(([id,p])=>[id,place(p,b.bodies[id]!,u)])),cups:Object.fromEntries(Object.entries(a.cups??{}).map(([id,p])=>[id,place(p,b.cups![id]!,u)]))});
export class WorldPlayback {
 private buffer=new SampleBuffer<TwinPoses>(interpolate,150,32);private identity='';private received=-Infinity;private sim=-1n;
 feed(identity:string,simNs:string,receivedMs:number,poses:TwinPoses):void{
  const key=identity+JSON.stringify([Object.keys(poses.arms).sort(),Object.keys(poses.bodies).sort(),Object.keys(poses.cups??{}).sort()]);
  if(key!==this.identity||receivedMs-this.received>500){this.clear();this.identity=key;}
  const sim=BigInt(simNs);if(sim<=this.sim)return;this.sim=sim;this.received=receivedMs;this.buffer.push(sim,receivedMs,structuredClone(poses));
 }
 clear():void{this.buffer.clear();this.identity='';this.received=-Infinity;this.sim=-1n;}
 at(nowMs:number):TwinPoses|null{return nowMs-this.received>500?null:this.buffer.at(nowMs);}
}
