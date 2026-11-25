// Freshness of a held sample by this browser's receipt clock (never compared with the gateway's monotonic clock). Supervision only, not
// a safety watchdog. A heartbeat proves the link, not the measurement: it never refreshes a sample's age.
import type {Held} from './store';
import type {LinkState} from '../runtime/stream';
export const FRESHNESS_MS={pose:500,status:2000,heartbeat:2000};
export interface Link {state:LinkState;lastHeartbeatMs:number|null;paused:boolean}
export interface Freshness {state:'live'|'stale'|'frozen_sim'|'disconnected'|'unknown';ageMs:number|null;reason:string|null}
/** Pose/joint samples go stale after 500 ms, device status after 2 s. */
export const kindOf=(s:Held)=>s.providerId==='mock_coffee'||s.frameId==='cell_base'?'status' as const:'pose' as const;
export function freshness(s:Held|undefined,link:Link,nowMs:number,kind:'pose'|'status'=s?kindOf(s):'pose'):Freshness{
 if(!s)return {state:'unknown',ageMs:null,reason:'NO_SAMPLE'};
 const ageMs=Math.max(0,nowMs-s.receivedAtMs);
 if(link.state!=='live')return {state:'disconnected',ageMs,reason:link.state};
 if(link.lastHeartbeatMs===null||nowMs-link.lastHeartbeatMs>FRESHNESS_MS.heartbeat)return {state:'disconnected',ageMs,reason:'HEARTBEAT_LOST'};
 // mock/simulation pause acknowledged by the runtime: frozen with the real age, no stale alarm; hardware has no such exception
 if(link.paused&&s.origin!=='hardware')return {state:'frozen_sim',ageMs,reason:'FROZEN_SIM'};
 if(s.quality==='unknown'||s.quality==='invalid')return {state:'unknown',ageMs,reason:s.reasonCodes[0]??s.quality.toUpperCase()};
 if(s.quality==='stale')return {state:'stale',ageMs,reason:s.reasonCodes[0]??'STALE'};
 if(ageMs>FRESHNESS_MS[kind])return {state:'stale',ageMs,reason:'AGE_EXCEEDED'};
 return {state:'live',ageMs,reason:null};
}
