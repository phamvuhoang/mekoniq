// Gain suggestion (R4-A §6, D4): one second-order form for both modes, then clamped into the axis envelope. The inertia is whatever the worker reports (the basis is the worker's business); this module never computes J.
import type {AxisEnvelope} from './drive-io';
import {SUGGEST_OPTIONS} from './bench-signals';

export interface SuggestedLoop {kp:number;ki:number;kd:number;integralLimit:number|null;slewLimit:null}

/** csp: kp = J wn^2, kd = 2 zeta wn J, ki = 0 (a PD loop on position). csv: a PI loop on speed, J s^2 + kp s + ki, so kp = 2 zeta wn J, ki = J wn^2, kd = 0, integral limit at the envelope's ceiling.
 *  A value outside the envelope is clamped and its field listed in `clamped` (a field the envelope does not list becomes 0). The integral limit exists exactly when the clamped ki is above 0. slewLimit is always null. */
export function suggestGains(input:{mode:'csp'|'csv';inertiaKgM2:number;bandwidthRadS:number;damping:number},envelope:AxisEnvelope):{loop:SuggestedLoop;clamped:('kp'|'ki'|'kd')[]}{
 const {mode,inertiaKgM2:j,bandwidthRadS:w,damping:z}=input;
 for(const x of [j,w,z])if(!(Number.isFinite(x)&&x>0))throw new RangeError('SUGGEST_INPUT_INVALID');
 const clamped:('kp'|'ki'|'kd')[]=[],clamp=(x:number,k:'kp'|'ki'|'kd')=>{
  const b=envelope[k],y=b?Math.min(b.max,Math.max(b.min,x)):0;
  if(y!==x)clamped.push(k);return y;
 };
 const loop=mode==='csp'?{kp:j*w*w,ki:0,kd:2*z*w*j}:{kp:2*z*w*j,ki:j*w*w,kd:0};
 const kp=clamp(loop.kp,'kp'),ki=clamp(loop.ki,'ki'),kd=clamp(loop.kd,'kd');
 return {loop:{kp,ki,kd,integralLimit:ki>0?envelope.integralLimit.max:null,slewLimit:null},clamped};
}

/** The suggestions a bench result carries (TuningResultV1.suggestions, V07pre): suggestGains at every registered (bandwidth, damping) pair of SUGGEST_OPTIONS, bandwidth first, so the Lab never computes gains itself.
 *  accelerationLimit is always null: D4 does not size one (null is valid on both modes). */
export const gainSuggestions=(input:{mode:'csp'|'csv';inertiaKgM2:number},envelope:AxisEnvelope)=>SUGGEST_OPTIONS.bandwidthRadS.flatMap(bandwidthRadS=>SUGGEST_OPTIONS.damping.map(damping=>
 {const {loop,clamped}=suggestGains({...input,bandwidthRadS,damping},envelope);return {bandwidthRadS,damping,loop,accelerationLimit:null,clamped};}));
