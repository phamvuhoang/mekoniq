import {afterEach,expect,test} from 'vitest';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runSilScenario} from '../../packages/lab-runtime/src/v2/sil/campaign';
import {readCompiledWorld,startGazeboBackend,StdioWorkerPort} from '../../packages/lab-runtime/src/v2/backends/gazebo-nav2';
import {FakeWorkerPort,compiledWorld} from '../support/sil-rig';
import {restaurant,corridor} from '../support/lab-v2';
import type {JsonObject} from '../../packages/contracts/src/index';
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function directory(){const d=await mkdtemp(join(tmpdir(),'sil-review-'));dirs.push(d);return d;}
test('compiled handoff pose, yaw and map identity reach the production adapter unchanged',async()=>{
 const out=await directory(),bundle=join(out,'bundle'),fixture=resolve('tests/fixtures/digital-twin/restaurant-v2.json');
 execFileSync(resolve('.venv/bin/python'),['-B','-m','compiler','--fixture',fixture,'--out',bundle,'--map-id','review-map'],{cwd:resolve('robotics/simulation')});
 const world=await readCompiledWorld(bundle),project=JSON.parse(await readFile(fixture,'utf8')).project;
 const compiled=JSON.parse(await readFile(join(bundle,'bindings.json'),'utf8')),targets:JsonObject[]=[];
 const result=await runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:17,project,sourceCommit:'test',outDir:out,world,backendSetId:'simulation-default',maxIterations:6000,paceMs:0,
  backendFactory:async(w,id)=>{const port=new FakeWorkerPort({nativeResult:'completed'}),request=port.request.bind(port);port.request=async(op,a)=>{if(op==='execute')targets.push(a.target as JsonObject);return request(op,a);};return startGazeboBackend(w,id,{port});}});
 expect(targets.find(t=>t.waypointId==='table-1')).toEqual(Object.fromEntries(['waypointId','mapId','mapRevision','frame','x','y','yaw'].map(k=>[k,compiled.bindings['table-1'][k]])));
 expect(result.manifest.status).toBe('completed');
});
for(const barrier of ['missing','error','late','wrong-participant'] as const)for(const transfer of [1,2])test(`${barrier} barrier ACK at transfer ${transfer} preserves unresolved custody`,async()=>{
 const out=await directory();let calls=0;
 const result=await runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:17,project:restaurant(),sourceCommit:'test',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:300,paceMs:0,
  backendFactory:async(w,id)=>{const port=new FakeWorkerPort({nativeResult:'completed'}),request=port.request.bind(port);port.request=async(op,a)=>{
   if(op==='barrier'&&++calls===transfer){if(barrier==='error')throw new Error('LINK_LOST');if(barrier==='late')return new Promise(()=>{});return {barrierId:a.barrierId,acks:barrier==='missing'?[]:[{participant:'intruder',clockNs:'1',simTimeNs:'1'}]};}return request(op,a);};return startGazeboBackend(w,id,{port});}});
 expect(result.manifest.status).toBe('needs_attention');expect(result.business.served).toBe('0');
 const events=(JSON.parse(await readFile(join(out,'journal.json'),'utf8')) as {events:{type:string;state:JsonObject}[]}[]).flatMap(j=>j.events);
 expect(events.filter(e=>e.type==='CargoLoaded')).toHaveLength(transfer-1);expect(events.filter(e=>e.type==='DeliveryHandedOff')).toHaveLength(0);
 const records=JSON.parse(await readFile(join(out,'barriers.json'),'utf8'));
 expect(JSON.stringify(records)).toContain('amr-1');expect(JSON.stringify(records)).toContain('pending');
});
test('a delayed asynchronous barrier ACK is consumed without blocking the campaign loop',async()=>{
 const out=await directory();
 const result=await runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:17,project:restaurant(),sourceCommit:'test',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:6000,paceMs:0,
  backendFactory:async(w,id)=>{const port=new FakeWorkerPort({nativeResult:'completed'}),request=port.request.bind(port);port.request=async(op,a)=>{if(op==='barrier'){setTimeout(()=>port.emit('barrier',{barrierId:a.barrierId,participant:'robot_amr_1',clockNs:'1',simTimeNs:'1'}),5);return {barrierId:a.barrierId,acks:[]};}return request(op,a);};return startGazeboBackend(w,id,{port});}});
 expect(result.manifest.status).toBe('completed');expect(result.business.served).toBe('1');
 const barriers=JSON.parse(await readFile(join(out,'barriers.json'),'utf8'));expect(JSON.stringify(barriers)).not.toContain('pending');
});
test('backend capability waits through bounded warmup instead of caching the first not-ready response',async()=>{
 const port=new FakeWorkerPort({nativeResult:'completed'}),request=port.request.bind(port);let calls=0;
 port.request=async(op,a)=>op==='capability'&&++calls<3?{available:false,reasons:['CLOCK_MISSING'],evidence:'none'}:request(op,a);
 const backend=await startGazeboBackend(compiledWorld(await directory()),'warmup',{port,startupTimeoutMs:100,startupPollMs:1});
 try{expect((await backend.capability()).available).toBe(true);expect(calls).toBe(3);}finally{await backend.close();}
});
test('an earlier live sensor and clearance cannot hide later lost coverage',async()=>{
 const out=await directory();let port!:FakeWorkerPort;
 const result=await runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:17,project:restaurant(),sourceCommit:'test',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:6000,paceMs:0,
  backendFactory:async(w,id)=>{port=new FakeWorkerPort({nativeResult:'completed',capability:{evidence:'sil'},scene:{robots:w.robots,liveness:true}});port.runId=id;const request=port.request.bind(port);port.request=async(op,a)=>{const reply=await request(op,a);if(op==='query'&&port.queryCalls>1)port.emit('contact-sensor',{robot:'amr-1',alive:false,sourceReceivedMonotonicNs:'1',sourceSimTimeNs:'1',sensorSequence:'1'});return reply;};return startGazeboBackend(w,id,{port});}});
 expect(result.assertions.find(a=>a.id==='SIM.no-contact')).toMatchObject({result:'not_run',reason:'PHYSICS_EVIDENCE_MISSING'});expect(JSON.parse(await readFile(join(out,'contacts.json'),'utf8')).physicsAssessment.find((a:{id:string})=>a.id==='SIM.no-contact')).toMatchObject({result:'not_run',reason:'CONTACT_SENSOR_COVERAGE_GAP:amr-1'});
 const evidence=JSON.parse(await readFile(join(out,'contacts.json'),'utf8'));expect(evidence.sensorReports.some((s:JsonObject)=>s.alive===false&&s.sourceReceivedMonotonicNs==='1')).toBe(true);
});
test('barrier deadline advances while its worker request never answers',async()=>{
 const out=await directory();
 const result=await runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:17,project:restaurant(),sourceCommit:'test',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:6000,paceMs:0,barrierTimeoutMs:5,
  backendFactory:async(w,id)=>{const port=new FakeWorkerPort({nativeResult:'completed'}),request=port.request.bind(port);port.request=async(op,a)=>op==='barrier'?new Promise(()=>{}):request(op,a);return startGazeboBackend(w,id,{port});}});
 expect(result.manifest.status).toBe('needs_attention');expect(result.business.served).toBe('0');
 expect(JSON.parse(await readFile(join(out,'barriers.json'),'utf8'))).toEqual([expect.objectContaining({status:'timeout',missing:['amr-1']})]);
});
test('startup expires even when the worker capability request never returns',async()=>{
 const port=new FakeWorkerPort({nativeResult:'completed'}),request=port.request.bind(port);
 port.request=async(op,a)=>op==='capability'?new Promise(()=>{}):request(op,a);
 const backend=await startGazeboBackend(compiledWorld(await directory()),'timeout',{port,startupTimeoutMs:5,startupPollMs:1});
 try{expect(await backend.capability()).toMatchObject({available:false,evidence:'none',reasons:['WORKER_UNAVAILABLE:STARTUP_TIMEOUT']});}finally{await backend.close();}
 expect(port.closed).toBe(1);
});
test('a late ACK cannot race the barrier deadline before the next main-loop tick',async()=>{
 const {createBarrierCoordinator}=await import('../../packages/lab-runtime/src/v2/backends/clock-barrier');let now=0n;
 const coordinator=createBarrierCoordinator({monotonicNs:()=>now,timeoutNs:5n});
 const outcome=coordinator.awaitTransferBarrier('late',['amr-1']);const rejected=expect(outcome).rejects.toThrow('BARRIER_TIMEOUT');
 now=6n;coordinator.ack('late','amr-1',{clockNs:'1',simTimeNs:'1'});
 await rejected;expect(coordinator.records()[0]).toMatchObject({status:'timeout',acks:[],missing:['amr-1']});
});
test('a recorded collision remains a failure when contact coverage is later lost',async()=>{
 const out=await directory();
 const result=await runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:17,project:restaurant(),sourceCommit:'test',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:6000,paceMs:0,
  backendFactory:async(w,id)=>{const port=new FakeWorkerPort({nativeResult:'completed',capability:{evidence:'sil'},scene:{robots:w.robots,liveness:true,contacts:[{pair:['amr-1','wall']}]}});port.runId=id;const request=port.request.bind(port);port.request=async(op,a)=>{const reply=await request(op,a);if(op==='query')port.emit('contact-sensor',{robot:'amr-1',alive:false});return reply;};return startGazeboBackend(w,id,{port});}});
 expect(result.manifest.evidence).toBe('protocol_double');expect(result.assertions.find(a=>a.id==='SIM.no-contact')).toMatchObject({result:'not_run',reason:'PHYSICS_EVIDENCE_MISSING'});expect(JSON.parse(await readFile(join(out,'contacts.json'),'utf8')).physicsAssessment.find((a:{id:string})=>a.id==='SIM.no-contact')).toMatchObject({result:'fail',reason:'CONTACT'});
});

