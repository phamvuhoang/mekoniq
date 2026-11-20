import {join} from 'node:path';
import {hashJson} from '../hash';
import {BASE_CONTROLLER_DEFAULTS,mobileDrive} from '../control/drive-run';
import {driveDocumentDigest,splitDriveSnapshot,type ControlProfileV1,type DriveModelV1} from '../control/drive-io';
import {buildDriveEvidence} from '../control/drive-report';
import type {ControllerEvent} from '../control/controller';
import {jointTrajectoryFollowerV1} from '../control/joint-follower';
import type {WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import type {Sim3DSnapshotV1} from '../navigation2d/contracts';
import type {XArmPhysics} from './arm-cell-scene';
import {worldDocument} from './world-control';
import {captureWorldPrefixDisk,materializeWorldPrefix,type WorldAdmission} from './world-evidence';


export function worldDriveControllers(admission:WorldAdmission){
 const {scene,files}=admission,engine=scene.engine;
 if(!engine?.driveModelRef||!engine.controlProfileRef)throw Error('WORLD_DRIVE_DOCUMENT_MISSING');
 const model=worldDocument<DriveModelV1>(files,engine.driveModelRef.path),control=worldDocument<ControlProfileV1>(files,engine.controlProfileRef.path);
 if(driveDocumentDigest(model)!==model.digest||driveDocumentDigest(control)!==control.digest||!control.driveModelDigests.includes(model.digest)||!control.controllers.some(c=>c.controllerId===jointTrajectoryFollowerV1.id&&c.revision===jointTrajectoryFollowerV1.revision))throw Error('WORLD_DRIVE_DOCUMENT_INVALID');
 const robot=scene.navigation.robots[0]!,armId=scene.armCell.arm.armId,base=mobileDrive({model,control},{robotId:robot.robotId,...robot.model.kinematics});
 const arm=worldDocument<{joints:{id:string;limits:{lower:{value:number};upper:{value:number}}}[]}>(files,scene.models.armComponent.path);
 const grip=arm.joints.find(j=>j.id==='drive_joint')!.limits,physics=worldDocument<XArmPhysics>(files,scene.models.armPhysics.path);
 let joint=jointTrajectoryFollowerV1.init({axes:[1,2,3,4,5,6].map(i=>armId+'/J'+i),gripperAxis:armId+'/gripper',gripperMap:{loRad:grip.lower.value,hiRad:grip.upper.value,openingMaxM:physics.gripper.openingMaxM},enableTimeoutTicks:BASE_CONTROLLER_DEFAULTS.enableTimeoutTicks,followTolRad:0.3,followTicks:25});
 return {model,control,step(last:Sim3DSnapshotV1,command:NonNullable<WorldEvidenceRecord['command']>){
  const v=command.velocities[0],q=command.jointTargets?.[0],g=command.gripperTargets?.[0];
  if(v?.robotId!==robot.robotId||q?.armId!==armId||g?.armId!==armId||!last.drives)throw Error('WORLD_DRIVE_SETPOINT_INVALID');
  const b=base.step(last.tick,{vMps:v.vMps,omegaRadps:v.omegaRadps,stop:command.worldControl?.movementInterlocked},last);
  const a=jointTrajectoryFollowerV1.step(joint,{tick:last.tick,setpoint:{positionsRad:q.positionsRad,openingM:g.openingM},feedback:splitDriveSnapshot(last.drives).feedback});
  joint=a.state;return {commands:[...a.commands,...b.commands],events:[...b.events,...a.events]};
 }};
}
export function buildWorldDriveReport(admission:WorldAdmission,records:WorldEvidenceRecord[],issues:string[]){
 const drive=worldDriveControllers(admission),events:ControllerEvent[]=[],rows=[];
 for(const [i,row] of records.entries()){
  const {snapshot,command}=row;
  if(!snapshot.drives){issues=[...issues,'WORLD_DRIVE_FEEDBACK_MISSING'];break;}
  if(i){
   if(!command){issues=[...issues,'WORLD_DRIVE_COMMAND_MISSING'];break;}
   const replay=drive.step(records[i-1]!.snapshot,command);
   if(hashJson(replay.commands)!==hashJson(command.driveCommands)||snapshot.drives.some(d=>d.commandSeq!==snapshot.tick)){
    issues=[...issues,'WORLD_DRIVE_COMMAND_REPLAY'];break;
   }
   events.push(...replay.events);
  }
  rows.push({tick:snapshot.tick,drives:snapshot.drives});
 }
 return buildDriveEvidence(drive.model,rows,{complete:issues.length===0,issues,events});
}
export async function readWorldDriveReport(directory:string,admission:WorldAdmission,identity:{runId:string;bootId:string;publicCommittedTick:number}){
 const capture=await captureWorldPrefixDisk(join(directory,'world-evidence'),admission,{...identity,sceneDigest:admission.scene.sceneDigest,admissionDigest:admission.digest});
 const prefix=await materializeWorldPrefix(capture,admission),issues=[...prefix.issues];
 if(prefix.publication.terminal||prefix.publication.gaps.length)issues.push('WORLD_FAILED');
 return buildWorldDriveReport(admission,prefix.records,issues);
}
