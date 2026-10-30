import type { ModuleRegistry } from '../modules';
import { all, amount, changed, created, done, expectVersion, fail, handle, requireState, stableId, text } from '../restaurant-context';
import { dueMinor } from './settlement';
export function registerPayments(registry:ModuleRegistry):void {
 handle(registry,'Payment.Claim',(c,s)=>{
  const bill=requireState(s,'bill',text(c.payload.billId));
  if(bill.state.status==='closed') return fail('BILL_CLOSED');
  return done([created('PaymentClaimed','payment-observation',stableId('claim',c),{billId:bill.ref.id,method:text(c.payload.method),actorRef:c.actorRef,status:'unverified',occurredAt:c.occurredAt})],{billId:bill.ref.id,status:'unverified'});
 });
 handle(registry,'Payment.RecordCash',(c,s)=>{
  const bill=requireState(s,'bill',text(c.payload.billId)); expectVersion(c,bill);
  if(bill.state.status!=='prepared') return fail('BILL_STATE_CONFLICT');
  if(bill.state.collectionLocked===true || all(s,'grant').some(g=>g.state.billId===bill.ref.id&&g.state.status!=='reconciled')) return fail('GRANT_UNRECONCILED');
  if(bill.state.externalPaymentState==='unknown'||bill.state.externalPaymentState==='pending') return fail('PAYMENT_UNRESOLVED');
  const shifts=all(s,'shift').filter(x=>x.state.cashierId===c.actorRef && x.state.status==='open');
  const shift=shifts.find(x=>!c.payload.shiftId || x.ref.id===c.payload.shiftId) ?? fail('ACTIVE_SHIFT_REQUIRED');
  const currency=bill.state.currency ?? 'VND';
  if((c.payload.currency!==undefined && c.payload.currency!==currency) || shift.state.currency!==currency) return fail('CURRENCY_MISMATCH');
  const tendered=BigInt(amount(c.payload.amountMinor ?? c.payload.tenderedMinor,true));
  const due=BigInt(dueMinor(String(bill.state.totalMinor),String(bill.state.paidMinor),String(bill.state.refundedMinor ?? '0')));
  if(due<=0n) return fail('NO_BALANCE_DUE');
  const applied=tendered>due ? due : tendered,change=tendered-applied;
  const paymentId=stableId('cash',c);
  return done([created('CashRecorded','payment',paymentId,{billId:bill.ref.id,shiftId:shift.ref.id,currency,appliedMinor:String(applied),tenderedMinor:String(tendered),changeMinor:String(change),status:'captured',method:'cash',actorRef:c.actorRef,occurredAt:c.occurredAt}),changed('BillCashApplied',bill,{paidMinor:String(BigInt(String(bill.state.paidMinor))+applied)}),changed('ShiftCashAdded',shift,{cashMinor:amount(String(BigInt(String(shift.state.cashMinor ?? '0'))+applied))})],{paymentId,appliedMinor:String(applied),changeMinor:String(change),billId:bill.ref.id});
 });
}
