// Finite, owned process group. Streams are written as received, including on timeout/abort.
import {spawn} from 'node:child_process';
import {open,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function runOwnedProcess(command,args,{out,cwd,env=process.env,timeoutMs,signal,maxBytes=32*1024*1024}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw Error('OWNED_PROCESS_DEADLINE_REQUIRED');
 const stdout=await open(join(out,'stdout.log'),'wx',0o600),stderr=await open(join(out,'stderr.log'),'wx',0o600),startedAt=new Date().toISOString();
 let reason=null,killTimer,child,timer,bytes=0,pending=Promise.resolve(),writeError=null;
 const send=s=>{if(!child?.pid)return;try{process.kill(-child.pid,s);}catch{try{child.kill(s);}catch{/* already exited */}}};
 const stop=why=>{reason??=why;send('SIGTERM');killTimer??=setTimeout(()=>send('SIGKILL'),1000);};
 const abort=()=>stop('aborted');
 const append=(file,data)=>{const remaining=Math.max(0,maxBytes-bytes),kept=data.subarray(0,remaining);bytes+=data.length;if(kept.length)pending=pending.then(()=>file.write(kept)).catch(e=>{writeError=e;stop('write_failed');});if(bytes>maxBytes)stop('output_limit');};
 let exitCode=null,exitSignal=null,spawnError=null;
 try{
  if(signal?.aborted)reason='aborted';
  else await new Promise(done=>{
   child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:true});
   child.stdout.on('data',d=>append(stdout,d));child.stderr.on('data',d=>append(stderr,d));
   child.once('error',e=>{spawnError=String(e);});child.once('close',(code,sig)=>{exitCode=code;exitSignal=sig;done();});
   timer=setTimeout(()=>stop('timeout'),timeoutMs);signal?.addEventListener('abort',abort,{once:true});
  });
 }finally{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);await pending;await stdout.close();await stderr.close();}
 const receipt={schemaVersion:1,startedAt,finishedAt:new Date().toISOString(),status:reason?'incomplete':exitCode===0?'completed':'failed',reason,exitCode,exitSignal,spawnError,writeError:writeError?String(writeError):null,command,args,stdout:'stdout.log',stderr:'stderr.log'};
 await writeFile(join(out,'process.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return receipt;
}
