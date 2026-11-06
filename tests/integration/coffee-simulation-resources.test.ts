// BV-02/03/07: cell resources are exclusive and atomic, every ingredient step keeps its own target/tolerance in the recipe's own order,
// consumption is exact, and a cancel after a dispense keeps what left the shelf. Temperature/milk evidence is never substituted.
import {afterEach,expect,test} from 'vitest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {cleanupCoffee,DEVICES,orderCoffee,recipeRef,STATION,CELL} from '../support/coffee';
import {createCoffeeSimulationRig,RECIPES} from '../support/coffee-simulation-lab';
afterEach(cleanupCoffee);
const iced=RECIPES['iced-milk-coffee'];
const target=(stepId:string)=>iced.steps.find(s=>s.id===stepId)!.target!;

test('two jobs cannot hold the same machine; the second waits with RESOURCE_HELD and takes nothing',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  await rig.reserve({recipeId:'espresso',recipeRevision:2,cupId:'cup-1',start:false});
  const line=await orderCoffee(rig.venue,'espresso');
  const second=await rig.venue.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'job-cup-2',lineId:line,cellId:CELL,recipe:recipeRef(RECIPES.espresso),cupId:'cup-2'});
  expect(second.code).toBe('RESOURCE_HELD');
  expect(await rig.stock('coffee-beans')).toBe('1000');
  const snapshots=await rig.venue.store.snapshots(rig.venue.scope);
  expect(snapshots.filter(s=>s.ref.kind==='coffee-job').map(s=>s.ref.id)).toEqual(['job-cup-1']);
  expect(snapshots.filter(s=>s.ref.kind==='cup').map(s=>s.ref.id)).toEqual(['cup-1']);
 }finally{await rig.close();}
});

test('iced milk coffee runs brew, ice, milk in the recipe order with per-ingredient tolerances and exact conservation',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'iced-milk-coffee',recipeRevision:2,cupId:'cup-1'});
  expect((await rig.startRecipeStep(job.id,'add_milk-1')).code).toBe('STEP_OUT_OF_ORDER');
  await rig.startRecipeStep(job.id,'brew-1');
  await rig.observeDevice({commandId:'brew-1',status:'completed',measuredQuantity:{value:target('brew').amount,unit:'m3',provenance:'modelled'}});
  await rig.startRecipeStep(job.id,'add_ice-1');
  // 0.11 kg is inside the ice tolerance (0.12 +/- 0.01) but would be far outside the milk tolerance: tolerances are per step
  await rig.observeDevice({commandId:'add_ice-1',status:'completed',measuredQuantity:{value:'0.11',unit:'kg',provenance:'modelled'}});
  await rig.startRecipeStep(job.id,'add_milk-1');
  await rig.observeDevice({commandId:'add_milk-1',status:'completed',measuredQuantity:{value:'0.000085',unit:'m3',provenance:'modelled'}});
  expect((await rig.verifyOutput(job.id)).status).toBe('accepted');
  expect((await rig.job(job.id)).status).toBe('ready_for_pickup');
  expect([await rig.stock('coffee-beans'),await rig.stock('ice'),await rig.stock('milk')]).toEqual(['982','4890','1915']);
  expect(((await rig.job(job.id)).steps as JsonObject[]).map(s=>[s.id,s.status])).toEqual([['brew','completed'],['add_ice','completed'],['add_milk','completed']]);
 }finally{await rig.close();}
});

test('a step with a unit mismatch or a missing measurement never verifies',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'iced-milk-coffee',recipeRevision:2,cupId:'cup-1'});
  await rig.startRecipeStep(job.id,'brew-1');
  await rig.observeDevice({commandId:'brew-1',status:'completed',measuredQuantity:{value:'0.00003',unit:'kg',provenance:'modelled'}}); // kg for a volume step
  await rig.startRecipeStep(job.id,'add_ice-1');
  await rig.observeDevice({commandId:'add_ice-1',status:'completed',measuredQuantity:{value:'0.12',unit:'kg',provenance:'modelled'}});
  await rig.startRecipeStep(job.id,'add_milk-1');
  await rig.observeDevice({commandId:'add_milk-1',status:'completed',measuredQuantity:{value:'0.00008',unit:'m3',provenance:'modelled'}});
  expect((await rig.verifyOutput(job.id)).code).toBe('MEASUREMENT_UNIT_MISMATCH');
  const b=await createCoffeeSimulationRig();
  try{
   const j2=await b.reserve({recipeId:'espresso',recipeRevision:2,cupId:'cup-2'});
   await b.startRecipeStep(j2.id,'brew-1');
   await b.observeDevice({commandId:'brew-1',status:'completed'});
   expect(await b.job(j2.id)).toMatchObject({status:'needs_attention',attentionReason:'MEASUREMENT_MISSING'});
  }finally{await b.close();}
 }finally{await rig.close();}
});

