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
test('a deviation smaller than what the encoder can resolve is not a tracking problem; a larger one still is (review of V05: the coarse encoder, 2.45 rad/s per count)',()=>{
 const slow=(c:DiffDriveBaseConfig,v:number)=>run(c,Array.from({length:60},()=>({setpoint:{vMps:v,omegaRadps:0},feedback:fb('enabled',{velocityRadS:0})}))).out.flatMap(o=>o.events.filter(e=>e.code==='TRACKING_DEGRADED'));
 const coarse={...config,velocityResolutionRadS:2.45};
 expect(slow(config,0.18)).toHaveLength(1);                       // 2 rad/s of error, an exact encoder: reported
 expect(slow(coarse,0.18)).toEqual([]);                           // the same 2 rad/s is under one count of this encoder: not reported
 expect(slow(coarse,0.36)).toHaveLength(1);                       // 4 rad/s of error is not quantisation
});
test('a stop input takes the wheels to zero in one tick, not down the acceleration ramp; without it the ramp stays',()=>{
 const run2=(stop:boolean)=>run({...config,maxWheelAccelRadS2:10},[...Array.from({length:30},()=>({setpoint:{vMps:0.18,omegaRadps:0},feedback:fb('enabled')})),{setpoint:{vMps:0,omegaRadps:0,...stop?{stop:true}:{}},feedback:fb('enabled')}]).out.at(-1)!.commands.map(c=>c.target);
 expect(run2(true)).toEqual([0,0]);expect(run2(false)[0]).toBeGreaterThan(0);
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

import {mobileDrive} from '../../packages/lab-runtime/src/v2/control/drive-run';
import {mobileDriveBundle} from '../../packages/lab-runtime/src/v2/control/drive-experiments';
import type {DriveAxisSnapshot} from '../../packages/lab-runtime/src/v2/control/drive-io';
const workerRoot='robotics/simulation-mujoco';
const wheels={robotId:'amr-1',wheelRadiusM:0.09,wheelSeparationM:0.36,maxLinearMps:.6,maxAngularRadps:1.2};
test('nominal emitted wheel commands respect acceleration and jerk through arrival, small steps, reversal, slowdown and stop release',async()=>{
 const docs=await mobileDriveBundle(workerRoot,'drive-nominal-v1'),drive=mobileDrive(docs,wheels);
 let tick=0,vel=[0,0],acc=[0,0];
 for(const [v,w,n,stop] of [[.5,0,70,0],[.503,0,20,0],[-.4,.2,80,0],[.6,0,18,0],[.01,0,50,0],[0,0,1,1],[.6,1.2,75,0]]){
  for(let i=0;i<n!;i++){
   const r=drive.step(tick++,{vMps:v!,omegaRadps:w!,stop:!!stop},{drives:fb('enabled') as DriveAxisSnapshot[]});
   const speeds=r.commands.map(c=>c.target*wheels.wheelRadiusM);
   expect(Math.abs((speeds[0]!+speeds[1]!)/2)).toBeLessThanOrEqual(.6+1e-12);
   expect(Math.abs((speeds[1]!-speeds[0]!)/wheels.wheelSeparationM)).toBeLessThanOrEqual(1.2+1e-12);
   const next=speeds.map((x,j)=>(x-vel[j]!)/.02);
   if(stop){expect(speeds).toEqual([0,0]);acc=[0,0];}
   else{for(const [j,a] of next.entries()){expect(Math.abs(a)).toBeLessThanOrEqual(1+1e-12);expect(Math.abs((a-acc[j]!)/.02)).toBeLessThanOrEqual(10+1e-10);}acc=next;}
   vel=speeds;
  }
  if(n!>=20){expect(vel[0]).toBeCloseTo(v!-w!*.18,12);expect(vel[1]).toBeCloseTo(v!+w!*.18,12);}
 }
});
test('the four device comparisons select revision two and ideal explicitly selects legacy compatibility',async()=>{
 const nominal=await mobileDriveBundle(workerRoot,'drive-nominal-v1');
 expect(nominal.control.controllers[0]?.revision).toBe(2);
 for(const id of ['drive-latency-v1','drive-torque-limited-v1','drive-coarse-encoder-v1'])expect((await mobileDriveBundle(workerRoot,id)).control.digest).toBe(nominal.control.digest);
 const ideal=await mobileDriveBundle(workerRoot,'drive-ideal-v1');
 expect(ideal.control.id).toContain('legacy');expect(ideal.control.controllers[0]?.params).not.toHaveProperty('maxJerkMps3');
});

test('revision two refuses a zero-duration sample and resets the ramp on a drive fault',async()=>{
 const {jerkStep}=await import('../../packages/lab-runtime/src/v2/control/diff-drive-base');
 expect(()=>jerkStep(10,0)).toThrow('DRIVE_CONTROLLER_LIMIT_INVALID');
 const drive=mobileDrive(await mobileDriveBundle(workerRoot,'drive-nominal-v1'),wheels);
 const step=(tick:number,status:'fault'|'enabled')=>drive.step(tick,{vMps:.4,omegaRadps:0},{drives:fb(status) as DriveAxisSnapshot[]});
 for(let i=0;i<50;i++)step(i,'enabled');
 const fault=step(50,'fault');expect(fault.commands.map(c=>c.target)).toEqual([0,0]);expect(fault.events[0]?.code).toBe('DRIVE_FAULT');
 expect(step(51,'enabled').commands.every(c=>c.target*wheels.wheelRadiusM<=10*.02**2+1e-12)).toBe(true);
});
test('already feasible navigation commands reach the wire on the requested tick',async()=>{
 const drive=mobileDrive(await mobileDriveBundle(workerRoot,'drive-nominal-v1'),wheels);
 for(const [tick,wheelSpeed] of [0,.002,.006,.008,.008,.007].entries()){
  const r=drive.step(tick,{vMps:wheelSpeed,omegaRadps:0},{drives:fb('enabled') as DriveAxisSnapshot[]});
  // Every requested increment itself admits braking to a steady target within its last interval.
  expect(r.commands[0]!.target*wheels.wheelRadiusM).toBeCloseTo(wheelSpeed,13);
 }
});
