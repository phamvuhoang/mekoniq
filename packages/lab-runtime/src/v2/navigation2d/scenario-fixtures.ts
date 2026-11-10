// Server-owned IR-SIM scenario fixtures (C02): the fixture projects a campaign may compile, and per IR-* scenario the scripted actors (immutable schedules) and the
// reservation zones laid over the compiled scene. Nothing here comes from a request: a browser or campaign names a fixture/scenario id, never a path, module or schedule.
// The scenario oracles below decide pass/fail from the run's inputs, its durable trace and its journal only; they never read a controller verdict.
import {hashJson} from '../hash';
import {TICK_MS} from '../clock';
import {actorStream} from '../random';
import type {RunReport} from '../report';
import type {ScenarioDefinition} from '../scenario-registry';
import type {NavigationSceneV1} from './contracts';
import type {EvidenceRead} from './evidence';
import {place,pointDistance,polygonDistance,polygonsOverlap,isConvex,type P,type Pose2} from './geometry';

/** Fixture projects under robotics/navigation-2d/fixtures/serve-demo-v1 (one shared component catalog). `robots` is what the scene must contain. */
export interface NavigationFixture{project:string;robots:readonly string[];/** absent = the IR-SIM plant; the Webots 3D fixtures live under robotics/simulation-3d/fixtures/serve-3d-v1 */provider?:'webots_3d'}
export const NAVIGATION_FIXTURES:Readonly<Record<string,NavigationFixture>>=Object.freeze({
 'serve-demo-v1':Object.freeze({project:'serve-project.json',robots:Object.freeze(['amr-1'])}),
 'serve-fleet-v1':Object.freeze({project:'serve-fleet-project.json',robots:Object.freeze(['robot01','robot02'])}),
 'serve-enclosed-v1':Object.freeze({project:'serve-enclosed-project.json',robots:Object.freeze(['amr-1'])}),
 'serve-noisy-v1':Object.freeze({project:'serve-noisy-project.json',robots:Object.freeze(['amr-1'])}),
 'serve-3d-v1':Object.freeze({project:'serve-3d-project.json',robots:Object.freeze(['amr-1']),provider:'webots_3d' as const}),
 'serve-3d-fleet-v1':Object.freeze({project:'serve-3d-fleet-project.json',robots:Object.freeze(['robot01','robot02']),provider:'webots_3d' as const}),
});
export const FIXTURE_DIRECTORY='fixtures/serve-demo-v1',FIXTURE_COMPONENTS='serve-components.json';
/** The Webots 3D fixture directory (relative to the source root) and its component catalog. */
export const FIXTURE_3D_DIRECTORY='robotics/simulation-3d/fixtures/serve-3d-v1',FIXTURE_3D_COMPONENTS='serve-3d-components.json';

/** A scripted person: stands at path[0] until its start tick (drawn once from its own PRNG stream in [a, b]), then walks the polyline at speedMps and stays at the end. */
export interface ActorSpec{id:string;radiusM:number;startTick:readonly [number,number];speedMps:number;path:readonly (readonly [number,number])[]}
export interface ZoneSpec{id:string;polygonM:readonly (readonly [number,number])[];entryPoints:readonly (readonly [number,number])[];exitPoints:readonly (readonly [number,number])[]}
/**
 * A campaign case. `scenarioId` is the case id a campaign names; `runs` the scenario definition it executes (default: the same id; a rig definition from RIG_SCENARIOS
 * or a registry scenario). `oracles` are the assertions a run of this case is judged by (a campaign's expectedAssertions must be among them).
 * kind: scenario (a registry scenario as the gateway would run it) | contention_rig (campaign-only, goals given to the controller directly, no missions: bypasses the
 * venue-movement serialization; labelled in every report) | operator_fault (a registry scenario plus a scripted operator act: cancel, worker kill) | raw_drive
 * (controller bypassed, test-only velocities straight to the worker: never admitted by the gateway). `label` is the honest one-liner shown with every result.
 */
export interface ScenarioFixtureSpec{scenarioId:string;runs?:string;kind?:'scenario'|'contention_rig'|'operator_fault'|'raw_drive';label:string;
 operator?:{cancelWhenMoving?:true;killWorkerOnTableLeg?:true;killEngineOnTableLeg?:true};expectOutcome?:{status:string;served:string;reasons?:readonly string[]};evidence?:'complete'|'step_ack_lost';
 raw?:{ticks:number;velocities:readonly {robotId:string;vMps:number;omegaRadps:number}[]};
 fixtures:readonly string[];worldId:string;actors:readonly ActorSpec[];zones:readonly ZoneSpec[];oracles:readonly string[]}
