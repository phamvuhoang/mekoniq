import type { ModuleRegistry } from '../modules';
import { changed, created, done, expectVersion, fail, find, handle, note, requireState, stableId, text, amount } from '../restaurant-context';
import { shiftLedger } from './ledger';
export function registerCashShifts(registry:ModuleRegistry):void {
 handle(registry,'Shift.Open',(c,s)=>{
  const owner=find(s,'cashier-shift',c.actorRef);
  if(owner?.state.status==='open') return fail('SHIFT_ALREADY_OPEN');
  const shiftId=c.payload.shiftId ? text(c.payload.shiftId) : stableId('shift',c);
  if(find(s,'shift',shiftId)) return fail('SHIFT_EXISTS');
  const currency=c.payload.currency ?? 'VND';
  if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)) return fail('INVALID_CURRENCY');
  const openingMinor=amount(c.payload.openingMinor ?? '0');
  return done([created('ShiftOpened','shift',shiftId,{cashierId:c.actorRef,status:'open',currency,openingMinor,cashMinor:'0',openedAt:c.recordedAt}),created('CashierShiftAssigned','cashier-shift',c.actorRef,{shiftId,status:'open'})],{shiftId});
 });
 // Shift.Close {shiftId,expectedVersion,countedMinor,note?,reason?,approve?}: counts the drawer against the ledger (cashbook.shiftLedger). A closed shift is immutable.
 // A non-zero variance needs a manager's approval (approve:true -> shift.approve, enforced by requiredPermissions) with a reason, and the approver cannot be the
 // shift's own cashier. Another cashier's shift can only be closed by an approver. Authority never moves silently: nothing here closes a shift on a timeout.
 handle(registry,'Shift.Close',(c,s)=>{
  const shift=requireState(s,'shift',text(c.payload.shiftId)); expectVersion(c,shift);
  if(shift.state.status!=='open') return fail('SHIFT_CLOSED');
  const approve=c.payload.approve===true,own=shift.state.cashierId===c.actorRef;
  if(!own&&!approve) return fail('SHIFT_NOT_OWNED');
  if(c.payload.currency!==undefined&&c.payload.currency!==shift.state.currency) return fail('CURRENCY_MISMATCH');
  const counted=BigInt(amount(c.payload.countedMinor)),ledger=shiftLedger(s,shift),variance=counted-BigInt(ledger.expectedMinor);
  let varianceReason:string|null=null;
  if(variance!==0n){
   if(!approve) return fail('VARIANCE_APPROVAL_REQUIRED');
   if(own) return fail('SELF_APPROVAL_FORBIDDEN');
   varianceReason=note(c.payload.reason,'REASON_REQUIRED');
  }
  const owner=find(s,'cashier-shift',String(shift.state.cashierId));
  const counter=BigInt(String(shift.state.cashMinor ?? '0'))-(ledger.receipts-ledger.change);
  return done([changed('ShiftClosed',shift,{status:'closed',closedAt:c.recordedAt,closedBy:c.actorRef,countedMinor:String(counted),expectedMinor:ledger.expectedMinor,varianceMinor:String(variance),varianceReason,approvedBy:approve?c.actorRef:null,
    ledger:{openingMinor:String(ledger.opening),receiptsMinor:String(ledger.receipts),cashInMinor:String(ledger.in),cashOutMinor:String(ledger.out),refundsMinor:String(ledger.refunds),changeMinor:String(ledger.change)},counterDriftMinor:String(counter),
    ...(c.payload.note!==undefined?{note:note(c.payload.note,'INVALID_NOTE')}:{})}),
   ...(owner?.state.shiftId===shift.ref.id&&owner.state.status==='open'?[changed('CashierShiftClosed',owner,{status:'closed'})]:[])],
   {shiftId:shift.ref.id,expectedMinor:ledger.expectedMinor,countedMinor:String(counted),varianceMinor:String(variance)});
 });
}
