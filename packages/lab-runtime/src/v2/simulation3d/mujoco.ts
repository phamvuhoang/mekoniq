// MuJoCo arm and mobile providers (mujoco_arm / mujoco_3d): operator opt-in (MEKONIQ_LAB_MUJOCO=1), a hash-locked .venv-mujoco, a real worker describe at boot, and per-request readiness from
// the run's project (the cell scene) plus a real create smoke. MuJoCo runs inside the worker process: nothing here installs anything or falls back to another plant.
import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {MUJOCO_ARM,MUJOCO_ARM_UNCONFIGURED,MUJOCO_MOBILE_UNCONFIGURED,type BackendCapability} from '../capabilities';
import {lockDigestOf} from '../../engineering/linkforge';
import {WorkerLostError,type IRSimRuntimeOptions} from '../navigation2d/plant';
import {closeOnAbort,providerReadiness} from '../navigation2d/readiness';
import type {ArmCellSceneV1} from '../navigation2d/contracts';
import type {ArmObstacle} from '../models/arm-collision';
import {buildArmCellScene,readXArmFixture,writeArmCellBundle,type XArmPhysics} from './arm-cell-scene';
import {armReadiness} from './readiness';
import {activeRunCount,holdsSlot,holdSlot,releaseSlot} from '../navigation2d/runner';
import {mujocoMobilePlant,prepareMobileStopMonitor} from './mujoco-mobile';
import type {MujocoProviderLike} from '../navigation2d/readiness';
import {spawnMujocoWorker} from './worker-client';

/** One MuJoCo world across arm/mobile/future cell: the run's world is one engine in one worker. */
export const MUJOCO_MAX_ACTIVE_RUNS=1,MUJOCO_SLOT='mujoco_engine';
export interface MujocoRuntimeOptions extends IRSimRuntimeOptions {engineVersion:string;maxActiveRuns?:number;
 /** Test/fault option: obstacles (arm base frame) that exist in the MuJoCo cell only; the TS capsule check never sees them. Never exposed through a request. */armExtraStatics?:readonly ArmObstacle[];
 /** Test/fault option: physics.json fields replaced for the worker (e.g. weaker gains). Never exposed through a request. */physicsOverride?:Partial<XArmPhysics>;
 /** Test/fault option: the pad friction of the cell scene (e.g. a slippery grip). Never exposed through a request. */padFrictionOverride?:number}
/** Operator options only (CLI flags/env), never request fields. */
export interface MujocoOptions {enabled:boolean;python:string;workerRoot:string;lockPath:string;directory:string;schemaDir?:string;bundleFile?:(bundleDigest:string,path:string)=>Promise<Uint8Array>}
const cap=(reason?:string):BackendCapability=>({id:MUJOCO_ARM.id,modes:['simulation'],accesses:['simulated'],installed:!reason,compatible:!reason,reachable:!reason,commissioned:true,...reason?{reason}:{}});
const run=promisify(execFile);
// every distribution the interpreter sees, as normalized name -> version (PEP 503 names), from the standard library only
const DISTRIBUTIONS="import importlib.metadata as m,json,re\nprint(json.dumps({re.sub(r'[-_.]+','-',d.metadata['Name']).lower():d.version for d in m.distributions()}))";

/** The packages of the lock (`name==version` lines) that the interpreter does not have at exactly that version. */
async function lockMismatch(python:string,lockPath:string):Promise<string[]>{
 const want=[...(await readFile(lockPath,'utf8')).matchAll(/^([A-Za-z0-9][A-Za-z0-9_.-]*)==([^\s;\\]+)/gm)].map(([,n,v])=>[n!.replace(/[-_.]+/g,'-').toLowerCase(),v!] as const);
 const have=JSON.parse((await run(python,['-I','-B','-c',DISTRIBUTIONS],{timeout:30_000,maxBuffer:1<<22})).stdout) as Record<string,string>;
 return want.filter(([n,v])=>have[n]!==v).map(([n,v])=>`${n}==${v}`);
}

