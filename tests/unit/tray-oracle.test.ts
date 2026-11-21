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

const policy={accelerationWindowTicks:3,episodeGapTicks:25,accelerationToleranceBelowMps2:0.3,accelerationToleranceAboveMps2:0.3,onsetLeadTicks:5,onsetLagTicks:15,slipEpsilonM:0.002,slipWindowTicks:0};

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
 const v=slipVerdict(run(300,t=>t>=100&&t<130?2.5:0.5,t=>t<200?0:(t-199)*0.001),['cup-1'],0.15,policy);
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

// MuJoCo's friction is soft: a cup creeps a little even far inside the friction cone. Slip is therefore read over a trailing window, which the creep stays under and a sliding cup does not.
test('windowed slip: a slow drift never reaches epsilon inside the window, a real slide does',()=>{
 const creep=run(300,()=>0.5,t=>t*0.00005);                       // 0.05 mm per tick: 15 mm in all, 1.25 mm per 25 ticks
 expect(slipOnset(creep,'cup-1',0.005)).not.toBeNull();            // read from tick 0 the drift looks like a slip ...
 expect(slipOnset(creep,'cup-1',0.005,25)).toBeNull();             // ... read over 25 ticks it is not
 expect(maxSlipM(creep,'cup-1')).toBeCloseTo(0.01495,5);expect(maxSlipM(creep,'cup-1',25)).toBeCloseTo(0.00125,5);
 const slide=run(300,()=>0.5,t=>t<100?0:(t-99)*0.002);            // 2 mm per tick from tick 100: 50 mm per window
 expect(slipOnset(slide,'cup-1',0.005,25)).toEqual({tick:102});
 expect(maxSlipM(slide,'cup-1',25)).toBeCloseTo(0.05,6);
});

test('windowed slip near the start compares with the first observed tick, and a window of 0 or 1 is the cumulative reading',()=>{
 const r=run(40,()=>0,t=>t*0.001);
 expect(maxSlipM(r,'cup-1',100)).toBeCloseTo(maxSlipM(r,'cup-1'),9);
 expect(maxSlipM(r,'cup-1',0)).toBeCloseTo(maxSlipM(r,'cup-1'),9);
});

test('verdict with a window: the creep of a long slow run is not an unexpected slip, a slide at high acceleration is found',()=>{
 const wp={...policy,slipEpsilonM:0.005,slipWindowTicks:25,onsetLagTicks:40};
 expect(slipVerdict(run(400,()=>0.5,t=>t*0.00005),['cup-1'],0.15,wp).verdict).toBe('no_slip_expected');
 expect(slipVerdict(run(400,t=>t<100?0.5:2.5,t=>t<105?0:(t-104)*0.002),['cup-1'],0.15,wp).verdict).toBe('slip_expected_and_found');
});

// the bound is crossed gradually: a slip may begin anywhere from where the acceleration enters the tolerance band under the bound to a little after it leaves the band above it
const ramp=(t:number)=>t<100?0.5:Math.min(0.5+(t-100)*0.05,2.5);          // 2.5 m/s2 within 40 ticks: bound-tol (1.17) is reached near tick 114, bound+tol (1.77) near tick 125
test('verdict: a slip that begins as the acceleration enters the tolerance band is the Coulomb transition, not an early slip',()=>{
 const v=slipVerdict(run(300,t=>ramp(t),t=>t<116?0:(t-115)*0.002),['cup-1'],0.15,policy);
 expect(v.verdict).toBe('slip_expected_and_found');
});
test('verdict: a slip well before the acceleration came near the bound is early, whatever happens later',()=>{
 const v=slipVerdict(run(300,t=>ramp(t),t=>t<70?0:(t-69)*0.002),['cup-1'],0.15,policy);
 expect(v.verdict).toBe('slip_onset_early');
});

// MuJoCo's friction is soft: a cup begins to creep before the hard Coulomb bound, never after. The tolerance below the bound is therefore its own number, wider than the one above.
test('verdict: a slip with the acceleration inside the (wider) band below the bound is inconclusive, and the same slip with a narrow band is unexpected',()=>{
 const r=run(300,()=>1.13,t=>t<150?0:(t-149)*0.0008);                  // 1.13 m/s2 is 0.34 under the bound 1.47; the cup creeps from tick 150
 const wide={...policy,accelerationToleranceBelowMps2:0.5};
 expect(slipVerdict(r,['cup-1'],0.15,wide).verdict).toBe('inconclusive');
 expect(slipVerdict(r,['cup-1'],0.15,{...policy,accelerationToleranceBelowMps2:0.3}).verdict).toBe('slip_unexpected');
});
test('verdict: the tolerance above the bound is unchanged by the one below',()=>{
 const wide={...policy,accelerationToleranceBelowMps2:0.5};
 expect(slipVerdict(run(200,t=>t<100?0.5:2.5),['cup-1'],0.15,wide).verdict).toBe('slip_expected_absent');
 expect(slipVerdict(run(200,()=>1.6),['cup-1'],0.15,wide).verdict).toBe('inconclusive');         // 1.6 is within 0.3 above the bound
});

