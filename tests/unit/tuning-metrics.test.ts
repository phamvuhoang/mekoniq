import {expect,test} from 'vitest';
import {stepResponseMetrics} from '../../packages/lab-runtime/src/v2/control/tuning-metrics';
import type {DriveTrace} from '../../packages/lab-runtime/src/v2/control/drive-io';

type Sample=NonNullable<DriveTrace['samples'][number]>;
const policy={finalWindowS:0.2,settleBand:0.02,holdWindowS:0.2},unit={t0S:0,y0:0,amplitude:1};
const value=(x:unknown)=>(x as {available:true;value:number}).value;
const second=(zeta:number,wn:number,n:number,dtS=0.002,extra:(k:number)=>Partial<Sample>=()=>({}))=>{
 const wd=wn*Math.sqrt(1-zeta**2);
 return Array.from({length:n},(_,k)=>{const t=k*dtS,y=1-Math.exp(-zeta*wn*t)*(Math.cos(wd*t)+zeta/Math.sqrt(1-zeta**2)*Math.sin(wd*t));return {target:1,actual:y,feedback:y,torqueNm:0,...extra(k)};});
};

test('step metrics match the closed-form second-order response',()=>{
 const zeta=0.5,wn=10,wd=wn*Math.sqrt(1-zeta**2),dtS=0.002;
 const samples=Array.from({length:1500},(_,k)=>{const t=k*dtS,y=1-Math.exp(-zeta*wn*t)*(Math.cos(wd*t)+zeta/Math.sqrt(1-zeta**2)*Math.sin(wd*t));return {target:1,actual:y,feedback:y,torqueNm:0};});
 const m=stepResponseMetrics({axisId:'a',dtS,samples},{t0S:0,y0:0,amplitude:1},{finalWindowS:0.2,settleBand:0.02,holdWindowS:0.2});
 expect(m.overshootPct.available).toBe(true);
 expect(value(m.overshootPct)).toBeCloseTo(16.30,1);          // exp(-pi*zeta/sqrt(1-zeta^2))
 expect(value(m.settlingTimeS)).toBeGreaterThan(0.72);         // after the second trough (-2.66 %) at 0.7255 s
 expect(value(m.settlingTimeS)).toBeLessThanOrEqual(0.812);    // the 2 % envelope bound
 expect(Math.abs(value(m.steadyStateError))).toBeLessThan(1e-3);
});
test('a response that never enters the 2 % band has no settling time',()=>{
 const samples=Array.from({length:500},(_,k)=>({target:1,actual:1+0.1*Math.sin(k/5),feedback:null,torqueNm:0}));
 const m=stepResponseMetrics({axisId:'a',dtS:0.002,samples},{t0S:0,y0:0,amplitude:1},{finalWindowS:0.2,settleBand:0.02,holdWindowS:0.2});
 expect(m.settlingTimeS).toEqual({available:false,value:null,unit:'s',reason:'NOT_SETTLED'});
});
test('settling away from the target: no settling time, but the final value and its error exist (contracts §5)',()=>{
 const samples=Array.from({length:500},(_,k)=>({target:1,actual:Math.min(1,k/100)*0.85,feedback:null,torqueNm:2}));   // flat at 0.85: outside the band, never at 90 %
 const m=stepResponseMetrics({axisId:'a',dtS:0.002,samples},unit,policy);
 expect(m.settlingTimeS).toMatchObject({available:false,reason:'NOT_SETTLED'});
 expect(value(m.steadyStateError)).toBeCloseTo(0.15,12);
 expect(m.riseTimeS).toMatchObject({available:false,reason:'TARGET_NOT_REACHED'});
 expect(m.overshootPct).toEqual({available:false,value:null,unit:'%',reason:'TARGET_NOT_REACHED'});   // contracts §5: overshoot is not defined when the target is never reached (not 0)
});
test('a final window that still moves (standard deviation above band * |A|) has no final value and no error; a gap or a small ripple does not decide it',()=>{
 const osc=Array.from({length:500},(_,k)=>({target:1,actual:1+0.1*Math.sin(k/5),feedback:null,torqueNm:0}));
 expect(stepResponseMetrics({axisId:'a',dtS:0.002,samples:osc},unit,policy).steadyStateError).toMatchObject({available:false,reason:'NOT_SETTLED'});
 const ripple=(a:number)=>Array.from({length:500},(_,k)=>({target:1,actual:1+a*(k%2?1:-1),feedback:null,torqueNm:0}));   // sd = a
 expect(value(stepResponseMetrics({axisId:'a',dtS:0.002,samples:ripple(0.015)},unit,policy).steadyStateError)).toBeCloseTo(0,12);
 expect(stepResponseMetrics({axisId:'a',dtS:0.002,samples:ripple(0.03)},unit,policy).steadyStateError).toMatchObject({available:false,reason:'NOT_SETTLED'});
 expect(value(stepResponseMetrics({axisId:'a',dtS:0.002,samples:ripple(0.03)},{...unit,amplitude:2,y0:-1},policy).steadyStateError)).toBeCloseTo(0,12);   // the threshold scales with |A|
});
test('rise time is the 10 % to 90 % interval, overshoot is 0 for a response that stays below the target',()=>{
 const dtS=0.002,samples=Array.from({length:1500},(_,k)=>({target:1,actual:1-Math.exp(-k*dtS/0.1),feedback:null,torqueNm:0}));   // first order, tau 0.1: rise = tau ln 9
 const m=stepResponseMetrics({axisId:'a',dtS,samples},unit,policy);
 expect(value(m.riseTimeS)).toBeCloseTo(0.1*Math.log(9),3);expect(value(m.overshootPct)).toBe(0);
 expect(m.riseTimeS).toMatchObject({unit:'s',basis:'actual'});expect(value(m.steadyStateError)).toBeCloseTo(0,5);
});
test('a step that starts late, from an offset, with a negative amplitude, is measured from its own start',()=>{
 const dtS=0.002,wd=10*Math.sqrt(0.75),n=1500,t0S=0.1,samples=Array.from({length:n},(_,k)=>{const t=Math.max(0,k*dtS-t0S),y=1-Math.exp(-5*t)*(Math.cos(wd*t)+0.5/Math.sqrt(0.75)*Math.sin(wd*t));return {target:0,actual:2-y*1.5,feedback:null,torqueNm:0};});
 const m=stepResponseMetrics({axisId:'a',dtS,samples},{t0S,y0:2,amplitude:-1.5},policy);
 expect(value(m.overshootPct)).toBeCloseTo(16.30,1);expect(value(m.settlingTimeS)).toBeLessThan(0.82);expect(value(m.settlingTimeS)).toBeGreaterThan(0.72);
 expect(Math.abs(value(m.steadyStateError))).toBeLessThan(1e-3);
});
test('the error is target minus actual: rms over the window, signed steady-state error',()=>{
 const samples=Array.from({length:500},(_,k)=>({target:1,actual:k<100?0:0.985,feedback:null,torqueNm:0}));   // inside the 2 % band, 0.015 short
 const m=stepResponseMetrics({axisId:'a',dtS:0.002,samples},unit,policy);
 expect(value(m.steadyStateError)).toBeCloseTo(0.015,12);
 expect(value(m.rmsError)).toBeCloseTo(Math.sqrt((100*1+400*0.015**2)/500),12);expect(m.rmsError).toMatchObject({unit:'rad',samples:500});
 expect(stepResponseMetrics({axisId:'a',dtS:0.002,samples},unit,policy,'csv').rmsError).toMatchObject({unit:'rad/s'});
});
test('peak torque and saturation ratio over the window; a trace without the flag cannot say',()=>{
 const samples=second(0.7,20,500,0.002,k=>({torqueNm:k===50?-3.5:1,saturated:k>=40&&k<60}));
 const m=stepResponseMetrics({axisId:'a',dtS:0.002,samples},unit,policy);
 expect(value(m.peakTorqueNm)).toBe(3.5);expect(m.peakTorqueNm).toMatchObject({unit:'N m'});
 expect(value(m.saturationRatio)).toBeCloseTo(20/500,12);
 expect(stepResponseMetrics({axisId:'a',dtS:0.002,samples:second(0.7,20,500)},unit,policy).saturationRatio).toMatchObject({available:false,reason:'SATURATION_NOT_TRACED'});
});
test('a missing substep is TRACE_GAP for every metric whose window contains it, and only for those',()=>{
 const base=second(0.7,20,1000),with_=(i:number)=>{const s:(Sample|null)[]=[...base];s[i]=null;return s;};
 const early=stepResponseMetrics({axisId:'a',dtS:0.002,samples:with_(100)},unit,policy);
 for(const k of ['riseTimeS','overshootPct','settlingTimeS','rmsError','peakTorqueNm','saturationRatio'] as const)expect(early[k],k).toMatchObject({available:false,reason:'TRACE_GAP'});
 expect(early.steadyStateError.available).toBe(true);   // the final window is complete
 expect(stepResponseMetrics({axisId:'a',dtS:0.002,samples:with_(950)},unit,policy).steadyStateError).toMatchObject({available:false,reason:'TRACE_GAP'});
 // a gap before the step does not matter
 expect(stepResponseMetrics({axisId:'a',dtS:0.002,samples:with_(5)},{...unit,t0S:0.1},policy).rmsError.available).toBe(true);
});
test('invalid windows and policies are reported, not computed',()=>{
 const trace={axisId:'a',dtS:0.002,samples:second(0.7,20,500)};
 expect(stepResponseMetrics(trace,{t0S:5,y0:0,amplitude:1},policy).riseTimeS).toMatchObject({available:false,reason:'WINDOW_INVALID'});
 expect(stepResponseMetrics(trace,{...unit,amplitude:0},policy).rmsError).toMatchObject({available:false,reason:'AMPLITUDE_ZERO'});
 expect(stepResponseMetrics(trace,unit,{...policy,settleBand:0}).settlingTimeS).toMatchObject({available:false,reason:'POLICY_INVALID'});
 expect(stepResponseMetrics({...trace,samples:[]},unit,policy).rmsError).toMatchObject({available:false,reason:'WINDOW_INVALID'});
 expect(stepResponseMetrics({...trace,dtS:0},unit,policy).rmsError).toMatchObject({available:false,reason:'WINDOW_INVALID'});
 expect(Object.keys(stepResponseMetrics(trace,unit,policy)).sort()).toEqual(['overshootPct','peakTorqueNm','riseTimeS','rmsError','saturationRatio','settlingTimeS','steadyStateError']);
});

