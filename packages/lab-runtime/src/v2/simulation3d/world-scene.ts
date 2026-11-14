import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {documentDigest,validateWorldSceneShape,validateSim3DResponse,type LabWorldSceneV1,type Sim3DSnapshotV1} from '../navigation2d/contracts';
import {XARM6_SI} from '../models/arm-kinematics';
export type {LabWorldSceneV1};
/** Source-owned intent. Its existence alone is not a custody receipt; B06 binds eventId to the production journal. */
export interface WorldInteractionIntent {eventId:string;cupId:string;propId:string;kind:'birth'|'remove';tick:number}
export function validateWorldScene(input:unknown):asserts input is LabWorldSceneV1 {
 if(!validateWorldSceneShape(input))throw new Error('WORLD_SCENE_INVALID');
 const s=input as LabWorldSceneV1;
 if(documentDigest(s,'sceneDigest')!==s.sceneDigest||documentDigest(s.navigation,'sceneDigest')!==s.navigation.sceneDigest||documentDigest(s.armCell,'sceneDigest')!==s.armCell.sceneDigest)throw new Error('WORLD_SCENE_DIGEST_MISMATCH');
 const ids=[s.navigation.robots[0]?.robotId,s.armCell.arm.armId,...s.propBindings.map(p=>p.propId)];
 if(s.armCell.arm.modelId!=='xarm6-g2-v1'||s.navigation.robots.length!==1||s.armCell.arm.homeRad.length!==6||s.armCell.arm.modelRevision!==XARM6_SI.revision||new Set(ids).size!==ids.length||new Set(s.propBindings.map(p=>p.cupId)).size!==s.propBindings.length||s.propBindings.length!==s.armCell.props.length||s.armCell.props.some(p=>!s.propBindings.some(b=>b.propId===p.propId))||s.navigation.engine.id!=='mujoco_3d')throw new Error('WORLD_IDENTITY_INVALID');
 if(s.navigation.engine.timestepMs!==2||s.navigation.engine.substeps!==10||s.navigation.clock.tickMs!==20||s.armCell.engine.timestepMs!==2||s.armCell.engine.substeps!==10)throw new Error('WORLD_CLOCK_INVALID');
 if(s.inputs.armModelDigest!==s.armCell.arm.modelRevision||s.inputs.mobileModelDigest!==s.navigation.robots[0]!.model.physicalModelDigest)throw new Error('WORLD_IDENTITY_INVALID');
 const files=new Set(s.files.map(f=>f.path));
 if(files.size!==s.files.length||[...Object.values(s.models),s.programsRef,s.handoffPolicyRef].some(ref=>!s.files.some(f=>f.path===ref.path&&f.sha256===ref.sha256)))throw new Error('WORLD_CLOSURE_INVALID');
}
export function activeWorldProps(scene:LabWorldSceneV1,intents:readonly WorldInteractionIntent[],tick:number):string[]{
 const active=new Set<string>(),born=new Set<string>(),events=new Set<string>();let last=0;
 for(const i of intents){
  if(!Number.isSafeInteger(i.tick)||i.tick<last||i.tick<1||i.tick>30000||!i.eventId||events.has(i.eventId)||!scene.propBindings.some(b=>b.propId===i.propId&&b.cupId===i.cupId))throw new Error('WORLD_PROP_LIFECYCLE_INVALID');
  events.add(i.eventId);last=i.tick;
  if(i.tick>tick)continue;
  if(i.kind==='birth'){if(born.has(i.propId))throw new Error('WORLD_PROP_LIFECYCLE_INVALID');born.add(i.propId);active.add(i.propId);}
  else if(i.kind==='remove'){if(!active.delete(i.propId))throw new Error('WORLD_PROP_LIFECYCLE_INVALID');}
  else throw new Error('WORLD_PROP_LIFECYCLE_INVALID');
 }
 return [...active].sort();
}
/** Additional world consumer checks after worker-client envelope validation, before any append or observer commit. */
export function validateWorldObservation(input:unknown,scene:LabWorldSceneV1,intents:readonly WorldInteractionIntent[]):asserts input is Sim3DSnapshotV1 {
 const s=input as Sim3DSnapshotV1,fail=()=>{throw new Error('WORLD_OBSERVATION_INVALID');};
 if(!s||!validateSim3DResponse({protocol:'mekoniq-sim3d/1',requestId:'world-validation',runId:s.runId,bootId:s.bootId,tick:s.tick,ok:true,result:s}).ok)fail();
 const finite=(x:unknown):boolean=>typeof x==='number'?Number.isFinite(x):Array.isArray(x)?x.every(finite):x!==null&&typeof x==='object'?Object.values(x).every(finite):true;
 const arm=s.arms?.[0],expected=activeWorldProps(scene,intents,s.tick);
 if(!s.worldStep||s.worldStep.physicsSubsteps!==(s.tick+1)*10||s.worldStep.nq!==21+7*scene.propBindings.length||s.worldStep.nv!==20+6*scene.propBindings.length||!finite(s)||s.sceneDigest!==scene.sceneDigest||s.robots.length!==1||s.robots[0]!.robotId!==scene.navigation.robots[0]!.robotId||s.arms?.length!==1||arm?.armId!==scene.armCell.arm.armId||arm.positionsRad.length!==6||arm.positionsRad.some((q,i)=>q<XARM6_SI.limits[i]!.min-1e-3||q>XARM6_SI.limits[i]!.max+1e-3)||arm.velocitiesRadS.length!==6||!arm.gripper||new Set(arm.gripper.heldPropIds).size!==arm.gripper.heldPropIds.length||s.props?.length!==expected.length||new Set(s.props?.map(p=>p.propId)).size!==expected.length||s.props?.some(p=>!expected.includes(p.propId)||Math.abs(Math.hypot(...p.quaternionXyzw)-1)>1e-6)||arm.gripper.heldPropIds.some(p=>!expected.includes(p))||s.simTimeNs!==String(BigInt(s.tick)*20_000_000n))fail();
}
/** Fixture files and vendor mesh closure are independently hash-checked before an engine sees them. */
export async function readWorldFixture(workerRoot:string){
 const dir=join(workerRoot,'fixtures','coffee-delivery-world-v1');
 const scene:unknown=JSON.parse(await readFile(join(dir,'lab-world-scene.json'),'utf8'));validateWorldScene(scene);
 const files=new Map<string,Uint8Array>();
 for(const f of scene.files){const path=f.path.startsWith('blobs/')?join(workerRoot,'fixtures','xarm6-g2-v1',f.path):join(dir,f.path),b=await readFile(path);if(b.length!==f.bytes||createHash('sha256').update(b).digest('hex')!==f.sha256)throw new Error('WORLD_CLOSURE_INVALID');files.set(f.path,b);}
 return {scene,files};
}

