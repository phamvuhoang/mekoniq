// One native run owns the source journal, workflow, provider session and durable action receipts.
// No virtual navigation/arm plant participates in this lifecycle.
import type {NativeFaultExpectation} from './native-fault-oracle';
import {validateFaultSchedule,type FaultScheduleEntry} from '../fault-schedule';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {DomainEvent,JsonObject} from '../../../../contracts/src/index';
import {dispatchRobotEffects,robotEventCommand} from '../../../../robot-adapters/src/dispatch';
import type {RobotEvent} from '../../../../robot-adapters/src/contract';
import {validateProjectV2,validateActionV2,type LabProjectV2} from '../contracts';
import {scenarioRegistry,resolveRoles,scenarioHash,checkScenario} from '../scenario-registry';
import {requiredBackends} from '../scenario-matrix';
import {defaultCatalog} from '../capabilities';
import {SourceSession} from '../session';
import {CoffeeDriver,initialCoffee,COFFEE_RECIPES,type CoffeeState,type CoffeeContext} from '../scenarios/coffee';
import type {CoffeePlantPorts} from '../beverage/coffee-ports';
import type {TransferObservation} from '../beverage/cup-ledger';
import type {RunManifestInput,RunProviders,ScenarioRun,RunView} from '../scenario-runner';
import type {RunReport,Attention,EntityView} from '../report';
import type {ArmCollisionEvidenceRecord} from '../arm/session';
import type {RunVerification} from '../reports/verification';
import {withVerification} from '../reports/verification';
import {hashJson} from '../hash';
import {actorStream,PRNG} from '../random';
import {readCheckpoint,writeCheckpoint} from '../checkpoint';
import {TelemetryRecorder} from '../telemetry';
import {createTelemetryIngest} from '../backends/telemetry-ingest';
import {SimulatedNavigationAdapter} from '../backends/simulated-navigation';
import type {GazeboBackend,CompiledWorld} from '../backends/gazebo-nav2';
export interface NativeObservedSnapshot {simTimeNs:string|null;entities:EntityView[];dock:{robotId:string;errorM:number;moving:boolean;localizationValid:boolean;bootId:string};receiver:{robotId:string;slot:number}|null}
export interface NativeEvidenceSnapshot {arm:ArmCollisionEvidenceRecord|null;armTickMap:NonNullable<RunVerification['armTickMap']>;transfers:TransferObservation[];raw:Record<string,unknown>;blockers:string[]}
export interface NativePlant {
 backend:GazeboBackend;evidenceKind:'native'|'protocol_double';descriptors:RunReport['manifest']['backends'];models:RunReport['manifest']['models'];profiles:RunReport['manifest']['profiles'];
 coffeePorts(state:CoffeeState,context:CoffeeContext):Promise<CoffeePlantPorts>;
 latest():NativeObservedSnapshot;
 samples():readonly import('../contracts').TwinSampleV2[];
 poll(runTick:number,clockOriginNs?:string):Promise<void>;
 pause(paused:boolean):Promise<{status:'paused'|'resumed'|'partial'|'unknown'}>;
 /** This promise runs outside the mutation queue. Provider observation listeners and deadline timers remain live. */
 barrier(key:string,robotId:string):Promise<void>;
 awaitObservationWindow?():Promise<void>;injectFault?(entry:FaultScheduleEntry):Promise<void>;freeze?():void;holdForReconcile():Promise<void>;evidence():Promise<NativeEvidenceSnapshot>;close():Promise<void>;
}
export interface NativeProviderFactory {faultExpectation?:NativeFaultExpectation;validateSchedule?(entries:FaultScheduleEntry[]):void;configurationHash?:string;world:CompiledWorld;project:LabProjectV2;open(input:RunManifestInput,runId:string,directory:string,signal:AbortSignal):Promise<NativePlant>}
interface NativeCheckpoint {reconciliations?:RunReport['reconciliations'];rejected?:RunReport['rejectedObservations'];epochMs:number;clockOriginNs?:string;version:1;id:string;identity:string;manifest:RunReport['manifest'];coffee:CoffeeState;tick:number;simTimeNs:string;ordinal:number;revision:number;started:boolean;paused:boolean;held:boolean;complete:boolean;attention:Attention[];receipts:Record<string,{hash:string;view?:RunView}>;lastView?:RunView;report?:RunReport;confirmations:Record<string,{missionId:string;stopId:string;robotId:string;due:number;barrier:'pending'|'complete'|'failed'}>}
const TICK_NS=20_000_000n;
async function bounded<T>(promise:Promise<T>,ms:number,label:string):Promise<T>{let timeout:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error(label)),ms);})]);}finally{clearTimeout(timeout);}}

