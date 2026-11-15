#!/usr/bin/env node
// Supported entrypoints use a fresh module graph, independent of the importing recorder's cache.
import {invokeCheckedProbe} from './probe-bootstrap.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const runMujocoProbe=options=>invokeCheckedProbe('run',options,options.signal);
export const verifyMujocoProbe=root=>invokeCheckedProbe('verify',{root});
export const readMujocoProbeSupplement=root=>invokeCheckedProbe('read',{root});
export const copyMujocoProbeSupplement=(input,out)=>invokeCheckedProbe('copy',{input,out});
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){if(!['--handoff','--out','--verify'].includes(args[i])||!args[i+1]||o[args[i]])throw Error('INVALID_ARGUMENT');o[args[i]]=resolve(args[i+1]);}
  if(o['--verify']?Object.keys(o).length!==1:!o['--handoff']||!o['--out'])throw Error('MISSING_ARGUMENT');
  const abort=new globalThis.AbortController();for(const s of ['SIGINT','SIGTERM','SIGHUP','SIGALRM'])process.once(s,()=>abort.abort());
  const result=o['--verify']?await verifyMujocoProbe(o['--verify']):await runMujocoProbe({handoff:o['--handoff'],out:o['--out'],signal:abort.signal});
  console.log(JSON.stringify(result,null,2));process.exitCode=o['--verify']?(result.passed?0:1):result.DEP_MJ_01==='passed'?0:2;
 }catch(e){console.error(JSON.stringify({error:e.message,accepted:false,qualification:'not_run'}));process.exitCode=1;}
}
