import type { RobotAdapter } from './contract';
export class AdapterRegistry {
 private adapters=new Map<string,RobotAdapter>();
 register(driver:string,adapter:RobotAdapter):void {
  if(this.adapters.has(driver)) throw new Error('DUPLICATE_ADAPTER');
  this.adapters.set(driver,adapter);
 }
 resolve(driver:string):RobotAdapter {
  const adapter=this.adapters.get(driver);
  if(!adapter) throw new Error('UNSUPPORTED_DRIVER');
  return adapter;
 }
}
