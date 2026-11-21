// R4-A 7.5: after two runs of MJ-TRAY01 that differ in exactly one input (the acceleration limit), one sentence filled with the measured numbers, or the reason there is none.
// Never from an unaccepted pair or a missing metric; one run per side, so no percentile and no "optimal".
import {tr} from '../i18n';
import type {RunReport} from '../scenarios/controls';
import {esc} from '../ui/icons';
export interface TraySummary {experimentId:string;accelerationLimitMps2:number;maxLoadSlipM:{available:boolean;value:number|null};serviceTimeS:{available:boolean;value:number|null}}
const usable=(m:{available:boolean;value:number|null})=>m.available&&typeof m.value==='number'&&Number.isFinite(m.value);
const num=(n:number)=>String(+n.toFixed(1));
/** `from` and `to` are the displayed numbers of the higher-limit and the lower-limit run: the sentence says what lowering the limit did to them, by the numbers. */
const change=(what:'slip'|'time',from:string,to:string,unit:string)=>{
 const up=Number(to)>Number(from),same=from===to;
 return what==='slip'
  ?same?tr(`giữ nguyên độ trượt cốc lớn nhất ở ${from} ${unit}`,`カップの最大滑りは ${from} ${unit} のまま変わらず`,`leaves the largest cup slip unchanged at ${from} ${unit}`)
   :up?tr(`làm độ trượt cốc lớn nhất tăng từ ${from} lên ${to} ${unit}`,`カップの最大滑りは ${from} ${unit} から ${to} ${unit} に増加し`,`increases the largest cup slip from ${from} to ${to} ${unit}`)
   :tr(`làm độ trượt cốc lớn nhất giảm từ ${from} xuống ${to} ${unit}`,`カップの最大滑りは ${from} ${unit} から ${to} ${unit} に減少し`,`decreases the largest cup slip from ${from} to ${to} ${unit}`)
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
 if(![a,b].every(r=>usable(r.maxLoadSlipM)&&usable(r.serviceTimeS)))return {available:false,reason:'METRIC_UNAVAILABLE'};
 const [hi,lo]=a.accelerationLimitMps2>b.accelerationLimitMps2?[a,b]:[b,a];
 const mm=(r:TraySummary)=>num(r.maxLoadSlipM.value!*1000),s=(r:TraySummary)=>num(r.serviceTimeS.value!);
 const text=tr(
  `Với bộ tham số mô phỏng này (chưa hiệu chuẩn), giảm giới hạn gia tốc từ ${num(hi.accelerationLimitMps2)} xuống ${num(lo.accelerationLimitMps2)} m/s² ${change('slip',mm(hi),mm(lo),'mm')} và ${change('time',s(hi),s(lo),'giây')}. Cần đối chiếu bằng thử nghiệm vật lý trước khi áp dụng lên robot.`,
  `このシミュレーションパラメータ（未較正）では、加速度の上限を ${num(hi.accelerationLimitMps2)} から ${num(lo.accelerationLimitMps2)} m/s² に下げると、${change('slip',mm(hi),mm(lo),'mm')}、${change('time',s(hi),s(lo),'秒')}。ロボットに適用する前に物理試験で確認してください。`,
  `With this simulation parameter set (not calibrated), lowering the acceleration limit from ${num(hi.accelerationLimitMps2)} to ${num(lo.accelerationLimitMps2)} m/s² ${change('slip',mm(hi),mm(lo),'mm')} and ${change('time',s(hi),s(lo),'s')}. Confirm with a physical test before applying it to the robot.`);
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
/**
 * The design hint of two tray reports. The runtime computed each report's evidence from its own durable records; the pair is taken as comparable only when it is the same scenario, seed, backend set,
 * source commit and thresholds, and the registered knobs differ in exactly one (the Lab cannot re-read the evidence, so this is the report-level reading of the comparison's acceptance).
 */
export function trayHint(a:RunReport,b:RunReport):{available:true;text:string}|{available:false;reason:string}{
 const x=trayEvidenceOf(a),y=trayEvidenceOf(b);if(!x||!y)return {available:false,reason:'NO_TRAY_EVIDENCE'};
 const ma=a.manifest,mb=b.manifest,same=ma.scenario.id===mb.scenario.id&&ma.seed===mb.seed&&ma.backendSetId===mb.backendSetId&&ma.sourceCommit===mb.sourceCommit&&x.policyDigest===y.policyDigest&&ma.mode===mb.mode&&ma.access===mb.access;
 const summary=(e:TrayEvidenceView):TraySummary=>({experimentId:e.experimentId,accelerationLimitMps2:e.accelerationLimitMps2,maxLoadSlipM:e.maxLoadSlipM,serviceTimeS:e.serviceTimeS});
 return designHint({accepted:same,changed:KNOBS.filter(k=>x.knobs[k]!==y.knobs[k]),a:summary(x),b:summary(y)});
}

const reasonWords=(code:string)=>({
 NO_TRAY_EVIDENCE:tr('một trong hai báo cáo không có bằng chứng khay','どちらかのレポートにトレイの証拠がない','one of the reports has no tray evidence'),
 PAIR_NOT_ACCEPTED:tr('hai lần chạy không cùng kịch bản, seed, bộ backend, commit hoặc ngưỡng','2つの実行でシナリオ・シード・バックエンドセット・コミット・しきい値が異なる','the two runs differ in scenario, seed, backend set, commit or thresholds'),
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
