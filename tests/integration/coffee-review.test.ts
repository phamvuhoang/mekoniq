import {afterEach,beforeEach,expect,test} from 'vitest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {recipeHash,type CoffeeRecipe} from '../../packages/domain/src/beverage/recipe';
import {validateCoffeeRecipe} from '../../packages/lab-runtime/src/v2/contracts';
import {cleanupCoffee,coffeeVenue,registerRecipes,verifiedJob,orderCoffee,deviceStatus,observeCup,startStep,commandResult,measured,brewAll,resetSeqs,recipeRef,dockedRobot,
 ESPRESSO,ICED_MILK_COFFEE,STATION,CELL,ARM,type CoffeeVenue} from '../support/coffee';
beforeEach(resetSeqs);afterEach(cleanupCoffee);
const payload={stationId:STATION,jobId:'coffee-1'};
const pick={...payload,transferId:'pick-1',cupId:'cup-1',to:{kind:'arm',id:ARM}};
async function ready(v:CoffeeVenue){
 await registerRecipes(v);const result=await verifiedJob(v);await v.submit('Coffee.StartJob',payload);await brewAll(v,'coffee-1');
 expect((await v.submit('Coffee.ConfirmQuality',payload)).status).toBe('accepted');return result;
}
async function picked(v:CoffeeVenue){
 expect((await v.submit('Cup.RequestTransfer',pick)).status).toBe('accepted');
 const cmd=(await v.effects()).filter(e=>(e.payload as JsonObject).deviceId===ARM).at(-1)!.payload as JsonObject;
 expect((await v.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:'pick-1',cupId:'cup-1',provenance:'sensor',evidence:{commandId:cmd.commandId!,observedAt:new Date(v.now()).toISOString(),gripperClosed:true,objectPresent:true,liftPoseReached:true}},`observer:${ARM}`)).status).toBe('accepted');
}
async function handoff(v:CoffeeVenue,lineId:string,id:string,quantity='1'){
 const line=await v.read('fulfillment',lineId);
 expect((await v.submit('Fulfillment.Allocate',{lineId,allocationId:id,quantity,method:'manual',expectedVersion:line.version},'waiter')).status).toBe('accepted');
 return v.submit('Fulfillment.HandOff',{allocationId:id,expectedVersion:(await v.read('allocation',id)).version},'waiter');
}

test.each(['cup_verified','started'] as const)('R01 removal in %s persists absence and requires a new cup verification before any effect',async status=>{
 const v=await coffeeVenue();await registerRecipes(v);await verifiedJob(v);
 if(status==='started')await v.submit('Coffee.StartJob',payload);
 expect((await observeCup(v,'coffee-1','cup-1',ESPRESSO.cupType,false)).status).toBe('accepted');
 expect((await v.read('cup','cup-1')).state.present).toBe(false);
 expect((await v.read('coffee-job','coffee-1')).state.status).toBe('reserved');
 expect((await v.submit('Coffee.StartJob',payload)).code).toBe('CUP_NOT_CONFIRMED');
 expect((await startStep(v,'coffee-1','brew')).result.status).toBe('rejected');
 expect((await v.effects()).filter(e=>e.type==='cell.execute')).toHaveLength(0);
 expect((await observeCup(v,'coffee-1','cup-1',ESPRESSO.cupType)).status).toBe('accepted');
 expect((await v.submit('Coffee.StartJob',payload)).status).toBe('accepted');
 expect((await startStep(v,'coffee-1','brew')).result.status).toBe('accepted');await v.close();
});

