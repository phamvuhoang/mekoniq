import {join} from 'node:path';
import {hashJson} from '../hash';
import {BASE_CONTROLLER_DEFAULTS,mobileDrive} from '../control/drive-run';
import {driveDocumentDigest,splitDriveSnapshot,type ControlProfileV1,type DriveCommandV1,type DriveModelV1,type FaultOracleV1,type FaultReportV1} from '../control/drive-io';
import {buildDriveEvidence} from '../control/drive-report';
import type {ControllerEvent} from '../control/controller';
import {applyCommandLoss,interlockOverridden,runtimeFaultsAt,type FaultReceipt} from '../control/drive-faults';
import {buildFaultReport,servedFacts} from '../fault-report';
import type {FaultScheduleEntry} from '../fault-schedule';
import {jointTrajectoryFollowerV1} from '../control/joint-follower';
import type {WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import type {Sim3DSnapshotV1} from '../navigation2d/contracts';
import type {XArmPhysics} from './arm-cell-scene';
import {readRetainedWorldAdmission} from './world-arm-report';
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
  if(command.velocities.length!==1||command.jointTargets?.length!==1||command.gripperTargets?.length!==1||v?.robotId!==robot.robotId||q?.armId!==armId||g?.armId!==armId||!last.drives)throw Error('WORLD_DRIVE_SETPOINT_INVALID');
  const b=base.step(last.tick,{vMps:v.vMps,omegaRadps:v.omegaRadps,stop:command.worldControl?.movementInterlocked},last);
  const a=jointTrajectoryFollowerV1.step(joint,{tick:last.tick,setpoint:{positionsRad:q.positionsRad,openingM:g.openingM},feedback:splitDriveSnapshot(last.drives).feedback});
  joint=a.state;return {commands:[...a.commands,...b.commands],events:[...b.events,...a.events]};
 }};
}
/** The cell's recorded drive rows and the controller events replayed from them. With a fault schedule the replay applies the schedule's own command-loss timeline to what the controllers ask for before it
 * compares with what was sent, and an axis' acknowledged seq is the seq of what was sent to it. */
