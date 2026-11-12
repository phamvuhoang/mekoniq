// Paced step (D57): the one place that knows the pacing rule. Pacing only delays the start of a tick; it never changes what a run computes,
// never catches up (a tick more than 250 ms late re-anchors) and never skips a tick. The anchor lives in the run's memory only.
import {TICK_MS} from './clock';
export interface PaceAnchor {wallMs:number;tick:number;factor:number}
export interface WallClock {now():number;sleep(ms:number):Promise<void>}
export const realWall:WallClock={now:()=>performance.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};
const LATE_MS=250;
/** Tick `tick` được bắt đầu sớm nhất tại anchor.wallMs+(tick−anchor.tick)·tickMs/factor. Mốc mới khi chưa có mốc, factor đổi, hoặc now đã trễ hơn thời điểm đó quá 250 ms. Thuần. */
export function paceDelay(anchor:PaceAnchor|null,tick:number,factor:number,nowMs:number,tickMs=TICK_MS):{anchor:PaceAnchor;delayMs:number}{
 if(anchor&&anchor.factor===factor){const due=anchor.wallMs+(tick-anchor.tick)*tickMs/factor;if(nowMs-due<=LATE_MS)return {anchor,delayMs:Math.max(0,due-nowMs)};}
 return {anchor:{wallMs:nowMs,tick,factor},delayMs:0};
}
/** Waits until `tick` is due on `wall`; returns the anchor to keep. Both runners call this before each tick of a paced step, and only then. */
export async function awaitTick(wall:WallClock,anchor:PaceAnchor|null,tick:number,factor:number):Promise<PaceAnchor>{
 const r=paceDelay(anchor,tick,factor,wall.now());if(r.delayMs>0)await wall.sleep(r.delayMs);return r.anchor;
}
