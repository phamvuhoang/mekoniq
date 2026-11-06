import {afterEach,expect,test} from 'vitest';
import {act,amrRef,cleanupRuns,coffeeProject,openCoffee,stepUntil} from '../support/lab-v2';
import {reportKpis} from '../../packages/lab-runtime/src/v2/comparison';
afterEach(cleanupRuns);
const project=()=>{
 const p=coffeeProject();return {...p,entities:[...p.entities,{id:'amr-2',kind:'amr',assetRef:amrRef}],world:{...p.world,width:10,height:6,points:[...p.world.points.map(x=>x.kind==='table'?{...x,x:8.5,y:1.5}:x),{id:'parking-2',name:'Parking 2',kind:'parking',x:0.8,y:5},{id:'kitchen',name:'Kitchen',kind:'kitchen',x:1,y:3},{id:'table-2',name:'T02',kind:'table',x:8.5,y:4.5}],obstacles:[{id:'wall-south',x:4.5,y:0,width:1,height:2.5},{id:'wall-north',x:4.5,y:3.5,width:1,height:2.5}]}};
};

test('FD02-cups carries food and its identified coffee cup on one mission, then serves each allocation once',async()=>{
 const run=await openCoffee('FD02-cups',{seed:42,project:project(),scenarioRevision:1});
 try{
  await run.start();await stepUntil(run,v=>v.run.status==='needs_attention'||v.coffee!.cups.some(c=>c.ownerKind==='robot'),25);
  const loaded=await run.report(),cargo=loaded.businessEvents.filter(e=>e.type==='CargoLoaded');
  expect(loaded.coverage.armSceneCollision).toBe(true);expect(loaded.coffee!.armTrace.collision!.evidence!.firstFailure).toBeUndefined();
  expect(loaded.manifest.armCollisionScene!.robotGeometry).toContainEqual(expect.objectContaining({id:'amr-2',motion:'static_parked',parkingId:'parking-2',parkedPose:{x:0.8,y:5,yawRad:0}}));
  expect(cargo,JSON.stringify(loaded.attention)).toHaveLength(2);expect(new Set(cargo.map(e=>e.state.missionId)).size).toBe(1);
  const mission=cargo[0]!.state.missionId;expect(loaded.workload[0]!.missionId).toBe(mission);expect(loaded.coffee!.cups[0]!.ownerId).toBe('amr-1');
  await stepUntil(run,undefined,500);const r=await run.report();expect(r.outcome).toMatchObject({status:'completed',served:'2'});
  expect(r.businessEvents.filter(e=>e.type==='DeliveryHandedOff')).toHaveLength(2);expect(r.coffee!.cups[0]).toMatchObject({ownerKind:'customer',ownerId:'table-1'});
 }finally{await run.close();}
});

test('the versioned food, corridor and coffee campaign executes both AMRs and queues the second coffee job without sharing a cup',async()=>{
 const run=await openCoffee('CAMPAIGN-FD02-FD07-BV01-BV03',{seed:3,project:project(),scenarioRevision:1});
 try{
  await run.start();await stepUntil(run,undefined,500,30000);const r=await run.report();
  expect(r.outcome,JSON.stringify(r.attention)).toMatchObject({status:'completed',served:'4'});expect(r.manifest.scenario).toMatchObject({revision:1,hash:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(new Set(r.businessEvents.filter(e=>e.type==='RobotGoalCompleted').map(e=>e.id))).toEqual(new Set(['amr-1','amr-2']));
  expect(r.coffee!.cups).toHaveLength(2);expect(new Set(r.coffee!.cups.map(c=>c.cupId)).size).toBe(2);
  expect(r.coffee!.jobs.map(j=>j.status)).toEqual(['delivered','delivered']);expect(r.businessEvents.some(e=>e.type==='ZoneReservationPending')).toBe(true);
  const metrics=reportKpis(r);
  for(const id of ['coffeeQueueWaitS','travelTimeS','humanWaitS','cellProcessBusyS']){
   const metric=metrics.find(k=>k.id===id)!;expect(metric,id).toMatchObject({available:true,unit:'s'});expect(metric.samples,id).toBeGreaterThan(0);expect(metric.value,id).toBeGreaterThan(0);
  }
 }finally{await run.close();}
},90000);

test('cancelling a mixed mission after both loads retains the cup on its robot until the return confirmation',async()=>{
 const run=await openCoffee('FD02-cups',{seed:42,project:project(),scenarioRevision:1});
 try{
  await run.start();await stepUntil(run,v=>v.run.status==='needs_attention'||v.coffee!.jobs.some(j=>j.status==='loaded'),25);
  await act(run,'cancel');let r=await run.report();expect(r.coffee!.jobs[0]!.status).toBe('returning');expect(r.coffee!.cups[0]!.ownerKind).toBe('robot');expect(r.outcome.served).toBe('0');
  await stepUntil(run,v=>v.run.status==='needs_attention'||v.awaiting.some(a=>a.confirmationType==='return'),25);
  r=await run.report();expect(r.coffee!.cups[0]!.ownerKind).toBe('robot');expect(r.businessEvents.map(e=>e.type)).not.toContain('DeliveryHandedOff');
 }finally{await run.close();}
});