test('a recorded overlap remains a failure when pose coverage is later lost',async()=>{
 const out=await directory(),robots=[{entityId:'amr-a',namespace:'robot_amr_a'},{entityId:'amr-b',namespace:'robot_amr_b'}];
 const result=await runSilScenario({scenarioId:'FD07',scenarioRevision:1,seed:17,project:corridor(),sourceCommit:'test',outDir:out,world:compiledWorld(out,robots),backendSetId:'simulation-default',maxIterations:6000,paceMs:0,
  backendFactory:async(w,id)=>{const port=new FakeWorkerPort({nativeResult:'completed',capability:{evidence:'sil'},scene:{robots:w.robots,liveness:true,gapM:0}});port.runId=id;const request=port.request.bind(port);port.request=async(op,a)=>{const reply=await request(op,a);if(op==='query')port.emit('telemetry',{entityId:'amr-a',quality:'stale'});return reply;};return startGazeboBackend(w,id,{port});}});
 expect(result.manifest.evidence).toBe('protocol_double');expect(result.assertions.find(a=>a.id==='SIM.min-separation')).toMatchObject({result:'not_run',reason:'PHYSICS_EVIDENCE_MISSING'});expect(JSON.parse(await readFile(join(out,'contacts.json'),'utf8')).physicsAssessment.find((a:{id:string})=>a.id==='SIM.min-separation')).toMatchObject({result:'fail',reason:'FOOTPRINT_OVERLAP'});
});

