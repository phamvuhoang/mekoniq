import {afterEach,beforeEach,expect,test} from 'vitest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {recipeHash,type CoffeeRecipe} from '../../packages/domain/src/beverage/recipe';
import {validateCoffeeRecipe} from '../../packages/lab-runtime/src/v2/contracts';
import {MockCoffeePlant} from '../../packages/cell-adapters/src/mock-coffee';
import type {CellReport} from '../../packages/cell-adapters/src/contract';
import {openCoffee,act,stepUntil,cleanupRuns} from '../support/lab-v2';
import {cleanupCoffee,coffeeVenue,registerRecipes,verifiedJob,orderCoffee,deviceStatus,observeCup,startStep,commandResult,measured,brewAll,resetSeqs,recipeRef,
 ESPRESSO,ICED_MILK_COFFEE,STATION,CELL,DEVICES,type CoffeeVenue} from '../support/coffee';
beforeEach(resetSeqs);afterEach(cleanupCoffee);afterEach(cleanupRuns);
const milkPolicy={revision:1,provenance:'illustrative',maxOpenMs:14400000,minTemperatureK:'273.15',maxTemperatureK:'278.15',temperatureMaxAgeMs:10000};
const cupPolicy={revision:1,provenance:'illustrative',capacityM3:'0.0003',headspaceM3:'0.00002',iceVolumeM3PerKg:'0.0011'};
const measurementPolicy={revision:1,provenance:'illustrative',maxTargetMultiplier:'2'};
function policyRecipe(base:CoffeeRecipe,policies:JsonObject):CoffeeRecipe{
 const r={...structuredClone(base),revision:8,policies};return {...r,hash:recipeHash(r as unknown as JsonObject)} as CoffeeRecipe;
}
const register=(v:CoffeeVenue,r:CoffeeRecipe)=>v.submit('Coffee.RegisterRecipe',{recipe:r as unknown as JsonObject},'configurer');
const batch=(v:CoffeeVenue,over:JsonObject={})=>({batchId:'batch-1',openedAt:new Date(v.now()-60000).toISOString(),coldChainIntact:true,temperature:{amount:'275.15',unit:'K',provenance:'modelled',observedAt:new Date(v.now()).toISOString()},...over});
async function beforeMilk(v:CoffeeVenue,r:CoffeeRecipe){
 expect((await register(v,r)).status).toBe('accepted');await verifiedJob(v,r,'coffee-1','cup-1',false);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});
 for(const step of r.steps.filter(s=>s.kind!=='add_milk')){const x=await startStep(v,'coffee-1',step.id);expect(x.result.status).toBe('accepted');await commandResult(v,x.effect!,'completed',measured(step.target!.amount,step.target!.unit));}
}

test('BV02/BV06 capacity model includes headspace and explicit ice displacement before reservation or effects',async()=>{
 const v=await coffeeVenue();
 // 33 ml shot + 88 ml milk + 0.13 kg ice * 1.1 L/kg = 264 ml at target tolerances; 250 - 20 = 230 ml usable.
 const r=policyRecipe(ICED_MILK_COFFEE,{cup:{...cupPolicy,capacityM3:'0.00025'}});
 expect((await register(v,r)).status).toBe('accepted');
 const lineId=await orderCoffee(v,r.id),res=await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-1',lineId,cellId:CELL,recipe:recipeRef(r),cupId:'cup-1'});
 expect(res.code).toBe('CUP_CAPACITY_EXCEEDED');
 expect((await v.read('coffee-job','coffee-1')).version).toBe(0);expect((await v.read('cell-resource',`${CELL}:machine`)).version).toBe(0);
 expect((await v.effects()).filter(e=>e.type==='cell.execute')).toHaveLength(0);await v.close();
});

test('BV02/BV06 capacity policy is schema validated, frozen with the recipe and rejects missing ice conversion assumptions',async()=>{
 const r=policyRecipe(ICED_MILK_COFFEE,{cup:cupPolicy});
 expect(validateCoffeeRecipe(r).ok).toBe(true);
 const v=await coffeeVenue();expect((await register(v,r)).status).toBe('accepted');await verifiedJob(v,r);
 expect((await v.read('coffee-job','coffee-1')).state.recipeHash).toBe(r.hash);
 const bad=policyRecipe(ICED_MILK_COFFEE,{cup:{...cupPolicy,iceVolumeM3PerKg:'0'}});
 expect((await register(v,{...bad,revision:9,hash:recipeHash({...bad,revision:9} as unknown as JsonObject)})).code).toBe('RECIPE_INVALID');await v.close();
});

