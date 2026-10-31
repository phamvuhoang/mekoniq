import {el,field,select,panel,list,tr,money,summary,button,act,type ScreenContext} from '../ui';
export function Checkout(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid');
 const activeShift=list(c,'shift').find(s=>s.state.cashierId===c.session.actorId&&s.state.status==='open');
 if(!activeShift)root.append(button(tr(c,'Mở ca thu ngân','Open cash shift'),()=>act(c,'Shift.Open',{currency:'VND',openingMinor:'0'}).then(()=>{})));
 else root.append(el('p',tr(c,'Ca đang mở · ','Shift open · ')+activeShift.ref.id));
 for(const session of list(c,'session').filter(s=>s.state.status==='open'&&!s.state.frozenBillId)){
  const row=summary(session);row.append(button(tr(c,'Chuẩn bị hóa đơn','Prepare bill'),()=>act(c,'Bill.Prepare',{sessionId:session.ref.id}).then(()=>{})));root.append(row);
 }
 for(const bill of list(c,'bill')){
   const row=summary(bill),due=BigInt(String(bill.state.totalMinor))-BigInt(String(bill.state.paidMinor??'0'))+BigInt(String(bill.state.refundedMinor??'0'));
   row.append(el('p',tr(c,'Tổng: ','Total: ')+money(bill.state.totalMinor)),el('p',tr(c,'Còn phải thu: ','Amount due: ')+money(due),'total'));
   if(bill.state.status==='prepared'){
    const cash=field(tr(c,'Khách đưa tiền mặt (VND)','Cash tendered (VND)'),String(due),'number');cash.input.min='1';cash.input.step='1';
    const record=button(tr(c,'Xác nhận đã thu tiền mặt','Confirm cash received'),()=>act(c,'Payment.RecordCash',{billId:bill.ref.id,amountMinor:cash.input.value,currency:bill.state.currency??'VND',...(activeShift?{shiftId:activeShift.ref.id}:{})},bill.version).then(()=>{}));record.disabled=!activeShift||due<=0n||Boolean(bill.state.collectionLocked);
    row.append(cash.node,record);
    const close=button(tr(c,'Đóng hóa đơn','Close bill'),()=>act(c,'Bill.Close',{billId:bill.ref.id},bill.version).then(()=>{}));close.disabled=due!==0n;row.append(close);
   }
   const grant=list(c,'grant').find(g=>g.state.billId===bill.ref.id&&g.state.status!=='reconciled');
   const manager=c.session.permissions.includes('*')||c.session.permissions.includes('continuity.resolve');
   if(!grant&&manager&&bill.state.status==='prepared'&&due>0n){
    const devices=list(c,'device').filter(d=>d.state.status==='active').map(d=>({id:d.ref.id,name:String(d.state.name??d.ref.id)}));
    if(devices.length){const recipient=select(tr(c,'Thiết bị được thu offline','Device allowed to collect offline'),devices);row.append(recipient.node,button(tr(c,'Khóa khoản thu cho thiết bị','Reserve collection for device'),()=>act(c,'SettlementGrant.Issue',{billId:bill.ref.id,deviceId:recipient.input.value}).then(()=>{})));}
   }
   if(grant){
    row.append(el('p',tr(c,'Quyền thu độc quyền: ','Exclusive collection: ')+String(grant.state.status)+' · '+String(grant.state.deviceId)),el('p',tr(c,'Đã ghi nhận trên thiết bị: ','Recorded on recipient device: ')+money(grant.state.spentMinor??'0')));
    if(grant.state.deviceId===c.session.deviceId&&['issued','partially_used','used'].includes(String(grant.state.status))&&!grant.state.restorationIncomplete){
     if(grant.state.status!=='used'){const amount=field(tr(c,'Tiền mặt nhận theo quyền offline','Cash received under offline grant'),String(BigInt(String(grant.state.amountMinor))-BigInt(String(grant.state.spentMinor??'0'))),'number');row.append(amount.node,button(tr(c,'Ghi nhận tiền theo quyền đã cấp','Record granted cash'),()=>act(c,'SettlementGrant.Use',{grantId:grant.ref.id,amountMinor:amount.input.value,currency:grant.state.currency!,method:'cash'}).then(()=>{})));}
     row.append(button(tr(c,'Đóng quyền thu trên thiết bị này','Close collection right on this device'),()=>act(c,'SettlementGrant.Return',{grantId:grant.ref.id}).then(()=>{})));
    }
    if(manager&&grant.state.status==='returned'&&list(c,'grant-return').some(proof=>proof.ref.id===grant.ref.id)){
     const evidence=field(tr(c,'Tham chiếu đối soát tiền thực tế','Actual funds reconciliation reference'));
     row.append(evidence.node,button(tr(c,'Đối soát và trả quyền thu','Reconcile and release collection right'),()=>act(c,'SettlementGrant.Reconcile',{grantId:grant.ref.id,evidenceRef:evidence.input.value}).then(()=>{})));
    }
   }
   root.append(row);
 }
 root.append(el('p',tr(c,'Thông báo của khách về chuyển khoản cần đối soát; không tự xác nhận đã thu.','Customer transfer claims need verification and do not settle a bill.'),'muted'));return panel(tr(c,'Thu ngân','Checkout'),root);
}
