// G-CAL1: the tool finds a hidden parameter set again (V15 self-test), on the real engine (.venv-mujoco; skipped without it). The "measurements" are the simulator's own trace at hidden parameters (the armature of J3
// x 1.3, the joint damping 1.0 -> 1.5) plus the quantization of a 16384-count encoder, imported through the real log importer and labelled synthetic. It proves the tool can identify when the signal excites the
// parameters. It says nothing about a device: the record must come out synthetic, a self-test, with nothing produced.
//
// Tolerance, declared BEFORE the run (the plan: "do not widen it if it fails; investigate the bench signals"): every parameter within 5 % of its hidden value.
// NOT covered: `torque.scale`. The arm's drive model has an `effort` torque (a limit in N*m), no scale to fit; on a wheel it is an envelope fraction, and the self-test could not recover it (ledger, V15 ruling): on the nominal
// wheel (scale 1) the 5 rad/s step is traction-limited above a scale of about 0.85, so the wheel speed does not change with the scale and a fit has no gradient; on a torque-limited drive (nominal 0.1, hidden 0.08)
// the speed is a V in the scale only in the first ~60 ms, and a 1 % change of the scale moves it by as much as a 20 % one (contact chatter), so the fit lands at 0.106 (+32 %). The tolerance was not widened. The path stays
// registered in parameter-paths.ts (the spec's set; a record still has to pass the held-out split to produce anything) but G-CAL1 does not claim it.
import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {assessCalibration} from '../../packages/lab-runtime/src/engineering/calibration';
import {benchBindingDigest,importCalibrationLog,type CalibrationSidecar} from '../../packages/lab-runtime/src/engineering/calibration-import';
import {calibrationConfigDigest,predictTrials} from '../../packages/lab-runtime/src/engineering/bench-prediction';
import {datasetDigestOf,identify,type IdentificationPlanV1} from '../../packages/lab-runtime/src/engineering/identification';
import {createHeadlessBench} from '../../packages/lab-runtime/src/v2/control/bench-runner';
import {benchAnchorTick} from '../../packages/lab-runtime/src/v2/control/bench-signals';
import {mujocoFromOptions,type MujocoRuntimeOptions} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import {readXArmFixture} from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import {sealDriveDocument,type BenchSignal,type ControlProfileV1,type DriveModelV1,type DriveTrace} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {mujocoPython,mujocoReady,mujocoRoot,mujocoTemp,removeMujocoDirs,mujocoProcessScope} from '../support/mujoco-arm';

const PLANT='d'.repeat(64),TOLERANCE=0.05,HIDDEN={a:0.13,d:1.5},ARM='armatureKgM2[2]',DAMP='jointDynamics.damping',QUANTUM=2*Math.PI/16384;
const doc=<T,>(name:string)=>JSON.parse(readFileSync(join(mujocoRoot,'fixtures/drive-v1',name),'utf8')) as T;
const step=(amplitude:number):BenchSignal=>({kind:'step',amplitude,atTick:10});
// the validation signals are smaller than their tune counterparts, so every validation value lies inside the domain the tune split measured (the assessor's OUT_OF_DOMAIN rule)
const TRIALS:[string,'tune'|'validation',string,BenchSignal][]=[
 ['tune-j3-step1','tune','xarm-1/J3',step(0.1)],['tune-j3-trap','tune','xarm-1/J3',{kind:'trapezoid',distance:0.2,peakVelocity:0.2,acceleration:0.5,atTick:10}],['tune-j2-step1','tune','xarm-1/J2',step(0.1)],
 ['val-j3-step05','validation','xarm-1/J3',step(0.05)],['val-j2-step05','validation','xarm-1/J2',step(0.05)]];

