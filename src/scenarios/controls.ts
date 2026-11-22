import {hashJson,sha256Hex} from '../twin/hash';
import type {RunVerification} from '../reports/contracts/verification-types';
// The twin's only path to execution: a small client over the source v2 gateway (/lab/v2). The UI never decides an outcome; every action
// is a request the runtime accepts or refuses, and a ViewState (selection, layers, view) is never an execution permission.
// TODO(interim-copy): RunView/RunReport mirror source packages/lab-runtime/src/v2/{scenario-runner,report}.ts; replace with the pinned artifact types (F07).
import type {LabProjectV2} from '../shared/types';
import type {TwinSample} from '../twin/store';
import type {BundleReceipt,EngineeringAssessment,EngineeringProject,EngineeringRef} from '../shared/engineering';
import type {ModelValidationReportV1} from '../shared/navigation2d';
import {validModelValidationReport} from './model-validation';
import {RunEntries} from '../runtime/run-entries';
import {loadToken,requestInit,saveToken,type RuntimeTarget} from '../runtime/target';
import {FetchEventSource} from '../runtime/fetch-event-source';
import type {StreamDeps} from '../runtime/stream';
import type {BenchHealth,BenchTraceReceipt} from '../control/workbench';
import type {BenchRequestV1,DriveTrace,TuningResultV1} from '../shared/navigation2d';
/** `tuningEnvelope`, `benchSignals` and `benchCatalog` (BenchHealth) are present only where a bench scenario is offered (R4.2, V06/V07pre). */
export interface TwinHealth extends BenchHealth {/** R4.5 V15: per plant provider, the maturity of each model group (a function of the sources of its parameters; read with maturityOf) */modelMaturity?:unknown;/** R4.5 V15: per bench axis, the digest of the measured configuration a calibration record is valid for */calibrationConfigDigests?:Record<string,string>;/** R4 V08: present only on a runtime that can run drive faults (read with faultCatalogOf) */faultCatalog?:unknown;/** R4 V10: the registered tray variants of a runtime that offers MJ-TRAY01 */trayExperiments?:{id:string;loadProfileId:string;driveExperimentId:string;accelerationPolicy:string;actor:boolean;comparedWith:string|null;requiresNewRun:boolean}[];worldExperiments?:{id:string;requiresNewRun:boolean;cause?:string}[];/** R4.4: the grasp modes of a runtime that has the belief grasp (capability sim3d_belief_grasp_v1) */graspModes?:{id:string;profileIds?:string[];recoveryPolicyIds?:string[]}[];scenarioRequirements?:Record<string,{mock:string[];simulation:string[]}>;
 /** Server-advertised optional features, e.g. engineering_bundle_v1. Absent on runtimes that predate engineering. */
 capabilities?:string[];
 /** scenarioId -> backendSetId -> what that pairing needs; engineering clients must read this instead of scenarioRequirements. */
 scenarioRequirementsByBackendSet?:Record<string,Record<string,{supported:boolean;required:string[];reasonCodes:string[]}>>;protocolMajors:number[];sourceCommit:string;schemaHash:string;scenarioIds:string[];
 backends:{id:string;modes:string[];installed:boolean;compatible:boolean;reachable:boolean;commissioned:boolean;enabled:boolean;reason?:string}[];
 /** `execution` is the set's optional clock metadata (portable IR-SIM: source_fixed_step); legacy sets omit it and keep their behaviour. It never grants anything by itself. */
 backendSets:{id:string;mode:string;access:string;backends:string[];execution?:BackendExecution}[];features?:{polling?:boolean;sse?:boolean;readiness?:boolean;
 /** N01/N02: a bearer session (sessionToken) and `step.payload.pace` (factor 1, 4, 16, 64; at most 50 ticks). */bearer?:boolean;pacedStep?:boolean};}
export interface BackendExecution {host:'portable_python'|'linux_native';clock:'source_fixed_step'|'native';manualStep:boolean;speedMultipliers:number[]}
export interface ReadinessSnapshot {checkedAt:string;expiresAt:string;scenarioId:string;backendSetId:string;checks:{id:string;status:'ready'|'blocked'|'unknown';reasonCodes:string[];evidenceRef:string|null}[];canStart:boolean}
export interface RunSnapshotV2 {schemaVersion:2;id:string;mode:'mock'|'simulation'|'hardware';access:string;backendSetId:string;backends:string[];
 status:'ready'|'running'|'paused'|'awaiting_confirmation'|'needs_attention'|'completed'|'cancelled'|'failed';runRevision:number;eventCursor:string|null;telemetryCursor:string|null;
 fidelity:string;ageMs:number;sourceCommit:string;scenarioId:string;scenarioRevision:number;seed:number;}
