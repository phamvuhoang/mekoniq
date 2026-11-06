import {afterEach,expect,test} from 'vitest';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalOutcome} from '../../packages/lab-runtime/src/v2/report';
import {scenarioRegistry,type ScenarioDefinition} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {act,cleanupRuns,executeFixture,openFixture,runDirectory,stepUntil} from '../support/lab-v2';
afterEach(cleanupRuns);
const FD01=scenarioRegistry.get('FD01')!,FD07=scenarioRegistry.get('FD07')!;
const human:Record<string,ScenarioDefinition>={'FD01-human':{...FD01,id:'FD01-human',confirm:{mode:'human',delayTicks:0}}};
const executes=(r:{effects:{type:string;status:string;attempts:number;payload:unknown}[]})=>r.effects.filter(e=>e.type==='robot.execute');
const awaiting=(type:string)=>(v:{awaiting:{confirmationType:string}[]})=>v.awaiting.some(a=>a.confirmationType===type);
async function confirm(run:Awaited<ReturnType<typeof openFixture>>,type:string){const v=await run.snapshot();const a=v.awaiting.find(x=>x.confirmationType===type)!;return act(run,'confirm',{subjectId:a.subjectId,confirmationType:type,actorProvenance:'scripted'});}

test('crash after journal commit and before checkpoint reopens as needs_attention, keeps cargo and never resends',async()=>{
 const directory=await runDirectory(),o={seed:42,scenarios:human,directory};
 let run=await openFixture('FD01-human',o);
 await run.start();await stepUntil(run,awaiting('load'));await confirm(run,'load');
 await act(run,'injectFault',{faultId:'crash-after-commit'});
 await expect(act(run,'step',{ticks:50})).rejects.toThrow('SIMULATED_CRASH');
 await expect(run.snapshot()).rejects.toThrow('RUN_CLOSED');
 run=await openFixture('FD01-human',o);
 try{
  const view=await run.snapshot();
  expect(view.run.status).toBe('needs_attention');expect(view.attention.map(a=>a.reason)).toContain('RECOVERY_UNKNOWN');
  const before=await run.report();
  // the crash fires right after an accepted Robot.Observe commit and before the checkpoint: that op is recovered as committed
  expect(before.recoveredOps.at(-1)).toMatchObject({type:'Robot.Observe',committed:true});
  expect(before.businessEvents.map(e=>e.type)).toContain('CargoLoaded');expect(before.businessEvents.map(e=>e.type)).not.toContain('DeliveryHandedOff');expect(before.outcome.served).toBe('0');
  expect(executes(before).map(e=>e.attempts)).toEqual([1,1]);
  expect(before.businessEvents.some(e=>e.type==='MissionNeedsAttention')).toBe(true);
  await act(run,'step',{ticks:500});
  const after=await act(run,'reconcile',{subjectId:'amr-1'});expect(after.run.status).toBe('needs_attention');
  const r=await run.report();expect(r.effects).toEqual(before.effects);expect(r.reconciliations).toEqual([expect.objectContaining({subjectId:'amr-1',nativeState:'unknown'})]);
  // Cargo stays with the held mission: the allocation is still loaded and nothing was served.
  const allocation=[...r.businessEvents].reverse().find(e=>e.kind==='allocation')!;expect((allocation.state as {status:string}).status).toBe('loaded');
 }finally{await run.close();}
});

test('clean close and reopen resumes from the checkpoint with the uninterrupted canonical outcome',async()=>{
 const straight=await executeFixture('FD01',{seed:11});
 const directory=await runDirectory();
 let run=await openFixture('FD01',{seed:11,directory});
 await run.start();await stepUntil(run,v=>v.entities[0]!.moving);await act(run,'step',{ticks:125});await run.close();
 run=await openFixture('FD01',{seed:11,directory});
 try{expect((await run.snapshot()).run.status).toBe('running');await stepUntil(run,undefined,500);expect(canonicalOutcome(await run.report())).toEqual(canonicalOutcome(straight));}
 finally{await run.close();}
 await expect(openFixture('FD01',{seed:12,directory})).rejects.toThrow('RUN_IDENTITY_MISMATCH');
});

