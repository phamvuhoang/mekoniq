import {expect,test} from 'vitest';
import {buildTrayEvidence,summariseTrayRun,type TrayRunFacts} from '../../packages/lab-runtime/src/v2/simulation3d/tray-verdict';
import type {PhysicsTickRecord} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';

const policy={slipWarnM:0.005,slipFailM:0.02,slipEpsilonM:0.005,slipWindowTicks:25,accelerationWindowTicks:3,episodeGapTicks:25,accelerationToleranceBelowMps2:0.3,accelerationToleranceAboveMps2:0.3,onsetLeadTicks:5,onsetLagTicks:40};
/** base moves along x by `speed(t)` m/s; the three cups sit still unless `slip` moves them; `contacts(t)` lists contact pairs */
const records=(ticks:number,speed:(t:number)=>number,slip:(t:number)=>number=()=>0,contacts:(t:number)=>{a:string;b:string}[]=()=>[]):PhysicsTickRecord[]=>{
 const out:PhysicsTickRecord[]=[];let x=2;
 for(let t=0;t<ticks;t++){out.push({schemaVersion:1,tick:t,simTimeNs:String(t*20_000_000),contacts:contacts(t),
  loads:['cup-1','cup-2','cup-3'].map((id,i)=>({propId:id,supportId:'amr-1/tray-1',poseInSupport:{positionM:[i*0.1+slip(t),0,0.05],quaternionXyzw:[0,0,0,1]}})),
  base:[{robotId:'amr-1',poseMap:{positionM:[x,8.1,0.075],quaternionXyzw:[0,0,0,1]},rollRad:0,pitchRad:0}]} as unknown as PhysicsTickRecord);x+=speed(t)*0.02;}
 return out;
};
const events=(startS:number,endS:number)=>[{type:'RobotCommandIssued',at:new Date(Date.UTC(2026,10,1,0,0,startS)).toISOString()},{type:'MissionCompleted',at:new Date(Date.UTC(2026,10,1,0,0,endS)).toISOString()}];
const facts=(over:Partial<TrayRunFacts>={}):TrayRunFacts=>({experimentId:'tray-nominal-v1',status:'completed',served:'3',tick:300,attention:[],records:records(300,()=>0.5),businessEvents:events(0,100),accelerationLimitMps2:0.5,cupSliding:0.6,traySliding:0.6,...over});
const result=(s:ReturnType<typeof summariseTrayRun>,id:string)=>s.verdicts.find(v=>v.id===id)?.result;

test('nominal: served all, no window slip, a cumulative drift that is reported and judged by nothing',()=>{
 const s=summariseTrayRun(facts({records:records(300,()=>0.5,t=>t*0.00005)}),policy);
 expect(result(s,'SERVED_ALL')).toBe('pass');expect(result(s,'SLIP_BELOW_WARN')).toBe('pass');expect(result(s,'NO_FALSE_SERVE')).toBe('pass');
 expect(s.maxLoadSlipM.value).toBeLessThan(0.005);expect(s.cumulativeDriftM).toBeGreaterThan(0.01);
 expect(s.serviceTimeS).toEqual({available:true,value:100});expect(s.accelerationLimitMps2).toBe(0.5);
});

test('nominal: a window slip above the warning threshold fails SLIP_BELOW_WARN',()=>{
 const s=summariseTrayRun(facts({records:records(300,()=>0.5,t=>t<100?0:(t-99)*0.002)}),policy);
 expect(result(s,'SLIP_BELOW_WARN')).toBe('fail');expect(s.slipLevel).toBe('fail');
});

test('a served unit without a completed mission is a false serve',()=>{
 expect(result(summariseTrayRun(facts({status:'needs_attention',served:'1',attention:['NO_PROGRESS']}),policy),'NO_FALSE_SERVE')).toBe('fail');
 expect(result(summariseTrayRun(facts({status:'needs_attention',served:'0',attention:['NO_PROGRESS']}),policy),'NO_FALSE_SERVE')).toBe('pass');
});

test('service time is unavailable, with a reason, when the mission did not finish',()=>{
 const s=summariseTrayRun(facts({businessEvents:[events(0,1)[0]!]}),policy);
 expect(s.serviceTimeS).toMatchObject({available:false,value:null,reason:'MISSION_NOT_COMPLETED'});
});

