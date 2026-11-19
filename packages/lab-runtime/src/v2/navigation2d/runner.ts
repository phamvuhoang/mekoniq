import {buildDriveEvidence} from '../control/drive-report';
import {experimentOfMobileModel} from '../control/drive-experiments';
import {admitDriveDocuments,mobileDrive,driveManifest,type MobileDrive} from '../control/drive-run';
import {openPhysicsRecorder,readPhysicsEvidence,readPhysicsManifest,preparePhysicsAdmission,validatePhysicsRecord,type PhysicsRecorder} from '../simulation3d/physics-evidence';
import {physicsMetrics} from '../simulation3d/physics-metrics';
// Fixed-step scenario runner for a plant port (IR-SIM today). The source runner is the only scheduler; per fixed 20 ms tick:
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
import {createNavigationController,NAVIGATION_CONTROLLER,type NavigationController} from './controller';
import {buildNavigationEvidence,engineSeedOf,EVIDENCE_LIMITS,navigationMetrics,openNavigationRecorder,readNavigationEvidence,type EvidenceIdentity,type Gap,type NavigationRecorder} from './evidence';
import {WorkerLostError,IRSIM_BACKEND,irsimPlant,type IRSimRuntimeOptions,type PlantPort,type PlantWorker} from './plant';
import {baseInMap,yawOf} from '../../engineering/navigation-model';
import {framePose} from '../../engineering/inertia';
import {quaternionFromYaw} from '../frames';
import {createIRSimNavigationAdapter,initialAdapterState,type IRSimAdapterState,type IRSimNavigationAdapter} from './adapter';
import {actorUpdatesAt,fixtureFile,resolveScenarioFixture,type ResolvedFixture} from './scenario-fixtures';
import {createZoneBridge,createZoneTraffic} from '../backends/zone-bridge';
import type {P,Pose2} from './geometry';
import {awaitTick,realWall,type PaceAnchor,type WallClock} from '../pace';

export type {IRSimRuntimeOptions,PlantPort};
export {IRSIM_BACKEND};
/** Process-wide worker slots (workers-runtime §6: two active runs per host). A run holds one from its start until its plant stops, is lost or the run closes. */
const slots=new Map<string,Set<string>>();
const slotsOf=(provider:string)=>{if(['mujoco_arm','mujoco_3d','mujoco_cell'].includes(provider))provider='mujoco_engine';let s=slots.get(provider);if(!s)slots.set(provider,s=new Set());return s;};
/** Live workers of one provider on this host (each plant has its own slots: a running IR-SIM never blocks Webots and the other way round). */
export const activeRunCount=(provider:string,exceptRunId?:string)=>[...slotsOf(provider)].filter(id=>id!==exceptRunId).length;
/** A plant that is not the fixed-step runner (the Webots arm) takes and gives back a slot of the provider it shares the engine with. */
/** Whether `runId` holds a live worker of `provider` now. */
export const holdsSlot=(provider:string,runId?:string)=>runId!==undefined&&slotsOf(provider).has(runId);
export const holdSlot=(provider:string,runId:string)=>{slotsOf(provider).add(runId);};
export const releaseSlot=(provider:string,runId:string)=>{slotsOf(provider).delete(runId);};
/** Whether `runId` (or, without one, a new run) may hold a live worker now. */
export const irsimCapacity=(limit=2,runId?:string,provider:string=IRSIM_BACKEND)=>runId!==undefined&&slotsOf(provider).has(runId)||slotsOf(provider).size<limit;
/** `bundleFile` (RunProviders) is needed only for a new run: the gateway authorised the bundle for the session before the run exists. */
export interface IRSimRunProviders extends RunProviders {irsim:IRSimRuntimeOptions}
const TILT_LIMIT_RAD=0.35,EVIDENCE_FLUSH_TICKS=100,EPOCH=Date.parse('2026-11-01T00:00:00Z'),ROBOT_TYPES=['robot.execute','robot.cancel','robot.requestStop'],FINAL=['completed','cancelled','failed'],SCENE='navigation-scene.json',FIXTURE='scenario-fixture.json';
const sha256=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
interface Confirmation {due:number|null;type:string;robotId:string}
interface PlantCheckpoint {status:'none'|'live'|'lost'|'stopped';reason:string|null;bootId:string|null;requests:number;snapshot:IRSimSnapshotV1|null;/** Mobile-only durable latch: create may have mutated the world, including tick-0 priming. */startupAttempt?:true}
interface Checkpoint {
 schemaVersion:1;provider:string;runId:string;manifestHash:string;manifest:RunReport['manifest'];roles:Roles;trays:Record<string,number>;
 tick:number;started:boolean;paused:boolean;cancelled:boolean;suspended:boolean;revision:number;ordinal:number;dispatchDue:boolean;telemetrySeq?:number;reclaimed?:boolean;
 workload:WorkloadItem[];confirmations:Record<string,Confirmation>;parking:Record<string,string>;attention:Attention[];
 receipts:Record<string,{hash:string;view:RunView}>;rejectedObservations:RunReport['rejectedObservations'];reconciliations:RunReport['reconciliations'];
 recoveredOps:RunReport['recoveredOps'];confirmationLog:RunReport['confirmations'];faults:RunReport['faults'];
 pendingOps:{ordinal:number;operationId:string;type:string;payloadHash:string}[];inFlight:boolean;
 plant:PlantCheckpoint;adapters:Record<string,IRSimAdapterState>;distanceM:Record<string,number>;maxConcurrentMovers:number;
 /** what the worker's describe reported when the plant started */
 engine?:{packageVersion:string;pythonVersion:string;hostArch?:'arm64'|'x86_64'};
 /** gaps the run asked the recorder for (a lost step ACK, a refused append): re-recorded on reopen when the manifest never got them */
 evidenceGaps?:Gap[];
 /** the recording's terminal reason once it ended: re-recorded on reopen when the manifest never got it (its write failed), so the evidence never turns complete */
 evidenceTerminal?:string|null;
 /** Only the registered braking campaign retains this bounded observation tail in the same world. */completionTail?:{firstTick:number;lastTick:number};
 /** contention rig only (scenario.rig): each robot's directly-given controller goal and its last decision */
 rig?:Record<string,{commandId:string;state:string;tick:number}>;
}

/** The locked navigation scene and the worker files it lists, verified against the bundle's project and this run's world. */
async function lockScene(input:RunManifestInput,project:LabProjectV2,roles:Roles,read:(path:string)=>Promise<Uint8Array>,engineId:string){
 const lock=input.engineering!,bytes=await read(SCENE).catch(()=>{throw new Error(`ENGINEERING_CLOSURE_MISSING:${SCENE}`);});
 const scene=JSON.parse(Buffer.from(bytes).toString('utf8')) as NavigationSceneV1,checked=validateNavigationDocument(scene);
 if(!checked.ok||scene.documentType!=='navigation-scene')throw new Error('NAVIGATION_SCENE_INVALID');
 if(lock.navigation&&(lock.navigation.sha256!==sha256(bytes)||lock.navigation.sceneDigest!==scene.sceneDigest))throw new Error('ENGINEERING_IDENTITY_MISMATCH');
 if(scene.inputs.project.digest!==lock.ref.projectDigest)throw new Error('ENGINEERING_IDENTITY_MISMATCH');
 if(scene.world.hash!==hashJson(project.world)||scene.world.id!==project.world.id||scene.world.revision!==project.world.revision)throw new Error('SCENE_WORLD_MISMATCH');
 if(scene.engine.id!==engineId||scene.clock.tickMs!==TICK_MS)throw new Error('NAVIGATION_SCENE_INVALID');
 if(!roles.robots.every(r=>scene.robots.some(x=>x.robotId===r.id)))throw new Error('SCENARIO_ROLE_UNBOUND');
 const bindings=scene.robots[0]!.targetBindings;
 // the source holds one binding table for the venue: every robot must stand at the same handoff for a point
 if(scene.robots.some(r=>hashJson(r.targetBindings)!==hashJson(bindings)))throw new Error('SCENE_BINDINGS_DIVERGE');
 const files:[string,Uint8Array][]=[[SCENE,bytes]];
 for(const f of scene.files){const b=await read(f.path).catch(()=>null);if(!b||sha256(b)!==f.sha256)throw new Error(`ENGINEERING_CLOSURE_MISSING:${f.path}`);files.push([f.path,b]);}
 return {scene,files};
}

/** The IR-SIM run: the shared fixed-step runner on the IR-SIM plant. */
export const createIRSimScenarioRun=(input:RunManifestInput,providers:IRSimRunProviders):Promise<ScenarioRun>=>createFixedStepScenarioRun(input,{...providers,plant:irsimPlant(),runtime:providers.irsim});

