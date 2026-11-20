// The drive-level fault catalog of R4-A §7.1 and its admission (plan V08). Pure: the server validates a schedule against these bounds before a run exists, the worker checks them again before it applies one.
import type {FaultScheduleEntry} from '../fault-schedule';

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
export interface FaultReceipt {entryId:string;faultId:string;targetId:string;params:Record<string,number>;phase:'start'|'end';appliedTick:number;runId:string;bootId:string;sceneDigest:string;requestDigest:string}
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