describe.skipIf(!mujocoReady)('identification self-test on the real engine',()=>{
 let runtime:MujocoRuntimeOptions;
 const driveModel=doc<DriveModelV1>('xarm6-drive-nominal-v1.json'),control=doc<ControlProfileV1>('xarm6-control-v1.json');
 beforeAll(async()=>{
  const p=await mujocoProcessScope.observe(async()=>mujocoFromOptions({enabled:true,python:mujocoPython,workerRoot:mujocoRoot,lockPath:join(mujocoRoot,'requirements.lock'),directory:await mujocoTemp('mj-ident-probe-'),bundleFile:async()=>{throw Error('NO_BUNDLE');}}));
  if(!p.arm.runtime)throw Error(`MUJOCO_NOT_INSTALLED: ${p.arm.capability.reason}`);runtime=p.arm.runtime;
 },60_000);
 afterAll(removeMujocoDirs);

 test('the hidden armature and damping are recovered within 5 %, and the record is synthetic, a self-test, and produces nothing',async()=>{
  const bench=createHeadlessBench(runtime),configDigest=calibrationConfigDigest({plantModelDigest:'p'.repeat(64),load:'empty',axisIds:['xarm-1/J2','xarm-1/J3']});
  const anchor=benchAnchorTick(driveModel),csv:Record<string,string>={};
  for(const [id,,axisId,signal] of TRIALS){
   const t:DriveTrace=await bench({axisId,signal,driveModel,control,physicsOverride:{[ARM]:HIDDEN.a,[DAMP]:HIDDEN.d}}),i0=10*(anchor+10)-1;
   // the transient is what carries the parameters (inertia sets how fast the axis answers, damping how far): 20 ms before the signal to 0.6 s after it, every 4 ms; the position is what the encoder would report, quantized to its count
   const rows:string[]=[];for(let i=i0-10;i<=i0+300;i+=2)rows.push([(i-i0)*2_000_000,t.samples[i]!.target,Math.round(t.samples[i]!.actual/QUANTUM)*QUANTUM].join(',')+'\n');
   csv[`${id}.csv`]='time_ns,command,position\n'+rows.join('');
  }
  const sidecar:CalibrationSidecar={sourceKind:'synthetic',generator:'tests/integration/identification-selftest.test.ts: simulator at hidden parameters + encoder quantization',deviceId:'simulator',configDigest,clockDomain:'sim',clockOffsetNs:0,
   units:{command:'rad',position:'rad'},uncertainty:{command:1e-9,position:QUANTUM/2},
   policy:{channels:{command:{absoluteTolerance:1e-3,relativeTolerance:0},position:{absoluteTolerance:1e-3,relativeTolerance:0}},minTrialsPerCondition:1,maxClockGapNs:20_000_000,capabilities:{position:'actuator'}},
   trials:TRIALS.map(([trialId,split,axisId,signal])=>({trialId,split,condition:`${axisId}`,file:`${trialId}.csv`,axisId,signal}))};
  const imported=await importCalibrationLog(sidecar,async f=>csv[f]!);expect(imported.ok,JSON.stringify(imported)).toBe(true);if(!imported.ok)return;
  const plan=sealDriveDocument({schemaVersion:1,documentType:'identification-plan',id:'selftest-j3',revision:1,datasetDigest:datasetDigestOf(imported.dataset),baseDriveModelDigest:driveModel.digest,plantModelDigest:PLANT,controlProfileDigest:control.digest,benchBinding:benchBindingDigest(sidecar),
   parameters:[{path:ARM,initial:0.1,lower:0.03,upper:0.4,unit:'kg*m^2'},{path:DAMP,initial:1,lower:0.2,upper:3,unit:'N*m*s/rad'}],objective:{channels:['position'],weights:{position:1}},
   optimizer:{method:'bounded_least_squares',maxIterations:15,tolerance:1e-6,relativeStep:1e-2,maxJacobianCondition:1e4}}) as IdentificationPlanV1;
  const models={driveModel,control,configDigest,plantModelDigest:PLANT,physics:readXArmFixture(runtime.workerRoot).physics};
  const record=await identify(plan,imported.dataset,sidecar,models,bench,{toolSelfTest:true});
  const by=Object.fromEntries(record.fitted.map(f=>[f.path,f]));
  console.log(JSON.stringify({fitted:record.fitted,convergence:record.convergence,reasonCodes:record.reasonCodes}));
  expect(Math.abs(by[ARM]!.value/HIDDEN.a-1),`armature ${by[ARM]!.value} vs ${HIDDEN.a}`).toBeLessThan(TOLERANCE);
  expect(Math.abs(by[DAMP]!.value/HIDDEN.d-1),`damping ${by[DAMP]!.value} vs ${HIDDEN.d}`).toBeLessThan(TOLERANCE);
  expect(record).toMatchObject({sourceKind:'synthetic',toolSelfTest:true,produced:[],accepted:false});expect(record.reasonCodes).toEqual(expect.arrayContaining(['SYNTHETIC_DATA','TOOL_SELF_TEST']));
  // the held-out split, judged as if measured (a copy that changes only the label), is inside the declared tolerance with the fitted values
  const fitted={[ARM]:by[ARM]!.value,[DAMP]:by[DAMP]!.value},prediction=await predictTrials(imported.dataset,sidecar,models,bench,{physicsOverride:fitted,trialIds:new Set(['val-j3-step05','val-j2-step05'])});
  const asMeasured=assessCalibration({...imported.dataset,sourceKind:'measured'},prediction);
  expect(asMeasured,JSON.stringify(asMeasured)).toMatchObject({status:'pass'});
 },3_000_000);
});
