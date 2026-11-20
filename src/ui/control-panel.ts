// The Control tab of the twin workspace (R4.2 §6.3, V07): pick an axis, edit its gains inside the envelope the runtime serves, run a single-axis bench on the
// pinned runtime, read the recorded trace as plots and the response metrics, compare with the previous bench, take a model-based starting point, export and import
// a control profile. It shares the workspace's runtime client and pairing and never touches the twin's own run or preset. A bench locks its draft when it is
// created (later edits go to the next one); a finished bench is read once (report, then trace) and archived, so tuning never fills the runtime's open-run limit.
import type {AxisControl,AxisEnvelope,ControlProfileV1,DriveTrace,GainSuggestion,TuningResultV1} from '../shared/navigation2d';
import {TwinRuntimeError,type BenchCreateRun,type RunView,type TwinHealth,type TwinRuntime} from '../scenarios/controls';
import {BENCH_SET,DRAFT_FIELDS,MAX_PROFILE_BYTES,benchDraft,draftOf,exportControlProfile,importControlProfile,offeredFields,parseDraft,parseSignal,sizesFor,traceSeries,
 type BenchAxisName,type BenchCatalogAxis,type BenchCatalogEntry,type BenchScenarioId,type BenchSignals,type DraftField,type DriveExperimentId,type SignalDraft,type WorkbenchDraft} from '../control/workbench';
import {reasonWords,tuningHtml} from '../reports/control';
import {linePlot,plotTable,sig,type PlotSeries} from './svg-plot';
import {esc,icon} from './icons';
import {locale,tr} from '../i18n';

/** Ticks per step request (unpaced): a stop waits behind at most one such batch. The seed and scenario revision are the bench's only (registry revision 1). */
const STEP_TICKS=50,SEED=7,SCENARIO_REVISION=1;
export interface ControlHost {rt():TwinRuntime;health():TwinHealth|null;pinBlock():string[]|null;render():void}
interface Bench {runId:string;scenarioId:BenchScenarioId;axis:BenchAxisName;unit:string;base:ControlProfileV1;control:AxisControl;sourceCommit:string;status:string;tuning:TuningResultV1|null;trace:DriveTrace|null;issues:string[]}
type Pick={scenarioId:BenchScenarioId;entry:BenchCatalogEntry;axis:BenchCatalogAxis};
type Ctx={ok:false;reason:string}|(Pick&{ok:true;h:TwinHealth;signals:BenchSignals;axes:Pick[];envelope:AxisEnvelope;experiments:DriveExperimentId[];experiment:DriveExperimentId;driveModelDigest:string;lastTick:number});
/** Server reason codes that name one field of the form: shown at that field; every code is also listed under the form. */
const FIELD_OF:Record<string,string>={INTEGRAL_LIMIT_REQUIRED:'integralLimit',INTEGRAL_LIMIT_WITHOUT_KI:'integralLimit',CSV_KD_NONZERO:'kd',CSV_SLEW_LIMIT:'slewLimit',CSP_ACCELERATION_LIMIT:'accelerationLimit',
 AMPLITUDE_NOT_REGISTERED:'size',JOINT_LIMIT_EXCEEDED:'size',WHEEL_REVERSE_UNSUPPORTED:'size',TICK_OUT_OF_RANGE:'atTick',SIGNAL_TOO_LONG:'atTick',DISTANCE_ZERO:'distance'};
