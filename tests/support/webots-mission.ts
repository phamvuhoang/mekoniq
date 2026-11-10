// WB-FD01 / WB-FD07 through the real source domain on a compiled Webots bundle. The bundle comes from the engineering service (the TypeScript Webots compiler); the plant is
// the real Webots R2025a, or a double in tests/support/webots_doubles. Nothing here sets the production provider installed.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createEngineeringService,type EngineeringService,type LockedEngineering} from '../../packages/lab-runtime/src/engineering/gateway';
import {createWebotsCompiler} from '../../packages/lab-runtime/src/engineering/webots-compiler';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {defaultCatalog,type CapabilityCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {createFixedStepScenarioRun} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {webotsPlant,type WebotsRuntimeOptions} from '../../packages/lab-runtime/src/v2/simulation3d/webots';
import type {RunManifestInput,RunProviders,ScenarioRun,RunView} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {testCompiler,writeFixtureCatalog} from './engineering';
import {navigationFixture} from './navigation2d';

export const WEBOTS_HOME=process.env.MEKONIQ_WEBOTS_HOME??'/Applications/Webots.app',webotsPython=resolve('.venv-webots/bin/python'),webotsRoot=resolve('robotics/simulation-3d'),schemaDir=resolve('packages/contracts/schemas');
const exe=join(WEBOTS_HOME,'Contents','MacOS','webots');
export const webotsAvailable=existsSync(exe)&&existsSync(webotsPython)&&(()=>{try{return execFileSync(exe,['--version'],{encoding:'utf8',timeout:30_000}).includes('R2025a');}catch{return false;}})();
export const webotsDouble=(name:string)=>resolve('tests/support/webots_doubles',name);
export const temp=(p:string)=>mkdtemp(join(tmpdir(),p));
/** Webots processes started by a run: anchored at the start of the command line, so a shell that merely mentions them never matches. */
export const webotsProcesses=()=>{try{return execFileSync('pgrep',['-f','^[^ ]*/Contents/MacOS/webots |^[^ ]+ -I -B -X utf8 [^ ]*webots_worker/(supervisor|robot_controller)\\.py'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);}catch{return [];}};

const bundleDirs:string[]=[];
export const removeBundles=()=>Promise.all(bundleDirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));
/** Compiles the 3D fixture once through the engineering service and admits it for `owner`. */
export async function webotsBundle(name:'serve-3d'|'fleet-3d'='serve-3d',owner='owner'):Promise<{service:EngineeringService;locked:LockedEngineering}>{
 const f=navigationFixture(name).fixture,catalogRoot=await temp('webots-cat-'),engineering=await temp('webots-eng-');bundleDirs.push(catalogRoot,engineering);
 await writeFixtureCatalog(catalogRoot,f as never);
 const service=createEngineeringService({directory:engineering,catalogRoot,compiler:testCompiler,compilers:{'engineering-webots-3d-v1':createWebotsCompiler()}});
 const receipt=await service.compileEngineeringProject(f.project,owner);
 if(receipt.state!=='compiled')throw new Error(`WEBOTS_BUNDLE_NOT_COMPILED ${JSON.stringify(receipt.problems)}`);
 return {service,locked:await service.admitRun(owner,{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-webots-3d-v1',undefined)};
}
/** The catalog with webots_3d marked usable: test wiring only (the production readiness decides this from a real describe and smoke). */
export const webotsCatalog=():CapabilityCatalog=>({...defaultCatalog,backends:defaultCatalog.backends.map(b=>{if(b.id!=='webots_3d')return b;const {reason:_r,...rest}=b;void _r;return {...rest,installed:true,compatible:true,reachable:true};})});
let sha:string|undefined;
const executableSha=()=>sha??=createHash('sha256').update(readFileSync(exe)).digest('hex');
export const webotsInput=(locked:LockedEngineering,seed=5,scenarioId='WB-FD01'):RunManifestInput=>({project:locked.runtimeProjection.project,scenarioId,scenarioRevision:1,seed,mode:'simulation',access:'simulated',backendSetId:'engineering-webots-3d-v1',sourceCommit:'test-commit',engineering:locked});
export async function webotsProviders(directory:string,service:EngineeringService,over:{entry?:string[];deadlinesMs?:Record<string,number>;evidence?:WebotsRuntimeOptions['evidence']}={}):Promise<RunProviders&{plant:ReturnType<typeof webotsPlant>;runtime:WebotsRuntimeOptions}>{
 const runtime:WebotsRuntimeOptions={python:webotsPython,workerRoot:webotsRoot,schemaDir,lockDigest:await lockDigestOf(join(webotsRoot,'requirements.lock')),webotsHome:WEBOTS_HOME,executableSha256:over.entry?'a'.repeat(64):executableSha(),basicTimeStepMs:20,maxActiveRuns:1,...over};
 return {directory,catalog:webotsCatalog(),enabledBackends:['webots_3d'],bundleFile:(d,p)=>service.bundleFile(d,p),plant:webotsPlant(runtime),runtime};
}
export async function openWebotsRun(directory:string,b:Awaited<ReturnType<typeof webotsBundle>>,over:Parameters<typeof webotsProviders>[2]={},seed=5,scenarioId='WB-FD01'){return createFixedStepScenarioRun(webotsInput(b.locked,seed,scenarioId),await webotsProviders(directory,b.service,over));}
let n=0;
export async function act(run:ScenarioRun,kind:string,payload:Record<string,unknown>={}){const v=await run.snapshot();return run.action({actionId:`webots-${++n}`,expectedRevision:v.run.runRevision,kind,payload});}
/** Step until the run leaves running/awaiting_confirmation or reaches `limit` ticks. A step that advances neither tick nor status is a stall and fails at once. */
export async function finish(run:ScenarioRun,ticks=500,limit=30000){
 let v=await run.snapshot();
 while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<limit){const next=await act(run,'step',{ticks});if(next.tick===v.tick&&next.run.status===v.run.status)throw new Error(`RUN_STALLED at tick ${v.tick}: ${v.run.status} ${JSON.stringify(next.attention??null)}`);v=next;}
 return v;
}
export async function stepUntil(run:ScenarioRun,until:(v:RunView)=>boolean|Promise<boolean>,chunk=25,limit=30000){
 let v=await run.snapshot();
 while(!await until(v)){if(v.tick>=limit)throw new Error(`STEP_LIMIT at ${v.tick}: ${v.run.status}`);if(['completed','cancelled','needs_attention'].includes(v.run.status))throw new Error(`RUN_ENDED ${v.run.status} ${JSON.stringify(v.attention)}`);v=await act(run,'step',{ticks:chunk});}
 return v;
}