/** The one fixed-step runner. `plant` says which engine it drives and what the report may claim about it; `runtime` is the operator's worker options. */
export async function createFixedStepScenarioRun(input:RunManifestInput,providers:RunProviders&{plant:PlantPort;runtime:IRSimRuntimeOptions}):Promise<ScenarioRun>{
 const plant=providers.plant,amr=plant.identity.amr;
 const registered=(providers.scenarios??scenarioRegistry).get(input.scenarioId);if(!registered)throw new Error('SCENARIO_UNSUPPORTED');
 const catalog=providers.catalog??defaultCatalog,set=Object.hasOwn(catalog.sets,input.backendSetId)?catalog.sets[input.backendSetId]:undefined;
 if(!set)throw new Error('BACKEND_SET_UNKNOWN');
 // this runner executes only portable sets whose AMR provider is the plant it was given; nothing here falls back to another plant, the mock plant or a native provider
 if(set.execution?.host!=='portable_python'||set.providers?.amr!==amr.id)throw new Error('BACKEND_EXECUTION_DISABLED');
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
 if(providers.reclaimOnly&&!cp)throw Error('RECOVERY_CHECKPOINT_MISSING');
 const fresh=!cp;
 if(fresh&&(await readdir(dir)).length)throw new Error('RECOVERY_CHECKPOINT_MISSING');
 if(cp&&cp.provider!==amr.id)throw new Error('RUN_IDENTITY_MISMATCH');
 if(plant.identity.completionObservation&&(amr.id!=='mujoco_3d'||plant.identity.completionObservation.id!=='payload-brake-observation-v1'||plant.identity.completionObservation.extraTicks!==5))throw new Error('COMPLETION_OBSERVATION_UNREGISTERED');
 if(cp?.completionTail&&(!plant.identity.completionObservation||!Number.isSafeInteger(cp.completionTail.firstTick)||cp.completionTail.firstTick<0||cp.completionTail.lastTick!==cp.completionTail.firstTick+5||cp.tick<cp.completionTail.firstTick||cp.tick>cp.completionTail.lastTick))throw new Error('RECOVERY_CHECKPOINT_INVALID');
 if(cp?.evidenceTerminal!=null&&(typeof cp.evidenceTerminal!=='string'||!cp.evidenceTerminal||cp.evidenceTerminal.length>500))throw new Error('RECOVERY_CHECKPOINT_INVALID');
 // a new run copies its locked scene out of the bundle; a reopened one reads (and re-verifies) only its own copy
 const read=fresh?(path:string)=>{if(!providers.bundleFile)throw new Error('ENGINEERING_CLOSURE_MISSING');return providers.bundleFile(input.engineering!.ref.bundleDigest,path);}:(path:string)=>readFile(join(bundleDir,path));
 const {scene,files}=await lockScene(input,project,roles,read,amr.id);
 const stopMonitor=await plant.prepareStopMonitor?.(scene,read);
 // a scene that names a drive model and a control profile runs its AMR through the diff-drive controller and the virtual drive; one that names neither is the R2b path, untouched
 const driveDocs=amr.id==='mujoco_3d'?await admitDriveDocuments(scene,read,providers.runtime.workerRoot,scene.robots[0]!.model.physicalModelDigest):undefined;
 const drive=driveDocs?mobileDrive(driveDocs,{robotId:scene.robots[0]!.robotId,wheelRadiusM:scene.robots[0]!.model.kinematics.wheelRadiusM,wheelSeparationM:scene.robots[0]!.model.kinematics.wheelSeparationM}):undefined;
 const physics=plant.identity.amr.id==='mujoco_3d'?await preparePhysicsAdmission(scene,read):undefined;
 if(physics&&(providers.runtime.evidence?.maxBytes??EVIDENCE_LIMITS.maxBytes)>EVIDENCE_LIMITS.maxBytes)throw new Error('PHYSICS_COMBINED_QUOTA_INVALID');
 // the scenario's server-owned actors (immutable seeded schedules) and reservation zones on this scene; refused whole, never partly applied
 const fixture=resolveScenarioFixture(scenario.id,scene,input.seed),fixtureBytes=fixture.actors.length?Buffer.from(JSON.stringify(fixtureFile(fixture))):null;
 const mapId=scene.world.id,mapRevision=scene.sceneDigest,lock=providers.runtime.lockDigest;
 // an IR-FD01 run without actors or zones keeps its configuration identity exactly as before (no fixture key)
 const configuration={revision:1,hash:hashJson({...plant.identity.completionObservation?{completionObservation:plant.identity.completionObservation}:{},...plant.identity.simulationPerturbation?{simulationPerturbation:plant.identity.simulationPerturbation}:{},roles,trays,sceneDigest:scene.sceneDigest,policy:scene.policy.hash,controller:scene.policy.parameters.controller,...plant.identity.controller?{controllerImplementation:plant.identity.controller.identity}:{},entitySpeedLimits:project.entities.map(e=>({id:e.id,speedLimitMps:e.speedLimitMps??null})),fleet:scenario.fleet??{},...fixture.actors.length||fixture.zones.length?{scenarioFixture:fixture.hash}:{}})};
 const backends=[{...amr}];
 const manifest:Omit<RunReport['manifest'],'runId'>={...driveDocs?{drive:driveManifest(driveDocs,experimentOfMobileModel((scene.engine as {driveModelRef:{path:string}}).driveModelRef.path))}:{},...plant.identity.completionObservation?{completionObservation:structuredClone(plant.identity.completionObservation)}:{},...plant.identity.simulationPerturbation?{simulationPerturbation:structuredClone(plant.identity.simulationPerturbation)}:{},engineering:input.engineering.ref,sourceCommit:input.sourceCommit,mode:'simulation',access:'simulated',backendSetId:input.backendSetId,backends,prng:{...PRNG},clock:{tickMs:TICK_MS,businessEpochMs:EPOCH},seed:input.seed,
  scenario:{id:scenario.id,revision:scenario.revision,hash:scenarioHash(scenario),...scenario.basedOn?{basedOn:{...scenario.basedOn}}:{}},project:{id:project.id,revision:project.revision,hash:hashJson(project)},world:{id:project.world.id,revision:project.world.revision,hash:worldHash(project.world)},assets,
  hashAlgorithm:'sha256-canonical-json-v1',designHash:hashJson(project.entities),adapterHash:hashJson({sourceCommit:input.sourceCommit,backends,workerLockDigest:lock,files:files.map(([p,b])=>[p,sha256(b)])}),configuration,recipes:[],
  models:[{id:amr.id,revision:amr.version,hash:scene.sceneDigest,provenance:'simulated_plant'},...scene.robots.map(r=>({id:`navigation-model:${r.robotId}`,revision:String(r.model.schemaVersion),hash:r.model.modelDigest,provenance:'projected'}))],
  profiles:[{id:scene.policy.id,revision:scene.policy.revision,hash:scene.policy.hash,provenance:scene.policy.source.kind}],calibration:{status:'not_calibrated',revision:null,hash:null,reason:'SIMULATED_PLANT'}};
 const manifestHash=hashJson(manifest);
 if(cp&&cp.manifestHash!==manifestHash)throw new Error('RUN_IDENTITY_MISMATCH');
 // a reopened run's actor file must still be exactly the one its manifest identity was made from
 if(cp&&fixtureBytes&&sha256(await readFile(join(bundleDir,FIXTURE)).catch(()=>Buffer.alloc(0)))!==sha256(fixtureBytes))throw new Error('RUN_IDENTITY_MISMATCH');
 if(!cp){
  for(const [path,bytes] of files){await mkdir(dirname(join(bundleDir,path)),{recursive:true});await writeFile(join(bundleDir,path),bytes,{mode:0o600,flag:'wx'});}
  if(fixtureBytes)await writeFile(join(bundleDir,FIXTURE),fixtureBytes,{mode:0o600,flag:'wx'});
  const runId=randomUUID(),draws=new Map<string,ReturnType<typeof actorStream>>();
  const draw=(actor:string,range:readonly [number,number])=>{const s=draws.get(actor)??actorStream(input.seed,actor);draws.set(actor,s);return s.int(range[0],range[1]);};
  const workload=scenario.orders.map((o,i)=>({actor:o.actor,tableId:roles.tables[o.table]!,quantity:o.quantity,atTick:draw(o.actor,o.atTick),sessionId:`lab-session-${i+1}`,status:'planned' as const}));
  cp={schemaVersion:1,provider:amr.id,runId,manifestHash,manifest:{runId,...manifest},roles,trays,tick:0,started:false,paused:false,cancelled:false,suspended:false,revision:0,ordinal:0,dispatchDue:false,
   workload,confirmations:{},parking:{},attention:[],receipts:{},rejectedObservations:[],reconciliations:[],recoveredOps:[],confirmationLog:[],faults:[],pendingOps:[],inFlight:false,
   plant:{status:'none',reason:null,bootId:null,requests:0,snapshot:null},adapters:Object.fromEntries(roles.robots.map(r=>[r.id,initialAdapterState()])),distanceM:Object.fromEntries(roles.robots.map(r=>[r.id,0])),maxConcurrentMovers:0};
 }
 const bindings=Object.fromEntries(scene.robots[0]!.targetBindings.map(t=>[t.pointId,{waypointId:t.pointId,mapId,mapRevision,frame:'map' as const,x:t.x,y:t.y,yaw:t.yaw}]));
 const sceneBytes=files[0]![1],lockFile=join(providers.runtime.workerRoot,'requirements.lock'),lockText=await readFile(lockFile,'utf8').catch(()=>'');
 // the NumPy pin is read from the lock only when that file is the lock the worker was admitted with
 const numpy=sha256(lockText)===lock?/^numpy==(\S+)/m.exec(lockText)?.[1]??'unpinned':'unverified';
 const identity:Omit<EvidenceIdentity,'engine'>={runId:cp.runId,sourceCommit:input.sourceCommit,sceneRef:{path:`bundle/${SCENE}`,sha256:sha256(sceneBytes),bytes:sceneBytes.length},lockDigest:lock,numpyVersion:numpy,runSeed:input.seed,
  actorRng:{algorithm:`${PRNG.algorithm} ${PRNG.seeding} v${PRNG.version}`,seed:input.seed},controller:{...(plant.identity.controller?.identity??NAVIGATION_CONTROLLER)},businessEpochMs:EPOCH};
 // the recording limit is the run's tick budget too: the scenario's maxTicks, never above the 30,000-tick quota
 // every terminal the recorder produces (any flush, the tick limit, close) goes into the checkpoint before its manifest write is attempted
 const owner:{run?:FixedStepRun}={},opened=cp;
 const recorder=await openNavigationRecorder({knownTerminal:cp.evidenceTerminal??null,onTerminal:async reason=>{const c=owner.run?.checkpoint??opened;c.evidenceTerminal=reason.slice(0,500);await writeCheckpoint(dir,c);},directory:join(dir,'evidence'),scene,runId:cp.runId,...providers.runtime.evidence,maxTicks:Math.min(providers.runtime.evidence?.maxTicks??Infinity,scenario.maxTicks,EVIDENCE_LIMITS.maxTicks)});
 const run=new FixedStepRun(dir,cp,scenario,project,scene,providers.runtime,plant,{mapId,mapRevision},recorder,identity,fixture,providers.wall??realWall,stopMonitor,physics,drive);owner.run=run;
 run.source=await SourceSession.open(dir,cp.runId,()=>run.clock.nowMs(),{epochMs:EPOCH,navigation:{mapId,mapRevision,bindings},project,robots:roles.robots.map(r=>({...r,trays:trays[r.id]!})),stationIds:[roles.stationId],...scenario.fleet?{fleet:scenario.fleet}:{}},fresh).catch(async(e:unknown)=>{await recorder.close();throw e;});
 run.traffic=fixture.zones.length?createZoneTraffic(createZoneBridge(run.source,{async enter(){}},()=>`op-${++run.checkpoint.ordinal}`),fixture.zones,{clearanceM:scene.policy.parameters.safetyMarginM+2*scene.policy.parameters.gridResolutionM}):undefined;
 try{
  if(!fresh)run.telemetry.gap('RUNTIME_RESTART',null,cp.tick);
  // ticks the previous process committed but never made durable are a recorded hole, never filled in
  const durable=recorder.lastTick??-1;
  if(!fresh&&cp.started&&cp.tick>durable&&!recorder.committed().gaps.some(g=>g.fromTick===durable+1&&g.toTick===cp.tick))await recorder.gap({fromTick:durable+1,toTick:cp.tick,reason:'RUNTIME_RESTART'});
  // an action was in flight on a live plant: a step may have been applied and never acknowledged; that tick is unknown, never assumed clean
  const unknown=Math.max(cp.tick,durable)+1;
  if(!fresh&&cp.inFlight&&cp.plant.status==='live'&&!recorder.committed().gaps.some(g=>g.fromTick===unknown))await recorder.gap({fromTick:unknown,toTick:unknown,reason:'STEP_ACK_LOST'});
  // a gap the checkpoint knows of but the manifest never got (its write failed before the process ended) is recorded now, never forgotten
  for(const g of cp.evidenceGaps??[])if(!recorder.committed().gaps.some(x=>x.fromTick===g.fromTick&&x.toTick===g.toTick&&x.reason===g.reason))await recorder.gap(g);
  // so is the terminal reason: a recording the checkpoint says ended is never reopened as one that did not
  if(cp.evidenceTerminal&&!recorder.terminal)await recorder.terminate(cp.evidenceTerminal);
  // the worker of a started run died with the previous process: its legs are unknown, never continued
  if(cp.inFlight||cp.plant.status==='live')await run.recover();
  run.record();await run.persist();
  return run;
 }catch(error){await run.close();throw error;}
}

