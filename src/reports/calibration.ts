// R4.5 (V15): the calibration screen and the model-maturity badge. A calibration record (and, optionally, the measured and predicted series it was judged on) is read from a LOCAL file: the Lab never fetches
// it, uploads it or runs the tool that made it, and the screen works without a runtime. The maturity of the model comes only from the runtime's health (a function of where its parameters came from);
// a record on this screen never changes a badge. Read-only: it counts what was recorded and says nothing is certified.
import type {CalibrationRecordV1} from '../shared/navigation2d';
import {tr} from '../i18n';
import {esc} from '../ui/icons';
import {linePlot,plotTable,sig,type PlotSeries} from '../ui/svg-plot';

export type MaturityLevel='illustrative'|'assumed'|'nominal'|'calibrated';
export const MATURITY_GROUPS=['geometry','inertia','drive','contact','sensing'] as const;
export type MaturityGroup=typeof MATURITY_GROUPS[number];
export type MaturityLevels=Record<MaturityGroup,MaturityLevel>;
const RANK:Record<MaturityLevel,number>={illustrative:0,assumed:1,nominal:2,calibrated:3};
const isLevel=(v:unknown):v is MaturityLevel=>typeof v==='string'&&Object.hasOwn(RANK,v);
const isObject=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);

/** The `modelMaturity` of a health: per plant provider, every group with a known level. Anything else (absent, an unknown level or group, a missing group) is no maturity at all, never a partial badge. */
export function maturityOf(health:unknown):Record<string,MaturityLevels>|null{
 const m=isObject(health)?health.modelMaturity:undefined;
 if(!isObject(m)||!Object.keys(m).length)return null;
 for(const plant of Object.values(m)){
  if(!isObject(plant)||Object.keys(plant).length!==MATURITY_GROUPS.length||!MATURITY_GROUPS.every(g=>isLevel(plant[g])))return null;
 }
 return structuredClone(m) as Record<string,MaturityLevels>;
}
/** A plant is as mature as its weakest group. */
export const overallLevel=(levels:MaturityLevels):MaturityLevel=>MATURITY_GROUPS.map(g=>levels[g]).reduce((a,b)=>RANK[b]<RANK[a]?b:a);
const LEVEL_WORDS:Record<MaturityLevel,()=>string>={illustrative:()=>tr('Minh họa','イラスト','Illustrative'),assumed:()=>tr('Giả định','仮定','Assumed'),nominal:()=>tr('Danh định','公称','Nominal'),calibrated:()=>tr('Đã hiệu chuẩn','校正済み','Calibrated')};
const GROUP_WORDS:Record<MaturityGroup,()=>string>={geometry:()=>tr('Hình học','形状','Geometry'),inertia:()=>tr('Quán tính','慣性','Inertia'),drive:()=>tr('Drive','ドライブ','Drive'),contact:()=>tr('Tiếp xúc','接触','Contact'),sensing:()=>tr('Cảm biến','センシング','Sensing')};
/** The level in words (never by colour alone), every group, and what a level is not. Empty without a plant. */
export function maturityBadgeHtml(levels:MaturityLevels|null,options:{testid:string}):string{
 if(!levels)return '';
 const level=overallLevel(levels);
 return `<span class="maturity-badge" data-testid="${esc(options.testid)}" data-level="${level}"><strong>${tr('Mức model','モデルの成熟度','Model maturity')}: ${esc(LEVEL_WORDS[level]())}</strong> <span class="maturity-groups">${MATURITY_GROUPS.map(g=>`<span class="maturity-group" data-group="${g}" data-level="${levels[g]}">${esc(GROUP_WORDS[g]())}: ${esc(LEVEL_WORDS[levels[g]]())}</span>`).join(' · ')}</span> <small class="field-help">${tr('Mức cho biết nguồn của tham số, không phải một tuyên bố an toàn.','成熟度はパラメータの出典を示すもので、安全性の保証ではありません。','A level says where the parameters come from; it is not a safety statement.')}</small></span>`;
}

