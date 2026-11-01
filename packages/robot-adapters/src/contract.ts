import type { JsonObject, RobotCommand, RobotManifest } from '../../contracts/src/index';
/** Schema: packages/contracts/schemas/robot-manifest.schema.json (validateRobotManifest). */
export type { RobotManifest };
export interface TargetBinding { waypointId:string; mapId:string; mapRevision:string; frame:string; x?:number; y?:number; yaw?:number; locationRef?:string }
export type ResolvedTarget =
 | {kind:'ros';mapId:string;mapRevision:string;frame:string;x:number;y:number;yaw:number}
 | {kind:'valetudo';mapId:string;mapRevision:string;frame:string;x:number;y:number}
 | {kind:'vendor';mapId:string;mapRevision:string;locationRef:string};
export interface Reachability {reachable:boolean;reason?:string;etaMs?:number}
export interface NativeAcceptance {accepted:boolean;nativeGoalId?:string;unknown:boolean;reason?:string}
export interface NativeCancellation {acknowledged:boolean;unknown:boolean}
/** stopRejected: the robot answered the STOP with a refusal (Valetudo 400); it stays unacknowledged and is retried with backoff. */
export interface StopAcknowledgement {acknowledged:boolean;physicalStopConfirmed:boolean;stopRejected?:boolean}
export interface NativeExecutionState {status:'sending'|'executing'|'completed'|'cancelled'|'failed'|'unknown';evidence:JsonObject}
export interface RobotEvent {type:'accepted'|'rejected'|'progress'|'completed'|'failed'|'cancelled'|'unknown'|'safety_state'|'stop_state';id:string;commandId:string;bootId:string;sequence:string;observedAt:string;payload:JsonObject}
export interface RobotAdapter {
 /** 'native': mutations leave the tablet only through the Android executor (journal before I/O). Required for any non-simulated robot. */
 readonly executor?:'native';
 describe():Promise<RobotManifest>;
 resolveTarget(target:TargetBinding):Promise<ResolvedTarget>;
 estimateReachability(target:ResolvedTarget):Promise<Reachability>;
 execute(command:RobotCommand):Promise<NativeAcceptance>;
 cancel(commandId:string):Promise<NativeCancellation>;
 requestStop(reason:string):Promise<StopAcknowledgement>;
 observe(listener:(event:RobotEvent)=>void):()=>void;
 reconcile(commandId:string):Promise<NativeExecutionState>;
}
