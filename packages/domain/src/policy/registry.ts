export type FeatureStatus = 'enabled'|'draining'|'disabled';
export type FeatureDefinition = {id:string;group:string;dependencies:string[];permission:string;readiness?:string};
export const featureRegistry: Record<string,FeatureDefinition> = {
  'catalog':{id:'catalog',group:'F03',dependencies:[],permission:'catalog.read'},
  'sessions':{id:'sessions',group:'F04',dependencies:[],permission:'order.write'},
  'pos.order':{id:'pos.order',group:'F05',dependencies:['catalog','sessions'],permission:'order.write'},
  'qr.order':{id:'qr.order',group:'F05',dependencies:['catalog','sessions'],permission:'guest.order'},
  'robot.order':{id:'robot.order',group:'F05',dependencies:['catalog','sessions'],permission:'order.write'},
  'orders':{id:'orders',group:'F06',dependencies:['catalog'],permission:'order.write'},
  'kitchen':{id:'kitchen',group:'F07',dependencies:['orders'],permission:'kitchen.write'},
  'fulfillment':{id:'fulfillment',group:'F08',dependencies:[],permission:'fulfillment.write'},
  'robot.delivery':{id:'robot.delivery',group:'F08',dependencies:['fleet','fulfillment'],permission:'mission.write',readiness:'robot'},
  'robot.bussing':{id:'robot.bussing',group:'F08',dependencies:['fleet'],permission:'mission.write',readiness:'robot'},
  'fleet':{id:'fleet',group:'F09',dependencies:[],permission:'mission.write'},
  'billing':{id:'billing',group:'F10',dependencies:['orders'],permission:'billing.write'},
  'payment.cash':{id:'payment.cash',group:'F11',dependencies:['billing','cash.shift'],permission:'payment.cash'},
  'payment.transfer':{id:'payment.transfer',group:'F11',dependencies:['billing'],permission:'payment.verify',readiness:'bank'},
  'payment.provider':{id:'payment.provider',group:'F11',dependencies:['billing'],permission:'payment.capture',readiness:'provider'},
  'refund':{id:'refund',group:'F12',dependencies:['billing'],permission:'payment.refund'},
  'cash.shift':{id:'cash.shift',group:'F13',dependencies:[],permission:'shift.write'},
  'printing':{id:'printing',group:'F14',dependencies:[],permission:'print',readiness:'printer'},
  'guest.call':{id:'guest.call',group:'F15',dependencies:[],permission:'guest.call'},
  'guest.bill':{id:'guest.bill',group:'F15',dependencies:[],permission:'guest.bill'},
  'robot.guide':{id:'robot.guide',group:'F15',dependencies:['fleet'],permission:'mission.write',readiness:'robot'},
  'reservations':{id:'reservations',group:'F16',dependencies:[],permission:'reservation.write'},
  'promotion':{id:'promotion',group:'F17',dependencies:['catalog'],permission:'promotion.write'},
  'loyalty':{id:'loyalty',group:'F18',dependencies:[],permission:'loyalty.write'},
  'inventory':{id:'inventory',group:'F19',dependencies:[],permission:'inventory.write'},
  'procurement':{id:'procurement',group:'F20',dependencies:['inventory'],permission:'procurement.write'},
  'workforce':{id:'workforce',group:'F21',dependencies:[],permission:'workforce.write'},
  'reporting':{id:'reporting',group:'F22',dependencies:[],permission:'report.read'},
  'chain':{id:'chain',group:'F23',dependencies:[],permission:'chain.write'},
  'online':{id:'online',group:'F24',dependencies:['catalog','orders'],permission:'channel.write'},
  'einvoice':{id:'einvoice',group:'F25',dependencies:['billing'],permission:'invoice.issue',readiness:'invoiceProvider'},
  'service.models':{id:'service.models',group:'F26',dependencies:['catalog'],permission:'configuration.publish'},
  'integrations':{id:'integrations',group:'F27',dependencies:[],permission:'integration.write'},
};
export const systemRegistry = {identity:'F01',configuration:'F02',operations:'F28',continuity:'F29',maintenance:'F30'} as const;
export const systemInvariants = ['identity','audit','tenant-isolation','replay-protection','robot.stop','continuity','maintenance'] as const;
export type FeatureConfig = Record<string,{status:FeatureStatus;revision:number}>;
export function validateDependencies(config:FeatureConfig, registry=featureRegistry):string[] {
  const errors:string[]=[]; const visiting=new Set<string>(); const visited=new Set<string>();
  function visit(key:string) {
    if(visiting.has(key)) {errors.push(`DEPENDENCY_CYCLE:${key}`);return;}
    if(visited.has(key))return;
    const def=registry[key]; if(!def){errors.push(`UNKNOWN_FEATURE:${key}`);return;}
    visiting.add(key);
    for(const dep of def.dependencies) {
      if(config[key]?.status==='enabled' && config[dep]?.status!=='enabled')errors.push(`DEPENDENCY_DISABLED:${key}:${dep}`);
      visit(dep);
    }
    visiting.delete(key);visited.add(key);
  }
  for(const [key,value] of Object.entries(config)) {
    if(!['enabled','draining','disabled'].includes(value.status))errors.push(`INVALID_STATUS:${key}`);
    visit(key);
  }
  return [...new Set(errors)];
}
