import {defaultCatalog} from '../capabilities';
import {instantiateBackends} from '../backend-registry';
import {scenarioRegistry,scenarioHash} from '../scenario-registry';
import type {RunReport} from '../report';
import {worldDocument} from '../simulation3d/world-control';
import type {WorldAdmission} from '../simulation3d/world-evidence';
import {hashJson} from '../hash';
const same=(a:unknown,b:unknown)=>hashJson(a)===hashJson(b);
/** Compare registration metadata without starting a backend. Host availability is
 * irrelevant to a cold reader; the retained world supplies the execution witness. */
export function verifyCellExecution(m:RunReport['manifest'],admission:WorldAdmission){
 const id='engineering-mujoco-cell-v1',set=defaultCatalog.sets[id]!,scenario=scenarioRegistry.get('MJ-CELL-BV01')!;
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>({...b,installed:true,compatible:true,reachable:true}))},registered=instantiateBackends(id,catalog,set.backends);
 const project=worldDocument<{id:string;revision:number}>(admission.files,'project.json'),projectHash=hashJson(project);
 if(m.mode!==registered.mode||m.access!==registered.access||m.backendSetId!==id||!m.backends||!same(m.backends,registered.descriptors)||!m.scenario||!same(m.scenario,{id:scenario.id,revision:scenario.revision,hash:scenarioHash(scenario)})||!m.project||!same(m.project,{id:project.id,revision:project.revision,hash:projectHash})||projectHash!==admission.scene.inputs.projectDigest||admission.scene.armCell.engine.id!==set.providers!.amr||admission.scene.navigation.engine.id!==set.providers!.amr||admission.scene.navigation.engine.version!==registered.descriptors[0]!.version)throw Error('CELL_EXECUTION_IDENTITY');
}
