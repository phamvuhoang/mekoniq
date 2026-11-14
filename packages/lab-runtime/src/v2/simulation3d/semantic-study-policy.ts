import type {PlantPort} from '../navigation2d/plant';
import {MOBILE_CONTROLLER_POLICY} from './mujoco-mobile';
/** Server-owned X01 admission. This is the same algorithm/ramp, not a new controller version or a browser override. */
export function withSemanticStudyController(plant:PlantPort):PlantPort{
 return {...plant,identity:{...plant.identity,controller:{identity:{id:'grid-diff-v1',version:MOBILE_CONTROLLER_POLICY.controller.version},options:{ramp:'previous-sent-command-v1'}}}};
}
