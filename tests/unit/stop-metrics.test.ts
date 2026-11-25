import {describe,expect,test} from 'vitest';
import {stopMetrics} from '../../packages/lab-runtime/src/v2/control/stop-metrics';
import {AXES,POLICY,decel,records} from '../support/stop-records';

const metrics=(r:ReturnType<typeof records>,fn:'normal'|'protective'|'emergency'='normal',applied=100)=>stopMetrics({appliedTick:applied,function:fn,records:r,policy:POLICY,chainAxes:AXES,wheelRadiusM:0.1});

describe('against an analytic reference',()=>{
 test('0.8 m/s with a uniform deceleration of 0.5 m/s2 from tick 100: 1600 ms and 0.64 m, within a tick',()=>{
  const m=metrics(records({ticks:400,speed:decel}));
  expect(Math.abs((m.stopTimeMs as number)-1600)).toBeLessThanOrEqual(20);expect(m.stopDistanceM as number).toBeCloseTo(0.64,1);expect(Math.abs((m.stopDistanceM as number)-0.64)).toBeLessThan(0.8*0.02);
  expect(m.peakDecelerationMps2 as number).toBeCloseTo(0.5,6);
 });
 test('a body that never gets below the rest speed has no stop time and no distance, and says why',()=>{
  const m=metrics(records({ticks:700,speed:t=>t<=100?0.8:0.3}));
  expect(m.stopTimeMs).toEqual({unavailable:'NOT_AT_REST'});expect(m.stopDistanceM).toEqual({unavailable:'NOT_AT_REST'});expect(m.postStopDriftMm).toEqual({unavailable:'NOT_AT_REST'});
  expect(typeof m.peakDecelerationMps2).toBe('number');                                      // the deceleration is still read over the observed window
 });
 test('fewer samples than the deceleration window is TOO_FEW_SAMPLES',()=>{
  expect(metrics(records({ticks:102,speed:decel})).peakDecelerationMps2).toEqual({unavailable:'TOO_FEW_SAMPLES'});
 });
 test('drift after rest: the run ending before the drift window is RUN_ENDED, a body that creeps is measured',()=>{
  expect(metrics(records({ticks:230,speed:decel})).postStopDriftMm).toEqual({unavailable:'RUN_ENDED'});
  expect(metrics(records({ticks:400,speed:t=>decel(t)+(t>180?0.005:0)})).postStopDriftMm as number).toBeGreaterThan(0);
 });
});

describe('torque, cups and wheels',()=>{
 const emergency=records({ticks:400,speed:t=>t<=100?0.8:Math.max(0,0.8-0.02*(t-100)),torque:t=>t<100?3:0});
 test('torque zero tick exists for an emergency stop only',()=>{
  expect(metrics(emergency,'emergency').torqueZeroTick).toBe(100);expect(metrics(emergency,'normal').torqueZeroTick).toEqual({unavailable:'NOT_APPLICABLE'});expect(metrics(emergency,'protective').torqueZeroTick).toEqual({unavailable:'NOT_APPLICABLE'});
 });
 test('without a drive stream the torque is STREAM_MISSING',()=>{expect(metrics(records({ticks:400,speed:decel,drives:false}),'emergency').torqueZeroTick).toEqual({unavailable:'STREAM_MISSING'});});
 test('no cups means NOT_APPLICABLE, never zero',()=>{const m=metrics(records({ticks:400,speed:decel}));expect(m.cupMaxSlipMm).toEqual({unavailable:'NOT_APPLICABLE'});expect(m.cupTipped).toEqual({unavailable:'NOT_APPLICABLE'});});
 test('cup slip is the largest displacement in the tray frame inside the stop window, in millimetres; a tilted cup is tipped',()=>{
  const m=metrics(records({ticks:400,speed:decel,cups:t=>({slipM:t<100?0.02:0.02+Math.min(0.004,(t-100)*0.0001),tilted:false})}));
  expect(m.cupMaxSlipMm as number).toBeCloseTo(4,3);expect(m.cupTipped).toBe(false);
  expect(metrics(records({ticks:400,speed:decel,cups:()=>({slipM:0,tilted:true})})).cupTipped).toBe(true);
 });
 test('wheel slip: the rim speed against the body speed',()=>{
  expect(metrics(records({ticks:400,speed:decel,wheels:true})).wheelSlip).toBe(false);
  const r=records({ticks:400,speed:decel,wheels:true});for(const x of r)if(x.tick>=120&&x.tick<125)(x.wheels![0] as {velocityRadS:number[]}).velocityRadS=[0,0];
  expect(metrics(r).wheelSlip).toBe(true);
  expect(metrics(records({ticks:400,speed:decel})).wheelSlip).toEqual({unavailable:'STREAM_MISSING'});
 });
});
