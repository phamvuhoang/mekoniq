import {hashPayload,canonicalBytes,validateJournal,verifyEs256,type PublicEcJwk} from '../../../contracts/src/index';
import type {CommandEnvelope,Snapshot} from '../../../contracts/src/index';
import {text,amount,find,change,ok,object,requireState,objects} from './shared';
export function mayMutateShared(mode:string,hasGrant:boolean){return mode==='coordinated'||hasGrant;}
export function captureTicket(c:CommandEnvelope,s:Snapshot[]) {
  if(canonicalBytes(c.payload).length>64*1024||Array.isArray(c.payload.items)&&c.payload.items.length>100)throw new Error('CAPTURE_TOO_LARGE');
  const p=c.payload,id=text(p.id),table=text(p.table??p.tableId),totalMinor=amount(p.totalMinor);
  const key=`${c.deviceId}:${c.deviceEpoch}:${id}`;
  if(find(s,'isolated-ticket',key))throw new Error('SOURCE_ALREADY_CAPTURED');
  const state={id:key,sourceDeviceId:c.deviceId,sourceDeviceEpoch:c.deviceEpoch,sourceId:id,table,totalMinor,currency:typeof p.currency==='string'?p.currency:'VND',status:'unlinked',menuVersion:p.menuVersion??null,policyRevision:c.policyRevision,occurredAt:c.occurredAt,recordedAt:c.recordedAt,sourceRef:p.sourceRef??null,items:p.items??[],availability:'unverified'};
  const events=[change('IsolatedTicketRecorded','isolated-ticket',key,state)];
  const others=s.filter(x=>x.ref.kind==='isolated-ticket'&&x.state.table===table&&x.state.status==='unlinked');
  if(others.length) events.push(change('ContinuityConflictOpened','conflict',`table:${table}`,{table,status:'open',sources:[...others.map(x=>x.ref.id),key],fingerprint:hashPayload({table,sources:[...others.map(x=>x.ref.id),key]})}));
  return ok(events,{ticketId:key});
}
export function receiveTicket(c:CommandEnvelope,s:Snapshot[]) {
  const entry=validateJournal(c.payload.originalJournal);
  if(entry.organizationId!==c.organizationId||entry.venueId!==c.venueId||entry.kind!=='observation'||entry.payload.operationType!=='Continuity.CaptureTicket')throw new Error('SOURCE_SCOPE_MISMATCH');
  const sourceDevice=requireState(s,'device',entry.deviceId).state;
  if(sourceDevice.deviceEpoch!==entry.deviceEpoch)throw new Error('SOURCE_DEVICE_EPOCH_MISMATCH');
  const unsigned=Object.fromEntries(Object.entries(entry).filter(([key])=>key!=='signature'));
  if(!verifyEs256(canonicalBytes(unsigned),entry.signature,object(sourceDevice.publicJwk) as PublicEcJwk))throw new Error('SOURCE_SIGNATURE_INVALID');
  const event=objects(entry.payload.events).find(e=>e.type==='IsolatedTicketRecorded');if(!event)throw new Error('SOURCE_EVENT_REQUIRED');
  const ticket=object(object(event.data).state),id=text(ticket.id),entryId=entry.entryId;
  if(ticket.sourceDeviceId!==entry.deviceId||ticket.sourceDeviceEpoch!==entry.deviceEpoch)throw new Error('SOURCE_DEVICE_MISMATCH');
  text(ticket.sourceDeviceId);text(ticket.sourceDeviceEpoch);text(ticket.table);amount(ticket.totalMinor);
  if(find(s,'isolated-ticket',id))return ok([],{ticketId:id,duplicate:true});
  const events=[change('IsolatedTicketRecovered','isolated-ticket',id,{...ticket,originalEntryId:entryId,originalJournal:entry as unknown as import('../../../contracts/src/index').JsonObject})];
  const others=s.filter(x=>x.ref.kind==='isolated-ticket'&&x.state.table===ticket.table&&x.state.status==='unlinked');
  if(others.length)events.push(change('ContinuityConflictOpened','conflict',`table:${ticket.table}`,{table:ticket.table,status:'open',sources:[...others.map(x=>x.ref.id),id]}));
  return ok(events,{ticketId:id});
}
