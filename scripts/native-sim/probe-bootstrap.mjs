// Trusted entry bootstrap. No assessment code or reference data is loaded in this process.
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {checkedCheckerIdentity} from '../native-checker-bootstrap.mjs';
export async function invokeCheckedProbe(operation,input,signal){
 const checker=await checkedCheckerIdentity();signal?.throwIfAborted();
 const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
 const child=fork(fileURLToPath(new URL('./probe-worker.mjs',import.meta.url)),[],{execArgv:[],env,stdio:['ignore','inherit','inherit','ipc']});
 const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
 let message;try{
  await new Promise((resolve,reject)=>{child.once('error',reject);child.on('message',m=>{message=m;});child.once('exit',(code)=>code===0&&message?resolve():reject(Error('CHECKER_PROCESS_FAILED')));const {signal:ignored,...data}=input;void ignored;child.send({operation,input:data,checker});});
  if(!isDeepStrictEqual(await checkedCheckerIdentity(),checker))throw Error('CHECKER_CHANGED_DURING_ASSESSMENT');
  if(message.error)throw Error(message.error);return message.result;
 }finally{signal?.removeEventListener('abort',abort);}
}
