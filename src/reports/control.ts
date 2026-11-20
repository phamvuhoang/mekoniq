// The drive section of a report (R4): what a virtual drive did, from the report's `driveEvidence`, and a bench's TuningResultV1 (R4.2). Read-only; a report without them says why, never a zero.
import type {ControlMetric,DriveEvidenceBlock,RunReport} from '../scenarios/controls';
import type {Row} from '../twin/amr';
import type {TuningResultV1} from '../shared/navigation2d';
import {comparable} from '../control/workbench';
import {sig} from '../ui/svg-plot';
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

// ---- R4.2 bench (V07): a TuningResultV1 in words. The run status of a finished bench is always completed; the result is tuning.status. ----
const METRICS=['riseTimeS','overshootPct','settlingTimeS','steadyStateError','rmsError','peakTorqueNm','saturationRatio'] as const;
const metricName=(k:string,t:TuningResultV1)=>({riseTimeS:tr('Thời gian lên 10–90 %','立ち上がり時間 10–90 %','Rise time 10–90 %'),overshootPct:tr('Vọt lố','オーバーシュート','Overshoot'),
 settlingTimeS:tr(`Thời gian xác lập (±${t.policy.settleBand*100} %)`,`整定時間(±${t.policy.settleBand*100} %)`,`Settling time (±${t.policy.settleBand*100} %)`),steadyStateError:tr('Sai số xác lập','定常偏差','Steady-state error'),
 rmsError:tr('RMS sai số bám','追従誤差RMS','Tracking error RMS'),peakTorqueNm:tr('Mô-men đỉnh','ピークトルク','Peak torque'),saturationRatio:tr('Tỷ lệ substep bão hòa','飽和サブステップ率','Saturated substeps')} as Record<string,string>)[k]??k;
/** Why a metric (or a run) has no value, in words; an unknown code is shown as itself. */
export const reasonWords=(code:string)=>({NOT_SETTLED:tr('chưa ổn định trong cửa sổ đo','測定窓内で整定せず','did not settle within the window'),TARGET_NOT_REACHED:tr('chưa đạt 90 % mục tiêu','目標の90 %に未達','never reached 90 % of the target'),
 TRACE_GAP:tr('trace có khoảng trống trong cửa sổ','窓内でトレースが欠落','the trace has a gap in the window'),AMPLITUDE_ZERO:tr('biên độ bằng 0','振幅がゼロ','zero amplitude'),WINDOW_INVALID:tr('cửa sổ đo nằm ngoài trace','測定窓がトレースの外','the window lies outside the trace'),
 SIGNAL_NOT_STEP:tr('chỉ đo với tín hiệu bước','ステップ信号でのみ測定','measured on a step only'),SIGNAL_NOT_STARTED:tr('tín hiệu chưa bắt đầu (drive chưa bật)','信号が開始せず(ドライブ未有効)','the signal never started (drive not enabled)'),SIGNAL_TRUNCATED:tr('tín hiệu bị cắt ở cuối bench','ベンチ終端で信号が切れた','the signal was cut at the end of the bench'),
 SATURATION_NOT_TRACED:tr('trace không ghi bão hòa','飽和が記録されていない','saturation was not traced'),POLICY_INVALID:tr('chính sách metric không hợp lệ','メトリック方針が無効','invalid metric policy'),DRIVE_FAULT:tr('drive đã báo lỗi','ドライブが故障を報告','the drive faulted'),
 PLANT_UNSTABLE:tr('mô phỏng bất ổn','シミュレーションが不安定','the simulation went unstable'),COLLISION:tr('có va chạm','衝突が発生','a collision occurred')} as Record<string,string>)[code]??code;
const faultWords=(code:string)=>({OVERSPEED:tr('đáp ứng vượt giới hạn tốc độ của drive và drive tự ngắt để bảo vệ. Đây là vật lý của model với các gain này, không phải lỗi phần mềm.','応答がドライブの速度上限を超え、ドライブが保護のため停止しました。これはこのゲインでのモデルの物理挙動であり、ソフトウェアの不具合ではありません。','the response exceeded the drive’s speed limit and the drive tripped to protect itself. That is the model’s physics with these gains, not a software bug.'),
 FOLLOWING_ERROR:tr('sai lệch bám vượt giới hạn của drive','追従偏差がドライブの上限を超えた','the following error exceeded the drive’s limit'),COMMAND_TIMEOUT:tr('drive không nhận được lệnh mới kịp (watchdog)','指令が間に合わなかった(ウォッチドッグ)','no new command in time (watchdog)'),
 FEEDBACK_LOSS:tr('mất phản hồi encoder','エンコーダ帰還が失われた','the encoder feedback was lost'),EXTERNAL_TRIP:tr('ngắt từ bên ngoài','外部トリップ','an external trip')} as Record<string,string>)[code]??tr('drive báo lỗi','ドライブが故障を報告','the drive latched a fault');
