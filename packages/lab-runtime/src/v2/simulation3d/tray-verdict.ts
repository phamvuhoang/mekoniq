/** The verdicts of one MJ-TRAY01 run, from facts the verifier read back from durable evidence: pure, so every claim is tested without an engine. */
import type {PhysicsTickRecord} from '../navigation2d/contracts';
import {maxSlipM,slipVerdict,supportAccelerationMps2,type TrayOraclePolicy,type SlipVerdict} from './tray-oracle';
import {TRAY_ACCELERATION,TRAY_EXPERIMENTS,type TrayExperimentId} from './tray-experiments';
import {DRIVE_EXPERIMENTS} from '../control/drive-experiments';
export interface TrayPolicy extends TrayOraclePolicy{slipWarnM:number;slipFailM:number}
export interface TrayRunFacts{experimentId:TrayExperimentId;status:string;served:string;tick:number;attention:readonly string[];records:readonly PhysicsTickRecord[];businessEvents:readonly {type:string;at:string}[];
 /** the navigation policy's limit of the run */accelerationLimitMps2:number;/** sliding friction of the cup face and of the tray face; the engine applies the larger */cupSliding:number;traySliding:number;
 /** the scripted person's position and radius, for the person variant */personAt?:(tick:number)=>{x:number;y:number}|null;personRadiusM?:number;
 /** the nominal run of the same seed, without a person: what the robot does on this route by itself (the negative control of the person oracle) */baselineRecords?:readonly PhysicsTickRecord[]}
export interface Verdict{id:string;result:'pass'|'fail'|'inconclusive';detail:string}
export interface TrayRunSummary{experimentId:TrayExperimentId;status:string;served:string;ticks:number;serviceTimeS:{available:boolean;value:number|null;reason?:string};
 /** the largest displacement of any cup in the tray frame within a trailing window, the reading a creep stays under; judged by the thresholds */maxLoadSlipM:{available:boolean;value:number|null};
 /** the largest displacement from where a cup started over the whole run: includes the soft-friction creep of the engine; reported, judged by nothing */cumulativeDriftM:number;
 /** the largest amount by which a wheel fell short of its commanded speed over the ticks the wheels were commanded (rad/s); null when they never were */wheelSpeedShortfallRadS:number|null;slipLevel:'none'|'warn'|'fail';accelerationLimitMps2:number;maxSupportAccelerationMps2:number|null;coulomb?:{muEffective:number;boundMps2:number;maxAccelerationMps2:number|null;verdict:SlipVerdict;onsetTick:number|null};
 person?:{contactTicks:number[];stoppedTicks:number;firstStopTick:number|null;lastStopTick:number|null;resumedTick:number|null};verdicts:Verdict[]}
