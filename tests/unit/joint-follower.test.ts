import {expect,test} from 'vitest';
import {gripperCtrl,jointTrajectoryFollowerV1} from '../../packages/lab-runtime/src/v2/control/joint-follower';
import type {JointFollowerConfig} from '../../packages/lab-runtime/src/v2/control/joint-follower';
import type {DriveFeedbackV1} from '../../packages/lab-runtime/src/v2/control/drive-io';

const axes=['arm-1/J1','arm-1/J2','arm-1/J3'];
const config:JointFollowerConfig={axes,gripperAxis:'arm-1/gripper',gripperMap:{loRad:0,hiRad:0.85,openingMaxM:0.0889},enableTimeoutTicks:25,followTolRad:0.1,followTicks:10};
type St='disabled'|'enabled'|'fault';
const fb=(state:St|((id:string)=>St),pos:number[]=[0.1,0.2,0.3,0.4])=>[...axes,'arm-1/gripper'].map((axisId,i)=>{const s=typeof state==='string'?state:state(axisId);
 return {axisId,state:s,fault:s==='fault'?'OVERSPEED' as const:null,commandSeq:0,positionRad:pos[i]!,velocityRadS:0,torqueNm:0,tick:0} as DriveFeedbackV1;});
const run=(steps:{setpoint:{positionsRad:number[];openingM:number|null};feedback:DriveFeedbackV1[]}[],cfg=config)=>{
 let s=jointTrajectoryFollowerV1.init(cfg);const out=[];for(const [tick,st] of steps.entries()){const r=jointTrajectoryFollowerV1.step(s,{tick,...st});s=r.state;out.push(r);}return {state:s,out};
};
const sp={positionsRad:[1,1,1],openingM:0.0889};

test('a disabled drive gets an enable request and every target at the measured position',()=>{
 const {out}=run([{setpoint:sp,feedback:fb('disabled')}]);
 expect(out[0]!.commands.map(c=>[c.enable,c.target,c.faultReset,c.mode])).toEqual([[true,0.1,false,'csp'],[true,0.2,false,'csp'],[true,0.3,false,'csp'],[true,0.4,false,'csp']]);
});
test('an enabled drive follows the program: joint targets and the gripper opening mapped onto the drive joint',()=>{
 const {out}=run([{setpoint:{positionsRad:[1,2,3],openingM:0},feedback:fb('enabled')}]);
 expect(out[0]!.commands.map(c=>c.target)).toEqual([1,2,3,0.85]);
 expect(gripperCtrl(config.gripperMap,0.0889)).toBeCloseTo(0,12);expect(gripperCtrl(config.gripperMap,0)).toBeCloseTo(0.85,12);
 const keep=run([{setpoint:{positionsRad:[1,2,3],openingM:0},feedback:fb('enabled')},{setpoint:{positionsRad:[1,2,3],openingM:null},feedback:fb('enabled')}]);
 expect(keep.out[1]!.commands[3]!.target).toBe(0.85);   // no opening in the setpoint keeps the last gripper command
});
test('past enableTimeoutTicks the follower says DRIVE_NOT_READY, once',()=>{
 const {out}=run(Array.from({length:60},()=>({setpoint:sp,feedback:fb('disabled')})));
 expect(out.flatMap((o,i)=>o.events.map(e=>[i,e.code]))).toEqual([[25,'DRIVE_NOT_READY']]);
});
test('with one axis faulted every axis holds, the gripper keeps its last command and nothing resets or opens',()=>{
 const steps=[{setpoint:{positionsRad:[1,1,1],openingM:0},feedback:fb('enabled',[0.9,0.9,0.9,0.8])},
  ...Array.from({length:30},()=>({setpoint:{positionsRad:[0,0,0],openingM:0.0889},feedback:fb(id=>id==='arm-1/J2'?'fault':'enabled',[0.91,0.92,0.93,0.8])}))];
 const {out}=run(steps);
 expect(out.flatMap(o=>o.events).filter(e=>e.code==='DRIVE_FAULT')).toHaveLength(1);
 for(const o of out.slice(1)){
  expect(o.commands.slice(0,3).map(c=>c.target)).toEqual([0.91,0.92,0.93]);          // joints at their last measured position, not at the new setpoint
  expect(o.commands[3]!.target).toBe(0.85);                                          // the gripper still closed on the cup: never towards open
  expect(o.commands.every(c=>!c.faultReset&&!c.quickStop)).toBe(true);
 }
});
test('the gripper target never moves towards open once a fault has begun, whatever the setpoint says',()=>{
 const steps=Array.from({length:10},(_,k)=>({setpoint:{positionsRad:[0,0,0],openingM:k<2?0.04:0.0889},feedback:fb(k<2?'enabled':'fault')}));
 const {out}=run(steps);
 const grip=out.map(o=>o.commands[3]!.target);
 for(let k=2;k<grip.length;k++)expect(grip[k]).toBeGreaterThanOrEqual(grip[1]!);
});
test('a joint that stays more than followTolRad from its command for followTicks is reported once',()=>{
 const steps=Array.from({length:40},()=>({setpoint:{positionsRad:[1,1,1],openingM:0.0889},feedback:fb('enabled',[0.0,1,1,0])}));
 const {out}=run(steps);
 const hits=out.flatMap((o,i)=>o.events.filter(e=>e.code==='ARM_FOLLOWING_ERROR').map(e=>[i,e.axisId]));
 expect(hits).toEqual([[10,'arm-1/J1']]);   // the command of tick 0 is first compared at tick 1; ten ticks over tolerance end at tick 10
});
test('the follower is pure and refuses a setpoint of the wrong shape',()=>{
 const steps=Array.from({length:50},(_,k)=>({setpoint:{positionsRad:[Math.sin(k),1,2],openingM:k%5===0?0.04:null},feedback:fb(k<4?'disabled':'enabled',[k*0.01,0.2,0.3,0.4])}));
 expect(run(steps)).toEqual(run(steps));
 expect(()=>run([{setpoint:{positionsRad:[1],openingM:null},feedback:fb('enabled')}])).toThrow('JOINT_SETPOINT_SHAPE');
});

