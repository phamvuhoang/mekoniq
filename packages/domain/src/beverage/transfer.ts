// Cup ownership ledger. A cup has exactly one owner at a time: cell -> arm (grasp evidence) -> robot tray (release + receiver evidence) -> customer
// (handoff confirmation). An uncertain transfer keeps the last known owner plus the pending transfer; a release ACK is never taken as receipt.
import {hashPayload} from '../../../contracts/src/canonical';
import type {JsonObject} from '../../../contracts/src/index';
import {fail} from '../restaurant-context';
export interface Party {kind:'cell'|'arm'|'robot'|'customer'|'human';id:string;slot?:number}
export interface EvidenceHalf {observedBy:string;observedAt:string;[k:string]:unknown}
export interface PendingTransfer {transferId:string;from:Party;to:Party;epoch:number;commandId:string|null;payloadHash?:string;controlEpoch?:number;requestedAt:string;giver?:EvidenceHalf;receiver?:EvidenceHalf}
export interface Movement {transferId:string;from:Party;to:Party;provenance:string;observedBy:string;at:string;reason?:string;evidence?:JsonObject}
export interface Cup {cupId:string;cupType:string;jobId:string;recipeKey:string;ownerKind:Party['kind'];ownerId:string;slot:number|null;epoch:number;pendingTransfer:PendingTransfer|null;movements:Movement[];disposition:string|null;[k:string]:unknown}
export interface TransferReceipt {transferId:string;cupId:string;provenance:'sensor'|'human';observedBy:string;at:string;reason?:string;evidence:JsonObject}
/** Approved arm programs (selected by id + hash, never a script from the caller). Choreography is illustrative mock data. */
export const ARM_PROGRAMS:Record<string,{id:string;hash:string}>=Object.fromEntries(['cup-pick','cup-place'].map(id=>[id,{id,hash:hashPayload({id,revision:1,provenance:'illustrative'})}]));
/** Evidence a transfer needs. The tray leg is two-sided: the giver's release AND the receiver's presence + dock, from the observer bound to each side. */
export const REQUIRED_EVIDENCE:Record<string,{fields:string[];code:string}>={arm:{fields:['gripperClosed','objectPresent','liftPoseReached'],code:'GRASP_EVIDENCE_REQUIRED'},robot:{fields:['released','receiverPresent','dockInTolerance'],code:'RECEIVER_EVIDENCE_REQUIRED'}};
export const ownerOf=(c:Cup):Party=>({kind:c.ownerKind,id:c.ownerId,...c.slot!==null?{slot:c.slot}:{}});
export const partyText=(p:Party)=>p.kind==='robot'?`robot:${p.id}/tray:${p.slot}`:`${p.kind}:${p.id}`;
/**
 * Pure: apply transfer receipts to a cup. A receipt for a transfer already in the ledger is absorbed (one owner, one movement); otherwise it must
 * match the pending transfer, its fencing epoch and the cup identity. `inventoryMovementCount` is the number of ownership movements in the ledger.
 */
export function applyTransfer(cup:Cup,receipts:TransferReceipt|TransferReceipt[]):{cup:Cup;inventoryMovementCount:number;applied:number} {
 let next:Cup=structuredClone(cup),applied=0;
 for(const r of Array.isArray(receipts)?receipts:[receipts]){
  if(r.cupId!==next.cupId)return fail('CUP_MISMATCH');
  if(next.movements.some(m=>m.transferId===r.transferId))continue;
  const p=next.pendingTransfer;
  if(!p||p.transferId!==r.transferId)return fail('TRANSFER_NOT_PENDING');
  if(p.epoch!==next.epoch||p.from.kind!==next.ownerKind||p.from.id!==next.ownerId)return fail('TRANSFER_FENCED');
  const need=REQUIRED_EVIDENCE[p.to.kind];
  if(need&&!need.fields.every(f=>r.evidence[f]===true))return fail(need.code);
  next={...next,ownerKind:p.to.kind,ownerId:p.to.id,slot:p.to.slot??null,epoch:next.epoch+1,pendingTransfer:null,
   movements:[...next.movements,{transferId:r.transferId,from:p.from,to:p.to,provenance:r.provenance,observedBy:r.observedBy,at:r.at,...r.reason?{reason:r.reason}:{},evidence:r.evidence}]};
  applied++;
 }
 return {cup:next,inventoryMovementCount:next.movements.length,applied};
}
