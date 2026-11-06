// Declared mock geometry only: map z=0 is the floor. Extrusions and a map-from-arm-base pose
// are explicit illustrative project inputs, never inferred from the viewer or a dock point.
import type {LabProjectV2} from '../contracts';
import {checkQuaternion,invertPose,qrotate,type Pose,type Vec3} from '../frames';
import {hashJson} from '../hash';
import {PUMA560_SI} from './arm-kinematics';
import type {ArmObstacle} from './arm-collision';
export type ArmCollisionProfile=NonNullable<LabProjectV2['armCollisionProfile']>;
export interface ArmSceneDeclaration {
 profile:ArmCollisionProfile|null;profileHash:string|null;world:LabProjectV2['world'];worldHash:string;
 robotGeometry:{id:string;radiusM:number|null;motion:'dynamic'|'static_parked';parkingId:string|null;parkedPose:ArmSceneRobot['pose']|null}[];hash:string;
}
export interface ArmSceneRobot {id:string;radiusM:number|null;pose:{x:number;y:number;yawRad:number}}
export interface ArmSceneSnapshot {
 available:boolean;scope:'self_injected_only'|'self_scene_robot';reason?:string;revision:string;profileRevision:number|null;tick:number;
 world:ArmObstacle[];
 /** Endpoints bound robot motion during this tick; the arm checker sees the enclosing swept AABB. */
 robotPoses:{id:string;from:[number,number];to:[number,number]}[];
}
export function validateArmCollisionProfile(p:ArmCollisionProfile){
 if(p.schemaVersion!==1||p.units!=='SI'||p.provenance!=='illustrative'||!p.id||!p.reference||!Number.isSafeInteger(p.revision)||p.revision<1)throw new Error('ARM_COLLISION_PROFILE_INVALID');
 if(p.modelId!==PUMA560_SI.id||p.modelRevision!==PUMA560_SI.revision)throw new Error('ARM_COLLISION_MODEL_MISMATCH');
 if(!p.baseInMap||p.baseInMap.position.length!==3||p.baseInMap.position.some(n=>!Number.isFinite(n)||Math.abs(n)>1000))throw new Error('ARM_COLLISION_POSE_INVALID');
 checkQuaternion(p.baseInMap.quaternionXyzw);
 if(![p.fixtureHeightM,p.robotHeightM].every(n=>Number.isFinite(n)&&n>0&&n<=100))throw new Error('ARM_COLLISION_HEIGHT_INVALID');
}
export function declareArmScene(project:LabProjectV2,radius:Record<string,number|null>,activeRobotIds:readonly string[]=project.entities.filter(e=>e.kind==='amr').map(e=>e.id)):ArmSceneDeclaration {
 const profile=project.armCollisionProfile??null;if(profile)validateArmCollisionProfile(profile);
 // Extend the scenario's sorted entity/parking binding to every project AMR. Unused AMRs are
 // stationary model obstacles, not erased physical objects; an absent parking binding stays unknown.
 const byId=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0,parking=project.world.points.filter(p=>p.kind==='parking').sort(byId);
 const declaration={profile:structuredClone(profile),profileHash:profile?hashJson(profile):null,world:structuredClone(project.world),worldHash:hashJson(project.world),
  robotGeometry:project.entities.filter(e=>e.kind==='amr').sort(byId).map((e,i)=>{const active=activeRobotIds.includes(e.id),point=parking[i];
   return {id:e.id,radiusM:radius[e.id]??null,motion:active?'dynamic' as const:'static_parked' as const,parkingId:point?.id??null,parkedPose:!active&&point?{x:point.x,y:point.y,yawRad:0}:null};})};
 return {...declaration,hash:hashJson(declaration)};
}
/** All eight transformed corners are enclosed: arbitrary normalized base rotation is conservative, not yaw-only. */
function boxInArm(id:string,min:Vec3,max:Vec3,mapInArm:Pose):ArmObstacle {
 const points:Vec3[]=[];
 for(const x of [min[0]!,max[0]!])for(const y of [min[1]!,max[1]!])for(const z of [min[2]!,max[2]!]){
  const p=qrotate(mapInArm.quaternionXyzw,[x,y,z]);points.push(p.map((v,k)=>v+mapInArm.position[k]!));
 }
 return {id,kind:'box',min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]!))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k]!)))};
}
/** Current model poses are read every advance. The union of consecutive XY proxies encloses linear AMR motion in the tick. */
export function materializeArmScene(d:ArmSceneDeclaration,robots:readonly ArmSceneRobot[],tick:number,previous:readonly ArmSceneRobot[]=robots):ArmSceneSnapshot {
 const p=d.profile,base:ArmSceneSnapshot={available:false,scope:p?'self_scene_robot':'self_injected_only',revision:d.hash,profileRevision:p?.revision??null,tick,world:[],robotPoses:[]};
 if(!p)return {...base,reason:'ARM_COLLISION_PROFILE_MISSING'};
 const mapInArm=invertPose(p.baseInMap);
 base.world=d.world.obstacles.map(o=>boxInArm(`fixture:${o.id}`,[o.x,o.y,0],[o.x+o.width,o.y+o.height,p.fixtureHeightM],mapInArm));
 for(const g of d.robotGeometry){
  if(g.motion==='static_parked'&&!g.parkedPose)return {...base,reason:'ROBOT_POSE_UNKNOWN'};
  const r=g.motion==='static_parked'?{id:g.id,radiusM:g.radiusM,pose:g.parkedPose!}:robots.find(r=>r.id===g.id),old=g.motion==='static_parked'?r:previous.find(r=>r.id===g.id)??r;
  if(g.radiusM===null||!Number.isFinite(g.radiusM)||g.radiusM<=0||g.radiusM>1000||r?.radiusM!==g.radiusM)return {...base,reason:'ROBOT_GEOMETRY_UNKNOWN'};
  if(!r||!old||![r.pose.x,r.pose.y,r.pose.yawRad,old.pose.x,old.pose.y,old.pose.yawRad].every(n=>Number.isFinite(n)&&Math.abs(n)<=1000))return {...base,reason:'ROBOT_POSE_UNKNOWN'};
  base.robotPoses.push({id:r.id,from:[old.pose.x,old.pose.y],to:[r.pose.x,r.pose.y]});
  base.world.push(boxInArm(`robot:${r.id}`,[Math.min(old.pose.x,r.pose.x)-g.radiusM,Math.min(old.pose.y,r.pose.y)-g.radiusM,0],
   [Math.max(old.pose.x,r.pose.x)+g.radiusM,Math.max(old.pose.y,r.pose.y)+g.radiusM,p.robotHeightM],mapInArm));
 }
 return {...base,available:true};
}
