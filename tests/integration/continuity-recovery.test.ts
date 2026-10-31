import {expect,test} from 'vitest';
import {createContinuityLab} from '../support/continuity-lab';
const receipt=(number:string)=>({sourceType:'paper',sourceSeries:'RECOVERY',sourceNumber:number,totalMinor:'50000',paidCashMinor:'50000',fulfilled:true,occurredAt:'2026-10-29T13:00:00Z'});
test('late source reference links a returning device receipt without duplicate revenue',async()=>{
 const lab=await createContinuityLab();try{
  await lab.importApproved([{...receipt('paper-1'),originalOperationId:'device-sale-1'}]);
  await lab.importApproved([{...receipt('device-sale-1'),sourceType:'device',sourceSeries:'epoch-1',originalOperationId:'device-sale-1'}]);
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(1);
  expect(await lab.effectCount('payment.capture')).toBe(0);expect(await lab.effectCount('robot.execute')).toBe(0);
  const changed=await lab.command('manager','Import.Validate',{rows:[{...receipt('bad-device'),sourceType:'device',originalOperationId:'device-sale-1',totalMinor:'60000'}],incidentRef:'late-conflict'});
  const preview=await lab.command('manager','Import.Preview',{batchId:changed.value.batchId!});
  const approved=await lab.command('manager','Import.Approve',{batchId:changed.value.batchId!,previewHash:preview.value.previewHash!});
  if(approved.status==='accepted')expect((await lab.command('manager','Import.Apply',{batchId:changed.value.batchId!})).code).toBe('SOURCE_LINK_CONFLICT');
  else expect(approved.status).toBe('rejected');
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(1);
 }finally{await lab.close();}
});
test('killed import resumes from the committed receipt without repeating money',async()=>{
 const lab=await createContinuityLab();try{
  const validated=await lab.command('manager','Import.Validate',{rows:[receipt('001'),receipt('002')],incidentRef:'crash-maintenance'});
  const batchId=validated.value.batchId!;
  const preview=await lab.command('manager','Import.Preview',{batchId});
  expect((await lab.command('manager','Import.Approve',{batchId,previewHash:preview.value.previewHash!})).status).toBe('accepted');
  await lab.fault('kill-after-local-commit');
  expect((await lab.command('manager','Import.Apply',{batchId},'apply-first-row')).status).toBe('unknown');
  await lab.restart('coordinator');
  expect((await lab.command('manager','Import.Apply',{batchId},'apply-first-row')).duplicate).toBe(true);
  expect((await lab.state<{cursor:number}>('import-batch',String(batchId))).cursor).toBe(1);
  expect((await lab.command('manager','Import.Apply',{batchId},'apply-second-row')).status).toBe('accepted');
  expect((await lab.state<{status:string;cursor:number}>('import-batch',String(batchId)))).toMatchObject({status:'applied',cursor:2});
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(2);expect(await lab.effectCount('robot.execute')).toBe(0);
 }finally{await lab.close();}
});
test('encrypted checkpoint restores pending robot commands as unknown without adapter resend',async()=>{
 const {createRestaurantLab}=await import('../support/restaurant-lab');
 const {openStore}=await import('../../packages/sync/src/store');
 const {encryptedExport,restoreEncrypted}=await import('../../packages/sync/src/archive');
 const {testPublicJwk,testSigner}=await import('../support/storage-cases');
 const {dispatchRobotEffects}=await import('../../packages/robot-adapters/src/dispatch');
 const {createSimulator}=await import('../support/restaurant-journey');
 const lab=await createRestaurantLab();let restored:Awaited<ReturnType<typeof openStore>>|undefined;
 try{
  const mission=await lab.command('cashier','Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]},'checkpoint-mission');
  expect(mission.status).toBe('accepted');
  const source=await lab.getStore('coordinator'),original=await source.journal(lab.scope);
  const archive=await encryptedExport(source,lab.scope,'independent-restore-passphrase');
  restored=await openStore({driver:'sqlite',url:lab.directory+'/restored-effects.db',producer:{deviceId:'coordinator',deviceEpoch:'epoch-1'},signer:testSigner,signerPublicJwk:JSON.parse(JSON.stringify(testPublicJwk))});
  await restoreEncrypted(restored,lab.scope,archive,'independent-restore-passphrase');
  expect(await restored.journal(lab.scope)).toEqual(original);
  expect((await restored.effects(lab.scope,'robot.execute'))[0]!.status).toBe('unknown');
  const simulator=await createSimulator(lab);let accepted=0;const unsubscribe=simulator.observe(e=>{if(e.type==='accepted')accepted++;});
  try{await dispatchRobotEffects(restored,lab.scope,simulator,lab.clock.nowMs);}finally{unsubscribe();}
  expect(accepted).toBe(0);expect((await restored.effects(lab.scope,'robot.execute'))[0]!.attempts).toBe(0);
 }finally{await restored?.close();await lab.close();}
});