const ILLUSTRATIVE:MaturityLevels={geometry:'illustrative',inertia:'illustrative',drive:'illustrative',contact:'illustrative',sensing:'illustrative'};
/** The levels of the plant a run (or a preset) uses: a mock backend is illustrative everywhere; a MuJoCo plant has what the runtime's health lists for it; anything else is not rated here. */
export function maturityForBackends(backends:readonly string[]|null,health:unknown):MaturityLevels|null{
 if(!backends?.length)return null;
 if(backends.some(b=>b.startsWith('mock')))return {...ILLUSTRATIVE};
 const m=maturityOf(health);
 return backends.includes('mujoco_arm')?m?.mujoco_arm??null:backends.includes('mujoco_3d')?m?.mujoco_3d??null:null;
}
/** What a run's own report says (`manifest.calibration.modelMaturity`, when the run is of a MuJoCo plant that rates itself), else the plant of its backends. */
export function maturityOfReport(report:unknown,health:unknown):MaturityLevels|null{
 const m=(report as {manifest?:{calibration?:{modelMaturity?:unknown};backends?:{id:string}[]}}|null)?.manifest;
 const own=m?.calibration?.modelMaturity;
 if(isObject(own)&&Object.keys(own).length===MATURITY_GROUPS.length&&MATURITY_GROUPS.every(g=>isLevel(own[g])))return {...own} as MaturityLevels;
 return maturityForBackends(Array.isArray(m?.backends)?m!.backends!.map(b=>b.id):null,health);
}

// ---- the calibration screen -------------------------------------------------------------------------------------------------------------------------------------
export type CalibrationLabel='measured'|'synthetic'|'self_test';
export interface CalibrationPlot {trialId:string;channel:string;unit:string;measured:[number,number][];predicted:[number,number][]}
export interface CalibrationView {record:CalibrationRecordV1;label:CalibrationLabel;/** `valid`: the record's configuration is the plant's, for that axis. `unchecked`: no runtime to compare with. */validity:'valid'|'unchecked';axisId:string|null;plot:CalibrationPlot|null}
export type CalibrationRead={ok:true;view:CalibrationView}|{ok:false;reason:string};
const LIMIT_BYTES=8*1024*1024,HEX=/^[0-9a-f]{64}$/,finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const num=(v:unknown)=>finite(v);

