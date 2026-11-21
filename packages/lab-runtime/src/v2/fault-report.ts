// FaultReportV1 (R4-A §7.2, plan V08), built from evidence that was read back: the schedule is intent, only a matching receipt proves a fault was applied, and nothing in the report comes from
// the runner's hot state. Pure: callers hand over the verified streams. A receipt that disagrees with its intent, or drive records with a hole, make the whole report FAULT_EVIDENCE_INVALID.
import {hashJson} from './hash';
import type {ControllerEvent} from './control/controller';
import type {DriveAxisSnapshot,FaultOracleV1,FaultReportV1} from './control/drive-io';
import {faultEndTick,faultEventsAt,faultStartTick,type FaultInjection,type FaultReceipt} from './control/drive-faults';
export {faultEndTick,faultStartTick};
import type {FaultScheduleEntry} from './fault-schedule';

const REST_RADS=0.01;   // an axis counts as at rest below this true speed: a report policy, not a safety value
const invalid=(why:string):never=>{throw new Error(`FAULT_EVIDENCE_INVALID:${why}`);};
const same=(a:Record<string,number>,b:Record<string,number>)=>hashJson(Object.fromEntries(Object.entries(a).sort(([x],[y])=>x<y?-1:1)))===hashJson(Object.fromEntries(Object.entries(b).sort(([x],[y])=>x<y?-1:1)));

export interface FaultReportInput {
 runId:string;schedule:readonly FaultScheduleEntry[];receipts:readonly FaultReceipt[];
 drives:readonly {tick:number;drives:readonly DriveAxisSnapshot[]}[];controllerEvents:readonly ControllerEvent[];attention:readonly {tick:number;reason:string}[];
 physics:readonly {tick:number;base?:readonly {poseMap:{positionM:readonly number[]}}[]}[];oracle:FaultOracleV1;
 /** what the Source's own journal says about the run, independent of the drive records: served counts, mutation resends after an unknown ACK, whether any custody changed (null: no custody in this run) */
 facts:{reportedServed:number;confirmedServed:number;resendsAfterUnknown:number;custodyChanged:boolean|null};
 /** What the records say the runner sent, tick by tick. When given, the report reconciles it with the schedule and the receipts: nothing the schedule demands may be missing, nothing it does not may be there. */
 intents?:readonly {tick:number;injections:readonly FaultInjection[]}[];
 evidence?:FaultReportV1['evidence'];
}
type Entry=FaultReportV1['entries'][number];
type Invariant=FaultReportV1['invariants'][number];

