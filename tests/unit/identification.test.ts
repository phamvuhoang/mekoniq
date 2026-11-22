// V15 logic with an ANALYTIC stand-in for the bench (the engine is in tests/integration/identification-selftest.test.ts): the response of the axis is a closed form of the two parameters, so what is
// checked here is the identification code itself: splits, bounds, convergence, identifiability, what is produced and what is refused. The data are hand-built fixtures, not measurements.
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {afterAll,describe,expect,test} from 'vitest';
import type {CalibrationDataset} from '../../packages/lab-runtime/src/engineering/calibration';
import type {CalibrationSidecar} from '../../packages/lab-runtime/src/engineering/calibration-import';
import type {HeadlessBench} from '../../packages/lab-runtime/src/engineering/bench-prediction';
import {datasetDigestOf,identify,writeCalibratedRevision,writeCalibrationRecord,type CalibrationRecordV1,type IdentificationPlanV1} from '../../packages/lab-runtime/src/engineering/identification';
import {validateCalibrationRecord} from '../../packages/lab-runtime/src/engineering/calibration-record';
import {benchAnchorTick} from '../../packages/lab-runtime/src/v2/control/bench-signals';
import {sealDriveDocument,type BenchSignal,type ControlProfileV1,type DriveModelV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import type {XArmPhysics} from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';

const fixtures=join(__dirname,'../../robotics/simulation-mujoco/fixtures');
const driveModel=JSON.parse(readFileSync(join(fixtures,'drive-v1/xarm6-drive-nominal-v1.json'),'utf8')) as DriveModelV1;
const control=JSON.parse(readFileSync(join(fixtures,'drive-v1/xarm6-control-v1.json'),'utf8')) as ControlProfileV1;
const physics=JSON.parse(readFileSync(join(fixtures,'xarm6-g2-v1/physics.json'),'utf8')) as XArmPhysics;
const AXIS='xarm-1/J3',CONFIG='c'.repeat(64),ARM='armatureKgM2[2]',DAMP='jointDynamics.damping';
const dirs:string[]=[];afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true});});