function recordOk(x:unknown):x is CalibrationRecordV1{
 if(!isObject(x)||x.schemaVersion!==1||x.documentType!=='calibration-record'||x.accepted!==false||typeof x.toolSelfTest!=='boolean'||!['measured','synthetic'].includes(x.sourceKind as string))return false;
 if(!['digest','planDigest','datasetDigest','configDigest','baseDriveModelDigest','fitDigest'].every(k=>typeof x[k]==='string'&&HEX.test(x[k] as string)))return false;
 if(!Array.isArray(x.fitted)||!x.fitted.length||!x.fitted.every(f=>isObject(f)&&typeof f.path==='string'&&num(f.value)&&typeof f.atBound==='boolean'&&typeof f.unit==='string'&&(f.standardError===null||num(f.standardError))))return false;
 const c=x.convergence,v=x.validation;
 if(!isObject(c)||!num(c.iterations)||typeof c.converged!=='boolean'||!num(c.objectiveInitial)||!num(c.objectiveFinal)||!(c.jacobianCondition===null||num(c.jacobianCondition)))return false;
 if(!isObject(v)||!['pass','fail','not_run'].includes(v.status as string)||!Array.isArray(v.reasons)||!isObject(v.residuals)||!Object.values(v.residuals).every(r=>isObject(r)&&num(r.samples)&&num(r.meanAbs)&&num(r.maxAbs)&&typeof r.withinTolerance==='boolean'))return false;
 if(!isObject(x.domain)||!Object.values(x.domain).every(d=>isObject(d)&&num(d.min)&&num(d.max))||!Array.isArray(x.reasonCodes)||!x.reasonCodes.every(r=>typeof r==='string'))return false;
 if(!Array.isArray(x.produced)||!x.produced.every(p=>isObject(p)&&['drive_model','arm_physics'].includes(p.document as string)&&typeof p.id==='string'&&Number.isSafeInteger(p.revision)&&typeof p.digest==='string'&&HEX.test(p.digest)))return false;
 // a record that produced a revision must be one the tool could have written: measured, not the self-test, converged, inside its bounds, and passed on the held-out split
 return !x.produced.length||(x.sourceKind==='measured'&&!x.toolSelfTest&&v.status==='pass'&&c.converged===true&&x.fitted.every(f=>!(f as {atBound:boolean}).atBound));
}
function plotOf(bundle:Record<string,unknown>):CalibrationPlot|null{
 const ds=bundle.dataset,pr=bundle.prediction;
 if(!isObject(ds)||!isObject(pr)||!Array.isArray(ds.trials)||!Array.isArray(pr.trials)||!isObject(ds.clockMapping)||!finite(ds.clockMapping.offsetNs))return null;
 for(const t of ds.trials as unknown[]){
  if(!isObject(t)||t.split!=='validation'||typeof t.trialId!=='string'||!Array.isArray(t.timesNs)||!isObject(t.channels))continue;
  const p=(pr.trials as unknown[]).find(q=>isObject(q)&&q.trialId===t.trialId);if(!isObject(p)||!Array.isArray(p.timesNs)||!isObject(p.channels))continue;
  const pc=p.channels as Record<string,unknown>,channel=Object.keys(t.channels).includes('position')?'position':Object.keys(t.channels).find(c=>Array.isArray(pc[c]));
  const m=channel?t.channels[channel]:null,q=channel?pc[channel]:null;
  if(!channel||!Array.isArray(m)||!Array.isArray(q)||m.length!==t.timesNs.length||q.length!==p.timesNs.length||m.length>100000||q.length>100000||![...m,...q,...t.timesNs,...p.timesNs].every(finite))continue;
  const unit=isObject(ds.units)&&typeof ds.units[channel]==='string'?ds.units[channel] as string:'';
  // the measured clock plus its declared offset is the prediction's clock (the assessor's own rule); seconds on the screen
  return {trialId:t.trialId,channel,unit,measured:(t.timesNs as number[]).map((x,i)=>[(x+(ds.clockMapping as {offsetNs:number}).offsetNs)/1e9,m[i] as number]),predicted:(p.timesNs as number[]).map((x,i)=>[x/1e9,q[i] as number])};
 }
 return null;
}
/** A local file: a calibration record, or `{record, dataset?, prediction?}` (the record and the series it was judged on). `current.configDigests`: the runtime's digest of the measured configuration of each bench axis
 * (health `calibrationConfigDigests`), or null without a runtime. A record whose configuration is none of the plant's is refused with CONFIG_DIGEST_MISMATCH and shows nothing of its values. */
export function readCalibrationFile(text:string,current:{configDigests:Record<string,string>|null}):CalibrationRead{
 if(text.length>LIMIT_BYTES)return {ok:false,reason:'CALIBRATION_FILE_LIMIT'};
 let x:unknown;try{x=JSON.parse(text);}catch{return {ok:false,reason:'CALIBRATION_FILE_INVALID'};}
 const bundle=isObject(x)&&isObject(x.record)?x:null,record=bundle?bundle.record:x;
 if(!recordOk(record))return {ok:false,reason:'CALIBRATION_FILE_INVALID'};
 let axisId:string|null=null;
 if(current.configDigests){
  axisId=Object.entries(current.configDigests).find(([,d])=>d===record.configDigest)?.[0]??null;
  if(!axisId)return {ok:false,reason:'CONFIG_DIGEST_MISMATCH'};
 }
 const label:CalibrationLabel=record.toolSelfTest?'self_test':record.sourceKind==='synthetic'?'synthetic':'measured';
 return {ok:true,view:{record,label,validity:axisId?'valid':'unchecked',axisId,plot:bundle?plotOf(bundle):null}};
}

