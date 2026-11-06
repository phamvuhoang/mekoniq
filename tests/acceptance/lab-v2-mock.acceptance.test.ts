// R-MOCK acceptance (F08). Every mock-capable row of lab/docs/specs/2026-11-05-digital-twin/verification.md (+ UX rows of product-experience.md)
// is mapped to an executed check or to an explicit not_run reason. Checks drive the real scenario runner / v2 gateway / source domain; nothing
// here mocks them. `pass` is only ever recorded after the assertions of that check ran (QA-07: never skip-to-pass).
// Run: LAB_V2_REQUIRE_LAB_FIXTURES=1 [LAB_V2_MOCK_EVIDENCE=<file.json>] pnpm test:acceptance -- tests/acceptance/lab-v2-mock.acceptance.test.ts
import {afterEach,expect,test,vi} from 'vitest';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import child from 'node:child_process';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonicalOutcome,outcomeDigest,type RunReport} from '../../packages/lab-runtime/src/v2/report';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {reportKpis,compareRuns} from '../../packages/lab-runtime/src/v2/comparison';
import {MOCK_AMR_PARAMS} from '../../packages/lab-runtime/src/v2/backends/mock-amr';
import {TICK_MS} from '../../packages/lab-runtime/src/v2/clock';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {act,cleanupRuns,coffeeProject,corridor,executeCoffee,executeFixture,openCoffee,openFixture,restaurant,runDirectory,stepUntil} from '../support/lab-v2';
import {assertRecordedRegressionIdentity,type RegressionIdentityRecord} from '../support/regression-identity';
afterEach(cleanupRuns);
type Run=Awaited<ReturnType<typeof openFixture>>;type View=Awaited<ReturnType<Run['snapshot']>>;
const types=(r:RunReport)=>r.businessEvents.map(e=>e.type);
const terminal=(v:View)=>['completed','needs_attention','cancelled'].includes(v.run.status);
const journalHas=async(run:Run,type:string)=>(await run.journal()).some(j=>j.events.some(e=>e.type===type));
const count=(r:RunReport,type:string)=>types(r).filter(t=>t===type).length;
const executes=(r:RunReport)=>r.effects.filter(e=>e.type==='robot.execute');
const reasons=(v:{attention:{reason:string}[]})=>v.attention.map(a=>a.reason);
const point=(kind:string)=>(restaurant().world.points as {kind:string;x:number;y:number}[]).find(p=>p.kind===kind)!;
/** Evidence collected while the checks run (synthetic data only): digests, failure traces, timing. Written to LAB_V2_MOCK_EVIDENCE if set. */
const evidence:{digests:Record<string,{seed:number;digest:string;seedlessDigest:string;atTicks:number[];status:string;served:string}[]>;repeats:Record<string,string[]>;traces:Record<string,{scenario:{id:string;revision:number;hash:string};backendSetId:string;backends:string[];outcome:{status:string;served:string};digest:string}&Record<string,unknown>>;traceByCheck:Record<string,string[]>;gateway:unknown[];timing:Record<string,unknown>}={digests:{},repeats:{},traces:{},traceByCheck:{},gateway:[],timing:{}};
let current='';
const trace=(id:string,r:RunReport)=>{(evidence.traceByCheck[current]??=[]).push(id);evidence.traces[id]={scenario:r.manifest.scenario,backendSetId:r.manifest.backendSetId,backends:r.manifest.backends.map(b=>`${b.id}@${b.version}/${b.model}`),seed:r.manifest.seed,outcome:{status:r.outcome.status,served:r.outcome.served},digest:outcomeDigest(r),attention:r.attention,faults:r.faults,
 rejectedObservations:r.rejectedObservations,reconciliations:r.reconciliations,holds:r.metrics.holds??null,collision:r.metrics.collision};};
const passed=new Set<string>(),titles=new Set<string>();
/** A check: its title is the test id used by the coverage table; it counts as executed only after every assertion in it ran. */
function check(title:string,fn:()=>Promise<void>,timeout=180000){titles.add(title);test(title,async()=>{current=title;await fn();passed.add(title);},timeout);}

// ---------------------------------------------------------------- food delivery (FD) ----------------------------------------------------------------
check('FD01 runner: arrival from observations, three legs, served only after handoff, parked not charged',async()=>{
 const r=await executeFixture('FD01',{seed:42});trace('FD01',r);
 expect(r.outcome).toMatchObject({status:'completed',served:'1'});
 const t=types(r);expect(t.indexOf('CargoLoaded')).toBeLessThan(t.indexOf('DeliveryHandedOff'));expect(t.indexOf('MissionArrived')).toBeLessThan(t.indexOf('CargoLoaded'));
 expect(count(r,'MissionArrived')).toBe(3);expect(executes(r).map(e=>[e.status,e.attempts])).toEqual([['confirmed',1],['confirmed',1],['confirmed',1]]);
 // the observed completion of each leg precedes its arrival event; nothing but the plant adapter reports completion
 expect(r.businessEvents.filter(e=>e.type==='RobotCommandObserved'&&(e.state as {status:string}).status==='completed')).toHaveLength(3);
 const parking=point('parking');expect(r.entities[0]!.pose).toMatchObject({x:parking.x,y:parking.y});
 // the last mission is a standby at the robot's own parking point, never a dock/charge stop
 const last=r.businessEvents.filter(e=>e.type==='MissionCreated').at(-1)!.state as {stops:{action:string;targetId:string}[]};
 expect(last.stops).toEqual([expect.objectContaining({action:'standby',targetId:'bay-1'})]);
});

check('FD02 runner: one batched mission for two tables; confirming table A hands off only A, B stays loaded for its own stop',async()=>{
 const run=await openFixture('FD02',{seed:1});
 try{
  await run.start();
  await stepUntil(run,v=>v.served!=='0'||terminal(v),5);
  const mid=await run.report();
  await stepUntil(run,undefined,100);
  const r=await run.report();trace('FD02',r);
  expect(r.outcome).toMatchObject({status:'completed',served:'3'});
  const delivery=r.businessEvents.filter(e=>e.type==='MissionCreated').map(e=>e.state as {stops:{action:string;targetId:string;allocationIds:string[]}[];allocationIds:string[]}).find(s=>s.allocationIds.length)!;
  expect(delivery.allocationIds).toHaveLength(2);
  expect(delivery.stops.map(s=>[s.action,s.allocationIds.length])).toEqual([['load',2],['handoff',1],['handoff',1]]);
  const tableOf=(lineId:string)=>r.workload.find(w=>w.lineId===lineId)!.tableId;
  const first=mid.businessEvents.filter(e=>e.type==='DeliveryHandedOff');expect(first).toHaveLength(1);
  const handed=first[0]!.state as {lineId:string};expect(tableOf(handed.lineId)).toBe(delivery.stops[1]!.targetId);
  const allocations=new Map<string,string>();for(const e of mid.businessEvents)if(e.kind==='allocation')allocations.set(e.id,String((e.state as {status:string}).status));
  expect([...allocations.values()].sort()).toEqual(['loaded','served']);
  // remaining stop and cargo: only B's allocation rides on, then B is handed off at its own table
  const handoffs=r.businessEvents.filter(e=>e.type==='DeliveryHandedOff').map(e=>tableOf((e.state as {lineId:string}).lineId));
  expect(handoffs).toEqual([delivery.stops[1]!.targetId,delivery.stops[2]!.targetId]);
  expect(new Set(handoffs).size).toBe(2);
 }finally{await run.close();}
});

const notTeleported=(r:RunReport)=>{
 const s=r.telemetry.samples.filter(x=>x.entityId===r.entities[0]!.id&&x.observed&&typeof (x.observed as {xM?:number}).xM==='number');
 for(let i=1;i<s.length;i++){
  const a=s[i-1]!.observed as {xM:number;yM:number},b=s[i]!.observed as {xM:number;yM:number},dt=(Number(BigInt(s[i]!.simTimeNs!)-BigInt(s[i-1]!.simTimeNs!))/1e9);
  expect(Math.hypot(b.xM-a.xM,b.yM-a.yM)).toBeLessThanOrEqual(MOCK_AMR_PARAMS.speedMps*dt+1e-6);
 }
 return s.length;
};
check('FD03 runner: a scheduled pedestrian crosses the route; the robot waits/replans in the model, no contact, resumes with a recorded cause',async()=>{
 const r=await executeFixture('FD03',{seed:1});trace('FD03',r);
 expect(r.outcome).toMatchObject({status:'completed',served:'1'});
 expect(r.metrics.collision).toMatchObject({available:true,contacts:0,minSeparationM:null});expect(reportKpis(r).find(k=>k.id==='minSeparationM')).toMatchObject({available:false,reason:'SINGLE_ROBOT'});
 const holds=r.metrics.holds!;expect(holds.some(h=>h.hold==='PATH_BLOCKED')).toBe(true);
 expect(holds.at(-1)!.hold).toBeNull(); // resumed, and the hold that preceded it is on record with its cause
 expect(r.faults.filter(f=>f.faultId.startsWith('obstacle:')).length).toBeGreaterThanOrEqual(2);
 expect(notTeleported(r)).toBeGreaterThan(10);
});

check('FD04 runner: chair on the destination: no false arrival, rejected with UNREACHABLE, nothing served',async()=>{
 const r=await executeFixture('FD04',{seed:1});trace('FD04',r);
 expect(r.outcome.status).toBe('needs_attention');expect(reasons(r)).toContain('UNREACHABLE');
 expect(count(r,'MissionArrived')).toBe(1);expect(types(r)).not.toContain('DeliveryHandedOff');expect(r.outcome.served).toBe('0');
 const pass=point('kitchen');expect(r.entities[0]!.pose).toMatchObject({x:pass.x,y:pass.y});
 notTeleported(r);
});

check('FD04 runner: lane closed while travelling: hold, then NO_PATH attention; never arrives, no contact, no teleport',async()=>{
 const r=await executeFixture('FD04-blocked',{seed:1,project:corridor()});trace('FD04-blocked',r);
 expect(r.outcome.status).toBe('needs_attention');expect(reasons(r)).toContain('NO_PATH');
 expect(r.metrics.holds!.some(h=>h.hold==='PATH_BLOCKED')).toBe(true);
 expect(count(r,'MissionArrived')).toBe(1);expect(r.outcome.served).toBe('0');expect(r.metrics.collision).toMatchObject({contacts:0});
 notTeleported(r);
});

check('FD04 runner: lane reopened inside the hold window: the robot resumes by policy (hold then clear) and delivers',async()=>{
 const r=await executeFixture('FD04-reopen',{seed:1,project:corridor()});trace('FD04-reopen',r);
 expect(r.outcome).toMatchObject({status:'completed',served:'1'});expect(reasons(r)).toEqual([]);
 const holds=r.metrics.holds!;expect(holds.some(h=>h.hold==='PATH_BLOCKED')).toBe(true);expect(holds.at(-1)!.hold).toBeNull();
 expect(r.metrics.collision).toMatchObject({contacts:0});notTeleported(r);
});

for(const [id,code] of [['FD05-payload','OVERLOADED'],['FD05-battery','BATTERY_LOW'],['FD05-capability','CAPABILITY_UNSUPPORTED'],['FD05-binding','TARGET_UNBOUND']] as const)
 check(`${id} runner: refused before any native start with ${code}; no robot command, nothing served`,async()=>{
  const r=await executeFixture(id,{seed:1});trace(id,r);
  expect(r.outcome.status).toBe('needs_attention');expect(r.attention).toEqual([expect.objectContaining({reason:'SCRIPTED_INPUT_REJECTED',subjectId:code})]);
  expect(r.effects).toEqual([]);expect(types(r)).not.toContain('MissionCreated');expect(types(r)).not.toContain('RobotCommandIssued');expect(r.outcome.served).toBe('0');
 });

