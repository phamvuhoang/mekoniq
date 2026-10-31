import {expect,test} from 'vitest';
import {createRestaurantLab} from '../support/restaurant-lab';
import {ingestSettlementObservation} from '../../packages/sync/src/settlement-observations';
import {ingestContinuityObservation} from '../../packages/sync/src/continuity-observations';
import type {JsonObject} from '../../packages/contracts/src/index';
test.each(['settlement','continuity'] as const)('%s source retry after lost ACK and policy advance returns durable receipt only after source verification',async(kind)=>{
 const lab=await createRestaurantLab();try {
  let grantId='';
  if(kind==='settlement') {
   await lab.seed('bill','retry-bill',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND'});
   const issued=await lab.command('owner','SettlementGrant.Issue',{billId:'retry-bill',deviceId:'device-a'});
   expect(issued.status).toBe('accepted');grantId=String(issued.value.grantId);
  }
  await lab.partition('lan');
  const capture=await lab.command('device-a',kind==='settlement'?'SettlementGrant.Use':'Continuity.CaptureTicket',kind==='settlement'?{grantId,amountMinor:'50000',method:'cash'}:{id:'retry-ticket',table:'table-1',totalMinor:'50000'},'original-offline-source');
  expect(capture).toMatchObject({status:'accepted',ack:'local'});
  const source=(await(await lab.getStore('device-a')).journal(lab.scope)).find(entry=>entry.operationId==='original-offline-source')!;
  expect(source.kind).toBe('observation');
  await lab.heal();
  const coordinator=await lab.getStore('coordinator'),ingest=kind==='settlement'?ingestSettlementObservation:ingestContinuityObservation;
  const original=await ingest(coordinator,source);expect(original).toMatchObject({status:'accepted',duplicate:false});
  // The accepted response is discarded; a forged source with that ID must never inherit its receipt.
  await expect(ingest(coordinator,{...source,actorRef:'forged-source'})).rejects.toThrow('SOURCE_SIGNATURE_INVALID');
  const configuration=await lab.state<JsonObject>('configuration','applied');
  const features=Object.fromEntries(Object.entries(configuration.features as JsonObject).map(([key,value])=>[key,{...(value as JsonObject),revision:2}]));
  expect((await lab.command('owner','Configuration.Apply',{revision:2,features})).status).toBe('accepted');
  expect((await coordinator.snapshots(lab.scope)).find(s=>s.ref.kind==='__scope__')?.state.policyRevision).toBe(2);
  const count=(await coordinator.journal(lab.scope)).length;
  const retry=await ingest(coordinator,source);
  expect(retry).toEqual({...original,duplicate:true});
  expect((await coordinator.journal(lab.scope)).length).toBe(count);
  expect(await lab.count(kind==='settlement'?'GrantCashObservationAccepted':'IsolatedTicketRecovered')).toBe(1);
  await expect(ingest(coordinator,{...source,actorRef:'forged-source'})).rejects.toThrow('SOURCE_SIGNATURE_INVALID');
 }finally{await lab.close();}
});
