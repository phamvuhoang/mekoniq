// MuJoCo mobile view: admitted geometry and committed free-load poses only. No client dynamics or custody.
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import componentSchema from '../shared/engineering-schemas/engineering-component.schema.json' with {type:'json'};
import physicalSchema from '../shared/engineering-schemas/robot-physical-model-v1.schema.json' with {type:'json'};
import loadSchema from '../shared/engineering-schemas/load-profile-v1.schema.json' with {type:'json'};
import navModelSchema from '../shared/engineering-schemas/navigation-model-2d-v1.schema.json' with {type:'json'};
import navSchema from '../shared/engineering-schemas/navigation-scene-v1.schema.json' with {type:'json'};
import driveIoSchema from '../shared/engineering-schemas/drive-io-v1.schema.json' with {type:'json'};
import sampleSchema from '../shared/engineering-schemas/twin-sample-v2.schema.json' with {type:'json'};
import design from '../../fixtures/engineering/serve-payload-v1/serve-3d-project.json' with {type:'json'};
import centerLoad from '../../fixtures/engineering/serve-payload-v1/cup-center.json' with {type:'json'};
import offsetLoad from '../../fixtures/engineering/serve-payload-v1/cup-offset.json' with {type:'json'};
import emptyLoad from '../../fixtures/engineering/serve-payload-v1/empty.json' with {type:'json'};
import tripleLoad from '../../fixtures/engineering/serve-tray-v1/cup-triple.json' with {type:'json'};
import tripleLowLoad from '../../fixtures/engineering/serve-tray-v1/cup-triple-low-friction.json' with {type:'json'};
import canonical from '../../fixtures/engineering/serve-payload-v1/physical-model-amr-1.json' with {type:'json'};
import type {EngineeringProject} from '../shared/engineering';
import type {RobotPhysicalModelV1,LoadProfileV1,NavigationSceneV1} from '../shared/navigation2d';
import type {TwinSample} from './store';
import type {TwinPreset} from '../scenarios/catalog';
import type {TwinRuntime} from '../scenarios/controls';
import {buildFrameGraph,composePose,checkQuaternion} from './frames';
import {hashJson,sha256Hex} from './hash';
import {tr} from '../i18n';
const ajv=new Ajv({strict:false});addFormats(ajv);ajv.addSchema(componentSchema,'engineering-component.schema.json');ajv.addSchema(physicalSchema,'robot-physical-model-v1.schema.json');ajv.addSchema(navModelSchema,'navigation-model-2d-v1.schema.json');ajv.addSchema(driveIoSchema,'drive-io-v1.schema.json');
const validPhysical=ajv.getSchema<RobotPhysicalModelV1>('robot-physical-model-v1.schema.json')!,validLoad=ajv.compile<LoadProfileV1>(loadSchema),validNav=ajv.compile<NavigationSceneV1>(navSchema),validSample=ajv.compile<TwinSample>(sampleSchema);
export const MUJOCO_MOBILE_SET='engineering-mujoco-3d-v1';
export const PAYLOAD_EXPERIMENT_IDS=['payload-empty-v1','payload-center-v1','payload-offset-v1','payload-slow-v1','payload-fast-v1','payload-friction-low-v1','payload-friction-high-v1'] as const;
export const experimentLabel=(id:string)=>({
 'payload-empty-v1':tr('Khay trống','空のトレイ','Empty tray'),'payload-center-v1':tr('Cốc ở giữa','中央のカップ','Center cup'),'payload-offset-v1':tr('Cốc lệch tâm','偏心カップ','Offset cup'),
 'payload-slow-v1':tr('Cốc · giới hạn chậm','カップ · 低速上限','Cup · slow caps'),'payload-fast-v1':tr('Cốc · giới hạn nhanh','カップ · 高速上限','Cup · fast caps'),
 'payload-friction-low-v1':tr('Cốc · tham số vật liệu thấp','カップ · 低い材料パラメータ','Cup · low material parameter'),'payload-friction-high-v1':tr('Cốc · tham số vật liệu cao','カップ · 高い材料パラメータ','Cup · high material parameter')})[id]??id;
