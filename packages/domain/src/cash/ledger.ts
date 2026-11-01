import type { Snapshot } from '../../../contracts/src/index';
/** Pure cash arithmetic, shared by the domain handlers and the tablet UI (no domain/runtime imports). */
export function expectedCash(x:{opening:bigint;receipts:bigint;in:bigint;out:bigint;refunds:bigint;change:bigint}) {
 return String(x.opening + x.receipts + x.in - x.out - x.refunds - x.change);
}
const big=(v:unknown)=>BigInt(String(v ?? '0'));
/**
 * Everything the drawer expects, recomputed from the recorded ledger facts (cash payments, cash refunds, cash-in/out movements), never from a
 * running counter that could drift (`shift.cashMinor` is only compared for audit). Receipts are what was tendered; change leaves again.
 * Adjustments recorded after the shift closed are reported apart: they never change the closed shift's own totals.
 */
export function shiftLedger(s:Snapshot[],shift:Snapshot) {
 const of=(kind:string)=>s.filter(x=>x.ref.kind===kind),id=shift.ref.id,payments=of('payment').filter(p=>p.state.shiftId===id&&p.state.method==='cash'&&p.state.status==='captured');
 const moves=of('cash-movement').filter(m=>m.state.shiftId===id),sum=(xs:Snapshot[],k:string)=>xs.reduce((a,x)=>a+big(x.state[k]),0n);
 const regular=moves.filter(m=>m.state.adjustment!==true),adjustments=moves.filter(m=>m.state.adjustment===true);
 const parts={opening:big(shift.state.openingMinor),receipts:payments.reduce((a,p)=>a+big(p.state.tenderedMinor ?? big(p.state.capturedMinor ?? p.state.appliedMinor)+big(p.state.changeMinor)),0n),
  in:sum(regular.filter(m=>m.state.direction==='in'),'amountMinor'),out:sum(regular.filter(m=>m.state.direction==='out'),'amountMinor'),
  refunds:sum(of('refund').filter(r=>r.state.shiftId===id&&r.state.method==='cash'),'amountMinor'),change:sum(payments,'changeMinor')};
 const adjustment=sum(adjustments.filter(m=>m.state.direction==='in'),'amountMinor')-sum(adjustments.filter(m=>m.state.direction==='out'),'amountMinor');
 return {...parts,expectedMinor:expectedCash(parts),adjustmentMinor:String(adjustment)};
}
