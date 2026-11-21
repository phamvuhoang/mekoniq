/** The verdicts of one MJ-TRAY01 run, from facts the verifier read back from durable evidence: pure, so every claim is tested without an engine. */
import type {PhysicsTickRecord} from '../navigation2d/contracts';
import {maxSlipM,slipVerdict,supportAccelerationMps2,type TrayOraclePolicy,type SlipVerdict} from './tray-oracle';
import {TRAY_ACCELERATION,TRAY_EXPERIMENTS,type TrayExperimentId} from './tray-experiments';
import {DRIVE_EXPERIMENTS} from '../control/drive-experiments';
export interface TrayPolicy extends TrayOraclePolicy{slipWarnM:number;slipFailM:number}
export interface TrayRunFacts{experimentId:TrayExperimentId;status:string;served:string;tick:number;attention:readonly string[];records:readonly PhysicsTickRecord[];businessEvents:readonly {type:string;at:string}[];
 /** the navigation policy's limit of the run */accelerationLimitMps2:number;/** sliding friction of the cup face and of the tray face; the engine applies the larger */cupSliding:number;traySliding:number;
 /** the scripted person's position and radius, for the person variant */personAt?:(tick:number)=>{x:number;y:number}|null;personRadiusM?:number}
export interface Verdict{id:string;result:'pass'|'fail'|'inconclusive';detail:string}
export interface TrayRunSummary{experimentId:TrayExperimentId;status:string;served:string;ticks:number;serviceTimeS:{available:boolean;value:number|null;reason?:string};
 /** the largest displacement of any cup in the tray frame within a trailing window, the reading a creep stays under; judged by the thresholds */maxLoadSlipM:{available:boolean;value:number|null};
 /** the largest displacement from where a cup started over the whole run: includes the soft-friction creep of the engine; reported, judged by nothing */cumulativeDriftM:number;
 slipLevel:'none'|'warn'|'fail';accelerationLimitMps2:number;maxSupportAccelerationMps2:number|null;coulomb?:{muEffective:number;boundMps2:number;maxAccelerationMps2:number|null;verdict:SlipVerdict;onsetTick:number|null};
 person?:{contactTicks:number[];stoppedTicks:number;firstStopTick:number|null;lastStopTick:number|null;resumedTick:number|null};verdicts:Verdict[]}
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
 say('NO_FALSE_SERVE',f.served==='0'||done,`served ${f.served}, status ${f.status}`);
 // A, A-prime and D must finish their mission; B and C stress the plant, and a mission that ends in attention there is the result (with its reasons), not a failure of the oracle
 if(['tray-nominal-v1','tray-low-friction-v1','tray-person-crossing-v1'].includes(f.experimentId))say('SERVED_ALL',done&&f.served==='3',`status ${f.status}, served ${f.served}`);
 else say('MISSION_OUTCOME',done?true:null,`status ${f.status}, served ${f.served}${f.attention.length?`, attention ${[...new Set(f.attention)].join(',')}`:''}`);
 const out:TrayRunSummary={experimentId:f.experimentId,status:f.status,served:f.served,ticks:f.tick,serviceTimeS,maxLoadSlipM:{available:true,value:windowSlip},cumulativeDriftM:drift,slipLevel,accelerationLimitMps2:f.accelerationLimitMps2,maxSupportAccelerationMps2:maxAccel,verdicts};
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
  // a stop for the person: the base nearly still for a while with the person within NEAR_M of it
  const still:number[]=[];
  for(let t=1;t<f.records.length-1;t++){const p=pos(f.records[t]!),q=f.personAt(t),v=speedAt(f.records,t);if(p&&q&&v!==null&&v<STOP_MPS&&Math.hypot(p[0]!-q.x,p[1]!-q.y)<=NEAR_M)still.push(t);}
  const stoppedTicks=still.length,firstStop=still[0]??null,lastStop=still.at(-1)??null;
  let resumed:number|null=null;
  if(lastStop!==null)for(let t=lastStop+1;t<f.records.length-1;t++){const v=speedAt(f.records,t);if(v!==null&&v>0.1){resumed=t;break;}}
  out.person={contactTicks,stoppedTicks,firstStopTick:firstStop,lastStopTick:lastStop,resumedTick:resumed};
  say('NO_PROXY_CONTACT',!contactTicks.length,contactTicks.length?`contact with the person at ticks ${contactTicks.slice(0,5).join(',')}`:'no contact between the robot and the person');
  say('STOPPED_FOR_PERSON',stoppedTicks>=MIN_STOP_TICKS,`${stoppedTicks} ticks nearly still with the person within ${NEAR_M} m`);
  say('RESUMED_AFTER_PASS',resumed!==null&&done,resumed===null?'the robot did not move again after the stop':`moved again at tick ${resumed}`);
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
