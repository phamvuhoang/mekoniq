// The perception section of a report (R4.4): the grasp attempts of a belief run (`report.perceptionEvidence`, rebuilt by the runtime from its durable stream) and the perception-gap study screen
// (a `PerceptionStudyV1` file read from disk; no runtime needed). Read-only: it counts what was recorded and ranks nothing.
import type {BeliefRecord,GraspAttempt,RecoveryStep} from '../shared/navigation2d';
import {tr} from '../i18n';
import {esc} from '../ui/icons';
import type {Ghosts} from '../twin/belief';
export interface PerceptionEvidenceView {schemaVersion:1;beliefs:BeliefRecord[];attempts:GraspAttempt[];recovery:RecoveryStep[];complete:boolean;issues:string[]}
export type PerceptionSection={available:false;reason:string}|{available:true;evidence:PerceptionEvidenceView};
const NOT_CAMERA=()=>tr('Sai số nhận thức được mô hình hóa, không phải dữ liệu camera. Vị trí thật chỉ có trong mô phỏng. Mọi tham số là giả định, chưa hiệu chuẩn.','モデル化した認識誤差でありカメラデータではありません。真の位置はシミュレーションにのみ存在します。全パラメータは仮定・未校正です。','Modelled perception error, not camera data. The true position exists only in simulation. Every parameter is assumed and not calibrated.');
const ok=(e:unknown):e is PerceptionEvidenceView=>{const x=e as PerceptionEvidenceView|null;return !!x&&typeof x==='object'&&x.schemaVersion===1&&Array.isArray(x.attempts)&&Array.isArray(x.beliefs)&&Array.isArray(x.recovery)&&Array.isArray(x.issues);};
/** What the report says about perception: a run that asked for a belief mode but carries no well-formed stream says so (never an empty table); a fixed-program or older report has none. */
export function perceptionSection(report:unknown):PerceptionSection{
 const r=report as {perceptionEvidence?:unknown}|null;
 return r&&ok(r.perceptionEvidence)?{available:true,evidence:r.perceptionEvidence}:{available:false,reason:'NO_PERCEPTION_DATA'};
}
const mm=(m:number|null)=>m===null?'—':String(Number((m*1000).toFixed(1)));
const outcomeText=(o:string)=>({lifted:tr('Nhấc được','持ち上げ成功','Lifted'),grip_not_established:tr('Kẹp không hình thành','把持不成立','Grip not established'),cup_dropped:tr('Rơi cốc','カップ落下','Cup dropped'),refused:tr('Bị từ chối trước khi chuyển động','動作前に拒否','Refused before motion'),unknown:tr('Chưa rõ','不明','Unknown')} as Record<string,string>)[o]??o;
/** The block of a report or replay: the attempts decided up to `tick` (all of them without one), the four gates of each, and the recovery steps. */
export function perceptionBlockHtml(report:unknown,tick?:number):string{
 const r=report as {manifest?:{perception?:unknown}}|null,s=perceptionSection(report),title=tr('Nhận thức và lượt gắp','認識と把持の試行','Perception and grasp attempts');
 if(!s.available)return r?.manifest?.perception?`<div data-testid="perception-evidence" data-available="false"><h3>${title}</h3><p class="field-help" data-testid="perception-reason">${tr('Không có dữ liệu nhận thức','認識データなし','No perception data')} (${esc(s.reason)})</p></div>`:'';
 const e=s.evidence,rows=e.attempts.filter(a=>tick===undefined||a.decidedTick<=tick),steps=e.recovery.filter(x=>tick===undefined||x.recordedTick<=tick);
 const head=[tr('Cốc','カップ','Cup'),tr('Lượt','試行','Attempt'),'Tick',tr('Lệch belief (mm)','belief誤差(mm)','Belief error (mm)'),tr('Belief','Belief','Belief'),tr('Vùng','領域','Region'),'IK',tr('Quét','スイープ','Sweep'),tr('Kết quả','結果','Outcome')];
 const table=rows.length?`<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${title}"><table class="eng-table" data-testid="perception-attempts"><thead><tr>${head.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(a=>`<tr data-attempt="${esc(a.attemptId)}"><th scope="row">${esc(a.cupId)}</th><td>${a.index+1}</td><td>${a.decidedTick}</td><td>${mm(a.beliefErrorAtCommitM)}</td>${(['belief','region','ik','sweep'] as const).map(g=>`<td data-gate="${g}" data-pass="${a.gates[g]==='pass'}">${esc(a.gates[g])}</td>`).join('')}<td data-outcome="${esc(a.outcome)}">${esc(outcomeText(a.outcome))}${a.refusal?` · <code>${esc(a.refusal)}</code>`:''}</td></tr>`).join('')}</tbody></table></div>`
  :`<p class="field-help" data-empty="true">${tr('Chưa có lượt gắp tại thời điểm này','この時点では試行なし','No grasp attempt yet at this point')}</p>`;
 const rec=steps.length?`<ul data-testid="perception-recovery">${steps.map(x=>`<li>${esc(x.attemptId)} · ${esc(x.rule)} · <code>${esc(x.action)}</code> · tick ${x.recordedTick}${x.completedTick!==null?`–${x.completedTick}`:''} · ${esc(x.result)}</li>`).join('')}</ul>`:'';
 return `<div data-testid="perception-evidence" data-available="true" data-complete="${e.complete}"><h3>${title}</h3><p class="field-help">${esc(NOT_CAMERA())}</p>${table}${rec}${e.issues.length?`<p class="field-error" data-testid="perception-issues">${tr('Stream chưa đầy đủ','ストリーム不完全','Stream incomplete')}: ${e.issues.map(i=>`<code>${esc(i)}</code>`).join(', ')}</p>`:''}</div>`;
}
export interface PointResult {id:string;mode:string;runs:number;firstTry:number;afterRecovery:number;attention:number;firstTryInterval:{low:number;high:number};medianTicks:number;unexpectedContacts:number;medianBeliefErrorAtCommitM:number|null;outcomes:Record<string,number>}
export interface PerceptionStudyV1 {schemaVersion:1;campaignId:string;calibration:string;points:PointResult[]}
const num=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const pointOk=(p:PointResult)=>!!p&&typeof p==='object'&&typeof p.id==='string'&&typeof p.mode==='string'&&Number.isInteger(p.runs)&&p.runs>0&&Number.isInteger(p.firstTry)&&p.firstTry>=0&&p.firstTry<=p.runs&&num(p.afterRecovery)&&num(p.attention)&&num(p.medianTicks)&&num(p.unexpectedContacts)
 &&!!p.firstTryInterval&&num(p.firstTryInterval.low)&&num(p.firstTryInterval.high)&&p.firstTryInterval.low>=0&&p.firstTryInterval.high<=1&&p.firstTryInterval.low<=p.firstTryInterval.high&&(p.medianBeliefErrorAtCommitM===null||num(p.medianBeliefErrorAtCommitM))&&!!p.outcomes&&typeof p.outcomes==='object';
