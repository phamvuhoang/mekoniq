// The Control tab's pure rules (R4.2 §6.3, V07): a gain draft checked against the envelope the runtime serves (a UI pre-block; the server stays the authority),
// the identity two bench results must share before a delta means anything, and a ControlProfileV1 sealed by the source rule (sha256-canonical-json-v1: the
// RFC 8785 JSON of the document without its `digest`, drive-io.ts driveDocumentDigest). Plant numbers, bounds and gain suggestions are the server's data
// (health benchCatalog/tuningEnvelope, TuningResultV1.suggestions): nothing here re-types one.
import Ajv from 'ajv';
import benchSchema from '../shared/engineering-schemas/bench-request-v1.schema.json' with {type:'json'};
import evidenceSchema from '../shared/engineering-schemas/control-evidence-v1.schema.json' with {type:'json'};
import componentSchema from '../shared/engineering-schemas/engineering-component.schema.json' with {type:'json'};
import driveIoSchema from '../shared/engineering-schemas/drive-io-v1.schema.json' with {type:'json'};
import profileSchema from '../shared/engineering-schemas/control-profile-v1.schema.json' with {type:'json'};
import type {AxisControl,AxisEnvelope,BenchRequestV1,BenchSignal,ControlProfileV1,DriveTrace,TunedSourceRef,TuningEnvelopeV1,TuningResultV1} from '../shared/navigation2d';
import {canonicalJson,hashJson} from '../twin/hash';
import {tr} from '../i18n';
import type {PlotSeries} from '../ui/svg-plot';

export {BENCH_SET} from '../scenarios/support';
export type BenchScenarioId=BenchRequestV1['scenarioId'];
export type BenchAxisName=BenchRequestV1['axis'];
export type DriveExperimentId=BenchRequestV1['driveExperimentId'];
// TODO(interim-copy): health's bench block as source bench-runner.ts/gateway.ts serve it (TS types there, no schema to generate from).
export type BenchCatalogAxis={axis:'wheels';axisIds:string[];mode:'csv';unit:'rad/s';direction:'forward';quantity?:'wheel_angular_speed';inertiaAssumption?:'straight_line_no_slip'}|{axis:Exclude<BenchAxisName,'wheels'>;axisIds:string[];mode:'csp';unit:'rad';lowerRad:number;upperRad:number;startRad:number};
export interface BenchCatalogEntry {plant:{id:string;revision:number;load:string;plantModelDigest:string};axes:BenchCatalogAxis[];experiments:Partial<Record<DriveExperimentId,{anchorTick:number;driveModelDigest:string}>>;startingProfile:ControlProfileV1}
export interface BenchSignals {kinds:BenchSignal['kind'][];maxTicks:number;amplitudes:{wheelRadS:number[];jointRad:number[]};suggestOptions:{bandwidthRadS:number[];damping:number[]};wheelDirection?:'forward'}
export interface BenchHealth {tuningEnvelope?:TuningEnvelopeV1;benchSignals?:BenchSignals;benchCatalog?:Partial<Record<BenchScenarioId,BenchCatalogEntry>>}

