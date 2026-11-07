export type PhysicsKind='joint'|'pose'|'contact'|'sensor'|'process';
export interface PhysicsSample{
 runId:string;bundleDigest:string;epoch:number;sequence:number;
 /** Decimal nanoseconds as strings: native clocks exceed 2^53. */
 simTimeNs:string;receivedMonotonicNs:string;
 entityId:string;frameId:string;kind:PhysicsKind;values:Record<string,number>;
}
export interface Ingested{accepted:boolean;reason:string|null}
export interface Expected{runId:string;bundleDigest:string;epoch:number}
/** Locked value names per kind (SI: m, rad, m/s, rad/s, N, N*m, kg, mL, s, K). A sample with other names carries no business meaning and is refused. */
const VALUES:Record<PhysicsKind,{required:string[];optional?:string[]}>={
 joint:{required:['position','velocity','effort']},
 pose:{required:['x','y','z','qx','qy','qz','qw']},
 contact:{required:['normalForceN','durationNs'],optional:['penetrationM']},
 sensor:{required:['value'],optional:['stddev']},
 process:{required:['volumeMl','massKg'],optional:['temperatureK']},
};
const NS=/^(0|[1-9][0-9]{0,19})$/;
const text=(v:unknown,max=200):v is string=>typeof v==='string'&&v.length>0&&v.length<=max;
const OK:Ingested={accepted:true,reason:null};
const no=(reason:string):Ingested=>({accepted:false,reason});
function shapeValid(raw:unknown):raw is PhysicsSample{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const s=raw as Record<string,unknown>;
 if(!text(s.runId)||!text(s.bundleDigest,64)||!text(s.entityId)||!text(s.frameId))return false;
 if(!Number.isSafeInteger(s.epoch)||(s.epoch as number)<0||!Number.isSafeInteger(s.sequence)||(s.sequence as number)<0)return false;
 if(typeof s.simTimeNs!=='string'||!NS.test(s.simTimeNs)||typeof s.receivedMonotonicNs!=='string'||!NS.test(s.receivedMonotonicNs))return false;
 const spec=typeof s.kind==='string'&&Object.hasOwn(VALUES,s.kind)?VALUES[s.kind as PhysicsKind]:undefined;
 if(!spec||!s.values||typeof s.values!=='object'||Array.isArray(s.values))return false;
 const values=s.values as Record<string,unknown>,allowed=new Set([...spec.required,...spec.optional??[]]);
 return Object.keys(values).every(k=>allowed.has(k)&&typeof values[k]==='number'&&Number.isFinite(values[k]))&&spec.required.every(k=>Object.hasOwn(values,k));
}
/** Stateless identity + schema check of one sample. */
export function ingestPhysicsSample(raw:unknown,expected:Expected):Ingested{
 if(!shapeValid(raw))return no('INVALID_SAMPLE');
 if(raw.runId!==expected.runId)return no('RUN_MISMATCH');
 if(raw.bundleDigest!==expected.bundleDigest)return no('BUNDLE_MISMATCH');
 if(raw.epoch!==expected.epoch)return no('EPOCH_MISMATCH');
 return OK;
}
/**
 * Ordered, bounded stream for one run epoch. Any ordering or capacity violation fails the stream for good: the caller must stop or raise attention,
 * and a late sample cannot paper over a gap. Evidence is queued before any downsampling for the UI.
 */
export function createPhysicsIngest(expected:Expected,options:{queueLimit?:number}={}){
 const limit=options.queueLimit??10_000,queue:PhysicsSample[]=[];
 let next=0,lastSim=-1n,failed:string|null=null;
 return {
  ingest(raw:unknown):Ingested{
   if(failed)return no('STREAM_FAILED');
   const basic=ingestPhysicsSample(raw,expected);
   if(!basic.accepted)return basic;
   const s=raw as PhysicsSample;
   if(s.sequence<next)return no('DUPLICATE_SEQUENCE');
   if(s.sequence>next){failed='SEQUENCE_GAP';return no(failed);}
   if(BigInt(s.simTimeNs)<lastSim)return no('CLOCK_REGRESSION');
   if(queue.length>=limit){failed='EVIDENCE_GAP';return no(failed);}
   queue.push(s);next+=1;lastSim=BigInt(s.simTimeNs);
   return OK;
  },
  /** Hands the accepted samples to the durable evidence sink. */
  drain():PhysicsSample[]{return queue.splice(0);},
  state(){return {next,queued:queue.length,failed};},
 };
}