const COMMON=['EVIDENCE_COMPLETE','IDENTITY_BOUND','NO_SERVED_BEFORE_HANDOFF'];
const deepFreeze=<T>(v:T):T=>{if(v&&typeof v==='object'){for(const x of Object.values(v))deepFreeze(x);Object.freeze(v);}return v;};
// All coordinates are the restaurant-10-tables fixture world (20 x 12 m; tables at x 4/7/10/13/16, rows y 3 and 9; aisle between y 3.4 and 8.6; kitchen pass handoff at 1.9, 6).
const SPECS:ScenarioFixtureSpec[]=[
 {scenarioId:'IR-FD01',label:'IR01: one order, one robot, kitchen -> table -> parking',fixtures:['serve-demo-v1','serve-noisy-v1'],worldId:'restaurant-10-tables',actors:[],zones:[],oracles:[...COMMON,'BUSINESS_OUTCOME','NO_PHYSICAL_CONTACT']},
 // IR02: a person (r 0.25 m, 0.5 m/s) crosses the bay -> kitchen lane at y 3.2 from tick 100, while the robot drives up it
 {scenarioId:'IR-FD03',label:'IR02: a person crosses the bay -> kitchen lane while the robot drives up it; the robot must see it, yield and resume',fixtures:['serve-demo-v1'],worldId:'restaurant-10-tables',actors:[{id:'person-1',radiusM:0.25,startTick:[100,100],speedMps:0.5,path:[[0.45,3.2],[3.2,3.2],[3.2,0.45]]}],zones:[],
  oracles:[...COMMON,'BUSINESS_OUTCOME','NO_PHYSICAL_CONTACT','ACTOR_SCHEDULE_APPLIED','ACTOR_OBSERVED','NO_ACTOR_CONTACT','ACTOR_YIELD']},
 // IR03: table T01's handoff is walled in (serve-enclosed-v1): admitted, then no_path before the robot drives; nothing served
 {scenarioId:'IR-FD04',label:'IR03: the T01 handoff is walled in: no_path before driving',fixtures:['serve-enclosed-v1'],worldId:'restaurant-10-tables',actors:[],zones:[],oracles:[...COMMON,'BUSINESS_OUTCOME','NO_PATH_NOT_BLOCKED','NO_PHYSICAL_CONTACT']},
 // IR03 blocked: a person stands on table T01's handoff for the whole run: a dynamic obstacle that never leaves -> blocked after the no-progress window, never no_path
 {scenarioId:'IR-FD04-blocked',label:'IR03: a person stands on the T01 handoff: blocked after the no-progress window',fixtures:['serve-demo-v1'],worldId:'restaurant-10-tables',actors:[{id:'person-1',radiusM:0.25,startTick:[0,0],speedMps:0.5,path:[[4,4.05]]}],zones:[],
  oracles:[...COMMON,'BUSINESS_OUTCOME','BLOCKED_NOT_NO_PATH','ACTOR_SCHEDULE_APPLIED','ACTOR_OBSERVED','NO_ACTOR_CONTACT']},
 // IR-FD07: two robots through the SOURCE (missions): the venue-movement reservation serializes them, so the aisle zone is reserved and released per leg but never
 // contended here, and the customer walks at x 5.5, away from both routes (schedule applied, no contact; not an avoidance test). Contention is the rig below.
 {scenarioId:'IR-FD07',label:'IR-FD07 (source-driven): two robots serialized by the venue-movement reservation; aisle zone reserved/released per leg, never contended; customer away from the routes',fixtures:['serve-fleet-v1'],worldId:'restaurant-10-tables',actors:[{id:'customer-1',radiusM:0.25,startTick:[600,600],speedMps:0.5,path:[[5.5,1.0],[5.5,11.0]]}],
  zones:[{id:'aisle-west',polygonM:[[2.6,3.45],[3.4,3.45],[3.4,8.55],[2.6,8.55]],entryPoints:[[2.3,6]],exitPoints:[[3.7,6]]}],
  oracles:[...COMMON,'BUSINESS_OUTCOME','NO_PHYSICAL_CONTACT','ACTOR_SCHEDULE_APPLIED','NO_ACTOR_CONTACT','BOTH_ROBOTS_MOVED','ROBOT_MAPPING','ZONE_SINGLE_OWNER','ZONE_RELEASE_AFTER_EXIT','MIN_SEPARATION_AVAILABLE','WITHIN_TICKS']},
 // Webots 3D variants: the IR-FD01 / IR-FD07 oracles on the rigid-body plant. Its worker takes no scripted actors, so WB-FD07 has the aisle zone but no walking customer.
 {scenarioId:'WB-FD01',label:'WB03: one order, one robot, kitchen -> table -> parking on the Webots 3D plant',fixtures:['serve-3d-v1'],worldId:'restaurant-10-tables',actors:[],zones:[],oracles:[...COMMON,'BUSINESS_OUTCOME','NO_PHYSICAL_CONTACT']},
 {scenarioId:'WB-FD07',label:'WB04 (source-driven): missions the source orchestrates are serialised by the __venue_movement__ reservation on the Webots 3D plant; the aisle zone is reserved/released per leg and never contended; there is no contention rig for Webots in this release',fixtures:['serve-3d-fleet-v1'],worldId:'restaurant-10-tables',actors:[],
  zones:[{id:'aisle-west',polygonM:[[2.6,3.45],[3.4,3.45],[3.4,8.55],[2.6,8.55]],entryPoints:[[2.3,6]],exitPoints:[[3.7,6]]}],
  oracles:[...COMMON,'BUSINESS_OUTCOME','NO_PHYSICAL_CONTACT','BOTH_ROBOTS_MOVED','ROBOT_MAPPING','ZONE_SINGLE_OWNER','ZONE_RELEASE_AFTER_EXIT','MIN_SEPARATION_AVAILABLE','WITHIN_TICKS']},
 {scenarioId:'WB-FD01-cancel',runs:'WB-FD01',kind:'operator_fault',label:'WB05: operator cancel mid-route on the kitchen leg; cancelled, nothing served, bounded simulated stop',operator:{cancelWhenMoving:true},expectOutcome:{status:'cancelled',served:'0'},
  fixtures:['serve-3d-v1'],worldId:'restaurant-10-tables',actors:[],zones:[],oracles:[...COMMON,'BUSINESS_OUTCOME','NO_PHYSICAL_CONTACT','CANCEL_BOUNDED_STOP','ONE_TERMINAL_PER_MISSION']},
 {scenarioId:'WB-FD01-enginekill',runs:'WB-FD01',kind:'operator_fault',label:'WB05: the Webots process is killed between steps on the table leg; leg unknown, no resend, no second engine, cargo kept, the unknown tick a recorded gap',operator:{killEngineOnTableLeg:true},
  expectOutcome:{status:'needs_attention',served:'0',reasons:['WORKER_LOST','EXECUTION_UNKNOWN']},evidence:'step_ack_lost',fixtures:['serve-3d-v1'],worldId:'restaurant-10-tables',actors:[],zones:[],oracles:['IDENTITY_BOUND','NO_SERVED_BEFORE_HANDOFF','BUSINESS_OUTCOME','EVIDENCE_GAP_AS_DECLARED','CARGO_KEPT','NO_SECOND_WORKER']},
 // IR04 contention rig: robot01 (west) -> T01 and robot02 (east) -> kitchen pass at tick 0 through one band zone from wall to wall; both move at once
 {scenarioId:'IR-RIG-ZONE',kind:'contention_rig',label:'CONTENTION RIG (not a production scenario): goals given to the controller directly, no missions, so the venue-movement serialization is bypassed; proves zone contention on the real plant',
  fixtures:['serve-fleet-v1'],worldId:'restaurant-10-tables',actors:[],zones:[{id:'band',polygonM:[[2.75,0.15],[3,0.15],[3,11.85],[2.75,11.85]],entryPoints:[],exitPoints:[]}],
  oracles:['EVIDENCE_COMPLETE','IDENTITY_BOUND','BUSINESS_OUTCOME','RIG_GOALS_ARRIVED','ZONE_CONTENDED','ZONE_PROMOTED_AT_RELEASE','ZONE_SINGLE_OWNER','ZONE_RELEASE_AFTER_EXIT','NO_PHYSICAL_CONTACT','MIN_SEPARATION_AVAILABLE']},
 // IR05: IR-FD01 cancelled by the operator as soon as the robot drives its first leg (before any load)
 {scenarioId:'IR-FD01-cancel',runs:'IR-FD01',kind:'operator_fault',label:'IR05: operator cancel mid-route on the kitchen leg; cancelled, nothing served, bounded simulated stop',operator:{cancelWhenMoving:true},expectOutcome:{status:'cancelled',served:'0'},
  fixtures:['serve-demo-v1'],worldId:'restaurant-10-tables',actors:[],zones:[],oracles:[...COMMON,'BUSINESS_OUTCOME','NO_PHYSICAL_CONTACT','CANCEL_BOUNDED_STOP','ONE_TERMINAL_PER_MISSION']},
 // IR10: the real worker is SIGKILLed between steps on the table leg (cargo aboard)
 {scenarioId:'IR-FD01-workerkill',runs:'IR-FD01',kind:'operator_fault',label:'IR10: worker process killed between steps on the table leg; leg unknown, no resend, no second worker, cargo kept, the unknown tick a recorded gap',operator:{killWorkerOnTableLeg:true},
  expectOutcome:{status:'needs_attention',served:'0',reasons:['WORKER_LOST','EXECUTION_UNKNOWN']},evidence:'step_ack_lost',
  fixtures:['serve-demo-v1'],worldId:'restaurant-10-tables',actors:[],zones:[],oracles:['IDENTITY_BOUND','NO_SERVED_BEFORE_HANDOFF','BUSINESS_OUTCOME','EVIDENCE_GAP_AS_DECLARED','CARGO_KEPT','NO_SECOND_WORKER']},
 // IR06: robot01 driven into robot02 (standing) by raw velocities with the controller bypassed (test-only, never admitted by the gateway)
 {scenarioId:'IR-RAW-PAIR-CONTACT',kind:'raw_drive',label:'IR06 (test-only raw drive, controller bypassed): robot01 driven into robot02; contact named by robotId, one episode per pair, oracle agrees',
  raw:{ticks:300,velocities:[{robotId:'robot01',vMps:0.3,omegaRadps:0},{robotId:'robot02',vMps:0,omegaRadps:0}]},
  fixtures:['serve-fleet-v1'],worldId:'restaurant-10-tables',actors:[],zones:[],oracles:['EVIDENCE_COMPLETE','CONTACT_NAMED_BY_ID','ONE_ENGINE_EPISODE_PER_PAIR','ORACLE_AGREES_CONTACT','STOPPED_AT_CONTACT']},
];
/** Campaign-only scenario definitions (never in the gateway's registry): the IR04 contention rig. */
export const RIG_SCENARIOS:ReadonlyMap<string,ScenarioDefinition>=new Map([['IR-RIG-ZONE',deepFreeze({id:'IR-RIG-ZONE',revision:1,title:'CONTENTION RIG: two robots cross one band zone at once (no missions)',robots:2,orders:[],confirm:{mode:'scripted' as const,delayTicks:0},park:false,maxTicks:6000,
 rig:{goals:[{robot:0,pointId:'t-01',atTick:0},{robot:1,pointId:'pass',atTick:0}],note:'goals are given to the controller directly with no order or mission, so the venue-movement reservation that serializes source-driven runs does not apply; this run proves zone contention, not delivery'}})]]);
