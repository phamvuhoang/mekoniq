// Portable IR-SIM provider: operator opt-in (MEKONIQ_LAB_IRSIM=1, independent of the LinkForge flag), a real worker describe at boot, and per-request readiness
// from the admitted bundle plus a real create smoke. Nothing here falls back to mock or native providers; test doubles never make this provider installed.
import {mkdir,mkdtemp,rm,statfs,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {defaultCatalog,type CapabilityCatalog} from '../capabilities';
import type {NativeReadinessChecks,ReadinessCheck} from '../readiness';
import type {RunManifestInput,RunProviders,ScenarioRun} from '../scenario-runner';
import {scenarioRegistry,resolveRoles} from '../scenario-registry';
import {validateProjectV2} from '../contracts';
import {hashJson} from '../hash';
import {lockDigestOf} from '../../engineering/linkforge';
import {validateNavigationDocument,type NavigationSceneV1} from './contracts';
import {spawnIRSimWorker,WorkerLostError} from './worker-client';
import {IRSIM_AMR} from './adapter';
import {createIRSimScenarioRun,irsimCapacity,IRSIM_BACKEND,type IRSimRuntimeOptions} from './runner';

/** The server catalog with irsim_2d marked usable (`usable`) or left unconfigured. Production code sets it usable only after a real worker describe. */
export const portableCatalog=(usable:boolean,base:CapabilityCatalog=defaultCatalog,reason?:string):CapabilityCatalog=>({...base,backends:base.backends.map(b=>{
 if(b.id!==IRSIM_BACKEND)return b;
 const {reason:_old,...rest}=b;void _old;
 return usable?{...rest,installed:true,compatible:true,reachable:true}:{...rest,installed:false,compatible:false,reachable:false,reason:reason??b.reason??'IRSIM_DISABLED'};
})});
export type SimulationFactory=(input:RunManifestInput,providers:RunProviders)=>Promise<ScenarioRun>;
/** Operator options only (CLI flags/env), never request fields. `nativeFactory` keeps native simulation exactly as configured. */
export interface PortableSimulationOptions {enabled:boolean;python:string;workerRoot:string;lockPath:string;directory:string;nativeFactory?:SimulationFactory;
 /** Catalog to extend (the native one when native is configured). */baseCatalog?:CapabilityCatalog;
 /** Admitted-bundle reader (the engineering service), for readiness. */bundleFile?:(bundleDigest:string,path:string)=>Promise<Uint8Array>;
 schemaDir?:string;
 /** Test/fault option: the worker entry (a double). Never exposed through a request. */entry?:string[];
 /** Live IR-SIM workers allowed on this host at once (default 2, workers-runtime §6). */maxActiveRuns?:number;}
export interface PortableSimulation {catalog:CapabilityCatalog;enabledBackends:string[];simulationFactory:SimulationFactory;readinessChecks?:NativeReadinessChecks;unavailable?:string;describe?:{packageVersion:string;pythonVersion:string;lockDigest:string}}
const MIN_FREE_BYTES=2*100*1024*1024; // two active runs at the 100 MiB evidence quota
const SMOKE_TTL_MS=60_000;
const sha256=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');

/** Factory dispatch by backend set: portable sets to the IR-SIM runner (only when the provider is live), native simulation sets to the native factory, anything else refused. */
function dispatcher(catalog:CapabilityCatalog,runtime:IRSimRuntimeOptions|undefined,nativeFactory?:SimulationFactory):SimulationFactory{
 return async(input,providers)=>{
  const set=Object.hasOwn(catalog.sets,input.backendSetId)?catalog.sets[input.backendSetId]:undefined;
  if(!set)throw new Error('BACKEND_SET_UNKNOWN');
  if(set.execution?.host==='portable_python'){if(!runtime)throw new Error('BACKEND_EXECUTION_DISABLED');return createIRSimScenarioRun(input,{...providers,irsim:runtime});}
  if(set.mode==='simulation'&&nativeFactory)return nativeFactory(input,providers);
  throw new Error('BACKEND_EXECUTION_DISABLED');
 };
}

export async function portableSimulationFromOptions(o:PortableSimulationOptions):Promise<PortableSimulation>{
 const base=o.baseCatalog??defaultCatalog,off=(reason:string):PortableSimulation=>{const catalog=portableCatalog(false,base,reason);return {catalog,enabledBackends:[],simulationFactory:dispatcher(catalog,undefined,o.nativeFactory),unavailable:reason.split(':')[0]!};};
 if(!o.enabled)return off('IRSIM_DISABLED: the portable IR-SIM provider is not enabled (MEKONIQ_LAB_IRSIM=1)');
 if(!process.versions.node.startsWith('24.'))return off('NODE_24_REQUIRED');
 if(!['darwin','linux'].includes(process.platform))return off(`HOST_UNSUPPORTED: ${process.platform}`);
 const workerRoot=resolve(o.workerRoot),schemaDir=resolve(o.schemaDir??join(workerRoot,'..','..','packages','contracts','schemas'));
 let lockDigest:string,describe:PortableSimulation['describe'];
 const probeDir=join(o.directory,'irsim-probe');
 try{
  lockDigest=await lockDigestOf(o.lockPath);
  await mkdir(probeDir,{recursive:true,mode:0o700});
  const scratch=await mkdtemp(join(probeDir,'describe-'));
  try{
   const w=await spawnIRSimWorker({python:o.python,workerRoot,runId:'irsim-describe',bundleRoot:scratch,runDirectory:join(scratch,'run'),lockDigest,schemaDir,...o.entry?{entry:o.entry}:{}});
   try{
    const r=await w.request({protocol:'mekoniq-irsim/1',requestId:'describe-1',runId:'irsim-describe',expectedTick:0,op:'describe',payload:{}});
    if(!r.ok)throw new Error(`IRSIM_DESCRIBE_FAILED:${r.error.code}`);
    describe=r.result as NonNullable<PortableSimulation['describe']>;
   }finally{await w.close('describe done');}
  }finally{await rm(scratch,{recursive:true,force:true});}
 }catch(e){return off(`IRSIM_WORKER_UNAVAILABLE: ${e instanceof WorkerLostError?e.code:(e as Error).message.slice(0,160)}`);}
 if(describe.packageVersion!==IRSIM_AMR.version)return off(`IRSIM_VERSION_MISMATCH: ir-sim ${describe.packageVersion}, pinned ${IRSIM_AMR.version}`);
 if(!describe.pythonVersion.startsWith('3.11.'))return off(`PYTHON_311_REQUIRED: ${describe.pythonVersion}`);
 if(describe.lockDigest!==lockDigest)return off('IRSIM_LOCK_MISMATCH');
 const runtime:IRSimRuntimeOptions={python:o.python,workerRoot,schemaDir,lockDigest,...o.entry?{entry:o.entry}:{},...o.maxActiveRuns!==undefined?{maxActiveRuns:o.maxActiveRuns}:{}},catalog=portableCatalog(true,base);
 return {catalog,enabledBackends:[IRSIM_BACKEND],simulationFactory:dispatcher(catalog,runtime,o.nativeFactory),describe,readinessChecks:portableReadiness(runtime,describe,o,probeDir)};
}

/** Per-request IR readiness: versions/lock, the admitted bundle's scene against the world and scenario, quota/free disk, and a real worker create smoke (cached per scene). */
function portableReadiness(runtime:IRSimRuntimeOptions,described:NonNullable<PortableSimulation['describe']>,o:PortableSimulationOptions,probeDir:string):NativeReadinessChecks{
 const smoked=new Map<string,number>();
 return async(context,signal)=>{
  const row=(id:string,reasonCodes:string[],evidenceRef:string|null=null,status:ReadinessCheck['status']='blocked'):ReadinessCheck=>({id,status:reasonCodes.length?status:'ready',reasonCodes,evidenceRef});
  const profile:string[]=[];
  if(await lockDigestOf(o.lockPath).catch(()=>null)!==runtime.lockDigest)profile.push('IRSIM_LOCK_CHANGED');
  const scenario=scenarioRegistry.get(context.scenarioId);
  let scene:NavigationSceneV1|undefined,files:[string,Uint8Array][]=[];const model:string[]=[],fixture:string[]=[];
  if(!context.engineering||!o.bundleFile)model.push('ENGINEERING_REF_REQUIRED');
  else try{
   const bytes=await o.bundleFile(context.engineering.bundleDigest,'navigation-scene.json'),doc=JSON.parse(Buffer.from(bytes).toString('utf8'));
   const checked=validateNavigationDocument(doc);
   if(!checked.ok||checked.value.documentType!=='navigation-scene')model.push(...new Set(checked.ok?['NAVIGATION_SCENE_INVALID']:checked.issues.map(i=>i.code)));
   else{
    scene=checked.value as NavigationSceneV1;files=[['navigation-scene.json',bytes]];
    if(scene.inputs.project.digest!==context.engineering.projectDigest)model.push('ENGINEERING_IDENTITY_MISMATCH');
    if(scene.robots.some(r=>r.model.sensors.length===0))model.push('SENSOR_MISSING');
    for(const f of scene.files){const b=await o.bundleFile(context.engineering.bundleDigest,f.path).catch(()=>null);if(!b||sha256(b)!==f.sha256)fixture.push(`ENGINEERING_CLOSURE_MISSING:${f.path}`);else files.push([f.path,b]);}
    const project=validateProjectV2(context.project);
    if(!project.ok)fixture.push('PROJECT_INVALID');
    else{
     if(scene.world.hash!==hashJson(project.value.world))fixture.push('SCENE_WORLD_MISMATCH');
     // ponytail: the runner refuses scheduled faults/obstacles until C02 compiles actors into the plant; readiness says so instead of a later failure
     if(project.value.faultSchedule?.length||scenario?.obstacles?.length)fixture.push('FAULT_SCHEDULE_UNSUPPORTED');
     try{if(scenario&&!resolveRoles(scenario,project.value).robots.every(r=>scene!.robots.some(x=>x.robotId===r.id)))fixture.push('SCENARIO_ROLE_UNBOUND');}catch(e){fixture.push((e as Error).message);}
    }
   }
  }catch{model.push('NAVIGATION_SCENE_UNREADABLE');}
  signal.throwIfAborted();
  const runner:string[]=[];
  const free=await statfs(o.directory).then(s=>s.bavail*s.bsize,()=>0);
  if(free<MIN_FREE_BYTES)runner.push('DISK_SPACE_LOW');
  // a full host is a blocked start, not a failure: the run that already holds a slot (context.runId, server-set) is never counted against itself
  if(!irsimCapacity(runtime.maxActiveRuns,context.runId))runner.push('IRSIM_CAPACITY');
  // a real process, the real scene: describe + create, then a clean stop. Success is cached briefly per scene and lock; a failure is never cached.
  if(scene&&!model.length&&!fixture.length&&!profile.length&&!runner.length&&!((smoked.get(scene.sceneDigest)??0)>Date.now())){
   const scratch=await mkdtemp(join(probeDir,'smoke-'));
   try{
    for(const [path,b] of files){await mkdir(dirname(join(scratch,'bundle',path)),{recursive:true});await writeFile(join(scratch,'bundle',path),b,{mode:0o600});}
    const w=await spawnIRSimWorker({python:runtime.python,workerRoot:runtime.workerRoot,runId:'irsim-smoke',bundleRoot:join(scratch,'bundle'),runDirectory:join(scratch,'run'),lockDigest:runtime.lockDigest,schemaDir:runtime.schemaDir,sceneDigest:scene.sceneDigest,...runtime.entry?{entry:runtime.entry}:{}});
    try{
     const ask=(op:'describe'|'create',payload:Record<string,unknown>,n:number)=>w.request({protocol:'mekoniq-irsim/1',requestId:`smoke-${n}`,runId:'irsim-smoke',expectedTick:0,op,payload} as never);
     const d=await ask('describe',{},1),c=await ask('create',{sceneRef:'navigation-scene.json',seed:1},2);
     if(!d.ok||!c.ok)runner.push(`IRSIM_SMOKE_FAILED:${(!d.ok?d:c as {error:{code:string}}).error.code}`);
     else smoked.set(scene.sceneDigest,Date.now()+SMOKE_TTL_MS);
    }catch(e){runner.push(`IRSIM_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'WORKER_FAILED'}`);}
    finally{await w.close('smoke done');}
   }catch(e){runner.push(`IRSIM_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'SPAWN_FAILED'}`);}
   finally{await rm(scratch,{recursive:true,force:true});}
  }else if(!scene)runner.push('IRSIM_SMOKE_NOT_RUN');
  else if(!(smoked.get(scene.sceneDigest)??0))runner.push('IRSIM_SMOKE_NOT_RUN');
  const evidence=`irsim:${described.packageVersion}/python-${described.pythonVersion}/lock:${runtime.lockDigest.slice(0,16)}`;
  return [row('profile',profile,evidence),row('model',model,scene?`navigation-scene:${scene.sceneDigest}`:null),row('fixture',fixture,scene?`world:${scene.world.id}:r${scene.world.revision}:${scene.world.hash}`:null),
   row('clock',[],'source_fixed_step:tick-ms-20'),row('runner',runner,scene?`irsim-smoke:${scene.sceneDigest}`:null)];
 };
}
