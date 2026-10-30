import {expect,test} from 'vitest';
import {createRestaurantLab} from '../support/restaurant-lab';
import {createSimulator,completeSimulatedTravel} from '../support/restaurant-journey';
import {canonicalBytes,type JsonObject,type CommandResult} from '../../packages/contracts/src/index';
import {testSigner,testPublicJwk} from '../support/storage-cases';
const accepted=(r:CommandResult)=>{expect(r.status,r.code).toBe('accepted');return r;};
type RestaurantLab=Awaited<ReturnType<typeof createRestaurantLab>>;
async function loadedMission(lab:RestaurantLab) {
 const ids:string[]=[];
 for(const [index,itemId,stationId] of [[1,'rice','kitchen'],[2,'tea','bar']] as const) {
  const sessionId=`review-session-${index}`,tableId=`table-${index}`;
  accepted(await lab.command('owner','Session.Open',{sessionId,tableId}));
  const order=accepted(await lab.command('owner','Order.Place',{sessionId,tableId,menuVersion:1,items:[{itemId,quantity:'1'}]}));
  const lineId=(order.value.lineIds as string[])[0]!;
  accepted(await lab.command('owner','Kitchen.Ready',{lineId,quantity:'1',stationId,expectedVersion:1}));
  ids.push(String(accepted(await lab.command('owner','Fulfillment.Allocate',{lineId,quantity:'1',expectedVersion:2,method:'robot'})).value.allocationId));
 }
 const missionId=String(accepted(await lab.command('owner','Mission.Create',{allocationIds:ids,robotId:'sim-1'})).value.missionId);
 const simulator=await createSimulator(lab);
 async function arrive(){await completeSimulatedTravel(lab,simulator,missionId);}
 async function confirm(){const m=await lab.state<JsonObject>('mission',missionId);return accepted(await lab.command('owner','Mission.ConfirmStop',{missionId,expectedVersion:m.version!,missionRevision:m.revision!,stopId:m.currentStopId!}));}
 await arrive();await confirm();await arrive();await confirm();
 return {missionId,ids,arrive,confirm};
}
test('review8: first handoff retains other table cargo and busy robot',async()=>{
 const lab=await createRestaurantLab();try {
  const m=await loadedMission(lab);await m.arrive();await m.confirm();
  expect(await lab.state('mission',m.missionId)).toMatchObject({loaded:true,status:'executing'});
  expect(await lab.state('allocation',m.ids[1]!)).toMatchObject({status:'loaded'});
  expect(await lab.state('robot','sim-1')).toMatchObject({availability:'busy',missionId:m.missionId});
 }finally{await lab.close();}
});
test('review8: first source return retains remaining cargo through repeated cancellation',async()=>{
 const lab=await createRestaurantLab();try {
  const m=await loadedMission(lab);await m.arrive();
  const before=await lab.state<JsonObject>('mission',m.missionId);
  accepted(await lab.command('owner','Mission.Cancel',{missionId:m.missionId,expectedVersion:before.version!}));
  await m.arrive();await m.confirm();
  expect(await lab.state('mission',m.missionId)).toMatchObject({loaded:true});
  const remaining=(await Promise.all(m.ids.map(async id=>({id,state:await lab.state<JsonObject>('allocation',id)})))).filter(a=>a.state.status==='loaded');
  expect(remaining).toHaveLength(1);
  await m.arrive();const returning=await lab.state<JsonObject>('mission',m.missionId);
  // Existing journals may contain the old false cache; cancellation must still inspect actual cargo.
  await lab.seed('mission',m.missionId,{...returning,loaded:false});
  const retry=await lab.command('owner','Mission.Cancel',{missionId:m.missionId,expectedVersion:returning.version!});
  accepted(retry);
  expect(await lab.state('robot','sim-1')).toMatchObject({availability:'busy',missionId:m.missionId});
  expect(await lab.state('allocation',remaining[0]!.id)).toMatchObject({status:'loaded'});
  await m.arrive();await m.confirm();
  expect(await lab.state('mission',m.missionId)).toMatchObject({loaded:false,status:'cancelled'});
  expect(await lab.state('robot','sim-1')).toMatchObject({availability:'idle',missionId:null});
  for(const id of m.ids)expect(await lab.state('allocation',id)).toMatchObject({status:'returned'});
 }finally{await lab.close();}
});
test('review9: reconciliation binds the current persisted mission command',async()=>{
 const lab=await createRestaurantLab();try {
  const robot=await lab.state<JsonObject>('robot','sim-1');await lab.seed('robot','sim-1',{...robot,executorPublicJwk:JSON.parse(JSON.stringify(testPublicJwk))});
  const created=accepted(await lab.command('owner','Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]}));
  accepted(await lab.command('owner','Robot.RequestStop',{robotId:'sim-1'}));
  const request=accepted(await lab.command('owner','Robot.PrepareReconciliation',{robotId:'sim-1'}));
  const challenge=request.value.challenge as JsonObject;
  expect(challenge.commandId).toBe(created.value.commandId);
  const proof={...lab.scope,robotId:'sim-1',nonce:challenge.nonce,commandId:created.value.commandId,controlEpoch:robot.controlEpoch,mapId:robot.mapId,mapRevision:robot.mapRevision,status:'completed',observedAt:new Date(lab.clock.nowMs).toISOString(),bootId:'executor-review',sequence:'1'};
  accepted(await lab.command('owner','Robot.Reconcile',{robotId:'sim-1',proof:{...proof,signature:testSigner(canonicalBytes(proof))}}));
  expect(await lab.state('robot','sim-1')).toMatchObject({availability:'unknown',available:false});
 }finally{await lab.close();}
});
test('review10: amendment rejects new menu currency without changing order or fulfillment',async()=>{
 const lab=await createRestaurantLab();try {
  accepted(await lab.command('owner','Session.Open',{sessionId:'currency-session',tableId:'table-1'}));
  const placed=accepted(await lab.command('owner','Order.Place',{sessionId:'currency-session',tableId:'table-1',menuVersion:1,items:[{itemId:'rice',quantity:'1'}]}));
  const orderId=String(placed.value.orderId),before=await lab.state<JsonObject>('order',orderId),menu=await lab.state<JsonObject>('catalog','current');
  await lab.seed('catalog','current',{...menu,version:2,currency:'USD'});
  const changed=await lab.command('owner','Order.Amend',{orderId,expectedVersion:before.version!,menuVersion:2,items:[{itemId:'tea',quantity:'1'}]});
  expect(changed).toMatchObject({status:'rejected',code:'CURRENCY_MISMATCH'});
  expect(await lab.state('order',orderId)).toEqual(before);
  expect(await lab.count('OrderAmended')).toBe(0);
  expect(await lab.count('KitchenTicketCreated')).toBe(1);
 }finally{await lab.close();}
});
test.each([false,true])('review11: previously approved batches cannot duplicate payment reference (concurrent=%s)',async(concurrent)=>{
 const lab=await createRestaurantLab();try {
  const batchIds:string[]=[];
  for(const sourceNumber of ['001','002']) {
   const rows=[{sourceType:'paper',sourceSeries:'review',sourceNumber,currency:'VND',totalMinor:'50000',paidCashMinor:'50000',paymentReference:'terminal-unique',fulfilled:true,occurredAt:'2026-10-29T13:00:00Z'}];
   const validated=accepted(await lab.command('owner','Import.Validate',{rows,incidentRef:'review-maintenance'}));
   const batchId=String(validated.value.batchId),preview=accepted(await lab.command('owner','Import.Preview',{batchId}));
   accepted(await lab.command('owner','Import.Approve',{batchId,previewHash:preview.value.previewHash!}));batchIds.push(batchId);
  }
  let rejectedBatch=batchIds[1]!;
  if(concurrent) {
   const results=await Promise.all(batchIds.map(batchId=>lab.command('owner','Import.Apply',{batchId})));
   expect(results.filter(r=>r.status==='accepted')).toHaveLength(1);
   rejectedBatch=batchIds[results.findIndex(r=>r.status!=='accepted')]!;
  } else accepted(await lab.command('owner','Import.Apply',{batchId:batchIds[0]!}));
  expect(await lab.command('owner','Import.Apply',{batchId:rejectedBatch})).toMatchObject({status:'rejected',code:'DUPLICATE_PAYMENT_REFERENCE'});
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(1);
  expect(await lab.state('import-batch',rejectedBatch)).toMatchObject({status:'approved',cursor:0});
 }finally{await lab.close();}
});