export const nativeProjectGeometry=(project:LabProjectV2)=>({...project,revision:0,updatedAt:'',faultSchedule:[]});
export function assertNativeAdmission(input:RunManifestInput,p:RunProviders,f:NativeProviderFactory){
 const scenario=(p.scenarios??scenarioRegistry).get(input.scenarioId);if(!scenario)throw new Error('SCENARIO_UNSUPPORTED');checkScenario(scenario);
 if(!scenario.coffee||scenario.orders.length)throw new Error('NATIVE_SCENARIO_UNSUPPORTED');
 if(scenario.revision!==input.scenarioRevision)throw new Error('SCENARIO_REVISION_MISMATCH');
 if(input.mode!=='simulation'||input.access!=='simulated')throw new Error('MODE_BACKEND_MISMATCH');
 const set=(p.catalog??defaultCatalog).sets[input.backendSetId],required=requiredBackends(scenario,'simulation');
 if(!set||set.mode!=='simulation')throw new Error('BACKEND_SET_UNKNOWN');
 if([...set.backends].sort().join()!==[...required].sort().join())throw new Error('BACKEND_SET_EXACT_MISMATCH');
 if(required.some(b=>!(p.enabledBackends??required).includes(b)))throw new Error('BACKEND_MISSING');
 const valid=validateProjectV2(input.project);if(!valid.ok)throw new Error('INVALID_PROJECT');
 resolveRoles(scenario,valid.value);
 const schedule=validateFaultSchedule(valid.value.faultSchedule??[],valid.value.entities,'simulation');f.validateSchedule?.(schedule);
 if(hashJson(nativeProjectGeometry(valid.value))!==hashJson(nativeProjectGeometry(f.project)))throw new Error('NATIVE_FIXTURE_MISMATCH:select native-bv01 project');
 if(!Number.isSafeInteger(input.seed)||input.seed<0||input.seed>0xffffffff)throw new Error('INVALID_SEED');
 return {scenario,project:valid.value};
}
export interface NativeScenarioRun extends ScenarioRun {awaitObservationWindow():Promise<void>}
export async function createNativeScenarioRun(input:RunManifestInput,p:RunProviders,f:NativeProviderFactory,policy:{deadlineMs?:number;paceMs?:number}={}):Promise<NativeScenarioRun>{
 const {scenario,project}=assertNativeAdmission(input,p,f),roles=resolveRoles(scenario,project),directory=p.directory;
 const deadlineMs=policy.deadlineMs??3_600_000,paceMs=policy.paceMs??20;
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>3_600_000||!Number.isSafeInteger(paceMs)||paceMs<1)throw new Error('NATIVE_DEADLINE_INVALID');
 await mkdir(directory,{recursive:true,mode:0o700});
 const identity=hashJson({input,world:f.world.inputHash,providers:f.configurationHash??null}),prior=await readCheckpoint<NativeCheckpoint>(directory);
 if(prior&&prior.identity!==identity)throw new Error('RUN_IDENTITY_MISMATCH');
 const draws=new Map<string,ReturnType<typeof actorStream>>(),draw=(actor:string,r:readonly [number,number])=>{const d=draws.get(actor)??actorStream(input.seed,actor);draws.set(actor,d);return d.int(...r);};
 const id=prior?.id??randomUUID();
 const manifest:RunReport['manifest']=prior?.manifest??{...project.faultSchedule?.length?{faultSchedule:{entries:project.faultSchedule,hash:hashJson(project.faultSchedule)}}:{},runId:id,sourceCommit:input.sourceCommit,mode:'simulation',access:'simulated',backendSetId:input.backendSetId,backends:[],prng:PRNG,clock:{tickMs:20},seed:input.seed,scenario:{id:scenario.id,revision:scenario.revision,hash:scenarioHash(scenario)},project:{id:project.id,revision:project.revision,hash:hashJson(project)},world:{id:project.world.id,revision:project.world.revision,hash:hashJson(project.world)},assets:project.entities.map(e=>({...e.assetRef,resolved:true})),hashAlgorithm:'sha256-canonical-json-v1',designHash:hashJson(project.entities),adapterHash:hashJson(requiredBackends(scenario,'simulation')),configuration:{revision:1,hash:hashJson({world:f.world.inputHash,providers:f.configurationHash??null,clock:'gazebo_clock',deadlineMs})},recipes:COFFEE_RECIPES.map(r=>({id:r.id,revision:r.revision,hash:r.hash})),models:[],profiles:[],calibration:{status:'not_calibrated',revision:null,hash:null,reason:'SIM_MODEL_NOT_CALIBRATED'}};
 const cp:NativeCheckpoint=prior??{epochMs:Date.now(),version:1,id,identity,manifest,coffee:initialCoffee(scenario.coffee!.orders,roles.coffee!,roles.tables,draw),tick:0,simTimeNs:'0',ordinal:0,revision:0,started:false,paused:false,held:false,complete:false,attention:[],receipts:{},confirmations:{}};
 let persistence:Promise<void>=Promise.resolve();
 const persist=()=>{const saved=structuredClone(cp);persistence=persistence.then(()=>writeCheckpoint(directory,saved,{sync:true}));return persistence;};
 // Persist identity before opening a provider or issuing any effect. Reopen is deliberately read-only.
 await persist();await mkdir(join(directory,'source'),{recursive:true,mode:0o700});
 const telemetry=new TelemetryRecorder(),abort=new AbortController();
 const source=await SourceSession.open(join(directory,'source'),id,()=>cp.epochMs+cp.tick*20,{project,epochMs:cp.epochMs,navigation:{mapId:f.world.mapId,mapRevision:f.world.mapRevision,bindings:f.world.bindings},robots:roles.robots.map(r=>({...r,trays:1})),stationIds:[roles.stationId],coffee:{...roles.coffee!,recipes:CoffeeDriver.recipes(scenario.coffee!.orders)}},!prior);
 let plant:NativePlant|undefined,coffee:CoffeeDriver|undefined,closed=false,closing:Promise<void>|undefined,queue:Promise<unknown>=Promise.resolve(),timer:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
 const tasks=new Set<Promise<unknown>>(),events:RobotEvent[]=[],ingest=createTelemetryIngest(telemetry,{runId:id,monotonicNs:()=>process.hrtime.bigint(),sampleTick:s=>cp.clockOriginNs&&s.simTimeNs?Math.max(0,Number((BigInt(s.simTimeNs)-BigInt(cp.clockOriginNs))/TICK_NS)):0}),unsubs:(()=>void)[]=[];
 const enqueue=<T>(fn:()=>Promise<T>):Promise<T>=>{const task=queue.then(()=>{if(closed)throw new Error('RUN_CLOSED');return fn();});queue=task.catch(()=>{});return task;};
 let holding:Promise<void>|undefined,actionMutation=false;
 const hold=()=>{clearTimeout(deadline);clearTimeout(timer);if(!cp.held&&!actionMutation)cp.revision++;cp.held=true;abort.abort();void persist();return holding??=(bounded(plant?.holdForReconcile()??Promise.resolve(),5000,'NATIVE_HOLD_TIMEOUT').catch(e=>{if(!cp.attention.some(a=>a.reason===String(e.message))){cp.attention.push({reason:String(e.message),tick:cp.tick});if(!actionMutation)cp.revision++;}}).then(()=>persist()));};
 const attention=(reason:string)=>{if(!cp.attention.some(a=>a.reason===reason)){if(cp.held&&!actionMutation)cp.revision++;cp.attention.push({reason,tick:cp.tick});}void hold();};
 const submit=async(type:string,payload:JsonObject,observer?:string)=>{if(cp.started)abort.signal.throwIfAborted();const op=++cp.ordinal;await persist();return source.submit(type,payload,`native-op-${op}`,observer);};
 const must:CoffeeContext['must']=async(type,payload)=>{const r=await submit(type,payload);if(r.status!=='accepted')throw new Error(`SCRIPTED_INPUT_REJECTED:${r.code??r.status}`);return r;};
 const track=(task:Promise<unknown>)=>{tasks.add(task);void task.finally(()=>tasks.delete(task)).catch(()=>{});};
 const confirm=async(missionId:string,stopId:string,robotId:string)=>{
  const key=`${missionId}:${stopId}`,x=cp.confirmations[key];
  if(!x){cp.confirmations[key]={missionId,stopId,robotId,due:cp.tick+scenario.confirm.delayTicks,barrier:'pending'};await persist();
   track(plant!.barrier(`${id}:${key}`,robotId).then(()=>enqueue(async()=>{cp.confirmations[key]!.barrier='complete';await persist();})).catch(e=>enqueue(async()=>{cp.confirmations[key]!.barrier='failed';attention(`BARRIER:${String(e.message)}`);await persist();})));return;}
  if(x.barrier!=='complete'||cp.tick<x.due)return;
  const m=await source.read('mission',missionId),r=await submit('Mission.ConfirmStop',{missionId,expectedVersion:m.version,missionRevision:m.state.revision!,stopId});
  if(r.status!=='accepted')throw new Error(`CONFIRMATION_REJECTED:${r.code}`);
  delete cp.confirmations[key];
  if(r.value.status==='completed'&&scenario.park&&!r.value.assignedMissionId&&(m.state.stops as JsonObject[]).some(s=>s.action!=='standby')){const parkingId=roles.robots.find(rb=>rb.id===robotId)!.parkingId;await must('Mission.Create',{robotId,stops:[{action:'standby',targetId:parkingId}]});}
 };
 const adapters:SimulatedNavigationAdapter[]=[];
 const view=async():Promise<RunView>=>{
  let served=0n;for(const w of cp.coffee.workload)if(w.lineId)served+=BigInt(String((await source.read('fulfillment',w.lineId)).state.served??'0'));
  const j=await source.journal();const result:RunView={run:{schemaVersion:2,id,mode:'simulation',access:'simulated',backendSetId:input.backendSetId,backends:requiredBackends(scenario,'simulation'),status:cp.held?'needs_attention':cp.complete?'completed':!cp.started?'ready':cp.paused?'paused':'running',runRevision:cp.revision,eventCursor:j.at(-1)?.sequence??null,telemetryCursor:telemetry.cursor(),fidelity:'modeled',ageMs:null,sourceCommit:input.sourceCommit,scenarioId:scenario.id,scenarioRevision:scenario.revision,seed:input.seed},tick:cp.tick,simTimeNs:cp.simTimeNs,model:'gazebo_nav2 + linuxcnc_sim + coffee_io_sim',entities:plant?.latest().entities??cp.lastView?.entities??[],workload:[],awaiting:[],attention:structuredClone(cp.attention),served:String(served),coffee:coffee?await coffee.view():cp.lastView?.coffee??null,...prior?{controlAccess:'view_reconcile' as const}:{}};cp.lastView=result;return structuredClone(result);
 };
 const journal=async()=>(await source.journal()).map(entry=>({sequence:entry.sequence,at:entry.recordedAt,events:(entry.payload.events as unknown as DomainEvent[]).map(e=>({type:e.type,kind:String(e.data.kind),id:String(e.data.id),state:(e.data.state??{}) as JsonObject}))}));
 const report=async():Promise<RunReport>=>{
  if((prior||cp.complete)&&cp.report)return {...structuredClone(cp.report),reconciliations:structuredClone(cp.reconciliations??[]),attention:structuredClone(cp.attention)};
  const v=await view(),j=await journal(),e=plant?await plant.evidence():{arm:null,armTickMap:[],transfers:[],raw:{},blockers:['NATIVE_REOPEN_RECONCILE_REQUIRED']},native=plant?.evidenceKind==='native';
  if(plant)telemetry.record(plant.samples());
  const files:Record<string,unknown>={...e.raw,'project.json':project,'arm-tick-map.json':e.armTickMap,'transfer-observations.json':e.transfers,'source-events.json':j,'telemetry.json':telemetry.report()};
  const artifacts:RunVerification['artifacts']=[];
  for(const [path,value] of Object.entries(files)){if(!/^[a-z0-9-]+\.json$/.test(path))throw new Error('NATIVE_ARTIFACT_PATH_INVALID');const bytes=JSON.stringify(value);await writeFile(join(directory,path),bytes);artifacts.push({path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)});}
  const samples=telemetry.report().samples,hasNav=samples.some(s=>s.providerId==='gazebo_nav2'),hasArm=e.armTickMap.length>1;
  const orderedEvents=j.flatMap(x=>x.events),deliveries=orderedEvents.filter(e=>e.type==='DeliveryHandedOff'),handoff=deliveries.length===cp.coffee.workload.length&&deliveries.every(delivery=>orderedEvents.some((load,i)=>load.type==='CargoLoaded'&&load.id===delivery.id&&i<orderedEvents.indexOf(delivery)));
  const transferComplete=cp.coffee.workload.every(w=>['grasp','release','receive'].every(phase=>e.transfers.some(t=>t.cupId===w.cupId&&t.phase===phase&&t.quality==='valid')));
  const blockers=[...e.blockers,...transferComplete?[]:['CUP_TRANSFER_COVERAGE_MISSING'],...telemetry.gaps.length?['TELEMETRY_COVERAGE_GAP']:[],...native?[]:['PROTOCOL_DOUBLE'],...hasNav?[]:['NAV_SAMPLES_MISSING'],...hasArm?[]:['ARM_SAMPLES_MISSING'],...e.arm?.result==='pass'?[]:['ARM03_COVERAGE_MISSING'],...cp.complete&&handoff&&BigInt(v.served)===BigInt(cp.coffee.workload.length)?[]:['BUSINESS_INCOMPLETE']];
  const faultLog=(e.raw['fault-evidence.json']??[]) as JsonObject[];
  const r:RunReport={schemaVersion:2,manifest:cp.manifest,outcome:{status:v.run.status,served:v.served,tick:cp.tick,simTimeNs:cp.simTimeNs},attention:v.attention,workload:[],entities:v.entities,businessEvents:j.flatMap(x=>x.events.map(e=>({...e,sequence:x.sequence,at:x.at}))),effects:(await source.effects()).map(x=>({id:String(x.id),type:String(x.type),status:String(x.status),attempts:Number(x.attempts),payload:x.payload as JsonObject})),metrics:{maxConcurrentMovers:0,distanceM:{},collision:{available:!e.blockers.some(b=>b.startsWith('CONTACT_SENSOR')),reason:'Single AMR: pairwise navigation separation is not applicable; arm clearance and contact coverage are in verified artifacts.',contacts:((e.raw['contacts.json'] as {contacts?:unknown[]}|undefined)?.contacts??[]).length,minSeparationM:null}},rejectedObservations:cp.rejected??[],reconciliations:cp.reconciliations??[],recoveredOps:[],confirmations:[],faults:faultLog.map(f=>({tick:Number(f.tick),faultId:`${f.id}:${f.status}`,entityId:typeof f.targetId==='string'?f.targetId:null})),faultScheduleFires:faultLog.filter(f=>f.status==='intent').map(f=>({id:String(f.id),tick:Number(f.tick),expiresAtMs:Number(f.tick)*20+Number((f.entry as JsonObject).durationMs),outcome:faultLog.some(x=>x.id===f.id&&['fired','observed_transition'].includes(String(x.status)))?'applied':faultLog.some(x=>x.id===f.id&&x.status==='unperformed')?'unknown':'dispatching',windowEnded:faultLog.some(x=>x.id===f.id&&x.status==='window-ended')})),coverage:{nativeExecution:native&&hasNav&&hasArm,armCollisionTraceComplete:e.arm?.result==='pass',physicalGrip:false},limitations:['Coffee I/O, cup/grip and geometric collision are modeled. Controller feedback and Gazebo physics are separate aspects; no hardware validation.','Reopened runs are read-only and require explicit external reconciliation; motion is never resent.'],...coffee?{coffee:await coffee.report()}:{},telemetry:{...telemetry.report(),source:plant?.evidenceKind??'reopened_native_journal'}};
  const verification:RunVerification={schemaVersion:1,execution:native&&hasNav&&hasArm?'ran':'not_run',result:native&&hasNav&&hasArm?(e.arm?.result==='fail'||e.blockers.includes('GAZEBO_CONTACT')||cp.attention.length?'fail':blockers.length?'not_run':'pass'):'not_run',blockers,target:'linux-vm-sim',aspects:artifacts.filter(a=>['arm-trace.json','telemetry.json','transfer-observations.json'].includes(a.path)).map(a=>({name:a.path,producer:plant?.evidenceKind??'reopened_native_journal',fidelity:a.path==='arm-trace.json'?'controller_sim':a.path==='telemetry.json'?'physics_sim':'modeled',artifactSha256:a.sha256})),arm:native?e.arm:e.arm?{...e.arm,result:'not_run',reasonCodes:[...e.arm.reasonCodes,'PROTOCOL_DOUBLE']}:null,armTickMap:e.armTickMap,transfers:e.transfers,artifacts};
  cp.report=withVerification(r,verification);await persist();await writeFile(join(directory,'report.json'),JSON.stringify(cp.report));return structuredClone(cp.report);
 };
 const pump=async()=>{
  if(cp.held||cp.complete||!cp.started||cp.paused)return;
  const time=plant!.latest().simTimeNs;
  if(time!==null){if(!/^\d+$/.test(time)||BigInt(time)<BigInt(cp.simTimeNs))throw new Error('GAZEBO_CLOCK_REGRESSION');cp.clockOriginNs??=time;cp.manifest.clock.native={provider:'gazebo_nav2',originNs:cp.clockOriginNs,businessEpochMs:cp.epochMs};cp.simTimeNs=time;cp.tick=Number((BigInt(time)-BigInt(cp.clockOriginNs))/TICK_NS);}
  await plant!.poll(cp.tick,cp.clockOriginNs);abort.signal.throwIfAborted();telemetry.record(plant!.samples());
  // Coffee durations advance only when Gazebo /clock advanced; polling never advances modeled process time.
  await coffee!.drain();if(cp.held)return;await coffee!.scripted();if(cp.held)return;await coffee!.dispatch();if(cp.held)return;await coffee!.advance();if(cp.held)return;await coffee!.drain();if(cp.held)return;
  for(const a of adapters){if(cp.held)return;await dispatchRobotEffects(source.store,source.scope,a,cp.epochMs+cp.tick*20);}
  for(const a of adapters){if(cp.held)return;await a.poll();}
  while(events.length){const ev=events.shift()!,r=await submit('Robot.Observe',robotEventCommand(ev),String(ev.payload.robotId));if(r.status!=='accepted')attention(`ROBOT_OBSERVATION_REJECTED:${r.code}`);}
  for(const rb of roles.robots){const robot=await source.read('robot',rb.id);if(typeof robot.state.missionId!=='string')continue;const m=await source.read('mission',robot.state.missionId),stop=(m.state.stops as JsonObject[]).find(s=>s.id===m.state.currentStopId);
   if(stop?.status==='awaiting_action'&&stop.action!=='load')await confirm(m.ref.id,String(stop.id),rb.id);}
  if(coffee!.done()){
   let complete=true;for(const rb of roles.robots){const r=await source.read('robot',rb.id);if(r.state.missionId||scenario.park&&r.state.position!==rb.parkingId)complete=false;}cp.complete=complete;
  }
  if(cp.complete){cp.revision++;clearTimeout(deadline);plant!.freeze?.();await bounded(plant!.holdForReconcile(),5000,'COMPLETION_STOP_TIMEOUT').catch(e=>attention(e.message));cp.report=undefined;await report();}
  await persist();
 };
 const schedule=()=>{if(closed||closing||cp.held||cp.complete||!cp.started)return;timer=setTimeout(()=>{void enqueue(async()=>{try{await pump();}catch(e){attention(`NATIVE_PUMP:${(e as Error).message}`);await plant?.holdForReconcile().catch(()=>{});await persist();}}).catch(()=>{}).finally(schedule);},paceMs);};
 try{
  if(prior){cp.held=true;cp.paused=true;attention('NATIVE_REOPEN_RECONCILE_REQUIRED');telemetry.gap('RUNTIME_RESTART',null,cp.tick);await persist();}
  else{
   plant=await f.open(input,id,directory,abort.signal);cp.manifest.backends=plant.descriptors;cp.manifest.models=plant.models;cp.manifest.profiles=plant.profiles;
   const cap=await plant.backend.capability();if(!cap.available||!cap.beverage?.available)throw new Error('NATIVE_BACKEND_OR_GRIP_UNAVAILABLE');
   unsubs.push(plant.backend.onEvent(e=>{if(e.event==='telemetry'&&!cp.complete&&!cp.held){const r=ingest.accept(e.payload);if(['gap','rejected','stale'].includes(r.status))telemetry.gap(`NAV_${r.status}`,null,cp.tick);}}));
   for(const rb of roles.robots){const a=new SimulatedNavigationAdapter(plant.backend,{id:rb.id,adapter:'simulator',protocolVersion:'1',firmware:'gazebo_nav2@1',capabilities:['delivery'],mapId:f.world.mapId,mapRevision:f.world.mapRevision,offlineExecution:true,maxLoadMinor:'10000',trays:1,validation:'simulated'},()=>cp.epochMs+cp.tick*20);adapters.push(a);unsubs.push(a.observe(e=>events.push(e)));}
   const context:CoffeeContext={source,runId:id,directory,nowMs:()=>cp.epochMs+cp.tick*20,tick:()=>cp.tick,submit,must,receiver:()=>plant!.latest().receiver,dock:()=>plant!.latest().dock,confirmLoad:confirm,createMission:async allocationId=>String((await must('Mission.Create',{allocationIds:[allocationId]})).value.missionId),attention:a=>{if(!cp.attention.some(x=>x.reason===a.reason&&x.subjectId===a.subjectId)){if(cp.held&&!actionMutation)cp.revision++;cp.attention.push({...a,tick:cp.tick});}void hold();},rejected:r=>{(cp.rejected??=[]).push({...r,tick:cp.tick});},suspend:()=>{void hold();}};
   coffee=new CoffeeDriver(cp.coffee,context,randomUUID,await plant.coffeePorts(cp.coffee,context));await coffee.initialize();await persist();
  }
 }catch(e){attention(`INITIALIZATION:${(e as Error).message}`);await hold();await persist();await plant?.close().catch(()=>{});await source.close();throw e;}
 const run:NativeScenarioRun={id,telemetry,awaitObservationWindow:()=>bounded(plant?.awaitObservationWindow?.()??Promise.resolve(),65000,'NATIVE_OBSERVATION_WINDOW_TIMEOUT'),pulse:()=>({tick:cp.tick,paused:cp.paused,runRevision:cp.revision}),snapshot:()=>enqueue(view),journal:()=>enqueue(journal),report:()=>enqueue(report),start:()=>prior?Promise.reject(new Error('NATIVE_RECONCILE_REQUIRED')):cp.receipts[`start-${id}`]?.view?Promise.resolve(structuredClone(cp.receipts[`start-${id}`]!.view!)):run.action({actionId:`start-${id}`,expectedRevision:cp.revision,kind:'start',payload:{}}),
  action:(raw,before)=>enqueue(async()=>{
   const checked=validateActionV2(raw);if(!checked.ok)throw new Error('INVALID_ACTION');const a=checked.value,h=hashJson(a),receipt=cp.receipts[a.actionId];
   if(receipt){if(receipt.hash!==h)throw new Error('ACTION_ID_CONFLICT');if(receipt.view)return structuredClone(receipt.view);throw new Error('ACTION_OUTCOME_UNKNOWN');}
   if(a.expectedRevision!==cp.revision)throw new Error('RUN_REVISION_CONFLICT');
   if((prior||cp.held)&&!['reconcile','cancel'].includes(a.kind))throw new Error('NATIVE_RECONCILE_REQUIRED');
   if(a.kind==='pause'||a.kind==='resume')throw new Error('NATIVE_PAUSE_UNSUPPORTED');
   if(!['start','cancel','reconcile','injectFault'].includes(a.kind))throw new Error(`NATIVE_ACTION_UNSUPPORTED:${a.kind}`);
   let injected:FaultScheduleEntry|undefined;if(a.kind==='injectFault'){injected={id:`action:${a.actionId}`,faultId:String(a.payload.faultId),targetId:String(a.payload.entityId),trigger:{kind:'elapsed_sim_ms',value:cp.tick*20},durationMs:1000};validateFaultSchedule([injected],project.entities,'simulation');f.validateSchedule?.([injected]);if(!plant?.injectFault)throw new Error('NATIVE_FAULT_UNSUPPORTED');}
   await before?.();actionMutation=true;try{cp.receipts[a.actionId]={hash:h};cp.revision++;await persist();
   if(a.kind==='injectFault'){try{await plant!.injectFault!(injected!);if(cp.held)await hold();}catch(e){attention(`FAULT_INJECTION_UNKNOWN:${(e as Error).message}`);await hold();await persist();throw e;}}
   else if(a.kind==='reconcile'){const subjectId=String(a.payload.subjectId??'run');const effects=await source.effects();(cp.reconciliations??=[]).push({subjectId,commandId:null,nativeState:`journal_only:${effects.filter(e=>e.status!=='completed').length}_unresolved_effects;external_provider_disposition_required`,tick:cp.tick});attention('NATIVE_RECONCILE_EXTERNAL_DISPOSITION_REQUIRED');}
   else if(a.kind==='start'){if(cp.started)throw new Error('RUN_ALREADY_STARTED');cp.started=true;deadline=setTimeout(()=>{if(closed||closing||cp.complete||cp.held)return;attention('NATIVE_DEADLINE_EXCEEDED');void enqueue(async()=>{await hold();await persist();});},deadlineMs);schedule();}
   else if(a.kind==='cancel'){attention('CANCEL_RECONCILE_REQUIRED');await hold();}

   const v=await view();cp.receipts[a.actionId]!.view=v;await persist();return v;}finally{actionMutation=false;}
  }),
  holdForReclaim:()=>enqueue(async()=>{attention('NATIVE_RECLAIM_RECONCILE_REQUIRED');await hold();await persist();return view();}),
  close(){if(closing)return closing;closing=(async()=>{clearTimeout(timer);clearTimeout(deadline);abort.abort();await bounded(plant?.holdForReconcile()??Promise.resolve(),5000,'NATIVE_HOLD_TIMEOUT').catch(e=>attention(e.message));await bounded(queue,15000,'NATIVE_DRAIN_TIMEOUT').catch(e=>attention(e.message));closed=true;for(const off of unsubs)off();await bounded(coffee?.close()??Promise.resolve(),5000,'NATIVE_COFFEE_CLOSE_TIMEOUT').catch(e=>attention(e.message));await bounded(plant?.close()??Promise.resolve(),15000,'NATIVE_PROVIDER_CLOSE_TIMEOUT').catch(e=>attention(e.message));await persist();await source.close();})();return closing;},
 };
 return run;
}