test('the contract: a TuningResultV1 of a bench run is a valid shape, an accepted or malformed one is not',async()=>{
 const {validateControlEvidenceShape}=await import('../../packages/lab-runtime/src/v2/control/drive-io');
 const d='a'.repeat(64),metrics=stepResponseMetrics({axisId:'a/J3',dtS:0.002,samples:second(0.7,20,500)},unit,policy);
 const result={schemaVersion:1,documentType:'tuning-result',runId:'run-1',status:'completed',unstable:null,fault:null,collision:null,axisIds:['xarm-1/J3'],signal:{kind:'step',amplitude:0.1,atTick:5},seed:7,engine:{id:'mujoco',version:'3.17.0'},
  plant:{plantModelDigest:d,driveModelDigest:d,controlProfileDigest:d,load:'empty'},effectiveInertia:{valueKgM2:0.5,basis:'mass_matrix_diagonal',provenance:'assumed'},policy,metrics,trace:{chunks:1,sha256:d,samples:500},accepted:false};
 const ok=(v:unknown)=>validateControlEvidenceShape(v);
 expect(ok(result),JSON.stringify(validateControlEvidenceShape.errors)).toBe(true);
 expect(ok({...result,status:'unstable',unstable:{tick:12,warning:'PLANT_UNSTABLE'},effectiveInertia:null})).toBe(true);
 // a drive that protected itself (V06c ruling 8): a result with the tick, the axis and the drive's code; status and its object come together
 expect(ok({...result,status:'drive_fault',fault:{tick:22,axisId:'xarm-1/J3',code:'OVERSPEED'}})).toBe(true);
 expect(ok({...result,status:'drive_fault'})).toBe(false);
 expect(ok({...result,fault:{tick:22,axisId:'xarm-1/J3',code:'OVERSPEED'}})).toBe(false);
 expect(ok({...result,status:'unstable'})).toBe(false);
 // a collision the plant does not allow (F1): a result with its tick and the ids the snapshot named; status and its object come together, and it is required (null otherwise)
 expect(ok({...result,status:'collision',collision:{tick:40,ids:['boundary-west']}})).toBe(true);
 expect(ok({...result,status:'collision'})).toBe(false);
 expect(ok({...result,collision:{tick:40,ids:['boundary-west']}})).toBe(false);
 expect(ok({...result,status:'collision',collision:{tick:40,ids:[]}})).toBe(false);
 expect(ok({...result,status:'collision',collision:{tick:40,ids:['boundary-west']},fault:{tick:40,axisId:'xarm-1/J3',code:'OVERSPEED'}})).toBe(false);
 // the architecture the worker reported (bit identity only holds within one): optional, one of two
 expect(ok({...result,engine:{...result.engine,hostArch:'arm64'}})).toBe(true);expect(ok({...result,engine:{...result.engine,hostArch:'x86_64'}})).toBe(true);
 expect(ok({...result,engine:{...result.engine,hostArch:'aarch64'}})).toBe(false);
 const {fault:_,...without}=result;void _;expect(ok(without)).toBe(false);
 const {collision:__,...noCollision}=result;void __;expect(ok(noCollision)).toBe(false);
 expect(ok({...result,accepted:true})).toBe(false);
 expect(ok({...result,effectiveInertia:{valueKgM2:0.5,basis:'mass_matrix_diagonal',provenance:'measured'}})).toBe(false);
 expect(ok({...result,axisIds:['a/J1','a/J2','a/J3']})).toBe(false);
 expect(ok({...result,signal:{kind:'sine'}})).toBe(false);
});
test('a bench signal that does not end inside the recorded trace has no metric at all: SIGNAL_TRUNCATED, never metrics of a step that did not run',async()=>{
 const {benchMetrics}=await import('../../packages/lab-runtime/src/v2/control/bench-runner');
 const p={finalWindowS:0.5,settleBand:0.02,holdWindowS:0.25},flat=(ticks:number)=>({axisId:'xarm-1/J3',dtS:0.002,samples:Array.from({length:(ticks+1)*10},()=>({target:0,actual:0,feedback:0,torqueNm:0,saturated:false}))});
 const trace=flat(500),truncated=(m:Record<string,{available:boolean;reason?:string}>)=>Object.values(m).every(x=>!x.available&&x.reason==='SIGNAL_TRUNCATED');
 // anchor 4: a step at signal tick 497 would land on engine tick 501, after the last recorded tick 500
 expect(truncated(benchMetrics(trace,{kind:'step',amplitude:0.1,atTick:497},4,'csp',p,'completed'))).toBe(true);
 // landing on the last tick is a step that ran (its window is that tick)
 const last=benchMetrics(trace,{kind:'step',amplitude:0.1,atTick:496},4,'csp',p,'completed');
 expect(last.rmsError).toMatchObject({available:true,samples:11});expect(last.riseTimeS).toMatchObject({available:false,reason:'TARGET_NOT_REACHED'});
 // a trapezoid whose motion (135 ticks) ends after the last tick, against one that ends on it; a hold longer than what ran
 const trap=(atTick:number)=>({kind:'trapezoid' as const,distance:5,peakVelocity:2,acceleration:10,atTick});
 expect(truncated(benchMetrics(trace,trap(362),4,'csv',p,'completed'))).toBe(true);expect(benchMetrics(trace,trap(361),4,'csv',p,'completed').rmsError.available).toBe(true);
 expect(truncated(benchMetrics(flat(300),{kind:'hold',ticks:400},4,'csp',p,'completed'))).toBe(true);expect(benchMetrics(flat(300),{kind:'hold',ticks:297},4,'csp',p,'completed').rmsError.available).toBe(true);
});
test('a trapezoid\'s tracking error and saturation ratio are measured over its motion, [signal start, motion end], not the stationary tail after it (spec §6.1, contracts §5)',async()=>{
 const {benchMetrics}=await import('../../packages/lab-runtime/src/v2/control/bench-runner');
 const p={finalWindowS:0.5,settleBand:0.02,holdWindowS:0.25},trap={kind:'trapezoid' as const,distance:5,peakVelocity:2,acceleration:10,atTick:10};   // 135 ticks of motion: signal ticks 10..145
 // anchor 4: the origin is sample 10*(4+10)-1 = 139, the motion's last sample the end of engine tick 4+145 = 149 (sample 1499): 1,361 samples. Every sample of the motion after the origin is 1 off
 // and saturated, the tail is exact; the tail holds the largest torque
 const samples=Array.from({length:5010},(_,i)=>({target:i>=140&&i<1500?1:0,actual:0,feedback:0,torqueNm:i===3000?9:i>=140&&i<1500?1:0,saturated:i>=140&&i<1500}));
 const m=benchMetrics({axisId:'amr-1/wheel-left',dtS:0.002,samples},trap,4,'csv',p,'completed');
 expect(m.rmsError).toMatchObject({available:true,samples:1361,unit:'rad/s'});expect(value(m.rmsError)).toBeCloseTo(Math.sqrt(1360/1361),12);
 expect(m.saturationRatio).toMatchObject({available:true,samples:1361});expect(value(m.saturationRatio)).toBeCloseTo(1360/1361,12);
 expect(value(m.peakTorqueNm)).toBe(9);   // the ruling moves the two above only: the peak torque keeps the window from the start to the end of the bench
 expect(m.riseTimeS).toMatchObject({available:false,reason:'SIGNAL_NOT_STEP'});
});
