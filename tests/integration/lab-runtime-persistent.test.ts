import {afterEach,expect,test,vi} from 'vitest';
import {SourceSession} from '../../packages/lab-runtime/src/v2/session';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
const roots:string[]=[],gateways:LabGateway[]=[];
afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of roots.splice(0))await rm(d,{recursive:true,force:true});});
const temp=async()=>{const d=await mkdtemp(join(tmpdir(),'b09-persistent-'));roots.push(d);return d;};
const start=(directory:string)=>startLabGateway({directory,port:0,sourceCommit:'test',schemaHash:'a'.repeat(64)});
test('a second runtime refuses the same data root before startup, and close releases ownership',async()=>{
 const directory=await temp(),a=await start(directory);gateways.push(a);let b:LabGateway|undefined;
 try{await expect(start(directory).then(g=>{b=g;return g;})).rejects.toThrow('LAB_DATA_DIR_BUSY');}finally{await b?.close();}
 await a.close();const c=await start(directory);gateways.push(c);expect((await fetch(c.url+'/lab/v2/health')).status).toBe(200);
});
test('corrupt ownership state fails closed and is never removed',async()=>{
 const directory=await temp();await writeFile(join(directory,'.runtime-owner.sqlite'),'uncertain');let g:LabGateway|undefined;
 try{await expect(start(directory).then(value=>{g=value;return value;})).rejects.toThrow('LAB_DATA_DIR_LOCK_INVALID');}finally{await g?.close();}
});
test('failed listener startup releases its root after cleanup',async()=>{
 const directory=await temp(),a=await start(await temp());gateways.push(a);
 await expect(startLabGateway({directory,port:Number(new URL(a.url).port),sourceCommit:'test',schemaHash:'a'.repeat(64)})).rejects.toThrow();
 const b=await start(directory);gateways.push(b);expect((await fetch(b.url+'/lab/v2/health')).status).toBe(200);
});

// Independent OS processes, same local filesystem. Container/PID namespaces are tested separately by WEB05.
test('cross-process race excludes a second runtime, SIGKILL releases lock, and interrupted runs reopen read-only',async()=>{
 const {fork}=await import('node:child_process'),{restaurant}=await import('../support/lab-v2');
 const directory=await temp(),bundle='tests/support/persistent-runtime-child.ts';
 const children:ReturnType<typeof fork>[]=[];
 const once=(child:ReturnType<typeof fork>,event:string)=>new Promise<unknown[]>(resolve=>child.once(event,(...values:unknown[])=>resolve(values)));
 const launch=async()=>{const child=fork(bundle,[directory],{stdio:['ignore','ignore','pipe','ipc'],execArgv:['--import','tsx']});children.push(child);const message=await Promise.race([once(child,'message').then(([m])=>m as {url?:string;token?:string;error?:string}),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('CHILD_START_TIMEOUT')),5000))]);return {child,...message};};
 const pair=async(p:{url?:string;token?:string})=>{const r=await fetch(p.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:p.token})});return {origin:'http://127.0.0.1:4175','content-type':'application/json',authorization:`Bearer ${(await r.json()).sessionToken}`};};
 try{
  const a=await launch();expect(a.url).toBeTruthy();const b=await launch();expect(b.error).toBe('LAB_DATA_DIR_BUSY');
  const h=await pair(a),post=async(path:string,body:unknown)=>{const r=await fetch(a.url+'/lab/v2'+path,{method:'POST',headers:h,body:JSON.stringify(body)});expect(r.status).toBeLessThan(300);return r.json();};
  const made=await post('/runs',{project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:42,mode:'mock',access:'simulated',backendSetId:'mock-amr',runtimeIdentity:{sourceCommit:'persistent-test',schemaHash:'a'.repeat(64)}}),path=`/runs/${made.run.id}`;
  const started=await post(path+'/actions',{actionId:'start',kind:'start',expectedRevision:0,payload:{}}),stepped=await post(path+'/actions',{actionId:'step',kind:'step',expectedRevision:started.run.runRevision,payload:{ticks:20}});expect(stepped.tick).toBe(20);
  const exited=once(a.child,'exit');a.child.kill('SIGKILL');await exited;
  const c=await launch();expect(c.url).toBeTruthy();const recovered=await fetch(c.url+'/lab/v2'+path+'/reclaim',{method:'POST',headers:await pair(c),body:JSON.stringify({proof:made.reclaimToken})});expect(recovered.status).toBe(200);const view=await recovered.json();expect(view.tick).toBe(20);expect(view.controlAccess).toBe('view_reconcile');expect(view.run.status).toBe('needs_attention');
  c.child.send('close');await once(c.child,'exit');
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}
},20000);
test('data ownership precedes provider preparation',async()=>{
 const directory=await temp();let release!:()=>void,prepared=false;
 const preparing=startLabGateway({port:0,directory,sourceCommit:'test',schemaHash:'a'.repeat(64),prepareV2:async()=>{prepared=true;await new Promise<void>(r=>release=r);return {};}});
 expect(prepared).toBe(true);await expect(start(directory)).rejects.toThrow('LAB_DATA_DIR_BUSY');release();const g=await preparing;gateways.push(g);
});