test('low friction: the effective pair friction is the larger of the two faces and the Coulomb verdict is recorded',()=>{
 const s=summariseTrayRun(facts({experimentId:'tray-low-friction-v1',cupSliding:0.15,traySliding:0.15,records:records(400,t=>t<100?0.5:0.5)}),policy);
 expect(s.coulomb).toMatchObject({muEffective:0.15,verdict:'no_slip_expected'});expect(s.coulomb!.boundMps2).toBeCloseTo(1.4715,4);
 expect(result(s,'COULOMB')).toBe('pass');
 const mixed=summariseTrayRun(facts({experimentId:'tray-low-friction-v1',cupSliding:0.15,traySliding:0.6}),policy);
 expect(mixed.coulomb!.muEffective).toBe(0.6);
});

test('high acceleration: acceleration above the bound with no slip is a failed oracle; with a slip near the crossing it passes',()=>{
 const speed=(t:number)=>Math.min(0.5+Math.max(0,t-100)*0.05,2.5);        // accelerates at 2.5 m/s2 after tick 100
 const none=summariseTrayRun(facts({experimentId:'tray-accel-high-v1',cupSliding:0.15,traySliding:0.15,accelerationLimitMps2:2.5,records:records(300,speed)}),policy);
 expect(none.coulomb!.verdict).toBe('slip_expected_absent');expect(result(none,'COULOMB')).toBe('fail');
 const found=summariseTrayRun(facts({experimentId:'tray-accel-high-v1',cupSliding:0.15,traySliding:0.15,accelerationLimitMps2:2.5,records:records(300,speed,t=>t<105?0:Math.min((t-104)*0.002,0.04))}),policy);
 expect(found.coulomb!.verdict).toBe('slip_expected_and_found');expect(result(found,'COULOMB')).toBe('pass');
 expect(found.maxSupportAccelerationMps2).toBeGreaterThan(2.3);
});

test('an inconclusive Coulomb reading is recorded as inconclusive, never as a pass',()=>{
 const s=summariseTrayRun(facts({experimentId:'tray-low-friction-v1',cupSliding:0.15,traySliding:0.15,records:records(300,t=>Math.min(1.5*t*0.02,1))}),policy);
 expect(result(s,'COULOMB')).toBe('inconclusive');
});

const person=(x:number,y:number)=>({x,y});
test('person crossing, physically: stop window near the person, then resume',()=>{
 const speed=(t:number)=>t<80?0.5:t<100?0.5-(t-80)*0.025:t<200?0:t<220?(t-200)*0.025:0.5;
 const recs=records(400,speed);
 const stopX=recs[150]!.base![0]!.poseMap.positionM[0]!;
 const at=(t:number)=>t<=200?person(stopX+1.0,8.1):person(stopX+1.0,11);
 const s=summariseTrayRun(facts({experimentId:'tray-person-crossing-v1',records:recs,personAt:at,personRadiusM:0.25,baselineRecords:records(400,()=>0.5)}),policy);
 expect(result(s,'NO_PROXY_CONTACT')).toBe('pass');expect(result(s,'STOPPED_FOR_PERSON')).toBe('pass');expect(result(s,'RESUMED_AFTER_PASS')).toBe('pass');expect(result(s,'SERVED_ALL')).toBe('pass');
 const never=summariseTrayRun(facts({experimentId:'tray-person-crossing-v1',records:records(400,()=>0.5),personAt:at,personRadiusM:0.25,baselineRecords:records(400,()=>0.5)}),policy);
 expect(result(never,'STOPPED_FOR_PERSON')).toBe('fail');
 const touched=summariseTrayRun(facts({experimentId:'tray-person-crossing-v1',records:records(400,speed,()=>0,t=>t===120?[{a:'actor/person-1',b:'amr-1/chassis/base/c0'}]:[]),personAt:at,personRadiusM:0.25,baselineRecords:records(400,()=>0.5)}),policy);
 expect(result(touched,'NO_PROXY_CONTACT')).toBe('fail');
 const stuck=summariseTrayRun(facts({experimentId:'tray-person-crossing-v1',status:'needs_attention',served:'0',attention:['NO_PROGRESS'],records:records(400,t=>t<100?0.5:0),personAt:()=>person(stopX+1.0,8.1),personRadiusM:0.25,baselineRecords:records(400,()=>0.5)}),policy);
 expect(result(stuck,'RESUMED_AFTER_PASS')).toBe('fail');expect(result(stuck,'SERVED_ALL')).toBe('fail');
});

