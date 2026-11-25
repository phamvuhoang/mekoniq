import type {DesignContext} from './design';
import type {CheckResult,IoAllocationV1,NetlistV1,SafetyRequirementsV1,WiringPolicyV1} from './contracts';
import type {SourceRef} from '../contracts';
import {pinCurrent,pinVoltage,protectionRating,resolvePin} from './netlist';
import {profileSources} from './profiles';

const chk=(ruleId:string,level:CheckResult['level'],path:string,detail:string,sources:SourceRef[]=[]):CheckResult=>({ruleId,level,path,detail,sources});
const fmt=(n:number)=>String(Math.round(n*10)/10);
const LEVEL={blocking:0,warning:1,unverified:2} as const;
export const sourceKey=(s:SourceRef)=>`${s.documentId}|${s.revision}|${s.locator}|${s.contentSha256}`;

/** Rules that need the whole picture: design, allocation, netlist, policy and register. Allocation and netlist report their own structural problems. */
export function checkElectrical(context:DesignContext,allocation:IoAllocationV1,netlist:NetlistV1,policy:WiringPolicyV1,safety:SafetyRequirementsV1|null,descriptions:Readonly<Record<string,unknown>>={}):CheckResult[]{
 const {design,profiles}=context,out:CheckResult[]=[],ampacity=(csa:number)=>policy.ampacity.find(r=>r.csaMm2===csa)?.maxCurrentA.value??0;
 const reqs=new Map((safety?.requirements??[]).map(r=>[r.id,r]));

 // axes: the drive must be able to take the base's velocity command (csv, or pv with its own ramp) and have the channel
 for(const [i,a] of design.axes.entries()){
  const d=profiles.get(a.driveDeviceId)?.drive;
  if(!d){out.push(chk('ELD_MODE_UNSUPPORTED','blocking',`/axes/${i}`,`${a.driveDeviceId} has no drive capability`));continue;}
  if(!d.modes.includes('csv')&&!d.modes.includes('pv'))out.push(chk('ELD_MODE_UNSUPPORTED','blocking',`/axes/${i}`,`${a.driveDeviceId} supports ${d.modes.join(', ')}; a velocity-controlled wheel needs csv, or pv with a profile acceleration`,[d.watchdog.source]));
  if(a.channel>=d.axes)out.push(chk('ELD_AXIS_UNMAPPED','blocking',`/axes/${i}/channel`,`${a.driveDeviceId} has ${d.axes} axis channel(s), not ${a.channel+1}`));
 }

 // power: voltage per pin, current per source and per protection device, protection per branch, drop per branch
 const behind=new Map<string,number>();
 for(const [ri,rail] of design.power.entries()){
  const srcPin=resolvePin(profiles.get(rail.source.deviceId)!,rail.source.pin),srcV=srcPin&&pinVoltage(context,rail.source.deviceId,srcPin);
  if(srcV&&(rail.nominalV<srcV[0]||rail.nominalV>srcV[1]))out.push(chk('ELD_VOLTAGE_MISMATCH','blocking',`/power/${ri}/source`,`rail ${rail.railId} is ${rail.nominalV} V; ${rail.source.deviceId} outputs ${srcV[0]} to ${srcV[1]} V`));
  let total=0;
  for(const [fi,f] of rail.feeds.entries()){
   const path=`/power/${ri}/feeds/${fi}`,toPin=resolvePin(profiles.get(f.to.deviceId)!,f.to.pin),v=toPin&&pinVoltage(context,f.to.deviceId,toPin),cur=toPin?pinCurrent(context,f.to.deviceId,toPin):null;
   if(v&&(rail.nominalV<v[0]||rail.nominalV>v[1]))out.push(chk('ELD_VOLTAGE_MISMATCH','blocking',path,`rail ${rail.railId} is ${rail.nominalV} V; ${f.to.deviceId} accepts ${v[0]} to ${v[1]} V`,cur?[cur.source]:[]));
   if(cur){total+=cur.value;if(f.protectionDeviceId)behind.set(f.protectionDeviceId,(behind.get(f.protectionDeviceId)??0)+cur.value);}
   else out.push(chk('UNVERIFIED_CURRENT','unverified',path,`${f.to.deviceId} does not state a continuous current for this supply pin`));
   if(!f.protectionDeviceId){out.push(chk('ELD_PROTECTION_MISSING','blocking',path,`${f.id} has no protection device`));}
   else{
    const rating=protectionRating(profiles.get(f.protectionDeviceId)!);
    if(rating!==null){
     const top=policy.ampacity[policy.ampacity.length-1]!.maxCurrentA.value,wire=netlist.wires.find(w=>w.netId===`pwr/${rail.railId}`&&w.to.deviceId===f.to.deviceId&&w.to.pin===toPin);
     if(wire&&rating>ampacity(wire.csaMm2))out.push(chk('ELD_PROTECTION_OVERSIZED','blocking',path,`${f.protectionDeviceId} is rated ${rating} A; the wire to ${f.to.deviceId} (${wire.csaMm2} mm2) carries ${ampacity(wire.csaMm2)} A`,[policy.sources.ampacity]));
     else if(!wire&&rating>top)out.push(chk('ELD_PROTECTION_OVERSIZED','blocking',path,`${f.protectionDeviceId} is rated ${rating} A; no wire in the policy carries more than ${top} A`));
    }
   }
   if(f.lengthM===null)out.push(chk('UNVERIFIED_LENGTH','unverified',path,`length of ${f.id} is not measured`));
   else if(cur&&toPin){
    const wire=netlist.wires.find(w=>w.netId===`ret/${rail.railId}`&&w.to.deviceId!==undefined&&(w.from.deviceId===f.to.deviceId||w.to.deviceId===f.to.deviceId));
    if(wire){
     const drop=2*f.lengthM.value*cur.value*policy.copperResistivityOhmMm2PerM/wire.csaMm2,frac=drop/rail.nominalV,limit=policy.maxVoltageDropFraction.value;
     if(frac>limit)out.push(chk('ELD_VOLTAGE_DROP_EXCEEDED','blocking',path,`${f.id}: ${fmt(drop)} V of ${rail.nominalV} V = ${fmt(frac*100)} % over ${fmt(f.lengthM.value)} m of ${wire.csaMm2} mm2 exceeds ${fmt(limit*100)} %`,[policy.maxVoltageDropFraction.source]));
    }
   }
  }
  const sc=srcPin?pinCurrent(context,rail.source.deviceId,srcPin):null;
  if(sc&&total>sc.value)out.push(chk('ELD_POWER_BUDGET_EXCEEDED','blocking',`/power/${ri}`,`rail ${rail.railId} loads add up to ${fmt(total)} A; ${rail.source.deviceId} supplies ${sc.value} A`,[sc.source]));
 }
 for(const [id,amps] of [...behind].sort((a,b)=>a[0]<b[0]?-1:1)){const r=protectionRating(profiles.get(id)!);if(r!==null&&amps>r)out.push(chk('ELD_POWER_BUDGET_EXCEEDED','blocking',`/devices/${id}`,`loads behind ${id} add up to ${fmt(amps)} A; it is rated ${r} A`));}
 for(const w of netlist.wires)if(w.currentA&&w.currentA.value>ampacity(w.csaMm2))out.push(chk('ELD_WIRE_UNDERSIZED','blocking',`/netlist/${w.id}`,`${fmt(w.currentA.value)} A in ${w.csaMm2} mm2 (${ampacity(w.csaMm2)} A allowed)`,[w.csaSource]));

 // safety: the register is the author's; here only references are checked
 for(const s of design.signals)if(s.consumer==='safety_chain'&&!(safety?.requirements??[]).some(r=>r.signalIds.includes(s.id)))out.push(chk('SAF_REQUIREMENT_UNREFERENCED','blocking',`/signals/${s.id}`,`no safety requirement names ${s.id}`));
 for(const [i,f] of design.stopFunctions.entries()){
  if(f.requirementId&&!reqs.has(f.requirementId))out.push(chk('SAF_REQUIREMENT_UNKNOWN','blocking',`/stopFunctions/${i}/requirementId`,f.requirementId));
  if(f.finalState.startsWith('torque_off'))for(const ax of f.axes){
   const drive=profiles.get(design.axes.find(a=>a.axisId===ax)?.driveDeviceId??'')?.drive;
   if(drive&&!drive.stop.torqueOff&&!f.requirementId)out.push(chk('ELD_STOP_UNSUPPORTED','blocking',`/stopFunctions/${i}`,`${f.id} ends in ${f.finalState} on ${ax}, but its drive has no torque-off input and no external safety requirement is named`));
  }
 }

 // unverified: everything the result stands on that no pinned document supports
 const assumed=new Map<string,SourceRef>();
 const add=(s:SourceRef)=>{if(s.kind==='assumed')assumed.set(sourceKey(s),s);};
 for(const d of design.devices){const p=profiles.get(d.id)!;profileSources(p).forEach(add);for(const q of context.components?.[p.component.digest]?.ports??[])if(q.continuousCurrentA)add(q.continuousCurrentA.source);}
 policy.ampacity.forEach(r=>add(r.maxCurrentA.source));add(policy.maxVoltageDropFraction.source);add(policy.sources.ampacity);add(policy.sources.drop);
 design.signals.forEach(s=>add(s.electrical.currentA.source));design.power.forEach(r=>r.feeds.forEach(f=>f.lengthM&&add(f.lengthM.source)));
 for(const s of [...assumed.values()].sort((a,b)=>sourceKey(a)<sourceKey(b)?-1:1))out.push(chk('UNVERIFIED_ASSUMED_SOURCE','unverified','/sources',`assumed: ${s.documentId} / ${s.locator}`,[s]));
 for(const d of [...design.devices].sort((a,b)=>a.id<b.id?-1:1)){
  const p=profiles.get(d.id)!;
  if(p.variant.firmware===null&&['servo_drive','io_module','compute'].includes(p.kind))out.push(chk('UNVERIFIED_FIRMWARE','unverified',`/devices/${d.id}`,`${d.id} (${p.id}) has no pinned firmware; I/O mapping and PDO layout depend on it`));
 }
 for(const a of allocation.assigned){
  const p=profiles.get(a.deviceId)!,pt=p.ioPoints.find(x=>x.pointId===a.pointId)!;
  if(pt.busExposure.kind!=='none'&&!p.documents.some(d=>d.kind==='description_file'&&d.digest in descriptions))out.push(chk('UNVERIFIED_BUS_EXPOSURE','unverified',`/allocation/${a.signalId}`,`${a.deviceId}/${a.pointId} is exposed as ${pt.busExposure.kind}${pt.busExposure.object?` on ${pt.busExposure.object}`:''} but no pinned description file confirms it`,[pt.source]));
 }
 return out;
}
export const sortChecks=(checks:CheckResult[])=>[...checks].sort((a,b)=>LEVEL[a.level]-LEVEL[b.level]||(a.ruleId<b.ruleId?-1:a.ruleId>b.ruleId?1:0)||(a.path<b.path?-1:a.path>b.path?1:0)||(a.detail<b.detail?-1:a.detail>b.detail?1:0));
