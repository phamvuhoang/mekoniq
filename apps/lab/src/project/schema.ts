import {validateSchedule} from '../scenarios/fault-schedule';
import type {LabProject,LabProjectV2} from '../shared/types';
export const MAX_PROJECT_BYTES=5*1024*1024;
export const MAX_TRAYS=10;
export const MAX_WORLD_SIZE=1000;
function invalid(field:string):never {throw new Error(`INVALID_PROJECT:${field}`);}
function object(value:unknown,keys:readonly string[],field:string):Record<string,unknown> {
  if (!value||typeof value!=='object'||Array.isArray(value)) invalid(field);
  const record=value as Record<string,unknown>;
  if (Object.keys(record).some(key=>!keys.includes(key))||keys.some(key=>!(key in record))) invalid(field);
  return record;
}
function text(value:unknown,field:string):void {if (typeof value!=='string'||!value.trim()||value.length>200) invalid(field);}
function number(value:unknown,field:string,positive=false):void {if (typeof value!=='number'||!Number.isFinite(value)||(positive&&value<=0)) invalid(field);}
function revision(value:unknown,field:string):void {number(value,field,true);if (!Number.isSafeInteger(value)) invalid(field);}
/** Structural validation permits incomplete designs, while rejecting unsupported or executable fields. */
export function validateProject(value:unknown):LabProject {
  const project=object(value,['schemaVersion','id','name','revision','updatedAt','design','world'],'root');
  if (project.schemaVersion!==1) invalid('schemaVersion');
  text(project.id,'id');text(project.name,'name');revision(project.revision,'revision');
  if (typeof project.updatedAt!=='string'||!Number.isFinite(Date.parse(project.updatedAt))) invalid('updatedAt');
  const design=object(project.design,['id','revision','chassis','trays','batteryAh','sensor','payloadKg'],'design');
  text(design.id,'design.id');revision(design.revision,'design.revision');
  if (!['service','valetudo'].includes(String(design.chassis))) invalid('design.chassis');
  if (!['lidar','depth'].includes(String(design.sensor))) invalid('design.sensor');
  for (const field of ['trays','batteryAh','payloadKg']) number(design[field],`design.${field}`);
  if (!Number.isSafeInteger(design.trays)||Number(design.trays)<1||Number(design.trays)>MAX_TRAYS) invalid('design.trays');
  for (const field of ['batteryAh','payloadKg']) if (Number(design[field])<0||Number(design[field])>1000) invalid(`design.${field}`);
  const world=object(project.world,['id','revision','width','height','points','obstacles'],'world');
  text(world.id,'world.id');revision(world.revision,'world.revision');number(world.width,'world.width',true);number(world.height,'world.height',true);
  for (const field of ['width','height']) if (Number(world[field])>MAX_WORLD_SIZE) invalid(`world.${field}`);
  if (!Array.isArray(world.points)||!Array.isArray(world.obstacles)||world.points.length+world.obstacles.length>200) invalid('world.objects');
  const ids=new Set<string>();
  for (const value of world.points) {
    const point=object(value,['id','name','kind','x','y'],'world.point');
    text(point.id,'point.id');text(point.name,'point.name');number(point.x,'point.x');number(point.y,'point.y');
    if (!['table','kitchen','parking','dock'].includes(String(point.kind))) invalid('point.kind');
    if (ids.has(point.id as string)) invalid('world.duplicateId');
    ids.add(point.id as string);
  }
  for (const value of world.obstacles) {
    const obstacle=object(value,['id','x','y','width','height'],'world.obstacle');
    text(obstacle.id,'obstacle.id');number(obstacle.x,'obstacle.x');number(obstacle.y,'obstacle.y');number(obstacle.width,'obstacle.width',true);number(obstacle.height,'obstacle.height',true);
    if (ids.has(obstacle.id as string)) invalid('world.duplicateId');
    ids.add(obstacle.id as string);
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length>MAX_PROJECT_BYTES) invalid('size');
  return structuredClone(value) as LabProject;
}
const ID=/^[A-Za-z0-9_.:-]{1,200}$/,HASH=/^[0-9a-f]{64}$/,KINDS=['table','kitchen','parking','dock','coffee_pickup'];
function id(value:unknown,field:string):void {if (typeof value!=='string'||!ID.test(value)) invalid(field);}
function hash(value:unknown,field:string):void {if (typeof value!=='string'||!HASH.test(value)) invalid(field);}
function list(value:unknown,field:string,max=200):unknown[] {if (!Array.isArray(value)||value.length>max) invalid(field);return value as unknown[];}
function vec(value:unknown,length:number,field:string):void {if (!Array.isArray(value)||value.length!==length||!value.every(Number.isFinite)) invalid(field);}
/** Structural v2 check on the Lab side; the source runtime stays the authoritative validator (JSON Schema). Rejects unknown members, so a bad migration cannot be stored. */
export function validateProjectV2(value:unknown):LabProjectV2 {
  const hasSchedule=!!value&&typeof value==='object'&&'faultSchedule' in value;
  const hasArmProfile=!!value&&typeof value==='object'&&'armCollisionProfile' in value;
  const project=object(value,['schemaVersion','id','name','revision','updatedAt','entities','world',...hasArmProfile?['armCollisionProfile']:[],...hasSchedule?['faultSchedule']:[]],'root');
  if(hasSchedule)validateSchedule(project.faultSchedule);
  if (project.schemaVersion!==2) invalid('schemaVersion');
  id(project.id,'id');text(project.name,'name');revision(project.revision,'revision');
  if (typeof project.updatedAt!=='string'||!Number.isFinite(Date.parse(project.updatedAt))) invalid('updatedAt');
  if(hasArmProfile){
    const p=object(project.armCollisionProfile,['schemaVersion','id','revision','units','provenance','reference','modelId','modelRevision','baseInMap','fixtureHeightM','robotHeightM'],'armCollisionProfile');
    id(p.id,'armCollisionProfile.id');revision(p.revision,'armCollisionProfile.revision');id(p.modelId,'armCollisionProfile.modelId');hash(p.modelRevision,'armCollisionProfile.modelRevision');
    if(p.schemaVersion!==1||p.units!=='SI'||p.provenance!=='illustrative'||typeof p.reference!=='string'||p.reference.length<1||p.reference.length>1000)invalid('armCollisionProfile');
    const pose=object(p.baseInMap,['position','quaternionXyzw'],'armCollisionProfile.baseInMap');vec(pose.position,3,'armCollisionProfile.position');vec(pose.quaternionXyzw,4,'armCollisionProfile.quaternionXyzw');
    if((pose.position as number[]).some(n=>Math.abs(n)>1000)||Math.abs(Math.hypot(...pose.quaternionXyzw as number[])-1)>1e-6)invalid('armCollisionProfile.baseInMap');
    for(const k of ['fixtureHeightM','robotHeightM']){number(p[k],`armCollisionProfile.${k}`,true);if(Number(p[k])>100)invalid(`armCollisionProfile.${k}`);}
  }
  const ids=new Set<string>();
  for (const e of list(project.entities,'entities')) {
    const optional=e&&typeof e==='object'?['recipeRefs','speedLimitMps'].filter(k=>k in e):[];
    const entity=object(e,['id','kind','assetRef',...optional],'entity');
    if('speedLimitMps' in entity&&(entity.kind!=='amr'||typeof entity.speedLimitMps!=='number'||!Number.isFinite(entity.speedLimitMps)||entity.speedLimitMps<=0||entity.speedLimitMps>0.5)) invalid('entity.speedLimitMps');
    id(entity.id,'entity.id');if (ids.has(entity.id as string)||!['amr','arm','coffee_machine','cup_station'].includes(String(entity.kind))) invalid('entity');
    ids.add(entity.id as string);
    const ref=object(entity.assetRef,['id','revision','contentHash'],'entity.assetRef');id(ref.id,'assetRef.id');revision(ref.revision,'assetRef.revision');hash(ref.contentHash,'assetRef.contentHash');
  }
  const hasHandoff=!!value&&typeof value==='object'&&'handoffPoints' in ((value as {world?:object}).world??{});
  const world=object(project.world,hasHandoff?['id','revision','width','height','points','handoffPoints','obstacles']:['id','revision','width','height','points','obstacles'],'world');
  id(world.id,'world.id');revision(world.revision,'world.revision');number(world.width,'world.width',true);number(world.height,'world.height',true);
  for (const field of ['width','height']) if (Number(world[field])>MAX_WORLD_SIZE) invalid(`world.${field}`);
  const points=new Set<string>();
  for (const p of list(world.points,'world.points')) {
    const point=object(p,['id','name','kind','x','y'],'world.point');id(point.id,'point.id');text(point.name,'point.name');number(point.x,'point.x');number(point.y,'point.y');
    if (!KINDS.includes(String(point.kind))||points.has(point.id as string)) invalid('point');
    points.add(point.id as string);
  }
  if (hasHandoff) for (const h of list(world.handoffPoints,'world.handoffPoints')) {
    const handoff=object(h,['id','name','kind','position','yawRad'],'world.handoff');id(handoff.id,'handoff.id');text(handoff.name,'handoff.name');vec(handoff.position,3,'handoff.position');
    if (!KINDS.includes(String(handoff.kind))||(handoff.yawRad!==null&&!Number.isFinite(handoff.yawRad))) invalid('handoff');
  }
  for (const o of list(world.obstacles,'world.obstacles')) {
    const obstacle=object(o,['id','x','y','width','height'],'world.obstacle');id(obstacle.id,'obstacle.id');number(obstacle.x,'obstacle.x');number(obstacle.y,'obstacle.y');number(obstacle.width,'obstacle.width',true);number(obstacle.height,'obstacle.height',true);
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length>MAX_PROJECT_BYTES) invalid('size');
  return structuredClone(value) as LabProjectV2;
}
