// MJ-BV01 through the gateway factory on the real MuJoCo 3.17.0 (.venv-mujoco): the flag-on provider (a real describe), the portable dispatcher, the fixture's xArm coffee cell project.
// Fault variants are runtime options set here in code (never a request field), or a copy of the worker root whose fixture differs in one value. Nothing here marks a provider installed
// that the production readiness would not.
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {portableSimulationFromOptions,type PortableSimulation} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import {mujocoFromOptions,type MujocoRuntimeOptions} from '../../packages/lab-runtime/src/v2/simulation3d/mujoco';
import {XARM_FIXTURE_ID} from '../../packages/lab-runtime/src/v2/simulation3d/arm-cell-scene';
import type {RunManifestInput,ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import type {AssetRevision} from '../../packages/lab-runtime/src/v2/contracts';
import type {LabProjectV2} from '../../packages/lab-runtime/src/v2/contracts';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {amrAsset} from './lab-v2';

export const mujocoPython=resolve('.venv-mujoco/bin/python'),mujocoRoot=resolve('robotics/simulation-mujoco');
export const mujocoReady=existsSync(mujocoPython)&&(()=>{try{return execFileSync(mujocoPython,['-I','-B','-c','import mujoco;print(mujoco.__version__)'],{encoding:'utf8',timeout:30_000}).trim()==='3.17.0';}catch{return false;}})();
/** Every MuJoCo worker process of this host (a run's, a describe's or a smoke's). */
export const mujocoWorkers=()=>{try{return execFileSync('pgrep',['-f','mujoco_worker'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);}catch{return [];}};
/** The fixture's xArm coffee cell project, verbatim. */
export const xarmProject=()=>JSON.parse(readFileSync(join(mujocoRoot,'fixtures',XARM_FIXTURE_ID,'coffee-cell-project.json'),'utf8')) as LabProjectV2;
/** The project's AMR asset (service-robot-asset@1, bf15015a…) is the server catalog's 3-tray lidar service robot (backend-registry.ts serverAssets, the same as lab-v2.ts amrAsset):
 * every run resolves it by content hash, a gateway run too. Passing it as a run asset changes nothing. */
export const xarmAmrAsset:AssetRevision=amrAsset;

const dirs:string[]=[];
export const removeMujocoDirs=()=>Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));
export const mujocoTemp=async(p:string)=>{const d=await mkdtemp(join(tmpdir(),p));dirs.push(d);return d;};

export interface MujocoGateway {sim:PortableSimulation;runtime:MujocoRuntimeOptions}
/** The flag-on provider (a real describe) and the dispatcher over it; `over` replaces arm runtime options (the fault options, or another worker root). */
export async function mujocoGateway(over:Partial<MujocoRuntimeOptions>={}):Promise<MujocoGateway>{
 const directory=await mujocoTemp('mj-gw-');
 const p=await mujocoFromOptions({enabled:true,python:mujocoPython,workerRoot:mujocoRoot,lockPath:join(mujocoRoot,'requirements.lock'),directory:join(directory,'probe')});
 if(!p.arm.capability.installed||!p.arm.runtime)throw new Error(`MUJOCO_ARM_NOT_INSTALLED: ${p.arm.capability.reason}`);
 const runtime={...p.arm.runtime,...over};
 const sim=await portableSimulationFromOptions({enabled:false,python:'python3',workerRoot:resolve('robotics/navigation-2d'),lockPath:resolve('robotics/navigation-2d/requirements.lock'),directory,mujoco:{arm:{...p.arm,runtime}}});
 return {sim,runtime};
}
export const mujocoInput=(project:unknown,seed:number,scenarioId='MJ-BV01',backendSetId='engineering-mujoco-arm-v1'):RunManifestInput=>({project,scenarioId,scenarioRevision:1,seed,mode:'simulation',access:'simulated',backendSetId,sourceCommit:'test-commit'});
export async function openMujocoRun(gw:MujocoGateway,over:{project?:unknown;seed?:number}={}):Promise<{run:ScenarioRun;directory:string}>{
 const directory=join(await mujocoTemp('mj-run-'),'run');await mkdir(directory,{recursive:true});
 const run=await gw.sim.simulationFactory(mujocoInput(over.project??xarmProject(),over.seed??42),{directory,assets:[xarmAmrAsset],catalog:gw.sim.catalog,enabledBackends:['mock_amr','mock_coffee','mock_arm',...gw.sim.enabledBackends]});
 return {run,directory};
}
/** A copy of the worker root (package, lock, fixture) whose fixture gives arm joint `joint` (0-based) `fraction` of its manufacturer effort: the compiled actuator's force range is that effort.
 * The manifest's file hash and component digest are recomputed so the runtime reads it; the model revision (kinematics) is unchanged. */
export async function weakJointRoot(joint:number,fraction:number):Promise<{root:string;effortNm:number;fromNm:number}>{
 const root=join(await mujocoTemp('mj-weak-'),'simulation-mujoco'),fx=join(root,'fixtures',XARM_FIXTURE_ID);
 await cp(join(mujocoRoot,'mujoco_worker'),join(root,'mujoco_worker'),{recursive:true,filter:s=>!s.includes('__pycache__')});
 await cp(join(mujocoRoot,'requirements.lock'),join(root,'requirements.lock'));
 await cp(join(mujocoRoot,'fixtures',XARM_FIXTURE_ID),fx,{recursive:true});
 const component=JSON.parse(await readFile(join(fx,'component.json'),'utf8')) as {joints:{id:string;limits?:{effort?:{value:number}}}[]};
 const arm=component.joints.filter(j=>/^J\d$/.test(j.id)),effort=arm[joint]!.limits!.effort!,fromNm=effort.value;effort.value=fromNm*fraction;
 const text=JSON.stringify(component,null,2)+'\n',manifest=JSON.parse(await readFile(join(fx,'manifest.json'),'utf8')) as {componentDigest:string;files:{path:string;bytes:number;sha256:string}[]};
 const row=manifest.files.find(f=>f.path==='component.json')!;row.bytes=Buffer.byteLength(text);row.sha256=createHash('sha256').update(text).digest('hex');manifest.componentDigest=hashJson(component as never);
 await writeFile(join(fx,'component.json'),text);await writeFile(join(fx,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return {root,effortNm:effort.value,fromNm};
}
export const killMujocoWorkers=(signal:NodeJS.Signals='SIGKILL')=>{
 const pids=(()=>{try{return execFileSync('pgrep',['-f','mujoco_worker --run-id'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(Number);}catch{return [] as number[];}})();
 for(const p of pids)process.kill(p,signal);
 return pids;
};
