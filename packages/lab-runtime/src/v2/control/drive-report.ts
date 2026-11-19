// The `drive` section of a report (plan V05): per axis the states it went through, its faults, its saturation, and the tracking and speed-deficit metrics, from the verified per-tick drive records.
import type {DriveModelV1} from './drive-io';
import {speedDeficit,trackingRms,type ControlMetric,type DriveRecord} from './drive-metrics';
import type {ControllerEvent} from './controller';

export const CRUISE_MIN_TICKS=50;   // one second of constant command; a policy of the report, not a safety value
export interface DriveEvidenceReport {
 testLevel:'controller_in_the_loop';complete:boolean;issues:string[];ticks:number;
 axes:{axisId:string;mode:'csp'|'csv';states:{state:string;fromTick:number}[];faults:{fault:string;firstTick:number}[];enabledAtTick:number|null;saturatedSubsteps:number;trackingRms:ControlMetric;speedDeficit?:ControlMetric}[];
 events:{tick:number;code:string;axisId?:string}[]}

export function buildDriveEvidence(model:Pick<DriveModelV1,'axes'>,records:readonly DriveRecord[],o:{complete:boolean;issues:string[];events:readonly ControllerEvent[]}):DriveEvidenceReport{
 const last=records.length?records[records.length-1]!.tick:-1;
 return {testLevel:'controller_in_the_loop',complete:o.complete,issues:[...o.issues],ticks:records.length,events:o.events.map(e=>({tick:e.tick,code:e.code,...e.axisId?{axisId:e.axisId}:{}})),
  axes:model.axes.map(a=>{
   const states:{state:string;fromTick:number}[]=[],faults:{fault:string;firstTick:number}[]=[];let saturated=0,enabledAt:number|null=null;
   for(const r of records){
    const d=r.drives.find(x=>x.axisId===a.axisId);if(!d)continue;
    if(states.at(-1)?.state!==d.state)states.push({state:d.state,fromTick:r.tick});
    if(d.fault&&!faults.some(f=>f.fault===d.fault))faults.push({fault:d.fault,firstTick:r.tick});
    saturated+=d.saturatedSubsteps;if(enabledAt===null&&d.state==='enabled')enabledAt=r.tick;
   }
   const tracking:ControlMetric=enabledAt===null?{available:false,value:null,unit:a.mode==='csp'?'rad':'rad/s',reason:'NEVER_ENABLED'}:trackingRms(records,a.axisId,{fromTick:enabledAt,toTick:last},a.mode);
   return {axisId:a.axisId,mode:a.mode,states,faults,enabledAtTick:enabledAt,saturatedSubsteps:saturated,trackingRms:tracking,...a.mode==='csv'?{speedDeficit:speedDeficit(records,a.axisId,{minCruiseTicks:CRUISE_MIN_TICKS})}:{}};
  })};
}
