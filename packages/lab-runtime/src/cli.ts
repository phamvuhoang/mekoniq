#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {nativeRuntimeOptions,type NativeServerConfig} from './v2/sil/native-providers';
import {resolve} from 'node:path';
import {startLabGateway} from './gateway';
import {engineeringFromOptions} from './engineering/runtime-options';
import {portableSimulationFromOptions} from './v2/navigation2d/readiness';
import {webotsFromOptions} from './v2/simulation3d/readiness';
declare const __LAB_SOURCE_COMMIT__:string;
declare const __LAB_SCHEMA_HASH__:string;
const args=process.argv.slice(2);
if(args.includes('--help')){
 console.log('Dev-only business simulator: node runtime.mjs [--port 4176] [--data-dir ./runs] [--native-config /absolute/native.json] [--engineering-catalog DIR --engineering-simulation DIR [--engineering-python PATH] [--linkforge-python PATH --linkforge-worker DIR] [--irsim-python PATH --irsim-worker DIR [--irsim-lock FILE]]]\nDefault: offline mock providers. Opt-in native config connects simulation providers. MEKONIQ_LAB_LINKFORGE=1 / MEKONIQ_LAB_IRSIM=1 switch on shadow validation / the portable IR-SIM 2D provider (independent). Pairs one local browser session; never connects to robot hardware.');
}else{
 if(Number(process.versions.node.split('.')[0])!==24)throw new Error('NODE_24_REQUIRED');
 let port=4176,directory=resolve('runs'),nativeConfig:string|undefined;const engineeringFlags:{catalogRoot?:string;simulationRoot?:string;python?:string}={},linkforgeFlags:{python?:string;workerRoot?:string}={},irsimFlags:{python?:string;workerRoot?:string;lockPath?:string}={},webotsFlags:{python?:string;workerRoot?:string;lockPath?:string;home?:string}={};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--port'){port=Number(args[++i]);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('INVALID_PORT');}
  else if(args[i]==='--data-dir'){if(!args[i+1])throw new Error('DATA_DIRECTORY_REQUIRED');directory=resolve(args[++i]!);}
  else if(args[i]==='--native-config'){if(!args[i+1])throw new Error('NATIVE_CONFIG_REQUIRED');nativeConfig=resolve(args[++i]!);}
  else if(args[i]==='--engineering-catalog'){if(!args[i+1])throw new Error('ENGINEERING_CATALOG_REQUIRED');engineeringFlags.catalogRoot=resolve(args[++i]!);}
  else if(args[i]==='--engineering-simulation'){if(!args[i+1])throw new Error('ENGINEERING_SIMULATION_ROOT_REQUIRED');engineeringFlags.simulationRoot=resolve(args[++i]!);}
  else if(args[i]==='--engineering-python'){if(!args[i+1])throw new Error('ENGINEERING_PYTHON_REQUIRED');engineeringFlags.python=args[++i]!;}
  else if(args[i]==='--linkforge-python'){if(!args[i+1])throw new Error('LINKFORGE_PYTHON_REQUIRED');linkforgeFlags.python=args[++i]!;}
  else if(args[i]==='--linkforge-worker'){if(!args[i+1])throw new Error('LINKFORGE_WORKER_REQUIRED');linkforgeFlags.workerRoot=resolve(args[++i]!);}
  else if(args[i]==='--irsim-python'){if(!args[i+1])throw new Error('IRSIM_PYTHON_REQUIRED');irsimFlags.python=args[++i]!;}
  else if(args[i]==='--irsim-worker'){if(!args[i+1])throw new Error('IRSIM_WORKER_REQUIRED');irsimFlags.workerRoot=resolve(args[++i]!);}
  else if(args[i]==='--irsim-lock'){if(!args[i+1])throw new Error('IRSIM_LOCK_REQUIRED');irsimFlags.lockPath=resolve(args[++i]!);}
  else if(args[i]==='--webots-python'){if(!args[i+1])throw new Error('WEBOTS_PYTHON_REQUIRED');webotsFlags.python=args[++i]!;}
  else if(args[i]==='--webots-worker'){if(!args[i+1])throw new Error('WEBOTS_WORKER_REQUIRED');webotsFlags.workerRoot=resolve(args[++i]!);}
  else if(args[i]==='--webots-lock'){if(!args[i+1])throw new Error('WEBOTS_LOCK_REQUIRED');webotsFlags.lockPath=resolve(args[++i]!);}
  else if(args[i]==='--webots-home'){if(!args[i+1])throw new Error('WEBOTS_HOME_REQUIRED');webotsFlags.home=resolve(args[++i]!);}
  else throw new Error(`UNKNOWN_ARGUMENT:${args[i]}`);
 }
 // Native simulation is an explicit server-owned opt-in; the default stays offline/mock.
 const native=nativeConfig?await nativeRuntimeOptions(JSON.parse(await readFile(nativeConfig,'utf8')) as NativeServerConfig):undefined;
 // Engineering is an explicit opt-in too: no catalog and working compiler, no capability.
 // LinkForge shadow validation is a second, independent opt-in (MEKONIQ_LAB_LINKFORGE=1); without it validation reports `not_run`.
 const linkforge=process.env.MEKONIQ_LAB_LINKFORGE==='1'?{python:linkforgeFlags.python??'python3',workerRoot:linkforgeFlags.workerRoot??resolve('robotics/model-validation')}:undefined;
 // The portable IR-SIM provider is a third opt-in (MEKONIQ_LAB_IRSIM=1): it needs engineering bundles, never falls back to mock/native, and stays unavailable (with a code) when its worker does not start.
 const irsimOn=process.env.MEKONIQ_LAB_IRSIM==='1',irsim={python:irsimFlags.python??'python3',workerRoot:irsimFlags.workerRoot??resolve('robotics/navigation-2d')};
 const engineering=await engineeringFromOptions({directory,...engineeringFlags,linkforge,...irsimOn?{portable:irsim}:{}});
 const legacy=native??{enabledBackends:['mock_amr','mock_coffee','mock_arm']};
 // The Webots 3D provider is a fourth opt-in (MEKONIQ_LAB_WEBOTS=1): a host Webots R2025a (MEKONIQ_WEBOTS_HOME or --webots-home, default /Applications/Webots.app), engineering bundles, no fallback.
 const webotsOn=process.env.MEKONIQ_LAB_WEBOTS==='1',webotsRoot=webotsFlags.workerRoot??resolve('robotics/simulation-3d');
 const webots=webotsOn?await webotsFromOptions({enabled:!!engineering,python:webotsFlags.python??resolve('.venv-webots/bin/python'),workerRoot:webotsRoot,lockPath:webotsFlags.lockPath??resolve(webotsRoot,'requirements.lock'),webotsHome:webotsFlags.home??process.env.MEKONIQ_WEBOTS_HOME??'/Applications/Webots.app',directory,...engineering?{bundleFile:(d:string,p:string)=>engineering.bundleFile(d,p)}:{}}):undefined;
 if(webots&&!webots.plant)console.error(`Webots provider unavailable: ${webots.capability.reason}`);
 const portable=irsimOn||webotsOn?await portableSimulationFromOptions({enabled:irsimOn&&!!engineering,...irsim,lockPath:irsimFlags.lockPath??resolve(irsim.workerRoot,'requirements.lock'),directory,...native?{nativeFactory:native.simulationFactory,baseCatalog:native.catalog}:{},...engineering?{bundleFile:(d:string,p:string)=>engineering.bundleFile(d,p)}:{},...webots?{webots}:{}}):undefined;
 if(irsimOn&&portable?.unavailable)console.error(`IR-SIM provider unavailable: ${portable.catalog.backends.find(b=>b.id==='irsim_2d')?.reason}`);
 const v2=portable?{...legacy,catalog:portable.catalog,enabledBackends:[...legacy.enabledBackends,...portable.enabledBackends],simulationFactory:portable.simulationFactory,...portable.readinessChecks?{portableChecks:portable.readinessChecks}:{}}:legacy;
 const gateway=await startLabGateway({port,directory,sourceCommit:__LAB_SOURCE_COMMIT__,schemaHash:__LAB_SCHEMA_HASH__,v2:{...v2,...engineering?{engineering}:{}}});
 console.log(`Mekoniq Robot Lab business_sim\nGateway: ${gateway.url}\nPairing token (expires in 5 minutes; one use): ${gateway.pairingToken}\nSource: ${__LAB_SOURCE_COMMIT__}`);
 const close=()=>{void gateway.close().then(()=>process.exit(0),()=>process.exit(1));};
 process.once('SIGINT',close);process.once('SIGTERM',close);
}
