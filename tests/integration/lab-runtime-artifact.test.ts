import {expect,test} from 'vitest';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
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
  expect(manifest.protocolMajor).toBe(1);expect(manifest.artifactSha256).toBe(createHash('sha256').update(await readFile(join(directory,'artifact/runtime.mjs'))).digest('hex'));
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
  child=spawn(process.execPath,[join(directory,'artifact/runtime.mjs'),'--port',String(port),'--data-dir',join(directory,'runs')],{cwd:directory,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr!.on('data',c=>stderr+=c);
  const stdout=await new Promise<string>((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('ARTIFACT_START_TIMEOUT:'+stderr)),10000);child!.stdout!.on('data',c=>{text+=c;if(text.includes('Source:')){clearTimeout(timer);resolve(text);}});child!.once('exit',code=>{clearTimeout(timer);reject(new Error(`ARTIFACT_EXIT_${code}:${stderr}`));});});
  const token=/one use\): ([A-Za-z0-9_-]+)/.exec(stdout)![1]!,url=`http://127.0.0.1:${port}/lab/v1`;
  const health=await (await fetch(url+'/health')).json() as {sourceCommit:string;schemaHash:string};expect(health.sourceCommit).toBe(manifest.sourceCommit);expect(health.schemaHash).toBe(manifest.schemaHash);
  const headers:Record<string,string>={Origin:'http://127.0.0.1:4175','Content-Type':'application/json'};
  const paired=await fetch(url+'/sessions',{method:'POST',headers,body:JSON.stringify({token})});expect(paired.status).toBe(201);headers.Cookie=paired.headers.get('set-cookie')!.split(';')[0]!;headers['X-CSRF-Token']=(await paired.json() as {csrfToken:string}).csrfToken;
  const project={schemaVersion:1,id:'p1',name:'Artifact',revision:1,updatedAt:'2026-11-01T00:00:00Z',design:{id:'robot',revision:1,chassis:'service',trays:2,batteryAh:20,sensor:'lidar',payloadKg:0},world:{id:'world',revision:1,width:12,height:8,points:[{id:'kitchen',name:'Kitchen',kind:'kitchen',x:1,y:4},{id:'parking',name:'Parking',kind:'parking',x:1,y:1},{id:'table-1',name:'Table',kind:'table',x:5,y:2}],obstacles:[]}};
  const created=await fetch(url+'/runs',{method:'POST',headers,body:JSON.stringify({project,scenarioId:'S01',seed:1,sourceCommit:manifest.sourceCommit})});expect(created.status).toBe(201);const run=await created.json() as {id:string};
  const start=await fetch(url+'/runs/'+run.id+'/actions',{method:'POST',headers,body:JSON.stringify({actionId:'artifact-start',expectedRevision:0,kind:'start'})});expect(start.status).toBe(200);
  const report=await (await fetch(url+'/runs/'+run.id+'/report',{headers})).json() as {journal:unknown[];effects:{type:string;attempts:number}[]};expect(report.journal.length).toBeGreaterThanOrEqual(6);expect(report.effects.filter(e=>e.type==='robot.execute').reduce((n,e)=>n+e.attempts,0)).toBe(1);
 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise<void>(resolve=>child!.once('exit',()=>resolve()));}await rm(directory,{force:true,recursive:true});}
});
