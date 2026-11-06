import {afterEach,beforeEach,expect,test} from 'vitest';
import type {JsonObject} from '../../packages/contracts/src/index';
import {cleanupCoffee,coffeeVenue,registerRecipes,verifiedJob,orderCoffee,deviceStatus,observeCup,startStep,commandResult,measured,brewAll,resetSeqs,recipeRef,dockedRobot,
 ESPRESSO,STATION,CELL,ARM,type CoffeeVenue} from '../support/coffee';
beforeEach(resetSeqs);afterEach(cleanupCoffee);
const jobPayload={stationId:STATION,jobId:'coffee-1'};
async function ready(v:CoffeeVenue){await registerRecipes(v);const r=await verifiedJob(v);await v.submit('Coffee.StartJob',jobPayload);await brewAll(v,'coffee-1');await v.submit('Coffee.ConfirmQuality',jobPayload);return r;}
async function pick(v:CoffeeVenue,jobId='coffee-1',cupId='cup-1'){
 const t=await v.submit('Cup.RequestTransfer',{stationId:STATION,jobId,cupId,transferId:`${jobId}:pick`,to:{kind:'arm',id:ARM}});expect(t.status).toBe('accepted');
 const cmd=(await v.effects()).filter(e=>(e.payload as JsonObject).deviceId===ARM).at(-1)!.payload as JsonObject;
 await v.submit('Cup.ConfirmTransfer',{stationId:STATION,cupId,transferId:`${jobId}:pick`,provenance:'sensor',evidence:{commandId:cmd.commandId!,observedAt:new Date(v.now()).toISOString(),gripperClosed:true,objectPresent:true,liftPoseReached:true}},`observer:${ARM}`);
}

test.each(['venue_disabled','device_not_simulated','explicit_simulation'] as const)('modelled measurements require venue and device opt-in: %s',async mode=>{
 const v=await coffeeVenue();await registerRecipes(v);await verifiedJob(v);await v.submit('Coffee.StartJob',jobPayload);
 if(mode==='venue_disabled'){const cfg=await v.read('configuration','applied');await v.store.seed(v.scope,'configuration','applied',{...cfg.state,beverage:{}},cfg.version);}
 if(mode==='device_not_simulated'){const device=await v.read('cell-device',CELL);await v.store.seed(v.scope,'cell-device',CELL,{...device.state,validation:'venue_approved'},device.version);}
 const x=await startStep(v,'coffee-1','brew');await commandResult(v,x.effect!,'completed',measured('0.00003','m3','modelled'));
 const quality=await v.submit('Coffee.ConfirmQuality',jobPayload);
 if(mode==='explicit_simulation')expect(quality.status).toBe('accepted');else expect(quality.code).toBe('MEASUREMENT_UNVERIFIED');await v.close();
});

test('quality consumes W07 cup/lid once, excludes already dispensed beans, and a discarded remake consumes new packaging',async()=>{
 const v=await coffeeVenue();await registerRecipes(v);
 await v.store.seed(v.scope,'stock-item','cup-lid',{name:'Cup and lid',baseUnit:'piece',conversions:{},negativePolicy:'block',currency:'VND',onHand:'10',valueMinor:'10000',movementSeq:0});
 expect((await v.submit('Recipe.Publish',{itemId:'espresso',recipeVersion:'espresso-packaging-v1',lines:[{ingredientId:'coffee-beans',quantity:'18',unit:'g'},{ingredientId:'cup-lid',quantity:'1',unit:'piece'}]},'manager')).status).toBe('accepted');
 const {lineId}=await verifiedJob(v);await v.submit('Coffee.StartJob',jobPayload);await brewAll(v,'coffee-1');
 expect((await v.submit('Coffee.ConfirmQuality',jobPayload)).status).toBe('accepted');
 expect((await v.read('stock-item','coffee-beans')).state.onHand).toBe('982');expect((await v.read('stock-item','cup-lid')).state.onHand).toBe('9');
 expect((await v.submit('Coffee.CancelJob',{...jobPayload,reason:'Cup damaged, remake requested'})).status).toBe('accepted');
 expect((await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId:'coffee-2',lineId,cellId:CELL,cupId:'cup-2',recipe:recipeRef(ESPRESSO)})).status).toBe('accepted');
 await observeCup(v,'coffee-2','cup-2',ESPRESSO.cupType);await v.submit('Coffee.StartJob',{stationId:STATION,jobId:'coffee-2'});await brewAll(v,'coffee-2');await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId:'coffee-2'});
 expect((await v.read('stock-item','coffee-beans')).state.onHand).toBe('964');expect((await v.read('stock-item','cup-lid')).state.onHand).toBe('8');
 const consumes=(await v.store.snapshots(v.scope)).filter(s=>s.ref.kind==='consumption');expect(consumes).toHaveLength(2);
 expect(consumes.find(s=>s.state.jobId==='coffee-1')!.state.wastedMilli).toBe('1000');await v.close();
});

