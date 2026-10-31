import {featureRegistry,validateDependencies,type FeatureConfig} from './registry';
const profiles: Record<string,string[]> = {
  'trial-service':['fleet','fulfillment','robot.delivery','robot.bussing'],
  'cash-only':['catalog','sessions','pos.order','orders','kitchen','fulfillment','billing','cash.shift','payment.cash'],
  'no-robot':['catalog','sessions','pos.order','orders','kitchen','fulfillment','billing','cash.shift','payment.cash','reporting'],
  'robot-only':['fleet','fulfillment','robot.delivery','robot.bussing'],
};
export function preset(name:string,flags:Record<string,boolean>={}) {
  const enabled=new Set(profiles[name]); if(!profiles[name])throw new Error('UNKNOWN_PRESET');
  const mapping:Record<string,string>={call:'guest.call',callStaff:'guest.call',requestBill:'guest.bill',guide:'robot.guide',order:'robot.order',pay:'payment.transfer'};
  for(const [key,value] of Object.entries(flags)) {
    if(!mapping[key]||typeof value!=='boolean')throw new Error('UNKNOWN_TRIAL_FLAG');
    if(value)enabled.add(mapping[key]);
  }
  const added:string[]=[];
  function include(key:string) {for(const dep of featureRegistry[key].dependencies)if(!enabled.has(dep)){enabled.add(dep);added.push(dep);include(dep);}}
  for(const key of enabled)include(key);
  const features:FeatureConfig=Object.fromEntries(Object.keys(featureRegistry).map(key=>[key,{status:enabled.has(key)?'enabled':'disabled',revision:1}]));
  const errors=validateDependencies(features);if(errors.length)throw new Error(errors.join(','));
  return {name,version:1,features,dependenciesAdded:added};
}
