import type { CommandEnvelope, CommandResult, JsonObject, Snapshot } from '../../../../packages/contracts/src/index';
export type AckLevel='local'|'venue'|'cloud'|'unknown';
export type TabletSession={actorId:string;role:string;permissions:string[];organizationId:string;venueId:string;deviceId:string;deviceEpoch:string;coordinatorEpoch:number;policyRevision:number;level:AckLevel;mode:string;pendingCount:number;lastSyncAt:string|null;ownerEndpoint:string;expiresAt?:string;stationIds?:string[];cloudIssuerPublicJwk?:JsonObject;isCoordinator?:boolean;pendingOperations?:{operationId:string;type:string;tableId:string}[]};
export interface TabletTransport {
  session():Promise<TabletSession>;
  snapshots():Promise<Snapshot[]>;
  command(command:CommandEnvelope):Promise<CommandResult>;
  close():Promise<void>;
}
export interface CommandDraft {type:string;payload:JsonObject;operationId:string;expectedVersion?:number}
export async function requestJson<T>(path:string,options:RequestInit={}):Promise<T> {
 const response=await fetch(path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...options.headers}});
 if(!response.ok)throw new Error((await response.json().catch(()=>({code:'UNAVAILABLE'}))).code??'UNAVAILABLE');
 return response.json();
}
