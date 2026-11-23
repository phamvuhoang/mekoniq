/** Check the estimator's sparse publication schedule against retained native observations.
 * Nothing observable before birth is legitimate; a missing due publication is not. */
import type {BeliefRecord,GraspAttempt,RecoveryStep,LabWorldSceneV1,PerceptionProfileV1,WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import type {ArmProgramSet} from '../../../../cell-adapters/src/mock-arm';
import {quinticSegment} from '../../../../cell-adapters/src/arm-motion';
import {XARM6_SI} from '../models/arm-kinematics';
import {worldDocument} from '../simulation3d/world-control';
import type {RunReport} from '../report';
import {composePose,invertPose} from '../frames';
import {hashJson} from '../hash';
import {scoreBeliefAttempts} from './belief-integrity';
const same=(a:unknown,b:unknown)=>hashJson(a as never)===hashJson(b as never);
export function invalidatePerceptionWorld(report:RunReport){const e=report.perceptionEvidence;if(!e)return;e.issues=[...new Set([...e.issues,'BELIEF_WORLD_COVERAGE'])];e.complete=false;if(e.coverage)e.coverage.prefixCovered=false;}
export function nativeBeliefTruth(records:readonly WorldEvidenceRecord[],scene:LabWorldSceneV1){
 const inverse=invertPose(scene.armCell.arm.baseInMap);
 return (cupId:string,tick:number)=>{const id=scene.propBindings.find(b=>b.cupId===cupId)?.propId,p=records[tick]?.snapshot.props?.find(p=>p.propId===id);return p?composePose(inverse,{position:p.position,quaternionXyzw:p.quaternionXyzw}).position:undefined;};
}
export function beliefPublicationIssues(beliefs:readonly BeliefRecord[],profile:PerceptionProfileV1,records:readonly WorldEvidenceRecord[],scene:LabWorldSceneV1,horizon:number){
 const issues=new Set<string>(),truth=nativeBeliefTruth(records,scene),expected=new Set<string>(),keys=new Set<string>();
 if(records.length!==horizon+1||records.some((r,t)=>r.snapshot.tick!==t))return ['BELIEF_WORLD_COVERAGE'];
 for(const b of scene.propBindings)for(let t=profile.updateEveryTicks;t<=horizon;t+=profile.updateEveryTicks)if(t-profile.latencyTicks>=1&&truth(b.cupId,t-profile.latencyTicks))expected.add(`${b.cupId}|${t}`);
 for(const r of beliefs){
  const key=`${r.objectId}|${r.tick}`,at=truth(r.objectId,r.tick-profile.latencyTicks);
  if(keys.has(key)||!expected.has(key)||!at||at.some((v,i)=>Math.abs(v-r.truthAtObservedTick[i]!)>1e-10))issues.add('BELIEF_PUBLICATION_COVERAGE');keys.add(key);
  if(r.belief&&at){const error=Math.hypot(r.belief.positionM[0]-at[0]!,r.belief.positionM[1]-at[1]!);if(r.errorM===null||Math.abs(error-r.errorM)>1e-12)issues.add('BELIEF_OBSERVATION_SCORE_MISMATCH');}
  else if(r.errorM!==null)issues.add('BELIEF_OBSERVATION_SCORE_MISMATCH');
 }
 if(keys.size!==expected.size||[...expected].some(k=>!keys.has(k)))issues.add('BELIEF_PUBLICATION_COVERAGE');
 return [...issues];
}
/** Derive commits from native commands, never from the attempt's stage label alone.
 * mujocoWorldPorts observes, then calls setCommitPlan. That only sets ready/committed:
 * the next command still holds pickApproach; its observation advances the program;
 * the next command is the first pick target. These are two distinct controller
 * boundaries, not a guessed timing allowance. A prefix before either is pending.
 * The admitted generator and the recorded pick waypoint must reproduce every target
 * of that descent. No dynamics, estimator random draws or runtime thresholds change. */
export function verifyBeliefNativeCommits(attempts:readonly GraspAttempt[],recovery:readonly RecoveryStep[],records:readonly WorldEvidenceRecord[],scene:LabWorldSceneV1,programs:ArmProgramSet){
 const fail=(why:string):never=>{throw Error('BELIEF_NATIVE_COMMIT_'+why);},verified=new Set<string>(),counts=new Map<string,number>(),commands=new Map<string,string>();
 const program=(r:WorldEvidenceRecord|undefined)=>r?.command?.worldControl?.program;
 const key=(p:NonNullable<ReturnType<typeof program>>)=>({commandId:p.commandId,payloadHash:p.payloadHash,controlEpoch:p.controlEpoch,cupId:p.cupId,transferId:p.transferId,sourceEventId:p.sourceEventId,programId:p.programId});
 const phase=(r:WorldEvidenceRecord|undefined,name:string)=>{const p=program(r);return p?.programId==='cup-pick'&&p.waypoint===name&&programs.choreography['cup-pick']?.[p.stage]?.waypoint===name;};
 const q=(r:WorldEvidenceRecord|undefined)=>r?.command?.jointTargets?.find(a=>a.armId===scene.armCell.arm.armId)?.positionsRad;
 const near=(a:readonly number[]|undefined,b:readonly number[]|undefined)=>!!a&&!!b&&a.length===XARM6_SI.links.length&&b.length===a.length&&a.every((v,i)=>Number.isFinite(v)&&Number.isFinite(b[i])&&Math.abs(v-b[i]!)<=1e-12);
 for(const [i,row]of records.entries()){
  const p=program(row);if(p?.programId!=='cup-pick')continue;
  if(programs.choreography['cup-pick']?.[p.stage]?.waypoint!==p.waypoint)fail('PHASE');
  if(!phase(row,'pick')||phase(records[i-1],'pick')&&same(key(p),key(program(records[i-1])!)))continue;
  const afterAcceptance=records[i-1],decision=records[i-2],index=counts.get(p.cupId)??0,id=`${p.cupId}#${index}`;counts.set(p.cupId,index+1);
  if(!phase(decision,'pickApproach')||!phase(afterAcceptance,'pickApproach')||!same(key(p),key(program(decision)!))||!same(key(p),key(program(afterAcceptance)!)))fail('PHASE');
  if(commands.has(p.cupId)&&commands.get(p.cupId)!==p.commandId)fail('IDENTITY');commands.set(p.cupId,p.commandId);
  const commit=attempts.find(a=>a.attemptId===id&&a.stage==='commit'),plan=attempts.find(a=>a.cupId===p.cupId&&a.index===0&&a.stage==='plan');
  if(!commit||commit.decidedTick!==decision!.snapshot.tick||commit.recordedTick!==commit.decidedTick||commit.outcome!=='unknown'||Object.values(commit.gates).some(g=>g!=='pass'))fail('DECISION');
  if(!plan||plan.decidedTick>commit!.decidedTick||!phase(records[plan.decidedTick],'pickApproach')||!same(key(p),key(program(records[plan.decidedTick])!)))fail('PLAN');
  if(index>0){const previous=attempts.find(a=>a.attemptId===`${p.cupId}#${index-1}`&&a.stage==='outcome');if(previous?.outcome!=='grip_not_established'||!recovery.some(r=>r.attemptId===previous.attemptId&&r.action==='retry_pick'&&r.result==='done'&&r.completedTick!==null&&r.completedTick>=(previous.recordedTick??previous.decidedTick)&&r.completedTick<commit!.decidedTick))fail('RETRY');}
  const from=q(decision),goal=commit!.waypointsRad?.pick,motion=programs.motion;
  if(!near(from,plan!.waypointsRad?.pickApproach)||!near(from,q(afterAcceptance))||!goal||motion.profile!=='quintic-sync-v1'||programs.modelId!==XARM6_SI.id)fail('TARGET');
  const m=motion as Extract<ArmProgramSet['motion'],{profile:'quintic-sync-v1'}>,segment=quinticSegment(from!,goal!,{maxVelocity:XARM6_SI.limits.map(l=>l.maxVelocity),maxAcceleration:m.maxAccelerationRadS2,speedFraction:m.speedFraction,dtS:.02});
  for(let j=i;j<records.length&&phase(records[j],'pick')&&same(key(p),key(program(records[j])!));j++)if(!near(q(records[j]),segment.at(j-i+1)))fail('TARGET');
  verified.add(id);
 }
 for(const a of attempts)if(['lifted','grip_not_established','cup_dropped'].includes(a.outcome)&&!verified.has(a.attemptId))fail('OUTCOME');
 return verified;
}
/** Called with the same verified world capture that materializes arm/world reports.
 * No second native read and no per-tick I/O are added to the simulation loop. */
export function bindPerceptionWorld(report:RunReport,world:{records:WorldEvidenceRecord[];admission:{scene:LabWorldSceneV1;files:ReadonlyMap<string,Uint8Array>}}){
 const e=report.perceptionEvidence;if(!e)return;
 const p=e.policy,c=e.coverage,pm=report.manifest.perception,h=report.outcome.tick;
 try{
  if(!p||!pm||!same(pm.profile,{id:p.profile.id,revision:p.profile.revision,digest:p.profile.digest,sha256:p.profileSha256}))throw Error('BELIEF_POLICY_IDENTITY');
  if(!c||!c.prefixCovered||c.firstTick!==0||c.lastTick!==h)throw Error('BELIEF_WORLD_COVERAGE');
  e.issues.push(...beliefPublicationIssues(e.beliefs,p.profile,world.records,world.admission.scene,h));
  verifyBeliefNativeCommits(e.attemptRecords,e.recovery,world.records,world.admission.scene,worldDocument<{programs:ArmProgramSet}>(world.admission.files,world.admission.scene.programsRef.path).programs);
  e.attemptRecords=scoreBeliefAttempts(e.attemptRecords,nativeBeliefTruth(world.records,world.admission.scene));
  e.attempts=[...new Map(e.attemptRecords.map(a=>[a.attemptId,a])).values()];
 }catch(error){e.issues.push((error as Error).message);}
 e.issues=[...new Set(e.issues)];if(e.issues.length){e.complete=false;if(c)c.prefixCovered=false;}
}

export {registeredBeliefPolicy} from './belief-policy';
export {displayedBeliefAt} from './belief-display';
export {beliefDecisionIssues,scoreBeliefAttempts} from './belief-integrity';
export {validateBeliefRecordShape,validateGraspAttemptShape,validateRecoveryStepShape} from './perception-contracts';