check('FD06 runner: cancel while the robot holds the dish: return stop, staff confirms the return, cargo returned, never delivered',async()=>{
 const run=await openFixture('FD01',{seed:5});
 try{
  await run.start();
  let v=await run.snapshot();while(!(await journalHas(run,'CargoLoaded')))v=await act(run,'step',{ticks:10});
  v=await act(run,'step',{ticks:50});expect(v.entities[0]!.moving).toBe(true);
  await act(run,'cancel');
  v=await stepUntil(run,x=>x.awaiting.some(a=>a.confirmationType==='return')||terminal(x),25);
  const a=v.awaiting.find(x=>x.confirmationType==='return')!;expect(a).toBeTruthy();
  v=await act(run,'confirm',{subjectId:a.subjectId,confirmationType:'return',actorProvenance:'human'});
  v=await stepUntil(run,undefined,25);
  const r=await run.report();trace('FD06',r);
  expect(r.outcome).toMatchObject({status:'cancelled',served:'0'});
  expect(types(r)).toContain('MissionCancellationRequested');expect(types(r)).toContain('CargoReturned');expect(types(r)).not.toContain('DeliveryHandedOff');
  expect(r.effects.filter(e=>e.type==='robot.cancel')).toHaveLength(1);
  expect(r.confirmations.at(-1)).toMatchObject({confirmationType:'return',provenance:'human'});
  const line=[...r.businessEvents].reverse().find(e=>e.type==='FulfillmentQuantityChanged')!.state as {returned:string;served:string};expect(line).toMatchObject({returned:'1',served:'0'});
 }finally{await run.close();}
});

check('FD07 runner: two robots, one narrow corridor: one owner at a time, no undetected deadlock, both deliver',async()=>{
 const r=await executeFixture('FD07',{seed:3});trace('FD07',r);
 expect(r.outcome).toMatchObject({status:'completed',served:'2'});expect(r.metrics.maxConcurrentMovers).toBe(1);
 let held=0,max=0;for(const e of r.businessEvents.filter(x=>x.kind==='reservation')){const s=String((e.state as {status:string}).status);if(e.type==='ZoneReservationGranted')held++;if(e.type==='ZoneReservationReleased')held--;max=Math.max(max,held);void s;}
 expect(max).toBe(1);expect(r.metrics.collision).toMatchObject({contacts:0});
});

check('FD08 runner: localization lost before arrival: goal unknown, attention, last pose stale, no arrival',async()=>{
 const run=await openFixture('FD01',{seed:2});
 try{
  await run.start();await stepUntil(run,v=>v.entities[0]!.moving);
  await act(run,'injectFault',{faultId:'localization-lost',entityId:'amr-1'});
  const v=await act(run,'step',{ticks:5});
  expect(v.run.status).toBe('needs_attention');expect(reasons(v)).toContain('LOCALIZATION_LOST');expect(v.entities[0]!.quality).toBe('stale');
  await act(run,'step',{ticks:800});const r=await run.report();trace('FD08-localization',r);
  expect(types(r)).not.toContain('MissionArrived');expect(r.outcome.served).toBe('0');expect(executes(r).reduce((n,e)=>n+e.attempts,0)).toBe(1);
 }finally{await run.close();}
});

check('FD08 runner: map revision changes at a stop: MAP_CHANGED latches stale pose and blocks the next leg, nothing served',async()=>{
 const run=await openFixture('FD01',{seed:2});
 try{
  await run.start();while(!(await journalHas(run,'MissionArrived')))await act(run,'step',{ticks:5});
  await act(run,'injectFault',{faultId:'map-changed',entityId:'amr-1'});
  const v=await stepUntil(run,undefined,25);
  expect(v.run.status).toBe('needs_attention');expect(reasons(v)).toContain('MAP_CHANGED');expect(v.entities[0]!.quality).toBe('stale');
  const r=await run.report();trace('FD08-map',r);
  expect(count(r,'MissionArrived')).toBe(1);expect(types(r)).not.toContain('DeliveryHandedOff');expect(r.outcome.served).toBe('0');
  expect(executes(r)).toHaveLength(1); // stale map latched at the stop: the next leg is never dispatched
 }finally{await run.close();}
});

// ---------------------------------------------------------------- coffee (BV) ----------------------------------------------------------------
const brewing=(v:View)=>!!v.coffee?.jobs.some(j=>j.status==='dispensing');
const job=(r:RunReport,id:string)=>r.coffee!.jobs.find(j=>j.jobId===id) as {status:string;attentionReason:string|null;steps:{id:string;status:string;measured?:{amount:string}|null;target:{amount:string;tolerance:string}}[]}|undefined;
check('BV01 runner: both recipes run their own step order; espresso has no ice/milk; one cup owner; served only after the final handoff',async()=>{
 const r=await executeCoffee('BV01',{seed:42});trace('BV01',r);
 expect(r.outcome).toMatchObject({status:'completed',served:'2'});
 const caps=(jobId:string)=>r.coffee!.cellEffects.filter(e=>e.payload.jobId===jobId&&e.payload.capability!=='start_job').map(e=>String(e.payload.capability==='brew'?'brew':(e.payload.payload as {resource:string}).resource));
 expect(caps('coffee-job-1')).toEqual(['brew']);expect(caps('coffee-job-2')).toEqual(['brew','ice','milk']);
 for(const c of r.coffee!.cups)expect(c.movements.map(m=>m.to.kind)).toEqual(['arm','robot','customer']);
 // mock measurements are labelled modelled (never measured/calibrated), and the report says no sensing/physics backs them
 const measured=r.coffee!.jobs.flatMap(j=>(j.steps as {measured?:{provenance:string}|null}[]).map(x=>x.measured).filter(Boolean));expect(measured.length).toBe(4);expect(measured.every(m=>m!.provenance==='modelled')).toBe(true);
 expect(r.coverage).toMatchObject({sensorEvidence:false,coffeeProcessModel:true,fluidModel:false});
 const t=types(r);expect(t.indexOf('CoffeeQualityConfirmed')).toBeLessThan(t.indexOf('CupTransferConfirmed'));expect(t.lastIndexOf('DeliveryHandedOff')).toBeGreaterThan(t.lastIndexOf('CoffeeQualityConfirmed'));
});

check('BV02 runner: cup removed mid-brew: step fails CUP_REMOVED, job held, the drink never becomes ready',async()=>{
 const run=await openCoffee('BV01',{seed:1});
 try{
  await run.start();await stepUntil(run,brewing,25);
  await act(run,'injectFault',{faultId:'cup-removed'});
  const v=await stepUntil(run,x=>x.run.status==='needs_attention',25);expect(reasons(v)).toContain('CUP_REMOVED');
  await act(run,'step',{ticks:500});const r=await run.report();trace('BV02-removed',r);
  expect(job(r,'coffee-job-1')).toMatchObject({status:'needs_attention',attentionReason:'CUP_REMOVED'});
  expect(r.businessEvents.some(e=>e.type==='CoffeeQualityConfirmed'&&e.id==='coffee-job-1')).toBe(false);
  expect(r.coffee!.cups.find(c=>c.cupId==='cup-1')!.movements).toEqual([]);expect(r.outcome.served).toBe('0');
 }finally{await run.close();}
});

check('BV02 runner: no cup under the nozzle before start: the job never starts and no brew command is issued',async()=>{
 const run=await openCoffee('BV01',{seed:1});
 try{
  await run.start();await act(run,'step',{ticks:20});
  await act(run,'injectFault',{faultId:'cup-removed'});await act(run,'step',{ticks:600});
  const r=await run.report();trace('BV02-nocup',r);
  expect(r.coffee!.cellEffects.filter(e=>e.payload.jobId==='coffee-job-1')).toEqual([]);
  expect(r.businessEvents.some(e=>e.type==='CoffeeJobStarted'&&e.id==='coffee-job-1')).toBe(false);expect(r.outcome.served).toBe('0');
 }finally{await run.close();}
});

check('BV03 runner: milk runs out: espresso still served, iced milk coffee held with its reason; consumed beans/ice kept, no blind retry',async()=>{
 const run=await openCoffee('BV01',{seed:1});
 try{
  await run.start();await act(run,'step',{ticks:5});await act(run,'injectFault',{faultId:'milk-empty'});
  await stepUntil(run,undefined,50);await act(run,'step',{ticks:500});
  const r=await run.report();trace('BV03-milk',r);
  expect(job(r,'coffee-job-1')!.status).toBe('delivered');
  // the milk step is refused by the device interlock before any milk command: the run holds the job with the domain code (no retry loop)
  const iced=job(r,'coffee-job-2')!;expect(iced.status).not.toBe('ready_for_pickup');expect(iced.steps.find(s=>s.id==='add_milk')!.status).toBe('pending');
  expect(r.attention).toEqual([expect.objectContaining({reason:'COFFEE_STEP_BLOCKED',subjectId:'coffee-job-2',commandId:'INGREDIENT_EMPTY'})]);
  expect(iced.steps.filter(s=>s.status==='completed').map(s=>s.id)).toEqual(['brew','add_ice']);
  const milk=r.coffee!.cellEffects.filter(e=>e.payload.jobId==='coffee-job-2'&&(e.payload.payload as {resource?:string}).resource==='milk');expect(milk.length).toBeLessThanOrEqual(1);
  expect(milk.every(e=>e.attempts<=1)).toBe(true);expect(r.outcome.served).toBe('1');
 }finally{await run.close();}
});

const iceEffects=(r:RunReport)=>r.coffee!.cellEffects.filter(e=>e.payload.jobId==='coffee-job-2'&&(e.payload.payload as {resource?:string}).resource==='ice');
check('BV03 runner: ice dispenser jammed before its step: the dispense is refused, the step times out on the recipe clock, job held, never resent',async()=>{
 const run=await openCoffee('BV01',{seed:1});
 try{
  await run.start();await act(run,'step',{ticks:5});await act(run,'injectFault',{faultId:'ice-jam'});
  await stepUntil(run,v=>v.run.status==='needs_attention'||terminal(v),50);await act(run,'step',{ticks:300});
  const r=await run.report();trace('BV03-ice-before',r);
  const iced=job(r,'coffee-job-2')!;expect(iced.status).toBe('needs_attention');expect(iced.steps.find(s=>s.id==='add_ice')!.status).not.toBe('completed');
  expect(iceEffects(r)).toHaveLength(1);expect(iceEffects(r)[0]!.attempts).toBeLessThanOrEqual(1);
  expect(job(r,'coffee-job-1')!.status).toBe('delivered');
 }finally{await run.close();}
});
check('BV03 runner: ice dispenser jams mid-dispense: the partial amount is measured and kept, the job is held, no second ice command',async()=>{
 const run=await openCoffee('BV01',{seed:1});
 try{
  await run.start();
  const iceRunning=async()=>(await run.journal()).some(j=>j.events.some(e=>e.type==='CoffeeStepStarted'&&e.id==='coffee-job-2'&&(e.state.steps as {id:string;status:string}[]).some(s=>s.id==='add_ice'&&s.status==='running')));
  while(!(await iceRunning()))await act(run,'step',{ticks:5});
  await act(run,'injectFault',{faultId:'ice-jam'});
  await stepUntil(run,v=>v.run.status==='needs_attention'||terminal(v),10);await act(run,'step',{ticks:300});
  const r=await run.report();trace('BV03-ice-mid',r);
  const ice=job(r,'coffee-job-2')!.steps.find(s=>s.id==='add_ice')!;expect(ice.status).not.toBe('completed');
  const kg=Number(ice.measured!.amount);expect(kg).toBeGreaterThan(0);expect(kg).toBeLessThan(Number(ice.target.amount));
  expect(iceEffects(r)).toHaveLength(1);expect(r.outcome.served).toBe('1');
 }finally{await run.close();}
});

