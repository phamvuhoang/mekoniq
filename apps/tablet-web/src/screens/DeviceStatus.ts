import {SyncStatus} from '../../../../packages/ui/src/SyncStatus';
import {OfflineBanner} from '../../../../packages/ui/src/OfflineBanner';
import {el,panel,tr,button,type ScreenContext} from '../ui';
export function DeviceStatus(c:ScreenContext) {
 const s=c.session,root=el('div',undefined,'screen-grid');
 root.append(OfflineBanner(s.mode,c.language));
 const identity=el('dl');
 for(const [label,value] of [[tr(c,'Thiết bị','Device'),s.deviceId],[tr(c,'Nhà hàng','Venue'),s.venueId],[tr(c,'Vai trò','Role'),s.role],[tr(c,'Bộ điều phối','Coordinator'),s.ownerEndpoint||tr(c,'Chưa được cấu hình','Not provisioned')],[tr(c,'Đồng bộ cuối','Last sync'),s.lastSyncAt??tr(c,'Chưa có xác nhận cloud','No cloud receipt')],[tr(c,'Phiên bản cấu hình','Configuration revision'),String(s.policyRevision)]])identity.append(el('dt',label),el('dd',value));
 for(const pending of s.pendingOperations??[])identity.append(el('dt',tr(c,'Yêu cầu chờ xác nhận','Request awaiting acceptance')),el('dd',pending.operationId+' · '+pending.tableId));
 const reset=button(tr(c,'Xóa dữ liệu','Clear data'),()=>{},'danger');reset.disabled=true;reset.title=tr(c,'Chỉ xóa theo quy trình xuất và đối soát; không xóa nhật ký đang chờ.','Use export and reconciliation before resetting pending journals.');
 root.append(panel(tr(c,'Trạng thái lưu trữ','Delivery status'),SyncStatus({level:s.level,language:c.language}),el('p',String(s.pendingCount)+' '+tr(c,'bản ghi chờ đồng bộ','records pending sync'))),panel(tr(c,'Thiết bị vận hành','Service device'),identity,reset));return root;
}