// ---- R06: a slip belongs to the acceleration episode it falls in, of the same cup, at the point of the tray under it ----
const twoEpisodes=(slip:(t:number)=>number)=>run(600,t=>t>=100&&t<120?1.3:t>=400&&t<430?2.5:0.3,slip);
test('verdict: a slip that belongs to an earlier, gentler episode does not stand in for the later episode that crossed the bound',()=>{
 // episode 1 (1.3 m/s2) is inside the band and the cup slips there; episode 2 (2.5) crosses the bound and the cup does not move
 const wp={...policy,slipWindowTicks:25,slipEpsilonM:0.005,onsetLagTicks:30};
 const v=slipVerdict(twoEpisodes(t=>t<110?0:Math.min((t-109)*0.002,0.03)),['cup-1'],0.15,wp);
 expect(v.verdict).not.toBe('slip_expected_and_found');expect(['slip_expected_absent','slip_onset_out_of_tolerance']).toContain(v.verdict);
 // the same with a slip in the second episode too: found
 const both=slipVerdict(twoEpisodes(t=>t<110?0:t<400?Math.min((t-109)*0.002,0.03):Math.min(0.03+(t-399)*0.002,0.06)),['cup-1'],0.15,wp);
 expect(both.verdict).toBe('slip_expected_and_found');
});
test('verdict: with several cups each cup is judged in its own episodes',()=>{
 // cup-1 slips in the crossing episode, cup-2 never moves although the same tray accelerates: the bound was crossed for cup-2 and nothing happened
 const wp={...policy,slipWindowTicks:25,slipEpsilonM:0.005,onsetLagTicks:30};
 const base=run(300,t=>t>=100&&t<130?2.5:0.3,t=>t<105?0:Math.min((t-104)*0.002,0.03));
 const rs=base.map(r=>({...r,loads:[...r.loads,{...r.loads[0]!,propId:'cup-2',poseInSupport:{positionM:[0.1,-0.09,0.05],quaternionXyzw:[0,0,0,1]}}]})) as never;
 expect(slipVerdict(rs,['cup-1','cup-2'],0.15,wp).verdict).toBe('slip_expected_absent');
 expect(slipVerdict(rs,['cup-1'],0.15,wp).verdict).toBe('slip_expected_and_found');
});
import {supportPointAccelerationMps2} from '../../packages/lab-runtime/src/v2/simulation3d/tray-oracle';
test('the acceleration of the point of the tray under a cup comes from the cup pose and its pose in the support frame (the tray transform), not from the base alone',()=>{
 // the tray yaws about its own centre while its base origin stays at the map origin: the point under a cup 0.4 m from the base origin accelerates, the base does not
 const recs=Array.from({length:200},(_,t)=>{const a=t*t*0.0004,c=Math.cos(a),s=Math.sin(a),off=[0.4,0],cupMap=[off[0]!*c-off[1]!*s,off[0]!*s+off[1]!*c,0.05];
  return {schemaVersion:1,tick:t,simTimeNs:String(t*20_000_000),contacts:[],base:[{robotId:'amr-1',poseMap:{positionM:[0,0,0.075],quaternionXyzw:[0,0,Math.sin(a/2),Math.cos(a/2)]},rollRad:0,pitchRad:0}],
   loads:[{propId:'cup-1',supportId:'s',poseMap:{positionM:cupMap,quaternionXyzw:[0,0,Math.sin(a/2),Math.cos(a/2)]},poseInSupport:{positionM:[0.4,0,0.05],quaternionXyzw:[0,0,0,1]}}]} as never;});
 const local=supportPointAccelerationMps2(recs as never,'cup-1',100,3),base=supportAccelerationMps2(recs as never,100,3);
 expect(base).toBeCloseTo(0,9);expect(local!).toBeGreaterThan(0.05);
 // yaw a = 0.0004 t^2: omega = 0.0008 t = 0.08 rad/tick-index; at t=100 alpha*r + omega^2 r (per s^2) ~ r*(2*0.0004/0.0004... checked against the analytic centripetal+tangential below
 const dt=0.02,alpha=2*0.0004/(dt*dt),omega=0.0008*100/dt,expected=0.4*Math.hypot(alpha,omega*omega);
 expect(local!).toBeGreaterThan(expected*0.9);expect(local!).toBeLessThan(expected*1.1);
});
