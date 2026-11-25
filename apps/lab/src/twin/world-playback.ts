// A bounded display-only buffer. Every component comes from the same received,
// committed world pair. Never advances past the latest observation or across identity/gaps.
import type {TwinPoses} from '../viewer/twin3d';
import {lerpJoints,lerpPlace} from './sample-buffer';
const place=(a:NonNullable<TwinPoses['cups']>[string],b:NonNullable<TwinPoses['cups']>[string],u:number)=>{const p=lerpPlace([...a.positionM,...a.quaternionXyzw],[...b.positionM,...b.quaternionXyzw],u);return {positionM:p.slice(0,3) as [number,number,number],quaternionXyzw:p.slice(3) as [number,number,number,number]};};
const interpolate=(a:TwinPoses,b:TwinPoses,u:number):TwinPoses=>({
 arms:Object.fromEntries(Object.entries(a.arms).map(([id,p])=>[id,{jointsRad:lerpJoints(p.jointsRad,b.arms[id]!.jointsRad,u),gripperOpeningM:p.gripperOpeningM===null||b.arms[id]!.gripperOpeningM===null?p.gripperOpeningM:p.gripperOpeningM+(b.arms[id]!.gripperOpeningM!-p.gripperOpeningM)*u}])),
 bodies:Object.fromEntries(Object.entries(a.bodies).map(([id,p])=>[id,place(p,b.bodies[id]!,u)])),cups:Object.fromEntries(Object.entries(a.cups??{}).map(([id,p])=>[id,place(p,b.cups![id]!,u)]))});
export class WorldPlayback {
 private samples:{sim:bigint;wall:number;poses:TwinPoses}[]=[];private identity='';private received=-Infinity;private sim=-1n;
 feed(identity:string,simNs:string,receivedMs:number,poses:TwinPoses):void{
  const key=identity+JSON.stringify([Object.keys(poses.arms).sort(),Object.keys(poses.bodies).sort(),Object.keys(poses.cups??{}).sort()]);
  const sim=BigInt(simNs);if(key===this.identity){if(sim===this.sim||receivedMs<this.received)return;if(sim<this.sim){this.clear();return;}}
  // a revision is not part of the identity: a sim-time gap over 1 s or a receipt gap over 500 ms starts a new buffer
  if(key!==this.identity||receivedMs-this.received>500||sim-this.sim>1000000000n){this.clear();this.identity=key;}
  this.sim=sim;this.received=receivedMs;
  if(this.samples.at(-1)?.wall===receivedMs)this.samples.pop();
  this.samples.push({sim,wall:receivedMs,poses:structuredClone(poses)});if(this.samples.length>32)this.samples.shift();
 }
 clear():void{this.samples=[];this.identity='';this.received=-Infinity;this.sim=-1n;}
 at(nowMs:number):TwinPoses|null{
  if(nowMs-this.received>500||!this.samples.length)return null;
  // Delay the received wall timeline, not a rate inferred anew from each poll.
  // Uneven committed tick counts must not move the playback target backwards.
  const target=nowMs-150;let i=this.samples.length-1;while(i>0&&this.samples[i-1]!.wall>target)i--;
  const b=this.samples[i]!,a=this.samples[i-1];if(!a||target>=b.wall)return b.poses;
  return b.sim-a.sim>1000000000n?a.poses:interpolate(a.poses,b.poses,(target-a.wall)/(b.wall-a.wall));
 }
}
