import {expect,test} from 'vitest';
import {speedDeficit,trackingRms,type DriveRecord} from '../../packages/lab-runtime/src/v2/control/drive-metrics';
import type {DriveAxisSnapshot} from '../../packages/lab-runtime/src/v2/control/drive-io';

const snap=(axisId:string,tick:number,o:Partial<DriveAxisSnapshot>={}):DriveAxisSnapshot=>({axisId,state:'enabled',fault:null,commandSeq:tick,positionRad:0,velocityRadS:0,torqueNm:0,tick,targetApplied:0,actualPositionRad:0,actualVelocityRadS:0,saturatedSubsteps:0,followingErrorRad:null,...o});
const rec=(n:number,f:(t:number)=>Partial<DriveAxisSnapshot>,axisId='w'):DriveRecord[]=>Array.from({length:n},(_,t)=>({tick:t,drives:[snap(axisId,t,f(t)),snap('other',t)]}));

test('trackingRms of a constant error is that error; of a sine is its amplitude over root two (analytic vectors)',()=>{
 const m=trackingRms(rec(100,()=>({targetApplied:1,actualPositionRad:0.9})),'w',{fromTick:10,toTick:59});
 expect(m).toMatchObject({available:true,unit:'rad',samples:50,basis:'actual'});expect((m as {value:number}).value).toBeCloseTo(0.1,12);
 const sine=trackingRms(rec(1000,t=>({actualPositionRad:0.2*Math.sin(2*Math.PI*t/100)})),'w',{fromTick:0,toTick:999});
 expect((sine as {value:number}).value).toBeCloseTo(0.2/Math.SQRT2,6);
 const v=trackingRms(rec(10,()=>({targetApplied:2,actualVelocityRadS:1})),'w',{fromTick:0,toTick:9},'csv');
 expect(v).toMatchObject({available:true,unit:'rad/s'});expect((v as {value:number}).value).toBe(1);
});
test('trackingRms over a window with a missing tick or axis is TRACE_GAP, never a number from the rest',()=>{
 const r=rec(100,()=>({targetApplied:1}));
 expect(trackingRms(r.filter(x=>x.tick!==30),'w',{fromTick:10,toTick:59})).toEqual({available:false,value:null,unit:'rad',reason:'TRACE_GAP'});
 expect(trackingRms(r,'ghost',{fromTick:0,toTick:9})).toMatchObject({available:false,reason:'TRACE_GAP'});
 expect(trackingRms(r,'w',{fromTick:50,toTick:150})).toMatchObject({available:false,reason:'TRACE_GAP'});   // beyond the records
 expect(trackingRms(r,'w',{fromTick:9,toTick:3})).toMatchObject({available:false,reason:'WINDOW_INVALID'});
 expect(trackingRms(rec(3,()=>({targetApplied:Number.NaN})),'w',{fromTick:0,toTick:2})).toMatchObject({available:false,reason:'TRACE_GAP'});
});
test('speedDeficit is the mean of |r| - |y| over the second half of each constant command, and ignores rest',()=>{
 // 20 ticks ramping 0..1.9, then 100 ticks at command 2 reaching 1.5, then 30 ticks at rest
 const r=rec(150,t=>t<20?{targetApplied:t*0.1,actualVelocityRadS:t*0.1}:t<120?{targetApplied:2,actualVelocityRadS:t<70?1:1.5}:{targetApplied:0,actualVelocityRadS:0});
 const m=speedDeficit(r,'w',{minCruiseTicks:50});
 expect(m).toMatchObject({available:true,unit:'rad/s',samples:50,basis:'actual'});expect((m as {value:number}).value).toBeCloseTo(0.5,12);
 const neg=speedDeficit(rec(100,()=>({targetApplied:-2,actualVelocityRadS:-1.5})),'w',{minCruiseTicks:20});
 expect((neg as {value:number}).value).toBeCloseTo(0.5,12);   // magnitudes: a reverse run is measured the same way
});
test('speedDeficit without a long enough constant command is NO_CRUISE_WINDOW',()=>{
 expect(speedDeficit(rec(100,t=>({targetApplied:t*0.01,actualVelocityRadS:t*0.01})),'w',{minCruiseTicks:10})).toMatchObject({available:false,reason:'NO_CRUISE_WINDOW'});
 expect(speedDeficit(rec(100,()=>({targetApplied:0})),'w',{minCruiseTicks:10})).toMatchObject({available:false,reason:'NO_CRUISE_WINDOW'});   // standing still is not a cruise
 expect(speedDeficit(rec(100,()=>({targetApplied:2})).filter(x=>x.tick!==40),'w',{minCruiseTicks:10})).toMatchObject({available:false,reason:'TRACE_GAP'});
 expect(speedDeficit(rec(10,()=>({targetApplied:2})),'w',{minCruiseTicks:1})).toMatchObject({available:false,reason:'POLICY_INVALID'});
});
