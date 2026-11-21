// R4-B §8.2: the registered perception-gap study (92 rig runs), the Wilson interval of its proportions and the rig's offset rule. The runner and verifier are below the table.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import campaign from '../../../../../robotics/simulation-mujoco/campaigns/perception-gap-v1.json';
import {actorStream} from '../random';
import {cellArtifacts} from '../simulation3d/cell-campaign';
import {lockDigestOf} from '../../engineering/linkforge';
import {rigDerived,runPickRig,type RigRunRecord} from './pick-rig';
import {readBeliefEvidence,readBeliefManifest} from './belief-evidence';
import type {GraspAttempt} from '../../../../contracts/generated/navigation2d';
/** The registered nudge acts on the tick after the first commit; its window in the stream's own truth (ticks). The grip of the same descent touches the cup much later. */
const NUDGE_WINDOW_TICKS=25;
export interface StudyPoint {id:string;mode:'fixed_program'|'belief_ground_truth'|'belief_estimated';truthOffsetM:0|0.02;profileId:string|null;nudge:boolean;seeds:readonly number[]}
/** Exactly the table of R4-B §8.2 (campaigns/perception-gap-v1.json): 1+10+1+10+4×10+4×5+10 = 92 runs. A point whose seeds change nothing (offset 0, no noise, no nudge) runs once. */
export const PERCEPTION_STUDY_POINTS:readonly StudyPoint[]=campaign.points as StudyPoint[];
/** Wilson score interval (z = 1.96 by default) of `successes` out of `n`. */
export function wilsonInterval(successes:number,n:number,z=1.959964):{low:number;high:number}{
 if(!(n>0))throw new Error('POPULATION_EMPTY');
 const p=successes/n,z2=z*z,d=1+z2/n,c=p+z2/(2*n),h=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n));
 return {low:successes===0?0:Math.max(0,(c-h)/d),high:successes===n?1:Math.min(1,(c+h)/d)};
}
/** The rig's real cup offset of a run: the registered magnitude along a direction drawn from the stream `rig:<seed>` (recorded in the run's artifact; a lateral and a radial offset do not behave alike). */
export function rigOffsetM(seed:number,magnitudeM:number):[number,number]{
 if(magnitudeM===0)return [0,0];
 const a=actorStream(seed,`rig:${seed}`).next()*2*Math.PI;return [magnitudeM*Math.cos(a),magnitudeM*Math.sin(a)];
}

