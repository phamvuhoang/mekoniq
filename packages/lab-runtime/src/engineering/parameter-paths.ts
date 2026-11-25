// R4-C §4 (D44): the parameters an offline tool may change in the plant or the drive model, as a closed registry of paths, and the pure functions that apply them. Anything else is refused by name:
// a calibration that could reach any field would be a way to edit the model by hand.
import type {DriveModelV1} from '../v2/control/drive-io';
import {sealDriveDocument} from '../v2/control/drive-io';
import type {XArmPhysics} from '../v2/simulation3d/arm-cell-scene';

/** The arm's rotor inertia (per joint) and the joint damping and friction loss (ONE value shared by the six joints: physics.json carries one, so a fit is a fit of that value). */
export const PHYSICS_PATHS:readonly RegExp[]=[/^armatureKgM2\[[0-5]\]$/,/^jointDynamics\.damping$/,/^jointDynamics\.frictionloss$/];
/** The torque scale of an axis whose drive model gives it as a fraction of the envelope (`envelope_ref`: the wheels). An `effort` axis has no scale to fit. Registered by the spec but NOT proven by the self-test (G-CAL1 covers the armature and the joint damping only: identification-selftest.test.ts says why). */
export const DRIVE_PATHS:readonly RegExp[]=[/^driveModel\.axes\[\d+\]\.torque\.scale$/];
export const IDENTIFIABLE_PATHS:readonly RegExp[]=[...PHYSICS_PATHS,...DRIVE_PATHS];
export const isIdentifiablePath=(path:string)=>IDENTIFIABLE_PATHS.some(r=>r.test(path));
export const isPhysicsPath=(path:string)=>PHYSICS_PATHS.some(r=>r.test(path));

const finitePositive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
/** A copy of the physics profile with the registered values set; any other path, or a value that is not finite and positive, throws a named error (nothing is half applied). */
export function applyPhysicsOverride(physics:XArmPhysics,override:Readonly<Record<string,number>>):XArmPhysics{
 const out=structuredClone(physics);
 for(const [path,value] of Object.entries(override)){
  if(!isPhysicsPath(path))throw Error(`PHYSICS_PATH_UNREGISTERED:${path}`);
  if(!finitePositive(value))throw Error(`PHYSICS_VALUE_INVALID:${path}`);
  if(path==='jointDynamics.damping')out.jointDynamics.damping=value;
  else if(path==='jointDynamics.frictionloss')out.jointDynamics.frictionloss=value;
  else out.armatureKgM2[Number(/\[(\d)\]/.exec(path)![1])]=value;
 }
 return out;
}
/** A copy of the drive model with `driveModel.axes[k].torque.scale` set and the document sealed again (a new digest: it is a different model). */
export function applyDriveOverride(model:DriveModelV1,override:Readonly<Record<string,number>>):DriveModelV1{
 const out=structuredClone(model) as DriveModelV1;
 for(const [path,value] of Object.entries(override)){
  const k=/^driveModel\.axes\[(\d+)\]\.torque\.scale$/.exec(path)?.[1];
  if(k===undefined)throw Error(`DRIVE_PATH_UNREGISTERED:${path}`);
  const axis=out.axes[Number(k)];
  if(!axis)throw Error(`DRIVE_AXIS_UNKNOWN:${path}`);
  if(axis.torque.kind!=='envelope_ref')throw Error(`DRIVE_PATH_NOT_APPLICABLE:${path}`);
  if(!(typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1))throw Error(`DRIVE_VALUE_INVALID:${path}`);
  axis.torque.scale=value;
 }
 return sealDriveDocument(out);
}
