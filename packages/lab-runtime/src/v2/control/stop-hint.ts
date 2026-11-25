// R5 design hint (R4-D15 rule): a sentence only from two reports that differ in exactly one input and have the metric available; three languages; always with its limit.
import type {StopReportV1} from '../navigation2d/contracts';

type Hint={vi:string;ja:string;en:string};
const num=(m:StopReportV1['metrics'][keyof StopReportV1['metrics']])=>typeof m==='number'?m:null;
const NAME:Record<StopReportV1['function'],Hint>={normal:{vi:'dừng có điều khiển',ja:'制御された停止',en:'a controlled stop'},protective:{vi:'dừng bảo vệ',ja:'保護停止',en:'a protective stop'},emergency:{vi:'ngắt mô-men và thả trôi',ja:'トルク遮断と惰行',en:'torque cut and coast'}};
const fmt=(m:number)=>(Math.round(m*100)/100).toString(),mm=(x:number)=>(Math.round(x*10)/10).toString();
/** Two reports of runs that differ only in the stop function. `null` when anything else differs (`context`), when a stop did not fire, or when a distance is not available. */
export function stopHint(a:StopReportV1,b:StopReportV1,context?:{sameInputsExceptFunction:boolean}):Hint|null{
 if(context?.sameInputsExceptFunction===false||a.function===b.function||a.verdict!=='fired'||b.verdict!=='fired')return null;
 const da=num(a.metrics.stopDistanceM),db=num(b.metrics.stopDistanceM);
 if(da===null||db===null)return null;
 const sa=num(a.metrics.cupMaxSlipMm),sb=num(b.metrics.cupMaxSlipMm),slip=sa!==null&&sb!==null;
 const limit={vi:'Cản lăn và ma sát caster chưa được đo; cần bài thả trôi trên xe thật trước khi dùng số này.',ja:'転がり抵抗とキャスター摩擦は未測定です。この数値を使う前に実機での惰行試験が必要です。',en:'Rolling resistance and caster friction are not measured; a coast-down test on the real robot is needed before this number is used.'};
 return {
  vi:`Trong model giả định này, ${NAME[a.function].vi} dừng sau ${fmt(da)} m; ${NAME[b.function].vi} dừng sau ${fmt(db)} m.${slip?` Cốc trượt tối đa ${mm(sa!)} mm so với ${mm(sb!)} mm.`:''} ${limit.vi}`,
  ja:`この仮定モデルでは、${NAME[a.function].ja}は${fmt(da)} mで、${NAME[b.function].ja}は${fmt(db)} mで停止します。${slip?`カップの最大滑りは${mm(sa!)} mmと${mm(sb!)} mmです。`:''}${limit.ja}`,
  en:`In this assumed model, ${NAME[a.function].en} stops after ${fmt(da)} m and ${NAME[b.function].en} after ${fmt(db)} m.${slip?` The cups slip at most ${mm(sa!)} mm against ${mm(sb!)} mm.`:''} ${limit.en}`};
}