/** The study result of one point: counts, the Wilson interval of the first-try proportion, the median time and the belief error at commit. No ranking field exists. */
export interface PointResult {id:string;mode:StudyPoint['mode'];runs:number;firstTry:number;afterRecovery:number;attention:number;firstTryInterval:{low:number;high:number};medianTicks:number;unexpectedContacts:number;medianBeliefErrorAtCommitM:number|null;outcomes:Record<string,number>}
export interface PerceptionStudyV1 {schemaVersion:1;campaignId:string;calibration:'not_calibrated';points:PointResult[]}
export interface PerceptionStudyVerdict {expectedRuns:number;completedRuns:number;missingArtifacts:string[];issues:string[];study:PerceptionStudyV1|null}
const SRC=fileURLToPath(new URL('../../../../../',import.meta.url)),exists=(f:string)=>readFile(f).then(()=>true,()=>false);
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n',runId=(p:StudyPoint,seed:number)=>`${p.id}/s${seed}`;
const median=(xs:number[])=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]!:(s[m-1]!+s[m]!)/2;};
/** Run the registered study (or one point) into a new directory. One artifact directory per run; a failing run is recorded in `error.txt` and the verifier counts it missing. */
export async function runPerceptionStudy(o:{root:string;out:string;sourceCommit:string;pointId?:string;python?:string;signal?:AbortSignal}):Promise<PerceptionStudyVerdict>{
 if(!/^[a-f0-9]{40}$/.test(o.sourceCommit))throw new Error('STUDY_SOURCE_COMMIT_REQUIRED');
 if(o.pointId&&!PERCEPTION_STUDY_POINTS.some(p=>p.id===o.pointId))throw new Error('CAMPAIGN_CASE_UNREGISTERED');
 await mkdir(o.out);await writeFile(join(o.out,'campaign.json'),json({campaign,sourceCommit:o.sourceCommit,accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'}));
 const workerRoot=join(o.root,'robotics/simulation-mujoco'),runtime={python:o.python??join(o.root,'.venv-mujoco/bin/python'),workerRoot,schemaDir:join(o.root,'packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0'};
 for(const p of PERCEPTION_STUDY_POINTS.filter(x=>!o.pointId||x.id===o.pointId))for(const seed of p.seeds){
  o.signal?.throwIfAborted();const dir=join(o.out,runId(p,seed));await mkdir(dir,{recursive:true});
  try{await runPickRig({seed,mode:p.mode,truthOffsetM:p.truthOffsetM,profileId:p.profileId,nudge:p.nudge,recoveryPolicyId:null,directory:dir,sourceCommit:o.sourceCommit,maxTicks:campaign.maxTicks},runtime as never);}
  catch(e){await writeFile(join(dir,'error.txt'),String((e as Error).stack??e));}
  await writeFile(join(dir,'case.json'),json({schemaVersion:1,point:p.id,seed,sourceCommit:o.sourceCommit,accepted:false,artifacts:await cellArtifacts(dir)}));
 }
 const verdict=await verifyPerceptionStudy(o.out,o.pointId);await writeFile(join(o.out,'summary.json'),json({accepted:false,...verdict}));return verdict;
}
/** Read every run back from its artifacts: identity, the registered inputs, the belief stream (complete, no issue) and the outcome recomputed from it; then the per-point proportions. A run that does not check out is missing, never counted. */
export async function verifyPerceptionStudy(root:string,only?:string):Promise<PerceptionStudyVerdict>{
 const out:PerceptionStudyVerdict={expectedRuns:0,completedRuns:0,missingArtifacts:[],issues:[],study:null};
 let doc:{campaign:{id:string};sourceCommit:string};try{doc=JSON.parse(await readFile(join(root,'campaign.json'),'utf8'));}catch{out.issues.push('STUDY_CAMPAIGN_UNREADABLE');return out;}
 if(doc.campaign?.id!==campaign.id)out.issues.push('STUDY_CAMPAIGN_MISMATCH');
 const points:PointResult[]=[];
 for(const p of PERCEPTION_STUDY_POINTS.filter(x=>!only||x.id===only)){
  const rows:(RigRunRecord['result']&{beliefErrorAtCommitM:number|null})[]=[];
  for(const seed of p.seeds){
   out.expectedRuns++;const id=runId(p,seed),dir=join(root,id),bad=(code:string)=>{out.missingArtifacts.push(id);out.issues.push(`${id}: ${code}`);};
   try{
    const rec=JSON.parse(await readFile(join(dir,'rig-run.json'),'utf8')) as RigRunRecord,c=JSON.parse(await readFile(join(dir,'case.json'),'utf8')) as {artifacts:{path:string;sha256:string;bytes:number}[];sourceCommit:string};
    if(c.sourceCommit!==doc.sourceCommit)throw new Error('SOURCE_COMMIT_MISMATCH');
    const now=await cellArtifacts(dir);if(JSON.stringify(now)!==JSON.stringify(c.artifacts))throw new Error('ARTIFACT_HASH_MISMATCH');
    const i=rec.input,want={seed,mode:p.mode,truthOffsetM:p.truthOffsetM,profileId:p.profileId,nudge:p.nudge};
    if(!(i.seed===want.seed&&i.mode===want.mode&&i.truthOffsetM===want.truthOffsetM&&i.profileId===want.profileId&&i.nudge===want.nudge))throw new Error('RUN_INPUT_NOT_REGISTERED');
    if(Math.abs(Math.hypot(...rec.offsetM)-p.truthOffsetM)>1e-9||JSON.stringify(rec.offsetM)!==JSON.stringify(rigOffsetM(seed,p.truthOffsetM)))throw new Error('RIG_OFFSET_MISMATCH');
    // what the run's own report says: identity of the run, the source commit, the contacts, and (fixed program) the outcome; an error recorded by the runner is a missing run
    if(await exists(join(dir,'error.txt')))throw new Error('RUN_ERROR_RECORDED');
    const report=JSON.parse(await readFile(join(dir,'report.json'),'utf8'));
    if(report.manifest?.runId!==rec.result.runId)throw new Error('RUN_ID_MISMATCH');if(report.manifest?.sourceCommit!==doc.sourceCommit)throw new Error('REPORT_SOURCE_COMMIT_MISMATCH');
    // the registered nudge is in the run's own report exactly when the point has one (the record's `nudge` is only what was asked)
    const nudged=((report.manifest?.profiles??[]) as {id:string;provenance:string}[]).some(x=>x.id==='world-cup-nudge-v1'&&x.provenance==='registered_disturbance');
    if(nudged!==p.nudge)throw new Error('NUDGE_NOT_REGISTERED');
    let evidence:{attempts:GraspAttempt[];recovery:unknown[]}={attempts:[],recovery:[]};
    if(p.mode!=='fixed_program'){
     const ev=join(dir,'run/belief-evidence'),m=await readBeliefManifest(ev),r=await readBeliefEvidence(ev,m,{identity:{runId:rec.result.runId,seed,graspMode:p.mode}});
     if(r.issues.length||!r.complete)throw new Error(`BELIEF_EVIDENCE:${r.issues.join(',')}`);
     // the stream is bound to the registered profile, the rig scene and this run, not only to the mode and seed
     const profileDoc=JSON.parse(await readFile(join(SRC,'robotics/simulation-mujoco/fixtures/perception-v1',`${p.profileId??'perception-ground-truth-v1'}.json`),'utf8')) as {digest:string};
     // the scene of the stream is the scene the report's own manifest names (the runtime seals the admitted scene, so it is not the fixture file's digest)
     const reportScene=(report.manifest?.models as {id:string;hash:string}[]|undefined)?.find(x=>x.id==='mujoco_shared_world')?.hash;
     const wrong=[m.identity.graspMode!==p.mode&&'mode',m.identity.seed!==seed&&'seed',m.identity.perceptionProfileDigest!==profileDoc.digest&&'profile',(!reportScene||m.identity.sceneDigest!==reportScene)&&'scene',m.identity.runId!==rec.result.runId&&'run'].filter(Boolean);
     if(wrong.length)throw new Error(`BELIEF_IDENTITY_MISMATCH:${wrong.join(',')}`);
     // a nudge point must show the nudge in the stream's own truth: the cup moves at least 3 mm within NUDGE_WINDOW_TICKS after the commit, before any grip can touch it
     if(p.nudge){
      const commit=r.attempts.find(a=>a.cupId==='cup-1'&&a.stage==='commit')?.recordedTick; // the first commit: the nudge fires after it
      const samples=r.beliefs.flatMap(b=>b.truthAtObservedTick&&b.belief?[{t:b.belief.observedTick,x:b.truthAtObservedTick}]:[]).sort((a,b)=>a.t-b.t),before=samples.filter(x=>commit!==undefined&&x.t<=commit).at(-1),after=samples.filter(x=>commit!==undefined&&x.t>commit&&x.t<=commit+NUDGE_WINDOW_TICKS);
      if(!before||!after.some(x=>Math.hypot(x.x[0]-before.x[0],x.x[1]-before.x[1])>=0.003))throw new Error('NUDGE_NOT_OBSERVED');
     }
     evidence={attempts:[...new Map(r.attempts.map(a=>[a.attemptId,a])).values()],recovery:r.recovery};
    }
    // everything the run record reports is recomputed from the report and the stream
    const d=rigDerived(p.mode,evidence,report),got=rec.result as unknown as Record<string,unknown>,differ=Object.entries(d).filter(([k,v])=>JSON.stringify(got[k]??null)!==JSON.stringify(v??null)).map(([k])=>k);
    if(differ.length)throw new Error(`RESULT_NOT_FROM_EVIDENCE:${differ.join(',')}`);
    rows.push(rec.result);out.completedRuns++;
   }catch(e){bad((e as Error).message);}
  }
  if(!rows.length)continue;
  const firstTry=rows.filter(r=>r.outcome==='lifted'&&r.attempts===1).length,after=rows.filter(r=>r.outcome==='lifted'&&r.recovered).length,outcomes:Record<string,number>={};
  for(const r of rows)outcomes[r.outcome]=(outcomes[r.outcome]??0)+1;
  points.push({id:p.id,mode:p.mode,runs:rows.length,firstTry,afterRecovery:after,attention:rows.filter(r=>r.attention).length,firstTryInterval:wilsonInterval(firstTry,rows.length),medianTicks:median(rows.map(r=>r.ticks))!,unexpectedContacts:rows.reduce((n,r)=>n+r.unexpectedContacts,0),medianBeliefErrorAtCommitM:median(rows.flatMap(r=>r.beliefErrorAtCommitM===null?[]:[r.beliefErrorAtCommitM])),outcomes});
 }
 out.study=points.length?{schemaVersion:1,campaignId:campaign.id,calibration:'not_calibrated',points}:null;return out;
}
