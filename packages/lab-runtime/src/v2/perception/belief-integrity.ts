/** Decision evidence is an exact published estimate with age recomputed at the decision.
 * The controller retains the last non-null estimate across missing observations; display
 * clears are deliberately stricter and live in belief-display.ts. No PRNG is replayed here. */
import type {BeliefEvidenceManifestV1,BeliefRecord,GraspAttempt,PerceptionProfileV1} from '../../../../contracts/generated/navigation2d';
import {hashJson} from '../hash';
const same=(a:unknown,b:unknown)=>hashJson(a as never)===hashJson(b as never);
export function beliefDecisionIssues(beliefs:readonly BeliefRecord[],attempts:readonly GraspAttempt[],identity:BeliefEvidenceManifestV1['identity'],profile?:PerceptionProfileV1){
 const issues=new Set<string>(),last=new Map<string,number>(),decisions=new Map<string,GraspAttempt>();
 for(const r of beliefs){
  const b=r.belief;
  if(r.tick<=(last.get(r.objectId)??-1)||b&&(b.objectId!==r.objectId||b.publishedTick!==r.tick||b.observedTick>b.publishedTick||b.ageTicks!==0||b.frameId!=='arm-base'||!b.positionM.every(Number.isFinite)))issues.add('BELIEF_PUBLICATION_INVALID');
  if(profile&&b&&(b.observedTick!==r.tick-profile.latencyTicks||r.tick%profile.updateEveryTicks!==0||!same(b.sigmaM,[...profile.sigmaM,0])||b.source!==(profile.biasM.every(x=>x===0)&&profile.sigmaM.every(x=>x===0)&&profile.latencyTicks===0&&profile.dropoutProbability===0?'ground_truth':'pose_estimator_sim')))issues.add('BELIEF_PROFILE_MISMATCH');
  last.set(r.objectId,r.tick);
 }
 for(const a of attempts){
  const previous=decisions.get(a.attemptId),tick=a.recordedTick??a.decidedTick,published=beliefs.filter(r=>r.objectId===a.cupId&&r.tick<=a.decidedTick&&r.belief).at(-1)?.belief;
  if(a.gates.belief==='pass'&&!a.stage||a.stage!=='outcome'&&!['unknown','refused'].includes(a.outcome))issues.add('BELIEF_ATTEMPT_DECISION_MISMATCH');
  if(a.mode!==identity.graspMode||a.attemptId!==`${a.cupId}#${a.index}`||tick<a.decidedTick)issues.add('BELIEF_ATTEMPT_IDENTITY');
  if(a.stage==='outcome'){
   if(!previous||previous.stage==='outcome'||previous.outcome!=='unknown'||tick<(previous.recordedTick??previous.decidedTick)||!same({...previous,stage:'outcome',recordedTick:tick,outcome:a.outcome},a))issues.add('BELIEF_ATTEMPT_DECISION_MISMATCH');
  }else if(a.stage&&tick!==a.decidedTick||previous&&(a.stage!=='commit'||previous.stage!=='plan'||previous.outcome!=='unknown'||a.decidedTick<previous.decidedTick||a.cupId!==previous.cupId||a.index!==previous.index))issues.add('BELIEF_ATTEMPT_DECISION_MISMATCH');
  decisions.set(a.attemptId,a);
  if(a.gates.belief!=='pass'){
   const usable=published?.valid&&(!profile||a.decidedTick-published.publishedTick<=profile.maxAgeTicks);
   if(usable||a.gates.belief==='BELIEF_STALE'&&(!published?.valid||!profile||a.decidedTick-published.publishedTick<=profile.maxAgeTicks))issues.add('BELIEF_REFUSAL_INVALID');
   if(a.beliefUsed!==null||a.beliefErrorAtCommitM!==null||a.outcome!=='refused'||!['BELIEF_UNAVAILABLE','BELIEF_STALE'].includes(a.gates.belief)||a.refusal!==a.gates.belief||['region','ik','sweep'].some(k=>a.gates[k as keyof GraspAttempt['gates']]!=='not_evaluated'))issues.add('BELIEF_REFUSAL_INVALID');
   continue;
  }
  const b=a.beliefUsed;
  if(!b||!published||!beliefs.some(r=>r.belief?.objectId===b.objectId&&r.belief.observedTick===b.observedTick&&r.belief.publishedTick===b.publishedTick)){issues.add('BELIEF_ATTEMPT_REFERENCE_MISSING');continue;}
  const expected={...published,positionM:[...published.positionM],ageTicks:a.decidedTick-published.publishedTick};
  const bias=identity.diagnosticBias;if(bias&&a.index<bias.attempts){expected.positionM[0]!+=bias.vectorM[0];expected.positionM[1]!+=bias.vectorM[1];}
  if(!same(b,expected)||!b.valid||b.observedTick>b.publishedTick||b.publishedTick>a.decidedTick||profile&&b.ageTicks>profile.maxAgeTicks)issues.add('BELIEF_ATTEMPT_REFERENCE_MISMATCH');
 }
 return [...issues];
}
/** Native observations are transformed into the same arm frame as the controller.
 * A late outcome preserves the decision's score; it never rescores the lifted cup. */
export function scoreBeliefAttempts(attempts:readonly GraspAttempt[],truthAt:(cupId:string,tick:number)=>readonly number[]|undefined):GraspAttempt[]{
 return attempts.map(a=>{
  if(!a.beliefUsed)return structuredClone(a);
  const p=truthAt(a.cupId,a.decidedTick),b=a.beliefUsed;
  if(!p||p.length!==3||!p.every(Number.isFinite))throw Error('BELIEF_NATIVE_TRUTH_MISSING');
  const error=Math.hypot(b.positionM[0]-p[0]!,b.positionM[1]-p[1]!);
  if(a.beliefErrorAtCommitM===null||Math.abs(error-a.beliefErrorAtCommitM)>1e-12)throw Error('BELIEF_NATIVE_SCORE_MISMATCH');
  return {...structuredClone(a),beliefErrorAtCommitM:error};
 });
}
