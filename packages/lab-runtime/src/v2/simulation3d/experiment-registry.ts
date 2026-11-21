/** One lookup over the two closed mujocoExperimentId families (payload, tray): the compiler, the input verifier and the comparison read the same shape. */
import {PAYLOAD_EXPERIMENTS,payloadExperiment} from './payload-experiments';
import {TRAY_ACCELERATION,isTrayExperiment,trayExperiment} from './tray-experiments';
export interface MujocoExperiment{family:'payload'|'tray';fixture:'serve-payload-v1'|'serve-tray-v1';load:string;physics:string;maxLinearMps:number;maxAngularRadps:number;
 /** tray only: the navigation policy's limit, the base controller's limit above it, the drive experiment the variant implies and whether a scripted person crosses the route */
 maxAccelerationMps2?:number;baseAccelerationMps2?:number;driveExperimentId?:string;actor?:boolean}
export function mujocoExperiment(id:string):MujocoExperiment{
 if(Object.hasOwn(PAYLOAD_EXPERIMENTS,id))return {family:'payload',fixture:'serve-payload-v1',...payloadExperiment(id)};
 if(!isTrayExperiment(id))throw new Error('MUJOCO_EXPERIMENT_UNREGISTERED');
 const e=trayExperiment(id),a=TRAY_ACCELERATION[e.accelerationPolicy];
 return {family:'tray',fixture:'serve-tray-v1',load:e.load,physics:e.physics,maxLinearMps:0.5,maxAngularRadps:1,maxAccelerationMps2:a.policyMps2,baseAccelerationMps2:a.baseLimitMps2,driveExperimentId:e.driveExperimentId,actor:e.actor};
}
