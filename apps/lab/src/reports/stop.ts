// A stop report in words (R5.4/R5.5): the runtime's StopReportV1 (the campaign writes one per run). Read-only; numbers a run could not measure say why.
import type {StopReportV1} from '../shared/navigation2d';
export type StopMetric={value:number;unit:string}|{unavailable:string};
export interface StopRow{function:StopReportV1['function'];verdict:StopReportV1['verdict'];appliedTick:number|null;distanceM:number|null;timeMs:number|null;peakDecelMps2:number|null;cupSlipMm:number|null;cupTipped:boolean|null;why:string|null;violated:string[];/** what the drive does when the torque is cut (`brake` or `coast`), from the report's deciding parameters */onDisable:string|null}
const num=(m:unknown):number|null=>typeof m==='number'?m:null;
const why=(m:unknown):string|null=>m&&typeof m==='object'&&'unavailable' in m?String((m as {unavailable:unknown}).unavailable):null;
export function stopRow(r:StopReportV1):StopRow{
 const m=r.metrics as unknown as Record<string,unknown>;
 return {function:r.function,verdict:r.verdict,appliedTick:r.appliedTick,distanceM:num(m.stopDistanceM),timeMs:num(m.stopTimeMs),peakDecelMps2:num(m.peakDecelerationMps2),cupSlipMm:num(m.cupMaxSlipMm),cupTipped:typeof m.cupTipped==='boolean'?m.cupTipped:null,
  why:why(m.stopDistanceM)??why(m.stopTimeMs),violated:r.invariants.filter(i=>i.result==='violated').map(i=>i.id),onDisable:String(r.decidingParameters.find(p=>p.id==='onDisable')?.value??'')||null};
}
/** The four stop kinds side by side, in a fixed order; a kind the set does not have is simply absent from the list. */
export const STOP_ORDER=['normal','protective','emergency'] as const;
export const stopRows=(reports:readonly StopReportV1[]):StopRow[]=>[...reports].sort((a,b)=>STOP_ORDER.indexOf(a.function)-STOP_ORDER.indexOf(b.function)||(stopRow(a).onDisable??'').localeCompare(stopRow(b).onDisable??'')).map(stopRow);
