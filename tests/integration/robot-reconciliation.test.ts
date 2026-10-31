import {expect,test} from 'vitest';
import {createContinuityLab} from '../support/continuity-lab';
import {canonicalBytes} from '../../packages/contracts/src/index';
import {testSigner,testPublicJwk} from '../support/storage-cases';
test('text notes and stale query proofs cannot release an unknown robot',async()=>{
 const lab=await createContinuityLab();try{
  await lab.seed('robot','sim-1',{controlEpoch:3,goalState:'unknown',commandId:'goal-1',mapId:'map-a',mapRevision:'1',executorPublicJwk:JSON.parse(JSON.stringify(testPublicJwk))});
  expect((await lab.command('manager','Robot.Reconcile',{robotId:'sim-1',nativeState:'completed',evidenceRef:'believe-me'})).code).toBe('NATIVE_EVIDENCE_REQUIRED');
  const request=await lab.command('manager','Robot.PrepareReconciliation',{robotId:'sim-1'});
  expect(request.status).toBe('accepted');
  const challenge=request.value.challenge as import('../../packages/contracts/src/index').JsonObject;
  const proof={...lab.scope,robotId:'sim-1',nonce:challenge.nonce,commandId:'goal-1',controlEpoch:3,mapId:'map-a',mapRevision:'1',status:'completed',observedAt:new Date(lab.clock.nowMs).toISOString(),bootId:'fake-executor-1',sequence:'1'};
  const signature=testSigner(canonicalBytes(proof));
  expect((await lab.command('manager','Robot.Reconcile',{robotId:'sim-1',proof:{...proof,commandId:'stale-goal',signature}})).code).toBe('NATIVE_PROOF_MISMATCH');
  expect((await lab.state<{goalState:string}>('robot','sim-1')).goalState).toBe('unknown');
  expect((await lab.command('manager','Robot.Reconcile',{robotId:'sim-1',proof:{...proof,signature}})).status).toBe('accepted');
  expect((await lab.state<{available:boolean}>('robot','sim-1')).available).toBe(true);
  expect((await lab.command('manager','Robot.Reconcile',{robotId:'sim-1',proof:{...proof,signature}})).status).toBe('rejected');
 }finally{await lab.close();}
});
