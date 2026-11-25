// Diagnostics tab (R5.4): pick an axis (a native listbox: arrows and Enter), read its drive state, I/O and alarms. A normal state has no colour and no "healthy" mark; colour and an icon belong to alarms only.
import type {Alarm,Quality,TagValue} from '../reports/diagnostics';
import {tr} from '../i18n';
import {esc} from './icons';

const qualityText=(q:Quality)=>q.kind==='good'?tr('có dữ liệu','データあり','data'):q.kind==='stale'?tr(`cũ ${q.ageTicks} tick`,`古い ${q.ageTicks} tick`,`stale ${q.ageTicks} ticks`):tr('không có dữ liệu','データなし','no data')+` (${esc(q.reason)})`;
const valueText=(t:TagValue)=>t.value===null?'—':esc(String(typeof t.value==='number'?+t.value.toFixed(4):t.value))+(t.unit?` ${esc(t.unit)}`:'');
export interface DiagnosticsInput{targets:{id:string;label:string}[];selected:string|null;device:{id:string;label:string}|null;tags:TagValue[];alarms:Alarm[]}
export function diagnosticsPanel(i:DiagnosticsInput):string{
 const list=`<label for="twin-diag-target">${tr('Chọn trục','軸を選択','Select an axis')}</label><select id="twin-diag-target" data-testid="diag-targets" size="${Math.min(8,Math.max(2,i.targets.length))}" aria-label="${tr('Trục và khớp','軸と関節','Axes and joints')}">${i.targets.map(t=>`<option value="${esc(t.id)}"${t.id===i.selected?' selected':''}>${esc(t.label)}${i.alarms.some(a=>a.targetId===t.id)?' ⚠':''}</option>`).join('')}</select>`;
 if(!i.selected)return `<section class="panel diag-panel" data-testid="diagnostics" aria-labelledby="diag-title"><h3 id="diag-title">${tr('Chẩn đoán','診断','Diagnostics')}</h3>${list}<p class="empty-inline">${tr('Chọn một trục để xem.','軸を選ぶと表示されます。','Select an axis to see it.')}</p></section>`;
 const rows=i.tags.map(t=>`<tr data-tag="${esc(t.tag)}" data-quality="${t.quality.kind}"><td>${esc(t.tag)}</td><td>${valueText(t)}</td><td>${qualityText(t.quality)}</td><td>${t.tick===null?'—':t.tick}</td></tr>`).join('');
 const alarms=i.alarms.length?`<ul data-testid="diag-alarms">${i.alarms.map(a=>`<li class="diag-alarm" data-alarm="${esc(a.id)}"><span aria-hidden="true">⚠</span> <b>${esc(a.code)}</b> · tick ${a.tick} · ${esc(a.verdict)} <button class="button quiet" data-action="twin-fault-jump" data-value="${a.tick}">${tr('Nhảy tới tick','tickへ移動','Jump to tick')}</button></li>`).join('')}</ul>`:`<p class="empty-inline" data-testid="diag-no-alarms">${tr('Không có cảnh báo trong báo cáo này.','このレポートにアラームはありません。','No alarms in this report.')}</p>`;
 return `<section class="panel diag-panel" data-testid="diagnostics" aria-labelledby="diag-title"><h3 id="diag-title">${tr('Chẩn đoán','診断','Diagnostics')}: ${esc(i.targets.find(t=>t.id===i.selected)?.label??i.selected)}</h3>${list}
${i.device?`<p data-testid="diag-device">${tr('Thiết bị điều khiển trục','軸を駆動する機器','Device driving the axis')}: <b>${esc(i.device.label)}</b> <small>${esc(i.device.id)}</small></p>`:''}
<table data-testid="diag-tags"><thead><tr><th>${tr('Tag','タグ','Tag')}</th><th>${tr('Giá trị','値','Value')}</th><th>${tr('Chất lượng','品質','Quality')}</th><th>tick</th></tr></thead><tbody>${rows}</tbody></table>
<h4>${tr('Cảnh báo','アラーム','Alarms')}</h4>${alarms}</section>`;
}
