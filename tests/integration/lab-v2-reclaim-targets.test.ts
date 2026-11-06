import {afterEach,expect,test} from 'vitest';
import {act,cleanupRuns,openFixture,stepUntil} from '../support/lab-v2';

afterEach(cleanupRuns);

test('reclaim at the actual FD01 first completed navigation exposes the waiting robot for audited reconciliation',async()=>{
 const run=await openFixture('FD01',{seed:42});
 try{
  await run.start();const arrived=await stepUntil(run,v=>v.entities[0]!.goal?.state==='completed',1);
  expect(arrived.tick).toBe(691);
  const held=await run.holdForReclaim(),stop=held.awaiting.find(a=>a.confirmationType==='load')!;
  expect(stop).toMatchObject({robotId:'amr-1'});
  expect(held.attention).toContainEqual(expect.objectContaining({reason:'RECLAIM_RECONCILIATION_REQUIRED',robotId:stop.robotId,subjectId:stop.missionId,tick:691}));
  const before=await run.report();await act(run,'reconcile',{subjectId:stop.robotId});const after=await run.report();
  expect(after.reconciliations.at(-1)).toMatchObject({subjectId:'amr-1',nativeState:'completed'});
  expect(after.effects).toEqual(before.effects);expect(after.outcome.served).toBe('0');
 }finally{await run.close();}
},30000);

test('reclaim identifies each active robot separately when two missions exist',async()=>{
 const run=await openFixture('FD07',{seed:42});
 try{
  await run.start();await stepUntil(run,v=>v.workload.filter(w=>w.missionId).length===2,25);
  const held=await run.holdForReclaim(),targets=held.attention.filter(a=>a.reason==='RECLAIM_RECONCILIATION_REQUIRED');
  expect(targets.map(a=>a.robotId).sort()).toEqual(['amr-a','amr-b']);
  expect(targets.every(a=>typeof a.subjectId==='string')).toBe(true);
  expect(new Set(targets.map(a=>a.subjectId)).size).toBe(2);
 }finally{await run.close();}
});
