/** The fault-v1 campaign (plan V08): 23 runs of drive, feedback, command-channel and sensor faults on MJ-FD01 and the shared-world cell, each verified from its own recorded stream. Expectations and the oracle are
 * locked in campaigns/fault-v1.json and fixtures/fault-v1 before the first run: a verdict is never loosened after a run has been seen. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import campaign from '../../../../../robotics/simulation-mujoco/campaigns/fault-v1.json';
import {cellArtifacts} from '../simulation3d/cell-campaign';
import {createScenarioRun,type ScenarioRun} from '../scenario-runner';
import {serviceAmrAsset} from '../assets';
import {defaultCatalog} from '../capabilities';
import {mujocoWorldPorts} from '../simulation3d/mujoco-world-ports';
import {spawnMujocoWorker} from '../simulation3d/worker-client';
import {readRetainedWorldFaultReport} from '../simulation3d/world-drive-report';
import type {WorldFactoryInput,WorldPlantBindings} from '../simulation3d/world-ports';
import {lockDigestOf} from '../../engineering/linkforge';
import {hashJson} from '../hash';
import type {RunReport} from '../report';
import type {FaultScheduleEntry} from '../fault-schedule';
import {readCampaignJournal,verifyCampaignOutcome} from './campaign-source-evidence';
import {buildDriveEvidence} from './drive-report';
import {DRIVE_FAULTS,faultStartTick,validateDriveFaultSchedule} from './drive-faults';
import {driveDocumentDigest,type ControlProfileV1,type DriveModelV1,type FaultOracleV1} from './drive-io';
import {buildFaultReport,serveTicksOf,servedFacts} from '../fault-report';
import {readJson,readStream,replayMobile,runMobile,setupMobile,type Rec,type Trace} from './cil-campaign';

export const FAULT_CAMPAIGN=campaign;
export interface FaultCase {id:string;kind:'mobile'|'cell';seed:number;schedule:FaultScheduleEntry[];expect:{status:string[];served:string|null;verdicts:Record<string,string[]>}}
export const FAULT_CASES=campaign.cases as unknown as FaultCase[];
export interface FaultCampaignVerdict {expectedRuns:number;completedCases:number;missingArtifacts:string[];issues:string[];coverage:{faultId:string;runs:number;targets:number;params:number}[];verdicts:{id:string;entries:Record<string,string>}[]}
const workerRoot=fileURLToPath(new URL('../../../../../robotics/simulation-mujoco/',import.meta.url));
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex'),json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
const EPOCH=Date.parse('2026-11-01T00:00:00Z'),hostArch=()=>process.arch==='arm64'?'arm64':'x86_64';
const oracleBytes=()=>readFile(join(workerRoot,'fixtures/fault-v1/fault-oracle-v1.json'));
const loadOracle=async()=>{const b=await oracleBytes(),o=JSON.parse(b.toString()) as FaultOracleV1;if(driveDocumentDigest(o)!==o.digest)throw Error('FLT_ORACLE_DIGEST');return {oracle:o,sha256:sha(b)};};

/** The table itself: every catalog fault at least twice (the single sensor and the single gripper axis: with different parameters), the campaign-only reset once, each schedule admissible. */
export function campaignCoverage(cases:readonly FaultCase[]=FAULT_CASES){
 const out=Object.keys(DRIVE_FAULTS).map(faultId=>{const entries=cases.flatMap(c=>c.schedule).filter(e=>e.faultId===faultId);return {faultId,runs:entries.length,targets:new Set(entries.map(e=>e.targetId)).size,params:new Set(entries.map(e=>JSON.stringify([e.params,e.durationMs]))).size};});
 const problems:string[]=[];
 for(const c of out){
  const one=['lidar-noise','grip-weak'].includes(c.faultId);
  if(c.faultId==='drive-reset'?c.runs<1:c.runs<2||(one?c.params<2:c.targets<2))problems.push('FLT_COVERAGE:'+c.faultId);
 }
 if(cases.length<16)problems.push('FLT_RUNS_BELOW_16');
 for(const c of cases){
  const axes=c.kind==='mobile'?['amr-1/wheel-left','amr-1/wheel-right']:['arm-1/J1','arm-1/J2','arm-1/J3','arm-1/J4','arm-1/J5','arm-1/J6','arm-1/gripper','amr-1/wheel-left','amr-1/wheel-right'];
  const v=validateDriveFaultSchedule(c.schedule,{axes,lidars:c.kind==='mobile'?['amr-1/lidar-2d']:[],campaign:true});if(!v.ok)problems.push(`FLT_SCHEDULE:${c.id}:${v.reasonCodes.join(',')}`);
  if(Object.keys(c.expect.verdicts).sort().join()!==c.schedule.map(e=>e.id).sort().join())problems.push('FLT_EXPECT_ENTRIES:'+c.id);
 }
 return {coverage:out,problems};
}