test.each(['between_steps','verifying','ready_for_pickup'] as const)('R01 removal in %s blocks later preparation, quality and pickup',async phase=>{
 const v=await coffeeVenue();await registerRecipes(v);await verifiedJob(v,ICED_MILK_COFFEE);await v.submit('Coffee.StartJob',payload);
 if(phase==='between_steps'){
  const brew=await startStep(v,'coffee-1','brew');await commandResult(v,brew.effect!,'completed',measured('0.00003','m3'));
 }else await brewAll(v,'coffee-1',ICED_MILK_COFFEE);
 if(phase==='ready_for_pickup')await v.submit('Coffee.ConfirmQuality',payload);
 expect((await observeCup(v,'coffee-1','cup-1',ICED_MILK_COFFEE.cupType,false)).status).toBe('accepted');
 expect((await v.read('cup','cup-1')).state.present).toBe(false);
 expect((await v.read('coffee-job','coffee-1')).state).toMatchObject({status:'needs_attention',attentionReason:'CUP_REMOVED'});
 const effects=(await v.effects()).length;
 expect((await startStep(v,'coffee-1','add_ice')).result.status).toBe('rejected');
 expect((await v.submit('Coffee.ConfirmQuality',payload)).status).toBe('rejected');
 expect((await v.submit('Cup.RequestTransfer',pick)).status).toBe('rejected');
 expect((await v.effects()).length).toBe(effects);
 // A new presence report records evidence but cannot silently resume an already dispensed, uncertain drink.
 expect((await observeCup(v,'coffee-1','cup-1',ICED_MILK_COFFEE.cupType)).status).toBe('accepted');
 expect((await v.read('coffee-job','coffee-1')).state.status).toBe('needs_attention');await v.close();
});

test.each(['pick','place'] as const)('R02 %s rejects fault, offline and stale arm without a new lease or effect',async leg=>{
 for(const [status,code] of [['fault','DEVICE_FAULT'],['offline','DEVICE_NOT_READY'],['stale','INTERLOCK_STALE']] as const){
  const v=await coffeeVenue();const {lineId}=await ready(v);
  if(leg==='place'){await picked(v);await dockedRobot(v,lineId);}
  if(status==='stale')v.advance(10001);else await deviceStatus(v,ARM,{status});
  const before=await v.read('coffee-job','coffee-1'),effects=(await v.effects()).length;
  const request=leg==='pick'?pick:{...pick,transferId:'place-1',to:{kind:'robot',id:'amr-1',slot:1}};
  expect((await v.submit('Cup.RequestTransfer',request)).code).toBe(code);
  expect(await v.read('coffee-job','coffee-1')).toEqual(before);
  expect((await v.read('cup','cup-1')).state.pendingTransfer).toBeNull();
  expect((await v.read('cell-resource',leg==='pick'?`${CELL}:arm`:`${STATION}:handoff`)).version).toBe(0);
  expect((await v.effects()).length).toBe(effects);
  await deviceStatus(v,ARM,{status:'ready'});
  expect((await v.submit('Cup.RequestTransfer',request)).status).toBe('accepted');await v.close();
 }
});

test('R03 quality-counted coffee occupies prepared capacity once and cancellation allows a remake within order quantity',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);const lineId=await orderCoffee(v,'espresso','2');
 const reserve=(n:number)=>v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:`coffee-${n}`,lineId,cellId:CELL,recipe:recipeRef(ESPRESSO),cupId:`cup-${n}`});
 const prepare=async(n:number)=>{
  for(const d of [CELL,ARM])await deviceStatus(v,d,{status:'ready'});
  expect((await observeCup(v,`coffee-${n}`,`cup-${n}`,ESPRESSO.cupType)).status).toBe('accepted');
  await v.submit('Coffee.StartJob',{stationId:STATION,jobId:`coffee-${n}`});await brewAll(v,`coffee-${n}`);
  expect((await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:`coffee-${n}`})).status).toBe('accepted');
 };
 expect((await reserve(1)).status).toBe('accepted');await prepare(1);await picked(v);
 // Its quality already contributed prepared=1, even though the first cup is still in transfer.
 expect((await reserve(2)).status).toBe('accepted');
 expect((await v.submit('Coffee.CancelJob',{stationId:STATION,jobId:'coffee-2',reason:'Replace unused cup'})).status).toBe('accepted');
 expect((await reserve(3)).status).toBe('accepted');
 expect((await reserve(4)).code).toBe('JOB_EXCEEDS_ORDER');await v.close();
});

