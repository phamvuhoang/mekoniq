import {Capacitor} from '@capacitor/core';
import type {JsonObject} from '../../../packages/contracts/src/index';
import type {ScreenContext} from './ui';
import {el,panel,tr,button} from './ui';
import {DeviceStatus} from './screens/DeviceStatus';
import {Pos} from './screens/Pos';
import {Kitchen} from './screens/Kitchen';
import {Fleet} from './screens/Fleet';
import {Checkout} from './screens/Checkout';
import {IsolatedSales} from './screens/IsolatedSales';
import {Reconciliation} from './screens/Reconciliation';
import {Maintenance} from './screens/Maintenance';
import {ImportHistory} from './screens/ImportHistory';
import {Recovery} from './screens/Recovery';
import {CashShift} from './screens/CashShift';
import {PrintQueue} from './screens/PrintQueue';
import {Kiosk} from './screens/Kiosk';
import {RobotDisplay} from './screens/RobotDisplay';
import {GuestRequests} from './screens/GuestRequests';
import {Reports} from './screens/Reports';
import {RobotSetup} from './screens/RobotSetup';
export const routes=[
 {path:'/device',key:'device',permission:'',screen:DeviceStatus},
 {path:'/pos',key:'pos',permission:'order.write',screen:Pos},
 {path:'/kitchen',key:'kitchen',permission:'kitchen.write',screen:Kitchen},
 {path:'/fleet',key:'fleet',permission:'mission.write',screen:Fleet},
 {path:'/robot',key:'fleet',permission:'mission.write',screen:Fleet},
 {path:'/robot-setup',key:'robot-setup',permission:'robot.configure',screen:RobotSetup},
 {path:'/checkout',key:'checkout',permission:'payment.cash',screen:Checkout},
 {path:'/cash',key:'cash',permission:'shift.write',screen:CashShift},
 {path:'/print',key:'print',permission:'print',screen:PrintQueue},
 {path:'/reports',key:'reports',permission:'report.read',screen:Reports},
 {path:'/guest-requests',key:'guest-requests',permission:'order.write',screen:GuestRequests},
 {path:'/kiosk',key:'kiosk',permission:'guest.order',screen:Kiosk},
 {path:'/robot-screen',key:'robot-screen',permission:'guest.order',screen:RobotDisplay},
 {path:'/isolated',key:'isolated',permission:'continuity.capture',screen:IsolatedSales},
 {path:'/reconciliation',key:'reconciliation',permission:'continuity.resolve',screen:Reconciliation},
 {path:'/maintenance',key:'maintenance',permission:'continuity.resolve',screen:Maintenance},
 {path:'/import',key:'import',permission:'continuity.import.approve',screen:ImportHistory},
 {path:'/recovery',key:'recovery',permission:'continuity.resolve',screen:Recovery},
] as const;
/**
 * A screen that starts business for a feature is offered only while that feature is enabled or draining in the applied configuration (any of the listed).
 * Display only: the coordinator's feature guard is the enforcement. No configuration snapshot -> nothing is hidden. Reports are read-only and stay.
 */
export const screenFeatures:Record<string,string[]>={'/pos':['pos.order'],'/kitchen':['kitchen'],'/fleet':['fleet'],'/robot':['fleet'],'/robot-setup':['fleet'],'/checkout':['billing'],'/cash':['cash.shift'],'/print':['printing'],'/guest-requests':['guest.call','guest.bill','qr.order','kiosk.order'],'/kiosk':['kiosk.order'],'/robot-screen':['robot.order']};
export function featureOn(c:Pick<ScreenContext,'snapshots'>,path:string){
 const wanted=screenFeatures[path],features=c.snapshots.find(s=>s.ref.kind==='configuration'&&s.ref.id==='applied')?.state.features as Record<string,{status?:string}>|undefined;
 return !wanted||!features||wanted.some(key=>['enabled','draining'].includes(String(features[key]?.status)));
}
export function canOpen(c:ScreenContext,permission:string){return !permission||c.session.permissions.includes('*')||c.session.permissions.includes(permission);}
export function routeScreen(path:string,c:ScreenContext):HTMLElement {
 if(path==='/settings'){
  const links=el('div',undefined,'management-links');
  for(const route of routes.filter(r=>['/isolated','/reconciliation','/maintenance','/import','/recovery'].includes(r.path)&&canOpen(c,r.permission))){const a=el('a',({vi:{isolated:'Ghi nhận riêng',reconciliation:'Đối soát',maintenance:'Bảo trì',import:'Nhập phiếu cũ',recovery:'Phục hồi'},en:{isolated:'Isolated capture',reconciliation:'Reconciliation',maintenance:'Maintenance',import:'Import history',recovery:'Recovery'}}[c.language] as Record<string,string>)[route.key]);a.href=route.path;links.append(a);}
  const settings=panel(tr(c,'Quản lý vận hành','Service management'),links);
  if(Capacitor.isNativePlatform()){
    const code=el('textarea');code.rows=7;code.id='pairing-code';const label=el('label',tr(c,'Mã ghép nối bộ điều phối','Coordinator pairing code'));label.htmlFor=code.id;
    settings.append(label,code);
    if(c.session.isCoordinator)settings.append(button(tr(c,'Tạo mã ghép nối một lần','Create one-time pairing code'),async()=>{try{const {Lan}=await import('../../tablet-android/src/lan-bridge');code.value=JSON.stringify(await Lan.pairingOffer({endpoint:c.session.ownerEndpoint,organizationId:c.session.organizationId,venueId:c.session.venueId}));}catch(error){c.notify(String(error),true);}}));
    else settings.append(button(tr(c,'Ghép nối với bộ điều phối','Pair with coordinator'),async()=>{try{const {Lan}=await import('../../tablet-android/src/lan-bridge');const offer=JSON.parse(code.value) as JsonObject;await Lan.pairWithCoordinator({offer});code.value='';c.notify(tr(c,'Đã ghép nối','Paired'));await c.refresh();}catch(error){c.notify(String(error),true);}}));
  }
  return settings;
 }
 const route=routes.find(r=>r.path===path);
 if(!route)return panel(tr(c,'Không tìm thấy màn hình','Screen not found'));
 if(!canOpen(c,route.permission))return panel(tr(c,'Không có quyền truy cập','Access denied'),el('p',tr(c,'Liên hệ quản lý để cấp quyền phù hợp.','Ask a manager for the required permission.')));
 if(!featureOn(c,path))return panel(tr(c,'Chức năng đang tắt','Feature is off'),el('p',tr(c,'Chức năng này chưa được bật trong cấu hình nhà hàng.','This function is not enabled in the venue configuration.')));
 return route.screen(c);
}
