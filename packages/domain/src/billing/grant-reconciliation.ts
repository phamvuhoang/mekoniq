import type {CommandEnvelope,Snapshot} from '../../../contracts/src/index';
import {text,amount,requireState,change,ok} from '../continuity/shared';
import {grantSpentFromReceipts,verifyStoredGrant,verifyGrantReturn} from './settlement-grant';
export function reconcileGrant(c:CommandEnvelope,s:Snapshot[]) {
 const id=text(c.payload.grantId),grant=requireState(s,'grant',id);
 if(grant.state.status==='reconciled')throw new Error('GRANT_ALREADY_RECONCILED');
 const authority=verifyStoredGrant(c,s,grant.state);
 if(grant.state.restorationIncomplete===true)throw new Error('GRANT_RESTORE_INCOMPLETE');
 if(grant.state.status!=='returned')throw new Error('GRANT_RETURN_REQUIRED');
 const proof=requireState(s,'grant-return',id);
 verifyGrantReturn(c,s,grant.state,proof.state);
 const evidenceRef=text(c.payload.evidenceRef,'RECONCILIATION_EVIDENCE_REQUIRED');
 const bill=requireState(s,'bill',String(grant.state.billId));
 if(bill.state.grantId!==id||bill.state.collectionLocked!==true)throw new Error('GRANT_BILL_LOCK_MISMATCH');
 const spent=grantSpentFromReceipts(s,grant.state),oldPaid=BigInt(amount(bill.state.paidMinor ?? '0'));
 const total=BigInt(amount(bill.state.totalMinor))+BigInt(amount(bill.state.refundedMinor ?? '0'));
 if(oldPaid>total)throw new Error('BILL_BALANCE_CORRUPT');
 const combined=oldPaid+spent,applied=combined>total?total:combined;
 return ok([change('SettlementGrantReconciled','grant',id,{...grant.state,status:'reconciled',evidenceRef,reconciledBy:c.actorRef,reconciledAt:new Date(Number(authority.nowMs)).toISOString()}),change('BillGrantReconciled','bill',bill.ref.id,{...bill.state,paidMinor:String(applied),unappliedMinor:String(BigInt(amount(bill.state.unappliedMinor ?? '0'))+combined-applied),collectionLocked:false,grantId:null})],{grantId:id,appliedMinor:String(applied-oldPaid),unappliedMinor:String(combined-applied)});
}
