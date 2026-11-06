import {afterEach,beforeEach,expect,test} from 'vitest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {act,cleanupRuns,openCoffee,stepUntil} from '../support/lab-v2';
import {cleanupCoffee,coffeeVenue,registerRecipes,verifiedJob,startStep,commandResult,measured,deviceStatus,observeCup,resetSeqs,orderCoffee,recipeRef,dockedRobot,ESPRESSO,ICED_MILK_COFFEE,STATION,CELL,DEVICES} from '../support/coffee';
beforeEach(resetSeqs);afterEach(cleanupCoffee);afterEach(cleanupRuns);

test('cancel before any dispense releases reservations and leases with no waste',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);await verifiedJob(v);
 expect((await v.submit('Coffee.CancelJob',{stationId:STATION,jobId:'coffee-1'})).code).toBe('REASON_REQUIRED');
 expect((await v.submit('Coffee.CancelJob',{stationId:STATION,jobId:'coffee-1',reason:'Guest changed order'})).status).toBe('accepted');
 const j=(await v.read('coffee-job','coffee-1')).state;
 expect(j).toMatchObject({status:'cancelled',leases:[]});
 expect((j.reservations as JsonObject[]).map(r=>r.status)).toEqual(['released']);
 expect((await v.journalTypes()).filter(t=>t==='StockWasted')).toHaveLength(0);
 expect((await v.read('cup','cup-1')).state).toMatchObject({ownerKind:'cell',disposition:'reusable'});
 // the machine is free for the next job
 const line=await orderCoffee(v,'espresso');
 expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-2',lineId:line,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:'cup-2'})).status).toBe('accepted');
 await v.close();
});

test('cancel after pour retains consumed inventory and the physical cup disposition; nothing is restocked',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);await verifiedJob(v,ICED_MILK_COFFEE);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 const b=await startStep(v,'coffee-1','brew');await commandResult(v,b.effect!,'completed',measured('0.00003','m3'));
 expect((await v.read('stock-item','coffee-beans')).state.onHand).toBe('982');
 expect((await v.submit('Coffee.CancelJob',{stationId:STATION,jobId:'coffee-1',reason:'Guest left'})).status).toBe('accepted');
 const j=(await v.read('coffee-job','coffee-1')).state;
 expect(j).toMatchObject({status:'cancelled',disposition:'discard_pending',leases:[]});
 expect((j.reservations as JsonObject[]).map(r=>[r.ingredientId,r.status])).toEqual([['coffee-beans','consumed'],['ice','released'],['milk','released']]);
 expect((await v.read('stock-item','coffee-beans')).state.onHand).toBe('982');
 const types=await v.journalTypes();expect(types.filter(t=>t==='StockWasted')).toHaveLength(1);
 expect((await v.read('cup','cup-1')).state).toMatchObject({ownerKind:'cell',ownerId:CELL,disposition:'discard_pending'});
 await v.close();
});

test('cancel during a running step or an unknown outcome holds everything until a human reconciles; no resend',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 const b=await startStep(v,'coffee-1','brew');await commandResult(v,b.effect!,'accepted');
 expect((await v.submit('Coffee.CancelJob',{stationId:STATION,jobId:'coffee-1',reason:'stop'})).status).toBe('accepted');
 expect((await v.read('coffee-job','coffee-1')).state).toMatchObject({status:'needs_attention',attentionReason:'CANCEL_DURING_STEP'});
 await commandResult(v,b.effect!,'outcome_unknown',{},'boot-2');
 let j=(await v.read('coffee-job','coffee-1')).state;
 expect((j.steps as JsonObject[])[0]!.status).toBe('unknown');
 expect(j.leases).toEqual([`${CELL}:machine`,`${CELL}:nozzle`]);
 expect((await v.submit('Coffee.StartStep',{stationId:STATION,jobId:'coffee-1',stepId:'brew'})).code).toBe('JOB_STATE_CONFLICT');
 expect((await v.submit('Coffee.Reconcile',{stationId:STATION,jobId:'coffee-1',reason:'checked',disposition:'discard'},'barista')).code).toBe('FORBIDDEN');
 expect((await v.submit('Coffee.Reconcile',{stationId:STATION,jobId:'coffee-1',disposition:'discard'},'supervisor')).code).toBe('REASON_REQUIRED');
 const r=await v.submit('Coffee.Reconcile',{stationId:STATION,jobId:'coffee-1',disposition:'discard',reason:'Half shot in cup; discarded by supervisor',provenance:'human'},'supervisor');
 expect(r.status).toBe('accepted');
 j=(await v.read('coffee-job','coffee-1')).state;
 expect(j).toMatchObject({status:'quarantined',disposition:'discard',leases:[],reconciledBy:'supervisor'});
 expect((j.steps as JsonObject[])[0]!.status).toBe('unknown');
 // consumption of the unknown step is neither assumed nor rolled back: it is an open stock exception
 expect((j.reservations as JsonObject[])[0]!.status).toBe('consumption_unknown');
 expect((await v.journalTypes()).filter(t=>t==='StockExceptionOpened')).toHaveLength(1);
 expect((await v.effects()).filter(e=>e.type==='cell.execute')).toHaveLength(1);
 expect((await v.read('cup','cup-1')).state).toMatchObject({ownerKind:'cell',disposition:'discard'});
 await v.close();
});

