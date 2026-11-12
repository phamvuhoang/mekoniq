// Pure joint motion profiles for the arm state machine. No state, no plant.
export interface MotionLimits {maxVelocity:readonly number[];maxAcceleration:readonly number[];speedFraction:number;dtS:number}
/** Rest-to-rest, s(u)=10u³−15u⁴+6u⁵, every joint shares one duration T = max_i max(1.875·|d_i|/(v_i·f), sqrt(5.7735·|d_i|/(a_i·f))), rounded up to whole ticks (at least 1).
 * 1.875 and 5.7735 are the peak of s' and s'' (10/√3), so the scaled limits hold at every tick. */
export function quinticSegment(from:readonly number[],to:readonly number[],lim:MotionLimits):{ticks:number;at(k:number):number[]} {
 const pos=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0,n=from.length;
 if(to.length!==n||![...from,...to].every(Number.isFinite)||!pos(lim.speedFraction)||!pos(lim.dtS)||lim.maxVelocity.length<n||lim.maxAcceleration.length<n
  ||!lim.maxVelocity.slice(0,n).every(pos)||!lim.maxAcceleration.slice(0,n).every(pos))throw new Error('MOTION_LIMITS_INVALID');
 const f=lim.speedFraction;let T=0;
 from.forEach((q,i)=>{const d=Math.abs(to[i]!-q);if(d>0)T=Math.max(T,1.875*d/(lim.maxVelocity[i]!*f),Math.sqrt(5.7735*d/(lim.maxAcceleration[i]!*f)));});
 const ticks=Math.max(1,Math.ceil(T/lim.dtS));
 return {ticks,at(k){if(k<=0)return [...from];if(k>=ticks)return [...to];const u=k/ticks,s=u*u*u*(10+u*(-15+6*u));return from.map((q,i)=>q+(to[i]!-q)*s);}};
}