test.each(['separate','combined'] as const)('withdrawal preserves the other cup of a line under a %s allocation',async mode=>{
 const v=await coffeeVenue();await registerRecipes(v);const lineId=await orderCoffee(v,'espresso','2');
 for(const n of [1,2]){
  const jobId=`coffee-${n}`,cupId=`cup-${n}`;
  await v.submit('Coffee.ReserveJob',{stationId:STATION,jobId,lineId,cellId:CELL,cupId,recipe:recipeRef(ESPRESSO)});
  await deviceStatus(v,CELL,{status:'ready'});await deviceStatus(v,ARM,{status:'ready'});await observeCup(v,jobId,cupId,ESPRESSO.cupType);await v.submit('Coffee.StartJob',{stationId:STATION,jobId});await brewAll(v,jobId);await v.submit('Coffee.ConfirmQuality',{stationId:STATION,jobId});
  if(n===1){if(mode==='separate')await v.submit('Fulfillment.Allocate',{lineId,quantity:'1',allocationId:'first-cup',expectedVersion:(await v.read('fulfillment',lineId)).version,method:'robot'});await pick(v);}
 }
 if(mode==='combined')expect((await v.submit('Fulfillment.Allocate',{lineId,quantity:'2',allocationId:'first-cup',expectedVersion:(await v.read('fulfillment',lineId)).version})).status).toBe('accepted');
 expect((await v.read('fulfillment',lineId)).state).toMatchObject({ready:'2',allocated:mode==='separate'?'1':'2'});
 await v.submit('Coffee.CancelJob',{...jobPayload,reason:'First cup lost while transferring'});
 expect((await v.submit('Coffee.Reconcile',{...jobPayload,disposition:'discard',reason:'First cup removed by operator'},'supervisor')).status).toBe('accepted');
 if(mode==='separate'){
  expect((await v.read('allocation','first-cup')).state.status).toBe('cancelled');
  expect((await v.read('fulfillment',lineId)).state).toMatchObject({ready:'1',allocated:'0'});
  const alloc=await v.submit('Fulfillment.Allocate',{lineId,quantity:'1',allocationId:'second-cup',expectedVersion:(await v.read('fulfillment',lineId)).version});expect(alloc.status).toBe('accepted');
  expect((await v.read('allocation','second-cup')).state.coffeeJobIds).toEqual(['coffee-2']);
 }else{
  const a=await v.read('allocation','first-cup');expect(a.state).toMatchObject({status:'reserved',quantity:'1',coffeeJobIds:['coffee-2']});
  expect((await v.read('fulfillment',lineId)).state).toMatchObject({ready:'1',allocated:'1'});
  expect((await v.submit('Fulfillment.HandOff',{allocationId:'first-cup',expectedVersion:a.version},'waiter')).status).toBe('accepted');
  expect((await v.read('coffee-job','coffee-2')).state.status).toBe('delivered');
  expect((await v.read('coffee-job','coffee-1')).state.status).toBe('quarantined');
 }
 await v.close();
});

