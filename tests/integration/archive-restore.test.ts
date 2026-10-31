import {expect,test} from 'vitest';
import {join} from 'node:path';
import {createLab} from '../support/lab';
import {testSigner,testPublicJwk} from '../support/storage-cases';
import {openStore} from '../../packages/sync/src/store';
import {encryptedExport,restoreEncrypted} from '../../packages/sync/src/archive';
import {command,batch} from '../support/storage-cases';
test('encrypted export restores original signed IDs and receipts without replaying external effects',async()=>{
 const lab=await createLab();let restored:Awaited<ReturnType<typeof openStore>>|undefined;
 try{
  await lab.command('cashier','Journal.RecordNote',{text:'preserve'},'export-original');
  const source=await lab.getStore('coordinator');
  const original=await source.journal(lab.scope);
  const archive=await encryptedExport(source,lab.scope,'independent-test-passphrase');
  restored=await openStore({driver:'sqlite',url:join(lab.directory,'restored.db'),producer:{deviceId:'coordinator',deviceEpoch:'epoch-1'},signer:testSigner,signerPublicJwk:JSON.parse(JSON.stringify(testPublicJwk))});
  await expect(restoreEncrypted(restored,lab.scope,archive,'incorrect-test-passphrase')).rejects.toThrow();
  expect(await restored.journalCount()).toBe(0);
  await restoreEncrypted(restored,lab.scope,archive,'independent-test-passphrase');
  expect(await restored.journal(lab.scope)).toEqual(original);
  const c=command('export-original',{text:'preserve'},{...lab.scope,actorRef:'cashier',deviceId:'device-a',deviceEpoch:'epoch-1'});
  expect((await restored.receipt(lab.scope,c.operationId,c.payloadHash,c))?.status).toBe('accepted');
  expect(await restored.events(lab.scope,'NoteRecorded')).toHaveLength(1);
  const forbidden=batch(command('export-forbidden',{note:'new'},{...lab.scope,deviceId:'coordinator',deviceEpoch:'epoch-1'}));
  await expect(restored.commit(forbidden)).rejects.toThrow('RECOVERY_REQUIRED');
  const next=batch(command('export-next',{amountMinor:'0',method:'cash'},{...lab.scope,type:'Continuity.RecordPaymentObservation',deviceId:'coordinator',deviceEpoch:'epoch-1'}));
  next.mutations[0].ref.kind='payment-observation';next.mutations[0].newState={amountMinor:'0',method:'cash',status:'unallocated'};
  expect((await restored.commit(next)).sequence).toBe('2');
 }finally{await restored?.close();await lab.close();}
});
