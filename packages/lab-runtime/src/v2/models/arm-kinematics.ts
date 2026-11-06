// Reference mock arm: modified-DH (Craig) forward kinematics and seeded damped-least-squares IK for a pinned PUMA 560-style table.
// This is a kinematic mock. It is not LinuxCNC, a controller or a MEKONIQ robot; every result is tagged mock_kinematic.
import {ModelError,angleToRad,lengthToM,composePose,qconj,qmul,qrotate,type Pose,type Quat,type Vec3} from '../frames';
import {hashJson} from '../hash';
export const MOCK_KINEMATIC='mock_kinematic' as const;
type LengthUnit='m'|'mm'|'inch';
type AngleUnit='rad'|'deg';
export interface ArmSourceJoint {name:string;alpha:number;a:number;d:number;thetaOffset:number;min:number;max:number;maxVelocity:number;}
export interface ArmSourceModel {
 id:string;convention:'modified_dh';provenance:'illustrative_reference';mekoniqRobotCode:null;
 /** alpha is the DH twist, joint is every theta/limit/velocity; LinuxCNC samples mix inch, rad (ALPHA) and deg (joints). */
 units:{length:LengthUnit;alpha:AngleUnit;joint:AngleUnit};
 joints:ArmSourceJoint[];toolTranslation:[number,number,number];
 tolerances:{fkPositionM:number;fkAngleRad:number;ikPositionM:number;ikAngleRad:number};
}
export interface ArmModelSI {
 units:'SI';id:string;revision:string;convention:'modified_dh';jointNames:string[];
 links:{alpha:number;a:number;d:number;thetaOffset:number}[];limits:{min:number;max:number;maxVelocity:number}[];
 toolM:Vec3;tolerances:ArmSourceModel['tolerances'];
}
const H=-Math.PI/2;
const j=(name:string,alpha:number,a:number,d:number,min:number,max:number):ArmSourceJoint=>({name,alpha,a,d,thetaOffset:0,min,max,maxVelocity:120});
/** Illustrative PUMA 560-style table (Craig modified DH; inch, deg; ALPHA in rad). Limits and velocity are illustrative, not vendor data. */
export const PUMA560_REFERENCE:ArmSourceModel={
 id:'puma560-reference',convention:'modified_dh',provenance:'illustrative_reference',mekoniqRobotCode:null,
 units:{length:'inch',alpha:'rad',joint:'deg'},
 joints:[j('J1',0,0,0,-160,160),j('J2',H,0,0,-225,45),j('J3',0,17,5.9,-45,225),j('J4',H,-0.8,17,-110,170),j('J5',-H,0,0,-100,100),j('J6',H,0,0,-266,266)],
 toolTranslation:[0,0,0],tolerances:{fkPositionM:1e-6,fkAngleRad:1e-6,ikPositionM:0.001,ikAngleRad:0.0087266463},
};
export const armModelRevision=(m:ArmSourceModel):string=>hashJson(m);
/** Pinned: changing any number of the table changes this hash and fails the pin test. */
export const PUMA560_REFERENCE_REVISION='bd57344faecee29df2d50b8e8535de6936b05da3778eadbf46ad0e5d626650f3';
export function toSI(m:ArmSourceModel):ArmModelSI {
 const u=m?.units as ArmSourceModel['units']|undefined;
 if(!u||!u.length||!u.alpha||!u.joint)throw new ModelError('UNITS_MISSING','length/alpha/joint');
 if(m.convention!=='modified_dh')throw new ModelError('CONVENTION_UNSUPPORTED',String(m.convention));
 if(!Array.isArray(m.joints)||m.joints.length!==6)throw new ModelError('MODEL_JOINT_COUNT',String(m.joints?.length));
 const len=(v:number)=>lengthToM(v,u.length),ang=(v:number)=>angleToRad(v,u.joint);
 for(const x of m.joints)if(!(x.min<x.max)||!(x.maxVelocity>0)||![x.min,x.max,x.maxVelocity].every(Number.isFinite))throw new ModelError('MODEL_LIMITS_INVALID',x.name);
 return {units:'SI',id:m.id,revision:armModelRevision(m),convention:m.convention,jointNames:m.joints.map(x=>x.name),
  links:m.joints.map(x=>({alpha:angleToRad(x.alpha,u.alpha),a:len(x.a),d:len(x.d),thetaOffset:ang(x.thetaOffset)})),
  limits:m.joints.map(x=>({min:ang(x.min),max:ang(x.max),maxVelocity:ang(x.maxVelocity)})),
  toolM:m.toolTranslation.map(len) as unknown as Vec3,tolerances:m.tolerances};
}
export const PUMA560_SI:ArmModelSI=toSI(PUMA560_REFERENCE);
/** LinuxCNC counts joints from 0 (JOINT_0 is J1). JOINT_4 is the wrist pitch J5, which the sample homes at 0.1 deg to dodge the inverse failure. */
export function jointNameForLinuxcnc(index:number):string {
 if(!Number.isInteger(index)||index<0||index>5)throw new ModelError('JOINT_INDEX_INVALID',String(index));
 return `J${index+1}`;
}
const need=(m:ArmModelSI)=>{if(!m||m.units!=='SI')throw new ModelError('MODEL_NOT_SI','convert with toSI() before use');};
const checkQ=(m:ArmModelSI,q:readonly number[])=>{
 if(!Array.isArray(q)||q.length!==m.links.length)throw new ModelError('JOINT_COUNT',`expected ${m.links.length}`);
 if(!q.every(Number.isFinite))throw new ModelError('JOINT_NOT_FINITE');
};
const ID:Quat=[0,0,0,1],P0:Vec3=[0,0,0];
const qx=(a:number):Quat=>[Math.sin(a/2),0,0,Math.cos(a/2)],qz=(a:number):Quat=>[0,0,Math.sin(a/2),Math.cos(a/2)];
export interface FkResult {frames:Pose[];flange:Pose;tcp:Pose;tag:typeof MOCK_KINEMATIC;modelRevision:string;}
/** T_i = Rx(alpha_{i-1}) Tx(a_{i-1}) Rz(theta_i) Tz(d_i), accumulated from the base. frames[i] is link_{i+1}; the last one is the flange. */
export function forwardKinematics(m:ArmModelSI,q:readonly number[]):FkResult {
 need(m);checkQ(m,q);
 let T:Pose={position:P0,quaternionXyzw:ID};const frames:Pose[]=[];
 m.links.forEach((l,i)=>{
  for(const step of [{position:P0,quaternionXyzw:qx(l.alpha)},{position:[l.a,0,0] as Vec3,quaternionXyzw:ID},{position:P0,quaternionXyzw:qz(q[i]!+l.thetaOffset)},{position:[0,0,l.d] as Vec3,quaternionXyzw:ID}])T=composePose(T,step);
  frames.push(T);
 });
 const flange=frames[frames.length-1]!;
 return {frames,flange,tcp:composePose(flange,{position:m.toolM,quaternionXyzw:ID}),tag:MOCK_KINEMATIC,modelRevision:m.revision};
}
// ---- small dense linear algebra (6x6) ----
type Mat=number[][];
const jac=(m:ArmModelSI,q:readonly number[]):{J:Mat;tcp:Pose;frames:Pose[]}=>{
 const f=forwardKinematics(m,q),pe=f.tcp.position,J:Mat=[[],[],[],[],[],[]];
 f.frames.forEach((fr,i)=>{
  const z=qrotate(fr.quaternionXyzw,[0,0,1]),r=[pe[0]-fr.position[0],pe[1]-fr.position[1],pe[2]-fr.position[2]];
  const lin=[z[1]*r[2]!-z[2]*r[1]!,z[2]*r[0]!-z[0]*r[2]!,z[0]*r[1]!-z[1]*r[0]!];
  for(let k=0;k<3;k++){J[k]![i]=lin[k]!;J[k+3]![i]=z[k]!;}
 });
 return {J,tcp:f.tcp,frames:f.frames};
};
/** Eigenvalues of a symmetric matrix by cyclic Jacobi rotations. */
function eigenSym(A:Mat):number[] {
 const n=A.length,a=A.map(r=>[...r]);
 for(let sweep=0;sweep<60;sweep++){
  let off=0;for(let p=0;p<n;p++)for(let r=p+1;r<n;r++)off+=a[p]![r]!**2;
  if(off<1e-30)break;
  for(let p=0;p<n;p++)for(let r=p+1;r<n;r++){
   if(Math.abs(a[p]![r]!)<1e-300)continue;
   const th=(a[r]![r]!-a[p]![p]!)/(2*a[p]![r]!),t=Math.sign(th||1)/(Math.abs(th)+Math.sqrt(th*th+1)),c=1/Math.sqrt(t*t+1),s=t*c;
   for(let k=0;k<n;k++){const x=a[k]![p]!,y=a[k]![r]!;a[k]![p]=c*x-s*y;a[k]![r]=s*x+c*y;}
   for(let k=0;k<n;k++){const x=a[p]![k]!,y=a[r]![k]!;a[p]![k]=c*x-s*y;a[r]![k]=s*x+c*y;}
  }
 }
 return a.map((r,i)=>r[i]!);
}
const JtJ=(J:Mat)=>J[0]!.map((_,i)=>J[0]!.map((__,k)=>J.reduce((s,row)=>s+row[i]!*row[k]!,0)));
/** Singular values of the 6x6 geometric Jacobian (mixed m and rad columns; a fixture-level indicator, not a calibrated metric). */
export function jacobianCondition(m:ArmModelSI,q:readonly number[]):{sigmaMin:number;sigmaMax:number;condition:number} {
 need(m);checkQ(m,q);
 const ev=eigenSym(JtJ(jac(m,q).J)).map(v=>Math.sqrt(Math.max(0,v))),sigmaMin=Math.min(...ev),sigmaMax=Math.max(...ev);
 return {sigmaMin,sigmaMax,condition:sigmaMin>0?sigmaMax/sigmaMin:Infinity};
}
function solveLinear(A:Mat,b:number[]):number[] {
 const n=b.length,M=A.map((r,i)=>[...r,b[i]!]);
 for(let c=0;c<n;c++){
  let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r]![c]!)>Math.abs(M[p]![c]!))p=r;
  [M[c],M[p]]=[M[p]!,M[c]!];
  for(let r=c+1;r<n;r++){const f=M[r]![c]!/M[c]![c]!;for(let k=c;k<=n;k++)M[r]![k]!-=f*M[c]![k]!;}
 }
 const x=Array<number>(n).fill(0);
 for(let r=n-1;r>=0;r--){let s=M[r]![n]!;for(let k=r+1;k<n;k++)s-=M[r]![k]!*x[k]!;x[r]=s/M[r]![r]!;}
 return x;
}
const mulberry32=(seed:number)=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
export interface IkTarget {position:Vec3;quaternionXyzw:Quat;}
export interface IkSeed {q:readonly number[];rngSeed?:number;dtS?:number;}
export interface IkOk {ok:true;tag:typeof MOCK_KINEMATIC;q:number[];residual:{positionM:number;orientationRad:number};condition:number;iterations:number;maxJointDeltaRad:number;modelRevision:string;solver:{name:'dls';version:1;rngSeed:number};}
export interface IkRejected {ok:false;tag:typeof MOCK_KINEMATIC;reason:string;residual?:{positionM:number;orientationRad:number};condition?:number;joint?:string;modelRevision?:string;solver:{name:'dls';version:1;rngSeed:number};}
export const MAX_CONDITION=1000,MAX_ITERATIONS=200,RESTARTS=8;
const err=(t:IkTarget,cur:Pose)=>{
 const pe=[t.position[0]-cur.position[0],t.position[1]-cur.position[1],t.position[2]-cur.position[2]];
 let dq=qmul(t.quaternionXyzw,qconj(cur.quaternionXyzw));if(dq[3]<0)dq=[-dq[0],-dq[1],-dq[2],-dq[3]];
 const s=Math.hypot(dq[0],dq[1],dq[2]),ang=2*Math.atan2(s,dq[3]),k=s>1e-12?ang/s:2;
 return {e:[...pe,dq[0]*k,dq[1]*k,dq[2]*k],pos:Math.hypot(...pe),ori:ang};
};
function dls(m:ArmModelSI,t:IkTarget,q0:readonly number[],clamp:boolean){
 let q=[...q0],it=0,r=err(t,forwardKinematics(m,q).tcp);
 for(;it<MAX_ITERATIONS&&(r.pos>1e-8||r.ori>1e-8);it++){
  const {J}=jac(m,q),lam2=1e-4,A=J.map((row,i)=>J.map((row2,k)=>row.reduce((s,v,c)=>s+v*row2[c]!,0)+(i===k?lam2:0)));
  const y=solveLinear(A,r.e),dq=J[0]!.map((_,c)=>J.reduce((s,row,i)=>s+row[c]!*y[i]!,0));
  const step=Math.max(1,Math.max(...dq.map(Math.abs))/0.3);
  q=q.map((v,i)=>{const n=v+dq[i]!/step;return clamp?Math.min(m.limits[i]!.max,Math.max(m.limits[i]!.min,n)):n;});
  r=err(t,forwardKinematics(m,q).tcp);
 }
 return {q,it,pos:r.pos,ori:r.ori};
}
const singularJoint=(m:ArmModelSI,q:readonly number[]):string|undefined=>{
 const f=forwardKinematics(m,q).frames;
 if(Math.abs(Math.sin(q[4]!+m.links[4]!.thetaOffset))<0.05)return m.jointNames[4];
 const u=f[2]!.position.map((v,i)=>v-f[1]!.position[i]!),w=f[3]!.position.map((v,i)=>v-f[2]!.position[i]!);
 const cr=[u[1]!*w[2]!-u[2]!*w[1]!,u[2]!*w[0]!-u[0]!*w[2]!,u[0]!*w[1]!-u[1]!*w[0]!];
 return Math.hypot(...cr)/(Math.hypot(...u)*Math.hypot(...w)||1)<0.05?m.jointNames[2]:undefined;
};
/** Seeded DLS inverse kinematics. Starts at seed.q (branch continuity), then bounded seeded restarts; never clips or invents a success. */
export function solvePose(m:ArmModelSI,target:IkTarget,seed:IkSeed):IkOk|IkRejected {
 const rngSeed=seed?.rngSeed??0,solver={name:'dls' as const,version:1 as const,rngSeed};
 const no=(reason:string,extra:Partial<IkRejected>={}):IkRejected=>({ok:false,tag:MOCK_KINEMATIC,reason,...extra,solver});
 try{need(m);}catch{return no('MODEL_NOT_SI');}
 const n=m.links.length,q0=seed?.q;
 if(!Array.isArray(q0)||q0.length!==n)return no('JOINT_COUNT',{modelRevision:m.revision});
 if(!q0.every(Number.isFinite))return no('JOINT_NOT_FINITE',{modelRevision:m.revision});
 if(q0.some(v=>Math.abs(v)>2*Math.PI+1e-9))return no('WRONG_UNITS_SUSPECTED',{modelRevision:m.revision});
 if(q0.some((v,i)=>v<m.limits[i]!.min||v>m.limits[i]!.max))return no('SEED_OUT_OF_LIMITS',{modelRevision:m.revision});
 if(!target||target.position?.length!==3||!target.position.every(Number.isFinite))return no('TARGET_NOT_FINITE',{modelRevision:m.revision});
 try{if(Math.abs(Math.hypot(...target.quaternionXyzw)-1)>1e-6||!target.quaternionXyzw.every(Number.isFinite))throw 0;}catch{return no('TARGET_QUATERNION_INVALID',{modelRevision:m.revision});}
 const rnd=mulberry32(rngSeed),tolP=m.tolerances.ikPositionM,tolO=m.tolerances.ikAngleRad;
 const starts=[[...q0],...Array.from({length:RESTARTS},()=>m.limits.map(l=>l.min+(l.max-l.min)*rnd()))];
 const run=(clamp:boolean)=>{let best:{pos:number;ori:number}|null=null;
  for(const s of starts){
   const r=dls(m,target,s,clamp);
   if(r.pos<=tolP&&r.ori<=tolO)return {hit:r,best:r};
   if(!best||r.pos+r.ori<best.pos+best.ori)best=r;
  }
  return {hit:null,best};};
 const c=run(true);
 if(!c.hit){
  const free=run(false);
  return no(free.hit?'JOINT_LIMIT':'UNREACHABLE',{residual:{positionM:c.best!.pos,orientationRad:c.best!.ori},modelRevision:m.revision});
 }
 const {q,it,pos,ori}=c.hit,{condition}=jacobianCondition(m,q),residual={positionM:pos,orientationRad:ori};
 if(condition>MAX_CONDITION)return no('NEAR_SINGULARITY',{residual,condition,joint:singularJoint(m,q),modelRevision:m.revision});
 if(seed.dtS!==undefined){
  if(!(seed.dtS>0))return no('DT_INVALID',{modelRevision:m.revision});
  const bad=q.findIndex((v,i)=>Math.abs(v-q0[i]!)/seed.dtS!>m.limits[i]!.maxVelocity);
  if(bad>=0)return no('VELOCITY_LIMIT',{residual,condition,joint:m.jointNames[bad],modelRevision:m.revision});
 }
 return {ok:true,tag:MOCK_KINEMATIC,q,residual,condition,iterations:it,maxJointDeltaRad:Math.max(...q.map((v,i)=>Math.abs(v-q0[i]!))),modelRevision:m.revision,solver};
}
