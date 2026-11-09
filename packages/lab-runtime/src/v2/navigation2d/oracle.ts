import {place,polygonDistance,polygonsOverlap,sweptHulls} from './geometry';
import type {P,Pose2} from './geometry';
import type {IRSimSnapshotV1,NavigationSceneV1} from './contracts';

export type ContactSource='engine_discrete'|'swept_oracle'|'safety_envelope';
export interface Contact{tick:number;pair:[string,string];source:ContactSource}
/** minSeparationM: robot-robot surface separation (null for one robot); minClearanceM: robot to obstacle/boundary; both null without complete coverage. */
export interface TrajectoryAssessment{contacts:Contact[];minSeparationM:number|null;minClearanceM:number|null;coverage:'complete'|'incomplete'}

/**
 * Independent collision oracle: it reads only observed poses and the physical hulls. It never asks the controller whether it collided, and it reports
 * three distinct kinds of evidence (the engine's own contact, an overlap or a sweep between ticks found here, and a breach of the safety margin).
 * Coverage is `complete` only for a contiguous run of ticks in which every robot has a pose; otherwise no clearance or separation is claimed.
 */
/** Scripted actors (C02) as discs at a tick: overlaps and margin breaches against them are contacts of the pair (robotId, actorId), like any solid. */
export type ActorsAt=(tick:number)=>readonly {id:string;x:number;y:number;radiusM:number}[];
const actorPoly=(x:number,y:number,r:number):P[]=>{const k=r/Math.cos(Math.PI/16);return Array.from({length:16},(_,i)=>[x+k*Math.cos(Math.PI*i/8),y+k*Math.sin(Math.PI*i/8)] as P);};
export function assessTrajectory(scene:NavigationSceneV1,snapshots:readonly IRSimSnapshotV1[],actorsAt?:ActorsAt):TrajectoryAssessment{
 const robots=scene.robots.map(r=>({id:r.robotId,hull:r.model.footprint.verticesM as P[]}));
 const solids=[...scene.world.obstacles,...scene.world.boundaries].map(o=>({id:o.id,poly:o.verticesM as P[]}));
 const margin=scene.policy.parameters.safetyMarginM,contacts:Contact[]=[],seen=new Set<string>();
 const add=(tick:number,a:string,b:string,source:ContactSource)=>{
  const pair=(a<b?[a,b]:[b,a]) as [string,string],key=`${tick}|${pair}|${source}`;
  if(!seen.has(key)){seen.add(key);contacts.push({tick,pair,source});}
 };
 let complete=snapshots.length>0;
 const poseOf=(s:IRSimSnapshotV1,id:string):Pose2|null=>{const r=s.robots.find(x=>x.robotId===id);return r?[r.poseDriveMap[0],r.poseDriveMap[1],r.poseDriveMap[2]]:null;};
 let minSeparation=Infinity,minClearance=Infinity;
 snapshots.forEach((s,i)=>{
  const prev=snapshots[i-1];
  if(s.sceneDigest!==scene.sceneDigest||robots.some(r=>!poseOf(s,r.id))||(prev&&s.tick!==prev.tick+1))complete=false;
  const bodies=robots.flatMap(r=>{const p=poseOf(s,r.id);return p?[{id:r.id,hull:r.hull,pose:p,poly:place(r.hull,...p)}]:[];});
  for(const r of s.robots)for(const id of [...r.collisionIds].sort())add(s.tick,r.robotId,id,'engine_discrete');
  for(const b of bodies){
   for(const o of solids){
    const d=polygonDistance(b.poly,o.poly);
    minClearance=Math.min(minClearance,d);
    if(d===0)add(s.tick,b.id,o.id,'swept_oracle');else if(d<margin)add(s.tick,b.id,o.id,'safety_envelope');
   }
  }
  // actors: the conservative 16-gon of each disc at this tick (and the robot's sweep from the previous tick against it)
  const actors=(actorsAt?.(s.tick)??[]).map(x=>({id:x.id,poly:actorPoly(x.x,x.y,x.radiusM)}));
  for(const b of bodies)for(const x of actors){
   const d=polygonDistance(b.poly,x.poly);
   if(d===0)add(s.tick,b.id,x.id,'swept_oracle');else if(d<margin)add(s.tick,b.id,x.id,'safety_envelope');
   const from=prev&&s.tick===prev.tick+1?poseOf(prev,b.id):null;
   if(from&&sweptHulls(b.hull,from,b.pose).some(h=>polygonsOverlap(h,x.poly)))add(s.tick,b.id,x.id,'swept_oracle');
  }
  for(let a=0;a<bodies.length;a++)for(let b=a+1;b<bodies.length;b++){
   const d=polygonDistance(bodies[a]!.poly,bodies[b]!.poly);
   minSeparation=Math.min(minSeparation,d);
   if(d===0)add(s.tick,bodies[a]!.id,bodies[b]!.id,'swept_oracle');else if(d<margin)add(s.tick,bodies[a]!.id,bodies[b]!.id,'safety_envelope');
  }
  if(prev&&s.tick===prev.tick+1)for(const b of bodies){
   const from=poseOf(prev,b.id);
   if(!from)continue;
   for(const hull of sweptHulls(b.hull,from,b.pose))for(const o of solids)if(polygonsOverlap(hull,o.poly))add(s.tick,b.id,o.id,'swept_oracle');
  }
 });
 return {contacts:contacts.sort((a,b)=>a.tick-b.tick||(a.pair<b.pair?-1:1)||(a.source<b.source?-1:1)),minSeparationM:complete&&robots.length>1&&Number.isFinite(minSeparation)?minSeparation:null,minClearanceM:complete&&Number.isFinite(minClearance)?minClearance:null,coverage:complete?'complete':'incomplete'};
}
