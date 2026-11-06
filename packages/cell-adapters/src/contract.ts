// Common cell adapter contract (coffee machine, dispensers, cup sensor, arm). Distinct from the navigation RobotAdapter: no targets, no motion goals,
// no STOP surface. Commands and observations are the F01 typed envelopes (mekoniq.cell-command.v2 / cell-observation.v2); device-specific facts ride beside them.
import type {JsonObject} from '../../contracts/src/index';
import type {CellCommand,CellObservation} from '../../contracts/generated/lab-v2';
export type {CellCommand,CellObservation};
export interface CellManifest {cellId:string;deviceIds:string[];adapter:string;version:string;model:string;validation:'simulated'|'bench'|'venue_approved';capabilities:CellCommand['capability'][]}
/** Measured quantity at the boundary: canonical SI decimal string (adapters may count µl/mg internally, never on the wire). */
export interface CellMeasurement {amount:string;unit:'m3'|'kg'|'K'|'s';provenance:'measured'|'modelled'|'unknown'}
export interface DeviceStatus {status:'ready'|'warming'|'fault'|'offline';level?:'ok'|'low'|'empty';reasonCodes:string[];
 milkBatch?:{batchId:string;openedAt:string;coldChainIntact:boolean;temperature:(CellMeasurement&{observedAt:string})|null}}
export interface CupPresence {cupId:string|null;cupType:string|null;present:boolean}
/** Receiving/giving-side transfer evidence; mock values are commanded state, never measured grip force. */
export interface TransferEvidence {gripperClosed?:boolean;objectPresent?:boolean;liftPoseReached?:boolean;released?:boolean;receiverPresent?:boolean;dockInTolerance?:boolean;receiverId?:string;slot?:number;source:string;[k:string]:unknown}
/** One report from a device: a command observation and/or a status/cup heartbeat, stamped with boot/sequence of that device. */
export interface CellReport {deviceId:string;bootId:string;seq:string;observedAt:string;observation?:CellObservation;measurement?:CellMeasurement;status?:DeviceStatus;cup?:CupPresence;evidence?:TransferEvidence}
export interface CellAcceptance {accepted:boolean;unknown:boolean;reason?:string}
export interface CellExecutionState {status:'accepted'|'running'|'completed'|'failed'|'unknown'|'not_found';evidence:JsonObject}
export interface CellAdapter {
 /** 'native': device I/O leaves only through the native cell executor (journal before I/O). Required for anything not simulated. */
 readonly executor?:'native';
 describe():Promise<CellManifest>;
 /** Idempotent per commandId: a repeated id returns the first answer and never acts twice. */
 execute(command:CellCommand):Promise<CellAcceptance>;
 cancel(commandId:string):Promise<{acknowledged:boolean;unknown:boolean}>;
 observe(listener:(report:CellReport)=>void):()=>void;
 /** Query by command id. Used after unknown/restart instead of resending. */
 reconcile(commandId:string):Promise<CellExecutionState>;
}
