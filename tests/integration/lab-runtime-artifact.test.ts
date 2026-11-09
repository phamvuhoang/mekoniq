import {expect,test} from 'vitest';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {mkdtemp,readFile,rm,copyFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const exec=promisify(execFile);
test('self-contained exported artifact opens its embedded SQLite migration away from the source checkout',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lab-artifact-'));
 let child:ReturnType<typeof spawn>|undefined;
 try{
  await exec(process.execPath,['scripts/export-lab-runtime.mjs',join(directory,'artifact'),'--allow-dirty']);
  const manifest=JSON.parse(await readFile(join(directory,'artifact/manifest.json'),'utf8'));
  expect(manifest.protocolMajor).toBe(2);expect(manifest.protocolMajors).toEqual([1,2]);expect(manifest.schemas).toEqual(expect.arrayContaining(['lab-project.schema.json','lab-project-v2.schema.json','cell-command.schema.json']));expect(manifest.artifactSha256).toBe(createHash('sha256').update(await readFile(join(directory,'artifact/runtime.mjs'))).digest('hex'));
  // portable (IR-SIM/LinkForge) tools are described apart from the Linux simulationTools/nativeTools, with a self-consistent closure and their locks inside it
  const native=JSON.stringify({simulationTools:manifest.simulationTools,nativeTools:manifest.nativeTools}),portable=manifest.portableSimulationTools;
  expect(manifest.simulationTools.requires).toContain('linux');expect(native).not.toContain('robotics/navigation-2d');
  expect(portable).toMatchObject({distribution:'separate',version:1,python:{implementation:'cpython',version:'3.11'}});
  expect(portable.closure.digest).toBe(createHash('sha256').update(JSON.stringify(portable.closure.files)).digest('hex'));
  const paths=portable.closure.files.map((f:{path:string})=>f.path);
  expect(paths).toEqual(expect.arrayContaining(['robotics/navigation-2d/irsim_worker/__main__.py','robotics/model-validation/linkforge_worker/__main__.py','robotics/simulation/compiler/description.py','robotics/navigation-2d/fixtures/serve-demo-v1/serve-project.json','packages/contracts/schemas/irsim-worker-v1.schema.json']));
  expect(paths.filter((p:string)=>/\/(tests|__pycache__|\.venv[^/]*)\//.test(p)||p.endsWith('.pyc'))).toEqual([]);
  for(const t of portable.tools.filter((t:{lock?:unknown})=>t.lock))expect(portable.closure.files.find((f:{path:string})=>f.path===t.lock.path).sha256).toBe(createHash('sha256').update(await readFile(t.lock.path)).digest('hex'));
  expect(portable.tools.map((t:{id:string})=>t.id)).toEqual(['irsim_worker','linkforge_worker','description_helper']);
  // C03 LFIR-17: each worker ships its license inventory inside the closure, next to its lock
  for(const t of portable.tools.filter((t:{lock?:unknown})=>t.lock)){expect(t.licenses.path,t.id).toBe(`${t.root}/licenses.json`);expect(portable.closure.files.find((f:{path:string})=>f.path===t.licenses.path).sha256).toBe(t.licenses.sha256);}
  expect(portable.roots).toEqual(['robotics/navigation-2d','robotics/model-validation','robotics/simulation/compiler','robotics/simulation/actors','robotics/simulation/worlds','packages/contracts/schemas']);expect(paths.every((p:string)=>portable.roots.some((r:string)=>p.startsWith(r+'/')))).toBe(true);
  expect((await readFile(join(directory,'artifact/manifest.json'))).length).toBeLessThan(65536);// the Lab importer's manifest limit
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
  child=spawn(process.execPath,[join(directory,'artifact/runtime.mjs'),'--port',String(port),'--data-dir',join(directory,'runs')],{cwd:directory,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr!.on('data',c=>stderr+=c);
  const stdout=await new Promise<string>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('ARTIFACT_START_TIMEOUT:'+stderr)),10000);child!.stdout!.on('data',c=>{text+=c;if(text.includes('Source:')){clearTimeout(timer);resolve(text);}});child!.once('exit',code=>{clearTimeout(timer);reject(new Error(`ARTIFACT_EXIT_${code}:${stderr}`));});});
  const token=/one use\): ([A-Za-z0-9_-]+)/.exec(stdout)![1]!,url=`http://127.0.0.1:${port}/lab/v1`;
  const health=await (await fetch(url+'/health')).json() as {sourceCommit:string;schemaHash:string};expect(health.sourceCommit).toBe(manifest.sourceCommit);expect(health.schemaHash).toBe(manifest.schemaHash);
  const health2=await (await fetch(`http://127.0.0.1:${port}/lab/v2/health`)).json() as {protocolMajors:number[];schemaHash:string;backends:{id:string;enabled:boolean}[];scenarioIds:string[]};expect(health2.protocolMajors).toEqual([1,2]);expect(health2.schemaHash).toBe(manifest.schemaHash);expect(health2.backends.filter(b=>b.enabled).map(b=>b.id)).toEqual(['mock_amr','mock_coffee','mock_arm']);expect(health2.scenarioIds).toEqual(['FD01','FD07','FD02','FD03','FD04','FD04-blocked','FD04-reopen','FD05-payload','FD05-battery','FD05-capability','FD05-binding','BV01','FD02-cups','CAMPAIGN-FD02-FD07-BV01-BV03','IR-FD01','IR-FD03','IR-FD04','IR-FD04-blocked','IR-FD07']);
  const headers:Record<string,string>={Origin:'http://127.0.0.1:4175','Content-Type':'application/json'};
  const paired=await fetch(url+'/sessions',{method:'POST',headers,body:JSON.stringify({token})});expect(paired.status).toBe(201);headers.Cookie=paired.headers.get('set-cookie')!.split(';')[0]!;headers['X-CSRF-Token']=(await paired.json() as {csrfToken:string}).csrfToken;
  const project={schemaVersion:1,id:'p1',name:'Artifact',revision:1,updatedAt:'2026-11-01T00:00:00Z',design:{id:'robot',revision:1,chassis:'service',trays:2,batteryAh:20,sensor:'lidar',payloadKg:0},world:{id:'world',revision:1,width:12,height:8,points:[{id:'kitchen',name:'Kitchen',kind:'kitchen',x:1,y:4},{id:'parking',name:'Parking',kind:'parking',x:1,y:1},{id:'table-1',name:'Table',kind:'table',x:5,y:2}],obstacles:[]}};
  const created=await fetch(url+'/runs',{method:'POST',headers,body:JSON.stringify({project,scenarioId:'S01',seed:1,sourceCommit:manifest.sourceCommit})});expect(created.status).toBe(201);const run=await created.json() as {id:string};
  const start=await fetch(url+'/runs/'+run.id+'/actions',{method:'POST',headers,body:JSON.stringify({actionId:'artifact-start',expectedRevision:0,kind:'start'})});expect(start.status).toBe(200);
  const report=await (await fetch(url+'/runs/'+run.id+'/report',{headers})).json() as {journal:unknown[];effects:{type:string;attempts:number}[]};expect(report.journal.length).toBeGreaterThanOrEqual(6);expect(report.effects.filter(e=>e.type==='robot.execute').reduce((n,e)=>n+e.attempts,0)).toBe(1);
 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise<void>(resolve=>child!.once('exit',()=>resolve()));}await rm(directory,{force:true,recursive:true});}
});
test('exporter refuses a bundle that is not standalone or embeds a secret',async()=>{
 // @ts-expect-error CLI JavaScript boundary
 const {auditBundle}=await import('../../scripts/lab-runtime-audit.mjs') as {auditBundle:(text:string)=>void};
 expect(()=>auditBundle('import fs from "fs";import {DatabaseSync} from "node:sqlite";const m=await import("node:path");')).not.toThrow();
 expect(()=>auditBundle('import pg from "pg";')).toThrow('NON_STANDALONE_IMPORT:pg');
 expect(()=>auditBundle('const m=await import("./local.mjs");')).toThrow('NON_STANDALONE_IMPORT:./local.mjs');
 expect(()=>auditBundle('const m=require("outside-package");')).toThrow('NON_STANDALONE_IMPORT:outside-package');
 expect(()=>auditBundle('const m=__require("outside-package");')).toThrow('NON_STANDALONE_IMPORT:outside-package');
 expect(()=>auditBundle('const m=require("node:fs");')).not.toThrow();
 expect(()=>auditBundle('const code = \'require("ajv/dist/runtime/validation_error")\';')).not.toThrow();
 expect(()=>auditBundle('// require("not-executed")\nconst code=`generated import("not-executed")`;')).not.toThrow();
 for(const payload of [{role:'service_role'},{iss:'x',role:'service_role'},{a:'xy',role:'service_role'}]){
  const jwt=`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.abcdefghijklmnopqrst`;
  expect(()=>auditBundle(`const k="${jwt}";`)).toThrow('SECRET_IN_ARTIFACT');
 }
 expect(()=>auditBundle('const k={"kty":"EC","d":"abcdefghijklmnopqrstuvwxy"};')).toThrow('SECRET_IN_ARTIFACT');
 expect(()=>auditBundle('const k="ghp_abcdefghijklmnopqrstuvwxyz1234567890";')).toThrow('SECRET_IN_ARTIFACT');
  // Construct a synthetic token at runtime so repository secret scanners do not mistake the fixture for a credential.
  const slackFixture=["xoxb", "0".repeat(12), "0".repeat(12), "synthetic".repeat(4)].join("-");
  expect(()=>auditBundle(`const k="${slackFixture}";`)).toThrow("SECRET_IN_ARTIFACT");
 expect(()=>auditBundle('const k="-----BEGIN EC PRIVATE KEY-----\\nMHcCAQEEIBexampleExampleExample";')).toThrow('SECRET_IN_ARTIFACT');
 expect(()=>auditBundle('const k="sb_secret_abcdefghijklmnopqrstu";')).toThrow('SECRET_IN_ARTIFACT');
 expect(()=>auditBundle('const k="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijkl";')).toThrow('SECRET_IN_ARTIFACT');
});

