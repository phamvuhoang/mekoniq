import {canonicalBytes,hashPayload,validateJournal,verifyEs256,type PublicEcJwk} from '../../contracts/src/index';
import type {CommandEnvelope,CommandResult,JournalEntry,JsonObject,Snapshot} from '../../contracts/src/index';
import type {DurableStore} from './store';
import {processCommand} from './command-processor';
import {grantReturnCapability,grantSpentFromReceipts,verifyStoredGrant,verifyGrantReturn} from '../../domain/src/billing/settlement-grant';
import {change,find,object,requireState,text,amount,ok,guarded} from '../../domain/src/continuity/shared';

const unsignedEntry=(entry:JournalEntry):JsonObject=>Object.fromEntries(Object.entries(entry).filter(([key])=>key!=='signature')) as JsonObject;
const eventState=(entry:JournalEntry,type:string):{id:string;state:JsonObject}=>{
 const events=entry.payload.events;
 if(!Array.isArray(events))throw new Error('SETTLEMENT_EVENTS_REQUIRED');
 const matched=events.filter(value=>value&&typeof value==='object'&&!Array.isArray(value)&&value.type===type) as JsonObject[];
 if(matched.length!==1)throw new Error('SETTLEMENT_EVENT_REQUIRED');
 const data=object(matched[0]!.data);return {id:text(data.id),state:object(data.state)};
};
/** Verify an original recipient-signed observation; never copy arbitrary source mutations. */
export async function ingestSettlementObservation(store:DurableStore,raw:unknown):Promise<CommandResult> {
 const entry=validateJournal(raw),scope={organizationId:entry.organizationId,venueId:entry.venueId};
 const snapshots=await store.snapshots(scope),authority=requireState(snapshots,'__scope__','authority').state;
 const device=requireState(snapshots,'device',entry.deviceId).state;
 if(entry.kind!=='observation'||!['SettlementGrant.Use','SettlementGrant.Return'].includes(String(entry.payload.operationType)))throw new Error('SETTLEMENT_OBSERVATION_REQUIRED');
 if(device.deviceEpoch!==entry.deviceEpoch)throw new Error('SOURCE_DEVICE_EPOCH_MISMATCH');
 if(!verifyEs256(canonicalBytes(unsignedEntry(entry)),entry.signature,object(device.publicJwk) as PublicEcJwk))throw new Error('SOURCE_SIGNATURE_INVALID');
 const payload:JsonObject={sourceEntryId:entry.entryId,sourceHash:entry.payloadHash,sourceDeviceId:entry.deviceId,sourceDeviceEpoch:entry.deviceEpoch,sourceSequence:entry.sequence};
 const command:CommandEnvelope={schemaVersion:1,...scope,operationId:`settlement-${hashPayload({entryId:entry.entryId}).slice(0,32)}`,type:'Continuity.AcceptSettlementObservation',actorRef:'settlement-sync',deviceId:text(authority.ownerDeviceId),deviceEpoch:text(authority.deviceEpoch),coordinatorEpoch:Number(authority.coordinatorEpoch),policyRevision:Number(authority.policyRevision),occurredAt:entry.occurredAt,recordedAt:new Date(Number(authority.nowMs)).toISOString(),payload,payloadHash:hashPayload(payload)};
 return processCommand(store,command,guarded((c,s)=>applyObservation(c,s,entry)),async()=>true);
}
function applyObservation(c:CommandEnvelope,s:Snapshot[],entry:JournalEntry) {
 const isReturn=entry.payload.operationType==='SettlementGrant.Return';
 const source=eventState(entry,isReturn?'SettlementGrantReturnRecorded':'GrantCashRecorded');
 const grantId=text(source.state.grantId),grant=requireState(s,'grant',grantId);
 verifyStoredGrant(c,s,grant.state);
 if(grant.state.deviceId!==entry.deviceId||grant.state.deviceEpoch!==entry.deviceEpoch)throw new Error('GRANT_SOURCE_DEVICE_MISMATCH');
 const provenance:JsonObject={entryId:entry.entryId,deviceId:entry.deviceId,deviceEpoch:entry.deviceEpoch,sequence:entry.sequence,payloadHash:entry.payloadHash,signature:entry.signature,originalJournal:entry as unknown as JsonObject};
 const events:ReturnType<typeof change>[]=[];
 if(!isReturn) {
  const receipt=source.state;
  if(source.id!==entry.operationId||receipt.deviceId!==entry.deviceId||receipt.deviceEpoch!==entry.deviceEpoch||receipt.billId!==grant.state.billId||receipt.currency!==grant.state.currency)throw new Error('GRANT_RECEIPT_SCOPE_MISMATCH');
  const existing=find(s,'grant-receipt',source.id);
  if(existing) {
   if(hashPayload(receiptCore(source.id,existing.state))!==hashPayload(receiptCore(source.id,receipt)))throw new Error('GRANT_RECEIPT_CONFLICT');
   return ok([],{duplicateObservation:true});
  }
  if(grant.state.status==='reconciled'||grant.state.status==='returned')throw new Error('GRANT_CLOSED_RECEIPT_CONFLICT');
  const sum=grantSpentFromReceipts(s,grant.state)+BigInt(amount(receipt.amountMinor));
  if(BigInt(amount(receipt.amountMinor))<=0n||sum>BigInt(amount(grant.state.amountMinor)))throw new Error('GRANT_LIMIT_EXCEEDED');
  events.push(change('GrantCashObservationAccepted','grant-receipt',source.id,{...receipt,provenance}),change('GrantReceiptInventoryMerged','grant',grantId,{...grant.state,spentMinor:String(sum),status:sum===BigInt(String(grant.state.amountMinor))?'used':'partially_used'}));
 } else {
  const proof=source.state;
  const returned=eventState(entry,'SettlementGrantReturned');
  if(returned.id!==grantId||returned.state.status!=='returned'||returned.state.returnProofId!==grantId)throw new Error('GRANT_DURABLE_RETURN_REQUIRED');
  if(source.id!==grantId)throw new Error('GRANT_RETURN_ID_MISMATCH');
  if(!verifyEs256(canonicalBytes(grantReturnCapability(proof)),text(proof.signature),object(requireState(s,'device',entry.deviceId).state.publicJwk) as PublicEcJwk))throw new Error('GRANT_RETURN_SIGNATURE_INVALID');
  verifyGrantReturn(c,s,grant.state,proof);
  const existing=find(s,'grant-return',grantId);
  if(existing&&hashPayload(grantReturnCapability(existing.state))!==hashPayload(grantReturnCapability(proof)))throw new Error('GRANT_RETURN_CONFLICT');
  if(!existing)events.push(change('GrantReturnObservationAccepted','grant-return',grantId,{...proof,provenance}));
  if(grant.state.status!=='reconciled')events.push(change('GrantClosedByRecipient','grant',grantId,{...grant.state,status:'returned',returnProofId:grantId,restorationIncomplete:false}));
 }
 return ok(events,{sourceEntryId:entry.entryId,grantId});
}
function receiptCore(id:string,receipt:JsonObject):JsonObject {
 return {id,grantId:receipt.grantId!,billId:receipt.billId!,amountMinor:receipt.amountMinor!,currency:receipt.currency!,deviceId:receipt.deviceId!,deviceEpoch:receipt.deviceEpoch!};
}