/** A 3D pose that is not finite, tilts more than 0.35 rad, or has its base more than 0.6 wheel radii below or 4 above the height the robot first stood at (the floor itself, z = 0, bounds the rest height from below, so a robot that sank before its first sample is caught). */
export function poseUnstable(p:{z:number;roll:number;pitch:number},wheelRadiusM:number,restZ:number):boolean{
 return![p.z,p.roll,p.pitch].every(Number.isFinite)||Math.abs(p.roll)>TILT_LIMIT_RAD||Math.abs(p.pitch)>TILT_LIMIT_RAD||p.z<Math.max(restZ,0)-0.6*wheelRadiusM||p.z>restZ+4*wheelRadiusM;
}
class FixedStepRun implements ScenarioRun {
 source!:SourceSession;
 /** reservation zones of the scenario fixture (Zone.Reserve/Release through the zone bridge), absent without zones */
 traffic?:ReturnType<typeof createZoneTraffic>;
 readonly clock:Clock;
 readonly telemetry:TelemetryRecorder;
 private controller:NavigationController;
 private adapters=new Map<string,IRSimNavigationAdapter>();
 private observations:RobotEvent[]=[];
 private holds:Record<string,string|null>={};
 private worker?:PlantWorker;
 private queue:Promise<unknown>=Promise.resolve();
 private closed=false;
 /** step actions queued or running: a pause/cancel arriving meanwhile is taken at that batch's next tick boundary (or after its refusal), never behind it */
 private steps=0;
 private controls:{raw:unknown;beforeExecute?:()=>Promise<void>;resolve:(v:RunView)=>void;reject:(e:unknown)=>void}[]=[];
 private engineSeed:number;
 private physicsRec?:PhysicsRecorder;
 /** Paced-step anchor (D57): memory only, never checkpointed nor in evidence; cleared by pause, resume, cancel, an unpaced step and a reopen. */
 private anchor:PaceAnchor|null=null;
 constructor(private dir:string,private cp:Checkpoint,private scenario:ScenarioDefinition,private project:LabProjectV2,private scene:NavigationSceneV1,private irsim:IRSimRuntimeOptions,private plant:PlantPort,map:{mapId:string;mapRevision:string},private rec:NavigationRecorder,private identity:Omit<EvidenceIdentity,'engine'>,private fixture:ResolvedFixture,private wall:WallClock,private stopMonitor?:import('./plant').PlantStopMonitor,private physics?:Awaited<ReturnType<typeof preparePhysicsAdmission>>,private drive?:MobileDrive){
  this.clock=createClock(EPOCH,cp.tick,cp.paused);
  this.telemetry=new TelemetryRecorder(20000,plant.identity.telemetryLabel);
  // the controller sees the fixture's zones (the scene stays the bundle's: its digest is the run's identity); a zone it does not hold is an obstacle
  this.controller=createNavigationController(fixture.zones.length?{...scene,zones:structuredClone(fixture.zones) as NavigationSceneV1['zones']}:scene,plant.identity.controller?.options);
  const derived=engineSeedOf(cp.manifest.seed,scene).engineSeed;this.engineSeed=plant.identity.evidence?.engineSeed?plant.identity.evidence.engineSeed(derived):derived;
  for(const r of cp.roles.robots){
   const a=createIRSimNavigationAdapter({robotId:r.id,scene,controller:this.controller,now:()=>this.clock.nowMs(),state:cp.adapters[r.id]!,...map,trays:cp.trays[r.id]!,...plant.identity.adapterIdentity?{identity:plant.identity.adapterIdentity}:{}});
   a.observe(e=>this.observations.push(e));this.adapters.set(r.id,a);
  }
 }
 get id(){return this.cp.runId;}
 get checkpoint(){return this.cp;}
 persist(){return writeCheckpoint(this.dir,this.cp);}
 pulse(){const c=this.cp;return {tick:c.tick,paused:c.paused,runRevision:c.revision};}
 journal(){return this.queue.then(async()=>{if(this.closed)throw new Error('RUN_CLOSED');return (await this.source.journal()).map(entry=>({sequence:entry.sequence,at:entry.recordedAt,events:(entry.payload.events as unknown as DomainEvent[]).map(e=>({type:e.type,kind:String(e.data.kind),id:String(e.data.id),state:(e.data.state??{}) as JsonObject}))})) as JournalEvents[];});}
 private robotObs(id:string){return this.cp.plant.snapshot?.robots.find(r=>r.robotId===id);}
 private moving(id:string){const r=this.robotObs(id),p=this.scene.policy.parameters;return !!r&&(Math.abs(r.bodyVelocity[0]!)>p.stoppedLinearMps||Math.abs(r.bodyVelocity[1]!)>p.stoppedAngularRadps);}
 /** The last snapshot is the plant's verified state: live, or deliberately stopped with the finished run. */
 private verified(){return this.cp.plant.status==='live'||this.cp.plant.status==='stopped';}
 /** The Digital Twin shows the robot base origin: T_map_base = T_map_drive x inverse(T_base_drive). The controller and evidence stay in the drive frame. */
 private basePose(id:string,d:readonly number[]):[number,number,number]{
  const b=baseInMap({position:[d[0]!,d[1]!,0],quaternionXyzw:quaternionFromYaw(d[2]!)},framePose(this.scene.robots.find(x=>x.robotId===id)!.model.driveFrameInBase));
  return [b.position[0]!,b.position[1]!,yawOf(b.quaternionXyzw)];
 }
 private releaseSlot(){slotsOf(this.plant.identity.amr.id).delete(this.cp.runId);}
 /** A finished run needs no plant: the worker stops and its slot is free; the persisted last snapshot stays the run's state. */
 private async stopPlant(){const c=this.cp,w=this.worker;this.worker=undefined;c.plant.status='stopped';c.plant.reason='RUN_FINISHED';await w?.close('RUN_FINISHED').catch(()=>{});this.releaseSlot();await this.rec.flush();await this.flushPhysics();}
 record(){
  const c=this.cp;c.telemetrySeq=(c.telemetrySeq??c.tick)+1;const at=String(process.hrtime.bigint()),stale=!this.verified();
  // lossy in-memory samples for the live view; the durable per-tick record (and every metric) is the evidence store
  this.telemetry.record(c.roles.robots.flatMap(({id}):TwinSampleV2[]=>{const r=this.robotObs(id),g=this.adapters.get(id)!.goal(),live=g&&(g.state==='executing'||g.state==='cancelling');if(!r)return [];
   const [xM,yM,yawRad]=this.basePose(id,r.poseDriveMap),pose3d=(r as {pose3d?:{z:number;roll:number;pitch:number}}).pose3d;
   return [{schemaVersion:2,runId:c.runId,entityId:id,providerId:this.plant.identity.amr.id,bootId:c.plant.bootId??c.adapters[id]!.bootId,seq:String(c.telemetrySeq),simTimeNs:this.clock.simTimeNs(),observedAt:new Date(this.clock.nowMs()).toISOString(),receivedMonotonicNs:at,frameId:'map',origin:this.plant.identity.telemetryOrigin??'controller_sim',
    quality:stale?'stale':'valid',reasonCodes:stale?['PLANT_NOT_LIVE']:[],commanded:live?{goalCommandId:g.commandId,goalState:g.state}:null,observed:{xM,yM,yawRad,...pose3d?{zM:pose3d.z,rollRad:pose3d.roll,pitchRad:pose3d.pitch}:{},moving:this.moving(id),hold:this.holds[id]??null},estimated:null,causationId:live?g.commandId:null} as TwinSampleV2];}));
  this.telemetry.record(this.payloadStates().map(({id,plant}):TwinSampleV2=>({schemaVersion:2,runId:c.runId,entityId:id,providerId:'mujoco_3d',bootId:c.plant.bootId!,seq:String(c.telemetrySeq),simTimeNs:this.clock.simTimeNs(),observedAt:new Date(this.clock.nowMs()).toISOString(),receivedMonotonicNs:at,frameId:'map',origin:'physics_sim',quality:stale?'stale':'valid',reasonCodes:stale?['PLANT_NOT_LIVE']:[],commanded:null,observed:plant,estimated:null,causationId:null})));
 }
 /** Only the committed checkpoint can publish a free payload. No coffee/custody IDs are synthesized. */
 private payloadStates(){
  const snapshot=this.cp.plant.snapshot as import('./contracts').Sim3DSnapshotV1|null;
  if(!this.physics||!snapshot?.physics)return [];
  return this.physics.load.props.flatMap(p=>{
   const observed=snapshot.physics!.loads.find(l=>l.propId===p.propId);
   if(p.attachment.kind!=='free'||!observed)return [];
   const plant:import('../../../../contracts/generated/lab-v2').TwinPayloadState={payloadKind:'free',propId:p.propId,supportId:p.attachment.supportId,loadProfileSha256:this.physics!.loadProfileDigest,sceneDigest:this.scene.sceneDigest,geometry:structuredClone(p.geometry),positionM:[...observed.poseMap.positionM],quaternionXyzw:[...observed.poseMap.quaternionXyzw]};
   return [{id:`payload:${p.propId}`,plant,moving:Math.hypot(...observed.linearVelocityMapMps)>this.scene.policy.parameters.stoppedLinearMps||Math.hypot(...observed.angularVelocityMapRadps)>this.scene.policy.parameters.stoppedAngularRadps}];
  });
 }
 // ---- plant (one worker process per run, never a second one) ----
 private async ask(op:'describe'|'create'|'start'|'pause'|'resume',payload:Record<string,unknown>):Promise<Extract<IRSimResponseV1,{ok:true}>>{
  const c=this.cp,r=await this.worker!.request({protocol:this.plant.protocol,requestId:`${op}-${++c.plant.requests}`,runId:c.runId,expectedTick:c.tick,op,payload} as never);
  if(!r.ok)throw new WorkerLostError(r.error.code,this.plant.startupPolicy&&op==='create'&&!this.plant.startupPolicy.preMutationCreateRefusals.includes(r.error.code)?'unknown':'not_sent',`${op} refused`);
  return r;
 }
 private async startPlant(){
  const c=this.cp,o=this.irsim;let created=false;
  this.worker=await this.plant.spawn({python:o.python,workerRoot:o.workerRoot,runId:c.runId,bundleRoot:join(this.dir,'bundle'),runDirectory:join(this.dir,'worker'),lockDigest:o.lockDigest,schemaDir:o.schemaDir,sceneDigest:this.scene.sceneDigest,...this.fixture.actors.length?{fixtureSha256:sha256(Buffer.from(JSON.stringify(fixtureFile(this.fixture))))}:{},...o.entry?{entry:o.entry}:{},...o.deadlinesMs?{deadlinesMs:o.deadlinesMs}:{}});
  try{
   const d=(await this.ask('describe',{})).result as {lockDigest:string;packageVersion:string;pythonVersion:string;hostArch?:'arm64'|'x86_64'};
   if(d.lockDigest!==o.lockDigest||d.packageVersion!==this.plant.identity.amr.version)throw new Error('IRSIM_PROVIDER_MISMATCH');
   c.engine={packageVersion:d.packageVersion,pythonVersion:d.pythonVersion,...d.hostArch?{hostArch:d.hostArch}:{}};
   // The plant's explicit seed profile determines engine identity; IR-SIM keeps its legacy NumPy derivation.
   if(this.plant.startupPolicy){c.plant.startupAttempt=true;await this.persist();}
   const snap=(await this.ask('create',{sceneRef:SCENE,seed:this.engineSeed})).result as IRSimSnapshotV1;
   created=true;
   if(this.physics){
    this.physicsRec=await openPhysicsRecorder({directory:join(this.dir,'physics'),identity:{runId:c.runId,bootId:snap.bootId,sceneDigest:this.scene.sceneDigest,loadProfileDigest:this.physics.loadProfileDigest,physicsProfileDigest:this.physics.physicsProfileDigest},admission:this.physics.admission,assumptions:this.physics.assumptions,metricsPolicyDigest:this.physics.metricsPolicyDigest,...o.evidence,maxTicks:Math.min(o.evidence?.maxTicks??EVIDENCE_LIMITS.maxTicks,this.scenario.maxTicks)});
    try{this.validatePhysics(snap,0);await this.physicsRec.append(this.physicsRecord(snap));}catch(e){await this.recordGap({fromTick:0,toTick:0,reason:'PHYSICS_OBSERVATION_INVALID'});throw e;}
   }
   const fault=this.stopMonitor?.(snap);if(fault)throw new Error(fault.code);
   await this.ask('start',{});
   await this.rec.append(snap,null);if(this.physics&&this.rec.terminal)throw new Error('EVIDENCE_INCOMPLETE');
   c.plant={status:'live',reason:null,bootId:this.worker.bootId,requests:c.plant.requests,snapshot:snap};
   for(const a of this.adapters.values())a.sink.observe(snap);
  }catch(e){
   if(this.plant.startupPolicy&&c.plant.startupAttempt){
    // A known refusal/not-sent create is before mutation. Once create succeeds, even a not-sent start cannot recreate this run's world.
    if(!created&&e instanceof WorkerLostError&&e.outcome==='not_sent')delete c.plant.startupAttempt;
    else this.startupLost();
   }
   await this.physicsRec?.finish('STARTUP_UNKNOWN').catch(()=>{});await this.worker.close('START_FAILED').catch(()=>{});this.worker=undefined;this.releaseSlot();throw new Error(`PLANT_START_FAILED:${e instanceof WorkerLostError?e.code:(e as Error).message.slice(0,80)}`);
  }
 }
 private validatePhysics(snap:IRSimSnapshotV1,tick:number){
  if(!this.physics)return;const s=snap as import('./contracts').Sim3DSnapshotV1;
  if(s.tick!==tick||s.runId!==this.cp.runId||s.sceneDigest!==this.scene.sceneDigest||s.simTimeNs!==String(tick*20_000_000)||(tick>0&&s.bootId!==this.cp.plant.snapshot?.bootId))throw new Error('PHYSICS_OBSERVATION_INVALID');
  validatePhysicsRecord(this.physicsRecord(snap),this.physics.admission,tick);
  const base=s.physics!.base[0]!,pose=s.robots[0]?.pose3d;
  if(!pose||Math.abs(pose.z-base.poseMap.positionM[2]!)>1e-6||Math.abs(pose.roll-base.rollRad)>1e-6||Math.abs(pose.pitch-base.pitchRad)>1e-6)throw new Error('PHYSICS_OBSERVATION_INVALID');
 }
 private startupLost(){const c=this.cp;c.plant.status='lost';c.plant.reason='STARTUP_UNKNOWN';c.attention.push({reason:'STARTUP_UNKNOWN',tick:c.tick});this.suspend();}
 private async plantLost(code:string,reason='WORKER_LOST'){
  const c=this.cp;if(c.plant.status==='lost')return;
  c.plant.status='lost';c.plant.reason=code;
  const w=this.worker;this.worker=undefined;await w?.close(code).catch(()=>{});this.releaseSlot();
  for(const a of this.adapters.values())a.sink.lost(reason);
  c.attention.push({reason,subjectId:code,tick:c.tick});this.suspend();
  // a zone held when the plant was lost stays held (the domain keeps it; nothing here frees it) and is named, never left implicit
  for(const [zoneId,robotId] of Object.entries(this.traffic?.owners()??{}))if(robotId)c.attention.push({reason:'ZONE_HELD_UNKNOWN',robotId,subjectId:zoneId,tick:c.tick});
  await this.physicsRec?.finish(code).catch(()=>{});await this.rec.flush();await this.drain();
 }
 /** A step that was sent but not verified: the plant may be at tick+1 with a state nobody saw (a contact included). That tick is a recorded gap, then the plant is lost. */
 private async stepLost(code:string){const t=this.cp.tick+1;await this.recordGap({fromTick:t,toTick:t,reason:'STEP_ACK_LOST'});await this.plantLost(code);}
 /** A gap the run knows of goes into the checkpoint as well: if the recorder cannot write it now (it retries on every flush), a reopen records it from there. */
 private async recordGap(g:Gap){const c=this.cp;(c.evidenceGaps??=[]).push(g);await this.rec.gap(g).catch(()=>{});await this.physicsRec?.gap(g.fromTick,g.toTick,g.reason).catch(()=>{});}
 /** A recording that ended (quota, tick limit, failed write) ends the plant too: no motion is ever left unrecorded. Legs in flight become unknown. */
 private evidenceEnded(){this.cp.evidenceTerminal=this.rec.terminal?.slice(0,500)??null;return this.plantLost(`EVIDENCE:${this.rec.terminal}`,'EVIDENCE_INCOMPLETE');}
 /** Reopened after a crash or restart: the journal is the truth. A leg the journal still shows travelling is unknown; cargo, reservations and custody stay. */
 async recover(){
  const c=this.cp;
  if(this.plant.startupPolicy&&c.plant.startupAttempt&&!c.started)this.startupLost();
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
  // A finished run is read-only. Business cancellation alone cannot complete a registered physical observation tail after a restart.
  if(!travelling&&!c.inFlight&&(await this.missionsDone()||c.cancelled&&!c.attention.length&&await this.cancellationFinished()))return;
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
  if(!this.rec.admits(c.tick+1)){if(!this.rec.terminal)await this.rec.terminate('EVIDENCE_TICK_LIMIT');await this.evidenceEnded();return false;}
  // contention rig (labelled, campaign-only): goals go to the controller directly at their tick, with no mission, so the venue-movement serialization is bypassed
  if(this.scenario.rig&&!c.suspended)for(const g of this.scenario.rig.goals){
   const robotId=c.roles.robots[g.robot]!.id,t=this.scene.robots.find(r=>r.robotId===robotId)!.targetBindings.find(b=>b.pointId===g.pointId)!;
   if(g.atTick<=c.tick&&!c.rig?.[robotId]){(c.rig??={})[robotId]={commandId:`rig-${robotId}-${g.pointId}`,state:'executing',tick:c.tick};this.controller.setGoal({robotId,commandId:`rig-${robotId}-${g.pointId}`,target:[t.x,t.y,t.yaw]});}
  }
  // zone traffic on the verified snapshot t: pre-entry requests and whole-footprint releases, then the controller with the granted owners
  const snapT=c.plant.snapshot!,reservations=this.traffic?await this.traffic.update(c.tick,this.scene.robots.map(r=>{const o=snapT.robots.find(x=>x.robotId===r.robotId)!,g=this.adapters.get(r.robotId)!.goal(),pose=o.poseDriveMap as Pose2;
   return {robotId:r.robotId,footprint:r.model.footprint.verticesM as P[],pose,live:!!g&&g.state==='executing'||c.rig?.[r.robotId]?.state==='executing',route:this.controller.route(r.robotId,pose)};})):{};
  // traffic does not decide what it cannot: a grant contradicting the owner it holds, or an owner stopped inside its zone, is attention (the run needs a person)
  for(const n of this.traffic?.notices()??[]){c.attention.push({reason:n.kind==='conflict'?'ZONE_OWNERSHIP_CONFLICT':'ZONE_HELD_BY_STOPPED_ROBOT',robotId:n.robotId,subjectId:n.zoneId,tick:c.tick});this.suspend();}
  const out=this.controller.advance(snapT,reservations);
  for(const d of out.decisions){
   this.adapters.get(d.robotId)?.sink.decide(d);this.holds[d.robotId]=d.status==='executing'?d.reason:null;
   const rg=c.rig?.[d.robotId];
   if(rg&&rg.commandId===d.commandId&&rg.state==='executing'&&d.status!=='executing'){rg.state=d.status;rg.tick=c.tick;if(d.status!=='arrived'){c.attention.push({reason:d.reason??d.status.toUpperCase(),robotId:d.robotId,subjectId:d.commandId,tick:c.tick});this.suspend();}}
  }
  let next:IRSimSnapshotV1,payload:{targetTick:number;velocities:typeof out.velocities;actorUpdates:ReturnType<typeof actorUpdatesAt>;driveCommands?:import('../control/drive-io').DriveCommandV1[]};
  try{
   // every actor at its scheduled pose for tick t+1 (the schedule is a pure function of the tick: nothing a batch or a pause did changes it)
   payload={targetTick:c.tick+1,velocities:out.velocities,actorUpdates:actorUpdatesAt(this.fixture,c.tick+1)};
   // with a drive the navigation controller's velocities are its setpoint: they go through the diff-drive controller and the drive, and the wire carries driveCommands only (the evidence keeps the setpoint)
   let wire:typeof payload=payload;
   if(this.drive){
    const rid=this.scene.robots[0]!.robotId,sp=out.velocities.find(v=>v.robotId===rid)??{vMps:0,omegaRadps:0},d=this.drive.step(c.tick,{vMps:sp.vMps,omegaRadps:sp.omegaRadps},snapT as {drives?:never});
    payload.driveCommands=d.commands;wire={...payload,velocities:[]};
    // a drive that is not ready or has faulted is a finding that needs a person: the run is not reset or retried, and the controller holds
    for(const ev of d.events)if(ev.code==='DRIVE_FAULT'||ev.code==='DRIVE_NOT_READY'){c.attention.push({reason:ev.code,robotId:rid,tick:c.tick});this.suspend();}
   }
   const r=await this.worker.request({protocol:this.plant.protocol,requestId:`step-${c.tick+1}`,runId:c.runId,expectedTick:c.tick,op:'step',payload:wire});
   // a refused step is as unverifiable as a lost one: the legs become unknown, the step is not retried
   if(!r.ok){await this.stepLost(`STEP_REFUSED:${(r as {error:{code:string}}).error.code}`);return false;}
   next=r.result as IRSimSnapshotV1;
   if(hashJson(next.robots.map(x=>x.robotId).sort())!==hashJson(this.scene.robots.map(x=>x.robotId).sort())||next.robots.some(x=>![...x.poseDriveMap,...x.bodyVelocity].every(Number.isFinite))){await this.stepLost('SNAPSHOT_INVALID');return false;}
  }catch(e){await this.stepLost(e instanceof WorkerLostError?e.code:'WORKER_FAILED');return false;}
  const prev=c.plant.snapshot!;
  if(this.physics){
   try{this.validatePhysics(next,c.tick+1);await this.physicsRec!.append(this.physicsRecord(next));await this.rec.append(next,payload);if(this.rec.terminal)throw new Error('EVIDENCE_INCOMPLETE');}
   catch(e){const why=(e as Error).message==='PHYSICS_OBSERVATION_INVALID'?'PHYSICS_OBSERVATION_INVALID':'PHYSICS_EVIDENCE_FAILED';await this.recordGap({fromTick:c.tick+1,toTick:c.tick+1,reason:why});await this.plantLost(why,why);return false;}
  }
  this.clock.advance(1);c.tick=this.clock.tick;c.plant.snapshot=next;
  // the verified tick goes to the evidence store with the step that produced it, before anything is derived from it
  // a refused append is never skipped silently: it ends the recording (and so the plant) with the reason
  if(!this.physics)await this.rec.append(next,payload).catch(async(e:Error)=>{const why=`EVIDENCE_REJECTED:${e.message.slice(0,60)}`;await this.recordGap({fromTick:c.tick,toTick:c.tick,reason:why});await this.rec.terminate(why);});
  // Mobile faults retain the acknowledged tick as evidence but cannot confirm a source outcome or publish valid telemetry.
  const observationFault=this.stopMonitor?.(next);
  if(observationFault){c.attention.push({reason:observationFault.code,robotId:observationFault.robotId,tick:c.tick});await this.plantLost(observationFault.code,observationFault.code);return false;}
  // live view distance at the robot base origin (the report's metric is recomputed from the durable evidence)
  for(const r of next.robots){const p=prev.robots.find(x=>x.robotId===r.robotId);if(!p||c.distanceM[r.robotId]===undefined)continue;const a=this.basePose(r.robotId,r.poseDriveMap),b=this.basePose(r.robotId,p.poseDriveMap);c.distanceM[r.robotId]+=Math.hypot(a[0]-b[0],a[1]-b[1]);}
  c.maxConcurrentMovers=Math.max(c.maxConcurrentMovers,c.roles.robots.filter(r=>this.moving(r.id)).length);
  for(const a of this.adapters.values())a.sink.observe(next);
  await this.drain();
  if(c.tick%TELEMETRY_RATE_TICKS===0)this.record();
  if(this.rec.terminal){await this.evidenceEnded();return false;}
  // a 3D plant's robot that tipped over, sank into the floor or left the physics ends the run now, with that reason: not at the mission timeout with a wrong one
  const unstable=this.stopMonitor?null:(()=>{const robotId=this.unstableRobot(next);return robotId===null?null:{code:'PLANT_UNSTABLE',robotId};})();
  if(unstable){c.attention.push({reason:unstable.code,robotId:unstable.robotId,tick:c.tick});await this.plantLost(unstable.code,unstable.code);return false;}
  return true;
 }
 /** The robot whose 3D pose (pose3d, only 3D plants report it) is unstable (see poseUnstable). `restZ` is the height each robot first reported: the model's base frame may be on the floor or on the axle. */
 private restZ=new Map<string,number>();
 private unstableRobot(snap:IRSimSnapshotV1):string|null{
  for(const r of snap.robots){
   const p=(r as {pose3d?:{z:number;roll:number;pitch:number}}).pose3d;if(!p)continue;
   if(!this.restZ.has(r.robotId)&&Number.isFinite(p.z))this.restZ.set(r.robotId,p.z);
   const wheel=this.scene.robots.find(x=>x.robotId===r.robotId)?.model.kinematics.wheelRadiusM??0;
   if(poseUnstable(p,wheel,this.restZ.get(r.robotId)??p.z))return r.robotId;
  }
  return null;
 }
 private suspend(){const c=this.cp;c.suspended=true;for(const x of Object.values(c.confirmations))if(x.type!=='standby')x.due=null;}
 snapshot(){return this.queue.then(()=>{if(this.closed)throw new Error('RUN_CLOSED');return this.view();});}
 holdForReclaim(){
  const p=this.queue.then(async()=>{
   if(this.closed)throw new Error('RUN_CLOSED');const c=this.cp;
   if(!c.reclaimed){
    this.suspend();c.paused=true;this.clock.pause();
    for(const a of this.adapters.values())await a.requestStop('LOCAL_RECLAIM');await this.drain();
    if(c.plant.status==='live'){c.plant.status='lost';c.plant.reason='RECLAIMED';const w=this.worker;this.worker=undefined;await w?.close('RECLAIMED').catch(()=>{});this.releaseSlot();await this.rec.flush();await this.flushPhysics();}
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
 controlDuringStep(a:unknown,beforeExecute?:()=>Promise<void>):Promise<RunView>|undefined{
  const kind=(a as {kind?:unknown}|null)?.kind;
  if(!this.steps||(kind!=='pause'&&kind!=='cancel'))return undefined;
  // Bound pending controls as well as durable action receipts; refusal never joins the batch.
  if(this.controls.length>=10000)return Promise.reject(new Error('ACTION_LIMIT'));
  return new Promise((resolve,reject)=>this.controls.push({raw:a,beforeExecute,resolve,reject}));
 }
 action(a:unknown,beforeExecute?:()=>Promise<void>):Promise<RunView>{
  // Synchronous admission closes the gap before a queued step's first await.
  const control=this.controlDuringStep(a,beforeExecute);if(control)return control;
  const step=(a as {kind?:unknown}|null)?.kind==='step';
  if(step)this.steps++;
  const p=this.queue.then(async()=>{try{return await this.execute(a,beforeExecute);}finally{if(step){this.steps--;await this.takeControls();}}});this.queue=p.catch(()=>{});return p;}
 private async execute(raw:unknown,beforeExecute?:()=>Promise<void>,onControlBegin?:()=>void):Promise<RunView>{
  if(this.closed)throw new Error('RUN_CLOSED');
  const checked=validateActionV2(raw);if(!checked.ok)throw new Error('INVALID_ACTION');
  const a=checked.value,c=this.cp,p=a.payload as Record<string,unknown>,hash=hashJson(a),old=c.receipts[a.actionId];
  if(c.reclaimed&&a.kind!=='reconcile')throw new Error('INVALID_STATE:RECLAIM_READ_ONLY');
  // A priority receipt waited inside a step, so it still needs current writer/session authority.
  // Ordinary cached actions keep their existing readiness-independent replay semantics.
  if(old){if(old.hash!==hash)throw new Error('ACTION_CONFLICT');if(onControlBegin)await beforeExecute?.();return structuredClone(old.view);}
  if(Object.keys(c.receipts).length>=10000)throw new Error('ACTION_LIMIT');
  if(a.expectedRevision!==c.revision)throw new Error('REVISION_CONFLICT');
  const view=await this.view(),status=view.run.status;
  if(a.kind==='start'&&this.plant.startupPolicy&&c.plant.startupAttempt)throw new Error('INVALID_STATE:STARTUP_UNKNOWN');
  if(a.kind==='start'&&c.started||a.kind!=='start'&&!c.started)throw new Error('INVALID_STATE');
  if(a.kind==='pause'&&c.paused||a.kind==='resume'&&!c.paused)throw new Error('INVALID_STATE');
  if(a.kind==='step'&&c.paused)throw new Error('RUN_PAUSED');
  // no plant, no motion: a lost worker is never replaced and its steps are never replayed
  if(a.kind==='step'&&c.plant.status!=='live')throw new Error(c.plant.status==='stopped'?'INVALID_STATE:RUN_FINISHED':'INVALID_STATE:PLANT_LOST');
  if(a.kind==='step'&&c.tick+Number(p.ticks)>this.scenario.maxTicks)throw new Error('RUN_DURATION_EXCEEDED');
  if(a.kind==='reconcile'&&status!=='needs_attention')throw new Error('INVALID_STATE');
  if(a.kind==='cancel'&&(c.cancelled||['completed','cancelled'].includes(status)))throw new Error('INVALID_STATE');
  if(a.kind==='injectFault'||a.kind==='restoreCup')throw new Error(a.kind==='injectFault'?'INVALID_FAULT':'INVALID_STATE:CUP_RESTORE_UNSAFE');
  const pending=a.kind==='confirm'?Object.entries(c.confirmations).find(([k,x])=>x.due===null&&k.endsWith(`/${String(p.subjectId)}`)):undefined;
  if(a.kind==='confirm'&&!pending)throw new Error('CONFIRMATION_NOT_PENDING');
  if(pending&&pending[1].type!==p.confirmationType)throw new Error('CONFIRMATION_TYPE_MISMATCH');
  if(pending&&c.plant.status==='lost')throw new Error('INVALID_STATE:LOCALIZATION_LOST');
  // a worker slot is taken at admission (no state change when the host is full) and given back if the plant never goes live
  if(a.kind==='start'){if(!irsimCapacity(this.irsim.maxActiveRuns,c.runId,this.plant.identity.amr.id))throw new Error('IRSIM_CAPACITY');slotsOf(this.plant.identity.amr.id).add(c.runId);}
  // Receipt replay rechecks authority above, but only a new control interrupts a batch.
  // Mark before persistence: a begun control with an uncertain outcome must still stop it.
  try{await beforeExecute?.();onControlBegin?.();c.inFlight=true;await this.persist();}catch(e){if(!this.worker)this.releaseSlot();throw e;}
  try{
   if(a.kind==='start'){await this.startPlant();c.started=true;}
   else if(a.kind==='pause'){c.paused=true;this.clock.pause();this.anchor=null;if(this.worker)await this.ask('pause',{}).catch(e=>this.plantLost(e instanceof WorkerLostError?e.code:'WORKER_FAILED'));}
   else if(a.kind==='resume'){this.anchor=null;if(this.worker)await this.ask('resume',{}).catch(e=>this.plantLost(e instanceof WorkerLostError?e.code:'WORKER_FAILED'));c.paused=false;this.clock.resume();}
   else if(a.kind==='step'){
    // pause/cancel sent during the batch are taken at the next tick boundary (workers-runtime §2), and the batch ends there
    // a batch ends at the tick the run finishes or first needs attention (IR09): the horizon is the same whatever the pacing (1 tick or 500 per request)
    // a paced step (D57) waits for each tick's wall-clock slot first; a control that arrived during the wait is taken before the tick
    const seen=c.attention.length,pace=(a.payload as {pace?:{factor:number}}).pace;if(!pace)this.anchor=null;
    try{for(let i=0;i<Number(p.ticks);i++){if(await this.takeControls())break;if(pace){this.anchor=await awaitTick(this.wall,this.anchor,c.tick,pace.factor);if(await this.takeControls())break;}if(!await this.tick()||c.attention.length>seen||await this.finished())break;}}finally{await this.takeControls();}
   }
   else if(a.kind==='confirm')await this.confirmStop(pending![0],String(p.actorProvenance??'human'));
   else if(a.kind==='cancel'){
    c.cancelled=true;this.suspend();this.anchor=null;
    // every open mission of the run's robots, the return-to-parking standby included
    for(const id of await this.runMissions()){const m=await this.source.read('mission',id);if(!FINAL.includes(String(m.state.status))&&m.state.status!=='cancelling'){const r=await this.submit('Mission.Cancel',{missionId:m.ref.id,expectedVersion:m.version});if(r.status!=='accepted')c.attention.push({reason:'CANCEL_REJECTED',subjectId:m.ref.id,tick:c.tick});}}
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
   // evidence becomes durable at the end of an action once 100 ticks (2 s) are buffered, and always when the plant stops; a crash loses at most that tail, recorded as a gap
   // a run that needs attention is flushed whole: what the operator (or a campaign) reads next must be the complete record up to that tick
   if(c.plant.status==='live'){await this.rec.flush(c.attention.length?0:EVIDENCE_FLUSH_TICKS);if(this.rec.terminal)await this.evidenceEnded();}
   // the run's tick budget is spent and it has not finished: terminal incomplete, not a run left 'running' that can never step again
   if(c.plant.status==='live'&&!this.rec.admits(c.tick+1)&&!await this.finished()){await this.rec.terminate('EVIDENCE_TICK_LIMIT');await this.evidenceEnded();}
   c.revision++;c.pendingOps=[];c.inFlight=false;
   if(c.plant.status==='live'&&await this.finished())await this.stopPlant();
   this.record();
   const after=await this.view();c.receipts[a.actionId]={hash,view:after};await this.persist();return structuredClone(after);
  }catch(e){c.attention.push({reason:'ACTION_INTERRUPTED',tick:c.tick});c.revision++;c.inFlight=false;await this.rec.flush().catch(()=>{});await this.persist();throw e;}
 }
 /** Every mission the run created: the workload's, the parking standbys, and whatever a robot is assigned now. */
 private async runMissions(){
  const c=this.cp,ids=new Set([...c.workload.flatMap(w=>w.missionId?[w.missionId]:[]),...Object.values(c.parking)]);
  for(const {id} of c.roles.robots){const m=(await this.source.read('robot',id)).state.missionId;if(typeof m==='string')ids.add(m);}
  return [...ids];
 }
 /** Cancelled only when the journal shows every run mission final and the last verified snapshot shows every robot stopped. */
 private async cancelDone(){
  for(const id of await this.runMissions())if(!FINAL.includes(String((await this.source.read('mission',id)).state.status)))return false;
  return !this.cp.roles.robots.some(r=>this.moving(r.id));
 }
 private async finished(){
  const c=this.cp,done=c.started&&!c.attention.length&&(c.cancelled?await this.cancelDone():await this.missionsDone());
  if(!done||!c.cancelled||!this.plant.identity.completionObservation)return done;
  c.completionTail??={firstTick:c.tick,lastTick:c.tick+this.plant.identity.completionObservation.extraTicks};
  return c.tick>=c.completionTail.lastTick;
 }
 /** Business cancellation can precede physical completion; reads must never start or shorten the registered observation tail. */
 private async cancellationFinished(){
  return await this.cancelDone()&&(!this.plant.identity.completionObservation||!!this.cp.completionTail&&this.cp.tick>=this.cp.completionTail.lastTick);
 }
 /** Pause/cancel received while a step was queued or ran: each is executed as its own action (own admission, revision check and receipt) at a tick boundary,
  * or right after a batch refused at admission. Once no step is pending, new controls take the ordinary queue (nothing is left behind: the last empty check and
  * the steps decrement happen before any await). */
 private async takeControls(){
  let admitted=false;
  while(this.controls.length){const x=this.controls.shift()!;await this.execute(x.raw,x.beforeExecute,()=>{admitted=true;}).then(x.resolve,x.reject);}
  // Admission refusals do not stop the batch. Once admitted, even a failed checkpoint or
  // worker operation ends it here; an uncertain mutation must never be followed by more ticks.
  return admitted;
 }
 private async missionsDone(){
  const c=this.cp;
  if(this.scenario.rig)return this.scenario.rig.goals.every(g=>c.rig?.[c.roles.robots[g.robot]!.id]?.state==='arrived');
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
  if(this.plant.startupPolicy&&c.plant.startupAttempt&&!c.started)status='needs_attention';
  else if(!c.started)status='ready';
  else if(c.attention.length)status='needs_attention';
  else if(c.cancelled)status=await this.cancellationFinished()?'cancelled':'running';
  else if(await this.missionsDone())status='completed';
  else if(c.paused)status='paused';
  else if(awaiting.length)status='awaiting_confirmation';
  let served=0n;for(const w of c.workload)if(w.lineId)served+=BigInt(String((await this.source.read('fulfillment',w.lineId)).state.served??'0'));
  const journal=await this.source.journal();
  return {run:{schemaVersion:2,id:c.runId,mode:'simulation',access:'simulated',backendSetId:m.backendSetId,backends:m.backends.map(b=>b.id),status,runRevision:c.revision,eventCursor:journal.length?journal[journal.length-1]!.sequence:null,telemetryCursor:this.telemetry.cursor(),fidelity:'modeled',ageMs:0,sourceCommit:m.sourceCommit,scenarioId:m.scenario.id,scenarioRevision:m.scenario.revision,seed:m.seed},
   tick:c.tick,simTimeNs:this.clock.simTimeNs(),model:this.plant.identity.amr.model,entities:this.entities(),workload:structuredClone(c.workload),awaiting,attention:structuredClone(c.attention),served:String(served),coffee:null,...c.reclaimed?{controlAccess:'view_reconcile' as const}:{}};
 }
 private entities():EntityView[]{
  const c=this.cp;
  const robots:EntityView[]=c.roles.robots.map(({id})=>{
   const r=this.robotObs(id),start=this.scene.robots.find(x=>x.robotId===id)!.initialPoseMap,[x,y,yawRad]=this.basePose(id,r?.poseDriveMap??start),g=this.adapters.get(id)!.goal();
   return {id,kind:'amr' as const,pose:{x,y,yawRad},quality:this.verified()?'valid' as const:'stale' as const,moving:c.plant.status==='live'&&this.moving(id),hold:this.holds[id]??null,goal:g?{commandId:g.commandId,state:g.state}:null,path:[],distanceM:c.distanceM[id]??0};
  });
  return [...robots,...this.payloadStates().map(({id,plant,moving}):EntityView=>({id,kind:'payload',plant,pose:{x:plant.positionM[0]!,y:plant.positionM[1]!,yawRad:yawOf(plant.quaternionXyzw)},quality:this.verified()?'valid':'stale',moving,hold:null,goal:null,path:[],distanceM:null}))];
 }
 /** One critical section: no action interleaves while the report reads the checkpoint, the journal, the evidence listing and the clock (one moment, never two). */
 report():Promise<RunReport>{const p=this.queue.then(()=>this.buildReport());this.queue=p.catch(()=>{});return p;}
 private async buildReport():Promise<RunReport>{
  if(this.closed)throw new Error('RUN_CLOSED');
  await this.flushPhysics();
  const c=this.cp,v=await this.view();
  // every plant metric comes from the evidence as read back from disk now: what is not durable yet is not measured
  const listed=this.rec.committed(),read=await readNavigationEvidence(this.rec.directory,listed,{scene:this.scene,runTick:c.started?c.tick:null}),m=navigationMetrics(this.scene,read,this.fixture.actors);
  const physicsEvidence=await this.physicsReport(read);
  const navigation2d=buildNavigationEvidence(this.scene,{...this.identity,engine:{version:c.engine?.packageVersion??this.plant.identity.amr.version,pythonVersion:c.engine?.pythonVersion??'not_started',...c.engine?.hostArch?{hostArch:c.engine.hostArch}:{}}},listed,read,m,c.started?c.tick:null,undefined,this.plant.identity.evidence);
  const available=m.coverage==='complete',why=m.coverageReasons.join(', ').slice(0,500)||'EVIDENCE_INCOMPLETE';
  const businessEvents:BusinessEvent[]=(await this.source.journal()).flatMap(entry=>(entry.payload.events as unknown as DomainEvent[]).map(e=>({sequence:entry.sequence,at:entry.recordedAt,type:e.type,kind:String(e.data.kind),id:String(e.data.id),state:(e.data.state??{}) as JsonObject})));
  return {schemaVersion:2,manifest:structuredClone(c.manifest),outcome:{status:v.run.status,served:v.served,tick:c.tick,simTimeNs:v.simTimeNs},attention:v.attention,workload:v.workload,entities:v.entities,businessEvents,
   effects:(await this.source.effects()).filter(e=>ROBOT_TYPES.includes(String(e.type))).map(e=>({id:String(e.id),type:String(e.type),status:String(e.status),attempts:Number(e.attempts),payload:e.payload as JsonObject})),
   metrics:{maxConcurrentMovers:c.maxConcurrentMovers,distanceM:m.distanceM??{},collision:available?{available:true,contacts:m.collisionEpisodes,minSeparationM:m.minSeparationM}:{available:false,reason:why,contacts:null,minSeparationM:null},
    navigation:{horizon:m.horizon,coverage:m.coverage,reasons:m.coverageReasons,distanceM:m.distanceM,driveDistanceM:m.driveDistanceM,collisionEpisodes:m.collisionEpisodes,safetyEnvelopeEpisodes:m.safetyEnvelopeEpisodes,episodes:m.episodes,minClearanceM:m.minClearanceM,minSeparationM:m.minSeparationM,sensorPublications:m.sensorPublications}},
   rejectedObservations:structuredClone(c.rejectedObservations),reconciliations:structuredClone(c.reconciliations),recoveredOps:structuredClone(c.recoveredOps),confirmations:structuredClone(c.confirmationLog),faults:structuredClone(c.faults),
   coverage:{businessSimulation:true,kinematicModel:true,dynamics:this.plant.identity.coverage.dynamics,nativeExecution:false,physicalStop:false,sensorEvidence:m.sensorPublications.complete,eventStream:true},
   limitations:[...this.scenario.rig?[`CONTENTION RIG (${this.scenario.id}): ${this.scenario.rig.note}`]:[],...this.plant.identity.limitations,
    'perception: known_map_plus_simulated_lidar; the controller plans on the compiled static map and uses simulated LiDAR for dynamic obstacles.',
    'Distance, collision and clearance metrics are computed from the durable per-tick evidence (navigation2d) by the independent oracle; they are unavailable whenever that evidence is incomplete.',
    'A lost or refused worker step leaves its legs unknown; it is never resent and the run is never continued by a new worker process.',
    'Stop requests are model stops only (physicalStopConfirmed false).',...this.scene.limitations],
   telemetry:this.telemetry.report(),navigation2d,...physicsEvidence?{physicsEvidence}:{},...this.driveEvidence?{driveEvidence:this.driveEvidence}:{}};
 }
 private async flushPhysics(){
  if(!this.physicsRec)return;
  try{await this.physicsRec.flush();}catch{const first=this.physicsRec.manifest().coverage.lastTick+1;await this.recordGap({fromTick:Math.min(first,this.cp.tick),toTick:this.cp.tick,reason:'PHYSICS_EVIDENCE_FAILED'});await this.plantLost('PHYSICS_EVIDENCE_FAILED','PHYSICS_EVIDENCE_FAILED');await this.persist();}
 }
 /** The physics tick as recorded: the worker's PhysicsTickRecord, with the axis snapshots of the same tick when the run has a drive. */
 private physicsRecord(snap:IRSimSnapshotV1){const s=snap as import('./contracts').Sim3DSnapshotV1;return {...s.physics!,...s.drives?{drives:s.drives}:{}};}
 private driveEvidence?:import('../control/drive-report').DriveEvidenceReport;
 private async physicsReport(navigation:import('./evidence').EvidenceRead):Promise<RunReport['physicsEvidence']>{
  if(!this.physics)return undefined;
  const manifest=this.physicsRec?.manifest()??await readPhysicsManifest(join(this.dir,'physics')).catch(()=>this.cp.started||this.cp.plant.startupAttempt?{schemaVersion:1 as const,documentType:'physics-evidence' as const,identity:{runId:this.cp.runId,bootId:this.cp.plant.snapshot?.bootId??'unobserved',sceneDigest:this.scene.sceneDigest,loadProfileDigest:this.physics!.loadProfileDigest,physicsProfileDigest:this.physics!.physicsProfileDigest},streams:[],coverage:{firstTick:0,lastTick:this.cp.tick,complete:false},gaps:[{firstTick:0,lastTick:this.cp.tick,reason:'PHYSICS_MANIFEST_INVALID'}],terminalReason:'PHYSICS_MANIFEST_INVALID',metricsPolicyDigest:this.physics!.metricsPolicyDigest,assumptions:this.physics!.assumptions}:null);
  if(!manifest)return undefined;
  // Checkpoint gaps are authoritative even when a failed disk could not publish the sidecar.
  for(const g of [...this.cp.evidenceGaps??[],...this.rec.committed().gaps])if(!manifest.gaps.some(x=>x.firstTick===g.fromTick&&x.lastTick===g.toTick))manifest.gaps.push({firstTick:g.fromTick,lastTick:g.toTick,reason:g.reason.slice(0,200)});
  if(this.cp.plant.status==='lost')manifest.terminalReason??=this.cp.plant.reason??'PLANT_LOST';
  if(manifest.gaps.length||manifest.terminalReason)manifest.coverage.complete=false;
  const read=await readPhysicsEvidence(join(this.dir,'physics'),manifest,{admission:this.physics.admission,metricsPolicyDigest:this.physics.metricsPolicyDigest,identity:{...manifest.identity,runId:this.cp.runId,sceneDigest:this.scene.sceneDigest,loadProfileDigest:this.physics.loadProfileDigest,physicsProfileDigest:this.physics.physicsProfileDigest,...this.cp.plant.snapshot?{bootId:this.cp.plant.snapshot.bootId}:{}},runTick:this.cp.tick});
  if(this.drive)this.driveEvidence=buildDriveEvidence(this.drive.model,read.records.map(r=>({tick:r.tick,drives:(r as {drives?:never}).drives??[]})),{complete:read.complete,issues:read.issues,events:this.drive.events});
  return {manifest,manifestSha256:sha256(Buffer.from(JSON.stringify(manifest))),complete:read.complete,issues:read.issues,metrics:physicsMetrics(read,this.physics.admission,{...navigation,policy:this.scene.policy.parameters})};
 }
 async close(){await this.queue;if(!this.closed){this.closed=true;const w=this.worker;this.worker=undefined;try{await this.physicsRec?.flush().catch(()=>{});await this.rec.flush().catch(()=>{});await w?.close('RUN_CLOSED');}finally{this.releaseSlot();await this.rec.close().catch(()=>{});await this.source.close();}}}
}
