// The session's monotonic clock (K04). runCase keeps its 20 ms tick on a Clock, so tests run on fakeClock and never wait.
export interface Clock{nowNs():bigint;sleepUntilNs(t:bigint):Promise<void>}
export const systemClock:Clock={
 nowNs:()=>process.hrtime.bigint(),
 // ponytail: setTimeout resolution (about 1 ms, more under load); a late tick is measured (latenessNs) and judged by policy.tickLatenessMaxMs, not hidden
 sleepUntilNs:t=>{const ms=Number(t-process.hrtime.bigint())/1e6;return ms>0?new Promise(r=>setTimeout(r,ms)):Promise.resolve();},
};
/** Time moves only when the code sleeps (to the deadline) or the test calls advance(). */
export function fakeClock(startNs=0n):Clock&{advance(ns:bigint):void}{
 let now=startNs;
 return {nowNs:()=>now,sleepUntilNs:async t=>{if(t>now)now=t;},advance(ns){now+=ns;}};
}
