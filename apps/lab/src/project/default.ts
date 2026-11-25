import type {LabProject} from '../shared/types';
import worldFixture from '../../fixtures/worlds/restaurant-six-tables.json' with {type:'json'};
/** Fresh mutable project; illustrative dimensions are never hardware measurements. */
export function defaultProject():LabProject {
  return {
    schemaVersion:1,id:'mekoniq-service-lab',name:'MEKONIQ · Service Lab',revision:1,
    updatedAt:new Date().toISOString(),
    design:{id:'service-robot',revision:1,chassis:'service',trays:3,batteryAh:20,sensor:'lidar',payloadKg:10},
    world:structuredClone(worldFixture) as LabProject['world']
  };
}
