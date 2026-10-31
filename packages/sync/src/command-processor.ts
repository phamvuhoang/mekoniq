import {validateEnvelope} from '../../contracts/src/index';
import type {CommandEnvelope,CommandResult,Decision,Handler,JsonObject,Snapshot,Mutation,EffectIntent} from '../../contracts/src/index';
import type {DurableStore} from './store';
export async function processCommand(store:DurableStore,raw:CommandEnvelope,decide:Handler,authorize:(command:CommandEnvelope)=>Promise<boolean>=async()=>false):Promise<CommandResult> {
  const command=validateEnvelope(raw);
  const rejected=(code:string):CommandResult=>({status:'rejected',code,value:{},duplicate:false,ack:'none',operationId:command.operationId});
  if(!await authorize(command)) return rejected('FORBIDDEN');
  try {
    const old=await store.receipt(command,command.operationId,command.payloadHash,command);
    if(old) return {...old,duplicate:true};
    const snapshots=await store.snapshots(command);
    const maintenance=snapshots.find(s=>s.ref.kind==='maintenance'&&s.ref.id==='current');
    if(maintenance?.state.status==='prepared'&&maintenance.state.mode==='full_shutdown'&&/^(Session\.Open|Order\.Place|Catalog\.Publish|Mission\.Create|Fulfillment\.Allocate|SettlementGrant\.Issue|Shift\.Open)$/.test(command.type))return rejected('MAINTENANCE_DRAINING');
    if(maintenance?.state.status==='active'&&maintenance.state.mode==='full_shutdown'&&!/^(Maintenance\.|Continuity\.|Import\.|Ownership\.|SettlementGrant\.Reconcile|Robot\.Reconcile)/.test(command.type))return rejected('MAINTENANCE_ACTIVE');
    const handoff=snapshots.find(s=>s.ref.kind==='ownership'&&['preparing','fenced'].includes(String(s.state.status)));
    if(handoff&&!/^(Ownership\.|Continuity\.|SettlementGrant\.Reconcile|Robot\.Reconcile)/.test(command.type))return rejected('HANDOFF_IN_PROGRESS');
    const decision:Decision=decide(command,snapshots);
    if(!decision.ok) return rejected(decision.code);
    const byRef=new Map<string,Mutation>();
    for(const event of decision.events) {
      const {kind,id,state}=event.data;
      if(typeof kind!=='string'||typeof id!=='string'||!state||typeof state!=='object'||Array.isArray(state)) continue;
      const oldSnapshot=snapshots.find(s=>s.ref.kind===kind&&s.ref.id===id);
      byRef.set(`${kind}:${id}`,{ref:{organizationId:command.organizationId,venueId:command.venueId,kind,id},expectedVersion:oldSnapshot?.version??0,newState:state as JsonObject});
    }
    const effects=(decision.value.effects??[]) as unknown as EffectIntent[];
    const result:CommandResult={status:'accepted',value:decision.value,duplicate:false,ack:store.ackLevel??'local',operationId:command.operationId};
    const receipt=await store.commit({command,expectedAuthority:{coordinatorEpoch:command.coordinatorEpoch,policyRevision:command.policyRevision},expectedReads:snapshots.map(s=>({ref:s.ref,expectedVersion:s.version})),mutations:[...byRef.values()],events:decision.events,effects,result});
    return {...receipt.result,duplicate:receipt.duplicate};
  } catch(error) {
    if(error instanceof Error&&['VERSION_CONFLICT','AUTHORITY_CONFLICT','POLICY_CONFLICT','IDEMPOTENCY_CONFLICT','STORAGE_FULL','RECOVERY_REQUIRED','INVALID_OBSERVATION_MUTATION','OBSERVATION_EFFECT_FORBIDDEN'].includes(error.message)) return rejected(error.message);
    throw error;
  }
}
export function createRouter(store:DurableStore,decide:(c:CommandEnvelope,s:Snapshot[])=>Decision,authorize:(c:CommandEnvelope)=>Promise<boolean>) {
  return {dispatch:(c:CommandEnvelope)=>processCommand(store,c,decide,authorize)};
}
