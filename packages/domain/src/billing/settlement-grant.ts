import {canonicalBytes,hashPayload,verifyEs256,type PublicEcJwk} from '../../../contracts/src/index';
import type {CommandEnvelope,JsonObject,Snapshot} from '../../../contracts/src/index';
import {amount,text,find,requireState,change,ok,object} from '../continuity/shared';
export function grantBlocksReissue(status:string){return ['issued','partially_used','used','unknown','returned'].includes(status);}
const signedFields=['schemaVersion','id','organizationId','venueId','billId','billVersion','billSnapshotHash','deviceId','deviceEpoch','issuerDeviceId','issuerDeviceEpoch','issuerEpoch','nonce','currency','amountMinor','methods','issuedAt','expiresAt','expiresAtMs'];
export function grantCapability(grant:JsonObject):JsonObject {
 const capability=Object.fromEntries(signedFields.map(key=>[key,grant[key]]));
 if(Object.values(capability).some(value=>value===undefined))throw new Error('INVALID_GRANT_CAPABILITY');
 return capability;
}
export function trustedGrantAuthority(c:CommandEnvelope,s:Snapshot[]):JsonObject {
 const authority=requireState(s,'__scope__','authority');
 if(authority.ref.organizationId!==c.organizationId||authority.ref.venueId!==c.venueId||authority.state.coordinatorEpoch!==c.coordinatorEpoch)throw new Error('GRANT_AUTHORITY_MISMATCH');
 if(typeof authority.state.nowMs!=='number'||!Number.isSafeInteger(authority.state.nowMs))throw new Error('TRUSTED_CLOCK_REQUIRED');
 return authority.state;
}
export function immutableBillHash(billId:string,bill:JsonObject):string {
 return hashPayload({billId,totalMinor:bill.totalMinor!,currency:bill.currency ?? 'VND',lines:bill.lines ?? [],orderIds:bill.orderIds ?? [],sessionId:bill.sessionId ?? null});
}
export function verifyStoredGrant(c:CommandEnvelope,s:Snapshot[],grant:JsonObject):JsonObject {
 const authority=trustedGrantAuthority(c,s);
 if(grant.organizationId!==c.organizationId||grant.venueId!==c.venueId)throw new Error('GRANT_SCOPE_MISMATCH');
 if(grant.issuerEpoch!==authority.coordinatorEpoch||grant.issuerDeviceId!==authority.ownerDeviceId||grant.issuerDeviceEpoch!==authority.deviceEpoch)throw new Error('GRANT_ISSUER_MISMATCH');
 const publicJwk=object(authority.publicJwk);
 if(typeof grant.signature!=='string'||!verifyEs256(canonicalBytes(grantCapability(grant)),grant.signature,publicJwk as PublicEcJwk))throw new Error('GRANT_SIGNATURE_INVALID');
 if(grant.schemaVersion!==1||typeof grant.expiresAtMs!=='number'||!Number.isSafeInteger(grant.expiresAtMs)||Date.parse(String(grant.expiresAt))!==grant.expiresAtMs)throw new Error('INVALID_GRANT_CAPABILITY');
 return authority;
}
export function grantSpentFromReceipts(s:Snapshot[],grant:JsonObject):bigint {
 const receipts=s.filter(x=>x.ref.kind==='grant-receipt'&&x.state.grantId===grant.id);
 const spent=receipts.reduce((sum,receipt)=>{
  if(receipt.state.billId!==grant.billId||receipt.state.currency!==grant.currency||receipt.state.deviceId!==grant.deviceId||receipt.state.deviceEpoch!==grant.deviceEpoch)throw new Error('GRANT_LEDGER_MISMATCH');
  return sum+BigInt(amount(receipt.state.amountMinor));
 },0n);
 if(spent!==BigInt(amount(grant.spentMinor ?? '0')))throw new Error('GRANT_LEDGER_MISMATCH');
 return spent;
}
export function issueGrant(c:CommandEnvelope,s:Snapshot[]) {
 const p=c.payload,billId=text(p.billId);
 // Even an expired/fully spent grant remains locked until its receipt inventory is reconciled.
 if(s.some(x=>x.ref.kind==='grant'&&x.state.billId===billId&&grantBlocksReissue(String(x.state.status))))throw new Error('GRANT_UNRECONCILED');
 const authority=trustedGrantAuthority(c,s),nowMs=Number(authority.nowMs);
 const bill=requireState(s,'bill',billId);
 if(bill.state.status!=='prepared'||bill.state.collectionLocked===true)throw new Error('BILL_NOT_PREPARED');
 if(['pending','unknown'].includes(String(bill.state.externalPaymentState))||s.some(x=>x.ref.kind==='payment'&&x.state.billId===billId&&['pending','unknown'].includes(String(x.state.status))))throw new Error('PAYMENT_UNRESOLVED');
 const deviceId=text(p.deviceId),device=requireState(s,'device',deviceId);
 if(device.state.status!=='active')throw new Error('GRANT_DEVICE_NOT_ACTIVE');
 const deviceEpoch=text(device.state.deviceEpoch);
 const due=BigInt(amount(bill.state.totalMinor))-BigInt(amount(bill.state.paidMinor ?? '0'))+BigInt(amount(bill.state.refundedMinor ?? '0'));
 const reserved=p.amountMinor===undefined?due:BigInt(amount(p.amountMinor));
 if(reserved<=0n||reserved>due)throw new Error('INVALID_GRANT_AMOUNT');
 const expiresAtMs=p.expiresAtMs===undefined?nowMs+86400000:p.expiresAtMs;
 if(typeof expiresAtMs!=='number'||!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=nowMs||expiresAtMs>nowMs+86400000)throw new Error('INVALID_GRANT_EXPIRY');
 const id=typeof p.grantId==='string'?text(p.grantId):c.operationId;
 if(find(s,'grant',id))throw new Error('GRANT_ID_EXISTS');
 const grant:JsonObject={schemaVersion:1,id,organizationId:c.organizationId,venueId:c.venueId,billId,billVersion:bill.version+1,billSnapshotHash:immutableBillHash(billId,bill.state),deviceId,deviceEpoch,issuerDeviceId:text(authority.ownerDeviceId),issuerDeviceEpoch:text(authority.deviceEpoch),issuerEpoch:c.coordinatorEpoch,nonce:c.operationId,currency:bill.state.currency ?? 'VND',amountMinor:String(reserved),spentMinor:'0',methods:['cash'],issuedAt:new Date(nowMs).toISOString(),expiresAt:new Date(expiresAtMs).toISOString(),expiresAtMs,status:'issued',signature:''};
 return ok([change('SettlementGrantIssued','grant',id,grant),change('BillCollectionReserved','bill',billId,{...bill.state,grantId:id,collectionLocked:true})],{grantId:id});
}
export function useGrant(c:CommandEnvelope,s:Snapshot[]) {
 const id=text(c.payload.grantId),grant=requireState(s,'grant',id).state;
 if(grant.deviceId!==c.deviceId)throw new Error('GRANT_DEVICE_MISMATCH');
 const authority=verifyStoredGrant(c,s,grant);
 const device=requireState(s,'device',c.deviceId);
 if(grant.deviceEpoch!==c.deviceEpoch||device.state.deviceEpoch!==grant.deviceEpoch||device.state.status!=='active')throw new Error('GRANT_DEVICE_EPOCH_MISMATCH');
 if(!['issued','partially_used'].includes(String(grant.status)))throw new Error('GRANT_NOT_SPENDABLE');
 if(Number(authority.nowMs)>=Number(grant.expiresAtMs))throw new Error('GRANT_EXPIRED');
 if(c.payload.currency!==undefined&&c.payload.currency!==grant.currency)throw new Error('CURRENCY_MISMATCH');
 if(c.payload.method!=='cash'||!Array.isArray(grant.methods)||!grant.methods.includes('cash'))throw new Error('METHOD_NOT_ALLOWED');
 const bill=requireState(s,'bill',String(grant.billId));
 if(bill.state.currency!==grant.currency)throw new Error('CURRENCY_MISMATCH');
 if(bill.version!==grant.billVersion||bill.state.grantId!==id||bill.state.collectionLocked!==true||bill.state.status!=='prepared'||immutableBillHash(bill.ref.id,bill.state)!==grant.billSnapshotHash)throw new Error('GRANT_BILL_CHANGED');
 const paid=BigInt(amount(c.payload.amountMinor)),spent=grantSpentFromReceipts(s,grant),limit=BigInt(amount(grant.amountMinor));
 if(paid<=0n||spent+paid>limit)throw new Error('GRANT_LIMIT_EXCEEDED');
 return ok([change('SettlementGrantUsed','grant',id,{...grant,spentMinor:String(spent+paid),status:spent+paid===limit?'used':'partially_used'}),change('GrantCashRecorded','grant-receipt',c.operationId,{grantId:id,billId:grant.billId!,amountMinor:String(paid),currency:grant.currency!,deviceId:c.deviceId,deviceEpoch:c.deviceEpoch,occurredAt:c.occurredAt,recordedAt:c.recordedAt,signature:grant.signature!})],{receiptId:c.operationId});
}