test('milk temperature unknown is never replaced by 0 or a model value: the milk step holds with a reason',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'iced-milk-coffee',recipeRevision:2,cupId:'cup-1',milkEvidence:false});
  await rig.startRecipeStep(job.id,'brew-1');
  await rig.observeDevice({commandId:'brew-1',status:'completed',measuredQuantity:{value:target('brew').amount,unit:'m3',provenance:'modelled'}});
  await rig.startRecipeStep(job.id,'add_ice-1');
  await rig.observeDevice({commandId:'add_ice-1',status:'completed',measuredQuantity:{value:'0.12',unit:'kg',provenance:'modelled'}});
  expect((await rig.startRecipeStep(job.id,'add_milk-1')).code).toBe('MILK_BATCH_REQUIRED');
  await rig.deviceStatus(DEVICES.milk,{status:'ready',milkBatch:{batchId:'b-1',openedAt:new Date(rig.venue.now()).toISOString(),coldChainIntact:true,temperature:null}});
  expect((await rig.startRecipeStep(job.id,'add_milk-1')).code).toBe('MILK_TEMPERATURE_UNKNOWN');
  await rig.deviceStatus(DEVICES.milk,{status:'ready',milkBatch:{batchId:'b-1',openedAt:new Date(rig.venue.now()).toISOString(),coldChainIntact:true,temperature:{amount:'275.15',unit:'K',provenance:'unknown',observedAt:new Date(rig.venue.now()).toISOString()}}});
  expect((await rig.startRecipeStep(job.id,'add_milk-1')).code).toBe('MILK_TEMPERATURE_UNKNOWN');
  expect(await rig.effectCount('dispense','milk')).toBe(0);
 }finally{await rig.close();}
});

test('cancel after a dispense keeps the quantity that left and never resends; a reboot mid-step is reconciled by a person',async()=>{
 const rig=await createCoffeeSimulationRig();
 try{
  const job=await rig.reserve({recipeId:'iced-milk-coffee',recipeRevision:2,cupId:'cup-1'});
  await rig.startRecipeStep(job.id,'brew-1');
  await rig.observeDevice({commandId:'brew-1',status:'completed',measuredQuantity:{value:target('brew').amount,unit:'m3',provenance:'modelled'}});
  await rig.startRecipeStep(job.id,'add_ice-1');
  await rig.observeDevice({commandId:'add_ice-1',status:'accepted'});
  expect((await rig.cancel(job.id)).status).toBe('accepted');
  expect(await rig.job(job.id)).toMatchObject({status:'needs_attention',attentionReason:'CANCEL_DURING_STEP'});
  await rig.observeDevice({commandId:'add_ice-1',status:'outcome_unknown',bootId:'boot-2'});
  expect(await rig.step(job.id,'add_ice')).toMatchObject({status:'unknown'});
  expect(await rig.effectCount('dispense','ice')).toBe(1);
  expect(await rig.stock('coffee-beans')).toBe('982');
  const r=await rig.venue.submit('Coffee.Reconcile',{stationId:STATION,jobId:job.id,disposition:'discard',reason:'Ice outcome unknown after reboot; cup discarded',provenance:'human'},'supervisor');
  expect(r.status).toBe('accepted');
  expect(await rig.job(job.id)).toMatchObject({status:'quarantined',leases:[]});
  expect(((await rig.job(job.id)).reservations as JsonObject[]).map(x=>[x.ingredientId,x.status])).toEqual([['coffee-beans','consumed'],['ice','consumption_unknown'],['milk','released']]);
  expect(await rig.stock('ice')).toBe('5000'); // not assumed consumed, not restocked: an open stock exception
  expect((await rig.journalTypes()).filter(t=>t==='StockExceptionOpened')).toHaveLength(1);
 }finally{await rig.close();}
});
