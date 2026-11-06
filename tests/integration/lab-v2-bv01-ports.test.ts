import {afterEach,expect,test} from 'vitest';
import {cleanupRuns} from '../support/lab-v2';
import {runBv01Case,runBv01Correlated} from '../support/bv01';
afterEach(cleanupRuns);
test('shared mock ports complete both recipes with conserved cup custody and load before served',async()=>{
 const r=await runBv01Case('happy');expect(r.served).toBe(2);expect(r.transferCount).toBe(4);expect(r.attention).toEqual([]);expect(r.motionStarts).toBe(4);
 expect(r.physicalParents).toHaveLength(2);expect(new Set(r.physicalParents)).toEqual(new Set(['table:table-1']));
});
test('controller-backed completion with null grip cannot move custody or serve',async()=>{
 const r=await runBv01Case('missing-grip');expect(r.served).toBe(0);expect(r.transferCount).toBe(0);expect(r.attention).toContain('GRIP_EVIDENCE_MISSING');
});
test('a receiver that starts moving after release cannot authorize cargo loading',async()=>{
 const r=await runBv01Case('receiver-moves');expect(r.served).toBe(0);expect(r.transferCount).toBeGreaterThanOrEqual(1);expect(r.attention).toContain('DOCK_OUT_OF_TOLERANCE');
});
test('recovery after staging never restarts a logical arm command',async()=>{
 const r=await runBv01Case('reboot-after-stage');expect(r.served).toBe(0);expect(r.motionStarts).toBeLessThanOrEqual(1);expect(r.attention).toContain('RECOVERY_UNKNOWN');
});

test('controller and independent receiver observations commit both real-domain transfers without a mock arm',async()=>{
 const r=await runBv01Correlated();expect(r.attention).toEqual([]);expect(r.served).toBe(2);expect(r.transferCount).toBe(4);expect(r.motionStarts).toBe(4);
});

test('pre-pick admission holds a completed drink when the machine returns to warming',async()=>{
 const {openCoffee,act,stepUntil}=await import('../support/lab-v2');const run=await openCoffee('BV01',{seed:42});
 try{await run.start();await stepUntil(run,v=>v.coffee!.jobs.some(j=>j.status==='ready_for_pickup'),1);
  await act(run,'injectFault',{faultId:'machine-not-ready'});await act(run,'step',{ticks:1});const r=await run.report();
  expect(r.attention.map(a=>a.reason)).toContain('MACHINE_NOT_READY');expect(r.businessEvents.filter(e=>e.type==='CupTransferRequested')).toEqual([]);expect(r.outcome.served).toBe('0');
 }finally{await run.close();}
});
test('the runner awaits asynchronous port advance and close before returning to its caller',async()=>{
 const {createScenarioRun}=await import('../../packages/lab-runtime/src/v2/scenario-runner');
 const {createMockCoffeePorts}=await import('../../packages/lab-runtime/src/v2/beverage/coffee-ports');
 const {manifestFor,coffeeProject,amrAsset,runDirectory,act}=await import('../support/lab-v2');const calls:string[]=[];
 const run=await createScenarioRun({...manifestFor('BV01',{seed:42,project:coffeeProject()}),backendSetId:'mock-default'}, {directory:await runDirectory(),assets:[amrAsset],enabledBackends:['mock_amr','mock_coffee','mock_arm'],coffeePorts:(st,ctx,boot)=>{
  const p=createMockCoffeePorts(st,ctx,boot);return {...p,async advance(){await new Promise<void>(r=>setImmediate(r));await p.advance();calls.push('advanced');},async close(){await new Promise<void>(r=>setImmediate(r));await p.close();calls.push('closed');}};
 }});
 try{await run.start();await act(run,'step',{ticks:1});expect(calls).toEqual(['advanced']);}finally{await run.close();}expect(calls).toEqual(['advanced','closed']);
});

test('native plant checkpoints retain a null arm and read legacy mock checkpoints separately',async()=>{
 const {createPlantSession}=await import('../../packages/lab-runtime/src/v2/beverage/plant-session');
 const {createArmSession,loadArmModel,tsChecker}=await import('../../packages/lab-runtime/src/v2/arm/session');
 const session=createArmSession({model:loadArmModel('integrations/arm-controller/models/puma560-reference'),checker:tsChecker(),entityId:'arm-1',runId:'run-1',providerId:'protocol_double',staleMs:500});
 const adapter:import('../../packages/cell-adapters/src/contract').CellAdapter={observe:()=>()=>{},describe:async()=>({cellId:'cell-1',deviceIds:['arm-1'],adapter:'protocol_double',version:'1',model:'puma',validation:'simulated',capabilities:[]}),execute:async()=>{throw new Error('NO_MOTION_EXPECTED');},cancel:async()=>({acknowledged:false,unknown:true}),reconcile:async()=>({status:'unknown',evidence:{}})};
 const p=createPlantSession({runId:'run-1',cellId:'cell-1',armId:'arm-1',nowMs:()=>0,receiver:()=>null,dock:()=>({robotId:'amr-1',bootId:'b',moving:false,localizationValid:true,errorM:0}),traySensor:()=>false,arm:{adapter,session}});
 expect(p.checkpoint()).toMatchObject({version:2,armState:null});expect(()=>p.arm).toThrow('NATIVE_ARM_HAS_NO_MOCK_SNAPSHOT');
});

test('duplicate native callbacks retain their first coordinator receipt stamp',async()=>{
 const {createPlantSession}=await import('../../packages/lab-runtime/src/v2/beverage/plant-session');
 const {createArmSession,loadArmModel,tsChecker}=await import('../../packages/lab-runtime/src/v2/arm/session');
 type Report=import('../../packages/cell-adapters/src/contract').CellReport;
 let receive:((r:Report)=>void)|undefined;
 const adapter:import('../../packages/cell-adapters/src/contract').CellAdapter&{journalPath:string}={journalPath:'protocol-double-journal',observe:l=>{receive=l;return ()=>{};},describe:async()=>({cellId:'cell-1',deviceIds:['arm-1'],adapter:'protocol_double',version:'1',model:'puma',validation:'simulated',capabilities:[]}),execute:async()=>{throw new Error('NO_MOTION_EXPECTED');},cancel:async()=>({acknowledged:false,unknown:true}),reconcile:async()=>({status:'unknown',evidence:{}})};
 const session=createArmSession({model:loadArmModel('integrations/arm-controller/models/puma560-reference'),checker:tsChecker(),entityId:'arm-1',runId:'run-1',providerId:'protocol_double',staleMs:500});
 let time=10n;const p=createPlantSession({runId:'run-1',cellId:'cell-1',armId:'arm-1',nowMs:()=>0,receiver:()=>null,dock:()=>({robotId:'amr-1',bootId:'b',moving:false,localizationValid:true,errorM:0}),traySensor:()=>false,arm:{adapter,session},receiptMonotonicNs:()=>time});
 const ports=p.ports(),report={deviceId:'arm-1',bootId:'b',seq:'1',observedAt:'2026-11-06T00:00:00Z',evidence:{source:'protocol_double',transferObservation:{observationId:'duplicate',receivedMonotonicNs:'999'}}} as Report;
 receive!(report);time=20n;receive!(report);const observations=ports.drain().map(r=>r.evidence!.transferObservation as {receivedMonotonicNs:string});
 expect(observations.map(o=>o.receivedMonotonicNs)).toEqual(['10','10']);expect((report.evidence!.transferObservation as {receivedMonotonicNs:string}).receivedMonotonicNs).toBe('999');await ports.close();
});
