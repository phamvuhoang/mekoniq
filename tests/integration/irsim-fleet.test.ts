// C02 G-IR2 / IR04 on the real IR-SIM plant: two robots with their own drives and LiDARs in one world, sharing a reservation zone through the source's
// Zone.Reserve/Release (zone bridge). Every verdict here is recomputed from the stored trace and the journal; nothing reads a controller verdict.
// Skipped, with the reason, where the pinned IR-SIM venv is not provisioned.
import {afterAll,afterEach,beforeAll,expect,test} from 'vitest';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const workers=()=>{try{return execFileSync('pgrep',['-P',String(process.pid)],{encoding:'utf8'}).trim().split('\n').filter(Boolean).filter(p=>{try{return execFileSync('ps',['-o','command=','-p',p],{encoding:'utf8'}).includes('irsim_worker');}catch{return false;}}).map(Number);}catch{return [];}};
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {spawnIRSimWorker} from '../../packages/lab-runtime/src/v2/navigation2d/worker-client';
import {createNavigationController} from '../../packages/lab-runtime/src/v2/navigation2d/controller';
import {readNavigationEvidence} from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import {place,polygonsOverlap,type P,type Pose2} from '../../packages/lab-runtime/src/v2/navigation2d/geometry';
import {resolveScenarioFixture,scenarioAssertions} from '../../packages/lab-runtime/src/v2/navigation2d/scenario-fixtures';
import type {IRSimSnapshotV1,NavigationSceneV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {createZoneBridge,createZoneTraffic} from '../../packages/lab-runtime/src/v2/backends/zone-bridge';
import {SourceSession} from '../../packages/lab-runtime/src/v2/session';
import type {RunReport} from '../../packages/lab-runtime/src/v2/report';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {act,irPython,irsimAvailable,irsimBundle,irsimProviders,removeBundles,schemaDir,temp,workerRoot,EPOCH_MS,tickOf} from '../support/irsim-mission';
import {createIRSimScenarioRun} from '../../packages/lab-runtime/src/v2/navigation2d/runner';

let fleet:Awaited<ReturnType<typeof irsimBundle>>;
const runs:ScenarioRun[]=[],dirs:string[]=[];
beforeAll(async()=>{if(irsimAvailable)fleet=await irsimBundle('fleet');},180_000);
afterAll(removeBundles);
afterEach(async()=>{for(const r of runs.splice(0))await r.close().catch(()=>{});for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const sceneOf=async(b:typeof fleet)=>JSON.parse(Buffer.from(await b.service.bundleFile(b.locked.ref.bundleDigest,'navigation-scene.json')).toString('utf8')) as NavigationSceneV1;
const footprintIn=(scene:NavigationSceneV1,robotId:string,pose:readonly number[],zone:readonly P[])=>polygonsOverlap(place(scene.robots.find(r=>r.robotId===robotId)!.model.footprint.verticesM as P[],...pose as Pose2),zone);
const ZONE:P[]=[[2.6,3.45],[3.4,3.45],[3.4,8.55],[2.6,8.55]];
/** The contention rig's corridor: a band from wall to wall between the two bays, so every way between the west and the east part of the room crosses it. */
const BAND:P[]=[[2.75,0.15],[3,0.15],[3,11.85],[2.75,11.85]];

test.skipIf(!irsimAvailable)('G-IR2 inputs: two robots with different wheels, axles and LiDARs flow into the compiled scene and the IR-SIM world, mapped by robotId',async()=>{
 const scene=await sceneOf(fleet),by=(id:string)=>scene.robots.find(r=>r.robotId===id)!;
 expect(scene.robots.map(r=>r.robotId)).toEqual(['robot01','robot02']);
 expect([by('robot01').model.kinematics.wheelRadiusM,by('robot02').model.kinematics.wheelRadiusM]).toEqual([0.09,0.1]);
 expect([by('robot01').model.kinematics.wheelSeparationM,by('robot02').model.kinematics.wheelSeparationM]).toEqual([0.36,0.42]);
 expect(by('robot01').model.sensors.map(s=>[s.beamCount,s.rangeMaxM])).toEqual([[360,10]]);
 expect(by('robot02').model.sensors.map(s=>[s.beamCount,s.rangeMaxM])).toEqual([[180,8]]);
 expect(by('robot01').model.modelDigest).not.toBe(by('robot02').model.modelDigest);
 // the engine world the worker loads: one entry per robot under its hashed name, each with its own shape, limits and LiDAR (never a shared singleton drive)
 // parsed by the worker's own pinned PyYAML (isolated, no bytecode written)
 const world=JSON.parse(execFileSync(irPython,['-I','-B','-c','import sys,json,yaml;print(json.dumps(yaml.safe_load(sys.stdin)))'],{input:Buffer.from(await fleet.service.bundleFile(fleet.locked.ref.bundleDigest,'irsim/world.yaml'))}).toString()) as {robot:{name:string;shape:{vertices:number[][]};vel_max:number[];sensors:{number:number;range_max:number}[]}[]};
 const names=JSON.parse(Buffer.from(await fleet.service.bundleFile(fleet.locked.ref.bundleDigest,'irsim/name-map.json')).toString('utf8')) as {robots:Record<string,string>};
 for(const id of ['robot01','robot02'])expect(names.robots[id]).toBe(`r_${createHash('sha256').update(id).digest('hex').slice(0,16)}`);
 const entry=(id:string)=>world.robot.find(r=>r.name===names.robots[id])!;
 expect([entry('robot01').sensors[0]!.number,entry('robot02').sensors[0]!.number]).toEqual([360,180]);
 expect([entry('robot01').sensors[0]!.range_max,entry('robot02').sensors[0]!.range_max]).toEqual([10,8]);
 expect(entry('robot01').shape.vertices).toEqual(by('robot01').model.footprint.verticesM);
 expect(entry('robot02').shape.vertices).toEqual(by('robot02').model.footprint.verticesM);
 expect(entry('robot01').shape.vertices).not.toEqual(entry('robot02').shape.vertices);
},120_000);

test.skipIf(!irsimAvailable)('IR04 IR-FD07: both robots deliver within 12,000 ticks; the aisle zone has one granted owner per tick, is entered only under a grant and released only after a whole-footprint exit',async()=>{
 const dir=await temp('irsim-fleet-');dirs.push(dir);
 const run=await createIRSimScenarioRun({project:fleet.locked.runtimeProjection.project,scenarioId:'IR-FD07',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-irsim-2d-v1',sourceCommit:'test-commit',engineering:fleet.locked},await irsimProviders(dir,fleet.service));runs.push(run);
 await run.start();let v=await run.snapshot();
 while(['running','awaiting_confirmation'].includes(v.run.status)&&v.tick<12000)v=await act(run,'step',{ticks:500});
 const r=await run.report() as RunReport,scene=await sceneOf(fleet),fixture=resolveScenarioFixture('IR-FD07',scene,7);
 const read=await readNavigationEvidence(join(dir,'evidence'),{chunks:r.navigation2d!.artifacts,...r.navigation2d!.recording},{scene});
 expect(r.outcome).toMatchObject({status:'completed',served:'2'});expect(r.outcome.tick).toBeLessThanOrEqual(12000);
 expect(read.complete).toBe(true);
 // every scenario oracle, each with expected/actual/oracle
 const oracles=scenarioAssertions({report:r,read,scene,fixture});
 expect(oracles.filter(a=>a.result!=='pass').map(a=>`${a.id}: ${a.actual}`)).toEqual([]);
 expect(oracles.map(a=>a.id)).toEqual(expect.arrayContaining(['ZONE_SINGLE_OWNER','ZONE_RELEASE_AFTER_EXIT','BOTH_ROBOTS_MOVED','ROBOT_MAPPING','MIN_SEPARATION_AVAILABLE','WITHIN_TICKS']));
 for(const a of oracles)expect(a.expected.length*a.actual.length*a.oracle.length,a.id).toBeGreaterThan(0);
 // the same facts recomputed here from the journal and the trace (independent of the oracle module)
 const zoneEvents=r.businessEvents.filter(e=>e.kind==='reservation'&&e.state.zoneId==='aisle-west');
 expect(new Set(zoneEvents.filter(e=>e.type==='ZoneReservationGranted').map(e=>String(e.state.robotId)))).toEqual(new Set(['robot01','robot02']));
 const held=(robotId:string,tick:number)=>{let g=false;for(const e of zoneEvents){if(tickOf(e.at)>=tick)break;if(String(e.state.robotId)===robotId)g=e.state.status==='granted';}return g;};
 let inside=0;
 for(const t of read.trajectory){
  const inZone=t.robots.filter(x=>footprintIn(scene,x.robotId,x.poseDriveMap,ZONE));inside+=inZone.length;
  expect(inZone.length,`tick ${t.tick}`).toBeLessThanOrEqual(1);
  for(const x of inZone)expect(held(x.robotId,t.tick),`${x.robotId} inside at ${t.tick}`).toBe(true);
 }
 expect(inside).toBeGreaterThan(100);
 for(const e of zoneEvents.filter(e=>e.type==='ZoneReservationReleased')){
  const pose=read.trajectory.find(t=>t.tick===tickOf(e.at))!.robots.find(x=>x.robotId===e.state.robotId)!.poseDriveMap;
  expect(footprintIn(scene,String(e.state.robotId),pose,ZONE),`release at ${tickOf(e.at)}`).toBe(false);
 }
 // the source's venue movement boundary serializes movers (domain semantics, unchanged): one robot moves at a time, the other waits granted-pending, never starved
 expect(r.metrics.maxConcurrentMovers).toBe(1);
 expect(r.businessEvents.some(e=>e.type==='ZoneReservationPending'&&e.state.zoneId==='__venue_movement__'&&e.state.robotId==='robot02')).toBe(true);
 for(const id of ['robot01','robot02'])expect(r.metrics.distanceM[id]).toBeGreaterThan(5);
 expect(r.metrics.navigation!.minSeparationM).toBeGreaterThan(0);
},600_000);

/** Headless two-robot rig on the real worker: source session (zone bridge), controller with the fixture's zone, zone traffic, simultaneous goals. */
async function rig(seedDir:string){
 const scene=await sceneOf(fleet),bundle=join(seedDir,'bundle');
 for(const f of ['navigation-scene.json',...scene.files.map(x=>x.path)]){await mkdir(join(bundle,f,'..'),{recursive:true});await writeFile(join(bundle,f),await fleet.service.bundleFile(fleet.locked.ref.bundleDigest,f));}
 let tick=0;await mkdir(join(seedDir,'source'),{recursive:true});
 const source=await SourceSession.open(join(seedDir,'source'),'fleet-rig',()=>EPOCH_MS+tick*20,{epochMs:EPOCH_MS,navigation:{mapId:scene.world.id,mapRevision:scene.sceneDigest,bindings:Object.fromEntries(scene.robots[0]!.targetBindings.map(t=>[t.pointId,{waypointId:t.pointId,mapId:scene.world.id,mapRevision:scene.sceneDigest,frame:'map' as const,x:t.x,y:t.y,yaw:t.yaw}]))},
  project:fleet.locked.runtimeProjection.project,robots:[{id:'robot01',parkingId:'bay-1',trays:3},{id:'robot02',parkingId:'bay-2',trays:3}],stationIds:['pass']},true);
 const zones=[{id:'band',polygonM:BAND,entryPoints:[],exitPoints:[]}],controller=createNavigationController({...scene,zones:structuredClone(zones) as NavigationSceneV1['zones']});
 const entered:string[]=[],traffic=createZoneTraffic(createZoneBridge(source,{async enter(robotId){entered.push(`${robotId}@${tick}`);}}),zones,{clearanceM:scene.policy.parameters.safetyMarginM+2*scene.policy.parameters.gridResolutionM});
 const w=await spawnIRSimWorker({python:irPython,workerRoot,runId:'fleet-rig',bundleRoot:bundle,runDirectory:join(seedDir,'worker'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),schemaDir,sceneDigest:scene.sceneDigest});
 let n=0;
 const ask=async(op:string,payload:Record<string,unknown>)=>{const r=await w.request({protocol:'mekoniq-irsim/1',requestId:`q${++n}`,runId:'fleet-rig',expectedTick:tick,op,payload} as never);if(!r.ok)throw new Error(`${op}: ${JSON.stringify(r.error)}`);tick=r.tick;return r.result as IRSimSnapshotV1;};
 let snap=await ask('create',{sceneRef:'navigation-scene.json',seed:1});await ask('start',{});
 const live=new Set<string>(),trace:IRSimSnapshotV1[]=[snap],decided:{robotId:string;status:string;tick:number;reason:string|null}[]=[];
 return {scene,source,traffic,entered,trace,decided,
  goal(robotId:string,pointId:string){const t=scene.robots.find(r=>r.robotId===robotId)!.targetBindings.find(b=>b.pointId===pointId)!;controller.setGoal({robotId,commandId:`${robotId}-${pointId}`,target:[t.x,t.y,t.yaw]});live.add(robotId);},
  /** One tick: traffic on snapshot t (robots without an observation are left out: no observation, no release), controller, one engine step. */
  async step(observe:(robotId:string)=>boolean=()=>true){
   const owners=await traffic.update(tick,scene.robots.filter(r=>observe(r.robotId)).map(r=>{const o=snap.robots.find(x=>x.robotId===r.robotId)!;return {robotId:r.robotId,footprint:r.model.footprint.verticesM as P[],pose:o.poseDriveMap as Pose2,live:live.has(r.robotId),route:controller.route(r.robotId,o.poseDriveMap as Pose2)};}));
   const out=controller.advance(snap,owners);
   for(const d of out.decisions)if(d.status!=='executing'){live.delete(d.robotId);decided.push({robotId:d.robotId,status:d.status,tick,reason:d.reason});}
   snap=await ask('step',{targetTick:tick+1,velocities:out.velocities,actorUpdates:[]});trace.push(snap);
   return owners;
  },
  live,close:async()=>{await w.close('rig over').catch(()=>{});await source.close();}};
}

test.skipIf(!irsimAvailable)('IR04 contention: opposite goals given at the same tick through one corridor band: the second robot waits outside while pending and enters only after the first released on a whole-footprint exit',async()=>{
 const dir=await temp('irsim-fleet-rig-');dirs.push(dir);
 const x=await rig(dir);
 try{
  // robot01 (west) goes east to T01, robot02 (east) goes west to the pass: both must cross the band; given in reverse id order (mapped by robotId, never by position)
  x.goal('robot02','pass');x.goal('robot01','t-01');
  const owners:Record<string,string|null>[]=[];
  for(let k=0;k<6000&&x.live.size;k++)owners.push(await x.step());
  expect(x.decided.map(d=>[d.robotId,d.status]).sort(),JSON.stringify(x.decided)+JSON.stringify(x.trace.filter(s=>s.tick%200===0).map(s=>[s.tick,s.robots.map(r=>r.poseDriveMap.map(v=>+v.toFixed(2)))]))).toEqual([['robot01','arrived'],['robot02','arrived']]);
  // each robot ends at ITS target (by robotId) in the engine's own snapshot
  const last=x.trace.at(-1)!,target=(id:string,p:string)=>x.scene.robots.find(r=>r.robotId===id)!.targetBindings.find(b=>b.pointId===p)!;
  for(const [id,p] of [['robot01','t-01'],['robot02','pass']] as const){const pose=last.robots.find(r=>r.robotId===id)!.poseDriveMap,t=target(id,p);expect(Math.hypot(pose[0]-t.x,pose[1]-t.y),id).toBeLessThan(0.05);}
  const journal=(await x.source.journal()).flatMap(e=>(e.payload.events as {type:string;data:{kind:string;state:Record<string,unknown>}}[]).filter(v=>v.data.kind==='reservation').map(v=>({type:v.type,robotId:String(v.data.state.robotId),status:String(v.data.state.status),tick:(Date.parse(e.recordedAt)-EPOCH_MS)/20})));
  const g1=journal.find(e=>e.robotId==='robot01'&&e.type==='ZoneReservationGranted')!,p2=journal.find(e=>e.robotId==='robot02'&&e.type==='ZoneReservationPending')!;
  const r1=journal.find(e=>e.robotId==='robot01'&&e.type==='ZoneReservationReleased')!,g2=journal.find(e=>e.robotId==='robot02'&&e.type==='ZoneReservationGranted')!;
  expect([g1.tick,p2.tick]).toEqual([0,0]);                 // both asked before anyone entered: robot01 granted (id order), robot02 queued pending
  expect(g2.tick).toBe(r1.tick);                              // promoted by the release itself, in the same transaction (domain FIFO), not by a TTL
  expect(x.entered).toEqual(['robot01@0',`robot02@${r1.tick}`]);
  // per tick, from the engine snapshots: one robot inside at most; robot02 never inside before its grant; robot01 outside at its release
  const inside=(s:IRSimSnapshotV1,id:string)=>footprintIn(x.scene,id,s.robots.find(r=>r.robotId===id)!.poseDriveMap,BAND);
  for(const s of x.trace){expect(['robot01','robot02'].filter(id=>inside(s,id)).length,`tick ${s.tick}`).toBeLessThanOrEqual(1);if(s.tick<=g2.tick)expect(inside(s,'robot02'),`robot02 at ${s.tick}`).toBe(false);}
  expect(x.trace.some(s=>inside(s,'robot01'))&&x.trace.some(s=>inside(s,'robot02'))).toBe(true);
  expect(inside(x.trace.find(s=>s.tick===r1.tick)!,'robot01')).toBe(false);
  // while pending, robot02 waited outside the boundary (stopped), not parked somewhere else
  const waiting=x.trace.filter(s=>s.tick>50&&s.tick<r1.tick).map(s=>s.robots.find(r=>r.robotId==='robot02')!);
  expect(waiting.length).toBeGreaterThan(50);expect(waiting.every(r=>Math.abs(r.bodyVelocity[0])<=0.011)).toBe(true);
  expect(owners.filter(o=>o.band==='robot01').length).toBeGreaterThan(0);expect(owners.filter(o=>o.band==='robot02').length).toBeGreaterThan(0);
 }finally{await x.close();}
},600_000);

test.skipIf(!irsimAvailable)('IR04 unknown holder: an owner that is no longer observed keeps the zone; the other robot stays pending (ZONE_HELD_UNKNOWN) and outside, past the 60 s TTL, with no release',async()=>{
 const dir=await temp('irsim-fleet-unknown-');dirs.push(dir);
 const x=await rig(dir);
 try{
  x.goal('robot01','t-01');
  let k=0;
  for(;k<3000&&!x.trace.at(-1)!.robots.some(r=>r.robotId==='robot01'&&footprintIn(x.scene,'robot01',r.poseDriveMap,BAND));k++)await x.step();
  expect(k).toBeLessThan(3000); // robot01 is inside the zone under its grant
  // robot01 is lost to the source (stop requested, no acknowledgement): its reservation turns unknown when robot02 asks; robot01 is no longer observed by traffic
  expect((await x.source.submit('Robot.RequestStop',{robotId:'robot01',reason:'link lost'},'stop-1')).status).toBe('accepted');
  x.goal('robot02','pass');
  const start=x.trace.at(-1)!.tick;
  for(let i=0;i<3200;i++)await x.step(id=>id!=='robot01');      // 64 s of sim time > the 60 s reservation TTL
  const snaps=await x.source.store.snapshots(x.source.scope),res=(id:string)=>snaps.find(s=>s.ref.kind==='reservation'&&s.ref.id===`band@${id}`)!.state;
  expect(res('robot01').status).toBe('unknown');
  expect(res('robot02')).toMatchObject({status:'pending',reason:'ZONE_HELD_UNKNOWN'});
  expect(x.trace.filter(s=>s.tick>start).some(s=>footprintIn(x.scene,'robot02',s.robots.find(r=>r.robotId==='robot02')!.poseDriveMap,BAND))).toBe(false);
  expect(x.entered).toEqual(['robot01@0']);
  expect(x.traffic.owners().band).toBe('robot01');
 }finally{await x.close();}
},600_000);

// ---- C02 fix pass F2: the domain's TTL lapse of an idle holder must never move a zone our traffic holds ----
async function sessionOnly(dir:string){
 const scene=await sceneOf(fleet);let tick=0;await mkdir(join(dir,'source'),{recursive:true});
 const source=await SourceSession.open(join(dir,'source'),'lapse',()=>EPOCH_MS+tick*20,{epochMs:EPOCH_MS,navigation:{mapId:scene.world.id,mapRevision:scene.sceneDigest,bindings:Object.fromEntries(scene.robots[0]!.targetBindings.map(t=>[t.pointId,{waypointId:t.pointId,mapId:scene.world.id,mapRevision:scene.sceneDigest,frame:'map' as const,x:t.x,y:t.y,yaw:t.yaw}]))},
  project:fleet.locked.runtimeProjection.project,robots:[{id:'robot01',parkingId:'bay-1',trays:3},{id:'robot02',parkingId:'bay-2',trays:3}],stationIds:['pass']},true);
 const fp=(id:string)=>scene.robots.find(r=>r.robotId===id)!.model.footprint.verticesM as P[];
 // robot01 stands INSIDE the band; robot02 wants to cross it
 const r1=(live:boolean)=>({robotId:'robot01',footprint:fp('robot01'),pose:[2.875,6,0] as Pose2,live,route:live?[[2.875,6],[1,6]] as P[]:null});
 const r2={robotId:'robot02',footprint:fp('robot02'),pose:[6,6,Math.PI] as Pose2,live:true,route:[[6,6],[1,6]] as P[]};
 return {source,r1,r2,setTick:(t:number)=>{tick=t;},state:async(id:string)=>(await source.store.snapshots(source.scope)).find(s=>s.ref.kind==='reservation'&&s.ref.id===id)?.state};
}
test.skipIf(!irsimAvailable)('F2 lapse: an owner whose leg ended inside the zone keeps it past the 60 s TTL (renewed through Zone.Reserve), the other robot stays pending, and one stranded notice is raised',async()=>{
 const dir=await temp('irsim-lapse-');dirs.push(dir);const x=await sessionOnly(dir);
 try{
  const traffic=createZoneTraffic(createZoneBridge(x.source,{async enter(){}}),[{id:'band',polygonM:BAND}],{clearanceM:0.1});
  expect((await traffic.update(0,[x.r1(true)])).band).toBe('robot01');
  const notices=[];
  for(let t=1;t<=3600;t++){x.setTick(t);const o=await traffic.update(t,[x.r1(false),x.r2]);notices.push(...traffic.notices());expect(o.band,`tick ${t}`).toBe('robot01');}
  expect(await x.state('band@robot01')).toMatchObject({status:'granted'});
  expect(await x.state('band@robot02')).toMatchObject({status:'pending'});
  expect(notices).toEqual([{kind:'stranded',zoneId:'band',robotId:'robot01',tick:1}]);
 }finally{await x.source.close();}
},120_000);
test.skipIf(!irsimAvailable)('F2 refusal: if the domain ever grants the zone to another robot while traffic holds it (renewal off here), traffic keeps its owner, never lets the other in, and raises a conflict once',async()=>{
 const dir=await temp('irsim-conflict-');dirs.push(dir);const x=await sessionOnly(dir);
 try{
  const traffic=createZoneTraffic(createZoneBridge(x.source,{async enter(){}}),[{id:'band',polygonM:BAND}],{clearanceM:0.1,renewEveryTicks:Infinity});
  await traffic.update(0,[x.r1(true)]);
  const notices=[];
  for(let t=1;t<=3300;t++){x.setTick(t);const o=await traffic.update(t,[x.r1(false),x.r2]);notices.push(...traffic.notices());expect(o.band,`tick ${t}`).toBe('robot01');}
  // the domain did lapse robot01 (TTL, idle holder) and granted robot02: that is exactly the contradiction traffic must not act on
  expect(await x.state('band@robot01')).toMatchObject({status:'released',releaseReason:'ttl_lapsed'});
  expect(await x.state('band@robot02')).toMatchObject({status:'granted'});
  expect(notices.filter(n=>n.kind==='conflict')).toEqual([{kind:'conflict',zoneId:'band',robotId:'robot02',owner:'robot01',tick:expect.any(Number)}]);
 }finally{await x.source.close();}
},120_000);
test.skipIf(!irsimAvailable)('F2 plant lost while a robot holds the aisle zone: the run needs attention with ZONE_HELD_UNKNOWN; the reservation is not released',async()=>{
 const dir=await temp('irsim-fleet-lost-');dirs.push(dir);
 const run=await createIRSimScenarioRun({project:fleet.locked.runtimeProjection.project,scenarioId:'IR-FD07',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-irsim-2d-v1',sourceCommit:'test-commit',engineering:fleet.locked},await irsimProviders(dir,fleet.service));runs.push(run);
 const before=workers();await run.start();
 let v=await run.snapshot();
 // step until robot01's footprint is inside aisle-west (from the live entities, base pose ~ drive pose for the Serve)
 while(v.tick<6000&&!(await run.report()).businessEvents.some(e=>e.kind==='reservation'&&e.state.zoneId==='aisle-west'&&e.state.status==='granted'))v=await act(run,'step',{ticks:25});
 v=await act(run,'step',{ticks:150});
 const live=workers().filter(p=>!before.includes(p));expect(live).toHaveLength(1);process.kill(live[0]!,'SIGKILL');
 v=await act(run,'step',{ticks:5});
 const r=await run.report();
 expect(v.run.status).toBe('needs_attention');
 expect(r.attention.filter(a=>a.reason==='ZONE_HELD_UNKNOWN').map(a=>a.subjectId)).toEqual(['aisle-west']);
 const last=r.businessEvents.filter(e=>e.kind==='reservation'&&e.state.zoneId==='aisle-west').at(-1)!;
 expect(last.state.status).toBe('granted');
},600_000);
