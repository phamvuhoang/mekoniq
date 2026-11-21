// R4-A 7.5: after two runs of MJ-TRAY01 that differ in exactly one input (the acceleration limit), one sentence filled with the measured numbers, or the reason there is none.
// Never from an unaccepted pair or a missing metric; one run per side, so no percentile and no "optimal".
import {tr} from '../i18n';
import type {RunReport} from '../scenarios/controls';
import {esc} from '../ui/icons';
/** `windowS`: the window the largest slip is taken in (the evidence's windowTicks at the run's tick). */
export interface TraySummary {experimentId:string;accelerationLimitMps2:number;windowS:number;maxLoadSlipM:{available:boolean;value:number|null};serviceTimeS:{available:boolean;value:number|null}}
const usable=(m:{available:boolean;value:number|null})=>m.available&&typeof m.value==='number'&&Number.isFinite(m.value);
const num=(n:number)=>String(+n.toFixed(1));
/** `from` and `to` are the displayed numbers of the higher-limit and the lower-limit run: the sentence says what lowering the limit did to them, by the numbers. */
/** The slip is the largest one within the window `w` (seconds), never a displacement over the whole mission. */
const change=(what:'slip'|'time',from:string,to:string,unit:string,w='')=>{
 const up=Number(to)>Number(from),same=from===to;
 return what==='slip'
  ?same?tr(`giữ nguyên độ trượt cốc lớn nhất trong cửa sổ ${w} s ở ${from} ${unit}`,`${w} 秒の区間内のカップの最大滑りは ${from} ${unit} のまま変わらず`,`leaves the largest cup slip within a ${w} s window unchanged at ${from} ${unit}`)
   :up?tr(`làm độ trượt cốc lớn nhất trong cửa sổ ${w} s tăng từ ${from} lên ${to} ${unit}`,`${w} 秒の区間内のカップの最大滑りは ${from} ${unit} から ${to} ${unit} に増加し`,`increases the largest cup slip within a ${w} s window from ${from} to ${to} ${unit}`)
   :tr(`làm độ trượt cốc lớn nhất trong cửa sổ ${w} s giảm từ ${from} xuống ${to} ${unit}`,`${w} 秒の区間内のカップの最大滑りは ${from} ${unit} から ${to} ${unit} に減少し`,`decreases the largest cup slip within a ${w} s window from ${from} to ${to} ${unit}`)
  :same?tr(`giữ nguyên thời gian phục vụ ở ${from} ${unit}`,`サービス時間は ${from} ${unit} のまま変わりません`,`leaves the service time unchanged at ${from} ${unit}`)
   :up?tr(`làm thời gian phục vụ tăng từ ${from} lên ${to} ${unit}`,`サービス時間は ${from} ${unit} から ${to} ${unit} に増加します`,`increases the service time from ${from} to ${to} ${unit}`)
   :tr(`làm thời gian phục vụ giảm từ ${from} xuống ${to} ${unit}`,`サービス時間は ${from} ${unit} から ${to} ${unit} に減少します`,`decreases the service time from ${from} to ${to} ${unit}`);
};
export function designHint(pair:{accepted:boolean;changed:string[];a:TraySummary;b:TraySummary}):{available:true;text:string}|{available:false;reason:string}{
 if(!pair.accepted)return {available:false,reason:'PAIR_NOT_ACCEPTED'};
 if(pair.changed.length!==1||pair.changed[0]!=='acceleration')return {available:false,reason:'CHANGED_INPUT_NOT_ACCELERATION'};
 const {a,b}=pair;
 if(![a.accelerationLimitMps2,b.accelerationLimitMps2].every(Number.isFinite))return {available:false,reason:'METRIC_UNAVAILABLE'};
 if(a.accelerationLimitMps2===b.accelerationLimitMps2)return {available:false,reason:'ACCELERATION_LIMIT_EQUAL'};
 if(![a,b].every(r=>usable(r.maxLoadSlipM)&&usable(r.serviceTimeS)&&Number.isFinite(r.windowS)&&r.windowS>0))return {available:false,reason:'METRIC_UNAVAILABLE'};
 const [hi,lo]=a.accelerationLimitMps2>b.accelerationLimitMps2?[a,b]:[b,a];
 const mm=(r:TraySummary)=>num(r.maxLoadSlipM.value!*1000),s=(r:TraySummary)=>num(r.serviceTimeS.value!);
 const text=tr(
  `Với bộ tham số mô phỏng này (chưa hiệu chuẩn), giảm giới hạn gia tốc từ ${num(hi.accelerationLimitMps2)} xuống ${num(lo.accelerationLimitMps2)} m/s² ${change('slip',mm(hi),mm(lo),'mm',num(hi.windowS))} và ${change('time',s(hi),s(lo),'giây')}. Cần đối chiếu bằng thử nghiệm vật lý trước khi áp dụng lên robot.`,
  `このシミュレーションパラメータ（未較正）では、加速度の上限を ${num(hi.accelerationLimitMps2)} から ${num(lo.accelerationLimitMps2)} m/s² に下げると、${change('slip',mm(hi),mm(lo),'mm',num(hi.windowS))}、${change('time',s(hi),s(lo),'秒')}。ロボットに適用する前に物理試験で確認してください。`,
  `With this simulation parameter set (not calibrated), lowering the acceleration limit from ${num(hi.accelerationLimitMps2)} to ${num(lo.accelerationLimitMps2)} m/s² ${change('slip',mm(hi),mm(lo),'mm',num(hi.windowS))} and ${change('time',s(hi),s(lo),'s')}. Confirm with a physical test before applying it to the robot.`);
 return {available:true,text};
}