export interface Attention {reason:string;tick:number;robotId?:string;subjectId?:string;commandId?:string}
export interface AmrView {sampleAgeMs?:number;id:string;kind:'amr';pose:{x:number;y:number;yawRad:number;z?:number;rollRad?:number;pitchRad?:number};quality:'valid'|'stale';moving:boolean;hold:string|null;goal:{commandId:string;state:string}|null;path:[number,number][];distanceM:number}
export interface PayloadView extends Omit<AmrView,'kind'|'distanceM'> {kind:'payload';plant:import('../twin/payload').PayloadState;distanceM:null}
export interface CoffeeJobView {canRestoreCup?:boolean;waitingReason?:string|null;jobId:string;status:string;recipeId:string;cupId:string;attentionReason:string|null}
export interface CupView {cupId:string;ownerKind:string;ownerId:string}
/** The inputs a run was created from, as stored by the runtime. Engineering runs also carry the exact project, projection and bundle ref. */
export type LockedInput=CreateRun&{sourceCommit?:string;engineering?:{ref:EngineeringRef;project:EngineeringProject;runtimeProjection:{project:LabProjectV2;assets:unknown[]}}};
export interface RunView {lockedInput?:LockedInput;controlAccess?:'view_reconcile'|'view';run:RunSnapshotV2;tick:number;simTimeNs:string;model:string;entities:(AmrView|PayloadView)[];
 workload:{actor:string;tableId:string;status:string;missionId?:string}[];awaiting:{subjectId:string;confirmationType:string;missionId:string;robotId:string}[];
 attention:Attention[];served:string;coffee:{jobs:CoffeeJobView[];cups:CupView[]}|null;}
export interface Quantity {amount:string;unit:string;provenance:string;tolerance?:string}
export interface JobStep {id:string;kind:string;status:string;deviceId:string;commandId:string|null;target:Quantity|null;measured:Quantity|null;observedBy:string|null}
export interface ArmCollisionResult {ok:boolean;engine:string;geometryRevision:string;modelRevision:string;pair?:[string,string];toleranceM?:number;evaluations?:number;reason?:string;fraction?:number;clearanceM?:number}
export interface ArmCollisionScene {available:boolean;scope:'self_injected_only'|'self_scene_robot';reason?:string;revision:string;profileRevision:number|null;tick:number;world?:unknown[];robotPoses?:{id:string;from:[number,number];to:[number,number]}[]}
export interface ArmCollisionEvidence {
 intervals:{firstTick:number;lastTick:number;fromQ:number[];toQ:number[];heldCupId:string|null;worldRevision:string;sceneRevision:string|null;result:ArmCollisionResult}[];
 worlds:Record<string,unknown[]>;droppedIntervals:number|null;
 firstFailure?:{tick:number;fromQ:number[];toQ:number[];heldCupId:string|null;worldRevision:string;world:unknown[];scene:ArmCollisionScene|null;result:ArmCollisionResult};
 /** Replay describes retained checks only; a truncated final trace has no timestamps for its missing checks. */
 projection?:{cursorTick:number;lastCheckTick:number|null;retainedRange:{fromTick:number|null;toTick:number|null};historyComplete:boolean;worldScope:'checked_geometry';reason?:'SOURCE_TRACE_TRUNCATED'|'MISSING_RECORDED_WORLD'};
}
export interface ArmCollisionView {world:unknown[];checks:number|null;last:ArmCollisionResult|null;scene?:ArmCollisionScene;evidence?:ArmCollisionEvidence}
export interface ArmStopView {latched:boolean;reconcileRequired:boolean;reason:string;/** codes and fixed wording only (M07b) */detail?:string;events:{tick:number;stage:'requested'|'acknowledged'|'observed'|'reset';reason:string;provenance:'modelled'}[]}
/** The `arm` block of a run whose arm is a plant (webots_arm): the actual/commanded joint trace file, tracking error, what the plant is, and the ARM03 record built from its per-tick checks. */
/** A contact plant (MuJoCo, R2a) adds the solved waypoint table, the cup trace file, the allowed contacts, the assumed release timeout and the runtime's statements (`notes`). */
export interface ArmPlantBlock {trace:{path:string;sha256:string;samples:number};tracking:{samples:number;peakRad:number[];rmsRad:number[]};armPlant:{engine:string;engineVersion?:string;control:string;grip:string;dynamics:string;calibration:string};
 collision:{result:'pass'|'fail'|'not_run';reasonCodes:string[];allowedContactsNote?:string;coverage?:{intervals:number;evaluations:number;uncertain:number;allowedContactsApplied:number}|null};
 waypoints?:{digest:string;table:{waypoint:string;q:number[];positionErrorM:number;orientationErrorRad:number;condition:number}[]};props?:{path:string;sha256:string;samples:number};allowedContacts?:{a:string;b:string}[];releaseTimeoutTicks?:number;notes?:string[]}
