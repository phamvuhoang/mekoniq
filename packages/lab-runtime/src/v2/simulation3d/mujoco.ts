// The MuJoCo arm provider (backend mujoco_arm, R2a): operator opt-in (MEKONIQ_LAB_MUJOCO=1), a hash-locked .venv-mujoco, a real worker describe at boot, and per-request readiness from
// the run's project (the cell scene) plus a real create smoke. MuJoCo runs inside the worker process: nothing here installs anything or falls back to another plant.
import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {MUJOCO_ARM,MUJOCO_ARM_UNCONFIGURED,type BackendCapability} from '../capabilities';
import {lockDigestOf} from '../../engineering/linkforge';
import type {NativeReadinessChecks} from '../readiness';
import {WorkerLostError,type IRSimRuntimeOptions} from '../navigation2d/plant';
import {closeOnAbort} from '../navigation2d/readiness';
import type {ArmCellSceneV1} from '../navigation2d/contracts';
import type {ArmObstacle} from '../models/arm-collision';
import {buildArmCellScene,readXArmFixture,writeArmCellBundle,type XArmPhysics} from './arm-cell-scene';
import {armReadiness} from './readiness';
import {spawnMujocoWorker} from './worker-client';

/** One MuJoCo arm run per host: the run's world is one engine in one worker. */
export const MUJOCO_MAX_ACTIVE_RUNS=1,MUJOCO_SLOT='mujoco_arm';
export interface MujocoRuntimeOptions extends IRSimRuntimeOptions {engineVersion:string;maxActiveRuns?:number;
 /** Test/fault option: obstacles (arm base frame) that exist in the MuJoCo cell only; the TS capsule check never sees them. Never exposed through a request. */armExtraStatics?:readonly ArmObstacle[];
 /** Test/fault option: physics.json fields replaced for the worker (e.g. weaker gains). Never exposed through a request. */physicsOverride?:Partial<XArmPhysics>;
 /** Test/fault option: the pad friction of the cell scene (e.g. a slippery grip). Never exposed through a request. */padFrictionOverride?:number}
/** Operator options only (CLI flags/env), never request fields. */
export interface MujocoOptions {enabled:boolean;python:string;workerRoot:string;lockPath:string;directory:string;schemaDir?:string}
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

export async function mujocoFromOptions(o:MujocoOptions):Promise<{arm:{runtime?:MujocoRuntimeOptions;capability:BackendCapability;readinessChecks?:NativeReadinessChecks}}>{
 const off=(reason:string)=>({arm:{capability:cap(reason)}});
 if(!o.enabled)return {arm:{capability:MUJOCO_ARM_UNCONFIGURED}}; // exactly the catalog entry of a runtime that was never given the option
 if(!process.versions.node.startsWith('24.'))return off('NODE_24_REQUIRED');
 if(!['darwin','linux'].includes(process.platform))return off(`HOST_UNSUPPORTED: ${process.platform}`);
 const workerRoot=resolve(o.workerRoot),schemaDir=resolve(o.schemaDir??join(workerRoot,'..','..','packages','contracts','schemas')),probeDir=join(o.directory,'mujoco-probe');
 let lockDigest:string,describe:{engineVersion:string;pythonVersion:string;lockDigest:string};
 try{
  lockDigest=await lockDigestOf(o.lockPath);
  // the venv must hold exactly the lock: a worker that merely starts on another set of packages is not this provider
  const missing=await lockMismatch(o.python,o.lockPath);
  if(missing.length)return off(`MUJOCO_LOCK_MISMATCH: ${missing.slice(0,5).join(', ')}${missing.length>5?` (+${missing.length-5})`:''}`);
  await mkdir(probeDir,{recursive:true,mode:0o700});
  const scratch=await mkdtemp(join(probeDir,'describe-'));
  try{
   const w=await spawnMujocoWorker({python:o.python,workerRoot,runId:'mujoco-describe',bundleRoot:scratch,runDirectory:join(scratch,'run'),lockDigest,schemaDir});
   try{
    const r=await w.request({protocol:'mekoniq-sim3d/1',requestId:'describe-1',runId:'mujoco-describe',expectedTick:0,op:'describe',payload:{}});
    if(!r.ok)return off(`MUJOCO_WORKER_UNAVAILABLE: ${(r as {error:{code:string}}).error.code}`);
    describe=r.result as unknown as typeof describe;
   }finally{await w.close('describe done');}
  }finally{await rm(scratch,{recursive:true,force:true});}
 }catch(e){return off(`MUJOCO_WORKER_UNAVAILABLE: ${e instanceof WorkerLostError?e.code:(e as Error).message.slice(0,160)}`);}
 if(!describe.pythonVersion.startsWith('3.11.'))return off(`PYTHON_311_REQUIRED: ${describe.pythonVersion}`);
 if(describe.lockDigest!==lockDigest)return off('MUJOCO_LOCK_MISMATCH: the worker reported another lock');
 const runtime:MujocoRuntimeOptions={python:o.python,workerRoot,schemaDir,lockDigest,engineVersion:describe.engineVersion,maxActiveRuns:MUJOCO_MAX_ACTIVE_RUNS};
 const readinessChecks=armReadiness({prefix:'MUJOCO',slot:MUJOCO_SLOT,maxRuns:MUJOCO_MAX_ACTIVE_RUNS,oracle:'mujocoArm',lockPath:o.lockPath,lockDigest,probeDir,gate:{busy:false},
  evidence:`mujoco:${describe.engineVersion}/python-${describe.pythonVersion}/lock:${lockDigest.slice(0,16)}`,
  // the cell the run will build from its project (one cup for the smoke: the run's own cups do not change whether the cell compiles)
  scene(project){const f=readXArmFixture(workerRoot),scene=buildArmCellScene(project,f,1,{armId:project.entities.find(e=>e.kind==='arm')?.id??'arm-1',propIds:['cup-1']});
   return {scene,write:bundle=>writeArmCellBundle(bundle,scene,f)};},
  smoke:(scene,bundle,runDirectory,signal)=>smoke(runtime,scene,bundle,runDirectory,signal)});
 return {arm:{runtime,capability:cap(),readinessChecks}};
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