test('R04 repeated milk steps reserve independently and conserve measured consumption, remaining reservation and dedup',async()=>{
 const v=await coffeeVenue();
 const r:CoffeeRecipe=structuredClone(ICED_MILK_COFFEE);r.revision=2;
 r.steps=[{...r.steps[2]!,id:'milk-a'},{...r.steps[2]!,id:'milk-b'}];r.resources=r.resources.filter(x=>['milk','cup'].includes(x.kind));
 r.resources[0]!.requiredAmount!.amount='0.00016';r.hash=recipeHash(r as unknown as JsonObject);
 expect((await v.submit('Coffee.RegisterRecipe',{recipe:r as unknown as JsonObject},'configurer')).status).toBe('accepted');
 await verifiedJob(v,r);await v.submit('Coffee.StartJob',payload);
 expect((await v.read('coffee-job','coffee-1')).state.reservations).toMatchObject([{stepId:'milk-a',baseQuantity:'80',status:'reserved'},{stepId:'milk-b',baseQuantity:'80',status:'reserved'}]);
 const a=await startStep(v,'coffee-1','milk-a');expect((await commandResult(v,a.effect!,'completed',measured('0.00008','m3'))).status).toBe('accepted');
 expect((await v.read('stock-item','milk')).state.onHand).toBe('1920');
 expect((await v.read('coffee-job','coffee-1')).state.reservations).toMatchObject([{stepId:'milk-a',status:'consumed'},{stepId:'milk-b',baseQuantity:'80',status:'reserved'}]);
 const b=await startStep(v,'coffee-1','milk-b');expect((await commandResult(v,b.effect!,'completed',measured('0.00008','m3'))).status).toBe('accepted');
 expect((await v.read('stock-item','milk')).state.onHand).toBe('1840');
 expect((await commandResult(v,b.effect!,'completed',measured('0.00008','m3'))).status).toBe('accepted');
 expect((await v.read('stock-item','milk')).state.onHand).toBe('1840');
 const entries=(await v.store.journal(v.scope)).flatMap(e=>e.payload.events as JsonObject[]).filter(e=>e.type==='StockMovementRecorded');
 expect(entries).toHaveLength(2);expect((await v.read('coffee-job','coffee-1')).state.reservations).toMatchObject([{status:'consumed',baseQuantity:'80'},{status:'consumed',baseQuantity:'80'}]);await v.close();
});

test.each(['identical','different_amount'] as const)('R04 rejects %s duplicate resource ids before stock reservations can share a movement identity',async variant=>{
 const v=await coffeeVenue(),r=structuredClone(ICED_MILK_COFFEE);r.revision=10;
 const milk=structuredClone(r.resources.find(x=>x.resourceId==='milk')!);
 r.resources.push({...milk,requiredAmount:{...milk.requiredAmount!,amount:variant==='identical'?'0.00008':'0.00004'}});
 r.hash=recipeHash(r as unknown as JsonObject);
 expect((await v.submit('Coffee.RegisterRecipe',{recipe:r as unknown as JsonObject},'configurer')).code).toBe('RECIPE_INVALID');
 expect((await v.read('coffee-recipe',`${r.id}@${r.revision}`)).version).toBe(0);
 expect((await v.read('stock-item','milk')).state.onHand).toBe('2000');
 expect((await v.journalTypes())).not.toContain('StockMovementRecorded');await v.close();
});

test('R04 schema semantic admission rejects duplicate resource ids and duplicate allocation step ids even when amounts differ',()=>{
 const duplicateResource=structuredClone(ICED_MILK_COFFEE),milk=structuredClone(duplicateResource.resources.find(x=>x.resourceId==='milk')!);
 duplicateResource.resources.push({...milk,requiredAmount:{...milk.requiredAmount!,amount:'0.00004'}});
 duplicateResource.hash=recipeHash(duplicateResource as unknown as JsonObject);
 expect(validateCoffeeRecipe(duplicateResource)).toMatchObject({ok:false,issues:[{path:'/resources/5/resourceId',code:'DUPLICATE_RESOURCE_ID'}]});
 const duplicateAllocation=structuredClone(ICED_MILK_COFFEE),resource=duplicateAllocation.resources.find(x=>x.resourceId==='milk')!;
 resource.allocations=[{stepId:'add_milk',amount:'0.00003'},{stepId:'add_milk',amount:'0.00005'}];
 duplicateAllocation.hash=recipeHash(duplicateAllocation as unknown as JsonObject);
 expect(validateCoffeeRecipe(duplicateAllocation)).toMatchObject({ok:false,issues:[{path:'/resources/2/allocations/1/stepId',code:'DUPLICATE_RESOURCE_ALLOCATION'}]});
});

