import {expect,test} from 'vitest';
import {coulombSlipBoundMps2,slipOnset,maxSlipM,supportAccelerationMps2,firstExceedTick,slipVerdict} from '../../packages/lab-runtime/src/v2/simulation3d/tray-oracle';
import type {PhysicsTickRecord} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

/** A synthetic tray run: the base moves along x with a scripted acceleration, the cup sits at `slip(tick)` in the support frame. */
const run=(ticks:number,accel:(t:number)=>number,slip:(t:number)=>number=()=>0):PhysicsTickRecord[]=>{
 const out:PhysicsTickRecord[]=[];let x=0,v=0;
 for(let t=0;t<ticks;t++){
  out.push({schemaVersion:1,tick:t,simTimeNs:String(t*20_000_000),contacts:[],
   loads:[{propId:'cup-1',supportId:'amr-1/tray-1',poseInSupport:{positionM:[-0.1+slip(t),-0.09,0.05],quaternionXyzw:[0,0,0,1]}}],
   base:[{robotId:'amr-1',poseMap:{positionM:[x,0,0.075],quaternionXyzw:[0,0,0,1]},rollRad:0,pitchRad:0}]} as unknown as PhysicsTickRecord);
  v+=accel(t)*0.02;x+=v*0.02;
 }
 return out;
};
const initial={positionM:[-0.1,-0.09,0.05]};void initial;

test('the slip bound is mu times g',()=>{
 expect(coulombSlipBoundMps2(0.6)).toBeCloseTo(5.886,3);
 expect(coulombSlipBoundMps2(0.15)).toBeCloseTo(1.4715,4);
 expect(()=>coulombSlipBoundMps2(0)).toThrow('FRICTION_INVALID');
 expect(()=>coulombSlipBoundMps2(Number.NaN)).toThrow('FRICTION_INVALID');
 expect(coulombSlipBoundMps2(0.5,1.62)).toBeCloseTo(0.81,6);
});

test('slipOnset is null while the cup stays within epsilon of where it started in the tray frame',()=>{
 const r=run(100,()=>0.5,t=>t>50?0.0004:0);
 expect(slipOnset(r,'cup-1',0.002)).toBeNull();
 expect(maxSlipM(r,'cup-1')).toBeCloseTo(0.0004,9);
});

test('slipOnset is the first tick the planar offset exceeds epsilon, measured from tick 0',()=>{
 const r=run(100,()=>0.5,t=>t<60?0:(t-59)*0.001);
 expect(slipOnset(r,'cup-1',0.0025)).toEqual({tick:62});
 expect(maxSlipM(r,'cup-1')).toBeCloseTo(0.040,9);
});

test('slipOnset ignores a tick with no support pose and refuses an unknown prop',()=>{
 const r=run(10,()=>0);(r[3]!.loads[0] as unknown as {poseInSupport:null}).poseInSupport=null;
 expect(slipOnset(r,'cup-1',0.001)).toBeNull();
 expect(()=>slipOnset(r,'cup-9',0.001)).toThrow('PROP_UNKNOWN');
 expect(()=>slipOnset([],'cup-1',0.001)).toThrow('RECORDS_EMPTY');
});

test('support acceleration is the second difference of the base position over +-window ticks',()=>{
 const r=run(200,t=>t<100?1.5:0);
 expect(supportAccelerationMps2(r,50,3)).toBeCloseTo(1.5,2);
 expect(supportAccelerationMps2(r,150,3)).toBeCloseTo(0,6);
 expect(supportAccelerationMps2(r,1,3)).toBeNull();
 expect(supportAccelerationMps2(r,199,3)).toBeNull();
});

test('firstExceedTick finds the first tick whose acceleration is above bound + tolerance',()=>{
 const r=run(200,t=>t<100?0.5:2.5);
 expect(firstExceedTick(r,1.4715,0.1,3)).toBeGreaterThanOrEqual(97);
 expect(firstExceedTick(r,1.4715,0.1,3)).toBeLessThanOrEqual(103);
 expect(firstExceedTick(run(200,()=>0.5),1.4715,0.1,3)).toBeNull();
});

const policy={accelerationWindowTicks:3,accelerationToleranceMps2:0.3,onsetLeadTicks:5,onsetLagTicks:15,slipEpsilonM:0.002};

test('verdict: acceleration above the bound with a slip near the crossing is slip_expected_and_found',()=>{
 const r=run(200,t=>t<100?0.5:2.5,t=>t<105?0:(t-104)*0.0011);
 const v=slipVerdict(r,['cup-1'],0.15,policy);
 expect(v.verdict).toBe('slip_expected_and_found');
 expect(v.boundMps2).toBeCloseTo(1.4715,4);expect(v.maxAccelerationMps2).toBeGreaterThan(2.3);expect(v.onset?.tick).toBe(106);
});

test('verdict: acceleration above the bound but no slip is a failure, not a pass',()=>{
 const v=slipVerdict(run(200,t=>t<100?0.5:2.5),['cup-1'],0.15,policy);
 expect(v.verdict).toBe('slip_expected_absent');
});

test('verdict: a slip long before the support ever exceeded the bound is a failure',()=>{
 const v=slipVerdict(run(200,()=>0.5,t=>t<20?0:(t-19)*0.001),['cup-1'],0.15,policy);
 expect(v.verdict).toBe('slip_unexpected');
});

test('verdict: a slip far from the crossing tick is out of tolerance',()=>{
 const v=slipVerdict(run(300,t=>t<100?0.5:2.5,t=>t<200?0:(t-199)*0.001),['cup-1'],0.15,policy);
 expect(v.verdict).toBe('slip_onset_out_of_tolerance');
});

test('verdict: never reaching the bound is no_slip_expected and records the largest acceleration',()=>{
 const v=slipVerdict(run(200,()=>0.5),['cup-1'],0.15,policy);
 expect(v).toMatchObject({verdict:'no_slip_expected',onset:null});expect(v.maxAccelerationMps2).toBeCloseTo(0.5,1);
});

test('verdict: inside the tolerance band around the bound proves neither way',()=>{
 const v=slipVerdict(run(200,()=>1.5),['cup-1'],0.15,policy);
 expect(v.verdict).toBe('inconclusive');
});

test('verdict: an unmeasurable run (too short for the window) is inconclusive, never a pass',()=>{
 expect(slipVerdict(run(5,()=>2),['cup-1'],0.15,policy).verdict).toBe('inconclusive');
});