// ---- from two run reports ----
/** What the runtime's report carries for a tray run (RunReport.trayEvidence), computed from the durable physics records. */
export interface TrayEvidenceView{schemaVersion:1;documentType:'tray-evidence';accepted:false;calibration:'not_calibrated';experimentId:string;comparedWith:string|null;knobs:{friction:string;acceleration:string;drive:string;actor:boolean};accelerationLimitMps2:number;
 windowTicks:number;maxLoadSlipM:{available:boolean;value:number|null};cumulativeDriftM:number|null;maxSupportAccelerationMps2:number|null;serviceTimeS:{available:boolean;value:number|null;reason?:string};policyDigest:string}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const metric=(v:unknown)=>obj(v)&&typeof v.available==='boolean'&&(v.value===null||typeof v.value==='number');
export function trayEvidenceOf(r:RunReport):TrayEvidenceView|null{
 const e=(r as unknown as {trayEvidence?:unknown}).trayEvidence;
 if(!obj(e)||e.documentType!=='tray-evidence'||e.schemaVersion!==1||typeof e.experimentId!=='string'||!obj(e.knobs)||![e.knobs.friction,e.knobs.acceleration,e.knobs.drive].every(x=>typeof x==='string')||typeof e.knobs.actor!=='boolean'
  ||typeof e.accelerationLimitMps2!=='number'||!metric(e.maxLoadSlipM)||!metric(e.serviceTimeS)||typeof e.policyDigest!=='string')return null;
 return e as unknown as TrayEvidenceView;
}
const KNOBS=['friction','acceleration','drive','actor'] as const;
/** R14: what must be the same on both runs, from every identity field the reports carry: the scenario (id, revision, hash), seed, backend set, backends and their versions,
 * source commit, mode, access, clock, project and world, the drive fault schedule, the tray policy and its window, and the engine and host the runtime names. */
const ENGINE=['id','version','engineVersion','pythonVersion','hostArch','platform','lockDigest'] as const;
const identity=(r:RunReport,e:TrayEvidenceView)=>{
 type Id={id?:unknown;revision?:unknown;hash?:unknown};const m=r.manifest as RunReport['manifest']&{project?:Id;world?:Id;driveFaultSchedule?:{hash?:unknown}},g=(r as {navigation2d?:{engine?:Record<string,unknown>}}).navigation2d?.engine;
 return JSON.stringify([m.scenario.id,m.scenario.revision,m.scenario.hash,m.seed,m.backendSetId,m.backends.map(b=>[b.id,b.version]),m.sourceCommit,m.mode,m.access,m.clock?.tickMs,[m.project?.id,m.project?.revision,m.project?.hash],[m.world?.id,m.world?.revision,m.world?.hash],m.driveFaultSchedule?.hash??null,e.policyDigest,e.windowTicks,ENGINE.map(k=>g?.[k])]);
};
/**
 * The design hint of two tray reports. The runtime computed each report's evidence from its own durable records; the pair is taken as comparable only when its identity is the same (above)
 * and the registered knobs differ in exactly one (the Lab cannot re-read the evidence, so this is the report-level reading of the comparison's acceptance).
 */
