// Portable IR-SIM provider: operator opt-in (MEKONIQ_LAB_IRSIM=1, independent of the LinkForge flag), a real worker describe at boot, and per-request readiness
// from the admitted bundle plus a real create smoke. Nothing here falls back to mock or native providers; test doubles never make this provider installed.
import {mkdir,mkdtemp,rm,statfs,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {defaultCatalog,type CapabilityCatalog} from '../capabilities';
import type {NativeReadinessChecks,ReadinessCheck} from '../readiness';
import type {BackendCapability} from '../capabilities';
import {createScenarioRun,type RunManifestInput,type RunProviders,type ScenarioRun} from '../scenario-runner';
import {scenarioRegistry,resolveRoles} from '../scenario-registry';
import {validateProjectV2,type LabProjectV2} from '../contracts';
import {hashJson} from '../hash';
import {lockDigestOf} from '../../engineering/linkforge';
import {validateNavigationDocument,type NavigationSceneV1} from './contracts';
import {spawnIRSimWorker,WorkerLostError} from './worker-client';
import {IRSIM_AMR} from './adapter';
import {resolveScenarioFixture} from './scenario-fixtures';
import {createFixedStepScenarioRun,irsimCapacity,IRSIM_BACKEND,type IRSimRuntimeOptions} from './runner';
import {irsimPlant,type PlantPort} from './plant';
import {webotsArmPorts} from '../simulation3d/arm-ports';
import type {WebotsRuntimeOptions} from '../simulation3d/webots';

/** The server catalog with irsim_2d marked usable (`usable`) or left unconfigured. Production code sets it usable only after a real worker describe. */
export const portableCatalog=(usable:boolean,base:CapabilityCatalog=defaultCatalog,reason?:string):CapabilityCatalog=>({...base,backends:base.backends.map(b=>{
 if(b.id!==IRSIM_BACKEND)return b;
 const {reason:_old,...rest}=b;void _old;
 return usable?{...rest,installed:true,compatible:true,reachable:true}:{...rest,installed:false,compatible:false,reachable:false,reason:reason??b.reason??'IRSIM_DISABLED'};
})});
export type SimulationFactory=(input:RunManifestInput,providers:RunProviders)=>Promise<ScenarioRun>;
/** Operator options only (CLI flags/env), never request fields. `nativeFactory` keeps native simulation exactly as configured. */
/** The Webots 3D provider next to IR-SIM (simulation3d/readiness.ts); it has its own opt-in and never makes IR-SIM usable or the other way round. */
export interface WebotsProviderLike {plant?:{port:PlantPort;runtime:IRSimRuntimeOptions};capability:BackendCapability;readinessChecks?:NativeReadinessChecks;
 /** The Webots arm (R1.1): the same engine and flag, its own backend id, capability and readiness. */
 arm?:{runtime?:WebotsRuntimeOptions;capability:BackendCapability;readinessChecks?:NativeReadinessChecks}}
export interface PortableSimulationOptions {enabled:boolean;python:string;workerRoot:string;lockPath:string;directory:string;nativeFactory?:SimulationFactory;
 /** Catalog to extend (the native one when native is configured). */baseCatalog?:CapabilityCatalog;
 /** Admitted-bundle reader (the engineering service), for readiness. */bundleFile?:(bundleDigest:string,path:string)=>Promise<Uint8Array>;
 schemaDir?:string;
 /** Test/fault option: the worker entry (a double). Never exposed through a request. */entry?:string[];
 /** Live IR-SIM workers allowed on this host at once (default 2, workers-runtime §6). */maxActiveRuns?:number;
 webots?:WebotsProviderLike;}
export interface PortableSimulation {plants?:PlantTable;catalog:CapabilityCatalog;enabledBackends:string[];simulationFactory:SimulationFactory;readinessChecks?:NativeReadinessChecks;unavailable?:string;describe?:{packageVersion:string;pythonVersion:string;lockDigest:string}}
const MIN_FREE_BYTES=2*100*1024*1024; // two active runs at the 100 MiB evidence quota
const SMOKE_TTL_MS=60_000;
const sha256=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');

/** The live plants of this host by provider id (`set.providers.amr`), each with the operator options of its worker. */
export type PlantTable=Readonly<Record<string,{port:PlantPort;runtime:IRSimRuntimeOptions}>>;
/** Factory dispatch by backend set: a portable set goes to the shared runner with the plant its AMR provider names (only when that plant is live), native simulation sets to the native factory, anything else refused. */
/** The live Webots arm of this host (`set.providers.arm`): its runtime options; the run builds its own ports from the manifest's project and seed. */
export type ArmPlantTable=Readonly<Record<string,{runtime:WebotsRuntimeOptions}>>;
export function plantDispatcher(catalog:CapabilityCatalog,plants:PlantTable|undefined,nativeFactory?:SimulationFactory,arms?:ArmPlantTable):SimulationFactory{
 return async(input,providers)=>{
  const set=Object.hasOwn(catalog.sets,input.backendSetId)?catalog.sets[input.backendSetId]:undefined;
  if(!set)throw new Error('BACKEND_SET_UNKNOWN');
  if(set.execution?.host==='portable_python'&&set.providers?.arm===WEBOTS_ARM_ID){
   const live=arms&&Object.hasOwn(arms,WEBOTS_ARM_ID)?arms[WEBOTS_ARM_ID]:undefined;
   if(!live)throw new Error('BACKEND_EXECUTION_DISABLED');
   // the AMR and the coffee machine stay mocks; only the arm is the plant, and its ports need the run's own project and seed
   return createScenarioRun(input,{...providers,coffeePorts:webotsArmPorts(live.runtime,{project:input.project as LabProjectV2,seed:input.seed})});
  }
  if(set.execution?.host==='portable_python'){
   const live=set.providers?.amr!==undefined&&plants&&Object.hasOwn(plants,set.providers.amr)?plants[set.providers.amr]:undefined;
   if(!live)throw new Error('BACKEND_EXECUTION_DISABLED');
   return createFixedStepScenarioRun(input,{...providers,plant:live.port,runtime:live.runtime});
  }
  if(set.mode==='simulation'&&nativeFactory)return nativeFactory(input,providers);
  throw new Error('BACKEND_EXECUTION_DISABLED');
 };
}

const WEBOTS_ID='webots_3d',WEBOTS_ARM_ID='webots_arm';
/** IR-SIM (when enabled) plus Webots (when its provider is live): one catalog, one dispatcher over the live plants, readiness chosen by the set's AMR provider. */
export async function portableSimulationFromOptions(o:PortableSimulationOptions):Promise<PortableSimulation>{
 const base=await irsimPortable(o),w=o.webots;
 if(!w)return base;
 const catalog:CapabilityCatalog={...base.catalog,backends:base.catalog.backends.map(b=>b.id===WEBOTS_ID?w.capability:b.id===WEBOTS_ARM_ID&&w.arm?w.arm.capability:b)};
 const plants:PlantTable={...base.plants,...w.plant?{[WEBOTS_ID]:w.plant}:{}},live=!!w.plant&&w.capability.installed;
 const armLive=!!w.arm?.runtime&&w.arm.capability.installed,arms:ArmPlantTable=armLive?{[WEBOTS_ARM_ID]:{runtime:w.arm!.runtime!}}:{};
 const ir=base.readinessChecks,wb=w.readinessChecks,wa=w.arm?.readinessChecks;
 const readinessChecks:NativeReadinessChecks|undefined=ir||wb||wa?async(context,signal)=>{
  const providers=Object.hasOwn(catalog.sets,context.backendSetId)?catalog.sets[context.backendSetId]!.providers:undefined,pick=providers?.arm===WEBOTS_ARM_ID?wa:providers?.amr===WEBOTS_ID?wb:ir;
  if(!pick)throw new Error('PORTABLE_PROVIDER_UNAVAILABLE');
  return pick(context,signal);
 }:undefined;
 return {...base,catalog,enabledBackends:[...base.enabledBackends,...live?[WEBOTS_ID]:[],...armLive?[WEBOTS_ARM_ID]:[]],plants,simulationFactory:plantDispatcher(catalog,plants,o.nativeFactory,arms),...readinessChecks?{readinessChecks}:{}};
}

async function irsimPortable(o:PortableSimulationOptions):Promise<PortableSimulation>{
 const base=o.baseCatalog??defaultCatalog,off=(reason:string):PortableSimulation=>{const catalog=portableCatalog(false,base,reason);return {catalog,enabledBackends:[],simulationFactory:plantDispatcher(catalog,undefined,o.nativeFactory),plants:{},unavailable:reason.split(':')[0]!};};
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
 const plants:PlantTable={[IRSIM_BACKEND]:{port:irsimPlant(),runtime}};
 return {catalog,enabledBackends:[IRSIM_BACKEND],plants,simulationFactory:plantDispatcher(catalog,plants,o.nativeFactory),describe,readinessChecks:portableReadiness(runtime,describe,o,probeDir)};
}

/** What differs between the plants' per-request readiness: the reason-code prefix, the engine the admitted scene must name, the worker slots and a real create smoke on the admitted scene. */
/** Runs `close` when `signal` aborts (at once if it already has); the returned function detaches the listener. */
export function closeOnAbort(signal:AbortSignal,close:()=>unknown):()=>void{
 const run=()=>{try{void Promise.resolve(close()).catch(()=>{});}catch{/* closing is best effort */}};
 if(signal.aborted){run();return()=>{};}
 signal.addEventListener('abort',run,{once:true});return()=>signal.removeEventListener('abort',run);
}
/** One smoke at a time per gate: a second caller gets null (and starts nothing) until the first has ended, whether it returned or threw. */
export async function exclusiveSmoke(gate:{busy:boolean},run:()=>Promise<string[]>):Promise<string[]|null>{
 if(gate.busy)return null;gate.busy=true;
 try{return await run();}finally{gate.busy=false;}
}
export interface ProviderReadinessSpec {
 prefix:string;engineId:string;runtime:IRSimRuntimeOptions;lockPath:string;directory:string;probeDir:string;evidence:string;
 bundleFile?:PortableSimulationOptions['bundleFile'];
 capacity:(runId?:string)=>boolean;
 /** Only one smoke at a time (a Webots start is one world per host): a concurrent request is blocked with `<PREFIX>_SMOKE_BUSY`. */
 exclusive?:boolean;
 /** The gate that `exclusive` uses; plants that share one engine pass the same object. */
 gate?:{busy:boolean};
 /** A real worker, the real scene: create, then a clean stop. Resolves to reason codes, [] when it worked. */
 smoke:(scene:NavigationSceneV1,bundleRoot:string,runDirectory:string,signal:AbortSignal)=>Promise<string[]>;
}
/** Per-request readiness: versions/lock, the admitted bundle's scene against the world and scenario, quota/free disk, and a real worker create smoke (cached per scene). */
export function providerReadiness(spec:ProviderReadinessSpec):NativeReadinessChecks{
 const smoked=new Map<string,number>(),gate=spec.gate??{busy:false},P=spec.prefix,lower=P.toLowerCase();
 return async(context,signal)=>{
  const row=(id:string,reasonCodes:string[],evidenceRef:string|null=null,status:ReadinessCheck['status']='blocked'):ReadinessCheck=>({id,status:reasonCodes.length?status:'ready',reasonCodes,evidenceRef});
  const profile:string[]=[];
  if(await lockDigestOf(spec.lockPath).catch(()=>null)!==spec.runtime.lockDigest)profile.push(`${P}_LOCK_CHANGED`);
  const scenario=scenarioRegistry.get(context.scenarioId);
  let scene:NavigationSceneV1|undefined,files:[string,Uint8Array][]=[];const model:string[]=[],fixture:string[]=[];
  if(!context.engineering||!spec.bundleFile)model.push('ENGINEERING_REF_REQUIRED');
  else try{
   const bytes=await spec.bundleFile(context.engineering.bundleDigest,'navigation-scene.json'),doc=JSON.parse(Buffer.from(bytes).toString('utf8'));
   const checked=validateNavigationDocument(doc);
   if(!checked.ok||checked.value.documentType!=='navigation-scene')model.push(...new Set(checked.ok?['NAVIGATION_SCENE_INVALID']:checked.issues.map(i=>i.code)));
   else{
    scene=checked.value as NavigationSceneV1;files=[['navigation-scene.json',bytes]];
    if(scene.engine.id!==spec.engineId)model.push('NAVIGATION_SCENE_ENGINE_MISMATCH');
    if(scene.inputs.project.digest!==context.engineering.projectDigest)model.push('ENGINEERING_IDENTITY_MISMATCH');
    if(scene.robots.some(r=>r.model.sensors.length===0))model.push('SENSOR_MISSING');
    for(const f of scene.files){const b=await spec.bundleFile(context.engineering.bundleDigest,f.path).catch(()=>null);if(!b||sha256(b)!==f.sha256)fixture.push(`ENGINEERING_CLOSURE_MISSING:${f.path}`);else files.push([f.path,b]);}
    const project=validateProjectV2(context.project);
    if(!project.ok)fixture.push('PROJECT_INVALID');
    else{
     if(scene.world.hash!==hashJson(project.value.world))fixture.push('SCENE_WORLD_MISMATCH');
     // ponytail: the runner refuses scheduled faults/obstacles until C02 compiles actors into the plant; readiness says so instead of a later failure
     if(project.value.faultSchedule?.length||scenario?.obstacles?.length)fixture.push('FAULT_SCHEDULE_UNSUPPORTED');
     try{if(scenario&&!resolveRoles(scenario,project.value).robots.every(r=>scene!.robots.some(x=>x.robotId===r.id)))fixture.push('SCENARIO_ROLE_UNBOUND');}catch(e){fixture.push((e as Error).message);}
     // the scenario's actors and zones must fit this scene exactly as the runner will lay them (the seed only moves a start tick, never validity)
     try{if(scenario)resolveScenarioFixture(scenario.id,scene,0);}catch(e){fixture.push((e as Error).message.split(':').slice(0,2).join(':'));}
    }
   }
  }catch{model.push('NAVIGATION_SCENE_UNREADABLE');}
  signal.throwIfAborted();
  const runner:string[]=[];
  const free=await statfs(spec.directory).then(s=>s.bavail*s.bsize,()=>0);
  if(free<MIN_FREE_BYTES)runner.push('DISK_SPACE_LOW');
  // a full host is a blocked start, not a failure: the run that already holds a slot (context.runId, server-set) is never counted against itself
  if(!spec.capacity(context.runId))runner.push(`${P}_CAPACITY`);
  // a real process, the real scene. Success is cached briefly per scene and lock; a failure is never cached.
  if(scene&&!model.length&&!fixture.length&&!profile.length&&!runner.length&&!((smoked.get(scene.sceneDigest)??0)>Date.now())){
   const scratch=await mkdtemp(join(spec.probeDir,'smoke-'));
   try{
    for(const [path,b] of files){await mkdir(dirname(join(scratch,'bundle',path)),{recursive:true});await writeFile(join(scratch,'bundle',path),b,{mode:0o600});}
    const failed=spec.exclusive?await exclusiveSmoke(gate,()=>spec.smoke(scene,join(scratch,'bundle'),join(scratch,'run'),signal)):await spec.smoke(scene,join(scratch,'bundle'),join(scratch,'run'),signal);
    if(failed===null)runner.push(`${P}_SMOKE_BUSY`);else if(failed.length)runner.push(...failed);else smoked.set(scene.sceneDigest,Date.now()+SMOKE_TTL_MS);
   }catch(e){runner.push(`${P}_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'SPAWN_FAILED'}`);}
   finally{await rm(scratch,{recursive:true,force:true});}
  }else if(!scene)runner.push(`${P}_SMOKE_NOT_RUN`);
  else if(!(smoked.get(scene.sceneDigest)??0))runner.push(`${P}_SMOKE_NOT_RUN`);
  return [row('profile',profile,spec.evidence),row('model',model,scene?`navigation-scene:${scene.sceneDigest}`:null),row('fixture',fixture,scene?`world:${scene.world.id}:r${scene.world.revision}:${scene.world.hash}`:null),
   row('clock',[],'source_fixed_step:tick-ms-20'),row('runner',runner,scene?`${lower}-smoke:${scene.sceneDigest}`:null)];
 };
}

function portableReadiness(runtime:IRSimRuntimeOptions,described:NonNullable<PortableSimulation['describe']>,o:PortableSimulationOptions,probeDir:string):NativeReadinessChecks{
 return providerReadiness({prefix:'IRSIM',engineId:'irsim_2d',runtime,lockPath:o.lockPath,directory:o.directory,probeDir,bundleFile:o.bundleFile,
  evidence:`irsim:${described.packageVersion}/python-${described.pythonVersion}/lock:${runtime.lockDigest.slice(0,16)}`,capacity:runId=>irsimCapacity(runtime.maxActiveRuns,runId),
  async smoke(scene,bundleRoot,runDirectory,signal){
   try{
    const w=await spawnIRSimWorker({python:runtime.python,workerRoot:runtime.workerRoot,runId:'irsim-smoke',bundleRoot,runDirectory,lockDigest:runtime.lockDigest,schemaDir:runtime.schemaDir,sceneDigest:scene.sceneDigest,...runtime.entry?{entry:runtime.entry}:{}});
    const detach=closeOnAbort(signal,()=>w.close('readiness timeout'));
    try{
     const ask=(op:'describe'|'create',payload:Record<string,unknown>,n:number)=>w.request({protocol:'mekoniq-irsim/1',requestId:`smoke-${n}`,runId:'irsim-smoke',expectedTick:0,op,payload});
     const d=await ask('describe',{},1),c=await ask('create',{sceneRef:'navigation-scene.json',seed:1},2);
     return !d.ok||!c.ok?[`IRSIM_SMOKE_FAILED:${(!d.ok?d:c as {error:{code:string}}).error.code}`]:[];
    }catch(e){return [`IRSIM_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'WORKER_FAILED'}`];}
    finally{detach();await w.close('smoke done');}
   }catch(e){return [`IRSIM_SMOKE_FAILED:${e instanceof WorkerLostError?e.code:'SPAWN_FAILED'}`];}
  }});
}
