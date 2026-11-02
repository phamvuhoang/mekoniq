import {el,field,select,panel,list,tr,button,act,summary,money,type ScreenContext} from '../ui';
import {paidDeposits,unresolvedDeposit} from '../../../../packages/domain/src/reservations/resource';
const iso=(v:string)=>v?new Date(v).toISOString():'';
/** Bookings, deposits and the waitlist from the coordinator's data on this tablet. Everything here is a command the coordinator checks again; while it is unreachable a booking taken here is only provisional. */
export function Reservations(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),can=(p:string)=>c.session.permissions.includes('*')||c.session.permissions.includes(p),at=(v:unknown)=>new Date(String(v)).toLocaleString(c.language==='vi'?'vi-VN':'en-GB');
 const offline=c.session.mode==='isolated';
 for(const b of list(c,'booking').filter(x=>!['cancelled','no_show'].includes(String(x.state.status))).sort((x,y)=>Number(x.state.startMs)-Number(y.state.startMs))){
  const row=summary(b),paid=paidDeposits(c.snapshots,b.ref.id).reduce((a,d)=>a+BigInt(String(d.state.paidMinor)),0n),status=String(b.state.status);
  row.append(el('p',`${String(b.state.tableId)} · ${at(b.state.startsAt)} → ${at(b.state.endsAt)} · ${String(b.state.partySize)} ${tr(c,'khách','guests')} · ${String(b.state.name)}`,'muted'));
  if(b.state.provisional)row.append(el('p',tr(c,'Đặt tạm khi mất kết nối: chưa đảm bảo bàn cho đến khi nhà hàng xác nhận.','Taken while disconnected: the table is not guaranteed until the venue confirms.'),'warning'));
  if(BigInt(String(b.state.depositRequiredMinor))>0n)row.append(el('p',`${tr(c,'Đặt cọc','Deposit')} ${money(paid)} / ${money(b.state.depositRequiredMinor)}${unresolvedDeposit(c.snapshots,b.ref.id)?` · ${tr(c,'có khoản cọc chưa rõ kết quả (giữ bàn)','a deposit result is unknown (table stays held)')}`:''}`,paid<BigInt(String(b.state.depositRequiredMinor))?'warning':'muted'));
  if(status==='requested')row.append(button(tr(c,'Xác nhận đặt bàn','Confirm booking'),()=>act(c,'Booking.Confirm',{bookingId:b.ref.id},b.version).then(()=>{})));
  if(status==='confirmed'){
   row.append(button(tr(c,'Khách đã đến (nhận bàn)','Check in'),()=>act(c,'Booking.CheckIn',{bookingId:b.ref.id},b.version).then(()=>{})));
   const why=field(tr(c,'Lý do không đến (bắt buộc)','No-show reason (required)'));
   row.append(why.node,button(tr(c,'Khách không đến','Mark no-show'),()=>act(c,'Booking.NoShow',{bookingId:b.ref.id,reason:why.input.value},b.version).then(()=>{})));
  }
  if(['requested','confirmed'].includes(status)){
   const amount=field(tr(c,'Tiền cọc nhận (VND)','Deposit received (VND)'),'','number');
   row.append(amount.node,button(tr(c,'Nhận tiền cọc (tiền mặt)','Take deposit (cash)'),()=>act(c,'Deposit.Receive',{depositId:crypto.randomUUID(),bookingId:b.ref.id,amountMinor:amount.input.value,method:'cash'}).then(()=>{})));
   const cancel=field(tr(c,'Lý do hủy','Cancel reason'));row.append(cancel.node,button(tr(c,'Hủy đặt bàn','Cancel booking'),()=>act(c,'Booking.Cancel',{bookingId:b.ref.id,reason:cancel.input.value},b.version).then(()=>{})));
  }
  root.append(row);
 }
 for(const d of list(c,'deposit').filter(x=>BigInt(String(x.state.paidMinor))-BigInt(String(x.state.appliedMinor??'0'))-BigInt(String(x.state.returnedMinor??'0'))-BigInt(String(x.state.forfeitedMinor??'0'))>0n)){
  const left=BigInt(String(d.state.paidMinor))-BigInt(String(d.state.appliedMinor??'0'))-BigInt(String(d.state.returnedMinor??'0'))-BigInt(String(d.state.forfeitedMinor??'0')),row=el('article',undefined,'record');
  row.append(el('strong',`${tr(c,'Cọc còn phải trả/áp vào hóa đơn','Deposit still owed')}: ${money(left)}`),el('p',`${d.ref.id} · ${String(d.state.bookingId??'—')} · ${tr(c,'khoản phải trả, không phải doanh thu','a liability, not sales')}`,'muted'));
  if(can('deposit.manage')){const amt=field(tr(c,'Số tiền hoàn','Amount to return'),'','number'),why=field(tr(c,'Lý do hoàn','Reason'));row.append(amt.node,why.node,button(tr(c,'Hoàn cọc (tiền mặt)','Return deposit (cash)'),()=>act(c,'Deposit.Return',{depositId:d.ref.id,amountMinor:amt.input.value,method:'cash',reason:why.input.value}).then(()=>{})));}
  root.append(row);
 }
 const waiting=list(c,'waitlist').filter(w=>w.state.status==='waiting').sort((a,b)=>Number(a.state.joinedMs)-Number(b.state.joinedMs)),tables=list(c,'table').map(t=>({id:t.ref.id,name:String(t.state.name??t.ref.id)}));
 waiting.forEach((w,i)=>{const row=summary(w);row.append(el('p',`#${i+1} · ${String(w.state.partySize)} ${tr(c,'khách','guests')} · ${at(w.state.joinedAt)}`,'muted'));
  if(tables.length){const t=select(tr(c,'Bàn','Table'),tables),skip=field(tr(c,'Lý do bỏ qua người đến trước (nếu có)','Reason for skipping those ahead (if any)'));row.append(t.node,skip.node,button(tr(c,'Mời vào bàn','Seat this party'),()=>act(c,'Waitlist.Promote',{waitId:w.ref.id,tableId:t.input.value,...(skip.input.value?{skipReason:skip.input.value}:{})}).then(()=>{})));}
  root.append(row);});
 const wn=field(tr(c,'Tên khách chờ','Waitlist name')),wp=field(tr(c,'Số khách','Party size'),'2','number');
 root.append(wn.node,wp.node,button(tr(c,'Thêm vào danh sách chờ','Add to waitlist'),()=>act(c,'Waitlist.Join',{waitId:crypto.randomUUID(),name:wn.input.value,partySize:Number(wp.input.value)}).then(()=>{})));
 const t=select(tr(c,'Bàn','Table'),tables),s=field(tr(c,'Bắt đầu','Starts'),'','datetime-local'),e=field(tr(c,'Kết thúc','Ends'),'','datetime-local'),n=field(tr(c,'Tên khách','Guest name')),p=field(tr(c,'Số khách','Party size'),'2','number'),dep=field(tr(c,'Cọc yêu cầu (VND, 0 = không)','Deposit required (VND, 0 = none)'),'0','number');
 root.append(t.node,s.node,e.node,n.node,p.node,dep.node,button(tr(c,'Tạo đặt bàn','Create booking'),()=>act(c,'Booking.Create',{bookingId:crypto.randomUUID(),tableId:t.input.value,startsAt:iso(s.input.value),endsAt:iso(e.input.value),partySize:Number(p.input.value),name:n.input.value,depositRequiredMinor:dep.input.value||'0',...(offline?{isolated:true}:{})}).then(()=>{})));
 return panel(tr(c,'Đặt bàn, cọc và danh sách chờ','Reservations, deposits and waitlist'),root);
}
