import {expect,test} from 'vitest';
import {diffDriveBaseV1} from '../../packages/lab-runtime/src/v2/control/diff-drive-base';
import type {DiffDriveBaseConfig} from '../../packages/lab-runtime/src/v2/control/diff-drive-base';
import type {DriveFeedbackV1} from '../../packages/lab-runtime/src/v2/control/drive-io';

const config:DiffDriveBaseConfig={axisLeft:'amr-1/wheel-left',axisRight:'amr-1/wheel-right',wheelRadiusM:0.09,wheelSeparationM:0.36,maxWheelAccelRadS2:1000,enableTimeoutTicks:25,trackingDegradedRadS:1,trackingDegradedTicks:25};
const fb=(state:'disabled'|'enabled'|'fault',over:Partial<DriveFeedbackV1>={})=>(['amr-1/wheel-left','amr-1/wheel-right'] as const).map(axisId=>
 ({axisId,state,fault:state==='fault'?'EXTERNAL_TRIP' as const:null,commandSeq:0,positionRad:0,velocityRadS:0,torqueNm:0,tick:0,...over}) as DriveFeedbackV1);
const run=(cfg:DiffDriveBaseConfig,steps:{setpoint:{vMps:number;omegaRadps:number};feedback:DriveFeedbackV1[]}[])=>{
 let s=diffDriveBaseV1.init(cfg);const out=[];
 for(const [tick,st] of steps.entries()){const r=diffDriveBaseV1.step(s,{tick,...st});s=r.state;out.push(r);}
 return {state:s,out};
};

