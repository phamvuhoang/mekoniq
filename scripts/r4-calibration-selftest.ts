// R4.5 (V15): the five-trial, xArm bench tool self-test. The hidden perturbations and the sampling window are fixed before the first bench call.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {assessCalibration} from '../packages/lab-runtime/src/engineering/calibration';
import {benchBindingDigest,importCalibrationLog,type CalibrationSidecar} from '../packages/lab-runtime/src/engineering/calibration-import';
import {calibrationConfigDigest,predictTrials,type HeadlessBench} from '../packages/lab-runtime/src/engineering/bench-prediction';
import {datasetDigestOf,identify,type IdentificationModels,type IdentificationPlanV1} from '../packages/lab-runtime/src/engineering/identification';
import {benchPlant} from '../packages/lab-runtime/src/v2/control/bench-runner';
import {benchAnchorTick,BENCH_SUBSTEPS} from '../packages/lab-runtime/src/v2/control/bench-signals';
import {sealDriveDocument,type BenchSignal,type ControlProfileV1,type DriveModelV1,type DriveTrace} from '../packages/lab-runtime/src/v2/control/drive-io';
import {hashJson} from '../packages/lab-runtime/src/v2/hash';
import {readXArmFixture,XARM_FIXTURE_ID} from '../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';

const ARM='armatureKgM2[2]',DAMP='jointDynamics.damping';
const step=(amplitude:number):BenchSignal=>({kind:'step',amplitude,atTick:10});
const roster:[string,'tune'|'validation',string,BenchSignal][]=[
 ['tune-j3-step1','tune','xarm-1/J3',step(0.1)],
 ['tune-j3-trap','tune','xarm-1/J3',{kind:'trapezoid',distance:0.2,peakVelocity:0.2,acceleration:0.5,atTick:10}],
 ['tune-j2-step1','tune','xarm-1/J2',step(0.1)],
 ['val-j3-step05','validation','xarm-1/J3',step(0.05)],
 ['val-j2-step05','validation','xarm-1/J2',step(0.05)]
];
const trials:CalibrationSidecar['trials']=roster.map(([trialId,split,axisId,signal])=>({trialId,split,condition:axisId,file:trialId+'.csv',axisId,signal}));

export const SELFTEST_PROTOCOL={
 schemaVersion:1,documentType:'calibration-selftest-protocol',sourceKind:'synthetic',toolSelfTest:true,
 seed:7,hidden:{[ARM]:0.13,[DAMP]:1.5},relativeTolerance:0.05,encoderCountsPerRevolution:16_384,
 sampleWindow:{startNs:-20_000_000,endNs:600_000_000,intervalNs:4_000_000,substepNs:2_000_000},
 scenarioId:'MJ-BENCH-ARM',driveExperimentId:'drive-nominal-v1',
 axisIds:['xarm-1/J2','xarm-1/J3'],trials,unprovenPaths:['driveModel.axes[k].torque.scale']
} as const;
const protocol=SELFTEST_PROTOCOL,quantum=2*Math.PI/protocol.encoderCountsPerRevolution;
export const SELFTEST_ENTRY='calibration-selftest.json';
export const SELFTEST_WORKER_ROOT='robotics/simulation-mujoco';
export const fitFile=(i:number)=>'fit-'+String(i).padStart(3,'0')+'.json';
export const hiddenFile=(id:string)=>'hidden-'+id+'.json';
export const calibrationSha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export type CalibrationSelftestIdentity={
 sourceCommit:string;dirty:false;toolClosures:{portable:string;native:string};node:string;
 runtime:{engine:'mujoco_arm';engineVersion:string;lockDigest:string;pythonVersion:string;platform:string;arch:string}
};
export type CalibrationSelftestBase=IdentificationModels&{
 plant:{id:string;revision:number;load:'empty';start:Record<string,number>;componentText:string;fixtureManifest:unknown}
};
export type SelftestBenchInput=Parameters<HeadlessBench>[0];
export const benchInputIdentity=({axisId,signal,driveModel,control,physicsOverride}:SelftestBenchInput)=>({
 axisId,signal,driveModelDigest:driveModel.digest,controlProfileDigest:control.digest,physicsOverride
});

