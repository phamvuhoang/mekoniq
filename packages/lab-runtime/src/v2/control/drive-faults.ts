// The drive-level fault catalog of R4-A §7.1 and its admission (plan V08). Pure: the server validates a schedule against these bounds before a run exists, the worker checks them again before it applies one.
import type {FaultScheduleEntry} from '../fault-schedule';
import {hashJson} from '../hash';
import type {DriveCommandV1} from './drive-io';

export type DriveFaultId='encoder-dropout'|'motor-weak'|'drive-trip'|'command-delay'|'command-loss'|'grip-weak'|'lidar-noise'|'drive-reset';
export type FaultParamBound={min:number;max:number;multipleOf?:number;required:boolean};
export interface DriveFaultSpec {layer:'command'|'drive'|'feedback'|'sensor';target:'axis'|'gripper'|'lidar';appliedBy:'worker'|'runtime';campaignOnly?:true;params:Readonly<Record<string,FaultParamBound>>}
/** `durationMs` is the entry's own field and is bound like a parameter. A trip or a reset is one tick wide: the latch, not the window, is the fault. Bounds are the spec's; `assumed`. */
const duration=(min:number,max:number):FaultParamBound=>({min,max,required:true,multipleOf:20});
export const DRIVE_FAULTS:Readonly<Record<DriveFaultId,DriveFaultSpec>>={
 'encoder-dropout':{layer:'feedback',target:'axis',appliedBy:'worker',params:{durationMs:duration(20,5000)}},
 'motor-weak':{layer:'drive',target:'axis',appliedBy:'worker',params:{durationMs:duration(20,60000),torqueScale:{min:0.2,max:0.95,required:true}}},
 'drive-trip':{layer:'drive',target:'axis',appliedBy:'worker',params:{durationMs:duration(20,20)}},
 'command-delay':{layer:'command',target:'axis',appliedBy:'worker',params:{durationMs:duration(20,60000),delayMs:{min:20,max:200,multipleOf:2,required:true}}},
 'command-loss':{layer:'command',target:'axis',appliedBy:'runtime',params:{durationMs:duration(20,2000)}},
 'grip-weak':{layer:'drive',target:'gripper',appliedBy:'worker',params:{durationMs:duration(20,60000),torqueScale:{min:0.1,max:0.9,required:true}}},
 'lidar-noise':{layer:'sensor',target:'lidar',appliedBy:'runtime',params:{durationMs:duration(20,60000),sigmaM:{min:0.005,max:0.1,required:true},dropoutFraction:{min:0,max:0.5,required:true}}},
 'drive-reset':{layer:'drive',target:'axis',appliedBy:'worker',campaignOnly:true,params:{durationMs:duration(20,20)}},
};
export const MAX_DRIVE_FAULTS=16;
/** What a worker is told to do and what it answers (contracts §4; the receipt echoes the parameters it applied, so a reader can compare them with the intent). Lab never trusts the schedule as proof of application: only a matching receipt is. */
export interface FaultInjection {entryId:string;faultId:string;targetId:string;params:Record<string,number>;phase:'start'|'end'}
export interface FaultReceipt {entryId:string;faultId:string;targetId:string;params:Record<string,number>;phase:'start'|'end';appliedTick:number;runId:string;bootId:string;sceneDigest:string;requestDigest:string;/** the world supervisor took the effect away on this tick (the base is held by the movement interlock): the injection was due, it did not happen */overriddenBy?:'WORLD_MOVEMENT_INTERLOCK'}
export const isDriveFaultId=(id:string):id is DriveFaultId=>Object.hasOwn(DRIVE_FAULTS,id);
export const isGripperAxis=(axisId:string)=>axisId.endsWith('/gripper');

const inBound=(v:unknown,b:FaultParamBound):boolean=>typeof v==='number'&&Number.isFinite(v)&&v>=b.min&&v<=b.max&&(b.multipleOf===undefined||Math.abs(v/b.multipleOf-Math.round(v/b.multipleOf))<1e-9);
/** The window of an entry on the simulated clock, [start, end) in ms. */
export const faultWindow=(e:Pick<FaultScheduleEntry,'trigger'|'durationMs'>):[number,number]=>{const s=e.trigger.kind==='elapsed_sim_ms'?e.trigger.value:Number.NaN;return [s,s+e.durationMs];};