/** C is judged by its speed shortfall: the wheels must have been commanded above SHORTFALL_MIN_RADS for at least SHORTFALL_MIN_TICKS ticks */
const SHORTFALL_MIN_RADS=1,SHORTFALL_MIN_TICKS=100;
function wheelShortfall(rs:readonly PhysicsTickRecord[]){
 let commandedTicks=0,value:number|null=null;
 for(const r of rs){const w=r.wheels?.[0];if(!w)continue;const target=Math.max(Math.abs(w.targetRadS[0]!),Math.abs(w.targetRadS[1]!));if(target<SHORTFALL_MIN_RADS)continue;commandedTicks++;const miss=Math.max(Math.abs(w.targetRadS[0]!)-Math.abs(w.velocityRadS[0]!),Math.abs(w.targetRadS[1]!)-Math.abs(w.velocityRadS[1]!));value=Math.max(value??-Infinity,miss);}
 return {commandedTicks,value};
}
const CUPS=['cup-1','cup-2','cup-3'],STOP_MPS=0.02,NEAR_M=2.0,MIN_STOP_TICKS=10;
const ms=(iso:string)=>Date.parse(iso);
const pos=(r:PhysicsTickRecord)=>r.base?.[0]?.poseMap.positionM;
/** speed of the base over +-1 tick (m/s); null at the ends or where a pose is missing */
const speedAt=(rs:readonly PhysicsTickRecord[],t:number)=>{const a=rs[t-1]&&pos(rs[t-1]!),b=rs[t+1]&&pos(rs[t+1]!);return a&&b?Math.hypot(b[0]!-a[0]!,b[1]!-a[1]!)/0.04:null;};
/** The measurements both the report's tray evidence and the verdicts read: one place, so they cannot differ. */
function measure(f:{status:string;records:readonly PhysicsTickRecord[];businessEvents:readonly {type:string;at:string}[]},policy:TrayPolicy){
 const done=f.status==='completed',first=f.businessEvents.find(e=>e.type==='RobotCommandIssued'),last=[...f.businessEvents].reverse().find(e=>e.type==='MissionCompleted');
 const serviceTimeS:TrayRunSummary['serviceTimeS']=first&&last&&done?{available:true,value:(ms(last.at)-ms(first.at))/1000}:{available:false,value:null,reason:'MISSION_NOT_COMPLETED'};
 const has=f.records.some(r=>CUPS.some(id=>r.loads.some(l=>l.propId===id)));
 const windowSlip=has?Math.max(...CUPS.map(id=>maxSlipM(f.records,id,policy.slipWindowTicks))):null,drift=has?Math.max(...CUPS.map(id=>maxSlipM(f.records,id))):null;
 const accel=f.records.map((_,i)=>supportAccelerationMps2(f.records,i,policy.accelerationWindowTicks)).filter((a):a is number=>a!==null),maxAccel=accel.length?Math.max(...accel):null;
 return {done,serviceTimeS,windowSlip,drift,maxAccel};
}
/** What a tray run's report carries (RunReport.trayEvidence): enough for two reports to be compared and the Lab's design hint to be filled, from the durable physics records only. */
export interface TrayEvidenceV1{schemaVersion:1;documentType:'tray-evidence';accepted:false;calibration:'not_calibrated';experimentId:TrayExperimentId;comparedWith:string|null;knobs:{friction:string;acceleration:string;drive:string;actor:boolean};
 accelerationLimitMps2:number;/** the trailing window of the slip reading, in ticks */windowTicks:number;maxLoadSlipM:{available:boolean;value:number|null};cumulativeDriftM:number|null;maxSupportAccelerationMps2:number|null;
 serviceTimeS:{available:boolean;value:number|null;reason?:string};policyDigest:string}