export async function loadCalibrationSelftestBase(workerRoot:string):Promise<CalibrationSelftestBase>{
 const plant=await benchPlant(workerRoot,{scenarioId:protocol.scenarioId,axis:'J3',driveExperimentId:protocol.driveExperimentId});
 const fixture=readXArmFixture(workerRoot);
 const control=JSON.parse(await readFile(join(workerRoot,'fixtures/drive-v1/xarm6-control-v1.json'),'utf8')) as ControlProfileV1;
 if(control.plantModelDigest!==plant.plantModelDigest||!control.driveModelDigests.includes(plant.model.digest))throw Error('SELFTEST_BASE_MODEL_MISMATCH');
 return {plantModelDigest:plant.plantModelDigest,plant:{id:plant.id,revision:plant.revision,load:plant.load,start:plant.start,componentText:fixture.componentText,
  fixtureManifest:JSON.parse(await readFile(join(workerRoot,'fixtures',XARM_FIXTURE_ID,'manifest.json'),'utf8'))},driveModel:plant.model,control,physics:fixture.physics,
  configDigest:calibrationConfigDigest({plantModelDigest:plant.plantModelDigest,load:plant.load,axisIds:protocol.axisIds})};
}

export const selftestSidecar=(configDigest:string):CalibrationSidecar=>({
 sourceKind:'synthetic',generator:'calibration-selftest/v1: MuJoCo bench at hidden parameters with encoder quantization',deviceId:'simulator',configDigest,clockDomain:'sim',clockOffsetNs:0,
 units:{command:'rad',position:'rad'},uncertainty:{command:1e-9,position:quantum/2},
 policy:{channels:{command:{absoluteTolerance:1e-3,relativeTolerance:0},position:{absoluteTolerance:1e-3,relativeTolerance:0}},minTrialsPerCondition:1,maxClockGapNs:20_000_000,capabilities:{position:'actuator'}},
 trials:structuredClone(trials)
});

export const selftestPlan=(dataset:Parameters<typeof datasetDigestOf>[0],sidecar:CalibrationSidecar,base:CalibrationSelftestBase):IdentificationPlanV1=>sealDriveDocument({
 schemaVersion:1,documentType:'identification-plan',id:'selftest-j3',revision:1,datasetDigest:datasetDigestOf(dataset),baseDriveModelDigest:base.driveModel.digest,plantModelDigest:base.plantModelDigest,
 controlProfileDigest:base.control.digest,benchBinding:benchBindingDigest(sidecar),
 parameters:[{path:ARM,initial:0.1,lower:0.03,upper:0.4,unit:'kg*m^2'},{path:DAMP,initial:1,lower:0.2,upper:3,unit:'N*m*s/rad'}],
 objective:{channels:['position'],weights:{position:1}},optimizer:{method:'bounded_least_squares',maxIterations:15,tolerance:1e-6,relativeStep:1e-2,maxJacobianCondition:1e4}
});
export const hiddenInput=(trial:CalibrationSidecar['trials'][number],{driveModel,control}:CalibrationSelftestBase):SelftestBenchInput=>({
 axisId:trial.axisId,signal:trial.signal,driveModel,control,physicsOverride:protocol.hidden
});

export function selftestCsv(trace:DriveTrace,signal:BenchSignal,driveModel:DriveModelV1):string{
 const {startNs,endNs,intervalNs,substepNs}=protocol.sampleWindow,anchor=benchAnchorTick(driveModel);
 const origin=BENCH_SUBSTEPS*(anchor+(signal.kind==='hold'?0:signal.atTick))-1;
 const rows=['time_ns,command,position'];
 for(let time=startNs;time<=endNs;time+=intervalNs){
  const sample=trace.samples[origin+time/substepNs];
  if(!sample)throw Error('SELFTEST_TRACE_GAP');
  rows.push([time,sample.target,Math.round(sample.actual/quantum)*quantum].join(','));
 }
 return rows.join('\n')+'\n';
}

