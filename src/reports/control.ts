// The drive section of a report (R4): what a virtual drive did, from the report's `driveEvidence`. Read-only; a report without it says why, never a zero.
import type {ControlMetric,DriveEvidenceBlock,RunReport} from '../scenarios/controls';
import type {Row} from '../twin/amr';
import {tr} from '../i18n';
import {esc} from '../ui/icons';

export type DriveSection={available:false;reason:string}|{available:true;complete:boolean;issues:string[];axes:{axisId:string;states:string[];trackingRms:ControlMetric}[];events:DriveEvidenceBlock['events']};
const isBlock=(b:unknown):b is DriveEvidenceBlock=>!!b&&typeof b==='object'&&Array.isArray((b as DriveEvidenceBlock).axes)&&Array.isArray((b as DriveEvidenceBlock).events)&&Array.isArray((b as DriveEvidenceBlock).issues)&&(b as DriveEvidenceBlock).testLevel==='controller_in_the_loop'&&(b as DriveEvidenceBlock).axes.every(a=>!!a&&Array.isArray(a.states)&&Array.isArray(a.faults)&&!!a.trackingRms);
/** `report` is whatever was imported: anything without a well-formed drive block is NO_DRIVE_DATA (an R2b report, a malformed one, null). */
export function driveSection(report:unknown):DriveSection{
 const b=report&&typeof report==='object'?(report as {driveEvidence?:unknown}).driveEvidence:undefined;
 if(!isBlock(b))return {available:false,reason:'NO_DRIVE_DATA'};
 return {available:true,complete:b.complete,issues:[...b.issues],events:b.events.map(e=>({...e})),axes:b.axes.map(a=>({axisId:a.axisId,states:a.states.map(s=>s.state),trackingRms:a.trackingRms}))};
}
const stateText=(s:string)=>({disabled:tr('tắt','無効','disabled'),ready:tr('sẵn sàng','準備','ready'),enabled:tr('bật','有効','enabled'),quick_stop:tr('dừng nhanh','クイックストップ','quick stop'),fault:tr('lỗi','故障','fault')} as Record<string,string>)[s]??s;
const metricText=(m:ControlMetric)=>m.available?`${m.value.toPrecision(3)} ${m.unit}`:`${tr('Không khả dụng','利用不可','Unavailable')} (${m.reason})`;
/** The state of one axis at `tick` from the recorded transitions (the last whose tick is not after it); null before the first record. */
export function stateAt(block:DriveEvidenceBlock,axisId:string,tick:number):{state:string;fault:string|null}|null{
 const a=block.axes.find(x=>x.axisId===axisId);if(!a)return null;
 const s=[...a.states].reverse().find(x=>x.fromTick<=tick);if(!s)return null;
 // the fault shown is the one the axis is in at the cursor: not one it has since left (a reset)
 const f=s.state==='fault'?a.faults.filter(x=>x.firstTick<=tick).at(-1):undefined;return {state:s.state,fault:f?.fault??null};
}
/** Rows for the inspector of an entity: one per axis whose id starts with `${entityId}/` — its drive state at the cursor and its tracking error. */
export function driveRows(report:RunReport|null,entityId:string,tick:number):Row[]{
 const b=report?.driveEvidence;if(!isBlock(b))return [];
 return b.axes.filter(a=>a.axisId.startsWith(entityId+'/')).map(a=>{const st=stateAt(b,a.axisId,tick);
  return {key:`drive-${a.axisId}`,label:`${tr('Drive','ドライブ','Drive')} ${a.axisId.split('/')[1]}`,observed:st?`${stateText(st.state)}${st.fault?` · ${st.fault}`:''}`:tr('chưa ghi','未記録','not recorded'),commanded:a.trackingRms.available?`RMS ${a.trackingRms.value.toPrecision(3)}`:'—',unit:a.trackingRms.unit,source:'modeled' as const,ageMs:null};});
}
/** The panel block: per axis the states it passed through and its tracking RMS (with the reason when the metric could not be computed), then the controller's events. */
export function driveHtml(report:RunReport):string{
 const s=driveSection(report);
 if(!s.available)return `<div data-testid="drive-evidence" data-available="false"><h3>${tr('Drive ảo','仮想ドライブ','Virtual drive')}</h3><p class="field-help" data-testid="drive-reason">${tr('Không có dữ liệu drive','ドライブデータなし','No drive data')} (${esc(s.reason)})</p></div>`;
 const m=(report.manifest as {drive?:{experimentId?:string}}).drive;
 return `<div data-testid="drive-evidence" data-available="true" data-complete="${esc(s.complete)}"><h3>${tr('Drive ảo','仮想ドライブ','Virtual drive')}${m?.experimentId?` · <code>${esc(m.experimentId)}</code>`:''}</h3>
<p class="field-help">${s.complete?tr('đầy đủ','完全','complete'):tr('chưa đầy đủ','不完全','incomplete')}${s.issues.length?`: ${esc(s.issues.join(', '))}`:''} · controller_in_the_loop · ${tr('chưa hiệu chuẩn','未校正','not calibrated')}</p>
<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${tr('Trạng thái và sai số bám theo trục','軸ごとの状態と追従誤差','Axis state and tracking error')}"><table class="eng-table" data-testid="drive-axes"><thead><tr><th scope="col">${tr('Trục','軸','Axis')}</th><th scope="col">${tr('Trạng thái đã qua','経過した状態','States passed')}</th><th scope="col">${tr('RMS sai số bám','追従誤差RMS','Tracking RMS')}</th></tr></thead><tbody>${s.axes.map(a=>`<tr data-axis="${esc(a.axisId)}"><th scope="row">${esc(a.axisId)}</th><td>${esc(a.states.map(stateText).join(' → '))}</td><td data-metric="${a.trackingRms.available?'available':'unavailable'}">${esc(metricText(a.trackingRms))}</td></tr>`).join('')}</tbody></table></div>
${s.events.length?`<ul data-testid="drive-events">${s.events.map(e=>`<li>tick ${esc(e.tick)} · <code>${esc(e.code)}</code>${e.axisId?` · ${esc(e.axisId)}`:''}</li>`).join('')}</ul>`:''}
<p class="source-note">${tr('Tham số drive là giả định; phép đo từ trạng thái thật của mô phỏng, không phải phần cứng.','ドライブのパラメータは仮定です。測定はシミュレーションの真値で、実機ではありません。','Drive parameters are assumed; measured on the simulation\'s true state, not on hardware.')}</p></div>`;
}
