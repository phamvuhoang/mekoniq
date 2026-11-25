// Readback uses the retained bench observations as the solver's only bench source. It never starts a worker.
import {constants} from 'node:fs';
import {lstat,open,opendir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {validateCalibrationRecord,validateIdentificationPlan} from '../packages/lab-runtime/src/engineering/calibration-record';
import {importCalibrationLog} from '../packages/lab-runtime/src/engineering/calibration-import';
import type {HeadlessBench} from '../packages/lab-runtime/src/engineering/bench-prediction';
import {identify,type CalibrationRecordV1} from '../packages/lab-runtime/src/engineering/identification';
import {benchAnchorTick,benchTarget,BENCH_MAX_TICKS,BENCH_SUBSTEPS} from '../packages/lab-runtime/src/v2/control/bench-signals';
import type {DriveTrace} from '../packages/lab-runtime/src/v2/control/drive-io';
import {hashJson} from '../packages/lab-runtime/src/v2/hash';
import {
 assessSelftestHeldOut,benchInputIdentity,calibrationSha,fitFile,hiddenFile,hiddenInput,loadCalibrationSelftestBase,predictSelftestHeldOut,selftestCsv,selftestPlan,selftestSidecar,
 SELFTEST_ENTRY,SELFTEST_PROTOCOL,SELFTEST_WORKER_ROOT,type CalibrationSelftestBase,type CalibrationSelftestIdentity,type SelftestBenchInput
} from './r4-calibration-selftest';

const maxEntryBytes=256*1024,maxFileBytes=1024*1024,maxTotalBytes=192*maxFileBytes;
// Initial evaluation, at most 15 x (2 Jacobian columns + 10 damped attempts), 4 final Jacobian columns, and 2 held-out calls.
const maxFitRuns=(1+15*(2+10)+4)*3+2;
const protocol=SELFTEST_PROTOCOL,hex256=/^[a-f0-9]{64}$/,sha1=/^[a-f0-9]{40}$/;
type Expected=Pick<CalibrationSelftestIdentity,'sourceCommit'|'toolClosures'>;
type Entry={identity:{before:CalibrationSelftestIdentity;after:CalibrationSelftestIdentity};files:{file:string;sha256:string;bytes:number}[];fitRuns:number};
const equal=(a:unknown,b:unknown)=>hashJson(a)===hashJson(b);
const check=(condition:unknown,reason:string)=>{if(!condition)throw Error(reason);};
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:unknown,expected:readonly string[])=>object(value)&&Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k));

async function readBounded(directory:string,file:string,maxBytes:number):Promise<Buffer>{
 const handle=await open(join(directory,file),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=await handle.stat();
  check(stat.isFile()&&stat.size>0&&stat.size<=maxBytes,'FILE_LIMIT');
  const bytes=Buffer.alloc(stat.size+1);
  let length=0;
  while(length<bytes.length){
   const got=await handle.read(bytes,length,bytes.length-length,length);
   if(!got.bytesRead)break;
   length+=got.bytesRead;
  }
  check(length===stat.size,'FILE_SIZE_CHANGED');
  return bytes.subarray(0,length);
 }finally{await handle.close();}
}

const STATIC_FILES=['protocol.json','base.json','sidecar.json','dataset.json','identification-plan.json','calibration-record.json','held-out-prediction.json','held-out-assessment.json',
 ...protocol.trials.flatMap(t=>[t.file,hiddenFile(t.trialId)])];
const entryKeys=['schemaVersion','documentType','sourceKind','toolSelfTest','produced','accepted','protocol','identity','fitRuns','files'];

function checkIdentity(entry:Entry,expected:Expected,lockText:string){
 check(keys(entry.identity,['before','after']),'TUPLE_MISMATCH');
 const {before,after}=entry.identity;
 check(keys(before,['sourceCommit','dirty','toolClosures','node','runtime'])&&keys(before.toolClosures,['portable','native'])&&
  sha1.test(before.sourceCommit)&&before.sourceCommit===expected.sourceCommit&&before.dirty===false&&/^v24\.\d+\.\d+$/.test(before.node)&&
  hex256.test(before.toolClosures.portable)&&hex256.test(before.toolClosures.native)&&equal(before.toolClosures,expected.toolClosures)&&equal(before,after),'TUPLE_MISMATCH');
 const runtime=before.runtime,engineVersion=/^mujoco==([^\s\\]+)(?:\s|$)/m.exec(lockText)?.[1];
 check(keys(runtime,['engine','engineVersion','lockDigest','pythonVersion','platform','arch'])&&runtime.engine==='mujoco_arm'&&typeof engineVersion==='string'&&runtime.engineVersion===engineVersion&&
  runtime.lockDigest===calibrationSha(lockText)&&/^3\.11\.\d+$/.test(runtime.pythonVersion)&&['darwin','linux'].includes(runtime.platform)&&['arm64','aarch64','x86_64'].includes(runtime.arch),'RUNTIME');
}