test.each([
 ['missing',null,'MILK_BATCH_REQUIRED'],
 ['expired',{openedAt:'2026-11-05T00:00:00Z'},'MILK_BATCH_EXPIRED'],
 ['warm',{temperature:{amount:'285.15',unit:'K',provenance:'modelled',observedAt:'2026-11-05T08:00:00Z'}},'MILK_TEMPERATURE_OUT_OF_RANGE'],
 ['unknown',{temperature:null},'MILK_TEMPERATURE_UNKNOWN'],
 ['stale',{temperature:{amount:'275.15',unit:'K',provenance:'modelled',observedAt:'2026-11-05T07:59:00Z'}},'MILK_TEMPERATURE_STALE'],
 ['broken_chain',{coldChainIntact:false},'MILK_COLD_CHAIN_BROKEN'],
] as const)('BV08 %s milk policy blocks dispense with its reason',async(_name,over,code)=>{
 const v=await coffeeVenue(),r=policyRecipe(ICED_MILK_COFFEE,{milk:milkPolicy});await beforeMilk(v,r);
 if(over)expect((await deviceStatus(v,DEVICES.milk,{status:'ready',milkBatch:batch(v,over)})).status).toBe('accepted');
 expect((await startStep(v,'coffee-1','add_milk')).result.code).toBe(code);
 expect((await v.effects()).filter(e=>e.type==='cell.execute'&&(e.payload as JsonObject).deviceId===DEVICES.milk)).toHaveLength(0);await v.close();
});

test('BV08 reboot cannot reset batch opening time or cold-chain failure; a documented new batch with fresh temperature permits milk',async()=>{
 const v=await coffeeVenue(),r=policyRecipe(ICED_MILK_COFFEE,{milk:milkPolicy});await beforeMilk(v,r);
 const initial=batch(v,{coldChainIntact:false});
 expect((await deviceStatus(v,DEVICES.milk,{status:'ready',milkBatch:initial})).status).toBe('accepted');
 expect((await deviceStatus(v,DEVICES.milk,{status:'ready',milkBatch:{...initial,coldChainIntact:true}},'boot-after-restart')).status).toBe('accepted');
 expect((await startStep(v,'coffee-1','add_milk')).result.code).toBe('MILK_COLD_CHAIN_BROKEN');
 expect((await deviceStatus(v,DEVICES.milk,{status:'ready',milkBatch:batch(v,{openedAt:new Date(v.now()).toISOString()})},'boot-after-restart')).code).toBe('MILK_BATCH_OPEN_TIME_CHANGED');
 const fresh=batch(v,{batchId:'replacement-batch',openedAt:new Date(v.now()).toISOString()});
 expect((await deviceStatus(v,DEVICES.milk,{status:'ready',milkBatch:fresh},'boot-after-restart')).status).toBe('accepted');
 expect((await startStep(v,'coffee-1','add_milk')).result.status).toBe('accepted');await v.close();
});