test('the hold is latched once: a sagging measurement after the fault does not drag the targets of the joints that are still enabled',()=>{
 // review of V05: "target = latest measured position" every tick lets an enabled joint lose its stiffness (J3 16 degrees in 5 s on the engine). The target is the position at the fault, whatever is measured after.
 const steps=[{setpoint:{positionsRad:[1,1,1],openingM:0},feedback:fb('enabled',[0.9,0.9,0.9,0.8])},
  ...Array.from({length:40},(_,k)=>({setpoint:{positionsRad:[0,0,0],openingM:0.0889},feedback:fb(id=>id==='arm-1/J2'?'fault':'enabled',[0.91-0.001*k,0.92-0.001*k,0.93-0.001*k,0.8])}))];
 const {out}=run(steps);
 for(const o of out.slice(1))expect(o.commands.slice(0,3).map(c=>c.target)).toEqual([0.91,0.92,0.93]);
});
test('the latch is taken once while the drive is not enabled, and released when every axis is enabled again',()=>{
 const steps=[{setpoint:sp,feedback:fb('disabled',[0.5,0.5,0.5,0.1])},{setpoint:sp,feedback:fb('disabled',[0.6,0.6,0.6,0.1])},{setpoint:{positionsRad:[1,2,3],openingM:0},feedback:fb('enabled',[0.6,0.6,0.6,0.1])},{setpoint:{positionsRad:[1,2,3],openingM:0},feedback:fb('disabled',[0.7,0.7,0.7,0.1])}];
 const {out}=run(steps);
 expect(out[0]!.commands.slice(0,3).map(c=>c.target)).toEqual([0.5,0.5,0.5]);
 expect(out[1]!.commands.slice(0,3).map(c=>c.target)).toEqual([0.5,0.5,0.5]);          // latched at the first measurement, not the latest
 expect(out[2]!.commands.slice(0,3).map(c=>c.target)).toEqual([1,2,3]);
 expect(out[3]!.commands.slice(0,3).map(c=>c.target)).toEqual([0.7,0.7,0.7]);          // a new latch after the release
});
