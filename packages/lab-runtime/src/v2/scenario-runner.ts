import {dueFaults,validateFaultSchedule,validateFaultTarget,type FaultFireRecord,type FaultPhase} from './fault-schedule';
// Mock scenario runner. Per tick: scripted inputs -> source decisions/outbox dispatch -> model advance -> observations -> journal.
// Business truth lives only in the run's source journal; the plant owns pose/path; the report reads events back from the journal.
import {mkdir,chmod,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {hashPayload,type CommandResult,type DomainEvent,type JsonObject,type RobotCommand} from '../../../contracts/src/index';
import {dispatchRobotEffects,robotEventCommand} from '../../../robot-adapters/src/dispatch';
import type {RobotEvent} from '../../../robot-adapters/src/contract';
import {validateProjectV2,validateActionV2,type LabProjectV2,type LabRunSnapshotV2,type AssetRevision} from './contracts';
import {defaultCatalog,MUJOCO_ARM,type CapabilityCatalog,type Access,type Mode} from './capabilities';
import {requiredBackends} from './scenario-matrix';
import {isArmPlantSet} from './backend-registry';
import {instantiateBackends,serverAssets} from './backend-registry';
import {compileAsset,verifyAssetHash,worldHash} from './assets';
import {hashJson} from './hash';
import {createClock,TICK_MS,type Clock} from './clock';
import {actorStream,PRNG} from './random';
import {scenarioRegistry,scenarioHash,checkScenario,resolveRoles,type Roles,type ScenarioDefinition} from './scenario-registry';
import {readCheckpoint,writeCheckpoint} from './checkpoint';
import {SourceSession,mealFor} from './session';
import {MockPlant,MockAmrAdapter,MOCK_AMR,MOCK_AMR_PARAMS,type PlantState,type PlantFault} from './backends/mock-amr';
import type {ArmProgramRecord,Attention,BusinessEvent,CoffeeView,EntityView,RunReport,WorkloadItem} from './report';
import type {CoffeePlantPorts} from './beverage/coffee-ports';
import type {CoffeeContext} from './scenarios/coffee';
import {CoffeeDriver,initialCoffee,COFFEE_RECIPES,COFFEE_POLICY,COFFEE_FAULTS,ARM_FAULTS,DOCK_TOLERANCE_M,type CoffeeState} from './scenarios/coffee';
import {MOCK_COFFEE_PARAMS} from '../../../cell-adapters/src/mock-coffee';
import {MOCK_ARM_PARAMS,ARM_CHOREOGRAPHY} from '../../../cell-adapters/src/mock-arm';
import {PUMA560_SI,XARM6_SI,type ArmModelSI} from './models/arm-kinematics';
import {DEFAULT_ARM_GEOMETRY} from './models/arm-collision';
import {declareArmScene,materializeArmScene,validateArmCollisionProfile} from './models/arm-scene';
import {TelemetryRecorder,TELEMETRY_RATE_TICKS} from './telemetry';
import {projectSamples} from './twin-projection';
import type {JournalEvents} from './event-stream';
import {awaitTick,realWall,type PaceAnchor,type WallClock} from './pace';
/** Locked engineering extension: the bundle ref plus the exact project and projection it was compiled from (absent for every legacy run). */
export interface EngineeringInputLock {ref:{bundleDigest:string;projectDigest:string};project:unknown;runtimeProjection:{project:unknown;assets:unknown[]};navigation?:{path:'navigation-scene.json';sha256:string;sceneDigest:string}}
export interface RunManifestInput {project:unknown;scenarioId:string;scenarioRevision:number;seed:number;mode:Mode;access:Access;backendSetId:string;sourceCommit:string;engineering?:EngineeringInputLock}
export interface RunProviders {directory:string;/** Server-side read of a file of the run's admitted engineering bundle (portable runs copy their locked scene from it). */bundleFile?:(bundleDigest:string,path:string)=>Promise<Uint8Array>;assets?:readonly AssetRevision[];catalog?:CapabilityCatalog;enabledBackends?:readonly string[];scenarios?:ReadonlyMap<string,ScenarioDefinition>;coffeePorts?:(state:CoffeeState,context:CoffeeContext,newBootId:()=>string,directory:string)=>CoffeePlantPorts|Promise<CoffeePlantPorts>;
 /** A plant arm whose program comes from its fixture (MuJoCo): what its ports run, for the manifest. Ignored unless the set's arm is a plant. */armProgram?:ArmProgramRecord;
 /** Wall clock of paced steps (tests inject a fake); consulted only by a step that carries `pace`. */wall?:WallClock}
export interface RunView {run:LabRunSnapshotV2;tick:number;simTimeNs:string;model:string;entities:EntityView[];workload:WorkloadItem[];awaiting:{subjectId:string;confirmationType:string;missionId:string;robotId:string}[];attention:Attention[];served:string;coffee:CoffeeView|null;controlAccess?:'view_reconcile'}
export interface ScenarioRun {readonly id:string;start():Promise<RunView>;action(action:unknown,beforeExecute?:()=>Promise<void>):Promise<RunView>;snapshot():Promise<RunView>;report():Promise<RunReport>;close():Promise<void>;holdForReclaim():Promise<RunView>;
 /** Cheap, synchronous liveness for stream heartbeats: never reads the journal. `paused` is the acknowledged pause of the virtual clock. */
 pulse():{tick:number;paused:boolean;runRevision:number};
 /** Durable business events in journal order (queued behind actions, so a reader sees committed state). */
 journal():Promise<JournalEvents[]>;
 /** Lossy, coalesced telemetry of this process (bounded, in memory). */
 readonly telemetry:TelemetryRecorder}
const EPOCH=Date.parse('2026-11-01T00:00:00Z'),ROBOT_TYPES=['robot.execute','robot.cancel','robot.requestStop'];
const FINAL=['completed','cancelled','failed'];
interface Confirmation {due:number|null;type:string;robotId:string}
interface Checkpoint {
 schemaVersion:2;runId:string;manifestHash:string;manifest:RunReport['manifest'];roles:Roles;trays:Record<string,number>;
 tick:number;started:boolean;paused:boolean;cancelled:boolean;suspended:boolean;revision:number;ordinal:number;dispatchDue:boolean;
 /** Telemetry publication sequence, independent of simulation time; retained across clean reopen with unchanged provider boots. */
 telemetrySeq?:number;
 reclaimed?:boolean;
 workload:WorkloadItem[];confirmations:Record<string,Confirmation>;parking:Record<string,string>;plant:PlantState;attention:Attention[];
 receipts:Record<string,{hash:string;view:RunView}>;rejectedObservations:RunReport['rejectedObservations'];reconciliations:RunReport['reconciliations'];
 recoveredOps:RunReport['recoveredOps'];confirmationLog:RunReport['confirmations'];faults:RunReport['faults'];
 pendingOps:{ordinal:number;operationId:string;type:string;payloadHash:string}[];inFlight:boolean;crashArmed:boolean;
 faultFires?:FaultFireRecord[];
 coffee?:CoffeeState;
}
class SimulatedCrash extends Error {constructor(){super('SIMULATED_CRASH');}}
const ID=/^[A-Za-z0-9_.:-]{1,200}$/;
function activeFaultEntities(project:LabProjectV2,roles:Roles){const ids=new Set([...roles.robots.map(r=>r.id),...roles.coffee?[roles.coffee.cellId,roles.coffee.armId]:[]]);return project.entities.filter(e=>ids.has(e.id));}
/** Runtime checks the JSON schema cannot express: unique ids, everything inside the world. */
/** `armModel`: the arm model of the run's arm provider (the set's, never the project's); a profile for another model is ARM_COLLISION_MODEL_MISMATCH. */
export function checkWorld(p:LabProjectV2,armModel:ArmModelSI=PUMA560_SI){
 if(p.armCollisionProfile)validateArmCollisionProfile(p.armCollisionProfile,armModel);
 const w=p.world,ids=new Set<string>();
 for(const o of [...w.points,...w.obstacles,...p.entities]){if(ids.has(o.id)||!ID.test(o.id))throw new Error('INVALID_PROJECT');ids.add(o.id);}
 if(![w.width,w.height].every(n=>Number.isFinite(n)&&n>0&&n<=1000))throw new Error('INVALID_PROJECT');
 for(const pt of w.points)if(!(pt.x>=0&&pt.y>=0&&pt.x<=w.width&&pt.y<=w.height))throw new Error('INVALID_PROJECT');
 for(const o of w.obstacles)if(!(o.x>=0&&o.y>=0&&o.width>0&&o.height>0&&o.x+o.width<=w.width&&o.y+o.height<=w.height))throw new Error('INVALID_PROJECT');
}
export async function createScenarioRun(input:RunManifestInput,providers:RunProviders):Promise<ScenarioRun>{
 const registered=(providers.scenarios??scenarioRegistry).get(input.scenarioId);if(!registered)throw new Error('SCENARIO_UNSUPPORTED');
 const capabilities=providers.catalog??defaultCatalog,runSet=Object.hasOwn(capabilities.sets,input.backendSetId)?capabilities.sets[input.backendSetId]:undefined,plantSet=isArmPlantSet(runSet);
 // the arm model is the run's arm provider's: the MuJoCo arm is the xArm 6, every other arm the PUMA 560 reference. Chosen by the set, so a project for the other model is refused.
 const armModel=runSet?.providers?.arm===MUJOCO_ARM.id?XARM6_SI:PUMA560_SI;
 if(plantSet&&!providers.coffeePorts)throw new Error('BACKEND_EXECUTION_DISABLED'); // a plant-backed arm is only ever the caller's ports; never a silent mock
 const backends=instantiateBackends(input.backendSetId,capabilities,providers.enabledBackends??[],requiredBackends(registered,plantSet?'simulation':'mock',input.backendSetId,capabilities));
 if(input.mode!==backends.mode||input.access!==backends.access)throw new Error('MODE_BACKEND_MISMATCH');
 const valid=validateProjectV2(input.project);if(!valid.ok)throw new Error('INVALID_PROJECT');
 const project=structuredClone(valid.value);checkWorld(project,armModel);
 const scenario=structuredClone(registered);
 checkScenario(scenario);if(scenario.revision!==input.scenarioRevision)throw new Error('SCENARIO_REVISION_MISMATCH');
 // A coffee scenario needs the coffee and arm backends of the locked set; there is no fallback to an AMR-only run.
 if(scenario.coffee&&!(backends.backends.includes('mock_coffee')&&(backends.backends.includes('mock_arm')||backends.backends.includes('webots_arm')||backends.backends.includes(MUJOCO_ARM.id))))throw new Error('SCENARIO_BACKEND_MISSING');
 if(!Number.isSafeInteger(input.seed)||input.seed<0||input.seed>0xffffffff)throw new Error('INVALID_SEED');
 const roles=resolveRoles(scenario,project),catalog=[...(providers.assets??[]),...serverAssets],radius:Record<string,number|null>={},trays:Record<string,number>={};
 const faultSchedule=validateFaultSchedule(project.faultSchedule??[],activeFaultEntities(project,roles),'mock',runSet?.providers?.arm);
 const assets=project.entities.map(e=>{
  const supplied=catalog.find(a=>a.contentHash===e.assetRef.contentHash);
  if(supplied&&(!verifyAssetHash(supplied)||supplied.id!==e.assetRef.id||supplied.revision!==e.assetRef.revision))throw new Error('ASSET_HASH_MISMATCH');
  // An unresolved asset is unknown geometry: point model for motion, and no collision metric is reported.
  const compiled=supplied?compileAsset(supplied):null;radius[e.id]=compiled?.collision.radiusM??null;
  trays[e.id]=supplied?Math.max(1,supplied.frames.filter(f=>/^tray_\d+$/.test(f.id)).length):1;
  return {...e.assetRef,resolved:!!compiled};
 });
 const armCollisionScene=scenario.coffee?declareArmScene(project,radius,roles.robots.map(r=>r.id),armModel):undefined;
 // a plant arm that runs its fixture's program (MuJoCo) records that program, its motion and its geometry; every other run keeps the mock arm's parameters
 const program=plantSet?providers.armProgram:undefined;
 const armProfile=program?{kinematics:armModel,program:{fixture:program.fixture,physicsDigest:program.physicsDigest,programsDigest:program.programsDigest,waypointsDigest:program.waypointsDigest,programs:program.programs},collision:{engine:'capsule-sweep-v1',toleranceM:0.0005},...armCollisionScene?{scene:armCollisionScene}:{}}
  :{kinematics:armModel,motion:MOCK_ARM_PARAMS,choreography:ARM_CHOREOGRAPHY,geometry:DEFAULT_ARM_GEOMETRY,collision:{engine:'capsule-sweep-v1',toleranceM:0.0005},...armCollisionScene?{scene:armCollisionScene}:{}},modelParameters={amr:MOCK_AMR_PARAMS,...scenario.coffee?{coffee:MOCK_COFFEE_PARAMS,arm:armProfile,coffeePolicy:COFFEE_POLICY}:{}},configuration={revision:1,hash:hashJson({roles,trays,modelParameters,entitySpeedLimits:project.entities.map(e=>({id:e.id,speedLimitMps:e.speedLimitMps??MOCK_AMR_PARAMS.speedMps})),fleet:scenario.fleet??{}})};
 const manifest:Omit<RunReport['manifest'],'runId'>={...input.engineering?{engineering:input.engineering.ref}:{},...faultSchedule.length?{faultSchedule:{entries:faultSchedule,hash:hashJson(faultSchedule)}}:{},sourceCommit:input.sourceCommit,mode:backends.mode,access:'simulated',backendSetId:backends.setId,backends:backends.descriptors.map(d=>({...d})),prng:{...PRNG},clock:{tickMs:TICK_MS},seed:input.seed,
  scenario:{id:scenario.id,revision:scenario.revision,hash:scenarioHash(scenario)},project:{id:project.id,revision:project.revision,hash:hashJson(project)},world:{id:project.world.id,revision:project.world.revision,hash:worldHash(project.world)},assets,
  hashAlgorithm:'sha256-canonical-json-v1',designHash:hashJson(project.entities),adapterHash:hashJson({sourceCommit:input.sourceCommit,backends:backends.descriptors}),configuration,
  recipes:COFFEE_RECIPES.filter(r=>scenario.coffee?.orders.some(o=>o.recipe===r.id)).map(r=>({id:r.id,revision:r.revision,hash:r.hash})),
  models:[{id:MOCK_AMR.id,revision:MOCK_AMR.version,hash:hashJson(MOCK_AMR_PARAMS),provenance:'illustrative'},...scenario.coffee?[{id:'mock_coffee',revision:'1',hash:hashJson(MOCK_COFFEE_PARAMS),provenance:'illustrative'},{id:armModel.id,revision:armModel.revision,hash:hashJson(armProfile),provenance:armModel===XARM6_SI?'manufacturer_nominal':'illustrative_reference'}]:[]],
  profiles:[{id:'mock-runtime',revision:1,hash:configuration.hash,provenance:'illustrative'},...armCollisionScene?.profile?[{id:armCollisionScene.profile.id,revision:armCollisionScene.profile.revision,hash:armCollisionScene.profileHash!,provenance:armCollisionScene.profile.provenance}]:[]],calibration:{status:'not_calibrated',revision:null,hash:null,reason:'MOCK_ILLUSTRATIVE'},...armCollisionScene?{armCollisionScene}:{},...program?{armProgram:structuredClone(program)}:{}};
 const manifestHash=hashJson(manifest),dir=providers.directory;
 await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 let cp=await readCheckpoint<Checkpoint>(dir);
 if(cp&&cp.manifestHash!==manifestHash)throw new Error('RUN_IDENTITY_MISMATCH');
 const fresh=!cp;
 if(fresh&&(await readdir(dir)).length)throw new Error('RECOVERY_CHECKPOINT_MISSING');
 if(!cp){
  const runId=randomUUID(),point=(id:string)=>project.world.points.find(p=>p.id===id)!,draws=new Map<string,ReturnType<typeof actorStream>>();
  const draw=(actor:string,range:readonly [number,number])=>{const s=draws.get(actor)??actorStream(input.seed,actor);draws.set(actor,s);return s.int(range[0],range[1]);};
  const workload=scenario.orders.map((o,i)=>({actor:o.actor,tableId:roles.tables[o.table]!,quantity:o.quantity,atTick:draw(o.actor,o.atTick),sessionId:`lab-session-${i+1}`,status:'planned' as const}));
  cp={schemaVersion:2,runId,manifestHash,manifest:{runId,...manifest},roles,trays,tick:0,started:false,paused:false,cancelled:false,suspended:false,revision:0,ordinal:0,dispatchDue:false,
   workload,confirmations:{},parking:{},attention:[],receipts:{},rejectedObservations:[],reconciliations:[],recoveredOps:[],confirmationLog:[],faults:[],pendingOps:[],inFlight:false,crashArmed:false,
   ...scenario.coffee&&roles.coffee?{coffee:initialCoffee(scenario.coffee.orders,roles.coffee,roles.tables,draw)}:{},
   plant:{width:project.world.width,height:project.world.height,obstacles:structuredClone(project.world.obstacles),injected:[],contacts:0,minSeparationM:null,maxConcurrentMovers:0,
    robots:roles.robots.map(r=>({id:r.id,radiusM:radius[r.id]!,speedLimitMps:project.entities.find(e=>e.id===r.id)?.speedLimitMps??MOCK_AMR_PARAMS.speedMps,pose:{x:point(r.parkingId).x,y:point(r.parkingId).y,yawRad:0},bootId:randomUUID(),seq:0,goals:[],lastCompleted:null,moving:false,hold:null,stale:false,distanceM:0}))}};
 }
 const run=new Run(dir,cp,scenario,project,providers.wall??realWall);
 const coffee=roles.coffee&&scenario.coffee?{...roles.coffee,recipes:CoffeeDriver.recipes(scenario.coffee.orders)}:undefined;
 run.source=await SourceSession.open(dir,cp.runId,()=>run.clock.nowMs(),{project,robots:roles.robots.map(r=>({...r,trays:trays[r.id]!})),stationIds:[...new Set([roles.stationId,...coffee?[coffee.stationId]:[]])],...coffee?{coffee}:{},...scenario.fleet?{fleet:scenario.fleet}:{}},fresh);
 try{await run.attach(providers.coffeePorts);
 // telemetry is not checkpointed: a reopened run starts a new buffer and says so
 if(!fresh)run.telemetry.gap('RUNTIME_RESTART',null,cp.tick);
 await run.initializeCoffee();
 if(cp.inFlight)await run.recover();
 run.recoverFaultSchedule();
 run.record();
 await run.persist();
 return run;
 }catch(error){await run.close();throw error;}
}
class Run implements ScenarioRun {
 source!:SourceSession;
 readonly clock:Clock;
 private plant!:MockPlant;
 private adapters:MockAmrAdapter[]=[];
 private observations:RobotEvent[]=[];
 private coffee?:CoffeeDriver;
 private queue:Promise<unknown>=Promise.resolve();
 private closed=false;
 /** Paced-step anchor (D57): memory only, never checkpointed or digested; cleared by pause, resume, cancel, an unpaced step and a reopen. */
 private anchor:PaceAnchor|null=null;
 readonly telemetry=new TelemetryRecorder();
 constructor(private dir:string,private cp:Checkpoint,private scenario:ScenarioDefinition,private project:LabProjectV2,private wall:WallClock){this.clock=createClock(EPOCH,cp.tick,cp.paused);}
 get id(){return this.cp.runId;}
 async attach(coffeePorts?:RunProviders['coffeePorts']){
  this.plant=new MockPlant(this.cp.plant,()=>this.clock.nowMs(),randomUUID);
  this.adapters=this.cp.roles.robots.map(r=>new MockAmrAdapter(this.plant,{id:r.id,adapter:'simulator',protocolVersion:'1',firmware:`${MOCK_AMR.id}@${MOCK_AMR.version}`,capabilities:['delivery'],mapId:'lab-world',mapRevision:String(this.project.world.revision),offlineExecution:true,maxLoadMinor:'10000',trays:this.cp.trays[r.id]!,validation:'simulated'}));
  for(const a of this.adapters)a.observe(e=>this.observations.push(e));
  const c=this.cp;
  if(c.coffee){
   const pickup=this.project.world.points.find(p=>p.id===c.coffee!.stationId)!,robotId=c.roles.robots[0]!.id;
   const collisionRobots=()=>c.plant.robots.map(({id,radiusM,pose})=>({id,radiusM,pose:{...pose}}));
   let previousRobots=collisionRobots();
   const context:CoffeeContext={source:this.source,runId:c.runId,directory:this.dir,nowMs:()=>this.clock.nowMs(),tick:()=>c.tick,
    armScene:()=>{const robots=collisionRobots(),scene=materializeArmScene(c.manifest.armCollisionScene!,robots,c.tick,previousRobots);previousRobots=robots;return scene;},
    submit:(type,payload,observer)=>this.submit(type,payload,observer),must:(type,payload)=>this.must(type,payload),
    // tray receiver: the run's robot stopped at the pickup point within 5 cm (illustrative dock tolerance)
    receiver:()=>{const r=c.plant.robots.find(x=>x.id===robotId)!;return !r.stale&&!r.moving&&Math.hypot(r.pose.x-pickup.x,r.pose.y-pickup.y)<=DOCK_TOLERANCE_M?{robotId,slot:1}:null;},
    dock:()=>{const r=c.plant.robots.find(x=>x.id===robotId)!;return {robotId,errorM:Math.hypot(r.pose.x-pickup.x,r.pose.y-pickup.y),moving:r.moving,localizationValid:!r.stale,bootId:r.bootId};},
    confirmLoad:async(missionId,stopId,robot)=>{const key=`${missionId}/${stopId}`;c.confirmations[key]={due:c.tick,type:'load',robotId:robot};await this.confirmStop(key,'system');},
    createMission:async(allocationId)=>{
     const food=this.scenario.mixFoodCoffee?c.workload.filter(w=>!w.missionId):[];if(food.some(w=>w.status!=='placed'))return null;
     const r=await this.must('Mission.Create',{allocationIds:[...food.map(w=>w.allocationId!),allocationId],robotId});const missionId=String(r.value.missionId);
     for(const w of food)w.missionId=missionId;return missionId;
    },
    attention:a=>c.attention.push({...a,tick:c.tick}),suspend:()=>this.suspend(),
    rejected:r=>{c.rejectedObservations.push({...r,tick:c.tick});if(c.rejectedObservations.length>1000)c.rejectedObservations.shift();}};
   this.coffee=new CoffeeDriver(c.coffee,context,randomUUID,await coffeePorts?.(c.coffee,context,randomUUID,this.dir));
  }
 }
 async initializeCoffee(){await this.coffee?.initialize();}
 persist(){return writeCheckpoint(this.dir,this.cp);}
 record(){const c=this.cp;c.telemetrySeq=(c.telemetrySeq??c.tick)+1;this.telemetry.record(projectSamples({runId:c.runId,seq:String(c.telemetrySeq),simTimeNs:this.clock.simTimeNs(),nowMs:this.clock.nowMs(),robots:c.plant.robots,...c.coffee?{coffee:c.coffee}:{}},String(process.hrtime.bigint())));}
 pulse(){const c=this.cp;return {tick:c.tick,paused:c.paused,runRevision:c.revision};}
 journal(){return this.queue.then(async()=>{if(this.closed)throw new Error('RUN_CLOSED');return (await this.source.journal()).map(entry=>({sequence:entry.sequence,at:entry.recordedAt,events:(entry.payload.events as unknown as DomainEvent[]).map(e=>({type:e.type,kind:String(e.data.kind),id:String(e.data.id),state:(e.data.state??{}) as JsonObject}))}));});}
 /** Crash between journal commit and checkpoint: the journal is ahead of the plant. Rebuild poses from source, report in-flight goals unknown, suspend the script. */
 async recover(){
  const c=this.cp;c.crashArmed=false;
  for(const op of c.pendingOps)c.recoveredOps.push({ordinal:op.ordinal,operationId:op.operationId,type:op.type,committed:!!await this.source.receipt(op.operationId,op.payloadHash)});
  c.pendingOps=[];
  for(const r of c.plant.robots){
   const robot=await this.source.read('robot',r.id),at=(robot.state.bindings as JsonObject)[String(robot.state.position)] as {x:number;y:number};
   Object.assign(r,{pose:{x:at.x,y:at.y,yawRad:0},goals:[],bootId:randomUUID(),seq:0,moving:false,hold:null,stale:true});
   if(typeof robot.state.missionId!=='string')continue;
   const m=await this.source.read('mission',robot.state.missionId),stop=(m.state.stops as JsonObject[]).find(s=>s.id===m.state.currentStopId);
   if(!FINAL.includes(String(m.state.status))&&stop?.status==='travelling')this.plant.reportLost(r.id,(await this.source.read('robot-command',String(m.state.commandId))).state as unknown as RobotCommand);
  }
  c.attention.push({reason:'RECOVERY_UNKNOWN',tick:c.tick});c.suspended=true;c.confirmations={};
  await this.drain();await this.coffee?.recover();
  await this.scanArrivals(); // a robot still waiting at a stop gets a human confirmation (the script is suspended)
  c.inFlight=false;c.dispatchDue=true;c.revision++;
 }
 private async submit(type:string,payload:JsonObject,robotId?:string):Promise<CommandResult>{
  if(type==='Mission.Create'){
   const limits=this.project.entities.filter(e=>e.kind==='amr'&&(payload.robotId===undefined||e.id===payload.robotId)).flatMap(e=>e.speedLimitMps===undefined?[]:[e.speedLimitMps]);
   if(limits.length)payload={...payload,speedLimitMps:Math.min(...limits,typeof payload.speedLimitMps==='number'?payload.speedLimitMps:Infinity)};
  }
  const c=this.cp,ordinal=++c.ordinal,operationId=`op-${ordinal}`;
  c.pendingOps.push({ordinal,operationId,type,payloadHash:hashPayload(payload)});await this.persist();
  const result=await this.source.submit(type,payload,operationId,robotId);
  if(result.status==='accepted'&&c.crashArmed&&type==='Robot.Observe')throw new SimulatedCrash();
  if(result.status==='accepted'&&Array.isArray(result.value.effects)&&result.value.effects.length)c.dispatchDue=true;
  return result;
 }
 /** Scripted inputs must be accepted by source; a rejection is a scenario finding, recorded and the script suspended. */
 private async must(type:string,payload:JsonObject){const r=await this.submit(type,payload);if(r.status!=='accepted')throw Object.assign(new Error('SCRIPTED_INPUT_REJECTED'),{code:r.code??r.status});return r;}
 private async placeOrder(w:WorkloadItem){
  const station=this.cp.roles.stationId,quantity=String(w.quantity);
  const existing=this.scenario.coffee?(await this.source.read('table',w.tableId)).state.activeSessionId:null;
  if(typeof existing==='string')w.sessionId=existing;else await this.must('Session.Open',{sessionId:w.sessionId,tableId:w.tableId});
  const placed=await this.must('Order.Place',{sessionId:w.sessionId,tableId:w.tableId,menuVersion:1,items:[{itemId:mealFor(station),quantity}]});
  w.lineId=(placed.value.lineIds as string[])[0]!;
  await this.must('Kitchen.Ready',{lineId:w.lineId,quantity,stationId:station,expectedVersion:(await this.source.read('fulfillment',w.lineId)).version});
  const allocation=await this.must('Fulfillment.Allocate',{lineId:w.lineId,quantity,expectedVersion:(await this.source.read('fulfillment',w.lineId)).version,method:'robot'});
  if(this.scenario.batch){w.allocationId=String(allocation.value.allocationId);w.status='placed';return;}
  w.missionId=await this.createMission([String(allocation.value.allocationId)]);w.status='placed';
 }
 /** Mission.Create for allocations; a scenario may name the robot and the payload so admission answers with that robot's own reason. */
 private async createMission(allocationIds:string[]){
  const s=this.scenario;
  return String((await this.must('Mission.Create',{allocationIds,...s.requestRobot?{robotId:this.cp.roles.robots[0]!.id}:{},...s.loadMinor?{loadMinor:s.loadMinor}:{}})).value.missionId);
 }
 private async scripted(){
  const c=this.cp;
  try{
   for(const w of c.workload)if(w.status==='planned'&&w.atTick<=c.tick)await this.placeOrder(w);
   // batch: one mission for every allocation, once the last order is placed
   if(this.scenario.batch&&!this.scenario.mixFoodCoffee&&c.workload.length&&c.workload.every(w=>w.status==='placed'&&!w.missionId)){const missionId=await this.createMission(c.workload.map(w=>w.allocationId!));for(const w of c.workload)w.missionId=missionId;}
   for(const [key,x] of Object.entries(c.confirmations))if(x.due!==null&&x.due<=c.tick)await this.confirmStop(key,'scripted');
   await this.coffee?.scripted();
  }catch(e){if((e as Error).message!=='SCRIPTED_INPUT_REJECTED')throw e;c.attention.push({reason:'SCRIPTED_INPUT_REJECTED',subjectId:(e as {code:string}).code,tick:c.tick});this.suspend();}
 }
 private async confirmStop(key:string,provenance:string){
  const c=this.cp,[missionId,stopId]=key.split('/') as [string,string],x=c.confirmations[key]!;
  if(this.plant.robot(x.robotId).stale)return;
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
   const r=await this.submit('Robot.Observe',robotEventCommand(e),robotId);
   if(r.status!=='accepted'){c.rejectedObservations.push({eventId:e.id,commandId:e.commandId,type:e.type,code:r.code??r.status,tick:c.tick});if(c.rejectedObservations.length>1000)c.rejectedObservations.shift();continue;}
   if(['failed','rejected','unknown'].includes(e.type))c.attention.push({reason:typeof e.payload.reason==='string'&&e.payload.reason!=='OBSERVER_REBOOT'&&e.payload.reason!=='RECOVERY_UNKNOWN'?e.payload.reason:e.type==='unknown'?'EXECUTION_UNKNOWN':`ROBOT_${e.type.toUpperCase()}`,robotId,subjectId:String(e.payload.missionId),commandId:e.commandId,tick:c.tick});
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
   // a coffee load is confirmed by the cell driver only after the cup's tray transfer is confirmed
   if(type==='load'&&this.coffee?.ownsLoad(m.ref.id,String(stop.targetId)))continue;
   // once the script is suspended (cancel, recovery, rejected input) no scripted staff remains: a load/handoff/return waits for a person
   c.confirmations[key]={due:type==='standby'?c.tick:this.scenario.confirm.mode==='scripted'&&!c.suspended?c.tick+this.scenario.confirm.delayTicks:null,type,robotId:id};
   if(type==='standby')await this.confirmStop(key,'system');
  }
 }
 private async dispatch(){
  if(this.coffee?.recoveryHeld)return;
  const c=this.cp;c.dispatchDue=false;
  for(const a of this.adapters)await dispatchRobotEffects(this.source.store,this.source.scope,a,this.clock.nowMs());
  await this.coffee?.dispatch();
  await this.drain();await this.coffee?.drain();
  const effects=(await this.source.effects()).filter(e=>ROBOT_TYPES.includes(String(e.type)));
  for(const e of effects.filter(e=>e.type==='robot.execute'&&e.status==='failed')){
   const p=e.payload as JsonObject;if(c.attention.some(a=>a.commandId===p.commandId))continue;
   const m=await this.source.read('mission',String(p.missionId));
   // A command that never left (expired, fenced) leaves its mission assigned: surface it instead of retrying.
   if(m.state.commandId===p.commandId&&['assigned','executing'].includes(String(m.state.status)))c.attention.push({reason:Date.parse(String(p.expiresAt))<=this.clock.nowMs()?'COMMAND_EXPIRED':'COMMAND_NOT_SENT',robotId:String(p.robotId),subjectId:m.ref.id,commandId:String(p.commandId),tick:c.tick});
  }
  if(effects.some(e=>e.status==='pending'))c.dispatchDue=true;
 }
 private async tick(){
  const c=this.cp;
  await this.coffee?.drain();
  this.schedule();
  await this.scheduledFaults();
  if(!c.suspended)await this.scripted();
  if(c.dispatchDue)await this.dispatch();
  this.clock.advance(1);c.tick=this.clock.tick;
  this.plant.advance();await this.coffee?.advance();
  await this.drain();await this.coffee?.drain();
  if(c.tick%TELEMETRY_RATE_TICKS===0)this.record();
 }
 recoverFaultSchedule(){
  for(const f of this.cp.faultFires??[])if(f.outcome==='dispatching'||f.outcome==='unknown'){
   f.outcome='unknown';if(!this.cp.attention.some(a=>a.reason==='FAULT_INJECTION_UNKNOWN'&&a.subjectId===f.id)){this.cp.attention.push({reason:'FAULT_INJECTION_UNKNOWN',subjectId:f.id,tick:this.cp.tick});this.cp.faults.push({tick:this.cp.tick,faultId:`schedule:${f.id}:unknown`,entityId:null});}this.suspend();
  }
 }
 private async faultPhase():Promise<FaultPhase>{
  for(const w of this.cp.coffee?.workload??[]){
   if(!w.jobId)continue;const j=(await this.source.read('coffee-job',w.jobId)).state;
   if(j.status==='loaded'||j.status==='delivered')return 'delivery';
   const cup=(await this.source.read('cup',String(j.cupId))).state;
   if(cup.ownerKind==='arm')return 'handoff';
   if(j.status==='ready_for_pickup')return 'grasp';
  }
  return this.cp.coffee?'brew':'delivery';
 }
 private async scheduledFaults(){
  const c=this.cp,entries=c.manifest.faultSchedule?.entries??[];if(!entries.length)return;
  const fired=c.faultFires??=[];
  // Ending an injection window never repairs custody, clears an interlock or resets a controller.
  for(const f of fired)if(!f.windowEnded&&c.tick*TICK_MS>=f.expiresAtMs){f.windowEnded=true;c.faults.push({tick:c.tick,faultId:`schedule:${f.id}:window-ended`,entityId:null});}
  if(c.suspended)return;
  for(const e of dueFaults(entries,new Set(fired.map(f=>f.id)),c.tick*TICK_MS,await this.faultPhase())){
   const record:FaultFireRecord={id:e.id,tick:c.tick,expiresAtMs:c.tick*TICK_MS+e.durationMs,outcome:'dispatching'};fired.push(record);c.faults.push({tick:c.tick,faultId:`schedule:${e.id}:fired`,entityId:e.targetId});await writeCheckpoint(this.dir,c,{sync:true});
   try{await this.injectFault(e.faultId,e.targetId);record.outcome='applied';}catch(error){record.outcome='unknown';this.recoverFaultSchedule();await this.persist();throw error;}
   await this.persist();if(c.suspended)break;
  }
 }
 private async injectFault(faultId:string,entityId:string){
  const c=this.cp;c.faults.push({tick:c.tick,faultId,entityId});
  if(COFFEE_FAULTS.includes(faultId)||ARM_FAULTS.includes(faultId))await this.coffee!.fault(faultId);
  else if(faultId==='crash-after-commit')c.crashArmed=true;
  else{this.plant.fault(entityId,faultId as PlantFault);await this.drain();
   if(faultId==='localization-lost'||faultId==='map-changed'){const reason=faultId==='map-changed'?'MAP_CHANGED':'LOCALIZATION_LOST';if(!c.attention.some(a=>a.reason===reason&&a.robotId===entityId))c.attention.push({reason,robotId:entityId,tick:c.tick});this.suspend();}
  }
 }
 /** No scripted staff after suspension: a confirmation already scheduled becomes a pending human confirmation (listed in `awaiting`). */
 private suspend(){const c=this.cp;c.suspended=true;for(const x of Object.values(c.confirmations))if(x.type!=='standby')x.due=null;}
 /** Scenario obstacles (person, chair, closed lane) enter and leave the plant world on their ticks; each change is logged as a fault entry. */
 private schedule(){
  const c=this.cp,injected=c.plant.injected;
  for(const o of this.scenario.obstacles??[]){
   const on=o.atTick<=c.tick&&(o.untilTick===undefined||c.tick<o.untilTick),i=injected.findIndex(x=>x.id===o.id);
   if(on&&i<0){injected.push({id:o.id,x:o.x,y:o.y,width:o.width,height:o.height});c.faults.push({tick:c.tick,faultId:`obstacle:${o.id}:on`,entityId:null});}
   else if(!on&&i>=0){injected.splice(i,1);c.faults.push({tick:c.tick,faultId:`obstacle:${o.id}:off`,entityId:null});}
  }
 }
 snapshot(){return this.queue.then(()=>{if(this.closed)throw new Error('RUN_CLOSED');return this.view();});}
 holdForReclaim(){
  const p=this.queue.then(async()=>{
   if(this.closed)throw new Error('RUN_CLOSED');const c=this.cp;
   if(!c.reclaimed){
    this.suspend();c.paused=true;this.clock.pause();
    // A reclaimed process can inspect and reconcile; its old motion is made unknown, never restarted from the checkpoint.
    for(const a of this.adapters)await a.requestStop('LOCAL_RECLAIM');await this.drain();await this.coffee?.recover();
    if(c.started&&!await this.missionsDone()){
     let targets=0;
     // A completed navigation can still be awaiting load/handoff. Identify its active mission even when requestStop emitted no event.
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
  if(a.kind==='step'&&c.tick+Number(p.ticks)>this.scenario.maxTicks)throw new Error('RUN_DURATION_EXCEEDED');
  if(a.kind==='reconcile'&&status!=='needs_attention')throw new Error('INVALID_STATE');
  if(a.kind==='cancel'&&(c.cancelled||['completed','cancelled'].includes(status)))throw new Error('INVALID_STATE');
  const cellFault=COFFEE_FAULTS.includes(String(p.faultId))?c.coffee?.cellId:ARM_FAULTS.includes(String(p.faultId))?c.coffee?.armId:null;
  if(a.kind==='injectFault'){try{validateFaultTarget(String(p.faultId),String(p.entityId??cellFault??c.roles.robots[0]!.id),activeFaultEntities(this.project,c.roles),'mock',c.coffee?.arm.plantId);}catch{throw new Error('INVALID_FAULT');}}
  const pending=a.kind==='confirm'?Object.entries(c.confirmations).find(([k,x])=>x.due===null&&k.endsWith(`/${String(p.subjectId)}`)):undefined;
  if(a.kind==='confirm'&&!pending)throw new Error('CONFIRMATION_NOT_PENDING');
  if(pending&&pending[1].type!==p.confirmationType)throw new Error('CONFIRMATION_TYPE_MISMATCH');
  if(pending&&this.plant.robot(pending[1].robotId).stale)throw new Error('INVALID_STATE:LOCALIZATION_LOST');
  if(a.kind==='restoreCup'&&!await this.coffee?.canRestoreJob(String(p.subjectId)))throw new Error('INVALID_STATE:CUP_RESTORE_UNSAFE');
  // Admission applies only to a new action, inside the same queue as receipt replay and execution.
  // A lost response can therefore be retried even if providers became unavailable after success.
  await beforeExecute?.();
  c.inFlight=true;await this.persist();
  try{
   if(a.kind==='start')c.started=true;
   else if(a.kind==='pause'){c.paused=true;this.clock.pause();this.anchor=null;}
   else if(a.kind==='resume'){c.paused=false;this.clock.resume();this.anchor=null;}
   else if(a.kind==='step'){const pace=(a.payload as {pace?:{factor:number}}).pace;if(!pace)this.anchor=null;for(let i=0;i<Number(p.ticks);i++){if(pace)this.anchor=await awaitTick(this.wall,this.anchor,c.tick,pace.factor);await this.tick();}}
   else if(a.kind==='confirm')await this.confirmStop(pending![0],String(p.actorProvenance??'human'));
   else if(a.kind==='restoreCup'){
    if(!this.coffee)throw new Error('INVALID_STATE:CUP_RESTORE_UNSAFE');await this.coffee.restoreCup(String(p.subjectId));
   }
   else if(a.kind==='cancel'){
    c.cancelled=true;this.suspend();this.anchor=null;
    for(const w of c.workload.filter((x,i,a)=>a.findIndex(y=>y.missionId===x.missionId)===i))if(w.missionId){const m=await this.source.read('mission',w.missionId);if(!FINAL.includes(String(m.state.status))&&m.state.status!=='cancelling'){const r=await this.submit('Mission.Cancel',{missionId:m.ref.id,expectedVersion:m.version});if(r.status!=='accepted')c.attention.push({reason:'CANCEL_REJECTED',subjectId:m.ref.id,tick:c.tick});}}
    await this.coffee?.cancel();
    // cancelled missions moved on (skipped stops, return legs): drop old confirmations and re-read the stops robots are waiting at now
    c.confirmations={};await this.scanArrivals();
   }
   else if(a.kind==='injectFault')await this.injectFault(String(p.faultId),String(p.entityId??cellFault??c.roles.robots[0]!.id));
   else if(a.kind==='reconcile'){
    // Mock reconciliation queries the plant by command id and audits the answer. It never resends; a signed native proof is required to release.
    const subject=String(p.subjectId);
    if(this.coffee?.ownsJob(subject)){c.reconciliations.push({...await this.coffee.reconcile(subject),tick:c.tick});}else{
    let index=c.roles.robots.findIndex(r=>r.id===subject);
    for(let i=0;index<0&&i<c.roles.robots.length;i++)if((await this.source.read('robot',c.roles.robots[i]!.id)).state.missionId===subject)index=i;
    if(index<0)throw new Error('INVALID_ACTION');
    const missionId=(await this.source.read('robot',c.roles.robots[index]!.id)).state.missionId,commandId=typeof missionId==='string'?String((await this.source.read('mission',missionId)).state.commandId):null;
    c.reconciliations.push({subjectId:subject,commandId,nativeState:commandId?(await this.adapters[index]!.reconcile(commandId)).status:'idle',tick:c.tick});}
   }
   c.revision++;c.pendingOps=[];c.inFlight=false;this.record();
   const after=await this.view();c.receipts[a.actionId]={hash,view:after};await this.persist();return structuredClone(after);
  }catch(e){
   if(e instanceof SimulatedCrash){this.closed=true;try{await this.coffee?.close();}finally{await this.source.close();}throw e;}
   c.attention.push({reason:'ACTION_INTERRUPTED',tick:c.tick});c.revision++;c.inFlight=false;await this.persist();throw e;
  }
 }
 private async missionsDone(){
  const c=this.cp;
  if(c.workload.some(w=>w.status!=='placed')||this.coffee&&!this.coffee.done())return false;
  for(const w of c.workload)if((await this.source.read('mission',w.missionId!)).state.status!=='completed')return false;
  if(!this.scenario.park)return true;
  for(const r of c.roles.robots){const s=(await this.source.read('robot',r.id)).state;if(s.missionId||s.availability!=='idle'||(s.position!==r.parkingId))return false;}
  return true;
 }
 private async view():Promise<RunView>{
  const c=this.cp,m=c.manifest;
  let status:LabRunSnapshotV2['status']='running';
  const awaiting=Object.entries(c.confirmations).filter(([,x])=>x.due===null).map(([k,x])=>({subjectId:k.split('/')[1]!,confirmationType:x.type,missionId:k.split('/')[0]!,robotId:x.robotId}));
  if(!c.started)status='ready';
  else if(c.attention.length)status='needs_attention';
  else if(c.cancelled){let open=false;for(const w of [...c.workload,...c.coffee?.workload??[]])if(w.missionId&&!FINAL.includes(String((await this.source.read('mission',w.missionId)).state.status)))open=true;status=open?'running':'cancelled';}
  else if(await this.missionsDone())status='completed';
  else if(c.paused)status='paused';
  else if(awaiting.length)status='awaiting_confirmation';
  let served=0n;for(const lineId of [...c.workload.map(w=>w.lineId),...c.coffee?.workload.map(w=>w.lineId)??[]])if(lineId)served+=BigInt(String((await this.source.read('fulfillment',lineId)).state.served??'0'));
  const journal=await this.source.journal();
  return {run:{...m.faultSchedule?{faultScheduleHash:m.faultSchedule.hash}:{},schemaVersion:2,id:c.runId,mode:m.mode,access:'simulated',backendSetId:m.backendSetId,backends:m.backends.map(b=>b.id),status,runRevision:c.revision,eventCursor:journal.length?journal[journal.length-1]!.sequence:null,telemetryCursor:this.telemetry.cursor(),fidelity:'modeled',ageMs:0,sourceCommit:m.sourceCommit,scenarioId:m.scenario.id,scenarioRevision:m.scenario.revision,seed:m.seed},
   tick:c.tick,simTimeNs:this.clock.simTimeNs(),model:MOCK_AMR.model,entities:this.entities(),workload:structuredClone(c.workload),awaiting,attention:structuredClone(c.attention),served:String(served),coffee:this.coffee?await this.coffee.view():null,...c.reclaimed?{controlAccess:'view_reconcile' as const}:{}};
 }
 private entities():EntityView[]{
  return this.cp.plant.robots.map(r=>{const g=r.goals.find(x=>x.state==='executing')??r.goals[r.goals.length-1];
   return {id:r.id,kind:'amr',pose:{...r.pose},quality:r.stale?'stale':'valid',moving:r.moving,hold:r.hold,goal:g?{commandId:g.commandId,state:g.state}:null,path:g?.state==='executing'?g.path.map(p=>[p[0],p[1]] as [number,number]):[],distanceM:r.distanceM};});
 }
 async report():Promise<RunReport>{
  await this.queue;if(this.closed)throw new Error('RUN_CLOSED');
  const c=this.cp,v=await this.view(),known=c.plant.robots.every(r=>r.radiusM!==null);
  const businessEvents:BusinessEvent[]=(await this.source.journal()).flatMap(entry=>(entry.payload.events as unknown as DomainEvent[]).map(e=>({sequence:entry.sequence,at:entry.recordedAt,type:e.type,kind:String(e.data.kind),id:String(e.data.id),state:(e.data.state??{}) as JsonObject})));
  const telemetry=this.telemetry.report();
  const armAsset=this.project.entities.find(e=>e.kind==='arm')?.assetRef,arm=this.coffee&&armAsset?await this.coffee.armEvidence(this.dir,c.manifest.world,armAsset as unknown as JsonObject):null;
  return {schemaVersion:2,manifest:structuredClone(c.manifest),outcome:{status:v.run.status,served:v.served,tick:c.tick,simTimeNs:v.simTimeNs},attention:v.attention,workload:v.workload,entities:v.entities,businessEvents,
   effects:(await this.source.effects()).filter(e=>ROBOT_TYPES.includes(String(e.type))).map(e=>({id:String(e.id),type:String(e.type),status:String(e.status),attempts:Number(e.attempts),payload:e.payload as JsonObject})),
   metrics:{maxConcurrentMovers:c.plant.maxConcurrentMovers,holds:structuredClone(c.plant.holdLog??[]),distanceM:Object.fromEntries(c.plant.robots.map(r=>[r.id,r.distanceM])),collision:known?{available:true,contacts:c.plant.contacts,minSeparationM:c.plant.minSeparationM}:{available:false,reason:'GEOMETRY_UNKNOWN',contacts:null,minSeparationM:null}},
   rejectedObservations:structuredClone(c.rejectedObservations),reconciliations:structuredClone(c.reconciliations),recoveredOps:structuredClone(c.recoveredOps),confirmations:structuredClone(c.confirmationLog),faults:structuredClone(c.faults),...c.faultFires?{faultScheduleFires:structuredClone(c.faultFires)}:{},
   coverage:{businessSimulation:true,kinematicModel:true,dynamics:false,nativeExecution:false,physicalStop:false,sensorEvidence:false,eventStream:true,
    ...this.coffee?{coffeeProcessModel:true,armKinematics:true,armTorque:false,physicalGrip:false,fluidModel:false,armCollisionChecker:(c.coffee!.arm.collision?.checks??0)>0,armSceneCollision:(c.coffee!.arm.collision?.checks??0)>0&&c.coffee!.arm.collision?.scene?.available===true,armCollisionTraceComplete:(c.coffee!.arm.collision?.checks??0)>0&&c.coffee!.arm.collision?.evidence?.droppedIntervals===0}:{}},
   limitations:['mock_kinematic: constant-speed motion on a footprint grid; no dynamics, sensors or hardware collision avoidance.','Venue movement zone serialises robots; parallel granular zones are not enabled for the simulator profile.','Plant goals lost in a crash are reported unknown; mock reconciliation audits only and cannot release them without native proof.','Unresolved asset geometry runs a point model and reports no collision metric.',
    ...this.coffee?['mock_process coffee cell: illustrative rates/volumes, scalar quantities, no fluid/thermal model; measurements are modelled, not sensed.',
     c.manifest.armProgram?'mujoco_arm program: the fixture\'s solved waypoints commanded as quintic-sync-v1 joint trajectories and tracked by a simulated position-controlled xArm 6; dynamics nominal and assumed, not_calibrated; the capsule sweep checks model geometry on the actual joints, with no physical stopping proof.'
      :'mock_kinematic arm: illustrative joint waypoints and linear joint interpolation; capsule sweep checks model geometry, with no torque, grip force or physical stopping proof.',
     'Arm sweep evidence records motion and scene changes with attachment identity and referenced geometry; identical stationary checks share a tick interval. Evidence is bounded to 4096 intervals; droppedIntervals and armCollisionTraceComplete expose truncation. The first blocked sweep retains its geometry independently.',
     c.manifest.armCollisionScene?.profile?'Arm scene scope: project obstacle rectangles extruded from map z=0, declared illustrative heights, compiled AMR radii, conservative swept AABBs in the declared arm base frame. No calibrated fixture or robot mesh, force, or physical safety validation.':'Arm scene scope unavailable: no declared armCollisionProfile; checker covers self and injected arm-frame obstacles only.',
     'Coffee reconciliation is human-provenance audit only; consumption of an unknown step stays an open stock exception.']:[],
    ...arm?.armPlant.engine==='mujoco_3d'?[`mujoco_arm: the arm is a MuJoCo ${arm.armPlant.engineVersion} xArm 6 under position actuators with the fixture's Gripper G2. not_calibrated: masses, inertia, joint limits and forces are the manufacturer's nominal values; gains, friction, contact, pads and the cell layout are assumed. The cup is gripped, lifted and released by contact (the plant reports what the pads hold and where the cup rests); the AMR and the coffee machine are mocks. ARM03 is the swept capsule check on the actual joints every tick, not a physical safety proof.`]
     :arm?['webots_arm: the arm is a Webots R2025a rigid-body plant under position servo. not_calibrated: link masses, inertia, joint torque limits and floor friction are assumed fixture values. Gripping is an event of the program state machine, never physics; the AMR and the coffee machine are mocks. ARM03 is the swept capsule check on the actual joints every tick, not a physical safety proof.']:[]],
   ...this.coffee?{coffee:await this.coffee.report()}:{},...arm?{arm}:{},telemetry};
 }
 async close(){await this.queue;if(!this.closed){this.closed=true;try{await this.coffee?.close();}finally{await this.source.close();}}}
}
