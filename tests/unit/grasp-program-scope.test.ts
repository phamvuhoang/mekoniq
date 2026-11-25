import {expect,test} from 'vitest';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {createBenchRun} from '../../packages/lab-runtime/src/v2/control/bench-runner';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
const input={project:{},scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:7,mode:'simulation' as const,access:'simulated' as const,backendSetId:'engineering-mujoco-cell-v1',sourceCommit:'a'.repeat(40),graspMode:'belief_ground_truth' as const,graspProgramId:'cup-pick-two-stage-v1'};
test('direct run admission refuses a program outside its registered scope before providers or a journal are opened',async()=>{
 for(const extra of [{mode:'mock' as const},{scenarioId:'MJ-BV01'},{backendSetId:'engineering-mujoco-arm-v1'}])await expect(createScenarioRun({...input,...extra},{directory:'/unused/no-program-scope'})).rejects.toThrow('GRASP_MODE_SCOPE_INVALID');
 for(const graspMode of [undefined,'fixed_program' as const])await expect(createScenarioRun({...input,graspMode},{directory:'/unused/no-program-scope'})).rejects.toThrow('GRASP_PROGRAM_NOT_ALLOWED');
 await expect(createScenarioRun({...input,graspProgramId:'cup-pick-two-stage-v2'},{directory:'/unused/no-program-scope'})).rejects.toThrow('GRASP_PROGRAM_NOT_REGISTERED');
});
test.each([undefined,'cup-pick-two-stage-v1','unregistered-v1'])('direct bench admission refuses every program ID before creating files; legacy remains admitted (%s)',async(graspProgramId)=>{
 const temporary=await mkdtemp(join(tmpdir(),'bench-grasp-scope-')),directory=join(temporary,'run'),workerRoot=resolve('robotics/simulation-mujoco');
 const controlProfile=JSON.parse(await readFile(join(workerRoot,'fixtures/drive-v1/serve-control-v1.json'),'utf8'));let run:Awaited<ReturnType<typeof createBenchRun>>|undefined,workerCalls=0;
 const request={...input,project:undefined,scenarioId:'MJ-BENCH-WHEEL',backendSetId:'engineering-mujoco-bench-v1',graspProgramId,bench:{schemaVersion:1 as const,scenarioId:'MJ-BENCH-WHEEL' as const,axis:'wheels' as const,signal:{kind:'step' as const,amplitude:2,atTick:5},driveExperimentId:'drive-nominal-v1' as const,controlProfile}};
 try{
  const pending=createBenchRun(request,{directory,catalog:defaultCatalog,enabledBackends:['mujoco_arm','mujoco_3d'],runtime:{python:'/nonexistent/python3.11',workerRoot,schemaDir:resolve('packages/contracts/schemas'),lockDigest:'0'.repeat(64),engineVersion:'3.17.0'},spawn:async()=>{workerCalls++;throw Error('UNEXPECTED_BENCH_WORKER');}}).then(value=>{run=value;return value;});
  if(graspProgramId===undefined)expect((await pending).id).toMatch(/^[0-9a-f-]{36}$/);
  else{await expect(pending).rejects.toThrow('BENCH_SCOPE_INVALID');expect(existsSync(directory)).toBe(false);}
  expect(workerCalls).toBe(0);
 }finally{await run?.close();await rm(temporary,{recursive:true,force:true});}
});

test('direct scenario, bench and world factory enforce the measured pulse registration before touching a provider or directory',async()=>{
 const {mujocoWorldPorts}=await import('../../packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports');
 const directory=join(await mkdtemp(join(tmpdir(),'pulse-scope-')),'run'),pulse='world-cup-nudge-v2' as const;
 const runtime={workerRoot:'/missing-fixture',python:'/missing-worker',schemaDir:'',engineVersion:'3.17.0',lockDigest:'0'.repeat(64)};
 try{
  for(const patch of [{graspMode:undefined},{graspMode:'fixed_program' as const},{graspProgramId:undefined}]){
   const manifest={...input,worldExperimentId:pulse,...patch};
   await expect(createScenarioRun(manifest,{directory})).rejects.toThrow('WORLD_EXPERIMENT_SCOPE_INVALID');
   const factory=mujocoWorldPorts({...runtime,cellDisturbance:{presetId:pulse,cupId:'cup-1'}});
   await expect(factory({manifest:{...manifest,worldExperimentId:undefined},directory} as never)).rejects.toThrow('WORLD_EXPERIMENT_SCOPE_INVALID');
  }
  await expect(createBenchRun({...input,graspProgramId:undefined,worldExperimentId:pulse,project:undefined,scenarioId:'MJ-BENCH-WHEEL',backendSetId:'engineering-mujoco-bench-v1',bench:{} as never},{directory,catalog:defaultCatalog,enabledBackends:[],runtime})).rejects.toThrow('BENCH_SCOPE_INVALID');
  expect(existsSync(directory)).toBe(false);
 }finally{await rm(join(directory,'..'),{recursive:true,force:true});}
});
