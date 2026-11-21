// V11 / BEL01: the perception profile and the belief evidence contract. Every refusal first, then the fixtures that must validate.
import {readFileSync,readdirSync} from 'node:fs';
import {expect,test} from 'vitest';
import {sealDriveDocument} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {validateBeliefRecordShape,validateGraspAttemptShape,validateGraspRequest,validatePerceptionProfile,validateRecoveryStepShape} from '../../packages/lab-runtime/src/v2/perception/perception-contracts';
import {validateRunRequestV2} from '../../packages/lab-runtime/src/v2/contracts';
const DIR='robotics/simulation-mujoco/fixtures/perception-v1/';
const read=<T,>(name:string):T=>JSON.parse(readFileSync(DIR+name,'utf8')) as T;
const regions=read<{viewRegions:{id:string}[]}>('perception-regions-v1.json').viewRegions.map(r=>r.id);
const nominal=read<Record<string,unknown>>('perception-nominal-v1.json');
const codes=(v:unknown)=>validatePerceptionProfile(v,regions).reasonCodes;
const withField=(k:string,v:unknown)=>sealDriveDocument({...nominal,[k]:v});

test('every generated perception profile validates, the manifest hashes match the bytes',()=>{
 const profiles=readdirSync(DIR).filter(f=>/^perception-.*-v\d+\.json$/.test(f)&&f!=='perception-regions-v1.json');
 expect(profiles.length).toBeGreaterThanOrEqual(13);
 for(const f of profiles)expect(validatePerceptionProfile(read(f),regions),f).toEqual({ok:true,reasonCodes:[]});
});
test('a profile is refused for sigma or bias beyond 0.03 m, a dropout of 0.95, a period of 0, a max age of 0, a latency beyond 100',()=>{
 expect(codes(withField('sigmaM',[0.031,0]))).toContain('INVALID_FIELD');
 expect(codes(withField('biasM',[0,-0.031]))).toContain('INVALID_FIELD');
 expect(codes(withField('dropoutProbability',0.95))).toContain('INVALID_FIELD');
 expect(codes(withField('updateEveryTicks',0))).toContain('INVALID_FIELD');
 expect(codes(withField('maxAgeTicks',0))).toContain('INVALID_FIELD');
 expect(codes(withField('latencyTicks',101))).toContain('INVALID_FIELD');
});
test('a profile is refused for a view region the scene does not have, an unknown field, a wrong digest and a non-finite number',()=>{
 expect(codes(withField('visibleRegionId','tray'))).toContain('VIEW_REGION_UNKNOWN');
 expect(codes({...nominal,extra:1})).toContain('UNKNOWN_FIELD');
 expect(codes({...nominal,sigmaM:[0.001,0.001]})).toContain('DIGEST_MISMATCH');
 expect(codes(withField('sigmaM',[Number.NaN,0]))).toContain('NON_FINITE_NUMBER');
 expect(codes(withField('parameterSource','measured'))).toContain('INVALID_FIELD');
});
const ref={id:'perception-nominal-v1',revision:1,sha256:'a'.repeat(64),path:'perception-nominal-v1.json'};
test('the fixed program mode takes no perception profile, the belief modes need one, a recovery policy needs a belief mode',()=>{
 expect(validateGraspRequest({graspMode:'fixed_program',perceptionProfileId:ref.id}).reasonCodes).toContain('PERCEPTION_PROFILE_NOT_ALLOWED');
 expect(validateGraspRequest({graspMode:'fixed_program',recoveryPolicyId:'pick-recovery-v1'}).reasonCodes).toContain('RECOVERY_POLICY_NOT_ALLOWED');
 expect(validateGraspRequest({graspMode:'belief_estimated'}).reasonCodes).toContain('PERCEPTION_PROFILE_REQUIRED');
 expect(validateGraspRequest({graspMode:'belief_ground_truth',perceptionProfileId:ref.id}).reasonCodes).toContain('PERCEPTION_PROFILE_NOT_ALLOWED'); // ground truth is a mode, not a profile
 expect(validateGraspRequest({graspMode:'belief_estimated',perceptionProfileId:ref.id})).toEqual({ok:true,reasonCodes:[]});
 expect(validateGraspRequest({graspMode:'belief_ground_truth'})).toEqual({ok:true,reasonCodes:[]});
 expect(validateGraspRequest({})).toEqual({ok:true,reasonCodes:[]});
 expect(validateGraspRequest({perceptionProfileId:ref.id}).reasonCodes).toContain('PERCEPTION_PROFILE_NOT_ALLOWED');
});
const run=(extra:object,scenario='MJ-CELL-BV01',set='engineering-mujoco-cell-v1')=>validateRunRequestV2({scenarioId:scenario,scenarioRevision:1,seed:7,mode:'simulation',backendSetId:set,access:'simulated',runtimeIdentity:{sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64)},engineeringRef:{bundleDigest:'c'.repeat(64),projectDigest:'d'.repeat(64)},...extra} as never);
test('a belief grasp mode is admitted on the shared-world cell only; MJ-BV01 stays fixed_program (422)',()=>{
 const bad=run({graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1'},'MJ-BV01','engineering-mujoco-arm-v1');
 expect(bad.ok).toBe(false);if(!bad.ok)expect(bad.issues.map(i=>i.code)).toContain('GRASP_MODE_SCOPE_INVALID');
 const cell=run({graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1'});
 expect(cell.ok).toBe(true);
 const mixed=run({graspMode:'fixed_program',perceptionProfileId:'perception-nominal-v1'});
 expect(mixed.ok).toBe(false);if(!mixed.ok)expect(mixed.issues.map(i=>i.code)).toContain('PERCEPTION_PROFILE_NOT_ALLOWED');
});
test('a request without the new fields still validates exactly as before',()=>{
 expect(run({}).ok).toBe(true);
});

const belief={objectId:'cup-1',kind:'cup',frameId:'arm-base',positionM:[0.5,0,0.15],sigmaM:[0.002,0.002,0],observedTick:15,publishedTick:20,ageTicks:0,source:'pose_estimator_sim',valid:true};
const record={tick:20,objectId:'cup-1',belief,dropped:false,truthAtObservedTick:[0.5,0,0.15],errorM:0.001};
const attempt={attemptId:'cup-1#0',cupId:'cup-1',index:0,decidedTick:20,mode:'belief_estimated',beliefUsed:belief,beliefErrorAtCommitM:null,gates:{belief:'pass',region:'pass',ik:'pass',sweep:'pass'},ikResidual:[],outcome:'lifted'};
const step={stepId:'s1',attemptId:'cup-1#0',rule:'grip-not-established',action:'open_gripper',commandId:'recovery-1',recordedTick:300,completedTick:null,result:'pending'};
test('the evidence records validate, and refuse a sigma beyond 0.03 m, an unknown outcome, a field that is not in the contract',()=>{
 expect(validateBeliefRecordShape(record)).toBe(true);expect(validateGraspAttemptShape(attempt)).toBe(true);expect(validateRecoveryStepShape(step)).toBe(true);
 expect(validateBeliefRecordShape({...record,belief:{...belief,sigmaM:[0.04,0,0]}})).toBe(false);
 expect(validateGraspAttemptShape({...attempt,outcome:'succeeded'})).toBe(false);
 expect(validateBeliefRecordShape({...record,extra:1})).toBe(false);
 expect(validateRecoveryStepShape({...step,completedTick:-1})).toBe(false);
});

test('over HTTP only the advertised perception profile and recovery policy are accepted: the study and test profiles stay campaign-only',()=>{
 for(const bad of [{perceptionProfileId:'perception-lossy-v1'},{perceptionProfileId:'perception-bias-out-of-region-v1'},{perceptionProfileId:'perception-sigma-15mm-v1'}]){
  const r=run({graspMode:'belief_estimated',...bad});expect(r.ok).toBe(false);if(!r.ok)expect(r.issues.map(i=>i.code)).toContain('PERCEPTION_PROFILE_NOT_REGISTERED');
 }
 const p=run({graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v2'});expect(p.ok).toBe(false);if(!p.ok)expect(p.issues.map(i=>i.code)).toContain('RECOVERY_POLICY_NOT_REGISTERED');
 expect(run({graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1'}).ok).toBe(true);
});
