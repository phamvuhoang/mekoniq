// lab:irsim boundary: the importer accepts only a self-consistent portable tool closure; the launcher re-hashes the tool tree, checks each venv against
// its lock and never starts anything (no runtime, no UI, no mock stand-in) when a check fails. Health must show a live irsim_2d; `lab:mock` is untouched.
import {expect,test} from 'vitest';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,chmod,copyFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
// @ts-expect-error CLI JavaScript boundary
import {installRuntime,installedManifest,validatePortableTools,verifyPortableTree} from '../../scripts/runtime-artifact.mjs';
// @ts-expect-error CLI JavaScript boundary
import {checkIRSimHealth,irsimOptions,venvProblem} from '../../scripts/start-irsim.mjs';
const lab=fileURLToPath(new URL('../../',import.meta.url)),launcher=join(lab,'scripts/start-irsim.mjs');
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
type Tools={roots:string[];tools:{id:string;root:string;lock?:{path:string;sha256:string}}[];closure:{version:1;digest:string;files:{path:string;sha256:string;bytes:number}[]}}&Record<string,unknown>;
const LOCK='ir-sim==2.12.0 \\\n    --hash=sha256:00\nnumpy==2.1.0\n';
/** A source tree with the two worker roots, their locks and the Serve components file, and the matching portableSimulationTools block. */
async function sourceTree(dir:string):Promise<Tools>{
 const files:Record<string,string>={'robotics/navigation-2d/irsim_worker/__main__.py':'print(1)\n','robotics/navigation-2d/requirements.lock':LOCK,
  'robotics/navigation-2d/fixtures/serve-demo-v1/serve-components.json':JSON.stringify({schemaVersion:1,components:{[ 'f'.repeat(64)]:{id:'chassis'}},models:{}}),
  'robotics/model-validation/linkforge_worker/__main__.py':'print(2)\n','robotics/model-validation/requirements.lock':'linkforge-core==1.6.0\n','robotics/simulation/compiler/description.py':'x=1\n'};
 for(const [p,t] of Object.entries(files)){await mkdir(join(dir,p,'..'),{recursive:true});await writeFile(join(dir,p),t);}
 await mkdir(join(dir,'robotics/navigation-2d/tests'),{recursive:true});await writeFile(join(dir,'robotics/navigation-2d/tests/test_x.py'),'ignored');// tests are outside the closure
 const listed=Object.entries(files).map(([path,t])=>({path,sha256:sha(t),bytes:Buffer.byteLength(t)})).sort((a,b)=>a.path<b.path?-1:1);
 return {distribution:'separate',version:1,python:{implementation:'cpython',version:'3.11'},flags:['MEKONIQ_LAB_IRSIM','MEKONIQ_LAB_LINKFORGE'],roots:['robotics/navigation-2d','robotics/model-validation','robotics/simulation/compiler'],
  tools:[{id:'irsim_worker',root:'robotics/navigation-2d',lock:{path:'robotics/navigation-2d/requirements.lock',sha256:sha(LOCK)}},{id:'linkforge_worker',root:'robotics/model-validation',lock:{path:'robotics/model-validation/requirements.lock',sha256:sha('linkforge-core==1.6.0\n')}},{id:'description_helper',root:'robotics/simulation/compiler'}],
  closure:{version:1,digest:sha(JSON.stringify(listed)),files:listed}};
}
/** A stand-in python: answers the launcher's stdlib probe with the given version and installed distributions (the launcher only reads its stdout). */
async function fakePython(dir:string,version:[number,number],dists:Record<string,string>){
 const f=join(dir,'python');await writeFile(f,`#!/bin/sh\necho '${JSON.stringify({version,impl:'cpython',dists})}'\n`);await chmod(f,0o755);return f;
}
const fakeRuntime=(commit:string,schemaHash:string,irsimLive:boolean,tag:string)=>`import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';// ${tag}
const a=process.argv,port=Number(a[a.indexOf('--port')+1]);
const health={protocolMajors:[1,2],sourceCommit:'${commit}',schemaHash:'${schemaHash}',capabilities:${JSON.stringify(irsimLive?['engineering_bundle_v1','irsim_navigation_v1']:['engineering_bundle_v1'])},scenarioIds:['FD01','IR-FD01'],backends:${JSON.stringify([...['mock_amr','mock_coffee','mock_arm'].map(id=>({id,enabled:true,installed:true,compatible:true,reachable:true})),{id:'irsim_2d',enabled:irsimLive,installed:irsimLive,compatible:irsimLive,reachable:irsimLive,...irsimLive?{}:{reason:'IRSIM_WORKER_UNAVAILABLE'}}])},};
writeFileSync('runtime-args.json',JSON.stringify({args:a.slice(2),flags:[process.env.MEKONIQ_LAB_IRSIM??null,process.env.MEKONIQ_LAB_LINKFORGE??null]}));
const s=createServer((q,r)=>{if(q.url==='/lab/v2/health'){r.setHeader('Content-Type','application/json');r.end(JSON.stringify(health));}else{r.statusCode=404;r.end('{}');}});
s.listen(port,'127.0.0.1',()=>console.log('Mekoniq Robot Lab business_sim\\nPairing token (expires in 5 minutes; one use): fake-one-use-token\\nSource: ${commit}'));
for(const g of ['SIGINT','SIGTERM'])process.once(g,()=>s.close(()=>process.exit(0)));`;
async function installed(root:string,tmp:string,tools:Tools|undefined,irsimLive=true){
 const dir=join(tmp,'export');await mkdir(join(dir,'schemas'),{recursive:true});const name='a.schema.json',body='{}';await writeFile(join(dir,'schemas',name),body);
 const schemaHash=sha(name+'\n'+body),commit='c'.repeat(40),js=fakeRuntime(commit,schemaHash,irsimLive,`${tools?.closure.digest??'none'}:${irsimLive}`);await writeFile(join(dir,'runtime.mjs'),js);
 await writeFile(join(dir,'manifest.json'),JSON.stringify({sourceCommit:commit,schemaHash,protocolMajor:2,protocolMajors:[1,2],artifactSha256:sha(js),entrypoint:'runtime.mjs',nodeMajor:24,packageVersion:'0.2.0',dirty:false,schemas:[name],toolchain:{node:'v24.22.2'},...tools?{portableSimulationTools:tools}:{}}));
 return installRuntime(dir,root);
}
async function freePort(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return p;}
const listening=(port:number)=>new Promise<boolean>(r=>{const s=createServer();s.once('error',()=>r(true));s.listen(port,'127.0.0.1',()=>s.close(()=>r(false)));});
function run(args:string[]){
 const child=spawn(process.execPath,[launcher,...args],{cwd:lab,stdio:['ignore','pipe','pipe'],env:{...process.env,MEKONIQ_LAB_IRSIM:undefined,MEKONIQ_LAB_LINKFORGE:undefined}});
 let out='',err='';child.stdout!.on('data',c=>out+=c);child.stderr!.on('data',c=>err+=c);
 return {exit:new Promise<number>(r=>child.once('exit',c=>r(c??1))),get out(){return out;},get err(){return err;}};
}
async function withTmp(fn:(tmp:string)=>Promise<void>){const tmp=await mkdtemp(join(tmpdir(),'lab-irsim-launcher-'));try{await fn(tmp);}finally{await rm(tmp,{recursive:true,force:true});}}

