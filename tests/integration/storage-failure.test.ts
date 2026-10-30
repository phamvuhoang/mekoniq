import {expect,test} from 'vitest';
import {storageCase,testSigner} from '../support/storage-cases';
import {openStore} from '../../packages/sync/src/store';
test('actual SQLite page limit rolls back every mutation and does not ACK',async()=>{
 const fixture=await storageCase('sqlite');const store=await openStore({driver:'sqlite',url:fixture.url,storagePageLimit:1,signer:testSigner});
 try{
  await store.provision(fixture.scope,1,1);
  const batch=fixture.batch(fixture.command('disk-full',{note:'small'}));
  batch.mutations[0].newState={data:'x'.repeat(128000)};
  await expect(store.commit(batch)).rejects.toThrow('STORAGE_FULL');
  expect(await store.events(fixture.scope)).toHaveLength(0);
  expect(await store.journalCount()).toBe(0);
 }finally{await store.close();await fixture.destroy();}
});
test('signer failure rolls back projections, journal, outbox and sequence',async()=>{
 const fixture=await storageCase('sqlite');let store=await openStore({driver:'sqlite',url:fixture.url,signer:()=>{throw new Error('KEY_UNAVAILABLE');}});
 try{
  await store.provision(fixture.scope,1,1);
  await expect(store.commit(fixture.batch(fixture.command('key-fail',{note:'one'})))).rejects.toThrow('KEY_UNAVAILABLE');
  expect(await store.journalCount()).toBe(0);expect(await store.pending(fixture.scope)).toHaveLength(0);
  await store.close();store=await fixture.open();
  expect((await store.commit(fixture.batch(fixture.command('key-success',{note:'one'})))).sequence).toBe('1');
 }finally{await store.close();await fixture.destroy();}
});
