import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {canonicalBytes,hashPayload,validateCommitBatch,verifyEs256,type PublicEcJwk} from '../../../contracts/src/index';
import type {AggregateRef,CommandEnvelope,CommandResult,CommitBatch,CommitReceipt,DomainEvent,JournalEntry,JsonObject,Scope,Snapshot,SyncAck} from '../../../contracts/src/index';
import type {DurableStore,StoreOptions} from '../store';
import {grantCapability,grantReturnCapability} from '../../../domain/src/billing/settlement-grant';
import {businessDateAt} from '../../../domain/src/shared/clock';
type Row=Record<string,string|number>;
type Query=(sql:string,params?:(string|number)[])=>Promise<Row[]>;
const exportTables=['authority','aggregate_snapshot','operation_receipt','producer_counter','journal','audit','domain_event','outbox','inbox','sync_cursor','quarantine'] as const;
function commandFingerprint(c:CommandEnvelope) {
 return hashPayload({organizationId:c.organizationId,venueId:c.venueId,type:c.type,actorRef:c.actorRef,deviceId:c.deviceId,deviceEpoch:c.deviceEpoch,coordinatorEpoch:c.coordinatorEpoch,policyRevision:c.policyRevision,expectedVersion:c.expectedVersion??null,payloadHash:c.payloadHash});
}
export class SqlStore implements DurableStore {
  private sqlite?:DatabaseSync;
  private pg?:ReturnType<typeof postgres>;
  private tail:Promise<unknown>=Promise.resolve();
  private lastScope?:Scope;
  private constructor(private options:StoreOptions) {}
  get ackLevel(){return this.options.ackLevel??(this.options.driver==='postgres'?'cloud':'local');}
  static async open(options:StoreOptions) {
    const store=new SqlStore(options);
    if(options.driver==='sqlite') {
      store.sqlite=new DatabaseSync(options.url);
      store.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      store.sqlite.exec(readFileSync(new URL('../../migrations/sqlite/001_journal.sql',import.meta.url),'utf8'));
      if(options.storagePageLimit!==undefined) {
        if(!Number.isSafeInteger(options.storagePageLimit)||options.storagePageLimit<1)throw new Error('INVALID_STORAGE_LIMIT');
        store.sqlite.exec(`PRAGMA max_page_count=${options.storagePageLimit}`);
      }
    } else store.pg=postgres(options.url,{max:1,prepare:false,connect_timeout:3});
    return store;
  }
  private async scoped<T>(scope:Scope,work:(q:Query)=>Promise<T>):Promise<T> {
    this.lastScope={organizationId:scope.organizationId,venueId:scope.venueId};
    const run=async()=>{
      if(this.sqlite) {
        const db=this.sqlite;
        db.exec('BEGIN IMMEDIATE');
        try {
          const q:Query=async(sql,params=[])=>{
            const bindings:(string|number)[]=[];
            const statement=sql.replace(/\$(\d+)/g,(_token,index:string)=>{bindings.push(params[Number(index)-1]);return '?';});
            return db.prepare(statement).all(...bindings) as Row[];
          };
          const result=await work(q); db.exec('COMMIT'); return result;
        } catch(error) {
          try{db.exec('ROLLBACK');}catch{/* SQLITE_FULL can already abort its transaction. */}
          if(error instanceof Error&&/database or disk is full/.test(error.message))throw new Error('STORAGE_FULL');
          throw error;
        }
      }
      if(!this.pg) throw new Error('STORE_CLOSED');
      return await this.pg.begin(async tx=>{
        await tx.unsafe("select set_config('app.organization_id',$1,true),set_config('app.venue_id',$2,true)",[scope.organizationId,scope.venueId]);
        await tx.unsafe('select pg_advisory_xact_lock(hashtext($1))',[scope.organizationId+':'+scope.venueId]);
        const q:Query=async(sql,params=[])=>await tx.unsafe(sql,params) as unknown as Row[];
        return work(q);
      }) as T;
    };
    // Serialize this connection; PostgreSQL also serializes venue writers across processes.
    const job=this.tail.then(run); this.tail=job.catch(()=>{}); return job;
  }
  async readSnapshot(ref:AggregateRef):Promise<Snapshot> {
    return this.scoped(ref,async q=>{
      const [row]=await q('SELECT version,state_json FROM aggregate_snapshot WHERE organization_id=$1 AND venue_id=$2 AND kind=$3 AND id=$4',[ref.organizationId,ref.venueId,ref.kind,ref.id]);
      return {ref,version:row?Number(row.version):0,state:row?JSON.parse(String(row.state_json)):{}};
    });
  }
  async snapshots(scope:Scope):Promise<Snapshot[]> {
    return this.scoped(scope,async q=>{
      const snapshots:Snapshot[]=(await q('SELECT * FROM aggregate_snapshot WHERE organization_id=$1 AND venue_id=$2',[scope.organizationId,scope.venueId])).map(r=>({ref:{organizationId:scope.organizationId,venueId:scope.venueId,kind:String(r.kind),id:String(r.id)},version:Number(r.version),state:JSON.parse(String(r.state_json))}));
      const [authority]=await q('SELECT * FROM authority WHERE organization_id=$1 AND venue_id=$2',[scope.organizationId,scope.venueId]);
      if(authority)snapshots.push({ref:{organizationId:scope.organizationId,venueId:scope.venueId,kind:'__scope__',id:'authority'},version:Number(authority.snapshot_revision),state:{recoveryRequired:Number(authority.recovery_required)===1,nowMs:this.options.nowMs?.()??Date.now(),localDeviceId:this.options.producer?.deviceId??'',localDeviceEpoch:this.options.producer?.deviceEpoch??'',ownerDeviceId:String(authority.owner_device_id),deviceEpoch:String(authority.owner_device_epoch),publicJwk:JSON.parse(String(authority.public_jwk)),coordinatorEpoch:Number(authority.coordinator_epoch),policyRevision:Number(authority.policy_revision)}});
      return snapshots;
    });
  }
  async receipt(scope:Scope,operationId:string,payloadHash:string,command?:CommandEnvelope):Promise<CommandResult|null> {
    return this.scoped(scope,async q=>{
      const [row]=await q('SELECT * FROM operation_receipt WHERE organization_id=$1 AND venue_id=$2 AND operation_id=$3',[scope.organizationId,scope.venueId,operationId]);
      if(!row) return null;
      if(row.payload_hash!==payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
      if(command&&row.command_fingerprint!==commandFingerprint(command))throw new Error('IDEMPOTENCY_CONFLICT');
      return JSON.parse(String(row.result_json));
    });
  }
  async commit(raw:CommitBatch):Promise<CommitReceipt> {
    const batch=validateCommitBatch(raw),c=batch.command;
    return this.scoped<CommitReceipt>(c,async q=>{
      const [existing]=await q('SELECT * FROM operation_receipt WHERE organization_id=$1 AND venue_id=$2 AND operation_id=$3',[c.organizationId,c.venueId,c.operationId]);
      if(existing) {
        if(existing.payload_hash!==c.payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
        if(existing.command_fingerprint!==commandFingerprint(c))throw new Error('IDEMPOTENCY_CONFLICT');
        return {result:JSON.parse(String(existing.result_json)),duplicate:true,sequence:String(existing.sequence),payloadHash:c.payloadHash,committed:true};
      }
      const [authority]=await q('SELECT * FROM authority WHERE organization_id=$1 AND venue_id=$2',[c.organizationId,c.venueId]);
      if(!authority||Number(authority.coordinator_epoch)!==batch.expectedAuthority.coordinatorEpoch||c.coordinatorEpoch!==batch.expectedAuthority.coordinatorEpoch) throw new Error('AUTHORITY_CONFLICT');
      const localObservation=['Continuity.CaptureTicket','Continuity.RecordPaymentObservation','SettlementGrant.Use','SettlementGrant.Return'].includes(c.type);
      if(!localObservation&&this.options.producer&&(authority.owner_device_id!==this.options.producer.deviceId||authority.owner_device_epoch!==this.options.producer.deviceEpoch))throw new Error('AUTHORITY_CONFLICT');
      if(Number(authority.recovery_required)===1&&!localObservation&&!/^(Continuity\.|Import\.|Ownership\.|Robot\.(PrepareReconciliation|Reconcile)|SettlementGrant\.Reconcile)/.test(c.type))throw new Error('RECOVERY_REQUIRED');
      if(localObservation) {
        const allowed:Record<string,string[]>={'Continuity.CaptureTicket':['isolated-ticket','conflict'],'Continuity.RecordPaymentObservation':['payment-observation'],'SettlementGrant.Use':['grant','grant-receipt'],'SettlementGrant.Return':['grant','grant-return']};
        if(batch.mutations.some(m=>!allowed[c.type].includes(m.ref.kind)))throw new Error('INVALID_OBSERVATION_MUTATION');
        if(batch.effects.length)throw new Error('OBSERVATION_EFFECT_FORBIDDEN');
      }
      if(Number(authority.policy_revision)!==batch.expectedAuthority.policyRevision||c.policyRevision!==batch.expectedAuthority.policyRevision) throw new Error('POLICY_CONFLICT');
      for(const read of batch.expectedReads??[]) {
        if(read.ref.organizationId!==c.organizationId||read.ref.venueId!==c.venueId) throw new Error('SCOPE_CONFLICT');
        if(read.ref.kind==='__scope__') {
          if(read.ref.id!=='authority'||Number(authority.snapshot_revision)!==read.expectedVersion)throw new Error('VERSION_CONFLICT');
          continue;
        }
        const [old]=await q('SELECT version FROM aggregate_snapshot WHERE organization_id=$1 AND venue_id=$2 AND kind=$3 AND id=$4',[c.organizationId,c.venueId,read.ref.kind,read.ref.id]);
        if((old?Number(old.version):0)!==read.expectedVersion) throw new Error('VERSION_CONFLICT');
      }
      const refs=new Set<string>();
      for(const m of batch.mutations) {
        if(m.ref.kind==='__scope__')throw new Error('RESERVED_AGGREGATE');
        if(m.ref.organizationId!==c.organizationId||m.ref.venueId!==c.venueId) throw new Error('SCOPE_CONFLICT');
        const key=JSON.stringify(m.ref); if(refs.has(key)) throw new Error('DUPLICATE_MUTATION'); refs.add(key);
        const [old]=await q('SELECT version FROM aggregate_snapshot WHERE organization_id=$1 AND venue_id=$2 AND kind=$3 AND id=$4',[c.organizationId,c.venueId,m.ref.kind,m.ref.id]);
        if((old?Number(old.version):0)!==m.expectedVersion) throw new Error('VERSION_CONFLICT');
        if(m.ref.kind==='grant'&&m.newState.signature===''&&m.newState.status==='issued') {
          if(!this.options.signer) throw new Error('SIGNER_REQUIRED');
          m.newState.signature=this.options.signer(canonicalBytes(grantCapability(m.newState)));
        }
        if(m.ref.kind==='grant-return'&&m.newState.signature==='') {
          if(!this.options.signer)throw new Error('SIGNER_REQUIRED');
          m.newState.signature=this.options.signer(canonicalBytes(grantReturnCapability(m.newState)));
        }
        await q('INSERT INTO aggregate_snapshot(organization_id,venue_id,kind,id,version,state_json) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,venue_id,kind,id) DO UPDATE SET version=excluded.version,state_json=excluded.state_json',[c.organizationId,c.venueId,m.ref.kind,m.ref.id,m.expectedVersion+1,JSON.stringify(m.newState)]);
      }
      const producer=this.options.producer??{deviceId:c.deviceId,deviceEpoch:c.deviceEpoch};
      const [counter]=await q('SELECT sequence FROM producer_counter WHERE organization_id=$1 AND venue_id=$2 AND device_id=$3 AND device_epoch=$4',[c.organizationId,c.venueId,producer.deviceId,producer.deviceEpoch]);
      const sequence=String(BigInt(counter?.sequence??'0')+1n);
      await q('INSERT INTO producer_counter(organization_id,venue_id,device_id,device_epoch,sequence) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,venue_id,device_id,device_epoch) DO UPDATE SET sequence=excluded.sequence',[c.organizationId,c.venueId,producer.deviceId,producer.deviceEpoch,sequence]);
      const payload:JsonObject={events:batch.events as unknown as JsonObject[],mutations:batch.mutations as unknown as JsonObject[],operationType:c.type,commandPayloadHash:c.payloadHash,commandEnvelope:c as unknown as JsonObject,commandResult:batch.result as unknown as JsonObject,commandFingerprint:commandFingerprint(c)};
      const [layout]=await q("SELECT state_json FROM aggregate_snapshot WHERE organization_id=$1 AND venue_id=$2 AND kind='venue-layout' AND id='current'",[c.organizationId,c.venueId]);
      const timezone=layout?String(JSON.parse(String(layout.state_json)).timezone??'UTC'):'UTC';
      const journal:JournalEntry={schemaVersion:1,entryId:randomUUID(),operationId:c.operationId,organizationId:c.organizationId,venueId:c.venueId,deviceId:c.deviceId,deviceEpoch:c.deviceEpoch,sequence,coordinatorEpoch:c.coordinatorEpoch,aggregateType:batch.mutations[0]?.ref.kind??'operation',aggregateId:batch.mutations[0]?.ref.id??c.operationId,expectedVersion:batch.mutations[0]?.expectedVersion??0,resultingVersion:(batch.mutations[0]?.expectedVersion??0)+1,kind:c.type.startsWith('Import.')?'historical_import':['Continuity.CaptureTicket','Continuity.RecordPaymentObservation','SettlementGrant.Use','SettlementGrant.Return'].includes(c.type)?'observation':'accepted_fact',occurredAt:c.occurredAt,recordedAt:c.recordedAt,timezone:'UTC',businessDate:c.occurredAt.slice(0,10),clockConfidence:'uncertain',actorRef:c.actorRef,payload,payloadHash:hashPayload(payload),signature:''};
      if(!this.options.signer) throw new Error('SIGNER_REQUIRED');
      journal.timezone=timezone;journal.businessDate=businessDateAt(c.occurredAt,timezone);
      journal.deviceId=producer.deviceId;journal.deviceEpoch=producer.deviceEpoch;
      const signable=Object.fromEntries(Object.entries(journal).filter(([key])=>key!=='signature')) as JsonObject;
      journal.signature=this.options.signer(canonicalBytes(signable));
      if(canonicalBytes(journal as unknown as JsonObject).length>1024*1024-16384)throw new Error('JOURNAL_TOO_LARGE');
      await q('INSERT INTO journal(organization_id,venue_id,entry_id,device_id,device_epoch,producer_sequence,entry_json) VALUES($1,$2,$3,$4,$5,$6,$7)',[c.organizationId,c.venueId,journal.entryId,producer.deviceId,producer.deviceEpoch,sequence,JSON.stringify(journal)]);
      for(let i=0;i<batch.events.length;i++) {
        const e=batch.events[i];
        await q('INSERT INTO domain_event(organization_id,venue_id,id,type,data_json) VALUES($1,$2,$3,$4,$5)',[c.organizationId,c.venueId,`${c.operationId}:${i}`,e.type,JSON.stringify(e.data)]);
      }
      await q('INSERT INTO audit(organization_id,venue_id,id,actor_ref,operation_id) VALUES($1,$2,$3,$4,$5)',[c.organizationId,c.venueId,randomUUID(),c.actorRef,c.operationId]);
      await q('INSERT INTO operation_receipt(organization_id,venue_id,operation_id,payload_hash,result_json,sequence,command_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7)',[c.organizationId,c.venueId,c.operationId,c.payloadHash,JSON.stringify(batch.result),sequence,commandFingerprint(c)]);
      const effects=[{id:journal.entryId,type:'sync.journal',payload:journal as unknown as JsonObject},...batch.effects];
      if(journal.kind==='historical_import'&&batch.effects.length) throw new Error('HISTORICAL_EFFECT_FORBIDDEN');
      for(const e of effects) await q('INSERT INTO outbox(organization_id,venue_id,id,type,payload_json) VALUES($1,$2,$3,$4,$5)',[c.organizationId,c.venueId,e.id,e.type,JSON.stringify(e.payload)]);
      const activated=batch.events.find(e=>e.type==='OwnershipActivated');
      if(activated) {
        const state=activated.data.state as JsonObject;
        if(state.epoch!==c.coordinatorEpoch+1)throw new Error('AUTHORITY_CONFLICT');
        await q('UPDATE authority SET coordinator_epoch=$1,owner_device_id=$2,owner_device_epoch=$3,public_jwk=$4,recovery_required=0 WHERE organization_id=$5 AND venue_id=$6',[state.epoch as number,String(state.owner),String(state.deviceEpoch),JSON.stringify(state.publicJwk),c.organizationId,c.venueId]);
      }
      if(batch.mutations.length)await q('UPDATE authority SET snapshot_revision=snapshot_revision+1 WHERE organization_id=$1 AND venue_id=$2',[c.organizationId,c.venueId]);
      const appliedPolicy=batch.events.find(e=>e.type==='ConfigurationApplied');
      if(appliedPolicy) {
        const state=appliedPolicy.data.state as JsonObject;
        const bootstrap=batch.mutations.some(m=>m.ref.kind==='configuration'&&m.ref.id==='applied'&&m.expectedVersion===0)&&state.revision===c.policyRevision;
        if(!bootstrap&&state.revision!==c.policyRevision+1)throw new Error('POLICY_CONFLICT');
        await q('UPDATE authority SET policy_revision=$1 WHERE organization_id=$2 AND venue_id=$3',[state.revision as number,c.organizationId,c.venueId]);
      }
      this.options.fault?.('before-local-commit');
      return {result:batch.result,duplicate:false,sequence,payloadHash:c.payloadHash,committed:true};
    }).then(receipt=>{this.options.fault?.('after-local-commit');return receipt;});
  }
  async journalCount() {
    if(this.sqlite) return Number((this.sqlite.prepare('SELECT count(*) AS n FROM journal').get() as Row).n);
    if(!this.lastScope)throw new Error('SCOPE_REQUIRED');
    return this.scoped(this.lastScope,async q=>Number((await q('SELECT count(*) AS n FROM journal WHERE organization_id=$1 AND venue_id=$2',[this.lastScope!.organizationId,this.lastScope!.venueId]))[0].n));
  }
  async events(scope:Scope,type?:string):Promise<DomainEvent[]> {
    return this.scoped(scope,async q=>(await q('SELECT type,data_json FROM domain_event WHERE organization_id=$1 AND venue_id=$2'+(type?' AND type=$3':''),type?[scope.organizationId,scope.venueId,type]:[scope.organizationId,scope.venueId])).map(r=>({type:String(r.type),data:JSON.parse(String(r.data_json))})));
  }
  async journal(scope:Scope):Promise<JournalEntry[]> {
    return this.scoped(scope,async q=>(await q('SELECT entry_json FROM journal WHERE organization_id=$1 AND venue_id=$2',[scope.organizationId,scope.venueId])).map(r=>JSON.parse(String(r.entry_json))));
  }
  async pending(scope:Scope):Promise<JsonObject[]> {
    return this.scoped(scope,async q=>(await q("SELECT id,type,payload_json,status FROM outbox WHERE organization_id=$1 AND venue_id=$2 AND status='pending'",[scope.organizationId,scope.venueId])).map(r=>({id:r.id,type:r.type,payload:JSON.parse(String(r.payload_json)),status:r.status})));
  }
  async acknowledge(ack:SyncAck) {
    await this.scoped(ack,async q=>{
      for(const receipt of ack.entries) {
        if(receipt.organizationId!==ack.organizationId||receipt.venueId!==ack.venueId||receipt.deviceId!==ack.deviceId||receipt.deviceEpoch!==ack.deviceEpoch)throw new Error('ACK_SCOPE_MISMATCH');
        const [row]=await q('SELECT entry_json FROM journal WHERE organization_id=$1 AND venue_id=$2 AND entry_id=$3',[ack.organizationId,ack.venueId,receipt.entryId]);
        if(!row)throw new Error('ACK_ENTRY_UNKNOWN');
        const original=JSON.parse(String(row.entry_json)) as JournalEntry;
        if(original.payloadHash!==receipt.payloadHash||original.sequence!==receipt.sequence||original.deviceId!==ack.deviceId||original.deviceEpoch!==ack.deviceEpoch)throw new Error('ACK_HASH_MISMATCH');
        if(['applied','quarantined','pending'].includes(receipt.status)&&BigInt(receipt.sequence)<=BigInt(ack.receivedCursor)) {
          await q("UPDATE outbox SET status='cloud_received' WHERE organization_id=$1 AND venue_id=$2 AND id=$3",[ack.organizationId,ack.venueId,receipt.entryId]);
        }
      }
      await q('INSERT INTO sync_cursor(organization_id,venue_id,producer,received_cursor,applied_cursor) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,venue_id,producer) DO UPDATE SET received_cursor=excluded.received_cursor,applied_cursor=excluded.applied_cursor',[ack.organizationId,ack.venueId,`${ack.deviceId}:${ack.deviceEpoch}`,ack.receivedCursor,ack.appliedCursor]);
    });
  }
  async claimEffect(scope:Scope,id:string) {
    return this.scoped(scope,async q=>{
      const rows=await q("UPDATE outbox SET status='dispatching',attempts=attempts+1 WHERE organization_id=$1 AND venue_id=$2 AND id=$3 AND status='pending' AND type<>'sync.journal' RETURNING id",[scope.organizationId,scope.venueId,id]);
      return rows.length===1;
    });
  }
  async completeEffect(scope:Scope,id:string,status:'confirmed'|'unknown'|'failed') {
    await this.scoped(scope,q=>q("UPDATE outbox SET status=$1 WHERE organization_id=$2 AND venue_id=$3 AND id=$4 AND (status IN ('dispatching','unknown') OR (status='pending' AND $1='failed'))",[status,scope.organizationId,scope.venueId,id]));
  }
  async effects(scope:Scope,type?:string):Promise<JsonObject[]> {
    return this.scoped(scope,async q=>(await q('SELECT id,type,payload_json,status,attempts FROM outbox WHERE organization_id=$1 AND venue_id=$2'+(type?' AND type=$3':''),type?[scope.organizationId,scope.venueId,type]:[scope.organizationId,scope.venueId])).map(r=>({id:r.id,type:r.type,payload:JSON.parse(String(r.payload_json)),status:r.status,attempts:Number(r.attempts)})));
  }
  async exportData(scope:Scope):Promise<JsonObject> {
    return this.scoped(scope,async q=>{
      const tables:JsonObject={};
      for(const table of exportTables)tables[table]=JSON.parse(JSON.stringify(await q(`SELECT * FROM ${table} WHERE organization_id=$1 AND venue_id=$2`,[scope.organizationId,scope.venueId])));
      const snapshot:JsonObject={schemaVersion:1,organizationId:scope.organizationId,venueId:scope.venueId,producer:this.options.producer??null,tables,preserveOriginalIds:true};
      if(!this.options.signer)throw new Error('SIGNER_REQUIRED');
      return {...snapshot,snapshotSignature:this.options.signer(canonicalBytes(snapshot))};
    });
  }
  async restoreData(scope:Scope,archive:JsonObject) {
    if(archive.schemaVersion!==1||archive.organizationId!==scope.organizationId||archive.venueId!==scope.venueId||!archive.tables||typeof archive.tables!=='object'||Array.isArray(archive.tables))throw new Error('INVALID_RESTORE_SCOPE');
    if(!this.options.producer||hashPayload(archive.producer!)!==hashPayload(this.options.producer))throw new Error('RESTORE_PRODUCER_MISMATCH');
    const signedSnapshot=Object.fromEntries(Object.entries(archive).filter(([key])=>key!=='snapshotSignature'));
    if(!this.options.signerPublicJwk||typeof archive.snapshotSignature!=='string'||!verifyEs256(canonicalBytes(signedSnapshot),archive.snapshotSignature,this.options.signerPublicJwk as PublicEcJwk))throw new Error('RESTORE_SNAPSHOT_SIGNATURE_INVALID');
    const tables=archive.tables as JsonObject;
    const journals=tables.journal;
    if(!Array.isArray(journals)||!this.options.signerPublicJwk)throw new Error('RESTORE_IDENTITY_REQUIRED');
    for(const raw of journals) {
      const row=raw as JsonObject,entry=JSON.parse(String(row.entry_json)) as JournalEntry;
      const unsigned=Object.fromEntries(Object.entries(entry).filter(([key])=>key!=='signature'));
      if(entry.organizationId!==scope.organizationId||entry.venueId!==scope.venueId||entry.deviceId!==this.options.producer.deviceId||entry.deviceEpoch!==this.options.producer.deviceEpoch||entry.payloadHash!==hashPayload(entry.payload)||!verifyEs256(canonicalBytes(unsigned),entry.signature,this.options.signerPublicJwk as PublicEcJwk))throw new Error('RESTORE_SIGNATURE_INVALID');
    }
    await this.scoped(scope,async q=>{
      const existing=await q('SELECT id FROM aggregate_snapshot WHERE organization_id=$1 AND venue_id=$2',[scope.organizationId,scope.venueId]);
      const receipts=await q('SELECT operation_id FROM operation_receipt WHERE organization_id=$1 AND venue_id=$2',[scope.organizationId,scope.venueId]);
      if(existing.length||receipts.length)throw new Error('RESTORE_REQUIRES_EMPTY_STORE');
      // Restore is inventory recovery. It never re-authorizes an old physical/financial effect.
      for(const table of exportTables) {
        const rows=tables[table];if(!Array.isArray(rows))throw new Error('INVALID_RESTORE_TABLE');
        for(const raw of rows) {
          if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('INVALID_RESTORE_ROW');
          const row={...raw} as Record<string,string|number>;
          if(row.organization_id!==scope.organizationId||row.venue_id!==scope.venueId)throw new Error('INVALID_RESTORE_SCOPE');
          const columns=Object.keys(row);
          // Identifiers must come from actual schema metadata, never interpolated archive keys.
          const allowed=this.sqlite?this.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c=>String(c.name)):(await q('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',['public',table])).map(c=>String(c.column_name));
          if(columns.some(column=>!allowed.includes(column)))throw new Error('INVALID_RESTORE_COLUMN');
          if(table==='authority') {
            const present=await q('SELECT coordinator_epoch FROM authority WHERE organization_id=$1 AND venue_id=$2',[scope.organizationId,scope.venueId]);
            if(present.length)throw new Error('RESTORE_REQUIRES_UNPROVISIONED_STORE');
            row.recovery_required=1;
          }
          if(table==='outbox'&&row.type!=='sync.journal'&&['pending','dispatching'].includes(String(row.status)))row.status='unknown';
          if(table==='aggregate_snapshot') {
            const state=JSON.parse(String(row.state_json)) as JsonObject;
            if(row.kind==='grant'&&state.status!=='reconciled')row.state_json=JSON.stringify({...state,status:'unknown',restorationIncomplete:true});
            if(row.kind==='robot')row.state_json=JSON.stringify({...state,goalState:'unknown',availability:'needs_attention',restorationIncomplete:true});
          }
          const writeColumns=Object.keys(row);
          await q(`INSERT INTO ${table}(${writeColumns.join(',')}) VALUES(${writeColumns.map((_,i)=>`$${i+1}`).join(',')})`,writeColumns.map(column=>row[column]));
        }
      }
    });
  }
  async provision(scope:Scope,epoch:number,revision:number) {
    const authority=this.options.authority??{ownerDeviceId:this.options.producer?.deviceId??'',deviceEpoch:this.options.producer?.deviceEpoch??'',publicJwk:this.options.signerPublicJwk??{}};
    await this.scoped(scope,q=>q('INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision,owner_device_id,owner_device_epoch,public_jwk) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,venue_id) DO NOTHING',[scope.organizationId,scope.venueId,epoch,revision,authority.ownerDeviceId,authority.deviceEpoch,JSON.stringify(authority.publicJwk)]));
  }
  async seed(scope:Scope,kind:string,id:string,state:JsonObject,version=1) {
    await this.scoped(scope,q=>q('INSERT INTO aggregate_snapshot(organization_id,venue_id,kind,id,version,state_json) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,venue_id,kind,id) DO UPDATE SET version=excluded.version,state_json=excluded.state_json',[scope.organizationId,scope.venueId,kind,id,version,JSON.stringify(state)]));
  }
  async close() {await this.tail;this.sqlite?.close();if(this.pg) await this.pg.end({timeout:2});}
}
