import {hashPayload} from '../../../contracts/src/index';
import type {CommandEnvelope,Snapshot} from '../../../contracts/src/index';
import {validateImportRows} from './import-validator';
import {text,objects,requireState,change,ok,find} from './shared';
import {sourceId,sourceKey} from './source-links';
export function validateImport(c:CommandEnvelope,s:Snapshot[]) {
  const rows=validateImportRows(c.payload.rows),incidentRef=text(c.payload.incidentRef);
  const id=c.operationId,previewHash=hashPayload({rows,incidentRef,venueId:c.venueId});
  const conflicts:{row:number;code:string;sourceKey:string}[]=[],seen=new Map<string,string>(),references=new Map<string,string>();
  rows.forEach((row,index)=>{
    const identity={venueId:c.venueId,sourceType:String(row.sourceType),sourceSeries:String(row.sourceSeries),sourceNumber:String(row.sourceNumber)},key=sourceKey(identity),hash=hashPayload(row);
    const existing=find(s,'historical-receipt',sourceId(identity));
    if((seen.has(key)&&seen.get(key)!==hash)||(existing&&existing.state.contentHash!==hash))conflicts.push({row:index,code:'SOURCE_CONFLICT',sourceKey:key});
    seen.set(key,hash);
    if(typeof row.paymentReference==='string') {
      const previous=references.get(row.paymentReference);
      if((previous&&previous!==key)||s.some(x=>x.ref.kind==='historical-receipt'&&x.state.paymentReference===row.paymentReference&&x.state.sourceKey!==key))conflicts.push({row:index,code:'DUPLICATE_PAYMENT_REFERENCE',sourceKey:key});
      references.set(row.paymentReference,key);
    }
  });
  return ok([change('ImportValidated','import-batch',id,{id,rows,incidentRef,previewHash,status:'validated',conflicts,cursor:0,createdBy:c.actorRef,createdAt:c.recordedAt})],{batchId:id,previewHash,rowCount:rows.length,conflicts});
}
export function previewImport(c:CommandEnvelope,s:Snapshot[]) {
  const batch=requireState(s,'import-batch',text(c.payload.batchId)).state,rows=objects(batch.rows);
  const total=rows.reduce((sum,r)=>sum+BigInt(String(r.totalMinor)),0n),cash=rows.reduce((sum,r)=>sum+BigInt(String(r.paidCashMinor)),0n);
  const currencies=[...new Set(rows.map(row=>String(row.currency)))];
  return ok([],{batchId:batch.id,previewHash:batch.previewHash,rowCount:rows.length,grossMinor:currencies.length===1?String(total):'mixed',cashMinor:currencies.length===1?String(cash):'mixed',totals:currencies.map(currency=>({currency,grossMinor:String(rows.filter(row=>row.currency===currency).reduce((sum,row)=>sum+BigInt(String(row.totalMinor)),0n)),cashMinor:String(rows.filter(row=>row.currency===currency).reduce((sum,row)=>sum+BigInt(String(row.paidCashMinor)),0n))})),conflicts:batch.conflicts??[],inventoryImpact:'deferred_pending_recipe',externalPaymentState:'observation_only'});
}
export function approveImport(c:CommandEnvelope,s:Snapshot[]) {
  const id=text(c.payload.batchId),batch=requireState(s,'import-batch',id);
  if(batch.state.previewHash!==c.payload.previewHash)throw new Error('PREVIEW_CHANGED');
  if(Array.isArray(batch.state.conflicts)&&batch.state.conflicts.length)throw new Error(String((batch.state.conflicts[0] as {code:string}).code));
  if(batch.state.status!=='validated')throw new Error('IMPORT_ALREADY_REVIEWED');
  return ok([change('ImportApproved','import-batch',id,{...batch.state,status:'approved',approvedBy:c.actorRef,approvedAt:c.recordedAt,approvedHash:c.payload.previewHash})]);
}
