import type {DesignContext} from './design';
import type {IoAllocationV1,SignalV1,CheckResult,SourceRef} from '../../../../contracts/generated/engineering';

type IoElectrical=SignalV1['electrical']['type'];
/** Field-signal type (key) → I/O point types that can receive or drive it. Version 1 of the table; a dry contact needs a supplied return, which the point types listed here provide. */
export const IO_COMPATIBILITY:Readonly<Record<IoElectrical,readonly IoElectrical[]>>={
 pnp_source_output:['pnp_sink_input','dry_contact_input'],
 npn_sink_output:['npn_source_input','dry_contact_input'],
 relay_output:['pnp_sink_input','npn_source_input','dry_contact_input'],
 isolated_transistor_output:['pnp_sink_input','npn_source_input','dry_contact_input'],
 pnp_sink_input:['pnp_source_output','isolated_transistor_output','relay_output'],
 npn_source_input:['npn_sink_output','isolated_transistor_output','relay_output'],
 dry_contact_input:['pnp_source_output','npn_sink_output','isolated_transistor_output','relay_output'],
 analog_voltage:['analog_voltage'],analog_current:['analog_current']};
export type AllocationReason='NO_CANDIDATE_DEVICE'|'DIRECTION_MISMATCH'|'ELECTRICAL_MISMATCH'|'VOLTAGE_OUT_OF_RANGE'|'OUTPUT_OVERCURRENT'|'POINT_RESERVED'|'NOT_BUS_EXPOSED'|'LATENCY_EXCEEDED'|'SAFETY_POINT_RESERVED'|'NO_FREE_POINT';
/** Functions a drive-local signal needs the point's firmware to allow. A role that is not listed cannot be drive-local. */
const LOCAL_FUNCTION:Partial<Record<SignalV1['role'],readonly string[]>>={brake_release:['brake'],bumper:['STOP'],aux_input:['STOP']};
type Ref={deviceId:string;pointId:string};
const key=(r:Ref)=>`${r.deviceId}/${r.pointId}`;
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;

interface Eval{ref:Ref;exposure:'cyclic'|'acyclic'|'local';busId:string|null;reasons:AllocationReason[]}
/** Every point of every device, evaluated against one signal; a point with no reasons is a candidate. */
function evaluate(signal:SignalV1,context:DesignContext):Eval[]{
 const {design,profiles}=context,out:Eval[]=[],busOf=(d:string)=>design.buses.filter(b=>b.members.some(m=>m.deviceId===d)).sort((a,b)=>cmp(a.id,b.id))[0]??null;
 const local=signal.consumer==='drive_local',needs=LOCAL_FUNCTION[signal.role]??[];
 for(const dev of [...design.devices].sort((a,b)=>cmp(a.id,b.id))){
  const p=profiles.get(dev.id);if(!p)continue;
  const bus=busOf(dev.id);
  if(local?!p.drive:!bus)continue;                                                       // not a candidate device at all
  for(const pt of [...p.ioPoints].sort((a,b)=>cmp(a.pointId,b.pointId))){
   const r:AllocationReason[]=[];
   if((signal.direction==='input')!==(pt.direction==='input'))r.push('DIRECTION_MISMATCH');
   if(!IO_COMPATIBILITY[signal.electrical.type].includes(pt.electrical.type))r.push('ELECTRICAL_MISMATCH');
   if(signal.electrical.nominalV<pt.electrical.voltageRangeV[0]||signal.electrical.nominalV>pt.electrical.voltageRangeV[1])r.push('VOLTAGE_OUT_OF_RANGE');
   if(pt.direction==='output'&&signal.direction==='output'&&pt.electrical.maxCurrentA&&signal.electrical.currentA.value>pt.electrical.maxCurrentA.value)r.push('OUTPUT_OVERCURRENT');
   if(pt.safety)r.push('SAFETY_POINT_RESERVED');
   const free=local?needs.some(f=>pt.functions.includes(f)):pt.defaultFunction==='general_purpose'||(pt.reassignable&&pt.functions.includes('general_purpose'));
   if(!free&&!pt.safety)r.push('POINT_RESERVED');
   if(!local){
    if(pt.busExposure.kind==='none')r.push('NOT_BUS_EXPOSED');
    else if(signal.maxLatencyMs!==null){
     const period=pt.busExposure.kind==='cyclic'?bus!.cycleMs:pt.busExposure.updatePeriodMs;
     if(period!==null&&period>signal.maxLatencyMs)r.push('LATENCY_EXCEEDED');
    }
   }
   out.push({ref:{deviceId:dev.id,pointId:pt.pointId},exposure:local?'local':pt.busExposure.kind==='cyclic'?'cyclic':'acyclic',busId:local?null:bus!.id,reasons:r});
  }
 }
 return out;
}
export function candidatePoints(signal:SignalV1,context:DesignContext):Ref[]|{rejected:{code:AllocationReason;candidates:number}[]}{
 const all=evaluate(signal,context),ok=all.filter(e=>!e.reasons.length);
 if(ok.length)return ok.map(e=>e.ref);
 if(!all.length)return {rejected:[{code:'NO_CANDIDATE_DEVICE',candidates:0}]};
 return {rejected:tally(all)};
}
const REASON_ORDER:AllocationReason[]=['NO_CANDIDATE_DEVICE','DIRECTION_MISMATCH','ELECTRICAL_MISMATCH','VOLTAGE_OUT_OF_RANGE','OUTPUT_OVERCURRENT','POINT_RESERVED','NOT_BUS_EXPOSED','LATENCY_EXCEEDED','SAFETY_POINT_RESERVED','NO_FREE_POINT'];
const tally=(all:Eval[])=>REASON_ORDER.flatMap(code=>{const n=all.filter(e=>e.reasons.includes(code)).length;return n?[{code,candidates:n}]:[];});
const chk=(ruleId:string,level:CheckResult['level'],path:string,detail:string,sources:SourceRef[]=[]):CheckResult=>({ruleId,level,path,detail,sources});

