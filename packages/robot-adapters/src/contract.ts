import type { JsonObject, RobotCommand } from '../../contracts/src/index';
export interface RobotManifest {
 id:string; adapter:string; protocolVersion:string; firmware:string;
 capabilities:string[]; mapId:string; mapRevision:string; offlineExecution:boolean;
 maxLoadMinor:string; trays:number; validation:'simulated'|'integration_tested'|'hardware_validated'|'venue_approved';
}
export interface TargetBinding { waypointId:string; mapId:string; mapRevision:string; frame:string; x?:number; y?:number; yaw?:number; locationRef?:string }
export type ResolvedTarget =
 | {kind:'ros';mapId:string;mapRevision:string;frame:string;x:number;y:number;yaw:number}
 | {kind:'valetudo';mapId:string;mapRevision:string;frame:string;x:number;y:number}
 | {kind:'vendor';mapId:string;mapRevision:string;locationRef:string};
export interface Reachability {reachable:boolean;reason?:string;etaMs?:number}
export interface NativeAcceptance {accepted:boolean;nativeGoalId?:string;unknown:boolean;reason?:string}
export interface NativeCancellation {acknowledged:boolean;unknown:boolean}
export interface StopAcknowledgement {acknowledged:boolean;physicalStopConfirmed:boolean}
export interface NativeExecutionState {status:'sending'|'executing'|'completed'|'cancelled'|'failed'|'unknown';evidence:JsonObject}
export interface RobotEvent {type:'accepted'|'rejected'|'progress'|'completed'|'failed'|'cancelled'|'unknown'|'safety_state';id:string;commandId:string;bootId:string;sequence:string;observedAt:string;payload:JsonObject}
export interface RobotAdapter {
 describe():Promise<RobotManifest>;
 resolveTarget(target:TargetBinding):Promise<ResolvedTarget>;
 estimateReachability(target:ResolvedTarget):Promise<Reachability>;
 execute(command:RobotCommand):Promise<NativeAcceptance>;
 cancel(commandId:string):Promise<NativeCancellation>;
 requestStop(reason:string):Promise<StopAcknowledgement>;
 observe(listener:(event:RobotEvent)=>void):()=>void;
 reconcile(commandId:string):Promise<NativeExecutionState>;
}
