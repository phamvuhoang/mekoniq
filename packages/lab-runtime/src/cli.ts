#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {nativeRuntimeOptions,type NativeServerConfig} from './v2/sil/native-providers';
import {resolve} from 'node:path';
import {startLabGateway} from './gateway';
import {engineeringFromOptions} from './engineering/runtime-options';
declare const __LAB_SOURCE_COMMIT__:string;
declare const __LAB_SCHEMA_HASH__:string;
const args=process.argv.slice(2);
if(args.includes('--help')){
 console.log('Dev-only business simulator: node runtime.mjs [--port 4176] [--data-dir ./runs] [--native-config /absolute/native.json] [--engineering-catalog DIR --engineering-simulation DIR [--engineering-python PATH] [--linkforge-python PATH --linkforge-worker DIR]]\nDefault: offline mock providers. Opt-in native config connects simulation providers. Pairs one local browser session; never connects to robot hardware.');
}else{
 if(Number(process.versions.node.split('.')[0])!==24)throw new Error('NODE_24_REQUIRED');
 let port=4176,directory=resolve('runs'),nativeConfig:string|undefined;const engineeringFlags:{catalogRoot?:string;simulationRoot?:string;python?:string}={},linkforgeFlags:{python?:string;workerRoot?:string}={};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--port'){port=Number(args[++i]);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('INVALID_PORT');}
  else if(args[i]==='--data-dir'){if(!args[i+1])throw new Error('DATA_DIRECTORY_REQUIRED');directory=resolve(args[++i]!);}
  else if(args[i]==='--native-config'){if(!args[i+1])throw new Error('NATIVE_CONFIG_REQUIRED');nativeConfig=resolve(args[++i]!);}
  else if(args[i]==='--engineering-catalog'){if(!args[i+1])throw new Error('ENGINEERING_CATALOG_REQUIRED');engineeringFlags.catalogRoot=resolve(args[++i]!);}
  else if(args[i]==='--engineering-simulation'){if(!args[i+1])throw new Error('ENGINEERING_SIMULATION_ROOT_REQUIRED');engineeringFlags.simulationRoot=resolve(args[++i]!);}
  else if(args[i]==='--engineering-python'){if(!args[i+1])throw new Error('ENGINEERING_PYTHON_REQUIRED');engineeringFlags.python=args[++i]!;}
  else if(args[i]==='--linkforge-python'){if(!args[i+1])throw new Error('LINKFORGE_PYTHON_REQUIRED');linkforgeFlags.python=args[++i]!;}
  else if(args[i]==='--linkforge-worker'){if(!args[i+1])throw new Error('LINKFORGE_WORKER_REQUIRED');linkforgeFlags.workerRoot=resolve(args[++i]!);}
  else throw new Error(`UNKNOWN_ARGUMENT:${args[i]}`);
 }
 // Native simulation is an explicit server-owned opt-in; the default stays offline/mock.
 const native=nativeConfig?await nativeRuntimeOptions(JSON.parse(await readFile(nativeConfig,'utf8')) as NativeServerConfig):undefined;
 // Engineering is an explicit opt-in too: no catalog and working compiler, no capability.
 // LinkForge shadow validation is a second, independent opt-in (MEKONIQ_LAB_LINKFORGE=1); without it validation reports `not_run`.
 const linkforge=process.env.MEKONIQ_LAB_LINKFORGE==='1'?{python:linkforgeFlags.python??'python3',workerRoot:linkforgeFlags.workerRoot??resolve('robotics/model-validation')}:undefined;
 const engineering=await engineeringFromOptions({directory,...engineeringFlags,linkforge});
 const gateway=await startLabGateway({port,directory,sourceCommit:__LAB_SOURCE_COMMIT__,schemaHash:__LAB_SCHEMA_HASH__,v2:{...native??{enabledBackends:['mock_amr','mock_coffee','mock_arm']},...engineering?{engineering}:{}}});
 console.log(`Mekoniq Robot Lab business_sim\nGateway: ${gateway.url}\nPairing token (expires in 5 minutes; one use): ${gateway.pairingToken}\nSource: ${__LAB_SOURCE_COMMIT__}`);
 const close=()=>{void gateway.close().then(()=>process.exit(0),()=>process.exit(1));};
 process.once('SIGINT',close);process.once('SIGTERM',close);
}
