// The registered drive experiments of R4-A §5.4. A closed registry: a request names an id, never a path, a gain or a delay. Every number behind an id is a file of
// robotics/simulation-mujoco/fixtures/drive-v1 (all `assumed`, `not_calibrated`); four nonideal AMR experiments share a controller revision, while ideal uses the legacy-compatible controller.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hashJson} from '../hash';
import {sealDriveDocument,type ControlProfileV1,type DriveModelV1} from './drive-io';

export type DriveExperimentId='drive-ideal-v1'|'drive-nominal-v1'|'drive-torque-limited-v1'|'drive-latency-v1'|'drive-coarse-encoder-v1';
export const DRIVE_EXPERIMENTS:Readonly<Record<DriveExperimentId,{mobileModel:string;armModel:string;mobileControl:string;armControl:string}>>=Object.freeze({
 'drive-ideal-v1':{mobileModel:'serve-drive-ideal-v1.json',armModel:'xarm6-drive-ideal-v1.json',mobileControl:'serve-control-legacy-ideal-v1.json',armControl:'xarm6-control-v1.json'},
 'drive-nominal-v1':{mobileModel:'serve-drive-nominal-v1.json',armModel:'xarm6-drive-nominal-v1.json',mobileControl:'serve-control-v2.json',armControl:'xarm6-control-v1.json'},
 // the wheel torque curve x 0.4 concerns the AMR; the arm keeps its nominal drive
 'drive-torque-limited-v1':{mobileModel:'serve-drive-torque-limited-v1.json',armModel:'xarm6-drive-nominal-v1.json',mobileControl:'serve-control-v2.json',armControl:'xarm6-control-v1.json'},
 'drive-latency-v1':{mobileModel:'serve-drive-latency-v1.json',armModel:'xarm6-drive-latency-v1.json',mobileControl:'serve-control-v2.json',armControl:'xarm6-control-v1.json'},
 'drive-coarse-encoder-v1':{mobileModel:'serve-drive-coarse-encoder-v1.json',armModel:'xarm6-drive-coarse-encoder-v1.json',mobileControl:'serve-control-v2.json',armControl:'xarm6-control-v1.json'},
});
export const driveExperiment=(id:string)=>{
 if(!Object.hasOwn(DRIVE_EXPERIMENTS,id))throw new Error('DRIVE_EXPERIMENT_UNREGISTERED');
 return DRIVE_EXPERIMENTS[id as DriveExperimentId];
};

/** The registered experiment whose AMR model document is `path`, if any (a run built from an unregistered document has no experiment id). */
export const experimentOfMobileModel=(path:string):DriveExperimentId|undefined=>(Object.keys(DRIVE_EXPERIMENTS) as DriveExperimentId[]).find(k=>DRIVE_EXPERIMENTS[k].mobileModel===path);

const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const json=(v:unknown)=>Buffer.from(JSON.stringify(v,null,2)+'\n');
export interface DriveBundle {files:{path:string;bytes:Uint8Array}[];refs:{driveModelRef:{id:string;revision:number;path:string;sha256:string};controlProfileRef:{id:string;revision:number;path:string;sha256:string}};model:DriveModelV1;control:ControlProfileV1}
const ref=(d:{id:string;revision:number},path:string,bytes:Uint8Array)=>({id:d.id,revision:d.revision,path,sha256:sha(bytes)});
const read=async<T,>(workerRoot:string,name:string)=>{const bytes=await readFile(join(workerRoot,'fixtures/drive-v1',name));return {bytes,doc:JSON.parse(bytes.toString()) as T};};

/** The AMR's drive documents of an experiment. The model is the fixture's, byte for byte. The control profile is the fixture's bound to the plant the bundle was compiled for (`plantModelDigest`);
 * without a plant it is byte for byte too. */
export async function mobileDriveBundle(workerRoot:string,id:string,plantModelDigest?:string):Promise<DriveBundle>{
 const e=driveExperiment(id),m=await read<DriveModelV1>(workerRoot,e.mobileModel),c=await read<ControlProfileV1>(workerRoot,e.mobileControl);
 const control=plantModelDigest&&plantModelDigest!==c.doc.plantModelDigest?sealDriveDocument({...c.doc,plantModelDigest}):c.doc,cb=control===c.doc?c.bytes:json(control);
 return {files:[{path:e.mobileModel,bytes:m.bytes},{path:e.mobileControl,bytes:cb}],refs:{driveModelRef:ref(m.doc,e.mobileModel,m.bytes),controlProfileRef:ref(control,e.mobileControl,cb)},model:m.doc,control};
}

/** The plant a world's combined control profile belongs to, from the world scene itself: the AMR's physical model digest and the sha256 the scene records for the arm component. The worker computes the same (`world_plant_digest`). */
export const worldPlantDigest=(scene:{navigation:{robots:{model:{physicalModelDigest:string}}[]};models:{armComponent:{sha256:string}}}):string=>hashJson({mobile:scene.navigation.robots[0]!.model.physicalModelDigest,arm:scene.models.armComponent.sha256});

/** One combined drive model and control profile for the nine axes of the cell world: the arm's axes (renamed to the scene's arm id) and the AMR's. A registry fixture may be re-sealed for the plant it runs on (D2): the
 * profile is sealed with `plantModelDigest`, the world's own. Only registry fixtures are ever re-sealed; a profile a person sends is admitted as it is or refused. */
export async function worldDriveBundle(workerRoot:string,id:string,armId:string,plantModelDigest:string):Promise<DriveBundle>{
 const e=driveExperiment(id),sm=await read<DriveModelV1>(workerRoot,e.mobileModel),sc=await read<ControlProfileV1>(workerRoot,e.mobileControl),am=await read<DriveModelV1>(workerRoot,e.armModel),ac=await read<ControlProfileV1>(workerRoot,e.armControl);
 const rename=<T extends {axisId:string}>(axes:T[])=>axes.map(a=>({...a,axisId:a.axisId.replace(/^xarm-1\//,`${armId}/`)}));
 const model=sealDriveDocument({...am.doc,id:`world-${id}`,axes:[...rename(am.doc.axes),...sm.doc.axes]});
 const control=sealDriveDocument({...ac.doc,id:`world-${id}-control`,plantModelDigest,driveModelDigests:[model.digest],axes:[...rename(ac.doc.axes),...sc.doc.axes],controllers:[...ac.doc.controllers,...sc.doc.controllers]});
 const mp=`${model.id}.json`,cp=`${control.id}.json`,mb=json(model),cb=json(control);
 return {files:[{path:mp,bytes:mb},{path:cp,bytes:cb}],refs:{driveModelRef:ref(model,mp,mb),controlProfileRef:ref(control,cp,cb)},model,control};
}
