import type {FaultScheduleEntry,FaultFireRecord} from './fault-schedule';
import type {RunVerification} from '../../../contracts/generated/lab-v2';
import type {NavigationRunEvidenceV1} from '../../../contracts/generated/navigation2d';
import type {NavigationMetrics} from './navigation2d/evidence';
import type {JsonObject} from '../../../contracts/src/index';
import {hashJson} from './hash';
import type {TelemetryReport} from './telemetry';
import type {ArmPlantState,ArmProgramSet} from '../../../cell-adapters/src/mock-arm';
/** A plant arm run whose program comes from its fixture (MuJoCo, R2a): what the arm ran, recorded in the manifest. */
export interface ArmProgramRecord {fixture:{id:string;revision:string};physicsDigest:string;programs:ArmProgramSet;programsDigest:string;waypointsDigest:string}
import type {ArmSceneDeclaration} from './models/arm-scene';
import type {ArmReportBlock} from './beverage/arm-plant-report';
export interface BusinessEvent {sequence:string;at:string;type:string;kind:string;id:string;state:JsonObject}
export interface Attention {reason:string;tick:number;robotId?:string;subjectId?:string;commandId?:string}
export interface WorkloadItem {actor:string;tableId:string;quantity:number;atTick:number;sessionId:string;status:'planned'|'placed';lineId?:string;missionId?:string;allocationId?:string}
export interface EntityView {id:string;kind:'amr';pose:{x:number;y:number;yawRad:number};quality:'valid'|'stale';moving:boolean;hold:string|null;goal:{commandId:string;state:string}|null;path:[number,number][];distanceM:number}
export interface CoffeeView {jobs:{jobId:string;status:string;recipeId:string;cupId:string;attentionReason:string|null;waitingReason?:string|null;canRestoreCup?:boolean}[];cups:{cupId:string;ownerKind:string;ownerId:string}[]}
export interface CupMovementView {transferId:string;from:{kind:string;id:string};to:{kind:string;id:string;slot?:number};provenance:string;observedBy:string;at:string;reason?:string;evidence?:JsonObject}
export interface CoffeeReport {
 jobs:JsonObject[];cups:{cupId:string;ownerKind:string;ownerId:string;movements:CupMovementView[];[k:string]:unknown}[];
 cellEffects:{id:string;type:string;status:string;attempts:number;payload:JsonObject}[];
 armTrace:{tag:string;interpolation:string;modelRevision:string;limitsOk:boolean;samples:{tick:number;q:number[];tcp:[number,number,number]}[];collision:ArmPlantState['collision']|null;stop:ArmPlantState['stop']|null};plantLog:JsonObject[];
}
export interface RunReport {
 schemaVersion:2;
 faultScheduleFires?:FaultFireRecord[];
 manifest:{faultSchedule?:{entries:FaultScheduleEntry[];hash:string};engineering?:{bundleDigest:string;projectDigest:string};runId:string;sourceCommit:string;mode:'mock'|'simulation';access:'simulated';backendSetId:string;backends:{id:string;version:string;model:string;dynamics:boolean}[];prng:{algorithm:string;seeding:string;version:number};clock:{tickMs:number;businessEpochMs?:number;native?:{provider:'gazebo_nav2';originNs:string;businessEpochMs:number}};seed:number;
  scenario:{id:string;revision:number;hash:string;basedOn?:{id:string;revision:number}};project:{id:string;revision:number;hash:string};world:{id:string;revision:number;hash:string};assets:{id:string;revision:number;contentHash:string;resolved:boolean}[];
  hashAlgorithm:'sha256-canonical-json-v1';designHash:string;adapterHash:string;configuration:{revision:number;hash:string};recipes:{id:string;revision:number;hash:string}[];
  models:{id:string;revision:string;hash:string;provenance:string}[];profiles:{id:string;revision:number;hash:string;provenance:string}[];calibration:{status:'not_calibrated';revision:null;hash:null;reason:string};armCollisionScene?:ArmSceneDeclaration;/** Only a run whose arm provider supplies its program (MuJoCo arm). */armProgram?:ArmProgramRecord};
 outcome:{status:string;served:string;tick:number;simTimeNs:string};
 attention:Attention[];workload:WorkloadItem[];entities:EntityView[];businessEvents:BusinessEvent[];effects:{id:string;type:string;status:string;attempts:number;payload:JsonObject}[];
 metrics:{maxConcurrentMovers:number;
  /** Plant hold transitions (cause of each wait and its end, null = moving again), from the mock model. */
  holds?:{at:string;robotId:string;hold:string|null}[];distanceM:Record<string,number>;collision:{available:boolean;reason?:string;contacts:number|null;minSeparationM:number|null};
  /** IR-SIM only: plant metrics recomputed from the durable evidence (navigation2d), with their coverage. */
  navigation?:Omit<NavigationMetrics,'contacts'|'coverageReasons'>&{reasons:string[]}};
 rejectedObservations:{eventId:string;commandId:string;type:string;code:string;tick:number}[];
 reconciliations:{subjectId:string;commandId:string|null;nativeState:string;tick:number}[];
 recoveredOps:{ordinal:number;operationId:string;type:string;committed:boolean}[];
 confirmations:{subjectId:string;confirmationType:string;provenance:string;tick:number}[];
 faults:{tick:number;faultId:string;entityId:string|null}[];
 coverage:Record<string,boolean>;limitations:string[];
 coffee?:CoffeeReport;
 verification?:RunVerification;
 /** Lossy coalesced samples, kept apart from the durable businessEvents; not part of canonicalOutcome. */
 telemetry:TelemetryReport;
 /** IR-SIM only (navigation-run-evidence-v1): durable evidence manifest, identities, seeds, digests and assertions. Not part of canonicalOutcome. */
 navigation2d?:NavigationRunEvidenceV1;
 /** Only a run whose arm is a plant (R1.1): the joint trace file, per-joint tracking error, what the plant is, and ARM03 on the actual joints; a contact plant (MuJoCo, R2a) adds the waypoint
  * table, the cup trace file, the allowed contacts, the release timeout and the notes that qualify them. Not part of canonicalOutcome. */
 arm?:ArmReportBlock;
}
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/**
 * Replay comparison form (CORE-07): keeps causal outcome, journal events (type, ordinal, logical ids, sim timestamps), effects, metrics and
 * configured identities; drops the run id and rewrites every runtime UUID (scope, adapter boot) to a first-appearance logical id.
 */
export function canonicalOutcome(r:RunReport){
 const ids=new Map<string,string>();
 const norm=(v:unknown):unknown=>typeof v==='string'?v.replace(UUID,m=>{const k=m.toLowerCase();if(!ids.has(k))ids.set(k,`uuid#${ids.size+1}`);return ids.get(k)!;})
  :Array.isArray(v)?v.map(norm):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,norm(x)])):v;
 const manifest=Object.fromEntries(Object.entries(r.manifest).filter(([k])=>k!=='runId')),{status,served}=r.outcome;
 // The report's own tick is when it was read, not part of the outcome; event timestamps carry the causal timing.
 return norm({manifest,outcome:{status,served},attention:r.attention,workload:r.workload,entities:r.entities,metrics:r.metrics,
  events:r.businessEvents,effects:r.effects.map(e=>({id:e.id,type:e.type,status:e.status,attempts:e.attempts,payload:e.payload})),
  rejectedObservations:r.rejectedObservations,confirmations:r.confirmations,faults:r.faults,...r.coffee?{coffee:r.coffee}:{}}) as JsonObject;
}
export const outcomeDigest=(r:RunReport)=>hashJson(canonicalOutcome(r));
