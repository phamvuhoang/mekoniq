import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {createMockDrive} from '../../packages/lab-runtime/src/v2/control/mock-drive';
import type {ControlProfileV1,DriveCommandV1,DriveModelV1} from '../../packages/lab-runtime/src/v2/control/drive-io';

const FX='robotics/simulation-mujoco/fixtures/drive-v1/';
const read=<T,>(f:string)=>JSON.parse(readFileSync(FX+f,'utf8')) as T;
const control=read<ControlProfileV1>('serve-control-v1.json');
const model=(f='nominal')=>read<DriveModelV1>(`serve-drive-${f}-v1.json`);
const cmd=(axisId:string,seq:number,over:Partial<DriveCommandV1>={}):DriveCommandV1=>({axisId,seq,mode:'csv',target:0,enable:true,quickStop:false,faultReset:false,...over});
const both=(seq:number,over:Partial<DriveCommandV1>={})=>[cmd('amr-1/wheel-left',seq,over),cmd('amr-1/wheel-right',seq,over)];
const left=(snaps:ReturnType<ReturnType<typeof createMockDrive>['step']>)=>snaps.find(s=>s.axisId==='amr-1/wheel-left')!;

test('the identity says protocol_double and binds both documents',()=>{
 const m=model();
 expect(createMockDrive(m,control).identity).toEqual({testLevel:'protocol_double',driveModelDigest:m.digest,controlProfileDigest:control.digest});
});
test('a drive boots disabled and goes disabled -> ready -> enabled over the enable delay',()=>{
 const d=createMockDrive(model(),control);  // enableDelaySubsteps 25 = 3 ticks of 10 substeps
 expect(left(d.step(both(1))).state).toBe('ready');
 expect(left(d.step(both(2))).state).toBe('ready');
 expect(left(d.step(both(3))).state).toBe('enabled');
 expect(left(createMockDrive(model('ideal'),control).step(both(1))).state).toBe('enabled'); // no enable sequence at all
});
test('a command to an axis that is not enabled is acknowledged and dropped',()=>{
 const d=createMockDrive(model(),control);
 const s=left(d.step(both(1,{target:2})));
 expect(s).toMatchObject({state:'ready',commandSeq:1,targetApplied:0,actualVelocityRadS:0,actualPositionRad:0});
 d.step(both(2,{target:2}));
 expect(left(d.step(both(3,{target:2}))).targetApplied).toBe(2); // applied only once the axis is enabled
 expect(left(d.step(both(4,{enable:false,target:2}))).state).toBe('disabled');
 expect(left(d.step(both(5,{enable:false,target:3}))).targetApplied).toBe(2); // dropped again
});
test('the watchdog counts steps without a new seq and latches COMMAND_TIMEOUT; only a rising faultReset clears it',()=>{
 const d=createMockDrive(model(),control);  // watchdogTicks 5
 for(let k=1;k<=3;k++)d.step(both(k,{target:1}));
 for(let k=0;k<4;k++)expect(left(d.step(both(3,{target:1}))).state).toBe('enabled'); // 4 quiet steps
 const tripped=left(d.step(both(3,{target:1})));  // the 5th
 expect(tripped).toMatchObject({state:'fault',fault:'COMMAND_TIMEOUT',actualVelocityRadS:0});
 expect(left(d.step(both(4,{faultReset:false}))).state).toBe('fault');
 expect(left(d.step(both(5,{faultReset:true}))).state).toBe('disabled');   // rising edge with a new command: cleared
 d.step(both(6,{enable:false,faultReset:true}));
 expect(left(d.step(both(7,{enable:true,faultReset:true}))).state).not.toBe('fault'); // held faultReset is not a new edge, and there is no fault to clear
});
test('holding faultReset=1 does not clear a later fault',()=>{
 const d=createMockDrive(model(),control);
 d.step(both(1,{faultReset:true}));d.step(both(2,{faultReset:true}));d.step(both(3,{faultReset:true}));
 for(let k=0;k<5;k++)d.step(both(3,{faultReset:true}));
 expect(left(d.step(both(4,{faultReset:true}))).state).toBe('fault');  // a held 1 is no rising edge
});
test('a steady stream of new seqs never trips the watchdog, however long it runs',()=>{
 const d=createMockDrive(model(),control);
 let s=left(d.step(both(1)));
 for(let k=2;k<200;k++)s=left(d.step(both(k)));
 expect(s.state).toBe('enabled');
});
test('quick stop brings the axis to rest and then disables it',()=>{
 const d=createMockDrive(model(),control);  // quickStopSubsteps 100 = 10 ticks
 for(let k=1;k<=3;k++)d.step(both(k,{target:1}));
 let s=left(d.step(both(4,{target:1,quickStop:true})));
 expect(s).toMatchObject({state:'quick_stop',actualVelocityRadS:0});
 for(let k=5;k<13;k++)s=left(d.step(both(k,{quickStop:true})));
 expect(s.state).toBe('quick_stop');
 expect(left(d.step(both(13,{quickStop:true}))).state).toBe('disabled');
 expect(left(d.step(both(14,{quickStop:true}))).state).toBe('disabled'); // enable is inhibited while quickStop is asserted
});
test('a velocity axis integrates its commanded speed; the position feedback is quantised, the true position is not',()=>{
 const d=createMockDrive(model(),control);
 for(let k=1;k<=3;k++)d.step(both(k,{target:1}));
 const s=left(d.step(both(4,{target:1})));
 expect(s.actualVelocityRadS).toBeCloseTo(1,12);
 const q=2*Math.PI/4096;
 expect(s.positionRad!/q).toBeCloseTo(Math.round(s.positionRad!/q),9);
 expect(s.positionRad).not.toBe(s.actualPositionRad);
 expect(s.torqueNm).toBeNull(); // a double has no torque: never a made-up 0
});
test('commands are admitted whole or not at all: unknown axis, mode, range, seq, missing axis',()=>{
 const d=createMockDrive(model(),control);
 d.step(both(5,{target:1}));
 const before=JSON.stringify(left(d.step(both(6,{target:1}))));
 const refused=(c:DriveCommandV1[])=>{try{d.step(c);return 'accepted';}catch(e){return (e as Error).message.split(':')[0];}};
 expect(refused([...both(7),cmd('amr-1/ghost',1)])).toBe('DRIVE_AXIS_UNKNOWN');
 expect(refused(both(7,{mode:'csp'}))).toBe('DRIVE_MODE_MISMATCH');
 expect(refused(both(7,{target:100}))).toBe('DRIVE_TARGET_OUT_OF_RANGE');
 expect(refused(both(7,{target:Number.NaN}))).toBe('DRIVE_TARGET_OUT_OF_RANGE');
 expect(refused(both(2))).toBe('DRIVE_COMMAND_SEQ_INVALID');
 expect(refused([cmd('amr-1/wheel-left',7)])).toBe('DRIVE_COMMAND_REQUIRED');
 expect(refused([...both(7),cmd('amr-1/wheel-left',7)])).toBe('DRIVE_COMMAND_SEQ_INVALID');
 // none of the refusals changed anything: the next tick is the tick after the one above
 expect(left(d.step(both(7,{target:1}))).tick).toBe(2);
 expect(before).toContain('"tick":1');
});
test('a position axis follows its target at the velocity limit',()=>{
 const arm=read<DriveModelV1>('xarm6-drive-ideal-v1.json'),profile=read<ControlProfileV1>('xarm6-control-v1.json');
 const d=createMockDrive(arm,profile);
 const all=(seq:number,target:number)=>arm.axes.map(a=>cmd(a.axisId,seq,{mode:'csp',target}));
 const s=d.step(all(1,10)).find(x=>x.axisId==='xarm-1/J1')!;
 expect(s.actualPositionRad).toBeCloseTo(3.14*0.02,12); // 3.14 rad/s over one 20 ms tick
 expect(s.followingErrorRad).toBeNull(); // the ideal model has no following-error monitor
});