test('actual Mac portable MuJoCo arm closes via public gateway, releases only its worker, and reopens committed data without a world',async()=>{
 const {readFile}=await import('node:fs/promises'),{findReclaim}=await import('../../packages/lab-runtime/src/v2/reclaim-store'),{mujocoGateway,mujocoProcessScope,mujocoWorkers,removeMujocoDirs}=await import('../support/mujoco-arm');
 const directory=await temp();mujocoProcessScope.addDirectory(directory);let g:LabGateway|undefined;
 const open=()=>startLabGateway({port:0,directory,sourceCommit:'test',schemaHash:'a'.repeat(64),prepareV2:async()=>{const {sim}=await mujocoGateway();return {catalog:sim.catalog,enabledBackends:['mock_amr','mock_coffee','mock_arm',...sim.enabledBackends],simulationFactory:sim.simulationFactory,portableChecks:sim.readinessChecks};}});
 const pair=async(g:LabGateway)=>{const r=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.pairingToken})});return {origin:'http://127.0.0.1:4175','content-type':'application/json',authorization:`Bearer ${(await r.json()).sessionToken}`};};
 try{
  g=await open();let h=await pair(g);const post=async(path:string,body:unknown)=>{const r=await fetch(g!.url+'/lab/v2'+path,{method:'POST',headers:h,body:JSON.stringify(body)});const value=await r.json();expect(r.status,JSON.stringify(value)).toBeLessThan(300);return value;};
  const awaitableProject=await readFile('robotics/simulation-mujoco/fixtures/xarm6-g2-v1/coffee-cell-project.json','utf8');
  const made=await mujocoProcessScope.observe(()=>post('/runs',{project:JSON.parse(awaitableProject),scenarioId:'MJ-BV01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-arm-v1',runtimeIdentity:{sourceCommit:'test',schemaHash:'a'.repeat(64)}}));
  const path=`/runs/${made.run.id}`,started=await mujocoProcessScope.observe(()=>post(path+'/actions',{actionId:'start',kind:'start',expectedRevision:0,payload:{}}));
  const stepped=await post(path+'/actions',{actionId:'step',kind:'step',expectedRevision:started.run.runRevision,payload:{ticks:20}});expect(stepped.tick).toBe(20);expect(mujocoWorkers()).toHaveLength(1);
  const report=await (await fetch(g.url+'/lab/v2'+path+'/report',{headers:h})).json();expect(report.outcome.tick).toBe(20);
  const stored=await findReclaim(directory,made.run.id),beforeCheckpoint=JSON.parse(await readFile(join(stored!.directory,'run.json'),'utf8')),sceneBefore=await readFile(join(stored!.directory,'mujoco-arm/bundle/arm-cell-scene.json'),'utf8');
  const closing=g.close();await expect(start(directory)).rejects.toThrow('LAB_DATA_DIR_BUSY');await Promise.race([closing,new Promise((_,reject)=>setTimeout(()=>reject(Error('WORKER_CLOSE_TIMEOUT')),5000))]);expect(mujocoWorkers()).toEqual([]);
  g=await open();h=await pair(g);const reclaimed=await post(path+'/reclaim',{proof:made.reclaimToken});expect(reclaimed.tick).toBe(20);expect(reclaimed.controlAccess).toBe('view_reconcile');expect(reclaimed.entities.every((e:{quality:string})=>e.quality==='stale')).toBe(true);expect(mujocoWorkers()).toEqual([]);
  await post(path+'/reclaim',{proof:made.reclaimToken});expect(mujocoWorkers()).toEqual([]);const checkpoint=JSON.parse(await readFile(join(stored!.directory,'run.json'),'utf8'));expect(checkpoint.coffee.arm).toEqual(beforeCheckpoint.coffee.arm);expect(await readFile(join(stored!.directory,'mujoco-arm/bundle/arm-cell-scene.json'),'utf8')).toBe(sceneBefore);
  const after=await (await fetch(g.url+'/lab/v2'+path+'/report',{headers:h})).json();expect(after.outcome.tick).toBe(20);expect(after.manifest.sourceCommit).toBe(report.manifest.sourceCommit);
  console.log('B09 actual portable arm',JSON.stringify({platform:process.platform,arch:process.arch,tick:20,workerPidsAfterClose:mujocoWorkers(),scope:'Mac portable worker; not WEB05 container/native-amd64',accepted:false}));
 }finally{await g?.close();await removeMujocoDirs();}
},60000);

