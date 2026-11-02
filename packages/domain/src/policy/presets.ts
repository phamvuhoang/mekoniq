import {featureRegistry,validateDependencies,type FeatureConfig} from './registry';
const profiles: Record<string,string[]> = {
  'trial-service':['fleet','fulfillment','robot.delivery','robot.bussing'],
  'cash-only':['catalog','sessions','pos.order','orders','kitchen','fulfillment','billing','cash.shift','payment.cash','discount'],
  'no-robot':['catalog','sessions','pos.order','orders','kitchen','fulfillment','billing','cash.shift','payment.cash','reporting','discount'],
  'robot-only':['fleet','fulfillment','robot.delivery','robot.bussing'],
};
/**
 * Legacy trial flag -> independent feature key. `pay` is the trial's staff-verified transfer (payment.verification 'staff'), i.e. the manual
 * attestation tender; payment.transfer is the bank-integrated path (readiness 'bank') the trial never had.
 */
export const trialFlagFeatures:Record<string,string>={call:'guest.call',callStaff:'guest.call',requestBill:'guest.bill',guide:'robot.guide',order:'robot.order',pay:'payment.transfer.manual',busRobot:'robot.bussing'};
export function preset(name:string,flags:Record<string,boolean>={}) {
  const enabled=new Set(profiles[name]); if(!profiles[name])throw new Error('UNKNOWN_PRESET');
  // aliases (call/callStaff) share a feature: conflicting values are refused so the result never depends on key order
  const wanted=new Map<string,boolean>();
  for(const [key,value] of Object.entries(flags)) {
    if(!trialFlagFeatures[key]||typeof value!=='boolean')throw new Error('UNKNOWN_TRIAL_FLAG');
    const feature=trialFlagFeatures[key];
    if(wanted.has(feature)&&wanted.get(feature)!==value)throw new Error('CONFLICTING_TRIAL_FLAGS');
    wanted.set(feature,value);
  }
  // an explicit false also switches off what the base profile enables (busRobot=false -> no bussing)
  for(const [feature,value] of wanted)if(value)enabled.add(feature);else enabled.delete(feature);
  const added:string[]=[];
  function include(key:string) {for(const dep of featureRegistry[key].dependencies)if(!enabled.has(dep)){enabled.add(dep);added.push(dep);include(dep);}}
  for(const key of enabled)include(key);
  const features:FeatureConfig=Object.fromEntries(Object.keys(featureRegistry).map(key=>[key,{status:enabled.has(key)?'enabled':'disabled',revision:1}]));
  const errors=validateDependencies(features);if(errors.length)throw new Error(errors.join(','));
  return {name,version:1,features,dependenciesAdded:added};
}
