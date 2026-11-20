// The signals of a single-axis bench run (R4-A §6) and the rules a request must meet before a world is created. Pure: the same numbers on the Mac runtime and in the cloud image.
import {validateBenchRequestShape,validateBenchSignalShape,type BenchRequestV1,type BenchSignal,type Check} from './drive-io';
export type {BenchSignal};

export const BENCH_MAX_TICKS=500;
/** The closed signal catalog (R4-A §6.1). */
export const BENCH_SIGNAL_KINDS=['step','trapezoid','hold'] as const;
/** One logical tick, 20 ms (10 substeps of 2 ms). */
export const BENCH_TICK_S=0.02,BENCH_SUBSTEPS=10;
/** Registered sizes: a speed (csv) step or peak in rad/s, a position (csp) step or distance in rad; the sign is free for a joint, a wheel bench runs forward only (validateBenchRequest: WHEEL_REVERSE_UNSUPPORTED). */
export const BENCH_AMPLITUDES={wheelRadS:[2,5],jointRad:[0.05,0.1,0.2]} as const;
export const SUGGEST_OPTIONS={bandwidthRadS:[5,10,20,40],damping:[0.7,1]} as const;
/** A wheel bench signal runs forward only (validateBenchRequest: WHEEL_REVERSE_UNSUPPORTED); health says so (benchSignals.wheelDirection, benchCatalog's wheel axis). */
export const BENCH_WHEEL_DIRECTION='forward' as const;

type Mode='csp'|'csv';
const done=(codes:Set<string>):Check=>({ok:codes.size===0,reasonCodes:[...codes].sort()});
const registered=(x:number,mode:Mode)=>(mode==='csv'?BENCH_AMPLITUDES.wheelRadS:BENCH_AMPLITUDES.jointRad).some(a=>a===Math.abs(x));

/** The velocity profile of a trapezoid: it accelerates at `acceleration` to `peakVelocity` (less, for a short distance: a triangle), cruises, and brakes; its area is |distance|. */
function profile(s:Extract<BenchSignal,{kind:'trapezoid'}>){
 const d=Math.abs(s.distance),a=s.acceleration,vp=Math.min(s.peakVelocity,Math.sqrt(d*a)),ta=vp/a,tc=d/vp-vp/a,sign=Math.sign(s.distance);
 return {durationS:2*ta+tc,velocity(t:number){return sign*(t<=0?0:t<ta?a*t:t<ta+tc?vp:t<2*ta+tc?vp-a*(t-ta-tc):0);},
  position(t:number){const u=Math.min(Math.max(t,0),2*ta+tc);return sign*(u<ta?a*u*u/2:u<ta+tc?vp*ta/2+vp*(u-ta):d-a*(2*ta+tc-u)**2/2);}};
}
/** The tick after which the commanded signal no longer changes: the end of the motion of a trapezoid, the length of a hold, the step tick of a step. */
export const benchMotionEndTick=(s:BenchSignal):number=>s.kind==='hold'?s.ticks:s.kind==='step'?s.atTick:s.atTick+Math.ceil(profile(s).durationS/BENCH_TICK_S-1e-9);
/** The last signal tick the signal needs: a step's landing, a trapezoid's motion end, a hold's last tick. Signal tick k runs on engine tick anchor + k, so the signal fits when anchor + this <= BENCH_MAX_TICKS. */
export const benchSignalLastTick=(s:BenchSignal):number=>s.kind==='hold'?s.ticks-1:benchMotionEndTick(s);
/** The engine tick that carries signal tick 0 (bench-runner.ts): the first tick commanded after every axis reports enabled. Every axis asks to be enabled from tick 1 and is enabled after its
 *  enableDelaySubsteps (an axis without an enable sequence boots enabled at the priming tick 0), so the slowest one is enabled at the end of tick ceil(max / 10): 1 for an ideal drive, 4 for 25 substeps. */
export const benchAnchorTick=(model:{axes:readonly {enableDelaySubsteps:number}[]}):number=>1+Math.ceil(Math.max(0,...model.axes.map(a=>a.enableDelaySubsteps))/BENCH_SUBSTEPS);

/** The reason codes (empty: admitted) for one signal on one axis: shape, a registered size, a tick inside the bench, a motion that ends inside it and, for a position axis with limits, a target inside them. `start` is the position the axis rests at.
 *  With `anchorTick` (the engine tick of signal tick 0, benchAnchorTick), the signal must also end inside the bench after the drive's enable sequence: TICK_OUT_OF_RANGE otherwise. */
