import {el,field,select,panel,list,tr,summary,button,act,type ScreenContext} from '../ui';
export function Reconciliation(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid');
 for(const conflict of list(c,'conflict').filter(s=>s.state.status==='open')){
  const reason=field(tr(c,'Lý do đối soát','Reconciliation reason'));
  const row=summary(conflict);row.append(el('p',tr(c,'Nguồn: ','Sources: ')+JSON.stringify(conflict.state.sources)),reason.node,button(tr(c,'Xác nhận đã đối soát','Confirm reconciliation'),()=>act(c,'Continuity.ResolveConflict',{id:conflict.ref.id,reason:reason.input.value},conflict.version).then(()=>{})));root.append(row);
 }
 for(const ticket of list(c,'isolated-ticket').filter(s=>s.state.status==='unlinked')){
  const sessions=list(c,'session').map(s=>({id:s.ref.id,name:String(s.state.tableId)+' · '+s.ref.id}));
  const session=select(tr(c,'Phiên bàn để liên kết','Session to link'),sessions),reason=field(tr(c,'Lý do liên kết','Link reason'));
  const row=summary(ticket);row.append(el('p',String(ticket.state.sourceDeviceId)+' · '+String(ticket.state.totalMinor)),session.node,reason.node,button(tr(c,'Liên kết phiếu','Link ticket'),()=>act(c,'Continuity.LinkTicket',{ticketId:ticket.ref.id,sessionId:session.input.value,reason:reason.input.value},ticket.version).then(()=>{})));root.append(row);
 }
 if(!root.children.length)root.append(el('p',tr(c,'Không có xung đột đang mở.','No open conflicts.')));return panel(tr(c,'Đối soát nguồn dữ liệu','Reconcile source records'),root);
}
