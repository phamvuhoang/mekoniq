// Server-owned backend factories. A caller names a catalog set; it never supplies endpoints, actors or backend code.
import {admitBackend,MUJOCO_ARM,WEBOTS_ARM,type CapabilityCatalog} from './capabilities';
import {MOCK_AMR} from './backends/mock-amr';
import {MOCK_COFFEE} from '../../../cell-adapters/src/mock-coffee';
import {MOCK_ARM} from '../../../cell-adapters/src/mock-arm';
type Descriptor={readonly id:string;readonly version:string;readonly model:string;readonly dynamics:boolean};
import {serviceAmrAsset,type AssetRevision} from './assets';
/** The Webots arm (R1.1): the mock arm's program state machine tracking a rigid-body plant under position servo. Its masses and torque limits are assumed. */
const WEBOTS_ARM_DESCRIPTOR:Descriptor={id:WEBOTS_ARM.id,version:WEBOTS_ARM.version,model:'webots_position_servo_arm',dynamics:true};
/** The MuJoCo arm (R2a): the same state machine tracking a MuJoCo xArm 6 under position actuators that grips by contact. Version: the engine the lock pins (readiness refuses any other). */
const MUJOCO_ARM_DESCRIPTOR:Descriptor={id:MUJOCO_ARM.id,version:'3.17.0',model:'mujoco_position_actuator_arm',dynamics:true};
/** Backends with an execution implementation in this runtime: the mock ones, and the Webots and MuJoCo arms (whose plant the caller supplies as coffeePorts). Other simulation/hardware stay denied with a reason. */
const IMPLEMENTED:Record<string,Descriptor>={mock_amr:MOCK_AMR,mock_coffee:MOCK_COFFEE,mock_arm:MOCK_ARM,[WEBOTS_ARM.id]:WEBOTS_ARM_DESCRIPTOR,[MUJOCO_ARM.id]:MUJOCO_ARM_DESCRIPTOR};
export interface InstantiatedBackends {setId:string;mode:'mock'|'simulation';access:'simulated';backends:string[];descriptors:Descriptor[]}
/** The simulation sets this runner executes: the arm is a Webots or a MuJoCo plant, the AMR and the coffee machine are mocks. */
export const isArmPlantSet=(set:{mode:string;providers?:{arm?:string}}|undefined)=>set?.mode==='simulation'&&(set.providers?.arm===WEBOTS_ARM.id||set.providers?.arm===MUJOCO_ARM.id);
/** Admission (capabilities.ts) first, then the execution switch: every scenario-required backend must be enabled and implemented, and the mode must be mock. */
export function instantiateBackends(setId:string,catalog:CapabilityCatalog,enabled:readonly string[],required?:readonly string[]):InstantiatedBackends {
 const set=Object.hasOwn(catalog.sets,setId)?catalog.sets[setId]:undefined;
 if(!set)throw new Error('BACKEND_SET_UNKNOWN');
 const plant=isArmPlantSet(set);
 if(!(set.mode==='mock'||plant)||set.access!=='simulated')throw new Error('BACKEND_EXECUTION_DISABLED');
 const needed=required??set.backends;
 if(!needed.length||!needed.every(id=>set.backends.includes(id)))throw new Error('SCENARIO_BACKEND_MISSING');
 const admission=admitBackend(set.mode,needed,catalog,set.access);
 if(!admission.ok)throw new Error(`BACKEND_UNAVAILABLE:${admission.reasonCodes.join(',')}`);
 if(!needed.every(id=>enabled.includes(id)&&Object.hasOwn(IMPLEMENTED,id)))throw new Error('BACKEND_EXECUTION_DISABLED');
 const active=set.backends.filter(id=>enabled.includes(id)&&Object.hasOwn(IMPLEMENTED,id)&&admitBackend(set.mode,[id],catalog,set.access).ok);
 return {setId,mode:plant?'simulation':'mock',access:'simulated',backends:active,descriptors:active.map(id=>IMPLEMENTED[id]!)};
}
/** Server asset catalog: the illustrative service AMR (lab/fixtures/catalog/service-illustrative.json) for every tray count and sensor. Resolved by content hash only. */
export const serverAssets:readonly AssetRevision[]=[1,2,3,4,5,6,7,8,9,10].flatMap(trays=>(['lidar','depth'] as const).map(sensor=>serviceAmrAsset({id:'service-robot',revision:1,chassis:'service',trays,sensor})));
