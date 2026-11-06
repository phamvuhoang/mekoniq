import {el,field,panel,list,tr,money,summary,button,act,type ScreenContext} from '../ui';
import {shiftLedger} from '../../../../packages/domain/src/cash/ledger';
const big=(v:unknown)=>BigInt(String(v??'0'));
export function CashShift(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid');
 const can=(permission:string)=>c.session.permissions.includes('*')||c.session.permissions.includes(permission);
 const approver=can('shift.approve'),done=()=>{};
 const shifts=list(c,'shift').filter(s=>s.state.cashierId===c.session.actorId||approver);
 if(!list(c,'shift').some(s=>s.state.cashierId===c.session.actorId&&s.state.status==='open')){
  const opening=field(tr(c,'Tiền đầu ca (VND)','Opening float (VND)'),'0','number');opening.input.min='0';
  root.append(opening.node,button(tr(c,'Mở ca thu ngân','Open cash shift'),()=>act(c,'Shift.Open',{currency:'VND',openingMinor:opening.input.value}).then(done)));
 }
 for(const shift of shifts.sort((a,b)=>String(b.state.openedAt).localeCompare(String(a.state.openedAt)))){
  const row=summary(shift),L=shiftLedger(c.snapshots,shift),open=shift.state.status==='open',currency=String(shift.state.currency??'VND'),own=shift.state.cashierId===c.session.actorId;
  row.append(el('p',`${tr(c,'Thu ngân','Cashier')}: ${String(shift.state.cashierId)} · ${shift.ref.id}`),
   el('p',`${tr(c,'Đầu ca','Opening')} ${money(L.opening,currency)} + ${tr(c,'thu tiền mặt','cash received')} ${money(L.receipts,currency)} + ${tr(c,'nộp thêm','cash in')} ${money(L.in,currency)} − ${tr(c,'chi ra','cash out')} ${money(L.out,currency)} − ${tr(c,'hoàn tiền mặt','cash refunds')} ${money(L.refunds,currency)} − ${tr(c,'tiền thối','change')} ${money(L.change,currency)}`,'muted'),
   el('p',`${tr(c,'Tiền mặt cần có trong két: ','Expected cash in drawer: ')}${money(open?L.expectedMinor:shift.state.expectedMinor,currency)}`,'total'));
  if(!open){
   row.append(el('p',`${tr(c,'Đã đếm','Counted')} ${money(shift.state.countedMinor,currency)} · ${tr(c,'chênh lệch','variance')} ${money(shift.state.varianceMinor,currency)}${shift.state.approvedBy?` · ${tr(c,'duyệt bởi','approved by')} ${String(shift.state.approvedBy)}`:''}${shift.state.varianceReason?` · ${String(shift.state.varianceReason)}`:''}`,big(shift.state.varianceMinor)===0n?'muted':'warning'),
    el('p',tr(c,'Ca đã đóng, không sửa được.','Shift closed; it cannot be edited.'),'muted'));
   if(big(L.adjustmentMinor)!==0n)row.append(el('p',tr(c,'Điều chỉnh sau khi đóng ca: ','Adjustments after close: ')+money(L.adjustmentMinor,currency),'warning'));
   if(approver){
    const direction=el('select');direction.setAttribute('aria-label',tr(c,'Chiều điều chỉnh tiền','Cash adjustment direction'));const amount=field(tr(c,'Số tiền điều chỉnh sau đóng ca','Late adjustment amount'),'','number'),reason=field(tr(c,'Lý do điều chỉnh (bắt buộc)','Adjustment reason (required)'));
    for(const [id,name] of [['in',tr(c,'Thu thêm','Cash in')],['out',tr(c,'Chi ra','Cash out')]]){const o=el('option',name);o.value=id!;direction.append(o);}
    row.append(direction,amount.node,reason.node,button(tr(c,'Ghi điều chỉnh sau đóng ca','Record adjustment after close'),()=>act(c,'Cash.RecordMovement',{shiftId:shift.ref.id,direction:direction.value,amountMinor:amount.input.value,reason:reason.input.value,adjustment:true}).then(done)));
   }
   root.append(row);continue;
  }
  if(own||approver){
   const direction=el('select');direction.setAttribute('aria-label',tr(c,'Chiều điều chỉnh tiền','Cash adjustment direction'));const amount=field(tr(c,'Số tiền nộp thêm / chi ra (VND)','Cash in / out amount (VND)'),'','number'),reason=field(tr(c,'Lý do','Reason'));
   for(const [id,name] of [['in',tr(c,'Nộp thêm vào két','Cash in')],['out',tr(c,'Chi ra khỏi két','Cash out')]]){const o=el('option',name);o.value=id!;direction.append(o);}
   row.append(direction,amount.node,reason.node,button(tr(c,'Ghi sổ két','Record cash movement'),()=>act(c,'Cash.RecordMovement',{shiftId:shift.ref.id,direction:direction.value,amountMinor:amount.input.value,reason:reason.input.value,...(own?{}:{approve:true})}).then(done)));
   const counted=field(tr(c,'Tiền mặt đếm được (VND)','Counted cash (VND)'),'','number'),why=field(tr(c,'Lý do chênh lệch (quản lý duyệt)','Variance reason (manager approval)'));
   row.append(counted.node,why.node,button(tr(c,'Đóng ca và đối soát','Close shift and reconcile'),()=>{
    const variance=counted.input.value===''?0n:big(counted.input.value)-big(L.expectedMinor),approve=!own||variance!==0n;
    if(approve&&!approver){c.notify(tr(c,'Chênh lệch cần quản lý duyệt và đếm lại.','A variance needs a manager to recount and approve.'),true);return;}
    return act(c,'Shift.Close',{shiftId:shift.ref.id,countedMinor:counted.input.value,...(approve?{approve:true,reason:why.input.value}:{})},shift.version).then(done);
   }));
  }
  root.append(row);
 }
 if(!root.children.length)root.append(el('p',tr(c,'Chưa có ca nào.','No shifts yet.')));
 return panel(tr(c,'Ca và sổ két','Cash shifts and cashbook'),root);
}