check('BV03 runner: two orders contend for one machine and arm: brews never overlap, the robot gets the cup only once docked',async()=>{
 const r=await executeCoffee('BV01',{seed:7});trace('BV03-contention',r);
 const brewIds=new Set(r.coffee!.cellEffects.filter(e=>e.payload.capability==='brew').map(e=>String(e.payload.commandId)));
 const log=r.coffee!.plantLog as {tick:number;event:string;commandId?:string}[];
 const spans=[...brewIds].map(id=>[log.find(l=>l.commandId===id&&l.event==='accepted')!.tick,log.find(l=>l.commandId===id&&l.event==='completed')!.tick] as const).sort((a,b)=>a[0]-b[0]);
 expect(spans).toHaveLength(2);expect(spans[1]![0]).toBeGreaterThanOrEqual(spans[0]![1]);
 const arrivals=r.businessEvents.filter(e=>e.type==='MissionArrived').map(e=>Date.parse(e.at));
 for(const c of r.coffee!.cups){const place=c.movements.find(m=>m.to.kind==='robot')!;expect(arrivals.some(a=>a<=Date.parse(place.at))).toBe(true);expect((place.evidence as {dockInTolerance:boolean}).dockInTolerance).toBe(true);}
});

for(const [fault,expectReason] of [['dose-low','QUALITY_REJECTED'],['measure-unknown','QUALITY_REJECTED'],['measure-missing','MEASUREMENT_MISSING']] as const)
 check(`BV04 runner: ${fault}: the drink is not ready; requested, observed and accepted stay separate (${expectReason})`,async()=>{
  const run=await openCoffee('BV01',{seed:1});
  try{
   await run.start();await act(run,'injectFault',{faultId:fault});
   const v=await stepUntil(run,x=>x.run.status==='needs_attention'||terminal(x),25);expect(reasons(v)).toContain(expectReason);
   const r=await run.report();trace(`BV04-${fault}`,r);
   const j=job(r,'coffee-job-1')!;expect(['needs_attention','verifying']).toContain(j.status);
   expect(r.businessEvents.some(e=>e.type==='CoffeeQualityConfirmed'&&e.id==='coffee-job-1')).toBe(false);
   const brew=j.steps.find(s=>s.id==='brew')!;expect(brew.target).toMatchObject({amount:'0.00003',tolerance:'0.000003'});
   if(fault==='measure-missing')expect(brew.measured??null).toBeNull();else expect(brew.measured).toBeTruthy();
   expect(r.outcome.served).toBe('0');
  }finally{await run.close();}
 });

check('BV05 runner: lost ACK, duplicate completion and a reboot mid-brew: one effect each, unknown is held, no second brew, cup kept',async()=>{
 const a=await openCoffee('BV01',{seed:3});
 try{
  await a.start();await act(a,'injectFault',{faultId:'drop-ack'});await act(a,'injectFault',{faultId:'duplicate-completion'});
  await stepUntil(a,undefined,50);const r=await a.report();trace('BV05-ack-dup',r);
  expect(r.outcome).toMatchObject({status:'completed',served:'2'});
  expect(r.coffee!.cellEffects.every(e=>e.attempts===1)).toBe(true);
  const consumed=r.coffee!.jobs.flatMap(j=>(j.steps as {consumed:string[]}[]).flatMap(s=>s.consumed));expect(new Set(consumed).size).toBe(consumed.length);
  expect(count(r,'StockMovementRecorded')).toBe(consumed.length);
 }finally{await a.close();}
 const b=await openCoffee('BV01',{seed:3});
 try{
  await b.start();await stepUntil(b,brewing,25);await act(b,'injectFault',{faultId:'coffee-reboot',entityId:'coffee-1'});
  await stepUntil(b,v=>v.run.status==='needs_attention',25);await act(b,'step',{ticks:500});
  const r=await b.report();trace('BV05-reboot',r);
  expect(r.coffee!.cellEffects.filter(e=>e.payload.jobId==='coffee-job-1').map(e=>[e.payload.capability,e.attempts])).toEqual([['brew',1]]);
  expect(job(r,'coffee-job-1')!.attentionReason).toBe('STEP_UNKNOWN');expect(r.outcome.served).toBe('0');
 }finally{await b.close();}
});

check('BV07 runner: arm drops the cup during pick: transfer fails, the cup is never on the robot, the robot is not released from the load stop',async()=>{
 const run=await openCoffee('BV01',{seed:1});
 try{
  await run.start();await stepUntil(run,v=>!!v.coffee?.jobs.some(j=>j.status==='transferring'),10);
  await act(run,'injectFault',{faultId:'arm-drop'});
  await stepUntil(run,v=>v.run.status==='needs_attention'||terminal(v),25);await act(run,'step',{ticks:400});
  const r=await run.report();trace('BV07-drop',r);
  expect(r.outcome.status).toBe('needs_attention');
  const cup=r.coffee!.cups.find(c=>c.cupId==='cup-1')!;expect(cup.movements.some(m=>m.to.kind==='robot')).toBe(false);expect(cup.ownerKind).not.toBe('robot');
  expect(types(r)).not.toContain('CargoLoaded');expect(r.outcome.served).toBe('0');
 }finally{await run.close();}
});

check('BV07 runner: robot docked out of tolerance: no tray transfer, the cup stays with the arm, the robot is held at the load stop',async()=>{
 const run=await openCoffee('BV01',{seed:1});
 try{
  await run.start();
  await stepUntil(run,v=>!!v.coffee?.cups.some(c=>c.ownerKind==='arm'),10);
  await stepUntil(run,v=>!v.entities[0]!.moving&&v.entities[0]!.goal?.state==='completed'&&!!v.coffee?.cups.some(c=>c.ownerKind==='arm'),5);
  await act(run,'injectFault',{faultId:'dock-offset',entityId:'amr-1'});await act(run,'step',{ticks:600});
  const r=await run.report();trace('BV07-dock',r);
  const cup=r.coffee!.cups.find(c=>c.ownerKind==='arm')!;expect(cup).toBeTruthy();expect(cup.movements.some(m=>m.to.kind==='robot')).toBe(false);
  expect(types(r)).not.toContain('CargoLoaded');expect(r.outcome.served).toBe('0');
  expect(r.coffee!.cups.filter(c=>c.ownerKind==='robot')).toHaveLength(0); // arm and robot never both own a cup
 }finally{await run.close();}
});

check('BV07 runner: cancel mid-cycle: the job is cancelled or held with a reason and disposition, nothing is delivered',async()=>{
 const run=await openCoffee('BV01',{seed:1});
 try{
  await run.start();await stepUntil(run,brewing,25);await act(run,'cancel');await act(run,'step',{ticks:400});
  const r=await run.report();trace('BV07-cancel',r);
  const j=job(r,'coffee-job-1')! as unknown as {status:string;attentionReason:string|null;cancelReason?:string};
  expect(['needs_attention','cancelled']).toContain(j.status);expect(j.cancelReason).toBeTruthy();
  if(j.status==='needs_attention')expect(j.attentionReason).toBe('CANCEL_DURING_STEP');
  expect(types(r)).not.toContain('CoffeeJobDelivered');expect(r.outcome.served).toBe('0');
 }finally{await run.close();}
});

check('ARM06 runner: arm reboot after an accepted pick: transfer outcome unknown, cup keeps its last owner, the program is not resent',async()=>{
 const run=await openCoffee('BV01',{seed:2});
 try{
  await run.start();await stepUntil(run,v=>!!v.coffee?.jobs.some(j=>j.status==='transferring'),5);
  await act(run,'injectFault',{faultId:'arm-reboot'});
  const v=await stepUntil(run,x=>x.run.status==='needs_attention'||terminal(x),5);expect(reasons(v)).toContain('TRANSFER_UNKNOWN');
  await act(run,'step',{ticks:400});const r=await run.report();trace('ARM06',r);
  const picks=r.coffee!.cellEffects.filter(e=>e.payload.jobId==='coffee-job-1'&&e.payload.capability==='start_job');expect(picks).toHaveLength(1);expect(picks[0]!.attempts).toBe(1);
  const cup=r.coffee!.cups.find(c=>c.cupId==='cup-1')!;expect(cup.ownerKind).toBe('cell');expect(cup.movements).toEqual([]);expect(r.outcome.served).toBe('0');
 }finally{await run.close();}
});

check('BV08 runner: machine not ready between StartJob and the brew step: the step waits visibly with MACHINE_NOT_READY (no latch) and opens only once readiness returns',async()=>{
 const run=await openCoffee('BV01',{seed:1});
 try{
  await run.start();
  const started=(x:View)=>x.coffee?.jobs.find(j=>j.jobId==='coffee-job-1')?.status==='started';
  let v=await stepUntil(run,x=>started(x)||terminal(x),1);expect(started(v)).toBe(true);
  await act(run,'injectFault',{faultId:'machine-not-ready'});const at=v.tick;
  v=await act(run,'step',{ticks:20});
  const waiting=v.coffee!.jobs.find(j=>j.jobId==='coffee-job-1')!;
  expect(waiting).toMatchObject({status:'started',waitingReason:'MACHINE_NOT_READY'});expect(v.attention).toEqual([]);expect(v.run.status).toBe('running');
  v=await stepUntil(run,undefined,50);
  const r=await run.report();trace('BV08',r);
  const log=r.coffee!.plantLog as {tick:number;event:string;commandId?:string}[];
  const brew=r.coffee!.cellEffects.find(e=>e.payload.jobId==='coffee-job-1'&&e.payload.capability==='brew')!;
  const accepted=log.find(l=>l.commandId===brew.payload.commandId&&l.event==='accepted')!.tick;
  expect(accepted).toBeGreaterThanOrEqual(at+150); // the illustrative 150-tick warm-up must elapse: only renewed readiness opens the step
  expect(log.some(l=>l.event==='fault:machine-not-ready'&&l.tick<accepted)).toBe(true);
  expect(r.attention).toEqual([]);expect(r.outcome).toMatchObject({status:'completed',served:'2'});
 }finally{await run.close();}
});

// ---------------------------------------------------------------- system (SYS) ----------------------------------------------------------------
check('SYS01 runner: step granularity, pauses and interleaved reads never change the canonical outcome',async()=>{
 const drive=async(chunk:number,pauses:boolean)=>{
  const run=await openFixture('FD01',{seed:9});
  try{await run.start();let v=await run.snapshot(),i=0;
   while(!terminal(v)){if(pauses&&++i%7===0){await act(run,'pause');await run.snapshot();await run.report();await act(run,'resume');}v=await act(run,'step',{ticks:chunk});}
   return await run.report();}finally{await run.close();}
 };
 const ref=await drive(500,false),fine=await drive(5,true),mid=await drive(37,false);
 trace('SYS01',ref);expect(canonicalOutcome(fine)).toEqual(canonicalOutcome(ref));expect(canonicalOutcome(mid)).toEqual(canonicalOutcome(ref));
 expect(ref.manifest).toMatchObject({backendSetId:'mock-amr',clock:{tickMs:TICK_MS}});
});

