// Telemetry ingest for simulation providers (SIM-07/08, CORE-06): canonical TwinSampleV2 only, ordered per (provider, entity) by bootId + seq.
// It feeds the lossy telemetry recorder and nothing else: a pose never becomes business state here, and an old boot can never advance anything.
import {validateTwinSampleV2,type TwinSampleV2} from '../contracts';
import type {TelemetryRecorder} from '../telemetry';
export type IngestStatus='accepted'|'duplicate'|'stale'|'gap'|'rejected';
export interface IngestResult {status:IngestStatus;reasonCodes:string[]}
export function createTelemetryIngest(recorder:TelemetryRecorder,o:{runId:string;monotonicNs:()=>bigint;sampleTick?:(sample:TwinSampleV2)=>number}){
 const last=new Map<string,{bootId:string;seq:bigint;tick:number}>(),boots=new Map<string,Set<string>>();
 return {
  accept(raw:unknown):IngestResult{
   const v=validateTwinSampleV2(raw);
   if(!v.ok)return {status:'rejected',reasonCodes:[...new Set(v.issues.map(i=>i.code))]};
   const s:TwinSampleV2=v.value;
   if(s.runId!==o.runId)return {status:'rejected',reasonCodes:['RUN_MISMATCH']};
   const key=`${s.providerId}/${s.entityId}`,prev=last.get(key),seq=BigInt(s.seq),tick=o.sampleTick?.(s)??Number(s.seq),seen=boots.get(key)??new Set<string>();
   let status:IngestStatus='accepted',reasonCodes:string[]=[];
   if(prev){
    if(prev.bootId===s.bootId){
     if(seq===prev.seq)return {status:'duplicate',reasonCodes:['SEQ_REPEATED']};
     if(seq<prev.seq)return {status:'stale',reasonCodes:['SEQ_REGRESSED']};
     if(seq>prev.seq+1n){status='gap';reasonCodes=[`SEQ_GAP:${seq-prev.seq-1n}`];recorder.gap(reasonCodes[0]!,prev.tick,tick);}
    }else if(seen.has(s.bootId))return {status:'stale',reasonCodes:['BOOT_SUPERSEDED']};
    else{status='gap';reasonCodes=['BOOT_CHANGED'];recorder.gap('BOOT_CHANGED',prev.tick,tick);}
   }
   seen.add(s.bootId);boots.set(key,seen);last.set(key,{bootId:s.bootId,seq,tick});
   // receipt time is the gateway's monotonic clock: ordering authority, never the provider's wall stamp
   recorder.record([{...s,receivedMonotonicNs:String(o.monotonicNs())}]);
   return {status,reasonCodes};
  },
 };
}
