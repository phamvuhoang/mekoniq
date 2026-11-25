// The stop-v1 campaign (R5 plan E13): MJ-TRAY01 with three cups under the registered HW-C stop variants; every case runs a stop request on the real MuJoCo worker and is read back from its immutable evidence.
// The oracle checks what can be checked (torque zero on the tick, no motion accepted, no restart, receipt = intent, nothing served after) and nothing about distance or slip: those are results.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import table from '../../../../../robotics/simulation-mujoco/campaigns/stop-v1.json';
import policyDoc from '../../../../../robotics/simulation-mujoco/fixtures/stop-v1/stop-policy-v1.json';
import {lockDigestOf} from '../../engineering/linkforge';
import {hashJson} from '../hash';
import {createFixedStepScenarioRun} from '../navigation2d/runner';
import {mujocoMobilePlant} from '../simulation3d/mujoco-mobile';
import {setupTray,readTrayRun,trayCatalog,trayRuntime,TRAY_MAX_TICKS,TRAY_SCENARIO,type TrayContext} from '../simulation3d/tray-campaign';
import {cellArtifacts} from '../simulation3d/cell-campaign';
import {blockingReadIssues} from '../simulation3d/tray-verdict';
import {readCampaignJournal,verifyCampaignOutcome} from './campaign-source-evidence';
import {readJson} from './cil-campaign';
import {stopStartTick} from './stop-functions';
import {buildStopReport,validateStopReport,stopReportDigest} from './stop-report';
import {bodySpeeds} from './stop-metrics';
import type {FaultScheduleEntry} from '../fault-schedule';
import type {StopPolicyV1,StopReportV1,PhysicsTickRecord} from '../navigation2d/contracts';
import type {StopScheduleEntryV1} from './drive-io';
import type {RunReport} from '../report';
import type {TrayExperimentId} from '../simulation3d/tray-experiments';

export const STOP_CAMPAIGN='stop-v1';
/** observeTicks (500) + restTicks (25) + driftTicks (100) of the stop policy, rounded up to whole batches of 250 ticks */
export const OBSERVE_AFTER_STOP_TICKS=750;
const SET='engineering-mujoco-3d-v1',json=(v:unknown)=>JSON.stringify(v,null,2)+'\n',sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),hostArch=()=>process.arch==='arm64'?'arm64':'x86_64';
export interface StopCase{id:string;group:'S1'|'S2'|'S3'|'S4'|'S5';experimentId:TrayExperimentId;seed:number;entry:StopScheduleEntryV1;faults?:FaultScheduleEntry[];repeatOf?:string}
export const STOP_CASES=table.cases as unknown as StopCase[];
export const STOP_TABLE=table;
export interface StopCampaignVerdict{expectedRuns:number;completedCases:number;missingArtifacts:string[];issues:string[];reports:{caseId:string;report:StopReportV1}[]}

/** The first tick from which the body holds at least 95 % of its fastest speed for 25 ticks: where a survey run says the cruise begins, and the speed it reaches. */
export function cruiseOf(records:readonly PhysicsTickRecord[]):{tick:number;speedMps:number}|null{
 const v=bodySpeeds(records),ticks=[...v.keys()].sort((a,b)=>a-b);
 const smooth=(t:number)=>{let s=0;for(let k=0;k<5;k++)s+=v.get(t-k)??0;return s/5;};
 const peak=Math.max(0,...ticks.map(smooth));if(peak<=0)return null;
 for(const t of ticks){let ok=true;for(let k=0;k<25&&ok;k++)if(smooth(t+k)<0.95*peak)ok=false;if(ok)return {tick:t,speedMps:peak};}
 return null;
}

