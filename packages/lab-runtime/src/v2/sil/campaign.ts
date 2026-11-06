import {assessPhysicsObservations} from './physics-assessment';
import {runNativeSilScenario} from './native-campaign';
import type {NativeProviderFactory} from './native-lifecycle';
import {validateFaultSchedule} from '../fault-schedule';
// SIL scenario orchestrator (SIM-10): drives a registry scenario through the real source domain/journal/dispatcher with the gazebo_nav2
// backend. It is NOT a second business engine: orders, admission, arrival, confirmations and parking are source commands; this file only
// paces them by iteration, feeds worker telemetry/contacts into evidence and writes a hashed run bundle whose assertions separate business
// results (from the journal) from physics evidence (only with a real SIL worker, never a protocol double).
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import type {DomainEvent,JsonObject} from '../../../../contracts/src/index';
import {dispatchRobotEffects,robotEventCommand} from '../../../../robot-adapters/src/dispatch';
import type {RobotEvent} from '../../../../robot-adapters/src/contract';
import {validateProjectV2} from '../contracts';
import {defaultCatalog,type CapabilityCatalog} from '../capabilities';
import {scenarioRegistry,checkScenario,resolveRoles,scenarioHash,type ScenarioDefinition} from '../scenario-registry';
import {SourceSession,mealFor} from '../session';
import {actorStream,PRNG} from '../random';
import {hashJson} from '../hash';
import {TelemetryRecorder} from '../telemetry';
import {createTelemetryIngest} from '../backends/telemetry-ingest';
import {GAZEBO_NAV2,type CompiledWorld,type GazeboBackend,type BackendCapability} from '../backends/gazebo-nav2';
import {SimulatedNavigationAdapter} from '../backends/simulated-navigation';
import {createBarrierCoordinator} from '../backends/clock-barrier';
import {createFaultRegistry,scheduleFaults,WORKER_FAULTS,type FaultEntry} from '../backends/fault-schedule';
import {requiredBackends} from '../scenario-matrix';
import type {RobotManifest} from '../../../../robot-adapters/src/contract';
export const SIL_TICK_MS=20;
/** Backends this orchestrator can drive; a scenario needing more is refused before any effect (no fallback to a mock). */
const IMPLEMENTED=['gazebo_nav2'];
const FINAL=['completed','cancelled','failed'];
/** Iterations a link/sensor fault stays active (disconnect, reboot, sensor-drop): long enough for a poll to see it, short enough to resume. */
const FAULT_ITERATIONS=25;
export interface SilRunOptions {
 nativeFactory?:NativeProviderFactory;
 scenarioId:string;scenarioRevision:number;seed:number;project:unknown;sourceCommit:string;outDir:string;world:CompiledWorld;backendSetId:string;
 maxIterations:number;paceMs:number;backendFactory(world:CompiledWorld,runId:string):Promise<GazeboBackend>;
 scenarios?:ReadonlyMap<string,ScenarioDefinition>;catalog?:CapabilityCatalog;nowMs?:()=>number;
 /** The scenario fixture's fault schedule; worker-scoped entries are the worker's (scene loop), orchestrator-scoped ones fire here. */
 faults?:readonly FaultEntry[];barrierTimeoutMs?:number;
}
export interface SilAssertion {id:string;result:'pass'|'fail'|'not_run';reason?:string;detail?:string}
export interface SilRunManifest {
 nativeFaultExpectation?:import('./native-fault-oracle').NativeFaultExpectation;schemaVersion:1;runId:string;sourceCommit:string;mode:'simulation';access:'simulated';backendSetId:string;backends:string[];
 scenario:{id:string;revision:number;hash:string};project:{id:string;revision:number;hash:string};world:{inputHash:string;manifestHash:string;mapId:string;mapRevision:string};
 seed:number;prng:typeof PRNG;clock:{iterationMs:number;source:string};evidence:string;backendCapability:BackendCapability;status:'completed'|'needs_attention'|'timeout';iterations:number;
 businessDigest:string;hashAlgorithm:'sha256-canonical-json-v1';outputs:{path:string;sha256:string}[];limitations:string[];manifestHash?:string;
}
export interface SilRunResult {manifest:SilRunManifest;business:{served:string;missions:{completed:number;needsAttention:number;open:number}};assertions:SilAssertion[]}
interface Work {actor:string;tableId:string;quantity:number;atTick:number;sessionId:string;placed:boolean;lineId?:string;allocationId?:string;missionId?:string}
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function runSilScenario(o:SilRunOptions):Promise<SilRunResult>{
 if(o.scenarioId==='BV01'){if(!o.nativeFactory)throw new Error('BACKEND_MISSING:linuxcnc_sim,coffee_io_sim:NATIVE_FACTORY_REQUIRED');return runNativeSilScenario(o,o.nativeFactory);}
 const registry=o.scenarios??scenarioRegistry,catalog=o.catalog??defaultCatalog,nowMs=o.nowMs??Date.now;
 const registered=registry.get(o.scenarioId);if(!registered)throw new Error('SCENARIO_UNSUPPORTED');
 const scenario=structuredClone(registered);checkScenario(scenario);
 if(scenario.revision!==o.scenarioRevision)throw new Error('SCENARIO_REVISION_MISMATCH');
 const set=Object.hasOwn(catalog.sets,o.backendSetId)?catalog.sets[o.backendSetId]!:undefined;
 if(!set||set.mode!=='simulation')throw new Error('BACKEND_SET_UNKNOWN');
 const required=requiredBackends(scenario,'simulation');
 const missing=required.filter(b=>!set.backends.includes(b)||!IMPLEMENTED.includes(b));
 if(missing.length)throw new Error(`BACKEND_MISSING:${missing.join(',')}`);
 const valid=validateProjectV2(o.project);if(!valid.ok)throw new Error('INVALID_PROJECT');
 const project=structuredClone(valid.value),roles=resolveRoles(scenario,project);
 validateFaultSchedule(project.faultSchedule??[],project.entities,'simulation');
 if(!Number.isSafeInteger(o.seed)||o.seed<0||o.seed>0xffffffff)throw new Error('INVALID_SEED');
 const barrierTimeoutMs=o.barrierTimeoutMs??60_000;if(!Number.isSafeInteger(barrierTimeoutMs)||barrierTimeoutMs<=0)throw new Error('BARRIER_TIMEOUT_INVALID');
 const runId=randomUUID();
 // ---- faults: validated before any effect; worker-scoped entries are announced here and applied by the worker's scene loop ----
 const faultLog:JsonObject[]=[],faultRegistry=createFaultRegistry(),link={downUntil:-1,dropEventsUntil:-1},sensorDrop=new Map<string,number>(),lastSample=new Map<string,JsonObject>(),pendingDup=new Set<string>(),pendingReorder=new Set<string>();
 const manifests=new Map<string,RobotManifest>();
 const fault=(faultId:string,scope:'run'|'entity',inject:(target:string|null)=>void)=>faultRegistry.register({faultId,scope,fields:{},inject:t=>inject(t)});
 fault('map-changed','entity',t=>{const m=manifests.get(String(t));if(m)m.mapRevision=`${m.mapRevision}-changed`;});
 fault('duplicate-observation','entity',t=>pendingDup.add(String(t)));
 fault('reorder-observation','entity',t=>pendingReorder.add(String(t)));
 fault('sensor-drop','entity',t=>sensorDrop.set(String(t),FAULT_ITERATIONS));
 fault('sensor-stale','entity',t=>{const last=lastSample.get(String(t));if(last){const r=ingest.accept(last);ingestLog[r.status]++;}});
 fault('disconnect','run',()=>{link.downUntil=iteration+FAULT_ITERATIONS;});
 fault('reboot','run',()=>{link.downUntil=iteration+FAULT_ITERATIONS;link.dropEventsUntil=iteration+FAULT_ITERATIONS;});
 const isWorkerFault=(f:FaultEntry)=>(WORKER_FAULTS as readonly string[]).includes(f.faultId);
 const schedule=scheduleFaults((o.faults??[]).filter(f=>!isWorkerFault(f)),faultRegistry);
 if(schedule.issues.length)throw new Error(`FAULT_SCHEDULE_INVALID:${schedule.issues.map(i=>`${i.index}:${i.reasonCodes.join('|')}`).join(';')}`);
 for(const f of (o.faults??[]).filter(isWorkerFault))faultLog.push({faultId:f.faultId,entityId:f.entityId??null,atTick:f.atTick,scope:'worker',applied:'deferred_to_worker'});
 // ---- backend first: an unavailable simulator is refused before the journal exists (never an attempt, never a mock) ----
 const backend=await o.backendFactory(o.world,runId),capability=await backend.capability();
 if(!capability.available){await backend.close().catch(()=>{});throw new Error(`BACKEND_UNAVAILABLE:${capability.reasons.join(',')||'NO_REASON'}`);}
 const linked:GazeboBackend={...backend,execute:(r,c)=>link.downUntil>=iteration?Promise.reject(new Error('LINK_DOWN')):backend.execute(r,c),query:(r,c)=>link.downUntil>=iteration?Promise.reject(new Error('LINK_DOWN')):backend.query(r,c),
  cancel:(r,c)=>link.downUntil>=iteration?Promise.reject(new Error('LINK_DOWN')):backend.cancel(r,c),stop:(r,c)=>link.downUntil>=iteration?Promise.reject(new Error('LINK_DOWN')):backend.stop(r,c)};
 await mkdir(join(o.outDir,'source'),{recursive:true,mode:0o700});
 const source=await SourceSession.open(join(o.outDir,'source'),runId,nowMs,{project,navigation:{mapId:o.world.mapId,mapRevision:o.world.mapRevision,bindings:o.world.bindings},robots:roles.robots.map(r=>({...r,trays:1})),stationIds:[roles.stationId],...scenario.fleet?{fleet:scenario.fleet}:{}},true);
 const draws=new Map<string,ReturnType<typeof actorStream>>(),draw=(actor:string,range:readonly [number,number])=>{const s=draws.get(actor)??actorStream(o.seed,actor);draws.set(actor,s);return s.int(range[0],range[1]);};
 const workload:Work[]=scenario.orders.map((x,i)=>({actor:x.actor,tableId:roles.tables[x.table]!,quantity:x.quantity,atTick:draw(x.actor,x.atTick),sessionId:`sil-session-${i+1}`,placed:false}));
 for(const r of roles.robots)manifests.set(r.id,{id:r.id,adapter:'simulator',protocolVersion:'1',firmware:`${GAZEBO_NAV2.id}@${GAZEBO_NAV2.version}`,capabilities:['delivery'],mapId:o.world.mapId,mapRevision:o.world.mapRevision,offlineExecution:true,maxLoadMinor:'10000',trays:1,validation:'simulated'});
 const adapters=roles.robots.map(r=>new SimulatedNavigationAdapter(linked,manifests.get(r.id)!,nowMs));
 const observations:RobotEvent[]=[];for(const a of adapters)a.observe(e=>observations.push(e));
 const recorder=new TelemetryRecorder(),ingest=createTelemetryIngest(recorder,{runId,monotonicNs:()=>process.hrtime.bigint()});
 const contacts:JsonObject[]=[],ingestLog={accepted:0,rejected:0,stale:0,duplicate:0,gap:0};
 const barriers=createBarrierCoordinator({monotonicNs:()=>process.hrtime.bigint(),timeoutNs:BigInt(barrierTimeoutMs)*1_000_000n});
 // what the worker shows: contact-sensor liveness per robot (a physics row needs a live sensor, not just an empty list) and footprint separation
 const sensorReports:JsonObject[]=[],poseSensorReports:JsonObject[]=[],contactGaps=new Set<string>(),poseGaps=new Set<string>();
 const liveness=new Map<string,number>(),separation={samples:0,min:null as null|{gapM:number;tick:number;a:string;b:string}};
 const stopEvents=backend.onEvent(e=>{
  if(link.dropEventsUntil>=iteration)return;                                                                  // reboot: the link is gone, events with it
  if(e.event==='telemetry'){const entity=String(e.payload.entityId);if((sensorDrop.get(entity)??0)>0){sensorDrop.set(entity,sensorDrop.get(entity)!-1);return;}lastSample.set(entity,e.payload);const r=ingest.accept(e.payload);ingestLog[r.status]++;if(e.payload.quality!=='valid'||['rejected','stale','gap'].includes(r.status))poseGaps.add(entity);}
  else if(e.event==='pose-sensor')poseSensorReports.push(e.payload);
  else if(e.event==='contact')contacts.push(e.payload);
  else if(e.event==='contact-sensor'){sensorReports.push(e.payload);const r=String(e.payload.robot);if(e.payload.alive===true)liveness.set(r,(liveness.get(r)??0)+1);else contactGaps.add(r);}
  else if(e.event==='separation'){const g=Number(e.payload.gapM);if(Number.isFinite(g)){separation.samples++;if(!separation.min||g<separation.min.gapM)separation.min={gapM:g,tick:Number(e.payload.tick),a:String(e.payload.a),b:String(e.payload.b)};}}
  else if(e.event==='fault')faultLog.push({...e.payload,source:'worker'});
  else if(e.event==='barrier'){try{acceptAck(String(e.payload.barrierId),e.payload);}catch(error){attention.push({reason:`BARRIER_ERROR:${(error as Error).message}`,iteration});}}
 });
 let op=0;const attention:{reason:string;robotId?:string;subjectId?:string;iteration:number}[]=[],confirmations=new Map<string,{due:number;type:string;robotId:string;barrier?:'pending'|'complete'|'failed'}>(),parking=new Map<string,string>();
 const submit=(type:string,payload:JsonObject,robotId?:string)=>source.submit(type,payload,`op-${++op}`,robotId);
 const must=async(type:string,payload:JsonObject)=>{const r=await submit(type,payload);if(r.status!=='accepted')throw Object.assign(new Error('SCRIPTED_INPUT_REJECTED'),{code:r.code??r.status});return r;};
 let suspended=false,iteration=0,status:SilRunManifest['status']='timeout',barrierAttention=0;
 const placeOrder=async(w:Work)=>{
  await must('Session.Open',{sessionId:w.sessionId,tableId:w.tableId});
  const placed=await must('Order.Place',{sessionId:w.sessionId,tableId:w.tableId,menuVersion:1,items:[{itemId:mealFor(roles.stationId),quantity:String(w.quantity)}]});
  w.lineId=(placed.value.lineIds as string[])[0]!;
  await must('Kitchen.Ready',{lineId:w.lineId,quantity:String(w.quantity),stationId:roles.stationId,expectedVersion:(await source.read('fulfillment',w.lineId)).version});
  const a=await must('Fulfillment.Allocate',{lineId:w.lineId,quantity:String(w.quantity),expectedVersion:(await source.read('fulfillment',w.lineId)).version,method:'robot'});
  w.allocationId=String(a.value.allocationId);w.placed=true;
  if(scenario.batch)return;
  w.missionId=String((await must('Mission.Create',{allocationIds:[w.allocationId],...scenario.requestRobot?{robotId:roles.robots[0]!.id}:{},...scenario.loadMinor?{loadMinor:scenario.loadMinor}:{}})).value.missionId);
 };
 const outcome=(faultId:string,entityId:string,result:string)=>{const f=faultLog.find(x=>x.faultId===faultId&&x.entityId===entityId&&x.outcome===undefined);if(f)f.outcome=result;};
 const drain=async()=>{
  while(observations.length){
   let e=observations.shift()!;let robotId=String(e.payload.robotId);
   if(pendingReorder.has(robotId)&&observations.length){pendingReorder.delete(robotId);const next=observations.shift()!;observations.unshift(e);e=next;robotId=String(e.payload.robotId);outcome('reorder-observation',robotId,'swapped');}
   const r=await submit('Robot.Observe',robotEventCommand(e),robotId);
   if(r.status!=='accepted'){attention.push({reason:`OBSERVATION_REJECTED:${String(r.code)}`,robotId,iteration});continue;}
   if(pendingDup.delete(robotId)){                                                                              // a replay: refused, or accepted as a no-op; never a second effect in the journal
    const before=(await source.journal()).length,again=await submit('Robot.Observe',robotEventCommand(e),robotId);
    const appended=(await source.journal()).slice(before).flatMap(j=>(j.payload.events as unknown as DomainEvent[]).map(x=>x.type));
    outcome('duplicate-observation',robotId,again.status!=='accepted'?`rejected:${String(again.code)}`:`accepted:${appended.join('+')||'no-op'}`);
   }
   if(['failed','rejected','unknown'].includes(e.type))attention.push({reason:typeof e.payload.reason==='string'?e.payload.reason:`ROBOT_${e.type.toUpperCase()}`,robotId,subjectId:String(e.payload.missionId),iteration});
  }
 };
 const acceptAck=(barrierId:string,a:JsonObject)=>barriers.ack(barrierId,String(a.participant),{simTimeNs:typeof a.simTimeNs==='string'?a.simTimeNs:null,clockNs:typeof a.clockNs==='string'?a.clockNs:''});
 const confirmStop=async(key:string)=>{
  const [missionId,stopId]=key.split('/') as [string,string],x=confirmations.get(key)!;
  if(x.type!=='standby'&&x.barrier!=='complete'){
   if(x.barrier)return;
   x.barrier='pending';
   const barrierId=`${missionId}:${stopId}`;
   // Await completion outside the campaign loop: the loop must keep polling events and advancing barrier deadlines.
   void barriers.awaitTransferBarrier(barrierId,[x.robotId]).then(()=>{if(x.barrier==='pending')x.barrier='complete';},()=>{x.barrier='failed';});
   void backend.barrier(barrierId,[x.robotId]).then(reply=>{
    if(reply.barrierId!==barrierId)throw new Error('BARRIER_ID_MISMATCH');
    for(const a of (reply.acks as JsonObject[]|undefined)??[])acceptAck(barrierId,a);
   }).catch(error=>{x.barrier='failed';attention.push({reason:`BARRIER_ERROR:${(error as Error).message}`,subjectId:stopId,robotId:x.robotId,iteration});});
   return;
  }
  confirmations.delete(key);
  const m=await source.read('mission',missionId),r=await submit('Mission.ConfirmStop',{missionId,expectedVersion:m.version,missionRevision:m.state.revision!,stopId});
  if(r.status!=='accepted'){attention.push({reason:`CONFIRMATION_REJECTED:${String(r.code)}`,subjectId:stopId,robotId:x.robotId,iteration});return;}
  if(r.value.status==='completed'&&scenario.park&&!suspended&&parking.get(x.robotId)!==missionId&&!r.value.assignedMissionId){
   const parkingId=roles.robots.find(rb=>rb.id===x.robotId)!.parkingId,created=await submit('Mission.Create',{robotId:x.robotId,stops:[{action:'standby',targetId:parkingId}]});
   if(created.status==='accepted')parking.set(x.robotId,String(created.value.missionId));else attention.push({reason:`PARKING_REJECTED:${String(created.code)}`,robotId:x.robotId,iteration});
  }
 };
 const scanArrivals=async()=>{
  for(const {id} of roles.robots){
   const robot=await source.read('robot',id);if(typeof robot.state.missionId!=='string')continue;
   const m=await source.read('mission',robot.state.missionId),stop=(m.state.stops as JsonObject[]).find(s=>s.id===m.state.currentStopId),key=`${m.ref.id}/${String(stop?.id)}`;
   if(!stop||stop.status!=='awaiting_action'||confirmations.has(key)||m.state.status!=='executing')continue;
   const type=String(stop.action);
   confirmations.set(key,{due:type==='standby'?iteration:iteration+scenario.confirm.delayTicks,type,robotId:id});
   if(type==='standby')await confirmStop(key);
  }
 };
 const missionsDone=async()=>{
  if(workload.some(w=>!w.placed||!w.missionId))return false;
  for(const w of workload)if((await source.read('mission',w.missionId!)).state.status!=='completed')return false;
  if(!scenario.park)return true;
  for(const r of roles.robots){const s=(await source.read('robot',r.id)).state;if(s.missionId||s.availability!=='idle'||s.position!==r.parkingId)return false;}
  return true;
 };
 try{
  for(iteration=0;iteration<o.maxIterations;iteration++){
   if(!suspended){
    try{
     for(const w of workload)if(!w.placed&&w.atTick<=iteration)await placeOrder(w);
     if(scenario.batch&&workload.length&&workload.every(w=>w.placed&&!w.missionId)){const missionId=String((await must('Mission.Create',{allocationIds:workload.map(w=>w.allocationId!)})).value.missionId);for(const w of workload)w.missionId=missionId;}
     for(const [key,x] of [...confirmations])if(x.due<=iteration&&scenario.confirm.mode==='scripted')await confirmStop(key);
    }catch(e){if((e as Error).message!=='SCRIPTED_INPUT_REJECTED')throw e;attention.push({reason:`SCRIPTED_INPUT_REJECTED:${(e as {code:string}).code}`,iteration});suspended=true;}
   }
   for(const f of schedule.due(iteration)){const r=faultRegistry.resolve(f.faultId,f.payload);if(r.ok)r.injector.inject(f.entityId??null,f.payload);faultLog.push({faultId:f.faultId,entityId:f.entityId??null,atTick:f.atTick,iteration,scope:'orchestrator',applied:r.ok});}
   for(const a of adapters)await dispatchRobotEffects(source.store,source.scope,a,nowMs());
   await drain();
   for(const a of adapters)await a.poll();
   await drain();await scanArrivals();
   barriers.tick();
   for(const b of barriers.attention().slice(barrierAttention))attention.push({reason:`BARRIER_TIMEOUT:${b.barrierId}:${b.missing.join(',')}`,iteration});
   barrierAttention=barriers.attention().length;
   if(attention.length){status='needs_attention';break;}
   if(await missionsDone()){status='completed';break;}
   if(o.paceMs>0)await sleep(o.paceMs);else await new Promise<void>(resolve=>setImmediate(resolve));
  }
  if(status==='timeout'&&[...confirmations.values()].some(x=>x.barrier==='pending')){status='needs_attention';for(const b of barriers.records().filter(b=>b.status==='pending'))attention.push({reason:`BARRIER_INCOMPLETE:${b.barrierId}:${b.missing.join(',')}`,iteration});}
  // ---- evidence ----
  const journal=(await source.journal()).map(entry=>({sequence:entry.sequence,at:entry.recordedAt,events:(entry.payload.events as unknown as DomainEvent[]).map(e=>({type:e.type,kind:String(e.data.kind),id:String(e.data.id),state:(e.data.state??{}) as JsonObject}))}));
  const effects=(await source.effects()).filter(e=>String(e.type).startsWith('robot.')).map(e=>({id:String(e.id),type:String(e.type),status:String(e.status),attempts:Number(e.attempts),payload:e.payload as JsonObject}));
  const types=journal.flatMap(j=>j.events.map(e=>e.type));
  let served=0n;for(const w of workload)if(w.lineId)served+=BigInt(String((await source.read('fulfillment',w.lineId)).state.served??'0'));
  const missions=(await source.store.snapshots(source.scope)).filter(s=>s.ref.kind==='mission').map(s=>String(s.state.status));
  const business={served:String(served),missions:{completed:missions.filter(s=>s==='completed').length,needsAttention:missions.filter(s=>s==='needs_attention').length,open:missions.filter(s=>!FINAL.includes(s)&&s!=='needs_attention').length}};
  const physics=capability.evidence==='sil'&&capability.available;
  const physicsAssessment=assessPhysicsObservations({robots:roles.robots.map(r=>r.id),contacts,liveness:Object.fromEntries(liveness),contactGaps:[...contactGaps],poseGaps:[...poseGaps],separation});
  const expected=workload.reduce((n,w)=>n+w.quantity,0);
  const arrivals=types.filter(t=>t==='MissionArrived').length,observedCompleted=journal.flatMap(j=>j.events).filter(e=>e.type==='RobotCommandObserved'&&e.state.status==='completed').length;
  const lastMission=[...journal.flatMap(j=>j.events)].reverse().find(e=>e.type==='MissionCreated');
  const standby=lastMission&&((lastMission.state.stops as JsonObject[])??[]).every(s=>s.action==='standby'&&roles.robots.some(r=>r.parkingId===s.targetId));
  const assertions:SilAssertion[]=[
   {id:`${scenario.id}.served-after-handoff`,...served===BigInt(expected)&&expected>0&&types.indexOf('CargoLoaded')<types.indexOf('DeliveryHandedOff')&&types.includes('DeliveryHandedOff')?{result:'pass',detail:`served ${served}/${expected} after CargoLoaded`}:{result:'fail',reason:'SERVED_MISMATCH',detail:`served ${served}/${expected}`}},
   {id:`${scenario.id}.arrival-from-observation`,...arrivals>0&&arrivals===observedCompleted?{result:'pass',detail:`${arrivals} arrivals from ${observedCompleted} observed completions`}:{result:'fail',reason:'ARRIVAL_WITHOUT_OBSERVATION',detail:`${arrivals} arrivals, ${observedCompleted} observed completions`}},
   ...scenario.park?[{id:`${scenario.id}.parked-not-charging`,...status==='completed'&&standby?{result:'pass' as const,detail:'last mission is a standby at the robot parking point'}:{result:'fail' as const,reason:'NOT_PARKED'}}]:[],
   {id:'SIM.progress-or-reason',...status==='completed'?{result:'pass',detail:`completed in ${iteration+1} iterations`}:status==='needs_attention'?{result:'pass',detail:`explicit attention: ${attention.map(a=>a.reason).join(',')}`}:{result:'fail',reason:'NO_PROGRESS:ITERATION_LIMIT',detail:`${o.maxIterations} iterations without completion or an explicit reason`}},
   ...physicsAssessment.map(a=>physics?a:{id:a.id,result:'not_run' as const,reason:a.reason==='SINGLE_ROBOT'?'SINGLE_ROBOT':'PHYSICS_EVIDENCE_MISSING',detail:`backend evidence ${capability.evidence}`}),
  ];
  // Canonical business form: runtime UUIDs become logical ids, wall-clock stamps (keys *At/*AtMs, ISO strings) are dropped; causal order, ids, quantities and statuses stay.
  const canonical=(v:unknown):unknown=>{const ids=new Map<string,string>();const norm=(x:unknown):unknown=>typeof x==='string'?(ISO.test(x)?'<time>':x.replace(UUID,m=>{const k=m.toLowerCase();if(!ids.has(k))ids.set(k,`uuid#${ids.size+1}`);return ids.get(k)!;})):Array.isArray(x)?x.map(norm):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>k!=='at'&&!/At(Ms)?$/.test(k)).map(([k,y])=>[k,norm(y)])):x;return norm(v);};
  const businessDigest=hashJson(canonical({events:journal.map(j=>j.events),outcome:{status,served:business.served},effects:effects.map(e=>({type:e.type,status:e.status,attempts:e.attempts}))}));
  const files:Record<string,string>={'journal.json':JSON.stringify(journal),'effects.json':JSON.stringify(effects),
   'telemetry.json':JSON.stringify({...recorder.report(),source:'gazebo_nav2 worker events',ingest:ingestLog,sensorReports:poseSensorReports}),
   'contacts.json':JSON.stringify({available:physics,...physics?{}:{reason:'PHYSICS_EVIDENCE_MISSING'},evidence:capability.evidence,physicsAssessment,contacts,sensorReports,coverage:{contactGaps:[...contactGaps].sort(),poseGaps:[...poseGaps].sort()},liveness:Object.fromEntries(liveness),separation:{samples:separation.samples,min:separation.min}}),
   'barriers.json':JSON.stringify(barriers.records()),'faults.json':JSON.stringify(faultLog),'assertions.json':JSON.stringify(assertions)};
  for(const [name,text] of Object.entries(files))await writeFile(join(o.outDir,name),text);
  const manifest:SilRunManifest={schemaVersion:1,runId,sourceCommit:o.sourceCommit,mode:'simulation',access:'simulated',backendSetId:o.backendSetId,backends:required,
   scenario:{id:scenario.id,revision:scenario.revision,hash:scenarioHash(scenario)},project:{id:project.id,revision:project.revision,hash:hashJson(project)},
   world:{inputHash:o.world.inputHash,manifestHash:o.world.manifestHash,mapId:o.world.mapId,mapRevision:o.world.mapRevision},seed:o.seed,prng:{...PRNG},clock:{iterationMs:SIL_TICK_MS,source:'orchestrator iteration; the worker runs on its own /clock'},
   evidence:capability.evidence,backendCapability:capability,status,iterations:iteration+1,businessDigest,hashAlgorithm:'sha256-canonical-json-v1',
   outputs:Object.entries(files).map(([path,text])=>({path,sha256:createHash('sha256').update(text).digest('hex')})),
   limitations:['Business results come from the source journal; physics rows need a real SIL worker (evidence sil) and stay not_run otherwise.','Mock-only scenario obstacles are ignored in SIL; scene actors/blockers come from the scenario fixture through the compiled world.',...physics?[]:[`Backend evidence is ${capability.evidence}: no plant telemetry, no contacts, no separation.`]]};
  manifest.manifestHash=hashJson(manifest);
  await writeFile(join(o.outDir,'run-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {manifest,business,assertions};
 }finally{stopEvents();await backend.close().catch(()=>{});await source.close();}
}
