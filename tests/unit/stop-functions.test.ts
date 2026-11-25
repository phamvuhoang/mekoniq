import {describe,expect,test} from 'vitest';
import {type StopFunctionId,STOP_FUNCTIONS,stopIntentsForTick,stopModeAt,stopReceiptsMatch,stopTimeline,validateStopSchedule,type StopScheduleEntryV1} from '../../packages/lab-runtime/src/v2/control/stop-functions';
import {diffDriveBaseV1,type DiffDriveBaseConfig} from '../../packages/lab-runtime/src/v2/control/diff-drive-base';
import type {DriveFeedbackV1} from '../../packages/lab-runtime/src/v2/control/drive-io';

const AXES=['amr-1/wheel-left','amr-1/wheel-right'];
const e=(id:string,fn:StopScheduleEntryV1['function'],at:number):StopScheduleEntryV1=>({id,function:fn,trigger:{kind:'elapsed_sim_ms',value:at}});
const ctx:{axes:readonly string[];functions:readonly StopFunctionId[];missionEndMs:number|null}={axes:AXES,functions:STOP_FUNCTIONS,missionEndMs:null};
const codes=(entries:StopScheduleEntryV1[],c=ctx)=>validateStopSchedule(entries,c).reasonCodes;

describe('admission',()=>{
 test('an empty schedule is fine, also without a drive',()=>{expect(validateStopSchedule([],{...ctx,axes:[]})).toEqual({ok:true,reasonCodes:[]});});
 test('a run without a drive refuses any stop',()=>{expect(codes([e('a','emergency',2000)],{...ctx,axes:[]})).toEqual(['STOP_BACKEND_UNSUPPORTED']);});
 test('five entries are too long',()=>{expect(codes([1,2,3,4,5].map(i=>e('s'+i,'normal',i*1000)))).toEqual(['STOP_SCHEDULE_TOO_LONG']);});
 test('a function the fixture does not have',()=>{expect(codes([e('a','emergency',2000)],{...ctx,functions:['normal']})).toEqual(['STOP_FUNCTION_UNKNOWN']);});
 test('two entries on one tick overlap; two on different ticks do not',()=>{
  expect(codes([e('a','normal',1990),e('b','emergency',2000)])).toEqual(['STOP_OVERLAP']);expect(codes([e('a','normal',2000),e('b','emergency',2020)])).toEqual([]);
 });
 test('a trigger that is not simulated time, negative, or at or after the mission end',()=>{
  expect(codes([{id:'a',function:'normal',trigger:{kind:'wall_clock_ms',value:5}} as never])).toEqual(['STOP_TRIGGER_INVALID']);
  expect(codes([e('a','normal',-1)])).toEqual(['STOP_TRIGGER_INVALID']);expect(codes([e('a','normal',9000)],{...ctx,missionEndMs:9000} as typeof ctx)).toEqual(['STOP_TRIGGER_INVALID']);
 });
 test('a repeated id is an invalid schedule',()=>{expect(codes([e('a','normal',1000),e('a','normal',2000)])).toEqual(['STOP_SCHEDULE_INVALID']);});
});

describe('timeline',()=>{
 const sched=[e('n','normal',2000),e('p','protective',4000),e('x','emergency',6000)];
 test('an entry is due on the step that starts at or after its trigger, and only then',()=>{
  expect(stopTimeline(sched,101).due.map(x=>x.id)).toEqual(['n']);expect(stopTimeline(sched,100).due).toEqual([]);expect(stopTimeline(sched,102).due).toEqual([]);
 });
 test('emergency goes to the worker over the chain axes; normal and protective go to the controller',()=>{
  expect(stopIntentsForTick(sched,301,AXES)).toEqual({controller:[],worker:[{entryId:'x',function:'emergency',axes:AXES}],intents:[{entryId:'x',function:'emergency',appliedBy:'worker',targetTick:301}]});
  expect(stopIntentsForTick(sched,101,AXES).controller).toEqual([{entryId:'n',function:'normal',appliedBy:'controller',targetTick:101}]);
 });
 test('the controller level request: none, normal, then protective for good',()=>{
  expect([100,101,200,201,500].map(t=>stopModeAt(sched,t))).toEqual([null,'normal','normal','protective','protective']);
  expect(stopModeAt([e('x','emergency',100)],500)).toBeNull();
 });
 test('it is a pure function of the schedule and the tick',()=>{expect(stopModeAt(sched,250)).toBe(stopModeAt([...sched].reverse(),250));});
});

