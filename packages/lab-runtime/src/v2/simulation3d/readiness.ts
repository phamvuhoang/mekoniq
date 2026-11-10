// Webots 3D provider: operator opt-in (MEKONIQ_LAB_WEBOTS=1), a host Webots R2025a, a real worker describe at boot, and per-request readiness from the admitted bundle plus
// a real create smoke. Nothing here falls back to another plant; test doubles never make the provider installed.
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {WEBOTS_UNCONFIGURED,type BackendCapability} from '../capabilities';
import {lockDigestOf} from '../../engineering/linkforge';
import type {NativeReadinessChecks} from '../readiness';
import {closeOnAbort,providerReadiness} from '../navigation2d/readiness';
import {WorkerLostError,type PlantPort} from '../navigation2d/plant';
import {activeRunCount} from '../navigation2d/runner';
import {WEBOTS_AMR,webotsPlant,type WebotsRuntimeOptions} from './webots';
import {spawnSim3DWorker} from './worker-client';

export const WEBOTS_BASIC_TIME_STEP_MS=20;
export const WEBOTS_MAX_ACTIVE_RUNS=1; // one Webots (one GUI process, one physics world) per host
export interface WebotsOptions {enabled:boolean;python:string;workerRoot:string;lockPath:string;webotsHome:string;directory:string;schemaDir?:string;
 bundleFile?:(bundleDigest:string,path:string)=>Promise<Uint8Array>;
 /** Test/fault option: the worker entry (a double). Never exposed through a request. */entry?:string[]}
export interface WebotsProvider {plant?:{port:PlantPort;runtime:WebotsRuntimeOptions};capability:BackendCapability;readinessChecks?:NativeReadinessChecks}
const cap=(reason?:string):BackendCapability=>({id:WEBOTS_AMR.id,modes:['simulation'],accesses:['simulated'],installed:!reason,compatible:!reason,reachable:!reason,commissioned:true,...reason?{reason}:{}});

export async function webotsFromOptions(o:WebotsOptions):Promise<WebotsProvider>{
 const off=(reason:string):WebotsProvider=>({capability:cap(reason)});
 if(!o.enabled)return {capability:WEBOTS_UNCONFIGURED}; // exactly the catalog entry of a runtime that was never given the option
 if(!process.versions.node.startsWith('24.'))return off('NODE_24_REQUIRED');
 if(process.platform!=='darwin')return off(`HOST_UNSUPPORTED: ${process.platform} (Release 1 runs Webots on macOS)`);
 const home=resolve(o.webotsHome);
 if(!existsSync(join(home,'Contents','MacOS','webots')))return off(`WEBOTS_NOT_INSTALLED: no Webots.app at ${home}`);
 const workerRoot=resolve(o.workerRoot),schemaDir=resolve(o.schemaDir??join(workerRoot,'..','..','packages','contracts','schemas')),probeDir=join(o.directory,'webots-probe');
 let lockDigest:string,describe:{engineVersion?:string;executableSha256?:string;pythonVersion:string;lockDigest:string};
 try{
  lockDigest=await lockDigestOf(o.lockPath);
  await mkdir(probeDir,{recursive:true,mode:0o700});
  const scratch=await mkdtemp(join(probeDir,'describe-'));
  try{
   const w=await spawnSim3DWorker({python:o.python,workerRoot,runId:'webots-describe',bundleRoot:scratch,runDirectory:join(scratch,'run'),lockDigest,schemaDir,webotsHome:home,...o.entry?{entry:o.entry}:{}});
   try{
    const r=await w.request({protocol:'mekoniq-sim3d/1',requestId:'describe-1',runId:'webots-describe',expectedTick:0,op:'describe',payload:{}});
    if(!r.ok)return off(`WEBOTS_WORKER_UNAVAILABLE: ${(r as {error:{code:string}}).error.code}`);
    describe=r.result as typeof describe;
   }finally{await w.close('describe done');}
  }finally{await rm(scratch,{recursive:true,force:true});}
 }catch(e){return off(`WEBOTS_WORKER_UNAVAILABLE: ${e instanceof WorkerLostError?e.code:(e as Error).message.slice(0,160)}`);}
 if(describe.engineVersion!==WEBOTS_AMR.version)return off(`WEBOTS_VERSION_MISMATCH: found ${describe.engineVersion??'unknown'}, pinned ${WEBOTS_AMR.version}`);
 if(!describe.executableSha256)return off('WEBOTS_WORKER_UNAVAILABLE: the worker reported no executable digest');
 if(!describe.pythonVersion.startsWith('3.11.'))return off(`PYTHON_311_REQUIRED: ${describe.pythonVersion}`);
 if(describe.lockDigest!==lockDigest)return off('WEBOTS_LOCK_MISMATCH');
 const runtime:WebotsRuntimeOptions={python:o.python,workerRoot,schemaDir,lockDigest,webotsHome:home,executableSha256:describe.executableSha256,basicTimeStepMs:WEBOTS_BASIC_TIME_STEP_MS,maxActiveRuns:WEBOTS_MAX_ACTIVE_RUNS,...o.entry?{entry:o.entry}:{}};
 const port=webotsPlant(runtime);
 const readinessChecks=providerReadiness({prefix:'WEBOTS',engineId:'webots_3d',runtime,lockPath:o.lockPath,directory:o.directory,probeDir,bundleFile:o.bundleFile,
  evidence:`webots:${describe.engineVersion}/sha256:${describe.executableSha256.slice(0,16)}/python-${describe.pythonVersion}/lock:${lockDigest.slice(0,16)}`,
  capacity:runId=>activeRunCount(WEBOTS_AMR.id,runId)<WEBOTS_MAX_ACTIVE_RUNS,exclusive:true,
  async smoke(scene,bundleRoot,runDirectory,signal){
   try{
    const w=await spawnSim3DWorker({python:runtime.python,workerRoot:runtime.workerRoot,runId:'webots-smoke',bundleRoot,runDirectory,lockDigest,schemaDir,sceneDigest:scene.sceneDigest,webotsHome:home,...o.entry?{entry:o.entry}:{}});
    const detach=closeOnAbort(signal,()=>w.close('readiness timeout'));
    try{
     const c=await w.request({protocol:'mekoniq-sim3d/1',requestId:'smoke-1',runId:'webots-smoke',expectedTick:0,op:'create',payload:{sceneRef:'navigation-scene.json',seed:1}});
     if(c.ok)return [];
     const code=(c as {error:{code:string;detail:string}}).error;
     // Webots needs a window-server session on macOS; a failure that names the display is that, not a broken install
     return [code.code==='WEBOTS_START_FAILED'&&/display|window ?server|cocoa|platform plugin/i.test(code.detail)?'WEBOTS_NO_GUI_SESSION':code.code==='WEBOTS_PORT_IN_USE'?'WEBOTS_PORT_IN_USE':`WEBOTS_SMOKE_FAILED:${code.code}`];
    }catch(e){return [`WEBOTS_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'WORKER_FAILED'}`];}
    finally{detach();await w.close('smoke done');}
   }catch(e){return [`WEBOTS_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'SPAWN_FAILED'}`];}
  }});
 // a worker entry override is a test double: it can exercise every row above, but it never makes the provider installed
 return {plant:{port,runtime},capability:o.entry?cap('WEBOTS_TEST_DOUBLE: a worker entry override never makes the provider installed'):cap(),readinessChecks};
}
