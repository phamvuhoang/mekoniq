import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../../src/project/store';
import { defaultProject } from '../../src/project/default';

describe('IndexedDB project storage', () => {
  it('persists revisions across connections and roundtrips an export', async () => {
    const name=`core-${crypto.randomUUID()}`;
    const project=defaultProject();
    const store=new ProjectStore(name);
    await store.save(project);
    await store.close();
    const reopened=new ProjectStore(name);
    expect(await reopened.load(project.id)).toEqual(project);
    const exported=await reopened.export(project.id);
    const destination=new ProjectStore(`${name}-import`);
    expect(await destination.import(exported)).toEqual(project);
    expect(await destination.load(project.id)).toEqual(project);
    await Promise.all([reopened.close(),destination.close()]);
  });
  it('propagates storage failures instead of reporting a saved revision', async () => {
    const store=new ProjectStore(`core-${crypto.randomUUID()}`);
    const project=defaultProject();
    await store.save(project);
    const put=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('Storage is full','QuotaExceededError');});
    await expect(store.save({...project,revision:2,name:'unsaved'})).rejects.toThrow(/Storage is full/);
    put.mockRestore();
    expect((await store.load(project.id))?.revision).toBe(1);
    await store.close();
  });
  it('rejects corrupt imports before overwriting a saved project', async () => {
    const store=new ProjectStore(`core-${crypto.randomUUID()}`);
    const project=defaultProject();
    await store.save(project);
    await expect(store.import(JSON.stringify({...project,name:'bad',schemaVersion:99}))).rejects.toThrow();
    await expect(store.import('{')).rejects.toThrow();
    expect((await store.load(project.id))?.name).toBe(project.name);
    expect(await store.load('unknown')).toBeNull();
    await expect(store.export('unknown')).rejects.toThrow(/NOT_FOUND/);
    await store.close();
  });
});

it('refuses numeric amplification before replacing a usable stored project',async()=>{
  const store=new ProjectStore(`bounded-${crypto.randomUUID()}`),p=defaultProject();await store.save(p);
  try{for(const bad of [{...p,design:{...p.design,trays:Number.MAX_SAFE_INTEGER}},{...p,world:{...p.world,width:1e20}}])await expect(store.import(JSON.stringify(bad))).rejects.toThrow();expect(await store.load(p.id)).toEqual(p);}finally{await store.close();}
});
it('persists v2 schedules and rejects malformed imports without overwriting them',async()=>{
 const {default:fixture}=await import('../../fixtures/twins/coffee-cell-v2.json');const {validateProjectV2}=await import('../../src/project/schema');const {editSchedule}=await import('../../src/scenarios/fault-schedule');const base=validateProjectV2(fixture.project);
 const p=editSchedule(base,[{id:'f1',faultId:'cup-removed',targetId:base.entities.find(e=>e.kind==='coffee_machine')!.id,trigger:{kind:'phase',value:'grasp'},durationMs:1000}]);
 const store=new ProjectStore(`schedule-${crypto.randomUUID()}`);await store.saveV2(p);const exported=await store.exportV2(p.id);await store.close();const copy=new ProjectStore(`copy-${crypto.randomUUID()}`);await copy.importV2(exported);expect(await copy.loadV2(p.id)).toEqual(p);
 await expect(copy.importV2(JSON.stringify({...p,faultSchedule:[{...p.faultSchedule![0],durationMs:0}]}))).rejects.toThrow();expect(await copy.loadV2(p.id)).toEqual(p);await copy.close();
});