export function buildFaultReport(input:FaultReportInput):FaultReportV1{
 const {schedule,drives,oracle}=input;
 drives.forEach((r,i)=>{if(i>0&&r.tick!==drives[i-1]!.tick+1)invalid(`DRIVE_TICKS:${r.tick}`);});
 const byEntry=new Map<string,{start?:FaultReceipt;end?:FaultReceipt}>();
 for(const r of input.receipts){
  const e=schedule.find(x=>x.id===r.entryId);
  if(!e||e.faultId!==r.faultId||e.targetId!==r.targetId||r.runId!==input.runId||!r.bootId||!r.sceneDigest||!r.requestDigest||!same(r.params??{},e.params??{}))invalid(`RECEIPT_MISMATCH:${r.entryId}`);
  if(e!.trigger.kind!=='elapsed_sim_ms')invalid(`TRIGGER:${r.entryId}`);
  const slot=byEntry.get(r.entryId)??{};byEntry.set(r.entryId,slot);
  const start=faultStartTick((e!.trigger as {value:number}).value);
  if(r.phase==='start'){if(slot.start||r.appliedTick!==start)invalid(`START_TICK:${r.entryId}`);slot.start=r;}
  else{if(!slot.start||slot.end||r.appliedTick!==faultEndTick(start,e!.durationMs))invalid(`END_TICK:${r.entryId}`);slot.end=r;}
 }
 if(input.intents)reconcile(input,drives.map(d=>d.tick));
 const entries=schedule.map((e):Entry=>{
  const rec=byEntry.get(e.id),spec=oracle.faults.find(f=>f.faultId===e.faultId),applied=rec?.start?.appliedTick??null;
  const axisRecs=drives.map(r=>({tick:r.tick,s:r.drives.find(d=>d.axisId===e.targetId)})).filter((x):x is {tick:number;s:DriveAxisSnapshot}=>!!x.s);
  let found:{tick:number;code:string}|null=null;
  if(applied!==null&&spec?.detector){
   const hit=(code:string)=>spec.codes.includes(code);
   if(spec.detector==='drive'){for(const x of axisRecs)if(x.tick>=applied&&x.s.fault&&hit(x.s.fault)){found={tick:x.tick,code:x.s.fault};break;}}
   else if(spec.detector==='controller'){const m=input.controllerEvents.filter(c=>c.tick>=applied&&hit(c.code)&&(c.axisId===undefined||c.axisId===e.targetId)).sort((a,b)=>a.tick-b.tick)[0];if(m)found={tick:m.tick,code:m.code};}
   else{const m=input.attention.filter(a=>a.tick>=applied&&hit(a.reason)).sort((a,b)=>a.tick-b.tick)[0];if(m)found={tick:m.tick,code:m.reason};}
  }
  const latency=found&&applied!==null?found.tick-applied:null;
  const verdict:Entry['verdict']=applied===null?'not_fired':!found?'not_detected':spec?.deadlineTicks==null||latency!<=spec.deadlineTicks?'detected_in_time':'detected_late';
  let firstChange:number|null=null,restTick:number|null=null,peak:number|null=null;
  if(applied!==null){
   for(const [i,x] of axisRecs.entries())if(x.tick>=applied&&i>0&&axisRecs[i-1]!.tick===x.tick-1&&x.s.targetApplied!==axisRecs[i-1]!.s.targetApplied){firstChange=x.tick;break;}
   for(const x of axisRecs)if(x.tick>=applied){peak=Math.max(peak??0,Math.abs(x.s.actualVelocityRadS));if(restTick===null&&Math.abs(x.s.actualVelocityRadS)<REST_RADS)restTick=x.tick;}
  }
  const pos=(tick:number)=>input.physics.find(p=>p.tick===tick)?.base?.[0]?.poseMap.positionM;
  const a=applied===null?undefined:pos(applied),b=restTick===null?undefined:pos(restTick);
  const last=axisRecs.at(-1)?.s;
  return {entryId:e.id,faultId:e.faultId,targetId:e.targetId,params:{...e.params},durationMs:e.durationMs,
   injection:{appliedTick:applied,endedTick:rec?.end?.appliedTick??null},
   detection:{by:found?spec!.detector:null,code:found?.code??null,tick:found?.tick??null,latencyTicks:latency},
   firstCommandChangeTick:firstChange,
   plantResponse:{axisState:last?.state??null,axisFault:last?.fault??null,peakActualSpeedRadS:peak,ticksToRest:applied!==null&&restTick!==null?restTick-applied:null,baseTravelM:a&&b?Math.hypot(...a.map((v,i)=>b[i]!-v)):null},
   verdict};
 });
 return {schemaVersion:1,documentType:'fault-report',runId:input.runId,scheduleDigest:hashJson(schedule),oracleDigest:oracle.digest,entries,invariants:invariants(input),evidence:[...input.evidence??[]],accepted:false};
}

function invariants(input:FaultReportInput):Invariant[]{
 const {facts,drives,oracle}=input,policy=oracle.invariantPolicy,axes=[...new Set(drives.flatMap(r=>r.drives.map(d=>d.axisId)))];
 const series=(axisId:string)=>drives.map(r=>({tick:r.tick,s:r.drives.find(d=>d.axisId===axisId)})).filter((x):x is {tick:number;s:DriveAxisSnapshot}=>!!x.s);
 const done=(id:Invariant['id'],result:Invariant['result'],tick:number|null,evidence:string):Invariant=>({id,result,tick,evidence});
 const first=(find:()=>{tick:number;note:string}|null,id:Invariant['id'],pass:string):Invariant=>{const v=find();return v?done(id,'violated',v.tick,v.note):done(id,'pass',null,pass);};
 const flag=(ok:boolean,id:Invariant['id'],note:string):Invariant=>ok?done(id,'pass',null,note):done(id,'violated',null,note);
 const motion=first(()=>{
  for(const r of drives)for(const d of r.drives){
   // a csv axis idles at 0, a csp axis holds where it is: any other applied target went to an axis that was not enabled
   if(!['enabled','quick_stop'].includes(d.state)&&Math.abs(d.targetApplied)>1e-12&&Math.abs(d.targetApplied-d.actualPositionRad)>policy.holdToleranceRad)return {tick:r.tick,note:`${d.axisId} is ${d.state} at tick ${r.tick} with applied target ${d.targetApplied}`};
  }
  return null;
 },'NO_MOTION_BEFORE_ENABLED','every applied target of a not-enabled axis idles or holds (drives)');
 const resets=input.receipts.filter(r=>r.faultId==='drive-reset'&&r.phase==='start');
 const latch=first(()=>{
  for(const a of axes){const s=series(a);for(let i=1;i<s.length;i++){const p=s[i-1]!.s,c=s[i]!.s;
   if(p.fault!==null&&c.fault===null&&!resets.some(r=>r.targetId===a&&r.appliedTick===c.tick))return {tick:c.tick,note:`${a} cleared ${p.fault} at tick ${c.tick} without an injected reset (the controllers never send one)`};}}
  return null;
 },'LATCH_HELD','no latched fault cleared without an injected reset (drives)');
 let timeouts=false;
 const torque=first(()=>{
  for(const a of axes){const s=series(a),f=s.find(x=>x.s.fault==='COMMAND_TIMEOUT');if(!f)continue;timeouts=true;
   for(const x of s)if(x.tick>=f.tick+policy.timeoutSettleTicks&&x.s.fault!==null&&Math.abs(x.s.torqueNm??0)>policy.torqueEpsNm)return {tick:x.tick,note:`${a} still carries ${x.s.torqueNm} N m at tick ${x.tick}, ${x.tick-f.tick} ticks after COMMAND_TIMEOUT`};}
  return null;
 },'TORQUE_ZERO_AFTER_TIMEOUT','torque is zero from timeoutSettleTicks after COMMAND_TIMEOUT (drives)');
 return [
  flag(facts.reportedServed===facts.confirmedServed,'NO_FALSE_SERVE',`reported ${facts.reportedServed} served, journal confirms ${facts.confirmedServed}`),
  flag(facts.resendsAfterUnknown===0,'NO_RESEND_AFTER_UNKNOWN',`${facts.resendsAfterUnknown} mutations resent after an unknown ACK`),
  motion,
  facts.custodyChanged===null?done('CUSTODY_UNCHANGED','not_applicable',null,'the run has no custody'):flag(!facts.custodyChanged,'CUSTODY_UNCHANGED',facts.custodyChanged?'custody changed during a fault run':'custody unchanged'),
  latch,
  timeouts?torque:done('TORQUE_ZERO_AFTER_TIMEOUT','not_applicable',null,'no axis latched COMMAND_TIMEOUT'),
 ];
}

