import {expect,test} from 'vitest';
import {buildFaultReport,faultEndTick,faultStartTick} from '../../packages/lab-runtime/src/v2/fault-report';
import type {FaultOracleV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import type {FaultReceipt} from '../../packages/lab-runtime/src/v2/control/drive-faults';
import type {FaultScheduleEntry} from '../../packages/lab-runtime/src/v2/fault-schedule';

const detector=(faultId:string,by:'drive'|'controller'|null,codes:string[],deadlineTicks:number|null,required:boolean)=>({faultId,required,detector:by,codes,deadlineTicks});
const oracle={schemaVersion:1,documentType:'fault-oracle',id:'t',revision:1,digest:'0'.repeat(64),calibration:'not_calibrated',
 faults:[detector('encoder-dropout','drive',['FEEDBACK_LOSS'],3,true),detector('motor-weak','controller',['TRACKING_DEGRADED'],null,false),detector('drive-trip','controller',['DRIVE_FAULT'],2,true),detector('command-delay',null,[],null,false),
  detector('command-loss','drive',['COMMAND_TIMEOUT'],5,true),detector('grip-weak',null,[],null,false),detector('lidar-noise',null,[],null,false),detector('drive-reset',null,[],null,false)],
 invariantPolicy:{holdToleranceRad:0.02,torqueEpsNm:1e-9,timeoutSettleTicks:2},source:{kind:'assumed',documentId:'x',revision:'1',locator:'x',contentSha256:'0'.repeat(64)}} as unknown as FaultOracleV1;
const AX='amr-1/wheel-right',OTHER='amr-1/wheel-left';
const entry=(faultId:string,at:number,durationMs:number,params:Record<string,number>={},targetId=AX):FaultScheduleEntry=>({id:`${faultId}@${at}`,faultId,targetId,trigger:{kind:'elapsed_sim_ms',value:at},durationMs,params});
const receipt=(e:FaultScheduleEntry,phase:'start'|'end',appliedTick:number,over:Partial<FaultReceipt>={}):FaultReceipt=>({entryId:e.id,faultId:e.faultId,targetId:e.targetId,params:e.params??{},phase,appliedTick,runId:'run-1',bootId:'boot-1',sceneDigest:'s',requestDigest:'r',...over});
const snap=(axisId:string,tick:number,o:Partial<{state:string;fault:string|null;commandSeq:number;torqueNm:number;targetApplied:number;actualPositionRad:number;actualVelocityRadS:number}>={})=>({axisId,state:'enabled',fault:null,commandSeq:tick,positionRad:null,velocityRadS:null,torqueNm:0.1,tick,targetApplied:0,actualPositionRad:0,actualVelocityRadS:0,saturatedSubsteps:0,followingErrorRad:null,...o}) as never;
const drives=(n:number,f:(axis:string,t:number)=>Parameters<typeof snap>[2]=()=>({}))=>Array.from({length:n+1},(_,t)=>({tick:t,drives:[OTHER,AX].map(a=>snap(a,t,f(a,t)))}));
const base={runId:'run-1',oracle,controllerEvents:[],attention:[],physics:[],facts:{reportedServed:0,confirmedServed:0,resendsAfterUnknown:0,custodyChanged:null as boolean|null}};

test('tick arithmetic: a trigger fires on the first tick whose step starts at or after it, the window closes duration/20 ticks later',()=>{
 expect(faultStartTick(0)).toBe(1);expect(faultStartTick(20)).toBe(2);expect(faultStartTick(25)).toBe(3);
 expect(faultEndTick(2,300)).toBe(17);
});
test('an entry without a start receipt is not_fired, and no detection is searched for',()=>{
 const e=entry('encoder-dropout',400,300);
 const r=buildFaultReport({...base,schedule:[e],receipts:[],drives:drives(40,(a,t)=>a===AX&&t>25?{fault:'FEEDBACK_LOSS',state:'fault'}:{})});
 expect(r.entries[0]).toMatchObject({verdict:'not_fired',injection:{appliedTick:null,endedTick:null},detection:{by:null,code:null,tick:null,latencyTicks:null}});
 expect(r.accepted).toBe(false);
});
test('a drive detection inside the oracle deadline is detected_in_time, with its latency',()=>{
 const e=entry('encoder-dropout',400,300),start=faultStartTick(400);   // tick 21
 const r=buildFaultReport({...base,schedule:[e],receipts:[receipt(e,'start',start),receipt(e,'end',faultEndTick(start,300))],drives:drives(60,(a,t)=>a===AX&&t>=start+2?{fault:'FEEDBACK_LOSS',state:'fault'}:{})});
 expect(r.entries[0]).toMatchObject({verdict:'detected_in_time',injection:{appliedTick:start,endedTick:start+15},detection:{by:'drive',code:'FEEDBACK_LOSS',tick:start+2,latencyTicks:2}});
 expect(r.entries[0]!.plantResponse.axisFault).toBe('FEEDBACK_LOSS');
});
test('a detection after the deadline is detected_late; a detection on another axis does not count; one before the fault does not count',()=>{
 const e=entry('command-loss',100,200),start=faultStartTick(100);
 const late=buildFaultReport({...base,schedule:[e],receipts:[receipt(e,'start',start)],drives:drives(40,(a,t)=>a===AX&&t>=start+8?{fault:'COMMAND_TIMEOUT',state:'fault',torqueNm:0}:{})});
 expect(late.entries[0]).toMatchObject({verdict:'detected_late',detection:{tick:start+8,latencyTicks:8}});
 const wrongAxis=buildFaultReport({...base,schedule:[e],receipts:[receipt(e,'start',start)],drives:drives(40,(a,t)=>a===OTHER&&t>=start+2?{fault:'COMMAND_TIMEOUT',state:'fault'}:{})});
 expect(wrongAxis.entries[0]!.verdict).toBe('not_detected');
 const before=buildFaultReport({...base,schedule:[e],receipts:[receipt(e,'start',start)],drives:drives(40,(a,t)=>a===AX&&t>=1?{fault:'COMMAND_TIMEOUT',state:'fault'}:{})});
 expect(before.entries[0]).toMatchObject({verdict:'detected_in_time',detection:{tick:start}});   // a fault already latched when the entry fires is seen on its first tick, not earlier
});
test('controller events detect a trip by axis; faults the oracle does not require stay not_detected without a detector',()=>{
 const trip=entry('drive-trip',100,20),delay=entry('command-delay',200,100,{delayMs:40},OTHER),start=faultStartTick(100);
 const r=buildFaultReport({...base,schedule:[trip,delay],receipts:[receipt(trip,'start',start),receipt(trip,'end',start+1),receipt(delay,'start',faultStartTick(200))],drives:drives(40),controllerEvents:[{tick:start+1,code:'DRIVE_FAULT',axisId:AX},{tick:start+1,code:'DRIVE_FAULT',axisId:OTHER}]});
 expect(r.entries[0]).toMatchObject({verdict:'detected_in_time',detection:{by:'controller',code:'DRIVE_FAULT',tick:start+1,latencyTicks:1}});
 expect(r.entries[1]).toMatchObject({verdict:'not_detected',detection:{by:null}});
});
test('a receipt that differs from the intent in id, target, parameters, tick or run throws FAULT_EVIDENCE_INVALID',()=>{
 const e=entry('motor-weak',100,1000,{torqueScale:0.5}),start=faultStartTick(100);
 const build=(rs:FaultReceipt[])=>()=>buildFaultReport({...base,schedule:[e],receipts:rs,drives:drives(80)});
 expect(build([receipt(e,'start',start)])).not.toThrow();
 for(const bad of [receipt(e,'start',start,{params:{torqueScale:0.4}}),receipt(e,'start',start,{targetId:OTHER}),receipt(e,'start',start,{faultId:'drive-trip'}),receipt(e,'start',start+1),receipt(e,'start',start,{runId:'other'}),receipt(e,'start',start,{entryId:'ghost'})])
  expect(build([bad]),JSON.stringify(bad)).toThrow('FAULT_EVIDENCE_INVALID');
 expect(build([receipt(e,'start',start),receipt(e,'start',start)])).toThrow('FAULT_EVIDENCE_INVALID');                 // twice
 expect(build([receipt(e,'end',faultEndTick(start,1000))])).toThrow('FAULT_EVIDENCE_INVALID');                          // an end without its start
 expect(build([receipt(e,'start',start),receipt(e,'end',faultEndTick(start,1000)+1)])).toThrow('FAULT_EVIDENCE_INVALID'); // closes at the wrong tick
});
test('drive records that skip a tick or repeat one are evidence errors',()=>{
 const e=entry('drive-trip',100,20);
 const d=drives(10);d.splice(4,1);
 expect(()=>buildFaultReport({...base,schedule:[e],receipts:[],drives:d})).toThrow('FAULT_EVIDENCE_INVALID');
});
test('invariants are judged from the drive records and the run facts',()=>{
 const e=entry('command-loss',100,200),start=faultStartTick(100);
 const ok=buildFaultReport({...base,schedule:[e],receipts:[receipt(e,'start',start)],drives:drives(40,(a,t)=>a===AX&&t>=start+4?{fault:'COMMAND_TIMEOUT',state:'fault',torqueNm:0,commandSeq:start+3}:{})});
 const by=Object.fromEntries(ok.invariants.map(i=>[i.id,i.result]));
 expect(by).toEqual({NO_FALSE_SERVE:'pass',NO_RESEND_AFTER_UNKNOWN:'pass',NO_MOTION_BEFORE_ENABLED:'pass',CUSTODY_UNCHANGED:'not_applicable',LATCH_HELD:'pass',TORQUE_ZERO_AFTER_TIMEOUT:'pass'});
 // torque still flowing two ticks after the timeout latched
 const live=buildFaultReport({...base,schedule:[e],receipts:[receipt(e,'start',start)],drives:drives(40,(a,t)=>a===AX&&t>=start+4?{fault:'COMMAND_TIMEOUT',state:'fault',torqueNm:0.5,commandSeq:start+3}:{})});
 expect(live.invariants.find(i=>i.id==='TORQUE_ZERO_AFTER_TIMEOUT')).toMatchObject({result:'violated',tick:start+6});
 // a latched fault that vanishes without a fresh command
 const cleared=buildFaultReport({...base,schedule:[e],receipts:[receipt(e,'start',start)],drives:drives(40,(a,t)=>a===AX&&t>=start+4&&t<start+8?{fault:'COMMAND_TIMEOUT',state:'fault',torqueNm:0,commandSeq:start+3}:{commandSeq:start+3})});
 expect(cleared.invariants.find(i=>i.id==='LATCH_HELD')).toMatchObject({result:'violated',tick:start+8});
 // …but a fresh command (a reset edge) or an injected drive-reset may clear it
 const reset=entry('drive-reset',200,20),rs=faultStartTick(200);
 const injected=buildFaultReport({...base,schedule:[reset],receipts:[receipt(reset,'start',rs)],drives:drives(40,(a,t)=>a===AX&&t>=2&&t<rs?{fault:'EXTERNAL_TRIP',state:'fault',commandSeq:1}:{commandSeq:1})});
 expect(injected.invariants.find(i=>i.id==='LATCH_HELD')!.result).toBe('pass');
 // motion toward a disabled axis
 const moving=buildFaultReport({...base,schedule:[e],receipts:[],drives:drives(10,(a,t)=>a===AX&&t===5?{state:'disabled',targetApplied:2}:{})});
 expect(moving.invariants.find(i=>i.id==='NO_MOTION_BEFORE_ENABLED')).toMatchObject({result:'violated',tick:5});
 // facts
 const facts=buildFaultReport({...base,schedule:[],receipts:[],drives:drives(3),facts:{reportedServed:1,confirmedServed:0,resendsAfterUnknown:1,custodyChanged:true}});
 expect(Object.fromEntries(facts.invariants.map(i=>[i.id,i.result]))).toMatchObject({NO_FALSE_SERVE:'violated',NO_RESEND_AFTER_UNKNOWN:'violated',CUSTODY_UNCHANGED:'violated'});
});
test('plant response: peak speed and ticks to rest after the fault',()=>{
 const e=entry('drive-trip',100,20),start=faultStartTick(100);
 const r=buildFaultReport({...base,schedule:[e],receipts:[receipt(e,'start',start)],drives:drives(30,(a,t)=>a===AX?{actualVelocityRadS:t<start?5:Math.max(0,5-(t-start)),state:t>=start?'fault':'enabled',fault:t>=start?'EXTERNAL_TRIP':null}:{}),
  physics:Array.from({length:31},(_,t)=>({tick:t,base:[{poseMap:{positionM:[Math.min(t,start+5)*0.1,0,0]}}]}))});
 expect(r.entries[0]!.plantResponse).toMatchObject({axisState:'fault',axisFault:'EXTERNAL_TRIP',peakActualSpeedRadS:5,ticksToRest:5});
 expect(r.entries[0]!.plantResponse.baseTravelM).toBeCloseTo(0.5,9);
});
test('the first tick the applied drive target changes after the fault is reported',()=>{
 const e=entry('motor-weak',100,1000,{torqueScale:0.5}),start=faultStartTick(100);
 const r=buildFaultReport({...base,schedule:[e],receipts:[receipt(e,'start',start)],drives:drives(30,(a,t)=>a===AX&&t>=start+3?{targetApplied:1}:{})});
 expect(r.entries[0]!.firstCommandChangeTick).toBe(start+3);
});

import {faultEventsAt} from '../../packages/lab-runtime/src/v2/control/drive-faults';
test('with the recorded intents the report reconciles them against the schedule and the receipts, tick by tick',()=>{
 const e=entry('motor-weak',100,100,{torqueScale:0.5}),start=faultStartTick(100),end=faultEndTick(start,100);
 const intents=(extra:{tick:number;injections:ReturnType<typeof faultEventsAt>}[]=[])=>[...[start,end].map(t=>({tick:t,injections:faultEventsAt([e],t)})),...extra].sort((a,b)=>a.tick-b.tick);
 const good=[receipt(e,'start',start),receipt(e,'end',end)];
 const build=(i:ReturnType<typeof intents>,r=good,n=40)=>()=>buildFaultReport({...base,schedule:[e],receipts:r,intents:i,drives:drives(n)});
 expect(build(intents())).not.toThrow();
 expect(build(intents().slice(1))).toThrow('FAULT_EVIDENCE_INVALID');                                              // an intent the schedule demands was never recorded
 expect(build([...intents(),{tick:start+1,injections:faultEventsAt([e],start)}])).toThrow('FAULT_EVIDENCE_INVALID');  // an intent the schedule does not have
 expect(build(intents(),[good[0]!])).toThrow('FAULT_EVIDENCE_INVALID');                                             // an intent with no receipt, inside the run
 expect(build(intents(),[good[0]!],start+2)).not.toThrow();                                                          // the run ended inside the window: the end is simply not due yet
 expect(build(intents(),[receipt(e,'start',start),receipt(e,'end',end,{requestDigest:'other'})])).not.toThrow();      // digests are per tick, not across ticks
 expect(()=>buildFaultReport({...base,schedule:[e],receipts:[good[0]!,{...good[0]!,entryId:'x'}],intents:intents(),drives:drives(40)})).toThrow('FAULT_EVIDENCE_INVALID');
});
test('receipts of one tick must agree on the run boot and the request digest',()=>{
 const a=entry('motor-weak',100,100,{torqueScale:0.5}),b=entry('encoder-dropout',100,100,{},OTHER),start=faultStartTick(100);
 const intents=[{tick:start,injections:faultEventsAt([a,b],start)}];
 const ok=[receipt(a,'start',start),receipt(b,'start',start)];
 expect(()=>buildFaultReport({...base,schedule:[a,b],receipts:ok,intents,drives:drives(start+1)})).not.toThrow();
 for(const bad of [{requestDigest:'x'},{bootId:'boot-2'}])
  expect(()=>buildFaultReport({...base,schedule:[a,b],receipts:[ok[0]!,{...ok[1]!,...bad}],intents,drives:drives(start+1)}),JSON.stringify(bad)).toThrow('FAULT_EVIDENCE_INVALID');
});

import {servedFacts} from '../../packages/lab-runtime/src/v2/fault-report';
test('a serve confirmed after a fault latched on an axis that never recovered does not count as confirmed',()=>{
 const faulted=drives(30,(a,t)=>a===AX&&t>=10?{fault:'EXTERNAL_TRIP',state:'fault'}:{});
 expect(servedFacts(faulted,[5])).toEqual({reportedServed:1,confirmedServed:1});
 expect(servedFacts(faulted,[5,12])).toEqual({reportedServed:2,confirmedServed:1});
 expect(servedFacts(drives(30),[5,29])).toEqual({reportedServed:2,confirmedServed:2});
 // a fault that was cleared later does not poison the serves after it
 const healed=drives(30,(a,t)=>a===AX&&t>=10&&t<15?{fault:'EXTERNAL_TRIP',state:'fault'}:{});
 expect(servedFacts(healed,[20])).toEqual({reportedServed:1,confirmedServed:1});
});
