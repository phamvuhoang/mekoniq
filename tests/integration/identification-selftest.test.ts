// G-CAL1 runs the same five-trial, synthetic tool self-test as the R4 recorder.
// The hidden XArm perturbations qualify armature and damping recovery. The ledger V15 ruling leaves torque.scale unproven.
import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {join} from 'node:path';
import {loadCalibrationSelftestBase,runCalibrationSelftest,SELFTEST_PROTOCOL} from '../../scripts/r4-calibration-selftest';
import {createHeadlessBench} from '../../packages/lab-runtime/src/v2/control/bench-runner';
import {mujocoFromOptions,type MujocoRuntimeOptions} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import {mujocoPython,mujocoReady,mujocoRoot,mujocoTemp,removeMujocoDirs,mujocoProcessScope} from '../support/mujoco-arm';

describe.skipIf(!mujocoReady)('identification self-test on the real engine',()=>{
 let runtime:MujocoRuntimeOptions;
 beforeAll(async()=>{
  const p=await mujocoProcessScope.observe(async()=>mujocoFromOptions({enabled:true,python:mujocoPython,workerRoot:mujocoRoot,lockPath:join(mujocoRoot,'requirements.lock'),directory:await mujocoTemp('mj-ident-probe-')}));
  if(!p.arm.runtime)throw Error(`MUJOCO_NOT_INSTALLED: ${p.arm.capability.reason}`);runtime=p.arm.runtime;
 },60_000);
 afterAll(removeMujocoDirs);

 test('recovers the two hidden parameters within 5% and passes the held-out synthetic comparison',async()=>{
  const base=await loadCalibrationSelftestBase(mujocoRoot);
  const bench=createHeadlessBench(runtime,{seed:SELFTEST_PROTOCOL.seed});
  const {record,assessment}=await runCalibrationSelftest(base,bench);
  const fitted=Object.fromEntries(record.fitted.map(f=>[f.path,f]));
  console.log(JSON.stringify({fitted:record.fitted,convergence:record.convergence,reasonCodes:record.reasonCodes}));
  expect(Math.abs(fitted['armatureKgM2[2]']!.value/0.13-1)).toBeLessThan(0.05);
  expect(Math.abs(fitted['jointDynamics.damping']!.value/1.5-1)).toBeLessThan(0.05);
  expect(record).toMatchObject({sourceKind:'synthetic',toolSelfTest:true,produced:[],accepted:false,convergence:{converged:true}});
  expect(record.reasonCodes).toEqual(expect.arrayContaining(['SYNTHETIC_DATA','TOOL_SELF_TEST']));
  expect(assessment,JSON.stringify(assessment)).toMatchObject({sourceKind:'synthetic',toolSelfTest:true,status:'pass'});
 },3_000_000);
});
