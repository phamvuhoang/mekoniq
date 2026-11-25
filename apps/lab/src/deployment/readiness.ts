import type {LabProject} from '../shared/types';
import {footprintForDesign,validateDesign} from '../design/catalog';
import {validateWorld} from '../world/validation';
export interface ReadinessItem {id:string;status:'ready'|'pending'|'blocked_external';reasons:string[];}
export function deploymentReadiness(project:LabProject,evidenceCount=0):ReadinessItem[] {
  const design=validateDesign(project.design);
  const footprint=footprintForDesign(project.design);
  // A circumscribed circle conservatively covers the rectangular candidate at any yaw.
  const world=footprint ? validateWorld(project.world,{robotRadiusM:Math.hypot(footprint.widthM,footprint.lengthM)/2}) : [...validateWorld(project.world),{code:'FOOTPRINT_UNAVAILABLE',field:'chassis',message:'Measured or illustrative geometry is unavailable for this chassis.'}];
  return [
    {id:'configuration',status:design.length||world.length ? 'pending' : 'ready',reasons:[...design,...world].map(issue=>issue.code)},
    {id:'business_sim',status:'pending',reasons:[evidenceCount ? 'EVIDENCE_REQUIRES_SOURCE_POLICY_REVIEW' : 'NO_RUN_EVIDENCE']},
    {id:'source_compatibility',status:'blocked_external',reasons:['SOURCE_RUNTIME_VERSION_NOT_VERIFIED']},
    {id:'map_binding',status:'blocked_external',reasons:['ROBOT_MAP_NOT_PROVISIONED','FIELD_CALIBRATION_REQUIRED']},
    {id:'hardware',status:'blocked_external',reasons:['ILLUSTRATIVE_PROFILE','MEASURED_PAYLOAD_AND_STOP_TESTS_REQUIRED','NO_HARDWARE_ACCEPTANCE']},
    {id:'venue',status:'blocked_external',reasons:['SOURCE_GATE_A_B_AND_OPERATOR_ACCEPTANCE_REQUIRED']}
  ];
}
