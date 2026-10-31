import {hashPayload} from '../../../contracts/src/index';
import type {CommandEnvelope,JsonObject,Snapshot} from '../../../contracts/src/index';
import {sourceId,sourceKey} from './source-links';
import {text,objects,requireState,find,change,ok} from './shared';
export function applyImport(c:CommandEnvelope,s:Snapshot[]) {
  const id=text(c.payload.batchId),batch=requireState(s,'import-batch',id),b=batch.state;
  if(!['approved','partial','applied'].includes(String(b.status)))throw new Error('IMPORT_NOT_APPROVED');
  if(b.approvedHash!==b.previewHash||b.previewHash!==hashPayload({rows:b.rows,incidentRef:b.incidentRef,venueId:c.venueId}))throw new Error('PREVIEW_CHANGED');
  const rows=objects(b.rows),cursor=typeof b.cursor==='number'?b.cursor:0;
  if(cursor>=rows.length)return ok([],{batchId:id,status:'applied',cursor});
  const row=rows[cursor];
  const identity={venueId:c.venueId,sourceType:text(row.sourceType),sourceSeries:text(row.sourceSeries),sourceNumber:text(row.sourceNumber)};
  const key=sourceKey(identity),receiptId=sourceId(identity),contentHash=hashPayload(row);
  const existing=find(s,'historical-receipt',receiptId);
  if(existing&&existing.state.contentHash!==contentHash)throw new Error('SOURCE_CONFLICT');
  // Validation/approval may predate another batch's commit. Recheck under the apply read-set CAS.
  if(typeof row.paymentReference==='string'&&s.some(x=>x.ref.kind==='historical-receipt'&&x.state.paymentReference===row.paymentReference&&x.state.sourceKey!==key))throw new Error('DUPLICATE_PAYMENT_REFERENCE');
  const events=[];
  // A durable source link also de-duplicates a later tablet export for this paper receipt.
  const sourceRef=typeof row.originalOperationId==='string'?row.originalOperationId:null;
  const linked=sourceRef?s.find(x=>x.ref.kind==='source-link'&&x.state.originalOperationId===sourceRef):undefined;
  const linkedPaper=typeof row.paperSourceKey==='string'?s.find(x=>x.ref.kind==='historical-receipt'&&x.state.sourceKey===row.paperSourceKey):undefined;
  if(linked) {
    const linkedReceipt=requireState(s,'historical-receipt',String(linked.state.receiptId));
    if(linkedReceipt.state.totalMinor!==row.totalMinor||linkedReceipt.state.paidCashMinor!==row.paidCashMinor||linkedReceipt.state.currency!==row.currency)throw new Error('SOURCE_LINK_CONFLICT');
  }
  if(linkedPaper&&(linkedPaper.state.totalMinor!==row.totalMinor||linkedPaper.state.paidCashMinor!==row.paidCashMinor||linkedPaper.state.currency!==row.currency))throw new Error('SOURCE_LINK_CONFLICT');
  if(!existing&&!linked&&!linkedPaper) events.push(change('HistoricalReceiptRecorded','historical-receipt',receiptId,{...row,id:receiptId,sourceKey:key,contentHash,originalOperationId:sourceRef,importedAt:c.recordedAt,importedBy:c.actorRef,batchId:id,stockAdjustment:'deferred_pending_recipe',kind:'historical_import'}));
  if(sourceRef&&!linked)events.push(change('ImportSourceLinked','source-link',hashPayload(sourceRef),{originalOperationId:sourceRef,receiptId:linkedPaper?.ref.id??receiptId,sourceKey:linkedPaper?.state.sourceKey??key}));
  events.push(change('ImportProgressed','import-batch',id,{...b,cursor:cursor+1,status:cursor+1===rows.length?'applied':'partial'}));
  return ok(events,{batchId:id,cursor:cursor+1,status:cursor+1===rows.length?'applied':'partial',duplicateReceipt:!!existing||!!linked||!!linkedPaper});
}
export function amendImport(c:CommandEnvelope,s:Snapshot[]) {
  const receiptId=text(c.payload.receiptId),receipt=requireState(s,'historical-receipt',receiptId);
  const reason=text(c.payload.reason),delta=c.payload.deltaMinor;
  if(typeof delta!=='string'||!/^(-?[1-9][0-9]{0,29}|0)$/.test(delta))throw new Error('INVALID_AMOUNT');
  const amendment:JsonObject={receiptId,originalHash:receipt.state.contentHash,deltaMinor:delta,reason,approvedBy:c.actorRef,occurredAt:c.occurredAt,recordedAt:c.recordedAt};
  return ok([change('HistoricalReceiptAmended','historical-amendment',c.operationId,amendment)],{amendmentId:c.operationId});
}
