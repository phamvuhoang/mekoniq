import {expect,test} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {createServer,type Server} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
// @ts-expect-error CLI JavaScript boundary
import {installRuntime,rollbackRuntime,checkedRuntime} from '../../scripts/runtime-artifact.mjs';
// @ts-expect-error CLI JavaScript boundary
import {assertNode,assertPlatform} from '../../scripts/start-mock.mjs';
import {verifyRuntime} from '../../src/runtime/compatibility';
const lab=fileURLToPath(new URL('../../',import.meta.url)),launcher=join(lab,'scripts/start-mock.mjs');
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const MOCK=['mock_amr','mock_coffee','mock_arm'];
// A stand-in runtime: binds the given loopback port, prints the source pairing line, answers /lab/v2/health with the given backends.
const fakeRuntime=(enabled:string[],commit:string,schemaHash:string)=>`import {createServer} from 'node:http';
const a=process.argv,port=Number(a[a.indexOf('--port')+1]);
const health={protocolMajors:[1,2],sourceCommit:'${commit}',schemaHash:'${schemaHash}',scenarioIds:['FD01','BV01'],backends:${JSON.stringify(['mock_amr','mock_coffee','mock_arm','gazebo_sim'].map(id=>({id,enabled:enabled.includes(id)})))}};
const s=createServer((q,r)=>{if(q.url==='/lab/v2/health'){r.setHeader('Content-Type','application/json');r.end(JSON.stringify(health));}else{r.statusCode=404;r.end('{}');}});
s.listen(port,'127.0.0.1',()=>console.log('Mekoniq Robot Lab business_sim\\nPairing token (expires in 5 minutes; one use): fake-one-use-token\\nSource: ${commit}'));
for(const g of ['SIGINT','SIGTERM'])process.once(g,()=>s.close(()=>process.exit(0)));`;
async function schemaFiles(dir:string){const names=['a.schema.json','b.schema.json'],h=createHash('sha256');await mkdir(join(dir,'schemas'),{recursive:true});for(const n of names){const b=`{"$id":"${n}"}`;await writeFile(join(dir,'schemas',n),b);h.update(n+'\n').update(b);}return {names,schemaHash:h.digest('hex')};}
async function exported(dir:string,o:{enabled?:string[];protocolMajors?:number[];dirty?:boolean}={}){
 await mkdir(dir,{recursive:true});const {names,schemaHash}=await schemaFiles(dir),commit='c'.repeat(40),js=fakeRuntime(o.enabled??MOCK,commit,schemaHash);
 await writeFile(join(dir,'runtime.mjs'),js);
 const manifest={sourceCommit:commit,schemaHash,protocolMajor:2,protocolMajors:o.protocolMajors??[1,2],artifactSha256:sha(js),entrypoint:'runtime.mjs',nodeMajor:24,packageVersion:'0.2.0',dirty:o.dirty??false,schemas:names,toolchain:{node:'v24.22.2'}};
 await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));return manifest;
}
async function freePort(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return p;}
const listening=(port:number)=>new Promise<boolean>(r=>{const s=createServer();s.once('error',()=>r(true));s.listen(port,'127.0.0.1',()=>s.close(()=>r(false)));});
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
function run(args:string[],env:NodeJS.ProcessEnv={}){
 const child=spawn(process.execPath,[launcher,...args],{cwd:lab,stdio:['ignore','pipe','pipe'],env:{...process.env,...env}});
 let out='',err='';child.stdout!.on('data',c=>out+=c);child.stderr!.on('data',c=>err+=c);
 const exit=new Promise<number>(r=>child.once('exit',c=>r(c??1)));
 const until=(re:RegExp,ms=30000)=>new Promise<string>((ok,fail)=>{const t=setTimeout(()=>fail(new Error('TIMEOUT:'+out+err)),ms);const f=()=>{if(re.test(out)){clearTimeout(t);clearInterval(i);ok(out);}};const i=setInterval(f,50);void exit.then(()=>{clearTimeout(t);clearInterval(i);re.test(out)?ok(out):fail(new Error('EXIT:'+out+err));});});
 return {child,exit,until,get out(){return out;},get err(){return err;}};
}
async function withRoot(fn:(root:string,tmp:string)=>Promise<void>){const tmp=await mkdtemp(join(tmpdir(),'lab-mock-launcher-'));try{await fn(join(tmp,'lab'),tmp);}finally{await rm(tmp,{recursive:true,force:true});}}