test('a disabled drive gets an enable request and no motion target',()=>{
 const out=diffDriveBaseV1.step(diffDriveBaseV1.init(config),{tick:0,setpoint:{vMps:0.5,omegaRadps:0},feedback:fb('disabled')});
 expect(out.commands.map(c=>[c.enable,c.target,c.faultReset])).toEqual([[true,0,false],[true,0,false]]);
});
test('positive yaw turns the left wheel backwards',()=>{
 const out=diffDriveBaseV1.step(diffDriveBaseV1.init(config),{tick:0,setpoint:{vMps:0,omegaRadps:1},feedback:fb('enabled')});
 expect(out.commands.map(c=>c.target)).toEqual([-2,2]);
 expect(out.commands.every(c=>c.mode==='csv'&&c.seq===1)).toBe(true);
});
test('a faulted axis stops both wheels and is never reset by the controller',()=>{
 const out=diffDriveBaseV1.step(diffDriveBaseV1.init(config),{tick:9,setpoint:{vMps:0.5,omegaRadps:0},feedback:fb('fault')});
 expect(out.commands.every(c=>c.target===0&&!c.faultReset)).toBe(true);
 expect(out.events.map(e=>e.code)).toContain('DRIVE_FAULT');
});
test('a fault is reported once, and held for as long as it lasts, with no faultReset in any command',()=>{
 const {out}=run(config,Array.from({length:40},()=>({setpoint:{vMps:0.5,omegaRadps:0},feedback:fb('fault')})));
 expect(out.flatMap(o=>o.events).filter(e=>e.code==='DRIVE_FAULT')).toHaveLength(1);
 expect(out.every(o=>o.commands.every(c=>c.target===0&&!c.faultReset&&!c.quickStop))).toBe(true);
});
test('past enableTimeoutTicks without an enabled drive the controller says DRIVE_NOT_READY, once, and keeps asking to enable',()=>{
 const {out}=run(config,Array.from({length:60},()=>({setpoint:{vMps:0.5,omegaRadps:0},feedback:fb('disabled')})));
 const at=out.flatMap((o,i)=>o.events.map(e=>[i,e.code]));
 expect(at).toEqual([[25,'DRIVE_NOT_READY']]);   // the 26th tick: more than 25 ticks waited
 expect(out.every(o=>o.commands.every(c=>c.enable&&c.target===0))).toBe(true);
});
test('the wheel command step is limited by maxWheelAccelRadS2 x 0.02 s',()=>{
 const {out}=run({...config,maxWheelAccelRadS2:10},Array.from({length:4},()=>({setpoint:{vMps:0.18,omegaRadps:0},feedback:fb('enabled')})));
 expect(out.map(o=>o.commands[0]!.target.toFixed(6))).toEqual(['0.200000','0.400000','0.600000','0.800000']);  // 10 rad/s^2 x 0.02 s = 0.2 rad/s per tick, towards 2
 expect(out[0]!.commands[0]!.target).toBe(out[0]!.commands[1]!.target);
});
test('a wheel that does not follow its command for trackingDegradedTicks is reported once',()=>{
 const {out}=run(config,Array.from({length:60},()=>({setpoint:{vMps:0.18,omegaRadps:0},feedback:fb('enabled',{velocityRadS:0})})));
 const hits=out.flatMap((o,i)=>o.events.filter(e=>e.code==='TRACKING_DEGRADED').map(()=>i));
 expect(hits).toEqual([24]);   // the window of 25 error samples is full at the 25th tick
});
test('a wheel that follows its command is never reported',()=>{
 let measured=0;const steps=Array.from({length:200},()=>({setpoint:{vMps:0.18,omegaRadps:0},get feedback(){return fb('enabled',{velocityRadS:measured});}}));
 let s=diffDriveBaseV1.init(config);const events=[];
 for(const [tick,st] of steps.entries()){const r=diffDriveBaseV1.step(s,{tick,setpoint:st.setpoint,feedback:st.feedback});s=r.state;measured=r.commands[0]!.target;events.push(...r.events);}
 expect(events).toEqual([]);
});
test('a quantised encoder at rest, 1024 counts, 500 ticks: no TRACKING_DEGRADED and the odometry never leaves one count',()=>{
 const q=2*Math.PI/1024,vres=q/0.01;  // the drive's velocity window is 5 substeps: one flipped count reads as q / 10 ms
 const steps=Array.from({length:500},(_,k)=>{const flip=k%7===3?1:0;return {setpoint:{vMps:0,omegaRadps:0},feedback:fb('enabled',{positionRad:flip*q,velocityRadS:k%7===3?vres:k%7===4?-vres:0})};});
 const {out,state}=run(config,steps);
 expect(out.flatMap(o=>o.events)).toEqual([]);
 expect(Math.max(...out.map(o=>Math.abs(o.state.odometry[0])))).toBeLessThanOrEqual(config.wheelRadiusM*q+1e-12);
 expect(state.odometry.map(Math.abs).every(x=>x<1e-9)).toBe(true);  // every excursion went back: no drift
});
test('odometry follows the measured wheel angle with the worker\'s arc formula',()=>{
 const steps=Array.from({length:101},(_,k)=>({setpoint:{vMps:0,omegaRadps:0},feedback:fb('enabled',{positionRad:k*0.1})}));
 const {state}=run(config,steps);
 expect(state.odometry[0]).toBeCloseTo(0.09*10,12);expect(state.odometry[1]).toBeCloseTo(0,12);expect(state.odometry[2]).toBeCloseTo(0,12);
 const turn=run(config,Array.from({length:11},(_,k)=>({setpoint:{vMps:0,omegaRadps:0},feedback:[{...fb('enabled')[0]!,positionRad:-k*0.1},{...fb('enabled')[1]!,positionRad:k*0.1}]})));
 expect(turn.state.odometry[2]).toBeCloseTo(2*0.09*1/0.36,12);expect(Math.hypot(turn.state.odometry[0],turn.state.odometry[1])).toBeLessThan(1e-12);
});
test('the controller is pure: the same feedback gives the same commands and events on two runs',()=>{
 const steps=Array.from({length:80},(_,k)=>({setpoint:{vMps:0.3*Math.sin(k/9),omegaRadps:0.2},feedback:fb(k<5?'disabled':k<60?'enabled':'fault',{positionRad:k*0.01,velocityRadS:k%3})}));
 expect(run(config,steps)).toEqual(run(config,steps));
});
test('feedback that lacks a wheel is refused, not guessed',()=>{
 expect(()=>diffDriveBaseV1.step(diffDriveBaseV1.init(config),{tick:0,setpoint:{vMps:0,omegaRadps:0},feedback:fb('enabled').slice(1)})).toThrow('DRIVE_FEEDBACK_AXIS_MISSING');
});