export type PhysicsMetric={available:true;value:number;unit:string;samples:number}|{available:false;value:null;unit:string;reason:string};
export interface PhysicsReportBlock {manifest:import('../shared/navigation2d').PhysicsEvidenceV1;manifestSha256:string;complete:boolean;issues:string[];metrics:Record<'loadDisplacementM'|'maxTiltRad'|'tiltExceededDurationS'|'wheelPositionResidualM'|'wheelYawResidualRad'|'contactPeakN'|'contactImpulseNs'|'stopDistanceM',PhysicsMetric>}
export type ControlMetric={available:true;value:number;unit:string;samples:number;basis:'actual'|'feedback'}|{available:false;value:null;unit:string;reason:string};
/** The `drive` section of a run that went through a virtual drive (R4): per axis the states, faults and metrics derived from the verified per-tick drive records. Absent on every other run. */
export interface DriveEvidenceBlock {testLevel:'controller_in_the_loop';complete:boolean;issues:string[];ticks:number;
 axes:{axisId:string;mode:'csp'|'csv';states:{state:string;fromTick:number}[];faults:{fault:string;firstTick:number}[];enabledAtTick:number|null;saturatedSubsteps:number;trackingRms:ControlMetric;speedDeficit?:ControlMetric}[];
 events:{tick:number;code:string;axisId?:string}[]}
/** `tuning`: a bench run's result (R4.2); null until it has one, absent on every other run. */
export interface RunReport {/** R4.4: the runtime's perception section of a belief run (beliefs, grasp attempts, recovery steps), rebuilt from its durable stream; absent on a fixed-program run and on older reports */perceptionEvidence?:import('../reports/perception').PerceptionEvidenceView;/** R4 V10: what the runtime computed from a tray run's durable records (read with trayEvidenceOf) */trayEvidence?:import('../reports/design-hint').TrayEvidenceView;/** R4 V08: the runtime's own fault report, built from the recorded streams; absent on a run without a drive fault schedule (read with faultSection) */faultReport?:import('../shared/navigation2d').FaultReportV1;bench?:{request:Omit<BenchRequestV1,'controlProfile'>&{controlProfile:Pick<BenchRequestV1['controlProfile'],'id'|'revision'|'digest'>}};tuning?:TuningResultV1|null;driveEvidence?:DriveEvidenceBlock;physicsEvidence?:PhysicsReportBlock;arm?:ArmPlantBlock;verification?:RunVerification;/** Present only on engineering runs; older reports have neither field. */engineeringEvidence?:EngineeringAssessment;manifest:{engineering?:{bundleDigest:string;projectDigest:string};armCollisionScene?:{hash:string;profile:LabProjectV2['armCollisionProfile']|null;profileHash:string|null;world:LabProjectV2['world'];worldHash:string;robotGeometry:{id:string;radiusM:number|null}[]};hashAlgorithm?:string;designHash?:string;models?:{id:string;revision:string|number;hash:string;provenance:string}[];recipes?:{id:string;revision:number;hash:string}[];profiles?:{id:string;revision:number;hash:string;provenance:string}[];adapterHash?:string;calibration?:{status:string;revision:string|number|null;hash:string|null;reason?:string};runId:string;sourceCommit:string;mode:string;access:string;backendSetId:string;backends:{id:string;version:string;model:string;dynamics:boolean}[];clock:{tickMs:number;native?:{provider:'gazebo_nav2';originNs:string;businessEpochMs:number}};seed:number;
  scenario:{id:string;revision:number;hash:string};project:{id:string;revision:number;hash:string};world:{id:string;revision:number;hash:string};assets:{id:string;revision:number;contentHash:string;resolved:boolean}[]};
 outcome:{status:string;served:string;tick:number;simTimeNs:string};
 metrics:{maxConcurrentMovers?:number;distanceM:Record<string,number>;collision:{available:boolean;reason?:string;contacts:number|null;minSeparationM:number|null};
  /** IR-SIM only: plant metrics the runtime recomputed from its durable evidence. */
  navigation?:{coverage?:string;horizon?:number|null;collisionEpisodes?:number|null;safetyEnvelopeEpisodes?:number|null;minClearanceM?:number|null;minSeparationM?:number|null;sensorPublications?:{expected:number;recorded:number;complete:boolean};reasons?:string[]}};
 /** IR-SIM only (navigation-run-evidence-v1); read through reports/navigation2d, never trusted raw. */
 navigation2d?:import('../shared/navigation2d').NavigationRunEvidenceV1;
 /** Durable: read back from the source journal, each with its journal sequence. */
 businessEvents:{sequence:string;at:string;type:string;kind:string;id:string;state?:Record<string,unknown>}[];faults:{tick:number;faultId:string;entityId:string|null}[];
 effects:{id:string;type:string;status:string;attempts:number;payload:Record<string,unknown>}[];attention?:Attention[];
 /** Lossy, coalesced: never an audit ledger (F06). Absent in reports from runtimes before F06. */
 telemetry?:{lossy:true;coalesced:true;rateHz:number;source:string;samples:TwinSample[];sampleCounts:Record<string,number>;dropped:number;gaps:{reason:string;fromTick:number|null;toTick:number}[]};
 reconciliations:{subjectId:string;commandId:string|null;nativeState:string;tick:number}[];coverage:Record<string,boolean>;limitations:string[];
 coffee?:{plantLog?:Record<string,unknown>[];jobs:{jobId:string;recipeId:string;recipeRevision:number;status:string;steps:JobStep[]}[];cups:{cupId:string;ownerKind:string;ownerId:string;movements:{transferId:string;provenance:string;observedBy:string;at:string}[]}[];
  armTrace:{collision?:ArmCollisionView|null;stop?:ArmStopView|null;tag:string;interpolation:string;modelRevision:string;limitsOk:boolean;samples:{tick:number;q:number[];tcp:[number,number,number]}[]}};}
