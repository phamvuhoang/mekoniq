// Gain suggestion (R4-A §6, D4): one second-order form for both modes, then clamped into the axis envelope. The inertia is whatever the worker reports (the basis is the worker's business); this module never computes J.
import type {AxisEnvelope} from './drive-io';

export interface SuggestedLoop {kp:number;ki:number;kd:number;integralLimit:number|null;slewLimit:null}

/** csp: kp = J wn^2, kd = 2 zeta wn J, ki = 0 (a PD loop on position). csv: a PI loop on speed, J s^2 + kp s + ki, so kp = 2 zeta wn J, ki = J wn^2, kd = 0, integral limit at the envelope's ceiling.
 *  A value outside the envelope is clamped and its field listed in `clamped` (a field the envelope does not list becomes 0). The integral limit exists exactly when the clamped ki is above 0. slewLimit is always null. */
export function suggestGains(input:{mode:'csp'|'csv';inertiaKgM2:number;bandwidthRadS:number;damping:number},envelope:AxisEnvelope):{loop:SuggestedLoop;clamped:string[]}{
 const {mode,inertiaKgM2:j,bandwidthRadS:w,damping:z}=input;
 for(const x of [j,w,z])if(!(Number.isFinite(x)&&x>0))throw new RangeError('SUGGEST_INPUT_INVALID');
 const clamped:string[]=[],clamp=(x:number,k:'kp'|'ki'|'kd')=>{
  const b=envelope[k],y=b?Math.min(b.max,Math.max(b.min,x)):0;
  if(y!==x)clamped.push(k);return y;
 };
 const loop=mode==='csp'?{kp:j*w*w,ki:0,kd:2*z*w*j}:{kp:2*z*w*j,ki:j*w*w,kd:0};
 const kp=clamp(loop.kp,'kp'),ki=clamp(loop.ki,'ki'),kd=clamp(loop.kd,'kd');
 return {loop:{kp,ki,kd,integralLimit:ki>0?envelope.integralLimit.max:null,slewLimit:null},clamped};
}
