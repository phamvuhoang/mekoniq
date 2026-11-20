import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {BENCH_AMPLITUDES,BENCH_MAX_TICKS,BENCH_TICK_S,SUGGEST_OPTIONS,benchTarget,validateBenchRequest,validateBenchSignal,type BenchSignal} from '../../packages/lab-runtime/src/v2/control/bench-signals';
import type {ControlProfileV1} from '../../packages/lab-runtime/src/v2/control/drive-io';

const csv={mode:'csv' as const},csp={mode:'csp' as const,lower:-1,upper:1,start:0.5};
const codes=(s:unknown,a:Parameters<typeof validateBenchSignal>[1])=>validateBenchSignal(s,a).reasonCodes;
const profile=JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/drive-v1/serve-control-v1.json','utf8')) as ControlProfileV1;
const req=(o:object={})=>({schemaVersion:1,scenarioId:'MJ-BENCH-WHEEL',axis:'wheels',signal:{kind:'step',amplitude:2,atTick:5},driveExperimentId:'drive-nominal-v1',controlProfile:profile,...o});

test('the registered sets are the ones of the plan',()=>{
 expect(BENCH_MAX_TICKS).toBe(500);expect(BENCH_TICK_S).toBe(0.02);
 expect(BENCH_AMPLITUDES).toEqual({wheelRadS:[2,5],jointRad:[0.05,0.1,0.2]});
 expect(SUGGEST_OPTIONS).toEqual({bandwidthRadS:[5,10,20,40],damping:[0.7,1]});
});
test('a registered amplitude is admitted in either sign; anything else is refused with its reason',()=>{
 expect(validateBenchSignal({kind:'step',amplitude:2,atTick:5},csv)).toEqual({ok:true,reasonCodes:[]});
 expect(validateBenchSignal({kind:'step',amplitude:-0.1,atTick:0},csp).ok).toBe(true);
 expect(codes({kind:'step',amplitude:3,atTick:5},csv)).toEqual(['AMPLITUDE_NOT_REGISTERED']);
 expect(codes({kind:'step',amplitude:2,atTick:5},{mode:'csp'})).toEqual(['AMPLITUDE_NOT_REGISTERED']);   // a wheel amplitude on a joint
 expect(codes({kind:'step',amplitude:0.1,atTick:5},csv)).toEqual(['AMPLITUDE_NOT_REGISTERED']);
});
test('a step that would carry the joint past a limit is refused',()=>{
 expect(codes({kind:'step',amplitude:0.2,atTick:5},{mode:'csp',lower:-1,upper:0.6,start:0.5})).toEqual(['JOINT_LIMIT_EXCEEDED']);
 expect(codes({kind:'step',amplitude:-0.2,atTick:5},{mode:'csp',lower:0.4,upper:1,start:0.5})).toEqual(['JOINT_LIMIT_EXCEEDED']);
 expect(codes({kind:'trapezoid',distance:0.2,peakVelocity:0.5,acceleration:2,atTick:0},{mode:'csp',lower:-1,upper:0.6,start:0.5})).toEqual(['JOINT_LIMIT_EXCEEDED']);
});
test('ticks, shape and numbers: out-of-range tick, unknown kind, extra field, NaN',()=>{
 expect(codes({kind:'step',amplitude:2,atTick:BENCH_MAX_TICKS},csv)).toEqual(['TICK_OUT_OF_RANGE']);
 expect(codes({kind:'hold',ticks:BENCH_MAX_TICKS+1},csv)).toEqual(['TICK_OUT_OF_RANGE']);   // one stable code, whatever the kind
 expect(codes({kind:'trapezoid',distance:0.1,peakVelocity:0.5,acceleration:2,atTick:BENCH_MAX_TICKS+1},csp)).toEqual(['TICK_OUT_OF_RANGE']);
 expect(codes({kind:'hold',ticks:500},csv)).toEqual([]);
 expect(codes({kind:'hold',ticks:0},csv).length).toBeGreaterThan(0);
 expect(codes({kind:'sine'},csv).length).toBeGreaterThan(0);
 expect(codes({kind:'step',amplitude:2,atTick:1,extra:1},csv)).toContain('UNKNOWN_FIELD');
 expect(codes({kind:'step',amplitude:NaN,atTick:1},csv)).toContain('NON_FINITE_NUMBER');
 expect(codes(null,csv).length).toBeGreaterThan(0);
});
test('a trapezoid must finish inside the bench and use a registered size',()=>{
 expect(codes({kind:'trapezoid',distance:0.1,peakVelocity:0.5,acceleration:2,atTick:10},csp)).toEqual([]);
 expect(codes({kind:'trapezoid',distance:0.1,peakVelocity:0.001,acceleration:2,atTick:10},csp)).toEqual(['SIGNAL_TOO_LONG']);   // 100 s
 expect(codes({kind:'trapezoid',distance:0.3,peakVelocity:0.5,acceleration:2,atTick:10},csp)).toEqual(['AMPLITUDE_NOT_REGISTERED']);
 expect(codes({kind:'trapezoid',distance:5,peakVelocity:2,acceleration:10,atTick:10},csv)).toEqual([]);          // a wheel profile: peak speed registered
 expect(codes({kind:'trapezoid',distance:5,peakVelocity:3,acceleration:10,atTick:10},csv)).toEqual(['AMPLITUDE_NOT_REGISTERED']);
});

