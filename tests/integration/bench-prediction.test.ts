// V14 on the real engine (.venv-mujoco; skipped without it): the headless bench runs the same bench a gateway run does, and predictTrials re-runs a trial's declared signal on the current model.
// The "log" here is the simulator's own trace written as CSV and labelled synthetic: it proves the plumbing (clock, units, digest, split) and that the assessor refuses it as not measured. It says nothing about a device.
import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {assessCalibration} from '../../packages/lab-runtime/src/engineering/calibration';
import {importCalibrationLog,type CalibrationSidecar} from '../../packages/lab-runtime/src/engineering/calibration-import';
import {calibrationConfigDigest,predictTrials,type HeadlessBench} from '../../packages/lab-runtime/src/engineering/bench-prediction';
import {createHeadlessBench} from '../../packages/lab-runtime/src/v2/control/bench-runner';
import {benchAnchorTick} from '../../packages/lab-runtime/src/v2/control/bench-signals';
import {mujocoFromOptions,type MujocoRuntimeOptions} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import type {BenchSignal,ControlProfileV1,DriveModelV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {mujocoPython,mujocoReady,mujocoRoot,mujocoTemp,removeMujocoDirs,mujocoProcessScope} from '../support/mujoco-arm';

const doc=<T,>(name:string)=>JSON.parse(readFileSync(join(mujocoRoot,'fixtures/drive-v1',name),'utf8')) as T;
const AXIS='xarm-1/J3',TRIALS:[string,'tune'|'validation',number][]=[['tune-1','tune',0.1],['val-1','validation',0.05],['val-2','validation',0.1]];

describe.skipIf(!mujocoReady)('headless bench and prediction on the real engine',()=>{
 let runtime:MujocoRuntimeOptions,bench:HeadlessBench;
 const driveModel=doc<DriveModelV1>('xarm6-drive-nominal-v1.json'),control=doc<ControlProfileV1>('xarm6-control-v1.json');
 const signal=(amplitude:number):BenchSignal=>({kind:'step',amplitude,atTick:10});
 beforeAll(async()=>{
  const p=await mujocoProcessScope.observe(async()=>mujocoFromOptions({enabled:true,python:mujocoPython,workerRoot:mujocoRoot,lockPath:join(mujocoRoot,'requirements.lock'),directory:await mujocoTemp('mj-pred-probe-'),bundleFile:async()=>{throw Error('NO_BUNDLE');}}));
  if(!p.arm.runtime)throw Error(`MUJOCO_NOT_INSTALLED: ${p.arm.capability.reason}`);runtime=p.arm.runtime;bench=createHeadlessBench(runtime);
 },60_000);
 afterAll(removeMujocoDirs);
 const models=()=>({driveModel,control,configDigest:calibrationConfigDigest({plantModelDigest:'p'.repeat(64),load:'empty',axisIds:[AXIS]})});

 test('the headless bench returns the traced axis as a complete 500 Hz trace and leaves no engine slot held',async()=>{
  const t=await bench({axisId:AXIS,signal:signal(0.1),driveModel,control});
  expect(t.axisId).toBe(AXIS);expect(t.samples).toHaveLength(5010);expect(t.samples.every(s=>s!==null)).toBe(true);
  const last=t.samples.at(-1)!;expect(last.target-t.samples[0]!.target).toBeCloseTo(0.1,9);   // the step landed: the target moved by the amplitude
  expect(Math.abs(last.actual-last.target)).toBeLessThan(0.01);
  // a second run, a second worker: the one engine slot was given back
  expect((await bench({axisId:AXIS,signal:signal(0.1),driveModel,control})).samples[5009]).toEqual(last);
 },120_000);

 test('a physics override that is registered changes the response; a physics override of an unregistered path is refused',async()=>{
  const base=await bench({axisId:AXIS,signal:signal(0.1),driveModel,control}),heavy=await bench({axisId:AXIS,signal:signal(0.1),driveModel,control,physicsOverride:{'armatureKgM2[2]':0.4}});
  expect(heavy.samples).not.toEqual(base.samples);
  await expect(bench({axisId:AXIS,signal:signal(0.1),driveModel,control,physicsOverride:{'contact.condim':3}})).rejects.toThrow('PHYSICS_PATH_UNREGISTERED:contact.condim');
 },180_000);

 test('a synthetic log written from the model itself imports, is predicted back to the sample, and is still refused as not measured; another configuration digest is CONFIG_DIGEST_MISMATCH',async()=>{
  const m=models(),anchor=benchAnchorTick(driveModel),csv:Record<string,string>={};
  for(const [id,,amp] of TRIALS){
   const t=await bench({axisId:AXIS,signal:signal(amp),driveModel,control}),i0=10*(anchor+10)-1;
   csv[`${id}.csv`]='time_ns,command,position\n'+t.samples.map((s,i)=>[(i-i0)*2_000_000,s!.target,s!.actual].join(',')+'\n').slice(i0-20,i0+300).join('');
  }
  const sidecar:CalibrationSidecar={sourceKind:'synthetic',generator:'tests/integration/bench-prediction.test.ts simulator trace',deviceId:'simulator',configDigest:m.configDigest,clockDomain:'sim',clockOffsetNs:0,
   units:{command:'rad',position:'rad'},uncertainty:{command:1e-9,position:1e-9},
   policy:{channels:{command:{absoluteTolerance:1e-6,relativeTolerance:0},position:{absoluteTolerance:1e-6,relativeTolerance:0}},minTrialsPerCondition:1,maxClockGapNs:20_000_000,capabilities:{position:'actuator'}},
   trials:TRIALS.map(([trialId,split,amp])=>({trialId,split,condition:'step',file:`${trialId}.csv`,axisId:AXIS,signal:signal(amp)}))};
  const imported=await importCalibrationLog(sidecar,async f=>csv[f]!);expect(imported.ok,JSON.stringify(imported)).toBe(true);if(!imported.ok)return;
  const prediction=await predictTrials(imported.dataset,sidecar,m,bench);
  expect(prediction.trials.map(t=>t.trialId)).toEqual(TRIALS.map(t=>t[0]));expect(prediction.units).toEqual({command:'rad',position:'rad'});expect(prediction.clockDomain).toBe('sim');
  // the one reason: the data is not measured. Nothing else (units, clock, digest, split, trials) is wrong.
  expect(assessCalibration(imported.dataset,prediction).reasons).toEqual(['MEASURED_DATA_REQUIRED']);
  // were it measured, the residuals would be within the tolerance (the same model, bit for bit): the assessor's residual step on a copy that only changes the label
  const asMeasured=assessCalibration({...imported.dataset,sourceKind:'measured'},prediction);
  expect(asMeasured).toMatchObject({status:'pass',reasons:[]});
  for(const c of ['command','position'])expect(asMeasured.residuals[c]).toMatchObject({withinTolerance:true,maxAbs:expect.any(Number)});
  const other=await importCalibrationLog({...sidecar,configDigest:'f'.repeat(64)},async f=>csv[f]!);if(!other.ok)throw Error('unexpected');
  expect(assessCalibration(other.dataset,prediction).reasons).toContain('CONFIG_DIGEST_MISMATCH');
  // only the trials asked for are run (the identification fit sees the tune split alone)
  const only=await predictTrials(imported.dataset,sidecar,m,bench,{trialIds:new Set(['tune-1'])});expect(only.trials.map(t=>t.trialId)).toEqual(['tune-1']);
 },300_000);
});
