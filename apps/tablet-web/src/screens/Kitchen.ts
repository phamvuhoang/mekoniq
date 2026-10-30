import {el,field,panel,list,tr,summary,button,act,type ScreenContext} from '../ui';
export function Kitchen(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid');
 for(const ticket of list(c,'kitchen-ticket').filter(s=>!['cancelled','ready'].includes(String(s.state.status)))){
   const quantity=field(tr(c,'Số phần vừa xong','Newly prepared portions'),'1','number');quantity.input.min='1';quantity.input.step='1';
   const row=summary(ticket);row.append(el('p',String(ticket.state.stationId)+' · '+String(ticket.state.prepared??'0')+'/'+String(ticket.state.quantity)));
   if(ticket.state.status==='queued')row.append(button(tr(c,'Nhận làm','Start preparation'),()=>act(c,'Kitchen.Accept',{lineId:ticket.ref.id,stationId:ticket.state.stationId!},ticket.version).then(()=>{})));
   row.append(quantity.node,button(tr(c,'Sẵn sàng','Ready'),()=>act(c,'Kitchen.Ready',{lineId:ticket.ref.id,stationId:ticket.state.stationId!,quantity:quantity.input.value},ticket.version).then(()=>{})));
   root.append(row);
 }
 if(!root.children.length)root.append(el('p',tr(c,'Không có phiếu cần chuẩn bị.','No tickets awaiting preparation.')));
 return panel(tr(c,'Bếp và quầy','Kitchen and bar'),root);
}