test('benchTarget: step, hold and the trapezoid of a position axis (area = distance)',()=>{
 const step:BenchSignal={kind:'step',amplitude:0.1,atTick:3};
 expect([0,2,3,4,499].map(t=>benchTarget(step,0.5,t))).toEqual([0.5,0.5,0.6,0.6,0.6]);
 expect(benchTarget({kind:'step',amplitude:2,atTick:3},9,4,'csv')).toBe(2);   // a speed target ignores the start
 expect(benchTarget({kind:'hold',ticks:10},0.5,7)).toBe(0.5);expect(benchTarget({kind:'hold',ticks:10},0.5,7,'csv')).toBe(0);
 const trap:BenchSignal={kind:'trapezoid',distance:0.2,peakVelocity:0.5,acceleration:2.5,atTick:4};   // ramps 0.2 s, cruise 0.2 s
 const pos=(t:number)=>benchTarget(trap,1,t),dt=BENCH_TICK_S;
 expect(pos(0)).toBe(1);expect(pos(4)).toBe(1);expect(pos(499)).toBeCloseTo(1.2,12);
 for(let t=4;t<60;t++)expect(pos(t+1)).toBeGreaterThanOrEqual(pos(t));
 // the position is the integral of the velocity profile: the speed between ticks 4+10 and 4+20 is the cruise speed
 expect((pos(24)-pos(14))/(10*dt)).toBeCloseTo(0.5,9);
 expect(pos(4+10)-1).toBeCloseTo(0.5*0.2/2,9);                       // acceleration ramp = v t / 2
});
test('benchTarget of a speed axis: the commanded velocity profile has the area of the distance, also when it never reaches the peak',()=>{
 const area=(s:BenchSignal)=>{let a=0;for(let t=0;t<BENCH_MAX_TICKS;t++)a+=(benchTarget(s,0,t,'csv')+benchTarget(s,0,t+1,'csv'))/2*BENCH_TICK_S;return a;};
 expect(area({kind:'trapezoid',distance:5,peakVelocity:2,acceleration:10,atTick:2})).toBeCloseTo(5,9);
 expect(area({kind:'trapezoid',distance:-5,peakVelocity:2,acceleration:10,atTick:2})).toBeCloseTo(-5,9);
 expect(area({kind:'trapezoid',distance:0.5,peakVelocity:2,acceleration:5,atTick:2})).toBeCloseTo(0.5,2);   // triangular: breakpoints between ticks
 expect(benchTarget({kind:'trapezoid',distance:5,peakVelocity:2,acceleration:10,atTick:2},0,2,'csv')).toBe(0);
});