const SIGNAL_FIELDS=['size','atTick','distance','peakVelocity','acceleration','ticks'] as const;
const codeWords=(c:string)=>({UNPAIRED:tr('ghép nối một runtime trước (hộp runtime trên thanh run)','先にランタイムをペアリングしてください(実行バーのランタイム枠)','pair a runtime first (the runtime box on the run bar)'),RUNTIME_UNREACHABLE:tr('không có trả lời từ runtime','ランタイムから応答がありません','no answer from the runtime'),
 BENCH_UNAVAILABLE:tr('runtime này không có bàn chỉnh (cần MuJoCo)','このランタイムにはベンチがありません(MuJoCoが必要)','this runtime offers no bench (it needs MuJoCo)'),BENCH_CATALOG_INVALID:tr('danh mục bench của runtime thiếu trục hoặc model drive','ランタイムのベンチカタログに軸かドライブモデルがありません','the runtime’s bench catalog lacks the axis or the drive model'),
 RUNTIME_PIN_MISMATCH:tr('runtime không phải bản Lab ghim: không tạo lần chạy','ランタイムがLabの固定版ではありません:実行は作成しません','the runtime is not the Lab’s pin: no run is created'),MUJOCO_CAPACITY:tr('engine MuJoCo đang bận với một lần chạy khác (một world mỗi runtime)','MuJoCoエンジンは別の実行で使用中(ランタイムごとに1ワールド)','the MuJoCo engine is busy with another run (one world per runtime)'),
 RUN_LIMIT:tr('runtime đã giữ 20 lần chạy mở','ランタイムの実行が上限の20件','the runtime already holds 20 open runs'),GAIN_OUT_OF_ENVELOPE:tr('một gain ngoài biên server','ゲインがサーバーの範囲外','a gain is outside the server’s bounds'),
 INTEGRAL_LIMIT_REQUIRED:tr('Ki > 0 cần giới hạn tích phân','Ki > 0 には積分制限が必要','Ki > 0 needs an integral limit'),INTEGRAL_LIMIT_WITHOUT_KI:tr('giới hạn tích phân chỉ dùng khi Ki > 0','積分制限は Ki > 0 のときのみ','an integral limit only goes with Ki > 0'),
 AMPLITUDE_NOT_REGISTERED:tr('kích thước không thuộc tập đăng ký','登録外のサイズ','a size outside the registered set'),JOINT_LIMIT_EXCEEDED:tr('vượt giới hạn khớp từ tư thế bench','ベンチ姿勢から関節制限を超える','past the joint limit from the bench pose'),WHEEL_REVERSE_UNSUPPORTED:tr('bánh chỉ chạy tới','車輪は前進のみ','wheels run forward only'),
 TICK_OUT_OF_RANGE:tr('tín hiệu không vừa trong 500 tick sau khi drive bật','ドライブ有効化後の500 tickに収まらない','the signal does not fit in the 500 ticks after the drive enables'),SIGNAL_TOO_LONG:tr('chuyển động dài hơn bench','動作がベンチより長い','the motion is longer than the bench'),
 DIGEST_MISMATCH:tr('digest không khớp nội dung','ダイジェストが内容と一致しない','the digest does not match the content'),DRIVE_PLANT_MISMATCH:tr('profile của plant khác','別のプラントのプロファイル','a profile of another plant'),DRIVE_MODEL_DIGEST_MISMATCH:tr('profile không khai báo model drive này','このドライブモデル向けに宣言されていない','not declared for this drive model'),
 AXIS_SET_MISMATCH:tr('bộ trục khác với plant','軸の構成がプラントと異なる','another set of axes than the plant'),INVALID_JSON:tr('không phải JSON','JSONではない','not JSON'),SCHEMA_INVALID:tr('không đúng schema ControlProfileV1','ControlProfileV1スキーマに合わない','does not match the ControlProfileV1 schema'),
 PROFILE_TOO_LARGE:tr('file quá lớn (tối đa 1 MiB)','ファイルが大きすぎる(最大1 MiB)','file too large (1 MiB at most)'),NON_FINITE_NUMBER:tr('có số không hữu hạn','有限でない数値を含む','holds a non-finite number')} as Record<string,string>)[c]??reasonWords(c);
