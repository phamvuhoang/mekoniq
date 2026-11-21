// R4-B contracts at the edges: the perception profile (a document in the admission bundle), the grasp request (what a run may ask for) and the shape of the belief evidence records.
import Ajv from 'ajv';
import componentSchema from '../../../../contracts/schemas/engineering-component.schema.json';
import profileSchema from '../../../../contracts/schemas/perception-profile-v1.schema.json';
import evidenceSchema from '../../../../contracts/schemas/belief-evidence-v1.schema.json';
import type {PerceptionProfileV1} from '../../../../contracts/generated/navigation2d';
import {checkReasons,driveDocumentDigest,nonFinite,shapeCodes,type Check} from '../control/drive-io';
const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});
for(const [key,schema] of Object.entries({'engineering-component.schema.json':componentSchema,'perception-profile-v1.schema.json':profileSchema,'belief-evidence-v1.schema.json':evidenceSchema}))ajv.addSchema(schema,key);
const profileShape=ajv.getSchema('perception-profile-v1.schema.json')!;
export const validateBeliefManifestShape=ajv.getSchema('belief-evidence-v1.schema.json')!;
export const validateBeliefRecordShape=ajv.getSchema('belief-evidence-v1.schema.json#/definitions/BeliefRecord')!;
export const validateGraspAttemptShape=ajv.getSchema('belief-evidence-v1.schema.json#/definitions/GraspAttempt')!;
export const validateRecoveryStepShape=ajv.getSchema('belief-evidence-v1.schema.json#/definitions/RecoveryStep')!;
export const GRASP_MODES=['fixed_program','belief_ground_truth','belief_estimated'] as const;
/** A perception profile: shape and ranges, finite numbers, a view region the scene has (`regionIds`), and its digest. */
export function validatePerceptionProfile(value:unknown,regionIds:readonly string[]):Check{
 const codes=new Set<string>();
 if(nonFinite(value))codes.add('NON_FINITE_NUMBER');
 shapeCodes(profileShape as never,value,codes);
 const p=value as PerceptionProfileV1;
 if(p&&typeof p.visibleRegionId==='string'&&!regionIds.includes(p.visibleRegionId))codes.add('VIEW_REGION_UNKNOWN');
 if(p&&typeof p==='object'&&typeof p.digest==='string'&&!nonFinite(value)&&driveDocumentDigest(p)!==p.digest)codes.add('DIGEST_MISMATCH');
 return checkReasons(codes);
}
/** What a run asks for: the fixed program takes no perception profile and no recovery policy; ground truth is a mode of its own (no profile); an estimated belief needs a profile. */
export function validateGraspRequest(r:{graspMode?:string;perceptionProfileId?:string;recoveryPolicyId?:string}):Check{
 const codes=new Set<string>(),mode=r.graspMode??'fixed_program';
 if(!(GRASP_MODES as readonly string[]).includes(mode))codes.add('INVALID_FIELD');
 if(r.perceptionProfileId!==undefined&&mode!=='belief_estimated')codes.add('PERCEPTION_PROFILE_NOT_ALLOWED');
 if(mode==='belief_estimated'&&r.perceptionProfileId===undefined)codes.add('PERCEPTION_PROFILE_REQUIRED');
 if(r.recoveryPolicyId!==undefined&&mode==='fixed_program')codes.add('RECOVERY_POLICY_NOT_ALLOWED');
 return checkReasons(codes);
}
