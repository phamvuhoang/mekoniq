import {gunzipSync} from 'node:zlib';
import {hashJson} from '../hash';
import {validatePhysicsEvidenceShape,type PhysicsTickRecord} from '../navigation2d/contracts';
import type {ControlRecord} from '../navigation2d/evidence';
import {validatePhysicsRecord,type PhysicsAdmission} from './physics-evidence';
import {physicsMetrics} from './physics-metrics';
import {MOBILE_STOP_POLICY} from './mujoco-mobile';
import {studyTrajectory} from './study-navigation';
import type {verifiedSimulationInput} from './simulation-input';
import type {verifiedPhysicsInputs} from './physics-inputs';
/** The axes of the run's drive model, when it has one: its physics records carry one snapshot per axis and are admitted only with them. */
export const studyDriveAxes=(scene:{engine:object},get:<T>(p:string)=>T)=>{const ref=(scene.engine as {driveModelRef?:{path:string}}).driveModelRef;return ref?get<{axes:{axisId:string}[]}>(ref.path).axes.map(a=>a.axisId):undefined;};
export const studyAdmission=(v:ReturnType<typeof verifiedSimulationInput>,inputs:ReturnType<typeof verifiedPhysicsInputs>):PhysicsAdmission=>{const driveAxes=studyDriveAxes(v.scene,v.get);return {...driveAxes?{driveAxes}:{},maxAbsRollPitchRad:MOBILE_STOP_POLICY.maxAbsRollPitchRad,robotId:inputs.physical.robotId,props:inputs.load.props.map(p=>({propId:p.propId,supportId:p.attachment.kind==='free'?p.attachment.supportId:null})),contactIds:['floor',...inputs.physical.links.flatMap(l=>l.collision.map((_,i)=>`${inputs.physical.robotId}/${l.id}/c${i}`)),...inputs.load.props.map(p=>`prop/${p.propId}`),...[...v.scene.world.obstacles,...v.scene.world.boundaries].map(o=>`static/${o.id}`)],tickMs:20,substeps:10,driveFrameInBase:v.scene.robots[0]!.model.driveFrameInBase};};
export function verifiedStudyPhysics(v:ReturnType<typeof verifiedSimulationInput>,inputs:ReturnType<typeof verifiedPhysicsInputs>){
 const p=v.report.physicsEvidence!,manifest=v.get('physics/manifest.json');
 if(!validatePhysicsEvidenceShape(manifest)||hashJson(manifest)!==hashJson(p.manifest)||v.refs.get('physics/manifest.json')?.sha256!==p.manifestSha256)throw Error('PHYSICS_MANIFEST_MISMATCH');
 const admission=studyAdmission(v,inputs);
 const records:PhysicsTickRecord[]=[],control:ControlRecord[]=[];let total=0;
 const decode=(ref:{path:string;sha256:string;bytes:number},prefix:string)=>{
  const actual=v.refs.get(prefix+ref.path),b=v.documents.get(prefix+ref.path);if(!actual||actual.sha256!==ref.sha256||actual.bytes!==ref.bytes||!Buffer.isBuffer(b))throw Error('PHYSICS_OR_CONTROL_ARTIFACT_MISSING');
  const inflated=gunzipSync(b,{maxOutputLength:64*1024*1024});total+=inflated.length;if(total>400*1024*1024)throw Error('PHYSICS_READ_LIMIT');const lines=inflated.toString().trimEnd().split('\n');if(lines.length>65536||lines.some(l=>Buffer.byteLength(l)>256*1024))throw Error('PHYSICS_READ_LIMIT');return lines.map(l=>JSON.parse(l));
 };
 for(const ref of p.manifest.streams[0]!.chunks)records.push(...decode(ref,'physics/'));
 if(records.length!==v.report.outcome.tick+1)throw Error('PHYSICS_WINDOW_MISMATCH');records.forEach((r,i)=>validatePhysicsRecord(r,admission,i));
 for(const ref of v.report.navigation2d!.artifacts.control)control.push(...decode(ref,'evidence/'));
 if(control.length!==v.report.outcome.tick||control.some((c,i)=>c.tick!==i||c.targetTick!==i+1||c.velocities.length!==1||c.velocities[0]!.robotId!==admission.robotId||!Number.isFinite(c.velocities[0]!.vMps)||!Number.isFinite(c.velocities[0]!.omegaRadps)||c.actorUpdates.length))throw Error('CONTROL_WINDOW_MISMATCH');
 const trajectory=studyTrajectory(v),metrics=physicsMetrics({complete:true,records,gaps:[],issues:[]},admission,{complete:true,trajectory,control,policy:v.scene.policy.parameters});
 if(hashJson(metrics)!==hashJson(p.metrics))throw Error('PHYSICS_METRIC_MISMATCH');
 return metrics;
}
