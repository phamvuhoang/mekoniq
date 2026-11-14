/** Exact shared-world display projection. No custody inference, clock advance or interpolation. */
import type {LabWorldSceneV1,WorldEvidenceRecord,RobotPhysicalModelV1,LoadProfileV1} from '../shared/navigation2d';
import type {RunReport,RunView} from '../scenarios/controls';
import type {TwinPreset} from '../scenarios/catalog';
import type {TwinFrame,SceneEntity} from './scene';
import type {Held} from './store';
import {openReplayV2} from '../reports/replay';
export interface WorldDrawing {sourceRevision?:number;quality?:'valid'|'stale';scene:LabWorldSceneV1;record:WorldEvidenceRecord;physical:RobotPhysicalModelV1;load:LoadProfileV1;meshKey:string;readMesh?:(sha:string)=>Promise<ArrayBuffer>}
export function mapExtent(f:TwinFrame):{minM:[number,number];maxM:[number,number]}{
 if(f.world&&!f.world.scene.controllerPolicy?.bounds&&!f.extent)throw Error('WORLD_DISPLAY_EXTENT_UNAVAILABLE');
 const b=f.world?.scene.controllerPolicy?.bounds??f.extent;
 if(b){if(![...b.minM,...b.maxM].every(Number.isFinite)||b.minM.some((v,i)=>v>=b.maxM[i]!))throw Error('WORLD_DISPLAY_EXTENT_INVALID');return {minM:[...b.minM] as [number,number],maxM:[...b.maxM] as [number,number]};}
 return {minM:[0,0],maxM:[f.preset.project.world.width,f.preset.project.world.height]};
}
export function worldEntities(w:WorldDrawing):SceneEntity[]{
 const source=w.quality==='stale'?'unknown' as const:'observed' as const,s=w.record.snapshot,arm=w.scene.armCell.arm,b=arm.baseInMap.position;
 return [...s.robots.map(r=>({id:r.robotId,kind:'amr',name:r.robotId,x:r.poseDriveMap[0]!,y:r.poseDriveMap[1]!,yawRad:r.poseDriveMap[2]!,pose3d:r.pose3d?{z:r.pose3d.z,rollRad:r.pose3d.roll,pitchRad:r.pose3d.pitch}:undefined,source})),
 {id:arm.armId,kind:'arm',name:'xArm 6 · Gripper G2',x:b[0]!,y:b[1]!,source},
 ...(s.props??[]).map(p=>({id:p.propId,kind:'cup',name:p.propId,x:p.position[0]!,y:p.position[1]!,source,cupGeometry:w.scene.armCell.props.find(d=>d.propId===p.propId),plant:{positionM:p.position as [number,number,number],quaternionXyzw:p.quaternionXyzw as [number,number,number,number]}}))];
}
export function worldFrame(preset:TwinPreset,report:RunReport,world:WorldDrawing,tick:number,projection:ReturnType<typeof openReplayV2> =openReplayV2(report)):TwinFrame{
 const result=projection.project({run:{id:report.manifest.runId,status:report.outcome.status},entities:[],workload:[],tick:report.outcome.tick} as unknown as RunView,tick),s=world.record.snapshot,now=0,samples={...result.samples};
 for(const a of s.arms??[])samples[a.armId]={schemaVersion:2,entityId:a.armId,runId:s.runId,providerId:'mujoco_arm',bootId:s.bootId,seq:s.seq,simTimeNs:s.simTimeNs,observedAt:null,receivedMonotonicNs:null,origin:'physics_sim',frameId:'arm_base',quality:'valid',reasonCodes:[],commanded:null,observed:{jointsRad:a.positionsRad,gripperOpeningM:a.gripper?.openingM},estimated:null,causationId:null,receivedAtMs:now} as unknown as Held;
 const entities=s.robots.map(r=>({id:r.robotId,kind:'amr' as const,pose:{x:r.poseDriveMap[0]!,y:r.poseDriveMap[1]!,yawRad:r.poseDriveMap[2]!,z:r.pose3d?.z,rollRad:r.pose3d?.roll,pitchRad:r.pose3d?.pitch},quality:'valid' as const,moving:Math.abs(r.bodyVelocity[0]!)>0.001,hold:null,goal:null,path:[],distanceM:0}));
 return {...result,preset,view:{...result.view!,entities,tick,simTimeNs:s.simTimeNs},report:result.report,samples,nowMs:now,world,navigation:world.scene.navigation,payloadBundle:{scene:world.scene.navigation,physical:world.physical,load:world.load,physicalSha256:world.scene.models.mobilePhysical.sha256,loadSha256:world.scene.models.emptyLoad.sha256}};
}
export function worldPhase(record:WorldEvidenceRecord):{id:string;camera:'cell'|'amr';cupId?:string;commandId?:string}{
 const p=record.command?.worldControl?.program;
 if(p)return {id:`${p.programId} · ${p.waypoint} · ${p.stage}`,camera:'cell',cupId:p.cupId,commandId:p.commandId};
 if(record.command?.worldControl?.stopLatched)return {id:'stop_latched',camera:'cell'};
 if(record.command?.velocities.some(v=>Math.abs(v.vMps)>0.001||Math.abs(v.omegaRadps)>0.001))return {id:'transport',camera:'amr'};
 return {id:'source_idle',camera:'cell'};
}
