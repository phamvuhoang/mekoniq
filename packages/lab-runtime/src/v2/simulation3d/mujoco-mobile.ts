import {createHash} from 'node:crypto';
import {hashJson} from '../hash';
import type {NavigationSceneV1,LoadProfileV1,Sim3DSnapshotV1} from '../navigation2d/contracts';
import {validateLoadProfile} from './load-profile';
import type {PlantPort,PlantStopMonitor} from '../navigation2d/plant';
import type {MujocoRuntimeOptions} from './mujoco';
import {spawnMujocoWorker} from './worker-client';
export const MUJOCO_MOBILE={id:'mujoco_3d',version:'3.17.0',model:'mujoco_serve_diff_drive',dynamics:true} as const;
export const MOBILE_PAYLOAD_IMPULSE=Object.freeze({id:'payload-cup-forward-impulse-v1',revision:1,parameters:Object.freeze({targetTick:501,frameSampleTick:500,forceTransform:'support-at-start-of-tick-held-in-map',frameId:'support',supportId:'amr-1/tray-1',forceN:Object.freeze([30,0,0]),durationS:.02,impulseNs:Object.freeze([.6,0,0]),substeps:10,propId:'cup-1',method:'mujoco-xfrc-applied',provenance:'assumed_simulation_fault'})});
export const MOBILE_BRAKE_OBSERVATION=Object.freeze({id:'payload-brake-observation-v1' as const,extraTicks:5 as const});
export const mujocoMobilePlant=(runtime:MujocoRuntimeOptions,experiment?:'payload-cup-forward-impulse-v1'|'payload-brake-observation-v1'):PlantPort=>{
 if(experiment&&experiment!==MOBILE_PAYLOAD_IMPULSE.id&&experiment!==MOBILE_BRAKE_OBSERVATION.id)throw new Error('PERTURBATION_UNREGISTERED');
 const perturbation=experiment===MOBILE_PAYLOAD_IMPULSE.id?experiment:undefined,completionObservation=experiment===MOBILE_BRAKE_OBSERVATION.id?MOBILE_BRAKE_OBSERVATION:undefined;
 return ({
 startupPolicy:{preMutationCreateRefusals:['SCENE_PATH_REJECTED','SCENE_SCHEMA_INVALID','SCENE_UNSUPPORTED','SCENE_DIGEST_MISMATCH','SCENE_FILE_MISMATCH','PROFILE_ID_MISMATCH','DIGEST_MISMATCH','MODEL_DIGEST_MISMATCH','WORLD_CAPACITY_EXCEEDED','PHYSICS_PROFILE_INVALID']},
 prepareStopMonitor:prepareMobileStopMonitor,
 identity:{...completionObservation?{completionObservation}:{},...perturbation?{simulationPerturbation:MOBILE_PAYLOAD_IMPULSE}:{},amr:MUJOCO_MOBILE,adapterIdentity:MUJOCO_MOBILE,controller:{identity:{id:'grid-diff-v1',version:'2+mujoco-sent-ramp-v1'},options:{ramp:'previous-sent-command-v1'}},telemetryOrigin:'physics_sim',telemetryLabel:'mujoco_3d simulated plant (rigid-body physics, in memory)',capability:'sim3d_mujoco_mobile_v1',coverage:{dynamics:true},
  limitations:['MuJoCo 3.17.0 rigid-body differential drive with fixed sliding sphere casters: not_calibrated.',
   'One zero-target priming tick precedes tick 0: engine time is (tick+1)*20 ms; source time is tick*20 ms.',
   'The seed is identity only: no stochastic engine, noisy sensors or actors. Fixed-caster drag and wheel-odometry slip are modeled limitations.',
   'Declared support coordinates and instantaneous payload contact are not proof of custody or delivery; physics metrics require verified durable coverage.'],
  evidence:{seedAlgorithm:'mujoco-identity-seed-v1',limitation:'mujoco_3d rigid-body dynamics, not_calibrated; seed is identity only (no stochastic engine or sensor noise)',
   engine:d=>({id:'mujoco_3d',engineVersion:runtime.engineVersion,timestepMs:2,substeps:10,pythonVersion:d.pythonVersion,platform:d.platform,lockDigest:d.lockDigest,...d.scene.engine.id==='mujoco_3d'?{stopPolicyRef:d.scene.engine.stopPolicyRef,controllerPolicyRef:d.scene.engine.controllerPolicyRef,loadProfileRef:d.scene.engine.loadProfileRef,physicsProfileRef:d.scene.engine.physicsProfileRef}:{}})}},
 protocol:'mekoniq-sim3d/1',spawn:o=>spawnMujocoWorker({...o,...perturbation?{payloadPerturbationId:perturbation}:{}}),
});};

/** Experiment cutoffs only, not physical safety limits. Separate from the B02a numerical measurement lock. */
export const MOBILE_CONTROLLER_POLICY=Object.freeze({schemaVersion:1,id:'serve-mobile-controller-v1',revision:1,calibration:'not_calibrated',controller:{id:'grid-diff-v1',version:'2+mujoco-sent-ramp-v1'},ramp:'previous-sent-command-v1',
 commandState:'Per robot, initialized to zero on a new run, updated from every sent output including explicit zeros; preserved across pause/resume, cancel and goal changes; lost or refused steps terminate, never resume.',
 observations:'Measured velocity remains authoritative for arrival/stopped checks, obstacle stopping distance and progress. No hardware controller equivalence is claimed.'});