export function buildTrayEvidence(f:{experimentId:TrayExperimentId;records:readonly PhysicsTickRecord[];businessEvents:readonly {type:string;at:string}[];status:string;accelerationLimitMps2:number;policy:TrayPolicy;policyDigest:string}):TrayEvidenceV1{
 const m=measure(f,f.policy),e=TRAY_EXPERIMENTS[f.experimentId];
 return {schemaVersion:1,documentType:'tray-evidence',accepted:false,calibration:'not_calibrated',experimentId:f.experimentId,comparedWith:e.comparedWith,knobs:{friction:e.load,acceleration:e.accelerationPolicy,drive:e.driveExperimentId,actor:e.actor},
  accelerationLimitMps2:f.accelerationLimitMps2,windowTicks:f.policy.slipWindowTicks,maxLoadSlipM:m.windowSlip===null?{available:false,value:null}:{available:true,value:m.windowSlip},cumulativeDriftM:m.drift,maxSupportAccelerationMps2:m.maxAccel,serviceTimeS:m.serviceTimeS,policyDigest:f.policyDigest};
}
export function summariseTrayRun(f:TrayRunFacts,policy:TrayPolicy):TrayRunSummary{
 const verdicts:Verdict[]=[],say=(id:string,ok:boolean|null,detail:string)=>verdicts.push({id,result:ok===null?'inconclusive':ok?'pass':'fail',detail});
 const {done,serviceTimeS,windowSlip:ws,drift:dr,maxAccel}=measure(f,policy),windowSlip=ws??0,drift=dr??0;
 const slipLevel=windowSlip>policy.slipFailM?'fail':windowSlip>policy.slipWarnM?'warn':'none';
 // the capture must be a whole run: one that is still running, paused or waiting was cut short and says nothing about the variant
 say('RUN_ENDED',['completed','needs_attention','failed','cancelled'].includes(f.status),`status ${f.status} at tick ${f.tick}`);
 const shortfall=wheelShortfall(f.records);
 if(f.experimentId==='tray-torque-limited-v1')say('SPEED_SHORTFALL',shortfall.commandedTicks>=SHORTFALL_MIN_TICKS&&shortfall.value!==null,`${shortfall.commandedTicks} ticks with the wheels commanded above ${SHORTFALL_MIN_RADS} rad/s; largest shortfall ${shortfall.value===null?'not observed':shortfall.value.toFixed(3)+' rad/s'}`);
 say('NO_FALSE_SERVE',f.served==='0'||done,`served ${f.served}, status ${f.status}`);
 // A, A-prime and D must finish their mission; B and C stress the plant, and a mission that ends in attention there is the result (with its reasons), not a failure of the oracle
 if(['tray-nominal-v1','tray-low-friction-v1','tray-person-crossing-v1'].includes(f.experimentId))say('SERVED_ALL',done&&f.served==='3',`status ${f.status}, served ${f.served}`);
 else say('MISSION_OUTCOME',done?true:null,`status ${f.status}, served ${f.served}${f.attention.length?`, attention ${[...new Set(f.attention)].join(',')}`:''}`);
 const out:TrayRunSummary={wheelSpeedShortfallRadS:shortfall.value,experimentId:f.experimentId,status:f.status,served:f.served,ticks:f.tick,serviceTimeS,maxLoadSlipM:{available:true,value:windowSlip},cumulativeDriftM:drift,slipLevel,accelerationLimitMps2:f.accelerationLimitMps2,maxSupportAccelerationMps2:maxAccel,verdicts};
 // a slide past the failure threshold fails every variant but B, where a slide above the Coulomb bound is the expected result and is only reported (slipLevel)
 if(f.experimentId!=='tray-accel-high-v1')say('SLIP_BELOW_FAIL',windowSlip<=policy.slipFailM,`largest window slip ${(windowSlip*1000).toFixed(2)} mm, failure above ${policy.slipFailM*1000} mm`);
 if(f.experimentId==='tray-nominal-v1')say('SLIP_BELOW_WARN',windowSlip<policy.slipWarnM,`largest window slip ${(windowSlip*1000).toFixed(2)} mm, warning at ${policy.slipWarnM*1000} mm`);
 if(f.experimentId==='tray-low-friction-v1'||f.experimentId==='tray-accel-high-v1'){
  const mu=Math.max(f.cupSliding,f.traySliding),v=slipVerdict(f.records,CUPS,mu,policy);
  out.coulomb={muEffective:mu,boundMps2:v.boundMps2,maxAccelerationMps2:v.maxAccelerationMps2,verdict:v.verdict,onsetTick:v.onset?.tick??null};
  say('COULOMB',v.verdict==='inconclusive'?null:v.verdict==='slip_expected_and_found'||v.verdict==='no_slip_expected',`${v.verdict}: tray acceleration up to ${v.maxAccelerationMps2?.toFixed(2)} m/s2 against the Coulomb bound ${v.boundMps2.toFixed(3)} m/s2 (mu ${mu})`);
 }
 if(f.experimentId==='tray-person-crossing-v1'&&f.personAt){
  const contactTicks=f.records.filter(r=>r.contacts.some(c=>c.a.startsWith('actor/')||c.b.startsWith('actor/'))).map(r=>r.tick);
  // a stop for the person: a stretch of at least MIN_STOP_TICKS nearly still, with the person within NEAR_M, that the same route without a person (the negative control) does not have
  const stopsOf=(rs:readonly PhysicsTickRecord[])=>{const out:{from:number;to:number}[]=[];let from=-1;for(let t=1;t<=rs.length-1;t++){const v=t<rs.length-1?speedAt(rs,t):null,still=v!==null&&v<STOP_MPS;if(still&&from<0)from=t;if(!still&&from>=0){if(t-from>=MIN_STOP_TICKS)out.push({from,to:t-1});from=-1;}}return out;};
  const near=(t:number)=>{const p=pos(f.records[t]!),q=f.personAt!(t);return !!p&&!!q&&Math.hypot(p[0]!-q.x,p[1]!-q.y)<=NEAR_M;};
  const base=f.baselineRecords?stopsOf(f.baselineRecords):null,mine=stopsOf(f.records);
  const mate=(s:{from:number;to:number})=>base!.some(b=>s.from<=b.to+MIN_STOP_TICKS&&b.from<=s.to+MIN_STOP_TICKS);
  const personStops=base?mine.filter(s=>near(s.from)&&!mate(s)):[];
  const stoppedTicks=personStops.reduce((n,s)=>n+s.to-s.from+1,0),firstStop=personStops[0]?.from??null,lastStop=personStops.at(-1)?.to??null;
  let resumed:number|null=null;
  if(lastStop!==null)for(let t=lastStop+1;t<f.records.length-1;t++){const v=speedAt(f.records,t);if(v!==null&&v>0.1){resumed=t;break;}}
  const clear=resumed!==null&&!near(resumed);
  out.person={contactTicks,stoppedTicks,firstStopTick:firstStop,lastStopTick:lastStop,resumedTick:resumed};
  say('NO_PROXY_CONTACT',!contactTicks.length,contactTicks.length?`contact with the person at ticks ${contactTicks.slice(0,5).join(',')}`:'no contact between the robot and the person');
  say('STOPPED_FOR_PERSON',!!base&&stoppedTicks>=MIN_STOP_TICKS,!base?'NO_NEGATIVE_CONTROL: the nominal run of this seed is needed':stoppedTicks>=MIN_STOP_TICKS?`${stoppedTicks} ticks nearly still with the person within ${NEAR_M} m, a stop the run without a person does not make`:mine.some(s=>near(s.from))?'the robot also stops there without a person (negative control): not a reaction to the person':'the robot did not stop with the person near');
  say('RESUMED_AFTER_PASS',resumed!==null&&clear&&done,resumed===null?'the robot did not move again after the stop':!clear?`moved again at tick ${resumed} while the person was still within ${NEAR_M} m`:`moved again at tick ${resumed}, the person more than ${NEAR_M} m away`);
 }
 return out;
}

