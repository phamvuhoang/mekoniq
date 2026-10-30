import {canonicalBytes,hashPayload,validateJournal,verifyEs256,type PublicEcJwk} from '../../contracts/src/index';
import type {CommandEnvelope,JsonObject} from '../../contracts/src/index';
import type {DurableStore} from './store';
import {processCommand} from './command-processor';
import {receiveTicket} from '../../domain/src/continuity/isolated-ticket';
import {requireState,object,objects,text,amount,change,ok,guarded,find} from '../../domain/src/continuity/shared';
/** Authenticated source facts enter only their explicit capture/reconciliation workflow. */
export async function ingestContinuityObservation(store:DurableStore,raw:unknown) {
 const entry=validateJournal(raw),scope={organizationId:entry.organizationId,venueId:entry.venueId};
 if(entry.kind!=='observation'||!['Continuity.CaptureTicket','Continuity.RecordPaymentObservation'].includes(String(entry.payload.operationType)))throw new Error('CAPTURE_OBSERVATION_REQUIRED');
 const snapshots=await store.snapshots(scope),source=requireState(snapshots,'device',entry.deviceId).state,authority=requireState(snapshots,'__scope__','authority').state;
 if(source.deviceEpoch!==entry.deviceEpoch)throw new Error('SOURCE_DEVICE_EPOCH_MISMATCH');
 const unsigned=Object.fromEntries(Object.entries(entry).filter(([key])=>key!=='signature'));
 if(!verifyEs256(canonicalBytes(unsigned),entry.signature,object(source.publicJwk) as PublicEcJwk))throw new Error('SOURCE_SIGNATURE_INVALID');
 const payload:JsonObject={originalJournal:entry as unknown as JsonObject};
 const c:CommandEnvelope={schemaVersion:1,...scope,operationId:`capture-${hashPayload({entryId:entry.entryId}).slice(0,32)}`,type:'Continuity.AcceptObservation',actorRef:'continuity-sync',deviceId:text(authority.ownerDeviceId),deviceEpoch:text(authority.deviceEpoch),coordinatorEpoch:Number(authority.coordinatorEpoch),policyRevision:Number(authority.policyRevision),occurredAt:entry.occurredAt,recordedAt:new Date(Number(authority.nowMs)).toISOString(),payload,payloadHash:hashPayload(payload)};
 return processCommand(store,c,guarded((command,s)=>{
  if(entry.payload.operationType==='Continuity.CaptureTicket')return receiveTicket(command,s);
  const events=objects(entry.payload.events),observed=events.filter(event=>event.type==='PaymentObserved');
  if(observed.length!==1)throw new Error('SOURCE_EVENT_REQUIRED');
  const data=object(observed[0].data),state=object(data.state),id=text(data.id);
  if(data.kind!=='payment-observation'||id!==entry.operationId||state.sourceDeviceId!==entry.deviceId)throw new Error('SOURCE_OBSERVATION_MISMATCH');
  amount(state.amountMinor);text(state.method);
  const existing=find(s,'payment-observation',id);
  if(existing) {
   if(existing.state.originalEntryId!==entry.entryId)throw new Error('SOURCE_OBSERVATION_CONFLICT');
   return ok([],{observationId:id,duplicateObservation:true});
  }
  return ok([change('PaymentObservationRecovered','payment-observation',id,{...state,status:'unallocated',originalEntryId:entry.entryId,originalJournal:entry as unknown as JsonObject})],{observationId:id});
 }),async command=>command.actorRef==='continuity-sync'&&command.type==='Continuity.AcceptObservation');
}