const ERROR_WORDS:Record<string,()=>string>={
 CONFIG_DIGEST_MISMATCH:()=>tr('Bản ghi thuộc plant hoặc cấu hình khác với plant đang mở (hết hiệu lực hoặc không phải của plant này). Không hiển thị giá trị của nó.','このレコードは開いているプラントとは別のプラント/構成のものです(無効、または対象外)。値は表示しません。','The record belongs to another plant or configuration than the one open (expired, or not this plant’s). Its values are not shown.'),
 CALIBRATION_FILE_INVALID:()=>tr('Tệp không phải bản ghi hiệu chuẩn hợp lệ (đúng loại, accepted:false, đủ trường).','校正レコードとして有効なファイルではありません(種別、accepted:false、必須項目)。','The file is not a valid calibration record (document type, accepted:false, required fields).'),
 CALIBRATION_FILE_LIMIT:()=>tr('Tệp quá lớn (tối đa 8 MiB).','ファイルが大きすぎます(最大8 MiB)。','The file is too large (8 MiB at most).')};
const REASON_WORDS:Record<string,()=>string>={
 SYNTHETIC_DATA:()=>tr('dữ liệu tổng hợp, không phải số đo','合成データであり計測値ではない','synthetic data, not measurements'),TOOL_SELF_TEST:()=>tr('tự kiểm công cụ','ツールの自己検証','tool self-test'),
 NOT_CONVERGED:()=>tr('fit không hội tụ','フィットが収束しなかった','the fit did not converge'),PARAMETER_AT_BOUND:()=>tr('tham số chạm biên','パラメータが境界に達した','a parameter ended on its bound'),
 IDENTIFIABILITY_POOR:()=>tr('không tách được các tham số','パラメータを分離できない','the parameters cannot be told apart'),VALIDATION_FAILED:()=>tr('không đạt trên tập validation giữ lại','保留した検証データで不合格','failed on the held-out validation split'),
 CONFIG_DIGEST_MISMATCH:()=>tr('dataset thuộc cấu hình khác','データセットは別の構成のもの','the dataset is for another configuration'),PREDICTION_FAILED:()=>tr('không chạy được dự đoán','予測を実行できなかった','the prediction could not run')};
const labelWords:Record<CalibrationLabel,()=>string>={
 measured:()=>tr('Số đo','計測値','Measured'),synthetic:()=>tr('Dữ liệu tổng hợp (không phải số đo)','合成データ(計測値ではない)','Synthetic data (not measured)'),
 self_test:()=>tr('Tự kiểm công cụ: dữ liệu tổng hợp, không phải số đo','ツールの自己検証:合成データであり計測値ではありません','Tool self-test: synthetic data, not measured')};