/** y(t) = A g(d) (1 - exp(-t/tau(a))): the armature sets how fast, the damping how far. Two parameters with separate signatures. `sumOnly` makes them appear only as a + d (not separable). */
const response=(a:number,d:number,sumOnly:boolean)=>sumOnly?{tau:0.02*(a+d)/1.1,gain:1}:{tau:0.02*a/0.1,gain:1/(1+0.1*(d-1))};
const DT=0.002,N=5010;
const fakeBench=(calls:{amplitude:number;overrides:Record<string,number>}[]=[],sumOnly=false):HeadlessBench=>async input=>{
 const s=input.signal as Extract<BenchSignal,{kind:'step'}>,o=input.physicsOverride??{},a=o[ARM]??0.1,d=o[DAMP]??1,{tau,gain}=response(a,d,sumOnly);
 calls.push({amplitude:s.amplitude,overrides:{...o}});
 const i0=10*(benchAnchorTick(input.driveModel)+s.atTick)-1,start=0.3;
 return {axisId:input.axisId,dtS:DT,samples:Array.from({length:N},(_,i)=>{const t=(i-i0)*DT,y=t<0?0:s.amplitude*gain*(1-Math.exp(-t/tau));return {target:start+(t<0?0:s.amplitude),actual:start+y,feedback:start+y,torqueNm:0,saturated:false};})};
};
const signal=(amplitude:number):BenchSignal=>({kind:'step',amplitude,atTick:10});
// validation amplitude 0.1 lies inside the tune domain (0.05..0.2: a validation value outside it is OUT_OF_DOMAIN) and is distinct from both tune ones, so a spy can tell the splits apart
const TRIALS:[string,'tune'|'validation',number][]=[['t1','tune',0.05],['t2','tune',0.2],['v1','validation',0.1],['v2','validation',0.1]];
/** the "measured" log: the same closed form at hidden parameters, sampled every 10 ms from 20 ms before the step to 0.5 s after */
async function dataset(hidden:{a:number;d:number},kind:'measured'|'synthetic'='measured',sumOnly=false):Promise<{dataset:CalibrationDataset;sidecar:CalibrationSidecar}>{
 const bench=fakeBench([],sumOnly),trials:CalibrationDataset['trials']=[];
 for(const [trialId,split,amp] of TRIALS){
  const t=await bench({axisId:AXIS,signal:signal(amp),driveModel,control,physicsOverride:{[ARM]:hidden.a,[DAMP]:hidden.d}}),i0=10*(benchAnchorTick(driveModel)+10)-1,idx=Array.from({length:52},(_,k)=>i0-10+5*k);
  trials.push({trialId,split,condition:'step',timesNs:idx.map(i=>(i-i0)*2_000_000),channels:{position:idx.map(i=>t.samples[i]!.actual)}});
 }
 const policy={channels:{position:{absoluteTolerance:5e-4,relativeTolerance:0}},minTrialsPerCondition:1,maxClockGapNs:20_000_000,capabilities:{position:'actuator' as const}};
 return {dataset:{schemaVersion:1,configDigest:CONFIG,instrument:{id:'fixture',revision:'1'},units:{position:'rad'},clockMapping:{domain:'sim',offsetNs:0},uncertainty:{position:1e-6},rawDigest:'e'.repeat(64),sourceKind:kind,policy,trials},
  sidecar:{sourceKind:kind==='measured'?'measured':'synthetic',deviceId:'fixture',configDigest:CONFIG,clockDomain:'sim',clockOffsetNs:0,units:{position:'rad'},uncertainty:{position:1e-6},policy,trials:TRIALS.map(([trialId,split,amp])=>({trialId,split,condition:'step',file:`${trialId}.csv`,axisId:AXIS,signal:signal(amp)}))}};
}
const plan=(ds:CalibrationDataset,o:Partial<IdentificationPlanV1>={}):IdentificationPlanV1=>sealDriveDocument({schemaVersion:1,documentType:'identification-plan',id:'plan-j3',revision:1,datasetDigest:datasetDigestOf(ds),baseDriveModelDigest:driveModel.digest,plantModelDigest:'d'.repeat(64),
 parameters:[{path:ARM,initial:0.1,lower:0.02,upper:0.5,unit:'kg*m^2'},{path:DAMP,initial:1,lower:0.2,upper:4,unit:'N*m*s/rad'}],objective:{channels:['position'],weights:{position:1}},
 optimizer:{method:'bounded_least_squares',maxIterations:40,tolerance:1e-10,relativeStep:1e-4,maxJacobianCondition:1e6},...o}) as IdentificationPlanV1;
const models={driveModel,control,configDigest:CONFIG,physics};

