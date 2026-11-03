import {el,field,select,panel,list,tr,button,act,summary,type ScreenContext} from '../ui';
export function Staff(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),can=(p:string)=>c.session.permissions.includes('*')||c.session.permissions.includes(p),me=c.session.actorId;
 const open=list(c,'staff-clock').find(s=>s.ref.id===me)?.state.openAttendanceId;
 // The punch id makes a retried tap the same punch: a duplicate offline punch is a no-op, never a second shift.
 root.append(open?button(tr(c,'Kết thúc ca làm (chấm công ra)','Clock out'),()=>act(c,'Staff.ClockOut',{punchId:crypto.randomUUID()}).then(()=>{})):button(tr(c,'Bắt đầu ca làm (chấm công vào)','Clock in'),()=>act(c,'Staff.ClockIn',{punchId:crypto.randomUUID()}).then(()=>{})));
 const attendance=list(c,'attendance').filter(a=>a.state.userId===me||can('workforce.approve')).sort((a,b)=>String(b.state.clockInAt).localeCompare(String(a.state.clockInAt))).slice(0,30);
 for(const a of attendance){
  const row=summary(a);row.append(el('p',`${String(a.state.userId)} · ${new Date(String(a.state.clockInAt)).toLocaleString(c.language==='vi'?'vi-VN':'en-GB')} → ${a.state.clockOutAt?new Date(String(a.state.clockOutAt)).toLocaleString(c.language==='vi'?'vi-VN':'en-GB'):tr(c,'đang làm','on shift')}${a.state.deviceMismatch?` · ${tr(c,'chấm ra từ thiết bị khác','clocked out on another device')}`:''}`,a.state.deviceMismatch?'warning':'muted'));
  if(can('workforce.approve')&&a.state.userId!==me){
   const out=field(tr(c,'Giờ ra đúng (sửa)','Corrected clock-out'),'','datetime-local'),why=field(tr(c,'Lý do sửa (bắt buộc)','Reason (required)'));
   row.append(out.node,why.node,button(tr(c,'Duyệt sửa chấm công','Approve correction'),()=>act(c,'Staff.ApproveCorrection',{attendanceId:a.ref.id,clockOutAt:out.input.value?new Date(out.input.value).toISOString():'',reason:why.input.value}).then(()=>{})));
  }
  root.append(row);
 }
 if(can('workforce.write')){
  const stations=list(c,'station').map(s=>({id:s.ref.id,name:String(s.state.name??s.ref.id)})),user=field(tr(c,'Nhân viên (mã đăng nhập)','Staff member (login id)')),from=field(tr(c,'Bắt đầu','Starts'),'','datetime-local'),to=field(tr(c,'Kết thúc','Ends'),'','datetime-local'),station=select(tr(c,'Trạm','Station'),[{id:'',name:'—'},...stations]);
  root.append(user.node,from.node,to.node,station.node,button(tr(c,'Xếp ca','Schedule shift'),()=>act(c,'Staff.Schedule',{scheduleId:crypto.randomUUID(),userId:user.input.value,startsAt:from.input.value?new Date(from.input.value).toISOString():'',endsAt:to.input.value?new Date(to.input.value).toISOString():'',...(station.input.value?{stationId:station.input.value}:{})}).then(()=>{})));
  for(const sch of list(c,'shift-schedule').sort((a,b)=>String(a.state.startsAt).localeCompare(String(b.state.startsAt))).slice(-20)){const r=el('p',`${String(sch.state.userId)} · ${new Date(String(sch.state.startsAt)).toLocaleString(c.language==='vi'?'vi-VN':'en-GB')} → ${new Date(String(sch.state.endsAt)).toLocaleString(c.language==='vi'?'vi-VN':'en-GB')}${sch.state.stationId?` · ${String(sch.state.stationId)}`:''}`,'muted');root.append(r);}
 }
 root.append(el('p',tr(c,'Quyền và trạm của nhân viên được quản lý trong quản trị đám mây (danh tính), không đổi tại tablet. Đây là giờ làm vận hành, không phải bảng lương.','Staff permissions and stations are managed in the cloud identity workflow, not on the tablet. These are operational hours, not payroll.'),'muted'));
 return panel(tr(c,'Ca làm và chấm công','Shifts and attendance'),root);
}
