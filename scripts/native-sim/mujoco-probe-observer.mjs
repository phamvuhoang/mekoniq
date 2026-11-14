// Passive observer of unchanged subject bytes. Never changes argv/options/return values or wire bytes.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {writeFileSync} from 'node:fs';
import {appendFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
export function observeSpawn(original,record,ownedRoot){
 return function(...args){
  const child=Reflect.apply(original,this,args),argv=args[1],options=args[2];
  const cwd=typeof options?.cwd==='string'?resolve(options.cwd):'';
  if(!Array.isArray(argv)||!argv.some((x,i)=>x==='-m'&&argv[i+1]==='mujoco_worker')||!cwd.startsWith(resolve(ownedRoot)+sep))return child;
  const at=()=>Number(process.hrtime.bigint())/1e6,pid=child.pid,runId=argv[argv.indexOf('--run-id')+1];
  record({event:'spawn',pid,runId,command:args[0],args:argv,cwd,atMs:at()});
  let input='',output='',bad=false;
  const consume=(kind,chunk)=>{
   if(bad)return;let b=(kind==='request'?input:output)+chunk.toString();
   if(b.length>2*1024*1024){bad=true;record({event:'incomplete',pid,reason:'line_limit',atMs:at()});return;}
   for(let p;(p=b.indexOf('\n'))>=0;){const line=b.slice(0,p);b=b.slice(p+1);try{record({event:kind,pid,runId,atMs:at(),value:JSON.parse(line)});}catch{bad=true;record({event:'incomplete',pid,reason:'invalid_wire_json',atMs:at()});}}
   if(kind==='request')input=b;else output=b;
  };
  const write=child.stdin.write;
  child.stdin.write=function(...values){try{consume('request',values[0]);}catch{record({event:'incomplete',pid,reason:'observer_error'});}return Reflect.apply(write,this,values);};
  child.stdout.on('data',chunk=>consume('ack',chunk));
  child.once('close',(code,signal)=>{if(input||output)record({event:'incomplete',pid,reason:'partial_wire_line',atMs:at()});record({event:'exit',pid,runId,code,signal,atMs:at()});});
  return child;
 };
}
if(process.env.L01_OBSERVER_FILE&&process.env.L01_OWNED_ROOT){
 const file=process.env.L01_OBSERVER_FILE,ownedRoot=process.env.L01_OWNED_ROOT;delete process.env.L01_OBSERVER_FILE;delete process.env.L01_OWNED_ROOT;
 let pending=Promise.resolve(),total=0,buffered=0,failed=false;
 const fail=reason=>{if(failed)return;failed=true;pending=pending.then(()=>writeFile(file+'.incomplete',reason+'\n')).catch(()=>{});};
 const record=e=>{if(failed)return;const text=JSON.stringify(e)+'\n',bytes=Buffer.byteLength(text);total+=bytes;buffered+=bytes;if(total>64*1024*1024||buffered>4*1024*1024){fail('observation_limit');return;}pending=pending.then(()=>appendFile(file,text,{mode:0o600})).catch(()=>fail('observation_write_failed')).finally(()=>{buffered-=bytes;});};
 childProcess.spawn=observeSpawn(childProcess.spawn,record,ownedRoot);syncBuiltinESMExports();
 process.on('beforeExit',()=>pending);
 // A small exit receipt never delays or rewrites subject streams; pending/lost diagnostics refuse qualification.
 process.on('exit',()=>{try{writeFileSync(file+'.seal',JSON.stringify({complete:!failed&&buffered===0,totalBytes:total})+'\n',{mode:0o600});}catch{/* missing seal is incomplete */}});
}