test('stale giver evidence can be refreshed for the same transfer without resending the arm command',async()=>{
 const v=await coffeeVenue();const {lineId}=await ready(v);await pick(v);await dockedRobot(v,lineId);
 const request={stationId:STATION,jobId:'coffee-1',cupId:'cup-1',transferId:'place',to:{kind:'robot',id:'amr-1',slot:1}};await v.submit('Cup.RequestTransfer',request);
 const cmd=(await v.effects()).filter(e=>(e.payload as JsonObject).deviceId===ARM).at(-1)!.payload as JsonObject;
 const giver=()=>v.submit('Cup.ConfirmTransfer',{stationId:STATION,cupId:'cup-1',transferId:'place',provenance:'sensor',side:'giver',evidence:{commandId:cmd.commandId!,released:true,observedAt:new Date(v.now()).toISOString()}},`observer:${ARM}`);
 await giver();v.advance(10001);
 await v.submit('Cup.ConfirmTransfer',{stationId:STATION,cupId:'cup-1',transferId:'place',provenance:'sensor',side:'receiver',evidence:{transferId:'place',receiverPresent:true,dockInTolerance:true,observedAt:new Date(v.now()).toISOString()}},'observer:amr-1');
 expect((await giver()).status).toBe('accepted');expect((await v.read('cup','cup-1')).state.ownerKind).toBe('robot');
 expect((await v.effects()).filter(e=>e.type==='cell.execute'&&(e.payload as JsonObject).deviceId===ARM)).toHaveLength(2);await v.close();
});

test('tray transfer refuses an arm and receiver configured to share the same observer identity',async()=>{
 const v=await coffeeVenue();const {lineId}=await ready(v);await pick(v);await dockedRobot(v,lineId);
 const robot=await v.read('robot','amr-1');await v.store.seed(v.scope,'robot','amr-1',{...robot.state,observerId:`observer:${ARM}`},robot.version);
 const effects=(await v.effects()).length;
 expect((await v.submit('Cup.RequestTransfer',{stationId:STATION,jobId:'coffee-1',cupId:'cup-1',transferId:'place',to:{kind:'robot',id:'amr-1',slot:1}})).code).toBe('TRANSFER_OBSERVERS_NOT_INDEPENDENT');
 expect((await v.effects()).length).toBe(effects);await v.close();
});

test('mission customer handoff refuses served quantity when its bound coffee cup is not loaded on that robot',async()=>{
 const v=await coffeeVenue();const {lineId}=await ready(v);
 await v.submit('Fulfillment.Allocate',{lineId,quantity:'1',allocationId:'alloc-1',expectedVersion:(await v.read('fulfillment',lineId)).version,method:'robot'});
 await dockedRobot(v,lineId);
 const allocation=await v.read('allocation','alloc-1');await v.store.seed(v.scope,'allocation','alloc-1',{...allocation.state,status:'loaded',coffeeJobIds:['coffee-1']},allocation.version);
 const mission=await v.read('mission','m-1');await v.store.seed(v.scope,'mission','m-1',{...mission.state,loaded:true,currentStopId:'hand-1',stops:(mission.state.stops as JsonObject[]).map(st=>({...st,status:st.id==='hand-1'?'awaiting_action':'completed'}))},mission.version);
 expect((await v.submit('Mission.ConfirmStop',{missionId:'m-1',expectedVersion:mission.version,missionRevision:1,stopId:'hand-1'},'manager')).code).toBe('CUP_HANDOFF_NOT_READY');
 expect((await v.read('fulfillment',lineId)).state.served).toBe('0');expect((await v.read('coffee-job','coffee-1')).state.status).toBe('ready_for_pickup');await v.close();
});