// ponytail: Kuhn's augmenting paths, O(signals x points); fine up to the schema bounds (128 x 2048). Switch to Hopcroft-Karp only if a design ever reaches them.
export function allocateIo(context:DesignContext):{allocation:IoAllocationV1;checks:CheckResult[]}{
 const {design,profiles}=context,checks:CheckResult[]=[];
 const signals=design.signals.filter(s=>s.consumer!=='safety_chain'),evals=new Map(signals.map(s=>[s.id,evaluate(s,context)]));
 const cand=new Map(signals.map(s=>[s.id,evals.get(s.id)!.filter(e=>!e.reasons.length).sort((a,b)=>(a.exposure==='cyclic'?0:1)-(b.exposure==='cyclic'?0:1)||cmp(a.ref.deviceId,b.ref.deviceId)||cmp(a.ref.pointId,b.ref.pointId))]));
 const owner=new Map<string,string>(),pinnedBy=new Map<string,string>(),pinnedIds=new Set<string>(),assignedBy=new Map<string,Eval>();
 // 1. pinned signals first; a pin that is not a valid candidate, or collides with another pin, is reported and the signal stays unassigned
 for(const s of [...signals].sort((a,b)=>cmp(a.id,b.id))){
  if(!s.pinned)continue;
  const want:Ref={deviceId:s.pinned.deviceId,pointId:s.pinned.pointId},hit=evals.get(s.id)!.find(e=>key(e.ref)===key(want));
  const why=!hit?'the point does not exist on that device or the device is not reachable for this signal':hit.reasons.length?`the point is not usable for this signal: ${hit.reasons.join(', ')}`:pinnedBy.has(key(want))?`the point is already pinned by ${pinnedBy.get(key(want))}`:null;
  if(why){checks.push(chk('IOA_PINNED_CONFLICT','blocking',`/signals/${s.id}/pinned`,`${s.id} is pinned to ${key(want)}: ${why}`));continue;}
  pinnedBy.set(key(want),s.id);pinnedIds.add(s.id);owner.set(key(want),s.id);assignedBy.set(s.id,hit!);
 }
 // 2. the rest by augmenting paths
 const order=signals.filter(s=>!pinnedIds.has(s.id)&&!(s.pinned)).sort((a,b)=>cand.get(a.id)!.length-cand.get(b.id)!.length||cmp(a.id,b.id));
 const matchOf=new Map<string,string>();                                                  // point key → signal id
 for(const [k,s] of owner)matchOf.set(k,s);
 const tryAssign=(sid:string,seen:Set<string>):boolean=>{
  const list=cand.get(sid)!;
  // a free point first, so signals take points in id order and a signal added later cannot move the others; only then reroute the current owner of a point
  const free=list.find(e=>!pinnedBy.has(key(e.ref))&&!matchOf.has(key(e.ref)));
  if(free){matchOf.set(key(free.ref),sid);return true;}
  for(const e of list){
   const k=key(e.ref);if(seen.has(k)||pinnedBy.has(k))continue;seen.add(k);
   if(tryAssign(matchOf.get(k)!,seen)){matchOf.set(k,sid);return true;}
  }
  return false;
 };
 for(const s of order)tryAssign(s.id,new Set());
 for(const [k,sid] of matchOf){if(pinnedIds.has(sid))continue;assignedBy.set(sid,cand.get(sid)!.find(e=>key(e.ref)===k)!);}
 const assigned:IoAllocationV1['assigned']=[...assignedBy].map(([sid,e])=>({signalId:sid,deviceId:e.ref.deviceId,pointId:e.ref.pointId,busId:e.busId,exposure:e.exposure,pinned:pinnedIds.has(sid)})).sort((a,b)=>cmp(a.signalId,b.signalId));
 const unassigned:IoAllocationV1['unassigned']=signals.filter(s=>!assignedBy.has(s.id)).sort((a,b)=>cmp(a.id,b.id)).map(s=>{
  const all=evals.get(s.id)!,n=cand.get(s.id)!.length;
  const reasons=!all.length?[{code:'NO_CANDIDATE_DEVICE',candidates:0}]:n?[{code:'NO_FREE_POINT',candidates:n}]:tally(all);
  return {signalId:s.id,reasons};
 });
 for(const u of unassigned){
  const s=signals.find(x=>x.id===u.signalId)!;
  if(s.pinned&&checks.some(c=>c.ruleId==='IOA_PINNED_CONFLICT'&&c.path===`/signals/${s.id}/pinned`))continue;
  checks.push(chk('IOA_SIGNAL_UNALLOCATED',s.required?'blocking':'warning',`/signals/${s.id}`,`${s.id} has no I/O point: ${u.reasons.map(r=>`${r.code} (${r.candidates})`).join(', ')}`));
 }
 // points that nothing took: spare when a general purpose point, reserved when the firmware gives it a function
 const taken=new Set(assigned.map(a=>key(a)));
 const spare:IoAllocationV1['spare']=[],reserved:IoAllocationV1['reserved']=[];
 for(const dev of [...design.devices].sort((a,b)=>cmp(a.id,b.id))){
  const p=profiles.get(dev.id);if(!p)continue;
  for(const pt of [...p.ioPoints].sort((a,b)=>cmp(a.pointId,b.pointId))){
   const r={deviceId:dev.id,pointId:pt.pointId};if(taken.has(key(r)))continue;
   if(pt.safety||pt.defaultFunction!=='general_purpose'&&!(pt.reassignable&&pt.functions.includes('general_purpose')))reserved.push({...r,function:pt.safety?`safety:${pt.safety.function}`:pt.defaultFunction});else spare.push(r);
  }
 }
 for(const a of assigned){
  const pt=profiles.get(a.deviceId)!.ioPoints.find(p=>p.pointId===a.pointId)!;
  if(pt.assignmentPersistence==='volatile')checks.push(chk('IOA_ASSIGNMENT_VOLATILE','warning',`/allocation/${a.signalId}`,`${a.deviceId}/${a.pointId} loses its function at every power-up; the controller must configure it each start and the point carries nothing until then`,[pt.source]));
  const dir=pt.direction;
  if(!spare.some(s=>s.deviceId===a.deviceId&&profiles.get(a.deviceId)!.ioPoints.find(p=>p.pointId===s.pointId)!.direction===dir)&&!checks.some(c=>c.ruleId==='IOA_SPARE_LOW'&&c.path===`/devices/${a.deviceId}/${dir}`))checks.push(chk('IOA_SPARE_LOW','warning',`/devices/${a.deviceId}/${dir}`,`${a.deviceId} has no spare ${dir} point left`));
 }
 checks.sort((x,y)=>cmp(x.ruleId,y.ruleId)||cmp(x.path,y.path));
 return {allocation:{assigned,unassigned,spare,reserved},checks};
}
