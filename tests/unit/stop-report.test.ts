import {describe,expect,test} from 'vitest';
import {buildStopReport,stopReportDigest,validateStopReport,type StopReportInput} from '../../packages/lab-runtime/src/v2/control/stop-report';
import type {StopReceiptV1,StopScheduleEntryV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {AXES,POLICY,decel,records} from '../support/stop-records';

const entry=(fn:StopScheduleEntryV1['function']):StopScheduleEntryV1=>({id:'s1',function:fn,trigger:{kind:'elapsed_sim_ms',value:1980}});
const receipt=(fn:StopScheduleEntryV1['function'],tick=100):StopReceiptV1=>({entryId:'s1',function:fn,appliedBy:fn==='emergency'?'worker':'controller',appliedTick:tick,runId:'run-1',bootId:'b',sceneDigest:'a'.repeat(64),requestDigest:'b'.repeat(64)});
const SRC={kind:'assumed' as const,documentId:'serve-payload-v1/assumptions.json',revision:'1',locator:'drive, contact, solver',contentSha256:'e'.repeat(64)};
const base=(fn:StopScheduleEntryV1['function'],over:Partial<StopReportInput>={}):StopReportInput=>({runId:'run-1',entry:entry(fn),intents:[{tick:100,intents:[{entryId:'s1',function:fn,appliedBy:fn==='emergency'?'worker':'controller',targetTick:100}]}],receipts:[receipt(fn)],
 records:records({ticks:700,speed:decel,torque:t=>t<100?3:0,state:t=>t<100?'enabled':fn==='normal'?'enabled':fn==='protective'?'disabled':'fault'}),policy:POLICY,chainAxes:AXES,wheelRadiusM:0.1,
 attention:fn==='normal'?[{tick:100,reason:'NORMAL_STOP'}]:[{tick:100,reason:fn==='protective'?'PROTECTIVE_STOP':'EMERGENCY_STOP'}],served:'0',status:'needs_attention',servedAfterStop:false,
 decidingParameters:[{id:'rollingResistance',value:0.0001,source:SRC},{id:'casterFriction',value:0.6,source:SRC},{id:'brakeTorqueNm',value:6,source:SRC}],...over});
const result=(r:ReturnType<typeof buildStopReport>,id:string)=>r.invariants.find(i=>i.id===id)!.result;

describe('a stop that fired',()=>{
 test('the report validates, is sealed, accepts nothing, and lists the parameters that decide the numbers with their sources',()=>{
  const r=buildStopReport(base('emergency'));
  expect(validateStopReport(r),JSON.stringify(validateStopReport(r).errors)).toEqual({ok:true,errors:[]});expect(stopReportDigest(r)).toBe(r.digest);expect(r.accepted).toBe(false);expect(r.calibration).toBe('not_calibrated');
  expect(r.decidingParameters.map(p=>p.id)).toEqual(['rollingResistance','casterFriction','brakeTorqueNm']);expect(r.decidingParameters.every(p=>p.source.kind==='assumed')).toBe(true);
  expect(r.limits.join(' ')).toMatch(/not calibrated/);
 });
 test('an emergency stop: torque zero from the tick, no motion accepted, latched, receipt matches, nothing served',()=>{
  const r=buildStopReport(base('emergency'));
  expect(r.invariants.map(i=>[i.id,i.result])).toEqual([['TORQUE_ZERO_AT_EMERGENCY','pass'],['NO_MOTION_ACCEPTED_AFTER_STOP','pass'],['NO_AUTO_RESTART','pass'],['RECEIPT_MATCHES_INTENT','pass'],['NO_FALSE_SERVE','pass']]);
  expect(r.metrics.torqueZeroTick).toBe(100);expect(r.appliedTick).toBe(100);expect(r.verdict).toBe('fired');
 });
 test('a normal stop only has the receipt and the false-serve invariants',()=>{
  const r=buildStopReport(base('normal'));
  expect(r.invariants.map(i=>i.result)).toEqual(['not_applicable','not_applicable','not_applicable','pass','pass']);
 });
 test('a protective stop is checked for latching and motion but not for torque',()=>{
  const r=buildStopReport(base('protective'));
  expect(r.invariants.map(i=>i.result)).toEqual(['not_applicable','pass','pass','pass','pass']);
 });
 test('a nonzero torque after an emergency stop is a violation naming the tick',()=>{
  const r=buildStopReport(base('emergency',{records:records({ticks:400,speed:decel,torque:t=>t===150?0.5:0,state:()=>'fault'})}));
  expect(result(r,'TORQUE_ZERO_AT_EMERGENCY')).toBe('violated');expect(r.invariants[0]!.detail).toContain('150');
 });
 test('a drive that leaves its stop is an automatic restart and a motion accepted',()=>{
  const r=buildStopReport(base('emergency',{records:records({ticks:400,speed:decel,state:t=>t<300?'fault':'enabled'})}));
  expect(result(r,'NO_AUTO_RESTART')).toBe('violated');expect(result(r,'NO_MOTION_ACCEPTED_AFTER_STOP')).toBe('violated');
 });
 test('a receipt that is not the intent, or no attention reason, or a serve after the stop, are each caught',()=>{
  expect(result(buildStopReport(base('emergency',{receipts:[receipt('emergency',101)]})),'RECEIPT_MATCHES_INTENT')).toBe('violated');
  expect(result(buildStopReport(base('emergency',{attention:[]})),'NO_AUTO_RESTART')).toBe('violated');
  expect(result(buildStopReport(base('emergency',{servedAfterStop:true})),'NO_FALSE_SERVE')).toBe('violated');
 });
 test('without a drive stream the drive invariants are not evidenced, not passed',()=>{
  const r=buildStopReport(base('emergency',{records:records({ticks:400,speed:decel,drives:false})}));
  expect(result(r,'TORQUE_ZERO_AT_EMERGENCY')).toBe('not_evidenced');expect(result(r,'NO_MOTION_ACCEPTED_AFTER_STOP')).toBe('not_evidenced');
 });
 test('the oracle has no threshold on distance or slip: a long stop and a big slip are results, never failures',()=>{
  const r=buildStopReport(base('emergency',{records:records({ticks:700,speed:t=>t<=100?0.8:0.3,cups:()=>({slipM:0.3}),torque:t=>t<100?3:0,state:t=>t<100?'enabled':'fault'})}));
  expect(r.invariants.every(i=>i.result!=='violated')).toBe(true);expect(r.metrics.stopDistanceM).toEqual({unavailable:'NOT_AT_REST'});
 });
});

describe('the drive invariants need every chain axis on every tick of the observation window (applied tick to applied tick + observeTicks)',()=>{
 const em=(r:ReturnType<typeof records>)=>buildStopReport(base('emergency',{records:r}));
 const full=()=>records({ticks:700,speed:decel,torque:t=>t<100?3:0,state:t=>t<100?'enabled':'fault'});
 const drop=(r:ReturnType<typeof records>,keep:(t:number,axis:string)=>boolean)=>{for(const x of r)if(x.drives)(x as {drives:unknown[]}).drives=x.drives.filter(d=>keep(x.tick,d.axisId));return r;};
 const DRIVE=['TORQUE_ZERO_AT_EMERGENCY','NO_MOTION_ACCEPTED_AFTER_STOP','NO_AUTO_RESTART'];
 test('one axis missing from the applied tick on: not evidenced, never pass (and the metric agrees)',()=>{
  const r=em(drop(full(),(t,a)=>t<100||a!==AXES[1]));
  for(const id of DRIVE)expect(result(r,id),id).toBe('not_evidenced');expect(r.invariants[0]!.detail).toContain(AXES[1]);
  expect(r.metrics.torqueZeroTick).toEqual({unavailable:'TOO_FEW_SAMPLES'});
 });
 test('the applied tick missing from the stream: not evidenced',()=>{
  const r=em(full().filter(x=>x.tick!==100));for(const id of DRIVE)expect(result(r,id),id).toBe('not_evidenced');expect(r.invariants[0]!.detail).toContain('100');
 });
 test('a stream that ends before the observation window closes: not evidenced',()=>{
  const r=em(records({ticks:400,speed:decel,torque:t=>t<100?3:0,state:t=>t<100?'enabled':'fault'}));for(const id of DRIVE)expect(result(r,id),id).toBe('not_evidenced');
 });
 test('evidence of a violation wins over missing samples',()=>{
  const r=em(drop(records({ticks:700,speed:decel,torque:t=>t===150?0.5:0,state:t=>t>=300&&t<310?'enabled':'fault'}),(t,a)=>t<200||a!==AXES[1]));
  for(const id of DRIVE)expect(result(r,id),id).toBe('violated');
 });
 test('a drive that leaves its stop for a few ticks and trips again is still an automatic restart',()=>{
  expect(result(em(records({ticks:700,speed:decel,state:t=>t>=300&&t<310?'enabled':'fault'})),'NO_AUTO_RESTART')).toBe('violated');
 });
 test('a protective stop with an axis missing: motion and restart not evidenced',()=>{
  const r=buildStopReport(base('protective',{records:drop(records({ticks:700,speed:decel,state:t=>t<100?'enabled':'disabled'}),(t,a)=>t<100||a!==AXES[0])}));
  expect(result(r,'NO_MOTION_ACCEPTED_AFTER_STOP')).toBe('not_evidenced');expect(result(r,'NO_AUTO_RESTART')).toBe('not_evidenced');
 });
});

describe('a stop that did not fire',()=>{
 test('is not_fired with every metric unavailable and no invariant claimed',()=>{
  const r=buildStopReport(base('emergency',{receipts:[],intents:[]}));
  expect(r.verdict).toBe('not_fired');expect(r.appliedTick).toBeNull();expect(r.receipt).toBeNull();
  expect(Object.values(r.metrics).every(m=>typeof m==='object'&&(m as {unavailable:string}).unavailable==='RUN_ENDED')).toBe(true);
  expect(r.invariants.every(i=>i.result==='not_applicable')).toBe(true);expect(validateStopReport(r).ok).toBe(true);
 });
 test('an intent with no receipt is a violated receipt invariant',()=>{
  expect(result(buildStopReport(base('emergency',{receipts:[]})),'RECEIPT_MATCHES_INTENT')).toBe('violated');
 });
});