test('refuses an unsupported Node version before doing anything',()=>{
 expect(()=>assertNode('22.11.0')).toThrow('UNSUPPORTED_NODE');
 expect(()=>assertNode('25.0.0')).toThrow('UNSUPPORTED_NODE');
 expect(()=>assertNode('24.22.2')).not.toThrow();
 expect(()=>assertPlatform('win32')).toThrow('UNSUPPORTED_OS:win32');
 expect(()=>assertPlatform('darwin')).not.toThrow();expect(()=>assertPlatform('linux')).not.toThrow();
});
test('missing runtime says preview only and how to install; never starts a stand-in',()=>withRoot(async(root)=>{
 await mkdir(root,{recursive:true});const r=run(['--root',root,'--ui-port',String(await freePort()),'--runtime-port',String(await freePort())]);
 expect(await r.exit).toBe(1);expect(r.err).toMatch(/preview only/i);expect(r.err).toContain('import-runtime.mjs');expect(r.out).not.toMatch(/ready/i);
}));
test('import rescans a hash-valid runtime and refuses credentials or external requires without changing its pin',()=>withRoot(async(root,tmp)=>{
 const artifact=join(tmp,'export');await exported(artifact);await installRuntime(artifact,root);
 const original=await readFile(join(root,'config/source-runtime.lock.json'),'utf8');
 for(const code of ['const external=require("unsafe-dependency");','const secret="ghp_abcdefghijklmnopqrstuvwxyz1234567890";']){
  const manifest=JSON.parse(await readFile(join(artifact,'manifest.json'),'utf8'));
  await writeFile(join(artifact,'runtime.mjs'),code);manifest.artifactSha256=sha(code);await writeFile(join(artifact,'manifest.json'),JSON.stringify(manifest));
  await expect(installRuntime(artifact,root)).rejects.toThrow(/NON_STANDALONE_IMPORT|SECRET_IN_ARTIFACT/);
  expect(await readFile(join(root,'config/source-runtime.lock.json'),'utf8')).toBe(original);
 }
}));
test('corrupt and dirty artifacts are refused',()=>withRoot(async(root,tmp)=>{
 const m=await exported(join(tmp,'export'));await installRuntime(join(tmp,'export'),root);
 await writeFile(join(root,'.runtime',m.artifactSha256,'runtime.mjs'),'tampered');
 let r=run(['--root',root,'--ui-port',String(await freePort()),'--runtime-port',String(await freePort())]);expect(await r.exit).toBe(1);expect(r.err).toContain('ARTIFACT_HASH_MISMATCH');
 const lock=JSON.parse(await readFile(join(root,'config/source-runtime.lock.json'),'utf8'));await writeFile(join(root,'config/source-runtime.lock.json'),JSON.stringify({...lock,dirty:true}));
 r=run(['--root',root,'--ui-port',String(await freePort()),'--runtime-port',String(await freePort())]);expect(await r.exit).toBe(1);expect(r.err).toContain('DIRTY_SOURCE_ARTIFACT');
 await exported(join(tmp,'dirty'),{dirty:true});await expect(installRuntime(join(tmp,'dirty'),join(tmp,'other'))).rejects.toThrow('DIRTY_SOURCE_ARTIFACT');
}));
test('a busy port is reported and its holder is left running; operational ports are refused',()=>withRoot(async(root,tmp)=>{
 await exported(join(tmp,'export'));await installRuntime(join(tmp,'export'),root);
 const holder:Server=createServer();await new Promise<void>(r=>holder.listen(0,'127.0.0.1',r));const busy=(holder.address() as {port:number}).port;
 try{
  const r=run(['--root',root,'--ui-port',String(await freePort()),'--runtime-port',String(busy)]);expect(await r.exit).toBe(1);expect(r.err).toContain(`PORT_IN_USE:${busy}`);expect(holder.listening).toBe(true);
 }finally{holder.close();}
 for(const p of [1880,1884]){const r=run(['--root',root,'--ui-port',String(p),'--runtime-port',String(await freePort())]);expect(await r.exit).toBe(1);expect(r.err).toContain(`FORBIDDEN_PORT:${p}`);}
}));
test('an unavailable mock backend fails explicitly and stops the runtime it started',()=>withRoot(async(root,tmp)=>{
 await exported(join(tmp,'export'),{enabled:['mock_amr','mock_arm']});await installRuntime(join(tmp,'export'),root);
 const rp=await freePort(),r=run(['--root',root,'--ui-port',String(await freePort()),'--runtime-port',String(rp)]);
 expect(await r.exit).toBe(1);expect(r.err).toContain('BACKEND_UNAVAILABLE:mock_coffee');expect(await listening(rp)).toBe(false);
}));
test('a non-mock backend enabled by the runtime is refused',()=>withRoot(async(root,tmp)=>{
 await exported(join(tmp,'export'),{enabled:[...MOCK,'gazebo_sim']});await installRuntime(join(tmp,'export'),root);
 const r=run(['--root',root,'--ui-port',String(await freePort()),'--runtime-port',String(await freePort())]);
 expect(await r.exit).toBe(1);expect(r.err).toContain('NON_MOCK_BACKEND_ENABLED:gazebo_sim');
}));
test('ready launcher prints the one-use code (never in a URL), makes no outbound connection, and Ctrl-C stops only its own children',()=>withRoot(async(root,tmp)=>{
 await exported(join(tmp,'export'));await installRuntime(join(tmp,'export'),root);
 const hook=join(tmp,'no-network.mjs'),log=join(tmp,'net.log');await writeFile(log,'');
 await writeFile(hook,`import net from 'node:net';import dns from 'node:dns';import {appendFileSync} from 'node:fs';
const ok=h=>!h||['127.0.0.1','localhost','::1'].includes(h),rec=s=>appendFileSync(process.env.NET_LOG,process.pid+' '+s+'\\n');
const c=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...a){const o=Array.isArray(a[0])?a[0][0]:typeof a[0]==='object'&&a[0]?a[0]:{port:a[0],host:typeof a[1]==='string'?a[1]:undefined};if(!o.path&&!ok(o.host)){rec(o.host+':'+o.port);throw new Error('NETWORK_DISABLED_IN_TEST');}return c.apply(this,a);};
const l=dns.lookup;dns.lookup=function(h,...r){if(!ok(h))rec('dns '+h);return l.call(this,h,...r);};`);
 const bystander=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 const up=await freePort(),rp=await freePort(),data=join(tmp,'runs');
 const r=run(['--root',root,'--ui-port',String(up),'--runtime-port',String(rp),'--data-dir',data],{NODE_OPTIONS:`--import ${pathToFileURL(hook).href}`,NET_LOG:log});
 let launched:ChildProcess|undefined=r.child;
 try{
  const out=await r.until(/Ready in \d+ ms/);
  expect(out).toContain(`http://127.0.0.1:${up}`);expect(out).toContain('fake-one-use-token');expect(out).not.toMatch(/[?&#]token=/);expect(out).toMatch(/mock_amr, mock_coffee, mock_arm/);
  const pids=/Owned processes: runtime pid (\d+), UI pid (\d+)/.exec(out)!.slice(1).map(Number);
  expect((await fetch(`http://127.0.0.1:${up}/`)).status).toBe(200);
  const h=await (await fetch(`http://127.0.0.1:${up}/lab/v2/health`)).json() as {sourceCommit:string};expect(h.sourceCommit).toBe('c'.repeat(40));
  r.child.kill('SIGINT');expect(await r.exit).toBe(0);launched=undefined;
  for(const pid of pids)expect(alive(pid)).toBe(false);
  expect(await listening(up)).toBe(false);expect(await listening(rp)).toBe(false);
  expect(alive(bystander.pid!)).toBe(true);
  expect(await readFile(log,'utf8')).toBe('');
 }finally{launched?.kill('SIGKILL');bystander.kill();}
}),60000);
test('install is one transaction: protocol compatibility, contract schemas and lock; the previous artifact stays for rollback',()=>withRoot(async(root,tmp)=>{
 const a=await exported(join(tmp,'a'),{protocolMajors:[1,2]});const lockA=await installRuntime(join(tmp,'a'),root);
 expect(lockA).toMatchObject({protocolMajor:2,protocolMajors:[1,2],schemaHash:a.schemaHash});
 expect(await readFile(join(root,'.runtime',a.artifactSha256,'schemas/a.schema.json'),'utf8')).toContain('a.schema.json');
 // unknown protocol major or a schema set that does not hash to the manifest: nothing changes
 await exported(join(tmp,'v3'),{protocolMajors:[2,3]});await expect(installRuntime(join(tmp,'v3'),root)).rejects.toThrow('UNSUPPORTED_PROTOCOL');
 await exported(join(tmp,'bad'),{enabled:['mock_amr']});await writeFile(join(tmp,'bad/schemas/b.schema.json'),'{"changed":true}');await expect(installRuntime(join(tmp,'bad'),root)).rejects.toThrow('SCHEMA_HASH_MISMATCH');
 expect(JSON.parse(await readFile(join(root,'config/source-runtime.lock.json'),'utf8'))).toEqual(lockA);
 const b=await exported(join(tmp,'b'),{enabled:[...MOCK,'gazebo_sim']});await installRuntime(join(tmp,'b'),root);
 expect((await checkedRuntime(root)).lock.artifactSha256).toBe(b.artifactSha256);
 await rollbackRuntime(root);expect((await checkedRuntime(root)).lock.artifactSha256).toBe(a.artifactSha256);
}));
test('re-importing the installed SHA keeps the verified directory in place (no remove-then-rename window); rollback lock written atomically after the lock',()=>withRoot(async(root,tmp)=>{
 const a=await exported(join(tmp,'a'));await installRuntime(join(tmp,'a'),root);
 const dir=join(root,'.runtime',a.artifactSha256);await writeFile(join(dir,'marker'),'same directory');
 const lock=await readFile(join(root,'config/source-runtime.lock.json'),'utf8');
 await installRuntime(join(tmp,'a'),root);
 expect(await readFile(join(dir,'marker'),'utf8')).toBe('same directory');expect(await readFile(join(root,'config/source-runtime.lock.json'),'utf8')).toBe(lock);
 const b=await exported(join(tmp,'b'),{enabled:[...MOCK,'gazebo_sim']});await installRuntime(join(tmp,'b'),root);
 expect(JSON.parse(await readFile(join(root,'.runtime/rollback.lock.json'),'utf8')).artifactSha256).toBe(a.artifactSha256);
 expect((await readdir(join(root,'.runtime'))).filter(n=>n.startsWith('.'))).toEqual([]); // no staging or temporary rollback file left behind
 expect((await readdir(join(root,'config'))).filter(n=>n.startsWith('.'))).toEqual([]);
}));
test('a lock offering protocols 1 and 2 stays compatible with the S01 v1 health',()=>{
 const lock={sourceCommit:'a',schemaHash:'s',protocolMajor:2,protocolMajors:[1,2]};
 expect(verifyRuntime(lock,{sourceCommit:'a',schemaHash:'s',protocolMajor:1})).toEqual({ok:true,reasons:[]});
 expect(verifyRuntime({...lock,protocolMajors:[2]},{sourceCommit:'a',schemaHash:'s',protocolMajor:1})).toEqual({ok:false,reasons:['CONTRACT_MISMATCH']});
});
test('review7 #2: a signal before ready latches 130/143 at once; startup never goes on to spawn the UI or print Ready, and what it started is gone',()=>withRoot(async(root,tmp)=>{
 const artifact=join(tmp,'export'),m=await exported(artifact),pidFile=join(tmp,'runtime.pid');
 // a runtime that ignores SIGTERM (so teardown takes the bounded wait) and only gets ready a little later
 const js=`import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';
const a=process.argv,port=Number(a[a.indexOf('--port')+1]);writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});
const health={protocolMajors:[1,2],sourceCommit:'${m.sourceCommit}',schemaHash:'${m.schemaHash}',scenarioIds:['FD01','BV01'],backends:${JSON.stringify(MOCK.map(id=>({id,enabled:true})))}};
const s=createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify(health));});
setTimeout(()=>s.listen(port,'127.0.0.1',()=>console.log('Pairing token (expires in 5 minutes; one use): fake-one-use-token')),800);`;
 await writeFile(join(artifact,'runtime.mjs'),js);await writeFile(join(artifact,'manifest.json'),JSON.stringify({...m,artifactSha256:sha(js)}));await installRuntime(artifact,root);
 for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]] as const){
  await rm(pidFile,{force:true});
  const up=await freePort(),r=run(['--root',root,'--data-dir',join(tmp,'runs'),'--ui-port',String(up),'--runtime-port',String(await freePort())]);
  let pid=NaN;for(let i=0;i<200&&!Number.isInteger(pid);i++){await new Promise(res=>setTimeout(res,25));pid=await readFile(pidFile,'utf8').then(Number,()=>NaN);}
  expect(Number.isInteger(pid),signal).toBe(true);
  r.child.kill(signal);
  // during the whole teardown (the runtime ignores SIGTERM: ~5 s) the UI port must never come up: no UI is spawned after the signal
  let uiSeen=false,done=false;void r.exit.then(()=>{done=true;});
  while(!done){if(await listening(up))uiSeen=true;await new Promise(res=>setTimeout(res,50));}
  expect(await r.exit,signal).toBe(code);expect(uiSeen,signal).toBe(false);
  expect(r.out,signal).not.toMatch(/Ready in/);expect(r.out,signal).not.toMatch(/UI pid/);
  expect(await listening(up),signal).toBe(false);
  const survived=alive(pid);if(survived)process.kill(pid,'SIGKILL');
  expect(survived,signal).toBe(false);
 }
}),60000);
