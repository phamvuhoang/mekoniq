import type {ModuleRegistry} from '../modules';
import {stateEvent} from '../modules';
import {evaluateFeature} from './evaluate';
import {guarded,find,object,text,ok} from '../continuity/shared';
import {validateDependencies,type FeatureConfig} from './registry';
import {runtimeReadiness} from './readiness';
import {hashPayload} from '../../../contracts/src/index';
function hasOpenWork(key:string,s:import('../../../contracts/src/index').Snapshot[]) {
  const kinds=key.startsWith('robot.')||key==='fleet'?['mission']:key==='cash.shift'?['shift']:key==='billing'||key.startsWith('payment.')?['bill','grant']:['order','session','kitchen-ticket'];
  return s.some(snapshot=>kinds.includes(snapshot.ref.kind)&&!['closed','cancelled','completed','reconciled','void'].includes(String(snapshot.state.status)));
}
export function registerPolicyModule(registry:ModuleRegistry) {
  registry.register('Policy.Check',guarded((c,s)=>{
    const key=text(c.payload.feature),feature=find(s,'feature',key);
    const config=find(s,'configuration','applied');
    const features=config?.state.features as unknown as FeatureConfig|undefined;
    const decision=evaluateFeature({feature:key,status:String(feature?.state.status??features?.[key]?.status??'disabled'),revision:Number(feature?.state.revision??config?.state.revision??1),intent:String(c.payload.intent??'new'),features,readiness:runtimeReadiness(s)});
    return decision.allowed?ok([],{reason:decision.reason}):{ok:false,code:decision.reason};
  }));
  registry.register('Configuration.Apply',guarded((c,s)=>{
    const revision=c.payload.revision;if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1)throw new Error('INVALID_REVISION');
    const current=find(s,'configuration','applied');
    if(current&&revision!==Number(current.state.revision)+1)throw new Error('CONFIGURATION_STALE');
    const desired=object(c.payload.features);const errors=validateDependencies(desired as unknown as FeatureConfig);if(errors.length)throw new Error(errors[0]);
    const features=Object.fromEntries(Object.entries(desired).map(([key,value])=>{
      const feature=object(value);if(feature.revision!==revision)throw new Error('FEATURE_REVISION_MISMATCH');
      return [key,{status:feature.status==='enabled'?'enabled':hasOpenWork(key,s)?'draining':'disabled',revision}];
    }));
    return ok([stateEvent('ConfigurationApplied','configuration','applied',{revision,features,readiness:runtimeReadiness(s),appliedAt:c.recordedAt})],{revision,effects:[{id:`configuration-ack:${hashPayload({organizationId:c.organizationId,venueId:c.venueId,revision})}`,type:'cloud.configurationAck',payload:{revision,coordinatorEpoch:c.coordinatorEpoch,operationId:c.operationId,payloadHash:c.payloadHash}}]});
  }));
}
