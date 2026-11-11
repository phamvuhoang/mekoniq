// WB-BV01 through the gateway factory on the real Webots R2025a: the flag-on provider (a real describe), the portable dispatcher, the Lab coffee project. Nothing here marks a provider installed
// that the production readiness would not. Fault variants swap the arm fixture (a weaker joint) or the project (an obstacle on the path) and nothing else.
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {portableSimulationFromOptions,type PortableSimulation} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import {webotsFromOptions,type WebotsProvider} from '../../packages/lab-runtime/src/v2/simulation3d/readiness';
import type {RunManifestInput,ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import type {ArmObstacle} from '../../packages/lab-runtime/src/v2/models/arm-collision';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {forwardKinematics,PUMA560_SI} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import {amrAsset,coffeeProject} from './lab-v2';

export const WEBOTS_HOME=process.env.MEKONIQ_WEBOTS_HOME??'/Applications/Webots.app',armPython=resolve('.venv-webots/bin/python'),armWorkerRoot=resolve('robotics/simulation-3d');
const exe=join(WEBOTS_HOME,'Contents','MacOS','webots');
export const armWebotsAvailable=existsSync(exe)&&existsSync(armPython)&&(()=>{try{return execFileSync(exe,['--version'],{encoding:'utf8',timeout:30_000}).includes('R2025a');}catch{return false;}})();
/** Webots, its supervisor and the controllers started by a run (anchored at the start of the command line, so a shell that merely mentions them never matches). */
export const armProcesses=()=>{try{return execFileSync('pgrep',['-f','^[^ ]*/Contents/MacOS/webots |^[^ ]+ -I -B -X utf8 [^ ]*webots_worker/(supervisor|robot_controller|arm_controller)\\.py'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);}catch{return [];}};
export const armWorkers=()=>{try{return execFileSync('pgrep',['-f','^[^ ]+ -I -B [^ ]* ?-m webots_worker |webots_worker --run-id'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);}catch{return [];}};

const dirs:string[]=[];
export const removeArmDirs=()=>Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));
export const armTemp=async(p:string)=>{const d=await mkdtemp(join(tmpdir(),p));dirs.push(d);return d;};

export interface ArmGateway {sim:PortableSimulation;webots:WebotsProvider;directory:string}
/** The flag-on provider and the dispatcher over it. `armRuntime` overrides the arm runtime options (a fixture variant). */
export async function armGateway(armRuntime:Partial<NonNullable<WebotsProvider['arm']['runtime']>>={}):Promise<ArmGateway>{
 const directory=await armTemp('arm-gw-');
 const webots=await webotsFromOptions({enabled:true,python:armPython,workerRoot:armWorkerRoot,lockPath:join(armWorkerRoot,'requirements.lock'),webotsHome:WEBOTS_HOME,directory:join(directory,'probe')});
 if(!webots.arm.capability.installed||!webots.arm.runtime)throw new Error(`WEBOTS_ARM_NOT_INSTALLED: ${webots.arm.capability.reason}`);
 const provider:WebotsProvider={...webots,arm:{...webots.arm,runtime:{...webots.arm.runtime,...armRuntime}}};
 const sim=await portableSimulationFromOptions({enabled:false,python:'python3',workerRoot:resolve('robotics/navigation-2d'),lockPath:resolve('robotics/navigation-2d/requirements.lock'),directory,webots:provider});
 return {sim,webots:provider,directory};
}
export const armInput=(project:unknown,seed:number,scenarioId='WB-BV01',backendSetId='engineering-webots-arm-v1'):RunManifestInput=>({project,scenarioId,scenarioRevision:1,seed,mode:'simulation',access:'simulated',backendSetId,sourceCommit:'test-commit'});
export async function openArmRun(gw:ArmGateway,over:{project?:unknown;seed?:number;scenarioId?:string;backendSetId?:string}={}):Promise<{run:ScenarioRun;directory:string}>{
 const directory=join(await armTemp('arm-run-'),'run');await mkdir(directory,{recursive:true});
 const run=await gw.sim.simulationFactory(armInput(over.project??coffeeProject(),over.seed??42,over.scenarioId,over.backendSetId),{directory,assets:[amrAsset],catalog:gw.sim.catalog,enabledBackends:['mock_amr','mock_coffee','mock_arm',...gw.sim.enabledBackends]}); // what the server enables: the mock backends, plus the portable provider
 return {run,directory};
}

/** A copy of the arm-ref-3d-v1 fixture whose joint `joint` (0-based) has `effortNm` of motor torque: the digest in its manifest is recomputed, so the scene and the worker accept it. */
export async function weakJointFixture(joint:number,effortNm:number):Promise<string>{
 const dir=join(await armTemp('arm-weak-'),'arm-ref-3d-v1');
 await cp(join(armWorkerRoot,'fixtures','arm-ref-3d-v1'),dir,{recursive:true});
 const component=JSON.parse(await readFile(join(dir,'component.json'),'utf8')) as {joints:{limits:{effort:{value:number}}}[]};
 component.joints[joint]!.limits.effort.value=effortNm;
 const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')) as Record<string,unknown>;
 await writeFile(join(dir,'component.json'),JSON.stringify(component,null,2)+'\n');
 await writeFile(join(dir,'manifest.json'),JSON.stringify({...manifest,componentDigest:hashJson(component)},null,2)+'\n');
 return dir;
}
/** A box in the Webots arm world only (arm base frame) square on where the flange is when the arm stands at `q`: whatever program moves the arm there touches it. */
export function obstacleAtPose(q:number[],half=0.06,id='crate'):ArmObstacle{
 const [x,y,z]=forwardKinematics(PUMA560_SI,q).flange.position;
 return {id,kind:'box',min:[x-half,y-half,z-half],max:[x+half,y+half,z+half]};
}
export const killProcesses=(pattern:string,signal:NodeJS.Signals='SIGKILL')=>{
 const pids=(()=>{try{return execFileSync('pgrep',['-f',pattern],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(Number);}catch{return [] as number[];}})();
 for(const p of pids)process.kill(p,signal);
 return pids;
};
