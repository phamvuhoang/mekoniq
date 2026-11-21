/** One lookup over the two closed mujocoExperimentId families (payload, tray): the compiler, the input verifier and the comparison read the same shape. */
import {PAYLOAD_EXPERIMENTS,payloadExperiment} from './payload-experiments';
import {defaultNavigationPolicy,sealDocument} from '../navigation2d/contracts';
import {hashJson} from '../hash';
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

/** The navigation policy an experiment applies: the baseline with the registered limits (all else retained), sealed with the experiment's name; the baseline itself when the limits equal it. The compiler and the input verifier build the same one. */
export function experimentPolicy(id:string){
 const e=mujocoExperiment(id),baseline=defaultNavigationPolicy(),parameters={...baseline.parameters,maxLinearMps:e.maxLinearMps,maxAngularRadps:e.maxAngularRadps,...e.maxAccelerationMps2===undefined?{}:{maxAccelerationMps2:e.maxAccelerationMps2}};
 if(hashJson(parameters)===hashJson(baseline.parameters))return baseline;
 const family=e.family==='tray'?'tray-experiments-v1':'payload-experiments-v1',what=e.family==='tray'?'speed and acceleration limits':'speed caps';
 return sealDocument({...baseline,id:`${id}-navigation-policy`,parameters,source:{kind:'assumed' as const,documentId:family,revision:'1',locator:`registered ${id} ${what}; all other parameters retain baseline`,contentSha256:hashJson(parameters)}},'hash');
}