export function validateDriveFaultSchedule(entries:readonly FaultScheduleEntry[],context:{axes:readonly string[];lidars:readonly string[];campaign:boolean}):{ok:boolean;reasonCodes:string[]}{
 const codes=new Set<string>();
 if(!entries.length)return {ok:true,reasonCodes:[]};
 if(!context.axes.length)return {ok:false,reasonCodes:['FAULT_BACKEND_UNSUPPORTED']};
 if(entries.length>MAX_DRIVE_FAULTS)return {ok:false,reasonCodes:['FAULT_SCHEDULE_TOO_LONG']};
 const ids=new Set<string>(),windows:{faultId:string;targetId:string;from:number;to:number}[]=[];
 for(const e of entries){
  if(ids.has(e.id))codes.add('FAULT_SCHEDULE_INVALID');ids.add(e.id);
  if(!isDriveFaultId(e.faultId)){codes.add('FAULT_UNKNOWN');continue;}
  const spec=DRIVE_FAULTS[e.faultId];
  if(spec.campaignOnly&&!context.campaign)codes.add('FAULT_CAMPAIGN_ONLY');
  if(e.trigger.kind!=='elapsed_sim_ms')codes.add('FAULT_TRIGGER_INVALID');
  const known=spec.target==='lidar'?context.lidars.includes(e.targetId):context.axes.includes(e.targetId)&&isGripperAxis(e.targetId)===(spec.target==='gripper');
  if(!known)codes.add('FAULT_TARGET_INVALID');
  const params=e.params??{};
  let ok=Object.keys(params).every(k=>Object.hasOwn(spec.params,k)&&k!=='durationMs');
  for(const [k,b] of Object.entries(spec.params)){const v=k==='durationMs'?e.durationMs:params[k];if(v===undefined?b.required:!inBound(v,b))ok=false;}
  if(!ok)codes.add('FAULT_PARAM_INVALID');
  if(known&&ok&&e.trigger.kind==='elapsed_sim_ms'){const [from,to]=faultWindow(e);if(windows.some(w=>w.faultId===e.faultId&&w.targetId===e.targetId&&from<w.to&&w.from<to))codes.add('FAULT_OVERLAP');windows.push({faultId:e.faultId,targetId:e.targetId,from,to});}
 }
 return {ok:codes.size===0,reasonCodes:[...codes]};
}

// ---- the timeline: a pure function of the schedule and the tick, so a resumed or replayed run needs no fired-set ------------------------------------------------------
const TICK_MS=20;
/** A trigger fires on the first tick whose step starts at or after it; the window closes duration/20 ticks later (the end tick is outside it). */
export const faultStartTick=(triggerMs:number):number=>Math.ceil(triggerMs/TICK_MS)+1;
export const faultEndTick=(startTick:number,durationMs:number):number=>startTick+Math.ceil(durationMs/TICK_MS);
const startOf=(e:FaultScheduleEntry)=>faultStartTick((e.trigger as {value:number}).value);
/** The injections of the step that produces `targetTick`, ends before starts so one window may open on the tick another of its kind closes. */
export function faultEventsAt(schedule:readonly FaultScheduleEntry[],targetTick:number):FaultInjection[]{
 const ev=(e:FaultScheduleEntry,phase:'start'|'end'):FaultInjection=>({entryId:e.id,faultId:e.faultId,targetId:e.targetId,params:{...e.params},phase});
 const ends=schedule.filter(e=>e.trigger.kind==='elapsed_sim_ms'&&faultEndTick(startOf(e),e.durationMs)===targetTick).map(e=>ev(e,'end'));
 const starts=schedule.filter(e=>e.trigger.kind==='elapsed_sim_ms'&&startOf(e)===targetTick).map(e=>ev(e,'start'));
 return [...ends,...starts];
}
/** What the runtime itself applies at `targetTick`: the runtime faults whose window holds the tick, and their start/end events. */
export function runtimeFaultsAt(schedule:readonly FaultScheduleEntry[],targetTick:number):{active:FaultScheduleEntry[];events:FaultInjection[]}{
 const mine=schedule.filter(e=>isDriveFaultId(e.faultId)&&DRIVE_FAULTS[e.faultId].appliedBy==='runtime');
 return {active:mine.filter(e=>e.trigger.kind==='elapsed_sim_ms'&&startOf(e)<=targetTick&&targetTick<faultEndTick(startOf(e),e.durationMs)),events:faultEventsAt(mine,targetTick)};
}
/** The command-loss axes the world movement interlock takes away: only the base wheels (the supervisor commands a stop, a stale target would be refused); an arm joint's loss is not the supervisor's to override. */
export const interlockOverridden=(active:readonly FaultScheduleEntry[],wheels:ReadonlySet<string>,interlocked:boolean)=>interlocked?active.filter(e=>e.faultId==='command-loss'&&wheels.has(e.targetId)):[];
/** command-loss: the axes in `lost` get the last command that was sent, seq included, instead of the new one. With nothing sent yet there is nothing to repeat. */
export function applyCommandLoss(commands:readonly DriveCommandV1[],last:readonly DriveCommandV1[]|undefined,lost:ReadonlySet<string>):DriveCommandV1[]{
 return commands.map(c=>lost.has(c.axisId)&&last?.find(l=>l.axisId===c.axisId)||c);
}

/** The receipts of a step against the injections the worker was sent: the same entries, phases, faults, targets and parameters in order, this tick, and the step's own run, boot, scene and request digest. Nothing missing, nothing extra, also on a tick that owes none. */
export function receiptsMatch(got:readonly FaultReceipt[]|undefined,sent:readonly {entryId:string;phase:string;faultId:string;targetId:string;params:Record<string,number>}[],ctx:{runId:string;bootId:string;sceneDigest:string;requestDigest:string;targetTick:number}):boolean{
 const rs=got??[];
 return rs.length===sent.length&&sent.every((w,i)=>{const x=rs[i];return !!x&&x.entryId===w.entryId&&x.phase===w.phase&&x.faultId===w.faultId&&x.targetId===w.targetId&&x.appliedTick===ctx.targetTick&&x.runId===ctx.runId&&x.bootId===ctx.bootId&&x.sceneDigest===ctx.sceneDigest&&x.requestDigest===ctx.requestDigest&&hashJson(x.params)===hashJson(w.params);});
}
