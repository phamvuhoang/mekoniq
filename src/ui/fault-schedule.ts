import {tr} from '../i18n';
import {esc} from './icons';
import {scheduledFaults,nativeScheduledFaults,type FaultScheduleEntry} from '../scenarios/fault-schedule';
import type {LabProjectV2} from '../shared/types';
export interface ScheduleDraft {faultId:string;targetId:string;trigger:'elapsed_sim_ms'|'phase';value:string;durationMs:string}
export function faultScheduleEditor(project:LabProjectV2,draft:ScheduleDraft,disabled:boolean,mode:'mock'|'simulation'='mock',open=false):string{
 const catalog=mode==='simulation'?nativeScheduledFaults:scheduledFaults;
 const off=disabled?'disabled':'',f=catalog.find(f=>f.id===draft.faultId),targets=project.entities.filter(t=>t.kind===f?.kind);
 const choices=catalog.filter(f=>project.entities.some(e=>e.kind===f.kind));
 return `<details id="twin-fault-schedule" class="panel" data-testid="fault-schedule" ${open?'open':''}><summary>${tr('Lịch lỗi cho lần chạy mới','新しい実行の障害予定','Fault schedule for new run')}</summary><p>${tr('Thời lượng là cửa sổ chèn lỗi; hết hạn không tự sửa cốc hoặc xóa interlock. Native chưa hỗ trợ sẽ bị từ chối.','期間終了でカップやインターロックは復旧しません。未対応のネイティブ障害は拒否されます。','Duration is the injection window; expiry does not repair custody or clear interlocks. Unsupported native faults are rejected.')}</p>
 <label>${tr('Lỗi','障害','Fault')}<select id="twin-schedule-fault" ${off}>${choices.map(f=>`<option value="${f.id}" ${f.id===draft.faultId?'selected':''}>${f.id}</option>`).join('')}</select></label>
 <label>${tr('Đối tượng','対象','Target')}<select id="twin-schedule-target" ${off}>${targets.map(t=>`<option value="${esc(t.id)}" ${t.id===draft.targetId?'selected':''}>${esc(t.id)}</option>`).join('')}</select></label>
 <label>${tr('Kích hoạt','トリガー','Trigger')}<select id="twin-schedule-trigger" ${off}><option value="elapsed_sim_ms" ${draft.trigger==='elapsed_sim_ms'?'selected':''}>${tr('Thời gian mô phỏng (ms)','模擬時間(ms)','Simulation time (ms)')}</option><option value="phase" ${draft.trigger==='phase'?'selected':''}>${tr('Giai đoạn','フェーズ','Phase')}</option></select></label>
 ${draft.trigger==='phase'?`<select id="twin-schedule-value" aria-label="${tr('Giai đoạn','フェーズ','Phase')}" ${off}>${['brew','grasp','handoff','delivery'].map(p=>`<option ${p===draft.value?'selected':''}>${p}</option>`).join('')}</select>`:`<input id="twin-schedule-value" aria-label="${tr('Thời gian mô phỏng (ms)','模擬時間(ms)','Simulation time (ms)')}" type="number" min="0" max="3600000" value="${esc(draft.value)}" ${off}>`}
 <label>${tr('Thời lượng (ms)','期間(ms)','Duration (ms)')}<input id="twin-schedule-duration" type="number" min="1" max="60000" value="${esc(draft.durationMs)}" ${off}></label>
 <button data-action="twin-schedule-add" class="button quiet" ${off}>${tr('Thêm lỗi','追加','Add fault')}</button><button data-action="twin-schedule-save" class="button quiet" ${off}>${tr('Lưu project','プロジェクト保存','Save project')}</button><button data-action="twin-schedule-load" class="button quiet" ${off}>${tr('Mở project đã lưu','保存済みを開く','Load saved project')}</button><button data-action="twin-project-export" class="button quiet" ${off}>${tr('Xuất project','エクスポート','Export project')}</button>
 <label>${tr('Nhập project JSON','プロジェクトJSONを読む','Import project JSON')}<input id="twin-project-import" type="file" accept="application/json,.json" ${off}></label>
 <ol>${(project.faultSchedule??[]).map(e=>`<li>${esc(e.faultId)} · ${esc(e.targetId)} · ${esc(e.trigger.kind)}: ${esc(String(e.trigger.value))} · ${esc(e.durationMs)}ms <button data-action="twin-schedule-remove" data-value="${esc(e.id)}" ${off}>${tr('Xóa','削除','Remove')}</button></li>`).join('')}</ol></details>`;
}
export function draftEntry(draft:ScheduleDraft,project:LabProjectV2,mode:'mock'|'simulation'='mock'):FaultScheduleEntry{
 const kind=(mode==='simulation'?nativeScheduledFaults:scheduledFaults).find(f=>f.id===draft.faultId)?.kind,targetId=draft.targetId||project.entities.find(e=>e.kind===kind)?.id||'';
 return {id:crypto.randomUUID(),faultId:draft.faultId,targetId,trigger:draft.trigger==='phase'?{kind:'phase',value:draft.value as 'brew'}:{kind:'elapsed_sim_ms',value:Number(draft.value)},durationMs:Number(draft.durationMs)};
}

