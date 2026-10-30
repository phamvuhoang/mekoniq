import type {CommandEnvelope,Snapshot} from '../../../contracts/src/index';
import {text,requireState,version,change,ok} from './shared';
export function resolveConflict(c:CommandEnvelope,s:Snapshot[]) {
  const id=text(c.payload.id),conflict=requireState(s,'conflict',id);version(c,conflict);
  const reason=text(c.payload.reason);
  if(conflict.state.status!=='open')throw new Error('CONFLICT_ALREADY_RESOLVED');
  return ok([change('ContinuityConflictResolved','conflict',id,{...conflict.state,status:'resolved',reason,resolvedBy:c.actorRef,resolvedAt:c.recordedAt})]);
}
export function linkTicket(c:CommandEnvelope,s:Snapshot[]) {
  const id=text(c.payload.ticketId),ticket=requireState(s,'isolated-ticket',id);version(c,ticket);
  const sessionId=text(c.payload.sessionId);requireState(s,'session',sessionId);
  return ok([change('IsolatedTicketLinked','isolated-ticket',id,{...ticket.state,status:'linked',sessionId,reason:text(c.payload.reason),linkedBy:c.actorRef})]);
}
