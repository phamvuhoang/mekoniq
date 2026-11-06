import {afterEach,expect,test} from 'vitest';
import {MockAmrAdapter,MockPlant,type PlantRobot} from '../../packages/lab-runtime/src/v2/backends/mock-amr';
import type {RobotCommand} from '../../packages/contracts/src/index';
import {scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {act,cleanupRuns,openFixture,runDirectory,stepUntil} from '../support/lab-v2';
afterEach(cleanupRuns);

test('localization loss before the first order stays latched through step and reconciliation',async()=>{
 const run=await openFixture('FD01',{seed:42});
 try{
  await run.start();await act(run,'injectFault',{faultId:'localization-lost'});
  const v=await act(run,'step',{ticks:2000});
  expect(v.run.status).toBe('needs_attention');expect(v.entities[0]).toMatchObject({quality:'stale',moving:false});
  expect(v.served).toBe('0');expect(v.attention.map(a=>a.reason)).toContain('LOCALIZATION_LOST');
  await act(run,'reconcile',{subjectId:'amr-1'});
  const r=await run.report();expect(r.effects.filter(e=>e.type==='robot.execute')).toHaveLength(0);
  expect(r.entities[0]!.quality).toBe('stale');
 }finally{await run.close();}
});

test.each(['load','handoff'])('localization loss while waiting for %s blocks confirmation and further travel',async(type)=>{
 const fd=scenarioRegistry.get('FD01')!,scenarios={'FD01-human':{...fd,id:'FD01-human',confirm:{mode:'human' as const,delayTicks:0}}};
 const run=await openFixture('FD01-human',{seed:42,scenarios});
 try{
  await run.start();let v=await stepUntil(run,v=>v.awaiting.some(x=>x.confirmationType==='load'));
  if(type==='handoff'){
   await act(run,'confirm',{subjectId:v.awaiting[0]!.subjectId,confirmationType:'load'});
   v=await stepUntil(run,v=>v.awaiting.some(x=>x.confirmationType==='handoff'));
  }
  const waiting=v.awaiting.find(x=>x.confirmationType===type)!,before=await run.report();
  await act(run,'injectFault',{faultId:'localization-lost'});
  await expect(act(run,'confirm',{subjectId:waiting.subjectId,confirmationType:type})).rejects.toThrow('LOCALIZATION_LOST');
  v=await act(run,'step',{ticks:100});const after=await run.report();
  expect(v.entities[0]).toMatchObject({quality:'stale',moving:false});expect(v.served).toBe('0');
  expect(after.effects).toEqual(before.effects);expect(after.confirmations).toEqual(before.confirmations);
 }finally{await run.close();}
});

test('paused localization loss publishes a newer sample at the same simulation time and persists its cursor across reopen',async()=>{
 const directory=await runDirectory();let run=await openFixture('FD01',{seed:42,directory});
 try{
  await run.start();await stepUntil(run,v=>v.entities[0]!.moving);await act(run,'pause');
  const before=run.telemetry.latest()[0]!;expect(before.observed).toMatchObject({moving:true});
  const v=await act(run,'injectFault',{faultId:'localization-lost'}),after=run.telemetry.latest()[0]!;
  expect(after.quality).toBe('stale');expect(after.observed).toMatchObject({moving:false});
  expect(BigInt(after.seq)).toBeGreaterThan(BigInt(before.seq));expect(after.simTimeNs).toBe(before.simTimeNs);
  expect(v.run.telemetryCursor).toBe(after.seq);
  expect((await run.report()).telemetry!.samples.filter(s=>s.simTimeNs===after.simTimeNs).map(s=>s.quality)).toContain('valid');
  await run.close();run=await openFixture('FD01',{seed:42,directory});
  expect(BigInt(run.telemetry.latest()[0]!.seq)).toBeGreaterThan(BigInt(after.seq));
  expect(run.telemetry.latest()[0]!.bootId).toBe(after.bootId);
 }finally{await run.close();}
});

test('reclaiming completed evidence stays completed and never grants control of the archived run',async()=>{
 const run=await openFixture('FD01',{seed:42});
 try{
  await run.start();await stepUntil(run,undefined,500);const before=await run.report(),view=await run.holdForReclaim();
  expect(view.run.status).toBe('completed');expect(view.controlAccess).toBe('view_reconcile');
  expect((await run.report()).effects).toEqual(before.effects);
  await expect(act(run,'step',{ticks:1})).rejects.toThrow('RECLAIM_READ_ONLY');
 }finally{await run.close();}
});

function robot(id:string,x:number,y:number):PlantRobot{return {id,radiusM:0.25,pose:{x,y,yawRad:0},bootId:'boot',seq:0,goals:[],lastCompleted:null,moving:false,hold:null,stale:false,distanceM:0};}
function plant(robots:PlantRobot[]){return new MockPlant({width:10,height:10,obstacles:[{id:'wall',x:1.3,y:0.1,width:0.2,height:1}],injected:[],robots,contacts:0,minSeparationM:null,maxConcurrentMovers:0},()=>0,()=> 'new-boot');}
function adapter(p:MockPlant){return new MockAmrAdapter(p,{id:'a',adapter:'simulator',protocolVersion:'1',firmware:'test',capabilities:['delivery'],mapId:'map',mapRevision:'1',offlineExecution:true,maxLoadMinor:'10000',trays:1,validation:'simulated'});}
const command=(id:string):RobotCommand=>({schemaVersion:1,commandId:id,operationId:id,organizationId:'org',venueId:'venue',robotId:'a',missionId:'mission',stopId:'stop',missionRevision:1,controlEpoch:1,issuerDeviceId:'coordinator',issuedAt:'1970-01-01T00:00:00Z',target:{kind:'ros',mapId:'map',mapRevision:'1',frame:'map',x:1,y:2,yaw:0},expiresAt:'2026-11-05T00:00:00Z',limits:{trays:1,maxLoadMinor:'10000'}});

test('new execute and reachability refuse a latched localization loss without erasing evidence',async()=>{
 const p=plant([robot('a',1,1)]),a=adapter(p),events:string[]=[];a.observe(e=>events.push(e.type));p.fault('a','localization-lost');
 expect(await a.estimateReachability({kind:'ros',mapId:'map',mapRevision:'1',frame:'map',x:1,y:2,yaw:0})).toMatchObject({reachable:false,reason:'LOCALIZATION_LOST'});
 expect(await a.execute(command('new'))).toMatchObject({accepted:false,reason:'LOCALIZATION_LOST'});
 p.advance();expect(p.robot('a')).toMatchObject({stale:true,moving:false,pose:{x:1,y:1}});expect(events).toEqual(['rejected']);
});

test('inter-robot separation measures the footprint pair even when a nearby wall is closer',async()=>{
 const p=plant([robot('a',1,1),robot('b',5,1)]);p.advance();
 // Wall clearance is 0.05 m; centres are 4 m apart with two 0.25 m footprints, including when stopped.
 expect(p.state.minSeparationM).toBe(3.5);
 const alone=plant([robot('a',1,1)]);await adapter(alone).execute(command('alone'));alone.advance();expect(alone.state.minSeparationM).toBeNull();
});
