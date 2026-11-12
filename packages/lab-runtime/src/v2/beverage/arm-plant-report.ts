// The `arm` block of a run report whose arm is a plant (R1.1 SX-26): the actual/commanded joint trace as a file with its hash, the tracking error of every joint, what the plant is (D24)
// and the ARM03 record. ARM03 here is the swept capsule check the arm ran on its ACTUAL joints every tick (D28); the record is assembled from those per-tick results, not re-derived.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {ArmPlantState} from '../../../../cell-adapters/src/mock-arm';
import type {JsonObject} from '../../../../contracts/src/index';
import {hashJson} from '../hash';
import {PUMA560_SI} from '../models/arm-kinematics';
import {METHOD,type AllowedContact,type ArmCollisionEvidenceRecord} from '../arm/session';
import type {ArmPlantReport} from './coffee-ports';

export const ARM_TRACE_FILE='arm-trace.json';
export interface ArmTraceFile {schemaVersion:1;note:string;samples:{tick:number;actualRad:number[];commandedRad:number[]}[]}
export interface ArmReportBlock {trace:{path:string;sha256:string;samples:number};tracking:ArmPlantReport['tracking'];armPlant:ArmPlantReport;collision:ArmCollisionEvidenceRecord}
type WorldRevision=ArmCollisionEvidenceRecord['worldRevision'];

/** ARM03 from the plant's own evidence: pass only when every checked interval was clear, none was dropped, and the arm was not stopped for a collision (its own check or the engine's).
 * The record names what was swept: the model revision of the sweeps, and the allowed pairs they skipped (static for the whole trace; a pair with a support named `tray` is the release's,
 * any other the grasp's) with `allowedContactsApplied` = the intervals x pairs that were actually in contact. A plant without allowed pairs (Webots) records none, as before. */
export function armCollisionRecord(arm:ArmPlantState,worldRevision:WorldRevision,assetRef:JsonObject):ArmCollisionEvidenceRecord{
 const base:ArmCollisionEvidenceRecord={id:'ARM03',result:'not_run',reasonCodes:[],engine:null,modelRevision:PUMA560_SI.revision,geometryRevision:null,worldRevision,assetRef,trace:null,attachments:[],allowedContacts:[],method:null,coverage:null,colliding:[],provenance:'geometric_checker',fidelity:'modeled'};
 const ev=arm.collision?.evidence,trace=arm.tracking?.trace??[];
 if(!ev||!ev.intervals.length||!trace.length)return {...base,reasonCodes:['TRACE_EMPTY']};
 if(ev.droppedIntervals>0)return {...base,reasonCodes:[`EVIDENCE_TRUNCATED:${ev.droppedIntervals}`]};
 const colliding=ev.intervals.filter(i=>!i.result.ok).map(i=>({pair:i.result.pair!,reason:i.result.reason!,fraction:i.result.fraction??null,clearanceM:i.result.clearanceM??null,interval:{fromTick:i.firstTick,toTick:i.lastTick}}));
 const plantStop=arm.stop?.reason==='ARM_COLLISION'&&!colliding.length;
 const revisions=[...new Set(ev.intervals.map(i=>i.result.geometryRevision))],attachments:{cupId:string;fromTick:number;toTick:number}[]=[];
 for(const i of ev.intervals){
  const last=attachments.at(-1);
  if(i.heldCupId&&last?.cupId===i.heldCupId&&last.toTick>=i.firstTick-1)last.toTick=i.lastTick;else if(i.heldCupId)attachments.push({cupId:i.heldCupId,fromTick:i.firstTick,toTick:i.lastTick});
 }
 return {...base,result:colliding.length||plantStop?'fail':'pass',reasonCodes:[...new Set([...colliding.map(c=>c.reason),...plantStop?['ARM_COLLISION']:[]])],engine:ev.intervals[0]!.result.engine,
  geometryRevision:revisions.length===1?revisions[0]!:hashJson({revisions} as unknown as JsonObject),trace:{samples:trace.length,fromTick:trace[0]!.tick,toTick:trace.at(-1)!.tick},attachments,
  method:{...METHOD,toleranceM:ev.intervals[0]!.result.toleranceM},
  coverage:{intervals:ev.intervals.length,evaluations:ev.intervals.reduce((n,i)=>n+i.result.evaluations,0),uncertain:ev.intervals.filter(i=>i.result.reason==='SWEEP_UNCERTAIN').length,
   allowedContactsApplied:ev.intervals.reduce((n,i)=>n+(i.result.allowed?.inContact.length??0),0)},colliding,
  modelRevision:ev.intervals[0]!.result.modelRevision,allowedContacts:allowedOf(ev.intervals.map(i=>i.result),trace[0]!.tick,trace.at(-1)!.tick)};
}
const allowedOf=(results:readonly {allowed?:{pairs:[string,string][]}}[],fromTick:number,toTick:number):AllowedContact[]=>{
 const seen=new Map<string,[string,string]>();for(const r of results)for(const p of r.allowed?.pairs??[])if(!seen.has(p.join('\u0000')))seen.set(p.join('\u0000'),[p[0],p[1]]);
 return [...seen.values()].map(pair=>({pair,phase:pair.includes('tray')?'release' as const:'grasp' as const,fromTick,toTick,revision:1}));
};
/** Writes the trace beside the run's other files and returns the block. The file is the evidence: its sha256 is in the report, `readArmTrace` re-checks it. */
export async function buildArmReport(arm:ArmPlantState,plant:ArmPlantReport,directory:string,worldRevision:WorldRevision,assetRef:JsonObject):Promise<ArmReportBlock>{
 const file:ArmTraceFile={schemaVersion:1,note:'Per tick of a running arm program: the joints the Webots plant reported (actual) and the joints the program commanded. Radians.',samples:arm.tracking?.trace??[]};
 const bytes=Buffer.from(JSON.stringify(file));
 await writeFile(join(directory,ARM_TRACE_FILE),bytes,{mode:0o600});
 return {trace:{path:ARM_TRACE_FILE,sha256:createHash('sha256').update(bytes).digest('hex'),samples:file.samples.length},tracking:plant.tracking,armPlant:plant,collision:armCollisionRecord(arm,worldRevision,assetRef)};
}
export async function readArmTrace(directory:string,block:ArmReportBlock):Promise<ArmTraceFile>{
 const bytes=await readFile(join(directory,block.trace.path));
 if(createHash('sha256').update(bytes).digest('hex')!==block.trace.sha256)throw new Error('ARM_TRACE_CORRUPT');
 return JSON.parse(bytes.toString('utf8')) as ArmTraceFile;
}
