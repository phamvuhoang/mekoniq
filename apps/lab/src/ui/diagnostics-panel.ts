// Diagnostics tab (R5.4): pick an axis (a native listbox: arrows and Enter), read its drive state, I/O and alarms. A normal state has no colour and no "healthy" mark; colour and an icon belong to alarms only.
import type {Alarm,Quality,TagValue,stopOf} from '../reports/diagnostics';
import {stopRow} from '../reports/stop';
import {tr} from '../i18n';
import {esc} from './icons';

const qualityText=(q:Quality)=>q.kind==='good'?tr('có dữ liệu','データあり','data'):q.kind==='stale'?tr(`cũ ${q.ageTicks} tick`,`古い ${q.ageTicks} tick`,`stale ${q.ageTicks} ticks`):tr('không có dữ liệu','データなし','no data')+` (${esc(q.reason)})`;
const valueText=(t:TagValue)=>t.value===null?'—':esc(String(typeof t.value==='number'?+t.value.toFixed(4):t.value))+(t.unit?` ${esc(t.unit)}`:'');
export interface DiagnosticsInput{targets:{id:string;label:string}[];selected:string|null;device:{id:string;label:string}|null;tags:TagValue[];alarms:Alarm[];/** the run's stop (stopOf); absent: not shown */stop?:ReturnType<typeof stopOf>;/** the electrical design the device is read from (bound to the run's engineering project), or null with no compiled design for it */design?:{id:string;label:string}|null}
const stopSection=(s:ReturnType<typeof stopOf>|undefined)=>{
 if(!s||s.kind==='none')return '';
 if(s.kind==='unavailable')return `<h4>${tr('Dừng','停止','Stop')}</h4><p data-testid="diag-stop" data-quality="unavailable">${tr(`Run có ${s.requested} yêu cầu dừng nhưng báo cáo không có báo cáo dừng: không có dữ liệu`,`停止要求 ${s.requested} 件の実行ですが、レポートに停止レポートがありません: データなし`,`The run asked for ${s.requested} stop(s) but its report carries no stop report: no data`)} (${s.reason})</p>`;
 const r=stopRow(s.report);
 return `<h4>${tr('Dừng','停止','Stop')}</h4><p data-testid="diag-stop" data-quality="good"><b>${esc(r.function)}</b> · ${esc(r.verdict)} · tick ${r.appliedTick??'—'} · ${tr('quãng dừng','停止距離','distance')} ${r.distanceM===null?`${tr('không có dữ liệu','データなし','no data')}${r.why?` (${esc(r.why)})`:''}`:`${r.distanceM} m`}${r.violated.length?` · <span aria-hidden="true">⚠</span> ${r.violated.map(esc).join(', ')}`:''} <small>not_calibrated</small></p>`;
};
export function diagnosticsPanel(i:DiagnosticsInput):string{
 const list=`<label for="twin-diag-target">${tr('Chọn trục','軸を選択','Select an axis')}</label><select id="twin-diag-target" data-testid="diag-targets" size="${Math.min(8,Math.max(2,i.targets.length))}" aria-label="${tr('Trục và khớp','軸と関節','Axes and joints')}">${i.targets.map(t=>`<option value="${esc(t.id)}"${t.id===i.selected?' selected':''}>${esc(t.label)}${i.alarms.some(a=>a.targetId===t.id)?' ⚠':''}</option>`).join('')}</select>`;
 if(!i.selected)return `<section class="panel diag-panel" data-testid="diagnostics" aria-labelledby="diag-title"><h3 id="diag-title">${tr('Chẩn đoán','診断','Diagnostics')}</h3>${list}<p class="empty-inline">${tr('Chọn một trục để xem.','軸を選ぶと表示されます。','Select an axis to see it.')}</p></section>`;
 const rows=i.tags.map(t=>`<tr data-tag="${esc(t.tag)}" data-quality="${t.quality.kind}"><td>${esc(t.tag)}</td><td>${valueText(t)}</td><td>${qualityText(t.quality)}</td><td>${t.tick===null?'—':t.tick}</td></tr>`).join('');
 const alarms=i.alarms.length?`<ul data-testid="diag-alarms">${i.alarms.map(a=>`<li class="diag-alarm" data-alarm="${esc(a.id)}"><span aria-hidden="true">⚠</span> <b>${esc(a.code)}</b> · tick ${a.tick} · ${esc(a.verdict)} <button class="button quiet" data-action="twin-fault-jump" data-value="${a.tick}">${tr('Nhảy tới tick','tickへ移動','Jump to tick')}</button></li>`).join('')}</ul>`:`<p class="empty-inline" data-testid="diag-no-alarms">${tr('Không có cảnh báo trong báo cáo này.','このレポートにアラームはありません。','No alarms in this report.')}</p>`;
 return `<section class="panel diag-panel" data-testid="diagnostics" aria-labelledby="diag-title"><h3 id="diag-title">${tr('Chẩn đoán','診断','Diagnostics')}: ${esc(i.targets.find(t=>t.id===i.selected)?.label??i.selected)}</h3>${list}
${i.device?`<p data-testid="diag-device">${tr('Thiết bị điều khiển trục','軸を駆動する機器','Device driving the axis')}: <b>${esc(i.device.label)}</b> <small>${esc(i.device.id)}</small>${i.design?` · <small data-testid="diag-design">${esc(i.design.label)} (${esc(i.design.id)})</small>`:''}</p>`:i.design===null?`<p data-testid="diag-device" data-quality="unavailable">${tr('Thiết bị điều khiển trục: không có dữ liệu (chưa compile phần Điện cho dự án của run này)','軸を駆動する機器: データなし(この実行のプロジェクトの電気が未コンパイル)','Device driving the axis: no data (no electrical design compiled for this run\'s project)')}</p>`:''}
<table data-testid="diag-tags"><thead><tr><th>${tr('Tag','タグ','Tag')}</th><th>${tr('Giá trị','値','Value')}</th><th>${tr('Chất lượng','品質','Quality')}</th><th>tick</th></tr></thead><tbody>${rows}</tbody></table>
<h4>${tr('Cảnh báo','アラーム','Alarms')}</h4>${alarms}${stopSection(i.stop)}</section>`;
}