export const SCENARIO_FIXTURES:ReadonlyMap<string,ScenarioFixtureSpec>=new Map(SPECS.map(s=>[s.scenarioId,deepFreeze(s)]));

export interface ResolvedActor{id:string;radiusM:number;initialPoseMap:[number,number,number];startTick:number;speedMps:number;path:[number,number][];scheduleRef:{id:string;revision:number;hash:string}}
export interface ResolvedFixture{scenarioId:string;hash:string;actors:ResolvedActor[];zones:{id:string;polygonM:[number,number][];entryPoints:[number,number][];exitPoints:[number,number][]}[]}
/** The worker file (scenario-fixture.json in the run's bundle copy): actor bodies and start poses only; poses per tick arrive as step actorUpdates. */
export const fixtureFile=(f:ResolvedFixture)=>({schemaVersion:1,scenarioId:f.scenarioId,fixtureHash:f.hash,actors:f.actors.map(a=>({id:a.id,radiusM:a.radiusM,initialPoseMap:a.initialPoseMap}))});

const fail=(code:string,detail:string):never=>{throw new Error(`SCENARIO_FIXTURE_INVALID:${code}:${detail}`.slice(0,300));};
const disc=(x:number,y:number,r:number,n=16):P[]=>{const k=r/Math.cos(Math.PI/n);return Array.from({length:n},(_,i)=>[x+k*Math.cos(2*Math.PI*i/n),y+k*Math.sin(2*Math.PI*i/n)] as P);};
/** Conservative disc (the circumscribing 16-gon, at most 0.5% of the radius outside the disc) used by every overlap/clearance check of an actor. */
export const actorPolygon=(x:number,y:number,r:number)=>disc(x,y,r);

/**
 * The effective fixture of `scenarioId` on this scene and seed, deep-frozen. Refuses (SCENARIO_FIXTURE_INVALID:<code>) anything the plant or the domain could not honour:
 * another world, ids clashing with robots/solids, an actor path leaving the world or crossing a solid, a zone that is not convex, leaves the world, or holds a place a
 * robot must stand (its start pose or any target): a robot parked inside a zone it cannot release would starve every other robot.
 */