export function payloadPreset():TwinPreset{
 const project={...structuredClone(design),requestedProfile:MUJOCO_MOBILE_SET,mujocoExperimentId:'payload-center-v1'} as unknown as EngineeringProject;
 return {id:'mujoco-payload',mode:'simulation',speed:1,scenarioId:'MJ-FD01',scenarioRevision:1,backendSetId:MUJOCO_MOBILE_SET,seed:7,project:structuredClone(project.runtimeProject),assets:[],names:{'amr-1':'Serve-1'},roles:{entities:['amr'],points:['kitchen','table','parking']},engineering:{project,receipt:null},title:()=>tr('MuJoCo · cốc trên robot Serve','MuJoCo · Serve上のカップ','MuJoCo · cup on Serve'),summary:()=>tr('Khay thật trong mô phỏng, cốc tự do · MuJoCo 3.17.0 · chưa hiệu chuẩn','模擬トレイと自由なカップ · MuJoCo 3.17.0 · 未校正','Simulated tray and free cup · MuJoCo 3.17.0 · not calibrated')};
}
export function selectPayloadExperiment(p:TwinPreset,id:string):TwinPreset{
 if(!(PAYLOAD_EXPERIMENT_IDS as readonly string[]).includes(id)||p.id!=='mujoco-payload'||!p.engineering)throw new Error('MUJOCO_EXPERIMENT_UNREGISTERED');
 return {...p,engineering:{project:{...structuredClone(p.engineering.project),mujocoExperimentId:id as EngineeringProject['mujocoExperimentId']},receipt:null}};
}
/** R4 V10 (MJ-TRAY01): the five registered tray variants, ids of the runtime's registry. A variant is a field of the engineering project (a new compile, a new receipt), like a payload experiment; its drive experiment is implied. */
export const TRAY_EXPERIMENT_IDS=['tray-nominal-v1','tray-low-friction-v1','tray-accel-high-v1','tray-torque-limited-v1','tray-person-crossing-v1'] as const;
export const trayExperimentLabel=(id:string)=>({
 'tray-nominal-v1':tr('A · gia tốc thường','A · 通常の加速','A · normal acceleration'),'tray-low-friction-v1':tr('A′ · khay trơn','A′ · 滑りやすいトレイ','A′ · slippery tray'),
 'tray-accel-high-v1':tr('B · gia tốc gắt trên khay trơn','B · 滑りやすいトレイで高加速','B · hard acceleration on the slippery tray'),'tray-torque-limited-v1':tr('C · motor bị giới hạn mô-men','C · モーターのトルク制限','C · torque-limited motor'),
 'tray-person-crossing-v1':tr('D · khách đi ngang','D · 人が横切る','D · a person crosses')} as Record<string,string>)[id]??id;
/** The presets that run the payload AMR on MuJoCo from a compiled engineering receipt (one cup, or the tray of three). */
export const isMobilePreset=(id:string)=>id==='mujoco-payload'||id==='mujoco-tray';
export function trayPreset():TwinPreset{
 const project={...structuredClone(design),requestedProfile:MUJOCO_MOBILE_SET,mujocoExperimentId:'tray-nominal-v1'} as unknown as EngineeringProject;
 return {id:'mujoco-tray',mode:'simulation',speed:1,scenarioId:'MJ-TRAY01',scenarioRevision:1,backendSetId:MUJOCO_MOBILE_SET,seed:7,project:structuredClone(project.runtimeProject),assets:[],names:{'amr-1':'Serve-1'},roles:{entities:['amr'],points:['kitchen','table','parking']},engineering:{project,receipt:null},
  title:()=>tr('MuJoCo · khay ba cốc','MuJoCo · 3つのカップのトレイ','MuJoCo · tray of three cups'),summary:()=>tr('Bếp → bàn thứ tám, ba cốc tự do trên khay · năm biến thể thí nghiệm, so sánh từng cặp · MuJoCo 3.17.0 · chưa hiệu chuẩn','厨房 → 8番テーブル、トレイ上の自由な3つのカップ · 5つの実験バリエーション · MuJoCo 3.17.0 · 未校正','Kitchen → eighth table, three free cups on the tray · five experiment variants, compared in pairs · MuJoCo 3.17.0 · not calibrated')};
}
export function selectTrayExperiment(p:TwinPreset,id:string):TwinPreset{
 if(!(TRAY_EXPERIMENT_IDS as readonly string[]).includes(id)||p.id!=='mujoco-tray'||!p.engineering)throw new Error('MUJOCO_EXPERIMENT_UNREGISTERED');
 return {...p,engineering:{project:{...structuredClone(p.engineering.project),mujocoExperimentId:id as EngineeringProject['mujocoExperimentId']},receipt:null}};
}
/** The drive experiment of the cell (a request field) or of the mobile run (its engineering project, so the receipt is void until it is compiled again); the ids are the registry's. */
export const DRIVE_EXPERIMENT_IDS=['drive-ideal-v1','drive-nominal-v1','drive-torque-limited-v1','drive-latency-v1','drive-coarse-encoder-v1'] as const;
export const driveExperimentLabel=(id:string)=>({'drive-ideal-v1':tr('Lý tưởng (không lượng tử, không trễ)','理想(量子化・遅延なし)','Ideal (no quantisation, no delay)'),'drive-nominal-v1':tr('Danh định','公称','Nominal'),'drive-torque-limited-v1':tr('Mô-men giới hạn','トルク制限','Torque-limited'),
 'drive-latency-v1':tr('Trễ cao','高遅延','High latency'),'drive-coarse-encoder-v1':tr('Encoder thô','粗いエンコーダ','Coarse encoder')} as Record<string,string>)[id]??id;