describe('identify',()=>{
 test('a measured, validated fit within its bounds recovers the hidden parameters and produces a revision of the physics profile; the base documents keep their bytes',async()=>{
  const {dataset:ds,sidecar}=await dataset({a:0.13,d:1.5}),calls:{amplitude:number;overrides:Record<string,number>}[]=[];
  const baseBytes=JSON.stringify(physics),record=await identify(plan(ds),ds,sidecar,models,fakeBench(calls),{toolSelfTest:false});
  const by=Object.fromEntries(record.fitted.map(f=>[f.path,f]));
  expect(by[ARM]!.value).toBeCloseTo(0.13,3);expect(by[DAMP]!.value).toBeCloseTo(1.5,2);
  expect(record).toMatchObject({sourceKind:'measured',toolSelfTest:false,accepted:false,reasonCodes:[],validation:{status:'pass'},convergence:{converged:true}});
  expect(record.fitted.every(f=>!f.atBound&&f.standardError!==null)).toBe(true);expect(record.produced).toHaveLength(1);expect(record.produced[0]).toMatchObject({document:'arm_physics',revision:2});
  expect(validateCalibrationRecord(record)).toEqual({ok:true,reasonCodes:[]});expect(record.domain.position).toBeDefined();
  expect(JSON.stringify(physics)).toBe(baseBytes);
  // the fit saw the tune split alone: validation (amplitude 0.1) is run only AFTER the last fit evaluation
  const firstValidation=calls.findIndex(c=>c.amplitude===0.1);expect(firstValidation).toBeGreaterThan(0);expect(calls.slice(0,firstValidation).every(c=>c.amplitude!==0.1)).toBe(true);expect(calls.slice(firstValidation).every(c=>c.amplitude===0.1)).toBe(true);
  // written to a NEW directory only
  const out=join(await mkdtemp(join(tmpdir(),'ident-')),'rev');dirs.push(out);
  const {files}=await writeCalibratedRevision(record,{driveModel,physics},out);
  expect((await readdir(out)).sort()).toEqual(['arm-physics-r2.json','calibration-record.json','revision-manifest.json']);expect(files.map(f=>f.path)).toEqual(['arm-physics-r2.json','calibration-record.json','revision-manifest.json']);
  const doc=JSON.parse(await readFile(join(out,'arm-physics-r2.json'),'utf8'));
  expect(doc).toMatchObject({revision:2,armatureKgM2:[0.1,0.1,expect.closeTo(0.13,3),0.1,0.1,0.1],calibrationSources:{[ARM]:{kind:'derived',contentSha256:record.datasetDigest},[DAMP]:{kind:'derived'}}});
  expect(JSON.parse(await readFile(join(out,'revision-manifest.json'),'utf8'))).toMatchObject({configDigest:CONFIG,domain:record.domain,accepted:false});
  await expect(writeCalibratedRevision(record,{driveModel,physics},out)).rejects.toThrow(/EEXIST/);
 },60_000);
 test('a parameter that ends on a bound, or a fit that does not converge, produces nothing and says why',async()=>{
  const {dataset:ds,sidecar}=await dataset({a:0.13,d:1.5});
  const bound=await identify(plan(ds,{parameters:[{path:ARM,initial:0.1,lower:0.02,upper:0.12,unit:'kg*m^2'},{path:DAMP,initial:1,lower:0.2,upper:4,unit:'N*m*s/rad'}]}),ds,sidecar,models,fakeBench(),{toolSelfTest:false});
  expect(bound.produced).toEqual([]);expect(bound.reasonCodes).toContain('PARAMETER_AT_BOUND');expect(bound.fitted.find(f=>f.path===ARM)).toMatchObject({atBound:true,value:0.12});
  const slow=await identify(plan(ds,{optimizer:{method:'bounded_least_squares',maxIterations:1,tolerance:1e-14,relativeStep:1e-4,maxJacobianCondition:1e6}}),ds,sidecar,models,fakeBench(),{toolSelfTest:false});
  expect(slow.produced).toEqual([]);expect(slow.reasonCodes).toContain('NOT_CONVERGED');expect(validateCalibrationRecord(slow).ok).toBe(true);
 },60_000);
 test('two parameters the signal cannot separate: IDENTIFIABILITY_POOR, standard errors null, nothing produced',async()=>{
  const {dataset:ds,sidecar}=await dataset({a:0.13,d:1.5},'measured',true);
  const r=await identify(plan(ds,{optimizer:{method:'bounded_least_squares',maxIterations:40,tolerance:1e-10,relativeStep:1e-4,maxJacobianCondition:1e3}}),ds,sidecar,models,fakeBench([],true),{toolSelfTest:false});
  expect(r.reasonCodes).toContain('IDENTIFIABILITY_POOR');expect(r.produced).toEqual([]);expect(r.fitted.every(f=>f.standardError===null)).toBe(true);expect(r.convergence.jacobianCondition===null||r.convergence.jacobianCondition>1e3).toBe(true);
 },60_000);
 test('synthetic data or the tool self-test fits and reports but never produces, however good the residual; the self-test needs synthetic data',async()=>{
  const {dataset:ds,sidecar}=await dataset({a:0.13,d:1.5},'synthetic');
  const r=await identify(plan(ds),ds,sidecar,models,fakeBench(),{toolSelfTest:true}),by=Object.fromEntries(r.fitted.map(f=>[f.path,f.value]));
  expect(by[ARM]).toBeCloseTo(0.13,3);expect(r).toMatchObject({sourceKind:'synthetic',toolSelfTest:true,produced:[]});expect(r.reasonCodes).toEqual(expect.arrayContaining(['SYNTHETIC_DATA','TOOL_SELF_TEST']));
  const plain=await identify(plan(ds),ds,sidecar,models,fakeBench(),{toolSelfTest:false});expect(plain.produced).toEqual([]);expect(plain.reasonCodes).toContain('SYNTHETIC_DATA');
  const {dataset:measured,sidecar:ms}=await dataset({a:0.13,d:1.5});
  await expect(identify(plan(measured),measured,ms,models,fakeBench(),{toolSelfTest:true})).rejects.toThrow('SELF_TEST_REQUIRES_SYNTHETIC_DATA');
 },60_000);
 test('a dataset recorded for another configuration is not fitted: no bench run, CONFIG_DIGEST_MISMATCH, nothing produced',async()=>{
  const {dataset:ds,sidecar}=await dataset({a:0.13,d:1.5}),calls:unknown[]=[];
  const r=await identify(plan(ds),ds,sidecar,{...models,configDigest:'f'.repeat(64)},fakeBench(calls as never),{toolSelfTest:false});
  expect(calls).toEqual([]);expect(r.reasonCodes).toEqual(['CONFIG_DIGEST_MISMATCH']);expect(r.produced).toEqual([]);expect(validateCalibrationRecord(r).ok).toBe(true);
 });
 test('a plan for another dataset or another base model, an invalid plan, or a path the model cannot take is refused before the engine',async()=>{
  const {dataset:ds,sidecar}=await dataset({a:0.13,d:1.5}),calls:unknown[]=[],b=fakeBench(calls as never);
  await expect(identify(plan(ds,{datasetDigest:'0'.repeat(64)}),ds,sidecar,models,b,{toolSelfTest:false})).rejects.toThrow('DATASET_DIGEST_MISMATCH');
  await expect(identify(plan(ds,{baseDriveModelDigest:'0'.repeat(64)}),ds,sidecar,models,b,{toolSelfTest:false})).rejects.toThrow('BASE_MODEL_MISMATCH');
  await expect(identify({...plan(ds),revision:9},ds,sidecar,models,b,{toolSelfTest:false})).rejects.toThrow(/PLAN_INVALID:.*DIGEST_MISMATCH/);
  const scale=plan(ds,{parameters:[{path:'driveModel.axes[2].torque.scale',initial:0.9,lower:0.5,upper:1,unit:'1'}]});
  await expect(identify(scale,ds,sidecar,models,b,{toolSelfTest:false})).rejects.toThrow('DRIVE_PATH_NOT_APPLICABLE');
  expect(calls).toEqual([]);
 });
 test('a fit that cannot run a trial (a bench fault, a gap) is an error, never a partial fit',async()=>{
  const {dataset:ds,sidecar}=await dataset({a:0.13,d:1.5});
  await expect(identify(plan(ds),ds,sidecar,models,async()=>{throw Error('HEADLESS_BENCH_DRIVE_FAULT');},{toolSelfTest:false})).rejects.toThrow('HEADLESS_BENCH_DRIVE_FAULT');
 });
});
describe('writing',()=>{
 test('a record that produced nothing is written as a record but has no revision to write; a record whose produced digests do not match what it would write is refused',async()=>{
  const {dataset:ds,sidecar}=await dataset({a:0.13,d:1.5},'synthetic'),r=await identify(plan(ds),ds,sidecar,models,fakeBench(),{toolSelfTest:true});
  const dir=await mkdtemp(join(tmpdir(),'ident-'));dirs.push(dir);
  await expect(writeCalibratedRevision(r,{driveModel,physics},join(dir,'x'))).rejects.toThrow('NO_REVISION_PRODUCED');
  await writeCalibrationRecord(r,join(dir,'record.json'));await expect(writeCalibrationRecord(r,join(dir,'record.json'))).rejects.toThrow(/EEXIST/);
  expect(JSON.parse(await readFile(join(dir,'record.json'),'utf8'))).toMatchObject({toolSelfTest:true,accepted:false});
  const {dataset:m,sidecar:ms}=await dataset({a:0.13,d:1.5}),good=await identify(plan(m),m,ms,models,fakeBench(),{toolSelfTest:false});
  const {digest:_d,...rest}=good,forged=sealDriveDocument({...rest,produced:[{...good.produced[0]!,digest:'9'.repeat(64)}]}) as CalibrationRecordV1;void _d;
  await expect(writeCalibratedRevision(forged,{driveModel,physics},join(dir,'y'))).rejects.toThrow('PRODUCED_DIGEST_MISMATCH');
  await expect(writeCalibratedRevision({...good,accepted:true as never},{driveModel,physics},join(dir,'z'))).rejects.toThrow(/RECORD_INVALID/);
 });
});
