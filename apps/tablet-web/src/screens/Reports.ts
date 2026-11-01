import type {JsonObject} from '../../../../packages/contracts/src/index';
import {el,field,panel,tr,money,button,type ScreenContext} from '../ui';
import {buildReport,reportCsv,venueZone,isBusinessDate,type Watermark} from '../../../../packages/domain/src/reporting/report';
import {businessDateAt} from '../../../../packages/domain/src/shared/clock';
let chosen='';
type Row=[string,unknown];
/** Shift, sales and robot reports computed on this tablet from its loaded snapshots (works offline), with the same pure functions as the cloud route. */
export function Reports(c:ScreenContext) {
 const {timeZone:tz,assumed}=venueZone(c.snapshots),asOf=new Date().toISOString();
 if(!isBusinessDate(chosen))chosen=businessDateAt(asOf,tz);
 // Loaded snapshots are this device's view: none loaded = never synced (no figures), isolated = offline (may lack other devices' sales), an unknown result = stale.
 const watermark:Watermark={source:'tablet',asOf,appliedAt:c.snapshots.length?asOf:null,pending:c.session.level==='unknown'?1:0,mode:c.session.mode};
 const [sales,shifts,robots]=(['sales','shifts','robot-kpi'] as const).map(kind=>buildReport(kind,c.snapshots,{businessDate:chosen,watermark}));
 const when=(at:unknown)=>typeof at==='string'&&at?new Date(at).toLocaleString(c.language==='vi'?'vi-VN':'en-GB',{timeZone:tz}):'—';
 const dl=(rows:Row[])=>{const node=el('dl');for(const [k,v] of rows)node.append(el('dt',k),el('dd',typeof v==='string'||typeof v==='number'?String(v):'—'));return node;};
 const method=(m:unknown)=>({cash:tr(c,'Tiền mặt','Cash'),'card-terminal':tr(c,'Máy POS thẻ','Card terminal'),transfer:tr(c,'Chuyển khoản','Bank transfer')} as Record<string,string>)[String(m)]??String(m);
 const exportCsv=(r:JsonObject)=>button(tr(c,'Xuất CSV','Export CSV'),()=>{
  const a=el('a');a.href=URL.createObjectURL(new Blob(['﻿'+reportCsv(r)],{type:'text/csv;charset=utf-8'}));a.download=`${String(r.kind)}-${String(r.businessDate)}.csv`;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 },'quiet');
 const date=field(tr(c,'Ngày kinh doanh','Business date'),chosen,'date');
 const controls=el('div',undefined,'report-controls');
 controls.append(date.node,button(tr(c,'Xem báo cáo','Show report'),async()=>{if(!isBusinessDate(date.input.value)){c.notify(tr(c,'Ngày không hợp lệ','Invalid date'),true);return;}chosen=date.input.value;await c.refresh();}),
  assumed?el('p',tr(c,'Chưa cấu hình múi giờ nhà hàng: đang tạm tính ngày theo UTC, có thể lệch ngày quanh nửa đêm. Quản lý cấu hình múi giờ trong Bố trí nhà hàng.','Venue timezone not configured: days are assumed to be UTC and may be off around midnight. Configure it in the venue layout.'),'warning')
   :el('p',`${tr(c,'Múi giờ nhà hàng','Venue timezone')}: ${tz} · ${tr(c,'ngày theo giờ nhà hàng, không theo UTC','dates follow venue time, not UTC')}`,'muted'));
 const status=String(sales!.status),notice=el('p',{
  current:tr(c,`Số liệu trên máy này lúc ${when(asOf)}.`,`Figures on this device as of ${when(asOf)}.`),
  stale:sales!.statusReason==='no-recent-sync'?tr(c,'Lâu chưa nhận dữ liệu mới: số liệu có thể thiếu.','No recent data received: figures may be incomplete.'):tr(c,'Có thao tác chưa rõ kết quả hoặc chưa đồng bộ: số liệu có thể chưa đủ. Làm mới sau khi đối soát.','An operation is unresolved or not yet synced: figures may be incomplete. Refresh after reconciling.'),
  offline:tr(c,`Mất kết nối bộ điều phối: đây là số liệu đã tải lúc ${when(asOf)}, có thể thiếu giao dịch của thiết bị khác.`,`Coordinator unreachable: figures loaded at ${when(asOf)}; sales from other devices may be missing.`),
  unsynced:tr(c,'Chưa có dữ liệu đồng bộ. Không hiển thị số liệu (không phải bằng 0).','No synced data yet. No figures are shown (this is not zero).'),
 }[status]??status,status==='current'?'muted':'offline-banner');
 notice.setAttribute('role','status');notice.dataset.reportStatus=status;
 const page=el('div',undefined,'reports');page.append(panel(tr(c,'Báo cáo','Reports'),controls,notice));
 if(status==='unsynced')return page;
 const undated=[sales,shifts,robots].flatMap(r=>(r!.undatedFacts??[]) as JsonObject[]);
 if(undated.length)page.append(el('p',tr(c,`${undated.length} giao dịch có thời điểm không hợp lệ nên không xếp được vào ngày nào (không bị tính vào số liệu): `,`${undated.length} record(s) have an invalid time and cannot be placed on any day (not counted): `)+undated.map(u=>`${String(u.kind)} ${String(u.id)}`).join(', '),'warning'));
 // Sales
 const t=sales!.totals as Record<string,string>,cash=sales!.cash as Record<string,string>,bills=sales!.bills as Record<string,string|number>,rec=sales!.reconciliation as Record<string,string>;
 const sale=panel(tr(c,'Doanh thu','Sales'),dl([[tr(c,'Doanh thu gộp','Gross sales'),money(t.grossMinor)],[tr(c,'Giảm giá','Discounts'),money(t.discountMinor)],[tr(c,'Trả hàng / hoàn tiền','Returns / refunds'),money(t.returnsMinor)],[tr(c,'Doanh thu thuần','Net sales'),money(t.netMinor)],
  [tr(c,'Phí dịch vụ','Service charge'),money(t.serviceMinor)],[tr(c,'Thuế','Tax'),money(t.taxMinor)],[tr(c,'Thuế đã gồm trong giá','Tax included'),money(t.taxIncludedMinor)],[tr(c,'Tổng hóa đơn đã đóng','Closed bill total'),money(t.salesTotalMinor)],
  [tr(c,'Phí thanh toán','Payment fees'),money(t.feesMinor)],[tr(c,'Tiền nhận dư (chưa hoàn)','Overpayment held'),money(t.unappliedMinor)],[tr(c,'Hóa đơn đã đóng','Closed bills'),bills.closed],[tr(c,'Hóa đơn đang mở (chưa thu)','Open bills (not collected)'),`${bills.open} · ${money(bills.openTotalMinor)}`],[tr(c,'Hóa đơn đã hủy','Voided bills'),bills.voided]]));
 const pays=el('div',undefined,'screen-grid');
 for(const p of sales!.payments as JsonObject[]){const row=el('article',undefined,'record');row.append(el('strong',method(p.method)),dl([[tr(c,'Số giao dịch','Payments'),p.count],[tr(c,'Đã áp vào hóa đơn','Applied'),money(p.appliedMinor)],...(p.method==='cash'?[[tr(c,'Khách đưa','Tendered'),money(p.tenderedMinor)],[tr(c,'Tiền thối','Change'),money(p.changeMinor)]] as Row[]:[]),[tr(c,'Phí','Fees'),money(p.feeMinor)]]));pays.append(row);}
 for(const r of sales!.refunds as JsonObject[]){const row=el('article',undefined,'record');row.append(el('strong',tr(c,'Hoàn tiền · ','Refunds · ')+method(r.method)),dl([[tr(c,'Số lần','Count'),r.count],[tr(c,'Số tiền','Amount'),money(r.amountMinor)]]));pays.append(row);}
 if(!pays.children.length)pays.append(el('p',tr(c,'Chưa có thanh toán trong ngày.','No payments on this day.'),'muted'));
 sale.append(el('h3',tr(c,'Thanh toán theo phương thức (theo ngày phát sinh giao dịch)','Payments by method (by transaction day)')),pays,dl([[tr(c,'Tiền mặt thu vào hóa đơn','Cash applied'),money(cash.appliedMinor)],[tr(c,'Tiền thối','Change given'),money(cash.changeMinor)],[tr(c,'Hoàn tiền mặt','Cash refunded'),money(cash.refundedMinor)]]));
 const unresolved=sales!.unresolved as {payments:JsonObject[];unverifiedClaims:number};
 for(const p of unresolved.payments)sale.append(el('p',`${method(p.method)} · ${String(p.status)} · ${money(p.amountMinor)} · `+tr(c,'chưa rõ kết quả, không tính là đã thu','unresolved, not counted as collected'),'warning'));
 if(unresolved.unverifiedClaims)sale.append(el('p',tr(c,`${unresolved.unverifiedClaims} thông báo "đã chuyển khoản" của khách chưa xác minh (không phải tiền đã thu).`,`${unresolved.unverifiedClaims} customer transfer claim(s) unverified (not money received).`),'warning'));
 const diff=BigInt(rec.differenceMinor??'0');
 sale.append(el('h3',tr(c,'Đối soát sổ cái','Ledger reconciliation')),el('p',tr(c,'Theo hóa đơn đóng trong ngày; thanh toán và hoàn tiền được ghép theo hóa đơn dù phát sinh ngày nào.','By bills closed on this day; payments and refunds are joined by bill whatever day they happened.'),'muted'),dl([[tr(c,'Phải thu (tổng hóa đơn − trả hàng)','Expected (bills − returns)'),money(rec.expectedMinor)],[tr(c,'Đã thu (thanh toán − hoàn)','Collected (payments − refunds)'),money(rec.collectedMinor)],[tr(c,'Chênh lệch','Difference'),money(rec.differenceMinor)]]),
  el('p',diff===0n?tr(c,'Khớp sổ cái.','Matches the ledger.'):tr(c,'Chưa khớp: kiểm tra thanh toán chưa rõ, nhập phiếu cũ hoặc điều chỉnh trễ. Báo cáo không sửa sổ cái.','Does not match: check unresolved payments, imports or late adjustments. Reports never edit the ledger.'),diff===0n?'muted':'warning'));
 const units=sales!.units as JsonObject[];sale.append(el('h3',tr(c,'Số lượng món','Items sold')),units.length?dl(units.map(u=>[String(u.name),String(u.quantity)] as Row)):el('p',tr(c,'Chưa bán món nào.','No items sold.'),'muted'));
 const hist=sales!.historical as Record<string,string|number>;if(Number(hist.count))sale.append(el('p',tr(c,`Phiếu nhập lịch sử: ${hist.count} · ${money(hist.totalMinor)} (tính vào ngày gốc)`,`Imported historical receipts: ${hist.count} · ${money(hist.totalMinor)} (counted on their original day)`)));
 const late=sales!.lateAdjustments as JsonObject[];
 if(late.length){sale.append(el('h3',tr(c,'Điều chỉnh ghi nhận trễ','Late adjustments')));for(const l of late)sale.append(el('p',`${String(l.kind)} · ${money(l.amountMinor)} · ${tr(c,'phát sinh','effective')} ${when(l.effectiveAt)} (${String(l.businessDate)}) · ${tr(c,'ghi nhận','recorded')} ${when(l.appliedAt)}${l.reason?' · '+String(l.reason):''}`,'warning'));}
 sale.append(exportCsv(sales!));
 // Shifts
 const shiftBox=el('div',undefined,'screen-grid');
 for(const s of shifts!.shifts as JsonObject[]){
  const row=el('article',undefined,'record'),closed=s.status==='closed';
  row.append(el('strong',`${String(s.cashierId)} · ${String(s.id)}`),el('span',closed?(s.reconciled?tr(c,'Đã đóng · đã đối soát','Closed · reconciled'):tr(c,'Đã đóng · chênh lệch chưa duyệt','Closed · variance not approved')):tr(c,'Đang mở','Open'),'badge'),
   dl([[tr(c,'Mở ca','Opened'),when(s.openedAt)],[tr(c,'Đóng ca','Closed'),closed?when(s.closedAt):'—'],[tr(c,'Đầu ca','Opening'),money(s.openingMinor)],[tr(c,'Thu tiền mặt','Cash received'),money(s.receiptsMinor)],[tr(c,'Nộp thêm','Cash in'),money(s.cashInMinor)],[tr(c,'Chi ra','Cash out'),money(s.cashOutMinor)],[tr(c,'Hoàn tiền mặt','Cash refunds'),money(s.refundsMinor)],[tr(c,'Tiền thối','Change'),money(s.changeMinor)],
    [tr(c,'Tiền cần có','Expected cash'),money(s.expectedMinor)],[tr(c,'Đã đếm','Counted'),closed?money(s.countedMinor):'—'],[tr(c,'Chênh lệch','Variance'),closed?money(s.varianceMinor):'—']]));
  for(const m of s.methods as JsonObject[])row.append(el('p',`${method(m.method)} · ${tr(c,'thu','received')} ${String(m.payments)} · ${money(m.appliedMinor)} · ${tr(c,'hoàn','refunded')} ${String(m.refunds)} · ${money(m.refundsMinor)} · ${tr(c,'thuần','net')} ${money(m.netMinor)}${Number(m.late)?` · ${tr(c,'ghi nhận sau khi đóng ca','recorded after close')}: ${String(m.late)}`:''}`,Number(m.late)?'warning':undefined));
  for(const a of s.adjustments as JsonObject[])row.append(el('p',`${tr(c,'Điều chỉnh sau đóng ca','Adjustment after close')} · ${a.direction==='in'?'+':'−'}${money(a.amountMinor)} · ${String(a.reason)} · ${tr(c,'ghi nhận','recorded')} ${when(a.appliedAt)}`,'warning'));
  shiftBox.append(row);
 }
 if(!shiftBox.children.length)shiftBox.append(el('p',tr(c,'Không có ca nào mở trong ngày.','No shifts opened on this day.'),'muted'));
 for(const u of shifts!.unattributed as JsonObject[])shiftBox.append(el('p',`${tr(c,'Không thuộc ca nào','Not attributed to a shift')} · ${u.kind==='refund'?tr(c,'hoàn','refund'):tr(c,'thu','payment')} ${method(u.method)} · ${money(u.amountMinor)} · ${String(u.id)}`,'warning'));
 // Robots
 const k=robots!.totals as Record<string,string|number|null>,robotBox=el('div');
 robotBox.append(dl([[tr(c,'Nhiệm vụ','Missions'),k.missions],[tr(c,'Hoàn thành','Completed'),k.missionsCompleted],[tr(c,'Đã hủy','Cancelled'),k.missionsCancelled],[tr(c,'Cần xử lý','Needs attention'),k.missionsNeedingAttention],[tr(c,'Lệnh robot','Robot commands'),k.commands],[tr(c,'Lệnh lỗi / không rõ','Failed / unknown commands'),`${k.commandsFailed} / ${k.commandsUnknown}`],[tr(c,'Thời gian lệnh trung bình','Average command time'),k.avgCommandMs===null?'—':`${Math.round(Number(k.avgCommandMs)/1000)} s`]]));
 if(Number(k.invalidObservations))robotBox.append(el('p',tr(c,`${String(k.invalidObservations)} lệnh hoàn thành có thời điểm không hợp lệ (không tính vào thời gian trung bình).`,`${String(k.invalidObservations)} completed command(s) have invalid times (excluded from the average).`),'warning'));
 if(robots!.simulatedOnly)robotBox.append(el('p',tr(c,'Số liệu từ robot mô phỏng (simulated), không phải robot thật.','Figures come from a simulated robot, not a physical one.'),'muted'));
 page.append(sale,panel(tr(c,'Ca thu ngân','Cash shifts'),shiftBox,exportCsv(shifts!)),panel(tr(c,'Hiệu suất robot','Robot KPI'),robotBox,exportCsv(robots!)));
 return page;
}
