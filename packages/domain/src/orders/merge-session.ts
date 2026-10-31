import type { ModuleRegistry } from '../modules';
import type { CommandEnvelope, Snapshot } from '../../../contracts/src/index';
import { all, changed, done, fail, handle, requireState, text } from '../restaurant-context';
import { retargetHandoffs } from '../fleet/retarget';
const lockVersion=(c:CommandEnvelope,key:string,snapshot:Snapshot):void=>{
 if(c.payload[key]===undefined) return fail('VERSION_REQUIRED');
 if(c.payload[key]!==snapshot.version) return fail('VERSION_CONFLICT');
};
/** Aggregates that name their session; a merge re-points them, it never copies or deletes them. */
const SESSION_BOUND=['kitchen-ticket','fulfillment','allocation','kitchen-delta','kitchen-cancellation'];
/**
 * Session.Merge {sourceSessionId,targetSessionId,expectedSourceVersion,expectedTargetVersion}: source orders move under the target session.
 * Both sessions are version-locked in sorted-id order; the source session record (and its order refs) stays as history with status 'merged'.
 * Prepared bills and unreconciled settlement grants block a merge, so no bill or cash grant is ever rewritten or removed.
 */
export function registerSessionMerge(registry:ModuleRegistry):void {
 handle(registry,'Session.Merge',(c,s)=>{
  const sourceId=text(c.payload.sourceSessionId),targetId=text(c.payload.targetSessionId);
  if(sourceId===targetId) return fail('SAME_SESSION');
  const lockOrder=[sourceId,targetId].sort(),locked=new Map(lockOrder.map(id=>[id,requireState(s,'session',id)]));
  for(const id of lockOrder) lockVersion(c,id===sourceId?'expectedSourceVersion':'expectedTargetVersion',locked.get(id)!);
  const source=locked.get(sourceId)!,target=locked.get(targetId)!;
  if(source.state.status!=='open'||target.state.status!=='open') return fail('SESSION_CLOSED');
  const billIds=new Set(all(s,'bill').filter(b=>b.state.sessionId===sourceId||b.state.sessionId===targetId).map(b=>b.ref.id));
  if(all(s,'grant').some(g=>billIds.has(String(g.state.billId))&&g.state.status!=='reconciled')) return fail('GRANT_UNRECONCILED');
  if(source.state.frozenBillId||target.state.frozenBillId) return fail('SESSION_FROZEN');
  const targetTable=String(target.state.tableId),sourceTable=requireState(s,'table',String(source.state.tableId));
  // Only open orders move: a cancelled/closed one keeps its session, matching the bill or history that already names it.
  const moving=all(s,'order').filter(o=>o.state.sessionId===sourceId&&o.state.status==='open'),movingLines=new Set(moving.flatMap(o=>((o.state.lines ?? []) as {id:string}[]).map(l=>l.id)));
  const bound=(x:Snapshot)=>x.state.sessionId===sourceId&&movingLines.has(String(x.state.lineId));
  const retarget=retargetHandoffs(c,s,new Set(all(s,'allocation').filter(bound).map(a=>a.ref.id)),targetTable);
  const sessionEvents=lockOrder.map(id=>id===sourceId
   ?changed('SessionMerged',source,{status:'merged',mergedInto:targetId,mergedAt:c.recordedAt,revision:Number(source.state.revision ?? 0)+1})
   :changed('SessionMergeReceived',target,{orderIds:[...((target.state.orderIds ?? []) as string[]),...moving.map(o=>o.ref.id)],mergedFrom:[...((target.state.mergedFrom ?? []) as string[]),sourceId],revision:Number(target.state.revision ?? 0)+1}));
  return done([
   ...sessionEvents,
   ...(sourceTable.state.activeSessionId===sourceId?[changed('TableReleased',sourceTable,{activeSessionId:null})]:[]),
   ...moving.map(o=>changed('OrderSessionChanged',o,{sessionId:targetId,tableId:targetTable,originSessionId:sourceId})),
   ...SESSION_BOUND.flatMap(kind=>all(s,kind).filter(bound).map(x=>changed('SessionRefMoved',x,{sessionId:targetId,originSessionId:sourceId}))),
   ...retarget.events,
  ],{sourceSessionId:sourceId,targetSessionId:targetId,effects:retarget.effects});
 });
}