const axisName=(a:BenchAxisName)=>a==='wheels'?tr('Hai bánh','両輪','Both wheels'):a==='gripper'?tr('Kẹp','グリッパー','Gripper'):a;
const kindName=(k:string)=>({step:tr('Bước','ステップ','Step'),trapezoid:tr('Hình thang','台形','Trapezoid'),hold:tr('Giữ','保持','Hold')} as Record<string,string>)[k]??k;
const signalText=(s:TuningResultV1['signal'])=>s.kind==='step'?`${kindName('step')} ${sig(s.amplitude)} @${s.atTick}`:s.kind==='trapezoid'?`${kindName('trapezoid')} ${sig(s.distance)} / ${sig(s.peakVelocity)} / ${sig(s.acceleration)} @${s.atTick}`:`${kindName('hold')} ${s.ticks}`;
const GAIN_LABEL=():Record<DraftField,string>=>({kp:'Kp',ki:'Ki',kd:'Kd',integralLimit:tr('Giới hạn tích phân','積分制限','Integral limit'),slewLimit:tr('Giới hạn tốc độ đổi lệnh','スルー制限','Slew limit'),accelerationLimit:tr('Giới hạn gia tốc','加速度制限','Acceleration limit')});
export class ControlPanel {
 /** idle, or where the one bench in flight is: creating, running (stepping), reading (its report and trace). */
 phase:'idle'|'creating'|'running'|'reading'='idle';
 private stopAsked=false;private progress=0;private axis:BenchAxisName|null=null;private experiment:DriveExperimentId='drive-nominal-v1';
 /** Per bench scenario the profile drafts start from: the last imported one, else the served startingProfile. Per axis the typed fields. */
 private bases:Partial<Record<BenchScenarioId,ControlProfileV1>>={};private drafts:Partial<Record<BenchAxisName,WorkbenchDraft>>={};private signals:Partial<Record<BenchAxisName,SignalDraft>>={};
 private errors:Record<string,string>={};private reasons:string[]=[];private notice='';private noticeOk=false;private suggestion=0;private tableOpen=false;
 /** The latest benches, newest last; only the newest keeps its trace (up to ~1 MB) for the plots. */
 private history:Bench[]=[];private plotCache={key:'',plots:'',table:''};
 constructor(private host:ControlHost){}
 private ctx():Ctx{
  const h=this.host.health();
  if(!this.host.rt().paired)return {ok:false,reason:'UNPAIRED'};
  if(!h)return {ok:false,reason:'RUNTIME_UNREACHABLE'};
  const entries=Object.entries(h.benchCatalog??{}) as [BenchScenarioId,BenchCatalogEntry][],signals=h.benchSignals,envelope=h.tuningEnvelope;
  if(!entries.length||!signals||!envelope)return {ok:false,reason:'BENCH_UNAVAILABLE'};
  const axes=entries.flatMap(([scenarioId,entry])=>(entry.axes??[]).map(axis=>({scenarioId,entry,axis}))),pick=axes.find(p=>p.axis.axis===this.axis)??axes[0];
  const experiments=Object.keys(pick?.entry.experiments??{}) as DriveExperimentId[],experiment=experiments.includes(this.experiment)?this.experiment:experiments.includes('drive-nominal-v1')?'drive-nominal-v1':experiments[0];
  const env=envelope.axes.find(e=>e.axisId===pick?.axis.axisIds[0]),x=experiment&&pick?.entry.experiments[experiment];
  if(!pick||!env||!x||!experiment)return {ok:false,reason:'BENCH_CATALOG_INVALID'};
  return {...pick,ok:true,h,signals,axes,envelope:env,experiments,experiment,driveModelDigest:x.driveModelDigest,lastTick:signals.maxTicks-x.anchorTick};
 }
 /** Morph rewrites attributes only, and a field once typed in no longer follows its value attribute: after a render the fields take the draft's values
  *  (an axis change, an import or a suggestion changes them; the field being typed in already holds its draft). */
 private paint(){
  this.host.render();
  const c=typeof document.getElementById==='function'?this.ctx():null;if(!c?.ok)return;
  const d=this.draft(c),s=this.signal(c),values:Record<string,string>={kind:s.kind,experiment:c.experiment,suggest:String(this.suggestion)};
  for(const k of DRAFT_FIELDS)values[k]=d[k];for(const k of SIGNAL_FIELDS)values[k]=s[k];
  for(const [k,v] of Object.entries(values)){const el=document.getElementById(`twin-ctl-${k}`) as HTMLInputElement|HTMLSelectElement|null;if(el&&el.value!==v&&(!(el instanceof HTMLSelectElement)||[...el.options].some(o=>o.value===v)))el.value=v;}
  const radio=document.getElementById(`twin-ctl-axis-${c.axis.axis}`) as HTMLInputElement|null;if(radio&&!radio.checked)radio.checked=true;
 }
 private base(c:Pick){return this.bases[c.scenarioId]??c.entry.startingProfile;}
 private draft(c:Pick):WorkbenchDraft{const id=c.axis.axisIds[0]!;return this.drafts[c.axis.axis]??=draftOf(this.base(c).axes.find(a=>a.axisId===id)??{axisId:id,loop:{kp:0,ki:0,kd:0,integralLimit:null,slewLimit:null},accelerationLimit:null});}
 private signal(c:Extract<Ctx,{ok:true}>):SignalDraft{
  const sizes=sizesFor(c.axis,c.signals),csv=c.axis.mode==='csv';
  return this.signals[c.axis.axis]??={kind:'step',size:String(sizes.find(x=>x>0)??sizes[0]??''),atTick:'10',distance:csv?'4':'',peakVelocity:csv?'':'0.5',acceleration:csv?'10':'2',ticks:'100'};
 }
 /** The reason of one field now (or none): the same parse a run does. */
 private check(c:Extract<Ctx,{ok:true}>,k:string){
  const g=parseDraft(this.draft(c),c.envelope),s=parseSignal(this.signal(c),c.axis.mode,c.lastTick),why=(!g.ok?g.fields[k]:undefined)??(!s.ok?s.fields[k]:undefined);
  if(why)this.errors[k]=why;else delete this.errors[k];
 }
 private suggestions(c:Pick):GainSuggestion[]{return [...this.history].reverse().find(b=>b.axis===c.axis.axis&&b.tuning?.suggestions?.length)?.tuning?.suggestions??[];}
 /** One bench: the draft and signal as they are now (later edits go to the next bench), create, start, step until it ends or a stop is asked, read its report and trace once, archive. */
 async run():Promise<void>{
  if(this.phase!=='idle')return;
  const c=this.ctx();if(!c.ok||this.host.pinBlock())return this.paint();
  const g=parseDraft(this.draft(c),c.envelope),s=parseSignal(this.signal(c),c.axis.mode,c.lastTick);
  this.errors={...g.ok?{}:g.fields,...s.ok?{}:s.fields};this.reasons=[];this.notice='';
  if(!g.ok||!s.ok)return this.paint();
  const base=this.base(c),control=g.control,rt=this.host.rt(),h=c.h;
  const request:BenchCreateRun={scenarioId:c.scenarioId,scenarioRevision:SCENARIO_REVISION,seed:SEED,mode:'simulation',backendSetId:BENCH_SET,access:'simulated',
   bench:{schemaVersion:1,scenarioId:c.scenarioId,axis:c.axis.axis,signal:s.signal,driveExperimentId:c.experiment,controlProfile:benchDraft(base,control,c.axis.axisIds)}};
  this.phase='creating';this.stopAsked=false;this.progress=0;this.paint();
  let v:RunView|null=null;
  try{
   v=await rt.create(request,{sourceCommit:h.sourceCommit,schemaHash:h.schemaHash});
   if(!this.stopAsked){v=await rt.action(v,'start');this.phase='running';this.paint();}
   while(v.run.status==='running'&&!this.stopAsked){v=await rt.action(v,'step',{ticks:STEP_TICKS});this.progress=v.tick;this.paint();}
   // a stop asked while a step was in flight goes with the revision that step returned; "stopping" stays until the runtime answers it
   if(this.stopAsked&&['running','paused'].includes(v.run.status))v=await rt.action(v,'cancel');
   if(v.run.status!=='ready'){
    this.phase='reading';this.paint();
    const tuning=(await rt.report(v.run.id)).tuning??null,trace=tuning&&rt.trace?await rt.trace(v.run.id):null;
    for(const b of this.history)b.trace=null;
    this.history=[...this.history.slice(-7),{runId:v.run.id,scenarioId:c.scenarioId,axis:c.axis.axis,unit:c.axis.unit,base,control,sourceCommit:h.sourceCommit,status:v.run.status,tuning,trace:trace?.traces[0]??null,issues:[...trace?.issues??[],...v.attention.map(a=>a.reason)]}];
   }
  }catch(e){
   if(e instanceof TwinRuntimeError){
    this.reasons=e.reasonCodes.length?[...e.reasonCodes]:[e.code];this.notice=`${tr('Runtime từ chối','ランタイムが拒否','Runtime refused')}: ${e.code}`;this.noticeOk=false;
    for(const r of e.reasonCodes){const f=r==='TICK_OUT_OF_RANGE'&&request.bench.signal.kind==='hold'?'ticks':FIELD_OF[r];if(f)this.errors[f]=`${r}: ${codeWords(r)}`;}
   }else{this.notice=e instanceof Error?e.message:String(e);this.noticeOk=false;}
  }finally{
   // archived even when it failed or was refused after creation: a bench is never left open on the runtime (20 open runs at most); an archived bench is never reclaimed
   if(v){const id=v.run.id;await rt.archive?.(id).catch((e:unknown)=>{this.notice=`${this.notice?`${this.notice} · `:''}ARCHIVE_FAILED: ${e instanceof Error?e.message:String(e)}`;this.noticeOk=false;});rt.dropProof?.(id);}
   this.phase='idle';this.stopAsked=false;this.paint();
  }
 }
 click(action:string,_value?:string):void{
  if(action==='twin-ctl-cancel'){if(this.phase==='idle'||this.phase==='reading'||this.stopAsked)return;this.stopAsked=true;return this.paint();}
  const c=this.ctx();if(!c.ok)return;
  if(action==='twin-ctl-suggest-apply'){const g=this.suggestions(c)[this.suggestion];if(!g)return;this.drafts[c.axis.axis]=draftOf({axisId:c.axis.axisIds[0]!,loop:g.loop,accelerationLimit:g.accelerationLimit});for(const k of DRAFT_FIELDS)delete this.errors[k];return this.paint();}
  if(action==='twin-ctl-export')return this.export();
 }
 change(id:string,value:string):void{
  if(id==='twin-ctl-import')return this.importFile();
  const c=this.ctx();if(!c.ok)return;
  if(id.startsWith('twin-ctl-axis-')){if(c.axes.some(p=>p.axis.axis===value)){this.axis=value as BenchAxisName;this.errors={};this.reasons=[];this.suggestion=0;}}
  else if(id==='twin-ctl-experiment'){if((c.experiments as string[]).includes(value))this.experiment=value as DriveExperimentId;}
  else if(id==='twin-ctl-suggest')this.suggestion=Math.max(0,Math.trunc(Number(value))||0);
  else if(id==='twin-ctl-kind'){if((c.signals.kinds as string[]).includes(value)){this.signal(c).kind=value as SignalDraft['kind'];for(const k of SIGNAL_FIELDS)delete this.errors[k];}}
  else{this.input(id,value);this.check(c,id.slice('twin-ctl-'.length));}// a field left (blur, Enter): its reason now
  this.paint();
 }
 /** Typing: the value is kept as typed; a reason already shown goes (or changes) as soon as the value does, a new one waits until the field is left or the run. */
 input(id:string,value:string):void{
  const c=this.ctx(),k=id.slice('twin-ctl-'.length);if(!c.ok)return;
  if((DRAFT_FIELDS as readonly string[]).includes(k))this.draft(c)[k as DraftField]=value;
  else if((SIGNAL_FIELDS as readonly string[]).includes(k))this.signal(c)[k as typeof SIGNAL_FIELDS[number]]=value;
  else return;
  if(this.errors[k]){this.check(c,k);this.paint();}
 }
 /** The file chosen in the import field (read through the app's change routing, so a re-rendered field needs no listener of its own). */
 private importFile(){
  const i=typeof document.getElementById==='function'?document.getElementById('twin-ctl-import') as HTMLInputElement|null:null,f=i?.files?.[0];if(!i||!f)return;i.value='';
  if(f.size>MAX_PROFILE_BYTES)return this.refused(['PROFILE_TOO_LARGE']);
  void f.text().then(t=>this.importText(t),()=>this.refused(['INVALID_JSON']));
 }
 private refused(codes:string[]){this.notice=`${tr('Không nhập profile; bản nháp giữ nguyên','プロファイルを読み込みません。下書きはそのまま','Profile not imported; the draft is unchanged')}: ${codes.map(x=>`${x} (${codeWords(x)})`).join(', ')}`;this.noticeOk=false;this.paint();}
 /** A profile for the current plant becomes the base of its drafts; anything else is refused and the draft stays as it was (never applied to another plant). */
 importText(text:string):void{
  const c=this.ctx();if(!c.ok)return;
  const r=importControlProfile(text,{plantModelDigest:c.entry.plant.plantModelDigest,driveModelDigest:c.driveModelDigest,axisIds:c.entry.startingProfile.axes.map(a=>a.axisId)});
  if(!r.ok)return this.refused(r.reasonCodes);
  this.bases[c.scenarioId]=r.profile;for(const p of c.axes)if(p.scenarioId===c.scenarioId)delete this.drafts[p.axis.axis];this.errors={};this.reasons=[];
  this.notice=tr(`Đã nhập ${r.profile.id} r${r.profile.revision}: bản nháp lấy giá trị của file.`,`${r.profile.id} r${r.profile.revision} を読み込みました。下書きはファイルの値です。`,`Imported ${r.profile.id} r${r.profile.revision}: the draft holds the file’s values.`);this.noticeOk=true;this.paint();
 }
 private export(){
  const b=this.history.at(-1);if(b?.tuning?.status!=='completed')return;
  let text:string;try{text=exportControlProfile(b.base,b.control,b.tuning,{scenarioId:b.scenarioId,sourceCommit:b.sourceCommit});}catch(e){this.notice=e instanceof Error?e.message:String(e);this.noticeOk=false;return this.paint();}
  const p=JSON.parse(text) as ControlProfileV1,url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download=`${p.id}-r${p.revision}-${b.runId.slice(0,8)}.json`;a.rel='noopener';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  this.notice=tr(`Đã xuất ${p.id} r${p.revision} (tuned_in_simulation, chưa hiệu chuẩn).`,`${p.id} r${p.revision} を書き出しました(tuned_in_simulation、未校正)。`,`Exported ${p.id} r${p.revision} (tuned_in_simulation, not calibrated).`);this.noticeOk=true;this.paint();
 }
 /** The plots of a bench's recorded trace: built once per bench and language (a re-render reuses them). */
 private plots(b:Bench&{trace:DriveTrace}):{plots:string;table:string}{
  const key=`${b.runId}|${locale}`;if(this.plotCache.key===key)return this.plotCache;
  const t=b.trace,s=traceSeries(t),x='t (s)',legend=(list:PlotSeries[])=>`<ul class="plot-legend">${list.map((p,i)=>`<li><i class="plot-key plot-s${i}${p.dashed?' dashed':''}" aria-hidden="true"></i>${esc(p.label)}</li>`).join('')}</ul>`;
  const plots=`<figure class="plot-wide" data-testid="control-plot-response" data-samples="${t.samples.filter(Boolean).length}" data-run="${esc(b.runId)}"><figcaption>${tr('Đáp ứng','応答','Response')} · ${esc(t.axisId)} (${esc(b.unit)})</figcaption>${linePlot(s.response,{width:640,height:240,xLabel:x,yLabel:b.unit})}${legend(s.response)}</figure>
<figure data-testid="control-plot-error"><figcaption>${tr('Sai số bám','追従誤差','Tracking error')} (${esc(b.unit)})</figcaption>${linePlot(s.error,{width:400,height:200,xLabel:x,yLabel:b.unit})}</figure>
<figure data-testid="control-plot-torque"><figcaption>${tr('Mô-men (vùng bão hòa tô đậm)','トルク(飽和区間を強調)','Torque (saturated spans shaded)')}</figcaption>${linePlot(s.torque,{width:400,height:200,xLabel:x,yLabel:'N m',bands:s.bands})}</figure>`;
  this.plotCache={key,plots,table:plotTable([...s.response,...s.error,...s.torque],60)};return this.plotCache;
 }
 private benchHtml(b:Bench,prev:Bench|undefined):string{
  const title=`<h3 data-testid="control-run">${tr('Lần chạy','実行','Run')} <code>${esc(b.runId.slice(0,8))}</code> · ${esc(axisName(b.axis))}${b.tuning?` · ${esc(signalText(b.tuning.signal))}`:''}</h3>`;
  if(!b.tuning)return `${title}<p class="field-error" role="status" data-testid="control-no-result">${b.status==='cancelled'?tr('Đã dừng trước khi có kết quả.','結果が出る前に停止しました。','Stopped before a result.'):tr('Không có kết quả.','結果はありません。','No result.')}${b.issues.length?` ${esc(b.issues.join(', '))}`:''}</p>`;
  const {plots,table}=b.trace?this.plots(b as Bench&{trace:DriveTrace}):{plots:'',table:''};
  return `${title}${tuningHtml(b.tuning,prev?.tuning)}${b.trace?`<div class="control-plots" data-testid="control-plots">${plots}</div><details class="plot-data" id="twin-ctl-table"${this.tableOpen?' open':''}><summary>${tr('Bảng số (thay cho đồ thị)','数値表(グラフの代わり)','Numbers (a table instead of the plots)')}</summary><div class="eng-table-wrap" tabindex="0" role="region" aria-label="${tr('Mẫu trace đã ghi','記録済みトレースのサンプル','Recorded trace samples')}">${table}</div></details>`:`<p class="field-help">${tr('Không có trace đã ghi.','記録済みトレースはありません。','No recorded trace.')}</p>`}${b.issues.length?`<p class="field-help" data-testid="trace-issues">${tr('Vấn đề của trace','トレースの問題','Trace issues')}: ${esc(b.issues.join(', '))}</p>`:''}`;
 }
 html():string{
  // an open table stays open across re-renders (view state only)
  this.tableOpen=(typeof document.getElementById==='function'?(document.getElementById('twin-ctl-table') as HTMLDetailsElement|null)?.open:undefined)??this.tableOpen;
  const c=this.ctx(),pin=this.host.pinBlock(),engine=[...this.history].reverse().find(b=>b.tuning)?.tuning?.engine;
  const head=`<header class="control-head"><h2 id="control-title">${tr('Điều khiển · bàn chỉnh một trục','制御 · 単軸チューニングベンチ','Control · single-axis tuning bench')}</h2>${c.ok?`<p class="control-plant" data-testid="control-plant">Plant: MuJoCo${engine?` ${esc(engine.version)}`:''} · ${esc(c.entry.plant.id)} r${esc(c.entry.plant.revision)} · ${esc(c.experiment)} · ${tr('tải','負荷','load')} ${esc(c.entry.plant.load)} · profile ${esc(this.base(c).id)} r${esc(this.base(c).revision)}</p>`:''}<p class="control-banner" data-testid="control-banner"><b>${tr('Mô phỏng · chưa hiệu chuẩn','シミュレーション · 未校正','Simulation · not calibrated')}</b> <span>${tr('Mức model: giả định','モデル水準:仮定','Model level: assumed')}</span></p></header>`;
  if(!c.ok)return `<section class="control-bench" data-testid="control-bench" aria-labelledby="control-title">${head}<p class="field-help" data-testid="control-unavailable" role="status">${icon('info',15)}${tr('Bàn chỉnh không khả dụng','ベンチは利用できません','The bench is unavailable')}: ${esc(codeWords(c.reason))}${c.reason==='UNPAIRED'?'':` (<code>${esc(c.reason)}</code>)`}</p></section>`;
  const d=this.draft(c),s=this.signal(c),busy=this.phase!=='idle',sizes=sizesFor(c.axis,c.signals),labels=GAIN_LABEL(),err=(k:string)=>this.errors[k];
  const invalid=(k:string)=>err(k)?` aria-invalid="true" aria-describedby="twin-ctl-${k}-error"`:'',why=(k:string)=>err(k)?`<p class="field-error" id="twin-ctl-${k}-error">${esc(err(k))}</p>`:'';
  const field=(k:string,label:string,attrs:string,value:string,hint='')=>`<div class="control-field"><label for="twin-ctl-${k}">${label}${hint?` <small>${hint}</small>`:''}</label><input id="twin-ctl-${k}" ${attrs} value="${esc(value)}"${invalid(k)}>${why(k)}</div>`;
  const number='type="text" inputmode="decimal" autocomplete="off" spellcheck="false"',whole='type="text" inputmode="numeric" autocomplete="off" spellcheck="false"';
  const axes=`<fieldset class="control-axes"><legend>${tr('Trục','軸','Axis')}</legend>${c.axes.map(p=>`<label><input type="radio" name="twin-ctl-axis" id="twin-ctl-axis-${p.axis.axis}" value="${p.axis.axis}"${p.axis.axis===c.axis.axis?' checked':''}> ${esc(axisName(p.axis.axis))}</label>`).join('')}</fieldset>`;
  const sizeLabel=s.kind==='step'?tr('Biên độ','振幅','Amplitude'):c.axis.mode==='csv'?tr('Vận tốc đỉnh','ピーク速度','Peak speed'):tr('Quãng','距離','Distance');
  const signal=`<fieldset class="control-signal"><legend>${tr('Tín hiệu','信号','Signal')}</legend><div class="control-field"><label for="twin-ctl-kind">${tr('Loại','種類','Kind')}</label><select id="twin-ctl-kind">${c.signals.kinds.map(k=>`<option value="${k}"${k===s.kind?' selected':''}>${kindName(k)}</option>`).join('')}</select></div>
${s.kind==='hold'?field('ticks',tr('Số tick','tick数','Ticks'),whole,s.ticks,`1–${Math.min(500,c.lastTick+1)}`):`<div class="control-field"><label for="twin-ctl-size">${sizeLabel} (${esc(c.axis.unit)})</label><select id="twin-ctl-size"${invalid('size')}>${sizes.map(x=>`<option value="${x}"${String(x)===s.size?' selected':''}>${sig(x)}</option>`).join('')}</select>${why('size')}</div>${s.kind==='trapezoid'?(c.axis.mode==='csv'?field('distance',`${tr('Quãng','距離','Distance')} (rad)`,number,s.distance):field('peakVelocity',`${tr('Vận tốc đỉnh','ピーク速度','Peak speed')} (rad/s)`,number,s.peakVelocity))+field('acceleration',`${tr('Gia tốc','加速度','Acceleration')} (rad/s²)`,number,s.acceleration):''}${field('atTick',tr('Tại tick','開始tick','At tick'),whole,s.atTick,`0–${Math.min(499,c.lastTick)}`)}`}
${c.axis.mode==='csv'?`<p class="field-help">${tr('Bánh chỉ chạy tới.','車輪は前進のみ。','Wheels run forward only.')}</p>`:''}</fieldset>`;
  const gains=`<fieldset class="control-gains"><legend>${tr('Gain · biên do server cấp','ゲイン · サーバーの範囲','Gains · server bounds')}</legend>${offeredFields(c.envelope).map(k=>{const b=c.envelope[k]!;return field(k,labels[k],`${number}${['integralLimit','slewLimit','accelerationLimit'].includes(k)?` placeholder="${tr('trống = không giới hạn','空欄=制限なし','empty = no limit')}"`:''}`,d[k],`[${b.min}, ${b.max}]`);}).join('')}</fieldset>`;
  const actions=`<div class="control-actions"><button type="submit" class="button primary" id="twin-ctl-run"${busy||pin?' disabled':''}>${icon('play',16)}${tr('Chạy thử','試運転','Run bench')}</button>${busy&&this.phase!=='reading'?`<button type="button" class="button secondary" data-action="twin-ctl-cancel"${this.stopAsked?' disabled':''}>${this.stopAsked?tr('Đang dừng…','停止中…','Stopping…'):tr('Dừng','停止','Stop')}</button>`:''}</div>
${pin?`<p class="field-error" role="status">${esc(codeWords('RUNTIME_PIN_MISMATCH'))}: ${esc(pin.join(' ≠ '))}</p>`:''}${this.reasons.length?`<ul class="field-error control-reasons" data-testid="control-server-reasons" role="alert">${this.reasons.map(r=>`<li><code>${esc(r)}</code> ${esc(codeWords(r))}</li>`).join('')}</ul>`:''}`;
  const list=this.suggestions(c),pickable=list.length>0,j=[...this.history].reverse().find(b=>b.axis===c.axis.axis&&b.tuning?.effectiveInertia)?.tuning?.effectiveInertia;
  const suggest=`<div class="control-suggest" id="twin-ctl-suggest-box"><label for="twin-ctl-suggest">${tr('Băng thông · hệ số cản','帯域 · 減衰比','Bandwidth · damping')}</label><select id="twin-ctl-suggest"${pickable?'':' disabled'}>${pickable?list.map((g,i)=>`<option value="${i}"${i===this.suggestion?' selected':''}>ωc ${g.bandwidthRadS} rad/s · ζ ${g.damping}${g.clamped.length?` · ${tr('kẹp','クランプ','clamped')} ${g.clamped.join(', ')}`:''}</option>`).join(''):'<option>—</option>'}</select>
<button type="button" class="button secondary" data-action="twin-ctl-suggest-apply"${pickable?'':' disabled'} aria-describedby="twin-ctl-suggest-note">${tr('Gợi ý từ quán tính','慣性から提案','Suggest from inertia')}</button><p class="field-help" id="twin-ctl-suggest-note">${tr('gợi ý khởi điểm từ model, chưa hiệu chuẩn','モデルからの初期値の提案、未校正','a model-based starting point, not calibrated')}${j?` · J = ${sig(j.valueKgM2)} kg m²`:''}${pickable?'':` · ${tr('cần một lần chạy thử của trục này (quán tính hiệu dụng tại tư thế bench)','この軸のベンチ実行が必要(ベンチ姿勢での実効慣性)','needs a bench of this axis (its effective inertia at the bench pose)')}`}</p></div>`;
  const last=this.history.at(-1),exportable=last?.tuning?.status==='completed';
  const io=`<div class="control-io" id="twin-ctl-io"><button type="button" class="button secondary" data-action="twin-ctl-export"${exportable?'':' disabled'} aria-describedby="twin-ctl-io-note">${icon('download',16)}${tr('Xuất profile','プロファイルを書き出す','Export profile')}</button><label for="twin-ctl-import">${tr('Nhập profile (JSON)','プロファイルを読み込む(JSON)','Import profile (JSON)')}</label><input id="twin-ctl-import" type="file" accept="application/json,.json">
<p class="field-help" id="twin-ctl-io-note">${exportable?tr(`Xuất: profile của lần chạy ${last!.runId.slice(0,8)}, nguồn tuned_in_simulation, chưa hiệu chuẩn.`,`書き出し:実行 ${last!.runId.slice(0,8)} のプロファイル、出典 tuned_in_simulation、未校正。`,`Export: the profile of run ${last!.runId.slice(0,8)}, sourced tuned_in_simulation, not calibrated.`):tr('Xuất cần một lần chạy thử hoàn tất.','書き出しには完了したベンチが必要です。','Export needs a completed bench.')} ${tr('Nhập kiểm schema, digest và plant; profile của plant khác bị từ chối.','読み込み時にスキーマ・ダイジェスト・プラントを確認し、別プラントのものは拒否します。','Import checks the schema, the digest and the plant; a profile of another plant is refused.')}</p></div>`;
  const progress=busy?`<p class="control-progress" role="status" data-testid="control-progress">${this.stopAsked?tr('Đang dừng… chờ runtime xác nhận','停止中… ランタイムの確認待ち','Stopping… waiting for the runtime to confirm'):this.phase==='creating'?tr('Đang tạo lần chạy thử','ベンチ実行を作成中','Creating the bench run'):this.phase==='reading'?tr('Đang đọc báo cáo và trace đã ghi','レポートと記録済みトレースを読み込み中','Reading the report and the recorded trace'):`${tr('Đang chạy','実行中','Running')} · tick ${this.progress}/${c.signals.maxTicks}`}${this.phase==='running'?` <progress max="${c.signals.maxTicks}" value="${this.progress}"></progress>`:''}</p>`:'';
  const prev=this.history.slice(0,-1).reverse().find(b=>b.tuning);
  const results=`<div class="control-results" id="twin-ctl-results">${progress}${this.notice?`<p class="${this.noticeOk?'field-help':'field-error'}" role="status" data-testid="control-notice">${esc(this.notice)}</p>`:''}${last?this.benchHtml(last,prev):`<p class="empty-inline">${tr('Chưa có lần chạy thử. Chọn trục, chỉnh gain trong biên rồi bấm Chạy thử.','まだベンチ実行はありません。軸を選び、範囲内でゲインを調整して「試運転」を押してください。','No bench yet. Pick an axis, set the gains inside the bounds, then press Run bench.')}</p>`}</div>`;
  return `<section class="control-bench" data-testid="control-bench" data-phase="${this.phase}" aria-labelledby="control-title">${head}<div class="control-grid"><form class="control-form" id="twin-ctl-form" novalidate>${axes}<div class="control-field"><label for="twin-ctl-experiment">${tr('Model drive','ドライブモデル','Drive model')}</label><select id="twin-ctl-experiment">${c.experiments.map(x=>`<option value="${x}"${x===c.experiment?' selected':''}>${esc(x)}</option>`).join('')}</select></div>${signal}${gains}${actions}${suggest}${io}</form>${results}</div></section>`;
 }
}
