import {afterEach,expect,test,vi} from 'vitest';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClock,TICK_MS} from '../../packages/lab-runtime/src/v2/clock';
import {actorStream,PRNG} from '../../packages/lab-runtime/src/v2/random';
import {canonicalOutcome} from '../../packages/lab-runtime/src/v2/report';
import {scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {instantiateBackends} from '../../packages/lab-runtime/src/v2/backend-registry';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {validateRunSnapshotV2} from '../../packages/lab-runtime/src/v2/contracts';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {act,amrAsset,amrRef,cleanupRuns,coffeeProject,executeFixture,openFixture,restaurant,stepUntil} from '../support/lab-v2';
afterEach(cleanupRuns);
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
type Report=Awaited<ReturnType<typeof executeFixture>>;
const types=(r:Report)=>r.businessEvents.map(e=>e.type);

test('FD01: same seed and inputs give the same canonical outcome, built from journal events and three observed legs',async()=>{
 const first=await executeFixture('FD01',{seed:42});
 const second=await executeFixture('FD01',{seed:42});
 expect(canonicalOutcome(first)).toEqual(canonicalOutcome(second));
 expect(first.businessEvents.some(e=>e.type==='RobotCommandObserved')).toBe(true);
 expect(first.outcome.status).toBe('completed');expect(first.outcome.served).toBe('1');
 // Served only after the handoff confirmation; arrival only from adapter observations.
 const t=types(first);expect(t.indexOf('CargoLoaded')).toBeLessThan(t.indexOf('DeliveryHandedOff'));
 expect(t.filter(x=>x==='MissionArrived')).toHaveLength(3);
 expect(first.effects.filter(e=>e.type==='robot.execute').map(e=>[e.status,e.attempts])).toEqual([['confirmed',1],['confirmed',1],['confirmed',1]]);
 // The journal is the event source: every business event carries the journal sequence it was committed in.
 expect(first.businessEvents.every(e=>/^[0-9]+$/.test(e.sequence))).toBe(true);
 expect(first.manifest.backends).toEqual([{id:'mock_amr',version:'1',model:'mock_kinematic',dynamics:false}]);
 expect(first.manifest.clock).toEqual({tickMs:20});expect(first.manifest.prng).toEqual(PRNG);
 expect(first.manifest.runId).not.toBe(second.manifest.runId);
 // Robot returns to its parking point, not to a dock/charger.
 expect(first.entities[0]).toMatchObject({id:'amr-1',pose:{x:1,y:1}});
 expect(first.metrics.collision).toMatchObject({available:true,contacts:0});expect(first.metrics.collision.minSeparationM).toBeNull();
});

test('entity IDs map deterministically from scenario ordinals; canonical outcome holds no runtime UUID',async()=>{
 const a=await executeFixture('FD01',{seed:7}),b=await executeFixture('FD01',{seed:7});
 expect(a.businessEvents.map(e=>`${e.kind}/${e.id}`)).toEqual(b.businessEvents.map(e=>`${e.kind}/${e.id}`));
 expect(JSON.stringify(a.businessEvents)).toMatch(UUID); // scope ids and adapter boot ids are random…
 expect(JSON.stringify(canonicalOutcome(a))).not.toMatch(UUID); // …and canonicalised away.
 expect(a.businessEvents.find(e=>e.type==='MissionCreated')!.id).toMatch(/^mission-[0-9a-f]{32}$/);
});

test('a different seed changes the scripted actor workload; actor streams are independent',async()=>{
 const a=await executeFixture('FD01',{seed:42}),b=await executeFixture('FD01',{seed:43});
 expect(a.workload[0]!.atTick).not.toBe(b.workload[0]!.atTick);
 expect(canonicalOutcome(a)).not.toEqual(canonicalOutcome(b));
 const s1=actorStream(42,'guest-1'),plain=[s1.next(),s1.next(),s1.next()];
 const s2=actorStream(42,'guest-1'),noise=actorStream(42,'ui-hover');for(let i=0;i<50;i++)noise.next();
 expect([s2.next(),s2.next(),s2.next()]).toEqual(plain);
 expect(actorStream(42,'guest-1').int(25,500)).toBe(actorStream(42,'guest-1').int(25,500));
 for(let i=0;i<200;i++){const v=s1.int(3,5);expect(v).toBeGreaterThanOrEqual(3);expect(v).toBeLessThanOrEqual(5);}
});

test('clock is a fixed 20 ms tick; paused runs keep tick, poses and revision-free reads stable',async()=>{
 expect(TICK_MS).toBe(20);
 const c=createClock(Date.parse('2026-11-01T00:00:00Z'));c.advance(3);expect(c.tick).toBe(3);expect(c.nowMs()-Date.parse('2026-11-01T00:00:00Z')).toBe(60);expect(c.simTimeNs()).toBe('60000000');
 c.pause();expect(()=>c.advance(1)).toThrow('CLOCK_PAUSED');expect(c.tick).toBe(3);c.resume();c.advance(1);expect(c.tick).toBe(4);
 const run=await openFixture('FD01',{seed:1});
 try{
  await run.start();await stepUntil(run,v=>v.entities[0]!.moving);
  const paused=await act(run,'pause',{});expect(paused.run.status).toBe('paused');
  await expect(act(run,'step',{ticks:10})).rejects.toThrow('RUN_PAUSED');
  const again=await run.snapshot();expect(again.tick).toBe(paused.tick);expect(again.entities).toEqual(paused.entities);expect(again.run.runRevision).toBe(paused.run.runRevision);
  await act(run,'resume',{});const moved=await act(run,'step',{ticks:5});expect(moved.tick).toBe(paused.tick+5);expect(moved.entities[0]!.pose).not.toEqual(paused.entities[0]!.pose);
  expect(validateRunSnapshotV2(moved.run).ok).toBe(true);expect(moved.run).toMatchObject({mode:'mock',fidelity:'modeled',backendSetId:'mock-amr',backends:['mock_amr']});
 }finally{await run.close();}
});

test('FD07: two robots never own the constrained corridor at once; one progresses at a time and both deliver',async()=>{
 const r=await executeFixture('FD07',{seed:3});
 expect(r.outcome.status).toBe('completed');expect(r.outcome.served).toBe('2');
 expect(r.metrics.maxConcurrentMovers).toBe(1);
 const granted=new Set<string>();let max=0;
 for(const e of r.businessEvents.filter(e=>e.kind==='reservation')){const s=e.state as {robotId:string;status:string;zoneId:string};if(s.status==='granted')granted.add(s.robotId);else granted.delete(s.robotId);max=Math.max(max,granted.size);}
 expect(max).toBe(1);
 expect(r.businessEvents.some(e=>e.type==='ZoneReservationPending'&&(e.state as {reason:string}).reason==='ZONE_SERIALIZED')).toBe(true);
 // Each robot keeps its own identity: both robots were observed arriving.
 const arrived=new Set(r.businessEvents.filter(e=>e.type==='RobotGoalCompleted').map(e=>e.id));expect([...arrived].sort()).toEqual(['amr-a','amr-b']);
 expect(canonicalOutcome(r)).toEqual(canonicalOutcome(await executeFixture('FD07',{seed:3})));
});

test('unreachable goal is rejected by the model and never completes the mission',async()=>{
 const box=[{id:'box-w',x:2,y:0.3,width:0.3,height:1.8},{id:'box-e',x:3.7,y:0.3,width:0.3,height:1.8},{id:'box-n',x:2,y:1.8,width:2,height:0.3},{id:'box-s',x:2,y:0,width:2,height:0.3}];
 const run=await openFixture('FD01',{seed:42,project:restaurant({obstacles:box})});
 try{
  await run.start();const view=await stepUntil(run);
  expect(view.run.status).toBe('needs_attention');expect(view.attention.map(a=>a.reason)).toContain('UNREACHABLE');
  await act(run,'step',{ticks:500});const r=await run.report();
  expect(types(r)).not.toContain('MissionCompleted');expect(types(r)).not.toContain('DeliveryHandedOff');expect(r.outcome.served).toBe('0');
  expect(r.businessEvents.find(e=>e.type==='RobotCommandObserved'&&(e.state as {status:string}).status==='rejected')).toBeTruthy();
 }finally{await run.close();}
});

test('contact with an injected obstacle fails the leg; no arrival, no completion, contact counted',async()=>{
 const run=await openFixture('FD01',{seed:42});
 try{
  await run.start();await stepUntil(run,v=>v.entities[0]!.moving);await act(run,'step',{ticks:20});
  await act(run,'injectFault',{faultId:'collide',entityId:'amr-1'});
  const view=await act(run,'step',{ticks:5});expect(view.run.status).toBe('needs_attention');expect(view.attention.map(a=>a.reason)).toContain('CONTACT');
  await act(run,'step',{ticks:500});const r=await run.report();
  expect(types(r)).not.toContain('MissionArrived');expect(types(r)).not.toContain('MissionCompleted');
  expect(r.metrics.collision).toMatchObject({available:true,contacts:1});
 }finally{await run.close();}
});

test('unknown geometry still runs the business flow but disallows collision metrics',async()=>{
 const unmeasured={id:'vendor-amr',revision:1,contentHash:'b'.repeat(64)};
 const r=await executeFixture('FD01',{seed:42,assets:[],project:restaurant({entities:[{id:'amr-1',kind:'amr',assetRef:unmeasured}]})});
 expect(r.outcome.status).toBe('completed');
 expect(r.metrics.collision).toEqual({available:false,reason:'GEOMETRY_UNKNOWN',contacts:null,minSeparationM:null});
 expect(r.manifest.assets).toEqual([{...unmeasured,resolved:false}]);
 // The server catalog resolves the illustrative service AMR by content hash without the caller supplying it.
 expect((await executeFixture('FD01',{seed:42,assets:[]})).manifest.assets).toEqual([{...amrRef,resolved:true}]);
 const tampered={...amrAsset,revision:2};
 await expect(executeFixture('FD01',{seed:42,assets:[tampered],project:restaurant({entities:[{id:'amr-1',kind:'amr',assetRef:{...amrRef,revision:2}}]})})).rejects.toThrow('ASSET_HASH_MISMATCH');
});

test('no robot network transport is instantiated by a mock run; only enabled mock backends instantiate',async()=>{
 const spies=[vi.spyOn(net.Socket.prototype,'connect'),vi.spyOn(net,'connect'),vi.spyOn(net,'createConnection'),vi.spyOn(http,'request'),vi.spyOn(https,'request'),vi.spyOn(dgram,'createSocket')];
 try{const r=await executeFixture('FD01',{seed:5});expect(r.outcome.status).toBe('completed');for(const s of spies)expect(s).not.toHaveBeenCalled();}
 finally{for(const s of spies)s.mockRestore();}
 expect(()=>instantiateBackends('mock-default',defaultCatalog,['mock_amr'])).toThrow('BACKEND_EXECUTION_DISABLED');
 expect(()=>instantiateBackends('hardware-live',defaultCatalog,['valetudo_native'])).toThrow('BACKEND_EXECUTION_DISABLED');
 expect(()=>instantiateBackends('mock-amr',defaultCatalog,[])).toThrow('BACKEND_EXECUTION_DISABLED');
 expect(instantiateBackends('mock-amr',defaultCatalog,['mock_amr'])).toMatchObject({mode:'mock',access:'simulated',backends:['mock_amr']});
 expect(instantiateBackends('mock-default',defaultCatalog,['mock_amr','mock_coffee','mock_arm'])).toMatchObject({backends:['mock_amr','mock_coffee','mock_arm']});
 expect([...scenarioRegistry.keys()]).toEqual(['FD01','FD07','FD02','FD03','FD04','FD04-blocked','FD04-reopen','FD05-payload','FD05-battery','FD05-capability','FD05-binding','BV01','FD02-cups','CAMPAIGN-FD02-FD07-BV01-BV03','IR-FD01','IR-FD03','IR-FD04','IR-FD04-blocked','IR-FD07','WB-FD01','WB-FD07','WB-BV01','MJ-BV01']);
});

// ---- gateway: run ownership and action idempotency (carried from F01) ----
const origin='http://127.0.0.1:4175',hash='a'.repeat(64);
const gateways:LabGateway[]=[],gwDirs:string[]=[];
afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of gwDirs.splice(0))await rm(d,{force:true,recursive:true});});
const post=(url:string,headers:Record<string,string>,body:unknown)=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
async function pair(g:LabGateway){const r=await post(g.url+'/lab/v2/sessions',{Origin:origin,'Content-Type':'application/json'},{token:g.issuePairingToken()});expect(r.status).toBe(201);return {Origin:origin,'Content-Type':'application/json',Cookie:r.headers.get('set-cookie')!.split(';')[0]!,'X-CSRF-Token':(await r.json() as {csrfToken:string}).csrfToken};}
test('v2 gateway runs the mock AMR set only, binds runs to the pairing session and keeps action receipts idempotent',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lab-v2-gw-'));gwDirs.push(directory);
 const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:hash,v2:{enabledBackends:['mock_amr']}});gateways.push(g);
 const health=await (await fetch(g.url+'/lab/v2/health')).json() as {backends:{id:string;enabled:boolean}[];scenarioIds:string[]};
 expect(health.backends.filter(b=>b.enabled).map(b=>b.id)).toEqual(['mock_amr']);expect(health.scenarioIds).toEqual(['FD01','FD07','FD02','FD03','FD04','FD04-blocked','FD04-reopen','FD05-payload','FD05-battery','FD05-capability','FD05-binding','BV01','FD02-cups','CAMPAIGN-FD02-FD07-BV01-BV03','IR-FD01','IR-FD03','IR-FD04','IR-FD04-blocked','IR-FD07','WB-FD01','WB-FD07','WB-BV01']);
 const owner=await pair(g),other=await pair(g);
 const body={project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:42,mode:'mock',backendSetId:'mock-amr',access:'simulated',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:hash}};
 expect((await post(g.url+'/lab/v2/runs',owner,{...body,scenarioId:'BV01',backendSetId:'mock-default'})).status).toBe(501);
 expect((await post(g.url+'/lab/v2/runs',owner,{...body,mode:'hardware',access:'live',backendSetId:'hardware-live'})).status).toBe(403);
 expect((await post(g.url+'/lab/v2/runs',owner,{...body,scenarioId:'NOPE'})).status).toBe(422);
 expect((await post(g.url+'/lab/v2/runs',owner,{...body,scenarioRevision:9})).status).toBe(409);
 const created=await post(g.url+'/lab/v2/runs',owner,body);expect(created.status).toBe(201);
 const view=await created.json() as {run:{id:string;status:string;runRevision:number}};expect(view.run.status).toBe('ready');
 const url=`${g.url}/lab/v2/runs/${view.run.id}`;
 expect((await fetch(url,{headers:other})).status).toBe(404);
 expect((await post(url+'/actions',other,{actionId:'s1',expectedRevision:0,kind:'start',payload:{}})).status).toBe(404);
 expect((await fetch(url+'/report',{headers:other})).status).toBe(404);
 const start={actionId:'s1',expectedRevision:0,kind:'start',payload:{}};
 const first=await post(url+'/actions',owner,start);expect(first.status).toBe(200);const firstBody=await first.json();
 const repeat=await post(url+'/actions',owner,start);expect(repeat.status).toBe(200);expect(await repeat.json()).toEqual(firstBody);
 const conflict=await post(url+'/actions',owner,{...start,kind:'pause'});expect(conflict.status).toBe(409);expect((await conflict.json() as {error:string}).error).toBe('ACTION_CONFLICT');
 const stale=await post(url+'/actions',owner,{actionId:'s2',expectedRevision:0,kind:'step',payload:{ticks:10}});expect(stale.status).toBe(409);
 const stepped=await post(url+'/actions',owner,{actionId:'s3',expectedRevision:1,kind:'step',payload:{ticks:10}});expect(stepped.status).toBe(200);expect((await stepped.json() as {tick:number}).tick).toBe(10);
 expect((await fetch(url,{headers:owner})).status).toBe(200);
 const report=await (await fetch(url+'/report',{headers:owner})).json() as {manifest:{backends:{model:string}[]}};expect(report.manifest.backends[0]!.model).toBe('mock_kinematic');
 // F06: the v2 business-event stream is served (SSE); v1 keeps answering 501 for events (lab-runtime-gateway tests)
 const ctl=new AbortController(),events=await fetch(url+'/events',{headers:owner,signal:ctl.signal});expect(events.status).toBe(200);expect(events.headers.get('content-type')).toMatch(/event-stream/);ctl.abort();
 expect(await readdir(directory)).toHaveLength(1);
});

test('v2 gateway runs the coffee set once every mock backend of it is enabled; hardware stays denied',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lab-v2-gw-'));gwDirs.push(directory);
 const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:hash,v2:{enabledBackends:['mock_amr','mock_coffee','mock_arm']}});gateways.push(g);
 const owner=await pair(g),body={project:coffeeProject(),scenarioId:'BV01',scenarioRevision:1,seed:42,mode:'mock',backendSetId:'mock-default',access:'simulated',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:hash}};
 expect((await post(g.url+'/lab/v2/runs',owner,{...body,mode:'hardware',access:'hil',backendSetId:'hardware-hil'})).status).toBe(403);
 expect((await post(g.url+'/lab/v2/runs',owner,{...body,backendSetId:'mock-amr'})).status).toBe(422); // the AMR-only set has no coffee cell for BV01
 const created=await post(g.url+'/lab/v2/runs',owner,body);expect(created.status).toBe(201);
 const view=await created.json() as {run:{backends:string[];status:string};coffee:unknown};
 expect(view.run).toMatchObject({backends:['mock_amr','mock_coffee','mock_arm'],status:'ready'});
});
