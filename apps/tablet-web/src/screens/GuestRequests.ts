import {encodeGuestToken} from '../../../../packages/domain/src/service/guest-token';
import {el,panel,list,tr,button,act,featureShown,type ScreenContext} from '../ui';
/** Staff view of guest service calls (acknowledging never touches a bill) and the per-seating guest links (QR/kiosk tokens). */
export function GuestRequests(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),tableName=(id:unknown)=>String(list(c,'table').find(t=>t.ref.id===id)?.state.name??id);
 const kinds:Record<string,string>={staff:tr(c,'Gọi nhân viên','Staff call'),bill:tr(c,'Yêu cầu thanh toán','Bill request'),issue:tr(c,'Báo sự cố','Issue report')};
 const sessions=new Map(list(c,'session').map(s=>[s.ref.id,s]));
 for(const call of list(c,'service-call').filter(s=>s.state.status==='open').sort((a,b)=>Number(a.state.lastRequestedAtMs)-Number(b.state.lastRequestedAtMs))){
  const row=el('article',undefined,'record');
  row.append(el('strong',`${tableName(sessions.get(String(call.state.sessionId))?.state.tableId??call.state.tableId)} · ${kinds[String(call.state.kind)]??String(call.state.kind)}`),el('span',`×${String(call.state.count)}`,'badge'));
  if(call.state.category)row.append(el('p',String(call.state.category)));if(call.state.note)row.append(el('p',String(call.state.note),'muted'));
  row.append(el('p',`${tr(c,'Lần cuối','Last')}: ${String(call.state.lastRequestedAt)} · ${String(call.state.channel)}`,'muted'));
  if(call.state.kind==='bill')row.append(el('p',tr(c,'Chỉ là yêu cầu: hãy lập và thu bill ở màn Thu ngân.','Only a request: prepare and collect the bill on Checkout.'),'muted'));
  row.append(button(tr(c,'Đã xử lý','Acknowledge'),()=>act(c,'Guest.AcknowledgeCall',{callId:call.ref.id},call.version).then(()=>{})));
  root.append(row);
 }
 if(!root.children.length)root.append(el('p',tr(c,'Không có yêu cầu nào đang chờ.','No open guest requests.')));
 const links=el('div',undefined,'screen-grid');
 if(featureShown(c,['sessions']))for(const table of list(c,'table').filter(t=>!t.state.activeSessionId)){
  const row=el('article',undefined,'record');row.append(el('strong',tableName(table.ref.id)),button(tr(c,'Mở phiên bàn','Open table session'),async()=>{
   const result=await act(c,'Session.Open',{tableId:table.ref.id,sessionId:crypto.randomUUID()});
   if(result?.status!=='accepted')await c.refresh(); // a concurrent seating may have occupied the table
  }));links.append(row);
 }
 for(const session of list(c,'session').filter(s=>s.state.status==='open')){
  const row=el('article',undefined,'record'),tokens=list(c,'guest-token').filter(t=>t.state.sessionId===session.ref.id&&t.state.revision===(session.state.revision??0)&&t.state.signature);
  row.append(el('strong',tableName(session.state.tableId)));
  for(const t of tokens){const code=el('code',t.state.channel==='kiosk'?encodeGuestToken(t.state):`/table/${encodeGuestToken(t.state)}`);code.style.overflowWrap='anywhere';row.append(el('p',`${String(t.state.channel).toUpperCase()} · ${tr(c,'hết hạn','expires')} ${String(t.state.expiresAt)}`,'muted'),code);}
  row.append(button(tr(c,'Tạo link QR cho khách','Create guest QR link'),()=>act(c,'Guest.IssueToken',{sessionId:session.ref.id,channel:'qr'}).then(()=>{}),'quiet'),button(tr(c,'Tạo mã kiosk','Create kiosk code'),()=>act(c,'Guest.IssueToken',{sessionId:session.ref.id,channel:'kiosk'}).then(()=>{}),'quiet'));
  links.append(row);
 }
 return panel(tr(c,'Yêu cầu của khách','Guest requests'),root,el('h3',tr(c,'Link khách theo bàn (hết hiệu lực khi chuyển/gộp/đóng bàn)','Guest links per table (void after move/merge/close)')),links);
}