test('importer: a self-consistent closure is pinned by digest; a forged digest, an unsafe path or a lock outside the closure is refused',()=>withTmp(async(tmp)=>{
 const tools=await sourceTree(join(tmp,'source'));
 expect(validatePortableTools(tools)).toBe(tools);
 const lock=await installed(join(tmp,'lab'),tmp,tools);expect(lock.portableToolsDigest).toBe(tools.closure.digest);
 const bad=(f:(t:Tools)=>void)=>{const t=structuredClone(tools);f(t);return ()=>validatePortableTools(t);};
 expect(bad(t=>{t.closure.digest='0'.repeat(64);})).toThrow('INVALID_PORTABLE_TOOLS:digest');
 expect(bad(t=>{t.closure.files[0]!.path='../escape.py';t.closure.digest=sha(JSON.stringify(t.closure.files));})).toThrow('INVALID_PORTABLE_TOOLS:file');
 expect(bad(t=>{t.tools[0]!.lock!.sha256='0'.repeat(64);})).toThrow('INVALID_PORTABLE_TOOLS:lock:irsim_worker');
 expect(bad(t=>{t.tools.splice(1,1);})).toThrow('INVALID_PORTABLE_TOOLS:tool:linkforge_worker');
 expect(bad(t=>{t.roots=['robotics/navigation-2d'];})).toThrow('INVALID_PORTABLE_TOOLS:roots');
 expect(bad(t=>{t.python={implementation:'cpython',version:'3.12'};})).toThrow('INVALID_PORTABLE_TOOLS:shape');
 // a refused manifest leaves the earlier pin in place
 const before=await readFile(join(tmp,'lab/config/source-runtime.lock.json'),'utf8');
 const t=structuredClone(tools);t.closure.digest='0'.repeat(64);await rm(join(tmp,'export'),{recursive:true});
 await expect(installed(join(tmp,'lab'),tmp,t)).rejects.toThrow('INVALID_PORTABLE_TOOLS');
 expect(await readFile(join(tmp,'lab/config/source-runtime.lock.json'),'utf8')).toBe(before);
}));
test('launcher tree check: exact closure passes; a changed, missing, unlisted or symlinked file is a mismatch',()=>withTmp(async(tmp)=>{
 const src=join(tmp,'source'),tools=await sourceTree(src);
 expect(await verifyPortableTree(tools,src)).toEqual([]);
 await writeFile(join(src,'robotics/navigation-2d/irsim_worker/__main__.py'),'print("changed")\n');
 await writeFile(join(src,'robotics/navigation-2d/irsim_worker/extra.py'),'import os\n');
 await rm(join(src,'robotics/simulation/compiler/description.py'));
 await symlink('/etc/hosts',join(src,'robotics/model-validation/linkforge_worker/link.py'));
 expect((await verifyPortableTree(tools,src)).sort()).toEqual(['robotics/model-validation/linkforge_worker/link.py:SYMLINK','robotics/navigation-2d/irsim_worker/__main__.py:CHANGED','robotics/navigation-2d/irsim_worker/extra.py:UNLISTED','robotics/simulation/compiler/description.py:MISSING']);
}));
test('pinned runtime: the closure covers the packages the description helper imports, so an edited actors/scenario.py is a mismatch',()=>withTmp(async(tmp)=>{
 const p=(await installedManifest(lab,JSON.parse(await readFile(join(lab,'config/source-runtime.lock.json'),'utf8')))).portableSimulationTools as Tools,src=join(tmp,'source');
 for(const f of p.closure.files){await mkdir(dirname(join(src,f.path)),{recursive:true});await copyFile(join(lab,'../source',f.path),join(src,f.path));}
 expect(await verifyPortableTree(p,src)).toEqual([]);
 for(const f of ['actors/scenario.py','worlds/generate_restaurant.py']){await mkdir(dirname(join(src,'robotics/simulation',f)),{recursive:true});await writeFile(join(src,'robotics/simulation',f),'raise SystemExit("unpinned")\n');}
 expect((await verifyPortableTree(p,src)).sort()).toEqual(['robotics/simulation/actors/scenario.py:CHANGED','robotics/simulation/worlds/generate_restaurant.py:CHANGED']);
}));
test('venv check: CPython 3.11 with every locked package at its version; anything else names the problem',()=>withTmp(async(tmp)=>{
 expect(await venvProblem(await fakePython(tmp,[3,11],{'ir-sim':'2.12.0',numpy:'2.1.0'}),LOCK)).toBeNull();
 expect(await venvProblem(await fakePython(tmp,[3,11],{'ir_sim':'2.12.0'}),LOCK)).toBe('LOCK_MISMATCH:numpy==2.1.0 (missing)');
 expect(await venvProblem(await fakePython(tmp,[3,11],{'ir-sim':'2.11.0',numpy:'2.1.0'}),LOCK)).toBe('LOCK_MISMATCH:ir-sim==2.12.0 (found 2.11.0)');
 expect(await venvProblem(await fakePython(tmp,[3,12],{}),LOCK)).toBe('PYTHON_UNSUPPORTED:cpython-3.12');
 expect(await venvProblem(join(tmp,'absent'),LOCK)).toBe('PYTHON_MISSING');
 expect(await venvProblem(tmp,LOCK)).toBe('PYTHON_MISSING');// a directory is not an interpreter
 expect(()=>irsimOptions(['--irsim-python'])).toThrow('MISSING_VALUE:--irsim-python');expect(()=>irsimOptions(['--source','--boot-only'])).toThrow('MISSING_VALUE:--source');
 expect(irsimOptions(['--source','/s','--ui-port','4175'])).toMatchObject({source:'/s',irsimPython:'/s/.venv-irsim/bin/python',linkforgePython:'/s/.venv-linkforge/bin/python',rest:['--ui-port','4175']});
}));
test('health: a live irsim_2d and both capabilities are required, mock backends stay exactly the mock set',()=>{
 const lock={sourceCommit:'c'.repeat(40),schemaHash:'s'};
 const b=(id:string,live=true)=>({id,enabled:live,installed:live,compatible:live,reachable:live});
 const health={...lock,protocolMajors:[1,2],capabilities:['engineering_bundle_v1','irsim_navigation_v1'],backends:[b('mock_amr'),b('mock_coffee'),b('mock_arm'),b('irsim_2d')]};
 expect(()=>checkIRSimHealth(health,lock)).not.toThrow();
 expect(()=>checkIRSimHealth({...health,backends:[...health.backends.slice(0,3),{...b('irsim_2d',false),reason:'IRSIM_WORKER_UNAVAILABLE'}]},lock)).toThrow('IRSIM_PROVIDER_UNAVAILABLE:IRSIM_WORKER_UNAVAILABLE');
 expect(()=>checkIRSimHealth({...health,capabilities:['engineering_bundle_v1']},lock)).toThrow('CAPABILITY_MISSING:irsim_navigation_v1');
 expect(()=>checkIRSimHealth({...health,backends:[...health.backends,b('gazebo_nav2')]},lock)).toThrow('NON_MOCK_BACKEND_ENABLED:gazebo_nav2');
});
test('every failed prerequisite exits 1 before any process starts: no runtime port, no UI, no mock fallback',()=>withTmp(async(tmp)=>{
 const root=join(tmp,'lab'),src=join(tmp,'source'),tools=await sourceTree(src);
 const ok=await fakePython(tmp,[3,11],{'ir-sim':'2.12.0',numpy:'2.1.0','linkforge-core':'1.6.0'});
 await mkdir(join(tmp,'py-empty'));const empty=await fakePython(join(tmp,'py-empty'),[3,11],{});
 const cases:[()=>Promise<void>,string[],RegExp][]=[
  [async()=>{await installed(root,tmp,undefined);},['--irsim-python',ok,'--linkforge-python',ok],/PORTABLE_TOOLS_NOT_IN_ARTIFACT/],
  [async()=>{await rm(join(tmp,'export'),{recursive:true});await installed(root,tmp,tools);await writeFile(join(src,'robotics/navigation-2d/irsim_worker/__main__.py'),'tampered');},['--irsim-python',ok,'--linkforge-python',ok],/PORTABLE_TOOLS_MISMATCH: robotics\/navigation-2d\/irsim_worker\/__main__.py:CHANGED/],
  [async()=>{await writeFile(join(src,'robotics/navigation-2d/irsim_worker/__main__.py'),'print(1)\n');},['--irsim-python',join(tmp,'none'),'--linkforge-python',ok],/IRSIM_PYTHON_MISSING/],
  [async()=>{},['--irsim-python',ok,'--linkforge-python',empty],/LINKFORGE_LOCK_MISMATCH:linkforge-core==1.6.0/],
 ];
 for(const [setup,args,error] of cases){
  await setup();const rp=await freePort(),up=await freePort();
  const r=run(['--root',root,'--source',src,'--data-dir',join(tmp,'runs'),'--runtime-port',String(rp),'--ui-port',String(up),...args]);
  expect(await r.exit,r.err).toBe(1);expect(r.err).toMatch(error);expect(r.out).not.toMatch(/Ready in/);
  expect(await listening(rp)).toBe(false);expect(await listening(up)).toBe(false);
 }
 const forbidden=run(['--root',root,'--source',src,'--runtime-port','1884','--ui-port',String(await freePort())]);
 expect(await forbidden.exit).toBe(1);expect(forbidden.err).toContain('FORBIDDEN_PORT:1884');
}),60000);
test('boot: verified tools reach the runtime as operator argv with both flags; an unavailable provider stops everything with its reason',()=>withTmp(async(tmp)=>{
 const root=join(tmp,'lab'),src=join(tmp,'source'),tools=await sourceTree(src);
 const ok=await fakePython(tmp,[3,11],{'ir-sim':'2.12.0',numpy:'2.1.0','linkforge-core':'1.6.0'});
 await installed(root,tmp,tools,true);
 const rp=await freePort(),up=await freePort(),data=join(tmp,'runs');
 const r=run(['--root',root,'--source',src,'--data-dir',data,'--runtime-port',String(rp),'--ui-port',String(up),'--irsim-python',ok,'--linkforge-python',ok,'--boot-only']);
 expect(await r.exit,r.err).toBe(0);expect(r.out).toContain('irsim_2d');expect(r.out).toMatch(/Ready in/);
 expect(JSON.parse(await readFile(join(data,'irsim-catalog/catalog.json'),'utf8')).components).toEqual([{file:`components/${'f'.repeat(64)}.json`,digest:'f'.repeat(64)}]);
 const seen=JSON.parse(await readFile(join(root,'runtime-args.json'),'utf8')) as {args:string[];flags:(string|null)[]};
 expect(seen.flags).toEqual(['1','1']);
 const arg=(k:string)=>seen.args[seen.args.indexOf(k)+1];
 expect(arg('--irsim-worker')).toBe(join(src,'robotics/navigation-2d'));expect(arg('--linkforge-worker')).toBe(join(src,'robotics/model-validation'));expect(arg('--irsim-lock')).toBe(join(src,'robotics/navigation-2d/requirements.lock'));
 expect(arg('--engineering-simulation')).toBe(join(src,'robotics/simulation'));expect(arg('--irsim-python')).toBe(ok);expect(arg('--engineering-catalog')).toBe(join(data,'irsim-catalog'));
 expect(await listening(rp)).toBe(false);expect(await listening(up)).toBe(false);
 await rm(join(tmp,'export'),{recursive:true});await installed(root,tmp,tools,false);
 const down=run(['--root',root,'--source',src,'--data-dir',data,'--runtime-port',String(await freePort()),'--ui-port',String(up),'--irsim-python',ok,'--linkforge-python',ok]);
 expect(await down.exit).toBe(1);expect(down.err).toContain('IRSIM_PROVIDER_UNAVAILABLE:IRSIM_WORKER_UNAVAILABLE');expect(down.out).not.toMatch(/Ready in/);expect(await listening(up)).toBe(false);
}),60000);
test('review5 #7: Ctrl-C during the venv preflight stops the probe and its children, and the launcher exits non-zero',()=>withTmp(async(tmp)=>{
 const root=join(tmp,'lab'),src=join(tmp,'source'),tools=await sourceTree(src);await installed(root,tmp,tools);
 // a probe that never answers: records its own pid and a grandchild's, then waits
 const slow=join(tmp,'slow-python');await writeFile(slow,`#!/bin/sh\nsleep 60 &\necho $! > ${join(tmp,'grandchild.pid')}\necho $$ > ${join(tmp,'probe.pid')}\nwait\n`);await chmod(slow,0o755);
 const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
 for(const signal of ['SIGINT','SIGTERM'] as const){
  await rm(join(tmp,'probe.pid'),{force:true});await rm(join(tmp,'grandchild.pid'),{force:true});
  const child=spawn(process.execPath,[launcher,'--root',root,'--source',src,'--data-dir',join(tmp,'runs'),'--runtime-port',String(await freePort()),'--ui-port',String(await freePort()),'--irsim-python',slow,'--linkforge-python',slow],{cwd:lab,stdio:['ignore','pipe','pipe']});
  const exit=new Promise<number|null>(r=>child.once('exit',c=>r(c)));
  let pids:number[]=[];
  for(let i=0;i<100&&pids.length<2;i++){await new Promise(r=>setTimeout(r,100));pids=await Promise.all(['probe.pid','grandchild.pid'].map(f=>readFile(join(tmp,f),'utf8').then(Number,()=>NaN))).then(x=>x.filter(Number.isInteger));}
  expect(pids,signal).toHaveLength(2);expect(pids.every(alive)).toBe(true);
  child.kill(signal);
  expect(await exit,signal).toBe(signal==='SIGINT'?130:143);
  for(let i=0;i<50&&pids.some(alive);i++)await new Promise(r=>setTimeout(r,100));
  expect(pids.filter(alive),signal).toEqual([]);
 }
}),60000);
// review5 #6: planted bytecode beside a pinned source. Same name, same source mtime and size in its header, different body: Python would run it.
const irPython=join(lab,'../source/.venv-irsim/bin/python');
const PLANT=`import os,py_compile,sys
src=sys.argv[1];body=open(src,'rb').read();st=os.stat(src)
evil=b"raise SystemExit('planted bytecode ran')\\n";evil=evil+b'#'*(len(body)-len(evil)-1)+b'\\n'
open(src,'wb').write(evil);os.utime(src,ns=(st.st_atime_ns,st.st_mtime_ns))
py_compile.compile(src,cfile=os.path.join(os.path.dirname(src),'__pycache__',os.path.basename(src)[:-3]+'.cpython-%d%d.pyc'%sys.version_info[:2]))
open(src,'wb').write(body);os.utime(src,ns=(st.st_atime_ns,st.st_mtime_ns))`;
test.skipIf(!existsSync(irPython))('review5 #6: planted __pycache__ in a copy of the pinned closure: the launcher refuses it, and the interpreter flags run the source, never the bytecode',()=>withTmp(async(tmp)=>{
 const p=(await installedManifest(lab,JSON.parse(await readFile(join(lab,'config/source-runtime.lock.json'),'utf8')))).portableSimulationTools as Tools,src=join(tmp,'source');
 for(const f of p.closure.files){await mkdir(dirname(join(src,f.path)),{recursive:true});await copyFile(join(lab,'../source',f.path),join(src,f.path));}
 expect(await verifyPortableTree(p,src)).toEqual([]);
 const root=join(src,'robotics/navigation-2d'),target=join(root,'irsim_worker/__init__.py'),before=await readFile(target);
 const {execFileSync}=await import('node:child_process');
 execFileSync(irPython,['-I','-c',PLANT,target]);
 expect(await readFile(target)).toEqual(before);// every source hash still matches the pin
 // (1) the launcher's tree check fails closed on the bytecode, naming it
 expect(await verifyPortableTree(p,src)).toEqual(['robotics/navigation-2d/irsim_worker/__pycache__:BYTECODE']);
 // the attack is real: writing bytecode off is not reading it off
 const imp=(args:string[],env:Record<string,string>={},code='import irsim_worker')=>{try{execFileSync(irPython,[...args,'-c',code],{cwd:tmp,env:{PATH:'/usr/bin:/bin',...env},stdio:'pipe'});return 'source';}catch(e){return String((e as {stderr?:Buffer}).stderr).includes('planted bytecode ran')?'planted':String(e);}};
 expect(imp([],{PYTHONPATH:root,PYTHONDONTWRITEBYTECODE:'1'})).toBe('planted');
 // (2) with a private empty pycache prefix the interpreter compiles the source instead: the source runtime's env form and the launcher probe's -I form
 const empty=await mkdtemp(join(tmp,'pycache-'));
 expect(imp([],{PYTHONPATH:root,PYTHONDONTWRITEBYTECODE:'1',PYTHONPYCACHEPREFIX:empty})).toBe('source');
 expect(imp(['-I','-B','-X',`pycache_prefix=${empty}`],{},`import sys;sys.path.insert(0,${JSON.stringify(root)});import irsim_worker`)).toBe('source');
 expect(imp(['-I'],{},`import sys;sys.path.insert(0,${JSON.stringify(root)});import irsim_worker`)).toBe('planted');// -I alone ignores PYTHON* variables: the switches must be on the command line
 // a sourceless .pyc or a native extension in a tool root is refused too
 await writeFile(join(root,'irsim_worker/loose.pyc'),'x');await writeFile(join(root,'irsim_worker/ext.cpython-311-darwin.so'),'x');
 expect((await verifyPortableTree(p,src)).sort()).toEqual(['robotics/navigation-2d/irsim_worker/__pycache__:BYTECODE','robotics/navigation-2d/irsim_worker/ext.cpython-311-darwin.so:UNLISTED','robotics/navigation-2d/irsim_worker/loose.pyc:BYTECODE']);
}),60000);
test('review5 #6: the launcher refuses to start over a tool tree holding bytecode, with the offending path and how to clear it',()=>withTmp(async(tmp)=>{
 const root=join(tmp,'lab'),src=join(tmp,'source'),tools=await sourceTree(src);await installed(root,tmp,tools);
 const ok=await fakePython(tmp,[3,11],{'ir-sim':'2.12.0',numpy:'2.1.0','linkforge-core':'1.6.0'});
 await mkdir(join(src,'robotics/model-validation/linkforge_worker/__pycache__'));await writeFile(join(src,'robotics/model-validation/linkforge_worker/__pycache__/__main__.cpython-311.pyc'),'x');
 const rp=await freePort(),up=await freePort();
 const r=run(['--root',root,'--source',src,'--data-dir',join(tmp,'runs'),'--runtime-port',String(rp),'--ui-port',String(up),'--irsim-python',ok,'--linkforge-python',ok,'--boot-only']);
 expect(await r.exit,r.err).toBe(1);expect(r.err).toMatch(/PORTABLE_TOOLS_MISMATCH: robotics\/model-validation\/linkforge_worker\/__pycache__:BYTECODE/);expect(r.err).toMatch(/__pycache__/);
 expect(await listening(rp)).toBe(false);
}),30000);
test('review5 #6: the venv probe runs with bytecode reading and writing off (-I would ignore PYTHON* variables)',()=>withTmp(async(tmp)=>{
 const f=join(tmp,'python');await writeFile(f,`#!/bin/sh\nprintf '%s\\n' "$@" > ${join(tmp,'argv')}\necho '${JSON.stringify({version:[3,11],impl:'cpython',dists:{'ir-sim':'2.12.0',numpy:'2.1.0'}})}'\n`);await chmod(f,0o755);
 expect(await venvProblem(f,LOCK)).toBeNull();
 const argv=(await readFile(join(tmp,'argv'),'utf8')).split('\n');
 expect(argv.slice(0,3)).toEqual(['-I','-B','-X']);expect(argv[3]).toMatch(/^pycache_prefix=\/.+mekoniq-pycache-/);
}));
test('review6 B: a probe that exited but left a child holding its stdout: Ctrl-C still stops that child (the group outlives its leader)',()=>withTmp(async(tmp)=>{
 const root=join(tmp,'lab'),src=join(tmp,'source'),tools=await sourceTree(src);await installed(root,tmp,tools);
 const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
 // the third round's child ignores SIGTERM: only the SIGKILL escalation after the bounded wait ends it
 for(const [round,signal,stubborn] of [[0,'SIGINT',false],[1,'SIGTERM',false],[2,'SIGINT',true]] as const){
  const gp=join(tmp,`grandchild-${round}.pid`),pp=join(tmp,`probe-${round}.pid`),fake=join(tmp,`probe-${round}`);
  // the probe answers and exits at once; its background child keeps the probe's stdout open, so the probe's stream never closes
  await writeFile(fake,`#!/bin/sh\n${stubborn?"(trap '' TERM; exec sleep 60) &":'sleep 60 &'}\necho $! > ${gp}\necho $$ > ${pp}\necho '{"version":[3,11],"impl":"cpython","dists":{}}'\nexit 0\n`);await chmod(fake,0o755);
  const child=spawn(process.execPath,[launcher,'--root',root,'--source',src,'--data-dir',join(tmp,'runs'),'--runtime-port',String(await freePort()),'--ui-port',String(await freePort()),'--irsim-python',fake,'--linkforge-python',fake],{cwd:lab,stdio:['ignore','pipe','pipe']});
  const exit=new Promise<number|null>(r=>child.once('exit',c=>r(c)));
  let leader=NaN,grand=NaN;
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,50));leader=await readFile(pp,'utf8').then(Number,()=>NaN);grand=await readFile(gp,'utf8').then(Number,()=>NaN);if(Number.isInteger(leader)&&Number.isInteger(grand)&&!alive(leader))break;}
  expect([alive(leader),alive(grand)],signal).toEqual([false,true]);// the leader is gone, its group is not
  child.kill(signal);
  expect(await exit,signal).toBe(signal==='SIGINT'?130:143);
  for(let i=0;i<100&&alive(grand);i++)await new Promise(r=>setTimeout(r,100));
  const survived=alive(grand);if(survived)process.kill(grand,'SIGKILL');// never leave the fixture's own child behind, even on RED
  expect(survived,signal).toBe(false);
 }
}),60000);
