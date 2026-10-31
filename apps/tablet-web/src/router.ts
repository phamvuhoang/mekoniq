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
export const routes=[
 {path:'/device',key:'device',permission:'',screen:DeviceStatus},
 {path:'/pos',key:'pos',permission:'order.write',screen:Pos},
 {path:'/kitchen',key:'kitchen',permission:'kitchen.write',screen:Kitchen},
 {path:'/fleet',key:'fleet',permission:'mission.write',screen:Fleet},
 {path:'/robot',key:'fleet',permission:'mission.write',screen:Fleet},
 {path:'/checkout',key:'checkout',permission:'payment.cash',screen:Checkout},
 {path:'/isolated',key:'isolated',permission:'continuity.capture',screen:IsolatedSales},
 {path:'/reconciliation',key:'reconciliation',permission:'continuity.resolve',screen:Reconciliation},
 {path:'/maintenance',key:'maintenance',permission:'continuity.resolve',screen:Maintenance},
 {path:'/import',key:'import',permission:'continuity.import.approve',screen:ImportHistory},
 {path:'/recovery',key:'recovery',permission:'continuity.resolve',screen:Recovery},
] as const;
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
 return route.screen(c);
}