export const DRAFT_FIELDS=['kp','ki','kd','integralLimit','slewLimit','accelerationLimit'] as const;
export type DraftField=typeof DRAFT_FIELDS[number];
/** The text of the gain fields as typed. `slewLimit` is offered too: the envelope lists it for a joint (the plan's interface predates envelope revision 2). */
export interface WorkbenchDraft {axisId:string;kp:string;ki:string;kd:string;integralLimit:string;slewLimit:string;accelerationLimit:string}
/** The fields the served envelope lists for this axis are the only ones offered (no kd or slew on a wheel, no acceleration limit on a joint). */
export const offeredFields=(e:AxisEnvelope):DraftField[]=>DRAFT_FIELDS.filter(k=>e[k]!==undefined);
const NULLABLE:readonly DraftField[]=['integralLimit','slewLimit','accelerationLimit'];
/** A decimal comma is a decimal point; anything else Number() does not read whole is not a number. */
const num=(s:string)=>Number(s.replace(',','.'));
const text=(v:number|null)=>v===null?'':String(v);
export const draftOf=(c:AxisControl):WorkbenchDraft=>({axisId:c.axisId,kp:text(c.loop.kp),ki:text(c.loop.ki),kd:text(c.loop.kd),integralLimit:text(c.loop.integralLimit),slewLimit:text(c.loop.slewLimit),accelerationLimit:text(c.accelerationLimit)});
/** The draft as an AxisControl, or a reason per field. An empty optional limit is null (no limit); a field the envelope does not list is 0 (kd) or null. */
export function parseDraft(draft:WorkbenchDraft,envelope:AxisEnvelope):{ok:true;control:AxisControl}|{ok:false;fields:Record<string,string>}{
 const fields:Record<string,string>={},v:Record<DraftField,number|null>={kp:0,ki:0,kd:0,integralLimit:null,slewLimit:null,accelerationLimit:null},offered=offeredFields(envelope);
 for(const k of offered){
  const s=draft[k].trim(),b=envelope[k]!;
  if(!s){if(NULLABLE.includes(k))v[k]=null;else fields[k]=tr('Bắt buộc','必須','Required');continue;}
  const x=num(s);
  if(!Number.isFinite(x)){fields[k]=tr('Không phải số','数値ではありません','Not a number');continue;}
  if(x<b.min||x>b.max){fields[k]=tr(`Ngoài biên server [${b.min}, ${b.max}]`,`サーバーの範囲外 [${b.min}, ${b.max}]`,`Outside the server's bounds [${b.min}, ${b.max}]`);continue;}
  v[k]=x;
 }
 if(!fields.ki&&!fields.integralLimit){
  if((v.ki??0)>0&&v.integralLimit===null)fields.integralLimit=tr('Cần khi Ki > 0','Ki > 0 のとき必須','Required when Ki > 0');
  if(v.ki===0&&v.integralLimit!==null)fields.integralLimit=tr('Chỉ dùng khi Ki > 0: để trống','Ki > 0 のときのみ:空欄にしてください','Only with Ki > 0: leave it empty');
 }
 if(Object.keys(fields).length)return {ok:false,fields};
 return {ok:true,control:{axisId:draft.axisId,loop:{kp:v.kp!,ki:v.ki!,kd:v.kd!,integralLimit:v.integralLimit,slewLimit:v.slewLimit},accelerationLimit:v.accelerationLimit}};
}

/** The signal fields as typed; `size` is the registered number (a step's amplitude, a wheel trapezoid's peak speed, a joint trapezoid's distance). */
export interface SignalDraft {kind:BenchSignal['kind'];size:string;atTick:string;distance:string;peakVelocity:string;acceleration:string;ticks:string}
/** Registered sizes this axis admits: a wheel forward only, a joint either way while the bench pose plus the size stays inside its limits (the catalog's). */
export const sizesFor=(axis:BenchCatalogAxis,s:BenchSignals):number[]=>axis.mode==='csv'?[...s.amplitudes.wheelRadS]:s.amplitudes.jointRad.flatMap(a=>[-a,a]).filter(a=>axis.startRad+a>=axis.lowerRad&&axis.startRad+a<=axis.upperRad).sort((x,y)=>x-y);
/** The signal, or a reason per field. `lastTick` = maxTicks − anchorTick (signal tick k runs on engine tick anchor + k): the last tick a step may land on. Whether a trapezoid's
 *  motion ends inside the bench is the server's check (SIGNAL_TOO_LONG / TICK_OUT_OF_RANGE). */
export function parseSignal(d:SignalDraft,mode:'csp'|'csv',lastTick:number):{ok:true;signal:BenchSignal}|{ok:false;fields:Record<string,string>}{
 const fields:Record<string,string>={};
 const int=(k:keyof SignalDraft,lo:number,hi:number)=>{const x=num(d[k].trim());if(!d[k].trim()||!Number.isInteger(x)||x<lo||x>hi){fields[k]=tr(`Số nguyên trong [${lo}, ${hi}]`,`[${lo}, ${hi}] の整数`,`A whole number in [${lo}, ${hi}]`);return 0;}return x;};
 const real=(k:keyof SignalDraft,positive:boolean)=>{const x=num(d[k].trim());if(!d[k].trim()||!Number.isFinite(x)||(positive?x<=0:x===0)){fields[k]=positive?tr('Số dương','正の数','A positive number'):tr('Số khác 0','0以外の数','A non-zero number');return 0;}return x;};
 let signal:BenchSignal;
 if(d.kind==='hold')signal={kind:'hold',ticks:int('ticks',1,Math.min(500,lastTick+1))};
 else if(d.kind==='step')signal={kind:'step',amplitude:real('size',false),atTick:int('atTick',0,Math.min(499,lastTick))};
 else{const size=real('size',false),atTick=int('atTick',0,Math.min(499,lastTick));signal=mode==='csv'?{kind:'trapezoid',distance:real('distance',true),peakVelocity:size,acceleration:real('acceleration',true),atTick}:{kind:'trapezoid',distance:size,peakVelocity:real('peakVelocity',true),acceleration:real('acceleration',true),atTick};}
 return Object.keys(fields).length?{ok:false,fields}:{ok:true,signal};
}