export function trayHint(a:RunReport,b:RunReport):{available:true;text:string}|{available:false;reason:string}{
 const x=trayEvidenceOf(a),y=trayEvidenceOf(b);if(!x||!y)return {available:false,reason:'NO_TRAY_EVIDENCE'};
 const summary=(e:TrayEvidenceView,r:RunReport):TraySummary=>({experimentId:e.experimentId,accelerationLimitMps2:e.accelerationLimitMps2,windowS:e.windowTicks*(r.manifest.clock?.tickMs??Number.NaN)/1000,maxLoadSlipM:e.maxLoadSlipM,serviceTimeS:e.serviceTimeS});
 return designHint({accepted:identity(a,x)===identity(b,y),changed:KNOBS.filter(k=>x.knobs[k]!==y.knobs[k]),a:summary(x,a),b:summary(y,b)});
}

const reasonWords=(code:string)=>({
 NO_TRAY_EVIDENCE:tr('một trong hai báo cáo không có bằng chứng khay','どちらかのレポートにトレイの証拠がない','one of the reports has no tray evidence'),
 PAIR_NOT_ACCEPTED:tr('hai lần chạy không cùng kịch bản (kể cả bản sửa đổi), seed, backend, engine hoặc máy chủ, commit, dự án hoặc thế giới, lịch lỗi hoặc ngưỡng','2つの実行でシナリオ(改訂を含む)・シード・バックエンド・エンジンまたはホスト・コミット・プロジェクトまたはワールド・障害スケジュール・しきい値のいずれかが異なる','the two runs differ in scenario (revision included), seed, backends, engine or host, commit, project or world, fault schedule or thresholds'),
 CHANGED_INPUT_NOT_ACCELERATION:tr('hai lần chạy không khác đúng một đầu vào là giới hạn gia tốc','2つの実行の違いが加速度上限の1つだけではない','the two runs do not differ in exactly one input, the acceleration limit'),
 ACCELERATION_LIMIT_EQUAL:tr('hai giới hạn gia tốc bằng nhau','加速度上限が同じ','the two acceleration limits are equal'),
 METRIC_UNAVAILABLE:tr('thiếu số đo (độ trượt hoặc thời gian phục vụ), ví dụ lần chạy chưa hoàn thành','計測値(滑りまたはサービス時間)がない。例: 実行が完了していない','a measurement is missing (the slip or the service time), for example a run that did not finish')} as Record<string,string>)[code]??code;
/** The compare panel's design-hint block: absent unless one of the two reports is a tray report; then the sentence, or "not enough data to compare" with the reason. */
export function trayHintHtml(a:RunReport,b:RunReport):string{
 if(!trayEvidenceOf(a)&&!trayEvidenceOf(b))return '';
 const h=trayHint(a,b);
 return h.available
  ?`<div class="design-hint" data-testid="tray-hint" data-available="true"><h3>${tr('Gợi ý thiết kế từ số đo','計測に基づく設計ヒント','Design hint from the measurements')}</h3><p>${esc(h.text)}</p></div>`
  :`<div class="design-hint" data-testid="tray-hint" data-available="false"><h3>${tr('Gợi ý thiết kế từ số đo','計測に基づく設計ヒント','Design hint from the measurements')}</h3><p>${tr('Không đủ dữ liệu để so sánh','比較に十分なデータがありません','Not enough data to compare')}: ${esc(reasonWords(h.reason))} <code>${esc(h.reason)}</code></p></div>`;
}
