/** Mock virtual clock: fixed 20 ms ticks from an injected epoch. Business time comes only from here, never Date.now(). */
export const TICK_MS=20;
export interface Clock {readonly tick:number;readonly paused:boolean;nowMs():number;simTimeNs():string;advance(ticks:number):void;pause():void;resume():void;}
export function createClock(epochMs:number,tick=0,paused=false):Clock {
 return {
  get tick(){return tick;},get paused(){return paused;},
  nowMs:()=>epochMs+tick*TICK_MS,
  simTimeNs:()=>(BigInt(tick)*BigInt(TICK_MS)*1000000n).toString(),
  advance(n){if(paused)throw new Error('CLOCK_PAUSED');if(!Number.isSafeInteger(n)||n<1)throw new Error('INVALID_TICKS');tick+=n;},
  pause(){paused=true;},resume(){paused=false;},
 };
}
