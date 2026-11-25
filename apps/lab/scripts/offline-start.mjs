#!/usr/bin/env node
// Self-contained launcher copied into an offline release. Node built-ins only.
import {createServer,request} from 'node:http';
import {createServer as netServer} from 'node:net';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join,resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
export async function verifyOffline(directory){
 const m=JSON.parse(await readFile(join(directory,'offline-manifest.json'),'utf8'));
 if(m.schema!=='mekoniq-offline-1'||m.platform!==process.platform||m.arch!==process.arch||m.node!==process.version)throw new Error('OFFLINE_PLATFORM_MISMATCH');
 for(const [name,entry] of Object.entries(m.files)){
  if(!name||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.')||name.includes('\\'))throw new Error('OFFLINE_PATH_INVALID');
  const path=join(directory,name),s=await lstat(path),resolved=await realpath(path);
  if(!s.isFile()||s.isSymbolicLink()||!resolved.startsWith((await realpath(directory))+sep))throw new Error(`OFFLINE_PATH_INVALID:${name}`);
  if(s.size!==entry.bytes||createHash('sha256').update(await readFile(path)).digest('hex')!==entry.sha256)throw new Error(`OFFLINE_HASH_MISMATCH:${name}`);
 }
 return m;
}
const free=port=>new Promise((ok,fail)=>{const s=netServer();s.once('error',()=>fail(new Error(`PORT_IN_USE:${port}`)));s.listen(port,'127.0.0.1',()=>s.close(ok));});
/** Resolve once the UI server is closed: a stopping launcher also tears down connections still waiting on the runtime, otherwise close() waits for them forever. */
export const closeServer=server=>new Promise(ok=>{server.close(()=>ok());server.closeAllConnections();});
export function staticServer(directory,runtimePort){
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'};
 return createServer(async(q,r)=>{
  if(q.url?.startsWith('/lab/')){
   // Preserve browser Origin/Host/cookies: the runtime still owns pairing, CSRF and origin admission.
   const upstream=request({host:'127.0.0.1',port:runtimePort,path:q.url,method:q.method,headers:q.headers},response=>{r.writeHead(response.statusCode??502,response.headers);response.pipe(r);});
   upstream.on('error',()=>{if(!r.headersSent)r.writeHead(502,{'Content-Type':'application/json'});r.end('{"error":"RUNTIME_UNAVAILABLE"}');});
   r.once('close',()=>upstream.destroy());q.pipe(upstream);return;
  }
  try{
   if(!['GET','HEAD'].includes(q.method??'')){r.writeHead(405);r.end();return;}
   const pathname=decodeURIComponent(new URL(q.url,'http://localhost').pathname),file=resolve(directory,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(resolve(directory)+sep)||!(await realpath(file)).startsWith((await realpath(directory))+sep))throw new Error('PATH');
   const body=await readFile(file);r.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});r.end(q.method==='HEAD'?undefined:body);
  }catch{r.writeHead(404);r.end('Not found');}
 });
}
async function main(){
 const started=performance.now();
 let uiPort=4175,runtimePort=4176,data=join(root,'runs'),bootOnly=false,child,server,stopping;
 const stop=()=>stopping??=Promise.all([server?closeServer(server):Promise.resolve(),new Promise(ok=>{
  if(!child||child.exitCode!==null||child.signalCode!==null){ok();return;}
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);ok();});child.kill('SIGTERM');
 })]);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(stopping)return;setTimeout(()=>process.exit(1),10000).unref();void stop().then(()=>process.exit(0));});// a stop that is not done in 10 s still exits: nothing here is worth a hung Ctrl-C
 try{
  const args=process.argv.slice(2);for(let i=0;i<args.length;i++){
   if(args[i]==='--ui-port')uiPort=Number(args[++i]);else if(args[i]==='--runtime-port')runtimePort=Number(args[++i]);
   else if(args[i]==='--data-dir')data=resolve(args[++i]);else if(args[i]==='--boot-only')bootOnly=true;else throw new Error(`UNKNOWN_ARGUMENT:${args[i]}`);
  }
  for(const p of [uiPort,runtimePort])if(!Number.isInteger(p)||p<1024||p>65535||[1880,1884].includes(p))throw new Error(`FORBIDDEN_PORT:${p}`);
  if(uiPort===runtimePort)throw new Error('PORTS_MUST_DIFFER');
  const manifest=await verifyOffline(root);await free(uiPort);await free(runtimePort);
  const {MEKONIQ_LAB_ACCESS_KEY:_key,...env}=process.env;// a local launcher never uses an access key: the runtime must print its pairing code
  child=spawn(process.execPath,[join(root,'runtime/runtime.mjs'),'--port',String(runtimePort),'--data-dir',data,...uiPort!==4175?['--allow-origin',`http://127.0.0.1:${uiPort}`,'--public-host',`127.0.0.1:${uiPort}`]:[]],{cwd:root,stdio:['ignore','pipe','inherit'],env});
  let text='';child.stdout.on('data',c=>text+=c);
  const token=await new Promise((ok,fail)=>{
   const timer=setTimeout(()=>finish(new Error('RUNTIME_NOT_READY')),15000);
   const poll=setInterval(()=>{const match=/Pairing token \(expires in 5 minutes; one use\): (\S+)/.exec(text);if(match)finish(null,match[1]);},50);
   const exited=()=>finish(new Error('RUNTIME_EXITED'));child.once('exit',exited);
   function finish(error,value){clearTimeout(timer);clearInterval(poll);child.off('exit',exited);error?fail(error):ok(value);}
  });
  const health=await(await fetch(`http://127.0.0.1:${runtimePort}/lab/v2/health`)).json();
  if(health.sourceCommit!==manifest.sourceCommit||!health.protocolMajors?.includes(2))throw new Error('RUNTIME_IDENTITY_MISMATCH');
  const enabled=(health.backends??[]).filter(b=>b.enabled).map(b=>b.id).sort();
  if(JSON.stringify(enabled)!==JSON.stringify(['mock_amr','mock_arm','mock_coffee']))throw new Error('MOCK_BACKEND_MISMATCH');
  server=staticServer(join(root,'ui'),runtimePort);await new Promise((ok,fail)=>{server.once('error',fail);server.listen(uiPort,'127.0.0.1',ok);});
  console.log(`Offline mock ready: http://127.0.0.1:${uiPort}\nEnter this one-use pairing code (expires in 5 minutes): ${token}\nSource ${manifest.sourceCommit}.\nReady in ${Math.round(performance.now()-started)} ms. Press Ctrl-C to stop.`);
  if(bootOnly){await stop();return;}
  await new Promise(ok=>child.once('exit',ok));if(!stopping)throw new Error('RUNTIME_EXITED');
 }catch(e){console.error(e.message);await stop();process.exitCode=1;}
}
if(process.argv[1]&&await realpath(process.argv[1])===await realpath(fileURLToPath(import.meta.url)))await main();
