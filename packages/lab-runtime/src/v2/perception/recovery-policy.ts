// R4-B §7: the bounded recovery table of a failed pick. Pure: a policy is data in a closed catalogue, and `decideRecovery` says either which steps to take or why a person is needed.
// A cup that may still be held is never released (R4-D28); nothing here knows the engine.
import Ajv from 'ajv';
import componentSchema from '../../../../contracts/schemas/engineering-component.schema.json';
import policySchema from '../../../../contracts/schemas/recovery-policy-v1.schema.json';
import type {RecoveryPolicyV1} from '../../../../contracts/generated/navigation2d';
import {checkReasons,driveDocumentDigest,nonFinite,shapeCodes,type Check} from '../control/drive-io';
export type {RecoveryPolicyV1};
export type RecoveryTrigger='GRIP_NOT_ESTABLISHED'|'BELIEF_UNAVAILABLE'|'BELIEF_STALE';
export type RecoveryFact='arm_state_fresh'|'no_unknown_command'|'cup_on_declared_support'|'cup_not_between_pads';
export type RecoveryAction='open_gripper'|'retreat_pick_approach'|'await_fresh_belief'|'retry_pick';
const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});ajv.addSchema(componentSchema,'engineering-component.schema.json');ajv.addSchema(policySchema,'recovery-policy-v1.schema.json');
const shape=ajv.getSchema('recovery-policy-v1.schema.json')!;
export function validateRecoveryPolicy(value:unknown):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(shape as never,value,codes);
 const p=value as RecoveryPolicyV1;
 if(p&&typeof p==='object'&&typeof p.digest==='string'&&!nonFinite(value)&&driveDocumentDigest(p)!==p.digest)codes.add('DIGEST_MISMATCH');
 if(p&&Array.isArray(p.rules)){
  const ids=new Set<string>(),triggers=new Set<string>();
  for(const r of p.rules){
   if(!r||typeof r!=='object')continue;
   if(ids.has(r.id))codes.add('RECOVERY_RULE_DUPLICATE');ids.add(r.id);
   for(const t of r.on??[]){if(triggers.has(t))codes.add('RECOVERY_RULE_DUPLICATE');triggers.add(t);}
   // opening the gripper is only allowed where the policy requires the observation that the cup is not between the pads
   if(r.steps?.includes('open_gripper')&&!r.requires?.includes('cup_not_between_pads'))codes.add('RECOVERY_OPEN_REQUIRES_NOT_HELD');
  }
 }
 return checkReasons(codes);
}
export type RecoveryDecision={action:'recover';rule:string;steps:RecoveryAction[]}|{action:'attention';reason:'RECOVERY_NOT_APPLICABLE'|'RECOVERY_FACTS_MISSING'|'RECOVERY_EXHAUSTED'};
/** Order of the checks: a failure the table does not name is not ours; a fact that is not known is a person's call (before any count); only then the bound. */
export function decideRecovery(policy:RecoveryPolicyV1,failure:{code:string},facts:ReadonlySet<RecoveryFact>,attemptsSoFar:number):RecoveryDecision{
 const rule=policy.rules.find(r=>(r.on as string[]).includes(failure.code));
 if(!rule)return {action:'attention',reason:'RECOVERY_NOT_APPLICABLE'};
 if(!(rule.requires as RecoveryFact[]).every(f=>facts.has(f)))return {action:'attention',reason:'RECOVERY_FACTS_MISSING'};
 if(attemptsSoFar>=rule.maxAttempts)return {action:'attention',reason:'RECOVERY_EXHAUSTED'};
 return {action:'recover',rule:rule.id,steps:[...rule.steps] as RecoveryAction[]};
}
