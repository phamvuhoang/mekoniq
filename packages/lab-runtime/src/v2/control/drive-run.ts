// The glue between a run and its virtual drive (R4-A §5.3, plan V04): admit the two bundle documents of a scene that names them, build the controller configuration from them
// and the plant, and turn a navigation setpoint plus the last measured feedback into the commands of the next tick. Nothing here reads the true state of the plant.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {splitDriveSnapshot,validateControlProfile,validateDriveModel,validateDriveRefs,type ControlProfileV1,type DriveAxisSnapshot,type DriveCommandV1,type DriveModelV1,type TuningEnvelopeV1} from './drive-io';
import {diffDriveBaseV1,initDiffDriveRevision2,type DiffDriveBaseConfig,type DiffDriveBaseState} from './diff-drive-base';
import type {ControllerEvent} from './controller';

export const CONTROLLER_IN_THE_LOOP='controller_in_the_loop' as const;
/** Starting values of the controller's own timers (`assumed`): ticks of 20 ms. */
const SUBSTEP_S=0.002;   // the worker's engine step: the drive's velocity window is counted in these
/** The speed one count of the wheel encoders is worth over the drive's velocity window (0 for an exact encoder): the coarsest of the two wheels. */
export function wheelVelocityResolutionRadS(model:Pick<DriveModelV1,'axes'>,robotId:string):number{
 return Math.max(0,...model.axes.filter(a=>a.axisId===`${robotId}/wheel-left`||a.axisId===`${robotId}/wheel-right`).map(a=>a.encoder.countsPerRev===null?0:2*Math.PI/a.encoder.countsPerRev/(a.encoder.velocityWindowSubsteps*SUBSTEP_S)));
}
export const BASE_CONTROLLER_DEFAULTS={enableTimeoutTicks:50,trackingDegradedRadS:1,trackingDegradedTicks:25} as const;
export interface DriveManifest {driveModelDigest:string;controlProfileDigest:string;controllers:{id:string;revision:number}[];testLevel:typeof CONTROLLER_IN_THE_LOOP;experimentId?:string;/** the architecture the worker reported (contracts §1): required for a drive run, since bit identity only means something within one */hostArch?:HostArch}
export type HostArch='arm64'|'x86_64';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
type Ref={id:string;revision:number;path:string;sha256:string};

/** The documents a scene names, checked: shape, own digest, pairing, the server's tuning envelope, the plant binding. Undefined when the scene names none. */
export async function admitDriveDocuments(scene:{engine?:object},read:(path:string)=>Promise<Uint8Array>,workerRoot:string,plantDigest:string|null):Promise<{model:DriveModelV1;control:ControlProfileV1}|undefined>{
 const refs=validateDriveRefs({engine:(scene.engine??{}) as Record<string,unknown>});
 if(!refs.ok)throw new Error(refs.reasonCodes[0]);
 const e=(scene.engine??{}) as {driveModelRef?:Ref;controlProfileRef?:Ref};
 if(!e.driveModelRef||!e.controlProfileRef)return undefined;
 const load=async<T,>(r:Ref)=>{const b=await read(r.path);if(sha(b)!==r.sha256)throw new Error('DRIVE_DOCUMENT_HASH_MISMATCH');return JSON.parse(Buffer.from(b).toString()) as T;};
 const model=await load<DriveModelV1>(e.driveModelRef),control=await load<ControlProfileV1>(e.controlProfileRef);
 const envelope=JSON.parse(await readFile(join(workerRoot,'fixtures/drive-v1/tuning-envelope-v1.json'),'utf8')) as TuningEnvelopeV1;
 // a world's axes carry the scene's arm id, the envelope of the fixture the xarm-1 prefix: bound by suffix
 const bound={...envelope,axes:model.axes.map(a=>{const own=envelope.axes.find(x=>x.axisId===a.axisId)??envelope.axes.find(x=>x.axisId.split('/')[1]===a.axisId.split('/')[1]&&x.axisId.startsWith('xarm-1/'));return own?{...own,axisId:a.axisId}:undefined;}).filter(Boolean) as TuningEnvelopeV1['axes']};
 const checks=[validateDriveModel(model),validateControlProfile(control,model,bound)];
 const bad=checks.find(c=>!c.ok);if(bad)throw new Error(`DRIVE_DOCUMENT_INVALID:${bad.reasonCodes.join(',')}`);
 if(plantDigest!==null&&control.plantModelDigest!==plantDigest)throw new Error('DRIVE_PLANT_MISMATCH');
 return {model,control};
}