test('BV08 cold-handling evidence lost after milk dispensing blocks quality and fulfillment readiness',async()=>{
 const v=await coffeeVenue(),r=policyRecipe(ICED_MILK_COFFEE,{milk:milkPolicy});await beforeMilk(v,r);
 await deviceStatus(v,DEVICES.milk,{status:'ready',milkBatch:batch(v)});
 const x=await startStep(v,'coffee-1','add_milk');await commandResult(v,x.effect!,'completed',measured('0.00008','m3'));
 await deviceStatus(v,DEVICES.milk,{status:'ready',milkBatch:batch(v,{temperature:null})},'reboot-after-dispense');
 expect((await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'})).code).toBe('MILK_TEMPERATURE_UNKNOWN');
 expect((await v.read('fulfillment',String((await v.read('coffee-job','coffee-1')).state.lineId))).state.ready).toBe('0');await v.close();
});

test('R04 explicit per-step bean allocations support repeated brews when measured volume cannot specify bean mass',async()=>{
 const v=await coffeeVenue(),base=structuredClone(ESPRESSO);
 const r={...base,revision:7,steps:[{...base.steps[0]!,id:'brew-a'},{...base.steps[0]!,id:'brew-b'}],resources:[{...base.resources[0]!,requiredAmount:{...base.resources[0]!.requiredAmount!,amount:'0.036'},allocations:[{stepId:'brew-a',amount:'0.018'},{stepId:'brew-b',amount:'0.018'}]}]};
 r.hash=recipeHash(r as unknown as JsonObject);
 expect(validateCoffeeRecipe(r).ok).toBe(true);expect((await register(v,r)).status).toBe('accepted');await verifiedJob(v,r);
 await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-1'});await brewAll(v,'coffee-1',r);
 expect((await v.read('stock-item','coffee-beans')).state.onHand).toBe('964');
 expect((await v.read('coffee-job','coffee-1')).state.reservations).toMatchObject([{stepId:'brew-a',baseQuantity:'18',status:'consumed'},{stepId:'brew-b',baseQuantity:'18',status:'consumed'}]);await v.close();
});

test('BV04 implausible terminal measurement is held with raw evidence and never booked as real stock consumption',async()=>{
 const v=await coffeeVenue(),r=policyRecipe(ICED_MILK_COFFEE,{measurement:measurementPolicy});await beforeMilk(v,r);
 const x=await startStep(v,'coffee-1','add_milk');expect(x.result.status).toBe('accepted');
 expect((await commandResult(v,x.effect!,'completed',measured('0.008','m3'))).status).toBe('accepted');
 const j=(await v.read('coffee-job','coffee-1')).state;
 expect(j).toMatchObject({status:'needs_attention',attentionReason:'MEASUREMENT_IMPLAUSIBLE'});
 expect((j.steps as JsonObject[]).at(-1)).toMatchObject({status:'unknown',measured:{amount:'0.008',unit:'m3'}});
 expect((await v.read('stock-item','milk')).state.onHand).toBe('2000');
 expect((await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-1'})).status).toBe('rejected');
 expect((await v.submit('Coffee.Reconcile',{stationId:STATION,jobId:'coffee-1',disposition:'discard',reason:'Inspect outlier sensor'},'supervisor')).status).toBe('accepted');
 expect((await v.journalTypes())).toContain('StockExceptionOpened');await v.close();
});

test('R03 two cups of one line prepare and deliver sequentially, without counting delivered jobs again',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);const lineId=await orderCoffee(v,'espresso','2');
 for(const n of [1,2]){
  const jobId=`coffee-${n}`,cupId=`cup-${n}`;
  expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId,lineId,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId})).status).toBe('accepted');
  await deviceStatus(v,CELL,{status:'ready'});await observeCup(v,jobId,cupId,ESPRESSO.cupType);await v.submit('Coffee.StartJob',{stationId:STATION,jobId});await brewAll(v,jobId);
  expect((await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId})).status).toBe('accepted');
  const p=await v.read('fulfillment',lineId),allocationId=`manual-${n}`;
  expect((await v.submit('Fulfillment.Allocate',{lineId,quantity:'1',allocationId,expectedVersion:p.version},'waiter')).status).toBe('accepted');
  expect((await v.submit('Fulfillment.HandOff',{allocationId,expectedVersion:1},'waiter')).status).toBe('accepted');
  expect((await v.read('coffee-job',jobId)).state.status).toBe('delivered');
 }
 expect((await v.read('fulfillment',lineId)).state).toMatchObject({served:'2',ready:'0',allocated:'0'});
 expect((await v.read('kitchen-ticket',lineId)).state.prepared).toBe('2');await v.close();
});

test('BV04 mock outlier fault preserves model quantity while source refuses implausible sensor evidence',async()=>{
 const run=await openCoffee('BV01',{seed:42});
 try{
  await run.start();await stepUntil(run,v=>v.coffee?.jobs.some(j=>j.status==='dispensing')??false);
  await act(run,'injectFault',{faultId:'measure-outlier',entityId:'coffee-1'});await stepUntil(run);
  const report=await run.report();expect(report.outcome.status).toBe('needs_attention');
  expect(report.coffee!.jobs.some(j=>j.attentionReason==='MEASUREMENT_IMPLAUSIBLE')).toBe(true);expect(report.outcome.served).toBe('0');
 }finally{await run.close();}
},60000);

test('BV08 mock reboot preserves opened milk batch and failed cold-chain evidence',()=>{
 let now=Date.parse('2026-11-05T08:00:00Z');const plant=new MockCoffeePlant(MockCoffeePlant.initial('cell'),()=>now,()=>`boot-${now}`),reports:CellReport[]=[];
 plant.on(r=>reports.push(r));plant.advance();
 const status=()=>reports.filter(r=>r.deviceId==='cell:milk'&&r.status).at(-1)!.status as unknown as JsonObject;
 const original=status().milkBatch as JsonObject;
 expect(original).toMatchObject({coldChainIntact:true,temperature:{unit:'K',provenance:'modelled'}});
 now+=1000;plant.fault('milk-warm');plant.fault('coffee-reboot');
 expect(status().milkBatch).toMatchObject({batchId:original.batchId,openedAt:original.openedAt,coldChainIntact:false});
});

test('operator mock cup correction reobserves only an unused removed cup',()=>{
 const plant=new MockCoffeePlant(MockCoffeePlant.initial('cell'),()=>Date.parse('2026-11-05T08:00:00Z'),()=> 'next-boot'),reports:CellReport[]=[];
 plant.on(r=>reports.push(r));plant.placeCup('cup','paper');plant.fault('cup-removed');plant.restoreCup('cup','paper');
 expect(plant.cupAtNozzle('cup')).not.toBeNull();expect(reports.at(-1)!.cup).toEqual({cupId:'cup',cupType:'paper',present:true});
 plant.cup('cup')!.liquidUl=1;plant.fault('cup-removed');
 expect(()=>plant.restoreCup('cup','paper')).toThrow('CUP_RESTORE_UNSAFE');
});
