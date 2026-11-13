import Ajv from 'ajv';
import schema from '../../../../contracts/schemas/load-profile-v1.schema.json';
import component from '../../../../contracts/schemas/engineering-component.schema.json';
import type {LoadProfileV1} from '../../../../contracts/generated/navigation2d';
import {inertiaProblems} from '../../engineering/inertia';
import {qrotate} from '../frames';
import {documentDigest,polygonIssues} from '../navigation2d/contracts';
export type {LoadProfileV1} from '../../../../contracts/generated/navigation2d';
const ajv=new Ajv({allErrors:true,strict:true});ajv.addSchema(component,'engineering-component.schema.json');
const shape=ajv.compile<LoadProfileV1>(schema);
/** Admission only: does not read files or resolve a parent-body ID. Bundle admission/compiler must verify byte refs and model links. */
export function validateLoadProfile(value:unknown):{ok:boolean;reasonCodes:string[]}{
 const reasons=new Set<string>();
 // Preserve a useful mass reason even when AJV rejects a zero or non-finite SI number.
 if(value&&typeof value==='object'&&Array.isArray((value as {props?:unknown}).props))for(const p of (value as {props:unknown[]}).props){
  if(p&&typeof p==='object'&&'massKg' in p&&!(typeof p.massKg==='number'&&Number.isFinite(p.massKg)&&p.massKg>0))reasons.add('LOAD_MASS_INVALID');
 }
 if(!shape(value)){
  const other=(shape.errors??[]).some(e=>!e.instancePath.match(/^\/props\/\d+\/massKg$/));
  if(other||!reasons.size)reasons.add('LOAD_SCHEMA_INVALID');
  return {ok:false,reasonCodes:[...reasons]};
 }
 const p=value as LoadProfileV1,ids=new Set<string>(),supportIds=new Set<string>();
 const quaternion=(q:number[])=>{if(Math.abs(Math.hypot(...q)-1)>1e-6)reasons.add('QUATERNION_NOT_NORMALIZED');};
 for(const s of p.supports){
  if(supportIds.has(s.supportId))reasons.add('LOAD_DUPLICATE_SUPPORT');supportIds.add(s.supportId);
  quaternion(s.poseInBody.quaternionXyzw);
  if(polygonIssues(s.polygonM as [number,number][],'').length)reasons.add('LOAD_SUPPORT_INVALID');
  // A convex CCW support makes exact half-plane containment of a cylinder possible.
  const poly=s.polygonM;
  if(poly.some((a,i)=>{const b=poly[(i+1)%poly.length]!,c=poly[(i+2)%poly.length]!;return (b[0]!-a[0]!)*(c[1]!-b[1]!)-(b[1]!-a[1]!)*(c[0]!-b[0]!) < -1e-12;}))reasons.add('LOAD_SUPPORT_INVALID');
 }
 for(const prop of p.props){
  if(ids.has(prop.propId))reasons.add('LOAD_DUPLICATE_PROP');ids.add(prop.propId);
  if(inertiaProblems(prop.inertiaKgM2 as [number,number,number,number,number,number]).length)reasons.add('LOAD_INERTIA_INVALID');
  const a=prop.attachment,pose=a.kind==='free'?a.initialPoseInSupport:a.poseInLink;quaternion(pose.quaternionXyzw);
  if(a.kind!=='free')continue;
  const support=p.supports.find(s=>s.supportId===a.supportId);
  if(!support){reasons.add('LOAD_SUPPORT_UNKNOWN');continue;}
  const axis=qrotate(pose.quaternionXyzw,[0,0,1]),radius=prop.geometry.radiusM,half=prop.geometry.heightM/2;
  const com=qrotate(pose.quaternionXyzw,prop.comM).map((v,i)=>v+pose.positionM[i]!);
  // Exact projected support extent of a rotated cylinder along each polygon edge normal.
  for(let i=0;i<support.polygonM.length;i++){
   const v=support.polygonM[i]!,w=support.polygonM[(i+1)%support.polygonM.length]!,dx=w[0]!-v[0]!,dy=w[1]!-v[1]!,len=Math.hypot(dx,dy);
   if(!len)continue;
   const nx=-dy/len,ny=dx/len,dot=nx*axis[0]!+ny*axis[1]!,extent=radius*Math.sqrt(Math.max(0,1-dot*dot))+half*Math.abs(dot);
   const distance=nx*(pose.positionM[0]!-v[0]!)+ny*(pose.positionM[1]!-v[1]!);
   if(distance<extent-1e-9||nx*(com[0]!-v[0]!)+ny*(com[1]!-v[1]!)<0.005-1e-9)reasons.add('LOAD_OUTSIDE_SUPPORT');
  }
  const verticalExtent=radius*Math.sqrt(Math.max(0,1-axis[2]!**2))+half*Math.abs(axis[2]!);
  if(Math.abs(pose.positionM[2]!-verticalExtent)>1e-6)reasons.add('LOAD_SUPPORT_HEIGHT_INVALID');
 }
 // Invalid numeric input has already returned; hash only finite JSON.
 if(documentDigest(p,'digest')!==p.digest)reasons.add('DIGEST_MISMATCH');
 return {ok:reasons.size===0,reasonCodes:[...reasons]};
}
