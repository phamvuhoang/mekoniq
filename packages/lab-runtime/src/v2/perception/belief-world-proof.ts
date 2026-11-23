/** Check the estimator's sparse publication schedule against retained native observations.
 * Nothing observable before birth is legitimate; a missing due publication is not. */
import type {BeliefRecord,LabWorldSceneV1,PerceptionProfileV1,WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import type {RunReport} from '../report';
import {composePose,invertPose} from '../frames';
import {hashJson} from '../hash';
import {scoreBeliefAttempts} from './belief-integrity';
const same=(a:unknown,b:unknown)=>hashJson(a as never)===hashJson(b as never);
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
/** Called with the same verified world capture that materializes arm/world reports.
 * No second native read and no per-tick I/O are added to the simulation loop. */
export function bindPerceptionWorld(report:RunReport,world:{records:WorldEvidenceRecord[];admission:{scene:LabWorldSceneV1}}){
 const e=report.perceptionEvidence;if(!e)return;
 const p=e.policy,c=e.coverage,pm=report.manifest.perception,h=report.outcome.tick;
 try{
  if(!p||!pm||!same(pm.profile,{id:p.profile.id,revision:p.profile.revision,digest:p.profile.digest,sha256:p.profileSha256}))throw Error('BELIEF_POLICY_IDENTITY');
  if(!c||!c.prefixCovered||c.firstTick!==0||c.lastTick!==h)throw Error('BELIEF_WORLD_COVERAGE');
  e.issues.push(...beliefPublicationIssues(e.beliefs,p.profile,world.records,world.admission.scene,h));
  e.attemptRecords=scoreBeliefAttempts(e.attemptRecords,nativeBeliefTruth(world.records,world.admission.scene));
  e.attempts=[...new Map(e.attemptRecords.map(a=>[a.attemptId,a])).values()];
 }catch(error){e.issues.push((error as Error).message);}
 e.issues=[...new Set(e.issues)];if(e.issues.length){e.complete=false;if(c)c.prefixCovered=false;}
}

export {registeredBeliefPolicy} from './belief-policy';
export {displayedBeliefAt} from './belief-display';
export {beliefDecisionIssues,scoreBeliefAttempts} from './belief-integrity';
export {validateBeliefRecordShape,validateGraspAttemptShape,validateRecoveryStepShape} from './perception-contracts';
