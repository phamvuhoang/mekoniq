import {featureRegistry,type FeatureConfig,type FeatureStatus} from './registry';
export type FeatureInput = {
  status:FeatureStatus|string;intent:'new'|'finish_existing'|'cancel'|'reconcile'|string;
  revision:number;permitted?:boolean;feature?:string;features?:FeatureConfig;
  readiness?:Record<string,boolean>;capable?:boolean;entitled?:boolean;policyRevision?:number;
};
export function evaluateFeature(input:FeatureInput) {
  const deny=(reason:string)=>({allowed:false,reason,revision:input.revision});
  if(!['new','finish_existing','cancel','reconcile'].includes(input.intent))return deny('INVALID_INTENT');
  if(!['new','finish_existing','cancel','reconcile'].includes(input.intent))return deny('INVALID_INTENT');
  if(input.permitted===false)return deny('PERMISSION_DENIED');
  if(input.policyRevision!==undefined && input.policyRevision!==input.revision)return deny('POLICY_STALE');
  if(input.feature && !featureRegistry[input.feature])return deny('UNKNOWN_FEATURE');
  if(input.intent!=='new')return {allowed:true,reason:'EXISTING_WORK',revision:input.revision};
  if(input.entitled===false)return deny('NOT_ENTITLED');
  if(input.status==='draining')return deny('FEATURE_DRAINING');
  if(input.status!=='enabled')return deny('FEATURE_DISABLED');
  const def=input.feature?featureRegistry[input.feature]:undefined;
  if(def && input.features && def.dependencies.some(key=>input.features?.[key]?.status!=='enabled'))return deny('DEPENDENCY_DISABLED');
  if(def?.readiness && input.readiness?.[def.readiness]!==true)return deny('NOT_READY');
  if(input.capable===false)return deny('CAPABILITY_UNSUPPORTED');
  return {allowed:true,reason:'ALLOWED',revision:input.revision};
}
