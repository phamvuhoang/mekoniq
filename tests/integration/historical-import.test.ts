import {expect,test} from 'vitest';
import {createContinuityLab} from '../support/continuity-lab';
import type {Lab} from '../support/lab';
import type {JsonObject} from '../../packages/contracts/src/index';
async function apply(lab:Lab,rows:JsonObject[]) {
 const validated=await lab.command('manager','Import.Validate',{rows,incidentRef:'maintenance-1'});
 expect(validated.status).toBe('accepted');
 const batchId=validated.value.batchId;
 const preview=await lab.command('manager','Import.Preview',{batchId});
 const approve=await lab.command('manager','Import.Approve',{batchId,previewHash:preview.value.previewHash});
 if(approve.status!=='accepted')return approve;
 return lab.command('manager','Import.Apply',{batchId});
}
const receipt={sourceType:'paper',sourceSeries:'M1',sourceNumber:'001',totalMinor:'50000',paidCashMinor:'50000',fulfilled:true,occurredAt:'2026-10-29T13:00:00Z'};
test('import replay never repeats money or robot commands',async()=>{
 const lab=await createContinuityLab();try{
  expect((await apply(lab,[receipt])).status).toBe('accepted');
  await apply(lab,[receipt]);
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(1);
  expect(await lab.effectCount('robot.execute')).toBe(0);
  expect(await lab.effectCount('payment.capture')).toBe(0);
  await expect((await lab.getStore('coordinator')).pending(lab.scope).then(x=>x.every(e=>e.type==='sync.journal'))).resolves.toBe(true);
 }finally{await lab.close();}
});
test('changed source creates a conflict; preview does not mutate revenue',async()=>{
 const lab=await createContinuityLab();try{
  await apply(lab,[receipt]);
  const changed=await apply(lab,[{...receipt,totalMinor:'60000'}]);
  expect(changed.code).toBe('SOURCE_CONFLICT');
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(1);
 }finally{await lab.close();}
});
test('approval is tied to the preview content hash',async()=>{
 const lab=await createContinuityLab();try{
  const v=await lab.command('manager','Import.Validate',{rows:[receipt],incidentRef:'maintenance-1'});
  expect((await lab.command('manager','Import.Approve',{batchId:v.value.batchId,previewHash:'tampered'})).code).toBe('PREVIEW_CHANGED');
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(0);
 }finally{await lab.close();}
});
test('renamed reordered imports and late matching device exports preserve one financial source',async()=>{
 const lab=await createContinuityLab();try{
  const second={...receipt,sourceNumber:'002',totalMinor:'20000',paidCashMinor:'20000'};
  expect((await lab.importApproved([receipt,second])).status).toBe('accepted');
  expect((await lab.importApproved([second,receipt])).status).toBe('accepted');
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(2);
  const paperSourceKey=JSON.stringify([lab.scope.venueId,'paper','M1','001']);
  const late={...receipt,sourceType:'device',sourceSeries:'device-a',sourceNumber:'d-1',originalOperationId:'device-old-op',paperSourceKey};
  expect((await lab.importApproved([late])).status).toBe('accepted');
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(2);
  const forged={...late,sourceNumber:'d-2',originalOperationId:'device-other-op',totalMinor:'90000'};
  expect((await lab.importApproved([forged])).code).toBe('SOURCE_LINK_CONFLICT');
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(2);
 }finally{await lab.close();}
});
test('per-receipt apply survives a real SIGKILL between receipts and resumes the remaining row',async()=>{
 const lab=await createContinuityLab();try{
  const rows=[receipt,{...receipt,sourceNumber:'002'}];
  const validated=await lab.command('manager','Import.Validate',{rows,incidentRef:'crash-maintenance'});
  const batchId=validated.value.batchId;
  const preview=await lab.command('manager','Import.Preview',{batchId});
  await lab.command('manager','Import.Approve',{batchId,previewHash:preview.value.previewHash});
  await lab.fault('kill-after-local-commit');
  expect((await lab.command('manager','Import.Apply',{batchId},'apply-killed')).status).toBe('unknown');
  await lab.restart('coordinator');
  expect((await lab.command('manager','Import.Apply',{batchId},'apply-killed')).duplicate).toBe(true);
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(1);
  expect((await lab.command('manager','Import.Apply',{batchId},'apply-next')).value.status).toBe('applied');
  expect(await lab.count('HistoricalReceiptRecorded')).toBe(2);
 }finally{await lab.close();}
});