function commandProfile(base:CalibrationSelftestBase,t:typeof protocol.trials[number]){
 const axis=base.driveModel.axes.find(a=>a.axisId===t.axisId)!;
 const anchor=benchAnchorTick(base.driveModel),firstSample=anchor*BENCH_SUBSTEPS+axis.commandDelaySubsteps;
 const commands=Array.from({length:BENCH_MAX_TICKS-anchor+1},(_,tick)=>benchTarget(t.signal,base.plant.start[t.axisId]!,tick));
 check(axis.mode==='csp'&&axis.commandInterpolation==='hold'&&axis.encoder.countsPerRev===protocol.encoderCountsPerRevolution,'BASE');
 return {firstSample,commands};
}

function checkedTrace(value:unknown,input:SelftestBenchInput,commands:ReturnType<typeof commandProfile>,label:string):DriveTrace{
 check(keys(value,['input','trace']),'TRACE:'+label);
 const saved=value as {input:unknown;trace:DriveTrace},trace=saved.trace;
 check(equal(saved.input,benchInputIdentity(input)),'BENCH_INPUT:'+label);
 check(keys(trace,['axisId','dtS','samples'])&&trace.axisId===input.axisId&&trace.dtS===0.002&&Array.isArray(trace.samples)&&
  trace.samples.length===(BENCH_MAX_TICKS+1)*BENCH_SUBSTEPS,'TRACE:'+label);
 for(const [i,sample] of trace.samples.entries()){
  check(keys(sample,['target','actual','feedback','torqueNm','saturated'])&&sample&&Number.isFinite(sample.target)&&Number.isFinite(sample.actual)&&
   (sample.feedback===null||Number.isFinite(sample.feedback))&&Number.isFinite(sample.torqueNm)&&typeof sample.saturated==='boolean','TRACE:'+label);
  if(i>=commands.firstSample){
   const target=commands.commands[Math.floor((i-commands.firstSample)/BENCH_SUBSTEPS)]!;
   check(Math.abs(sample!.target-target)<1e-12,'BENCH_COMMAND:'+label);
  }
 }
 return trace;
}

function checkFit(record:CalibrationRecordV1,plan:ReturnType<typeof selftestPlan>){
 check(record?.sourceKind==='synthetic'&&record.toolSelfTest===true&&record.accepted===false&&Array.isArray(record.produced)&&record.produced.length===0&&
  validateCalibrationRecord(record).ok,'RECORD');
 check(record.fitted.length===plan.parameters.length&&plan.parameters.every((parameter,i)=>{
  const fitted=record.fitted[i]!,hidden=protocol.hidden[parameter.path as keyof typeof protocol.hidden];
  return fitted.path===parameter.path&&fitted.unit===parameter.unit&&fitted.atBound===false&&fitted.value>parameter.lower&&fitted.value<parameter.upper&&
   Math.abs(fitted.value/hidden-1)<protocol.relativeTolerance;
 }),'FIT_RECOVERY');
 const c=record.convergence;
 check(c.converged===true&&c.iterations>=1&&c.iterations<=plan.optimizer.maxIterations&&c.jacobianCondition!==null&&c.jacobianCondition>=1&&
  c.jacobianCondition<=plan.optimizer.maxJacobianCondition&&c.objectiveInitial>c.objectiveFinal&&c.objectiveFinal>=0,'FIT_CONVERGENCE');
}