test('tray evidence carries what the Lab needs to compare two runs: the variant, its knobs, the limit and the measured slip and service time',()=>{
 const f=facts({experimentId:'tray-accel-high-v1',accelerationLimitMps2:2.5,records:records(300,()=>0.5,t=>t*0.00005)});
 const e=buildTrayEvidence({experimentId:f.experimentId,records:f.records,businessEvents:f.businessEvents,status:f.status,accelerationLimitMps2:f.accelerationLimitMps2,policy,policyDigest:'a'.repeat(64)});
 expect(e).toMatchObject({schemaVersion:1,documentType:'tray-evidence',accepted:false,calibration:'not_calibrated',experimentId:'tray-accel-high-v1',comparedWith:'tray-low-friction-v1',accelerationLimitMps2:2.5,windowTicks:25,
  knobs:{friction:'cup-triple-low-friction',acceleration:'high',drive:'drive-nominal-v1',actor:false},serviceTimeS:{available:true,value:100},policyDigest:'a'.repeat(64)});
 expect(e.maxLoadSlipM.value).toBeLessThan(0.005);expect(e.cumulativeDriftM).toBeGreaterThan(0.01);
 // and it is the same numbers the verdicts use
 const s=summariseTrayRun({...f,cupSliding:0.15,traySliding:0.15},policy);
 expect(e.maxLoadSlipM).toEqual(s.maxLoadSlipM);expect(e.serviceTimeS).toEqual(s.serviceTimeS);expect(e.cumulativeDriftM).toBe(s.cumulativeDriftM);expect(e.maxSupportAccelerationMps2).toBe(s.maxSupportAccelerationMps2);
});

test('tray evidence of a run that did not finish has no service time and says why; a run without records has no slip',()=>{
 const e=buildTrayEvidence({experimentId:'tray-nominal-v1',records:records(300,()=>0.5),businessEvents:[events(0,1)[0]!],status:'needs_attention',accelerationLimitMps2:0.5,policy,policyDigest:'b'.repeat(64)});
 expect(e.serviceTimeS).toMatchObject({available:false,value:null,reason:'MISSION_NOT_COMPLETED'});
 const none=buildTrayEvidence({experimentId:'tray-nominal-v1',records:[],businessEvents:[],status:'ready',accelerationLimitMps2:0.5,policy,policyDigest:'b'.repeat(64)});
 expect(none.maxLoadSlipM).toEqual({available:false,value:null});expect(none.cumulativeDriftM).toBeNull();
});

test('a variant that stresses the plant (B, C) may end without the mission done: that is a recorded result with its reasons, not a failed oracle',()=>{
 for(const id of ['tray-accel-high-v1','tray-torque-limited-v1'] as const){
  const stuck=summariseTrayRun(facts({experimentId:id,status:'needs_attention',served:'0',attention:['NO_PROGRESS'],cupSliding:0.15,traySliding:0.15,accelerationLimitMps2:2.5}),policy);
  expect(result(stuck,'SERVED_ALL'),id).toBeUndefined();expect(result(stuck,'NO_FALSE_SERVE'),id).toBe('pass');
  const outcome=stuck.verdicts.find(v=>v.id==='MISSION_OUTCOME')!;expect(outcome.result).toBe('inconclusive');expect(outcome.detail).toContain('NO_PROGRESS');
  const done=summariseTrayRun(facts({experimentId:id,cupSliding:0.15,traySliding:0.15,accelerationLimitMps2:2.5}),policy);
  expect(result(done,'MISSION_OUTCOME'),id).toBe('pass');
 }
 // A, A-prime and D must finish
 for(const id of ['tray-nominal-v1','tray-low-friction-v1'] as const)expect(result(summariseTrayRun(facts({experimentId:id,status:'needs_attention',served:'0',attention:['NO_PROGRESS'],cupSliding:0.15,traySliding:0.15}),policy),'SERVED_ALL'),id).toBe('fail');
});

// ---- review fixes ----
import {trayInputIssues,registeredTrayInputs} from '../../packages/lab-runtime/src/v2/simulation3d/tray-verdict';
test('a window slip above the failure threshold fails SLIP_BELOW_FAIL for every variant but B, where a slip is the expected result and is only reported',()=>{
 const slide=records(300,()=>0.5,t=>t<100?0:(t-99)*0.002);          // 50 mm per window
 for(const id of ['tray-nominal-v1','tray-low-friction-v1','tray-torque-limited-v1','tray-person-crossing-v1'] as const){
  const s=summariseTrayRun(facts({experimentId:id,cupSliding:0.15,traySliding:0.15,records:slide,personAt:()=>({x:0,y:0}),personRadiusM:0.25}),policy);
  expect(result(s,'SLIP_BELOW_FAIL'),id).toBe('fail');expect(s.slipLevel).toBe('fail');
  expect(result(summariseTrayRun(facts({experimentId:id,cupSliding:0.15,traySliding:0.15,records:records(300,()=>0.5),personAt:()=>({x:0,y:0}),personRadiusM:0.25}),policy),'SLIP_BELOW_FAIL'),id).toBe('pass');
 }
 const b=summariseTrayRun(facts({experimentId:'tray-accel-high-v1',cupSliding:0.15,traySliding:0.15,accelerationLimitMps2:2.5,records:slide}),policy);
 expect(result(b,'SLIP_BELOW_FAIL')).toBeUndefined();expect(b.slipLevel).toBe('fail');
});

