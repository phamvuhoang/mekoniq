// Writes the arm-ref-3d-v1 fixture (R1.1 D23): the Lab PUMA560_REFERENCE table as an engineering component, byte-stable.
//   pnpm exec tsx scripts/generate-arm-fixture.mjs [--out <dir>]      (default robotics/simulation-3d/fixtures/arm-ref-3d-v1)
// Geometry is derived from the table; masses, inertia and joint effort are ASSUMED (docs/research/2026-11-webots-arm-spike.md, X00). Not PUMA data, not a product arm.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PUMA560_SI,PUMA560_REFERENCE_REVISION,jointNameForLinuxcnc} from '../packages/lab-runtime/src/v2/models/arm-kinematics';
import {DEFAULT_ARM_GEOMETRY} from '../packages/lab-runtime/src/v2/models/arm-collision';
import {qmul,qrotate} from '../packages/lab-runtime/src/v2/frames';
import {hashJson} from '../packages/lab-runtime/src/v2/hash';

export const MASS_KG=[10,8,6,4,1.5,1,0.5]; // base, link1..link6 (the base is fixed to the world; its mass only completes the record)
export const EFFORT_NM=[200,200,100,30,20,10];
const ASSUMPTIONS='arm-ref-3d-v1 assumptions: link masses 10/8/6/4/1.5/1/0.5 kg (base, link1..6), joint effort 200/200/100/30/20/10 N*m, solid cylinder/sphere inertia at the link centre of mass, link radius = DEFAULT_ARM_GEOMETRY.linkRadiusM. Chosen in spike X00; nothing here is PUMA data or a measured value.';
const ASSUMED={documentId:'arm-ref-3d-assumptions',revision:'1',contentSha256:createHash('sha256').update(ASSUMPTIONS).digest('hex')};
const TABLE={documentId:'lab-puma560-reference',revision:'1',contentSha256:PUMA560_REFERENCE_REVISION};
const src=(base,kind,locator)=>({kind,...base,locator});
const r12=(x)=>{const v=Number(x.toPrecision(12));return Object.is(v,-0)?0:v;};
const round=(v)=>Array.isArray(v)?v.map(round):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,round(x)])):typeof v==='number'?r12(v):v;
const sortKeys=(v)=>Array.isArray(v)?v.map(sortKeys):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map((k)=>[k,sortKeys(v[k])])):v;
const text=(v)=>JSON.stringify(sortKeys(round(v)),null,2)+'\n';
const scalar=(value,unit,source)=>({value,unit,source});
const qx=(a)=>[Math.sin(a/2),0,0,Math.cos(a/2)],qz=(a)=>[0,0,Math.sin(a/2),Math.cos(a/2)];
/** Rotation matrix (row-major 3x3) of a unit quaternion xyzw. */
const matrix=([x,y,z,w])=>[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
/** I = R diag(d) R^T as [ixx,ixy,ixz,iyy,iyz,izz]. */
const rotateInertia=(q,d)=>{const R=matrix(q),at=(i,j)=>R[i][0]*d[0]*R[j][0]+R[i][1]*d[1]*R[j][1]+R[i][2]*d[2]*R[j][2];return [at(0,0),at(0,1),at(0,2),at(1,1),at(1,2),at(2,2)];};
/** Quaternion taking +z to the unit vector u. */
const fromZ=(u)=>{const ax=[-u[1],u[0],0],s=Math.hypot(ax[0],ax[1]);if(s<1e-12)return u[2]>0?[0,0,0,1]:[1,0,0,0];const a=Math.acos(Math.max(-1,Math.min(1,u[2])));return [ax[0]/s*Math.sin(a/2),ax[1]/s*Math.sin(a/2),0,Math.cos(a/2)];};

/** Joint i (0-based) origin in the parent link frame: modified DH (alpha, a, d, thetaOffset) -> xyz=[a,-sin(alpha)d,cos(alpha)d], rotation Rx(alpha)Rz(thetaOffset). */
const jointOrigin=(i)=>{const {alpha,a,d,thetaOffset}=PUMA560_SI.links[i];return {xyzM:[a,-Math.sin(alpha)*d,Math.cos(alpha)*d],quaternionXyzw:qmul(qx(alpha),qz(thetaOffset))};};

function link(i){ // 0 = base, i = link i; its shape joins its own origin to the next joint origin
  const id=i===0?'base':`link${i}`,next=i<6?jointOrigin(i).xyzM:[0,0,0],len=Math.hypot(...next),m=MASS_KG[i],r=DEFAULT_ARM_GEOMETRY.linkRadiusM;
  const loc=`${id} geometry`,shapeSource=src(ASSUMED,'assumed',loc);
  let geometry,pose,inertia,formula;
  if(len>1e-9){
    const u=next.map((n)=>n/len),q=fromZ(u);
    geometry={kind:'cylinder',radiusM:r,lengthM:len};pose={xyzM:next.map((n)=>n/2),quaternionXyzw:q};
    const t=m*(3*r*r+len*len)/12;inertia=rotateInertia(q,[t,t,m*r*r/2]);formula='cylinder: m*(3r^2+L^2)/12, m*r^2/2';
  }else{
    geometry={kind:'sphere',radiusM:r};pose={xyzM:[0,0,0],quaternionXyzw:[0,0,0,1]};
    const s=2*m*r*r/5;inertia=[s,0,0,s,0,s];formula='sphere: 2*m*r^2/5';
  }
  const shape={pose,geometry,source:shapeSource};
  return {id,visual:[shape],collision:[shape],massKg:scalar(m,'kg',src(ASSUMED,'assumed',`${id} mass`)),comM:pose.xyzM,inertiaKgM2:inertia,
    inertialSource:src({documentId:'arm-ref-3d-inertia-formulas',revision:'1',contentSha256:createHash('sha256').update(formula).digest('hex')},'derived',formula)};
}
function joint(i){
  const lim=PUMA560_SI.limits[i],name=jointNameForLinuxcnc(i),tab=(k)=>src(TABLE,'assumed',`${name}/${k}`);
  return {id:name,kind:'revolute',parent:i===0?'base':`link${i}`,child:`link${i+1}`,origin:jointOrigin(i),axis:[0,0,1],
    limits:{lower:scalar(lim.min,'rad',tab('min')),upper:scalar(lim.max,'rad',tab('max')),velocity:scalar(lim.maxVelocity,'rad/s',tab('maxVelocity')),effort:scalar(EFFORT_NM[i],'N*m',src(ASSUMED,'assumed',`${name} effort`))}};
}
export function buildArmComponent(){
  return round({schemaVersion:1,id:'arm-ref-3d-v1',revision:'1',identity:{manufacturer:'fixture',family:'arm',sku:null,status:'candidate'},
    links:[0,1,2,3,4,5,6].map(link),joints:[0,1,2,3,4,5].map(joint),ports:[],models:[],documents:[]});
}
/** Pure forward kinematics of the fixture: T = prod(Trans(origin.xyz) Rot(origin.q) Rz(q_i)) over the joints in order; returns the last link origin (the flange). */
export function chainFk(component,q){
  let p=[0,0,0],rot=[0,0,0,1];
  component.joints.forEach((j,i)=>{const o=qrotate(rot,j.origin.xyzM);p=[p[0]+o[0],p[1]+o[1],p[2]+o[2]];rot=qmul(qmul(rot,j.origin.quaternionXyzw),qz(q[i]*j.axis[2]));});
  return {flange:p,quaternionXyzw:rot};
}
export async function generateArmFixture(dir){
  const component=buildArmComponent(),body=text(component),componentDigest=hashJson(component);
  const manifest={schemaVersion:1,documentType:'sim3d-fixture-manifest',id:'arm-ref-3d-v1',generator:'scripts/generate-arm-fixture.mjs',componentDigest,modelRevision:PUMA560_SI.revision,
    note:'The Lab PUMA560_REFERENCE table as one 6-revolute engineering component for the Webots arm plant. Geometry derives from the table; masses, inertia and joint effort are assumed inputs (spike X00). Not PUMA data and not a product arm.',
    files:[{path:'component.json',sha256:createHash('sha256').update(body).digest('hex'),bytes:Buffer.byteLength(body)}]};
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'component.json'),body);await writeFile(join(dir,'manifest.json'),text(manifest));
  return {component,componentDigest,manifest};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const i=process.argv.indexOf('--out'),dir=i>0?process.argv[i+1]:'robotics/simulation-3d/fixtures/arm-ref-3d-v1';
  const out=await generateArmFixture(dir);console.log(`wrote ${dir}/component.json (digest ${out.componentDigest}) and manifest.json`);
}
