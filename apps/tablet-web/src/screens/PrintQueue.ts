import {el,field,panel,list,tr,summary,button,act,type ScreenContext} from '../ui';
import {printerSupport} from '../../../../integrations/printing/src/profile';
type Attempt={effectId:string;number:number;reprint:boolean;status:string;code?:string;reason:string|null};
export function PrintQueue(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),done=()=>{};
 const state=(s:string)=>({pending:tr(c,'Đang chờ in','Pending'),unknown:tr(c,'Không rõ kết quả','Unknown'),confirmed:tr(c,'Máy in xác nhận','Confirmed by printer'),failed:tr(c,'Lỗi, chưa gửi lệnh','Failed, nothing sent')} as Record<string,string>)[s]??s;
 for(const printer of list(c,'printer')){
  const support=printerSupport(printer.state),row=el('article',undefined,'record');
  row.append(el('strong',String(printer.state.label??printer.ref.id)),el('span',support.ready?tr(c,'Sẵn sàng','Ready'):tr(c,'Không hỗ trợ: ','Unsupported: ')+support.reason,'badge'),
   el('p',`${String(printer.state.transport)} · ${String(printer.state.model)} · ${tr(c,'kiểm chứng','validation')}: ${String(printer.state.validation)}`,'muted'));
  if(printer.state.validation==='fixture')row.append(el('p',tr(c,'Máy in mô phỏng/kiểm thử: chưa chứng minh in thật trên giấy.','Fixture printer: no physical print has been proven.'),'warning'));
  root.append(row);
 }
 if(!list(c,'printer').length)root.append(el('p',tr(c,'Chưa cài hồ sơ máy in nên chưa in được. Bán hàng và bếp vẫn chạy bình thường.','No printer profile installed, so printing is off. Sales and the kitchen are unaffected.'),'warning'));
 const printed=new Set(list(c,'print-job').filter(j=>((j.state.attempts??[]) as Attempt[]).some(a=>a.status!=='failed')).map(j=>`${String(j.state.billId)}:${String(j.state.kind)}`));
 for(const bill of list(c,'bill').filter(b=>['prepared','closed'].includes(String(b.state.status))&&!printed.has(`${b.ref.id}:${b.state.status==='prepared'?'bill':'receipt'}`))){
  const row=summary(bill);row.append(button(tr(c,'In hóa đơn','Print receipt'),()=>act(c,'Print.Request',{billId:bill.ref.id}).then(done)));root.append(row);
 }
 for(const job of list(c,'print-job')){
  const attempts=(job.state.attempts??[]) as Attempt[],row=el('article',undefined,'record'),reason=field(tr(c,'Lý do in lại (bắt buộc)','Reprint reason (required)'));
  row.append(el('strong',`${String(job.state.kind)} · ${String(job.state.billId)}`),el('span',state(String(job.state.status)),'badge'));
  for(const a of attempts)row.append(el('p',`#${a.number} ${a.reprint?tr(c,'IN LẠI','REPRINT'):tr(c,'bản gốc','original')} · ${state(a.status)}${a.code?` (${a.code})`:''}${a.reason?` · ${a.reason}`:''}`,a.status==='unknown'?'warning':'muted'));
  if(job.state.status==='unknown')row.append(el('p',tr(c,'Kết quả không rõ: hệ thống không tự in lại. Kiểm tra giấy in rồi chọn in lại nếu cần; doanh thu không bị ảnh hưởng.','Result unknown: the system never resends by itself. Check the paper, then reprint if needed; the sale is unaffected.'),'warning'));
  if(job.state.status!=='pending')row.append(reason.node,button(tr(c,'Xác nhận in lại','Confirm reprint'),()=>act(c,'Print.ConfirmReprint',{jobId:job.ref.id,reason:reason.input.value}).then(done)));
  root.append(row);
 }
 return panel(tr(c,'Hàng đợi in','Print queue'),root);
}
