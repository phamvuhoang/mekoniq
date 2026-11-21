// The fault section of a report (R4 V08): `faultReport` (FaultReportV1, built by the runtime from the recorded streams) in words. Read-only; a report without one says why, never an empty table.
import type {FaultReportV1} from '../shared/navigation2d';
import {tr} from '../i18n';
import {esc,icon} from '../ui/icons';
import {hashJson} from '../twin/hash';
export interface FaultRow {entryId:string;title:string;injected:string;detection:string;controller:string;plant:string;invariants:string;verdict:string;verdictCode:string;tick:number|null}
export type FaultSection={available:false;reason:string}|{available:true;rows:FaultRow[];violated:string[]};
const VERDICTS=['detected_in_time','detected_late','not_detected','not_fired'],RESULTS=['pass','violated','not_applicable','not_evidenced'];
const isTick=(x:unknown):x is number|null=>x===null||(typeof x==='number'&&Number.isInteger(x)&&x>=0);
const isReport=(r:unknown):r is FaultReportV1=>{
 const x=r as FaultReportV1|null;
 return !!x&&typeof x==='object'&&x.documentType==='fault-report'&&x.schemaVersion===1&&Array.isArray(x.entries)&&Array.isArray(x.invariants)&&x.invariants.length===6
  &&x.invariants.every(i=>!!i&&typeof i.id==='string'&&RESULTS.includes(i.result))
  &&x.entries.every(e=>!!e&&typeof e.entryId==='string'&&typeof e.faultId==='string'&&typeof e.targetId==='string'&&VERDICTS.includes(e.verdict)&&!!e.injection&&isTick(e.injection.appliedTick)&&isTick(e.injection.endedTick)&&!!e.detection&&isTick(e.detection.tick)&&!!e.plantResponse);
};
const verdictText=(v:string)=>({detected_in_time:tr('Phát hiện đúng hạn','期限内に検出','Detected in time'),detected_late:tr('Phát hiện trễ','遅れて検出','Detected late'),not_detected:tr('Không phát hiện','未検出','Not detected'),not_fired:tr('Chưa chèn','未注入','Not fired')} as Record<string,string>)[v]??v;
const m=(n:number)=>String(Number(n.toFixed(2)));
/** Why a well-formed fault report does not belong to the report that carries it (R13), or null: another run, a schedule other than the manifest's (hashed as the
 * runtime hashes it), an entry that schedule does not have, or a tick past the report's outcome. */