check('SYS02 runner: executor crash after a committed accept: reopen holds unknown, keeps cargo/owner, never resends',async()=>{
 const directory=await runDirectory();
 let run=await openFixture('FD01',{seed:42,directory});
 await run.start();while(!(await journalHas(run,'CargoLoaded')))await act(run,'step',{ticks:10});
 await act(run,'injectFault',{faultId:'crash-after-commit'});
 await expect(act(run,'step',{ticks:1500})).rejects.toThrow('SIMULATED_CRASH');
 run=await openFixture('FD01',{seed:42,directory});
 try{
  const v=await run.snapshot();expect(v.run.status).toBe('needs_attention');expect(reasons(v)).toContain('RECOVERY_UNKNOWN');expect(v.entities[0]!.quality).toBe('stale');
  const before=await run.report();await act(run,'step',{ticks:500});const after=await run.report();trace('SYS02',after);
  expect(after.effects).toEqual(before.effects);expect(after.outcome.served).toBe('0');expect(types(after)).not.toContain('DeliveryHandedOff');
  expect(after.recoveredOps.at(-1)).toMatchObject({type:'Robot.Observe',committed:true});
 }finally{await run.close();}
});

check('SYS03 runner: duplicate and stale retained completions are absorbed or rejected; no terminal state revived, served once',async()=>{
 const run=await openFixture('FD01',{seed:4});
 try{
  await run.start();while(!(await journalHas(run,'MissionArrived')))await act(run,'step',{ticks:5});
  await act(run,'injectFault',{faultId:'duplicate-arrival',entityId:'amr-1'});
  await stepUntil(run,v=>v.entities[0]!.moving,5);
  await act(run,'injectFault',{faultId:'duplicate-arrival',entityId:'amr-1'}); // stale completion of the previous leg while the next leg runs
  await stepUntil(run,undefined,50);
  await act(run,'injectFault',{faultId:'duplicate-arrival',entityId:'amr-1'}); // after the run completed
  await act(run,'step',{ticks:10});
  const r=await run.report();trace('SYS03',r);
  expect(r.outcome).toMatchObject({status:'completed',served:'1'});expect(count(r,'DeliveryHandedOff')).toBe(1);expect(count(r,'MissionArrived')).toBe(3);
  expect(r.rejectedObservations.length).toBeGreaterThanOrEqual(1);expect(r.rejectedObservations.every(o=>/STALE|NOT_FOUND|FINAL|CONFLICT/.test(o.code))).toBe(true);
 }finally{await run.close();}
});

check('SYS05 runner: reading the report and journal repeatedly is read-only (journal, effects and revision unchanged)',async()=>{
 const run=await openFixture('FD01',{seed:6});
 try{
  await run.start();await act(run,'step',{ticks:300});
  const v0=await run.snapshot(),j0=(await run.journal()).length,r0=await run.report();
  for(let i=0;i<3;i++){await run.report();await run.journal();await run.snapshot();}
  const v1=await run.snapshot(),r1=await run.report();trace('SYS05',r1);
  expect((await run.journal()).length).toBe(j0);expect(v1.run.runRevision).toBe(v0.run.runRevision);expect(r1.effects).toEqual(r0.effects);expect(canonicalOutcome(r1)).toEqual(canonicalOutcome(r0));
 }finally{await run.close();}
});

// ---- the real v2 gateway: capability denial, identity, mode immutability (SYS06, QA-06/07/12) and the transport-deny boundary ----
const origin='http://127.0.0.1:4175',schemaHash='a'.repeat(64),gateways:LabGateway[]=[],gwDirs:string[]=[];
afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of gwDirs.splice(0))await rm(d,{force:true,recursive:true});});
const post=(url:string,headers:Record<string,string>,body:unknown)=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
async function gateway(){
 const directory=await mkdtemp(join(tmpdir(),'lab-v2-acc-'));gwDirs.push(directory);
 const g=await startLabGateway({port:0,directory,sourceCommit:'acceptance',schemaHash,v2:{enabledBackends:['mock_amr','mock_coffee','mock_arm']}});gateways.push(g);
 const r=await post(g.url+'/lab/v2/sessions',{Origin:origin,'Content-Type':'application/json'},{token:g.issuePairingToken()});
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:r.headers.get('set-cookie')!.split(';')[0]!,'X-CSRF-Token':(await r.json() as {csrfToken:string}).csrfToken};
 return {g,headers,body:{project:coffeeProject(),scenarioId:'BV01',scenarioRevision:1,seed:42,mode:'mock',backendSetId:'mock-default',access:'simulated',runtimeIdentity:{sourceCommit:'acceptance',schemaHash}}};
}
check('SYS06 gateway: missing/wrong backend or identity is blocked with a reason, never a fallback; a run cannot change mode',async()=>{
 const {g,headers,body}=await gateway(),runs=g.url+'/lab/v2/runs';
 const deny=async(over:Record<string,unknown>,status:number,code:string)=>{const r=await post(runs,headers,{...body,...over}),j=await r.json();evidence.gateway.push({request:over,expected:{status,code},actual:{status:r.status,body:j}});expect(r.status).toBe(status);expect(JSON.stringify(j)).toContain(code);};
 await deny({mode:'simulation',backendSetId:'simulation-default'},422,'BACKEND_NOT_INSTALLED');
 await deny({mode:'hardware',access:'live',backendSetId:'hardware-live'},403,'ACCESS_NOT_GRANTED');
 await deny({mode:'hardware',access:'hil',backendSetId:'hardware-hil'},403,'ACCESS_NOT_GRANTED');
 await deny({mode:'hardware',access:'shadow',backendSetId:'hardware-shadow'},422,'BACKEND');
 await deny({runtimeIdentity:{sourceCommit:'other',schemaHash}},409,'CONTRACT_MISMATCH');
 await deny({backendSetId:'mock-amr'},422,'SCENARIO_BACKEND_MISSING');
 const created=await post(runs,headers,body);expect(created.status).toBe(201);const v=await created.json() as {run:{id:string;backends:string[]}};
 expect(v.run.backends).toEqual(['mock_amr','mock_coffee','mock_arm']);
 const bad=await post(`${runs}/${v.run.id}/actions`,headers,{actionId:'m1',expectedRevision:0,kind:'setMode',payload:{mode:'hardware'}});expect(bad.status).toBe(422);
 const snap=await (await fetch(`${runs}/${v.run.id}`,{headers})).json() as {run:{mode:string;access:string}};expect(snap.run).toMatchObject({mode:'mock',access:'simulated'});
 trace('SYS06-created',await (await fetch(`${runs}/${v.run.id}/report`,{headers})).json() as RunReport);
});

check('QA-06 transport deny: a full coffee run through the gateway opens no robot/cell socket, process or datagram; hardware sets stay denied',async()=>{
 const {g,headers,body}=await gateway();
 // spies sit at the effect boundary from before run creation (backend instantiation included); the test client's fetch uses undici, not node:http/net.connect
 const spies=[vi.spyOn(net.Socket.prototype,'connect'),vi.spyOn(net,'connect'),vi.spyOn(net,'createConnection'),vi.spyOn(http,'request'),vi.spyOn(http,'get'),vi.spyOn(https,'request'),vi.spyOn(https,'get'),vi.spyOn(dgram,'createSocket'),
  vi.spyOn(child,'spawn'),vi.spyOn(child,'exec'),vi.spyOn(child,'execFile'),vi.spyOn(child,'fork'),vi.spyOn(child,'spawnSync'),vi.spyOn(child,'execSync')];
 try{
  const created=await (await post(g.url+'/lab/v2/runs',headers,body)).json() as {run:{id:string}},url=`${g.url}/lab/v2/runs/${created.run.id}`;
  let rev=0,i=0,status='ready';
  for(;!['completed','needs_attention','cancelled'].includes(status)&&i<400;i++){
   const r=await post(url+'/actions',headers,{actionId:`q${i}`,expectedRevision:rev,kind:i?'step':'start',payload:i?{ticks:50}:{}});expect(r.status).toBe(200);
   const v=await r.json() as {run:{runRevision:number;status:string}};rev=v.run.runRevision;status=v.run.status;
  }
  expect(status).toBe('completed');
  const report=await (await fetch(url+'/report',{headers})).json() as RunReport;expect(report.outcome.served).toBe('2');trace('QA-06',report);
  expect(report.coverage).toMatchObject({nativeExecution:false,physicalStop:false,sensorEvidence:false,dynamics:false});
  // only the test client's loopback requests exist; no spy saw a call from the runtime
  // net.* may only carry the test client's own loopback connections to the gateway port (undici opens them via net.connect)
  const net3=spies.slice(0,3),port=Number(new URL(g.url).port);
  for(const s of spies.slice(3))expect(s).not.toHaveBeenCalled();
  for(const s of net3)for(const call of s.mock.calls){const [raw,b]=call as unknown[],a=Array.isArray(raw)?raw[0]:raw;/* Socket#connect gets normalized [options,cb] */const o=typeof a==='object'&&a?a as {port?:number;host?:string}:{port:Number(a),host:typeof b==='string'?b:undefined};expect(Number(o.port)).toBe(port);expect([undefined,'127.0.0.1','localhost','::1']).toContain(o.host);}
 }finally{for(const s of spies)s.mockRestore();}
 const denied=await post(g.url+'/lab/v2/runs',headers,{...body,mode:'hardware',access:'live',backendSetId:'hardware-live'});expect(denied.status).toBe(403);
});

// ---------------------------------------------------------------- seeds, repeats, timing ----------------------------------------------------------------
const SEEDS=Array.from({length:20},(_,i)=>1000+i);
check('QA-03 stochastic: FD01 and FD02 over 20 fixed seeds hold every invariant; each seed repeats to the same digest 3 times',async()=>{
 for(const id of ['FD01','FD02']){
  evidence.digests[id]=[];
  for(const seed of SEEDS){
   const r=await executeFixture(id,{seed});
   const c=canonicalOutcome(r) as {manifest:Record<string,unknown>};
   evidence.digests[id].push({seed,digest:outcomeDigest(r),seedlessDigest:hashJson({...c,manifest:{...c.manifest,seed:0}}),atTicks:r.workload.map(w=>w.atTick),status:r.outcome.status,served:r.outcome.served});
   if(r.outcome.status!=='completed'||seed===SEEDS[0])trace(`${id}-seed-${seed}`,r);
   expect(r.outcome).toMatchObject({status:'completed',served:id==='FD01'?'1':'3'});
   expect(r.metrics.collision).toMatchObject({contacts:0});expect(r.rejectedObservations).toEqual([]);
   expect(executes(r).every(e=>e.attempts===1&&e.status==='confirmed')).toBe(true);
   const t=types(r);expect(t.indexOf('CargoLoaded')).toBeLessThan(t.indexOf('DeliveryHandedOff'));
  }
  // seeds are real perturbations here (atTick ranges): the drawn order ticks differ, and so do outcomes with the manifest seed normalised out
  expect(new Set(evidence.digests[id].map(d=>JSON.stringify(d.atTicks))).size).toBeGreaterThan(1);
  expect(new Set(evidence.digests[id].map(d=>d.seedlessDigest)).size).toBeGreaterThan(1);
  const seed=SEEDS[0]!;evidence.repeats[`${id}@${seed}`]=[];
  for(let i=0;i<3;i++)evidence.repeats[`${id}@${seed}`]!.push(outcomeDigest(await executeFixture(id,{seed})));
  expect(new Set(evidence.repeats[`${id}@${seed}`]).size).toBe(1);expect(evidence.repeats[`${id}@${seed}`]![0]).toBe(evidence.digests[id][0]!.digest);
 }
},600000);

