// IR-SIM scenario runner (provider irsim_2d). The source runner is the only scheduler; per fixed 20 ms tick:
// scripted inputs -> source decisions/dispatch -> controller velocities -> one worker step -> verified ACK -> commit the logical clock -> observations -> journal.
// Business truth lives only in the run's source journal (production registry via SourceSession); the Python worker owns plant state only.
// A lost or unverifiable step leaves its legs unknown: nothing is resent, and no second process ever continues this run.
import {mkdir,chmod,readdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {hashPayload,type CommandResult,type DomainEvent,type JsonObject,type RobotCommand} from '../../../../contracts/src/index';
import {dispatchRobotEffects,robotEventCommand} from '../../../../robot-adapters/src/dispatch';
import type {RobotEvent} from '../../../../robot-adapters/src/contract';
import {validateProjectV2,validateActionV2,type LabProjectV2,type TwinSampleV2} from '../contracts';
import {admitBackend,defaultCatalog} from '../capabilities';
import {requiredBackends} from '../scenario-matrix';
import {serverAssets} from '../backend-registry';
import {worldHash} from '../assets';
import {hashJson} from '../hash';
import {createClock,TICK_MS,type Clock} from '../clock';
import {actorStream,PRNG} from '../random';
import {scenarioRegistry,scenarioHash,checkScenario,resolveRoles,type Roles,type ScenarioDefinition} from '../scenario-registry';
import {readCheckpoint,writeCheckpoint} from '../checkpoint';
import {SourceSession,mealFor} from '../session';
import {checkWorld,type RunManifestInput,type RunProviders,type RunView,type ScenarioRun} from '../scenario-runner';
import type {Attention,BusinessEvent,EntityView,RunReport,WorkloadItem} from '../report';
import {TelemetryRecorder,TELEMETRY_RATE_TICKS} from '../telemetry';
import type {JournalEvents} from '../event-stream';
import {validateNavigationDocument,type IRSimResponseV1,type IRSimSnapshotV1,type NavigationSceneV1} from './contracts';
import {createNavigationController,type NavigationController} from './controller';
import {spawnIRSimWorker,WorkerLostError,type IRSimWorkerClient} from './worker-client';
import {createIRSimNavigationAdapter,initialAdapterState,IRSIM_AMR,type IRSimAdapterState,type IRSimNavigationAdapter} from './adapter';

/** Operator-owned worker options (never from a request). `entry`/`deadlinesMs` exist for test doubles and fault tests. */
export interface IRSimRuntimeOptions {python:string;workerRoot:string;schemaDir:string;lockDigest:string;entry?:string[];deadlinesMs?:Record<string,number>}
/** `bundleFile` (RunProviders) is needed only for a new run: the gateway authorised the bundle for the session before the run exists. */
export interface IRSimRunProviders extends RunProviders {irsim:IRSimRuntimeOptions}
export const IRSIM_BACKEND='irsim_2d';
const EPOCH=Date.parse('2026-11-01T00:00:00Z'),ROBOT_TYPES=['robot.execute','robot.cancel','robot.requestStop'],FINAL=['completed','cancelled','failed'],SCENE='navigation-scene.json';
const sha256=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
interface Confirmation {due:number|null;type:string;robotId:string}
interface PlantCheckpoint {status:'none'|'live'|'lost';reason:string|null;bootId:string|null;requests:number;snapshot:IRSimSnapshotV1|null}
interface Checkpoint {
 schemaVersion:1;provider:'irsim_2d';runId:string;manifestHash:string;manifest:RunReport['manifest'];roles:Roles;trays:Record<string,number>;
 tick:number;started:boolean;paused:boolean;cancelled:boolean;suspended:boolean;revision:number;ordinal:number;dispatchDue:boolean;telemetrySeq?:number;reclaimed?:boolean;
 workload:WorkloadItem[];confirmations:Record<string,Confirmation>;parking:Record<string,string>;attention:Attention[];
 receipts:Record<string,{hash:string;view:RunView}>;rejectedObservations:RunReport['rejectedObservations'];reconciliations:RunReport['reconciliations'];
 recoveredOps:RunReport['recoveredOps'];confirmationLog:RunReport['confirmations'];faults:RunReport['faults'];
 pendingOps:{ordinal:number;operationId:string;type:string;payloadHash:string}[];inFlight:boolean;
 plant:PlantCheckpoint;adapters:Record<string,IRSimAdapterState>;distanceM:Record<string,number>;maxConcurrentMovers:number;
}

/** The locked navigation scene and the worker files it lists, verified against the bundle's project and this run's world. */
async function lockScene(input:RunManifestInput,project:LabProjectV2,roles:Roles,read:(path:string)=>Promise<Uint8Array>){
 const lock=input.engineering!,bytes=await read(SCENE).catch(()=>{throw new Error(`ENGINEERING_CLOSURE_MISSING:${SCENE}`);});
 const scene=JSON.parse(Buffer.from(bytes).toString('utf8')) as NavigationSceneV1,checked=validateNavigationDocument(scene);
 if(!checked.ok||scene.documentType!=='navigation-scene')throw new Error('NAVIGATION_SCENE_INVALID');
 if(lock.navigation&&(lock.navigation.sha256!==sha256(bytes)||lock.navigation.sceneDigest!==scene.sceneDigest))throw new Error('ENGINEERING_IDENTITY_MISMATCH');
 if(scene.inputs.project.digest!==lock.ref.projectDigest)throw new Error('ENGINEERING_IDENTITY_MISMATCH');
 if(scene.world.hash!==hashJson(project.world)||scene.world.id!==project.world.id||scene.world.revision!==project.world.revision)throw new Error('SCENE_WORLD_MISMATCH');
 if(scene.engine.id!==IRSIM_BACKEND||scene.clock.tickMs!==TICK_MS)throw new Error('NAVIGATION_SCENE_INVALID');
 if(!roles.robots.every(r=>scene.robots.some(x=>x.robotId===r.id)))throw new Error('SCENARIO_ROLE_UNBOUND');
 const bindings=scene.robots[0]!.targetBindings;
 // the source holds one binding table for the venue: every robot must stand at the same handoff for a point
 if(scene.robots.some(r=>hashJson(r.targetBindings)!==hashJson(bindings)))throw new Error('SCENE_BINDINGS_DIVERGE');
 const files:[string,Uint8Array][]=[[SCENE,bytes]];
 for(const f of scene.files){const b=await read(f.path).catch(()=>null);if(!b||sha256(b)!==f.sha256)throw new Error(`ENGINEERING_CLOSURE_MISSING:${f.path}`);files.push([f.path,b]);}
 return {scene,files};
}

export async function createIRSimScenarioRun(input:RunManifestInput,providers:IRSimRunProviders):Promise<ScenarioRun>{
 const registered=(providers.scenarios??scenarioRegistry).get(input.scenarioId);if(!registered)throw new Error('SCENARIO_UNSUPPORTED');
 const catalog=providers.catalog??defaultCatalog,set=Object.hasOwn(catalog.sets,input.backendSetId)?catalog.sets[input.backendSetId]:undefined;
 if(!set)throw new Error('BACKEND_SET_UNKNOWN');
 // this runner executes only portable sets whose AMR provider is irsim_2d; nothing here falls back to the mock plant or a native provider
 if(set.execution?.host!=='portable_python'||set.providers?.amr!==IRSIM_BACKEND)throw new Error('BACKEND_EXECUTION_DISABLED');
 if(input.mode!=='simulation'||input.access!=='simulated'||set.mode!==input.mode||set.access!==input.access)throw new Error('MODE_BACKEND_MISMATCH');
 const required=requiredBackends(registered,'simulation',input.backendSetId,catalog),admission=admitBackend('simulation',required,catalog,'simulated');
 if(!admission.ok)throw new Error(`BACKEND_UNAVAILABLE:${admission.reasonCodes.join(',')}`);
 if(!required.every(id=>(providers.enabledBackends??[]).includes(id)))throw new Error('BACKEND_EXECUTION_DISABLED');
 if(!input.engineering)throw new Error('ENGINEERING_REF_REQUIRED');
 const valid=validateProjectV2(input.project);if(!valid.ok)throw new Error('INVALID_PROJECT');
 const project=structuredClone(valid.value);checkWorld(project);
 const scenario=structuredClone(registered);checkScenario(scenario);if(scenario.revision!==input.scenarioRevision)throw new Error('SCENARIO_REVISION_MISMATCH');
 if(scenario.coffee)throw new Error('SCENARIO_BACKEND_MISSING');
 if(!Number.isSafeInteger(input.seed)||input.seed<0||input.seed>0xffffffff)throw new Error('INVALID_SEED');
 // ponytail: scheduled faults/obstacles are not compiled into the 2D plant yet (C02); refuse them instead of silently running without
 if(project.faultSchedule?.length||scenario.obstacles?.length)throw new Error('FAULT_SCHEDULE_UNSUPPORTED');
 const roles=resolveRoles(scenario,project),assetCatalog=[...(providers.assets??input.engineering.runtimeProjection.assets as never[]),...serverAssets],trays:Record<string,number>={};
 const assets=project.entities.map(e=>{const a=assetCatalog.find(x=>x.contentHash===e.assetRef.contentHash);trays[e.id]=a?Math.max(1,a.frames.filter(f=>/^tray_\d+$/.test(f.id)).length):1;return {...e.assetRef,resolved:!!a};});
 const dir=providers.directory,bundleDir=join(dir,'bundle');
 await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 let cp=await readCheckpoint<Checkpoint>(dir);
 const fresh=!cp;
 if(fresh&&(await readdir(dir)).length)throw new Error('RECOVERY_CHECKPOINT_MISSING');
 if(cp&&cp.provider!=='irsim_2d')throw new Error('RUN_IDENTITY_MISMATCH');
 // a new run copies its locked scene out of the bundle; a reopened one reads (and re-verifies) only its own copy
 const read=fresh?(path:string)=>{if(!providers.bundleFile)throw new Error('ENGINEERING_CLOSURE_MISSING');return providers.bundleFile(input.engineering!.ref.bundleDigest,path);}:(path:string)=>readFile(join(bundleDir,path));
 const {scene,files}=await lockScene(input,project,roles,read);
 const mapId=scene.world.id,mapRevision=scene.sceneDigest,lock=providers.irsim.lockDigest;
 const configuration={revision:1,hash:hashJson({roles,trays,sceneDigest:scene.sceneDigest,policy:scene.policy.hash,controller:scene.policy.parameters.controller,entitySpeedLimits:project.entities.map(e=>({id:e.id,speedLimitMps:e.speedLimitMps??null})),fleet:scenario.fleet??{}})};
 const backends=[{...IRSIM_AMR}];
 const manifest:Omit<RunReport['manifest'],'runId'>={engineering:input.engineering.ref,sourceCommit:input.sourceCommit,mode:'simulation',access:'simulated',backendSetId:input.backendSetId,backends,prng:{...PRNG},clock:{tickMs:TICK_MS,businessEpochMs:EPOCH},seed:input.seed,
  scenario:{id:scenario.id,revision:scenario.revision,hash:scenarioHash(scenario),...scenario.basedOn?{basedOn:{...scenario.basedOn}}:{}},project:{id:project.id,revision:project.revision,hash:hashJson(project)},world:{id:project.world.id,revision:project.world.revision,hash:worldHash(project.world)},assets,
  hashAlgorithm:'sha256-canonical-json-v1',designHash:hashJson(project.entities),adapterHash:hashJson({sourceCommit:input.sourceCommit,backends,workerLockDigest:lock,files:files.map(([p,b])=>[p,sha256(b)])}),configuration,recipes:[],
  models:[{id:IRSIM_AMR.id,revision:IRSIM_AMR.version,hash:scene.sceneDigest,provenance:'simulated_plant'},...scene.robots.map(r=>({id:`navigation-model:${r.robotId}`,revision:String(r.model.schemaVersion),hash:r.model.modelDigest,provenance:'projected'}))],
  profiles:[{id:scene.policy.id,revision:scene.policy.revision,hash:scene.policy.hash,provenance:scene.policy.source.kind}],calibration:{status:'not_calibrated',revision:null,hash:null,reason:'SIMULATED_PLANT'}};
 const manifestHash=hashJson(manifest);
 if(cp&&cp.manifestHash!==manifestHash)throw new Error('RUN_IDENTITY_MISMATCH');
 if(!cp){
  for(const [path,bytes] of files){await mkdir(dirname(join(bundleDir,path)),{recursive:true});await writeFile(join(bundleDir,path),bytes,{mode:0o600,flag:'wx'});}
  const runId=randomUUID(),draws=new Map<string,ReturnType<typeof actorStream>>();
  const draw=(actor:string,range:readonly [number,number])=>{const s=draws.get(actor)??actorStream(input.seed,actor);draws.set(actor,s);return s.int(range[0],range[1]);};
  const workload=scenario.orders.map((o,i)=>({actor:o.actor,tableId:roles.tables[o.table]!,quantity:o.quantity,atTick:draw(o.actor,o.atTick),sessionId:`lab-session-${i+1}`,status:'planned' as const}));
  cp={schemaVersion:1,provider:'irsim_2d',runId,manifestHash,manifest:{runId,...manifest},roles,trays,tick:0,started:false,paused:false,cancelled:false,suspended:false,revision:0,ordinal:0,dispatchDue:false,
   workload,confirmations:{},parking:{},attention:[],receipts:{},rejectedObservations:[],reconciliations:[],recoveredOps:[],confirmationLog:[],faults:[],pendingOps:[],inFlight:false,
   plant:{status:'none',reason:null,bootId:null,requests:0,snapshot:null},adapters:Object.fromEntries(roles.robots.map(r=>[r.id,initialAdapterState()])),distanceM:Object.fromEntries(roles.robots.map(r=>[r.id,0])),maxConcurrentMovers:0};
 }
 const bindings=Object.fromEntries(scene.robots[0]!.targetBindings.map(t=>[t.pointId,{waypointId:t.pointId,mapId,mapRevision,frame:'map' as const,x:t.x,y:t.y,yaw:t.yaw}]));
 const run=new IRSimRun(dir,cp,scenario,project,scene,providers.irsim,{mapId,mapRevision});
 run.source=await SourceSession.open(dir,cp.runId,()=>run.clock.nowMs(),{epochMs:EPOCH,navigation:{mapId,mapRevision,bindings},project,robots:roles.robots.map(r=>({...r,trays:trays[r.id]!})),stationIds:[roles.stationId],...scenario.fleet?{fleet:scenario.fleet}:{}},fresh);
 try{
  if(!fresh)run.telemetry.gap('RUNTIME_RESTART',null,cp.tick);
  // the worker of a started run died with the previous process: its legs are unknown, never continued
  if(cp.inFlight||cp.plant.status==='live')await run.recover();
  run.record();await run.persist();
  return run;
 }catch(error){await run.close();throw error;}
}

class IRSimRun implements ScenarioRun {
 source!:SourceSession;
 readonly clock:Clock;
 readonly telemetry=new TelemetryRecorder(20000,'irsim_2d simulated plant (modeled, in memory)');
 private controller:NavigationController;
 private adapters=new Map<string,IRSimNavigationAdapter>();
 private observations:RobotEvent[]=[];
 private holds:Record<string,string|null>={};
 private worker?:IRSimWorkerClient;
 private queue:Promise<unknown>=Promise.resolve();
 private closed=false;
 constructor(private dir:string,private cp:Checkpoint,private scenario:ScenarioDefinition,private project:LabProjectV2,private scene:NavigationSceneV1,private irsim:IRSimRuntimeOptions,map:{mapId:string;mapRevision:string}){
  this.clock=createClock(EPOCH,cp.tick,cp.paused);
  this.controller=createNavigationController(scene);
  for(const r of cp.roles.robots){
   const a=createIRSimNavigationAdapter({robotId:r.id,scene,controller:this.controller,now:()=>this.clock.nowMs(),state:cp.adapters[r.id]!,...map,trays:cp.trays[r.id]!});
   a.observe(e=>this.observations.push(e));this.adapters.set(r.id,a);
  }
 }
 get id(){return this.cp.runId;}
 persist(){return writeCheckpoint(this.dir,this.cp);}
 pulse(){const c=this.cp;return {tick:c.tick,paused:c.paused,runRevision:c.revision};}
 journal(){return this.queue.then(async()=>{if(this.closed)throw new Error('RUN_CLOSED');return (await this.source.journal()).map(entry=>({sequence:entry.sequence,at:entry.recordedAt,events:(entry.payload.events as unknown as DomainEvent[]).map(e=>({type:e.type,kind:String(e.data.kind),id:String(e.data.id),state:(e.data.state??{}) as JsonObject}))})) as JournalEvents[];});}
 private robotObs(id:string){return this.cp.plant.snapshot?.robots.find(r=>r.robotId===id);}
 private moving(id:string){const r=this.robotObs(id),p=this.scene.policy.parameters;return !!r&&(Math.abs(r.bodyVelocity[0]!)>p.stoppedLinearMps||Math.abs(r.bodyVelocity[1]!)>p.stoppedAngularRadps);}
 record(){
  const c=this.cp;c.telemetrySeq=(c.telemetrySeq??c.tick)+1;const at=String(process.hrtime.bigint()),stale=c.plant.status!=='live';
  // ponytail: in-memory lossy samples only; the durable per-tick trajectory/sensor record is B05 (navigation-run-evidence-v1)
  this.telemetry.record(c.roles.robots.flatMap(({id}):TwinSampleV2[]=>{const r=this.robotObs(id),g=this.adapters.get(id)!.goal(),live=g&&(g.state==='executing'||g.state==='cancelling');if(!r)return [];
   return [{schemaVersion:2,runId:c.runId,entityId:id,providerId:IRSIM_BACKEND,bootId:c.plant.bootId??c.adapters[id]!.bootId,seq:String(c.telemetrySeq),simTimeNs:this.clock.simTimeNs(),observedAt:new Date(this.clock.nowMs()).toISOString(),receivedMonotonicNs:at,frameId:'map',origin:'physics_sim',
    quality:stale?'stale':'valid',reasonCodes:stale?['PLANT_NOT_LIVE']:[],commanded:live?{goalCommandId:g.commandId,goalState:g.state}:null,observed:{xM:r.poseDriveMap[0]!,yM:r.poseDriveMap[1]!,yawRad:r.poseDriveMap[2]!,moving:this.moving(id),hold:this.holds[id]??null},estimated:null,causationId:live?g.commandId:null} as TwinSampleV2];}));
 }
 // ---- plant (one worker process per run, never a second one) ----
 private async ask(op:'describe'|'create'|'start'|'pause'|'resume',payload:Record<string,unknown>):Promise<Extract<IRSimResponseV1,{ok:true}>>{
  const c=this.cp,r=await this.worker!.request({protocol:'mekoniq-irsim/1',requestId:`${op}-${++c.plant.requests}`,runId:c.runId,expectedTick:c.tick,op,payload} as never);
  if(!r.ok)throw new WorkerLostError(r.error.code,'not_sent',`${op} refused`);
  return r;
 }
 private async startPlant(){
  const c=this.cp,o=this.irsim;
  this.worker=await spawnIRSimWorker({python:o.python,workerRoot:o.workerRoot,runId:c.runId,bundleRoot:join(this.dir,'bundle'),runDirectory:join(this.dir,'worker'),lockDigest:o.lockDigest,schemaDir:o.schemaDir,sceneDigest:this.scene.sceneDigest,...o.entry?{entry:o.entry}:{},...o.deadlinesMs?{deadlinesMs:o.deadlinesMs}:{}});
  try{
   const d=(await this.ask('describe',{})).result as {lockDigest:string;packageVersion:string};
   if(d.lockDigest!==o.lockDigest||d.packageVersion!==IRSIM_AMR.version)throw new Error('IRSIM_PROVIDER_MISMATCH');
   const snap=(await this.ask('create',{sceneRef:SCENE,seed:c.manifest.seed})).result as IRSimSnapshotV1;
   await this.ask('start',{});
   c.plant={status:'live',reason:null,bootId:this.worker.bootId,requests:c.plant.requests,snapshot:snap};
   for(const a of this.adapters.values())a.sink.observe(snap);
  }catch(e){await this.worker.close('START_FAILED').catch(()=>{});this.worker=undefined;throw new Error(`PLANT_START_FAILED:${e instanceof WorkerLostError?e.code:(e as Error).message.slice(0,80)}`);}
 }
 private async plantLost(code:string){
  const c=this.cp;if(c.plant.status==='lost')return;
  c.plant.status='lost';c.plant.reason=code;
  const w=this.worker;this.worker=undefined;await w?.close(code).catch(()=>{});
  for(const a of this.adapters.values())a.sink.lost('WORKER_LOST');
  c.attention.push({reason:'WORKER_LOST',subjectId:code,tick:c.tick});this.suspend();
  await this.drain();
 }
 /** Reopened after a crash or restart: the journal is the truth. A leg the journal still shows travelling is unknown; cargo, reservations and custody stay. */
 async recover(){
  const c=this.cp;
  for(const op of c.pendingOps)c.recoveredOps.push({ordinal:op.ordinal,operationId:op.operationId,type:op.type,committed:!!await this.source.receipt(op.operationId,op.payloadHash)});
  c.pendingOps=[];
  if(c.plant.status==='live'){c.plant.status='lost';c.plant.reason='RUNTIME_RESTART';}
  for(const a of this.adapters.values())a.state.plantLost=c.plant.status==='lost';
  let travelling=0;
  for(const {id} of c.roles.robots){
   const robot=await this.source.read('robot',id);if(typeof robot.state.missionId!=='string')continue;
   const m=await this.source.read('mission',robot.state.missionId),stop=(m.state.stops as JsonObject[]).find(s=>s.id===m.state.currentStopId);
   if(!FINAL.includes(String(m.state.status))&&stop?.status==='travelling'&&typeof m.state.commandId==='string'){travelling++;this.adapters.get(id)!.sink.reportUnknown((await this.source.read('robot-command',m.state.commandId)).state as unknown as RobotCommand,'RECOVERY_UNKNOWN');}
  }
  // a finished run had nothing in flight: reopening it is a read, not a recovery
  if(!travelling&&!c.inFlight&&await this.missionsDone())return;
  c.attention.push({reason:'RECOVERY_UNKNOWN',tick:c.tick});c.suspended=true;c.confirmations={};
  await this.drain();await this.scanArrivals();
  c.inFlight=false;c.dispatchDue=true;c.revision++;
 }
 // ---- source (same scripted semantics as the mock FD runner) ----
 private async submit(type:string,payload:JsonObject,robotId?:string):Promise<CommandResult>{
  if(type==='Mission.Create'){
   const limits=this.project.entities.filter(e=>e.kind==='amr'&&(payload.robotId===undefined||e.id===payload.robotId)).flatMap(e=>e.speedLimitMps===undefined?[]:[e.speedLimitMps]);
   if(limits.length)payload={...payload,speedLimitMps:Math.min(...limits,typeof payload.speedLimitMps==='number'?payload.speedLimitMps:Infinity)};
  }
  const c=this.cp,ordinal=++c.ordinal,operationId=`op-${ordinal}`;
  c.pendingOps.push({ordinal,operationId,type,payloadHash:hashPayload(payload)});await this.persist();
  const result=await this.source.submit(type,payload,operationId,robotId);
  if(result.status==='accepted'&&Array.isArray(result.value.effects)&&result.value.effects.length)c.dispatchDue=true;
  return result;
 }
 private async must(type:string,payload:JsonObject){const r=await this.submit(type,payload);if(r.status!=='accepted')throw Object.assign(new Error('SCRIPTED_INPUT_REJECTED'),{code:r.code??r.status});return r;}
 private async placeOrder(w:WorkloadItem){
  const station=this.cp.roles.stationId,quantity=String(w.quantity);
  await this.must('Session.Open',{sessionId:w.sessionId,tableId:w.tableId});
  const placed=await this.must('Order.Place',{sessionId:w.sessionId,tableId:w.tableId,menuVersion:1,items:[{itemId:mealFor(station),quantity}]});
  w.lineId=(placed.value.lineIds as string[])[0]!;
  await this.must('Kitchen.Ready',{lineId:w.lineId,quantity,stationId:station,expectedVersion:(await this.source.read('fulfillment',w.lineId)).version});
  const allocation=await this.must('Fulfillment.Allocate',{lineId:w.lineId,quantity,expectedVersion:(await this.source.read('fulfillment',w.lineId)).version,method:'robot'});
  if(this.scenario.batch){w.allocationId=String(allocation.value.allocationId);w.status='placed';return;}
  w.missionId=await this.createMission([String(allocation.value.allocationId)]);w.status='placed';
 }
 private async createMission(allocationIds:string[]){const s=this.scenario;return String((await this.must('Mission.Create',{allocationIds,...s.requestRobot?{robotId:this.cp.roles.robots[0]!.id}:{},...s.loadMinor?{loadMinor:s.loadMinor}:{}})).value.missionId);}
 private async scripted(){
  const c=this.cp;
  try{
   for(const w of c.workload)if(w.status==='planned'&&w.atTick<=c.tick)await this.placeOrder(w);
   if(this.scenario.batch&&c.workload.length&&c.workload.every(w=>w.status==='placed'&&!w.missionId)){const missionId=await this.createMission(c.workload.map(w=>w.allocationId!));for(const w of c.workload)w.missionId=missionId;}
   for(const [key,x] of Object.entries(c.confirmations))if(x.due!==null&&x.due<=c.tick)await this.confirmStop(key,'scripted');
  }catch(e){if((e as Error).message!=='SCRIPTED_INPUT_REJECTED')throw e;c.attention.push({reason:'SCRIPTED_INPUT_REJECTED',subjectId:(e as {code:string}).code,tick:c.tick});this.suspend();}
 }
 private async confirmStop(key:string,provenance:string){
  const c=this.cp,[missionId,stopId]=key.split('/') as [string,string],x=c.confirmations[key]!;
  delete c.confirmations[key];
  const m=await this.source.read('mission',missionId);
  const r=await this.submit('Mission.ConfirmStop',{missionId,expectedVersion:m.version,missionRevision:m.state.revision!,stopId});
  if(r.status!=='accepted'){c.attention.push({reason:'CONFIRMATION_REJECTED',subjectId:stopId,robotId:x.robotId,tick:c.tick});return;}
  if(x.type!=='standby')c.confirmationLog.push({subjectId:stopId,confirmationType:x.type,provenance,tick:c.tick});
  const robot=x.robotId,parking=c.roles.robots.find(r=>r.id===robot)!.parkingId;
  if(r.value.status==='completed'&&this.scenario.park&&!c.suspended&&c.parking[robot]!==missionId&&!r.value.assignedMissionId){
   const created=await this.submit('Mission.Create',{robotId:robot,stops:[{action:'standby',targetId:parking}]});
   if(created.status==='accepted')c.parking[robot]=String(created.value.missionId);else c.attention.push({reason:'PARKING_REJECTED',robotId:robot,tick:c.tick});
  }
 }
 /** Observations come only from the plant adapters and pass the production Robot.Observe identity checks. */
 private async drain(){
  const c=this.cp;let arrived=false;
  while(this.observations.length){
   const e=this.observations.shift()!,robotId=String(e.payload.robotId);
   // an observation the source could not commit (busy or full store) is not lost: it goes back and is submitted again
   const r=await this.submit('Robot.Observe',robotEventCommand(e),robotId).catch(error=>{this.observations.unshift(e);throw error;});
   if(r.status!=='accepted'){c.rejectedObservations.push({eventId:e.id,commandId:e.commandId,type:e.type,code:r.code??r.status,tick:c.tick});if(c.rejectedObservations.length>1000)c.rejectedObservations.shift();continue;}
   if(['failed','rejected','unknown'].includes(e.type))c.attention.push({reason:e.type==='unknown'?'EXECUTION_UNKNOWN':typeof e.payload.reason==='string'?e.payload.reason:`ROBOT_${e.type.toUpperCase()}`,robotId,subjectId:String(e.payload.missionId),commandId:e.commandId,tick:c.tick});
   if(e.type==='completed')arrived=true;
  }
  if(arrived)await this.scanArrivals();
 }
 /** Arrival is durable source state (MissionArrived); only then does a confirmation become due. Parking standby needs no person. */
 private async scanArrivals(){
  const c=this.cp;
  for(const {id} of c.roles.robots){
   const robot=await this.source.read('robot',id);if(typeof robot.state.missionId!=='string')continue;
   const m=await this.source.read('mission',robot.state.missionId),stop=(m.state.stops as JsonObject[]).find(s=>s.id===m.state.currentStopId),key=`${m.ref.id}/${String(stop?.id)}`;
   if(!stop||stop.status!=='awaiting_action'||c.confirmations[key]||m.state.status!=='executing'&&m.state.status!=='cancelling')continue;
   const type=String(stop.action);
   c.confirmations[key]={due:type==='standby'?c.tick:this.scenario.confirm.mode==='scripted'&&!c.suspended?c.tick+this.scenario.confirm.delayTicks:null,type,robotId:id};
   if(type==='standby')await this.confirmStop(key,'system');
  }
 }
 private async dispatch(){
  const c=this.cp;c.dispatchDue=false;
  for(const a of this.adapters.values())await dispatchRobotEffects(this.source.store,this.source.scope,a,this.clock.nowMs());
  await this.drain();
  const effects=(await this.source.effects()).filter(e=>ROBOT_TYPES.includes(String(e.type)));
  for(const e of effects.filter(e=>e.type==='robot.execute'&&e.status==='failed')){
   const p=e.payload as JsonObject;if(c.attention.some(a=>a.commandId===p.commandId))continue;
   const m=await this.source.read('mission',String(p.missionId));
   if(m.state.commandId===p.commandId&&['assigned','executing'].includes(String(m.state.status)))c.attention.push({reason:Date.parse(String(p.expiresAt))<=this.clock.nowMs()?'COMMAND_EXPIRED':'COMMAND_NOT_SENT',robotId:String(p.robotId),subjectId:m.ref.id,commandId:String(p.commandId),tick:c.tick});
  }
  if(effects.some(e=>e.status==='pending'))c.dispatchDue=true;
 }
 /** One fixed tick. Returns false when the plant could not be verified (the clock then stays where it was). */
 private async tick():Promise<boolean>{
  const c=this.cp;
  if(!c.suspended)await this.scripted();
  if(c.dispatchDue)await this.dispatch();
  if(c.plant.status!=='live'||!this.worker)return false;
  const out=this.controller.advance(c.plant.snapshot!,{});
  for(const d of out.decisions){this.adapters.get(d.robotId)?.sink.decide(d);this.holds[d.robotId]=d.status==='executing'?d.reason:null;}
  let next:IRSimSnapshotV1;
  try{
   const r=await this.worker.request({protocol:'mekoniq-irsim/1',requestId:`step-${c.tick+1}`,runId:c.runId,expectedTick:c.tick,op:'step',payload:{targetTick:c.tick+1,velocities:out.velocities,actorUpdates:[]}});
   // a refused step is as unverifiable as a lost one: the legs become unknown, the step is not retried
   if(!r.ok){await this.plantLost(`STEP_REFUSED:${(r as {error:{code:string}}).error.code}`);return false;}
   next=r.result as IRSimSnapshotV1;
   if(hashJson(next.robots.map(x=>x.robotId).sort())!==hashJson(this.scene.robots.map(x=>x.robotId).sort())||next.robots.some(x=>![...x.poseDriveMap,...x.bodyVelocity].every(Number.isFinite))){await this.plantLost('SNAPSHOT_INVALID');return false;}
  }catch(e){await this.plantLost(e instanceof WorkerLostError?e.code:'WORKER_FAILED');return false;}
  const prev=c.plant.snapshot!;
  this.clock.advance(1);c.tick=this.clock.tick;c.plant.snapshot=next;
  for(const r of next.robots){const p=prev.robots.find(x=>x.robotId===r.robotId);if(p&&c.distanceM[r.robotId]!==undefined)c.distanceM[r.robotId]+=Math.hypot(r.poseDriveMap[0]!-p.poseDriveMap[0]!,r.poseDriveMap[1]!-p.poseDriveMap[1]!);}
  c.maxConcurrentMovers=Math.max(c.maxConcurrentMovers,c.roles.robots.filter(r=>this.moving(r.id)).length);
  for(const a of this.adapters.values())a.sink.observe(next);
  await this.drain();
  if(c.tick%TELEMETRY_RATE_TICKS===0)this.record();
  return true;
 }
 private suspend(){const c=this.cp;c.suspended=true;for(const x of Object.values(c.confirmations))if(x.type!=='standby')x.due=null;}
 snapshot(){return this.queue.then(()=>{if(this.closed)throw new Error('RUN_CLOSED');return this.view();});}
 holdForReclaim(){
  const p=this.queue.then(async()=>{
   if(this.closed)throw new Error('RUN_CLOSED');const c=this.cp;
   if(!c.reclaimed){
    this.suspend();c.paused=true;this.clock.pause();
    for(const a of this.adapters.values())await a.requestStop('LOCAL_RECLAIM');await this.drain();
    if(c.plant.status==='live'){c.plant.status='lost';c.plant.reason='RECLAIMED';const w=this.worker;this.worker=undefined;await w?.close('RECLAIMED').catch(()=>{});}
    if(c.started&&!await this.missionsDone()){
     let targets=0;
     for(const {id:robotId} of c.roles.robots){
      const missionId=(await this.source.read('robot',robotId)).state.missionId;if(typeof missionId!=='string')continue;
      const mission=await this.source.read('mission',missionId);if(FINAL.includes(String(mission.state.status)))continue;
      c.attention.push({reason:'RECLAIM_RECONCILIATION_REQUIRED',robotId,subjectId:missionId,tick:c.tick,...typeof mission.state.commandId==='string'?{commandId:mission.state.commandId}:{}});targets++;
     }
     if(!targets)c.attention.push({reason:'RECLAIM_RECONCILIATION_REQUIRED',tick:c.tick});
    }
    c.reclaimed=true;c.revision++;this.record();await this.persist();
   }
   return this.view();
  });this.queue=p.catch(()=>{});return p;
 }
 start(){return this.snapshot().then(v=>this.action({actionId:'start',expectedRevision:v.run.runRevision,kind:'start',payload:{}}));}
 action(a:unknown,beforeExecute?:()=>Promise<void>):Promise<RunView>{const p=this.queue.then(()=>this.execute(a,beforeExecute));this.queue=p.catch(()=>{});return p;}
 private async execute(raw:unknown,beforeExecute?:()=>Promise<void>):Promise<RunView>{
  if(this.closed)throw new Error('RUN_CLOSED');
  const checked=validateActionV2(raw);if(!checked.ok)throw new Error('INVALID_ACTION');
  const a=checked.value,c=this.cp,p=a.payload as Record<string,unknown>,hash=hashJson(a),old=c.receipts[a.actionId];
  if(c.reclaimed&&a.kind!=='reconcile')throw new Error('INVALID_STATE:RECLAIM_READ_ONLY');
  if(old){if(old.hash!==hash)throw new Error('ACTION_CONFLICT');return structuredClone(old.view);}
  if(Object.keys(c.receipts).length>=10000)throw new Error('ACTION_LIMIT');
  if(a.expectedRevision!==c.revision)throw new Error('REVISION_CONFLICT');
  const view=await this.view(),status=view.run.status;
  if(a.kind==='start'&&c.started||a.kind!=='start'&&!c.started)throw new Error('INVALID_STATE');
  if(a.kind==='pause'&&c.paused||a.kind==='resume'&&!c.paused)throw new Error('INVALID_STATE');
  if(a.kind==='step'&&c.paused)throw new Error('RUN_PAUSED');
  // no plant, no motion: a lost worker is never replaced and its steps are never replayed
  if(a.kind==='step'&&c.plant.status!=='live')throw new Error('INVALID_STATE:PLANT_LOST');
  if(a.kind==='step'&&c.tick+Number(p.ticks)>this.scenario.maxTicks)throw new Error('RUN_DURATION_EXCEEDED');
  if(a.kind==='reconcile'&&status!=='needs_attention')throw new Error('INVALID_STATE');
  if(a.kind==='cancel'&&(c.cancelled||['completed','cancelled'].includes(status)))throw new Error('INVALID_STATE');
  if(a.kind==='injectFault'||a.kind==='restoreCup')throw new Error(a.kind==='injectFault'?'INVALID_FAULT':'INVALID_STATE:CUP_RESTORE_UNSAFE');
  const pending=a.kind==='confirm'?Object.entries(c.confirmations).find(([k,x])=>x.due===null&&k.endsWith(`/${String(p.subjectId)}`)):undefined;
  if(a.kind==='confirm'&&!pending)throw new Error('CONFIRMATION_NOT_PENDING');
  if(pending&&pending[1].type!==p.confirmationType)throw new Error('CONFIRMATION_TYPE_MISMATCH');
  if(pending&&c.plant.status==='lost')throw new Error('INVALID_STATE:LOCALIZATION_LOST');
  await beforeExecute?.();
  c.inFlight=true;await this.persist();
  try{
   if(a.kind==='start'){await this.startPlant();c.started=true;}
   else if(a.kind==='pause'){c.paused=true;this.clock.pause();if(this.worker)await this.ask('pause',{}).catch(e=>this.plantLost(e instanceof WorkerLostError?e.code:'WORKER_FAILED'));}
   else if(a.kind==='resume'){if(this.worker)await this.ask('resume',{}).catch(e=>this.plantLost(e instanceof WorkerLostError?e.code:'WORKER_FAILED'));c.paused=false;this.clock.resume();}
   else if(a.kind==='step')for(let i=0;i<Number(p.ticks);i++){if(!await this.tick())break;}
   else if(a.kind==='confirm')await this.confirmStop(pending![0],String(p.actorProvenance??'human'));
   else if(a.kind==='cancel'){
    c.cancelled=true;this.suspend();
    for(const w of c.workload.filter((x,i,all)=>all.findIndex(y=>y.missionId===x.missionId)===i))if(w.missionId){const m=await this.source.read('mission',w.missionId);if(!FINAL.includes(String(m.state.status))&&m.state.status!=='cancelling'){const r=await this.submit('Mission.Cancel',{missionId:m.ref.id,expectedVersion:m.version});if(r.status!=='accepted')c.attention.push({reason:'CANCEL_REJECTED',subjectId:m.ref.id,tick:c.tick});}}
    c.confirmations={};await this.scanArrivals();
   }
   else if(a.kind==='reconcile'){
    // reconciliation queries the adapter by command id and audits the answer; it never resends and never releases on its own
    const subject=String(p.subjectId);
    let index=c.roles.robots.findIndex(r=>r.id===subject);
    for(let i=0;index<0&&i<c.roles.robots.length;i++)if((await this.source.read('robot',c.roles.robots[i]!.id)).state.missionId===subject)index=i;
    if(index<0)throw new Error('INVALID_ACTION');
    const robotId=c.roles.robots[index]!.id,missionId=(await this.source.read('robot',robotId)).state.missionId,commandId=typeof missionId==='string'?String((await this.source.read('mission',missionId)).state.commandId):null;
    c.reconciliations.push({subjectId:subject,commandId,nativeState:commandId?(await this.adapters.get(robotId)!.reconcile(commandId)).status:'idle',tick:c.tick});
   }
   c.revision++;c.pendingOps=[];c.inFlight=false;this.record();
   const after=await this.view();c.receipts[a.actionId]={hash,view:after};await this.persist();return structuredClone(after);
  }catch(e){c.attention.push({reason:'ACTION_INTERRUPTED',tick:c.tick});c.revision++;c.inFlight=false;await this.persist();throw e;}
 }
 private async missionsDone(){
  const c=this.cp;
  if(c.workload.some(w=>w.status!=='placed'))return false;
  for(const w of c.workload)if((await this.source.read('mission',w.missionId!)).state.status!=='completed')return false;
  if(!this.scenario.park)return true;
  for(const r of c.roles.robots){const s=(await this.source.read('robot',r.id)).state;if(s.missionId||s.availability!=='idle'||s.position!==r.parkingId)return false;}
  return true;
 }
 private async view():Promise<RunView>{
  const c=this.cp,m=c.manifest;
  let status:RunView['run']['status']='running';
  const awaiting=Object.entries(c.confirmations).filter(([,x])=>x.due===null).map(([k,x])=>({subjectId:k.split('/')[1]!,confirmationType:x.type,missionId:k.split('/')[0]!,robotId:x.robotId}));
  if(!c.started)status='ready';
  else if(c.attention.length)status='needs_attention';
  else if(c.cancelled){let open=false;for(const w of c.workload)if(w.missionId&&!FINAL.includes(String((await this.source.read('mission',w.missionId)).state.status)))open=true;status=open?'running':'cancelled';}
  else if(await this.missionsDone())status='completed';
  else if(c.paused)status='paused';
  else if(awaiting.length)status='awaiting_confirmation';
  let served=0n;for(const w of c.workload)if(w.lineId)served+=BigInt(String((await this.source.read('fulfillment',w.lineId)).state.served??'0'));
  const journal=await this.source.journal();
  return {run:{schemaVersion:2,id:c.runId,mode:'simulation',access:'simulated',backendSetId:m.backendSetId,backends:m.backends.map(b=>b.id),status,runRevision:c.revision,eventCursor:journal.length?journal[journal.length-1]!.sequence:null,telemetryCursor:this.telemetry.cursor(),fidelity:'modeled',ageMs:0,sourceCommit:m.sourceCommit,scenarioId:m.scenario.id,scenarioRevision:m.scenario.revision,seed:m.seed},
   tick:c.tick,simTimeNs:this.clock.simTimeNs(),model:IRSIM_AMR.model,entities:this.entities(),workload:structuredClone(c.workload),awaiting,attention:structuredClone(c.attention),served:String(served),coffee:null,...c.reclaimed?{controlAccess:'view_reconcile' as const}:{}};
 }
 private entities():EntityView[]{
  const c=this.cp;
  return c.roles.robots.map(({id})=>{
   const r=this.robotObs(id),start=this.scene.robots.find(x=>x.robotId===id)!.initialPoseMap,pose=r?.poseDriveMap??start,g=this.adapters.get(id)!.goal();
   return {id,kind:'amr' as const,pose:{x:pose[0]!,y:pose[1]!,yawRad:pose[2]!},quality:c.plant.status==='live'?'valid' as const:'stale' as const,moving:c.plant.status==='live'&&this.moving(id),hold:this.holds[id]??null,goal:g?{commandId:g.commandId,state:g.state}:null,path:[],distanceM:c.distanceM[id]??0};
  });
 }
 async report():Promise<RunReport>{
  await this.queue;if(this.closed)throw new Error('RUN_CLOSED');
  const c=this.cp,v=await this.view();
  const businessEvents:BusinessEvent[]=(await this.source.journal()).flatMap(entry=>(entry.payload.events as unknown as DomainEvent[]).map(e=>({sequence:entry.sequence,at:entry.recordedAt,type:e.type,kind:String(e.data.kind),id:String(e.data.id),state:(e.data.state??{}) as JsonObject})));
  return {schemaVersion:2,manifest:structuredClone(c.manifest),outcome:{status:v.run.status,served:v.served,tick:c.tick,simTimeNs:v.simTimeNs},attention:v.attention,workload:v.workload,entities:v.entities,businessEvents,
   effects:(await this.source.effects()).filter(e=>ROBOT_TYPES.includes(String(e.type))).map(e=>({id:String(e.id),type:String(e.type),status:String(e.status),attempts:Number(e.attempts),payload:e.payload as JsonObject})),
   metrics:{maxConcurrentMovers:c.maxConcurrentMovers,distanceM:{...c.distanceM},collision:{available:false,reason:'TRAJECTORY_EVIDENCE_NOT_RECORDED',contacts:null,minSeparationM:null}},
   rejectedObservations:structuredClone(c.rejectedObservations),reconciliations:structuredClone(c.reconciliations),recoveredOps:structuredClone(c.recoveredOps),confirmations:structuredClone(c.confirmationLog),faults:structuredClone(c.faults),
   coverage:{businessSimulation:true,kinematicModel:true,dynamics:false,nativeExecution:false,physicalStop:false,sensorEvidence:false,eventStream:true},
   limitations:['irsim_2d simulated plant (IR-SIM 2.12.0, planar kinematics, collision_mode stop): no dynamics, contact physics or hardware behaviour.',
    'perception: known_map_plus_simulated_lidar; the controller plans on the compiled static map and uses simulated LiDAR for dynamic obstacles.',
    'Per-tick trajectory and sensor evidence is not yet recorded durably, so collision/clearance metrics are unavailable for this run.',
    'A lost or refused worker step leaves its legs unknown; it is never resent and the run is never continued by a new worker process.',
    'Stop requests are model stops only (physicalStopConfirmed false).',...this.scene.limitations],
   telemetry:this.telemetry.report()};
 }
 async close(){await this.queue;if(!this.closed){this.closed=true;const w=this.worker;this.worker=undefined;try{await w?.close('RUN_CLOSED');}finally{await this.source.close();}}}
}