function unbound(b:FaultReportV1,r:{manifest?:{runId?:unknown;driveFaultSchedule?:{entries?:unknown;hash?:unknown}};outcome?:{tick?:unknown}}):string|null{
 if(b.runId!==r.manifest?.runId)return 'FAULT_RUN_MISMATCH';
 const s=r.manifest?.driveFaultSchedule,entries=Array.isArray(s?.entries)?s.entries as {id?:unknown;faultId?:unknown;targetId?:unknown}[]:null;
 if(!entries||b.scheduleDigest!==s!.hash||(()=>{try{return hashJson(entries);}catch{return null;}})()!==s!.hash)return 'FAULT_SCHEDULE_MISMATCH';// an imported schedule hashJson cannot hash (a non-finite number) is a mismatch, never a crash
 if(!b.entries.every(e=>entries.some(x=>x?.id===e.entryId&&x.faultId===e.faultId&&x.targetId===e.targetId)))return 'FAULT_ENTRY_UNSCHEDULED';
 const end=r.outcome?.tick;
 return typeof end==='number'&&b.entries.some(e=>[e.injection.appliedTick,e.injection.endedTick,e.detection.tick].some(t=>t!==null&&t>end))?'FAULT_BEYOND_HORIZON':null;
}
/** The section of whatever was imported: anything without a well-formed fault report is NO_FAULT_DATA; one that is not bound to the report carrying it says why (unbound). */
export function faultSection(report:unknown):FaultSection{
 const b=report&&typeof report==='object'?(report as {faultReport?:unknown}).faultReport:undefined;
 if(!isReport(b))return {available:false,reason:'NO_FAULT_DATA'};
 const reason=unbound(b,report as Parameters<typeof unbound>[1]);if(reason)return {available:false,reason};
 const pass=b.invariants.filter(i=>i.result==='pass').length,viol=b.invariants.filter(i=>i.result==='violated'),na=b.invariants.filter(i=>i.result==='not_applicable').length,ne=b.invariants.filter(i=>i.result==='not_evidenced').length;
 const inv=`${pass}/${b.invariants.length} ${tr('đạt','合格','pass')}${viol.length?` · ${viol.length} ${tr('vi phạm','違反','violated')} (${viol.map(i=>i.id).join(', ')})`:''}${na?` · ${na} ${tr('không áp dụng','対象外','n/a')}`:''}${ne?` · ${ne} ${tr('chưa có bằng chứng','証拠なし','not evidenced')}`:''}`;
 const rows=b.entries.map((e):FaultRow=>{
  const fired=e.injection.appliedTick!==null,d=e.detection,p=e.plantResponse;
  const plant=[p.axisState?`${p.axisState}${p.axisFault?` ${p.axisFault}`:''}`:'',typeof p.ticksToRest==='number'?`${tr('dừng sau','停止まで','rests after')} ${p.ticksToRest} tick`:'',typeof p.baseTravelM==='number'?`${m(p.baseTravelM)} m`:''].filter(Boolean).join(' · ');
  return {entryId:e.entryId,title:`${e.faultId} · ${e.targetId}`,
   injected:fired?`tick ${e.injection.appliedTick}${e.injection.endedTick!==null?`–${e.injection.endedTick}`:''}`:(e.injection as {overriddenBy?:string}).overriddenBy?`${tr('bị ghi đè','上書き','overridden')}: ${(e.injection as {overriddenBy?:string}).overriddenBy}`:'—',
   detection:!fired?'—':d.by&&d.tick!==null?`${d.by} ${d.code??''} tick ${d.tick}${typeof d.latencyTicks==='number'?` (+${d.latencyTicks})`:''}`.replace('  ',' '):tr('Không phát hiện','未検出','Not detected'),
   controller:fired&&typeof e.firstCommandChangeTick==='number'?`${tr('lệnh đổi từ tick','指令変化 tick','command changes from tick')} ${e.firstCommandChangeTick}`:'—',
   plant:fired&&plant?plant:'—',invariants:inv,verdict:verdictText(e.verdict),verdictCode:e.verdict,tick:e.injection.appliedTick};
 });
 return {available:true,rows,violated:viol.map(i=>i.id)};
}
/** The panel block. A fired entry's title is a button that moves the replay cursor to its tick (`twin-fault-jump`). */
export function faultHtml(report:unknown):string{
 const s=faultSection(report),title=tr('Lỗi đã chèn','注入された障害','Injected faults');
 if(!s.available)return `<div data-testid="fault-evidence" data-available="false"><h3>${title}</h3><p class="field-help" data-testid="fault-reason">${tr('Không có dữ liệu lỗi','障害データなし','No fault data')} (${esc(s.reason)})</p></div>`;
 const head=[tr('Lỗi · đối tượng','障害 · 対象','Fault · target'),tr('Chèn','注入','Injected'),tr('Phát hiện','検出','Detection'),tr('Controller','コントローラ','Controller'),tr('Plant','プラント','Plant'),tr('Bất biến','不変条件','Invariants'),tr('Phán quyết','判定','Verdict')];
 return `<div data-testid="fault-evidence" data-available="true"${s.violated.length?' data-violated="true"':''}><h3>${title}</h3>
<p class="field-help">${tr('Dựng lại từ stream đã ghi; lịch không phải bằng chứng đã áp dụng. Chưa hiệu chuẩn.','記録ストリームから再構築。予定は適用の証拠ではありません。未校正。','Rebuilt from the recorded streams; the schedule is not proof of application. Not calibrated.')}</p>
<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${title}"><table class="eng-table" data-testid="fault-rows"><thead><tr>${head.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r=>`<tr data-entry="${esc(r.entryId)}" data-verdict="${esc(r.verdictCode)}"><th scope="row">${r.tick!==null?`<button class="link-button" data-action="twin-fault-jump" data-value="${r.tick}" title="${esc(tr('Đặt con trỏ replay tại tick áp dụng','適用tickへ移動','Move the replay cursor to the applied tick'))}">${icon('arrow',12)}${esc(r.title)}</button>`:esc(r.title)}</th><td>${esc(r.injected)}</td><td>${esc(r.detection)}</td><td>${esc(r.controller)}</td><td>${esc(r.plant)}</td><td>${esc(r.invariants)}</td><td><span class="pill" data-verdict="${esc(r.verdictCode)}">${esc(r.verdict)}</span></td></tr>`).join('')}</tbody></table></div></div>`;
}

/** The block a report or a recorded package shows: only a run that had a drive fault schedule (or carries a fault report) has anything to say about faults; a package that names the schedule but lost the report says NO_FAULT_DATA. */
export function faultBlockHtml(report:unknown):string{
 const r=report&&typeof report==='object'?report as {faultReport?:unknown;manifest?:{driveFaultSchedule?:unknown}}:null;
 return r&&(r.faultReport||r.manifest?.driveFaultSchedule)?faultHtml(report):'';
}