/** Accepts the study itself or the verdict/summary document that carries it as `study`. */
export function parseStudy(text:string):{ok:true;study:PerceptionStudyV1}|{ok:false;reason:string}{
 let v:unknown;try{v=JSON.parse(text);}catch{return {ok:false,reason:'STUDY_NOT_JSON'};}
 const s=((v as {study?:unknown})?.study??v) as PerceptionStudyV1|null;
 if(!s||typeof s!=='object'||s.schemaVersion!==1||typeof s.campaignId!=='string'||!Array.isArray(s.points)||!s.points.length)return {ok:false,reason:'STUDY_SHAPE_INVALID'};
 return s.points.every(pointOk)?{ok:true,study:s}:{ok:false,reason:'STUDY_POINT_INVALID'};
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
const modeText=(m:string)=>({fixed_program:tr('Chương trình cố định','固定プログラム','Fixed program'),belief_ground_truth:tr('Vị trí thật','真の位置','Ground truth'),belief_estimated:tr('Ước lượng mô phỏng','模擬推定','Simulated estimate')} as Record<string,string>)[m]??m;
export function studyHtml(s:PerceptionStudyV1):string{
 const title=tr('Nghiên cứu sai số nhận thức','認識誤差スタディ','Perception-gap study'),head=[tr('Điểm','ポイント','Point'),tr('Chế độ','モード','Mode'),tr('Số lượt','試行数','Runs'),tr('Đạt lần đầu','初回成功','First try'),`${tr('Khoảng','区間','Interval')} (Wilson 95 %)`,tr('Sau phục hồi','回復後','After recovery'),tr('Cần người','要対応','Needs a person'),tr('Trung vị tick','中央値tick','Median ticks'),tr('Lệch belief (mm)','belief誤差(mm)','Belief error (mm)')];
 return `<div data-testid="perception-study" data-campaign="${esc(s.campaignId)}"><h3>${title}</h3><p class="field-help">${esc(NOT_CAMERA())} ${tr('Khoảng mô tả tỷ lệ trên các hướng lệch và lần rút nhiễu đã đăng ký, không phải xác suất của một tay máy thật. Không xếp hạng.','区間は登録済みのずれ方向とノイズ抽出に対する割合であり、実機の確率ではありません。順位付けはしません。','The interval describes the proportion over the registered offset directions and noise draws, not the probability for a physical arm. No ordering of points is implied.')}</p>${intervalPlot(s.points)}
<div class="eng-table-wrap" tabindex="0" role="region" aria-label="${title}"><table class="eng-table" data-testid="perception-study-rows"><thead><tr>${head.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${s.points.map(p=>`<tr data-point="${esc(p.id)}"><th scope="row">${esc(p.id)}</th><td>${esc(modeText(p.mode))}</td><td>${p.runs}</td><td>${p.firstTry}/${p.runs}</td><td>${pct(p.firstTryInterval.low)}–${pct(p.firstTryInterval.high)}</td><td>${p.afterRecovery}</td><td>${p.attention}</td><td>${p.medianTicks}</td><td>${mm(p.medianBeliefErrorAtCommitM)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
/** The line under the stage of a cell run: what the dashed belief and the solid truth are, or why nothing is drawn (never a ghost on top of the real cup). */
export function ghostLegendHtml(g:Ghosts):string{
 if(g.status==='data')return `<p class="field-help" data-testid="belief-legend" data-state="data"><span class="legend-belief" aria-hidden="true">◌</span> ${tr('vị trí tin (nét đứt)','信じる位置(破線)','believed position (dashed)')} · <span aria-hidden="true">●</span> ${tr('vị trí thật khi quan sát (đặc, chỉ có trong mô phỏng)','観測時の真の位置(実線・シミュレーションのみ)','true position when observed (solid, simulation only)')} · ${g.items.map(i=>`${esc(i.objectId)} ↔ ${i.errorMm===null?'—':mm(i.errorMm/1000)} mm`).join(', ')}</p>`;
 return `<p class="field-help" data-testid="belief-legend" data-state="${g.status}">${g.status==='none'?tr('Không có dữ liệu nhận thức','認識データなし','No perception data'):tr('Không có dữ liệu nhận thức tại thời điểm này','この時点の認識データなし','No perception data at this point')}</p>`;
}
