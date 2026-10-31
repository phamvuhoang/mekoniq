import type {JsonObject} from '../../../../packages/contracts/src/index';
import {el,panel,list,tr,summary,button,act,type ScreenContext} from '../ui';
export function Fleet(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid');
 for(const portion of list(c,'fulfillment')){
   const available=BigInt(String(portion.state.ready??'0'))-BigInt(String(portion.state.allocated??'0'));if(available<=0n)continue;
   const row=summary(portion);row.append(el('p',String(available)+' '+tr(c,'phần sẵn sàng','portions available')),
    button(tr(c,'Giữ một phần','Reserve one portion'),()=>act(c,'Fulfillment.Allocate',{lineId:portion.ref.id,quantity:'1'},portion.version).then(()=>{})));
   root.append(row);
 }
 const unassigned=list(c,'allocation').filter(s=>s.state.status==='reserved'&&!s.state.missionId);
 if(unassigned.length)root.append(button(tr(c,'Tạo chuyến giao','Create delivery'),()=>act(c,'Mission.Create',{allocationIds:unassigned.map(s=>s.ref.id)}).then(()=>{})));
 for(const mission of list(c,'mission')){
   const row=summary(mission);row.append(el('p',String(mission.state.robotId)+' · '+tr(c,'Tải: ','Cargo: ')+String(mission.state.loaded)));
   const stops=Array.isArray(mission.state.stops)?mission.state.stops as JsonObject[]:[];
   const current=stops.find(s=>s.id===mission.state.currentStopId);
   if(current)row.append(el('p',String(current.action)+' → '+String(current.targetId)+' · '+String(current.status)));
   if(current?.status==='awaiting_action')row.append(button(current.action==='load'?tr(c,'Đã xếp đồ','Cargo loaded'):current.action==='return'?tr(c,'Đã trả món','Cargo returned'):tr(c,'Đã giao','Handed off'),()=>act(c,'Mission.ConfirmStop',{missionId:mission.ref.id,stopId:current.id!,missionRevision:mission.state.revision!},mission.version).then(()=>{})));
   if(!['completed','cancelled','failed'].includes(String(mission.state.status)))row.append(button(tr(c,'Hủy chuyến','Cancel delivery'),()=>act(c,'Mission.Cancel',{missionId:mission.ref.id},mission.version).then(()=>{}),'danger'));
   root.append(row);
 }
 for(const robot of list(c,'robot')){
  const row=summary(robot);row.append(el('p',String(robot.state.validation??'')+' · '+String(robot.state.goalState??'')));
  row.append(button(tr(c,'Yêu cầu dừng từ xa','Request remote stop'),()=>act(c,'Robot.RequestStop',{robotId:robot.ref.id,reason:'staff_request'}).then(()=>{}),'danger'));root.append(row);
 }
 if(!root.children.length)root.append(el('p',tr(c,'Chưa có robot hoặc phần món cần giao.','No robots or portions ready for delivery.')));
 root.append(el('p',tr(c,'Yêu cầu dừng qua mạng không thay nút dừng khẩn vật lý.','A network stop request does not replace the physical emergency stop.'),'muted'));
 return panel(tr(c,'Điều phối giao món','Dispatch'),root);
}
