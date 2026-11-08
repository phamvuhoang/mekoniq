// IR-FD01 through the real source domain on the real IR-SIM plant: navigation only ends movement legs; the domain owns load, handoff and served.
// Skipped, with the reason, where the pinned IR-SIM venv is not provisioned.
import {afterAll,afterEach,beforeAll,expect,test} from 'vitest';
import {rm} from 'node:fs/promises';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {act,double,irsimAvailable,irsimBundle,openRun,stepUntil,temp,tickOf,workerLog} from '../support/irsim-mission';

let bundle:Awaited<ReturnType<typeof irsimBundle>>;
const runs:ScenarioRun[]=[],dirs:string[]=[];
beforeAll(async()=>{if(irsimAvailable)bundle=await irsimBundle();},120_000);
afterEach(async()=>{for(const r of runs.splice(0))await r.close().catch(()=>{});for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
afterAll(async()=>{});
async function open(over:Parameters<typeof openRun>[2]={}){const dir=await temp('irsim-mission-');dirs.push(dir);const run=await openRun(dir,bundle,over);runs.push(run);return {run,dir};}
const events=async(run:ScenarioRun)=>(await run.report()).businessEvents;

test.skipIf(!irsimAvailable)('GATE (a) IR-FD01: arriving at the table does not serve the order; served only after the scripted handoff, then the robot parks',async()=>{
 const {run}=await open();
 await run.start();
 let window=0;
 const done=await stepUntil(run,async v=>{
  const r=await run.report(),atTable=r.businessEvents.some(e=>e.type==='RobotGoalCompleted'&&e.state.position==='t-01'),handed=r.businessEvents.some(e=>e.type==='DeliveryHandedOff');
  if(atTable&&!handed){
   expect(r.manifest.backends.map(b=>b.id)).toEqual(['irsim_2d']);
   expect(r.outcome.served).toBe('0'); // before the scripted handoff action
   expect(r.businessEvents.some(e=>e.type==='DeliveryHandedOff')).toBe(false);
   window++;
  }
  return v.run.status==='completed';
 });
 expect(window).toBeGreaterThan(0);
 const r=await run.report();
 expect(r.outcome).toMatchObject({status:'completed',served:'1'});
 expect(r.manifest).toMatchObject({mode:'simulation',access:'simulated',backendSetId:'engineering-irsim-2d-v1',scenario:{id:'IR-FD01',revision:1,basedOn:{id:'FD01',revision:1}},clock:{tickMs:20,businessEpochMs:Date.parse('2026-11-01T00:00:00Z')}});
 const types=r.businessEvents.map(e=>e.type),handoff=types.indexOf('DeliveryHandedOff');
 expect(types.indexOf('CargoLoaded')).toBeGreaterThan(-1);
 expect(types.indexOf('CargoLoaded')).toBeLessThan(handoff);
 // three observed legs (pass, table, parking), each ended by a plant completion; the handoff is a scripted staff confirmation, not the arrival
 expect(r.businessEvents.filter(e=>e.type==='RobotGoalCompleted').map(e=>e.state.position)).toEqual(['pass','t-01','bay-1']);
 expect(r.confirmations.map(c=>[c.confirmationType,c.provenance])).toEqual([['load','scripted'],['handoff','scripted']]);
 const robot=r.businessEvents.filter(e=>e.kind==='robot').at(-1)!.state;
 expect(robot).toMatchObject({position:'bay-1',availability:'idle'});
 expect(r.entities[0]!.pose.x).toBeCloseTo(2,1);expect(r.entities[0]!.pose.y).toBeCloseTo(1.5,1);
 expect(done.tick).toBeLessThanOrEqual(30000);
 expect(r.limitations.join(' ')).toMatch(/irsim_2d/);
 expect(r.coverage).toMatchObject({nativeExecution:false,physicalStop:false});
},240_000);

test.skipIf(!irsimAvailable)('GATE (b) IR-FD01: cancel completes only after a stopped observation, never on the request alone',async()=>{
 const {run,dir}=await open({entry:[double('logged.py')]});
 await run.start();
 // moving on the first leg at speed: the last reported body velocity is well above the stopped threshold
 const moving=await stepUntil(run,()=>{const last=workerLog(dir).filter(l=>l.op==='step').at(-1);return !!last&&Math.abs(last.robots[0]!.bodyVelocity[0]!)>0.2;},10);
 const commandId=moving.entities[0]!.goal!.commandId;
 const cancelTick=moving.tick;
 const after=await act(run,'cancel');
 expect(after.tick).toBe(cancelTick);
 const observed=async()=>(await events(run)).filter(e=>e.type==='RobotCommandObserved'&&e.id===commandId).map(e=>({status:String(e.state.status),tick:tickOf(e.at)}));
 expect((await observed()).map(o=>o.status)).not.toContain('cancelled');
 let cancelled:{status:string;tick:number}|undefined;
 for(let i=0;i<300&&!cancelled;i++){await act(run,'step',{ticks:1});cancelled=(await observed()).find(o=>o.status==='cancelled');}
 expect(cancelled).toBeDefined();
 const steps=workerLog(dir).filter(l=>l.op==='step');
 const at=steps.find(l=>l.tick===cancelled!.tick)!;
 // the observation it was emitted on shows the robot stopped; between the request and that tick the plant still reported motion
 expect(Math.abs(at.robots[0]!.bodyVelocity[0]!)).toBeLessThanOrEqual(0.01);
 expect(Math.abs(at.robots[0]!.bodyVelocity[1]!)).toBeLessThanOrEqual(0.02);
 expect(steps.some(l=>l.tick>cancelTick&&l.tick<cancelled!.tick&&Math.abs(l.robots[0]!.bodyVelocity[0]!)>0.05)).toBe(true);
 expect(cancelled!.tick).toBeGreaterThan(cancelTick+1);
 // the cancel request itself was an ACK of the request, not of the stop
 const r=await run.report();
 expect(r.effects.find(e=>e.type==='robot.cancel')).toMatchObject({status:'confirmed'});
 expect(r.outcome.served).toBe('0');
 const v=await stepUntil(run,x=>x.run.status==='cancelled',25,cancelled!.tick+500);
 expect(v.run.status).toBe('cancelled');
},240_000);

test('adapter admission: exact duplicates keep the first receipt; conflicts, stale epochs/revisions, foreign maps/robots and expired commands are refused; terminal goals never revive',async()=>{
 const {createIRSimNavigationAdapter}=await import('../../packages/lab-runtime/src/v2/navigation2d/adapter');
 const {navigationScene}=await import('../support/navigation2d');
 const scene=navigationScene('serve'),calls:string[]=[];
 const controller={setGoal:(g:{commandId:string})=>{calls.push(`goal:${g.commandId}`);},cancel:(_r:string,c:string)=>{calls.push(`cancel:${c}`);},advance:()=>({velocities:[],decisions:[]})};
 let now=Date.parse('2026-11-01T00:00:10Z');
 const a=createIRSimNavigationAdapter({robotId:'amr-1',scene,controller,now:()=>now}),events:{type:string;commandId:string;reason?:unknown}[]=[];
 a.observe(e=>events.push({type:e.type,commandId:e.commandId,reason:e.payload.reason}));
 const manifest=await a.describe();
 const cmd=(over:Record<string,unknown>={})=>({schemaVersion:1,commandId:'c1',operationId:'op',organizationId:'o',venueId:'v',robotId:'amr-1',missionId:'m1',stopId:'s1',missionRevision:2,controlEpoch:3,issuerDeviceId:'d',issuedAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-01T00:01:00Z',
  target:{waypointId:'pass',mapId:manifest.mapId,mapRevision:manifest.mapRevision,frame:'map',x:1.9,y:6,yaw:Math.PI},limits:{trays:1,maxLoadMinor:'0'},...over}) as never;
 const first=await a.execute(cmd());
 expect(first).toEqual({accepted:true,nativeGoalId:'c1',unknown:false});
 expect(await a.execute(cmd())).toEqual(first);
 await expect(a.execute(cmd({stopId:'other'}))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 expect(calls).toEqual(['goal:c1']);
 const target=(over:Record<string,unknown>)=>({waypointId:'pass',mapId:manifest.mapId,mapRevision:manifest.mapRevision,frame:'map',x:1.9,y:6,yaw:0,...over});
 const refused=async(over:Record<string,unknown>)=>(await a.execute(cmd({commandId:`c-${JSON.stringify(over).length}-${calls.length}-${events.length}-${Math.random()}`,...over}))).reason;
 expect(await refused({controlEpoch:2})).toBe('STALE_CONTROL_EPOCH');
 expect(await refused({missionRevision:1})).toBe('STALE_MISSION_REVISION');
 expect(await refused({target:target({mapRevision:'0'.repeat(64)})})).toBe('MAP_MISMATCH');
 expect(await refused({robotId:'amr-2'})).toBe('ROBOT_MISMATCH');
 expect(await refused({expiresAt:'2026-11-01T00:00:10Z'})).toBe('EXPIRED_COMMAND');
 expect(await refused({target:target({x:Number.NaN})})).toBe('INVALID_TARGET');
 expect(await refused({})).toBe('GOAL_ACTIVE');
 expect(calls).toEqual(['goal:c1']); // nothing refused ever reached the controller
 // arrival completes the leg once; a late, repeated or reordered decision changes nothing
 a.sink.decide({robotId:'amr-1',commandId:'c1',status:'arrived',reason:null});
 a.sink.decide({robotId:'amr-1',commandId:'c1',status:'arrived',reason:null});
 a.sink.decide({robotId:'amr-1',commandId:'c1',status:'blocked',reason:'NO_PROGRESS'});
 a.sink.lost('WORKER_LOST');
 expect(events.filter(e=>e.commandId==='c1').map(e=>e.type)).toEqual(['accepted','completed']);
 expect((await a.reconcile('c1')).status).toBe('completed');
 expect(await a.cancel('c1')).toEqual({acknowledged:false,unknown:false});
 expect(await a.requestStop('test')).toEqual({acknowledged:true,physicalStopConfirmed:false});
 // a lost plant refuses new goals
 now+=1000;expect((await a.execute(cmd({commandId:'c9',missionRevision:3}))).reason).toBe('PLANT_LOST');
});

test('adapter cancel: requested, then cancelled only on a stopped observation; a lost plant while cancelling is unknown; stale snapshots are ignored',async()=>{
 const {createIRSimNavigationAdapter}=await import('../../packages/lab-runtime/src/v2/navigation2d/adapter');
 const {navigationScene}=await import('../support/navigation2d');
 const scene=navigationScene('serve'),controller={setGoal:()=>{},cancel:()=>{},advance:()=>({velocities:[],decisions:[]})};
 const make=()=>{const a=createIRSimNavigationAdapter({robotId:'amr-1',scene,controller,now:()=>Date.parse('2026-11-01T00:00:10Z')}),ev:string[]=[];a.observe(e=>ev.push(e.type));return {a,ev};};
 const snap=(tick:number,v:number)=>({schemaVersion:1,runId:'r',bootId:'b',tick,simTimeNs:String(tick*20_000_000),seq:String(tick),sceneDigest:scene.sceneDigest,robots:[{robotId:'amr-1',poseDriveMap:[2,1.5,0],bodyVelocity:[v,0],scans:[],collisionIds:[]}]}) as never;
 const {a,ev}=make(),m=await a.describe();
 const cmd={schemaVersion:1,commandId:'c1',operationId:'op',organizationId:'o',venueId:'v',robotId:'amr-1',missionId:'m1',stopId:'s1',missionRevision:1,controlEpoch:1,issuerDeviceId:'d',issuedAt:'2026-11-01T00:00:00Z',expiresAt:'2026-11-01T00:01:00Z',target:{waypointId:'pass',mapId:m.mapId,mapRevision:m.mapRevision,frame:'map',x:1.9,y:6,yaw:0},limits:{trays:1,maxLoadMinor:'0'}} as never;
 await a.execute(cmd);
 expect(await a.cancel('c1')).toEqual({acknowledged:true,unknown:false});
 a.sink.decide({robotId:'amr-1',commandId:'c1',status:'cancelled',reason:null}); // the controller dropping its goal is not a stop
 a.sink.observe(snap(10,0.3));
 expect(ev).toEqual(['accepted']);
 a.sink.observe(snap(11,0));a.sink.observe(snap(11,0));
 expect(ev).toEqual(['accepted','cancelled']);
 a.sink.observe(snap(12,0));a.sink.lost('WORKER_LOST');
 expect(ev).toEqual(['accepted','cancelled']);
 const b=make();await b.a.execute(cmd);await b.a.cancel('c1');
 b.a.sink.observe(snap(5,0.4));b.a.sink.observe(snap(4,0)); // older snapshot: ignored, not a stop
 b.a.sink.lost('WORKER_LOST'); // the stop was never observed
 expect(b.ev).toEqual(['accepted','unknown']);
 expect((await b.a.reconcile('c1')).status).toBe('unknown');
});
