import type { ModuleRegistry } from '../modules';
import { all, changed, created, done, expectVersion, fail, find, handle, requireState, text } from '../restaurant-context';
export function registerSessions(registry:ModuleRegistry):void {
 handle(registry,'Session.Open',(c,s)=>{
  const tableId=text(c.payload.tableId), sessionId=text(c.payload.sessionId);
  const table=requireState(s,'table',tableId);
  if(find(s,'session',sessionId)) return fail('SESSION_EXISTS');
  if(table.state.activeSessionId) return fail('TABLE_OCCUPIED');
  return done([created('SessionOpened','session',sessionId,{tableId,status:'open',orderIds:[],revision:0,openedBy:c.actorRef,openedAt:c.recordedAt}),changed('TableOccupied',table,{activeSessionId:sessionId})],{sessionId});
 });
 /**
  * Session.Close {sessionId,expectedVersion?}: ends a seating that never reached a bill (empty, or every order cancelled) and frees the table.
  * A prepared bill closes its session through Bill.Close. The revision bump kills guest tokens issued for this seating.
  */
 handle(registry,'Session.Close',(c,s)=>{
  const session=requireState(s,'session',text(c.payload.sessionId));
  if(c.expectedVersion!==undefined||c.payload.expectedVersion!==undefined) expectVersion(c,session);
  if(session.state.status!=='open') return fail('SESSION_CLOSED');
  if(session.state.frozenBillId) return fail('SESSION_FROZEN');
  if(all(s,'order').some(o=>o.state.sessionId===session.ref.id&&o.state.status!=='cancelled')) return fail('SESSION_HAS_ORDERS');
  const table=requireState(s,'table',String(session.state.tableId));
  return done([changed('SessionClosed',session,{status:'closed',closedAt:c.recordedAt,closedBy:c.actorRef,revision:Number(session.state.revision ?? 0)+1}),...(table.state.activeSessionId===session.ref.id?[changed('TableReleased',table,{activeSessionId:null})]:[])],{sessionId:session.ref.id});
 });
}