export function validateBenchSignal(signal:unknown,axis:{mode:Mode;lower?:number;upper?:number;start?:number;anchorTick?:number}):Check{
 const shape=validateBenchSignalShape(signal);
 if(!shape.ok)return shape;
 const s=signal as BenchSignal,codes=new Set<string>();
 if(s.kind!=='hold'&&s.atTick>=BENCH_MAX_TICKS)codes.add('TICK_OUT_OF_RANGE');
 if(s.kind==='step'&&!registered(s.amplitude,axis.mode))codes.add('AMPLITUDE_NOT_REGISTERED');
 if(s.kind==='trapezoid'){
  // a speed axis is sized by its peak speed, a position axis by its distance; the other numbers only have to be positive (the schema) and fit in the bench
  if(!registered(axis.mode==='csv'?s.peakVelocity:s.distance,axis.mode))codes.add('AMPLITUDE_NOT_REGISTERED');
  if(s.distance===0)codes.add('DISTANCE_ZERO');
  else if(s.atTick<BENCH_MAX_TICKS&&benchMotionEndTick(s)>BENCH_MAX_TICKS)codes.add('SIGNAL_TOO_LONG');
 }
 if(axis.anchorTick!==undefined&&!codes.has('TICK_OUT_OF_RANGE')&&!codes.has('SIGNAL_TOO_LONG')&&axis.anchorTick+benchSignalLastTick(s)>BENCH_MAX_TICKS)codes.add('TICK_OUT_OF_RANGE');
 if(axis.mode==='csp'&&(s.kind==='step'||s.kind==='trapezoid')){
  const far=(axis.start??0)+(s.kind==='step'?s.amplitude:s.distance);
  if((axis.lower!==undefined&&far<axis.lower)||(axis.upper!==undefined&&far>axis.upper))codes.add('JOINT_LIMIT_EXCEEDED');
 }
 return done(codes);
}

/** The command for `tick`. csp: a position (rad), `start` plus the step or the integral of the velocity profile; csv: a speed (rad/s), `start` is ignored (a wheel bench starts at rest), a step is its amplitude
 *  and a trapezoid is the velocity profile itself, with the area |distance|. Sampled at the tick (a step takes effect on its tick). */
export function benchTarget(signal:BenchSignal,start:number,tick:number,mode:Mode='csp'):number{
 const base=mode==='csp'?start:0;
 if(signal.kind==='hold')return base;
 if(signal.kind==='step')return tick>=signal.atTick?base+signal.amplitude:base;
 const p=profile(signal),t=(tick-signal.atTick)*BENCH_TICK_S;
 return mode==='csp'?base+p.position(t):p.velocity(t);
}

/** The axes a bench request can name, and the drive mode of each: the two wheels (speed) or one arm axis (position). */
export const benchAxisMode=(axis:BenchRequestV1['axis']):Mode=>axis==='wheels'?'csv':'csp';
/** Shape plus the cross-field rules a schema cannot say: `wheels` only on MJ-BENCH-WHEEL, a joint or the gripper only on MJ-BENCH-ARM, a wheel signal forward only (the AMR has 1.5 m of floor behind it: a reverse
 *  step drove it into boundary-west, final-fix-report F1; a negative peak is the schema's refusal), and a signal the axis admits. `plant.anchorTick` is the engine tick of signal tick 0 for the experiment's drive (benchAnchorTick);
 *  `plant.limits` are the joint limits and rest position the server knows: required for a joint or the gripper (without them: AXIS_LIMITS_REQUIRED, never a request admitted unchecked), ignored for the wheels. The control profile against its model and the envelope is the caller's check (validateControlProfile, which calls withinEnvelope). */
export function validateBenchRequest(request:unknown,plant:{anchorTick:number;limits?:{lower:number;upper:number;start:number}}):Check{
 const shape=validateBenchRequestShape(request);
 if(!shape.ok)return shape;
 const r=request as BenchRequestV1,codes=new Set<string>();
 if((r.axis==='wheels')!==(r.scenarioId==='MJ-BENCH-WHEEL'))codes.add('AXIS_SCENARIO_MISMATCH');
 if(codes.size)return done(codes);
 const limits=plant.limits;
 if(r.axis!=='wheels'&&!(limits&&[limits.lower,limits.upper,limits.start].every(Number.isFinite)))return done(codes.add('AXIS_LIMITS_REQUIRED'));
 if(r.axis==='wheels'&&(r.signal.kind==='step'&&r.signal.amplitude<0||r.signal.kind==='trapezoid'&&r.signal.distance<0))codes.add('WHEEL_REVERSE_UNSUPPORTED');
 for(const c of validateBenchSignal(r.signal,{mode:benchAxisMode(r.axis),anchorTick:plant.anchorTick,...(r.axis==='wheels'?{}:limits)}).reasonCodes)codes.add(c);
 return done(codes);
}
