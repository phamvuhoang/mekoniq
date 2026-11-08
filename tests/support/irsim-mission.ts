// IR-FD01 runs through the real source domain on a compiled portable bundle. The bundle comes from the engineering service (portable compiler, real IR-SIM venv);
// the worker is the real one, or the logging/crashing double in tests/support/irsim_doubles. Nothing here sets a production provider installed.
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createEngineeringService,type EngineeringService,type LockedEngineering} from '../../packages/lab-runtime/src/engineering/gateway';
import {createNavigationCompiler} from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {createIRSimScenarioRun,type IRSimRunProviders} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {portableCatalog} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import type {RunManifestInput,ScenarioRun,RunView} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {testCompiler,writeFixtureCatalog} from './engineering';
import {navigationFixture,type NavigationFixtureName} from './navigation2d';

export const irPython=resolve('.venv-irsim/bin/python'),workerRoot=resolve('robotics/navigation-2d'),schemaDir=resolve('packages/contracts/schemas');
export const irsimAvailable=existsSync(irPython)&&(()=>{try{execFileSync(irPython,['-c','import irsim, yaml, rfc8785, jsonschema, referencing'],{stdio:'ignore'});return true;}catch{return false;}})();
export const double=(name:string)=>resolve('tests/support/irsim_doubles',name);
export const temp=(p:string)=>mkdtemp(join(tmpdir(),p));

/** Compiles the fixture once through the engineering service and admits it for `owner` (the gateway's admitRun: projections come from the bundle). */
export async function irsimBundle(name:NavigationFixtureName='serve',owner='owner'):Promise<{service:EngineeringService;locked:LockedEngineering}>{
 const f=navigationFixture(name).fixture,catalogRoot=await temp('irsim-cat-');
 await writeFixtureCatalog(catalogRoot,f as never);
 const service=createEngineeringService({directory:await temp('irsim-eng-'),catalogRoot,compiler:testCompiler,compilers:{'engineering-irsim-2d-v1':createNavigationCompiler({python:irPython,workerRoot,descriptionHelperRoot:resolve('robotics/simulation')})}});
 const receipt=await service.compileEngineeringProject(f.project,owner);
 if(receipt.state!=='compiled')throw new Error(`IRSIM_BUNDLE_NOT_COMPILED ${JSON.stringify(receipt.problems)}`);
 return {service,locked:await service.admitRun(owner,{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-irsim-2d-v1',undefined)};
}
export const irsimInput=(locked:LockedEngineering,seed=5):RunManifestInput=>({project:locked.runtimeProjection.project,scenarioId:'IR-FD01',scenarioRevision:1,seed,mode:'simulation',access:'simulated',backendSetId:'engineering-irsim-2d-v1',sourceCommit:'test-commit',engineering:locked});
/** Test wiring only: the catalog marks irsim_2d usable because this test provisions the venv itself. */
export async function irsimProviders(directory:string,service:EngineeringService,over:{entry?:string[];deadlinesMs?:Record<string,number>}={}):Promise<IRSimRunProviders>{
 return {directory,catalog:portableCatalog(true),enabledBackends:['irsim_2d'],bundleFile:(d,p)=>service.bundleFile(d,p),
  irsim:{python:irPython,workerRoot,schemaDir,lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),...over}};
}
let n=0;
export async function act(run:ScenarioRun,kind:string,payload:Record<string,unknown>={}){const v=await run.snapshot();return run.action({actionId:`irsim-${++n}`,expectedRevision:v.run.runRevision,kind,payload});}
export async function openRun(directory:string,b:Awaited<ReturnType<typeof irsimBundle>>,over:Parameters<typeof irsimProviders>[2]={},seed=5){return createIRSimScenarioRun(irsimInput(b.locked,seed),await irsimProviders(directory,b.service,over));}
export async function stepUntil(run:ScenarioRun,until:(v:RunView)=>boolean|Promise<boolean>,chunk=25,limit=30000){
 let v=await run.snapshot();
 while(!await until(v)){if(v.tick>=limit)throw new Error(`STEP_LIMIT at ${v.tick}: ${v.run.status}`);if(['completed','cancelled','needs_attention'].includes(v.run.status))throw new Error(`RUN_ENDED ${v.run.status} ${JSON.stringify(v.attention)}`);v=await act(run,'step',{ticks:chunk});}
 return v;
}
/** The logging double's record of every request it handled and the robots it reported (no LiDAR ranges). */
export const workerLog=(directory:string)=>{const p=join(directory,'worker','worker-log.ndjson');return existsSync(p)?readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l) as {op:string;requestId:string;payload:Record<string,unknown>;ok:boolean;tick:number;robots:{robotId:string;poseDriveMap:number[];bodyVelocity:number[]}[]}):[];};
export const EPOCH_MS=Date.parse('2026-11-01T00:00:00Z');
export const tickOf=(at:string)=>(Date.parse(at)-EPOCH_MS)/20;
