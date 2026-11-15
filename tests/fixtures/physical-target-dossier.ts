import type {DossierReference} from '../../packages/lab-runtime/src/commissioning/target-dossier';
/** Synthetic prerequisite references only. No hardware values, credentials or commissioning keys. */
export const prerequisiteFields=['host','controller','tool','safety','latency','maintenance','calibration','observer','signature','vendorInterface','operatingLimits','conformance'] as const;
export function undecidedDossierFixture() {
 return {schemaVersion:1,targetKind:'undecided',branch:null,profileId:null,identity:{vendor:null,model:null,firmware:null,sdk:null,serial:null},modelRevision:null,prerequisites:Object.fromEntries(prerequisiteFields.map(k=>[k,null]))};
}
export function preparedDossierFixture(branch:'xarm_ros2'|'custom_linuxcnc'='xarm_ros2') {
 const fact=(value:string,sourceKind:DossierReference['sourceKind']='owner'):DossierReference=>({value,sourceKind,sourceRef:'TEST-ONLY/reference-revision-1#section',owner:'TEST-ONLY-owner'});
 return {...undecidedDossierFixture(),targetKind:'arm',branch,profileId:branch==='xarm_ros2'?'arm-xarm-dossier-v1':'arm-custom-dossier-v1',identity:Object.fromEntries(['vendor','model','firmware','sdk','serial'].map(k=>[k,fact(`TEST-ONLY-${k}`,'vendor')])) as Record<string,DossierReference|null>,modelRevision:fact('TEST-ONLY-model-revision'),prerequisites:Object.fromEntries(prerequisiteFields.map(k=>[k,fact(`TEST-ONLY-${k}`,['calibration','latency'].includes(k)?'measurement':'owner')])) as Record<string,DossierReference|null>};
}
