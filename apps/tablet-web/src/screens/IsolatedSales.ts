import {el,field,panel,tr,button,act,type ScreenContext} from '../ui';
let captureId=crypto.randomUUID();
export function IsolatedSales(c:ScreenContext) {
 const table=field(tr(c,'Bàn / ghi chú vị trí','Table / location')),amount=field(tr(c,'Tổng ghi trên phiếu (VND)','Receipt total (VND)'),'','number'),source=field(tr(c,'Mã phiếu giấy nếu có','Paper receipt reference, if any'));
 return panel(tr(c,'Ghi nhận riêng trên thiết bị','Record isolated activity'),el('p',tr(c,'Phiếu này chưa gắn vào hóa đơn chung. Giữ phiếu và tiền thực tế để quản lý đối soát.','This ticket is not attached to a shared bill. Keep the receipt and funds for reconciliation.')),table.node,amount.node,source.node,
  button(tr(c,'Lưu phiếu riêng','Save isolated ticket'),async()=>{const result=await act(c,'Continuity.CaptureTicket',{id:captureId,table:table.input.value,totalMinor:amount.input.value,currency:'VND',sourceRef:source.input.value||null},undefined,captureId);if(result?.status==='accepted'){captureId=crypto.randomUUID();await c.refresh();}}));
}
