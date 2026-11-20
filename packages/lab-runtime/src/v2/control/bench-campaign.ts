/** The bench campaign `bench-v1` (R4.2, contracts §9 "Bench: mỗi trục đăng ký một step và một trapezoid với profile khởi điểm"): for each of the 8 bench axes one step and one trapezoid with the
 * served starting profile and drive-nominal-v1, 16 single-axis benches on the real engine. Every run keeps its own artifacts (bundle, trace chunks and manifest, report). Verification re-reads every
 * trace (chunk sizes and hashes, through readBenchTrace) and recomputes the metrics and the gain suggestions from it; it never trusts the report's numbers, and the oracle is the campaign file's, locked
 * before the recording. Pass-all of the suite is not a substitute for a run's artifact. */
import {lstat,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import campaign from '../../../../../robotics/simulation-mujoco/campaigns/bench-v1.json';
import {BENCH_SET_ID} from '../capabilities';
import {hashJson} from '../hash';
import {mujocoFromOptions} from '../simulation3d/mujoco';
import {cellArtifacts} from '../simulation3d/cell-campaign';
import {benchCatalog,benchMetrics,benchPlant,benchWheelMeasurement,createBenchRun,readBenchTrace,BENCH_TRACE_LIMITS} from './bench-runner';
import {BENCH_MAX_TICKS,benchAxisMode,benchSignalLastTick} from './bench-signals';
import {gainSuggestions} from './gain-suggest';
import type {BenchRequestV1,BenchSignal,TuningResultV1} from './drive-io';

export const BENCH_CAMPAIGN=campaign;
export interface BenchCase {id:string;scenarioId:BenchRequestV1['scenarioId'];axis:BenchRequestV1['axis'];signal:BenchSignal;expect:keyof typeof campaign.expectations}
export const BENCH_CASES=campaign.runs as BenchCase[];
export interface BenchCampaignVerdict {expectedRuns:number;completedCases:number;missingArtifacts:string[];issues:string[];runs:{id:string;status:string|null;metrics:Record<string,number|string>}[]}
const WORKER_ROOT=fileURLToPath(new URL('../../../../../robotics/simulation-mujoco/',import.meta.url));
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
type Report={manifest:{runId:string;sourceCommit:string;seed:number;scenario:{id:string}};outcome:{status:string;tick:number};tuning:TuningResultV1|null;bench:{request:Record<string,unknown>;anchorTick:number|null;traceIssues:string[]}};

async function readJson(root:string,path:string,max=64*1024*1024){
 let cur=root;for(const part of path.split('/')){cur=join(cur,part);if((await lstat(cur)).isSymbolicLink())throw Error('BENCH_ARTIFACT_PATH');}
 const st=await lstat(cur);if(!st.isFile()||st.size>max)throw Error('BENCH_ARTIFACT_LIMIT');return JSON.parse(await readFile(cur,'utf8'));
}

export async function runBenchCampaign(o:{root:string;out:string;sourceCommit:string;python?:string;caseId?:string;signal?:AbortSignal}):Promise<BenchCampaignVerdict>{
 o.signal?.throwIfAborted();
 if(!/^[a-f0-9]{40}$/.test(o.sourceCommit))throw Error('BENCH_SOURCE_COMMIT_REQUIRED');
 if(o.caseId&&!BENCH_CASES.some(c=>c.id===o.caseId))throw Error('CAMPAIGN_CASE_UNREGISTERED');
 const workerRoot=join(o.root,'robotics/simulation-mujoco'),probe=await mkdtemp(join(tmpdir(),'bench-campaign-'));
 await mkdir(o.out);await writeFile(join(o.out,'campaign.json'),json({campaign,sourceCommit:o.sourceCommit,hostArch:process.arch==='arm64'?'arm64':'x86_64',accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'}));
 try{
  const p=await mujocoFromOptions({enabled:true,python:o.python??join(o.root,'.venv-mujoco/bin/python'),workerRoot,lockPath:join(workerRoot,'requirements.lock'),directory:probe,bundleFile:async()=>{throw Error('NO_BUNDLE');}});
  if(!p.arm.runtime)throw Error(`MUJOCO_PREREQUISITE_MISSING: ${p.arm.capability.reason}`);
  const served=await benchCatalog(workerRoot);
  for(const spec of BENCH_CASES.filter(c=>!o.caseId||c.id===o.caseId)){
   const dir=join(o.out,spec.id);await mkdir(dir);let error:string|null=null;
   try{
    const bench:BenchRequestV1={schemaVersion:1,scenarioId:spec.scenarioId,axis:spec.axis,signal:spec.signal,driveExperimentId:campaign.driveExperimentId as BenchRequestV1['driveExperimentId'],controlProfile:served[spec.scenarioId].startingProfile};
    const run=await createBenchRun({project:undefined,scenarioId:spec.scenarioId,scenarioRevision:1,seed:campaign.seed,mode:'simulation',access:'simulated',backendSetId:BENCH_SET_ID,sourceCommit:o.sourceCommit,bench},
     {directory:join(dir,'run'),enabledBackends:['mujoco_3d','mujoco_arm'],runtime:p.arm.runtime});
    try{
     let v=await run.start();
     while(v.run.status==='running'){o.signal?.throwIfAborted();v=await run.action({actionId:`step-${v.run.runRevision}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:BENCH_MAX_TICKS}});}
     await writeFile(join(dir,'report.json'),json(await run.report()));
    }finally{await run.close();}
   }catch(e){error=String((e as Error).stack??e);await writeFile(join(dir,'error.txt'),error);}
   await writeFile(join(dir,'case.json'),json({schemaVersion:1,case:spec,sourceCommit:o.sourceCommit,accepted:false,execution:'actual_mujoco',engineVersion:'3.17.0',error,artifacts:await cellArtifacts(dir)}));
   if(o.signal?.aborted)break;
  }
 }finally{await rm(probe,{recursive:true,force:true});}
 const verdict=await verifyBenchCampaign(o.out,o.caseId);await writeFile(join(o.out,'summary.json'),json({accepted:false,...verdict}));return verdict;
}

/** `workerRoot`: where the plant fixtures are (the drive model, the starting profile, the envelope and the metric policy): this checkout's, the commit the campaign names. */
export async function verifyBenchCampaign(root:string,onlyCase?:string,workerRoot=WORKER_ROOT):Promise<BenchCampaignVerdict>{
 const selected=BENCH_CASES.filter(c=>!onlyCase||c.id===onlyCase);
 const v:BenchCampaignVerdict={expectedRuns:selected.length,completedCases:0,missingArtifacts:[],issues:[],runs:[]};let source:string|undefined,host:string|undefined;
 try{const c=await readJson(root,'campaign.json');if(c.accepted!==false||c.execution!=='actual_mujoco'||c.calibration!=='not_calibrated'||hashJson(c.campaign)!==hashJson(campaign)||!/^[a-f0-9]{40}$/.test(c.sourceCommit)||!['arm64','x86_64'].includes(c.hostArch))throw Error();source=c.sourceCommit;host=c.hostArch;}catch{v.issues.push('BENCH_CAMPAIGN_IDENTITY');}
 const served=await benchCatalog(workerRoot);
 for(const spec of selected){
  const dir=join(root,spec.id),check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
  try{
   const rec=await readJson(dir,'case.json');check(rec.schemaVersion===1&&rec.accepted===false&&rec.execution==='actual_mujoco'&&rec.sourceCommit===source&&hashJson(rec.case)===hashJson(spec)&&rec.error===null,'BENCH_CASE_IDENTITY');
   check(hashJson(await cellArtifacts(dir))===hashJson(rec.artifacts),'BENCH_ARTIFACT_INVENTORY');
   const report=await readJson(dir,'report.json') as Report,t=report.tuning;check(t,'BENCH_NO_RESULT');
   // identity: commit, scenario, seed, signal, the starting profile and drive model the plant serves (their bundle bytes too), the traced axes, the engine's architecture
   const profile=served[spec.scenarioId].startingProfile,plant=await benchPlant(workerRoot,{scenarioId:spec.scenarioId,axis:spec.axis,driveExperimentId:campaign.driveExperimentId as BenchRequestV1['driveExperimentId']});
   check(report.manifest.sourceCommit===source&&report.manifest.scenario.id===spec.scenarioId&&report.manifest.seed===campaign.seed&&t!.seed===campaign.seed&&report.manifest.runId===t!.runId,'BENCH_RUN_IDENTITY');
   check(hashJson(report.bench.request as never)===hashJson({schemaVersion:1,scenarioId:spec.scenarioId,axis:spec.axis,signal:spec.signal,driveExperimentId:campaign.driveExperimentId,controlProfile:{id:profile.id,revision:profile.revision,digest:profile.digest}})&&hashJson(t!.signal as never)===hashJson(spec.signal as never),'BENCH_REQUEST_IDENTITY');
   check(t!.plant.controlProfileDigest===profile.digest&&(await readFile(join(dir,'run/bundle/bench-control.json'),'utf8'))===JSON.stringify(profile),'BENCH_PROFILE_IDENTITY');
   check(t!.plant.driveModelDigest===plant.model.digest&&(await readFile(join(dir,'run/bundle/bench-drive.json'))).equals(plant.modelBytes)&&t!.plant.plantModelDigest===plant.plantModelDigest&&t!.plant.load===plant.load,'BENCH_PLANT_IDENTITY');
   check(hashJson(t!.axisIds)===hashJson(plant.axisIds),'BENCH_AXIS_IDENTITY');
   check(t!.engine.hostArch&&t!.engine.hostArch===host,'BENCH_HOSTARCH:'+String(t!.engine.hostArch));
   check(report.bench.anchorTick===plant.anchorTick,'BENCH_ANCHOR:'+String(report.bench.anchorTick));
   // the trace as read back now: every chunk's size and sha256 against its manifest, its ticks against their place; complete, and the manifest the result names
   const read=await readBenchTrace(join(dir,'run/trace'),{runId:t!.runId,axisIds:plant.axisIds,plantModelDigest:plant.plantModelDigest,driveModelDigest:plant.model.digest,controlProfileDigest:profile.digest},report.outcome.tick);
   check(!read.issues.length&&read.manifest?.coverage.complete&&read.manifest.coverage.lastTick===report.outcome.tick,'BENCH_TRACE_INCOMPLETE:'+read.issues.join(','));
   if(read.bodyForwardMps!==null||t!.wheelMeasurement!==undefined)
    check(spec.axis==='wheels'&&hashJson(t!.wheelMeasurement??null)===hashJson(benchWheelMeasurement(read,report.outcome.tick,plant.wheelRadiusM)),'BENCH_WHEEL_COMPARISON_NOT_FROM_TRACE');
   const first=read.traces[0]!,samples=first.samples.slice(BENCH_TRACE_LIMITS.substeps).filter(x=>x!==null).length;
   check(read.manifestSha256===t!.trace.sha256&&read.manifest!.chunks.length===t!.trace.chunks&&samples===t!.trace.samples,'BENCH_TRACE_NOT_THE_RESULTS');
   // the result's status against the run: a completed step or trapezoid ran to the bench's last tick; any other result ended on the tick it names
   const end=t!.fault?.tick??t!.unstable?.tick??t!.collision?.tick;
   check(t!.status==='completed'?end===undefined&&report.outcome.tick===(spec.signal.kind==='hold'?plant.anchorTick+benchSignalLastTick(spec.signal):BENCH_MAX_TICKS):end===report.outcome.tick,'BENCH_STATUS_NOT_THE_RUN');
   // the metrics and the suggestions, recomputed from the trace read back and the inertia the run reports
   const again=benchMetrics(first,spec.signal,report.bench.anchorTick,benchAxisMode(spec.axis),plant.policy,t!.status);
   check(hashJson(again as never)===hashJson(t!.metrics as never)&&hashJson(t!.policy as never)===hashJson(plant.policy as never),'BENCH_METRICS_NOT_FROM_TRACE');
   const env=plant.envelope.axes.find(a=>a.axisId===plant.axisIds[0])!;
   check(t!.effectiveInertia?t!.effectiveInertia.valueKgM2>0&&hashJson(t!.suggestions as never)===hashJson(gainSuggestions({mode:benchAxisMode(spec.axis),inertiaKgM2:t!.effectiveInertia.valueKgM2},env) as never):t!.suggestions===null,'BENCH_SUGGESTIONS_NOT_FROM_INERTIA');
   // the oracle, as the campaign file declared it before the recording
   const oracle=campaign.expectations[spec.expect] as {status:string;metrics:Record<string,string>};
   check(t!.status===oracle.status,'BENCH_ORACLE_STATUS:'+t!.status);
   for(const [k,want] of Object.entries(oracle.metrics)){const m=t!.metrics[k];check(m&&(want==='either'||(want==='available'?m.available:!m.available&&m.reason===want)),`BENCH_ORACLE_METRIC:${k}:${m?.available?'available':m?.reason}`);}
   if(t!.status==='completed')check(samples===campaign.oracles.trace.samplesPerAxis,'BENCH_ORACLE_TRACE:'+samples);
   v.runs.push({id:spec.id,status:t!.status,metrics:Object.fromEntries(Object.entries(t!.metrics).map(([k,m])=>[k,m.available?m.value:m.reason]))});
   v.completedCases++;
  }catch(e){v.missingArtifacts.push(spec.id);v.issues.push(`${spec.id}:${(e as Error).message}`);v.runs.push({id:spec.id,status:null,metrics:{}});}
 }
 return v;
}