test('R04 production recipe admission rejects duplicate allocation step ids',async()=>{
 const v=await coffeeVenue(),r=structuredClone(ICED_MILK_COFFEE);r.revision=10;
 r.resources.find(x=>x.resourceId==='milk')!.allocations=[{stepId:'add_milk',amount:'0.00003'},{stepId:'add_milk',amount:'0.00005'}];r.hash=recipeHash(r as unknown as JsonObject);
 expect((await v.submit('Coffee.RegisterRecipe',{recipe:r as unknown as JsonObject},'configurer')).code).toBe('RECIPE_INVALID');
 expect((await v.read('coffee-recipe',`${r.id}@${r.revision}`)).version).toBe(0);await v.close();
});

test('R05 waiter manual handoff atomically serves, records human custody and releases every coffee lease',async()=>{
 const v=await coffeeVenue();const {lineId}=await ready(v);
 expect((await handoff(v,lineId,'manual-1')).status).toBe('accepted');
 expect((await v.read('fulfillment',lineId)).state).toMatchObject({served:'1',ready:'0',allocated:'0'});
 expect((await v.read('coffee-job','coffee-1')).state).toMatchObject({status:'delivered',leases:[],deliveredBy:'waiter',deliveryAllocationId:'manual-1'});
 const cup=(await v.read('cup','cup-1')).state;
 expect(cup).toMatchObject({ownerKind:'customer',ownerId:'t1',pendingTransfer:null,present:false});
 expect(cup.movements).toMatchObject([{from:{kind:'cell',id:CELL},to:{kind:'human',id:'waiter'},provenance:'human',observedBy:'waiter'},{from:{kind:'human',id:'waiter'},to:{kind:'customer',id:'t1'},provenance:'human',observedBy:'waiter'}]);
 for(const id of [`${CELL}:machine`,`${CELL}:nozzle`])expect((await v.read('cell-resource',id)).state.holder).toBeNull();
 const journal=await v.store.journal(v.scope),entry=journal.find(e=>(e.payload.events as JsonObject[]).some(x=>x.type==='ManualDeliveryHandedOff'))!;
 expect((entry.payload.events as JsonObject[]).map(x=>x.type)).toEqual(expect.arrayContaining(['ManualDeliveryHandedOff','PortionServed','CoffeeJobDelivered','CupHandedOff','CellResourceReleased']));
 expect((await v.submit('Fulfillment.HandOff',{allocationId:'manual-1',expectedVersion:(await v.read('allocation','manual-1')).version},'waiter')).code).toBe('ALLOCATION_STATE_CONFLICT');
 expect((await v.read('cup','cup-1')).state.movements).toHaveLength(2);await v.close();
});

test.each(['removed','transfer_pending'] as const)('R05 manual handoff of %s cup refuses the entire fulfillment decision',async reason=>{
 const v=await coffeeVenue();const {lineId}=await ready(v);
 if(reason==='removed')await observeCup(v,'coffee-1','cup-1',ESPRESSO.cupType,false);
 else await v.submit('Cup.RequestTransfer',pick);
 expect((await handoff(v,lineId,'manual-bad')).code).toBe('COFFEE_HANDOFF_NOT_READY');
 expect((await v.read('fulfillment',lineId)).state).toMatchObject({served:'0',ready:'1',allocated:'1'});
 expect((await v.read('allocation','manual-bad')).state.status).toBe('reserved');
 expect((await v.read('cup','cup-1')).state.ownerKind).toBe('cell');
 expect((await v.read('cell-resource',`${CELL}:machine`)).state.holder).toBe('coffee-1');await v.close();
});
