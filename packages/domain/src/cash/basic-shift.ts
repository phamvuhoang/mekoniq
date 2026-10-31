import type { ModuleRegistry } from '../modules';
import { created, done, fail, find, handle, stableId, text, amount } from '../restaurant-context';
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
}
