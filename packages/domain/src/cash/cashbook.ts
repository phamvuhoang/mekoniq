import type { ModuleRegistry } from '../modules';
import { shiftLedger } from './ledger';
export { expectedCash, shiftLedger } from './ledger';
import { amount, created, changed, done, fail, handle, note, requireState, stableId, text } from '../restaurant-context';
export function registerCashbook(registry:ModuleRegistry):void {
 // Cash.RecordMovement {shiftId,direction:'in'|'out',amountMinor,reason,adjustment?,approve?}: drawer money that is not a sale (float top-up, payout, bank drop).
 // Only the shift's own cashier moves cash in an open shift (approve: a manager with shift.approve, enforced by requiredPermissions); cash-out can never exceed the
 // drawer. After close the shift is immutable: a late movement is a separate `adjustment` (needs shift.approve) recorded beside it, "reopened day adjustment".
 handle(registry,'Cash.RecordMovement',(c,s)=>{
  const shift=requireState(s,'shift',text(c.payload.shiftId)),direction=c.payload.direction;
  if(direction!=='in'&&direction!=='out') return fail('INVALID_DIRECTION');
  const minor=amount(c.payload.amountMinor,true),reason=note(c.payload.reason,'REASON_REQUIRED'),adjustment=c.payload.adjustment===true;
  if(adjustment!==(shift.state.status==='closed')) return fail(adjustment?'ADJUSTMENT_REQUIRES_CLOSED_SHIFT':'SHIFT_CLOSED');
  if(!adjustment&&shift.state.cashierId!==c.actorRef&&c.payload.approve!==true) return fail('SHIFT_NOT_OWNED');
  if(direction==='out'&&!adjustment&&BigInt(minor)>BigInt(shiftLedger(s,shift).expectedMinor)) return fail('INSUFFICIENT_CASH');
  const id=stableId('move',c),state={shiftId:shift.ref.id,direction,amountMinor:minor,currency:String(shift.state.currency ?? 'VND'),reason,adjustment,afterClose:adjustment,actorRef:c.actorRef,occurredAt:c.occurredAt,recordedAt:c.recordedAt};
  const key=direction==='in'?'cashInMinor':'cashOutMinor';
  return done([created(adjustment?'CashAdjustmentRecorded':'CashMovementRecorded','cash-movement',id,state),
   ...(adjustment?[]:[changed('ShiftCashMoved',shift,{[key]:String(BigInt(String(shift.state[key] ?? '0'))+BigInt(minor))})])],{movementId:id,shiftId:shift.ref.id,adjustment});
 });
}