const good={policySha:'p',loadId:'cup-triple',cupSliding:0.6,physicsId:'serve-drive-contact-v1',traySliding:0.6,accelerationLimitMps2:0.5,driveModelPath:'serve-drive-nominal-v1.json',baseLimitMps2:1};
test('the inputs a run really used are compared with the registered ones, field by field',()=>{
 const r=registeredTrayInputs('tray-nominal-v1',{policySha:'p'});expect(r).toMatchObject({loadId:'cup-triple',cupSliding:0.6,traySliding:0.6,accelerationLimitMps2:0.5,driveModelPath:'serve-drive-nominal-v1.json',baseLimitMps2:1});
 expect(trayInputIssues('tray-nominal-v1',good,'p')).toEqual([]);
 expect(trayInputIssues('tray-nominal-v1',{...good,accelerationLimitMps2:0.6},'p')).toEqual(['accelerationLimitMps2']);
 expect(trayInputIssues('tray-nominal-v1',{...good,policySha:'q'},'p')).toEqual(['policySha']);
 expect(trayInputIssues('tray-nominal-v1',{...good,driveModelPath:'serve-drive-torque-limited-v1.json'},'p')).toEqual(['driveModelPath']);
 expect(trayInputIssues('tray-nominal-v1',{...good,cupSliding:0.15,traySliding:0.15,loadId:'cup-triple-low-friction'},'p').sort()).toEqual(['cupSliding','loadId','traySliding']);
 const high=registeredTrayInputs('tray-accel-high-v1',{policySha:'p'});expect(high).toMatchObject({accelerationLimitMps2:2.5,baseLimitMps2:3,cupSliding:0.15,traySliding:0.15});
 expect(registeredTrayInputs('tray-torque-limited-v1',{policySha:'p'}).driveModelPath).toBe('serve-drive-torque-limited-v1.json');
});

// ---- R04: what the evidence reader found is never ignored ----
import {blockingReadIssues} from '../../packages/lab-runtime/src/v2/simulation3d/tray-verdict';
test('every integrity, identity or gap finding of the reader blocks the verdicts; only a stop by the plant monitor excuses incomplete coverage',()=>{
 const ok={issues:[] as string[]},m=(over:object={})=>({gaps:[] as unknown[],terminalReason:null as string|null,...over});
 expect(blockingReadIssues(ok,m(),101,100)).toEqual([]);
 expect(blockingReadIssues({issues:['PHYSICS_POLICY_MISMATCH']},m(),101,100)).toEqual(['PHYSICS_POLICY_MISMATCH']);
 expect(blockingReadIssues({issues:['PHYSICS_IDENTITY_MISMATCH','PHYSICS_COVERAGE_INCOMPLETE']},m(),101,100)).toEqual(expect.arrayContaining(['PHYSICS_IDENTITY_MISMATCH','PHYSICS_COVERAGE_INCOMPLETE']));
 // a gap, or incomplete coverage with no stop reason, is a loss of data
 expect(blockingReadIssues({issues:['PHYSICS_COVERAGE_INCOMPLETE']},m({gaps:[{firstTick:100,lastTick:112}]}),101,100)).toEqual(expect.arrayContaining(['PHYSICS_GAPS']));
 expect(blockingReadIssues({issues:['PHYSICS_COVERAGE_INCOMPLETE']},m(),101,100)).toEqual(['PHYSICS_COVERAGE_INCOMPLETE']);
 expect(blockingReadIssues({issues:['PHYSICS_COVERAGE_INCOMPLETE']},m({terminalReason:'LOAD_FELL'}),101,100)).toEqual([]);
 expect(blockingReadIssues({issues:['PHYSICS_COVERAGE_INCOMPLETE']},m({terminalReason:'WORKER_LOST'}),101,100)).toEqual(['PHYSICS_COVERAGE_INCOMPLETE']);
 // one record per tick up to the run's tick, no more and no less
 expect(blockingReadIssues(ok,m(),99,100)).toEqual(['PHYSICS_RECORD_COUNT']);
});

