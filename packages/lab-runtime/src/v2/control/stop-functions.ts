// R5 stop functions (spec R5-B 5.1, 5.2): the three ways a mobile run is told to stop, as a closed list, a schedule on the simulated clock and the intents and receipts that prove each was applied.
// Pure: the schedule and the tick decide everything, so a resumed or replayed run needs no fired set. Emergency stops never go through the controller; normal and protective ones do.
import type {StopIntentV1,StopReceiptV1,StopScheduleEntryV1,StopInjectionV1} from './drive-io';
import {faultStartTick} from './drive-faults';
import {hashJson} from '../hash';

export type StopFunctionId='normal'|'protective'|'emergency';
export const STOP_FUNCTIONS:readonly StopFunctionId[]=['normal','protective','emergency'];
export const MAX_STOP_ENTRIES=4;
export type {StopScheduleEntryV1,StopInjectionV1,StopIntentV1,StopReceiptV1};

/** Admission of a run's `stopSchedule`: only a run with a drive, at most four entries, known functions, a trigger on the simulated clock inside the mission, and never two entries on one tick. */
export function validateStopSchedule(entries:readonly StopScheduleEntryV1[],context:{axes:readonly string[];functions:readonly StopFunctionId[];missionEndMs:number|null}):{ok:boolean;reasonCodes:string[]}{
 const codes=new Set<string>();
 if(!entries.length)return {ok:true,reasonCodes:[]};
 if(!context.axes.length)return {ok:false,reasonCodes:['STOP_BACKEND_UNSUPPORTED']};
 if(entries.length>MAX_STOP_ENTRIES)return {ok:false,reasonCodes:['STOP_SCHEDULE_TOO_LONG']};
 const ids=new Set<string>(),ticks=new Set<number>();
 for(const e of entries){
  if(ids.has(e.id))codes.add('STOP_SCHEDULE_INVALID');ids.add(e.id);
  if(!context.functions.includes(e.function))codes.add('STOP_FUNCTION_UNKNOWN');
  if(e.trigger.kind!=='elapsed_sim_ms'||!Number.isFinite(e.trigger.value)||e.trigger.value<0||(context.missionEndMs!==null&&e.trigger.value>=context.missionEndMs)){codes.add('STOP_TRIGGER_INVALID');continue;}
  const tick=faultStartTick(e.trigger.value);
  if(ticks.has(tick))codes.add('STOP_OVERLAP');ticks.add(tick);
 }
 return {ok:codes.size===0,reasonCodes:[...codes].sort()};
}
/** The tick of the step that carries the stop out. */
export const stopStartTick=(e:Pick<StopScheduleEntryV1,'trigger'>):number=>faultStartTick(e.trigger.value);
/** What is due on the step that produces `targetTick`. */
export const stopTimeline=(entries:readonly StopScheduleEntryV1[],targetTick:number):{due:StopScheduleEntryV1[]}=>({due:entries.filter(e=>stopStartTick(e)===targetTick)});
/** Who must act on `targetTick`: the controller (normal, protective) is told through the setpoint, the worker (emergency) through an injection over the safety-chain axes. */
export function stopIntentsForTick(entries:readonly StopScheduleEntryV1[],targetTick:number,chainAxes:readonly string[]):{controller:StopIntentV1[];worker:StopInjectionV1[];intents:StopIntentV1[]}{
 const due=stopTimeline(entries,targetTick).due,intent=(e:StopScheduleEntryV1,appliedBy:'controller'|'worker'):StopIntentV1=>({entryId:e.id,function:e.function,appliedBy,targetTick});
 const controller=due.filter(e=>e.function!=='emergency').map(e=>intent(e,'controller')),emergencies=due.filter(e=>e.function==='emergency');
 return {controller,worker:emergencies.map(e=>({entryId:e.id,function:'emergency' as const,axes:[...chainAxes]})),intents:[...controller,...emergencies.map(e=>intent(e,'worker'))]};
}
/** The controller-level request in force on the step that produces `targetTick`: protective beats normal, and neither is ever taken back. */
export function stopModeAt(entries:readonly StopScheduleEntryV1[],targetTick:number):'normal'|'protective'|null{
 let mode:'normal'|'protective'|null=null;
 for(const e of entries){
  if(e.function==='emergency'||stopStartTick(e)>targetTick)continue;
  if(e.function==='protective')return 'protective';
  mode='normal';
 }
 return mode;
}
/** Receipts against intents: same entries in order, this tick, the step's own run, boot, scene and request digest; the worker's receipts come from the worker, the controller's are the runtime's own. Nothing missing, nothing extra. */
export function stopReceiptsMatch(got:readonly StopReceiptV1[]|undefined,sent:readonly StopInjectionV1[],ctx:{runId:string;bootId:string;sceneDigest:string;requestDigest:string;targetTick:number}):boolean{
 const rs=got??[];
 return rs.length===sent.length&&sent.every((w,i)=>{const x=rs[i];return !!x&&x.entryId===w.entryId&&x.function==='emergency'&&x.appliedBy==='worker'&&x.appliedTick===ctx.targetTick&&x.runId===ctx.runId&&x.bootId===ctx.bootId&&x.sceneDigest===ctx.sceneDigest&&x.requestDigest===ctx.requestDigest;});
}
export const stopScheduleHash=(entries:readonly StopScheduleEntryV1[])=>hashJson(entries);