/** The result and its cause in words (R4-A §6.1: an over-gained bench is a result with its tick and cause, never an incident; no gain is lowered). */
export function tuningStatus(t:TuningResultV1):string{
 if(t.status==='drive_fault'&&t.fault)return `${tr('Lỗi drive','ドライブ故障','Drive fault')} · tick ${t.fault.tick} · ${t.fault.axisId} · ${t.fault.code}: ${faultWords(t.fault.code)}`;
 if(t.status==='unstable'&&t.unstable)return `${tr('Bất ổn','不安定','Unstable')} · tick ${t.unstable.tick}: ${tr('engine báo','エンジンの報告','the engine reported')} “${t.unstable.warning}”. ${tr('Đây là kết quả của gain này, không phải sự cố; không tự hạ gain.','このゲインの結果であり障害ではありません。ゲインは自動で下げません。','This is the result of these gains, not an incident; no gain is lowered for you.')}`;
 if(t.status==='collision'&&t.collision)return `${tr('Va chạm','衝突','Collision')} · tick ${t.collision.tick}: ${t.collision.ids.join(', ')}`;
 return tr('Hoàn tất','完了','Completed');
}
const value=(m:ControlMetric|undefined)=>!m?'—':m.available?m.unit==='ratio'?`${sig(m.value*100)} %`:`${sig(m.value)} ${m.unit}`:`${tr('Không khả dụng','利用不可','Unavailable')}: ${reasonWords(m.reason)} (${m.reason})`;
const delta=(a:ControlMetric|undefined,b:ControlMetric|undefined)=>{if(!a?.available||!b?.available)return '—';const d=b.unit==='ratio'?(b.value-a.value)*100:b.value-a.value;return `${d>0?'+':d<0?'−':''}${sig(Math.abs(d))} ${b.unit==='ratio'?'%':b.unit}`;};
const shortName=(k:string)=>({riseTimeS:tr('Lên','立ち上がり','Rise'),overshootPct:tr('Vọt lố','オーバーシュート','Overshoot'),settlingTimeS:tr('Xác lập','整定','Settling'),steadyStateError:tr('Sai số xác lập','定常偏差','Steady-state error'),rmsError:'RMS',peakTorqueNm:tr('Mô-men đỉnh','ピークトルク','Peak torque'),saturationRatio:tr('Bão hòa','飽和','Saturated')} as Record<string,string>)[k]??k;
const changedName=(k:string)=>({plantModelDigest:tr('digest plant','プラントのダイジェスト','plant digest'),driveModelDigest:tr('digest model drive','ドライブモデルのダイジェスト','drive model digest'),load:tr('tải','負荷','load'),axis:tr('trục','軸','axis'),signal:tr('tín hiệu','信号','signal'),seed:'seed',engine:'engine'} as Record<string,string>)[k]??k;
/** The bench result in the order of the §6.3 sketch: status, `plots` (the panel's), a one-line metric summary (an unavailable metric is "—"), then the full table
 *  with each reason and, given the previous result `a`, the A/B: B − A per metric when the two are comparable, otherwise the inputs that changed and no delta. */
export function tuningHtml(t:TuningResultV1,a?:TuningResultV1|null,plots=''):string{
 const c=a?comparable(a,t):null,ab=!!c?.ok,run=(r:TuningResultV1)=>esc(r.runId.slice(0,8));
 const rows=METRICS.filter(k=>k in t.metrics).map(k=>`<tr data-metric="${k}"><th scope="row">${esc(metricName(k,t))}</th>${ab?`<td>${esc(value(a!.metrics[k]))}</td>`:''}<td data-available="${esc(t.metrics[k]!.available)}">${esc(value(t.metrics[k]))}</td>${ab?`<td>${esc(delta(a!.metrics[k],t.metrics[k]))}</td>`:''}</tr>`).join('');
 const j=t.effectiveInertia;
 return `<div class="control-result" data-testid="tuning-result" data-status="${esc(t.status)}"><p class="control-status" data-status="${esc(t.status)}" role="status"><b>${esc(tuningStatus(t))}</b></p>${plots}
<p class="control-summary" data-testid="tuning-summary">${METRICS.filter(k=>k in t.metrics).map(k=>{const m=t.metrics[k]!;return `<span><small>${esc(shortName(k))}</small> ${esc(m.available?value(m):'—')}</span>`;}).join(' · ')}</p>
${c&&!c.ok?`<p class="field-help" data-testid="ab-changed">${tr('Không so với lần trước: đầu vào đã đổi','前回とは比較しません:入力が変わりました','Not compared with the previous run: its inputs changed')} (${esc(c.changed.map(changedName).join(', '))}).</p>`:''}
<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${tr('Metric đáp ứng','応答メトリック','Response metrics')}"><table class="eng-table" data-testid="${ab?'ab-delta':'tuning-metrics'}"><thead><tr><th scope="col">${tr('Metric','メトリック','Metric')}</th>${ab?`<th scope="col">A · ${run(a!)}</th>`:''}<th scope="col">${ab?`B · ${run(t)}`:tr('Giá trị','値','Value')}</th>${ab?`<th scope="col">Δ B − A</th>`:''}</tr></thead><tbody>${rows}</tbody></table></div>
<p class="source-note">${j?`J = ${sig(j.valueKgM2)} kg m² (${esc(j.basis)}, ${tr('giả định','仮定','assumed')}) · `:''}${esc(t.engine.id)} ${esc(t.engine.version)}${t.engine.hostArch?` · ${esc(t.engine.hostArch)}`:''} · seed ${esc(t.seed)} · ${tr('tải','負荷','load')} ${esc(t.plant.load)} · trace ${esc(t.trace.sha256.slice(0,12))} · ${esc(t.trace.samples)} ${tr('mẫu','サンプル','samples')} · ${tr('chưa hiệu chuẩn','未校正','not calibrated')}</p></div>`;
}
