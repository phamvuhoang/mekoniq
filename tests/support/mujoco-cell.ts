import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {createScenarioRun,type ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {defaultCatalog,type CapabilityCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {mujocoWorldPorts} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco-world-ports';
import {readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import {prepareWorldAdmission,readWorldEvidence} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import type {WorldFactoryInput,WorldPlantBindings} from '../../packages/lab-runtime/src/v2/simulation3d/world-ports';
import type {MujocoRuntimeOptions} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import {act,amrAsset} from './lab-v2';
import {OwnedProcesses} from './owned-processes';
export const cellRoot=resolve('robotics/simulation-mujoco');
export const cellCampaign=JSON.parse(readFileSync(join(cellRoot,'campaigns/mj-cell-bv01-v1.json'),'utf8')) as {nominalSeeds:number[];maxTicks:number;nativeDeadlineSecondsPerCase:number};
export async function openCell(seed:number,kind:string,options:Partial<MujocoRuntimeOptions>={},manifestExtra:{driveExperimentId?:import('../../packages/lab-runtime/src/v2/control/drive-experiments').DriveExperimentId;driveFaultSchedule?:import('../../packages/lab-runtime/src/v2/fault-schedule').FaultScheduleEntry[];graspMode?:'fixed_program'|'belief_ground_truth'|'belief_estimated';perceptionProfileId?:string;recoveryPolicyId?:string}={},spawn?:Parameters<typeof mujocoWorldPorts>[1]){
 const directory=await mkdtemp(`/tmp/mekoniq-b06-${kind}-${seed}-`),processes=new OwnedProcesses();processes.addDirectory(directory);
 const project=JSON.parse(await readFile(join(cellRoot,'fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
 const catalog:CapabilityCatalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
 const factory=mujocoWorldPorts({python:resolve('.venv-mujoco/bin/python'),workerRoot:cellRoot,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(cellRoot,'requirements.lock')),engineVersion:'3.17.0',...options},spawn);
 let bindings!:WorldPlantBindings,input!:WorldFactoryInput,opens=0;
 const manifest={project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed,mode:'simulation' as const,access:'simulated' as const,backendSetId:'engineering-mujoco-cell-v1',sourceCommit:process.env.B06_SOURCE_IDENTITY??'development:B06-unfrozen',...manifestExtra};
 const providers={directory,catalog,assets:[amrAsset],enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],worldPorts:async(i:WorldFactoryInput)=>{opens++;input=i;bindings=await factory(i);return bindings;}};
 const reopen=async()=>processes.observeRun(await processes.observe(()=>createScenarioRun(manifest,providers))),run=await reopen();
 return {run,directory,processes,reopen,opens:()=>opens,bindings:()=>bindings,input:()=>input,async save(label:string){const report=await run.report(),journal=await run.journal(),rawJournal=await input.context.source.journal();await writeFile(join(directory,`${label}-report.json`),JSON.stringify(report,null,2));await writeFile(join(directory,`${label}-journal.json`),JSON.stringify(journal,null,2));await writeFile(join(directory,`${label}-source-journal.json`),JSON.stringify(rawJournal,null,2));await writeFile(join(directory,`${label}-controller-state.json`),JSON.stringify(input.state.arm,null,2));await writeFile(join(directory,`${label}-physical-custody.json`),JSON.stringify(bindings.coffee.report().cupLedger,null,2));return {report,journal,rawJournal};},async readback(){const f=await readWorldFixture(cellRoot,'coffee-delivery-cell-v1'),scene=JSON.parse(await readFile(join(directory,'mujoco-world/bundle/lab-world-scene.json'),'utf8')),admission=await(async()=>{for(const r of scene.files)if(!f.files.has(r.path))f.files.set(r.path,await readFile(join(directory,'mujoco-world/bundle',r.path)));return prepareWorldAdmission(scene,f.files);})(),cp=JSON.parse(await readFile(join(directory,'run.json'),'utf8')),authority={runId:cp.runId,bootId:cp.world.snapshot.bootId,sceneDigest:cp.world.snapshot.sceneDigest,lastCommittedTick:cp.tick,businessEpochMs:cp.manifest.clock.businessEpochMs};return {authority,...await readWorldEvidence(join(directory,'world-evidence'),admission),scene,admission};}};
}
export async function cellUntil(run:ScenarioRun,predicate:(view:Awaited<ReturnType<ScenarioRun['snapshot']>>)=>boolean,limit=12000,chunk=25){let v=await run.snapshot(),lastProgress=0;const started=performance.now();while(v.tick<limit&&!predicate(v)&&!['completed','needs_attention','cancelled'].includes(v.run.status)){v=await act(run,'step',{ticks:chunk});if(v.tick-lastProgress>=500){lastProgress=v.tick;console.log('B06 progress',JSON.stringify({tick:v.tick,simSeconds:v.tick*.02,wallSeconds:(performance.now()-started)/1000,status:v.run.status,served:v.served}));}}return v;}
