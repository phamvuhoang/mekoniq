import {hashJson} from '../hash';
import {scenarioRegistry,scenarioHash,resolveRoles} from '../scenario-registry';
import type {BusinessEvent} from '../report';
import type {EngineeringProject} from '../../engineering/contracts';
import {verifiedSimulationInput,type SimulationRunInput,type StudyRef} from './simulation-input';
import {navigationMetrics} from '../navigation2d/evidence';
import {studyTrajectory} from './study-navigation';
export interface EquivalenceRef {id:string;sha256:string}
export interface SemanticStudyInput {equivalence:Record<'model'|'world'|'task'|'commonProjection',EquivalenceRef>;runs:(SimulationRunInput&{commonProjection:EquivalenceRef})[];invariantPolicy:{id:string;revision:number}}
export interface StudyInvariant {runId:string;id:string;status:'pass'|'fail'|'not_run';reasonCodes:string[];tick:number|null}
export interface SemanticStudyV1 {schemaVersion:1;documentType:'semantic-study';accepted:false;status:'complete'|'incomparable'|'failed';reasonCodes:string[];equivalence:SemanticStudyInput['equivalence'];invariantPolicy:SemanticStudyInput['invariantPolicy'];runs:{runId:string;engine:string;reportRef:StudyRef;artifactRefs:StudyRef[];sceneDigest:string;modelDigest:string;firstTick:number;lastTick:number;replay:{runId:string;tick:number}}[];invariants:StudyInvariant[];differences:{runId:string;dimension:string;value:number|null;unit:string;status:'observed'|'unavailable';reason:string|null}[];unsupportedDimensions:{engine:string;dimension:string;status:'unsupported';reason:string}[];percentiles:null;limitations:string[]}
const ref=(id:string,v:unknown):EquivalenceRef=>({id,sha256:hashJson(v)});
/** Common planar projection includes every model field except its explicitly derived input identities. */
export function semanticEquivalence(input:SimulationRunInput):SemanticStudyInput['equivalence']{
 const {scene,report,project}=verifiedSimulationInput(input),robot=scene.robots[0]!,{inputs:_inputs,modelDigest:_digest,physicalModelDigest:_physical,...model}=robot.model;void _inputs;void _digest;void _physical;
 const scenario=scenarioRegistry.get(report.manifest.scenario.id),base=report.manifest.scenario.basedOn;
 if(!scenario||base?.id!=='FD01'||base.revision!==1||scenarioHash(scenario)!==report.manifest.scenario.hash||scenario.confirm.mode!=='scripted'||scene.actors.length||scene.zones.length||robot.model.sensors.some(s=>s.noise.stddevM!==0||s.noise.distribution!=='none')||scene.clock.tickMs!==20||report.manifest.simulationPerturbation)throw Error('INPUTS_NOT_EQUIVALENT');
 if(scene.engine.id==='mujoco_3d'&&(scene.engine.loadProfileRef.id!=='empty'||scene.engine.physicsProfileRef.id!=='serve-drive-contact-v1'))throw Error('INPUTS_NOT_EQUIVALENT');
 const task={basedOn:base,orders:scenario.orders,confirm:scenario.confirm,park:scenario.park,roles:resolveRoles(scenario,(project as unknown as EngineeringProject).runtimeProject),seed:report.manifest.seed,controller:report.navigation2d!.controller,policy:scene.policy};
 const common={model,world:scene.world,initialPoseMap:robot.initialPoseMap,goals:robot.targetBindings,clock:scene.clock,task,noise:'off',load:'empty',actors:[]};
 return {model:ref('serve-empty-geometric-v1',model),world:ref(scene.world.id,scene.world),task:ref('FD01-scripted-v1',task),commonProjection:ref('serve-empty-fd01-planar-v1',common)};
}
const before=(a:BusinessEvent,b:BusinessEvent)=>Date.parse(a.at)<=Date.parse(b.at)&&BigInt(a.sequence)<=BigInt(b.sequence);
function sourceInvariants(v:ReturnType<typeof verifiedSimulationInput>):StudyInvariant[]{
 const r=v.report,n=r.navigation2d!,rows:StudyInvariant[]=[],tick=(e:BusinessEvent)=>Math.round((Date.parse(e.at)-n.clock.businessEpochMs)/20);
 const result=(id:string,ok:boolean,reasons:string[],at:number|null)=>rows.push({runId:r.manifest.runId,id,status:ok?'pass':'fail',reasonCodes:reasons,tick:at});
 const arrivals=r.businessEvents.filter(e=>e.type==='MissionArrived'),confirmations=r.businessEvents.filter(e=>['CargoLoaded','DeliveryHandedOff','CargoReturned'].includes(e.type)),handoffs=confirmations.filter(e=>e.type==='DeliveryHandedOff'),served=r.businessEvents.filter(e=>e.kind==='fulfillment'&&BigInt(String(e.state.served??'0'))>0n);
 let bad:BusinessEvent|undefined;
 for(const c of confirmations){const arrival=arrivals.find(a=>before(a,c)&&a.id===c.state.missionId&&Array.isArray(a.state.stops)&&a.state.stops.some(s=>s&&typeof s==='object'&&!Array.isArray(s)&&Array.isArray(s.allocationIds)&&s.allocationIds.includes(c.id)&&s.status==='awaiting_action'&&s.action===({CargoLoaded:'load',DeliveryHandedOff:'handoff',CargoReturned:'return'} as Record<string,string>)[c.type]));if(!arrival){bad=c;break;}const action=({CargoLoaded:'load',DeliveryHandedOff:'handoff',CargoReturned:'return'} as Record<string,string>)[c.type]!,stop=(arrival.state.stops as unknown as {id:string;action:string;allocationIds:string[];status:string}[]).find(s=>s.action===action&&s.status==='awaiting_action'&&s.allocationIds.includes(c.id))!;if(tick(c)-tick(arrival)!==scenarioRegistry.get(r.manifest.scenario.id)!.confirm.delayTicks||!r.confirmations.some(x=>x.subjectId===stop.id&&x.confirmationType===action&&x.provenance==='scripted'&&x.tick===tick(c))){bad=c;break;}}
 for(const s of served)if(!handoffs.some(h=>h.state.lineId===s.id&&before(h,s))){bad=s;break;}
 const complete=r.outcome.status==='completed',causal=!bad&&(!complete||arrivals.length>0&&handoffs.length>0&&served.length>0&&r.outcome.served==='1');
 result('arrival-confirmation-served',causal,causal?[]:['SOURCE_CAUSAL_RELATION_FAILED'],bad?tick(bad):null);
 const unknown=r.businessEvents.filter(e=>e.type==='RobotCommandObserved'&&e.state.status==='unknown');
 const duplicate=r.effects.some(e=>e.type==='robot.execute'&&e.attempts>1)||unknown.some(u=>r.businessEvents.some(e=>e.type==='RobotCommandIssued'&&(e.id===u.id||typeof u.state.missionId==='string'&&e.state.missionId===u.state.missionId)&&before(u,e)&&e!==u));
 result('unknown-no-redispatch',!duplicate,duplicate?['DISPATCH_AFTER_UNKNOWN']:[],unknown[0]?tick(unknown[0]):null);if(!unknown.length&&!duplicate)Object.assign(rows.at(-1)!,{status:'not_run',reasonCodes:['NO_UNKNOWN_TRIGGER']});
 const cancel=r.businessEvents.filter(e=>e.type==='MissionCancelled'),requests=r.businessEvents.filter(e=>e.type==='MissionCancellationRequested');
 const invalidCancel=cancel.find(c=>!requests.some(x=>x.id===c.id&&before(x,c)));
 result('cancel-causality',!invalidCancel,invalidCancel?['CANCEL_WITHOUT_REQUEST']:[],invalidCancel?tick(invalidCancel):null);if(!requests.length&&!cancel.length)Object.assign(rows.at(-1)!,{status:'not_run',reasonCodes:['NO_CANCEL_TRIGGER']});
 return rows;
}
/** Cross-engine differences are observations. Only a registered input/scenario constraint can fail this study. */
export function buildSemanticStudy(input:SemanticStudyInput):SemanticStudyV1{
 const out:SemanticStudyV1={schemaVersion:1,documentType:'semantic-study',accepted:false,status:'complete',reasonCodes:[],equivalence:input.equivalence,invariantPolicy:input.invariantPolicy,runs:[],invariants:[],differences:[],unsupportedDimensions:[],percentiles:null,limitations:['not_calibrated; no measured ground truth or engine-accuracy winner.','One run per engine; no statistical p50/p95, performance ranking or uncertainty estimate.','Same seed does not imply the same engine noise stream; this study disables noise and stochastic actors.','Source journal governs mission, confirmation and served; the trajectory supplies drive geometry only.','Nominal runs do not exercise cancellation or unknown-ACK handling; absent triggers are not_run.','Contact, slip and tipping are unsupported by IR-SIM. Byte hashes establish input integrity, not producer trust or human acceptance.']};
 const incomparable=(reason:string)=>{out.status='incomparable';out.reasonCodes.push('INPUTS_NOT_EQUIVALENT',reason);};
 if(input.runs.length<2||input.runs.length>3||input.invariantPolicy.id!=='fd01-source-causal-v1'||input.invariantPolicy.revision!==1)incomparable('STUDY_POLICY_UNSUPPORTED');
 const engines=new Set<string>(),ids=new Set<string>();
 for(const run of input.runs){try{
  const v=verifiedSimulationInput(run),equivalence=semanticEquivalence(run),r=v.report,engine=v.scene.engine.id;
  if(hashJson(equivalence)!==hashJson(input.equivalence)||hashJson(run.commonProjection)!==hashJson(equivalence.commonProjection)||engines.has(engine)||ids.has(r.manifest.runId)){incomparable('EQUIVALENCE_BINDING_MISMATCH');continue;}
  engines.add(engine);ids.add(r.manifest.runId);
  const trajectory=studyTrajectory(v),robot=v.scene.robots[0]!,replay={runId:r.manifest.runId,tick:r.outcome.tick};
  out.runs.push({runId:r.manifest.runId,engine,reportRef:run.report.ref,artifactRefs:run.artifacts.map(a=>a.ref),sceneDigest:v.scene.sceneDigest,modelDigest:robot.model.modelDigest,firstTick:0,lastTick:r.outcome.tick,replay});
  out.invariants.push(...sourceInvariants(v));
  const boundGoals=robot.targetBindings,arrivals=r.businessEvents.filter(e=>e.type==='MissionArrived'),errors:number[]=[],windowErrors:number[]=[];let unbound=false,arrivalViolation=false;const policy=v.scene.policy.parameters;
  for(const arrival of arrivals){const stops=arrival.state.stops as unknown as {targetId:string;status:string}[]|undefined;const stop=stops?.find(s=>s.status==='awaiting_action'),goal=boundGoals.find(g=>g.pointId===stop?.targetId);if(!goal){unbound=true;continue;}const tick=Math.round((Date.parse(arrival.at)-r.navigation2d!.clock.businessEpochMs)/20),pose=trajectory[tick]?.robots.find(x=>x.robotId===robot.robotId)?.poseDriveMap;if(!pose){unbound=true;continue;}errors.push(Math.hypot(pose[0]-goal.x,pose[1]-goal.y));const hold=trajectory.slice(Math.max(0,tick-policy.arrivalHoldTicks+1),tick+1);if(hold.length!==policy.arrivalHoldTicks)arrivalViolation=true;for(const row of hold){const observed=row.robots.find(x=>x.robotId===robot.robotId)!;const error=Math.hypot(observed.poseDriveMap[0]-goal.x,observed.poseDriveMap[1]-goal.y),yaw=Math.abs(Math.atan2(Math.sin(observed.poseDriveMap[2]-goal.yaw),Math.cos(observed.poseDriveMap[2]-goal.yaw)));windowErrors.push(error);if(error>policy.goalPositionToleranceM||yaw>policy.goalYawToleranceRad||Math.abs(observed.bodyVelocity[0])>policy.stoppedLinearMps||Math.abs(observed.bodyVelocity[1])>policy.stoppedAngularRadps)arrivalViolation=true;}}
  out.invariants.push({runId:r.manifest.runId,id:'goal-frame-world-bindings',status:unbound?'fail':'pass',reasonCodes:unbound?['GOAL_BINDING_MISMATCH']:[],tick:null});
  out.invariants.push({runId:r.manifest.runId,id:'arrival-policy-window',status:unbound||arrivalViolation?'fail':arrivals.length?'pass':'not_run',reasonCodes:unbound||arrivalViolation?['ARRIVAL_POLICY_VIOLATION']:arrivals.length?[]:['NO_ARRIVAL_TRIGGER'],tick:null});
  // No extra corridor tolerance is invented. The registered policy's safety envelope is the constraint.
  const geometry=navigationMetrics(v.scene,{trajectory,control:[],sensors:[],collisions:[],issues:[],gaps:[],horizon:r.outcome.tick,complete:true,reasons:[],terminal:null,text:{trajectory:'',control:'',sensors:'',collisions:''}});
  const constraintFailure=geometry.coverage!=='complete'||(geometry.collisionEpisodes??0)>0;
  out.invariants.push({runId:r.manifest.runId,id:'registered-navigation-constraints',status:constraintFailure?'fail':'pass',reasonCodes:constraintFailure?['REGISTERED_NAVIGATION_CONSTRAINT_FAILED']:[],tick:null});
  out.differences.push({runId:r.manifest.runId,dimension:'arrivalGoalErrorMaxM',value:errors.length?Math.max(...errors):null,unit:'m',status:errors.length?'observed':'unavailable',reason:errors.length?null:'NO_BOUND_ARRIVAL'},
   {runId:r.manifest.runId,dimension:'driveDistanceM',value:geometry.driveDistanceM?.[robot.robotId]??null,unit:'m',status:geometry.driveDistanceM?'observed':'unavailable',reason:geometry.driveDistanceM?null:'NO_VERIFIED_DISTANCE'},
   {runId:r.manifest.runId,dimension:'minObstacleClearanceM',value:geometry.minClearanceM??null,unit:'m',status:geometry.minClearanceM!=null?'observed':'unavailable',reason:geometry.minClearanceM!=null?null:'NO_VERIFIED_CLEARANCE'});
  out.differences.push({runId:r.manifest.runId,dimension:'arrivalWindowPositionErrorMaxM',value:windowErrors.length?Math.max(...windowErrors):null,unit:'m',status:windowErrors.length?'observed':'unavailable',reason:windowErrors.length?null:'NO_BOUND_ARRIVAL'});
  const limits=`Arrival measurement: drive-frame pose at Source MissionArrived; acceptance checks that tick and preceding ${policy.arrivalHoldTicks-1} recorded ticks against bound policy position ${policy.goalPositionToleranceM} m, yaw ${policy.goalYawToleranceRad} rad, stopped linear ${policy.stoppedLinearMps} m/s and angular ${policy.stoppedAngularRadps} rad/s. Cross-engine differences within these constraints do not imply an accuracy winner.`;if(!out.limitations.includes(limits))out.limitations.push(limits);
  if(engine==='irsim_2d')for(const dimension of ['contact','slip','tipping'])out.unsupportedDimensions.push({engine,dimension,status:'unsupported',reason:'PLANAR_KINEMATICS_NO_CONTACT_DYNAMICS'});
 }catch(e){incomparable(e instanceof Error?e.message:'EVIDENCE_INVALID');}}
 if(out.status!=='incomparable'&&out.invariants.some(i=>i.status==='fail')){out.status='failed';out.reasonCodes.push('SCENARIO_INVARIANT_FAILED');}
 out.reasonCodes=[...new Set(out.reasonCodes)];return out;
}
