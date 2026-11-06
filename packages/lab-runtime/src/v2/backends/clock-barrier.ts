// Co-simulation clocks (SIM-07): 1x with semantic barriers (cup-ready, arm-transfer-complete, amr-docked). A barrier completes only when every
// participant backend ACKed it; the record keeps each ACK's sim time, controller/wall clock and gateway receipt time (monotonic), so the
// provider clocks stay separate; receipt spread is evidence, not a clock synchronization estimate. A missing ACK times out naming the silent backend and leaves the run in attention. No step/seek is assumed:
// a backend that cannot step says so and `requireStep` refuses to pretend.
import {hashJson} from '../hash';
import type {BackendCapability} from './gazebo-nav2';
export interface EvidenceRef {id:string;sha256:string}
export interface BarrierProof {nonce?:string;bootId?:string;controllerEpoch?:number;seq?:string;state?:'stationary'|'paused'}
export interface BarrierPolicy {nonce:string;expected:Record<string,{bootId:string;controllerEpoch?:number;afterSeq:string}>;state?:'stationary'|'paused'}
export interface BarrierAck extends BarrierProof {participant:string;simTimeNs:string|null;clockNs:string;receivedMonotonicNs:string}
export interface BarrierRecord {barrierId:string;participants:string[];acks:BarrierAck[];status:'pending'|'complete'|'timeout';missing:string[];skewNs:string|null;skewBasis:'coordinator_receipt';proofKind:'legacy_ack'|'correlated_observation';policy:BarrierPolicy|null;openedMonotonicNs:string;closedMonotonicNs:string|null}
export interface BarrierAttention {reason:'BARRIER_TIMEOUT';barrierId:string;missing:string[]}
const BARRIER_ID=/^[A-Za-z0-9_.:-]{1,200}$/,DIGITS=/^[0-9]{1,20}$/;
interface Entry {record:BarrierRecord;deadline:bigint;resolve:(v:{barrierId:string;evidence:EvidenceRef[]})=>void;reject:(e:Error)=>void;promise:Promise<{barrierId:string;evidence:EvidenceRef[]}>}
export function createBarrierCoordinator(o:{monotonicNs:()=>bigint;timeoutNs:bigint}){
 if(o.timeoutNs<=0n)throw new Error('BARRIER_TIMEOUT_INVALID');
 const entries=new Map<string,Entry>(),attention:BarrierAttention[]=[];
 const missingOf=(r:BarrierRecord)=>r.participants.filter(p=>!r.acks.some(a=>a.participant===p));
 const expire=(e:Entry,now:bigint)=>{
  if(e.record.status!=='pending'||now<e.deadline)return;
  e.record.status='timeout';e.record.closedMonotonicNs=String(now);
  attention.push({reason:'BARRIER_TIMEOUT',barrierId:e.record.barrierId,missing:[...e.record.missing]});
  e.reject(new Error(`BARRIER_TIMEOUT:${e.record.missing.join(',')}`));
 };
 return {
  /** Resolves when every participant has ACKed (now or later); rejects BARRIER_TIMEOUT:<missing> once `timeoutNs` of monotonic time passed without them. */
  awaitTransferBarrier(barrierId:string,participants:readonly string[],policy?:BarrierPolicy):Promise<{barrierId:string;evidence:EvidenceRef[]}>{
   if(!BARRIER_ID.test(barrierId))throw new Error('BARRIER_ID_INVALID');
   if(!participants.length||new Set(participants).size!==participants.length||participants.some(p=>!BARRIER_ID.test(p)))throw new Error('BARRIER_PARTICIPANTS_INVALID');
   if(policy&&(!BARRIER_ID.test(policy.nonce)||Object.keys(policy.expected).sort().join(',')!==[...participants].sort().join(',')||Object.values(policy.expected).some(p=>!BARRIER_ID.test(p.bootId)||!DIGITS.test(p.afterSeq)||p.controllerEpoch!==undefined&&(!Number.isSafeInteger(p.controllerEpoch)||p.controllerEpoch<1))||policy.state!==undefined&&!['stationary','paused'].includes(policy.state)))throw new Error('BARRIER_POLICY_INVALID');
   const existing=entries.get(barrierId);if(existing){if([...participants].sort().join(',')!==[...existing.record.participants].sort().join(','))throw new Error('BARRIER_PARTICIPANTS_CONFLICT');if(hashJson(existing.record.policy)!==hashJson(policy??null))throw new Error('BARRIER_POLICY_CONFLICT');return existing.promise;}
   let resolve!:Entry['resolve'],reject!:Entry['reject'];
   const promise=new Promise<{barrierId:string;evidence:EvidenceRef[]}>((res,rej)=>{resolve=res;reject=rej;});
   const now=o.monotonicNs();
   entries.set(barrierId,{record:{barrierId,participants:[...participants],acks:[],status:'pending',missing:[...participants],skewNs:null,skewBasis:'coordinator_receipt',proofKind:policy?'correlated_observation':'legacy_ack',policy:policy?structuredClone(policy):null,openedMonotonicNs:String(now),closedMonotonicNs:null},deadline:now+o.timeoutNs,resolve,reject,promise});
   return promise;
  },
  ack(barrierId:string,participant:string,clocks:{simTimeNs:string|null;clockNs:string}&BarrierProof):void{
   const e=entries.get(barrierId);if(!e)throw new Error('BARRIER_UNKNOWN');
   if(!e.record.participants.includes(participant))throw new Error('BARRIER_PARTICIPANT_UNKNOWN');
   if(!DIGITS.test(clocks.clockNs)||clocks.simTimeNs!==null&&!DIGITS.test(clocks.simTimeNs))throw new Error('BARRIER_CLOCK_INVALID');
   expire(e,o.monotonicNs());
   if(e.record.status!=='pending'||e.record.acks.some(a=>a.participant===participant))return; // late or repeated ACK: recorded nothing, changes nothing
   const policy=e.record.policy,expected=policy?.expected[participant];
   if(policy&&expected&&(clocks.nonce!==policy.nonce||clocks.bootId!==expected.bootId||clocks.controllerEpoch!==expected.controllerEpoch||!clocks.seq||!DIGITS.test(clocks.seq)||BigInt(clocks.seq)<=BigInt(expected.afterSeq)||policy.state!==undefined&&clocks.state!==policy.state))throw new Error('BARRIER_PROOF_MISMATCH');
   e.record.acks.push({participant,simTimeNs:clocks.simTimeNs,clockNs:clocks.clockNs,...policy?{nonce:clocks.nonce!,bootId:clocks.bootId!,seq:clocks.seq!,...clocks.controllerEpoch!==undefined?{controllerEpoch:clocks.controllerEpoch}:{},...policy.state?{state:policy.state}:{}}:{},receivedMonotonicNs:String(o.monotonicNs())});
   e.record.missing=missingOf(e.record);
   if(e.record.missing.length)return;
   const clocksNs=e.record.acks.map(a=>BigInt(a.receivedMonotonicNs));
   e.record.status='complete';e.record.closedMonotonicNs=String(o.monotonicNs());
   e.record.skewNs=String(clocksNs.reduce((m,v)=>v>m?v:m)-clocksNs.reduce((m,v)=>v<m?v:m));
   e.resolve({barrierId,evidence:[{id:`barrier:${barrierId}`,sha256:hashJson(e.record)}]});
  },
  /** Evaluate deadlines against the monotonic clock (called by the run loop; no timers of its own). */
  tick():void{
   const now=o.monotonicNs();
   for(const e of entries.values())expire(e,now);
  },
  records():BarrierRecord[]{return [...entries.values()].map(e=>structuredClone(e.record));},
  attention():BarrierAttention[]{return structuredClone(attention);},
 };
}
export function withinReceiptWindow(receipts:readonly bigint[],maxSkewNs:bigint):boolean{return receipts.length>0&&maxSkewNs>=0n&&receipts.every(n=>n>=0n)&&receipts.reduce((a,b)=>a>b?a:b)-receipts.reduce((a,b)=>a<b?a:b)<=maxSkewNs;}
export interface PauseProvider {pause(paused:boolean):Promise<{acknowledged:boolean;paused?:unknown}>}
/** Pause/resume shows complete only after every provider ACKed; otherwise partial (some ACKs) or unknown (no ACK, a provider failed to answer). */
export async function coordinatePause(providers:Record<string,PauseProvider>,paused:boolean,timeoutMs=5000):Promise<{status:'paused'|'resumed'|'partial'|'unknown';acknowledged:string[];missing:string[]}>{
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw new Error('PAUSE_TIMEOUT_INVALID');
 const acknowledged:string[]=[],missing:string[]=[];let failed=0;
 await Promise.all(Object.keys(providers).sort().map(async id=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const r=await Promise.race([Promise.resolve().then(()=>providers[id]!.pause(paused)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('PAUSE_TIMEOUT')),timeoutMs);})]);
   if(r.acknowledged===true&&r.paused===paused)acknowledged.push(id);else missing.push(id);
  }catch{missing.push(id);failed++;}finally{clearTimeout(timer);}
 }));
 acknowledged.sort();missing.sort();
 return {status:!Object.keys(providers).length||!acknowledged.length&&failed?'unknown':missing.length?'partial':paused?'paused':'resumed',acknowledged,missing};
}
/** Only a backend that declares `step` may be advanced deterministically; gazebo_nav2 (own /clock) and linuxcnc_sim (wall time) do not. */
export function requireStep(capability:BackendCapability):true{
 if(!capability.step)throw new Error(`STEP_UNSUPPORTED:${capability.backendId}`);
 return true;
}
