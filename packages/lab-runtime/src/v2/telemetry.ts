// High-rate telemetry: lossy and coalesced by contract, never an audit ledger. Kept in memory per run (bounded), separate from the journal;
// a restarted runtime starts a new buffer and records the hole as an explicit gap.
import type {TwinSampleV2} from './contracts';
import {sseFrame,type SseSink} from './event-stream';
/** Recording period in 20 ms ticks: 10 Hz sim time (scene publish target), plus one sample per entity at the end of every action. */
export const TELEMETRY_RATE_TICKS=5;
export interface TelemetryGap {reason:string;fromTick:number|null;toTick:number}
export interface TelemetryReport {lossy:true;coalesced:true;rateHz:number;source:string;samples:TwinSampleV2[];sampleCounts:Record<string,number>;dropped:number;gaps:TelemetryGap[]}
const same=(a:{bootId:string;seq:string}|undefined,b:{bootId:string;seq:string})=>!!a&&a.bootId===b.bootId&&a.seq===b.seq;
export class TelemetryRecorder {
 private ring:TwinSampleV2[]=[];private last=new Map<string,TwinSampleV2>();dropped=0;readonly gaps:TelemetryGap[]=[];
 // ponytail: ~20k samples (~10 MB) per run in memory; the spec's 100 MiB/run quota needs an on-disk segment store when runs get long
 constructor(private cap=20000,private source='mock plant/device state (modeled)'){}
 /** Keeps only samples that changed (new boot or seq) per entity; the oldest are evicted and counted once the buffer is full. */
 record(samples:readonly TwinSampleV2[]){
  for(const s of samples){if(same(this.last.get(s.entityId),s))continue;this.last.set(s.entityId,s);this.ring.push(s);if(this.ring.length>this.cap){this.ring.shift();this.dropped++;}}
 }
 gap(reason:string,fromTick:number|null,toTick:number){this.gaps.push({reason,fromTick,toTick});}
 latest(){return [...this.last.values()];}
 cursor(){return this.ring.at(-1)?.seq??null;}
 countBetween(fromSeq:string,toSeq:string){const from=BigInt(fromSeq),to=BigInt(toSeq);return this.ring.filter(s=>BigInt(s.seq)>from&&BigInt(s.seq)<=to).length;}
 report():TelemetryReport{
  const sampleCounts:Record<string,number>={};for(const s of this.ring)sampleCounts[s.entityId]=(sampleCounts[s.entityId]??0)+1;
  return {lossy:true,coalesced:true,rateHz:1000/(20*TELEMETRY_RATE_TICKS),source:this.source,samples:structuredClone(this.ring),sampleCounts,dropped:this.dropped,gaps:structuredClone(this.gaps)};
 }
}
/**
 * Per-connection coalescing publisher. While the socket signals backpressure only the newest sample per entity is kept; superseded ones
 * are counted and announced as an explicit `gap` record before the next delivery. Memory per connection is one sample per entity.
 */
export class TelemetryPublisher {
 private sent=new Map<string,{bootId:string;seq:string}>();private pending=new Map<string,TwinSampleV2>();private blocked=false;private dropped=0;
 constructor(private sink:SseSink){}
 drained(){this.blocked=false;}
 offer(samples:readonly TwinSampleV2[]){
  for(const s of samples){
   if(same(this.sent.get(s.entityId),s))continue;
   const p=this.pending.get(s.entityId);if(p&&!same(p,s))this.dropped++;
   this.pending.set(s.entityId,s);
  }
  if(this.blocked||!this.pending.size)return;
  if(this.dropped){this.write(sseFrame('gap',{reason:'BACKPRESSURE',dropped:this.dropped}));this.dropped=0;}
  for(const s of [...this.pending.values()]){
   if(this.blocked)break;
   this.pending.delete(s.entityId);this.sent.set(s.entityId,{bootId:s.bootId,seq:s.seq});this.write(sseFrame('sample',s,s.seq));
  }
 }
 private write(frame:string){if(!this.sink.write(frame))this.blocked=true;}
}