// ---- R09: a capture cut short is not a case; C must show its speed shortfall ----
const withWheels=(rs:PhysicsTickRecord[],target:number,speed:number)=>rs.map(r=>({...r,wheels:[{robotId:'amr-1',angleRad:[0,0],velocityRadS:[speed,speed],torqueNm:[0,0],targetRadS:[target,target],saturatedSubsubsteps:0}]})) as unknown as PhysicsTickRecord[];
test('a run that has not ended (running, paused, awaiting) fails RUN_ENDED for every variant',()=>{
 for(const id of ['tray-nominal-v1','tray-low-friction-v1','tray-accel-high-v1','tray-torque-limited-v1','tray-person-crossing-v1'] as const)
  for(const status of ['running','paused','awaiting_confirmation','ready']){
   const s=summariseTrayRun(facts({experimentId:id,status,served:'0',cupSliding:0.15,traySliding:0.15,personAt:()=>({x:0,y:0}),personRadiusM:0.25}),policy);
   expect(result(s,'RUN_ENDED'),id+status).toBe('fail');
  }
 for(const status of ['completed','needs_attention','failed','cancelled'])expect(result(summariseTrayRun(facts({status,served:'0'}),policy),'RUN_ENDED'),status).toBe('pass');
});
test('C: the wheel speed shortfall must be observed (the wheels commanded for a while); a 40-tick capture does not show it',()=>{
 const short=summariseTrayRun(facts({experimentId:'tray-torque-limited-v1',status:'needs_attention',served:'0',attention:['NO_PROGRESS'],records:withWheels(records(40,()=>0.5),5,5)}),policy);
 expect(result(short,'SPEED_SHORTFALL')).toBe('fail');
 const shown=summariseTrayRun(facts({experimentId:'tray-torque-limited-v1',status:'needs_attention',served:'0',attention:['NO_PROGRESS'],records:withWheels(records(400,()=>0.5),5,3.5)}),policy);
 expect(result(shown,'SPEED_SHORTFALL')).toBe('pass');expect(shown.wheelSpeedShortfallRadS).toBeCloseTo(1.5,6);
 expect(summariseTrayRun(facts({experimentId:'tray-nominal-v1',records:withWheels(records(400,()=>0.5),5,5)}),policy).verdicts.find(v=>v.id==='SPEED_SHORTFALL')).toBeUndefined();
});

// ---- R05: the negative control: the same stop without the person is not a reaction to the person ----
test('person crossing: a stop that the nominal run (no person) makes at the same place is not a stop for the person; a missing control fails',()=>{
 const speed=(t:number)=>t<80?0.5:t<100?0.5-(t-80)*0.025:t<200?0:t<220?(t-200)*0.025:0.5;
 const recs=records(400,speed),stopX=recs[150]!.base![0]!.poseMap.positionM[0]!,at=(t:number)=>t<=200?person(stopX+1.0,8.1):person(stopX+1.0,11);
 const same=summariseTrayRun(facts({experimentId:'tray-person-crossing-v1',records:recs,personAt:at,personRadiusM:0.25,baselineRecords:recs}),policy);
 expect(result(same,'STOPPED_FOR_PERSON')).toBe('fail');expect(same.verdicts.find(v=>v.id==='STOPPED_FOR_PERSON')!.detail).toMatch(/also stops|negative control/i);
 expect(result(summariseTrayRun(facts({experimentId:'tray-person-crossing-v1',records:recs,personAt:at,personRadiusM:0.25,baselineRecords:records(400,()=>0.5)}),policy),'STOPPED_FOR_PERSON')).toBe('pass');
 const none=summariseTrayRun(facts({experimentId:'tray-person-crossing-v1',records:recs,personAt:at,personRadiusM:0.25}),policy);
 expect(result(none,'STOPPED_FOR_PERSON')).toBe('fail');expect(none.verdicts.find(v=>v.id==='STOPPED_FOR_PERSON')!.detail).toContain('NO_NEGATIVE_CONTROL');
 // moving on while the person is still beside the robot is not "after the person has passed"
 const stay=summariseTrayRun(facts({experimentId:'tray-person-crossing-v1',records:recs,personAt:()=>person(stopX+1.0,8.1),personRadiusM:0.25,baselineRecords:records(400,()=>0.5)}),policy);
 expect(result(stay,'RESUMED_AFTER_PASS')).toBe('fail');
});
