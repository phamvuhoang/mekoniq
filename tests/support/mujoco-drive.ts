// Shared by the V04/V05 mobile drive tests: one MJ-FD01 run on a freshly compiled bundle, every step the worker answers kept.
import {afterEach} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {expect} from 'vitest';
import {createMujocoCompiler} from '../../packages/lab-runtime/src/engineering/mujoco-compiler';
import {createEngineeringService} from '../../packages/lab-runtime/src/engineering/gateway';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {mujocoMobilePlant} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile';
import {createFixedStepScenarioRun} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {navigationFixture} from './navigation2d';
import {testCompiler,writeFixtureCatalog} from './engineering';
export const root=resolve('robotics/simulation-mujoco');const dirs:string[]=[],runs:ScenarioRun[]=[];
export const temp=async()=>{const d=await mkdtemp(join(tmpdir(),'mj-drive-mobile-'));dirs.push(d);return d;};
afterEach(async()=>{for(const r of runs.splice(0))await r.close();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
export interface Step {request:Record<string,unknown>;result:Record<string,unknown>|null}
/** One run of MJ-FD01 on a freshly compiled bundle; `driveExperimentId` and `compilerRoot` choose the drive, every step the worker answers is kept. */
export async function setup(o:{driveExperimentId?:string;compilerRoot?:string;driveFaultSchedule?:import('../../packages/lab-runtime/src/v2/fault-schedule').FaultScheduleEntry[];stopSchedule?:import('../../packages/lab-runtime/src/v2/control/drive-io').StopScheduleEntryV1[];faultCampaign?:true}={}){
 const f=navigationFixture('serve-3d').fixture;f.project={...f.project,requestedProfile:'engineering-mujoco-3d-v1',...o.driveExperimentId?{driveExperimentId:o.driveExperimentId}:{}} as typeof f.project;
 const catalogRoot=await temp();await writeFixtureCatalog(catalogRoot,f);
 const service=createEngineeringService({directory:await temp(),catalogRoot,compiler:testCompiler,compilers:{'engineering-mujoco-3d-v1':createMujocoCompiler({workerRoot:o.compilerRoot??root})}});
 const receipt=await service.compileEngineeringProject(f.project,'owner');expect(receipt.state,JSON.stringify(receipt.problems)).toBe('compiled');
 const locked=await service.admitRun('owner',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-mujoco-3d-v1',undefined);
 const runtime={python:resolve('.venv-mujoco/bin/python'),workerRoot:root,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1};
 const plant=mujocoMobilePlant(runtime),steps:Step[]=[],spawn=plant.spawn;
 plant.spawn=async s=>{const w=await spawn(s);return {...w,async request(req){const r=await w.request(req);if(req.op==='step')steps.push({request:structuredClone(req.payload) as never,result:r.ok?structuredClone(r.result) as never:null});return r;}};};
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)};
 const runDirectory=await temp();
 const run=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:'MJ-FD01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',sourceCommit:'drive-mobile-test',engineering:locked,...o.driveFaultSchedule?{driveFaultSchedule:o.driveFaultSchedule}:{},...o.stopSchedule?{stopSchedule:o.stopSchedule}:{}},
  {directory:runDirectory,...o.faultCampaign?{faultCampaign:true as const}:{},catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>service.bundleFile(d,p),plant,runtime});runs.push(run);
 return {run,steps,service,receipt,locked,runDirectory:runDirectory};
}
let ordinal=0;
export async function act(run:ScenarioRun,kind:string,payload={}){const v=await run.snapshot();return run.action({actionId:`drive-${++ordinal}`,expectedRevision:v.run.runRevision,kind,payload});}
export async function tick(run:ScenarioRun,n:number){let v=await run.snapshot();while(v.tick<n&&v.run.status==='running')v=await act(run,'step',{ticks:Math.min(20,n-v.tick)});return v;}
export async function finish(run:ScenarioRun,limit=12000){let v=await run.snapshot();while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<limit){const before=v.tick;v=await act(run,'step',{ticks:250});if(v.tick===before&&v.run.status!=='running')break;}return v;}