check('QA-03 deterministic scenarios: FD07, BV01, FD03, FD04-reopen repeat 3 times to one digest (seed is provenance only)',async()=>{
 for(const [id,exec] of [['FD07',(s:number)=>executeFixture('FD07',{seed:s})],['BV01',(s:number)=>executeCoffee('BV01',{seed:s})],['FD03',(s:number)=>executeFixture('FD03',{seed:s})],['FD04-reopen',(s:number)=>executeFixture('FD04-reopen',{seed:s,project:corridor()})]] as const){
  const d:string[]=[];for(let i=0;i<3;i++){const r=await exec(77);if(!i)trace(`${id}@77`,r);d.push(outcomeDigest(r));}evidence.repeats[`${id}@77`]=d;expect(new Set(d).size).toBe(1);
  // no random input in these definitions: another seed changes only the manifest's seed, never the events
  const other=canonicalOutcome(await exec(78)) as {manifest:{seed:number}};const same=canonicalOutcome(await exec(77)) as {manifest:{seed:number}};
  expect({...other,manifest:{...other.manifest,seed:0}}).toEqual({...same,manifest:{...same.manifest,seed:0}});
 }
},600000);

/** Sim-time durations (virtual clock, ms) read from the journal and plant log; a duration without both ends is null, never 0. */
function timings(r:RunReport){
 const at=(e:{at:string})=>Date.parse(e.at),ev=r.businessEvents;
 const issued=new Map(ev.filter(e=>e.type==='RobotCommandIssued').map(e=>[e.id,at(e)]));
 const travel=ev.filter(e=>e.type==='RobotCommandObserved'&&(e.state as {status:string}).status==='completed').map(e=>issued.has(e.id)?at(e)-issued.get(e.id)!:null);
 const lines=new Map<string,{created?:number;served?:number}>();
 for(const e of ev){if(e.type==='FulfillmentLineCreated')lines.set(e.id,{created:at(e)});if(e.type==='FulfillmentQuantityChanged'&&Number((e.state as {served?:string}).served??0)>0&&lines.get(e.id)&&lines.get(e.id)!.served===undefined)lines.get(e.id)!.served=at(e);}
 const log=(r.coffee?.plantLog??[]) as {tick:number;event:string;commandId?:string}[],cell=r.coffee?.cellEffects??[];
 const span=(cap:(e:typeof cell[number])=>boolean)=>cell.filter(cap).map(e=>{const a=log.find(l=>l.commandId===e.payload.commandId&&l.event==='accepted'),c=log.find(l=>l.commandId===e.payload.commandId&&l.event==='completed');return a&&c?(c.tick-a.tick)*TICK_MS:null;});
 const ready=new Map(ev.filter(e=>e.type==='CoffeeQualityConfirmed').map(e=>[String((e.state as {cupId:string}).cupId),at(e)]));
 const transfer=(r.coffee?.cups??[]).map(c=>{const m=c.movements.find(x=>x.to.kind==='robot');return m&&ready.has(c.cupId)?Date.parse(m.at)-ready.get(c.cupId)!:null;});
 const k=reportKpis(r).find(x=>x.id==='humanWaitS')!;
 return {travelMs:travel,guestWaitMs:[...lines.values()].map(l=>l.created!==undefined&&l.served!==undefined?l.served-l.created:null),
  brewMs:span(e=>e.payload.capability==='brew'),dispenseMs:span(e=>e.payload.capability==='dispense'),readyToTrayMs:transfer,
  staffWaitMs:k.available?k.value!*1000:null,
  interventions:{humanConfirmations:r.confirmations.filter(c=>c.provenance==='human').length,scriptedConfirmations:r.confirmations.filter(c=>c.provenance==='scripted').length,reconciliations:r.reconciliations.length,attention:r.attention.length}};
}
check('Timing: two runs compare wait/travel/brew/transfer and interventions against thresholds fixed before the run',async()=>{
 // thresholds recorded in mock-report.md before this run: same-input sim durations equal (|delta| = 0 ms); wall clock per BV01 run <= 30 s, per FD01 run <= 10 s
 const THRESHOLDS={sameInputDeltaMs:0,bv01WallMs:30000,fd01WallMs:10000};
 const timed=async<T>(f:()=>Promise<T>)=>{const t=performance.now();const v=await f();return {v,wallMs:Math.round(performance.now()-t)};};
 const a=await timed(()=>executeCoffee('BV01',{seed:11})),b=await timed(()=>executeCoffee('BV01',{seed:11}));
 const c=await timed(()=>executeFixture('FD01',{seed:11})),d=await timed(()=>executeFixture('FD01',{seed:12}));
 const ta=timings(a.v),tb=timings(b.v),tc=timings(c.v),td=timings(d.v);trace('Timing-BV01@11',a.v);trace('Timing-FD01@11',c.v);
 evidence.timing={thresholds:THRESHOLDS,host:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,cpus:os.cpus().length,memGiB:Math.round(os.totalmem()/2**30),node:process.version},
  runs:{'BV01@11#1':{wallMs:a.wallMs,...ta},'BV01@11#2':{wallMs:b.wallMs,...tb},'FD01@11':{wallMs:c.wallMs,...tc},'FD01@12':{wallMs:d.wallMs,...td}},
  compareFD01:compareRuns(c.v,d.v).kpis.map(k=>({id:k.id,unit:k.unit,a:k.a,b:k.b,delta:k.delta,available:k.available,reasons:k.reasons})),
  notApplicable:{'FD01.brewMs':'no coffee in FD01','FD01.readyToTrayMs':'no coffee in FD01'}};
 const {interventions:ia,...da}=ta,{interventions:ib,...db}=tb;expect(db).toEqual(da);expect(ib).toEqual(ia);
 expect(ta.brewMs.every(x=>x!==null)).toBe(true);expect(ta.brewMs).toHaveLength(2);expect(ta.readyToTrayMs.every(x=>x!==null&&x>0)).toBe(true);expect(ta.travelMs.every(x=>x!==null&&x>0)).toBe(true);
 expect(tc.brewMs).toEqual([]);expect(tc.staffWaitMs).not.toBeNull();
 expect(a.wallMs).toBeLessThanOrEqual(THRESHOLDS.bv01WallMs);expect(b.wallMs).toBeLessThanOrEqual(THRESHOLDS.bv01WallMs);expect(c.wallMs).toBeLessThanOrEqual(THRESHOLDS.fd01WallMs);expect(d.wallMs).toBeLessThanOrEqual(THRESHOLDS.fd01WallMs);
},300000);