/** What two results must share before B − A means anything: plant, drive model, load, axis, signal, seed and engine (id, version, host architecture). The control
 *  profile is what is being compared, so it is not in the list. */
const IDENTITY:[string,(r:TuningResultV1)=>unknown][]=[['plantModelDigest',r=>r.plant.plantModelDigest],['driveModelDigest',r=>r.plant.driveModelDigest],['load',r=>r.plant.load],['axis',r=>r.axisIds],['signal',r=>r.signal],['seed',r=>r.seed],['engine',r=>[r.engine.id,r.engine.version,r.engine.hostArch??null]]];
export function comparable(a:TuningResultV1,b:TuningResultV1):{ok:true}|{ok:false;changed:string[]}{
 const changed=IDENTITY.filter(([,f])=>canonicalJson(f(a))!==canonicalJson(f(b))).map(([k])=>k);
 return changed.length?{ok:false,changed}:{ok:true};
}

/** The source digest rule: sha256 of the canonical JSON of the document without its `digest` key. */
export const profileDigest=(p:ControlProfileV1):string=>{const {digest:_,...rest}=p;void _;return hashJson(rest);};
const seal=(p:ControlProfileV1):ControlProfileV1=>({...p,digest:profileDigest(p)});
/** The draft a bench runs: `base` as its next revision with `control` on every traced axis (both wheels take the one wheel control), sealed. */
export function benchDraft(base:ControlProfileV1,control:AxisControl,axisIds:readonly string[]):ControlProfileV1{
 const sources=structuredClone(base.sources);
 for(const field of ['loop','limits'] as const){
  const ref=sources[field],changed=base.axes.filter(a=>axisIds.includes(a.axisId)&&(field==='loop'?canonicalJson(a.loop)!==canonicalJson(control.loop):
   a.accelerationLimit!==control.accelerationLimit||a.loop.integralLimit!==control.loop.integralLimit||a.loop.slewLimit!==control.loop.slewLimit)).map(a=>a.axisId);
  if(!changed.length)continue;
  if(ref.kind==='tuned_in_simulation'){
   const retained=ref.axisIds.filter(id=>!changed.includes(id));
   if(retained.length){ref.axisIds=retained;continue;}
  }
  sources[field]={kind:'assumed',documentId:base.id,revision:String(base.revision),locator:'edited bench draft',contentSha256:base.digest};
 }
 return seal({...structuredClone(base),sources,revision:base.revision+1,axes:base.axes.map(a=>axisIds.includes(a.axisId)?{axisId:a.axisId,loop:{...control.loop},accelerationLimit:control.accelerationLimit}:structuredClone(a))});
}
/** The profile of a bench that ran: exactly its draft (else EXPORT_RESULT_MISMATCH: it would not be the profile that bench measured), with the loop and limits
 *  sourced to that bench run, its recorded trace, the runtime commit, the axes it traced and the drive model it ran (TunedSourceRef), not calibrated, sealed.
 *  Only one tuned source per field fits the wire schema. Keep references for unchanged axes by declining an unrepresentable export. */
