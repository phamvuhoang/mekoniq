// Rehashed attempt records must still be the actual published decision and native XY score.
import {afterEach,expect,test} from 'vitest';
import {join} from 'node:path';
import {readBeliefEvidence,readBeliefManifest} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
import {buildPerceptionReport} from '../../packages/lab-runtime/src/v2/perception/perception-report';
import {bindPerceptionWorld} from '../../packages/lab-runtime/src/v2/perception/belief-world-proof';
import {verifyPerceptionStudy} from '../../packages/lab-runtime/src/v2/perception/perception-study';
import {displayedBeliefAt} from '../../packages/lab-runtime/src/v2/perception/belief-display';
import {rm} from 'node:fs/promises';
import {studyFixture} from '../support/pick-rig';
import {readPickRigEvidence} from '../../packages/lab-runtime/src/v2/perception/pick-rig-evidence';
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const fixture=async()=>{const h=await studyFixture();dirs.push(h.root);return h;};
test('the actual published belief and native XY decision score are accepted',async()=>{
 const h=await fixture();expect(await readPickRigEvidence(h.directory,h.input,h.report)).toMatchObject({beliefErrorAtCommitM:0,outcome:'lifted'});
});
test.each(['removed','pose','age','observed_future','published_future','invalid','object','source','score','outcome_score','outcome_belief','outcome_decision'])('a rehashed %s attempt cannot invent evidence or a score',async mutation=>{
 const h=await fixture();for(const a of h.attempts){
  if(mutation==='removed')a.beliefUsed=null;
  if(mutation==='pose')a.beliefUsed!.positionM[0]+=.01;
  if(mutation==='age')a.beliefUsed!.ageTicks=49;
  if(mutation==='observed_future')a.beliefUsed!.observedTick=100;
  if(mutation==='published_future')a.beliefUsed!.publishedTick=100;
  if(mutation==='invalid')a.beliefUsed!.valid=false;
  if(mutation==='object')a.beliefUsed!.objectId='cup-2';
  if(mutation==='source')a.beliefUsed!.source='pose_estimator_sim';
  if(mutation==='score'||mutation==='outcome_score'&&a.stage==='outcome')a.beliefErrorAtCommitM=100;
  if(mutation==='outcome_belief'&&a.stage==='outcome')a.beliefUsed=structuredClone(h.beliefs[5]!.belief!);
  if(mutation==='outcome_decision'&&a.stage==='outcome')a.decidedTick=6;
 }
 await h.write();await expect(readPickRigEvidence(h.directory,h.input,h.report)).rejects.toThrow(/BELIEF_/);
});
test('the scalar score is checked at the commit tick, not at the outcome or observation tick',async()=>{
 const h=await fixture();for(const a of h.attempts)if(a.stage!=='plan')a.beliefErrorAtCommitM=.01;
 await h.write();await expect(readPickRigEvidence(h.directory,h.input,h.report)).rejects.toThrow(/BELIEF_/);
});

test.each(['wrong_profile_age','wrong_profile_source','publication_future'])('the shared reader rejects %s even if every attempt copy is changed together',async mode=>{
 const h=await fixture();if(mode==='wrong_profile_age')for(const a of h.attempts){a.decidedTick=100;a.recordedTick=100;a.beliefUsed!.ageTicks=100-a.beliefUsed!.publishedTick;}
 if(mode==='wrong_profile_source'){for(const r of h.beliefs)r.belief!.source='pose_estimator_sim';for(const a of h.attempts)a.beliefUsed!.source='pose_estimator_sim';}
 if(mode==='publication_future'){for(const r of h.beliefs)r.belief!.observedTick=r.tick+1;for(const a of h.attempts)a.beliefUsed!.observedTick=a.beliefUsed!.publishedTick+1;}
 await h.write();await expect(readPickRigEvidence(h.directory,h.input,h.report)).rejects.toThrow(/BELIEF_/);
});

test('published coverage and native observation scores are bound to the same world prefix',async()=>{
 const h=await fixture();h.report.perceptionEvidence=await buildPerceptionReport(join(h.run,'belief-evidence'));bindPerceptionWorld(h.report,{records:h.records,admission:h.admission});
 expect(h.report.perceptionEvidence).toMatchObject({issues:[],coverage:{firstTick:0,lastTick:30,prefixCovered:true,streamFinalized:true}});
 h.report.perceptionEvidence.beliefs.splice(10,1);bindPerceptionWorld(h.report,{records:h.records,admission:h.admission});
 expect(h.report.perceptionEvidence.issues).toContain('BELIEF_PUBLICATION_COVERAGE');expect(h.report.perceptionEvidence.coverage?.prefixCovered).toBe(false);
});
test('an explicit diagnostic bias is verified exactly and cannot qualify as a registered study',async()=>{
 const h=await fixture();h.input.transientBias={vectorM:[.01,0],attempts:1};for(const a of h.attempts){a.beliefUsed!.positionM[0]+=.01;a.beliefErrorAtCommitM=.01;}await h.write();
 expect((await readPickRigEvidence(h.directory,h.input,h.report)).beliefErrorAtCommitM).toBeCloseTo(.01,12);
 expect((await verifyPerceptionStudy(h.root,'truth-0')).issues.join()).toContain('RUN_INPUT_NOT_REGISTERED');
 for(const a of h.attempts)a.beliefUsed!.positionM[0]+=.01;await h.write();await expect(readPickRigEvidence(h.directory,h.input,h.report)).rejects.toThrow('BELIEF_ATTEMPT_REFERENCE_MISMATCH');
});

test('a last-row replacement cannot present an already lifted outcome as a new standalone decision',async()=>{
 const h=await fixture(),a=h.attempts.at(-1)!;a.stage='commit';a.decidedTick=30;a.beliefUsed=structuredClone(h.beliefs.at(-1)!.belief!);h.attempts.splice(0,2);await h.write();
 await expect(readPickRigEvidence(h.directory,h.input,h.report)).rejects.toThrow('BELIEF_ATTEMPT_DECISION_MISMATCH');
});
test('a refusal before any usable publication stays null, but a refusal cannot hide a usable belief',async()=>{
 const h=await fixture(),a=h.attempts[0]!;h.attempts.splice(1);Object.assign(a,{beliefUsed:null,beliefErrorAtCommitM:null,refusal:'BELIEF_UNAVAILABLE',outcome:'refused',gates:{belief:'BELIEF_UNAVAILABLE',region:'not_evaluated',ik:'not_evaluated',sweep:'not_evaluated'}});
 const dir=join(h.run,'belief-evidence');await h.write();expect((await readBeliefEvidence(dir,await readBeliefManifest(dir))).issues).toContain('BELIEF_REFUSAL_INVALID');
 a.decidedTick=0;a.recordedTick=0;await h.write();expect((await readBeliefEvidence(dir,await readBeliefManifest(dir))).issues).toEqual([]);
});

test('cursor availability uses the publication age boundary and requires a finite covered cursor range',async()=>{
 const h=await fixture(),e=await buildPerceptionReport(join(h.run,'belief-evidence'));e.beliefs=e.beliefs.filter(r=>r.tick===20);e.beliefs[0]!.belief!.observedTick=15;e.coverage!.lastTick=100;
 expect(displayedBeliefAt(e,'cup-1',19)).toBeNull();expect(displayedBeliefAt(e,'cup-1',70)?.ageTicks).toBe(50);expect(displayedBeliefAt(e,'cup-1',71)).toBeNull();
 e.coverage!.lastTick=Number.NaN;expect(displayedBeliefAt(e,'cup-1',20)).toBeNull();
});