/** One MJ-TRAY01 run with a stop request (and optionally drive faults) into `dir`: its bundle copy, run directory, report and, when the stop fired, its stop report. */
export async function runStopCase(c:TrayContext,dir:string,spec:Pick<StopCase,'experimentId'|'seed'|'entry'|'faults'>|{experimentId:TrayExperimentId;seed:number;entry?:undefined;faults?:undefined}):Promise<RunReport>{
 const {locked,scene}=c.compiled.get(spec.experimentId)!;await mkdir(dir,{recursive:true});
 const bundle=join(dir,'bundle');for(const path of ['navigation-scene.json',...scene.files.map(f=>f.path)]){await mkdir(join(bundle,path,'..'),{recursive:true});await writeFile(join(bundle,path),await c.service.bundleFile(locked.ref.bundleDigest,path));}
 const run=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:TRAY_SCENARIO,scenarioRevision:1,seed:spec.seed,mode:'simulation',access:'simulated',backendSetId:SET,sourceCommit:c.sourceCommit,engineering:locked,
  ...spec.faults?.length?{driveFaultSchedule:spec.faults}:{},...spec.entry?{stopSchedule:[spec.entry]}:{}},
  {directory:join(dir,'run'),catalog:c.catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>c.service.bundleFile(d,p),plant:mujocoMobilePlant(c.runtime),runtime:c.runtime});
 let n=0,report:RunReport|undefined;
 try{
  await run.start();let v=await run.snapshot();
  // after a stop the run needs attention, but the plant is still read: the run goes on until the whole observation window (rest, rest ticks, drift ticks) is on record
  const observeUntil=spec.entry?stopStartTick(spec.entry)+OBSERVE_AFTER_STOP_TICKS:0;
  while((['running','awaiting_confirmation'].includes(v.run.status)||(v.run.status==='needs_attention'&&v.tick<observeUntil))&&v.tick<TRAY_MAX_TICKS){c.signal?.throwIfAborted();const before=v.tick;v=await run.action({actionId:`stop-${++n}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:250}});if(v.tick===before)break;}
  report=await run.report();
 }finally{await run.close();if(report)await writeFile(join(dir,'report.json'),json(report));}
 return report;
}
const POLICY=policyDoc as unknown as StopPolicyV1;
/** The physics profile numbers that decide the stop, with the sources the fixture gives them. */
const decidingFrom=(physics:{contact:{rollingM:number;sliding:number};brakeTorqueNm?:number;sources:Record<string,never>},drive:{axes:{onDisable:string;brakeTorqueNm:number|null}[];sources:{disable:never}}) =>{
 const src=Object.values(physics.sources)[0] as never;
 return [{id:'rollingResistanceM',value:physics.contact.rollingM,source:src},{id:'floorContactSliding',value:physics.contact.sliding,source:src},{id:'onDisable',value:drive.axes[0]!.onDisable,source:drive.sources.disable},{id:'brakeTorqueNm',value:drive.axes[0]!.brakeTorqueNm,source:drive.sources.disable}] as StopReportV1['decidingParameters'];
};
/** The stop report of a finished case, built from its durable files only. */
export async function stopReportOfCase(dir:string,spec:StopCase):Promise<StopReportV1>{
 const report=await readJson(dir,'report.json') as RunReport,{cp,scene,records}=await readTrayRun(dir),policy=POLICY;
 const evidence=records as unknown as PhysicsTickRecord[],intents=evidence.filter(r=>(r as {stopIntents?:unknown[]}).stopIntents).map(r=>({tick:r.tick,intents:(r as unknown as {stopIntents:never[]}).stopIntents}));
 const receipts=evidence.flatMap(r=>(r as unknown as {stopReceipts?:never[]}).stopReceipts??[]);
 const doc=async(p:string)=>JSON.parse(await readFile(join(dir,'bundle',p),'utf8'));
 const eng=scene.engine as unknown as {physicsProfileRef:{path:string};driveModelRef:{path:string}},physics=await doc(eng.physicsProfileRef.path),drive=await doc(eng.driveModelRef.path);
 const wheel=scene.robots[0]!.model.kinematics.wheelRadiusM,chain=(drive.axes as {axisId:string}[]).map(a=>a.axisId),appliedAfter=receipts.find(r=>(r as {entryId:string}).entryId===spec.entry.id) as {appliedTick:number}|undefined;
 return buildStopReport({runId:cp.runId,entry:spec.entry,intents,receipts,records:evidence,policy,chainAxes:chain,wheelRadiusM:wheel,attention:report.attention.map(a=>({tick:a.tick,reason:a.reason})),served:report.outcome.served,status:report.outcome.status,servedAfterStop:report.outcome.served!=='0'&&appliedAfter!==undefined,decidingParameters:decidingFrom(physics,drive)});
}

export async function runStopCampaign(o:{root:string;out:string;sourceCommit:string;python?:string;caseId?:string;signal?:AbortSignal}):Promise<StopCampaignVerdict>{
 o.signal?.throwIfAborted();
 if(!/^[a-f0-9]{40}$/.test(o.sourceCommit))throw Error('STOP_SOURCE_COMMIT_REQUIRED');
 const only=(o.caseId??'').split(',').filter(Boolean);if(only.some(id=>!STOP_CASES.some(c=>c.id===id)))throw Error('CAMPAIGN_CASE_UNREGISTERED');
 await mkdir(o.out);await writeFile(join(o.out,'campaign.json'),json({campaign:table,sourceCommit:o.sourceCommit,hostArch:hostArch(),accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'}));
 const wanted=STOP_CASES.filter(c=>!only.length||only.includes(c.id)),{service,compiled,workerRoot}=await setupTray(o,[...new Set(wanted.map(c=>c.experimentId))]);
 const ctx:TrayContext={service,compiled,runtime:trayRuntime(o.root,workerRoot,await lockDigestOf(join(workerRoot,'requirements.lock')),o.python),catalog:trayCatalog(),sourceCommit:o.sourceCommit,...o.signal?{signal:o.signal}:{}};
 for(const spec of wanted){
  const dir=join(o.out,spec.id);let error:string|null=null;
  try{await runStopCase(ctx,dir,spec);await writeFile(join(dir,'stop-report.json'),json(await stopReportOfCase(dir,spec)));}catch(e){error=String((e as Error).stack??e);await mkdir(dir,{recursive:true});await writeFile(join(dir,'error.txt'),error);}
  await writeFile(join(dir,'case.json'),json({schemaVersion:1,case:spec,sourceCommit:o.sourceCommit,accepted:false,execution:'actual_mujoco',engineVersion:'3.17.0',error,artifacts:await cellArtifacts(dir)}));
  if(o.signal?.aborted)break;
 }
 const verdict=await verifyStopCampaign(o.out,o.caseId);await writeFile(join(o.out,'summary.json'),json({accepted:false,...verdict}));return verdict;
}

/** Every case from its own files: identity, inventory, the journal's outcome, the durable records, and the stop report rebuilt from them. An invariant that is `violated` is an issue; distances and slips never are. */
export async function verifyStopCampaign(out:string,onlyCase?:string):Promise<StopCampaignVerdict>{
 const v:StopCampaignVerdict={expectedRuns:0,completedCases:0,missingArtifacts:[],issues:[],reports:[]};let source:string;
 try{const c=await readJson(out,'campaign.json');if(c.accepted!==false||c.execution!=='actual_mujoco'||c.calibration!=='not_calibrated'||hashJson(c.campaign)!==hashJson(table)||!/^[a-f0-9]{40}$/.test(c.sourceCommit)||!['arm64','x86_64'].includes(c.hostArch))throw Error();source=c.sourceCommit;}
 catch{v.issues.push('STOP_CAMPAIGN_IDENTITY');return v;}
 const only=(onlyCase??'').split(',').filter(Boolean),selected=STOP_CASES.filter(c=>!only.length||only.includes(c.id));v.expectedRuns=selected.length;if(!selected.length){v.issues.push('STOP_CASE_UNREGISTERED');return v;}
 const runs=new Set<string>(),recordHash=new Map<string,string>();
 for(const spec of selected){
  const dir=join(out,spec.id),check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
  try{
   const rec=await readJson(dir,'case.json');
   check(rec.schemaVersion===1&&rec.engineVersion==='3.17.0'&&rec.accepted===false&&rec.execution==='actual_mujoco'&&rec.sourceCommit===source&&hashJson(rec.case)===hashJson(spec)&&rec.error===null,'STOP_CASE_IDENTITY');
   check(hashJson(await cellArtifacts(dir))===hashJson(rec.artifacts),'STOP_ARTIFACT_INVENTORY');
   const report=await readJson(dir,'report.json') as RunReport,{cp,records,read,manifest}=await readTrayRun(dir);
   const blocked=blockingReadIssues(read,manifest as never,records.length,cp.tick);check(!blocked.length,'STOP_PHYSICS_EVIDENCE:'+blocked.join(','));
   const mf=(cp as unknown as {manifest:{seed:number;sourceCommit:string;scenario:{id:string};stopSchedule?:{entries:StopScheduleEntryV1[]}}}).manifest;
   check(mf.seed===spec.seed&&mf.sourceCommit===source&&mf.scenario.id===TRAY_SCENARIO&&cp.tick===report.outcome.tick,'STOP_RUN_IDENTITY');
   check(hashJson(mf.stopSchedule?.entries)===hashJson([spec.entry]),'STOP_SCHEDULE_NOT_THE_CASES');
   check(!runs.has(cp.runId),'STOP_DUPLICATE_EXECUTION');runs.add(cp.runId);
   const journal=await readCampaignJournal(join(dir,'run'),cp.runId),outcome=verifyCampaignOutcome(cp as never,journal,report,'STOP');check(report.outcome&&hashJson(outcome)===hashJson(report.outcome),'STOP_OUTCOME_NOT_FROM_JOURNAL');
   const stored=await readJson(dir,'stop-report.json') as StopReportV1,rebuilt=await stopReportOfCase(dir,spec);
   check(validateStopReport(stored).ok&&stopReportDigest(stored)===stored.digest,'STOP_REPORT_INVALID');check(hashJson(stored)===hashJson(rebuilt),'STOP_REPORT_NOT_FROM_STREAM');
   check(stored.verdict==='fired','STOP_NOT_FIRED');
   for(const i of stored.invariants)if(i.result==='violated')v.issues.push(`STOP_ORACLE:${spec.id}:${i.id}`);
   if(spec.group==='S4'){const t=stored.invariants.find(i=>i.id==='TORQUE_ZERO_AT_EMERGENCY');check(t?.result==='pass','STOP_S4_TORQUE_NOT_ZERO');}
   recordHash.set(spec.id,hashJson(records.map(r=>({...r}))));
   v.reports.push({caseId:spec.id,report:stored});v.completedCases++;
  }catch(e){v.issues.push(`${spec.id}:${(e as Error).message}`);}
 }
 // the repeated runs are the same run: their durable physics records are bit-identical
 for(const spec of selected.filter(c=>c.repeatOf&&recordHash.has(c.id)&&recordHash.has(c.repeatOf)))if(recordHash.get(spec.id)!==recordHash.get(spec.repeatOf!))v.issues.push(`STOP_REPEAT_NOT_BIT_IDENTICAL:${spec.id}`);
 void sha;
 return v;
}
