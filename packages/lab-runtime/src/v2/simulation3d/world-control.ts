/** Source control context is command provenance, never a sensor or custody receipt. */
import {validateWorldControlShape,type LabWorldSceneV1,type LoadProfileV1} from '../navigation2d/contracts';
import type {WorldControl} from './world-ports';
import type {ArmProgramSet} from '../../../../cell-adapters/src/mock-arm';
import type {XArmPhysics} from './arm-cell-scene';
import {DEFAULT_ARM_GEOMETRY,type ArmGeometry} from '../models/arm-collision';
import {XARM6_SI} from '../models/arm-kinematics';
import {qconj,qrotate} from '../frames';
export const worldDocument=<T>(files:ReadonlyMap<string,Uint8Array>,path:string):T=>JSON.parse(Buffer.from(files.get(path)!).toString()) as T;
export function worldArmGeometry(scene:LabWorldSceneV1,files:ReadonlyMap<string,Uint8Array>):ArmGeometry{
 const p=worldDocument<XArmPhysics>(files,scene.models.armPhysics.path),cup=scene.armCell.props[0]!,axis=qrotate(qconj(scene.armCell.graspFrames.pick.quaternionXyzw),[0,0,1]);
 return {...DEFAULT_ARM_GEOMETRY,provenance:'assumed',linkRadiiM:[...p.capsuleRadiusM],gripperBackM:XARM6_SI.toolM[2]-p.palm.centerM[2]+p.palm.sizeM[2]/2,gripperRadiusM:Math.hypot(p.palm.sizeM[0]/2,p.palm.sizeM[1]/2),cupRadiusM:cup.radiusM,cupHeightM:cup.heightM,cupAxisInTool:[axis[0]!,axis[1]!,axis[2]!]};
}
export function worldAllowedPairs(scene:LabWorldSceneV1,files:ReadonlyMap<string,Uint8Array>,programId:string|null):[string,string][]{
 const phase=programId==='cup-pick'?'grasp':programId==='cup-place'?'release':null,load=worldDocument<LoadProfileV1>(files,scene.models.emptyLoad.path),support=load.supports.find(s=>s.supportId===scene.supportMap.mobileSupportId)!,rid=scene.navigation.robots[0]!.robotId;
 return scene.allowedContactRules.filter(r=>r.phase===phase).map(r=>{if(r.regionId!=='nozzle-stand'&&r.regionId!==support.supportId||r.regionId!==r.b)throw Error('WORLD_CONTROL_INVALID');return [r.a==='held_prop'?'held-cup':r.a,r.regionId==='nozzle-stand'?'support/nozzle-stand':`${rid}/${support.parentBodyId}/c0`];});
}
export function validateWorldControl(input:unknown,scene:LabWorldSceneV1,files:ReadonlyMap<string,Uint8Array>):asserts input is WorldControl|undefined{
 const fail=()=>{throw Error('WORLD_CONTROL_INVALID');};if(scene.controlContextVersion!==1){if(input!==undefined)fail();return;}if(!validateWorldControlShape(input))fail();
 const c=input as WorldControl,p=c.program,programs=worldDocument<{programs:ArmProgramSet}>(files,scene.programsRef.path).programs;
 if(c.movementInterlocked!==!!(p||c.attachmentProxyPropId||c.stopLatched)||c.attachmentProxyPropId&&!scene.propBindings.some(b=>b.propId===c.attachmentProxyPropId))fail();
 if(p&&(!scene.propBindings.some(b=>b.cupId===p.cupId)||programs.choreography[p.programId]?.[p.stage]?.waypoint!==p.waypoint))fail();
}