test('a bench request: wheels only on the wheel scenario, a joint or the gripper only on the arm scenario',()=>{
 expect(validateBenchRequest(req())).toEqual({ok:true,reasonCodes:[]});
 expect(validateBenchRequest(req({scenarioId:'MJ-BENCH-ARM'})).reasonCodes).toEqual(['AXIS_SCENARIO_MISMATCH']);
 expect(validateBenchRequest(req({axis:'J3',signal:{kind:'step',amplitude:0.1,atTick:5}})).reasonCodes).toEqual(['AXIS_SCENARIO_MISMATCH']);
 expect(validateBenchRequest(req({scenarioId:'MJ-BENCH-ARM',axis:'J3',signal:{kind:'step',amplitude:0.1,atTick:5}}),{lower:-1,upper:1,start:0}).ok).toBe(true);
 // a joint or the gripper is checked against the limits the server knows: without them the request is refused, never admitted unchecked
 expect(validateBenchRequest(req({scenarioId:'MJ-BENCH-ARM',axis:'gripper',signal:{kind:'step',amplitude:0.1,atTick:5}})).reasonCodes).toEqual(['AXIS_LIMITS_REQUIRED']);
 expect(validateBenchRequest(req({scenarioId:'MJ-BENCH-ARM',axis:'gripper',signal:{kind:'step',amplitude:0.1,atTick:5}}),{lower:0,upper:0.85,start:0}).ok).toBe(true);
});
test('a bench request: unknown fields, unregistered axis, experiment and signal are refused',()=>{
 expect(validateBenchRequest(req({extra:1})).reasonCodes).toContain('UNKNOWN_FIELD');
 expect(validateBenchRequest(req({axis:'J7'})).reasonCodes.length).toBeGreaterThan(0);
 expect(validateBenchRequest(req({driveExperimentId:'../drive-v1/x'})).reasonCodes.length).toBeGreaterThan(0);
 expect(validateBenchRequest(req({controlProfile:{...profile,extra:1}})).reasonCodes).toContain('UNKNOWN_FIELD');
 expect(validateBenchRequest(req({signal:{kind:'step',amplitude:3,atTick:5}})).reasonCodes).toEqual(['AMPLITUDE_NOT_REGISTERED']);
 expect(validateBenchRequest(req({signal:{kind:'step',amplitude:2,atTick:501}})).reasonCodes).toEqual(['TICK_OUT_OF_RANGE']);
 expect(validateBenchRequest(req({signal:{kind:'hold',ticks:501}})).reasonCodes).toEqual(['TICK_OUT_OF_RANGE']);
 expect(validateBenchRequest(null).ok).toBe(false);
 expect(validateBenchRequest({...req(),scenarioId:'MJ-DEMO'}).ok).toBe(false);
});
test('the schema bounds of the signal ticks are the validator\'s',()=>{
 const schema=JSON.parse(readFileSync('packages/contracts/schemas/bench-request-v1.schema.json','utf8')) as {definitions:{BenchSignal:{oneOf:{properties:Record<string,{maximum?:number}>}[]}}};
 const max=(kind:string,field:string)=>schema.definitions.BenchSignal.oneOf.find(b=>(b.properties.kind as {const?:string}).const===kind)!.properties[field]!.maximum;
 expect([max('step','atTick'),max('trapezoid','atTick'),max('hold','ticks')]).toEqual([BENCH_MAX_TICKS-1,BENCH_MAX_TICKS-1,BENCH_MAX_TICKS]);
 expect(codes({kind:'step',amplitude:2,atTick:BENCH_MAX_TICKS-1},csv)).toEqual([]);
});
