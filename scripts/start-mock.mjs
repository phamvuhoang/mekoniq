#!/usr/bin/env node
// pnpm lab:mock — run the INSTALLED, pinned source runtime (mock backends only) and the Lab UI on loopback, in one terminal.
// Never downloads or installs anything, never starts a stand-in when the runtime is missing, never stops a process it did not start.
// Options (defaults are the only ones the source runtime accepts browser traffic from): --ui-port 4175 --runtime-port 4176 --data-dir <lab>/runs
// --root <dir> selects another Lab install (tests); --boot-only exits after ready (boot-to-ready measurement).
// --allow-origin <origin> lets the runtime accept a bearer session from that origin too; --extra-ui-port <port> serves the same Lab on
// http://localhost:<port> (another origin, loopback only) with no /lab of its own: a web-hosted Lab stand-in for the e2e (remote-origin.spec.ts).
// A local launcher never uses an access key: MEKONIQ_LAB_ACCESS_KEY is removed from the runtime's environment, so it always prints a pairing code.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as httpServer,request} from 'node:http';
import {access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkedRuntime} from './runtime-artifact.mjs';
export const MOCK_BACKENDS=['mock_amr','mock_coffee','mock_arm'];
export const FORBIDDEN_PORTS=[1880,1884];// operational Node-RED/MQTT on live robots
const lab=fileURLToPath(new URL('../',import.meta.url));
export function assertNode(version=process.versions.node){if(Number(version.split('.')[0])!==24)throw new Error(`UNSUPPORTED_NODE:${version}. Use Node.js 24 (see .node-version), then run pnpm lab:mock.`);}
export function assertPlatform(platform=process.platform){if(!['darwin','linux'].includes(platform))throw new Error(`UNSUPPORTED_OS:${platform}. The mock launcher supports macOS and Linux (Linux not yet verified on a fresh host).`);}
function assertPort(port){if(!Number.isInteger(port)||port<1024||port>65535)throw new Error(`INVALID_PORT:${port}`);if(FORBIDDEN_PORTS.includes(port))throw new Error(`FORBIDDEN_PORT:${port} is an operational robot port; the Lab never uses it.`);}
const portFree=(port)=>new Promise((ok,fail)=>{const s=createServer();s.once('error',()=>fail(new Error(`PORT_IN_USE:${port}. Another process holds it; stop that process yourself (the launcher never stops it) and retry.`)));s.listen(port,'127.0.0.1',()=>s.close(ok));});
/** The running runtime must be the pinned one, speak v2 and enable exactly the mock backends. */
export function checkHealth(health,lock){
 if(health.sourceCommit!==lock.sourceCommit||health.schemaHash!==lock.schemaHash)throw new Error('RUNTIME_IDENTITY_MISMATCH');
 if(!health.protocolMajors?.includes(2))throw new Error('RUNTIME_PROTOCOL_V2_REQUIRED');
 const enabled=new Set((health.backends??[]).filter(b=>b.enabled).map(b=>b.id));
 for(const id of MOCK_BACKENDS)if(!enabled.has(id))throw new Error(`BACKEND_UNAVAILABLE:${id}`);
 for(const id of enabled)if(!MOCK_BACKENDS.includes(id))throw new Error(`NON_MOCK_BACKEND_ENABLED:${id}`);
}
/** The user's shell environment without the access key (a keyed runtime prints no pairing code and the launcher would wait for one). */
export const runtimeEnv=(env=process.env)=>{const {MEKONIQ_LAB_ACCESS_KEY:_key,...rest}=env;return rest;};
/** The Lab UI on another loopback origin: every request goes to the UI server as it is, except /lab, which that origin does not have. */
function extraUi(port,uiPort){
 const server=httpServer((q,r)=>{
  if(q.url?.startsWith('/lab/')||q.url==='/lab'){r.writeHead(404,{'Content-Type':'application/json'});r.end('{"error":"NO_RUNTIME_ON_THIS_ORIGIN"}');return;}
  const upstream=request({host:'127.0.0.1',port:uiPort,path:q.url,method:q.method,headers:q.headers},res=>{r.writeHead(res.statusCode??502,res.headers);res.pipe(r);});
  upstream.on('error',()=>{if(!r.headersSent)r.writeHead(502);r.end();});r.once('close',()=>upstream.destroy());q.pipe(upstream);
 });
 return new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',()=>ok(server));});
}
const PREVIEW='Runtime unavailable: the Lab can only open in preview only mode (design, layout, no runs or results). Install the pinned export with node scripts/import-runtime.mjs <artifact-dir> (see README), then pnpm check:source.';
function options(argv){
 const o={root:lab,uiPort:4175,runtimePort:4176,dataDir:undefined,bootOnly:false,allowOrigin:undefined,extraUiPort:undefined};
 for(let i=0;i<argv.length;i++){const a=argv[i];
  if(a==='--')continue;else if(a==='--root')o.root=resolve(argv[++i]);else if(a==='--ui-port')o.uiPort=Number(argv[++i]);else if(a==='--runtime-port')o.runtimePort=Number(argv[++i]);
  else if(a==='--data-dir')o.dataDir=resolve(argv[++i]);else if(a==='--boot-only')o.bootOnly=true;
  else if(a==='--allow-origin')o.allowOrigin=argv[++i];else if(a==='--extra-ui-port')o.extraUiPort=Number(argv[++i]);else throw new Error(`UNKNOWN_ARGUMENT:${a}`);}
 o.dataDir??=join(o.root,'runs');return o;
}
const waitFor=(child,name,until,ms)=>new Promise((ok,fail)=>{
 const t=setTimeout(()=>{clearInterval(i);fail(new Error(`${name}_NOT_READY after ${ms} ms`));},ms),onExit=c=>{clearTimeout(t);clearInterval(i);fail(new Error(`${name}_EXITED:${c}`));};
 child.once('exit',onExit);
 const i=setInterval(async()=>{try{const v=await until();if(v!==undefined){clearTimeout(t);clearInterval(i);child.off('exit',onExit);ok(v);}}catch{/* not yet */}},100);
});
/**
 * One launcher loop for the mock and the IR-SIM launchers: checks, then the pinned runtime and the UI as the only processes it owns, stopped on Ctrl-C.
 * `prepare` runs after the runtime pin is verified and before anything is spawned; it returns extra runtime argv/env (IR-SIM: the verified tool paths).
 * Every child it starts (a preflight probe) is handed to its `track` at spawn time, so a signal, an error or the exit stops it too (its whole group when
 * `groupKill`). A signal before ready aborts the start: exit 130 (SIGINT) / 143 (SIGTERM), never 0; Ctrl-C after ready is the normal stop (exit 0).
 */