type Put=(file:string,doc:unknown)=>Promise<void>;
export async function runCalibrationSelftest(base:CalibrationSelftestBase,bench:HeadlessBench,put?:Put){
 await put?.('protocol.json',protocol);
 await put?.('base.json',base);
 const sidecar=selftestSidecar(base.configDigest),csv:Record<string,string>={};
 await put?.('sidecar.json',sidecar);
 for(const trial of sidecar.trials){
  const input=hiddenInput(trial,base),trace=await bench(input);
  await put?.(hiddenFile(trial.trialId),{input:benchInputIdentity(input),trace});
  csv[trial.file]=selftestCsv(trace,trial.signal,base.driveModel);
  await put?.(trial.file,csv[trial.file]);
 }
 const imported=await importCalibrationLog(sidecar,async file=>csv[file]!);
 if(!imported.ok)throw Error('SELFTEST_IMPORT:'+imported.issues.join(','));
 const {dataset}=imported,plan=selftestPlan(dataset,sidecar,base);
 await put?.('dataset.json',dataset);
 await put?.('identification-plan.json',plan);
 let fitRuns=0;
 const finalTraces=new Map<string,DriveTrace>();
 const recordingBench:HeadlessBench=async input=>{
  const trace=await bench(input),identity=benchInputIdentity(input);
  if(put)await put(fitFile(fitRuns),{input:identity,trace});
  fitRuns++;
  const trial=sidecar.trials.find(t=>t.axisId===input.axisId&&hashJson(t.signal)===hashJson(input.signal));
  if(trial?.split==='validation')finalTraces.set(hashJson(identity),trace);
  return trace;
 };
 const record=await identify(plan,dataset,sidecar,base,recordingBench,{toolSelfTest:true});
 await put?.('calibration-record.json',record);
 const prediction=await predictSelftestHeldOut(dataset,sidecar,base,record,async input=>{
  const trace=finalTraces.get(hashJson(benchInputIdentity(input)));
  if(!trace)throw Error('SELFTEST_FINAL_TRACE_MISSING');
  return trace;
 });
 const assessment=assessSelftestHeldOut(dataset,prediction);
 await put?.('held-out-prediction.json',prediction);
 await put?.('held-out-assessment.json',assessment);
 return {record,assessment,fitRuns};
}

type Dataset=Parameters<typeof predictTrials>[0];
export const predictSelftestHeldOut=(dataset:Dataset,sidecar:CalibrationSidecar,base:CalibrationSelftestBase,record:Awaited<ReturnType<typeof identify>>,bench:HeadlessBench)=>predictTrials(dataset,sidecar,base,bench,{
 trialIds:new Set(trials.filter(t=>t.split==='validation').map(t=>t.trialId)),
 physicsOverride:Object.fromEntries(record.fitted.map(f=>[f.path,f.value]))
});

export function assessSelftestHeldOut(dataset:Dataset,prediction:Awaited<ReturnType<typeof predictTrials>>){
 // The measured label is local to the numeric comparison. The recorded result has no calibrated capabilities.
 const {status,reasons,residuals,domain}=assessCalibration({...dataset,sourceKind:'measured'},prediction);
 return {sourceKind:'synthetic',toolSelfTest:true,status,reasons,residuals,domain};
}

export async function writeCalibrationSelftest(out:string,base:CalibrationSelftestBase,bench:HeadlessBench,before:CalibrationSelftestIdentity,identifySource:()=>Promise<CalibrationSelftestIdentity>){
 await mkdir(out,{mode:0o700});
 const files:{file:string;sha256:string;bytes:number}[]=[];
 const put:Put=async(file,doc)=>{
  const bytes=typeof doc==='string'?doc:JSON.stringify(doc)+'\n';
  await writeFile(join(out,file),bytes,{mode:0o600,flag:'wx'});
  files.push({file,sha256:calibrationSha(bytes),bytes:Buffer.byteLength(bytes)});
 };
 const {fitRuns,record,assessment}=await runCalibrationSelftest(base,bench,put);
 const after=await identifySource();
 if(hashJson(before)!==hashJson(after))throw Error('SOURCE_IDENTITY_CHANGED');
 const entry={schemaVersion:1,documentType:'calibration-selftest',sourceKind:'synthetic',toolSelfTest:true,produced:[],accepted:false,
  protocol,identity:{before,after},fitRuns,files};
 await writeFile(join(out,SELFTEST_ENTRY),JSON.stringify(entry,null,2)+'\n',{mode:0o600,flag:'wx'});
 return {record,assessment,fitRuns};
}