describe('receipts',()=>{
 const sent=[{entryId:'x',function:'emergency' as const,axes:AXES}],c={runId:'r',bootId:'b',sceneDigest:'s'.repeat(64),requestDigest:'q'.repeat(64),targetTick:301};
 const good={entryId:'x',function:'emergency' as const,appliedBy:'worker' as const,appliedTick:301,runId:'r',bootId:'b',sceneDigest:'s'.repeat(64),requestDigest:'q'.repeat(64)};
 test('a matching receipt, none on a quiet tick',()=>{expect(stopReceiptsMatch([good],sent,c)).toBe(true);expect(stopReceiptsMatch(undefined,[],c)).toBe(true);});
 test('a missing, extra, late, foreign or controller-made receipt is a mismatch',()=>{
  expect(stopReceiptsMatch([],sent,c)).toBe(false);expect(stopReceiptsMatch([good],[],c)).toBe(false);
  for(const bad of [{appliedTick:302},{entryId:'y'},{runId:'other'},{requestDigest:'z'.repeat(64)},{appliedBy:'controller' as const}])expect(stopReceiptsMatch([{...good,...bad}],sent,c)).toBe(false);
 });
});

describe('controller revision 3',()=>{
 const base:DiffDriveBaseConfig={axisLeft:AXES[0]!,axisRight:AXES[1]!,wheelRadiusM:0.09,wheelSeparationM:0.36,maxWheelAccelRadS2:20,enableTimeoutTicks:25,trackingDegradedRadS:1,trackingDegradedTicks:25};
 const fb=(state:'enabled'|'quick_stop'|'disabled'):DriveFeedbackV1[]=>AXES.map(axisId=>({axisId,state,fault:null,commandSeq:0,positionRad:0,velocityRadS:0,torqueNm:0,tick:0}) as DriveFeedbackV1);
 const drive=(cfg:DiffDriveBaseConfig,plan:{mode?:'normal'|'protective'|null;state?:'enabled'|'quick_stop'|'disabled'}[])=>{
  let s=diffDriveBaseV1.init(cfg);const out=[];
  for(const [tick,p] of plan.entries()){const r=diffDriveBaseV1.step(s,{tick,setpoint:{vMps:0.8,omegaRadps:0,...p.mode?{stopMode:p.mode}:{}},feedback:fb(p.state??'enabled')});s=r.state;out.push(r);}
  return out;
 };
 const stopAware={...base,stopAware:true};
 test('a normal stop brings the targets down by the acceleration step and keeps the drive enabled',()=>{
  const out=drive(stopAware,[{},{},{},{mode:'normal'},{mode:'normal'},{mode:'normal'}]),t=out.map(r=>r.commands[0]!.target);
  expect(t[3]!).toBeLessThan(t[2]!);expect(t[4]!).toBeLessThan(t[3]!);expect(out.every(r=>r.commands.every(c=>c.enable&&!c.quickStop))).toBe(true);
  expect(out[3]!.events.map(x=>x.code)).toEqual(['NORMAL_STOP']);expect(out[4]!.events).toEqual([]);
 });
 test('a protective stop commands quickStop from that tick on, and a later navigation setpoint does not take it back',()=>{
  const out=drive(stopAware,[{},{mode:'protective'},{},{},{state:'quick_stop'},{state:'disabled'}]);
  expect(out.map(r=>r.commands[0]!.quickStop)).toEqual([false,true,true,true,true,true]);expect(out.slice(1).every(r=>r.commands.every(c=>c.target===0&&c.enable))).toBe(true);
  expect(out[1]!.events.map(x=>x.code)).toEqual(['PROTECTIVE_STOP']);
 });
 test('a protective stop leaves the drive disabled on purpose: no enable failure is reported however long it lasts',()=>{
  const out=drive(stopAware,[{mode:'protective'},...Array.from({length:60},()=>({state:'disabled' as const}))]);
  expect(out.flatMap(r=>r.events).map(x=>x.code)).toEqual(['PROTECTIVE_STOP']);
 });
 test('revisions 1 and 2 ignore a stop request: not a byte of their commands changes',()=>{
  const plain=drive(base,[{},{},{}]),asked=drive(base,[{},{mode:'protective'},{mode:'normal'}]);
  expect(JSON.stringify(asked.map(r=>r.commands))).toBe(JSON.stringify(plain.map(r=>r.commands)));
 });
});
