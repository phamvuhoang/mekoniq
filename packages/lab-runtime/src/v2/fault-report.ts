// FaultReportV1 (R4-A §7.2, plan V08), built from evidence that was read back: the schedule is intent, only a matching receipt proves a fault was applied, and nothing in the report comes from
// the runner's hot state. Pure: callers hand over the verified streams. A receipt that disagrees with its intent, or drive records with a hole, make the whole report FAULT_EVIDENCE_INVALID.
import {hashJson} from './hash';
import type {ControllerEvent} from './control/controller';
import type {DriveAxisSnapshot,FaultOracleV1,FaultReportV1} from './control/drive-io';
import type {FaultReceipt} from './control/drive-faults';
import type {FaultScheduleEntry} from './fault-schedule';

const TICK_MS=20;
const REST_RADS=0.01;   // an axis counts as at rest below this true speed: a report policy, not a safety value
export const faultStartTick=(triggerMs:number):number=>Math.ceil(triggerMs/TICK_MS)+1;
export const faultEndTick=(startTick:number,durationMs:number):number=>startTick+Math.ceil(durationMs/TICK_MS);
const invalid=(why:string):never=>{throw new Error(`FAULT_EVIDENCE_INVALID:${why}`);};
const same=(a:Record<string,number>,b:Record<string,number>)=>hashJson(Object.fromEntries(Object.entries(a).sort(([x],[y])=>x<y?-1:1)))===hashJson(Object.fromEntries(Object.entries(b).sort(([x],[y])=>x<y?-1:1)));

export interface FaultReportInput {
 runId:string;schedule:readonly FaultScheduleEntry[];receipts:readonly FaultReceipt[];
 drives:readonly {tick:number;drives:readonly DriveAxisSnapshot[]}[];controllerEvents:readonly ControllerEvent[];attention:readonly {tick:number;reason:string}[];
 physics:readonly {tick:number;base?:readonly {poseMap:{positionM:readonly number[]}}[]}[];oracle:FaultOracleV1;
 /** what the Source's own journal says about the run, independent of the drive records: served counts, mutation resends after an unknown ACK, whether any custody changed (null: no custody in this run) */
 facts:{reportedServed:number;confirmedServed:number;resendsAfterUnknown:number;custodyChanged:boolean|null};
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
   if(p.fault!==null&&c.fault===null&&c.commandSeq<=p.commandSeq&&!resets.some(r=>r.targetId===a&&r.appliedTick===c.tick))return {tick:c.tick,note:`${a} cleared ${p.fault} at tick ${c.tick} without a fresh command or an injected reset`};}}
  return null;
 },'LATCH_HELD','no latched fault cleared without a fresh command or an injected reset (drives)');
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