/** The recorded intents against the schedule's own timeline and the receipts. Intents of a tick past the last verified one cannot be reconciled and are left out. */
function reconcile(input:FaultReportInput,ticks:readonly number[]){
 const seen=new Set(ticks),byTick=new Map<number,readonly FaultInjection[]>();
 for(const i of input.intents!){if(byTick.has(i.tick))invalid(`INTENT_DUPLICATE:${i.tick}`);byTick.set(i.tick,i.injections);}
 for(const t of ticks)if(hashJson(faultEventsAt(input.schedule,t))!==hashJson(byTick.get(t)??[]))invalid(`INTENT_MISMATCH:${t}`);
 for(const t of byTick.keys())if(!seen.has(t)&&t<=(ticks.at(-1)??-1))invalid(`INTENT_TICK:${t}`);
 const key=(x:{entryId:string;phase:string;appliedTick:number})=>`${x.appliedTick}/${x.entryId}/${x.phase}`;
 const got=new Set(input.receipts.map(key)),want=new Set(ticks.flatMap(t=>(byTick.get(t)??[]).map(i=>key({...i,appliedTick:t}))));
 for(const k of want)if(!got.has(k))invalid(`RECEIPT_MISSING:${k}`);
 for(const k of got)if(!want.has(k))invalid(`RECEIPT_UNINTENDED:${k}`);
 const perTick=new Map<number,FaultReceipt>();
 for(const r of input.receipts){const first=perTick.get(r.appliedTick);if(first&&(first.bootId!==r.bootId||first.requestDigest!==r.requestDigest||first.sceneDigest!==r.sceneDigest))invalid(`RECEIPT_TICK_IDENTITY:${r.appliedTick}`);perTick.set(r.appliedTick,first??r);}
}

/** The served count the run reports against the one its own drive records can support: a serve confirmed while some axis is latched in a fault that stays latched to the end of the run is not a serve a plant
 * that could not move delivered. `serveTicks` are the ticks of the journal's served increments. */
export function servedFacts(drives:FaultReportInput['drives'],serveTicks:readonly number[]):{reportedServed:number;confirmedServed:number}{
 let latchedFrom=Number.POSITIVE_INFINITY;
 const axes=[...new Set(drives.flatMap(r=>r.drives.map(d=>d.axisId)))];
 for(const a of axes){
  const s=drives.map(r=>({tick:r.tick,f:r.drives.find(d=>d.axisId===a)?.fault??null}));
  let from:number|null=null;for(const x of s){if(x.f!==null){from??=x.tick;}else from=null;}
  if(from!==null)latchedFrom=Math.min(latchedFrom,from);
 }
 return {reportedServed:serveTicks.length,confirmedServed:serveTicks.filter(t=>t<latchedFrom).length};
}

/** The ticks at which the journal's fulfillment lines gained a served unit; the journal's clock is the run's (tick = (at - epoch) / 20 ms). */
export function serveTicksOf(events:readonly {kind:string;id:string;at:string;state:unknown}[],epochMs:number):number[]{
 const last=new Map<string,bigint>(),ticks:number[]=[];
 for(const e of events){
  if(e.kind!=='fulfillment')continue;
  const n=BigInt(String((e.state as {served?:unknown}|null)?.served??'0')),before=last.get(e.id)??0n;last.set(e.id,n);
  for(let i=before;i<n;i++)ticks.push(Math.round((Date.parse(e.at)-epochMs)/20));
 }
 return ticks;
}
