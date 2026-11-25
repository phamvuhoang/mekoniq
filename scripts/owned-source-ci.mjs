#!/usr/bin/env node
// Final prerequisite stage only: creates/stops its own fresh namespace. Never reset/migrate the developer Supabase project.
import {mkdtemp,cp,readFile,writeFile,mkdir,open,rename} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {randomBytes} from 'node:crypto';import {createServer} from 'node:net';import {spawn} from 'node:child_process';import {ownedCiConfig} from './owned-ci-config.mjs';import {requireUnpublishedCiPorts} from './owned-ci-ports.mjs';
const args=process.argv.slice(2);if(args[0]!=='--'||args.length<2)throw Error('USAGE: owned-source-ci.mjs -- COMMAND [ARG...]');
// Reserve/test every fixed service port before invoking Supabase. Conflict means not_run; no unrelated service is stopped.
const source=resolve(import.meta.dirname,'..'),config=await readFile(join(source,'supabase/config.toml'),'utf8'),ports=[...new Set([...config.matchAll(/^\s*port\s*=\s*(\d+)/gm)].map(m=>Number(m[1])))],servers=[];
try{requireUnpublishedCiPorts(ports);}catch(e){console.error(JSON.stringify({code:'CI_PORT_INVENTORY_NOT_RUN',reason:e.message,accepted:false,servicesStarted:false}));process.exit(2);}
try{for(const port of ports){const s=createServer();await new Promise((ok,fail)=>{s.once('error',fail);s.listen(port,'127.0.0.1',ok);});servers.push(s);}}finally{for(const s of servers)await new Promise(r=>s.close(r));}
const work=await mkdtemp(join(process.env.MEKONIQ_OWNED_CI_PARENT??tmpdir(),'mekoniq-owned-ci-')),projectId='mekoniq-ci-'+randomBytes(8).toString('hex');await cp(join(source,'supabase'),join(work,'supabase'),{recursive:true,filter:p=>!p.includes('/.temp')&&!p.includes('/.branches')});await writeFile(join(work,'supabase/config.toml'),ownedCiConfig(config,projectId));await mkdir(join(work,'logs'));
// A retained, atomic owner record exists before the first start. Restoration can inspect
// it even when the caller was interrupted. Status stdout contains credentials and is never logged.
const stateFile=resolve(process.env.MEKONIQ_OWNED_CI_STATE??join(work,'owner.json'));
const deadline=Number(process.env.MEKONIQ_OWNED_CI_TEST_TIMEOUT_MS??14400000);
if(!Number.isSafeInteger(deadline)||deadline<1||deadline>14400000)throw Error('INVALID_CHILD_TIMEOUT');
const state={work,projectId,ownerPid:process.pid,accepted:false,cleanup:'pending',primaryExitCode:null,stopExitCode:null};
await writeFile(stateFile,JSON.stringify(state),{flag:'wx',mode:0o600});
const publish=async()=>{await writeFile(stateFile+'.tmp',JSON.stringify(state),{mode:0o600});await rename(stateFile+'.tmp',stateFile);};
let cancelCode=0,interrupt;
for(const [sig,code] of Object.entries({SIGINT:130,SIGTERM:143,SIGHUP:129,SIGALRM:124}))process.on(sig,()=>{cancelCode||=code;interrupt?.(cancelCode);});
async function run(id,cmd,argv,env=process.env){
 const cleanup=id==='stop',capture=id==='inspect'||id==='status',startedAt=new Date().toISOString();
 const log=await open(join(work,'logs',id+'.log'),'wx',0o600);
 let stdout='',failure=0,killTimer,timeout,child,spawnError=null,exitSignal=null,exitCode;
 const killGroup=signal=>{if(child?.pid)try{process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}};
 const terminate=code=>{if(failure)return;failure=code;killGroup('SIGTERM');killTimer=setTimeout(()=>killGroup('SIGKILL'),5000);};
 try{
  if(cancelCode&&!cleanup)exitCode=cancelCode;
  else{
   child=spawn(cmd,argv,{cwd:source,env,detached:true,stdio:['ignore',capture?'pipe':log.fd,id==='status'?'ignore':log.fd]});
   if(capture)child.stdout.on('data',b=>{if(stdout.length+b.length>1024*1024)terminate(1);else stdout+=b.toString();});
   if(!cleanup)interrupt=terminate;
   timeout=setTimeout(()=>terminate(124),id==='tests'?deadline:300000);
   child.on('error',e=>{spawnError=e.code??'SPAWN_FAILED';});
   const result=await new Promise(ok=>child.once('close',(code,signal)=>ok({code,signal})));
   exitSignal=result.signal;exitCode=failure||(spawnError?1:result.code??1);
   if(failure)killGroup('SIGKILL'); // a launcher may exit before its interrupted descendants
  }
 }finally{interrupt=undefined;clearTimeout(timeout);clearTimeout(killTimer);await log.close();}
 const receipt={id,command:cmd,args:argv,startedAt,finishedAt:new Date().toISOString(),exitCode,signal:exitSignal,spawnError};
 await writeFile(join(work,'logs',id+'.json'),JSON.stringify(receipt),{mode:0o600});
 return {exitCode,stdout};
}
const checked=async(...args)=>{const r=await run(...args);if(r.exitCode)throw Object.assign(Error(args[0]==='start'?'OWNED_SUPABASE_NOT_RUN':'OWNED_'+args[0].toUpperCase()+'_FAILED'),{exitCode:r.exitCode,prerequisite:true});return r.stdout;};
try{
 await checked('start','pnpm',['exec','supabase','start','--workdir',work,'-x','studio,imgproxy,edge-runtime,logflare,vector']);
 const containerId=(await checked('inspect','docker',['inspect','--format','{{.Id}}','supabase_db_'+projectId])).trim();
 if(!/^[a-f0-9]{64}$/.test(containerId))throw Error('OWNED_CONTAINER_MISSING');
 const creds=JSON.parse(await checked('status','pnpm',['exec','supabase','status','--workdir',work,'--output','json']));
 const receipt=join(work,'service-receipt.json');
 await writeFile(receipt,JSON.stringify({version:1,projectId,containerId,database:'postgres',host:'127.0.0.1',port:57422,createdForTests:true,unrelatedServicesModified:false}),{mode:0o600});
 const childEnv={...process.env};
 for(const key of ['MEKONIQ_OWNED_CI_STATE','MEKONIQ_OWNED_CI_PARENT','MEKONIQ_OWNED_CI_TEST_TIMEOUT_MS'])delete childEnv[key];
 state.primaryExitCode=(await run('tests',args[1],args.slice(2),{...childEnv,MEKONIQ_TEST_SERVICE_RECEIPT:receipt,MEKONIQ_DB_CONTAINER:'supabase_db_'+projectId,MEKONIQ_TEST_DB:'postgres',DATABASE_ADMIN_URL:creds.DB_URL,NEXT_PUBLIC_SUPABASE_URL:creds.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:creds.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:creds.SERVICE_ROLE_KEY})).exitCode;
}catch(e){state.primaryExitCode=e.exitCode??2;console.error(e.prerequisite?e.message:'OWNED_CI_PREREQUISITE_FAILED');}
finally{
 try{state.stopExitCode=(await run('stop','pnpm',['exec','supabase','stop','--workdir',work])).exitCode;}
 catch{state.stopExitCode=1;}
 state.cleanup=state.stopExitCode===0?'stopped':'failed';state.primaryExitCode ||= cancelCode;
 await publish();console.log(JSON.stringify(state));
}
process.exitCode=state.primaryExitCode||state.stopExitCode;