/** The inputs of a tray run as its own bundle holds them: what the verdicts and the campaign read. */
export interface TrayInputsUsed{policySha:string;loadId:string;cupSliding:number;physicsId:string;traySliding:number;accelerationLimitMps2:number;driveModelPath:string;baseLimitMps2:number|null}
/** What the registry says a variant runs on. A recording whose bundle names the variant but ran on other inputs (a dropped override, a wrong drive) is not that variant. */
export function registeredTrayInputs(id:TrayExperimentId,o:{policySha:string}):TrayInputsUsed{
 const e=TRAY_EXPERIMENTS[id],a=TRAY_ACCELERATION[e.accelerationPolicy],low=e.load==='cup-triple-low-friction';
 return {policySha:o.policySha,loadId:e.load,cupSliding:low?0.15:0.6,physicsId:e.physics==='drive-contact-profile'?'serve-drive-contact-v1':e.physics,traySliding:e.physics==='drive-contact-profile'?0.6:0.15,accelerationLimitMps2:a.policyMps2,driveModelPath:DRIVE_EXPERIMENTS[e.driveExperimentId as keyof typeof DRIVE_EXPERIMENTS].mobileModel,baseLimitMps2:a.baseLimitMps2};
}
/** The names of the fields in which the run's inputs differ from the registered ones. */
export const trayInputIssues=(id:TrayExperimentId,used:TrayInputsUsed,policySha:string)=>{const want=registeredTrayInputs(id,{policySha});return (Object.keys(want) as (keyof TrayInputsUsed)[]).filter(k=>want[k]!==used[k]);};

/** Stops by the plant's own monitor: the run ends there on purpose and the records up to the stop are all there is. */
export const MONITOR_STOPS=['LOAD_FELL','BASE_TIPPED','PLANT_UNSTABLE'] as const;
/** What the physics evidence reader found that makes the records unusable. Any integrity, identity or gap finding blocks; the single excuse is incomplete coverage that a monitor stop explains (a terminal reason of the plant monitor, no gap). */
export function blockingReadIssues(read:{issues:readonly string[]},manifest:{gaps:readonly unknown[];terminalReason?:string|null},recordCount:number,tick:number):string[]{
 const stopped=!!manifest.terminalReason&&(MONITOR_STOPS as readonly string[]).includes(manifest.terminalReason)&&!manifest.gaps.length;
 const out=read.issues.filter(i=>i!=='PHYSICS_COVERAGE_INCOMPLETE'||!stopped);
 if(manifest.gaps.length)out.push('PHYSICS_GAPS');
 if(recordCount!==tick+1)out.push('PHYSICS_RECORD_COUNT');
 return out;
}
