import type { ModuleRegistry } from '../modules';
import type { JsonValue } from '../../../contracts/src/index';
import { all, changed, done, expectVersion, fail, handle, requireState, text } from '../restaurant-context';
import { retargetHandoffs } from '../fleet/retarget';
/**
 * Session.Move {sessionId,toTableId,expectedVersion}: the whole open session (orders, kitchen work, deliveries) follows the guests to a free table.
 * The session revision bumps so anything bound to the old seating (guest links) can be invalidated; a robot already heading to the old table is retargeted.
 */
export function registerTableMoves(registry:ModuleRegistry):void {
 handle(registry,'Session.Move',(c,s)=>{
  const session=requireState(s,'session',text(c.payload.sessionId)); expectVersion(c,session);
  if(session.state.status!=='open') return fail('SESSION_CLOSED');
  if(session.state.frozenBillId) return fail('SESSION_FROZEN');
  const toId=text(c.payload.toTableId,'INVALID_TABLE'),from=requireState(s,'table',String(session.state.tableId)),to=requireState(s,'table',toId);
  if(from.ref.id===to.ref.id) return fail('SAME_TABLE');
  if(from.state.activeSessionId!==session.ref.id) return fail('TABLE_SESSION_MISMATCH');
  if(to.state.activeSessionId) return fail('TABLE_OCCUPIED');
  const mine=new Set(all(s,'allocation').filter(a=>a.state.sessionId===session.ref.id).map(a=>a.ref.id));
  const retarget=retargetHandoffs(c,s,mine,toId);
  const history=[...((session.state.tableHistory ?? []) as JsonValue[]),{from:from.ref.id,to:toId,at:c.recordedAt,by:c.actorRef}];
  return done([
   changed('SessionMoved',session,{tableId:toId,revision:Number(session.state.revision ?? 0)+1,tableHistory:history}),
   changed('TableReleased',from,{activeSessionId:null}),changed('TableOccupied',to,{activeSessionId:session.ref.id}),
   ...all(s,'order').filter(o=>o.state.sessionId===session.ref.id&&o.state.status==='open').map(o=>changed('OrderTableChanged',o,{tableId:toId})),
   ...retarget.events,
  ],{sessionId:session.ref.id,tableId:toId,effects:retarget.effects});
 });
}
