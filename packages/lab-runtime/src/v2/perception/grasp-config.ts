// What a run's grasp request resolves to, on the server: the registered perception profile (the bytes checked against the fixture manifest, then the document against its schema and digest), the
// registered regions and the grasp policy; and the grasp frames of the cell layout as offsets from the cup. Absent or `fixed_program`: nothing, the run is the R2b run.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {PerceptionProfileV1,RecoveryPolicyV1} from '../../../../contracts/generated/navigation2d';
import {qrotate} from '../frames';
import type {CellLayout} from '../simulation3d/arm-cell-scene';
import {validateGraspRequest,validatePerceptionProfile} from './perception-contracts';
import type {GraspPlanInput} from './grasp-conditioning';
import {validateRecoveryPolicy} from './recovery-policy';
const DIR='fixtures/perception-v1',ID=/^perception-[a-z0-9-]{1,64}-v[0-9]{1,3}$/,GROUND_TRUTH='perception-ground-truth-v1';
export interface GraspConfig {mode:'belief_ground_truth'|'belief_estimated';profile:PerceptionProfileV1;/** sha256 of the profile file's bytes */profileSha256:string;
 /** the registered recovery policy of the run (V13), with the sha256 of its file; absent = no recovery */recovery?:{policy:RecoveryPolicyV1;sha256:string};
 regions:{view:{id:string;supportId:string;halfExtentM:[number,number]};workHalfExtentM:[number,number]};beliefWaitTicks:number}
interface Regions {viewRegions:{id:string;supportId:string;halfExtentM:[number,number]}[];workRegions:{id:string;viewRegionId:string;halfExtentM:[number,number]}[];graspPolicy:{beliefWaitTicks:number}}
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
export async function loadGraspConfig(workerRoot:string,request:{graspMode?:string;perceptionProfileId?:string;recoveryPolicyId?:string}):Promise<GraspConfig|undefined>{
 const mode=request.graspMode;if(mode===undefined||mode==='fixed_program')return undefined;
 const checked=validateGraspRequest(request);if(!checked.ok)throw new Error(checked.reasonCodes[0]!);
 const id=mode==='belief_ground_truth'?GROUND_TRUTH:request.perceptionProfileId!;
 if(!ID.test(id))throw new Error('PERCEPTION_PROFILE_NOT_REGISTERED');
 const dir=join(workerRoot,DIR),manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')) as {files:{path:string;sha256:string}[]};
 const bytes=async(name:string)=>{const entry=manifest.files.find(f=>f.path===name);if(!entry)throw new Error('PERCEPTION_PROFILE_NOT_REGISTERED');const b=await readFile(join(dir,name));if(sha(b)!==entry.sha256)throw new Error('PERCEPTION_FIXTURE_HASH_MISMATCH');return b;};
 const profileBytes=await bytes(`${id}.json`),regionsBytes=await bytes('perception-regions-v1.json');
 const regions=JSON.parse(regionsBytes.toString()) as Regions,profile=JSON.parse(profileBytes.toString()) as PerceptionProfileV1;
 const valid=validatePerceptionProfile(profile,regions.viewRegions.map(r=>r.id));if(!valid.ok)throw new Error(`PERCEPTION_PROFILE_INVALID: ${valid.reasonCodes.join(',')}`);
 const view=regions.viewRegions.find(r=>r.id===profile.visibleRegionId)!,work=regions.workRegions.find(r=>r.viewRegionId===view.id);
 if(!work)throw new Error('PERCEPTION_REGIONS_INVALID');
 let recovery:GraspConfig['recovery'];
 if(request.recoveryPolicyId!==undefined){
  if(request.recoveryPolicyId!=='pick-recovery-v1')throw new Error('RECOVERY_POLICY_NOT_REGISTERED');
  const rdir=join(workerRoot,'fixtures/recovery-v1'),rm=JSON.parse(await readFile(join(rdir,'manifest.json'),'utf8')) as {files:{path:string;sha256:string}[]},entry=rm.files.find(f=>f.path==='pick-recovery-v1.json');
  if(!entry)throw new Error('RECOVERY_POLICY_NOT_REGISTERED');const rb=await readFile(join(rdir,'pick-recovery-v1.json'));if(sha(rb)!==entry.sha256)throw new Error('RECOVERY_FIXTURE_HASH_MISMATCH');
  const policy=JSON.parse(rb.toString()) as RecoveryPolicyV1,ok=validateRecoveryPolicy(policy);if(!ok.ok)throw new Error(`RECOVERY_POLICY_INVALID: ${ok.reasonCodes.join(',')}`);recovery={policy,sha256:sha(rb)};
 }
 return {mode:mode as GraspConfig['mode'],profile,profileSha256:sha(profileBytes),...recovery?{recovery}:{},regions:{view,workHalfExtentM:work.halfExtentM},beliefWaitTicks:recovery?.policy.beliefWaitTicks??regions.graspPolicy.beliefWaitTicks};
}
/** The pick, approach and lift frames of the layout (the fixture's definitions: approach = pick back along the tool axis, lift = pick + liftM up) as offsets from the cup's nominal centre, all in the arm base frame. */
export function graspOffsetsFrom(layout:Pick<CellLayout,'grasp'>,cupCentreM:readonly number[]):GraspPlanInput['graspOffsets']{
 const {pick,approachM,liftM}=layout.grasp,ag=qrotate(pick.quaternionXyzw as [number,number,number,number],[0,0,1]),q=pick.quaternionXyzw as [number,number,number,number];
 const off=(p:readonly number[]):[number,number,number]=>[p[0]!-cupCentreM[0]!,p[1]!-cupCentreM[1]!,p[2]!-cupCentreM[2]!];
 return {pickApproach:{positionM:off(pick.position.map((v,i)=>v-approachM*ag[i]!)),quaternionXyzw:q},pick:{positionM:off(pick.position),quaternionXyzw:q},
  lift:{positionM:off([pick.position[0]!,pick.position[1]!,pick.position[2]!+liftM]),quaternionXyzw:q}};
}
