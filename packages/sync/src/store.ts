import type { AtomicStore, CommandEnvelope,CommandResult, DomainEvent, JournalEntry, JsonObject, Scope, Snapshot,SyncAck } from '../../contracts/src/index';
export type { AtomicStore } from '../../contracts/src/index';
export interface DurableStore extends AtomicStore {
  readonly ackLevel?:'local'|'venue'|'cloud';
  snapshots(scope:Scope):Promise<Snapshot[]>;
  receipt(scope:Scope,operationId:string,payloadHash:string,command?:CommandEnvelope):Promise<CommandResult|null>;
  events(scope:Scope,type?:string):Promise<DomainEvent[]>;
  journal(scope:Scope):Promise<JournalEntry[]>;
  pending(scope:Scope):Promise<JsonObject[]>;
  acknowledge(ack:SyncAck):Promise<void>;
  claimEffect(scope:Scope,id:string):Promise<boolean>;
  completeEffect(scope:Scope,id:string,status:'confirmed'|'unknown'|'failed'):Promise<void>;
  effects(scope:Scope,type?:string):Promise<JsonObject[]>;
  exportData(scope:Scope):Promise<JsonObject>;
  restoreData(scope:Scope,archive:JsonObject):Promise<void>;
  provision(scope:Scope,epoch:number,policyRevision:number):Promise<void>;
  seed(scope:Scope,kind:string,id:string,state:JsonObject,version?:number):Promise<void>;
}
export type StoreOptions={driver:'sqlite'|'postgres';url:string;nowMs?:()=>number;authority?:{ownerDeviceId:string;deviceEpoch:string;publicJwk:JsonObject};ackLevel?:'local'|'venue'|'cloud';storagePageLimit?:number;producer?:{deviceId:string;deviceEpoch:string};signerPublicJwk?:JsonObject;signer?:(bytes:Uint8Array)=>string;fault?:(point:string)=>void};
export async function openStore(options:StoreOptions):Promise<DurableStore> {
  const {SqlStore}=await import('./storage/sql-store');
  return SqlStore.open(options);
}