export const MOBILE_STOP_POLICY=Object.freeze({schemaVersion:1,id:'serve-mobile-stop-v1',revision:1,calibration:'not_calibrated',maxAbsRollPitchRad:0.7853981633974483,belowRestWheelRadii:0.6,aboveRestWheelRadii:4,loadDropM:0.10,loadDropHoldTicks:5,
 assumptions:'Experimental observation cutoffs, not calibrated safety limits. Missing physics/frame/identity is unknown, not a fall. Source journal remains custody authority.'});
/** Read only declared byte-verified files. Rebinding a path/ref cannot select raw policy knobs. */
export async function prepareMobileStopMonitor(scene:NavigationSceneV1,read:(path:string)=>Promise<Uint8Array>):Promise<PlantStopMonitor>{
 if(scene.engine.id!=='mujoco_3d'||!scene.engine.stopPolicyRef||!scene.engine.controllerPolicyRef)throw new Error('MUJOCO_STOP_POLICY_REQUIRED');
 const doc=async(ref:{id:string;revision:number;path:string;sha256:string})=>{
  const f=scene.files.find(f=>f.path===ref.path);if(!f||f.sha256!==ref.sha256)throw new Error('MUJOCO_PROFILE_REF_INVALID');
  const b=await read(ref.path);if(b.length!==f.bytes||createHash('sha256').update(b).digest('hex')!==ref.sha256)throw new Error('MUJOCO_PROFILE_HASH_MISMATCH');
  const d=JSON.parse(Buffer.from(b).toString());if(d.id!==ref.id||d.revision!==ref.revision)throw new Error('MUJOCO_PROFILE_IDENTITY_MISMATCH');return d;
 };
 const policy=await doc(scene.engine.stopPolicyRef),load=await doc(scene.engine.loadProfileRef),controller=await doc(scene.engine.controllerPolicyRef);
 if(hashJson(controller)!==hashJson(MOBILE_CONTROLLER_POLICY))throw new Error('MUJOCO_CONTROLLER_POLICY_UNSUPPORTED');
 if(hashJson(policy)!==hashJson(MOBILE_STOP_POLICY))throw new Error('MUJOCO_STOP_POLICY_UNSUPPORTED');
 if(!validateLoadProfile(load).ok)throw new Error('MUJOCO_LOAD_PROFILE_INVALID');
 return createMobileStopMonitor(scene,load,policy);
}
export function createMobileStopMonitor(scene:NavigationSceneV1,load:LoadProfileV1,policy:typeof MOBILE_STOP_POLICY):PlantStopMonitor{
 const robot=scene.robots[0]!;let last=-1,restZ:number|undefined;
 const falling=new Map<string,number>(),props=load.props.filter(p=>p.attachment.kind==='free');
 return snapshot=>{
  const fail=(code:string)=>({code,robotId:robot.robotId}),s=snapshot as unknown as Sim3DSnapshotV1;
  if(s.tick!==last+1||!s.physics||s.physics.tick!==s.tick||s.physics.simTimeNs!==s.simTimeNs||s.simTimeNs!==String(s.tick*20_000_000))return fail('PHYSICS_OBSERVATION_INVALID');
  last=s.tick;
  const p=s.robots.find(r=>r.robotId===robot.robotId)?.pose3d;
  if(!p)return fail('PHYSICS_OBSERVATION_INVALID');
  if(![p.z,p.roll,p.pitch].every(Number.isFinite))return fail('PLANT_UNSTABLE');
  restZ??=p.z;
  const radius=robot.model.kinematics.wheelRadiusM;
  if(p.z<Math.max(restZ,0)-policy.belowRestWheelRadii*radius||p.z>restZ+policy.aboveRestWheelRadii*radius)return fail('PLANT_UNSTABLE');
  if(Math.abs(p.roll)>policy.maxAbsRollPitchRad||Math.abs(p.pitch)>policy.maxAbsRollPitchRad)return fail('BASE_TIPPED');
  if(s.physics.loads.length!==load.props.length||new Set(s.physics.loads.map(p=>p.propId)).size!==load.props.length)return fail('PHYSICS_OBSERVATION_INVALID');
  for(const prop of props){
   if(prop.attachment.kind!=='free')continue;
   const obs=s.physics.loads.find(p=>p.propId===prop.propId),pose=obs?.poseInSupport;
   if(!obs||obs.supportId!==prop.attachment.supportId||!pose||![...pose.positionM,...pose.quaternionXyzw].every(Number.isFinite)||Math.abs(Math.hypot(...pose.quaternionXyzw)-1)>1e-6)return fail('PHYSICS_OBSERVATION_INVALID');
   const count=pose.positionM[2]!<=prop.attachment.initialPoseInSupport.positionM[2]!-policy.loadDropM?(falling.get(prop.propId)??0)+1:0;falling.set(prop.propId,count);
   if(count>=policy.loadDropHoldTicks)return fail('LOAD_FELL');
  }
  return null;
 };
}
