export interface Point {x:number;y:number;}
export interface WorldPoint extends Point {id:string;name:string;kind:'table'|'kitchen'|'parking'|'dock';}
export interface LabProject {schemaVersion:1;id:string;name:string;revision:number;updatedAt:string;design:{id:string;revision:number;chassis:'service'|'valetudo';trays:number;batteryAh:number;sensor:'lidar'|'depth';payloadKg:number};world:{id:string;revision:number;width:number;height:number;points:WorldPoint[];obstacles:{id:string;x:number;y:number;width:number;height:number}[]};}
export type RunStatus='ready'|'running'|'awaiting_load'|'awaiting_handoff'|'completed'|'cancelled'|'needs_attention';
export interface RunSnapshot {id:string;mode:'business_sim';status:RunStatus;stage:'idle'|'to_kitchen'|'load'|'to_table'|'handoff'|'to_parking'|'finished';revision:number;robotPosition:Point;target:Point|null;served:string;loaded:boolean;events:{type:string;at:string;[key:string]:unknown}[];elapsedMs:number;sourceCommit:string;scenarioId:string;seed:number;attentionReason?:string;}
export interface RunAction {actionId:string;expectedRevision:number;kind:string;payload?:Record<string,unknown>;}
