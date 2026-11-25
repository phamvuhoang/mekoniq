// Joint frames of the Webots arm fixture (arm-ref-3d-v1) in the arm base frame, from its joint origins and axes: T_i = T_{i-1} · Trans(origin.xyz) · Rot(origin.q) · Rot(axis, q_i).
// Pure geometry for drawing; the runtime's own FK (and the golden flange it is checked against) is the reference. Matrices are row-major 4x4.
export type Mat4=readonly number[];
export interface ArmJointDef {origin:{xyzM:readonly number[];quaternionXyzw:readonly number[]};axis:readonly number[]}
const mul=(a:Mat4,b:Mat4):Mat4=>Array.from({length:16},(_,k)=>{const r=k>>2,c=k&3;return a[r*4]!*b[c]!+a[r*4+1]!*b[4+c]!+a[r*4+2]!*b[8+c]!+a[r*4+3]!*b[12+c]!;});
/** Rotation by the unit quaternion (x, y, z, w) with translation t. */
const pose=(q:readonly number[],t:readonly number[]):Mat4=>{const [x,y,z,w]=q as [number,number,number,number];
 return [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),t[0]!, 2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),t[1]!, 2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),t[2]!, 0,0,0,1];};
/** Base frame followed by the frame after each joint (so `joints.length + 1` frames); the last one is the flange. */
export function armFrames(joints:readonly ArmJointDef[],q:readonly number[]):Mat4[]{
 const out:Mat4[]=[[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]];
 joints.forEach((j,i)=>{const n=Math.hypot(...j.axis),h=Math.sin(q[i]!/2)/n; // rotation about the (normalised) joint axis by q_i
  out.push(mul(mul(out[i]!,pose(j.origin.quaternionXyzw,j.origin.xyzM)),pose([j.axis[0]!*h,j.axis[1]!*h,j.axis[2]!*h,Math.cos(q[i]!/2)],[0,0,0])));});
 return out;
}
export const framePosition=(m:Mat4):[number,number,number]=>[m[3]!,m[7]!,m[11]!];