export function grantReceiptInventory(s:Snapshot[],grant:JsonObject) {
 const receipts=s.filter(x=>x.ref.kind==='grant-receipt'&&x.state.grantId===grant.id).sort((a,b)=>a.ref.id<b.ref.id?-1:a.ref.id>b.ref.id?1:0);
 const summaries=receipts.map(receipt=>({id:receipt.ref.id,grantId:receipt.state.grantId!,billId:receipt.state.billId!,amountMinor:receipt.state.amountMinor!,currency:receipt.state.currency!,deviceId:receipt.state.deviceId!,deviceEpoch:receipt.state.deviceEpoch!}));
 return {receiptIds:receipts.map(r=>r.ref.id),receiptHash:hashPayload(summaries),spentMinor:String(grantSpentFromReceipts(s,grant))};
}
const returnFields=['schemaVersion','grantId','organizationId','venueId','deviceId','deviceEpoch','issuerEpoch','spentMinor','receiptIds','receiptHash','returnedAt'];
export function grantReturnCapability(proof:JsonObject):JsonObject {
 const value=Object.fromEntries(returnFields.map(key=>[key,proof[key]]));
 if(Object.values(value).some(v=>v===undefined))throw new Error('INVALID_GRANT_RETURN');
 return value;
}
export function returnGrant(c:CommandEnvelope,s:Snapshot[]) {
 const id=text(c.payload.grantId),grant=requireState(s,'grant',id);
 const authority=verifyStoredGrant(c,s,grant.state);
 if(grant.state.restorationIncomplete===true)throw new Error('GRANT_RESTORE_INCOMPLETE');
 if(authority.localDeviceId!==grant.state.deviceId||authority.localDeviceEpoch!==grant.state.deviceEpoch||c.deviceId!==grant.state.deviceId||c.deviceEpoch!==grant.state.deviceEpoch)throw new Error('GRANT_RETURN_RECIPIENT_REQUIRED');
 const device=requireState(s,'device',c.deviceId);
 if(device.state.deviceEpoch!==c.deviceEpoch||device.state.status!=='active')throw new Error('GRANT_DEVICE_EPOCH_MISMATCH');
 if(['returned','reconciled'].includes(String(grant.state.status)))throw new Error('GRANT_ALREADY_RETURNED');
 const inventory=grantReceiptInventory(s,grant.state);
 const proof:JsonObject={schemaVersion:1,grantId:id,organizationId:c.organizationId,venueId:c.venueId,deviceId:c.deviceId,deviceEpoch:c.deviceEpoch,issuerEpoch:grant.state.issuerEpoch!,...inventory,returnedAt:new Date(Number(authority.nowMs)).toISOString(),signature:''};
 return ok([change('SettlementGrantReturned','grant',id,{...grant.state,status:'returned',returnProofId:id}),change('SettlementGrantReturnRecorded','grant-return',id,proof)],{grantId:id,returnProofId:id});
}
export function verifyGrantReturn(c:CommandEnvelope,s:Snapshot[],grant:JsonObject,proof:JsonObject):void {
 verifyStoredGrant(c,s,grant);
 const device=requireState(s,'device',String(grant.deviceId));
 if(proof.schemaVersion!==1||proof.grantId!==grant.id||proof.organizationId!==c.organizationId||proof.venueId!==c.venueId||proof.deviceId!==grant.deviceId||proof.deviceEpoch!==grant.deviceEpoch||proof.issuerEpoch!==grant.issuerEpoch||device.state.deviceEpoch!==grant.deviceEpoch)throw new Error('GRANT_RETURN_SCOPE_MISMATCH');
 if(!verifyEs256(canonicalBytes(grantReturnCapability(proof)),text(proof.signature),object(device.state.publicJwk) as PublicEcJwk))throw new Error('GRANT_RETURN_SIGNATURE_INVALID');
 const inventory=grantReceiptInventory(s,grant);
 if(proof.spentMinor!==inventory.spentMinor||proof.receiptHash!==inventory.receiptHash||hashPayload(proof.receiptIds!)!==hashPayload(inventory.receiptIds))throw new Error('GRANT_RETURN_RECEIPTS_MISSING');
}