export function resolveScenarioFixture(scenarioId:string,scene:NavigationSceneV1,seed:number,spec:ScenarioFixtureSpec|undefined=SCENARIO_FIXTURES.get(scenarioId)):ResolvedFixture{
 if(!spec)return deepFreeze({scenarioId,hash:hashJson({scenarioId,actors:[],zones:[]}),actors:[],zones:[]});
 if(scene.world.id!==spec.worldId)fail('WORLD_MISMATCH',`${scenarioId} is laid out for ${spec.worldId}, the scene is ${scene.world.id}`);
 const W=scene.world.widthM,H=scene.world.heightM,solids=[...scene.world.obstacles,...scene.world.boundaries].map(o=>({id:o.id,poly:o.verticesM as P[]}));
 const taken=new Set([...scene.robots.map(r=>r.robotId),...solids.map(s=>s.id)]),ids=new Set<string>();
 const own=(id:string)=>{if(!/^[A-Za-z0-9_.:-]{1,64}$/.test(id)||taken.has(id)||ids.has(id))fail('ID_CLASH',id);ids.add(id);};
 const actors=spec.actors.map(a=>{
  own(a.id);
  if(!(a.radiusM>0&&a.radiusM<=1)||!(a.speedMps>0&&a.speedMps<=2)||!a.path.length||a.path.length>32)fail('ACTOR_SHAPE',a.id);
  for(let i=0;i<a.path.length;i++){
   const p=a.path[i]!,q=a.path[Math.min(i+1,a.path.length-1)]!,n=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/0.05));
   for(let k=0;k<=n;k++){const x=p[0]+(q[0]-p[0])*k/n,y=p[1]+(q[1]-p[1])*k/n;
    if(x<a.radiusM||y<a.radiusM||x>W-a.radiusM||y>H-a.radiusM)fail('ACTOR_OUTSIDE_WORLD',`${a.id} at ${x},${y}`);
    const hit=solids.find(s=>pointDistance([x,y],s.poly)<a.radiusM);if(hit)fail('ACTOR_CROSSES_SOLID',`${a.id} meets ${hit.id} at ${x.toFixed(2)},${y.toFixed(2)}`);}
  }
  const start=a.startTick[0]===a.startTick[1]?a.startTick[0]:actorStream(seed,a.id).int(a.startTick[0],a.startTick[1]);
  const schedule={id:`${scenarioId}/${a.id}`,startTick:start,speedMps:a.speedMps,path:a.path.map(p=>[p[0],p[1]] as [number,number])};
  return {id:a.id,radiusM:a.radiusM,initialPoseMap:[a.path[0]![0],a.path[0]![1],0] as [number,number,number],startTick:start,speedMps:a.speedMps,path:schedule.path,scheduleRef:{id:schedule.id,revision:1,hash:hashJson(schedule)}};
 });
 const standing=scene.robots.flatMap(r=>[{what:`${r.robotId} start`,poly:place(r.model.footprint.verticesM as P[],...r.initialPoseMap as Pose2)},...r.targetBindings.map(t=>({what:`${r.robotId} at ${t.pointId}`,poly:place(r.model.footprint.verticesM as P[],t.x,t.y,t.yaw)}))]);
 const zones=spec.zones.map(z=>{
  own(z.id);
  const poly=z.polygonM.map(p=>[p[0],p[1]] as P);
  if(poly.length<3||!isConvex(poly))fail('ZONE_NOT_CONVEX',z.id);
  if(poly.some(([x,y])=>x<0||y<0||x>W||y>H))fail('ZONE_OUTSIDE_WORLD',z.id);
  const s=standing.find(p=>polygonsOverlap(p.poly,poly));if(s)fail('ZONE_CONTAINS_STANDING_POINT',`${z.id}: ${s.what}`);
  return {id:z.id,polygonM:poly as [number,number][],entryPoints:z.entryPoints.map(p=>[p[0],p[1]] as [number,number]),exitPoints:z.exitPoints.map(p=>[p[0],p[1]] as [number,number])};
 });
 const body={scenarioId,actors:actors.map(({scheduleRef,...a})=>({...a,scheduleRef})),zones};
 return deepFreeze({...body,hash:hashJson(body)});
}
/** Actor pose at `tick` from its immutable schedule (pure: the same tick always gives the same pose, whatever was asked before). */
export function actorPoseAt(a:Pick<ResolvedActor,'startTick'|'speedMps'|'path'>,tick:number):[number,number,number]{
 let s=Math.max(0,tick-a.startTick)*a.speedMps*TICK_MS/1000;
 for(let i=0;i+1<a.path.length;i++){
  const p=a.path[i]!,q=a.path[i+1]!,l=Math.hypot(q[0]-p[0],q[1]-p[1]);
  if(s<=l){const t=l===0?0:s/l;return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,0];}
  s-=l;
 }
 const e=a.path.at(-1)!;return [e[0],e[1],0];
}
export const actorUpdatesAt=(f:ResolvedFixture,tick:number)=>f.actors.map(a=>({actorId:a.id,poseMap:actorPoseAt(a,tick)}));

// ---- scenario oracles ----
export interface ScenarioAssertion{id:string;result:'pass'|'fail'|'inconclusive';expected:string;actual:string;oracle:string}
/** `expectOutcome` replaces the scenario's expected business outcome for an operator-driven case (a cancel mid-route): the oracle is the same, only the expectation moves. */
export interface OracleInput{report:RunReport;read:EvidenceRead;scene:NavigationSceneV1;fixture:ResolvedFixture;expectOutcome?:{status:string;served:string;reasons?:readonly string[]};
 /** the case being judged (default: the run's scenario id) and what the operator did: the tick a cancel was sent / a worker was killed, and the worker processes seen after the kill */
 caseId?:string;operator?:{cancelTick?:number;killTick?:number;workersAfterKill?:number}}
const tickOf=(r:RunReport,at:string)=>Math.round((Date.parse(at)-(r.manifest.clock as {businessEpochMs?:number}).businessEpochMs!)/TICK_MS);
const say=(id:string,ok:boolean|null,expected:string,actual:string,oracle:string):ScenarioAssertion=>({id,result:ok===null?'inconclusive':ok?'pass':'fail',expected,actual,oracle});
/** Expected business outcome per scenario: status, served count and, for a failed leg, the attention reasons that are acceptable. */
const OUTCOME:Record<string,{status:string;served:string;reasons?:readonly string[]}>={'IR-RIG-ZONE':{status:'completed',served:'0'},
 'IR-FD01':{status:'completed',served:'1'},'WB-FD01':{status:'completed',served:'1'},'WB-FD07':{status:'completed',served:'2'},'IR-FD03':{status:'completed',served:'1'},'IR-FD07':{status:'completed',served:'2'},
 'IR-FD04':{status:'needs_attention',served:'0',reasons:['NO_PATH']},'IR-FD04-blocked':{status:'needs_attention',served:'0',reasons:['DYNAMIC_OBSTACLE','NO_PROGRESS']},
};
/** Footprint of a robot (drive-frame pose, as recorded) overlapping a convex zone polygon. */
const inZone=(scene:NavigationSceneV1,robotId:string,pose:readonly number[],zone:readonly P[])=>polygonsOverlap(place(scene.robots.find(r=>r.robotId===robotId)!.model.footprint.verticesM as P[],pose[0]!,pose[1]!,pose[2]!),zone);

