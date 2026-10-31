import {expect,test} from 'vitest';
import {createContinuityLab} from '../support/continuity-lab';
import {canonicalBytes} from '../../packages/contracts/src/index';
import {testSigner} from '../support/storage-cases';
test('unknown robot goal prevents replacement coordinator activation',async()=>{
 const lab=await createContinuityLab();try{
  await lab.seed('robot','sim-1',{controlEpoch:3,goalState:'unknown'});
  expect((await lab.command('manager','Ownership.Activate',{newDeviceId:'device-b'})).code).toBe('RESOURCE_UNRECONCILED');
 }finally{await lab.close();}
});
test('handoff requires durable checkpoint, fencing and executor epoch acknowledgment',async()=>{
 const lab=await createContinuityLab();try{
  for(const deviceId of ['device-a','device-b','device-kds','device-guest'])await lab.seed('device-checkpoint',deviceId,{deviceEpoch:'epoch-1',status:'complete',pendingCount:0,receivedCursor:'0',appliedCursor:'0',coveredSequence:'0',expiresAtMs:lab.clock.nowMs+30000});
  const prepared=await lab.command('manager','Ownership.PrepareHandoff',{newDeviceId:'device-b'});
  expect(prepared.status).toBe('accepted');
  expect((await lab.command('manager','Ownership.Activate',{newDeviceId:'device-b'})).code).toBe('FENCING_REQUIRED');
  expect((await lab.command('manager','Ownership.Fence',{newDeviceId:'device-b',oldOwnerStopped:true,executorEpochAck:true})).code).toBe('FENCING_EVIDENCE_REQUIRED');
  const proof={...lab.scope,resourceId:'coordinator',status:'fenced',oldOwnerDeviceId:'coordinator',newOwnerDeviceId:'device-b',oldEpoch:1,newEpoch:2,handoffId:prepared.value.handoffId,checkpointHash:prepared.value.checkpointHash};
  const signature=testSigner(canonicalBytes(proof));
  expect((await lab.command('manager','Ownership.Fence',{newDeviceId:'device-b',proofs:[{...proof,signature}]})).status).toBe('accepted');
  expect((await lab.command('manager','Ownership.Activate',{newDeviceId:'device-b'})).status).toBe('accepted');
  expect((await lab.state<{owner:string;epoch:number}>('ownership','venue-a')).owner).toBe('device-b');
  await lab.restart('coordinator');
  expect((await lab.command('manager','Continuity.CaptureTicket',{id:'stale-owner',table:'table-1',totalMinor:'0'})).code).toBe('AUTHORITY_CONFLICT');
 }finally{await lab.close();}
});
