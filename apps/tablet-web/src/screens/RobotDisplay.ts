import type {JsonObject} from '../../../../packages/contracts/src/index';
import {el,panel,list,tr,featureShown,type ScreenContext} from '../ui';
import {guestOrdering,guestSubmit} from './Kiosk';
/**
 * Robot-facing screen. Its robot is the venue's Robot.PairDisplay record for THIS device (session.deviceId), never a robotId from the URL;
 * the venue resolves the table from where that robot is waiting, so guest actions carry no table or robot id.
 */
export function RobotDisplay(c:ScreenContext) {
 const pairing=list(c,'robot-display').find(s=>s.ref.id===c.session.deviceId);
 if(!pairing)return panel(tr(c,'Màn hình robot','Robot screen'),el('p',tr(c,'Thiết bị này chưa được ghép với robot. Quản lý ghép tại màn Robot.','This device is not paired with a robot. A manager pairs it on the Robots screen.'),'warning'));
 const robotId=String(pairing.state.robotId),robot=list(c,'robot').find(r=>r.ref.id===robotId);
 const mission=list(c,'mission').find(m=>m.ref.id===robot?.state.missionId);
 const stop=((mission?.state.stops??[]) as JsonObject[]).find(s=>s.id===mission?.state.currentStopId);
 const table=stop?.status==='awaiting_action'?list(c,'table').find(t=>t.ref.id===stop.targetId):undefined;
 const root=panel(tr(c,'Màn hình robot','Robot screen'),el('p',`${tr(c,'Robot','Robot')}: ${String(robot?.state.name??robotId)}`,'badge'));
 if(robot?.state.safetyState&&robot.state.safetyState!=='clear')root.append(el('p',tr(c,'Robot đang dừng an toàn. Vui lòng gọi nhân viên.','The robot is in a safety stop. Please call staff.'),'warning'));
 if(!table?.state.activeSessionId){root.append(el('p',stop?tr(c,'Robot đang di chuyển. Vui lòng nhường đường.','The robot is moving. Please make way.'):tr(c,'Robot đang chờ.','The robot is waiting.')));return root;}
 // The status and safety notices above always show; only the guest ordering section follows robot.order (the API refuses it when off).
 if(!featureShown(c,['robot.order'])){root.append(el('p',tr(c,'Robot đã tới bàn. Gọi món trên robot hiện không được bật.','The robot has arrived. Ordering on the robot is not enabled.')));return root;}
 root.append(el('h3',String(table.state.name??table.ref.id)),guestOrdering(c,`robot:${robotId}:${String(table.state.activeSessionId)}`,(type,payload,operationId)=>guestSubmit(c,type==='Order.Place'?'Guest.PlaceOrder':type,payload,operationId)));
 return root;
}