// ---- R4 V09: the drive fault studio ---------------------------------------------------------------------------------------------------------------------------------
import {DRIVE_FAULT_LAYERS,faultTargets,type DriveFaultDraft,type DriveFaultEntry,type DriveFaultContext,type FaultCatalog} from '../scenarios/drive-faults';
import {faultTimeline,layerName} from './fault-timeline';
import {DRIVE_EXPERIMENT_IDS,driveExperimentLabel} from '../twin/payload';
export interface DriveStudioState {open:boolean;catalog:FaultCatalog;ctx:DriveFaultContext;draft:DriveFaultDraft;entries:readonly DriveFaultEntry[];experiment:string|undefined;disabled:boolean;
 check:{state:'idle'|'checking'|'ok'|'refused';codes:string[];error?:string};message:string|null;/** no drive experiment chosen: nothing can be checked or run */blocked?:boolean}
/** The runtime's reason codes in words; an unknown code is shown as itself. */
export const faultCodeWords=(code:string)=>({FAULT_OVERLAP:tr('hai mục cùng loại chồng thời gian trên cùng đối tượng','同じ種類の2件が同じ対象で時間的に重なる','two entries of one kind overlap in time on one target'),
 FAULT_PARAM_INVALID:tr('tham số ngoài biên hoặc thiếu','パラメータが範囲外または不足','a parameter is out of bounds or missing'),FAULT_TARGET_INVALID:tr('đối tượng không đúng loại hoặc không có','対象の種類が違う、または存在しない','the target is of the wrong kind or does not exist'),
 FAULT_UNKNOWN:tr('loại lỗi runtime không có','ランタイムにない障害','a fault the runtime does not have'),FAULT_CAMPAIGN_ONLY:tr('chỉ dùng trong campaign','キャンペーン専用','campaign only'),FAULT_SCHEDULE_TOO_LONG:tr('quá 16 mục','16件を超える','more than 16 entries'),
 FAULT_SCHEDULE_INVALID:tr('lịch không hợp lệ (id trùng, quá 16 mục hoặc sai dạng)','予定が不正(ID重複、16件超過、形式)','invalid schedule (duplicate id, more than 16, or shape)'),FAULT_TRIGGER_INVALID:tr('thời điểm kích hoạt không hợp lệ','トリガー時刻が不正','invalid trigger time'),
 FAULT_BACKEND_UNSUPPORTED:tr('lần chạy này không có drive: chọn một thí nghiệm drive','この実行にはドライブがありません。ドライブ実験を選んでください','this run has no drive: pick a drive experiment'),
 INVALID_FAULT_SCHEDULE:tr('lịch bị từ chối','予定が拒否されました','the schedule was refused')} as Record<string,string>)[code]??code;
