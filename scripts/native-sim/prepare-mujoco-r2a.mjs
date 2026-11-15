#!/usr/bin/env node
import {invokeCheckedProbe} from './probe-bootstrap.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const prepareR2aHandoff=options=>invokeCheckedProbe('prepare',options);
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){if(!['--runtime-cache','--lab','--out'].includes(args[i])||!args[i+1]||o[args[i]])throw Error('INVALID_ARGUMENT');o[args[i]]=resolve(args[i+1]);}if(Object.keys(o).length!==3)throw Error('MISSING_ARGUMENT');
  console.log(JSON.stringify(await prepareR2aHandoff({runtimeCache:o['--runtime-cache'],lab:o['--lab'],out:o['--out']})));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
