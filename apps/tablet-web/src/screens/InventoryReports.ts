import type {JsonObject} from '../../../../packages/contracts/src/index';
import {el,field,panel,tr,button,type ScreenContext} from '../ui';
import {buildReport,reportCsv,venueZone,isBusinessDate,type Watermark} from '../../../../packages/domain/src/reporting/report';
import {businessDateAt} from '../../../../packages/domain/src/shared/clock';
let chosen='';
/** Stock, food-cost and attendance reports computed on this tablet from its snapshots (works offline) with the same pure functions as the cloud route. */
export function InventoryReports(c:ScreenContext) {
 const {timeZone:tz}=venueZone(c.snapshots),asOf=new Date().toISOString();
 if(!isBusinessDate(chosen))chosen=businessDateAt(asOf,tz);
 const watermark:Watermark={source:'tablet',asOf,appliedAt:c.snapshots.length?asOf:null,pending:c.session.level==='unknown'?1:0,mode:c.session.mode};
 const page=el('div',undefined,'reports'),date=field(tr(c,'Ngày kinh doanh','Business date'),chosen,'date');
 page.append(panel(tr(c,'Báo cáo kho, giá vốn, chấm công','Stock, food-cost and attendance reports'),date.node,button(tr(c,'Xem báo cáo','Show report'),async()=>{if(!isBusinessDate(date.input.value)){c.notify(tr(c,'Ngày không hợp lệ','Invalid date'),true);return;}chosen=date.input.value;await c.refresh();})));
 for(const [kind,title] of [['stock',tr(c,'Kho','Stock')],['food-cost',tr(c,'Giá vốn','Food cost')],['attendance',tr(c,'Chấm công','Attendance')]] as const){
  const r=buildReport(kind,c.snapshots,{businessDate:chosen,watermark}),box=panel(title);
  box.append(el('p',String(r.basis??''),'muted'));
  if(r.status==='unsynced'){box.append(el('p',tr(c,'Chưa có dữ liệu đồng bộ. Không hiển thị số liệu (không phải bằng 0).','No synced data yet. No figures are shown (this is not zero).'),'offline-banner'));page.append(box);continue;}
  const t=r.totals as Record<string,unknown>;
  box.append(el('p',Object.entries(t).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([k,v])=>`${k}: ${String(v)}`).join(' · '),'total'));
  if(kind==='stock'&&Number((t as JsonObject).unbackedBalances)>0)box.append(el('p',tr(c,'Có số dư tồn không có phát sinh nào đứng sau (ví dụ tồn đầu kỳ): xem cột ledger.','Some balances have no movement behind them (e.g. an opening balance): see the ledger check.'),'warning'));
  if(kind==='food-cost'&&Number(t.missingCostLines)>0)box.append(el('p',tr(c,`${String(t.missingCostLines)} dòng chưa có giá vốn (tồn không đủ): chi phí đang thấp hơn thực tế.`,`${String(t.missingCostLines)} line(s) have no cost (stock was short): cost is understated.`),'warning'));
  if(kind==='food-cost'&&Number(t.estimatedLines)>0)box.append(el('p',tr(c,`${String(t.estimatedLines)} dòng điều chỉnh được ước tính theo giá bình quân.`,`${String(t.estimatedLines)} adjustment line(s) are estimated at the average cost.`),'muted'));
  const columns=r.columns as string[],rows=(r.rows as JsonObject[]).slice(0,100),table=el('table'),head=el('tr');
  for(const col of columns)head.append(el('th',col));table.append(head);
  for(const row of rows){const tr_=el('tr');for(const col of columns)tr_.append(el('td',row[col]===null||row[col]===undefined?'':String(row[col])));table.append(tr_);}
  const tableRegion=el('div',undefined,'mq-table');tableRegion.tabIndex=0;tableRegion.setAttribute('role','region');tableRegion.setAttribute('aria-label',title);tableRegion.append(table);
  box.append(tableRegion,button(tr(c,'Xuất CSV','Export CSV'),()=>{const a=el('a');a.href=URL.createObjectURL(new Blob(['﻿'+reportCsv(r)],{type:'text/csv;charset=utf-8'}));a.download=`${kind}-${chosen}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},'quiet'));
  page.append(box);
 }
 return page;
}
