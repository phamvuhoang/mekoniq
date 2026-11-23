// The perception section of a report (R4.4): the grasp attempts of a belief run (`report.perceptionEvidence`, rebuilt by the runtime from its durable stream) and the perception-gap study screen
// (a `PerceptionStudyV2` file read from disk; no runtime needed). Read-only: it counts what was recorded and ranks nothing.
import type {BeliefRecord,GraspAttempt,RecoveryStep,PerceptionProfileV1} from '../shared/navigation2d';
import {tr} from '../i18n';
import {esc} from '../ui/icons';
import type {Ghosts} from '../twin/belief';
export interface PerceptionEvidenceView {schemaVersion:1;policy?:{ageBasis:'publishedTick';profile:PerceptionProfileV1;profileBytes:string;profileSha256:string};coverage?:{scope:'belief_evaluations';firstTick:0;lastTick:number;prefixCovered:boolean;streamFinalized:boolean};beliefs:BeliefRecord[];attempts:GraspAttempt[];/** every record of every attempt as it was written (plan, commit, outcome); older reports have none */attemptRecords?:GraspAttempt[];recovery:RecoveryStep[];complete:boolean;issues:string[]}
export type PerceptionSection={available:false;reason:string}|{available:true;evidence:PerceptionEvidenceView};
const NOT_CAMERA=()=>tr('Sai số nhận thức được mô hình hóa, không phải dữ liệu camera. Vị trí thật chỉ có trong mô phỏng. Mọi tham số là giả định, chưa hiệu chuẩn.','モデル化した認識誤差でありカメラデータではありません。真の位置はシミュレーションにのみ存在します。全パラメータは仮定・未校正です。','Modelled perception error, not camera data. The true position exists only in simulation. Every parameter is assumed and not calibrated.');
const ok=(e:unknown):e is PerceptionEvidenceView=>{const x=e as PerceptionEvidenceView|null;return !!x&&typeof x==='object'&&x.schemaVersion===1&&Array.isArray(x.attempts)&&Array.isArray(x.beliefs)&&Array.isArray(x.recovery)&&Array.isArray(x.issues);};
/** What the report says about perception: a run that asked for a belief mode but carries no well-formed stream says so (never an empty table); a fixed-program or older report has none. */
export function perceptionSection(report:unknown):PerceptionSection{
 const r=report as {perceptionEvidence?:unknown}|null;
 return r&&ok(r.perceptionEvidence)?{available:true,evidence:r.perceptionEvidence}:{available:false,reason:'NO_PERCEPTION_DATA'};
}
/** The attempts as they stood at the cursor: the last record of each attempt that had been written by then (so a replay never shows the outcome of the end of the run at the moment of the commit); the final ones without a cursor, or in a report that kept no records. */
export function attemptsAt(e:PerceptionEvidenceView,tick?:number):GraspAttempt[]{
 if(tick===undefined||!e.attemptRecords)return e.attempts.filter(a=>tick===undefined||a.decidedTick<=tick);
 const by=new Map<string,GraspAttempt>();for(const a of e.attemptRecords)if((a.recordedTick??a.decidedTick)<=tick)by.set(a.attemptId,a);
 return [...by.values()];
}
/** A step is recorded before it is done (pending) and again when it ends: one row per step, as it stood at the cursor (the last record that had finished by then, else the pending one). */
function stepsAt(all:RecoveryStep[],tick?:number):RecoveryStep[]{
 const by=new Map<string,RecoveryStep[]>();for(const x of all)by.set(x.stepId,[...by.get(x.stepId)??[],x]);
 return [...by.values()].flatMap(list=>{
  if(tick===undefined)return [list.at(-1)!];
  const seen=list.filter(x=>x.recordedTick<=tick);if(!seen.length)return [];
  const finished=seen.filter(x=>(x.completedTick??x.recordedTick)<=tick&&x.result!=='pending');
  return [finished.at(-1)??{...seen[0]!,completedTick:null,result:'pending'}];
 }).sort((a,b)=>a.recordedTick-b.recordedTick);
}
const resultText=(r:string)=>({pending:tr('đang chờ','実行中','Pending'),done:tr('xong','完了','Done'),failed:tr('thất bại','失敗','Failed')} as Record<string,string>)[r]??r;
const ENDED:Record<string,()=>string>={
 RECOVERY_EXHAUSTED:()=>tr('Phục hồi đã dùng hết số lần cho phép; cần người xử lý.','回復は許可回数を使い切りました。人の対応が必要です。','Recovery used all the attempts it was allowed; a person is needed.'),
 RECOVERY_FACTS_MISSING:()=>tr('Không phục hồi: trạng thái tay máy/cốc chưa đủ rõ (ví dụ cốc có thể vẫn nằm giữa hai má). Gripper không được mở.','回復せず:アーム/カップの状態が不明(例:カップがまだパッドの間にある可能性)。グリッパは開きません。','Not recovered: the arm or cup state was not known well enough (for example the cup may still be between the pads). The gripper was not opened.'),
 RECOVERY_NOT_APPLICABLE:()=>tr('Thất bại này không nằm trong bảng phục hồi; cần người xử lý.','この失敗は回復表の対象外です。人の対応が必要です。','This failure is not in the recovery table; a person is needed.')};