export const exportLosesAttribution=(base:ControlProfileV1,axes:readonly string[])=>[base.sources.loop,base.sources.limits].some(ref=>ref.kind==='tuned_in_simulation'&&ref.axisIds.some(id=>!axes.includes(id)));
export function exportControlProfile(base:ControlProfileV1,control:AxisControl,result:TuningResultV1,source:{scenarioId:BenchScenarioId;sourceCommit:string}):string{
 const draft=benchDraft(base,control,result.axisIds);
 if(draft.digest!==result.plant.controlProfileDigest)throw new Error('EXPORT_RESULT_MISMATCH');
 if(exportLosesAttribution(base,result.axisIds))throw new Error('EXPORT_AXIS_PROVENANCE');
 const tuned:TunedSourceRef={kind:'tuned_in_simulation',benchRunId:result.runId,scenarioId:source.scenarioId,traceSha256:result.trace.sha256,sourceCommit:source.sourceCommit,axisIds:[...result.axisIds],driveModelDigest:result.plant.driveModelDigest};
 const doc=seal({...draft,calibration:'not_calibrated',sources:{...draft.sources,loop:tuned,limits:{...tuned,axisIds:[...tuned.axisIds]}}});
 // M4: a file neither the Lab nor the server would take back (e.g. a runtime commit that is not 40 hex) is never downloaded
 if(!validProfile(doc))throw new Error('EXPORT_INVALID');
 return JSON.stringify(doc,null,2)+'\n';
}
const ajv=new Ajv({strict:false,strictNumbers:true,allErrors:false,discriminator:true});
for(const [key,schema] of Object.entries({'bench-request-v1.schema.json':benchSchema,'control-evidence-v1.schema.json':evidenceSchema,'engineering-component.schema.json':componentSchema,'drive-io-v1.schema.json':driveIoSchema,'control-profile-v1.schema.json':profileSchema}))ajv.addSchema(schema,key);
const validProfile=ajv.getSchema('control-profile-v1.schema.json') as import('ajv').ValidateFunction<ControlProfileV1>;
const validEnvelope=ajv.getSchema<TuningEnvelopeV1>('mekoniq.control-profile.v1#/definitions/TuningEnvelopeV1')!;
export const validTuning=ajv.getSchema<TuningResultV1>('mekoniq.control-evidence.v1#/definitions/TuningResultV1')!;
const validTrace=ajv.getSchema<DriveTrace>('mekoniq.drive-io.v1#/definitions/DriveTrace')!;
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const positiveList=(v:unknown)=>Array.isArray(v)&&v.length>0&&v.every(n=>finite(n)&&n>0);
const unique=(items:readonly unknown[])=>new Set(items).size===items.length;
const integer=(n:unknown):n is number=>Number.isSafeInteger(n);
export function validBenchCatalog(signals:BenchSignals,envelope:TuningEnvelopeV1,entries:[string,BenchCatalogEntry][]){
 if(!validEnvelope(envelope)||!unique(envelope.axes.map(a=>a.axisId))||!envelope.axes.every(a=>offeredFields(a).every(k=>a[k]!.min<=a[k]!.max)))return false;
 if(!Array.isArray(signals.kinds)||!signals.kinds.includes('step')||!unique(signals.kinds)||!signals.kinds.every(k=>['step','hold','trapezoid'].includes(k))
  ||!integer(signals.maxTicks)||signals.maxTicks<1||signals.maxTicks>500||!positiveList(signals.amplitudes?.wheelRadS)||!positiveList(signals.amplitudes?.jointRad)
  ||!positiveList(signals.suggestOptions?.bandwidthRadS)||!positiveList(signals.suggestOptions?.damping))return false;
 const driveIds=new Set<string>();
 return entries.every(([id,e])=>{
  if(!benchSchema.properties.scenarioId.enum.includes(id)||!e?.plant||typeof e.plant.id!=='string'||typeof e.plant.load!=='string'||!integer(e.plant.revision)||e.plant.revision<1
   ||!validProfile(e.startingProfile)||profileDigest(e.startingProfile)!==e.startingProfile.digest||e.plant.plantModelDigest!==e.startingProfile.plantModelDigest
   ||!Array.isArray(e.axes)||!e.axes.length||!e.experiments||!Object.keys(e.experiments).length)return false;
  const profileIds=e.startingProfile.axes.map(a=>a.axisId);
  return unique(profileIds)&&unique(e.axes.map(a=>a?.axis))&&Object.entries(e.experiments).every(([name,x])=>benchSchema.properties.driveExperimentId.enum.includes(name)&&x&&integer(x.anchorTick)&&x.anchorTick>=0&&x.anchorTick<=signals.maxTicks&&e.startingProfile.driveModelDigests.includes(x.driveModelDigest))
   &&e.axes.every(a=>{
    if(!a||typeof a.axis!=='string'||!benchSchema.properties.axis.enum.includes(a.axis)||!Array.isArray(a.axisIds))return false;
    const expected=a.axis==='wheels'?['amr-1/wheel-left','amr-1/wheel-right']:[`xarm-1/${a.axis}`];
    if(canonicalJson(a.axisIds)!==canonicalJson(expected)||a.axisIds.some(axis=>driveIds.has(axis)))return false;
    for(const axis of a.axisIds)driveIds.add(axis);
    return a.axisIds.every(axis=>profileIds.includes(axis)&&envelope.axes.some(x=>x.axisId===axis))
    &&(a.axis==='wheels'?id==='MJ-BENCH-WHEEL'&&a.axisIds.length===2&&a.mode==='csv'&&a.unit==='rad/s'&&a.direction==='forward'
     &&(a.quantity===undefined&&a.inertiaAssumption===undefined||a.quantity==='wheel_angular_speed'&&a.inertiaAssumption==='straight_line_no_slip')
    :id==='MJ-BENCH-ARM'&&a.axisIds.length===1&&a.mode==='csp'&&a.unit==='rad'&&finite(a.lowerRad)&&finite(a.startRad)&&finite(a.upperRad)&&a.lowerRad<=a.startRad&&a.startRad<=a.upperRad);});
 });
}
// The endpoint includes ten initial substeps plus up to 5000 measured substeps.
export interface BenchTraceReceipt {runId:string;manifestSha256:string|null;traces:DriveTrace[];issues:string[]}
export function validBenchTraces(data:BenchTraceReceipt,result:TuningResultV1,tick:number){
 if(!data||data.runId!==result.runId||data.manifestSha256!==result.trace.sha256||!Array.isArray(data.issues)||!data.issues.every(i=>typeof i==='string')||!Array.isArray(data.traces)||data.traces.length!==result.axisIds.length)return false;
 return data.traces.every((t,i)=>t?.axisId===result.axisIds[i]&&t.dtS===0.002&&Array.isArray(t.samples)&&t.samples.length===(tick+1)*10
  &&validTrace({...t,samples:t.samples.slice(0,10)})&&validTrace({...t,samples:t.samples.slice(10)})&&t.samples.slice(10).filter(Boolean).length===result.trace.samples);
}
export const MAX_PROFILE_BYTES=1024*1024;
/** A profile file for this plant: JSON, the source schema, its own digest, this plant and a drive model it was declared for (and, given, this plant's axis set). */
export function importControlProfile(text:string,plant:{plantModelDigest:string;driveModelDigest:string;axisIds?:readonly string[]}):{ok:true;profile:ControlProfileV1}|{ok:false;reasonCodes:string[]}{
 const no=(...reasonCodes:string[])=>({ok:false as const,reasonCodes});
 if(text.length>MAX_PROFILE_BYTES)return no('PROFILE_TOO_LARGE');
 let v:unknown;try{v=JSON.parse(text);}catch{return no('INVALID_JSON');}
 if(!validProfile(v))return no('SCHEMA_INVALID');
 let digest:string;try{digest=profileDigest(v);}catch{return no('NON_FINITE_NUMBER');}
 const codes=[...digest!==v.digest?['DIGEST_MISMATCH']:[],...v.plantModelDigest!==plant.plantModelDigest?['DRIVE_PLANT_MISMATCH']:[],...!v.driveModelDigests.includes(plant.driveModelDigest)?['DRIVE_MODEL_DIGEST_MISMATCH']:[],
  ...plant.axisIds&&canonicalJson(v.axes.map(a=>a.axisId).sort())!==canonicalJson([...plant.axisIds].sort())?['AXIS_SET_MISMATCH']:[]];
 return codes.length?no(...codes):{ok:true,profile:v};
}

