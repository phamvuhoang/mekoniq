// Identity cases (KID, contracts §6.2; spec B1 §7.2), read-only (K07a): KID02–KID05 judge what `scan` read before any write (trace.scan) against the kit and the
// description summary of each axis (trace.descriptions, the DescriptionSummary of scripts/describe-device.py). A script of zero ticks: nothing is sent, no torque.
// KID01 (host), KID06 (inputs) and KID07 (sensor ports, RS232 level) are not here. evaluate() is a pure function of (trace, kit): readback re-runs it.
import {readFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative} from 'node:path';
import type {DescriptionSummary} from '../../../lab-runtime/src/engineering/catalog';
import type {BenchKitV1} from '../contracts';
import type {BenchCase,CaseTrace,CaseVerdict,ScanSlave} from './types';

type Axis=BenchKitV1['axes'][number];
/** Visible strings `scan` reads for KID02: software (firmware), hardware version, device name. */
export const IDENTITY_STRINGS=['100A:00','1009:00','1008:00'];
/** Relied on by every kit beyond its own PDO entries and SDO writes: supported modes, quick-stop option, statusword, position. */
const ALWAYS=['6502:00','605A:00','6041:00','6064:00'];
const up=(o:string)=>o.toUpperCase();
export const reliedObjects=(a:Axis)=>[...new Set([...a.pdo.rx,...a.pdo.tx,...a.sdoWrites.map(w=>w.object),...ALWAYS].map(up))];
/** What `scan` must read for the identity cases on this kit (startBenchSession(w, objects, {strings, scanOnly: true})). */
export const identityScan=(kit:BenchKitV1)=>({objects:[...new Set(kit.axes.flatMap(reliedObjects))].sort(),strings:IDENTITY_STRINGS});
/** 6502h bits, the table of scripts/describe-device.py. */
const MODE_BIT:Record<string,number>={pp:0,pv:2,pt:3,hm:5,csp:7,csv:8,cst:9};
const num=(x:string|number)=>typeof x==='number'?x:x.trim()?Number(x):NaN;   // '0x53494D00', '1' or 1; anything else is NaN and never equal
const hex=(v:number)=>`0x${v.toString(16).toUpperCase().padStart(8,'0')}`;

/** The simulated kit's summary (simSlave.descriptionSummary, relative to the kit file) for every axis; {} when the kit names none. Real kits take theirs from the catalog. */
export function simDescriptions(kit:BenchKitV1,kitPath:string):Record<string,DescriptionSummary>{
 const rel=kit.simSlave?.descriptionSummary;
 if(rel===undefined)return {};
 const base=dirname(kitPath),full=typeof rel==='string'&&rel&&!isAbsolute(rel)?join(base,rel):'',back=full&&relative(base,full);
 if(!back||back.startsWith('..')||isAbsolute(back))throw Object.assign(new Error(`DESCRIPTION_SUMMARY_PATH ${String(rel)}`),{code:'DESCRIPTION_SUMMARY_PATH'});
 const d=JSON.parse(readFileSync(full,'utf8')) as DescriptionSummary;
 return Object.fromEntries(kit.axes.map(a=>[a.axisId,d]));
}

const verdict=(failed:string[],missing:string[],observed?:Record<string,string>):CaseVerdict=>failed.length?{status:'failed',reason:failed[0]!,measurements:[]}
 :missing.length?{status:'not_run',reason:missing[0]!,measurements:[]}:{status:'tested',reason:null,measurements:[],...observed?{observed}:{}};
/** A read-only case: every kit axis with the slave found at its position and its summary; problems are collected, a contradiction wins over a missing read. */
function idCase(id:string,needsDescription:boolean,judge:(a:Axis,s:ScanSlave,d:DescriptionSummary|undefined,out:{failed:string[];missing:string[];observed:Record<string,string>},t:CaseTrace,kit:BenchKitV1)=>void):BenchCase{
 return {id,needsTorque:false,requires:[],script:()=>({ticks:0,commandsAt:()=>[]}),evaluate(t,kit){
  if(!t.scan)return verdict([],['SCAN_NOT_RECORDED']);
  const out={failed:[] as string[],missing:[] as string[],observed:{} as Record<string,string>};
  for(const a of kit.axes){
   const s=t.scan.slaves.find(x=>x.position===a.slavePosition),d=t.descriptions?.[a.axisId];
   if(!s){out.failed.push(`SLAVE_MISSING ${a.axisId} at position ${a.slavePosition}`);continue;}
   if(needsDescription&&!d){out.missing.push(`DESCRIPTION_SUMMARY_MISSING ${a.axisId}`);continue;}
   judge(a,s,d,out,t,kit);
  }
  return verdict(out.failed,out.missing,out.observed);
 }};
}