test('reclaim-only creation refuses an empty root rather than creating any simulated run',async()=>{
 const {createScenarioRun}=await import('../../packages/lab-runtime/src/v2/scenario-runner'),{manifestFor}=await import('../support/lab-v2');
 await expect(createScenarioRun(manifestFor('FD01',{seed:1}),{directory:await temp(),enabledBackends:['mock_amr'],reclaimOnly:true})).rejects.toThrow('RECOVERY_CHECKPOINT_MISSING');
});
for(const missing of ['coffee','arm','arm.q','arm.bootId','plant'] as const)test(`explicit arm reclaim refuses missing ${missing} before opening Source or changing retained bytes`,async()=>{
 const {readFile,readdir}=await import('node:fs/promises'),{createScenarioRun}=await import('../../packages/lab-runtime/src/v2/scenario-runner'),{manifestFor,coffeeProject,amrAsset,COFFEE_BACKENDS}=await import('../support/lab-v2');
 const directory=await temp(),input={...manifestFor('BV01',{seed:1,project:coffeeProject()}),backendSetId:'mock-default'},providers={directory,assets:[amrAsset],enabledBackends:COFFEE_BACKENDS};
 const original=await createScenarioRun(input,providers);await original.close();const path=join(directory,'run.json'),cp=JSON.parse(await readFile(path,'utf8'));
 if(missing==='coffee')delete cp.coffee;else if(missing==='arm.q')delete cp.coffee.arm.q;else if(missing==='arm.bootId')delete cp.coffee.arm.bootId;else delete cp.coffee[missing];
 const bytes=JSON.stringify(cp);await writeFile(path,bytes);const journal=await readFile(join(directory,'journal.db')),files=await readdir(directory),opening=vi.spyOn(SourceSession,'open');let unexpected:Awaited<ReturnType<typeof createScenarioRun>>|undefined;
 try{await expect(createScenarioRun(input,{...providers,reclaimOnly:true}).then(run=>{unexpected=run;return 'RECOVERY_ACCEPTED';})).rejects.toThrow('RECOVERY_STATE_INVALID');expect(opening).not.toHaveBeenCalled();expect(await readFile(path,'utf8')).toBe(bytes);expect((await readFile(join(directory,'journal.db'))).equals(journal)).toBe(true);expect(await readdir(directory)).toEqual(files);}finally{opening.mockRestore();await unexpected?.close();}
});
test('an unwritable or symlinked data root is refused before any provider setup',async()=>{
 const {chmod,symlink}=await import('node:fs/promises'),directory=await temp();let prepared=false;
 await chmod(directory,0o500);try{await expect(startLabGateway({port:0,directory,sourceCommit:'test',schemaHash:'a'.repeat(64),prepareV2:async()=>{prepared=true;return {};}})).rejects.toThrow('LAB_DATA_DIR_UNWRITABLE');expect(prepared).toBe(false);}finally{await chmod(directory,0o700);}
 const linked=join(await temp(),'link');await symlink(directory,linked);await expect(start(linked)).rejects.toThrow('LAB_DATA_DIR_INVALID');
});
