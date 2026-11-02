import type {JsonObject,Snapshot} from '../../../../packages/contracts/src/index';
import {el,field,select,panel,list,tr,button,act,type ScreenContext} from '../ui';
import {eligibleRobots} from '../../../../packages/domain/src/fleet/admission';
import {bindingReason} from '../../../../packages/domain/src/fleet/map-binding';
import {profileReason} from '../../../../packages/domain/src/fleet/capabilities';
/** Per robot: dispatch profile, each venue point's binding status on the map the robot reports now, and the admission reasons per capability. */
export function robotSetupView(snapshots:Snapshot[]) {
 const points=snapshots.filter(s=>s.ref.kind==='table'||s.ref.kind==='station').map(s=>({id:s.ref.id,name:String(s.state.name??s.ref.id)}));
 return snapshots.filter(s=>s.ref.kind==='robot').map(robot=>{
  const homes=[robot.state.parkingPoint,robot.state.chargingDock].filter((x):x is string=>typeof x==='string').map(id=>({id,name:id}));
  return {robot,profile:profileReason(robot.state) ?? null,
   points:[...points,...homes].map(p=>({...p,status:bindingReason(robot.state,p.id) ?? 'CURRENT'})),
   eligibility:['delivery','bussing','guide'].map(capability=>({capability,reasons:eligibleRobots({stops:[],capability,trays:1},[robot])[0]!.reasons}))};
 });
}
const reasons:Record<string,[string,string]>={
 CURRENT:['Đã gán trên bản đồ hiện tại','Bound on the current map'],MAP_BINDING_STALE:['Bản đồ đã đổi: cần gán lại','Map changed: rebind required'],TARGET_UNBOUND:['Chưa gán điểm','Not taught'],
 UNKNOWN_DRIVER:['Driver không có trong danh mục','Driver not in the capability registry'],VALIDATION_INSUFFICIENT:['Hồ sơ chưa được kiểm chứng cho venue','Profile not validated for this venue'],
 CAPABILITY_UNSUPPORTED:['Không hỗ trợ','Not supported'],BATTERY_LOW:['Pin thấp','Battery low'],SAFETY_NOT_CLEAR:['An toàn chưa xác nhận','Safety not clear'],ROBOT_UNAVAILABLE:['Đang bận/không rõ','Busy or unknown'],
};
const say=(c:ScreenContext,code:string)=>{const r=reasons[code];return r?`${tr(c,r[0],r[1])} (${code})`:code;};
export function RobotSetup(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid');
 for(const view of robotSetupView(c.snapshots)) {
  const robot=view.robot,s=robot.state as JsonObject,row=el('article',undefined,'record');
  row.append(el('strong',String(s.name??robot.ref.id)),el('span',view.profile?say(c,view.profile):String(s.validation),view.profile?'badge warning':'badge'),
   el('p',`${String(s.driver)} · ${tr(c,'bản đồ robot đang báo','map reported by robot')}: ${String(s.mapId)} rev ${String(s.mapRevision)} · ${tr(c,'lần gán','binding epoch')}: ${String(s.bindingRevision??'-')}`,'muted'));
  for(const e of view.eligibility) row.append(el('p',`${e.capability}: ${e.reasons.length?e.reasons.map(r=>say(c,r)).join(', '):tr(c,'đủ điều kiện','eligible')}`,e.reasons.length?'warning':'muted'));
  const units=select(tr(c,'Đơn vị toạ độ (bắt buộc)','Coordinate units (required)'),[{id:'',name:'—'},{id:'m',name:'m'},{id:'cm',name:'cm'},{id:'mm',name:'mm'}]),frame=field(tr(c,'Khung toạ độ (vd. map)','Frame (e.g. map)'));
  row.append(units.node,frame.node,el('p',tr(c,'Góc yaw tính bằng radian. Dạy điểm bằng vị trí robot đang đứng trên bản đồ hiện tại; bản đồ cùng kích thước không chứng minh cùng toạ độ.','Yaw is in radians. Teach a point from the robot\'s pose on the current map; a same-size map does not prove the same coordinates.'),'muted'));
  const inputs=view.points.map(p=>{
   const x=field(`${p.name} x`,'','number'),y=field('y','','number'),yaw=field('yaw','','number');
   row.append(el('p',`${p.name}: ${say(c,p.status)}`,p.status==='CURRENT'?'muted':'warning'),x.node,y.node,yaw.node);
   return {id:p.id,x,y,yaw};
  });
  row.append(button(tr(c,'Gán các điểm đã nhập','Bind entered points'),async()=>{
   const waypoints:JsonObject={};
   for(const i of inputs) if(i.x.input.value!==''&&i.y.input.value!=='') waypoints[i.id]={x:Number(i.x.input.value),y:Number(i.y.input.value),...(i.yaw.input.value!==''?{yaw:Number(i.yaw.input.value)}:{})};
   await act(c,'Robot.BindMap',{robotId:robot.ref.id,mapId:String(s.mapId),mapRevision:String(s.mapRevision),frame:frame.input.value.trim(),units:units.input.value,waypoints},robot.version);
  }));
  root.append(row);
 }
 if(!list(c,'robot').length) root.append(el('p',tr(c,'Chưa có robot.','No robots yet.')));
 return panel(tr(c,'Cài đặt robot và bản đồ','Robot and map setup'),root);
}