/** Omit input only at the R4 adapter. Any declared artifact with missing or malformed bytes is corrupt. */
export async function verifyCalibrationSelftest(directory:string,expected:Expected,entrySha256?:string):Promise<string[]>{
 let stage='CORRUPT';
 try{
  check((await lstat(directory)).isDirectory(),stage);
  const entryBytes=await readBounded(directory,SELFTEST_ENTRY,maxEntryBytes);
  check(entrySha256===undefined||calibrationSha(entryBytes)===entrySha256,stage);
  const doc=JSON.parse(entryBytes.toString());
  check(keys(doc,entryKeys)&&doc.schemaVersion===1&&doc.documentType==='calibration-selftest'&&doc.sourceKind==='synthetic'&&doc.toolSelfTest===true&&
   Array.isArray(doc.produced)&&doc.produced.length===0&&doc.accepted===false,'MANIFEST');
  check(equal(doc.protocol,protocol),'PROTOCOL');
  const entry=doc as unknown as Entry,workerRoot=resolve(import.meta.dirname,'..',SELFTEST_WORKER_ROOT);
  stage='TUPLE_MISMATCH';
  checkIdentity(entry,expected,await readFile(join(workerRoot,'requirements.lock'),'utf8'));
  stage='FILE_ROSTER';
  check(Number.isSafeInteger(entry.fitRuns)&&entry.fitRuns>0&&entry.fitRuns<=maxFitRuns&&Array.isArray(entry.files),'FILE_ROSTER');
  const names=new Set([...STATIC_FILES,...Array.from({length:entry.fitRuns},(_,i)=>fitFile(i))]);
  const refs=new Map<string,Entry['files'][number]>();
  let total=0;
  for(const ref of entry.files){
   check(keys(ref,['file','bytes','sha256'])&&names.has(ref.file)&&!refs.has(ref.file)&&hex256.test(ref.sha256)&&
    Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=maxFileBytes,stage);
   refs.set(ref.file,ref);total+=ref.bytes;
  }
  check(refs.size===names.size&&total<=maxTotalBytes,stage);
  let count=0;
  for await(const item of await opendir(directory)){
   check(item.name===SELFTEST_ENTRY||names.has(item.name),stage);
   count++;
  }
  check(count===names.size+1,stage);
  const read=async(file:string)=>{
   const ref=refs.get(file)!;
   stage='CORRUPT:'+file;
   const bytes=await readBounded(directory,file,ref.bytes);
   check(bytes.length===ref.bytes&&calibrationSha(bytes)===ref.sha256,stage);
   return bytes.toString();
  };
  const json=async(file:string)=>JSON.parse(await read(file));

  check(equal(await json('protocol.json'),protocol),'PROTOCOL');
  stage='BASE';
  const base=await loadCalibrationSelftestBase(workerRoot);
  check(equal(await json('base.json'),base),'BASE');
  const sidecar=selftestSidecar(base.configDigest);
  check(equal(await json('sidecar.json'),sidecar),'SIDECAR');
  const csv:Record<string,string>={},commandByTrial=new Map(sidecar.trials.map(trial=>[trial.trialId,commandProfile(base,trial)]));
  for(const trial of sidecar.trials){
   const label=trial.trialId,input=hiddenInput(trial,base),commands=commandByTrial.get(label)!;
   const trace=checkedTrace(await json(hiddenFile(label)),input,commands,label);
   csv[trial.file]=await read(trial.file);
   check(csv[trial.file]===selftestCsv(trace,input.signal,base.driveModel),'RAW_CSV:'+label);
  }
  const imported=await importCalibrationLog(sidecar,async file=>csv[file]!);
  if(!imported.ok)throw Error('DATASET');
  const {dataset}=imported;
  check(equal(await json('dataset.json'),dataset),'DATASET');
  const plan=selftestPlan(dataset,sidecar,base),savedPlan=await json('identification-plan.json');
  check(validateIdentificationPlan(savedPlan).ok&&equal(savedPlan,plan),'PLAN');
  const record=await json('calibration-record.json') as CalibrationRecordV1;
  checkFit(record,plan);

  // Consume exactly the requests made by the deterministic optimizer, including its final validation calls.
  const finalTraces=new Map<string,DriveTrace>();
  let cursor=0;
  const replay:HeadlessBench=async input=>{
   check(cursor<entry.fitRuns,'FIT_TRACE_COUNT');
   const file=fitFile(cursor++),trial=sidecar.trials.find(t=>t.axisId===input.axisId&&equal(t.signal,input.signal))!;
   const trace=checkedTrace(await json(file),input,commandByTrial.get(trial.trialId)!,file);
   if(trial.split==='validation')finalTraces.set(hashJson(benchInputIdentity(input)),trace);
   return trace;
  };
  const derived=await identify(plan,dataset,sidecar,base,replay,{toolSelfTest:true});
  check(cursor===entry.fitRuns,'FIT_TRACE_COUNT');
  check(equal(derived,record),'FIT_REPLAY');
  const prediction=await predictSelftestHeldOut(dataset,sidecar,base,derived,async input=>{
   const trace=finalTraces.get(hashJson(benchInputIdentity(input)));
   if(!trace)throw Error('FINAL_TRACE');
   return trace;
  });
  check(equal(await json('held-out-prediction.json'),prediction),'PREDICTION');
  const assessment=assessSelftestHeldOut(dataset,prediction);
  check(assessment.status==='pass'&&equal(await json('held-out-assessment.json'),assessment),'ASSESSMENT');
  return [];
 }catch(error){
  const code=error instanceof Error&&/^[A-Z_]+(?::[a-zA-Z0-9.-]+)?$/.test(error.message)&&!['ELOOP','ENOENT','FILE_LIMIT','FILE_SIZE_CHANGED'].includes(error.message)?error.message:stage;
  return ['CALIBRATION_SELFTEST_'+code];
 }
}