/** Slave count and order; vendor, product and revision against the kit's `expect` and the summary; a serial on every slave, none twice; the firmware string (observed). */
const KID02=idCase('KID02',true,(a,s,d,out,t,kit)=>{
 const f=out.failed;
 if(a===kit.axes[0]){
  if(t.scan!.slaves.length!==kit.axes.length)f.push(`SLAVE_COUNT ${t.scan!.slaves.length} on the bus, ${kit.axes.length} in the kit`);
  if(new Set(t.scan!.slaves.map(x=>x.serial)).size!==t.scan!.slaves.length)f.push('SERIAL_DUPLICATE');
 }
 if(s.axisId!==a.axisId)f.push(`SLAVE_ORDER ${a.axisId} at position ${a.slavePosition}`);
 for(const k of ['vendorId','productCode','revision'] as const)if(a.expect[k]!==null&&num(s[k])!==num(a.expect[k]))f.push(`IDENTITY_MISMATCH ${a.axisId} ${k}`);
 for(const k of ['vendorId','productCode','revision'] as const)if(num(s[k])!==num(d![k]))f.push(`DESCRIPTION_MISMATCH ${a.axisId} ${k}`);
 if(!s.serial)f.push(`SERIAL_MISSING ${a.axisId}`);
 const fw=s.strings?.['100A:00'];
 if(fw)out.observed[`/devices/${a.axisId}`]=fw;else out.missing.push(`FIRMWARE_NOT_READ ${a.axisId}`);
});

/** Every object the kit relies on was read on the bus and is in the summary with the access and PDO mapping the kit uses it for. */
const KID03=idCase('KID03',true,(a,s,d,out)=>{
 const desc=new Map(d!.objects.map(o=>[`${up(o.index)}:${o.subindex.toString(16).toUpperCase().padStart(2,'0')}`,o]));
 const rx=new Set(a.pdo.rx.map(up)),tx=new Set(a.pdo.tx.map(up)),sdo=new Set(a.sdoWrites.map(w=>up(w.object)));
 for(const o of reliedObjects(a)){
  const e=desc.get(o);
  if(!Object.hasOwn(s.objects,o))out.missing.push(`OBJECT_NOT_READ ${a.axisId} ${o}`);
  if(!e){out.failed.push(`OBJECT_NOT_IN_DESCRIPTION ${a.axisId} ${o}`);continue;}
  if(rx.has(o)&&(!e.pdoMappable||e.access==='ro'))out.failed.push(`RX_NOT_MAPPABLE ${a.axisId} ${o}`);
  if(tx.has(o)&&!e.pdoMappable)out.failed.push(`TX_NOT_MAPPABLE ${a.axisId} ${o}`);
  if(sdo.has(o)&&e.access==='ro')out.failed.push(`SDO_NOT_WRITABLE ${a.axisId} ${o}`);
 }
});

/** The PDO maps the slave booted with (read by scan before any write), and whether configure must remap them to the kit's: an observation, never a failure. */
const KID04=idCase('KID04',false,(a,s,_d,out)=>{
 if(!Array.isArray(s.rxPdo)||!Array.isArray(s.txPdo)){out.failed.push(`PDO_SNAPSHOT_MISSING ${a.axisId}`);return;}
 const same=(x:string[],y:string[])=>x.join()===y.map(up).join();
 out.observed[`/pdo/${a.axisId}/default`]=`rx ${s.rxPdo.join(',')}; tx ${s.txPdo.join(',')}`;
 out.observed[`/pdo/${a.axisId}/remapNeeded`]=String(!same(s.rxPdo,a.pdo.rx)||!same(s.txPdo,a.pdo.tx));
});

/** 6502h read on the bus supports the kit's bus.mode; so does the summary when there is one. */
const KID05=idCase('KID05',false,(a,s,d,out,_t,kit)=>{
 const v=s.objects['6502:00'],mode=kit.bus.mode;
 if(v===undefined){out.missing.push(`OBJECT_NOT_READ ${a.axisId} 6502:00`);return;}
 out.observed[`/modes/${a.axisId}`]=Object.keys(MODE_BIT).filter(m=>v>>MODE_BIT[m]!&1).join(',');
 if(!(v>>MODE_BIT[mode]!&1))out.failed.push(`MODE_NOT_SUPPORTED ${a.axisId} ${mode} (6502h ${hex(v)})`);
 if(d&&!d.supportedModes.includes(mode))out.failed.push(`DESCRIPTION_MODE_MISSING ${a.axisId} ${mode}`);
});

export const IDENTITY_CASES:BenchCase[]=[KID02,KID03,KID04,KID05];