test('cleaning overdue and stale interlocks block the cell with a reason until an audited cleaning is recorded',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);
 const line=await orderCoffee(v,'espresso');
 await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-1',lineId:line,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:'cup-1'});
 await deviceStatus(v,DEVICES.machine,{status:'ready'});
 v.advance(30000);
 expect((await observeCup(v,'coffee-1','cup-1',ESPRESSO.cupType)).code).toBe('INTERLOCK_STALE');
 v.advance(5*3600000);await deviceStatus(v,DEVICES.machine,{status:'ready'});
 expect((await observeCup(v,'coffee-1','cup-1',ESPRESSO.cupType)).code).toBe('CLEANING_OVERDUE');
 expect((await v.submit('Coffee.RecordCleaning',{stationId:STATION,deviceId:CELL},'barista')).code).toBe('REASON_REQUIRED');
 expect((await v.submit('Coffee.RecordCleaning',{stationId:STATION,deviceId:CELL,reason:'Daily flush'},'barista')).status).toBe('accepted');
 expect((await v.read('cell-device',CELL)).state.cleaning).toMatchObject({status:'ok',cleanedBy:'barista'});
 expect((await observeCup(v,'coffee-1','cup-1',ESPRESSO.cupType)).status).toBe('accepted');
 await v.close();
});

test('BV05 on mock-default: a cell reboot mid-brew leaves the outcome unknown, never resends, keeps the cup; a human reconcile quarantines it',async()=>{
 const run=await openCoffee('BV01',{seed:3});
 try{
  await run.start();
  await stepUntil(run,v=>!!v.coffee?.jobs.some(j=>j.status==='dispensing'),25);
  await act(run,'injectFault',{faultId:'coffee-reboot',entityId:'coffee-1'});
  const held=await stepUntil(run,v=>v.run.status==='needs_attention',25);
  const job=held.coffee!.jobs.find(j=>j.status==='needs_attention')!;
  expect(job.attentionReason).toBe('STEP_UNKNOWN');
  expect(held.attention.map(a=>a.reason)).toContain('STEP_UNKNOWN');
  await act(run,'step',{ticks:500});
  let r=await run.report();
  const brews=r.coffee!.cellEffects.filter(e=>e.payload.jobId===job.jobId);
  expect(brews.map(e=>[e.payload.capability,e.attempts])).toEqual([['brew',1]]);
  expect(r.coffee!.cups.find(c=>c.cupId===job.cupId)).toMatchObject({ownerKind:'cell',movements:[]});
  expect(r.outcome.served).toBe('0');
  await act(run,'reconcile',{subjectId:String(job.jobId)});
  r=await run.report();
  expect(r.coffee!.jobs.find(j=>j.jobId===job.jobId)).toMatchObject({status:'quarantined',leases:[],provenance:'human',reconciledBy:'lab-supervisor'});
  expect(r.reconciliations.at(-1)).toMatchObject({subjectId:job.jobId,nativeState:'unknown'});
  // reconciling never resends the brew
  expect(r.coffee!.cellEffects.filter(e=>e.payload.jobId===job.jobId)).toHaveLength(1);
 }finally{await run.close();}
},120000);

test('cancel after quality withdraws the ready portion: not allocatable, not loadable, and a remake is allowed',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);
 const {lineId}=await verifiedJob(v);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 const b=await startStep(v,'coffee-1','brew');await commandResult(v,b.effect!,'completed',measured('0.00003','m3'));
 await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'});
 const line=await v.read('fulfillment',lineId);expect(line.state.ready).toBe('1');
 const alloc=await v.submit('Fulfillment.Allocate',{lineId,quantity:'1',expectedVersion:line.version,method:'robot'});expect(alloc.status).toBe('accepted');
 expect((await v.submit('Coffee.CancelJob',{stationId:STATION,jobId:'coffee-1',reason:'Drink spilled at the cell'})).status).toBe('accepted');
 const after=(await v.read('fulfillment',lineId)).state;
 expect(after).toMatchObject({ready:'0',allocated:'0',served:'0'});
 expect((await v.read('allocation',String(alloc.value.allocationId))).state.status).toBe('cancelled');
 expect((await v.read('kitchen-ticket',lineId)).state).toMatchObject({prepared:'0',withdrawn:'1'});
 expect((await v.submit('Fulfillment.Allocate',{lineId,quantity:'1',expectedVersion:(await v.read('fulfillment',lineId)).version,method:'robot'})).code).toBe('INSUFFICIENT_READY');
 // a robot standing at the load stop for this line cannot load it: no live coffee job owns a cup for it
 await dockedRobot(v,lineId,'alloc-stale');
 expect((await v.submit('Mission.ConfirmStop',{missionId:'m-1',expectedVersion:1,missionRevision:1,stopId:'load-1'},'manager')).code).toBe('CUP_TRANSFER_REQUIRED');
 // the guest still wants the drink: a remake on the same line is allowed and becomes ready again once
 expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-2',lineId,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:'cup-2'})).status).toBe('accepted');
 await v.close();
});