export function replayWorldDrive(admission:WorldAdmission,records:WorldEvidenceRecord[],issues:string[],faults:readonly FaultScheduleEntry[]=[]){
 const drive=worldDriveControllers(admission),events:ControllerEvent[]=[],rows:{tick:number;drives:NonNullable<WorldEvidenceRecord['snapshot']['drives']>}[]=[];let lastSent:DriveCommandV1[]|undefined;
 for(const [i,row] of records.entries()){
  const {snapshot,command}=row;
  if(!snapshot.drives){issues=[...issues,'WORLD_DRIVE_FEEDBACK_MISSING'];break;}
  if(i){
   if(!command){issues=[...issues,'WORLD_DRIVE_COMMAND_MISSING'];break;}
   try{
    const replay=drive.step(records[i-1]!.snapshot,command);
    const activeNow=runtimeFaultsAt(faults,snapshot.tick).active,over=interlockOverridden(activeNow,new Set([`${admission.scene.navigation.robots[0]!.robotId}/wheel-left`,`${admission.scene.navigation.robots[0]!.robotId}/wheel-right`]),!!command.worldControl?.movementInterlocked),lost=new Set(activeNow.filter(e=>e.faultId==='command-loss'&&!over.includes(e)).map(e=>e.targetId)),sent=lost.size?applyCommandLoss(replay.commands,lastSent,lost):replay.commands;lastSent=sent;
    const seqOf=(axisId:string)=>faults.length?sent.find(c=>c.axisId===axisId)?.seq:snapshot.tick;
    if(!command.driveCommands||hashJson(sent)!==hashJson(command.driveCommands)||snapshot.drives.some(d=>d.commandSeq!==seqOf(d.axisId)))throw Error('WORLD_DRIVE_COMMAND_REPLAY');
    events.push(...replay.events);
   }catch(e){issues=[...issues,(e as Error).message];break;}
  }
  rows.push({tick:snapshot.tick,drives:snapshot.drives});
 }
 return {drive,rows,events,issues};
}
export function buildWorldDriveReport(admission:WorldAdmission,records:WorldEvidenceRecord[],issues:string[],faults:readonly FaultScheduleEntry[]=[]){
 const r=replayWorldDrive(admission,records,issues,faults);
 return buildDriveEvidence(r.drive.model,r.rows,{complete:r.issues.length===0,issues:r.issues,events:r.events});
}
/** The fault report of a cell run, from the verified prefix of its own stream: recorded intents (the commands), the worker's receipts (the snapshots) and the runtime's (the commands, after the ACK). */
export function buildWorldFaultReport(admission:WorldAdmission,records:WorldEvidenceRecord[],issues:string[],o:{runId:string;faults:readonly FaultScheduleEntry[];oracle:FaultOracleV1;facts:{serveTicks:readonly number[];custodyChanged:boolean|'unknown';attention:readonly {tick:number;reason:string}[]}}){
 const r=replayWorldDrive(admission,records,issues,o.faults);
 if(r.issues.length)throw Error(`FAULT_EVIDENCE_INVALID:${r.issues[0]}`);
 const gaps=issues.length;void gaps;
 return buildFaultReport({runId:o.runId,schedule:o.faults,oracle:o.oracle,drives:r.rows,controllerEvents:r.events,attention:o.facts.attention,
  receipts:records.flatMap(x=>[...(x.snapshot as {faultReceipts?:FaultReceipt[]}).faultReceipts??[],...x.command?.faultReceipts??[]]),
  intents:records.map(x=>({tick:x.snapshot.tick,injections:x.command?.faultInjections??[]})),
  physics:records.map(x=>({tick:x.snapshot.tick,base:x.snapshot.physics?.base})),
  axisModes:Object.fromEntries(worldDocument<DriveModelV1>(admission.files,admission.scene.engine!.driveModelRef!.path).axes.map(a=>[a.axisId,a.mode as 'csp'|'csv'])),
  // no count of the steps sent after an unknown ACK exists for a cell run: that invariant is not evidenced here, never passed
  facts:{...servedFacts(r.rows,o.facts.serveTicks),resendsAfterUnknown:null,custodyChanged:o.facts.custodyChanged}});
}
/** The sealed fault oracle a faulted cell run was judged by, kept in the run directory. */
export const FAULT_ORACLE_FILE='fault-oracle-v1.json';
/** What the cell's physical custody says for the fault report's invariant: a transfer that ended unknown (listed, or in the attention) means custody cannot be said unchanged. */
export const custodyFacts=(physical:readonly {status:string}[],attention:readonly {reason:string}[]):false|'unknown'=>physical.some(x=>x.status==='unknown')||attention.some(a=>/(TRANSFER|EXECUTION|WORLD_RESTART)_UNKNOWN/.test(a.reason))?'unknown':false;
export async function readWorldDriveReport(directory:string,admission:WorldAdmission,identity:{runId:string;bootId:string;publicCommittedTick:number},faults:readonly FaultScheduleEntry[]=[]){
 const capture=await captureWorldPrefixDisk(join(directory,'world-evidence'),admission,{...identity,sceneDigest:admission.scene.sceneDigest,admissionDigest:admission.digest});
 const prefix=await materializeWorldPrefix(capture,admission),issues=[...prefix.issues];
 if(prefix.publication.terminal||prefix.publication.gaps.length)issues.push('WORLD_FAILED');
 return buildWorldDriveReport(admission,prefix.records,issues,faults);
}
/** The same read, to a fault report. A prefix that is not whole, or evidence that does not reconcile, throws: the caller reports it, a fault report is only made from complete evidence and never goes missing quietly. */
export async function readWorldFaultReport(directory:string,admission:WorldAdmission,identity:{runId:string;bootId:string;publicCommittedTick:number},o:Omit<Parameters<typeof buildWorldFaultReport>[3],'runId'>){
 const capture=await captureWorldPrefixDisk(join(directory,'world-evidence'),admission,{...identity,sceneDigest:admission.scene.sceneDigest,admissionDigest:admission.digest});
 const prefix=await materializeWorldPrefix(capture,admission);
 if(prefix.issues.length||prefix.publication.terminal||prefix.publication.gaps.length)throw Error(`FAULT_EVIDENCE_INVALID:${prefix.issues[0]??'WORLD_FAILED'}`);
 return buildWorldFaultReport(admission,prefix.records,[],{...o,runId:identity.runId});
}
/** What a read of the fault report gave: the report, or the reasons there is none. */
export async function faultReadOutcome(read:()=>Promise<FaultReportV1|undefined>):Promise<{report?:FaultReportV1;issues:string[]}>{
 try{const report=await read();return report?{report,issues:[]}:{issues:['FAULT_REPORT_UNAVAILABLE']};}
 catch(e){return {issues:[(e as NodeJS.ErrnoException).code==='ENOENT'?'WORLD_RETAINED_BUNDLE_UNAVAILABLE':(e as Error).message]};}
}

/** No installed replacement document may supply measurements for an unavailable cold bundle. */
export async function readRetainedWorldDriveReport(directory:string,identity:{runId:string;bootId:string;sceneDigest:string;publicCommittedTick:number},faults:readonly FaultScheduleEntry[]=[]){
 try{return await readWorldDriveReport(directory,await readRetainedWorldAdmission(directory,identity.sceneDigest),identity,faults);}
 catch(e){
  const reason=(e as NodeJS.ErrnoException).code==='ENOENT'?'WORLD_RETAINED_BUNDLE_UNAVAILABLE':(e as Error).message;
  return buildDriveEvidence({axes:[]},[],{complete:false,issues:[reason],events:[]});
 }
}

export const readRetainedWorldFaultReport=(directory:string,identity:{runId:string;bootId:string;sceneDigest:string;publicCommittedTick:number},o:Omit<Parameters<typeof buildWorldFaultReport>[3],'runId'>)=>
 faultReadOutcome(async()=>readWorldFaultReport(directory,await readRetainedWorldAdmission(directory,identity.sceneDigest),identity,o));
