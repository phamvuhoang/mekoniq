import {qrotate,type Pose as FramePose} from '../v2/frames';
import type {Link,Pose,Vec3} from './contracts';

type Tensor=NonNullable<Link['inertiaKgM2']>;
type M3=number[][];
/** Engineering poses ({xyzM, quaternionXyzw}) to the frames.ts shape the rest of the runtime uses. */
export const framePose=(p:Pose):FramePose=>({position:p.xyzM,quaternionXyzw:p.quaternionXyzw});
export const engineeringPose=(p:FramePose):Pose=>({xyzM:[p.position[0]!,p.position[1]!,p.position[2]!],quaternionXyzw:[p.quaternionXyzw[0]!,p.quaternionXyzw[1]!,p.quaternionXyzw[2]!,p.quaternionXyzw[3]!]});

const toMatrix=([xx,xy,xz,yy,yz,zz]:Tensor):M3=>[[xx,xy,xz],[xy,yy,yz],[xz,yz,zz]];
const fromMatrix=(m:M3):Tensor=>[m[0]![0]!,m[0]![1]!,m[0]![2]!,m[1]![1]!,m[1]![2]!,m[2]![2]!];
/** Columns are the rotated basis vectors, so R maps link axes to the common frame. */
const rotation=(q:readonly number[]):M3=>{const c=[[1,0,0],[0,1,0],[0,0,1]].map(e=>qrotate(q,e));return [0,1,2].map(i=>[0,1,2].map(j=>c[j]![i]!));};
const mul=(a:M3,b:M3):M3=>a.map((_,i)=>[0,1,2].map(j=>a[i]![0]!*b[0]![j]!+a[i]![1]!*b[1]![j]!+a[i]![2]!*b[2]![j]!));
const transpose=(a:M3):M3=>[0,1,2].map(i=>[0,1,2].map(j=>a[j]![i]!));

/**
 * Mass, centre of mass and inertia tensor (about that COM, in the axes of the common frame) of rigid links whose frames sit at `poses`.
 *   M = Σ m_i;  C = Σ m_i c_i / M;  I = Σ R_i I_i R_iᵀ + m_i (d·d·E − d dᵀ),  d_i = c_i − C
 * A link without a tensor throws: unknown inertia is never replaced by zero.
 */
export function combineInertia(links:Link[],poses:Pose[]):{massKg:number;comM:Vec3;inertiaKgM2:Tensor}{
 if(links.length!==poses.length)throw new Error('INERTIA_POSE_COUNT');
 const parts=links.map((l,i)=>{
  if(l.inertiaKgM2===null)throw new Error(`INERTIA_UNKNOWN ${l.id}`);
  const R=rotation(poses[i]!.quaternionXyzw),r=qrotate(poses[i]!.quaternionXyzw,l.comM),p=poses[i]!.xyzM;
  return {m:l.massKg.value,c:[p[0]+r[0]!,p[1]+r[1]!,p[2]+r[2]!],I:mul(mul(R,toMatrix(l.inertiaKgM2)),transpose(R))};
 });
 const M=parts.reduce((s,x)=>s+x.m,0),C=[0,1,2].map(k=>parts.reduce((s,x)=>s+x.m*x.c[k]!,0)/M);
 const I:M3=[[0,0,0],[0,0,0],[0,0,0]];
 for(const x of parts){const d=[0,1,2].map(k=>x.c[k]!-C[k]!),dd=d[0]!**2+d[1]!**2+d[2]!**2;for(let i=0;i<3;i++)for(let j=0;j<3;j++)I[i]![j]!+=x.I[i]![j]!+x.m*((i===j?dd:0)-d[i]!*d[j]!);}
 return {massKg:M,comM:[C[0]!,C[1]!,C[2]!],inertiaKgM2:fromMatrix(I)};
}

/** Principal moments (ascending) of a symmetric 3x3 tensor, closed form. */
function principal([xx,xy,xz,yy,yz,zz]:Tensor):number[]{
 const off=xy*xy+xz*xz+yz*yz,q=(xx+yy+zz)/3;
 if(off===0)return [xx,yy,zz].sort((a,b)=>a-b);
 const p2=(xx-q)**2+(yy-q)**2+(zz-q)**2+2*off,p=Math.sqrt(p2/6);
 const b=[[xx-q,xy,xz],[xy,yy-q,yz],[xz,yz,zz-q]].map(r=>r.map(v=>v/p));
 const det=b[0]![0]!*(b[1]![1]!*b[2]![2]!-b[1]![2]!*b[2]![1]!)-b[0]![1]!*(b[1]![0]!*b[2]![2]!-b[1]![2]!*b[2]![0]!)+b[0]![2]!*(b[1]![0]!*b[2]![1]!-b[1]![1]!*b[2]![0]!);
 const phi=Math.acos(Math.max(-1,Math.min(1,det/2)))/3,e3=q+2*p*Math.cos(phi),e1=q+2*p*Math.cos(phi+2*Math.PI/3);
 return [e1,3*q-e1-e3,e3];
}
/** Roundoff allowance only (1e-12 relative); a tensor that violates physics by more than float noise is reported. */
const ROUNDOFF=1e-12;
/** Empty array means physically valid. Codes: NOT_FINITE, NOT_POSITIVE_DEFINITE, TRIANGLE_INEQUALITY. */
export function inertiaProblems(t:Tensor):string[]{
 if(t.length!==6||t.some(v=>!Number.isFinite(v)))return ['NOT_FINITE'];
 const [xx,xy,xz,yy,yz,zz]=t;
 const minor2=xx*yy-xy*xy,det=xx*(yy*zz-yz*yz)-xy*(xy*zz-yz*xz)+xz*(xy*yz-yy*xz);
 if(!(xx>0&&minor2>0&&det>0))return ['NOT_POSITIVE_DEFINITE'];
 const [a,b,c]=principal(t),scale=Math.max(a!,b!,c!);
 return a!+b!<c!-ROUNDOFF*scale?['TRIANGLE_INEQUALITY']:[];
}