test('real stdio capability replies can outlive the normal request timeout within startup budget',async()=>{
 const child=spawn(process.execPath,['-e',`
  require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
   const m=JSON.parse(line);
   const reply=()=>process.stdout.write(JSON.stringify({id:m.id,ok:true,result:m.op==='capability'?{available:true,evidence:'protocol_double',reasons:[],robots:['robot_amr_1']}:{closed:true}})+'\\n');
   if(m.op==='capability'||m.op==='query')setTimeout(reply,100);else reply();
  });
 `],{stdio:['pipe','pipe','inherit'],shell:false});
 const port=new StdioWorkerPort(child,20);
 try{
  const backend=await startGazeboBackend(compiledWorld(await directory()),'slow-health',{port,startupTimeoutMs:500,startupPollMs:1});
  expect(await backend.capability()).toMatchObject({available:true,evidence:'protocol_double'});
  // The longer readiness deadline must not permanently extend ordinary command deadlines.
  await expect(port.request('query',{commandId:'none',robotId:'robot_amr_1'})).rejects.toThrow('WORKER_TIMEOUT');
 }finally{await port.close();}
});
test('actual Python SceneLoop telemetry passes the canonical validator and gateway ingest',async()=>{
 const {validateTwinSampleV2}=await import('../../packages/lab-runtime/src/v2/contracts');
 const {createTelemetryIngest}=await import('../../packages/lab-runtime/src/v2/backends/telemetry-ingest');
 const {TelemetryRecorder}=await import('../../packages/lab-runtime/src/v2/telemetry');
 const runId='3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c';
 const events=JSON.parse(execFileSync(resolve('.venv/bin/python'),['-B','-c',`
import json,time
from types import SimpleNamespace
from bridge.scene_loop import SceneLoop
clock=[0]
pose={'value':{'position':{'x':1.,'y':2.,'z':0.},'orientation':{'x':0.,'y':0.,'z':0.,'w':1.}},'simTimeNs':0,'receivedMonotonicNs':time.monotonic_ns(),'sequence':1}
poses={'robot_amr_1':pose}
ports=SimpleNamespace(clock_ns=lambda:clock[0],poses=lambda:poses,contacts=lambda:{})
events=[]
loop=SceneLoop(ports,{'seed':0,'actors':[],'blockers':[],'faults':[]},[{'namespace':'robot_amr_1','entityId':'amr-1','footprint':{'min':[-.3,-.3],'max':[.3,.3]}}],run_id='${runId}',boot_id='worker-1',emit=lambda event,payload:events.append({'event':event,'payload':payload}))
loop.step()
clock[0]=60_000_000_000
loop.step()
poses.clear()
clock[0]+=20_000_000
loop.step()
print(json.dumps(events))
 `],{cwd:resolve('robotics/simulation'),encoding:'utf8'})) as {event:string;payload:JsonObject}[];
 const samples=events.filter(e=>e.event==='telemetry').map(e=>e.payload),recorder=new TelemetryRecorder(),ingest=createTelemetryIngest(recorder,{runId,monotonicNs:()=>1n});
 expect(samples).toHaveLength(3);expect(samples.map(s=>s.quality)).toEqual(['valid','stale','unknown']);
 for(const sample of samples){expect(validateTwinSampleV2(sample)).toMatchObject({ok:true});expect(ingest.accept(sample).status).toBe('accepted');}
 const receipts=events.filter(e=>e.event==='pose-sensor').map(e=>e.payload);
 expect(receipts).toHaveLength(3);expect(receipts[0]).toMatchObject({entityId:'amr-1',sourceSimTimeNs:'0',sensorSequence:'1'});
 expect(receipts[1]!.sourceReceivedMonotonicNs).toBe(receipts[0]!.sourceReceivedMonotonicNs);
 const out=await directory();
 await runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:17,project:restaurant(),sourceCommit:'test',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:6000,paceMs:0,
  backendFactory:async(w,id)=>{const port=new FakeWorkerPort({nativeResult:'completed'}),request=port.request.bind(port);let sent=false;
   port.request=async(op,a)=>{const reply=await request(op,a);if(op==='query'&&!sent){sent=true;for(const e of events)port.emit(e.event,e.event==='telemetry'?{...e.payload,runId:id}:e.payload);}return reply;};return startGazeboBackend(w,id,{port});}});
 const artifact=JSON.parse(await readFile(join(out,'telemetry.json'),'utf8'));
 expect(artifact.ingest).toMatchObject({accepted:3,rejected:0});
 expect(artifact.samples.map((sample:JsonObject)=>sample.quality)).toEqual(['valid','stale','unknown']);
 expect(artifact.sensorReports).toEqual(receipts);
});
