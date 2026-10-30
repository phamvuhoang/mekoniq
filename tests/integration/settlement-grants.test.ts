import {expect,test} from 'vitest';
import {createContinuityLab} from '../support/continuity-lab';
test('expired collection grant remains locked until reconciliation',async()=>{
 const lab=await createContinuityLab();try {
  await lab.seed('bill','bill-1',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND'});
  await lab.seed('grant','grant-1',{billId:'bill-1',deviceId:'device-a',status:'issued',expiresAtMs:1000});
  await lab.advance(2000);
  expect((await lab.command('manager','SettlementGrant.Issue',{billId:'bill-1',deviceId:'device-b'})).code).toBe('GRANT_UNRECONCILED');
 }finally{await lab.close();}
});
test('grant spending is bounded and expiry never authorizes another collector',async()=>{
 const lab=await createContinuityLab();try{
  await lab.seed('bill','bill-1',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND'});
  const issue=await lab.command('manager','SettlementGrant.Issue',{billId:'bill-1',deviceId:'device-a',expiresAtMs:lab.clock.nowMs+1000});
  expect(issue.status).toBe('accepted');
  const grantId=String(issue.value.grantId);
  expect((await lab.command('device-b','SettlementGrant.Use',{grantId,amountMinor:'50000',method:'cash'})).code).toBe('GRANT_DEVICE_MISMATCH');
  const spend=await lab.command('device-a','SettlementGrant.Use',{grantId,amountMinor:'100000',method:'cash'},'grant-use');
  expect(spend.status).toBe('accepted');
  expect((await lab.command('device-a','SettlementGrant.Use',{grantId,amountMinor:'100000',method:'cash'},'grant-use')).duplicate).toBe(true);
  expect((await lab.command('device-a','SettlementGrant.Use',{grantId,amountMinor:'1',method:'cash'})).status).toBe('rejected');
  expect(await lab.count('GrantCashRecorded')).toBe(1);
 }finally{await lab.close();}
});

test('tampered signed amount and copied tenant grant are rejected before cash receipt',async()=>{
 const lab=await createContinuityLab(),other=await createContinuityLab();try{
  for(const target of [lab,other]) {
   await target.seed('device','device-a',{deviceEpoch:'epoch-1',status:'active'});
   await target.seed('bill','secured-bill',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND'});
  }
  const issued=await lab.command('manager','SettlementGrant.Issue',{billId:'secured-bill',deviceId:'device-a'});
  expect(issued.status).toBe('accepted');const grantId=String(issued.value.grantId);
  const grant=await lab.state<import('../../packages/contracts/src/index').JsonObject>('grant',grantId);
  await lab.seed('grant',grantId,{...grant,amountMinor:'999999'});
  expect((await lab.command('device-a','SettlementGrant.Use',{grantId,amountMinor:'100000',method:'cash'})).code).toBe('GRANT_SIGNATURE_INVALID');
  await other.seed('grant',grantId,grant);
  expect((await other.command('device-a','SettlementGrant.Use',{grantId,amountMinor:'1',method:'cash'})).code).toBe('GRANT_SCOPE_MISMATCH');
  expect(await lab.count('GrantCashRecorded')).toBe(0);expect(await other.count('GrantCashRecorded')).toBe(0);
 }finally{await lab.close();await other.close();}
});
test('recipient reenrollment and changed frozen bill invalidate old collection authority',async()=>{
 const lab=await createContinuityLab();try{
  await lab.seed('device','device-a',{deviceEpoch:'epoch-1',status:'active'});
  await lab.seed('bill','secured-bill',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND'});
  const issued=await lab.command('manager','SettlementGrant.Issue',{billId:'secured-bill',deviceId:'device-a'});
  expect(issued.status).toBe('accepted');const grantId=String(issued.value.grantId);
  await lab.seed('device','device-a',{deviceEpoch:'epoch-2',status:'active'});
  expect((await lab.command('device-a','SettlementGrant.Use',{grantId,amountMinor:'1',method:'cash'})).code).toBe('GRANT_DEVICE_EPOCH_MISMATCH');

 }finally{await lab.close();}
});
test('isolated collector commits once, returns a signed closure and coordinator reconciles original receipts',async()=>{
 const lab=await createContinuityLab();try{
  await lab.seed('bill','offline-bill',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND'});
  const issue=await lab.command('manager','SettlementGrant.Issue',{billId:'offline-bill',deviceId:'device-a',expiresAtMs:lab.clock.nowMs+1000});
  expect(issue.status).toBe('accepted');const grantId=String(issue.value.grantId);
  await lab.partition('lan');
  const use={grantId,amountMinor:'50000',method:'cash'};
  expect((await lab.command('device-a','SettlementGrant.Use',use,'offline-collection')).ack).toBe('local');
  expect((await lab.command('device-a','SettlementGrant.Use',use,'offline-collection')).duplicate).toBe(true);
  expect((await lab.stateOn<{spentMinor:string}>('device-a','grant',grantId)).spentMinor).toBe('50000');
  await lab.advance(2000);
  expect((await lab.command('device-a','SettlementGrant.Use',{grantId,amountMinor:'1',method:'cash'})).code).toBe('GRANT_EXPIRED');
  expect((await lab.command('device-a','SettlementGrant.Return',{grantId},'offline-return')).status).toBe('accepted');
  await lab.heal();
  const coordinator=await lab.getStore('coordinator'),collector=await lab.getStore('device-a');
  const {ingestSettlementObservation}=await import('../../packages/sync/src/settlement-observations');
  const observations=(await collector.journal(lab.scope)).filter(e=>['SettlementGrant.Use','SettlementGrant.Return'].includes(String(e.payload.operationType)));
  for(const entry of observations)expect((await ingestSettlementObservation(coordinator,entry)).status).toBe('accepted');
  for(const entry of observations)expect((await ingestSettlementObservation(coordinator,entry)).duplicate).toBe(true);
  const reconcile=await lab.command('manager','SettlementGrant.Reconcile',{grantId,evidenceRef:'counted-cash-50000'});
  expect(reconcile.status).toBe('accepted');
  expect((await lab.state<{paidMinor:string;collectionLocked:boolean}>('bill','offline-bill'))).toMatchObject({paidMinor:'50000',collectionLocked:false});
  expect((await lab.command('manager','SettlementGrant.Issue',{billId:'offline-bill',deviceId:'device-b'})).status).toBe('accepted');
 }finally{await lab.close();}
});
test('manager note cannot release collection authority without recipient closure proof',async()=>{
 const lab=await createContinuityLab();try{
  await lab.seed('bill','proof-bill',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND'});
  const issue=await lab.command('manager','SettlementGrant.Issue',{billId:'proof-bill',deviceId:'device-a'});
  const grantId=String(issue.value.grantId);
  expect((await lab.command('manager','SettlementGrant.Reconcile',{grantId,evidenceRef:'trust-me'})).code).toBe('GRANT_RETURN_REQUIRED');
  expect((await lab.command('manager','SettlementGrant.Issue',{billId:'proof-bill',deviceId:'device-b'})).code).toBe('GRANT_UNRECONCILED');
 }finally{await lab.close();}
});

test('changing a frozen bill after grant issuance blocks collection',async()=>{
 const lab=await createContinuityLab();try{
  await lab.seed('bill','changed-bill',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND'});
  const issue=await lab.command('manager','SettlementGrant.Issue',{billId:'changed-bill',deviceId:'device-a'});
  const bill=await lab.state<import('../../packages/contracts/src/index').JsonObject>('bill','changed-bill');
  await lab.seed('bill','changed-bill',{...bill,totalMinor:'200000'});
  expect((await lab.command('device-a','SettlementGrant.Use',{grantId:issue.value.grantId!,amountMinor:'1',method:'cash'})).code).toBe('GRANT_BILL_CHANGED');
 }finally{await lab.close();}
});
test('unknown provider payment blocks offline recollection and mutable spent state cannot erase receipts',async()=>{
 const lab=await createContinuityLab();try{
  await lab.seed('bill','unknown-bill',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND',externalPaymentState:'unknown'});
  expect((await lab.command('manager','SettlementGrant.Issue',{billId:'unknown-bill',deviceId:'device-a'})).code).toBe('PAYMENT_UNRESOLVED');
  await lab.seed('bill','ledger-bill',{status:'prepared',totalMinor:'100000',paidMinor:'0',currency:'VND'});
  const issue=await lab.command('manager','SettlementGrant.Issue',{billId:'ledger-bill',deviceId:'device-a'}),grantId=String(issue.value.grantId);
  expect((await lab.command('device-a','SettlementGrant.Use',{grantId,amountMinor:'50000',method:'cash'})).status).toBe('accepted');
  const grant=await lab.stateOn<import('../../packages/contracts/src/index').JsonObject>('device-a','grant',grantId);
  await(await lab.getStore('device-a')).seed(lab.scope,'grant',grantId,{...grant,spentMinor:'0'},Number(grant.version));
  expect((await lab.command('device-a','SettlementGrant.Use',{grantId,amountMinor:'100000',method:'cash'})).code).toBe('GRANT_LEDGER_MISMATCH');
 }finally{await lab.close();}
});
