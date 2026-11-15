// Observer entrypoint inside the already-installed exact image. No network except private loopback.
import {performance} from 'node:perf_hooks';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,lstat,copyFile,open} from 'node:fs/promises';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {runProbeCommand} from './mujoco-probe-process.mjs';
import {sha256,probeFile,analyseWire,mujocoCases,assessCase} from './mujoco-probe-evidence.mjs';
const [id,out]=process.argv.slice(2),handoff=JSON.parse(await readFile('/probe/handoff.json','utf8')),python='/opt/venv-mujoco/bin/python';
const save=(name,value)=>writeFile(join(out,name),JSON.stringify(value)+'\n',{mode:0o600}),read=async p=>JSON.parse(await readFile(p,'utf8'));
const abort=new globalThis.AbortController();for(const s of ['SIGTERM','SIGINT'])process.once(s,()=>abort.abort());
await mkdir(out,{recursive:true});
async function engine(mode,seed){const dir=join(out,'engine');await mkdir(dir);return runProbeCommand(python,['-I','-B','/probe/mujoco-probe-engine.py',mode,dir,...seed!==undefined?[String(seed)]:[]],{out:dir,cwd:dir,timeoutMs:mode==='long_run'?300000:120000,signal:abort.signal});}
async function imageInventory(){
 if(sha256(await probeFile('/app','runtime.mjs'))!==handoff.subject.runtimeArtifactSha256)throw Error('IMAGE_RUNTIME_MISMATCH');
 const checked=[];
 for(const r of Object.values(handoff.refs).flat()){
  const path=handoff.refs.schema.includes(r)?'packages/contracts/schemas/'+r.sourcePath:r.sourcePath;
  if(!path.startsWith('robotics/simulation-mujoco/')&&!path.startsWith('packages/contracts/schemas/'))continue;
  const b=await probeFile('/app',path);if(sha256(b)!==r.sha256||b.length!==r.bytes)throw Error('IMAGE_CLOSURE_MISMATCH:'+path);checked.push({path,sha256:r.sha256,bytes:r.bytes});
 }
 const observed=[];async function walk(p){for(const name of await readdir('/app/'+p)){const q=p+'/'+name,s=await lstat('/app/'+q);if(s.isSymbolicLink())throw Error('IMAGE_TOOL_SYMLINK');if(s.isDirectory())await walk(q);else observed.push(q);}}
 await walk('robotics/simulation-mujoco');await walk('packages/contracts/schemas');
 if(observed.some(p=>!checked.some(r=>r.path===p)))throw Error('IMAGE_EXTRA_TOOL_FILE');
 const r=await engine('inventory');if(r.status!=='completed')throw Error('ENGINE_INVENTORY_FAILED');
 return {subject:handoff.subject,checked,osRelease:await readFile('/etc/os-release','utf8'),architecture:process.arch,node:process.version,engine:await read(join(out,'engine/engine.json'))};
}
async function business(spec){
 const data='/tmp/L01-'+id,key=randomBytes(24).toString('hex'),wirePath=join(out,'wire.jsonl'),base='http://127.0.0.1:39176/lab/v2';await mkdir(data);
 const stdout=await open(join(out,'runtime.stdout.log'),'wx'),stderr=await open(join(out,'runtime.stderr.log'),'wx');let logs=Promise.resolve(),runtimeClosed=false;
 const runtime=spawn(process.execPath,['--import','/probe/mujoco-probe-observer.mjs','/app/runtime.mjs','--bind','127.0.0.1','--port','39176','--data-dir',data,'--mujoco-python',python,'--mujoco-worker','/app/robotics/simulation-mujoco','--mujoco-lock','/app/robotics/simulation-mujoco/requirements.lock'],{env:{...process.env,MEKONIQ_LAB_ACCESS_KEY:key,L01_OBSERVER_FILE:wirePath,L01_OWNED_ROOT:data},stdio:['ignore','pipe','pipe']});
 runtime.stdout.on('data',b=>{logs=logs.then(()=>stdout.write(b));});runtime.stderr.on('data',b=>{logs=logs.then(()=>stderr.write(b));});runtime.once('close',()=>{runtimeClosed=true;});
 const closed=once(runtime,'close');let token,runDir,runId,raw,view,revision=0,action=0,injection=null,afterLossSteps=0,maxRssKiB=0;
 const requests=[],httpMs=[];
 const api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{origin:'http://127.0.0.1:4175','content-type':'application/json',...token?{authorization:'Bearer '+token}:{}},...body!==undefined?{body:JSON.stringify(body)}:{},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});const value=await r.json();if(!r.ok)throw Error(`HTTP_${r.status}:${JSON.stringify(value).slice(0,300)}`);return value;};
 const wire=async()=>{try{return (await readFile(wirePath,'utf8')).split('\n').filter(Boolean).map(s=>JSON.parse(s));}catch{return [];}};
 const memory=async()=>{let sum=0;for(const name of await readdir('/proc'))if(/^\d+$/.test(name))try{const status=await readFile('/proc/'+name+'/status','utf8');sum+=Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0);}catch{/* exited */}maxRssKiB=Math.max(maxRssKiB,sum);};
 try{
  let health;for(const deadline=Date.now()+60000;Date.now()<deadline;){try{health=await api('/health');break;}catch{abort.signal.throwIfAborted();if(runtimeClosed)throw Error('RUNTIME_EXITED');await new Promise(r=>setTimeout(r,200));}}
  if(!health||health.sourceCommit!==handoff.subject.sourceCommit||health.schemaHash!==handoff.subject.schemaHash)throw Error('RUNTIME_IDENTITY_MISMATCH');await save('health.json',health);
  token=(await api('/sessions','POST',{token:key})).sessionToken;if(!token)throw Error('PAIRING_FAILED');
  const project=await read('/app/robotics/simulation-mujoco/fixtures/xarm6-g2-v1/coffee-cell-project.json');
  view=await api('/runs','POST',{project,scenarioId:'MJ-BV01',scenarioRevision:1,seed:spec.seed,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-arm-v1',runtimeIdentity:{sourceCommit:health.sourceCommit,schemaHash:health.schemaHash}});runId=view.run.id;revision=view.run.runRevision;
  for(const d of await readdir(data)){try{const cp=await read(join(data,d,'run.json'));if(cp.runId===runId){runDir=join(data,d);break;}}catch{/* readiness dir */}}
  if(!runDir)throw Error('RUN_DIRECTORY_MISSING');
  const act=async(kind,payload={})=>{const actionId='native-'+(++action),r={actionId,kind,payload,received:false},t=performance.now();requests.push(r);await save('requests.json',requests);const next=await api('/runs/'+runId+'/actions','POST',{actionId,expectedRevision:revision,kind,payload});r.received=true;httpMs.push(performance.now()-t);revision=next.run.runRevision;await memory();return next;};
  view=await act('start');
  while(view.tick<10000&&['running','created','paused'].includes(view.run.status)){
   if(spec.kind==='worker_loss'&&!injection&&view.coffee?.jobs?.some(j=>j.status==='transferring')){
    const spawned=(await wire()).filter(e=>e.event==='spawn'&&e.runId===runId);if(spawned.length!==1||!Number.isInteger(spawned[0].pid))throw Error('OWNED_WORKER_UNOBSERVED');
    const pid=spawned[0].pid,cmd=(await readFile('/proc/'+pid+'/cmdline')).toString();
    if(!cmd.includes('mujoco_worker')||!cmd.includes(runDir))throw Error('WORKER_OWNERSHIP_MISMATCH');
    injection={kind:'owned_pid_sigkill',pid,atTick:view.tick,atMs:Number(process.hrtime.bigint())/1e6};await save('injection.json',injection);process.kill(pid,'SIGKILL');
   }
   abort.signal.throwIfAborted();view=await act('step',{ticks:spec.kind==='worker_loss'?5:50});
  }
  if(spec.kind==='worker_loss'&&injection)for(let i=0;i<5;i++){view=await act('step',{ticks:5});afterLossSteps++;}
  const report=await api('/runs/'+runId+'/report');await save('report.json',report);
  const traceBytes=await probeFile(runDir,report.arm.trace.path),propsBytes=await probeFile(runDir,report.arm.props.path);
  if(sha256(traceBytes)!==report.arm.trace.sha256||sha256(propsBytes)!==report.arm.props.sha256)throw Error('SUBJECT_TRACE_HASH_MISMATCH');
  await api('/runs/'+runId+'/archive','POST',{});
  // Give passive diagnostics time to finish after the subject closed its own worker; no pipe is paused.
  for(const deadline=Date.now()+3000;Date.now()<deadline;){const e=(await wire()).filter(e=>e.runId===runId);if(e.some(e=>e.event==='exit'))break;await new Promise(r=>setTimeout(r,20));}
  raw={scope:spec.scope,engineVersion:report.arm.armPlant.engineVersion,report,trace:JSON.parse(traceBytes),props:JSON.parse(propsBytes),checkpoint:await read(join(runDir,'run.json')),requests,httpMs,injection,afterLossSteps,maxRssKiB};
 }finally{
  if(!runtimeClosed)runtime.kill('SIGTERM');const kill=setTimeout(()=>{if(!runtimeClosed)runtime.kill('SIGKILL');},10000);await closed;clearTimeout(kill);await logs;await stdout.close();await stderr.close();
  // Retained journals are verified byte copies after the runtime closed, never the runtime's live originals.
  const copies=[];async function copy(source,target,path=''){await mkdir(target,{recursive:true});for(const name of await readdir(source)){const p=path?path+'/'+name:name,s=await lstat(join(source,name));if(s.isDirectory())await copy(join(source,name),join(target,name),p);else{const b=await probeFile(data,p);await copyFile(join(source,name),join(target,name));if(sha256(await probeFile(join(out,'runtime'),p))!==sha256(b))throw Error('RUNTIME_COPY_CHANGED');copies.push({path:'runtime/'+p,sha256:sha256(b),bytes:b.length});}}}
  await copy(data,join(out,'runtime'));await save('runtime-copies.json',{afterRuntimeClose:true,copies});
 }
 raw.checkpoint=await read(join(out,'runtime',runDir.slice(data.length+1),'run.json'));
 const events=(await wire()).filter(e=>e.runId===runId||e.event==='incomplete'),analysis=analyseWire(events);await save('run-wire.json',events);
 const missing=await lstat(wirePath+'.incomplete').then(()=>true,()=>false);const seal=await read(wirePath+'.seal');if(missing||seal.complete!==true||!analysis.valid)throw Error('WIRE_OBSERVATION_INCOMPLETE');
 raw.wire=events;raw.ipcMs=analysis.ipcMs;raw.workerObservation={maxActive:analysis.maxActive,spawned:analysis.spawned,afterLoss:injection?events.filter(e=>e.event==='spawn'&&e.atMs>injection.atMs).map(e=>e.pid):[]};
 return raw;
}
try{
 if(id==='inventory'){await save('result.json',await imageInventory());}
 else{
  const spec=mujocoCases().find(c=>c.id===id);if(!spec)throw Error('CASE_UNSUPPORTED');let raw;
  if(['business','worker_loss'].includes(spec.kind))raw=await business(spec);
  else{const r=await engine(spec.kind,spec.seed);if(r.status!=='completed')throw Error('ENGINE_CASE_INCOMPLETE');
   if(spec.kind==='m00'){const lines=(await readFile(join(out,'engine/stdout.log'),'utf8')).split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s));const trial=lines.find(r=>r.seed===spec.seed),trace=await read(join(out,'engine/trace-'+spec.seed+'.json'));raw={scope:spec.scope,engineVersion:lines[0]?.version,trial,trace,tickMs:trace.map(t=>t.ms),...await read(join(out,'engine/resource.json'))};}
   else raw=await read(join(out,'engine/result.json'));
  }
  await save('result.json',raw);const verdict=assessCase(spec,raw);await save('assertions.json',verdict);if(!verdict.passed)process.exitCode=1;
 }
}catch(e){await save('failure.json',{status:'failed',message:e.message,accepted:false});console.error(e.stack);process.exitCode=1;}