interface CreateRunBase {/** R4 V09: the cell's drive experiment and the run-scoped drive fault schedule (never part of the project) */driveExperimentId?:string;driveFaultSchedule?:import('./drive-faults').DriveFaultEntry[];worldExperimentId?:import('../twin/cell').WorldExperiment;/** R4.4 (shared-world cell only) */graspMode?:'belief_ground_truth'|'belief_estimated';perceptionProfileId?:string;recoveryPolicyId?:string;scenarioId:string;scenarioRevision:number;seed:number;mode:'mock'|'simulation';backendSetId:string;access:'simulated'}
/** Legacy request: the project travels with it and there is no engineeringRef. */
export interface LegacyCreateRun extends CreateRunBase {project:LabProjectV2;engineeringRef?:undefined}
/** Engineering request: the server derives the project from the bundle; a project, if sent at all, must equal the locked projection. */
export interface EngineeringCreateRun extends CreateRunBase {engineeringRef:EngineeringRef;project?:LabProjectV2}
/** Bench request (R4.2): the plant is the server's, so no project, bundle or run experiment travels with it. */
export interface BenchCreateRun extends CreateRunBase {bench:BenchRequestV1;project?:undefined;engineeringRef?:undefined}
export type CreateRun=LegacyCreateRun|EngineeringCreateRun|BenchCreateRun;
export function requestForPreset(p:import('./catalog').TwinPreset,driveFaults?:readonly import('./drive-faults').DriveFaultEntry[]):CreateRun{
 // a drive fault schedule rides with the request; the cell also names its drive experiment (a mobile run's experiment is in its engineering project)
 const base={...p.worldExperimentId?{worldExperimentId:p.worldExperimentId}:{},...p.id==='mujoco-cell'&&p.driveExperimentId?{driveExperimentId:p.driveExperimentId}:{},...p.id==='mujoco-cell'&&p.graspMode&&p.graspMode!=='fixed_program'?{graspMode:p.graspMode,...p.graspMode==='belief_estimated'?{perceptionProfileId:'perception-nominal-v1'}:{},recoveryPolicyId:'pick-recovery-v1'}:{},...driveFaults?.length?{driveFaultSchedule:structuredClone([...driveFaults])}:{},scenarioId:p.scenarioId,scenarioRevision:p.scenarioRevision,seed:p.seed,mode:p.mode??'mock',backendSetId:p.backendSetId,access:'simulated'} as const;
 // engineering never falls back to the preset project: the receipt that matches this exact draft is the only way to a ref
 if (p.engineering) return {...base,engineeringRef:engineeringRefFor(p.engineering.project,p.engineering.receipt)};
 return {project:structuredClone(p.project),...base};
}
/** Only a compiled receipt for exactly this project yields a ref; a blocked, missing or stale receipt is a typed refusal before any request. */
export function engineeringRefFor(project:EngineeringProject,receipt:BundleReceipt|null):EngineeringRef {
 if (!receipt) throw new TwinRuntimeError('ENGINEERING_NOT_COMPILED',[],0);
 if (receipt.state!=='compiled') throw new TwinRuntimeError('ENGINEERING_COMPILE_BLOCKED',receipt.problems.map(p=>p.code),0);
 if (receipt.projectDigest!==hashJson(project)) throw new TwinRuntimeError('ENGINEERING_RECEIPT_STALE',['ENGINEERING_IDENTITY_MISMATCH'],0);
 return {bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest};
}
/** Reset is a new run from what the chosen run was created with, never from the open draft or preset. */
export function requestFromLocked(locked:LockedInput):CreateRun {
 const {sourceCommit:_c,engineering,...rest}=locked as LockedInput&{runtimeIdentity?:unknown};void _c;
 const {project,runtimeIdentity:_r,...base}=rest as LegacyCreateRun&{runtimeIdentity?:unknown};void _r;
 return engineering?{...base,engineeringRef:engineering.ref}:{...base,project:structuredClone(project)};
}
export type ActionKind='start'|'pause'|'resume'|'cancel'|'step'|'confirm'|'injectFault'|'reconcile'|'restoreCup';
export interface EngineeringManifest {schemaVersion:1;projectDigest:string;assemblyDigest:string;sceneDigest:string;profile:string;compilerVersion:string;files:{path:string;sha256:string;sizeBytes:number}[]}
export interface WorldDisplay {view?:RunView;version:1;runId:string;revision:number;tick:number;simTimeNs:string;availability:'valid'|'stale'|'unknown';reason:string|null;snapshot:import('../shared/navigation2d').Sim3DSnapshotV1|null;control:Pick<import('../shared/navigation2d').WorldEvidenceRecord['command'] & {},'targetTick'|'worldControl'|'velocities'>|null;controlReason:string|null}
export interface TwinRuntime {
 /** R4 V09: asks the runtime to check a drive fault schedule (schema, bounds, overlap, backend) without creating a run. 422 answers are data, anything else throws. */
 checkDriveFaults?(body:{driveFaultSchedule:import('./drive-faults').DriveFaultEntry[];backendSetId:string;scenarioId:string;driveExperimentId?:string},signal?:AbortSignal):Promise<{ok:true}|{ok:false;error:string;codes:string[]}>;
 exportReplay?(id:string,signal:AbortSignal):Promise<{reader:import('../reports/replay-package').ReplayReader;release():Promise<void>}>;
 worldDisplay?(id:string,signal?:AbortSignal):Promise<WorldDisplay>;
 worldDisplayScene?(id:string,signal?:AbortSignal):Promise<{runId:string;availability:string;reason:string|null;scene:import('../shared/navigation2d').LabWorldSceneV1|null}>;
 readiness?(scenarioId:string,backendSetId:string,project?:LabProjectV2,engineeringRef?:EngineeringRef):Promise<ReadinessSnapshot>;
 /** Present only against a runtime that advertises engineering_bundle_v1. */
 compileEngineering?(project:EngineeringProject):Promise<BundleReceipt>;
 /** Read access to a bundle this session compiled (or reclaimed): its manifest and content-addressed blobs. */
 engineeringManifest?(bundleDigest:string):Promise<EngineeringManifest>;
 engineeringBlob?(sha256:string):Promise<Uint8Array>;
 /** LinkForge shadow validation of one robot of a bundle this session owns (POST /engineering/validate), and a report read back by digest. */
 validateEngineeringModel?(ref:EngineeringRef,robotId:string):Promise<ModelValidationReportV1>;
 readModelValidation?(reportDigest:string):Promise<ModelValidationReportV1>;
 health():Promise<TwinHealth>;pair(token:string):Promise<void>;readonly paired:boolean;
 /** Drop the in-memory CSRF token after the runtime lost the session (restart): the pair form shows again. */
 forget():void;
 readonly sessionGeneration?:number;
 create(request:CreateRun,identity:{sourceCommit:string;schemaHash:string},signal?:AbortSignal):Promise<RunView>;
 /** `actionId`: resend a step whose response was lost with the same id; the runtime returns its stored receipt and does not act again. */
 action(view:RunView,kind:ActionKind,payload?:Record<string,unknown>,actionId?:string,signal?:AbortSignal):Promise<RunView>;
 readonly recoverableRunIds?:readonly string[];archive?(runId:string,signal?:AbortSignal):Promise<void>;reclaim?(runId:string,signal?:AbortSignal):Promise<RunView>;
 get(runId:string,signal?:AbortSignal):Promise<RunView>;report(runId:string,signal?:AbortSignal):Promise<RunReport>;
 /** A bench run's drive trace as read back from its chunks (GET /runs/:id/trace; null samples are gaps). Up to ~1 MB: read once per finished bench, never polled. */
 trace?(runId:string,signal?:AbortSignal):Promise<BenchTraceReceipt>;
 /** Drop this client's reclaim proof of a run: an archived bench keeps no checkpoint to reclaim, so it is never offered for reopening. */
 dropProof?(runId:string):void;
 /** Where requests go (target.ts). Optional only so test doubles may omit it; httpTwinRuntime always has it. */
 readonly target?:RuntimeTarget;
 /** Point this client at another runtime: the old session (and its stored bearer) is dropped. */
 retarget?(t:RuntimeTarget):void;
 /** What openRunStreams needs to reach this runtime with this client's credentials. */
 streamDeps?():Pick<StreamDeps,'base'|'EventSource'|'fetch'>;
}
export class TwinRuntimeError extends Error {
 constructor(readonly code:string,readonly reasonCodes:string[],readonly status:number,readonly runId?:string){super(reasonCodes.length?`${code}: ${reasonCodes.join(', ')}`:code);this.name='TwinRuntimeError';}
}
/** The Lab's pin (config/source-runtime.lock.json, served beside the page): the commit a runtime on another origin must report. */
let pin:Promise<string>|undefined;
export const pinnedCommit=()=>pin??=fetch('/source-runtime.lock.json',{cache:'no-store',signal:AbortSignal.timeout(30000)}).then(async r=>{const c=r.ok?(await r.json() as {sourceCommit?:unknown}).sourceCommit:undefined;if(typeof c!=='string'||!c)throw new TwinRuntimeError('RUNTIME_LOCK_MISSING',[],409);return c;}).catch(e=>{pin=undefined;throw e;});
/** Same origin: cookie session + CSRF header (unchanged). Other targets: the bearer from POST /sessions, no CSRF, no cookie; the bearer is dropped on 401. */
export function httpTwinRuntime(target:RuntimeTarget={base:'/lab/v2',kind:'same_origin'}):TwinRuntime {
 let csrf='',token=target.kind==='same_origin'?'':loadToken(target);
 const remote=()=>target.kind!=='same_origin',auth=()=>requestInit(target,token);
 // reclaim proofs belong to the runtime that issued them: same origin keeps its original key, any other runtime has its own
 const proofKey=(t:RuntimeTarget)=>t.kind==='same_origin'?'mekoniq-lab-reclaim':`mekoniq-lab-reclaim:${t.base}`;
 const usableProof=(proof:unknown):proof is string=>typeof proof==='string'&&proof.trim().length>0;
 const proofs=new RunEntries<string>(raw=>Object.fromEntries(raw&&typeof raw==='object'?Object.entries(raw).filter(([,proof])=>usableProof(proof)):[]),usableProof);
 let generation=0;
 const forget=()=>{generation++;csrf='';if(token){token='';saveToken(target,'');}};
 const assertSession=(g:number)=>{if(g!==generation)throw new TwinRuntimeError('SESSION_CHANGED',[],0);};
 /** Every request is judged by the target it was made for: a late 401 from a previous runtime never drops the current bearer.
  * A loopback fetch the browser refuses (local network access denied, nothing listening, Safari's HTTPS-to-http rule) rejects with a TypeError we cannot tell apart. */
 const send=async(url:string,init:RequestInit,t:RuntimeTarget,g=generation)=>{
  let response:Response;
  try{response=await fetch(url,init);}catch(e){if(t.kind==='loopback'&&e instanceof TypeError)throw new TwinRuntimeError('LOOPBACK_BLOCKED',[],0);throw e;}
  if(response.status===401&&t===target&&g===generation&&(csrf||token))forget();
  return response;
 };
 const request=async<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>=>{
  signal=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
  const t=target,post=body!==undefined,a=auth(),response=await send(t.base+path,{method:post?'POST':'GET',...a,cache:'no-store',headers:{...a.headers as Record<string,string>,...post?{'Content-Type':'application/json',...csrf&&!remote()?{'X-CSRF-Token':csrf}:{}}:{}},...post?{body:JSON.stringify(body)}:{},...signal?{signal}:{}},t);
  // a body that does not parse (not JSON, cut off, or aborted while read) is never data, whatever the status
  const data=await response.json().then(d=>d!==null&&typeof d==='object'?d as Record<string,unknown>:null,()=>null);
  if(!data)throw new TwinRuntimeError('INVALID_RUNTIME_RESPONSE',[],response.status);
  if(!response.ok)throw new TwinRuntimeError(String(data.error??'RUNTIME_REQUEST_FAILED'),Array.isArray(data.reasonCodes)?data.reasonCodes.map(String):[],response.status);
  return data as T;
 };
 const run=(id:string)=>`/runs/${encodeURIComponent(id)}`;
 return {
  get sessionGeneration(){return generation;},get paired(){return remote()?!!token:!!csrf;},forget,
  get target(){return target;},
  retarget(t){forget();target=t;token=t.kind==='same_origin'?'':loadToken(t);},
  streamDeps(){
   if(!remote())return {base:target.base,EventSource:globalThis.EventSource};
   // the bearer is read when each stream opens (a re-pair is picked up by the next reconnect), and only while this client still points at that runtime
   const t=target,a=()=>requestInit(t,t===target?token:''),init=()=>{const {headers,...extra}=a();return {headers:headers as Record<string,string>,extra};};
   return {base:t.base,EventSource:class extends FetchEventSource{constructor(url:string){super(url,init());}} as unknown as typeof EventSource,
    fetch:((url:string,i:RequestInit={})=>{const x=a();return send(url,{...i,...x,headers:{...i.headers as Record<string,string>,...x.headers as Record<string,string>}},t);}) as typeof fetch};
  },
  health:()=>request<TwinHealth>('/health'),
  compileEngineering:project=>request<BundleReceipt>('/engineering/compile',{project}),
  async validateEngineeringModel(engineeringRef,robotId){const r=await request<{report?:unknown}>('/engineering/validate',{engineeringRef,robotId});if(!validModelValidationReport(r.report))throw new TwinRuntimeError('MODEL_VALIDATION_SCHEMA_UNKNOWN',[],502);return r.report;},
  async readModelValidation(digest){
   if(!/^[0-9a-f]{64}$/.test(digest))throw new TwinRuntimeError('INVALID_REPORT_DIGEST',[],0);
   const r=await request<unknown>(`/engineering/validations/${digest}`);
   if(!validModelValidationReport(r))throw new TwinRuntimeError('MODEL_VALIDATION_SCHEMA_UNKNOWN',[],502);
   if(r.reportDigest!==digest)throw new TwinRuntimeError('MODEL_VALIDATION_DIGEST_MISMATCH',[],502);
   return r;
  },
  engineeringManifest:digest=>request<EngineeringManifest>(`/engineering/bundles/${encodeURIComponent(digest)}/manifest`),
  async engineeringBlob(sha256){
   const response=await send(`${target.base}/engineering/blobs/${encodeURIComponent(sha256)}`,{...auth(),cache:'no-store'},target);
   if(!response.ok){const data=await response.json().catch(()=>({error:'INVALID_RUNTIME_RESPONSE'}));throw new TwinRuntimeError(String(data.error??'RUNTIME_REQUEST_FAILED'),[],response.status);}
   const bytes=new Uint8Array(await response.arrayBuffer());
   // content addressing is checked here too: a blob that does not hash to its name is never rendered
   if(sha256Hex(bytes)!==sha256)throw new TwinRuntimeError('ENGINEERING_BLOB_CORRUPT',[],409);
   return bytes;
  },
  async checkDriveFaults(body,signal){try{await request('/projects/validate',body,signal);return {ok:true as const};}catch(e){if(e instanceof TwinRuntimeError&&e.status===422)return {ok:false as const,error:e.code,codes:e.reasonCodes};throw e;}},
  readiness:(scenarioId,backendSetId,project,engineeringRef)=>engineeringRef?request<ReadinessSnapshot>('/readiness',{scenarioId,backendSetId,engineeringRef,...project?{project}:{}}):project?request<ReadinessSnapshot>('/readiness',{scenarioId,backendSetId,project}):request<ReadinessSnapshot>(`/readiness?scenarioId=${encodeURIComponent(scenarioId)}&backendSetId=${encodeURIComponent(backendSetId)}`),
  async pair(code){
   const g=++generation,r=await request<{csrfToken?:string;sessionToken?:string}>('/sessions',{token:code},AbortSignal.timeout(30000));assertSession(g);
   if(remote()){if(!r.sessionToken)throw new TwinRuntimeError('INVALID_PAIRING_RESPONSE',[],502);token=r.sessionToken;saveToken(target,token);return;}
   if(!r.csrfToken)throw new TwinRuntimeError('INVALID_PAIRING_RESPONSE',[],502);csrf=r.csrfToken;
  },
  async create(r,identity,signal){
   const g=generation,t=target;
   // a runtime on another origin was not installed by the launcher: it must be the pinned one (same origin is checked by the launcher)
   if(remote()){const [h,p]=await Promise.all([request<TwinHealth>('/health',undefined,signal),pinnedCommit()]);assertSession(g);if(h.sourceCommit!==p)throw new TwinRuntimeError('RUNTIME_PIN_MISMATCH',[String(h.sourceCommit).slice(0,7),p.slice(0,7)],409);}
   const {reclaimToken,...view}=await request<RunView&{reclaimToken?:string}>('/runs',{...r,runtimeIdentity:identity},signal);
   const id=typeof view.run?.id==='string'&&view.run.id.trim()?view.run.id:undefined;
   if('bench' in r&&!usableProof(reclaimToken))throw new TwinRuntimeError('BENCH_CREATE_PROOF_MISSING',[],502,id);
   if(id&&usableProof(reclaimToken))proofs.write(proofKey(t),id,reclaimToken);
   return view;},
  get recoverableRunIds(){return Object.keys(proofs.read(proofKey(target)));},
  async archive(id,signal){
   const ack=await request<{archived?:boolean;runId?:string}>(`${run(id)}/archive`,{},signal);
   if(ack.archived!==true||ack.runId!==id)throw new TwinRuntimeError('INVALID_RUNTIME_RESPONSE',[],502);
  },
  reclaim:(id,signal)=>{const proof=proofs.read(proofKey(target))[id];if(!proof)throw new TwinRuntimeError('RUN_PROOF_MISSING',[],403);return request<RunView>(`${run(id)}/reclaim`,{proof},signal);},
  // expectedRevision comes from the last snapshot the UI rendered: a stale view is refused (REVISION_CONFLICT), never applied
  action:(v,kind,payload={},actionId=crypto.randomUUID(),signal)=>request<RunView>(`${run(v.run.id)}/actions`,{actionId,expectedRevision:v.run.runRevision,kind,payload},signal),
  get:(id,signal)=>request<RunView>(run(id),undefined,signal),
  async exportReplay(id,signal){
   const exportTarget=target,exportAuth=auth(),exportCsrf=csrf;const version=await request<{exportId:string;manifest:unknown}>(`${run(id)}/replay`,{},signal),path=`${run(id)}/replay/${encodeURIComponent(version.exportId)}`;let released=false;
   const release=async()=>{
    if(released)return;released=true;
    // Cleanup still runs after export cancellation. Consume the acknowledgement: header-only fetch can leave the browser request nonterminal.
    const cleanup=new AbortController(),timer=setTimeout(()=>cleanup.abort(),10000);
    try{const a=exportAuth,r=await send(exportTarget.base+path,{...a,method:'DELETE',signal:cleanup.signal,headers:{...a.headers as Record<string,string>,...exportCsrf&&exportTarget.kind==='same_origin'?{'X-CSRF-Token':exportCsrf}:{}}},exportTarget),ack=await r.json().catch(()=>null);
     if(!r.ok)throw new TwinRuntimeError('REPLAY_DELETE_REFUSED',[],r.status);
     if(r.status!==200||ack?.deleted!==true)throw new TwinRuntimeError('INVALID_RUNTIME_RESPONSE',[],r.status);
    }catch(e){if(cleanup.signal.aborted)throw new TwinRuntimeError('REPLAY_DELETE_TIMEOUT',[],0);throw e;}finally{clearTimeout(timer);}
   };
   try{const {openLiveReplay}=await import('../reports/replay-transport'),reader=await openLiveReplay(exportTarget.base+path,new TextEncoder().encode(JSON.stringify(version.manifest)),exportAuth,signal);return {reader,release};}catch(e){await release().catch(()=>{});throw e;}
  },
  worldDisplay:(id,signal)=>request<WorldDisplay>(`${run(id)}/world-display`,undefined,signal),
  worldDisplayScene:(id,signal)=>request(`${run(id)}/world-display/scene`,undefined,signal),
  report:(id,signal)=>request<RunReport>(`${run(id)}/report`,undefined,signal),
  async trace(id,signal){
   const r=await request<{runId?:unknown;manifestSha256?:unknown;traces?:unknown;issues?:unknown}>(`${run(id)}/trace`,undefined,signal);
   if(!r||r.runId!==id||!(r.manifestSha256===null||typeof r.manifestSha256==='string'&&/^[a-f0-9]{64}$/.test(r.manifestSha256))||!Array.isArray(r.traces)||!Array.isArray(r.issues)||!r.issues.every(i=>typeof i==='string')||!r.traces.every(t=>!!t&&typeof t==='object'&&typeof (t as DriveTrace).axisId==='string'&&typeof (t as DriveTrace).dtS==='number'&&Array.isArray((t as DriveTrace).samples)))throw new TwinRuntimeError('INVALID_RUNTIME_RESPONSE',[],502);
   return {runId:id,manifestSha256:r.manifestSha256,traces:r.traces as DriveTrace[],issues:r.issues};
  },
  dropProof(id){proofs.write(proofKey(target),id,null);},
 };
}
/** What the run controls may offer, from the set's execution metadata in health. Mock: Lab step/auto-run. Simulation with a source fixed-step clock:
 * step and pacing at the set's multipliers (no step while paused unless manualStep). Native or unknown simulation: the engine owns time, no Lab step. */
export interface ClockControls {clock:'mock'|'source_fixed_step'|'native';step:boolean;play:boolean;speeds:number[]}
/** The run speeds a runtime accepts (×): the paced step's factors and the mock clock's speeds. */
export const SPEED_FACTORS=[1,4,16,64] as const;
export function clockControls(view:RunView,health:TwinHealth|null):ClockControls{
 const live=['running','awaiting_confirmation'].includes(view.run.status),paused=view.run.status==='paused';
 if(view.run.mode==='mock')return {clock:'mock',step:live,play:live,speeds:[...SPEED_FACTORS]};
 const e=health?.backendSets.find(s=>s.id===view.run.backendSetId)?.execution;
 if(view.run.mode!=='simulation'||e?.clock!=='source_fixed_step')return {clock:'native',step:false,play:false,speeds:[]};
 return {clock:'source_fixed_step',step:live||paused&&e.manualStep,play:live,speeds:e.speedMultipliers.filter(n=>(SPEED_FACTORS as readonly number[]).includes(n))};
}