const paramLabel=(k:string)=>({durationMs:tr('Thời lượng (ms)','継続(ms)','Duration (ms)'),torqueScale:tr('Tỷ lệ mô-men','トルク比','Torque scale'),delayMs:tr('Trễ thêm (ms)','追加遅延(ms)','Extra delay (ms)'),sigmaM:tr('Nhiễu σ (m)','ノイズσ(m)','Noise σ (m)'),dropoutFraction:tr('Tỷ lệ mất tia','欠測率','Dropout fraction')} as Record<string,string>)[k]??k;
export function driveFaultStudio(s:DriveStudioState):string{
 const off=s.disabled?'disabled':'',item=s.catalog.find(f=>f.id===s.draft.faultId),offered=s.catalog.filter(f=>faultTargets(f,s.ctx).length),targets=item?faultTargets(item,s.ctx):[];
 const horizon=Math.max(20000,Math.ceil(Math.max(0,...s.entries.map(e=>e.trigger.value+e.durationMs))*1.15/5000)*5000);
 const experiment=`<label>${tr('Thí nghiệm drive','ドライブ実験','Drive experiment')}<select id="twin-drive-experiment" data-testid="drive-experiment" ${off}>${s.experiment?'':`<option value="" selected>${tr('— chọn —','— 選択 —','— choose —')}</option>`}${DRIVE_EXPERIMENT_IDS.map(id=>`<option value="${id}" ${id===s.experiment?'selected':''}>${esc(id)} · ${esc(driveExperimentLabel(id))}</option>`).join('')}</select></label>`;
 const params=item?Object.entries(item.params).map(([k,b])=>`<label>${esc(paramLabel(k))}<input id="twin-df-p-${esc(k)}" data-param="${esc(k)}" type="number" min="${b.min}" max="${b.max}" step="${b.multipleOf??'any'}" value="${esc(s.draft.params[k]??'')}" ${b.required?'required':''} ${off}></label>`).join(''):'';
 const check=s.check.state==='ok'?`<p role="status" class="state-text" data-testid="drive-fault-check" data-state="ok">${tr('Runtime chấp nhận lịch này. Chưa tạo run.','ランタイムはこの予定を受理しました。実行はまだ作成されていません。','The runtime accepts this schedule. No run was created.')}</p>`
  :s.check.state==='refused'?`<div role="alert" class="field-error" data-testid="drive-fault-check" data-state="refused"><p>${tr('Runtime từ chối lịch','ランタイムが予定を拒否','The runtime refused the schedule')}</p><ul>${s.check.codes.map(c=>`<li><code>${esc(c)}</code> · ${esc(faultCodeWords(c))}</li>`).join('')||`<li><code>${esc(s.check.error??'')}</code> · ${esc(faultCodeWords(s.check.error??''))}</li>`}</ul></div>`
  :s.check.state==='checking'?`<p role="status" data-testid="drive-fault-check" data-state="checking">${tr('Đang kiểm tra…','確認中…','Checking…')}</p>`:'<p class="field-help" data-testid="drive-fault-check" data-state="idle"></p>';
 return `<details id="twin-drive-faults" class="panel drive-faults" data-testid="drive-faults" ${s.open?'open':''}><summary>${tr('Lịch lỗi drive cho lần chạy mới','新しい実行のドライブ障害予定','Drive fault schedule for a new run')}</summary>
<p class="field-help">${tr('Lịch này là đầu vào của lần chạy mới, không lưu trong project. “Kiểm tra” hỏi runtime mà không tạo run. Mỗi lần đổi là một lần chạy mới; tham số là giả định, chưa hiệu chuẩn.','この予定は新しい実行の入力で、プロジェクトには保存されません。「確認」は実行を作らずランタイムに問い合わせます。変更ごとに新しい実行になります。パラメータは仮定で未校正です。','This schedule is an input of the new run and is not saved in the project. “Check” asks the runtime without creating a run. Each change is a new run; parameters are assumed, not calibrated.')}</p>
${experiment}
<fieldset class="drive-fault-draft"><legend>${tr('Thêm một lỗi','障害を追加','Add a fault')}</legend>
<label>${tr('Lỗi','障害','Fault')}<select id="twin-df-fault" ${off}>${DRIVE_FAULT_LAYERS.map(l=>{const g=offered.filter(f=>f.layer===l);return g.length?`<optgroup label="${esc(layerName(l))}">${g.map(f=>`<option value="${esc(f.id)}" ${f.id===s.draft.faultId?'selected':''}>${esc(f.id)}</option>`).join('')}</optgroup>`:'';}).join('')}</select></label>
<label>${tr('Đối tượng','対象','Target')}<select id="twin-df-target" ${off}>${targets.map(t=>`<option value="${esc(t)}" ${t===s.draft.targetId?'selected':''}>${esc(t)}</option>`).join('')}</select></label>
<label>${tr('Bắt đầu (ms mô phỏng)','開始(模擬ms)','Start (simulated ms)')}<input id="twin-df-at" type="number" min="0" max="3600000" step="20" value="${esc(s.draft.atMs)}" ${off}></label>${params}
<button type="button" class="button quiet" data-action="twin-drivefault-add" ${off}>${tr('Thêm lỗi','追加','Add fault')}</button></fieldset>
${faultTimeline(s.entries,s.catalog,horizon,{removable:!s.disabled})}
<div class="run-actions" role="group" aria-label="${tr('Lịch lỗi drive','ドライブ障害予定','Drive fault schedule')}"><button type="button" class="button" data-action="twin-drivefault-check" data-testid="drive-fault-check-button" ${s.entries.length&&!s.disabled&&!s.blocked&&s.check.state!=='checking'?'':'disabled'}>${tr('Kiểm tra','確認','Check')}</button>
<button type="button" class="button quiet" data-action="twin-drivefault-export" ${s.entries.length?'':'disabled'}>${tr('Xuất lịch JSON','予定JSONを出力','Export schedule JSON')}</button>
<label class="button quiet file-button">${tr('Nhập lịch JSON','予定JSONを読む','Import schedule JSON')}<input id="twin-drivefault-import" type="file" accept="application/json,.json" ${off}></label>
<button type="button" class="text-button" data-action="twin-drivefault-clear" ${s.entries.length&&!s.disabled?'':'disabled'}>${tr('Xóa hết','すべて削除','Clear all')}</button></div>${check}${s.message?`<p class="field-error" role="alert" data-testid="drive-fault-message">${esc(s.message)}</p>`:''}</details>`;
}
