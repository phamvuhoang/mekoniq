// Diagnostics (R5.4): what one selected axis shows, read only from the run report's own sections. Pure, no DOM. A value the report does not carry is `unavailable` with a reason,
// never 0 and never "healthy": the page has no good/ok state, only the facts and the alarms.
import type {RunReport} from '../scenarios/controls';
import type {ElectricalBundleV1,ElectricalDesignV1} from '../shared/engineering';

export type Quality={kind:'good'}|{kind:'stale';ageTicks:number}|{kind:'unavailable';reason:string};
export interface TagValue {tag:string;value:number|boolean|string|null;unit:string|null;quality:Quality;tick:number|null}
export interface Alarm {id:string;source:'fault'|'stop'|'io';targetId:string;code:string;tick:number;verdict:string}
export type TargetKind='amr'|'wheel'|'arm'|'joint'|'gripper';
const unavailable=(tag:string,reason:string,unit:string|null=null):TagValue=>({tag,value:null,unit,quality:{kind:'unavailable',reason},tick:null});

/** A fixed order for the keyboard: for each robot its two wheels, then the arm joints J1..J6 and the gripper when the scene has them. */
export function selectableTargets(scene:{robotIds:readonly string[];armIds?:readonly string[]}):{id:string;kind:TargetKind;label:string}[]{
 const out:{id:string;kind:TargetKind;label:string}[]=[];
 for(const r of scene.robotIds)out.push({id:`${r}/wheel-left`,kind:'wheel',label:`${r} · wheel left`},{id:`${r}/wheel-right`,kind:'wheel',label:`${r} · wheel right`});
 for(const a of scene.armIds??[]){for(let j=1;j<=6;j++)out.push({id:`${a}/J${j}`,kind:'joint',label:`${a} · J${j}`});out.push({id:`${a}/gripper`,kind:'gripper',label:`${a} · gripper`});}
 return out;
}
type Drive=NonNullable<RunReport['driveEvidence']>;
const axisOf=(r:RunReport|null,id:string)=>(r?.driveEvidence as Drive|undefined)?.axes.find(a=>a.axisId===id)??null;
const stateAt=(states:{state:string;fromTick:number}[],tick:number|null)=>{let s=states[0]??null;for(const x of states)if(tick===null||x.fromTick<=tick)s=x;return s;};

/** All alarms of a report, ordered by (tick, id): drive faults, then stop receipts. The report carries no I/O stream yet, so there is no `io` alarm. */
export function alarmsOf(report:RunReport|null):Alarm[]{
 if(!report)return [];
 const out:Alarm[]=[];
 for(const a of (report.driveEvidence as Drive|undefined)?.axes??[])for(const f of a.faults)out.push({id:`fault:${a.axisId}:${f.fault}:${f.firstTick}`,source:'fault',targetId:a.axisId,code:f.fault,tick:f.firstTick,verdict:'fault'});
 // a stop the plant applied ends the run in needs_attention with NORMAL_STOP, PROTECTIVE_STOP or EMERGENCY_STOP at its tick (the server's own attention list)
 for(const a of (report as unknown as {attention?:{tick:number;reason:string;subjectId?:string}[]}).attention??[])if(/^(NORMAL|PROTECTIVE|EMERGENCY)_STOP$/.test(a.reason))out.push({id:`stop:${a.reason}:${a.tick}`,source:'stop',targetId:'*',code:a.reason,tick:a.tick,verdict:'applied'});
 return out.sort((x,y)=>x.tick-y.tick||(x.id<y.id?-1:x.id>y.id?1:0));
}
/** What the panel shows for one target. `cursorTick` is the replay cursor (null: the end of the run). */
export function diagnosticsFor(targetId:string,input:{report:RunReport|null;cursorTick:number|null;bundle:ElectricalBundleV1|null;design?:ElectricalDesignV1|null}):{device:{id:string;label:string}|null;tags:TagValue[];alarms:Alarm[]}{
 const {report,cursorTick,bundle,design}=input,axis=axisOf(report,targetId),last=(report?.driveEvidence as Drive|undefined)?.ticks??null;
 const stale:Quality=cursorTick!==null&&last!==null&&cursorTick>last?{kind:'stale',ageTicks:cursorTick-last}:{kind:'good'};
 const noDrive=(tag:string,unit:string|null=null)=>unavailable(tag,report?(report.driveEvidence?'AXIS_NOT_IN_REPORT':'NO_DRIVE_EVIDENCE'):'NO_REPORT',unit);
 const tags:TagValue[]=[];
 if(!axis)tags.push(noDrive('state'),noDrive('fault'),noDrive('trackingRms'),noDrive('saturatedSubsteps'));
 else{
  const st=stateAt(axis.states,cursorTick),fault=axis.faults.filter(f=>cursorTick===null||f.firstTick<=cursorTick).at(-1)??null;
  tags.push({tag:'state',value:st?.state??null,unit:null,quality:st?stale:{kind:'unavailable',reason:'NO_STATE'},tick:st?.fromTick??null},
   {tag:'fault',value:fault?.fault??null,unit:null,quality:stale,tick:fault?.firstTick??null},
   axis.trackingRms.available?{tag:'trackingRms',value:axis.trackingRms.value,unit:axis.trackingRms.unit,quality:stale,tick:null}:unavailable('trackingRms',axis.trackingRms.reason,axis.trackingRms.unit),
   {tag:'saturatedSubsteps',value:axis.saturatedSubsteps,unit:null,quality:stale,tick:null});
 }
 // the report has no stream of the controller's I/O points yet; the page says so for each, never a 0
 tags.push(unavailable('io',report?'NO_IO_STREAM':'NO_REPORT'));
 const dev=design?.axes.find(a=>a.axisId===targetId),device=dev?{id:dev.driveDeviceId,label:bundle?.inputs.profiles.find(p=>design?.devices.find(d=>d.id===dev.driveDeviceId)?.profile.id===p.id)?.id??dev.driveDeviceId}:null;
 return {device,tags,alarms:alarmsOf(report).filter(a=>a.targetId===targetId||a.targetId==='*')};
}
