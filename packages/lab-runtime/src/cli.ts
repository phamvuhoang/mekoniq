#!/usr/bin/env node
import {resolve} from 'node:path';
import {startLabGateway} from './gateway';
declare const __LAB_SOURCE_COMMIT__:string;
declare const __LAB_SCHEMA_HASH__:string;
const args=process.argv.slice(2);
if(args.includes('--help')){
 console.log('Dev-only business simulator: node runtime.mjs [--port 4176] [--data-dir ./runs]\nPairs one local browser session; never connects to robot hardware.');
}else{
 if(Number(process.versions.node.split('.')[0])!==24)throw new Error('NODE_24_REQUIRED');
 let port=4176,directory=resolve('runs');
 for(let i=0;i<args.length;i++){
  if(args[i]==='--port'){port=Number(args[++i]);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('INVALID_PORT');}
  else if(args[i]==='--data-dir'){if(!args[i+1])throw new Error('DATA_DIRECTORY_REQUIRED');directory=resolve(args[++i]!);}
  else throw new Error(`UNKNOWN_ARGUMENT:${args[i]}`);
 }
 const gateway=await startLabGateway({port,directory,sourceCommit:__LAB_SOURCE_COMMIT__,schemaHash:__LAB_SCHEMA_HASH__});
 console.log(`Mekoniq Robot Lab business_sim\nGateway: ${gateway.url}\nPairing token (expires in 5 minutes; one use): ${gateway.pairingToken}\nSource: ${__LAB_SOURCE_COMMIT__}`);
 const close=()=>{void gateway.close().then(()=>process.exit(0),()=>process.exit(1));};
 process.once('SIGINT',close);process.once('SIGTERM',close);
}
