import {el,field,panel,list,tr,button,act,summary,type ScreenContext} from '../ui';
/** E-invoice requests as this tablet knows them (the venue's own synced facts). "Issued" appears only with the provider's code; a request waits as "requested" when the cloud/provider is unreachable. */
export function Invoices(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid');
 for(const inv of list(c,'invoice-request')) {
  const row=summary(inv),status=String(inv.state.status);
  const text:Record<string,[string,string]>={requested:['Đã yêu cầu, đang chờ nhà cung cấp (chưa phải đã phát hành)','Requested, waiting for the provider (not issued yet)'],issued:['Đã phát hành','Issued'],rejected:['Bị từ chối','Rejected'],cancelled:['Đã hủy','Cancelled'],external:['Hóa đơn phát hành bên ngoài (chỉ liên kết)','Issued outside this system (link only)']};
  row.append(el('p',`${tr(c,'Hóa đơn bán hàng','Bill')} ${String(inv.state.billId)} · ${tr(c,...(text[status]??[status,status]))}`));
  if(status==='issued')row.append(el('p',`${tr(c,'Mã tra cứu','Lookup code')}: ${String(inv.state.code)}`));
  if(inv.state.amendmentDue===true)row.append(el('p',tr(c,'Đã hoàn tiền sau khi phát hành: cần điều chỉnh hoặc hủy hóa đơn tại nhà cung cấp','Refunded after issue: the invoice must be adjusted or cancelled at the provider'),'warning'));
  if(status==='rejected')row.append(el('p',`${tr(c,'Lý do','Reason')}: ${String(inv.state.rejectionReason)}`,'warning'));
  root.append(row);
 }
 const bill=field(tr(c,'Mã hóa đơn bán hàng (đã đóng)','Closed bill id')),name=field(tr(c,'Tên người mua','Buyer name')),tax=field(tr(c,'Mã số thuế (10 hoặc 13 chữ số)','Tax code (10 or 13 digits)')),email=field(tr(c,'Email nhận hóa đơn (tùy chọn)','Email (optional)'));
 root.append(bill.node,name.node,tax.node,email.node,button(tr(c,'Yêu cầu hóa đơn điện tử','Request e-invoice'),()=>act(c,'Invoice.Request',{billId:bill.input.value,buyer:{name:name.input.value,...(tax.input.value?{taxCode:tax.input.value}:{}),...(email.input.value?{email:email.input.value}:{})}}).then(()=>{})));
 if(!list(c,'invoice-request').length)root.prepend(el('p',tr(c,'Chưa có yêu cầu hóa đơn.','No invoice requests yet.')));
 return panel(tr(c,'Hóa đơn điện tử','E-invoices'),root);
}
