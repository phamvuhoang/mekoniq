import {expect,test} from 'vitest';
import {createContinuityLab} from '../support/continuity-lab';
import {createRestaurantLab} from '../support/restaurant-lab';
import {canonicalBytes} from '../../packages/contracts/src/index';
import {testSigner,testPublicJwk} from '../support/storage-cases';
const transitions=['Ownership.Fence','Ownership.Activate','Maintenance.Enter'] as const;
const changes=['expired','new-device','new-epoch'] as const;
for(const transition of transitions)test.each(changes)('%s checkpoint change blocks '+transition+' after preparation',async(change)=>{
 const lab=await createContinuityLab();try {
  for(const deviceId of ['device-a','device-b','device-kds','device-guest'])await lab.seed('device-checkpoint',deviceId,{deviceEpoch:'epoch-1',status:'complete',pendingCount:0,receivedCursor:'0',appliedCursor:'0',coveredSequence:'0',expiresAtMs:lab.clock.nowMs+30000});
  const maintenance=transition==='Maintenance.Enter';
  const prepared=await lab.command('manager',maintenance?'Maintenance.Prepare':'Ownership.PrepareHandoff',maintenance?{mode:'full_shutdown'}:{newDeviceId:'device-b'});
  expect(prepared.status).toBe('accepted');
  const proof={...lab.scope,resourceId:'coordinator',status:'fenced',oldOwnerDeviceId:'coordinator',newOwnerDeviceId:'device-b',oldEpoch:1,newEpoch:2,handoffId:prepared.value.handoffId,checkpointHash:prepared.value.checkpointHash};
  const proofs=maintenance?[]:[{...proof,signature:testSigner(canonicalBytes(proof))}];
  if(transition==='Ownership.Activate')expect((await lab.command('manager','Ownership.Fence',{newDeviceId:'device-b',proofs})).status).toBe('accepted');
  if(change==='expired')lab.clock.advance(30001);
  else await lab.seed('device',change==='new-device'?'late-device':'device-a',{status:'active',deviceEpoch:change==='new-device'?'epoch-1':'epoch-2',publicJwk:JSON.parse(JSON.stringify(testPublicJwk))});
  const result=await lab.command('manager',transition,maintenance?{mode:'full_shutdown'}:transition==='Ownership.Fence'?{newDeviceId:'device-b',proofs}:{newDeviceId:'device-b'});
  expect(result.status).toBe('rejected');
  expect(['CHECKPOINT_INCOMPLETE','MISSING_DEVICE_CHECKPOINTS','CHECKPOINT_CHANGED']).toContain(result.code);
  expect(await lab.count(maintenance?'MaintenanceEntered':transition==='Ownership.Fence'?'OwnershipFenced':'OwnershipActivated')).toBe(0);
 }finally{await lab.close();}
});
test('expired checkpoint does not block ordinary restaurant order placement',async()=>{
 const lab=await createRestaurantLab();try {
  await lab.seed('device-checkpoint','device-a',{deviceEpoch:'epoch-1',status:'complete',pendingCount:0,receivedCursor:'0',appliedCursor:'0',coveredSequence:'0',expiresAtMs:lab.clock.nowMs-1});
  expect((await lab.command('owner','Session.Open',{sessionId:'normal-order',tableId:'table-1'})).status).toBe('accepted');
  expect((await lab.command('owner','Order.Place',{sessionId:'normal-order',tableId:'table-1',menuVersion:1,items:[{itemId:'rice',quantity:'1'}]})).status).toBe('accepted');
 }finally{await lab.close();}
});