/** Every oracle of the scenario. Without complete evidence a trace-based oracle is inconclusive, never a pass; business oracles read the journal only. */
export function scenarioAssertions(o:OracleInput):ScenarioAssertion[]{
 const {report:r,read,scene,fixture}=o,spec=SCENARIO_FIXTURES.get(o.caseId??r.manifest.scenario.id),ev=r.navigation2d,complete=read.complete&&ev?.completeness?.status==='complete';
 const out:ScenarioAssertion[]=[],trace=read.trajectory,events=r.businessEvents;
 const want=(id:string)=>!spec||spec.oracles.includes(id);
 if(want('EVIDENCE_COMPLETE'))out.push(say('EVIDENCE_COMPLETE',complete&&['EVIDENCE_INTEGRITY','EVIDENCE_COVERAGE','EVIDENCE_LIMITS'].every(id=>ev?.assertions.find(a=>a.id===id)?.result==='pass'),
  'durable evidence complete 0..outcome tick: integrity, coverage and limits pass',`completeness ${ev?.completeness?.status??'absent'} (${(ev?.completeness?.reasons??[]).join(', ')||'no reasons'}); read ${read.complete?'complete':'incomplete'} horizon ${read.horizon}`,'readNavigationEvidence over the stored chunks + evidence assertions'));
 if(want('IDENTITY_BOUND')){
  const robots=[...scene.robots.map(x=>x.robotId)].sort(),inTrace=trace.length?[...trace[0]!.robots.map(x=>x.robotId)].sort():[];
  const ok=!!ev&&ev.runId===r.manifest.runId&&ev.sceneDigest===scene.sceneDigest&&ev.seed.runSeed===r.manifest.seed&&r.manifest.models.some(m=>m.provenance==='simulated_plant'&&m.hash===scene.sceneDigest)
   &&JSON.stringify(inTrace)===JSON.stringify(robots)&&scene.robots.every(x=>r.manifest.models.some(m=>m.id===`navigation-model:${x.robotId}`&&m.hash===x.model.modelDigest))&&read.horizon===r.outcome.tick;
  out.push(say('IDENTITY_BOUND',ok,'report, evidence and trace bound to one run: runId, scene digest, seed, per-robot model digests by robotId, horizon = outcome tick',
   `evidence run ${ev?.runId===r.manifest.runId?'same':'other'}, scene ${ev?.sceneDigest===scene.sceneDigest?'same':'other'}, seed ${ev?.seed.runSeed}/${r.manifest.seed}, trace robots ${inTrace.join(',')}, horizon ${read.horizon}/${r.outcome.tick}`,'manifest x evidence x trace cross-check'));
 }
 if(want('NO_SERVED_BEFORE_HANDOFF')){
  let bad:string|null=null;
  for(const e of events){
   if(e.kind==='fulfillment'&&String(e.state.served??'0')!=='0'&&!events.slice(0,events.indexOf(e)).some(x=>x.type==='DeliveryHandedOff'))bad=`${e.id} served ${String(e.state.served)} at ${e.at} before any handoff`;
  }
  const loaded=events.findIndex(e=>e.type==='CargoLoaded'),handoff=events.findIndex(e=>e.type==='DeliveryHandedOff');
  if(!bad&&handoff>=0&&(loaded<0||loaded>handoff))bad='a handoff precedes the load';
  out.push(say('NO_SERVED_BEFORE_HANDOFF',!bad,'served only after DeliveryHandedOff; CargoLoaded before any handoff',bad??`${events.filter(e=>e.type==='DeliveryHandedOff').length} handoff(s), ${events.filter(e=>e.type==='CargoLoaded').length} load(s), in order`,'journal event order'));
 }
 if(want('BUSINESS_OUTCOME')){
  const x=o.expectOutcome??spec?.expectOutcome??OUTCOME[r.manifest.scenario.id],reasons=r.attention.map(a=>a.reason);
  const ok=!!x&&r.outcome.status===x.status&&r.outcome.served===x.served&&(x.reasons?reasons.length>0&&reasons.every(a=>x.reasons!.includes(a)):reasons.length===0);
  out.push(say('BUSINESS_OUTCOME',ok,x?`${x.status}, served ${x.served}${x.reasons?`, attention only ${x.reasons.join('|')}`:', no attention'}`:'a known scenario',`${r.outcome.status}, served ${r.outcome.served}, attention ${reasons.join(',')||'none'}`,'journal outcome (served from fulfillment state)'));
 }
 const m=r.metrics.navigation;
 if(want('NO_PHYSICAL_CONTACT'))out.push(say('NO_PHYSICAL_CONTACT',!complete||!m||m.collisionEpisodes===null?null:m.collisionEpisodes===0,'0 engine_discrete/swept_oracle episodes (robots, solids, actors)',m?`${m.collisionEpisodes} episode(s): ${(m.episodes??[]).filter(e=>e.source!=='safety_envelope').map(e=>`${e.pair.join('~')}@${e.fromTick}-${e.toTick}/${e.source}`).join('; ')||'none'}`:'no metrics','independent oracle over the durable trajectory'));
 // actors: the control ledger must carry exactly the immutable schedule, tick by tick
 const poseAt=(a:ResolvedActor,t:number)=>actorPoseAt(a,t);
 if(want('ACTOR_SCHEDULE_APPLIED')){
  let bad:string|null=null;
  for(const c of read.control){const sent=c.actorUpdates as {actorId:string;poseMap:number[]}[];
   if(sent.length!==fixture.actors.length){bad=`tick ${c.targetTick}: ${sent.length} updates for ${fixture.actors.length} actors`;break;}
   for(const a of fixture.actors){const u=sent.find(x=>x.actorId===a.id),p=poseAt(a,c.targetTick);if(!u||u.poseMap.some((v,i)=>v!==p[i])){bad=`tick ${c.targetTick}: ${a.id} sent ${JSON.stringify(u?.poseMap)} schedule ${JSON.stringify(p)}`;break;}}
   if(bad)break;}
  out.push(say('ACTOR_SCHEDULE_APPLIED',!complete?null:!bad&&read.control.length>0,'every step carries every actor at its scheduled pose (bitwise)',bad??`${read.control.length} steps x ${fixture.actors.length} actor(s) match`,'control ledger vs actorPoseAt(schedule)'));
 }
 if(want('ACTOR_OBSERVED')){
  // independent ray geometry: a LiDAR return counts as the actor when its hit point lies on the actor's disc (radius + 3 cm) at the scan's tick
  const refs:string[]=[];
  for(const s of read.sensors){
   const robot=scene.robots.find(x=>x.robotId===s.robotId),mount=robot?.model.sensors.find(x=>x.id===s.scan.sensorId),pose=trace.find(t=>t.tick===s.tick)?.robots.find(x=>x.robotId===s.robotId)?.poseDriveMap;
   if(!robot||!mount||!pose)continue;
   const [mx,my,myaw]=mount.poseInDrive,ox=pose[0]+mx*Math.cos(pose[2])-my*Math.sin(pose[2]),oy=pose[1]+mx*Math.sin(pose[2])+my*Math.cos(pose[2]);
   for(const a of fixture.actors){const [ax,ay]=poseAt(a,s.tick);let beams=0;
    s.scan.rangesM.forEach((d,i)=>{if(d===null||s.scan.states[i]!=='hit')return;const ang=pose[2]+myaw+s.scan.angleMinRad+i*s.scan.angleIncrementRad;if(Math.hypot(ox+d*Math.cos(ang)-ax,oy+d*Math.sin(ang)-ay)<=a.radiusM+0.03)beams++;});
    if(beams)refs.push(`${s.robotId}/${s.scan.sensorId}@${s.tick}:${a.id}x${beams}`);}
  }
  out.push(say('ACTOR_OBSERVED',!complete?null:refs.length>0,'the robot LiDAR returned hits on the actor (dynamic observation refs)',refs.length?`${refs.length} scan(s), first ${refs.slice(0,5).join(' ')}, last ${refs.at(-1)}`:'no scan hit an actor','ray hit points of recorded scans vs scheduled actor discs'));
 }
 if(want('NO_ACTOR_CONTACT')){
  let min=Infinity,at='';
  for(const t of trace)for(const x of t.robots){const body=place(scene.robots.find(y=>y.robotId===x.robotId)!.model.footprint.verticesM as P[],...x.poseDriveMap as Pose2);
   for(const a of fixture.actors){const [ax,ay]=poseAt(a,t.tick),d=polygonDistance(body,actorPolygon(ax,ay,a.radiusM));if(d<min){min=d;at=`${x.robotId}~${a.id}@${t.tick}`;}}}
  const engine=trace.some(t=>t.robots.some(x=>x.collisionIds.some(id=>fixture.actors.some(a=>a.id===id))));
  out.push(say('NO_ACTOR_CONTACT',!complete||!fixture.actors.length?null:min>0&&!engine,'robot footprint never touches an actor (polygon separation > 0, no engine contact)',`min separation ${Number.isFinite(min)?min.toFixed(4):'n/a'} m at ${at||'n/a'}; engine contact ${engine}`,'footprint polygon vs conservative actor 16-gon at every recorded tick'));
 }
 if(want('ACTOR_YIELD')){
  // the robot stood still away from every target while an actor was within 1 m of its footprint, and drove on afterwards (> 0.5 m): it waited for the person
  const p=scene.policy.parameters;let stop:number|null=null,after=0;
  for(const t of trace)for(const x of t.robots){
   const robot=scene.robots.find(y=>y.robotId===x.robotId)!,still=Math.abs(x.bodyVelocity[0])<=p.stoppedLinearMps&&Math.abs(x.bodyVelocity[1])<=p.stoppedAngularRadps;
   const atTarget=robot.targetBindings.some(b=>Math.hypot(b.x-x.poseDriveMap[0],b.y-x.poseDriveMap[1])<=0.3)||Math.hypot(robot.initialPoseMap[0]-x.poseDriveMap[0],robot.initialPoseMap[1]-x.poseDriveMap[1])<=0.3;
   const body=place(robot.model.footprint.verticesM as P[],...x.poseDriveMap as Pose2),near=fixture.actors.some(a=>{const [ax,ay]=poseAt(a,t.tick);return polygonDistance(body,actorPolygon(ax,ay,a.radiusM))<=1;});
   if(stop===null&&still&&!atTarget&&near)stop=t.tick;
   if(stop!==null&&t.tick>stop){const prev=trace.find(y=>y.tick===t.tick-1)?.robots.find(y=>y.robotId===x.robotId);if(prev)after+=Math.hypot(x.poseDriveMap[0]-prev.poseDriveMap[0],x.poseDriveMap[1]-prev.poseDriveMap[1]);}
  }
  out.push(say('ACTOR_YIELD',!complete?null:stop!==null&&after>0.5,'stopped away from any target with an actor within 1 m, then drove on > 0.5 m',stop===null?'never stood still near an actor away from a target':`stood still at tick ${stop}, then drove ${after.toFixed(2)} m`,'trace velocities/poses vs scheduled actor discs'));
 }
 const failed=r.attention.filter(a=>a.reason!=='RECOVERY_UNKNOWN');
 if(want('NO_PATH_NOT_BLOCKED')){
  const np=failed.find(a=>a.reason==='NO_PATH'),loaded=events.find(e=>e.type==='CargoLoaded'),lt=loaded?tickOf(r,loaded.at):null;
  // no_path is decided from the static map before the robot drives: within a few ticks of the leg after the load, and the robot never enters the pocket
  const ok=!!np&&lt!==null&&np.tick>=lt&&np.tick<=lt+10&&!failed.some(a=>a.reason!=='NO_PATH');
  out.push(say('NO_PATH_NOT_BLOCKED',ok,'NO_PATH attention within 10 ticks of the leg start (after CargoLoaded), no blocked/timeout reason',`attention ${failed.map(a=>`${a.reason}@${a.tick}`).join(',')||'none'}; CargoLoaded at ${lt}`,'journal + attention timestamps'));
 }
 if(want('BLOCKED_NOT_NO_PATH')){
  const b=failed.find(a=>a.reason==='DYNAMIC_OBSTACLE'||a.reason==='NO_PROGRESS'),loaded=events.find(e=>e.type==='CargoLoaded'),lt=loaded?tickOf(r,loaded.at):null,p=scene.policy.parameters;
  const ok=!!b&&lt!==null&&b.tick>=lt+p.noProgressTicks&&b.tick<lt+p.goalDeadlineTicks&&!failed.some(a=>a.reason==='NO_PATH'||a.reason==='GOAL_DEADLINE');
  out.push(say('BLOCKED_NOT_NO_PATH',ok,`blocked (DYNAMIC_OBSTACLE/NO_PROGRESS) no earlier than ${p.noProgressTicks} ticks and before the ${p.goalDeadlineTicks}-tick deadline after the leg start; never NO_PATH`,`attention ${failed.map(a=>`${a.reason}@${a.tick}`).join(',')||'none'}; CargoLoaded at ${lt}`,'journal + attention timestamps vs policy windows'));
 }
 if(want('BOTH_ROBOTS_MOVED')){
  const d=m?.distanceM??null;
  out.push(say('BOTH_ROBOTS_MOVED',!complete||!d?null:scene.robots.every(x=>(d[x.robotId]??0)>1),'every robot travelled > 1 m (durable trace, base origin)',d?scene.robots.map(x=>`${x.robotId} ${(d[x.robotId]??0).toFixed(2)} m`).join(', '):'distance unavailable','trace path length'));
 }
 if(want('ROBOT_MAPPING')){
  // each arrival in the journal names a robot; that robot's own trace (by robotId, never by list position) must be at the arrival's target at that tick
  const arrivals=events.filter(e=>e.type==='MissionArrived'),bad:string[]=[];let checked=0;
  for(const e of arrivals){const robotId=String(e.state.robotId??''),stop=(e.state.stops as {id:string;targetId:string}[]|undefined)?.find(s=>s.id===e.state.currentStopId),t=tickOf(r,e.at);
   const target=scene.robots.find(x=>x.robotId===robotId)?.targetBindings.find(b=>b.pointId===stop?.targetId),pose=trace.find(x=>x.tick===t)?.robots.find(x=>x.robotId===robotId)?.poseDriveMap;
   if(!target||!pose){bad.push(`${e.id}@${t}: ${robotId}/${stop?.targetId} unresolved`);continue;}
   checked++;if(Math.hypot(pose[0]-target.x,pose[1]-target.y)>scene.policy.parameters.goalPositionToleranceM+1e-9)bad.push(`${robotId} not at ${target.pointId} at ${t}`);}
  out.push(say('ROBOT_MAPPING',!complete?null:!bad.length&&checked>=scene.robots.length,'every MissionArrived robot is, in its own trace, at its stop target at that tick',bad.join('; ')||`${checked} arrival(s) matched by robotId`,'journal arrivals x trace by robotId x scene target bindings'));
 }
 if(want('ZONE_SINGLE_OWNER')||want('ZONE_RELEASE_AFTER_EXIT')){
  const res=events.filter(e=>e.kind==='reservation'&&fixture.zones.some(z=>z.id===e.state.zoneId));
  const bad1:string[]=[],bad2:string[]=[];let insideTicks=0,releases=0;
  for(const z of fixture.zones){
   const grants=res.filter(e=>e.state.zoneId===z.id);
   const owners=(t:number)=>{const own=new Set<string>();for(const e of grants){if(tickOf(r,e.at)>=t)break;if(e.state.status==='granted')own.add(String(e.state.robotId));else own.delete(String(e.state.robotId));}return own;};
   for(const t of trace){const own=owners(t.tick);if(own.size>1)bad1.push(`${z.id}@${t.tick}: ${[...own].join(',')} granted`);
    for(const x of t.robots)if(inZone(scene,x.robotId,x.poseDriveMap,z.polygonM)){insideTicks++;if(!own.has(x.robotId))bad1.push(`${x.robotId} inside ${z.id} at ${t.tick} without a grant`);}}
   for(const e of grants.filter(e=>e.type==='ZoneReservationReleased')){releases++;const t=tickOf(r,e.at),pose=trace.find(x=>x.tick===t)?.robots.find(x=>x.robotId===String(e.state.robotId))?.poseDriveMap;
    if(!pose||inZone(scene,String(e.state.robotId),pose,z.polygonM))bad2.push(`${String(e.state.robotId)} released ${z.id} at ${t} ${pose?'while inside':'without an observation'}`);}
  }
  // contention: some robot asked (pending) while another held the grant, and the release itself promoted it (same journal transaction tick)
  const contended:string[]=[],promoted:string[]=[],unpromoted:string[]=[];
  for(const z of fixture.zones){
   const ev=res.filter(e=>e.state.zoneId===z.id),held=(t:number,robot:string)=>{let g=false;for(const e of ev){if(tickOf(r,e.at)>t)break;if(String(e.state.robotId)===robot)g=e.state.status==='granted';}return g;};
   const firsts=new Set<string>();
   for(const p of ev.filter(e=>e.type==='ZoneReservationPending')){
    const b=String(p.state.robotId),t=tickOf(r,p.at),holder=[...new Set(ev.map(e=>String(e.state.robotId)))].find(a=>a!==b&&held(t,a));if(!holder||firsts.has(`${b}@${holder}`))continue;firsts.add(`${b}@${holder}`);
    const grant=ev.find(e=>e.type==='ZoneReservationGranted'&&String(e.state.robotId)===b&&tickOf(r,e.at)>=t),release=ev.find(e=>e.type==='ZoneReservationReleased'&&String(e.state.robotId)===holder&&tickOf(r,e.at)>=t);
    contended.push(`${b} pending on ${z.id} from ${t} while ${holder} held it`);
    if(grant&&release&&tickOf(r,grant.at)===tickOf(r,release.at))promoted.push(`${b} granted at ${tickOf(r,grant.at)} = ${holder}'s release`);else unpromoted.push(`${b}: grant ${grant?tickOf(r,grant.at):'none'}, ${holder}'s release ${release?tickOf(r,release.at):'none'}`);
   }
  }
  if(want('ZONE_CONTENDED'))out.push(say('ZONE_CONTENDED',contended.length>0,'a robot was pending on the zone while another held it (the zone was actually contended)',contended.join('; ')||'never contended (a run that never contends cannot show exclusion)','journal reservation events'));
  if(want('ZONE_PROMOTED_AT_RELEASE'))out.push(say('ZONE_PROMOTED_AT_RELEASE',contended.length>0&&!unpromoted.length,'every contended robot is granted exactly at the holder\'s release tick (domain promotion), not earlier or by TTL',[...promoted,...unpromoted].join('; ')||'no contention','journal reservation events'));
  if(want('ZONE_SINGLE_OWNER'))out.push(say('ZONE_SINGLE_OWNER',!complete?null:!bad1.length&&insideTicks>0,'at every tick at most one granted owner per zone, and a robot footprint inside a zone only while it holds the grant',bad1.slice(0,5).join('; ')||`${insideTicks} robot-ticks inside zones, all granted`,'journal reservations x trace footprints'));
  if(want('ZONE_RELEASE_AFTER_EXIT'))out.push(say('ZONE_RELEASE_AFTER_EXIT',!complete?null:!bad2.length&&releases>=scene.robots.length,'every release only when the whole footprint is outside the zone at that tick',bad2.slice(0,5).join('; ')||`${releases} release(s), each after a full exit`,'journal releases x trace footprints'));
 }
 if(want('RIG_GOALS_ARRIVED')){
  const rig=RIG_SCENARIOS.get(r.manifest.scenario.id)?.rig,ids=[...scene.robots.map(x=>x.robotId)].sort(),last=trace.at(-1),bad:string[]=[];
  for(const g of rig?.goals??[]){const id=ids[g.robot]!,t=scene.robots.find(x=>x.robotId===id)!.targetBindings.find(b=>b.pointId===g.pointId)!,p=last?.robots.find(x=>x.robotId===id)?.poseDriveMap;
   if(!p||Math.hypot(p[0]-t.x,p[1]-t.y)>scene.policy.parameters.goalPositionToleranceM+1e-9)bad.push(`${id} not at ${g.pointId}`);}
  out.push(say('RIG_GOALS_ARRIVED',!complete?null:!!rig&&!bad.length&&r.outcome.status==='completed','every rig robot ends at its own target (by robotId) and the rig completed',bad.join('; ')||`${rig?.goals.length??0} goal(s) reached, ${r.outcome.status}`,'last trace pose vs scene target bindings'));
 }
 if(want('CANCEL_BOUNDED_STOP')){
  const c=o.operator?.cancelTick,stop=c===undefined?undefined:trace.find(t=>t.tick>=c&&t.robots.every(x=>Math.abs(x.bodyVelocity[0])<=scene.policy.parameters.stoppedLinearMps&&Math.abs(x.bodyVelocity[1])<=scene.policy.parameters.stoppedAngularRadps));
  const moving=c!==undefined&&trace.find(t=>t.tick===c)?.robots.some(x=>Math.abs(x.bodyVelocity[0])>scene.policy.parameters.stoppedLinearMps||Math.abs(x.bodyVelocity[1])>scene.policy.parameters.stoppedAngularRadps);
  out.push(say('CANCEL_BOUNDED_STOP',!complete?null:c!==undefined&&!!moving&&!!stop&&stop.tick-c<=60,'the robot was moving at the cancel and stood still within 60 ticks (0.5 m/s at 0.5 m/s2 = 50 ticks + 10)',c===undefined?'no cancel tick':`cancel at ${c} (moving ${moving}), still from ${stop?.tick??'never'}`,'trace velocities after the operator cancel tick'));
 }
 if(want('ONE_TERMINAL_PER_MISSION')){
  const ended=events.filter(e=>e.type==='MissionCancelled'||e.kind==='mission'&&e.state.status==='completed'&&e.type!=='MissionCancelled'),ids=ended.map(e=>e.id);
  out.push(say('ONE_TERMINAL_PER_MISSION',ids.length>0&&new Set(ids).size===ids.length&&!events.some(e=>e.type==='DeliveryHandedOff'),'each mission ends once (one terminal event), no handoff',`${ids.length} terminal event(s) for ${new Set(ids).size} mission(s); handoffs ${events.filter(e=>e.type==='DeliveryHandedOff').length}`,'journal'));
 }
 if(want('EVIDENCE_GAP_AS_DECLARED')){
  const k=o.operator?.killTick,ok=k!==undefined&&!read.issues.length&&read.gaps.length===1&&read.gaps[0]!.reason==='STEP_ACK_LOST'&&read.gaps[0]!.fromTick===read.gaps[0]!.toTick&&read.gaps[0]!.fromTick===r.outcome.tick+1&&ev?.completeness?.status==='incomplete';
  out.push(say('EVIDENCE_GAP_AS_DECLARED',ok,'exactly one recorded gap: STEP_ACK_LOST at the step sent to the dead worker (outcome tick + 1); no integrity issue; the evidence says incomplete',`kill at ${k}; gaps ${JSON.stringify(read.gaps)}; issues ${read.issues.length}; completeness ${ev?.completeness?.status}`,'durable evidence read'));
 }
 if(want('CARGO_KEPT')){
  const loaded=events.some(e=>e.type==='CargoLoaded'),gone=events.some(e=>['CargoReturned','AllocationReleased','DeliveryHandedOff'].includes(e.type)),venue=events.filter(e=>e.kind==='reservation'&&e.state.zoneId==='__venue_movement__').at(-1);
  out.push(say('CARGO_KEPT',loaded&&!gone&&r.outcome.served==='0'&&!!venue&&venue.state.status!=='released','cargo stays loaded (no return/release/handoff), nothing served, the movement reservation still held',`loaded ${loaded}, returned/released/handed ${gone}, served ${r.outcome.served}, venue ${venue?.state.status??'none'}`,'journal'));
 }
 if(want('NO_SECOND_WORKER'))out.push(say('NO_SECOND_WORKER',o.operator?.workersAfterKill===0,'no worker process for this run after the kill (nothing respawned or resent)',`${o.operator?.workersAfterKill??'unmeasured'} worker process(es) for this run after the kill`,'process table (pgrep on the run\'s bundle root)'));
 if(want('MIN_SEPARATION_AVAILABLE'))out.push(say('MIN_SEPARATION_AVAILABLE',!complete||!m?null:m.minSeparationM!==null&&m.minSeparationM>0,'robot-robot polygon separation measured and > 0',`minSeparationM ${m?.minSeparationM??'unavailable'}`,'oracle over both robots'));
 if(want('WITHIN_TICKS'))out.push(say('WITHIN_TICKS',r.outcome.status==='completed'&&r.outcome.tick<=12000,'completed within 12,000 ticks (IR-FD07 campaign bound)',`${r.outcome.status} at tick ${r.outcome.tick}`,'outcome tick'));
 return out;
}