export function selectDriveExperiment(p:TwinPreset,id:string):TwinPreset{
 if(!(DRIVE_EXPERIMENT_IDS as readonly string[]).includes(id))throw new Error('DRIVE_EXPERIMENT_UNREGISTERED');
 if(p.id==='mujoco-cell')return {...p,driveExperimentId:id};
 if(p.id==='mujoco-payload'&&p.engineering)return {...p,engineering:{project:{...structuredClone(p.engineering.project),driveExperimentId:id as EngineeringProject['driveExperimentId']},receipt:null}};
 throw new Error('DRIVE_EXPERIMENT_SCOPE_INVALID');
}
/** A tray variant implies its drive experiment (the runtime refuses a project that names another): only the torque-limited variant is on the torque-limited drive. */
export const trayDriveExperiment=(variant:string|undefined)=>variant==='tray-torque-limited-v1'?'drive-torque-limited-v1':'drive-nominal-v1';
export const driveExperimentOf=(p:TwinPreset):string|undefined=>p.id==='mujoco-cell'?p.driveExperimentId:p.id==='mujoco-payload'?p.engineering?.project.driveExperimentId:p.id==='mujoco-tray'?trayDriveExperiment(p.engineering?.project.mujocoExperimentId):undefined;
export interface PayloadState {payloadKind:'free';propId:string;supportId:string;loadProfileSha256:string;sceneDigest:string;geometry:{kind:'cylinder';radiusM:number;heightM:number};positionM:[number,number,number];quaternionXyzw:[number,number,number,number]}
export function validMobileSample(s:TwinSample):boolean{
 const {receivedAtMs:_r,epochResetAtMs:_e,...wire}=s as TwinSample&{receivedAtMs?:number;epochResetAtMs?:number};void _r;void _e;
 if(!validSample(wire)||s.origin!=='physics_sim'||s.frameId!=='map')return false;
 const o=s.observed;if(o?.payloadKind==='free'){
  try{checkQuaternion(o.quaternionXyzw as number[]);}catch{return false;}
  return s.entityId===`payload:${o.propId}`;
 }
 return o!==null&&['xM','yM','yawRad','zM','rollRad','pitchRad'].every(k=>typeof o[k]==='number'&&Number.isFinite(o[k]));
}
export function payloadState(s:TwinSample|undefined):PayloadState|null{
 return s?.providerId==='mujoco_3d'&&validMobileSample(s)&&s.observed?.payloadKind==='free'?s.observed as unknown as PayloadState:null;
}
/** The loads the twin admits: the registered fixtures, byte-checked against the runtime's own (a payload cup, none, or the tray of three). */
const ADMITTED:Record<string,{supports:unknown[];props:{propId:string}[]}>={'cup-center':centerLoad,'cup-offset':offsetLoad,'empty':emptyLoad,'cup-triple':tripleLoad,'cup-triple-low-friction':tripleLowLoad} as never;
export const admittedLoad=(id:string)=>Object.hasOwn(ADMITTED,id)?ADMITTED[id]!:null;
export interface PayloadBundle {scene:NavigationSceneV1;physical:RobotPhysicalModelV1;load:LoadProfileV1;loadSha256:string;physicalSha256:string}
const digestOk=(v:object,key:string)=>hashJson(Object.fromEntries(Object.entries(v).filter(([k])=>k!==key)))===(v as Record<string,unknown>)[key];
/** Shape is pinned to the very same Serve mechanics the source compiler admits; provenance/derived digests may differ with the experiment. */
const mechanics=(m:RobotPhysicalModelV1)=>hashJson({links:m.links,joints:m.joints,drive:m.drive,baseFrameId:m.baseFrameId});
export async function readPayloadBundle(read:(path:string,sha:string)=>Promise<Uint8Array>,scene:NavigationSceneV1):Promise<PayloadBundle>{
 if(!validNav(scene)||scene.engine.id!=='mujoco_3d'||!digestOk(scene,'sceneDigest'))throw new Error('PAYLOAD_SCENE_INVALID');
 const ref=scene.engine.loadProfileRef,load=JSON.parse(new TextDecoder().decode(await read(ref.path,ref.sha256)));
 if(!validLoad(load)||!digestOk(load,'digest'))throw new Error('PAYLOAD_LOAD_INVALID');
 const admitted=admittedLoad(load.id);
 if(!admitted||ref.id!==load.id||ref.revision!==load.revision||hashJson({supports:load.supports,props:load.props})!==hashJson({supports:admitted.supports,props:admitted.props}))throw new Error('PAYLOAD_LOAD_UNADMITTED');
 const physical=JSON.parse(new TextDecoder().decode(await read(load.modelRef.path,load.modelRef.sha256)));
 if(!validPhysical(physical)||!digestOk(physical,'modelDigest')||mechanics(physical)!==mechanics(canonical as unknown as RobotPhysicalModelV1)||scene.robots.length!==1||scene.robots[0]!.model.physicalModelDigest!==physical.modelDigest)throw new Error('PAYLOAD_MODEL_INVALID');
 payloadGeometry(physical);// frame graph also validates normalized orientations/cycles
 return {scene,physical,load,loadSha256:ref.sha256,physicalSha256:load.modelRef.sha256};
}
export async function loadPayloadBundle(rt:TwinRuntime,bundle:string):Promise<PayloadBundle|null>{
 if(!rt.engineeringManifest||!rt.engineeringBlob)return null;
 const manifest=await rt.engineeringManifest(bundle),entry=manifest.files.find(f=>f.path==='navigation-scene.json');if(!entry)return null;
 const read=async(path:string,sha:string)=>{const e=manifest.files.find(f=>f.path===path&&f.sha256===sha);if(!e)throw new Error('PAYLOAD_BLOB_UNBOUND');const b=await rt.engineeringBlob!(sha);if(b.length!==e.sizeBytes||sha256Hex(b)!==sha)throw new Error('PAYLOAD_BLOB_CORRUPT');return b;};
 const scene=JSON.parse(new TextDecoder().decode(await read(entry.path,entry.sha256)));return scene.engine?.id==='mujoco_3d'?readPayloadBundle(read,scene):null;
}
export function payloadMatches(s:PayloadState,b:PayloadBundle):boolean{
 const prop=b.load.props.find(p=>p.propId===s.propId);return s.sceneDigest===b.scene.sceneDigest&&s.loadProfileSha256===b.loadSha256&&prop?.attachment.kind==='free'&&prop.attachment.supportId===s.supportId&&hashJson(prop.geometry)===hashJson(s.geometry);
}
export function payloadGeometry(model:RobotPhysicalModelV1){
 const frames=buildFrameGraph([{id:model.baseFrameId,parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]},...model.joints.map(j=>({id:j.child,parentId:j.parent,translationM:j.origin.xyzM,quaternionXyzw:j.origin.quaternionXyzw}))]);
 return model.links.flatMap(link=>link.visual.map(v=>{const p=composePose(frames.poseOf(link.id),{position:v.pose.xyzM,quaternionXyzw:v.pose.quaternionXyzw});return {linkId:link.id,geometry:v.geometry,positionM:p.position,quaternionXyzw:p.quaternionXyzw};}));
}