/** A recorded trace (one sample per substep, index × dtS from the trace's first sample) as plot series: command, true state and feedback (dashed), tracking
 *  error (command − true state) and torque, with the saturated samples as bands. A null sample, or a null feedback, is a gap. */
export function traceSeries(t:DriveTrace):{response:PlotSeries[];error:PlotSeries[];torque:PlotSeries[];bands:{from:number;to:number;label:string}[]}{
 const at=(f:(s:NonNullable<DriveTrace['samples'][number]>)=>number|null)=>t.samples.map((s,j)=>[j*t.dtS,s?Number(f(s)??NaN):NaN] as const);
 const bands:{from:number;to:number;label:string}[]=[],label=tr('bão hòa','飽和','saturated');
 t.samples.forEach((s,j)=>{if(!s?.saturated)return;const last=bands.at(-1);if(last&&t.samples[j-1]?.saturated)last.to=(j+1)*t.dtS;else bands.push({from:j*t.dtS,to:(j+1)*t.dtS,label});});
 return {response:[{id:'target',label:tr('lệnh','指令','command'),points:at(s=>s.target)},{id:'actual',label:tr('thực','実際','actual'),points:at(s=>s.actual)},{id:'feedback',label:tr('phản hồi encoder','エンコーダ帰還','encoder feedback'),points:at(s=>s.feedback),dashed:true}],
  error:[{id:'error',label:tr('sai số bám','追従誤差','tracking error'),points:at(s=>s.target-s.actual)}],torque:[{id:'torque',label:tr('mô-men','トルク','torque'),points:at(s=>s.torqueNm)}],bands};
}
