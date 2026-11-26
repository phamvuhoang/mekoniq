// R5 design hint (R4-D15 rule): a sentence only from two runs whose identities prove they differ in exactly one allowed input (the stop function, or the stop variant of the drive), with the metric available; three languages; always with its limit.
import type {StopReportV1} from '../navigation2d/contracts';
import {hashJson} from '../hash';
import {TRAY_EXPERIMENTS} from '../simulation3d/tray-experiments';

type Hint={vi:string;ja:string;en:string};
/** What a run was given, from its manifest and case: the hint compares only runs whose provenance is stated. */
export interface StopRunIdentity{scenarioId:string;seed:number;trigger:{kind:string;value:number};experimentId:string}
export interface StopRun{report:StopReportV1;identity:StopRunIdentity}
const num=(m:StopReportV1['metrics'][keyof StopReportV1['metrics']])=>typeof m==='number'?m:null;
const NAME:Record<StopReportV1['function'],Hint>={normal:{vi:'dừng có điều khiển',ja:'制御された停止',en:'a controlled stop'},protective:{vi:'dừng bảo vệ',ja:'保護停止',en:'a protective stop'},emergency:{vi:'ngắt mô-men',ja:'トルク遮断',en:'torque cut'}};
const fmt=(m:number)=>(Math.round(m*100)/100).toString(),mm=(x:number)=>(Math.round(x*10)/10).toString();
type Variant={onDisable:'brake';brakeTorqueNm:number}|{onDisable:'coast'};
/** The stop variant the drive of the run actually had, from the report's deciding parameters; null when not stated or inconsistent. */
function variantOf(r:StopReportV1):Variant|null{
 const p=(id:string)=>r.decidingParameters.find(x=>x.id===id)?.value,on=p('onDisable'),nm=p('brakeTorqueNm');
 return on==='coast'?{onDisable:'coast'}:on==='brake'&&typeof nm==='number'&&nm>0?{onDisable:'brake',brakeTorqueNm:nm}:null;
}
const identityOk=(i:StopRunIdentity|undefined):i is StopRunIdentity=>!!i&&typeof i.scenarioId==='string'&&Number.isInteger(i.seed)&&typeof i.trigger?.kind==='string'&&typeof i.trigger.value==='number'&&Object.hasOwn(TRAY_EXPERIMENTS,i.experimentId);
/** the experiment without its drive: two experiments that agree here differ only in the drive variant */
const withoutDrive=(id:string)=>{const {driveExperimentId:_d,comparedWith:_c,...rest}=TRAY_EXPERIMENTS[id as keyof typeof TRAY_EXPERIMENTS] as {driveExperimentId?:unknown;comparedWith?:unknown};return hashJson(rest);};
const others=(r:StopReportV1)=>hashJson(r.decidingParameters.filter(p=>p.id!=='onDisable'&&p.id!=='brakeTorqueNm').map(p=>[p.id,p.value]).sort());
function label(fn:StopReportV1['function'],v:Variant,withVariant:boolean):Hint{
 const n=v.onDisable==='brake'?fmt(v.brakeTorqueNm):'';
 if(fn==='emergency')return v.onDisable==='brake'?{vi:`ngắt mô-men và phanh ${n} N·m`,ja:`トルク遮断と${n} N·mブレーキ`,en:`torque cut with a ${n} N·m brake`}:{vi:'ngắt mô-men và thả trôi',ja:'トルク遮断と惰行',en:'torque cut and coast'};
 if(!withVariant)return NAME[fn];
 const q:Hint=v.onDisable==='brake'?{vi:` (drive phanh ${n} N·m khi ngắt)`,ja:`（停止時${n} N·mブレーキ）`,en:` (a drive with a ${n} N·m brake when disabled)`}:{vi:' (drive thả trôi khi ngắt)',ja:'（停止時惰行）',en:' (a drive that coasts when disabled)'};
 return {vi:NAME[fn].vi+q.vi,ja:NAME[fn].ja+q.ja,en:NAME[fn].en+q.en};
}
/** `null` unless both runs state their provenance and differ in exactly one of: the stop function, the stop variant of the drive (onDisable / brake torque, through experiments that differ only in the drive); also null when a stop did not fire or a distance is not available. */
export function stopHint(a:StopRun,b:StopRun):Hint|null{
 if(!a?.report||!b?.report||!identityOk(a.identity)||!identityOk(b.identity))return null;
 const ra=a.report,rb=b.report,ia=a.identity,ib=b.identity,va=variantOf(ra),vb=variantOf(rb);
 if(!va||!vb||ra.verdict!=='fired'||rb.verdict!=='fired')return null;
 if(ia.scenarioId!==ib.scenarioId||ia.seed!==ib.seed||hashJson(ia.trigger)!==hashJson(ib.trigger)||ra.appliedTick!==rb.appliedTick||others(ra)!==others(rb))return null;
 const fnDiff=ra.function!==rb.function,sameVariant=hashJson(va)===hashJson(vb);
 const variantDiff=ia.experimentId!==ib.experimentId;
 if(variantDiff?withoutDrive(ia.experimentId)!==withoutDrive(ib.experimentId)||sameVariant:!sameVariant)return null;
 if(fnDiff===variantDiff)return null;
 const da=num(ra.metrics.stopDistanceM),db=num(rb.metrics.stopDistanceM);
 if(da===null||db===null)return null;
 const sa=num(ra.metrics.cupMaxSlipMm),sb=num(rb.metrics.cupMaxSlipMm),slip=sa!==null&&sb!==null,la=label(ra.function,va,variantDiff),lb=label(rb.function,vb,variantDiff);
 const limit={vi:'Cản lăn và ma sát caster chưa được đo; cần bài thả trôi trên xe thật trước khi dùng số này.',ja:'転がり抵抗とキャスター摩擦は未測定です。この数値を使う前に実機での惰行試験が必要です。',en:'Rolling resistance and caster friction are not measured; a coast-down test on the real robot is needed before this number is used.'};
 return {
  vi:`Trong model giả định này, ${la.vi} dừng sau ${fmt(da)} m; ${lb.vi} dừng sau ${fmt(db)} m.${slip?` Cốc trượt tối đa ${mm(sa!)} mm so với ${mm(sb!)} mm.`:''} ${limit.vi}`,
  ja:`この仮定モデルでは、${la.ja}は${fmt(da)} mで、${lb.ja}は${fmt(db)} mで停止します。${slip?`カップの最大滑りは${mm(sa!)} mmと${mm(sb!)} mmです。`:''}${limit.ja}`,
  en:`In this assumed model, ${la.en} stops after ${fmt(da)} m and ${lb.en} after ${fmt(db)} m.${slip?` The cups slip at most ${mm(sa!)} mm against ${mm(sb!)} mm.`:''} ${limit.en}`};
}