export const driveManifest=(d:{model:DriveModelV1;control:ControlProfileV1},experimentId?:string,hostArch?:HostArch):DriveManifest=>({driveModelDigest:d.model.digest,controlProfileDigest:d.control.digest,
 controllers:d.control.controllers.map(c=>({id:c.controllerId,revision:c.revision})),testLevel:CONTROLLER_IN_THE_LOOP,...experimentId?{experimentId}:{},...hostArch?{hostArch}:{}});

export interface MobileDrive {readonly manifest:DriveManifest;readonly model:DriveModelV1;readonly events:ControllerEvent[];
 /** The commands of the next tick from the navigation controller's setpoint and the drive feedback of the last verified snapshot. */
 step(tick:number,setpoint:{vMps:number;omegaRadps:number;stop?:boolean},snapshot:{drives?:readonly DriveAxisSnapshot[]}):{commands:DriveCommandV1[];events:ControllerEvent[];odometry:[number,number,number]}}

export function mobileDrive(d:{model:DriveModelV1;control:ControlProfileV1},robot:{robotId:string;wheelRadiusM:number;wheelSeparationM:number;maxLinearMps:number;maxAngularRadps:number}):MobileDrive{
 const ctl=d.control.controllers.find(c=>c.controllerId===diffDriveBaseV1.id);
 if(!ctl||![1,2].includes(ctl.revision))throw new Error('DRIVE_CONTROLLER_UNREGISTERED');
 const accelMps2=ctl.params.maxAccelerationMps2;
 const config:DiffDriveBaseConfig={axisLeft:`${robot.robotId}/wheel-left`,axisRight:`${robot.robotId}/wheel-right`,wheelRadiusM:robot.wheelRadiusM,wheelSeparationM:robot.wheelSeparationM,
  maxWheelAccelRadS2:typeof accelMps2==='number'?accelMps2/robot.wheelRadiusM:1e9,...BASE_CONTROLLER_DEFAULTS,velocityResolutionRadS:wheelVelocityResolutionRadS(d.model,robot.robotId)};
 if(ctl.revision===2&&typeof accelMps2!=='number')throw Error('DRIVE_CONTROLLER_LIMIT_INVALID');
 let state:DiffDriveBaseState=ctl.revision===1?diffDriveBaseV1.init(config):initDiffDriveRevision2(config,Number(ctl.params.maxJerkMps3)/robot.wheelRadiusM,{
  wheel:[config.axisLeft,config.axisRight].map(id=>d.model.axes.find(a=>a.axisId===id)?.velocityLimitRadS??0) as [number,number],mean:robot.maxLinearMps/robot.wheelRadiusM,halfDifference:robot.maxAngularRadps*robot.wheelSeparationM/(2*robot.wheelRadiusM)});const events:ControllerEvent[]=[];
 return {manifest:driveManifest(d),model:d.model,events,step(tick,setpoint,snapshot){
  if(!snapshot.drives)throw new Error('DRIVE_FEEDBACK_MISSING');
  const {feedback}=splitDriveSnapshot(snapshot.drives),r=diffDriveBaseV1.step(state,{tick,setpoint,feedback});
  state=r.state;events.push(...r.events);
  return {commands:r.commands,events:r.events,odometry:state.odometry};
 }};
}

/** The step a drive world sends: the controllers' setpoints (velocities, joint and gripper targets) stay in the evidence and are not sent. */
export function driveWireCommand<T extends {velocities:unknown[];jointTargets:unknown[];gripperTargets:unknown[]}>(c:T):T{
 const {velocities:_v,jointTargets:_j,gripperTargets:_g,...rest}=c;void _v;void _j;void _g;
 return {...rest,velocities:[],jointTargets:[],gripperTargets:[]} as unknown as T;
}