/** A throwaway git repo holding only the exporter scripts (the main checkout is never touched). */
async function scratchRepo(){
 const dir=await mkdtemp(join(tmpdir(),'lab-export-repo-')),tmp=join(dir,'tmp'),repo=join(dir,'repo');await mkdir(join(repo,'scripts'),{recursive:true});await mkdir(tmp);
 await mkdir(join(repo,'scripts/native-sim'),{recursive:true});
 for(const f of ['export-lab-runtime.mjs','lab-runtime-audit.mjs','native-sim/tool-identity.mjs'])await copyFile(join('scripts',f),join(repo,'scripts',f));
 await exec('git',['init','-q'],{cwd:repo});await writeFile(join(repo,'untracked.txt'),'dirty');
 return {dir,repo,tmp,run:(...args:string[])=>exec(process.execPath,['scripts/export-lab-runtime.mjs',join(dir,'out'),...args],{cwd:repo,env:{...process.env,TMPDIR:tmp}})};
}
test('exporter refuses a dirty checkout, and a failing --clean-checkout surfaces the real git error and leaks no temporary directory',async()=>{
 const r=await scratchRepo();
 try{
  await expect(r.run()).rejects.toThrow('CLEAN_SOURCE_CHECKOUT_REQUIRED');
  // no commit exists, so `git worktree add … HEAD` fails: that error must surface, not a masking `worktree remove` failure
  const failed=await r.run('--clean-checkout').then(()=>null,(e:{stderr:string})=>e.stderr);
  expect(failed).toMatch(/worktree add/);expect(failed).not.toMatch(/worktree remove/);
  expect(await readdir(r.tmp)).toEqual([]);
 }finally{await rm(r.dir,{recursive:true,force:true});}
});
test.runIf(process.env.LAB_V2_CLEAN_EXPORT==='1')('--clean-checkout exports committed HEAD: dirty false and sourceCommit equal to HEAD',async()=>{
 const out=await mkdtemp(join(tmpdir(),'lab-clean-export-'));
 try{
  await exec(process.execPath,['scripts/export-lab-runtime.mjs','--clean-checkout',join(out,'artifact')],{maxBuffer:1<<26});
  const manifest=JSON.parse(await readFile(join(out,'artifact/manifest.json'),'utf8')),head=(await exec('git',['rev-parse','HEAD'])).stdout.trim();
  expect(manifest).toMatchObject({dirty:false,sourceCommit:head});
 }finally{await rm(out,{recursive:true,force:true});}
},600000);
