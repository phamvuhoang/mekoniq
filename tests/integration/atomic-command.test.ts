import {expect,test} from 'vitest';
import {storageCase} from '../support/storage-cases';
for(const driver of ['sqlite','postgres'] as const) {
  test(`${driver}: durable receipts survive reopen and concurrent retries`,async()=>{
    const fixture=await storageCase(driver);let store=await fixture.open();
    try {
      const c=fixture.command('op-1',{note:'A'}),b=fixture.batch(c);
      const results=await Promise.all(Array.from({length:20},()=>store.commit(b)));
      expect(results.filter(r=>!r.duplicate)).toHaveLength(1);
      await store.close();store=await fixture.open();
      expect((await store.commit(b)).duplicate).toBe(true);
      expect(await store.events(fixture.scope,'NoteRecorded')).toHaveLength(1);
      await expect(store.commit(fixture.batch(fixture.command('op-1',{note:'B'})))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      await expect(store.commit(fixture.batch({...c,type:'Other.Command'}))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      await expect(store.commit(fixture.batch(fixture.command('op-2',{note:'C'})))).rejects.toThrow('VERSION_CONFLICT');
      expect((await store.journal(fixture.scope))[0].sequence).toMatch(/^[1-9][0-9]*$/);
      expect((await store.pending(fixture.scope))).toHaveLength(1);
      expect((await store.readSnapshot({...fixture.scope,kind:'note',id:'note-1'})).state.note).toBe('A');
    } finally {await store.close();await fixture.destroy();}
  });
  test(`${driver}: scope and authority cannot partially commit`,async()=>{
    const fixture=await storageCase(driver);const store=await fixture.open();
    try {
      const b=fixture.batch(fixture.command('op-invalid',{note:'A'}));
      b.mutations.push({ref:{...fixture.scope,venueId:'foreign',kind:'note',id:'x'},expectedVersion:0,newState:{}});
      await expect(store.commit(b)).rejects.toThrow('SCOPE_CONFLICT');
      expect(await store.events(fixture.scope)).toHaveLength(0);
      b.mutations.pop();b.expectedAuthority.coordinatorEpoch=2;
      await expect(store.commit(b)).rejects.toThrow('AUTHORITY_CONFLICT');
      expect((await store.snapshots(fixture.scope)).filter(s=>s.ref.kind!=='__scope__')).toHaveLength(0);
    } finally {await store.close();await fixture.destroy();}
  });
  test(`${driver}: scope revision rejects phantom resource creation`,async()=>{
    const fixture=await storageCase(driver);const store=await fixture.open();
    try {
      const snapshot=await store.snapshots(fixture.scope);
      const concurrent=fixture.batch(fixture.command('op-concurrent',{note:'unknown resource'}));
      concurrent.mutations[0].ref.kind='robot';concurrent.mutations[0].ref.id='new-unknown';
      await store.commit(concurrent);
      const stale=fixture.batch(fixture.command('op-stale-scan',{note:'activate'}));
      stale.expectedReads=snapshot.map(s=>({ref:s.ref,expectedVersion:s.version}));
      await expect(store.commit(stale)).rejects.toThrow('VERSION_CONFLICT');
      expect(await store.events(fixture.scope,'NoteRecorded')).toHaveLength(1);
    }finally{await store.close();await fixture.destroy();}
  });
}
