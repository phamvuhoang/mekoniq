// Browser twin state from the telemetry stream: one provider authority per entity, ordered by (bootId, seq), a bounded history and
// read-only snapshots. A sample never becomes business truth; it only drives the scene and inspector.
// TODO(interim-copy): TwinSample mirrors source packages/contracts/generated/lab-v2.ts TwinSampleV2; replace with the pinned artifact types (F07).
type State=Record<string,unknown>;
export interface TwinSample {schemaVersion:2;runId:string;entityId:string;providerId:string;bootId:string;seq:string;simTimeNs:string|null;observedAt:string|null;receivedMonotonicNs:string;frameId:string;
 origin:'mock'|'controller_sim'|'physics_sim'|'hardware';quality:'valid'|'stale'|'unknown'|'invalid';reasonCodes:string[];commanded:State|null;observed:State|null;estimated:State|null;causationId:string|null}
/** A held sample: the wire sample plus when this browser received it (its own monotonic clock) and when its epoch last reset. */
export type Held=Readonly<TwinSample&{receivedAtMs:number;epochResetAtMs:number|null}>;
export type ApplyResult='applied'|'duplicate'|'out_of_order'|'stale_epoch'|'epoch_reset'|'foreign_provider';
export interface Gap {reason:string;dropped?:number;fromTick?:number|null;toTick?:number;fromSeq?:string;toSeq?:string;samplesNotSent?:number;atMs:number}
const freeze=<T,>(o:T):T=>{if(o&&typeof o==='object'){Object.freeze(o);for(const v of Object.values(o))freeze(v);}return o;};
export class TwinStore {
 private cur=new Map<string,Held>();private retired=new Map<string,string[]>();private hist=new Map<string,Held[]>();
 readonly stats={applied:0,duplicates:0,outOfOrder:0,staleEpoch:0,epochResets:0,foreignProvider:0,downsampled:0,dropped:0,gapDropped:0};
 readonly gaps:Gap[]=[];
 private now:()=>number;private windowMs:number;private max:number;
 /** Browser keeps 60 s of full-rate history, then 1 sample/s, at most `maxPerEntity` per entity; every removal is counted. */
 constructor(o:{now?:()=>number;windowMs?:number;maxPerEntity?:number}={}){this.now=o.now??(()=>performance.now());this.windowMs=o.windowMs??60000;this.max=o.maxPerEntity??2000;}
 apply(s:TwinSample):ApplyResult{
  const old=this.cur.get(s.entityId),at=this.now();let reset:number|null=old?.epochResetAtMs??null,result:ApplyResult='applied';
  if(old){
   if(old.providerId!==s.providerId){this.stats.foreignProvider++;return 'foreign_provider';}
   if(old.bootId===s.bootId){const a=BigInt(s.seq),b=BigInt(old.seq);if(a===b){this.stats.duplicates++;return 'duplicate';}if(a<b){this.stats.outOfOrder++;return 'out_of_order';}}
   else if(this.retired.get(s.entityId)?.includes(s.bootId)){this.stats.staleEpoch++;return 'stale_epoch';}
   else{this.retired.set(s.entityId,[...(this.retired.get(s.entityId)??[]),old.bootId].slice(-16));reset=at;result='epoch_reset';this.stats.epochResets++;}
  }
  const held=freeze({...structuredClone(s),receivedAtMs:at,epochResetAtMs:reset});
  this.cur.set(s.entityId,held);if(result==='applied')this.stats.applied++;
  const h=this.hist.get(s.entityId)??[];h.push(held);this.hist.set(s.entityId,this.trim(h,at));
  return result;
 }
 private trim(h:Held[],at:number){
  // ponytail: linear rebuild per apply; fine for a few entities at 10 Hz, use a ring + bucket index for hundreds of entities
  const cut=at-this.windowMs,out:Held[]=[];let bucket=-1;
  for(const x of h){if(x.receivedAtMs<cut){const b=Math.floor(x.receivedAtMs/1000);if(b===bucket){this.stats.downsampled++;continue;}bucket=b;}out.push(x);}
  while(out.length>this.max){out.shift();this.stats.dropped++;}
  return out;
 }
 gap(g:Omit<Gap,'atMs'>){this.gaps.push({...g,atMs:this.now()});this.stats.gapDropped+=(g.dropped??0)+(g.samplesNotSent??0);if(this.gaps.length>200)this.gaps.shift();}
 entity(id:string):Held|undefined{return this.cur.get(id);}
 entities():Held[]{return [...this.cur.values()];}
 history(id:string):readonly Held[]{return this.hist.get(id)??[];}
 /** Latest held sample per entity with simTimeNs at or before `simTimeNs`; frozen, so a reader cannot change the store. */
 snapshotAt(simTimeNs:string):Record<string,Held>{
  const c=BigInt(simTimeNs),out:Record<string,Held>={};
  for(const [id,h] of this.hist){for(let i=h.length-1;i>=0;i--){const t=h[i]!.simTimeNs;if(t!==null&&BigInt(t)<=c){out[id]=h[i]!;break;}}}
  return out;
 }
}
