import Ajv from 'ajv';
import schema from '../../../contracts/schemas/physical-target-dossier-v1.schema.json';

/** Sourced assertions only: this module does not load or authenticate referenced material. */
export type DossierReference={value:string;sourceKind:'vendor'|'measurement'|'owner';sourceRef:string;owner:string};
type Branch='xarm_ros2'|'custom_linuxcnc';
type Dossier={schemaVersion:1;targetKind:'undecided'|'arm'|'chassis';branch:Branch|null;profileId:string|null;identity:Record<string,DossierReference|null>;modelRevision:DossierReference|null;prerequisites:Record<string,DossierReference|null>};
export type TargetDossierAssessment={structurallyValid:boolean;readiness:'prepared'|'incomplete';missing:string[];branchRequirements:{branch:Branch;requirements:string[]}[]};
const validate=new Ajv({strict:true,allErrors:true}).compile<Dossier>(schema);
const requirements:Record<Branch,string[]>={
 xarm_ros2:['qualified Ubuntu/ROS host and installed vendor provenance','vendor hardware driver and physical identity','controller/SDK/firmware compatibility and tool definition','supervised independent stop, measured latency and calibration','physical adapter conformance and commissioning authority'],
 custom_linuxcnc:['qualified Debian/ISA host and installed controller provenance','measured machine kinematics and controller/drive interface','sourced drive wiring, homing, feedback and tool definition','supervised independent stop, measured latency and calibration','physical adapter conformance and commissioning authority'],
};
const placeholder=/^(unknown|tbd|todo|unassigned|undecided|not[ _-]?(measured|available|run)|blocked_external|n\/?a)$/i;
function unresolved(ref:DossierReference|null):boolean {
 return ref===null||[ref.value,ref.sourceRef,ref.owner].some(v=>placeholder.test(v.trim()));
}
/** `prepared` means complete sourced references only. Never emits a manifest, validation rank, live capability or admission verdict. */
export function assessTargetDossier(value:unknown):TargetDossierAssessment {
 if(!validate(value))return {structurallyValid:false,readiness:'incomplete',missing:['schema'],branchRequirements:[]};
 const missing:string[]=[];
 if(value.targetKind==='undecided')missing.push('targetKind');
 for(const [key,ref]of Object.entries(value.identity))if(unresolved(ref)||(key==='serial'&&ref?.value.trim().toUpperCase()==='XI13050520BB00'))missing.push(`identity.${key}`);
 if(unresolved(value.modelRevision))missing.push('modelRevision');
 for(const [key,ref]of Object.entries(value.prerequisites))if(unresolved(ref))missing.push(`prerequisites.${key}`);
 const branches:Branch[]=value.targetKind==='undecided'?['xarm_ros2','custom_linuxcnc']:value.targetKind==='arm'?[value.branch as Branch]:[];
 return {structurallyValid:true,readiness:missing.length?'incomplete':'prepared',missing,branchRequirements:branches.map(branch=>({branch,requirements:[...requirements[branch]]}))};
}