/** Health may be served on a public bind: a MuJoCo reason is a code and fixed wording only. What varies (exception text, paths, versions, package names) goes to the runtime's stderr. */
const OFF_WORDING={NODE_24_REQUIRED:'the runtime needs Node 24',HOST_UNSUPPORTED:'MuJoCo runs on macOS or Linux only',MUJOCO_LOCK_MISMATCH:'the interpreter does not hold exactly the packages of requirements.lock',
 MUJOCO_WORKER_UNAVAILABLE:'the MuJoCo worker could not be started or did not answer describe',PYTHON_311_REQUIRED:'the MuJoCo worker needs Python 3.11'} as const;
export async function mujocoFromOptions(o:MujocoOptions):Promise<MujocoProviderLike&{mobile:NonNullable<MujocoProviderLike['mobile']>}>{
 const off=(code:keyof typeof OFF_WORDING,detail?:string)=>{if(detail)process.stderr.write(`mujoco_arm unavailable: ${code}: ${detail}\n`);return {arm:{capability:cap(`${code}: ${OFF_WORDING[code]}`)},mobile:{capability:{...cap(`${code}: ${OFF_WORDING[code]}`),id:'mujoco_3d'}}};};
 if(!o.enabled)return {arm:{capability:MUJOCO_ARM_UNCONFIGURED},mobile:{capability:MUJOCO_MOBILE_UNCONFIGURED}}; // exactly the catalog entry of a runtime that was never given the option
 if(!process.versions.node.startsWith('24.'))return off('NODE_24_REQUIRED');
 if(!['darwin','linux'].includes(process.platform))return off('HOST_UNSUPPORTED',process.platform);
 const workerRoot=resolve(o.workerRoot),schemaDir=resolve(o.schemaDir??join(workerRoot,'..','..','packages','contracts','schemas')),probeDir=join(o.directory,'mujoco-probe');
 let lockDigest:string,describe:{engineVersion:string;pythonVersion:string;lockDigest:string};
 try{
  lockDigest=await lockDigestOf(o.lockPath);
  // the venv must hold exactly the lock: a worker that merely starts on another set of packages is not this provider
  const missing=await lockMismatch(o.python,o.lockPath);
  if(missing.length)return off('MUJOCO_LOCK_MISMATCH',`${missing.slice(0,5).join(', ')}${missing.length>5?` (+${missing.length-5})`:''}`);
  await mkdir(probeDir,{recursive:true,mode:0o700});
  const scratch=await mkdtemp(join(probeDir,'describe-'));
  try{
   const w=await spawnMujocoWorker({python:o.python,workerRoot,runId:'mujoco-describe',bundleRoot:scratch,runDirectory:join(scratch,'run'),lockDigest,schemaDir});
   try{
    const r=await w.request({protocol:'mekoniq-sim3d/1',requestId:'describe-1',runId:'mujoco-describe',expectedTick:0,op:'describe',payload:{}});
    if(!r.ok)return off('MUJOCO_WORKER_UNAVAILABLE',(r as {error:{code:string}}).error.code);
    describe=r.result as unknown as typeof describe;
   }finally{await w.close('describe done');}
  }finally{await rm(scratch,{recursive:true,force:true});}
 }catch(e){return off('MUJOCO_WORKER_UNAVAILABLE',e instanceof WorkerLostError?e.code:(e as Error).message);}
 if(!describe.pythonVersion.startsWith('3.11.'))return off('PYTHON_311_REQUIRED',describe.pythonVersion);
 if(describe.lockDigest!==lockDigest)return off('MUJOCO_LOCK_MISMATCH','the worker reported another lock');
 const runtime:MujocoRuntimeOptions={python:o.python,workerRoot,schemaDir,lockDigest,engineVersion:describe.engineVersion,maxActiveRuns:MUJOCO_MAX_ACTIVE_RUNS};
 const gate={busy:false};
 // A probe owns the same engine slot as a run, from immediately before spawn through process close.
 const engineSmoke=async(runSmoke:()=>Promise<string[]>)=>{
  if(activeRunCount(MUJOCO_SLOT))return ['MUJOCO_CAPACITY'];
  const id='mujoco-readiness-smoke';holdSlot(MUJOCO_SLOT,id);
  try{return await runSmoke();}finally{releaseSlot(MUJOCO_SLOT,id);}
 };
 const readinessChecks=armReadiness({prefix:'MUJOCO',slot:MUJOCO_SLOT,maxRuns:MUJOCO_MAX_ACTIVE_RUNS,oracle:'mujocoArm',lockPath:o.lockPath,lockDigest,probeDir,gate,
  evidence:`mujoco:${describe.engineVersion}/python-${describe.pythonVersion}/lock:${lockDigest.slice(0,16)}`,
  // the cell the run will build from its project (one cup for the smoke: the run's own cups do not change whether the cell compiles)
  scene(project){const f=readXArmFixture(workerRoot),scene=buildArmCellScene(project,f,1,{armId:project.entities.find(e=>e.kind==='arm')?.id??'arm-1',propIds:['cup-1']});
   return {scene,write:bundle=>writeArmCellBundle(bundle,scene,f)};},
  smoke:(scene,bundle,runDirectory,signal)=>engineSmoke(()=>smoke(runtime,scene,bundle,runDirectory,signal))});
 const mobile:NonNullable<MujocoProviderLike['mobile']>=o.bundleFile?{plant:{port:mujocoMobilePlant(runtime),runtime},capability:{...cap(),id:'mujoco_3d'},readinessChecks:providerReadiness({
  prefix:'MUJOCO',engineId:'mujoco_3d',runtime,lockPath:o.lockPath,directory:o.directory,probeDir,bundleFile:o.bundleFile,
  evidence:`mujoco:${describe.engineVersion}/python-${describe.pythonVersion}/lock:${lockDigest.slice(0,16)}`,
  capacity:runId=>activeRunCount(MUJOCO_SLOT,runId)<MUJOCO_MAX_ACTIVE_RUNS,holds:runId=>holdsSlot(MUJOCO_SLOT,runId),exclusive:true,gate,
  async smoke(scene,bundleRoot,runDirectory,signal){return engineSmoke(async()=>{
   const monitor=await prepareMobileStopMonitor(scene,path=>readFile(join(bundleRoot,path)));
   const w=await spawnMujocoWorker({...runtime,runId:'mujoco-mobile-smoke',bundleRoot,runDirectory,sceneDigest:scene.sceneDigest});
   const detach=closeOnAbort(signal,()=>w.close('readiness timeout'));
   try{const c=await w.request({protocol:'mekoniq-sim3d/1',requestId:'create-1',runId:'mujoco-mobile-smoke',expectedTick:0,op:'create',payload:{sceneRef:'navigation-scene.json',seed:1}});if(!c.ok)return [`MUJOCO_SMOKE_FAILED:${c.error.code}`];const fault=monitor(c.result as never);return fault?[`MUJOCO_SMOKE_FAILED:${fault.code}`]:[];}
   catch(e){return [`MUJOCO_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'WORKER_FAILED'}`];}
   finally{detach();await w.close('smoke done');}
  });}})}:{capability:{...cap('ENGINEERING_REF_REQUIRED: mobile MuJoCo needs an engineering bundle service'),id:'mujoco_3d'}};
 return {arm:{runtime,capability:cap(),readinessChecks},mobile};
}
/** A real worker on the real cell: create (compiles the MJCF, loads the meshes, runs the priming step), then close. */
async function smoke(runtime:MujocoRuntimeOptions,scene:ArmCellSceneV1,bundleRoot:string,runDirectory:string,signal:AbortSignal):Promise<string[]>{
 try{
  const w=await spawnMujocoWorker({python:runtime.python,workerRoot:runtime.workerRoot,runId:'mujoco-arm-smoke',bundleRoot,runDirectory,lockDigest:runtime.lockDigest,schemaDir:runtime.schemaDir,sceneDigest:scene.sceneDigest,...runtime.entry?{entry:runtime.entry}:{}});
  const detach=closeOnAbort(signal,()=>w.close('readiness timeout'));
  try{
   const c=await w.request({protocol:'mekoniq-sim3d/1',requestId:'smoke-1',runId:'mujoco-arm-smoke',expectedTick:0,op:'create',payload:{sceneRef:'arm-cell-scene.json',seed:1,arms:[{armId:scene.arm.armId,sceneRef:'arm-cell-scene.json'}]}});
   return c.ok?[]:[`MUJOCO_SMOKE_FAILED:${(c as {error:{code:string}}).error.code}`];
  }catch(e){return [`MUJOCO_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'WORKER_FAILED'}`];}
  finally{detach();await w.close('smoke done');}
 }catch(e){return [`MUJOCO_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'SPAWN_FAILED'}`];}
}
