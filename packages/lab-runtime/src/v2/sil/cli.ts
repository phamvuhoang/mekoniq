import {nativeProviderFactory,doctorNativeArm,type NativeServerConfig} from './native-providers';
// tsx entry used by scripts/lab-sil.mjs: `preflight` (scenario/backend-set admission without effects) and `run` (one SIL run over the real
// worker). Arguments are a fixed schema; nothing here accepts a topic, endpoint or shell string.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {defaultCatalog} from '../capabilities';
import {scenarioRegistry} from '../scenario-registry';
import {requiredBackends} from '../scenario-matrix';
import type {FaultEntry} from '../backends/fault-schedule';
import {readCompiledWorld,startGazeboBackend} from '../backends/gazebo-nav2';
import {runSilScenario} from './campaign';
const FIXTURE:Record<string,{project:string;scenario:string|null}>={BV01:{project:'sil/bv01.json',scenario:'sil/bv01.json'},FD01:{project:'restaurant-v2.json',scenario:null},FD02:{project:'restaurant-v2.json',scenario:null},FD03:{project:'restaurant-v2.json',scenario:'scenarios/fd03-crossing.json'},
 FD04:{project:'restaurant-v2.json',scenario:'scenarios/fd04-blocked.json'},FD07:{project:'corridor-v2.json',scenario:'scenarios/fd07-corridor.json'}};
// FD08 (scenarios/fd08-localization.json) has no runner scenario in the registry yet: its SIL faults are exercised by the scene-loop/adapter tests only.
function args(argv:string[]){const o:Record<string,string>={};for(let i=0;i<argv.length;i++){const a=argv[i]!;if(!a.startsWith('--')||argv[i+1]===undefined||argv[i+1]!.startsWith('--'))throw new Error(`USAGE:${a}`);o[a.slice(2)]=argv[++i]!;}return o;}
export function preflight(scenarioId:string,backendSetId:string){
 const scenario=scenarioRegistry.get(scenarioId);
 if(!scenario)return {ok:false,reasons:['SCENARIO_UNSUPPORTED'],required:[] as string[]};
 const set=Object.hasOwn(defaultCatalog.sets,backendSetId)?defaultCatalog.sets[backendSetId]!:undefined;
 if(!set||set.mode!=='simulation')return {ok:false,reasons:['BACKEND_SET_UNKNOWN'],required:[] as string[]};
 const required=requiredBackends(scenario,'simulation');
 const missing=required.filter(b=>!set.backends.includes(b)||!['gazebo_nav2','coffee_io_sim','linuxcnc_sim'].includes(b));
 const fixture=FIXTURE[scenarioId]??null;
 if(scenario.coffee&&[...set.backends].sort().join()!==[...required].sort().join())return {ok:false,reasons:['BACKEND_SET_EXACT_MISMATCH'],required,scenarioRevision:scenario.revision,fixture};
 return {ok:!missing.length&&!!fixture,reasons:[...missing.length?[`BACKEND_MISSING:${missing.join(',')}`]:[],...fixture?[]:['SIL_FIXTURE_MISSING']],required,scenarioRevision:scenario.revision,fixture};
}
export async function runCli(argv:string[]){
 const [command,...rest]=argv,o=args(rest);
 if(command==='doctor-arm'){if(!o['native-config'])throw new Error('NATIVE_SERVER_CONFIG_REQUIRED');const result=await doctorNativeArm(JSON.parse(await readFile(resolve(o['native-config']),'utf8')) as NativeServerConfig);console.log(JSON.stringify(result));process.exit(result.prerequisitesMet?0:2);}
 if(command==='preflight'){const r=preflight(String(o.scenario),String(o['backend-set']??'simulation-default'));console.log(JSON.stringify(r));process.exit(r.ok?0:2);}
 if(command!=='run')throw new Error('USAGE:command');
 const pre=preflight(String(o.scenario),String(o['backend-set']??'simulation-default'));if(!pre.ok)throw new Error(pre.reasons.join(','));
 for(const k of ['fixture','bundle','out','seed','source-commit'])if(o[k]===undefined)throw new Error(`USAGE:--${k}`);
 const fixture=JSON.parse(await readFile(resolve(o.fixture!),'utf8')) as {project:unknown};
 const world=await readCompiledWorld(resolve(o.bundle!));
 // the scenario fixture (actors, blockers, faults) goes to the worker's scene loop; its fault schedule also drives the orchestrator-scoped faults
 const scenarioFile=o.scenario_file??(pre.fixture?.scenario?(pre.fixture.scenario===pre.fixture.project?resolve(o.fixture!):resolve(o.fixture!,'..',pre.fixture.scenario)):undefined);
 const faults=scenarioFile?((JSON.parse(await readFile(scenarioFile,'utf8')) as {faults?:FaultEntry[]}).faults??[]):[];
 const nativeConfig=o['native-config']?JSON.parse(await readFile(resolve(o['native-config']),'utf8')) as NativeServerConfig:null;
 const combined=pre.required.includes('linuxcnc_sim')&&pre.required.includes('coffee_io_sim');
 if(combined&&!nativeConfig)throw new Error('NATIVE_SERVER_CONFIG_REQUIRED');
 const nativeFactory=combined&&nativeConfig?await nativeProviderFactory({...nativeConfig,environmentProfile:o['environment-profile']??nativeConfig.environmentProfile,bundleDirectory:world.outputDirectory}):undefined;
 const result=await runSilScenario({nativeFactory,scenarioId:String(o.scenario),scenarioRevision:pre.scenarioRevision!,seed:Number(o.seed),project:fixture.project,sourceCommit:String(o['source-commit']),outDir:resolve(o.out!),world,backendSetId:String(o['backend-set']??'simulation-default'),
  maxIterations:Number(o['max-iterations']??90000),paceMs:Number(o['pace-ms']??20),faults,backendFactory:(w,runId)=>startGazeboBackend(w,runId,{python:o.python,environmentProfile:o['environment-profile'],...scenarioFile?{scenarioFile}:{}})});
 console.log(JSON.stringify({runId:result.manifest.runId,status:result.manifest.status,evidence:result.manifest.evidence,assertions:result.assertions}));
 process.exit(result.assertions.some(a=>a.result==='fail')?1:result.manifest.status==='completed'||result.manifest.status==='needs_attention'?0:1);
}
if(process.argv[1]&&/sil[\\/]cli\.ts$/.test(process.argv[1]))runCli(process.argv.slice(2)).catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exit(2);});