/** The empty state (no file), the refusal of a file (its code and words, none of its values) or the record. */
export function calibrationHtml(view:CalibrationView|null,error:string|null):string{
 if(error)return `<div class="calibration-view" data-testid="calibration-screen"><p class="field-error" role="alert" data-testid="calibration-error"><code>${esc(error)}</code> ${esc((ERROR_WORDS[error]??(()=>''))())}</p></div>`;
 if(!view)return `<div class="calibration-view" data-testid="calibration-screen"><p class="field-help" data-testid="calibration-empty" role="status">${tr('Chưa có dữ liệu hiệu chuẩn. Nhập một bản ghi hiệu chuẩn (JSON, tệp cục bộ). Mức model không đổi.','校正データはまだありません。校正レコード(JSON、ローカルファイル)を読み込んでください。モデルの成熟度は変わりません。','No calibration data yet. Import a calibration record (JSON, a local file). The model maturity does not change.')}</p></div>`;
 const r=view.record,c=r.convergence;
 const fitted=`<table class="eng-table" data-testid="calibration-fitted"><thead><tr><th scope="col">${tr('Tham số','パラメータ','Parameter')}</th><th scope="col">${tr('Giá trị','値','Value')}</th><th scope="col">${tr('Đơn vị','単位','Unit')}</th><th scope="col">±${tr('sai số chuẩn','標準誤差','standard error')}</th><th scope="col">${tr('Biên','境界','Bound')}</th></tr></thead><tbody>${r.fitted.map(f=>`<tr data-bound="${f.atBound}"><th scope="row"><code>${esc(f.path)}</code></th><td>${esc(sig(f.value))}</td><td>${esc(f.unit)}</td><td>${f.standardError===null?'—':esc(sig(f.standardError))}</td><td>${f.atBound?`⚠ ${tr('chạm biên','境界に到達','at bound')}`:'—'}</td></tr>`).join('')}</tbody></table>`;
 const residuals=Object.entries(r.validation.residuals),resTable=`<table class="eng-table" data-testid="calibration-residuals"><thead><tr><th scope="col">${tr('Kênh','チャンネル','Channel')}</th><th scope="col">${tr('Mẫu','サンプル','Samples')}</th><th scope="col">${tr('Trung bình |sai số|','平均|誤差|','Mean |error|')}</th><th scope="col">${tr('Lớn nhất |sai số|','最大|誤差|','Max |error|')}</th><th scope="col">${tr('Trong dung sai','許容内','Within tolerance')}</th></tr></thead><tbody>${residuals.length?residuals.map(([k,v])=>`<tr><th scope="row"><code>${esc(k)}</code></th><td>${esc(v.samples)}</td><td>${esc(sig(v.meanAbs))}</td><td>${esc(sig(v.maxAbs))}</td><td>${v.withinTolerance?tr('có','はい','yes'):tr('không','いいえ','no')}</td></tr>`).join(''):`<tr><td colspan="5">${tr('Không có residual (đánh giá dừng ở bước cấu trúc).','残差なし(評価は構造チェックで停止)。','No residuals (the assessment stopped at its structural checks).')}</td></tr>`}</tbody></table>`;
 const domain=Object.entries(r.domain),domTable=`<table class="eng-table" data-testid="calibration-domain"><thead><tr><th scope="col">${tr('Kênh','チャンネル','Channel')}</th><th scope="col">min</th><th scope="col">max</th></tr></thead><tbody>${domain.map(([k,v])=>`<tr><th scope="row"><code>${esc(k)}</code></th><td>${esc(sig(v.min))}</td><td>${esc(sig(v.max))}</td></tr>`).join('')||`<tr><td colspan="3">—</td></tr>`}</tbody></table>`;
 const plot=view.plot?`<figure data-testid="calibration-plot">${linePlot([{id:'measured',label:tr('đo','計測','measured'),points:view.plot.measured},{id:'predicted',label:tr('dự đoán','予測','predicted'),points:view.plot.predicted,dashed:true}] as PlotSeries[],{width:560,height:220,xLabel:'t (s)',yLabel:`${view.plot.channel}${view.plot.unit?` (${view.plot.unit})`:''}`,title:`${tr('Đo và dự đoán','計測と予測','Measured and predicted')} · ${view.plot.trialId}`})}<details><summary>${tr('Bảng','表','Table')}</summary>${plotTable([{id:'measured',label:tr('đo','計測','measured'),points:view.plot.measured},{id:'predicted',label:tr('dự đoán','予測','predicted'),points:view.plot.predicted}],12)}</details></figure>`
  :`<p class="field-help" data-testid="calibration-no-series">${tr('Không có chuỗi đo/dự đoán trong tệp này (tệp so sánh gồm record, dataset và prediction).','このファイルに計測/予測の系列はありません(比較ファイルは record、dataset、prediction を含みます)。','No measured/predicted series in this file (a comparison file holds the record, the dataset and the prediction).')}</p>`;
 const validity=view.validity==='valid'?tr(`Hợp lệ cho cấu hình của trục ${esc(view.axisId)}. Đổi plant, tải hoặc bộ trục làm bản ghi hết hiệu lực.`,`軸 ${esc(view.axisId)} の構成に対して有効です。プラント、負荷、軸の構成が変わると無効になります。`,`Valid for the configuration of axis ${esc(view.axisId)}. A changed plant, load or axis set makes it expire.`)
  :tr('Chưa kiểm tra: cần runtime để so với cấu hình của plant.','未確認:プラント構成との照合にはランタイムが必要です。','Not checked: a runtime is needed to compare it with the plant’s configuration.');
 const produced=r.produced.length?tr(`Sinh ${r.produced.length} revision mới: ${r.produced.map(p=>`${esc(p.document)} r${esc(p.revision)}`).join(', ')}.`,`新しいリビジョンを ${r.produced.length} 件生成: ${r.produced.map(p=>`${esc(p.document)} r${esc(p.revision)}`).join(', ')}。`,`Produced ${r.produced.length} new revision(s): ${r.produced.map(p=>`${esc(p.document)} r${esc(p.revision)}`).join(', ')}.`):tr('Không sinh revision.','リビジョンは生成されませんでした。','No revision produced.');
 return `<div class="calibration-view" data-testid="calibration-screen"><section data-testid="calibration-record" data-label="${view.label}" data-validity="${view.validity}" aria-labelledby="calibration-title"><h3 id="calibration-title">${tr('Bản ghi hiệu chuẩn','校正レコード','Calibration record')} · <span class="pill" data-testid="calibration-label">${esc(labelWords[view.label]())}</span></h3>`
  +`<p data-testid="calibration-validity" role="status">${validity}</p><p>${produced} ${r.reasonCodes.length?`<ul class="calibration-reasons" data-testid="calibration-reasons">${r.reasonCodes.map(c2=>`<li><code>${esc(c2)}</code> ${esc((REASON_WORDS[c2]??(()=>''))())}</li>`).join('')}</ul>`:''}</p>`
  +`<h4>${tr('Tham số đã fit','フィットしたパラメータ','Fitted parameters')}</h4>${fitted}<p class="field-help" data-testid="calibration-convergence">${tr('Vòng lặp','反復','Iterations')} ${esc(c.iterations)} · ${c.converged?tr('hội tụ','収束','converged'):tr('không hội tụ','収束せず','not converged')} · ${tr('hàm mục tiêu','目的関数','objective')} ${esc(sig(c.objectiveInitial))} → ${esc(sig(c.objectiveFinal))} · ${tr('số điều kiện Jacobian','ヤコビアン条件数','Jacobian condition')} ${c.jacobianCondition===null?'∞':esc(sig(c.jacobianCondition))}</p>`
  +`<h4>${tr('Tập validation giữ lại','保留した検証データ','Held-out validation')}: <span data-testid="calibration-status">${esc(r.validation.status)}</span></h4>${resTable}<h4>${tr('Miền hiệu lực (đã đo)','有効範囲(計測済み)','Domain (measured)')}</h4>${domTable}${plot}`
  +`<p class="field-help">${tr('Khớp số đo trong một miền không nói gì về hành vi ngoài miền đó. Mức model do runtime báo, bản ghi này không đổi nó.','計測値との一致は、その範囲の外での挙動については何も示しません。モデルの成熟度はランタイムが報告し、このレコードでは変わりません。','Matching measurements inside a domain says nothing about behaviour outside it. The model maturity is the runtime’s report; this record does not change it.')}</p></section></div>`;
}
