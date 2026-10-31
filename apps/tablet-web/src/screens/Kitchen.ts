import {el,field,panel,list,tr,summary,button,act,type ScreenContext} from '../ui';
export function Kitchen(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid');
 // Delta tickets (cancelled-before-cooking) stay on screen until the station acknowledges them.
 for(const delta of list(c,'kitchen-delta').filter(s=>s.state.status==='pending')){
   const row=summary(delta);row.append(el('p',`${tr(c,'HỦY','CANCEL')} × ${String(delta.state.quantity)} · ${String(delta.state.stationId)} · ${String(delta.state.reason??'')}`),
     button(tr(c,'Đã nhận (ACK)','Acknowledge'),()=>act(c,'Kitchen.AckDelta',{deltaId:delta.ref.id,stationId:delta.state.stationId!},delta.version).then(()=>{})));
   root.append(row);
 }
 // Cooked food on a cancelled line: the kitchen must say what happened to it, nothing is discarded automatically.
 for(const request of list(c,'kitchen-cancellation').filter(s=>s.state.status==='requested')){
   const note=field(tr(c,'Ghi chú (bắt buộc khi xử lý tay)','Note (required for manual handling)')),row=summary(request),dispose=(disposition:string)=>act(c,'Kitchen.DisposePrepared',{cancellationId:request.ref.id,stationId:request.state.stationId!,disposition,...(note.input.value?{note:note.input.value}:{})},request.version).then(()=>{});
   row.append(el('p',`${tr(c,'Khách hủy món đã làm','Guest cancelled cooked food')} × ${String(request.state.quantity)} · ${String(request.state.stationId)} · ${String(request.state.reason??'')}`),note.node,
     button(tr(c,'Dùng lại','Return to stock'),()=>dispose('return'),'quiet'),button(tr(c,'Bỏ đi','Waste'),()=>dispose('waste'),'danger'),button(tr(c,'Xử lý tay','Handled manually'),()=>dispose('manual'),'quiet'));
   root.append(row);
 }
 const tickets=list(c,'kitchen-ticket').filter(s=>!['cancelled','ready'].includes(String(s.state.status))).sort((a,b)=>Number(a.state.course??1)-Number(b.state.course??1));
 const courses=new Set(tickets.map(s=>Number(s.state.course??1)));let shown=0;
 for(const ticket of tickets){
   const course=Number(ticket.state.course??1);
   if(courses.size>1&&course!==shown){shown=course;root.append(el('h3',tr(c,`Đợt ${course}`,`Course ${course}`)));}
   const quantity=field(tr(c,'Số phần vừa xong','Newly prepared portions'),'1','number');quantity.input.min='1';quantity.input.step='1';
   const row=summary(ticket);row.append(el('p',String(ticket.state.stationId)+' · '+String(ticket.state.prepared??'0')+'/'+String(ticket.state.quantity)));
   if(ticket.state.status==='held'){row.append(el('p',tr(c,'Đang giữ, chờ gọi món đợt này.','Held until this course is fired.'),'muted'));root.append(row);continue;}
   if(ticket.state.status==='queued')row.append(button(tr(c,'Nhận làm','Start preparation'),()=>act(c,'Kitchen.Accept',{lineId:ticket.ref.id,stationId:ticket.state.stationId!},ticket.version).then(()=>{})));
   row.append(quantity.node,button(tr(c,'Sẵn sàng','Ready'),()=>act(c,'Kitchen.Ready',{lineId:ticket.ref.id,stationId:ticket.state.stationId!,quantity:quantity.input.value},ticket.version).then(()=>{})));
   root.append(row);
 }
 if(!root.children.length)root.append(el('p',tr(c,'Không có phiếu cần chuẩn bị.','No tickets awaiting preparation.')));
 return panel(tr(c,'Bếp và quầy','Kitchen and bar'),root);
}