async function runCell(o:{root:string;dir:string;sourceCommit:string;python:string;signal?:AbortSignal},spec:FaultCase){
 const dir=o.dir,directory=join(dir,'run');await mkdir(directory,{recursive:true});
 const project=JSON.parse(await readFile(join(workerRoot,'fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
 let input!:WorldFactoryInput,bindings!:WorldPlantBindings,opens=0,error:string|null=null,run:ScenarioRun|undefined;const started=performance.now();
 const factory=mujocoWorldPorts({python:o.python,workerRoot,schemaDir:join(o.root,'packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0',faultCampaign:true},async options=>{opens++;return spawnMujocoWorker(options);});
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
 const manifest={project,scenarioId:campaign.cell.scenarioId,scenarioRevision:1,seed:spec.seed,mode:'simulation' as const,access:'simulated' as const,backendSetId:campaign.cell.backendSetId,sourceCommit:o.sourceCommit,driveExperimentId:campaign.driveExperimentId as 'drive-nominal-v1',...spec.schedule.length?{driveFaultSchedule:structuredClone(spec.schedule)}:{}};
 const providers={directory,catalog,assets:[serviceAmrAsset({id:'service-robot',revision:1,chassis:'service',trays:3,sensor:'lidar'})],enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],worldPorts:async(i:WorldFactoryInput)=>{input=i;bindings=await factory(i);return bindings;}};
 try{
  run=await createScenarioRun(manifest,providers);let n=0;await run.start();let v=await run.snapshot();
  while(v.tick<campaign.maxTicks&&!['completed','needs_attention','cancelled'].includes(v.run.status)){o.signal?.throwIfAborted();v=await run.action({actionId:`fault-cell-${++n}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:25}});}
  const report=await run.report();await writeFile(join(dir,'report.json'),json(report));
 }catch(e){error=String((e as Error).stack??e);await writeFile(join(dir,'error.txt'),error);}
 finally{await run?.close();void bindings;void input;await writeFile(join(dir,'trace.json'),json({opens,elapsedMs:performance.now()-started,error}));}
 return error;
}

export async function runFaultCampaign(o:{root:string;out:string;sourceCommit:string;python?:string;caseId?:string;signal?:AbortSignal}):Promise<FaultCampaignVerdict>{
 o.signal?.throwIfAborted();
 if(!/^[a-f0-9]{40}$/.test(o.sourceCommit))throw Error('FLT_SOURCE_COMMIT_REQUIRED');
 if(o.caseId&&!FAULT_CASES.some(c=>c.id===o.caseId))throw Error('CAMPAIGN_CASE_UNREGISTERED');
 const {problems}=campaignCoverage();if(problems.length&&!o.caseId)throw Error(problems[0]);
 const {sha256}=await loadOracle();
 await mkdir(o.out);await writeFile(join(o.out,'campaign.json'),json({campaign,sourceCommit:o.sourceCommit,hostArch:hostArch(),oracleSha256:sha256,accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'}));
 const wanted=FAULT_CASES.filter(c=>!o.caseId||c.id===o.caseId),python=o.python??join(o.root,'.venv-mujoco/bin/python');
 if(wanted.some(c=>c.kind==='mobile')){
  const {service,compiled}=await setupMobile(o,[campaign.driveExperimentId as 'drive-nominal-v1']);
  const runtime={python,workerRoot,schemaDir:join(o.root,'packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1};
  const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)};
  for(const spec of wanted.filter(c=>c.kind==='mobile')){
   const dir=join(o.out,spec.id);let error:string|null=null;
   try{await runMobile({service,compiled,runtime,catalog,sourceCommit:o.sourceCommit,...o.signal?{signal:o.signal}:{}},dir,campaign.driveExperimentId,spec.seed,spec.schedule);}
   catch(e){error=String((e as Error).stack??e);await mkdir(dir,{recursive:true});await writeFile(join(dir,'error.txt'),error);}
   await writeFile(join(dir,'case.json'),json({schemaVersion:1,case:spec,sourceCommit:o.sourceCommit,accepted:false,execution:'actual_mujoco',engineVersion:'3.17.0',error,artifacts:await cellArtifacts(dir)}));
   if(o.signal?.aborted)break;
  }
 }
 if(!o.signal?.aborted)for(const spec of wanted.filter(c=>c.kind==='cell')){
  const dir=join(o.out,spec.id);await mkdir(dir);const error=await runCell({root:o.root,dir,sourceCommit:o.sourceCommit,python,...o.signal?{signal:o.signal}:{}},spec);
  await writeFile(join(dir,'case.json'),json({schemaVersion:1,case:spec,sourceCommit:o.sourceCommit,accepted:false,execution:'actual_mujoco',engineVersion:'3.17.0',error,artifacts:await cellArtifacts(dir)}));
  if(o.signal?.aborted)break;
 }
 const verdict=await verifyFaultCampaign(o.out,o.caseId);await writeFile(join(o.out,'summary.json'),json({accepted:false,...verdict}));return verdict;
}

export async function verifyFaultCampaign(root:string,onlyCase?:string):Promise<FaultCampaignVerdict>{
 const cov=campaignCoverage(),v:FaultCampaignVerdict={expectedRuns:0,completedCases:0,missingArtifacts:[],issues:[...onlyCase?[]:cov.problems],coverage:cov.coverage,verdicts:[]};let source:string,oracle:FaultOracleV1;
 try{
  const c=await readJson(root,'campaign.json'),o=await loadOracle();oracle=o.oracle;
  if(c.accepted!==false||c.execution!=='actual_mujoco'||c.calibration!=='not_calibrated'||hashJson(c.campaign)!==hashJson(campaign)||!/^[a-f0-9]{40}$/.test(c.sourceCommit)||c.hostArch!==hostArch()||c.oracleSha256!==o.sha256)throw Error();source=c.sourceCommit;
 }catch{v.issues.push('FLT_CAMPAIGN_IDENTITY');return v;}
 const selected=FAULT_CASES.filter(c=>!onlyCase||c.id===onlyCase);v.expectedRuns=selected.length;if(!selected.length){v.issues.push('FLT_CASE_UNREGISTERED');return v;}
 const executions=new Set<string>();
 for(const spec of selected){
  const dir=join(root,spec.id),check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
  try{
   const rec=await readJson(dir,'case.json');
   check(rec.schemaVersion===1&&rec.engineVersion==='3.17.0'&&rec.accepted===false&&rec.execution==='actual_mujoco'&&rec.sourceCommit===source&&hashJson(rec.case)===hashJson(spec)&&rec.error===null,'FLT_CASE_IDENTITY');
   check(hashJson(await cellArtifacts(dir))===hashJson(rec.artifacts),'FLT_ARTIFACT_INVENTORY');
   const report=await readJson(dir,'report.json') as RunReport,cp=await readJson(dir,'run/run.json'),trace=await readJson(dir,'trace.json') as Trace&{opens?:number};
   check(cp.manifest.seed===spec.seed&&cp.manifest.sourceCommit===source&&cp.runId===report.manifest.runId&&cp.tick===report.outcome.tick&&(trace.spawns??trace.opens)===1&&!trace.error,'FLT_RUN_IDENTITY');
   check(typeof cp.runId==='string'&&!executions.has(cp.runId),'FLT_DUPLICATE_EXECUTION');executions.add(cp.runId);
   // the schedule the run carried is the locked one, byte for byte, and nothing else was injected
   check(spec.schedule.length?hashJson(cp.manifest.driveFaultSchedule)===hashJson({entries:spec.schedule,hash:hashJson(spec.schedule)})&&hashJson(report.manifest.driveFaultSchedule)===hashJson(cp.manifest.driveFaultSchedule):cp.manifest.driveFaultSchedule===undefined&&report.faultReport===undefined,'FLT_SCHEDULE_MANIFEST');
   const journal=await readCampaignJournal(join(dir,'run'),cp.runId),outcome=verifyCampaignOutcome(cp,journal,report,spec.kind==='cell'?'CELL':'CIL');
   check(spec.expect.status.includes(outcome.status),'FLT_OUTCOME_STATUS:'+outcome.status);
   if(spec.expect.served!==null)check(outcome.served===spec.expect.served,'FLT_SERVED:'+outcome.served);
   // the report is recomputed from the stream, never read back
   let again:ReturnType<typeof buildFaultReport>|undefined;
   const serveTicks=serveTicksOf(journal.events,EPOCH),attention=(cp.attention as {tick:number;reason:string}[]).map(a=>({tick:a.tick,reason:a.reason}));
   if(spec.kind==='mobile'){
    const {scene,read}=await readStream(dir,cp);check(read.complete&&read.records.length===cp.tick+1,'FLT_PHYSICS_COVERAGE:'+read.issues.join(','));
    const e=scene.engine as {driveModelRef:{path:string};controlProfileRef:{path:string}},model=JSON.parse(await readFile(join(dir,'bundle',e.driveModelRef.path),'utf8')) as DriveModelV1,control=JSON.parse(await readFile(join(dir,'bundle',e.controlProfileRef.path),'utf8')) as ControlProfileV1;
    const records=read.records as unknown as (Rec&{faultIntents?:never[];faultReceipts?:never[];base?:never})[];
    const events=await replayMobile(dir,cp,scene,{model,control},records,trace,spec.schedule);
    const rows=records.map(r=>({tick:r.tick,drives:r.drives??[]})),drive=buildDriveEvidence(model,rows,{complete:read.complete,issues:read.issues,events});
    check(hashJson(drive as never)===hashJson(report.driveEvidence as never),'FLT_DRIVE_REPORT_NOT_FROM_STREAM');
    // the wire sent a fault injection exactly on the ticks the schedule's timeline names, and only the ones the worker applies
    const sentTicks=new Set((trace as unknown as {steps:{tick:number}[]}).steps.map(s=>s.tick));check(sentTicks.size===(trace as unknown as {steps:unknown[]}).steps.length,'FLT_RESEND');
    if(spec.schedule.length)again=buildFaultReport({runId:cp.runId,schedule:spec.schedule,oracle,drives:rows,controllerEvents:events,attention,physics:records as never,
     receipts:records.flatMap(r=>(r as {faultReceipts?:never[]}).faultReceipts??[]),intents:records.map(r=>({tick:r.tick,injections:(r as {faultIntents?:never[]}).faultIntents??[]})),
     facts:{reportedServed:serveTicks.length,confirmedServed:servedFacts(rows,serveTicks).confirmedServed,resendsAfterUnknown:0,custodyChanged:null}});
   }else if(spec.schedule.length){
    const physical=(report.coffee as {physicalCustody?:{status:string}[]}|undefined)?.physicalCustody??[];
    again=await readRetainedWorldFaultReport(join(dir,'run'),{sceneDigest:cp.world.snapshot.sceneDigest,runId:cp.runId,bootId:cp.world.snapshot.bootId,publicCommittedTick:cp.tick},{faults:spec.schedule,oracle,facts:{serveTicks,custodyChanged:physical.some(x=>x.status==='unknown'),attention}});
   }
   if(spec.schedule.length){
    check(again,'FLT_REPORT_UNAVAILABLE');check(hashJson(again as never)===hashJson(report.faultReport as never),'FLT_REPORT_NOT_FROM_STREAM');
    check(again!.oracleDigest===oracle.digest,'FLT_ORACLE_BINDING');
    const verdicts:Record<string,string>={};
    for(const [i,e] of spec.schedule.entries()){
     const row=again!.entries[i]!;verdicts[e.id]=row.verdict;
     check(spec.expect.verdicts[e.id]!.includes(row.verdict),`FLT_VERDICT:${e.id}:${row.verdict}`);
     const o=oracle.faults.find(f=>f.faultId===e.faultId)!;
     // a fault the oracle requires that fired must have been detected in time: this is the locked rule, not a per-case choice
     if(row.verdict!=='not_fired'&&o.required)check(row.verdict==='detected_in_time','FLT_REQUIRED_DETECTION:'+e.id);
     if(row.verdict==='not_fired')check(row.injection.appliedTick===null&&!(trace as unknown as {steps?:{faultInjections?:unknown}[]}).steps?.some(s=>JSON.stringify(s).includes(`"${e.id}"`)),'FLT_NOT_FIRED_INJECTED:'+e.id);
     else check(row.injection.appliedTick===faultStartTick((e.trigger as {value:number}).value),'FLT_APPLIED_TICK:'+e.id);
    }
    const bad=again!.invariants.filter(x=>x.result==='violated');check(!bad.length,'FLT_INVARIANT:'+bad.map(x=>x.id).join(','));
    v.verdicts.push({id:spec.id,entries:verdicts});
   }
   v.completedCases++;
  }catch(e){v.issues.push(`${spec.id}:${(e as Error).message.split('\n')[0]}`);if((e as NodeJS.ErrnoException).code==='ENOENT')v.missingArtifacts.push(spec.id);}
 }
 return v;
}
