import type { AggregateRef, CommandEnvelope, CommandResult, CommitBatch, CommitReceipt, DomainEvent, JournalEntry, JsonObject, Scope, Snapshot, SyncAck } from '../../../contracts/src/index';
import type { DurableStore } from '../store';
export interface NativeJournal {
  receiveCloudEntries(input:{entries:JournalEntry[]}):Promise<{received:number;applied:number}>;
  exportArchive(input:{password:string}):Promise<{uri:string;sha256:string;committed:true;journalCount:number}>;
  inspectArchive(input:{password:string}):Promise<JsonObject>;
  restoreArchive(input:{password:string}):Promise<JsonObject>;
  commitBatch(input:{batch:CommitBatch}):Promise<CommitReceipt>;
  readSnapshot(input:{ref:AggregateRef}):Promise<Snapshot>;
  snapshots(input:{scope:Scope}):Promise<{snapshots:Snapshot[]}>;
  receipt(input:{scope:Scope;operationId:string;payloadHash:string;command?:CommandEnvelope}):Promise<{result:CommandResult|null}>;
  events(input:{scope:Scope;type?:string}):Promise<{events:DomainEvent[]}>;
  journal(input:{scope:Scope}):Promise<{entries:JournalEntry[]}>;
  pendingOutbox():Promise<{entries:{id:string;kind:string;payload:JsonObject}[]}>;
  journalCount():Promise<{count:number}>;
  acknowledge(input:{ack:SyncAck}):Promise<{committed:true}>;
  claimEffect(input:{scope:Scope;id:string}):Promise<{claimed:boolean}>;
  completeEffect(input:{scope:Scope;id:string;status:'confirmed'|'unknown'|'failed'}):Promise<{committed:true}>;
  effects(input:{scope:Scope;type?:string}):Promise<{effects:JsonObject[]}>;
  ack(input:{receipt:JsonObject}):Promise<{committed:true}>;
}
/** SQL and producer sequences stay entirely inside the typed native transaction. */
export class AndroidStore implements DurableStore {
  constructor(private journalPlugin:NativeJournal,readonly ackLevel:'local'|'venue'='local') {}
  readSnapshot(ref:AggregateRef) { return this.journalPlugin.readSnapshot({ref}); }
  commit(batch:CommitBatch) { return this.journalPlugin.commitBatch({batch}); }
  async snapshots(scope:Scope) { return (await this.journalPlugin.snapshots({scope})).snapshots; }
  async receipt(scope:Scope,operationId:string,payloadHash:string,command?:CommandEnvelope) { return (await this.journalPlugin.receipt({scope,operationId,payloadHash,command})).result; }
  async events(scope:Scope,type?:string) { return (await this.journalPlugin.events({scope,type})).events; }
  async journal(scope:Scope) { return (await this.journalPlugin.journal({scope})).entries; }
  async pending(scope:Scope):Promise<JsonObject[]> { return (await this.effects(scope)).filter(e=>e.status==='pending'); }
  async acknowledge(ack:SyncAck){await this.journalPlugin.acknowledge({ack});}
  async claimEffect(scope:Scope,id:string){return (await this.journalPlugin.claimEffect({scope,id})).claimed;}
  async completeEffect(scope:Scope,id:string,status:'confirmed'|'unknown'|'failed'){await this.journalPlugin.completeEffect({scope,id,status});}
  async effects(scope:Scope,type?:string){return (await this.journalPlugin.effects({scope,type})).effects;}
  async journalCount() { return (await this.journalPlugin.journalCount()).count; }
  async exportData(_scope:Scope):Promise<JsonObject> {void _scope;throw new Error('NATIVE_SAF_ARCHIVE_REQUIRED');}
  async restoreData(_scope:Scope,_data:JsonObject):Promise<void> {void [_scope,_data];throw new Error('NATIVE_STAGED_RESTORE_REQUIRED');}
  async provision(_scope:Scope,_epoch:number,_revision:number):Promise<void> { void [_scope,_epoch,_revision]; throw new Error('SIGNED_ENROLLMENT_REQUIRED'); }
  async seed(_scope:Scope,_kind:string,_id:string,_state:JsonObject,_version?:number):Promise<void> { void [_scope,_kind,_id,_state,_version]; throw new Error('TEST_SEED_FORBIDDEN'); }
  async close():Promise<void> { /* Native database lifecycle belongs to the Activity. */ }
}