/** What stopped the run after a recovery decision, from the report's own attention and arm stop reason (up to the cursor): the code and a sentence. */
function endedHtml(report:unknown,tick?:number):string{
 const r=report as {attention?:{reason?:string;tick?:number}[];coffee?:{armTrace?:{stop?:{reason?:string;events?:{tick?:number}[]}}}}|null,found=new Map<string,number>();
 for(const a of r?.attention??[])if(a.reason&&ENDED[a.reason]&&(tick===undefined||(a.tick??0)<=tick))found.set(a.reason,a.tick??0);
 const stop=r?.coffee?.armTrace?.stop;if(stop?.reason&&ENDED[stop.reason]&&!found.has(stop.reason)){const t=stop.events?.at(-1)?.tick??0;if(tick===undefined||t<=tick)found.set(stop.reason,t);}
 return found.size?`<ul data-testid="perception-ended">${[...found].map(([code,t])=>`<li><code>${esc(code)}</code> · tick ${t} · ${esc(ENDED[code]!())}</li>`).join('')}</ul>`:'';
}
/** The phase bar's suffix: which grasp attempt the cup is at, of the three the table allows (one try and two recoveries). Empty without attempts for that cup at the cursor. */
export const ATTEMPT_BOUND=3;
export function attemptCounter(report:unknown,tick:number,cupId:string|undefined):string{
 const s=perceptionSection(report);if(!s.available||!cupId)return '';
 const k=attemptsAt(s.evidence,tick).filter(a=>a.cupId===cupId).length;
 return k?` · ${tr('lượt','試行','attempt')} ${k}/${ATTEMPT_BOUND}`:'';
}
const mm=(m:number|null)=>m===null?'—':String(Number((m*1000).toFixed(1)));
const outcomeText=(o:string)=>({lifted:tr('Nhấc được','持ち上げ成功','Lifted'),grip_not_established:tr('Kẹp không hình thành','把持不成立','Grip not established'),cup_dropped:tr('Rơi cốc','カップ落下','Cup dropped'),refused:tr('Bị từ chối trước khi chuyển động','動作前に拒否','Refused before motion'),unknown:tr('Chưa rõ','不明','Unknown')} as Record<string,string>)[o]??o;
/** The block of a report or replay: the attempts decided up to `tick` (all of them without one), the four gates of each, and the recovery steps. */
export function perceptionBlockHtml(report:unknown,tick?:number,jump=false):string{
 const r=report as {manifest?:{perception?:unknown}}|null,s=perceptionSection(report),title=tr('Nhận thức và lượt gắp','認識と把持の試行','Perception and grasp attempts');
 if(!s.available)return r?.manifest?.perception?`<div data-testid="perception-evidence" data-available="false"><h3>${title}</h3><p class="field-help" data-testid="perception-reason">${tr('Không có dữ liệu nhận thức','認識データなし','No perception data')} (${esc(s.reason)})</p></div>`:'';
 const e=s.evidence,rows=attemptsAt(e,tick),steps=stepsAt(e.recovery,tick);
 const head=[tr('Cốc','カップ','Cup'),tr('Lượt','試行','Attempt'),'Tick',tr('Sai số XY (mm)','XY誤差 (mm)','XY error (mm)'),tr('Belief','Belief','Belief'),tr('Vùng','領域','Region'),'IK',tr('Quét','スイープ','Sweep'),tr('Kết quả','結果','Outcome')];
 const table=rows.length?`<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${title}"><table class="eng-table" data-testid="perception-attempts"><thead><tr>${head.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(a=>`<tr data-attempt="${esc(a.attemptId)}"><th scope="row">${esc(a.cupId)}</th><td>${a.index+1}</td><td>${a.decidedTick}</td><td>${mm(a.beliefErrorAtCommitM)}</td>${(['belief','region','ik','sweep'] as const).map(g=>`<td data-gate="${g}" data-pass="${a.gates[g]==='pass'}">${esc(a.gates[g])}</td>`).join('')}<td data-outcome="${esc(a.outcome)}">${esc(outcomeText(a.outcome))}${a.refusal?` · <code>${esc(a.refusal)}</code>`:''}</td></tr>`).join('')}</tbody></table></div>`
  :`<p class="field-help" data-empty="true">${tr('Chưa có lượt gắp tại thời điểm này','この時点では試行なし','No grasp attempt yet at this point')}</p>`;
 const rec=steps.length?`<h4>${tr('Bước phục hồi','回復ステップ','Recovery steps')}</h4><ul data-testid="perception-recovery">${steps.map(x=>`<li data-step="${esc(x.stepId)}" data-result="${esc(x.result)}">${jump?`<button class="button quiet" data-replay="recovery" data-tick="${x.recordedTick}">${tr('Đến tick','移動先のtick','Go to tick')} ${x.recordedTick}</button> `:''}${esc(x.attemptId)} · ${esc(x.rule)} · <code>${esc(x.action)}</code> · tick ${x.recordedTick}${x.completedTick!==null?`–${x.completedTick}`:''} · <b>${esc(resultText(x.result))}</b></li>`).join('')}</ul>`:'';
 const ended=endedHtml(report,tick);
 return `<div data-testid="perception-evidence" data-available="true" data-complete="${e.complete}"><h3>${title}</h3><p class="field-help">${esc(NOT_CAMERA())}</p>${table}${rec}${ended}${e.issues.length?`<p class="field-error" data-testid="perception-issues">${tr('Stream chưa đầy đủ','ストリーム不完全','Stream incomplete')}: ${e.issues.map(i=>`<code>${esc(i)}</code>`).join(', ')}</p>`:''}</div>`;
}
export interface PointResult {id:string;mode:string;runs:number;firstTry:number;afterRecovery:number;attention:number;firstTryInterval:{low:number;high:number};medianTicks:number;unexpectedContacts:number;medianBeliefErrorAtCommitM:number|null;outcomes:Record<string,number>}
export interface PerceptionStudyV2 {schemaVersion:2;endpointProtocol:'first-cup-grasp-v2';accepted:false;campaignId:string;calibration:'not_calibrated';points:PointResult[]}
const num=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const count=(n:unknown):n is number=>num(n)&&Number.isSafeInteger(n)&&n>=0;
function pointOk(p:PointResult){
 if(!p||typeof p.id!=='string'||!p.id||!['fixed_program','belief_ground_truth','belief_estimated'].includes(p.mode)||!count(p.runs)||!p.runs||
  !count(p.firstTry)||!count(p.afterRecovery)||!count(p.attention)||p.attention>p.runs||!count(p.unexpectedContacts)||!num(p.medianTicks)||p.medianTicks<0||
  !(p.medianBeliefErrorAtCommitM===null||num(p.medianBeliefErrorAtCommitM)&&p.medianBeliefErrorAtCommitM>=0))return false;
 const i=p.firstTryInterval,o=p.outcomes;
 return !!i&&num(i.low)&&num(i.high)&&i.low>=0&&i.high<=1&&i.low<=i.high&&!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.values(o).every(count)&&
  Object.values(o).reduce((n,v)=>n+v,0)===p.runs&&p.firstTry+p.afterRecovery===(o.lifted??0);
}
/** Accepts the study itself or the verdict/summary document that carries it as `study`. */
export function parseStudy(text:string):{ok:true;study:PerceptionStudyV2}|{ok:false;reason:string}{
 let v:unknown;try{v=JSON.parse(text);}catch{return {ok:false,reason:'STUDY_NOT_JSON'};}
 const s=((v as {study?:unknown})?.study??v) as PerceptionStudyV2|null;
 if((s as {schemaVersion?:number}|null)?.schemaVersion===1)return {ok:false,reason:'STUDY_LEGACY_ENDPOINT'};
 if(!s||typeof s!=='object'||s.schemaVersion!==2||s.endpointProtocol!=='first-cup-grasp-v2'||s.accepted!==false||s.calibration!=='not_calibrated'||typeof s.campaignId!=='string'||!s.campaignId||!Array.isArray(s.points)||!s.points.length)return {ok:false,reason:'STUDY_SHAPE_INVALID'};
 return s.points.every(pointOk)&&new Set(s.points.map(p=>p.id)).size===s.points.length?{ok:true,study:s}:{ok:false,reason:'STUDY_POINT_INVALID'};
}
const pct=(x:number)=>`${Math.round(x*100)} %`;
/** First-try proportion over the noise sigma of the registered sweep, each point with its Wilson interval and n. Inline SVG with a table alternative below; sigma points are those named `sigma-<n>mm`. */
function intervalPlot(points:PointResult[]):string{
 const sig=points.flatMap(p=>{const m=/^sigma-(\d+)mm$/.exec(p.id);return m?[{p,x:Number(m[1])}]:[];}).sort((a,b)=>a.x-b.x);
 if(!sig.length)return '';
 const W=420,H=220,L=52,R=14,T=14,B=44,xMax=Math.max(...sig.map(s=>s.x))*1.1,X=(x:number)=>L+x/xMax*(W-L-R),Y=(y:number)=>T+(1-y)*(H-T-B),title=tr('Tỷ lệ gắp đạt ngay lần đầu theo σ nhiễu (khoảng Wilson 95 %)','初回成功率とノイズσ(Wilson 95 %区間)','First-try success against noise σ (Wilson 95 % interval)');
 const grid=[0,0.5,1].map(y=>`<line class="plot-grid" x1="${L}" x2="${W-R}" y1="${Y(y)}" y2="${Y(y)}"/><text class="plot-tick" x="${L-6}" y="${Y(y)+4}" text-anchor="end">${pct(y)}</text>`).join('');
 const marks=sig.map(({p,x})=>`<g class="study-interval" data-point="${esc(p.id)}"><line x1="${X(x)}" x2="${X(x)}" y1="${Y(p.firstTryInterval.high)}" y2="${Y(p.firstTryInterval.low)}"/><circle cx="${X(x)}" cy="${Y(p.firstTry/p.runs)}" r="4"/><text class="plot-tick" x="${X(x)}" y="${H-24}" text-anchor="middle">${x} mm</text><text class="plot-tick" x="${X(x)}" y="${H-10}" text-anchor="middle">n=${p.runs}</text></g>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" class="plot study-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><desc>${esc(sig.map(({p,x})=>`σ ${x} mm: ${p.firstTry}/${p.runs} (${pct(p.firstTryInterval.low)}–${pct(p.firstTryInterval.high)})`).join('; '))}</desc>${grid}<rect class="plot-frame" x="${L}" y="${T}" width="${W-L-R}" height="${H-T-B}"/>${marks}</svg>`;
}
const modeText=(m:string)=>({fixed_program:tr('Chương trình cố định','固定プログラム','Fixed program'),belief_ground_truth:tr('XY thật (2D)','真値XY（2D）','Ground-truth XY (2D)'),belief_estimated:tr('Ước lượng mô phỏng','模擬推定','Simulated estimate')} as Record<string,string>)[m]??m;
export function studyHtml(s:PerceptionStudyV2):string{
 const title=tr('Nghiên cứu sai số nhận thức','認識誤差スタディ','Perception-gap study'),head=[tr('Điểm','ポイント','Point'),tr('Chế độ','モード','Mode'),tr('Số lượt','試行数','Runs'),tr('Đạt lần đầu','初回成功','First try'),`${tr('Khoảng','区間','Interval')} (Wilson 95 %)`,tr('Sau phục hồi','回復後','After recovery'),tr('Cần người','要対応','Needs a person'),tr('Trung vị tick','中央値tick','Median ticks'),tr('Tiếp xúc ngoài dự kiến','想定外の接触','Unexpected contacts'),tr('Sai số XY (mm)','XY誤差 (mm)','XY error (mm)')];
 return `<div data-testid="perception-study" data-campaign="${esc(s.campaignId)}"><h3>${title}</h3><p class="field-help">${tr('Kết quả, thời gian và tiếp xúc được đo tới khi kết thúc lượt gắp cốc đầu tiên.','結果、時間、接触は最初のカップ把持の終了時点までを集計します。','Outcomes, time and contacts are measured through the first cup grasp.')} ${esc(NOT_CAMERA())} ${tr('Khoảng mô tả tỷ lệ trên các hướng lệch và lần rút nhiễu đã đăng ký, không phải xác suất của một tay máy thật. Không xếp hạng.','区間は登録済みのずれ方向とノイズ抽出に対する割合であり、実機の確率ではありません。順位付けはしません。','The interval describes the proportion over the registered offset directions and noise draws, not the probability for a physical arm. No ordering of points is implied.')}</p>${intervalPlot(s.points)}
<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${title}"><table class="eng-table" data-testid="perception-study-rows"><thead><tr>${head.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${s.points.map(p=>`<tr data-point="${esc(p.id)}"><th scope="row">${esc(p.id)}</th><td>${esc(modeText(p.mode))}</td><td>${p.runs}</td><td>${p.firstTry}/${p.runs}</td><td>${pct(p.firstTryInterval.low)}–${pct(p.firstTryInterval.high)}</td><td>${p.afterRecovery}</td><td>${p.attention}</td><td>${p.medianTicks}</td><td>${p.unexpectedContacts}</td><td>${mm(p.medianBeliefErrorAtCommitM)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
/** The line under the stage of a cell run: what the dashed belief and the solid truth are, or why nothing is drawn (never a ghost on top of the real cup). */
export function ghostLegendHtml(g:Ghosts):string{
 if(g.status==='data')return `<p class="field-help" data-testid="belief-legend" data-state="data"><span class="legend-belief" aria-hidden="true">◌</span> ${tr('vị trí tin (nét đứt)','信じる位置(破線)','believed position (dashed)')} · <span aria-hidden="true">●</span> ${tr('vị trí thật khi quan sát (đặc, chỉ có trong mô phỏng)','観測時の真の位置(実線・シミュレーションのみ)','true position when observed (solid, simulation only)')} · ${g.items.map(i=>`${esc(i.objectId)} ↔ XY ${i.errorMm===null?'—':mm(i.errorMm/1000)} mm`).join(', ')}</p>`;
 return `<p class="field-help" data-testid="belief-legend" data-state="${g.status}">${g.status==='none'?tr('Không có dữ liệu nhận thức','認識データなし','No perception data'):tr('Không có dữ liệu nhận thức tại thời điểm này','この時点の認識データなし','No perception data at this point')}</p>`;
}