/** Conservative per-primitive mobile obstacles in the actual arm frame. Fixed mount
 * transforms stay explicit; wheel rotation cannot change its cylinder's envelope. */
export function worldArmObstacles(scene:LabWorldSceneV1,physical:RobotPhysicalModelV1,snapshot:Sim3DSnapshotV1):ArmObstacle[]{
 const base=snapshot.physics?.base[0];if(!base)throw Error('WORLD_BASE_OBSERVATION_REQUIRED');
 const root:Pose={position:base.poseMap.positionM,quaternionXyzw:base.poseMap.quaternionXyzw},poses=new Map<string,Pose>([[physical.baseFrameId,root]]),pending=[...physical.joints];
 while(pending.length){const i=pending.findIndex(j=>poses.has(j.parent));if(i<0)throw Error('WORLD_MOBILE_FRAME_INVALID');const j=pending.splice(i,1)[0]!;poses.set(j.child,composePose(poses.get(j.parent)!,{position:j.origin.xyzM,quaternionXyzw:j.origin.quaternionXyzw}));}
 const inverse=invertPose(scene.armCell.arm.baseInMap),rid=scene.navigation.robots[0]!.robotId;
 const mobile=physical.links.flatMap(l=>l.collision.map((c,i)=>{const g=c.geometry,half=g.kind==='box'?g.sizeM.map(n=>n/2):g.kind==='sphere'?[g.radiusM,g.radiusM,g.radiusM]:g.kind==='cylinder'?[g.radiusM,g.radiusM,g.lengthM/2]:null;if(!half)throw Error('WORLD_COLLISION_GEOMETRY_UNSUPPORTED');const pose=composePose(inverse,composePose(poses.get(l.id)!,{position:c.pose.xyzM,quaternionXyzw:c.pose.quaternionXyzw}));return boxInArm(`${rid}/${l.id}/c${i}`,half.map(n=>-n),half,pose);}));
 const supports=scene.armCell.supports.filter(s=>s.id!==scene.supportMap.replacedStaticSupportId).map(s=>boxInArm(`support/${s.id}`,s.centerM.map((v,i)=>v-s.sizeM[i]!/2),s.centerM.map((v,i)=>v+s.sizeM[i]!/2),inverse));
 return [...mobile,...supports,...scene.armCell.statics];
}
import type {RobotPhysicalModelV1} from '../navigation2d/contracts';
import {composePose,invertPose,type Pose} from '../frames';
import {boxInArm} from '../models/arm-scene';
import type {ArmObstacle} from '../models/arm-collision';