export async function launch({argv=process.argv.slice(2),prepare=async()=>({args:[],env:{}}),check=checkHealth,banner}={}){
 const started=performance.now(),owned=[],track=(c)=>{owned.push(c);return c;};
 // the exit code is latched when the signal arrives (never read later): startup may still be between two awaits when teardown finishes
 let stopping,ready=false,exitCode=null;
 track.stopping=()=>stopping!==undefined;
 /** Every startup step checks this first: once stopping, nothing more is spawned, printed or marked ready. */
 const go=()=>{if(stopping)throw Object.assign(new Error('START_ABORTED'),{aborted:true});};
 // a tracked group (groupKill) lives as long as any member does, whether or not its leader exited: liveness is kill(-pgid, 0), never the leader's state
 const live=(c)=>{if(!c.groupKill)return c.exitCode===null&&c.signalCode===null;if(!c.pid)return false;try{process.kill(-c.pid,0);return true;}catch(e){return e.code==='EPERM';}};
 const signal=(c,sig)=>{try{if(c.groupKill&&c.pid)process.kill(-c.pid,sig);else c.kill(sig);}catch{/* already gone */}};
 const gone=async(c,ms)=>{for(const end=Date.now()+ms;live(c)&&Date.now()<end;)await new Promise(r=>setTimeout(r,50));return !live(c);};
 // SIGTERM, a bounded wait, then SIGKILL and a wait for the group (or process) to disappear
 const stopOne=async(c)=>{signal(c,'SIGTERM');if(!await gone(c,5000)){signal(c,'SIGKILL');await gone(c,2000);}};
 // a child tracked while teardown runs (spawned by a step already in flight) is stopped too: the loop runs until no tracked group is left
 // in-process servers this launcher opened (the extra UI origin): closed on every stop path, so the port is free once the launcher stops
 const servers=[],closeServers=()=>Promise.all(servers.splice(0).map(s=>new Promise(r=>{s.close(()=>r());s.closeAllConnections();})));
 const stop=()=>stopping??=(async()=>{for(let n=0;n<owned.length;){const batch=owned.slice(n);n=owned.length;await Promise.all(batch.filter(live).map(stopOne));}await closeServers();})();
 for(const [s,code] of [['SIGINT',130],['SIGTERM',143]])process.on(s,()=>{if(stopping)return;exitCode=ready?0:code;console.log(ready?'\nStopping the runtime and UI this launcher started…':`\n${s} before ready: start aborted, stopping what this launcher started…`);void stop().then(()=>process.exit(exitCode));});
 process.once('exit',()=>{for(const c of owned)if(live(c))signal(c,'SIGKILL');});
 try{
  assertNode();assertPlatform();
  const o=options(argv);
  assertPort(o.uiPort);assertPort(o.runtimePort);if(o.uiPort===o.runtimePort)throw new Error('INVALID_PORT:ui and runtime ports must differ');
  if(o.extraUiPort!==undefined){assertPort(o.extraUiPort);if([o.uiPort,o.runtimePort].includes(o.extraUiPort))throw new Error('INVALID_PORT:the extra UI port must differ from the others');}
  if(o.allowOrigin!==undefined&&!/^https?:\/\/[^/\s]+$/.test(o.allowOrigin))throw new Error(`INVALID_ORIGIN:${o.allowOrigin}`);
  let runtime;
  try{runtime=await checkedRuntime(o.root);}catch(e){throw new Error(`${e.code==='ENOENT'?'RUNTIME_NOT_INSTALLED':e.message}. ${PREVIEW}`);}
  const {lock,file}=runtime;
  if(!(lock.protocolMajors??[lock.protocolMajor]).includes(2))throw new Error(`RUNTIME_PROTOCOL_V2_REQUIRED: pinned artifact offers protocol ${lock.protocolMajor} only. ${PREVIEW}`);
  const vite=join(lab,'node_modules/vite/bin/vite.js');
  await access(vite).catch(()=>{throw new Error('DEPENDENCIES_NOT_INSTALLED: run pnpm install --frozen-lockfile once (the launcher never downloads).');});
  const extra=await prepare(o,lock,track);go();
  await portFree(o.runtimePort);await portFree(o.uiPort);if(o.extraUiPort!==undefined)await portFree(o.extraUiPort);go();
  const rt=spawn(process.execPath,[file,'--port',String(o.runtimePort),'--data-dir',o.dataDir,...o.uiPort!==4175?['--public-host',`127.0.0.1:${o.uiPort}`]:[],...o.allowOrigin?['--allow-origin',o.allowOrigin]:[],...extra.args],{cwd:o.root,stdio:['ignore','pipe','inherit'],env:{...runtimeEnv(),...extra.env},detached:true});rt.groupKill=true;track(rt);
  let out='';rt.stdout.on('data',c=>{out+=c;});
  const token=await waitFor(rt,'RUNTIME',()=>/Pairing token \(expires in 5 minutes; one use\): (\S+)/.exec(out)?.[1],extra.readyMs??15000);
  go();const health=await (await fetch(`http://127.0.0.1:${o.runtimePort}/lab/v2/health`)).json();
  check(health,lock);go();
  const ui=spawn(process.execPath,[vite,'--host','127.0.0.1','--port',String(o.uiPort),'--strictPort'],{cwd:lab,stdio:['ignore','ignore','inherit'],env:{...process.env,LAB_RUNTIME_PORT:String(o.runtimePort)},detached:true});ui.groupKill=true;track(ui);
  await waitFor(ui,'UI',async()=>(await fetch(`http://127.0.0.1:${o.uiPort}/`)).ok||undefined,30000);go();
  const extraServer=o.extraUiPort===undefined?null:await extraUi(o.extraUiPort,o.uiPort);
  if(extraServer){servers.push(extraServer);if(stopping)await closeServers();}// a stop that began while it opened has already closed the others
  go();
  console.log(`${banner??'Mekoniq Robot Lab — mock twin (simulated; no robot hardware)'}
Source ${lock.sourceCommit} · artifact ${lock.artifactSha256.slice(0,12)} · protocol ${health.protocolMajors.join('/')}
Backends: ${extra.backends??MOCK_BACKENDS.join(', ')} · journal ${o.dataDir}
Owned processes: runtime pid ${rt.pid}, UI pid ${ui.pid}
${extraServer?`Also serving the Lab at http://localhost:${o.extraUiPort} (no /lab there: enter the runtime address http://127.0.0.1:${o.runtimePort}${o.allowOrigin?`; runtime allows ${o.allowOrigin}`:''})\n`:''}Open http://127.0.0.1:${o.uiPort} and enter this one-use pairing code (expires in 5 minutes): ${token}
Ready in ${Math.round(performance.now()-started)} ms. Press Ctrl-C to stop.`);ready=true;
  if(o.bootOnly){await stop();return;}
  const code=await new Promise(r=>{for(const c of owned)c.once('exit',x=>r(x));});
  if(!stopping){console.error(`A launcher process exited unexpectedly (${code}); stopping the other one.`);await stop();process.exitCode=1;}
 }catch(e){if(stopping)return;console.error(e.message);await stop();process.exitCode=1;}// a signal is already stopping everything: its exit code stands
}
const main=()=>launch();
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