// ---------------------------------------------------------------- coverage table ----------------------------------------------------------------
// One row per mock-capable assertion (verification.md §1/§3-§5, product-experience.md UX table). `test`: self:<check title> (executed above),
// source:<file>::<test title> or lab:<file>::<test title> (other suites; executed in the regression run recorded in mock-report.md).
type Reason='UNSUPPORTED_FIDELITY'|'NOT_IMPLEMENTED'|'BLOCKED_EXTERNAL'|'NEEDS_HUMAN';
interface Row {id:string;level:'runner'|'gateway'|'domain'|'model'|'lab'|'browser'|'host'|'human';expected:string;tests:string[];status:'pass'|'not_run';reason?:Reason;note?:string}
const T=(prefix:string)=>{const t=[...titles].find(x=>x.startsWith(prefix));if(!t)throw new Error(`no check titled ${prefix}`);return `self:${t}`;};
const src=(file:string,title:string)=>`source:tests/integration/${file}::${title}`,lab=(file:string,title:string)=>`lab:tests/${file}::${title}`;
const pass=(id:string,level:Row['level'],expected:string,tests:string[],note?:string):Row=>({id,level,expected,tests,status:'pass',...note?{note}:{}});
const notRun=(id:string,level:Row['level'],expected:string,reason:Reason,note:string,tests:string[]=[]):Row=>({id,level,expected,tests,status:'not_run',reason,note});
const C={
 tw:(t:string)=>lab('e2e/twin-workspace.spec.ts',t),rec:lab('e2e/twin-recovery.spec.ts','telemetry stream, stale/frozen states, reconnect, read-only replay, compare, export and a lost session'),
 cj:lab('e2e/coffee-journey.spec.ts','missing cup: visible reason and entity, confirmed reconcile, corrected run completes'),s01:lab('e2e/service-journey.spec.ts','paired source runtime drives arrival then human load and handoff'),
 ui:(t:string)=>lab('e2e/ui.spec.ts',t),rr:(t:string)=>lab('unit/report-replay.test.ts',t),ws:(t:string)=>lab('unit/twin-workspace.test.ts',t),tt:(t:string)=>lab('unit/twin-telemetry.test.ts',t),
 arm:(t:string)=>src('lab-v2-arm-model.test.ts',t),cof:(t:string)=>src('coffee-job.test.ts',t),
};
function coverage():Row[]{return [
 // ---- QA rules (§1)
 pass('QA-01','runner','runner/gateway rows resolve to records with scenario id/revision/hash, backend set and backend versions, expected text, actual outcome and digest; suite-only rows resolve to stored machine-readable results with command, timestamp and sha256',[T('QA-01 evidence')],'granularity is one record per check, not per expect(); raw refs are trace keys in F08-mock-acceptance.json and files in regression/manifest.json'),
 pass('QA-02a','runner','run manifest holds project/world/scenario/source/backend set/backend versions/asset content hashes, seed, PRNG and clock',[src('lab-v2-mock.test.ts','FD01: same seed and inputs give the same canonical outcome, built from journal events and three observed legs'),T('SYS01'),T('QA-01 evidence')]),
 pass("QA-02b","runner","run manifest holds design, recipe, adapter and config hashes plus explicit calibration/profile provenance",[src("lab-v2-software-gaps.test.ts","coffee manifest locks every design, recipe, model, adapter and illustrative profile without implying calibration")]),
 pass('QA-03','runner','same inputs/seed/source give the same normalized trace; 20 seeds for stochastic scenarios, 3 repeats per input',[T('QA-03 stochastic'),T('QA-03 deterministic')]),
 pass('QA-04','runner','the backend clock executes; step size, pauses and reads never change the domain result',[T('SYS01')],'browser render-rate/visibility evidence is linked separately under SYS01-render'),
 pass('QA-05','runner','negative cases exist and hold: stale, duplicate, missing ACK, no-path, invalid recipe/joints/cup, backend unavailable',[T('SYS03'),T('BV05'),T('FD04 runner: lane closed'),T('BV02 runner: no cup'),T('SYS06'),C.cof('reservation is atomic and resources are exclusive'),C.arm('joint limits are enforced: a target reachable only outside the limits is JOINT_LIMIT')]),
 pass('QA-06','gateway','report/replay/import/runs execute no robot/cell/arm/payment/print effect: checked at the transport boundary',[T('QA-06'),src('lab-v2-stream.test.ts','reading the report and both streams is read-only: command count and journal are unchanged'),C.rr('replay is read-only: seek returns recorded events and the pose at the cursor; the report is never mutated')],'payment/print effects do not exist in the Lab runtime; spies cover net/http/https/dgram/child_process'),
 pass('QA-07','gateway','missing backend/capability/runtime is blocked with a reason; no fallback to a pass',[T('SYS06'),lab('integration/mock-launcher.test.ts','an unavailable mock backend fails explicitly and stops the runtime it started'),lab('integration/mock-launcher.test.ts','missing runtime says preview only and how to install; never starts a stand-in')]),
 pass('QA-08','runner','metrics carry unit, definition, population; missing data is unavailable, never 0',[src('lab-v2-report.test.ts','compareRuns: same scenario/mode/backends with another seed is comparable, KPIs carry unit, definition and population'),src('lab-v2-report.test.ts','a KPI without data is unavailable with a reason, never 0'),T('Timing')]),
 pass('QA-09a','lab','edits are immutable revisions; migration keeps the old record and rolls back on interruption',[lab('unit/core-design-world.test.ts','edits coordinates immutably and invalidates old reports and bindings'),lab('integration/project-v2-migration.test.ts','an interruption mid-transaction leaves no half-save: backup, v2 and the readable v1 are as before')]),
 pass("QA-09b","lab","editing model/world/recipe/profile marks immutable stored evidence stale by scope",[lab("unit/report-evidence.test.ts","saved reports remain immutable while geometry/world/recipe/profile edits stale only the corresponding scope")]),
 pass('QA-10','model','freshness, frames and units checked independently; commanded never stands in for observed',[C.tt('freshness: heartbeat alive does not refresh a pose that stopped updating; paused sim is FROZEN_SIM; lost link is disconnected'),src('lab-v2-model.test.ts','transform convention T_A_B: golden world pose through cell_base yaw 90 deg and arm_base offset'),C.arm('source units convert to SI explicitly: inch->m and deg->rad, never silently'),C.ws('inspector separates observed from commanded, keeps units and leaves unknown unknown')]),
 pass('QA-11','browser','WebGL loss, disconnect and reload never change command ownership or repeat an effect; history resumes by cursor',[C.rec,C.tw('WebGL disabled and reduced motion fall back to a 2D twin with the same controls'),C.ui('desktop workshop screenshot and WebGL context loss retain configuration')]),
 pass('QA-12','gateway','mock/simulation never promotes a hardware gate; hardware sets are denied in the Lab',[T('SYS06'),T('QA-06'),src('lab-v2-contracts.test.ts','evidence records only allow the four spec results'),lab('unit/core-deployment.test.ts','exports hashed inputs without promoting simulation into hardware validation')],'the hardware gate content itself (identity, calibration, owner signature) is H-only: blocked_external'),
 // ---- food delivery (§3)
 pass('FD01','runner','0 delivered before load/handoff; right allocation; arrival from observation; three traced legs; parks, never charges',[T('FD01 runner'),T('QA-03 stochastic')]),
 pass('FD02','runner','confirming table A transfers only A; remaining stop and cargo correct',[T('FD02 runner'),T('QA-03 stochastic')]),
 pass("FD02-cups","runner","food and identified coffee share a mission without mixing allocation custody",[src("lab-v2-mixed.test.ts","FD02-cups carries food and its identified coffee cup on one mission, then serves each allocation once")]),
 pass('FD03','runner','a person crossing the route: the robot waits/replans in the model, no penetration, resumes with a recorded cause',[T('FD03 runner'),T('QA-03 deterministic')],'person = scheduled 0.4 m obstacle stepping 0.2 m every 15 ticks; avoidance is the mock hold/replan rule on a geometric grid, not sensing'),
 notRun('FD03-sensor','runner','reaction to a sensed pedestrian (Nav2/sensor)','UNSUPPORTED_FIDELITY','mock_kinematic has no sensors or dynamics; S/H only (G-SIM-NAV blocked_external on this host)'),
 pass('FD04-chair','runner','chair on the target: no false arrival, attention with a reason, no teleport',[T('FD04 runner: chair')]),
 pass('FD04-blocked','runner','lane fully closed: hold then NO_PATH attention, no arrival, no contact',[T('FD04 runner: lane closed')]),
 pass('FD04-reopen','runner','lane reopened: resume only by policy (inside the hold window), recorded hold and clear',[T('FD04 runner: lane reopened'),T('QA-03 deterministic')]),
 ...['payload','battery','capability','binding'].map(k=>pass(`FD05-${k}`,'runner','refused before native start with the right code; no stock change, nothing served',[T(`FD05-${k}`)])),
 pass('FD06-cancel','runner','cancel while holding cargo: mission stops on evidence, cargo explicit, return + staff disposition, never delivered',[T('FD06 runner')]),
 pass('FD06-retarget','domain','retarget while en route: new revision, no stale leg',[src('table-order-amendments.test.ts','moving a table while the robot is en route retargets the mission under a bumped revision')],'domain level only: the Lab action schema has no retarget action, so no runner check'),
 pass('FD07','runner','one corridor owner by policy, no undetected deadlock, both deliver',[T('FD07 runner'),T('QA-03 deterministic')],'the simulator profile serialises on the venue-wide movement zone; granular per-corridor zones are not enabled'),
 pass('FD07-ttl','domain','an unknown reservation is not released by TTL',[src('robot-admission.test.ts','an unknown reservation is not released on TTL; a known idle holder lapses')],'domain level only: the mock runner never produces an unknown zone reservation'),
 pass('FD08-localization','runner','localization lost before arrival: attention, last pose stale, no arrival',[T('FD08 runner: localization')]),
 pass('FD08-map','runner','map revision change: next leg refused, pose stale, nothing served',[T('FD08 runner: map')]),
 pass('FD08-rebind','domain','a new map needs a new binding before dispatch resumes',[src('robot-admission.test.ts','a robot reporting a new map mid-mission is held: confirmed cargo commits, no old-map leg is issued, rebind + resume continues')],'domain level: the Lab runner has no map-report/rebind action'),
 // ---- coffee (§4)
 pass('BV01','runner','recipe steps of the locked revision; espresso without ice/milk; one cup owner; verified dose before pickup; right cup at the table',[T('BV01 runner'),src('coffee-transfer.test.ts','BV01 on mock-default: espresso and iced milk coffee run recipe -> verify -> arm -> robot -> table with one cup owner at a time'),T('QA-03 deterministic')]),
 pass('BV02-nocup','runner','no cup: never starts',[T('BV02 runner: no cup')]),
 pass('BV02-removed','runner','cup removed mid-brew: interlock, partial/unknown explicit, never ready',[T('BV02 runner: cup removed')]),
 pass('BV02-type','domain','wrong cup type/id refused',[C.cof('brew only after cup + machine ready, through station-scoped authorization; espresso never runs ice or milk')],'domain level (CUP_TYPE_MISMATCH, CUP_MISMATCH); no runner fault places a wrong cup'),
 pass("BV02-capacity","domain","cup capacity and headspace refuse overflow before reservation/effects",[src("coffee-policy.test.ts","BV02/BV06 capacity model includes headspace and explicit ice displacement before reservation or effects")]),
 pass('BV03-milk','runner','ingredient out: other order still served, held with reason, no blind retry',[T('BV03 runner: milk')]),
 pass('BV03-ice','runner','ice jam: partial kept, held, no second command',[T('BV03 runner: ice dispenser jammed before'),T('BV03 runner: ice dispenser jams mid')]),
 pass('BV03-contention','runner','two orders on one machine/arm never share it against policy; robot pickup waits for the dock',[T('BV03 runner: two orders'),C.cof('reservation is atomic and resources are exclusive')]),
 pass('BV04-tolerance','runner','out of tolerance or unknown/missing measurement never becomes ready; requested/observed/accepted separate',[T('BV04 runner: dose-low'),T('BV04 runner: measure-unknown'),T('BV04 runner: measure-missing'),C.cof('unknown or out-of-tolerance quantity cannot pass automatic quality; missing measurement needs attention')]),
 pass('BV04-timeout','runner','step timeout on the recipe clock: attention, no resend',[T('BV03 runner: ice dispenser jammed before'),C.cof('a silent device times out its step from the recipe timeout on the command clock: needs attention, no resend')]),
 pass("BV04-outlier","runner","implausible measurement is held with raw evidence, no ready or invented consumption",[src("coffee-policy.test.ts","BV04 mock outlier fault preserves model quantity while source refuses implausible sensor evidence")]),
 pass('BV05','runner','lost ACK / reboot / duplicate id: one effect or unknown + reconcile; no second brew; lifecycle not reset',[T('BV05 runner'),src('coffee-recovery.test.ts','BV05 on mock-default: a cell reboot mid-brew leaves the outcome unknown, never resends, keeps the cup; a human reconcile quarantines it')]),
 pass('BV06-order','domain','wrong step order, recipe/item or hash mismatch refused before the step',[C.cof('recipe order is enforced; ice jam halts the workflow; empty milk rejects its step'),C.cof('reservation is atomic and resources are exclusive'),C.cof('a device observation counts only for its own step: another bound device or another control epoch cannot complete it')],'domain level: the runner always submits the locked recipe, so no runner fault produces a mismatch'),
 pass("BV06-capacity","domain","capacity/headspace policy is frozen and rejects missing conversion assumptions",[src("coffee-policy.test.ts","BV02/BV06 capacity policy is schema validated, frozen with the recipe and rejects missing ice conversion assumptions")]),
 pass('BV07-drop','runner','arm/robot never co-own a cup; robot not released without the right cup',[T('BV07 runner: arm drops')]),
 pass('BV07-dock','runner','dock out of tolerance: no tray transfer, robot held',[T('BV07 runner: robot docked')]),
 pass('BV07-cancel','runner','cancel mid-cycle: disposition for the cup, nothing delivered',[T('BV07 runner: cancel')]),
 pass("BV07-timeout","runner","pickup timeout preserves cup custody and prevents departure",[src("lab-v2-software-gaps.test.ts","a robot that cannot dock times out pickup without departing or losing cup custody")]),
 pass('BV08-ready','runner','machine not ready blocks the step; only renewed readiness opens it',[T('BV08 runner')]),
 pass('BV08-cleaning','domain','cleaning overdue / stale interlock blocks with a reason until an audited cleaning',[src('coffee-recovery.test.ts','cleaning overdue and stale interlocks block the cell with a reason until an audited cleaning is recorded')]),
 pass("BV08-milk-policy","domain","batch/open-time/cold-chain/fresh temperature policy cannot be bypassed by reboot",[src("coffee-policy.test.ts","BV08 reboot cannot reset batch opening time or cold-chain failure; a documented new batch with fresh temperature permits milk"),src("coffee-policy.test.ts","BV08 cold-handling evidence lost after milk dispensing blocks quality and fulfillment readiness")]),
 pass("CAMPAIGN-FD02+FD07+BV01+BV03","runner","versioned concurrent food/coffee workload with two robots, resource queue, travel, human wait and process busy metrics",[src("lab-v2-mixed.test.ts","the versioned food, corridor and coffee campaign executes both AMRs and queues the second coffee job without sharing a cup")]),
 // ---- arm (§5)
 pass('ARM01','model','FK independent oracle, seeded IK within tolerance, units/frames; runner arm trace within limits',[C.arm('FK agrees with the independent Craig oracle at 200 seeded configurations within 1e-6 m / 1e-6 rad'),C.arm('IK from a nearby seed converges inside the fixture tolerance and is deterministic'),T('BV01 runner')]),
 pass('ARM02','model','out of workspace / joint limit / invalid configuration refused, never clipped',[C.arm('IK rejects unreachable targets with a structured result, not a clipped success'),C.arm('joint limits are enforced: a target reachable only outside the limits is JOINT_LIMIT'),C.arm('FK refuses wrong joint vectors and source-unit models')]),
 pass("ARM03","model","conservative swept collision checks links/gripper/held cup between samples with engine/model/tolerance/pair evidence",[src("lab-v2-arm-safety-model.test.ts","ARM03 swept checker catches a thin obstacle between clear endpoint poses and identifies the geometry pair"),src("lab-v2-arm-safety-model.test.ts","ARM03 held cup participates in collision checks; no cup means the same fixture is clear"),src("lab-v2-arm-safety-model.test.ts","ARM03 non-adjacent links and the gripper are checked as geometry, not only the TCP point"),src('lab-v2-arm-scene.test.ts','ARM03 project fixture stops real arm motion and leaves the cup at the nozzle'),src('lab-v2-arm-scene.test.ts','ARM03 the current AMR pose and compiled radius block the arm independently of project fixtures'),src('lab-v2-arm-scene.test.ts','ARM03 a project fixture touching only the held cup blocks motion and retains attachment'),src('lab-v2-arm-scene.test.ts','ARM03 a robot entering a stationary held-cup arm is checked between programs')]),
 pass('ARM04','model','near singularity / branch change / velocity limit: continuity kept or refused',[C.arm('near-singular wrist (J5 -> 0, LinuxCNC JOINT_4) is rejected with its condition number'),C.arm('IK keeps branch continuity along a path and selects the wrist branch nearest the seed'),C.arm('velocity limit rejects a step the joints cannot make in the stated time')],'acceleration limits are not modelled'),
 pass("ARM05","model","modeled following error/stop/E-stop then reset keeps uncertainty and does not resume",[src("lab-v2-arm-faults.test.ts","ARM mock arm-following-error reaches source attention, preserves cup custody and cannot resume by reset"),src("lab-v2-arm-faults.test.ts","ARM mock arm-stop reaches source attention, preserves cup custody and cannot resume by reset"),src("lab-v2-arm-faults.test.ts","ARM mock arm-estop reaches source attention, preserves cup custody and cannot resume by reset")]),
 pass('ARM06','runner','link loss / reboot after accept: no blind resend; unknown holds cup ownership until reconcile',[T('ARM06 runner'),src('coffee-transfer.test.ts','arm outcome unknown during transfer holds the cup with its last known owner and the job needs attention')]),
 // ---- system (§5)
 pass('SYS01','runner','same inputs: same normalized trace regardless of step size/pauses; manifest names the backend set',[T('SYS01'),T('QA-03 deterministic')]),
 pass("SYS01-render","browser","measured 15/60 FPS and actual debugger-paused renderer preserve normalized journal/effects",[lab("e2e/twin-plan01.spec.ts","SYS01: normalized journal/effects are identical at 15/60 FPS and while the browser renderer is debugger-paused")],'CDP Debugger.paused acknowledgement and zero in-interval draws; not an OS background-tab throttling claim'),
 pass('SYS02-executor','runner','executor crash after accept: no owner change, no duplicate effect, unknown vs stale explicit',[T('SYS02'),src('lab-v2-recovery.test.ts','crash after journal commit and before checkpoint reopens as needs_attention, keeps cargo and never resends')]),
 pass('SYS02-ui','browser','UI/gateway loss and reconnect: no duplicate action, lost session explicit',[C.rec]),
 pass("SYS02-reclaim","gateway","new paired session/runtime requires ownership proof and reclaims view/reconcile-only evidence",[src("lab-v2-stream.test.ts","a new paired runtime reclaims durable evidence only with the local proof and cannot re-drive the run"),src("lab-v2-stream.test.ts","archiving frees an active slot while preserving proof-protected evidence for later reclaim"),src('lab-v2-reclaim-targets.test.ts','reclaim at the actual FD01 first completed navigation exposes the waiting robot for audited reconciliation'),lab('unit/workspace-reclaim.test.ts','multiple known reconciliation targets require an explicit selection and never default to the first robot')]),
 pass('SYS03','runner','duplicate / stale retained completions never revive a terminal state or count twice',[T('SYS03'),T('BV05')]),
 pass("SYS03-reorder","runner","delayed and reordered observations neither duplicate execution nor served quantity",[src("lab-v2-software-gaps.test.ts","reorder-observations keeps one served item and does not repeat execution"),src("lab-v2-software-gaps.test.ts","delay-observation keeps one served item and does not repeat execution")]),
 pass('SYS04','lab','geometry edit is a new revision; bad/old import refused without damage; saved run reopens with its locked inputs',[lab('unit/core-design-world.test.ts','rejects unknown fields, nonfinite numbers and unsupported import schemas'),lab('integration/project-store.test.ts','rejects corrupt imports before overwriting a saved project'),src('lab-v2-recovery.test.ts','clean close and reopen resumes from the checkpoint with the uninterrupted canonical outcome')],'scope-based staleness of old v2 reports: see QA-09b'),
 pass('SYS05','runner','replay/scrub/export/import cause no effect; action-like fields inert or refused',[T('SYS05'),T('QA-06'),C.rr('replay is read-only: seek returns recorded events and the pose at the cursor; the report is never mutated'),lab('unit/core-deployment.test.ts','rejects live state, credentials and forged validation in candidate inputs')]),
 pass('SYS06','gateway','backend missing/wrong version/mode change: blocked with reason, no fallback; backend death mid-run held unknown',[T('SYS06'),T('BV05'),T('FD08 runner: localization')]),
 // ---- UX (product-experience.md)
 pass('UX-01','browser','sample project with food and coffee runs through the source runner; missing runner is explained, never completed',[C.tw('coffee preset runs on the mock backend with a locked, visible identity'),lab('integration/mock-launcher.test.ts','missing runtime says preview only and how to install; never starts a stand-in')]),
 notRun('UX-01-time','human','start mock within 3 min, complete/report within 5 min, find a fault cause within 2 min (>=5 new users)','NEEDS_HUMAN','guided usability with representative users cannot be performed by an agent'),
 pass('UX-02','browser','2D/3D of the same run keeps run id, time, selection; no domain action',[C.tw('layers, legend and one shared selection survive a 3D to 2D switch')]),
 pass('UX-03','lab','route, target, footprint, occupancy layers with a legend; unknown stays unknown',[C.ws('layers toggle overlays and the legend names modeled, observed and unknown'),C.tw('layers, legend and one shared selection survive a 3D to 2D switch')]),
 pass('UX-04','browser','mission/cargo/cup/arm state side by side; confirmation names the object',[C.cj,C.s01]),
 pass('UX-05','browser','run/pause/step; an acknowledged pause of the mock clock is not a stop',[C.rec,C.cj]),
 pass("UX-05-reset-speed","browser","reset creates a new immutable run and pacing/plant speed controls have explicit scope",[lab("e2e/twin-inputs.spec.ts","UX05/UX18/QA09b: reset, speed-limit draft, saved report reopening and replay remain independent")]),
 pass('UX-06','browser','fault palette shows where/when a fault applied',[C.cj],'one-shot faults from the UI; schedules exist only as server scenario data (FD03/FD04)'),
 pass('UX-07','browser','inspector values with units, source and freshness; unknown never 0',[C.ws('inspector separates observed from commanded, keeps units and leaves unknown unknown'),C.tw('engineering panel shows units, observed versus commanded and data age')]),
 pass('UX-08','lab','timeline links business events, commands and observations',[C.rr('trace links command -> observation -> business transition for a command, mission or robot id')],'the 2-minute find-the-cause target is UX-01-time (NEEDS_HUMAN)'),
 pass('UX-09','lab','replay: recorded time/cursor, no execute, gaps marked, no interpolation over the gap',[C.rr('replay is read-only: seek returns recorded events and the pose at the cursor; the report is never mutated'),C.rr('pose interpolation only inside the declared max gap and never across an epoch change; gaps are marked'),T('QA-06')]),
 pass('UX-10','lab','compare shows inputs/coverage/samples; never ranks mock against hardware; missing KPI unavailable',[C.rr('compareRuns: comparable for same scenario/mode/backends; never ranks mock against hardware'),src('lab-v2-report.test.ts','compareRuns refuses to rank mock against hardware, and different scenarios, with explicit reasons')]),
 pass('UX-11','browser','responsive, keyboard, reduced motion, 2D when WebGL is missing; no run lost on context loss',[C.tw('mobile layout is operable with the keyboard only'),C.tw('WebGL disabled and reduced motion fall back to a 2D twin with the same controls'),C.ui('mobile and reduced-motion fallback remain accessible without horizontal overflow')]),
 pass('UX-12','lab','save/open/import/export with migration and revision; history unchanged',[lab('integration/project-store.test.ts','rejects corrupt imports before overwriting a saved project'),C.ui('failed huge numeric import keeps the usable current and persisted project')],'old-run badge against the current configuration: QA-09b'),
 pass('UX-13','model','one asset/world revision for scene, planner and collision',[src('lab-v2-model.test.ts','compileAsset derives visual and collision from one geometry source and reports capabilities honestly'),lab('integration/project-v2-migration.test.ts','the catalog fixture, the compiled footprint and the viewer source agree')]),
 pass('UX-14','model','state samples carry entity, frame, SI unit, sim/wall time, source and sequence',[src('lab-v2-contracts.test.ts','twin sample states are finite per entity kind, SI units in the field name, no open maps'),C.tt('orders samples per provider by bootId+seq: a late older sample never overwrites a newer one; duplicates are ignored')]),
 pass('UX-15','domain','desired/commanded, observed and derived stay separate (goal != arrived, dispense != dose, gripper closed != holding)',[src('coffee-transfer.test.ts','cell -> arm needs grasp evidence from the bound arm observer; release ACK alone never moves ownership'),C.ws('inspector separates observed from commanded, keeps units and leaves unknown unknown'),T('FD01 runner')]),
 pass('UX-16','runner','a run locks project/scenario/source/backend set; edits never change a running run',[src('lab-v2-recovery.test.ts','clean close and reopen resumes from the checkpoint with the uninterrupted canonical outcome'),C.ws('locked identity shows recipe and project revisions as the runtime reported them, never preset constants')]),
 pass('UX-17','runner','continuous telemetry with stale/drop/disconnect marks; heartbeat on a monotonic clock',[src('lab-v2-stream.test.ts','telemetry is a separate coalesced stream of schema-valid samples; heartbeats continue while the pose does not refresh; paused sim is acknowledged'),C.tt('freshness: heartbeat alive does not refresh a pose that stopped updating; paused sim is FROZEN_SIM; lost link is disconnected'),C.rec]),
 pass('UX-18','runner','geometry/load/recipe changes act on the model with an explainable effect',[T('FD04 runner: chair'),T('FD05-payload'),T('BV01 runner')],'speed-limit changes: see UX-18-speed'),
 pass("UX-18-speed","runner","speed limit is pinned and acts on admission and modeled motion",[src("lab-v2-software-gaps.test.ts","project speed limit reaches mission admission and the plant, while the run keeps immutable inputs")]),
 pass('UX-19','runner','the report says which engine/model backs each claim; mock never claims physics',[src('lab-v2-report.test.ts','report separates durable business events from lossy coalesced telemetry with per-entity sample counts'),T('QA-06')]),
 pass('UX-20','model','mock values and measurements carry illustrative/modelled/unknown provenance, never calibrated',[src('coffee-job.test.ts','lab recipe fixtures equal the server recipes, are schema-valid and carry their content hash'),src('lab-v2-model.test.ts','migrateV1Project keeps handoff coordinates, backs the design into amr-1 and marks geometry illustrative'),T('BV01 runner'),C.ui('all three locales fit tablet and desktop, with explicit unmeasured Valetudo values')],'calibration records for real hardware do not exist (H only)'),
 // ---- release-level items (plan README §3 R-MOCK) and measurements
 pass('R-MOCK-launcher','host','single launcher starts the pinned runtime, refuses non-mock/unavailable backends, makes no outbound connection',[lab('integration/mock-launcher.test.ts','ready launcher prints the one-use code (never in a URL), makes no outbound connection, and Ctrl-C stops only its own children'),lab('integration/mock-launcher.test.ts','a non-mock backend enabled by the runtime is refused')]),
 pass('S01','browser','S01 regression still runs through source domain/journal/dispatcher on the pinned artifact',[C.s01]),
 notRun('R-MOCK-fresh-macos','host','fresh macOS user profile install + first run','NEEDS_HUMAN','needs a separate clean user profile on this machine (F07 not_run)'),
 notRun('R-MOCK-linux','host','fresh Linux profile install + first run','BLOCKED_EXTERNAL','no Linux host available (F07 not_run)'),
 notRun('R-MOCK-network-off','host','launcher and run with networking disabled','NEEDS_HUMAN','turning off host networking is outside agent scope (F07 not_run); the transport-deny check (QA-06) covers the runtime side'),
 pass("R-MOCK-offline-bundle","host","vendored Node/runtime/compiled dependencies/assets boot without a package manager and reject tampering",[lab("integration/offline-bundle.test.ts","offline release contains its Node, runtime, built dependency assets and lock; boots with no package manager")]),
 notRun('R-MOCK-cold-boot','host','boot-to-ready after a host reboot','NEEDS_HUMAN','requires rebooting the host (F07 not_run; warm p95 608 ms recorded without a pass badge)'),
 pass('UI-perf-p95','browser','60s renderer measurement: desktop 3D p95 <=33ms and emulated tablet 2D <=50ms, 2 AMRs+arm+6 tables',['lab:scripts/measure-twin-ui.mjs::60-second renderer capture meets declared desktop and emulated tablet limits'],'emulation on the recorded host; no physical tablet result'),
 notRun('UI-perf-physical-tablet','host','repeat frame-time capture on the target physical tablet','NEEDS_HUMAN','requires the target tablet; browser emulation does not establish device performance'),
 // ---- physical assertions a mock cannot make (§2)
 notRun('PHYS-grip-spill-stop','runner','cup grip, grasp force, spill, stop distance','UNSUPPORTED_FIDELITY','mock proves no physics (report coverage physicalGrip/armTorque/fluidModel/physicalStop false)'),
 notRun('PHYS-liquid','runner','real coffee/milk/ice quantities and brew state','UNSUPPORTED_FIDELITY','process model + synthetic measurements only (provenance modelled)'),
 notRun('PHYS-contact-dynamics','runner','contact/dynamics of robot motion','UNSUPPORTED_FIDELITY','mock_kinematic: no dynamics; contacts are geometric overlaps in the model'),
];}
export let COVERAGE:Row[]=[];
const REQUIRED=[...['01','02','03','04','05','06','07','08','09','10','11','12'].map(n=>`QA-${n}`),...Array.from({length:8},(_,i)=>`FD0${i+1}`),...Array.from({length:8},(_,i)=>`BV0${i+1}`),...Array.from({length:6},(_,i)=>`ARM0${i+1}`),...Array.from({length:6},(_,i)=>`SYS0${i+1}`),...Array.from({length:20},(_,i)=>`UX-${String(i+1).padStart(2,'0')}`)];
const LAB=join(process.cwd(),'..','lab'),REGRESSION=join(LAB,'docs/implementation/evidence/digital-twin-v2/regression');
const recordsOf=(r:Row)=>r.tests.filter(t=>t.startsWith('self:')).flatMap(t=>evidence.traceByCheck[t.slice(5)]??[]);
check('QA-01 evidence records: every runner/gateway pass row resolves to records with scenario revision, backend set and versions, expected and actual outcome',async()=>{
 const rows=coverage().filter(r=>r.status==='pass'&&['runner','gateway'].includes(r.level)&&r.tests.some(t=>t.startsWith('self:')&&t.slice(5)!==current));
 expect(rows.length).toBeGreaterThan(30);
 for(const r of rows){
  const keys=recordsOf(r);expect(keys.length,`${r.id} has no run record`).toBeGreaterThan(0);expect(r.expected.length).toBeGreaterThan(10);
  for(const k of keys){const x=evidence.traces[k]!;
   expect(x.scenario.revision,k).toBeGreaterThan(0);expect(x.scenario.hash,k).toMatch(/^[0-9a-f]{64}$/);expect(x.backendSetId,k).toMatch(/^mock-/);
   expect(x.backends.length,k).toBeGreaterThan(0);expect(x.backends.every(b=>/^mock_[a-z]+@\d+\/mock_[a-z]+$/.test(b)),k).toBe(true);
   expect(['completed','needs_attention','cancelled','ready','running'],k).toContain(x.outcome.status);expect(x.digest,k).toMatch(/^[0-9a-f]{64}$/);}
 }
});
/** Stored regression results (vitest/Playwright JSON, recorded with command, timestamp and sha256 in regression/manifest.json): title -> passed? */
function storedResults(){
 const manifest=JSON.parse(readFileSync(join(REGRESSION,'manifest.json'),'utf8')) as Omit<RegressionIdentityRecord,'commands'>&{commands:{id:string;exitCode:number|null}[];notRun:unknown[];runs:{repo:string;kind:string;file:string;sha256:string}[]};
 expect(manifest.commands.filter(c=>c.exitCode!==0),'all recorded regression commands must pass').toEqual([]);
 expect(manifest.notRun,'missing regression commands are not acceptance evidence').toEqual([]);
 assertRecordedRegressionIdentity(manifest,process.cwd(),LAB);
 const lock=JSON.parse(readFileSync(join(LAB,'config/source-runtime.lock.json'),'utf8')) as {sourceCommit:string};
 expect(lock.sourceCommit,'Lab must exercise the source revision being accepted').toBe(manifest.revisions.source);
 const out=new Map<string,{status:string;file:string}>(),put=(repo:string,file:string,title:string,status:string,from:string)=>{const k=`${repo}|${evidenceTestPath(file)}|${title}`;if(out.get(k)?.status!=='passed')out.set(k,{status,file:from});};
 for(const run of manifest.runs){
  const bytes=readFileSync(join(REGRESSION,run.file));expect(createHash('sha256').update(bytes).digest('hex'),run.file).toBe(run.sha256);
  if(!['vitest','playwright','measurement'].includes(run.kind))continue; // pytest XML is checksum-verified, with no direct row reference
  const j=JSON.parse(bytes.toString('utf8'));
  if(run.kind==='measurement'){
   expect(j.minimumDurationMet).toBe(true);expect(Number.isFinite(j.durationMs)).toBe(true);expect(j.durationMs).toBeGreaterThanOrEqual(60000);
   for(const [id,limit,view] of [['desktop-3d',33,'3d'],['tablet-2d-emulated',50,'2d']] as const){
    const p=j.results.find((r:{id:string})=>r.id===id);expect(p).toMatchObject({limitMs:limit,renderedView:view,entities:2,armCount:1,tableCount:6,valid:true,meetsTarget:true,pageErrors:[],errors:[]});
    expect(Number.isFinite(p.elapsedMs)).toBe(true);expect(p.elapsedMs).toBeGreaterThanOrEqual(j.durationMs);
    expect(Number.isInteger(p.frameIntervals.samples)).toBe(true);expect(p.frameIntervals.samples).toBeGreaterThanOrEqual(Math.max(1000,Math.floor(p.elapsedMs/50)));
    expect(Number.isInteger(p.workspacePaint.samples)).toBe(true);expect(p.workspacePaint.samples).toBeGreaterThanOrEqual(p.elapsedMs/100*0.9);expect(p.workspacePaint.samples).toBeLessThanOrEqual(p.elapsedMs/100*1.1+1);
    expect(Number.isInteger(p.renderedPaints)).toBe(true);expect(p.renderedPaints).toBeGreaterThan(0);expect(p.renderedPaints).toBe(p.workspacePaint.samples);
    for(const value of [p.frameIntervals.p95Ms,p.workspacePaint.p95Ms]){expect(typeof value).toBe('number');expect(Number.isFinite(value)).toBe(true);expect(value).toBeGreaterThan(0);expect(value).toBeLessThanOrEqual(limit);}
   }
   put('lab','scripts/measure-twin-ui.mjs','60-second renderer capture meets declared desktop and emulated tablet limits','passed',run.file);continue;
  }
  if(run.kind==='vitest')for(const f of j.testResults as {name:string;assertionResults:{title:string;status:string}[]}[])for(const a of f.assertionResults)put(run.repo,f.name,a.title,a.status,run.file);
  else{const walk=(suite:{specs?:{title:string;file:string;tests:{status:string;results:{status:string}[]}[]}[];suites?:unknown[]})=>{
    for(const sp of suite.specs??[])put(run.repo,sp.file,sp.title,sp.tests.length&&sp.tests.every(t=>t.status==='expected'&&t.results.at(-1)?.status==='passed')?'passed':sp.tests.map(t=>t.status).join(','),run.file);
    for(const x of suite.suites??[])walk(x as never);};for(const x of j.suites)walk(x);}
 }
 return out;
}
const evidenceTestPath=(file:string)=>{const normalized=file.replaceAll('\\','/'),i=normalized.indexOf('/tests/');return i>=0?normalized.slice(i+1):normalized.startsWith('tests/')||normalized.startsWith('scripts/')?normalized:!normalized.includes('/')&&normalized.endsWith('.spec.ts')?`tests/e2e/${normalized}`:`tests/${normalized}`;};
test('coverage table: every pass row has an executed assertion; not_run rows carry a reason; every mock-capable row is listed',()=>{
 // every check title resolves (also of checks that failed), so a failed check turns its rows red here instead of dropping them
 COVERAGE=coverage();
 const ids=COVERAGE.map(r=>r.id);expect(new Set(ids).size).toBe(ids.length);
 for(const id of REQUIRED)expect(ids.some(x=>x===id||x.startsWith(`${id}-`)||x.startsWith(`${id}a`)),id).toBe(true);
 const requireLab=process.env.LAB_V2_REQUIRE_LAB_FIXTURES==='1'||existsSync(LAB);
 if(process.env.LAB_V2_MOCK_EVIDENCE)expect(requireLab,'publishing acceptance evidence requires stored Lab results').toBe(true);
 // with the Lab checkout present the stored regression results are mandatory; without it (source-only CI) only titles can be checked
 const stored=requireLab?storedResults():null,resolved:Record<string,string[]>={};
 for(const r of COVERAGE){
  if(r.status==='not_run'){expect(r.reason,r.id).toBeTruthy();expect(r.note,r.id).toBeTruthy();continue;}
  expect(r.tests.length,r.id).toBeGreaterThan(0);expect(r.reason,r.id).toBeUndefined();
  for(const ref of r.tests){
   if(ref.startsWith('self:')){expect(passed.has(ref.slice(5)),`${r.id}: ${ref}`).toBe(true);continue;}
   const [repo,rest]=[ref.slice(0,ref.indexOf(':')),ref.slice(ref.indexOf(':')+1)],[file,title]=rest.split('::') as [string,string];
   const path=repo==='source'?join(process.cwd(),file):join(LAB,file);
   if(!stored){if(repo==='lab')continue;expect(readFileSync(path,'utf8').includes(title),`${r.id}: ${title} in ${file}`).toBe(true);continue;}
   // a referenced suite test counts only if the stored machine-readable result shows it PASSED (a skip is not a pass)
   const hit=stored.get(`${repo}|${evidenceTestPath(file)}|${title}`);expect(hit?.status,`${r.id}: ${repo}:${file} :: ${title}`).toBe('passed');(resolved[r.id]??=[]).push(`regression/${hit!.file}`);
  }
 }
 const counts=COVERAGE.reduce<Record<string,number>>((m,r)=>{const k=r.status==='pass'?'pass':`not_run:${r.reason}`;m[k]=(m[k]??0)+1;return m;},{});
 if(process.env.LAB_V2_MOCK_EVIDENCE)writeFileSync(process.env.LAB_V2_MOCK_EVIDENCE,JSON.stringify({schema:'lab-v2-mock-acceptance/1',generatedAt:new Date().toISOString(),
  note:'Synthetic mock data only. pass = assertions executed: self rows in this run (records = run traces), source/lab rows = PASSED entries in the stored regression results (regression/manifest.json with sha256).',counts,
  rows:COVERAGE.map(r=>({...r,records:Object.fromEntries(recordsOf(r).map(k=>{const x=evidence.traces[k]!;return [k,{scenario:x.scenario,backendSetId:x.backendSetId,backends:x.backends,actual:x.outcome,digest:x.digest}];})),
   storedResults:[...new Set(resolved[r.id]??[])],actual:r.status!=='pass'?'not executed':r.tests.every(t=>!t.startsWith('self:')||passed.has(t.slice(5)))?'assertions passed':'FAILED'})),evidence},null,1)+'\n');
 console.log('coverage',JSON.stringify(counts));
});
