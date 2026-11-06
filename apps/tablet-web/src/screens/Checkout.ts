import {el,field,select,panel,list,tr,money,summary,button,act,type ScreenContext} from '../ui';
import type {JsonObject,Snapshot} from '../../../../packages/contracts/src/index';
import {refundableComponents} from '../../../../packages/domain/src/pricing/combo';
const big=(v:unknown)=>BigInt(String(v??'0'));
const dueOf=(b:Snapshot)=>big(b.state.totalMinor)-big(b.state.paidMinor)+big(b.state.refundedMinor);
export function Checkout(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid');
 const can=(permission:string)=>c.session.permissions.includes('*')||c.session.permissions.includes(permission);
 const done=()=>{};
 const activeShift=list(c,'shift').find(s=>s.state.cashierId===c.session.actorId&&s.state.status==='open');
 if(!activeShift)root.append(button(tr(c,'Mở ca thu ngân','Open cash shift'),()=>act(c,'Shift.Open',{currency:'VND',openingMinor:'0'}).then(done)));
 else root.append(el('p',tr(c,'Ca đang mở · ','Shift open · ')+activeShift.ref.id));
 for(const session of list(c,'session').filter(s=>s.state.status==='open'&&!s.state.frozenBillId)){
  const row=summary(session);row.append(button(tr(c,'Chuẩn bị hóa đơn','Prepare bill'),()=>act(c,'Bill.Prepare',{sessionId:session.ref.id}).then(done)));root.append(row);
 }
 const payments=list(c,'payment');
 const unpaid=(b:Snapshot)=>b.state.status==='prepared'&&big(b.state.paidMinor)===0n&&big(b.state.unappliedMinor)===0n&&!b.state.externalPaymentState&&!b.state.collectionLocked&&!payments.some(p=>p.state.billId===b.ref.id&&p.state.status!=='failed');
 const mergeable=new Set<string>();
 for(const bill of list(c,'bill')){
   const row=summary(bill),due=dueOf(bill),currency=String(bill.state.currency??'VND');
   row.append(el('p',tr(c,'Tổng: ','Total: ')+money(bill.state.totalMinor)),el('p',tr(c,'Còn phải thu: ','Amount due: ')+money(due),'total'));
   if(big(bill.state.unappliedMinor)>0n)row.append(el('p',tr(c,'Tiền nhận dư (giữ lại, chờ hoàn/đối soát): ','Overpaid, kept for refund/reconciliation: ')+money(bill.state.unappliedMinor)));
   if(bill.state.externalPaymentState)row.append(el('p',tr(c,'Giao dịch thẻ chưa rõ kết quả: không thu lại cho đến khi đối soát · ','Card charge unresolved: no re-collection until reconciled · ')+String(bill.state.externalPaymentState),'warning'));
   if(bill.state.parentBillId)row.append(el('p',tr(c,'Tách từ ','Split from ')+String(bill.state.parentBillId)));
   if(bill.state.status==='split')row.append(el('p',tr(c,'Đã tách thành: ','Split into: ')+((bill.state.childBillIds??[]) as string[]).join(', ')));
   if(bill.state.status==='merged')row.append(el('p',tr(c,'Đã gộp vào: ','Merged into: ')+String(bill.state.mergedInto)));
   if(bill.state.status==='prepared'){
    const cash=field(tr(c,'Khách đưa tiền mặt (VND)','Cash tendered (VND)'),String(due),'number');cash.input.min='1';cash.input.step='1';
    const record=button(tr(c,'Xác nhận đã thu tiền mặt','Confirm cash received'),()=>act(c,'Payment.RecordCash',{billId:bill.ref.id,amountMinor:cash.input.value,currency,...(activeShift?{shiftId:activeShift.ref.id}:{})},bill.version).then(done));record.disabled=!activeShift||due<=0n||Boolean(bill.state.collectionLocked)||Boolean(bill.state.externalPaymentState);
    row.append(cash.node,record);
    if(can('payment.terminal')){
     const amount=field(tr(c,'Số tiền trên máy POS thẻ','Card terminal amount'),String(due>0n?due:0n),'number'),provider=field(tr(c,'Đơn vị máy POS','Terminal provider')),merchant=field(tr(c,'Mã cửa hàng (MID)','Merchant ID')),transaction=field(tr(c,'Mã giao dịch trên phiếu','Transaction reference'));
     const status=select(tr(c,'Kết quả trên máy','Terminal result'),[{id:'captured',name:tr(c,'Đã duyệt','Approved')},{id:'pending',name:tr(c,'Đang chờ','Pending')},{id:'unknown',name:tr(c,'Không rõ (mất kết nối)','Unknown (connection lost)')},{id:'failed',name:tr(c,'Từ chối','Declined')}]);
     row.append(amount.node,provider.node,merchant.node,transaction.node,status.node,button(tr(c,'Ghi nhận giao dịch thẻ','Record card terminal result'),()=>act(c,'Payment.RecordTerminal',{billId:bill.ref.id,amountMinor:amount.input.value,currency,status:status.input.value,reference:{provider:provider.input.value,merchantId:merchant.input.value,transactionId:transaction.input.value}}).then(done)));
    }
    if(can('payment.verify')&&due>0n){
     const claims=list(c,'payment-observation').filter(o=>o.state.billId===bill.ref.id&&o.state.status==='unverified');
     const amount=field(tr(c,'Số tiền chuyển khoản đã thấy','Transfer amount seen'),String(due),'number'),bank=field(tr(c,'Ngân hàng','Bank')),account=field(tr(c,'Tài khoản nhận','Receiving account')),transaction=field(tr(c,'Mã giao dịch ngân hàng','Bank transaction reference')),reason=field(tr(c,'Lý do xác nhận thủ công','Manual verification reason')),evidence=field(tr(c,'Tham chiếu chứng từ (sao kê/ảnh)','Evidence reference (statement/photo)'));
     const claim=select(tr(c,'Thông báo của khách','Customer claim'),[{id:'',name:tr(c,'Không có','None')},...claims.map(o=>({id:o.ref.id,name:o.ref.id}))]);
     row.append(amount.node,bank.node,account.node,transaction.node,reason.node,evidence.node,claim.node,button(tr(c,'Xác nhận đã nhận chuyển khoản','Verify transfer received'),()=>act(c,'Payment.VerifyManual',{billId:bill.ref.id,amountMinor:amount.input.value,currency,reference:{provider:bank.input.value,merchantId:account.input.value,transactionId:transaction.input.value},reason:reason.input.value,evidenceRef:evidence.input.value,...(claim.input.value?{claimId:claim.input.value}:{})},bill.version).then(done)));
    }
    if(unpaid(bill)){
     mergeable.add(bill.ref.id);
     const parts=field(tr(c,'Chia đều cho số người','Split equally between'),'2','number');parts.input.min='2';parts.input.max='20';
     row.append(parts.node,button(tr(c,'Chia đều hóa đơn','Split equally'),()=>act(c,'Bill.Split',{billId:bill.ref.id,mode:'equal',parts:Number(parts.input.value)},bill.version).then(done)));
     const lines=((bill.state.lines??[]) as JsonObject[]).filter(l=>big(l.quantity)>big(l.cancelledQuantity));
     if(lines.length>1&&new Set(lines.map(l=>l.id)).size===lines.length){
      const picks=lines.map(l=>({line:l,part:field(String(l.name??l.id)+tr(c,' → phần số',' → part no.'),'1','number')}));
      row.append(...picks.map(p=>p.part.node),button(tr(c,'Tách theo món','Split by line'),()=>{
       const groups=new Map<string,string[]>();for(const p of picks){const key=p.part.input.value;groups.set(key,[...(groups.get(key)??[]),String(p.line.id)]);}
       return act(c,'Bill.Split',{billId:bill.ref.id,mode:'lines',parts:[...groups.values()].map(lineIds=>({lineIds}))},bill.version).then(done);
      }));
     }
     if(can('bill.void')){const reason=field(tr(c,'Lý do hủy hóa đơn','Void reason'));row.append(reason.node,button(tr(c,'Hủy hóa đơn (chưa thu tiền)','Void bill (nothing collected)'),()=>act(c,'Bill.Void',{billId:bill.ref.id,reason:reason.input.value},bill.version).then(done),'danger'));}
    }
    const close=button(tr(c,'Đóng hóa đơn','Close bill'),()=>act(c,'Bill.Close',{billId:bill.ref.id},bill.version).then(done));close.disabled=due!==0n;row.append(close);
   }
   for(const payment of payments.filter(p=>p.state.billId===bill.ref.id)){
    const captured=big(payment.state.capturedMinor??payment.state.appliedMinor),refundable=captured-big(payment.state.refundedMinor);
    const line=el('p',`${String(payment.state.method)} · ${String(payment.state.status)} · `+tr(c,'đã nhận ','captured ')+money(captured)+(big(payment.state.changeMinor)>0n?tr(c,' · tiền thối ',' · change ')+money(payment.state.changeMinor):'')+(big(payment.state.refundedMinor)>0n?tr(c,' · đã hoàn ',' · refunded ')+money(payment.state.refundedMinor):''));
    row.append(line);
    if(can('payment.refund')&&payment.state.status==='captured'&&refundable>0n){
     const amount=field(tr(c,'Số tiền hoàn','Refund amount'),String(refundable),'number'),reason=field(tr(c,'Lý do hoàn tiền','Refund reason')),evidence=field(tr(c,'Tham chiếu hoàn (thẻ/chuyển khoản)','Refund reference (card/transfer)'));
     row.append(amount.node,reason.node,...(payment.state.method==='cash'?[]:[evidence.node]),button(tr(c,'Hoàn tiền','Record refund'),()=>act(c,'Refund.Record',{paymentId:payment.ref.id,amountMinor:amount.input.value,reason:reason.input.value,...(payment.state.method==='cash'?{}:{evidenceRef:evidence.input.value})},payment.version).then(done)));
     // one part of a combo goes back at the domain's live share (after cancellations, split and merge), once
     const refunded=new Set(list(c,'refund').filter(r=>r.state.billId===bill.ref.id&&r.state.component).map(r=>{const k=r.state.component as {lineId:string;itemId:string};return k.lineId+'\u0000'+k.itemId;}));
     for(const part of refundableComponents((bill.state.lines??[]) as JsonObject[])){
      const share=big(part.minor);
      if(share>0n&&share<=refundable&&!refunded.has(part.lineId+'\u0000'+part.itemId))row.append(button(`${tr(c,'Hoàn phần combo','Refund combo part')}: ${part.name} (${money(share)})`,()=>act(c,'Refund.Record',{paymentId:payment.ref.id,amountMinor:String(share),component:{lineId:part.lineId,itemId:part.itemId},reason:reason.input.value,...(payment.state.method==='cash'?{}:{evidenceRef:evidence.input.value})},payment.version).then(done),'quiet'));
     }
    }
   }
   const grant=list(c,'grant').find(g=>g.state.billId===bill.ref.id&&g.state.status!=='reconciled');
   const manager=can('continuity.resolve');
   if(!grant&&manager&&bill.state.status==='prepared'&&due>0n){
    const devices=list(c,'device').filter(d=>d.state.status==='active').map(d=>({id:d.ref.id,name:String(d.state.name??d.ref.id)}));
    if(devices.length){const recipient=select(tr(c,'Thiết bị được thu offline','Device allowed to collect offline'),devices);row.append(recipient.node,button(tr(c,'Khóa khoản thu cho thiết bị','Reserve collection for device'),()=>act(c,'SettlementGrant.Issue',{billId:bill.ref.id,deviceId:recipient.input.value}).then(done)));}
   }
   if(grant){
    row.append(el('p',tr(c,'Quyền thu độc quyền: ','Exclusive collection: ')+String(grant.state.status)+' · '+String(grant.state.deviceId)),el('p',tr(c,'Đã ghi nhận trên thiết bị: ','Recorded on recipient device: ')+money(grant.state.spentMinor??'0')));
    if(grant.state.deviceId===c.session.deviceId&&['issued','partially_used','used'].includes(String(grant.state.status))&&!grant.state.restorationIncomplete){
     if(grant.state.status!=='used'){const amount=field(tr(c,'Tiền mặt nhận theo quyền offline','Cash received under offline grant'),String(big(grant.state.amountMinor)-big(grant.state.spentMinor)),'number');row.append(amount.node,button(tr(c,'Ghi nhận tiền theo quyền đã cấp','Record granted cash'),()=>act(c,'SettlementGrant.Use',{grantId:grant.ref.id,amountMinor:amount.input.value,currency:grant.state.currency!,method:'cash'}).then(done)));}
     row.append(button(tr(c,'Đóng quyền thu trên thiết bị này','Close collection right on this device'),()=>act(c,'SettlementGrant.Return',{grantId:grant.ref.id}).then(done)));
    }
    if(manager&&grant.state.status==='returned'&&list(c,'grant-return').some(proof=>proof.ref.id===grant.ref.id)){
     const evidence=field(tr(c,'Tham chiếu đối soát tiền thực tế','Actual funds reconciliation reference'));
     row.append(evidence.node,button(tr(c,'Đối soát và trả quyền thu','Reconcile and release collection right'),()=>act(c,'SettlementGrant.Reconcile',{grantId:grant.ref.id,evidenceRef:evidence.input.value}).then(done)));
    }
   }
   root.append(row);
 }
 if(mergeable.size>1){
  const box=el('fieldset');box.append(el('legend',tr(c,'Gộp các hóa đơn chưa thu tiền','Merge unpaid bills')));
  const picks=[...mergeable].map(id=>{const label=el('label'),input=el('input');input.type='checkbox';input.value=id;label.append(input,el('span',id));box.append(label);return input;});
  box.append(button(tr(c,'Gộp hóa đơn đã chọn','Merge selected bills'),()=>act(c,'Bill.Merge',{bills:picks.filter(p=>p.checked).map(p=>({billId:p.value,expectedVersion:list(c,'bill').find(b=>b.ref.id===p.value)!.version}))}).then(done)));
  root.append(box);
 }
 root.append(el('p',tr(c,'Thông báo của khách về chuyển khoản cần đối soát; không tự xác nhận đã thu.','Customer transfer claims need verification and do not settle a bill.'),'muted'));return panel(tr(c,'Thu ngân','Checkout'),root);
}
