import project from '../../fixtures/twins/shared-world/project.json';
import physical from '../../fixtures/twins/shared-world/mobile-physical.json';
import load from '../../fixtures/twins/shared-world/empty-load.json';
import type {TwinPreset} from '../scenarios/catalog';
import type {LabProjectV2} from '../shared/types';
import type {LabWorldSceneV1,RobotPhysicalModelV1,LoadProfileV1} from '../shared/navigation2d';
import type {WorldDrawing} from './world-view';
import {tr} from '../i18n';
export const CELL_SET='engineering-mujoco-cell-v1';
export const WORLD_EXPERIMENTS=['world-nominal-v1','world-cup-fall-v1','world-dock-drift-v1'] as const;
export type WorldExperiment=typeof WORLD_EXPERIMENTS[number];
export const worldExperimentLabel=(id:string)=>id==='world-nominal-v1'?tr('Giao cà phê','コーヒーを届ける','Coffee delivery'):id==='world-cup-fall-v1'?tr('Cốc rơi do tác động','外力によるカップ落下','Cup falls after an impact'):tr('Lệch dock do tác động','外力によるドックずれ','Dock drift after an impact');
export function cellPreset():TwinPreset{return {id:'mujoco-cell',view:'arm_cell',scenarioId:'MJ-CELL-BV01',scenarioRevision:1,backendSetId:CELL_SET,mode:'simulation',seed:7,speed:1,worldExperimentId:'world-nominal-v1',project:structuredClone(project) as LabProjectV2,assets:[],names:{'arm-1':'xArm 6 · G2','amr-1':'Serve'},roles:{entities:['amr','arm','coffee_machine'],points:['coffee_pickup','parking','table']},title:()=>tr('Giao cà phê · Cell vật lý mô phỏng','コーヒー配送 · 物理シミュレーションセル','Coffee delivery · simulated physical cell'),summary:()=>tr('Một thế giới MuJoCo · Serve + xArm 6/G2 + cốc tự do · chưa hiệu chuẩn','1つのMuJoCo世界 · Serve + xArm 6/G2 + 自由カップ · 未校正','One MuJoCo world · Serve + xArm 6/G2 + free cups · not calibrated')};}
/** Only exact known assets may dress a live admitted scene. A different model is an explicit unavailable view. */
export function knownWorldDrawing(scene:LabWorldSceneV1):Omit<WorldDrawing,'record'>|null{
 if(scene.models.mobilePhysical.sha256!=='830ba57f4f51272b533fd2c6a2c8743ba4857341af0e7af90f4525145b7249b9'||scene.models.emptyLoad.sha256!=='58251fa7d1f98e32bb3807d30bdd849c897edee21709f98baf3fa125ea68f682')return null;
 return {scene,physical:physical as unknown as RobotPhysicalModelV1,load:load as unknown as LoadProfileV1,meshKey:scene.inputs.armModelDigest+':'+scene.models.armComponent.sha256,readMesh:async sha=>{const response=await fetch(`/fixtures/xarm6-g2-v1/blobs/${sha}.stl`);if(!response.ok)throw Error('ARM_MESH_UNAVAILABLE');return response.arrayBuffer();}};
}