test('duplicate arrival is absorbed or rejected by source identity checks; served counts once',async()=>{
 const run=await openFixture('FD01-human',{seed:42,scenarios:human});
 try{
  await run.start();await stepUntil(run,awaiting('load'));
  await act(run,'injectFault',{faultId:'duplicate-arrival',entityId:'amr-1'});await act(run,'step',{ticks:1});
  expect((await run.snapshot()).awaiting).toHaveLength(1);
  await confirm(run,'load');await stepUntil(run,v=>v.entities[0]!.moving);
  await act(run,'injectFault',{faultId:'duplicate-arrival',entityId:'amr-1'});const v=await act(run,'step',{ticks:1});
  expect(v.run.status).toBe('running');
  await stepUntil(run,awaiting('handoff'));await confirm(run,'handoff');await stepUntil(run);
  const r=await run.report();expect(r.outcome).toMatchObject({status:'completed',served:'1'});
  expect(r.rejectedObservations).toEqual([expect.objectContaining({type:'completed',code:'STALE_ROBOT_EVENT'})]);
  expect(r.businessEvents.filter(e=>e.type==='MissionArrived')).toHaveLength(3);
 }finally{await run.close();}
});

test('an expired command is never sent; the run needs attention instead of retrying',async()=>{
 const slow:Record<string,ScenarioDefinition>={'FD07-slow':{...FD07,id:'FD07-slow',confirm:{mode:'scripted',delayTicks:2000}}};
 const run=await openFixture('FD07-slow',{seed:3,scenarios:slow});
 try{
  await run.start();const v=await stepUntil(run,undefined,500);
  expect(v.run.status).toBe('needs_attention');expect(v.attention).toEqual(expect.arrayContaining([expect.objectContaining({reason:'COMMAND_EXPIRED',robotId:'amr-b'})]));
  const r=await run.report(),b=executes(r).filter(e=>(e.payload as {robotId:string}).robotId==='amr-b');
  expect(b.map(e=>[e.status,e.attempts])).toEqual([['failed',0]]);
  expect(r.businessEvents.filter(e=>e.type==='RobotGoalCompleted'&&e.id==='amr-b')).toHaveLength(0);
 }finally{await run.close();}
});

test('observer reboot turns the in-flight goal unknown and holds it without resend',async()=>{
 const run=await openFixture('FD01',{seed:42});
 try{
  await run.start();await stepUntil(run,v=>v.entities[0]!.moving);
  await act(run,'injectFault',{faultId:'reboot',entityId:'amr-1'});const v=await act(run,'step',{ticks:1});
  expect(v.run.status).toBe('needs_attention');expect(v.attention.map(a=>a.reason)).toContain('EXECUTION_UNKNOWN');
  const before=await run.report();await act(run,'step',{ticks:1000});const after=await run.report();
  expect(after.effects).toEqual(before.effects);expect(executes(after).reduce((n,e)=>n+e.attempts,0)).toBe(1);
  expect(after.businessEvents.map(e=>e.type)).not.toContain('MissionArrived');
 }finally{await run.close();}
});

test('a checkpoint cannot be dropped to hide an existing durable journal',async()=>{
 const directory=await runDirectory();const run=await openFixture('FD01',{seed:1,directory});await run.start();await act(run,'step',{ticks:600});await run.close();
 await rm(join(directory,'run.json'));
 await expect(openFixture('FD01',{seed:1,directory})).rejects.toThrow('RECOVERY_CHECKPOINT_MISSING');
});

test('a confirmation scheduled before the script is suspended becomes a human confirmation instead of hanging',async()=>{
 // guest-2 opens a second session on the same occupied table: Session.Open is refused, the script suspends while amr-1 waits at the load stop
 const twice:Record<string,ScenarioDefinition>={'FD01-twice':{...FD01,id:'FD01-twice',orders:[{actor:'guest-1',table:0,quantity:1,atTick:[10,10]},{actor:'guest-2',table:0,quantity:1,atTick:[650,650]}],confirm:{mode:'scripted',delayTicks:400}}};
 const run=await openFixture('FD01-twice',{seed:1,scenarios:twice});
 try{
  await run.start();
  const v=await stepUntil(run,x=>x.tick>=700,25);
  expect(v.attention.map(a=>a.reason)).toContain('SCRIPTED_INPUT_REJECTED');
  expect(v.awaiting).toEqual([expect.objectContaining({confirmationType:'load',robotId:'amr-1'})]);
  await confirm(run,'load');
  const r=await run.report();expect(r.businessEvents.map(e=>e.type)).toContain('CargoLoaded');expect(r.confirmations.at(-1)).toMatchObject({confirmationType:'load'});
 }finally{await run.close();}
});
