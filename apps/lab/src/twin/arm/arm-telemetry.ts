// Arm telemetry for the twin (plan 03 A05): a TwinSample of an arm entity (mock_arm commanded-only, or linuxcnc_sim controller_sim with
// actual joints) becomes a view with commanded and actual apart, the source timestamp, freshness by the browser's receipt clock and the
// provider's provenance. Rendering only ever shows the latest observed value: no extrapolation, no animation that completes a pickup.
import type {Held} from '../store';
export interface ArmJointsView {jointsActualRad:number[]|null;jointsCommandedRad:number[]|null;/** observed gripper opening, when the provider reports one */gripperOpeningM:number|null;tcpM:[number,number,number]|null;homed:boolean|null;gripper:'open'|'closed'|'unknown';
 provenance:'controller_sim'|'mock'|'physics_sim'|'hardware';providerId:string;bootId:string;seq:string;observedAt:string|null;quality:'valid'|'stale'|'unknown'|'invalid';ageMs:number;stale:boolean;reasonCodes:string[]}
const six=(v:unknown):number[]|null=>Array.isArray(v)&&v.length===6&&v.every(n=>typeof n==='number'&&Number.isFinite(n))?[...v] as number[]:null;
/** `nowMs` is the browser's receipt clock (performance.now domain of the store); staleMs is the gateway/profile threshold (500 ms default). */
export function armJointsView(sample:Held,nowMs:number,staleMs=500):ArmJointsView {
 const obs=(sample.observed??{}) as Record<string,unknown>,cmd=(sample.commanded??{}) as Record<string,unknown>,ageMs=Math.max(0,nowMs-sample.receivedAtMs),stale=ageMs>staleMs||sample.quality==='stale';
 const tcp=Array.isArray(obs.tcpM)&&obs.tcpM.length===3&&(obs.tcpM as unknown[]).every(n=>typeof n==='number')?[...obs.tcpM] as [number,number,number]:null;
 return {jointsActualRad:six(obs.jointsRad),jointsCommandedRad:six(cmd.jointsRad),gripperOpeningM:typeof obs.gripperOpeningM==='number'&&Number.isFinite(obs.gripperOpeningM)?obs.gripperOpeningM:null,tcpM:tcp,homed:typeof obs.homed==='boolean'?obs.homed:null,gripper:cmd.gripper==='open'||cmd.gripper==='closed'?cmd.gripper:'unknown',
  provenance:sample.origin,providerId:sample.providerId,bootId:sample.bootId,seq:sample.seq,observedAt:sample.observedAt,quality:stale&&sample.quality==='valid'?'stale':sample.quality,ageMs,stale,reasonCodes:[...sample.reasonCodes,...stale&&!sample.reasonCodes.includes('STALE')?['STALE']:[]]};
}
/** What the renderer may draw between two samples: the latest observed joints, frozen while stale; never an interpolation past the last sample. */
export function displayJoints(previous:ArmJointsView|null,latest:ArmJointsView|null):{jointsRad:number[]|null;source:'observed'|'commanded'|'unknown';frozen:boolean} {
 const v=latest??previous;if(!v)return {jointsRad:null,source:'unknown',frozen:false};
 if(v.jointsActualRad)return {jointsRad:v.jointsActualRad,source:'observed',frozen:v.stale};
 if(v.jointsCommandedRad)return {jointsRad:v.jointsCommandedRad,source:'commanded',frozen:v.stale};
 return {jointsRad:null,source:'unknown',frozen:v.stale};
}
/** The model the 3D view draws for an arm sample's provider: the MuJoCo plant runs the xArm 6 fixture; every other provider (Webots, the mock) the reference arm. */
const finite=(v:unknown,n:number):v is number[]=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x));
/** A cup's pose as the MuJoCo plant reports it (map frame, a valid sample), or null: any other sample is not the plant's word on where the cup is. */
export function plantCupPose(h:Held|undefined):{positionM:[number,number,number];quaternionXyzw:[number,number,number,number]}|null{
 const o=h?.observed;if(!h||h.providerId!=='mujoco_arm'||h.frameId!=='map'||h.quality!=='valid'||!o||!finite(o.positionM,3)||!finite(o.quaternionXyzw,4))return null;
 return {positionM:[...o.positionM] as [number,number,number],quaternionXyzw:[...o.quaternionXyzw] as [number,number,number,number]};
}
export const armModelFor=(providerId:string):'xarm6-g2-v1'|'arm-ref-3d-v1'=>providerId==='mujoco_arm'?'xarm6-g2-v1':'arm-ref-3d-v1';
