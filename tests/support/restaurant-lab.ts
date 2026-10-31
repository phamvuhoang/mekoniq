import { createLab } from './lab';
import { actors } from './actors';
import {productionPermissions} from '../../packages/domain/src/application';
import { registerPolicyModule } from '../../packages/domain/src/policy/module';
import { registerContinuityModules } from '../../packages/domain/src/continuity/module';
import { registerRestaurantModules } from '../../packages/domain/src/restaurant';
import fixture from '../fixtures/restaurant-v1.json';
import type { JsonObject } from '../../packages/contracts/src/index';
export async function createRestaurantLab() {
 const lab=await createLab(registry=>{registerRestaurantModules(registry);registerContinuityModules(registry);registerPolicyModule(registry);});
 lab.addAuthorization((actor,type,payload)=>{
  const principal=actors[actor],permission=productionPermissions[type];
  if(!principal||!permission) return false;
  if(actor==='chef'&&type.startsWith('Kitchen.')&&payload.stationId!=='kitchen') return false;
  return principal.permissions.includes('*')||principal.permissions.includes(permission);
 });
 await lab.seed('configuration','applied',fixture.configuration as JsonObject);
 await lab.seed('catalog','current',fixture.menu as JsonObject);
 await lab.seed('catalog-version','1',fixture.menu as JsonObject);
 for(const station of fixture.stations) await lab.seed('station',station.id,station);
 for(const table of fixture.tables) await lab.seed('table',table.id,table);
 await lab.seed('robot',fixture.robot.id,fixture.robot as JsonObject);
 return lab;
}
