// Placement of a robot body in the three.js scene (y up; ROS x, y, z-up map to x, z, -y) from the plant's pose. A planar plant reports no z, roll or pitch and keeps
// the flat placement the twin always had; a 3D plant's base height and tilt (zM, rollRad, pitchRad of the AMR sample) lift and tip the body. Nothing is invented: a
// non-finite 3D pose falls back to the flat placement.
export interface BasePose {x:number;y:number;yawRad:number;z?:number;rollRad?:number;pitchRad?:number}
export interface Placement {position:[number,number,number];quaternion:[number,number,number,number]}
type Q=[number,number,number,number];
const mul=(a:Q,b:Q):Q=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const about=(axis:0|1|2,angle:number):Q=>{const q:Q=[0,0,0,Math.cos(angle/2)];q[axis]=Math.sin(angle/2);return q;};
const ROS_TO_THREE:Q=about(0,-Math.PI/2),THREE_TO_ROS:Q=about(0,Math.PI/2);
/**
 * `centerHeightM`: height above the floor of the body's centre when the robot stands level (the twin's mesh height); `baseHeightM`: height of the base origin above the floor
 * then (the wheel radius). The centre sits `centerHeightM - baseHeightM` above the base origin along the body's own up axis.
 */
export function bodyPlacement(p:BasePose,centerHeightM:number,baseHeightM:number):Placement{
 const three=p.z!==undefined&&p.rollRad!==undefined&&p.pitchRad!==undefined&&[p.z,p.rollRad,p.pitchRad,p.yawRad].every(Number.isFinite);
 if(!three)return {position:[p.x,centerHeightM,-p.y],quaternion:[0,0,0,1]};
 return placeBody([p.x,p.y,p.z!],rosQuat(p.yawRad,p.pitchRad!,p.rollRad!),centerHeightM-baseHeightM);
}
/** ROS orientation (x, y, z, w) of yaw about z, then pitch about y, then roll about x. */
export const rosQuat=(yawRad:number,pitchRad:number,rollRad:number):Q=>mul(mul(about(2,yawRad),about(1,pitchRad)),about(0,rollRad));
/** Yaw of a ROS orientation (the inverse of rosQuat's first rotation). */
export const yawOf=([x,y,z,w]:readonly number[]):number=>Math.atan2(2*(w!*z!+x!*y!),1-2*(y!*y!+z!*z!));
/** A body whose centre sits `c` above the ROS base origin `position` along its own up axis, with ROS orientation `ros`, placed in the three.js scene. */
export function placeBody(position:readonly number[],ros:readonly number[],c:number):Placement{
 const [qx,qy,qz,qw]=ros as Q;
 // R * (0, 0, c): the third column of the rotation matrix of `ros`, scaled
 const up=[2*(qx*qz+qy*qw),2*(qy*qz-qx*qw),1-2*(qx*qx+qy*qy)],rosCenter=[position[0]!+c*up[0]!,position[1]!+c*up[1]!,position[2]!+c*up[2]!];
 return {position:[rosCenter[0]!,rosCenter[2]!,-rosCenter[1]!],quaternion:mul(mul(ROS_TO_THREE,ros as Q),THREE_TO_ROS)}; // a mesh's own axes are three's (y up): conjugate the ROS rotation into them
}
/** The optional 3D fields of an AMR sample's `observed` (zM, rollRad, pitchRad), all three or none: a partial or non-numeric set is no 3D pose. */
export function pose3dOf(observed:Record<string,unknown>|null|undefined):{z?:number;rollRad?:number;pitchRad?:number}{
 const z=observed?.zM,r=observed?.rollRad,p=observed?.pitchRad;
 return typeof z==='number'&&typeof r==='number'&&typeof p==='number'&&[z,r,p].every(Number.isFinite)?{z,rollRad:r,pitchRad:p}:{};
}
