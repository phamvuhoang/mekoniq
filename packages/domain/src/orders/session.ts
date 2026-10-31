import type { ModuleRegistry } from '../modules';
import { changed, created, done, fail, find, handle, requireState, text } from '../restaurant-context';
export function registerSessions(registry:ModuleRegistry):void {
 handle(registry,'Session.Open',(c,s)=>{
  const tableId=text(c.payload.tableId), sessionId=text(c.payload.sessionId);
  const table=requireState(s,'table',tableId);
  if(find(s,'session',sessionId)) return fail('SESSION_EXISTS');
  if(table.state.activeSessionId) return fail('TABLE_OCCUPIED');
  return done([created('SessionOpened','session',sessionId,{tableId,status:'open',orderIds:[],openedBy:c.actorRef,openedAt:c.recordedAt}),changed('TableOccupied',table,{activeSessionId:sessionId})],{sessionId});
 });
}
