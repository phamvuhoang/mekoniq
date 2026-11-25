import {expect,test} from 'vitest';
import {decideRecovery,validateRecoveryPolicy} from '../../packages/lab-runtime/src/v2/perception/recovery-policy';
import {sealDriveDocument} from '../../packages/lab-runtime/src/v2/control/drive-io';
import policy from '../../robotics/simulation-mujoco/fixtures/recovery-v1/pick-recovery-v1.json';
const all=new Set(['arm_state_fresh','no_unknown_command','cup_on_declared_support','cup_not_between_pads'] as const);
test('a known failed grip is retried with a fresh observation',()=>{
 expect(decideRecovery(policy as never,{code:'GRIP_NOT_ESTABLISHED'},all,0)).toEqual({action:'recover',rule:'grip-not-established',steps:['open_gripper','retreat_pick_approach','await_fresh_belief','retry_pick']});
});
test('a belief that is not usable waits for a fresh one and picks again, with fewer requirements',()=>{
 const some=new Set(['arm_state_fresh','no_unknown_command'] as const);
 expect(decideRecovery(policy as never,{code:'BELIEF_STALE'},some,0)).toEqual({action:'recover',rule:'belief-not-usable',steps:['await_fresh_belief','retry_pick']});
 expect(decideRecovery(policy as never,{code:'BELIEF_UNAVAILABLE'},some,1)).toMatchObject({action:'recover'});
});
test('a cup that may still be held is never released by recovery',()=>{
 const held=new Set([...all].filter(f=>f!=='cup_not_between_pads'));
 expect(decideRecovery(policy as never,{code:'GRIP_NOT_ESTABLISHED'},held,0)).toEqual({action:'attention',reason:'RECOVERY_FACTS_MISSING'});
});
test('the bound and the scope are enforced',()=>{
 expect(decideRecovery(policy as never,{code:'GRIP_NOT_ESTABLISHED'},all,2)).toEqual({action:'attention',reason:'RECOVERY_EXHAUSTED'});
 for(const code of ['CUP_DROPPED','ARM_COLLISION','BELIEF_OUT_OF_REGION','WORLD_UNKNOWN'])expect(decideRecovery(policy as never,{code},all,0)).toEqual({action:'attention',reason:'RECOVERY_NOT_APPLICABLE'});
});
const rules=(policy as {rules:unknown[]}).rules;
const reasons=(v:object)=>validateRecoveryPolicy(sealDriveDocument({...policy,digest:'',...v}) as never).reasonCodes;
test('the shipped policy validates and a changed byte breaks its digest',()=>{
 expect(validateRecoveryPolicy(policy)).toEqual({ok:true,reasonCodes:[]});expect(validateRecoveryPolicy({...policy,beliefWaitTicks:251}).reasonCodes).toContain('DIGEST_MISMATCH');
});
test('a policy is refused for steps or facts outside the catalogue, nine rules, four attempts, an unknown field, and an open-gripper rule that does not require the cup to be off the pads',()=>{
 const r0=rules[0] as Record<string,unknown>;
 expect(reasons({rules:[{...r0,steps:['open_gripper','teleport']}]})).toContain('INVALID_FIELD');
 expect(reasons({rules:[{...r0,requires:['cup_on_declared_support','the_cup_is_fine']}]})).toContain('INVALID_FIELD');
 expect(reasons({rules:Array.from({length:9},(_,i)=>({...r0,id:`r${i}`}))})).toContain('INVALID_FIELD');
 expect(reasons({rules:[{...r0,maxAttempts:4}]})).toContain('INVALID_FIELD');
 expect(reasons({rules:[{...r0,extra:1}]})).toContain('UNKNOWN_FIELD');
 expect(reasons({rules:[{...r0,requires:['arm_state_fresh','no_unknown_command','cup_on_declared_support']}]})).toContain('RECOVERY_OPEN_REQUIRES_NOT_HELD');
 expect(reasons({rules:[r0,r0]})).toContain('RECOVERY_RULE_DUPLICATE');
});
