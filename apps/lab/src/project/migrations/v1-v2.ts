// v1 -> v2 project migration, pure and synchronous. Copy of source/packages/lab-runtime/src/v2/project-migration.ts (identical apart from imports).
// TODO(interim-copy): replace with the pinned source artifact or a generated import; until then tests/integration/lab-v2-model.test.ts in source fails on any drift from the source file.
import type {AssetRevision,LabProject as LabProjectV1,LabProjectV2} from '../../shared/types';
import {serviceAmrAsset} from '../../twin/model';
import {ModelError} from '../../twin/frames';
export type {LabProjectV1};
export interface MigrationResult {projectV2:LabProjectV2;assets:AssetRevision[];warnings:string[];}
const bad=(field:string):never=>{throw new ModelError('MIGRATION_INVALID_V1',field);};
const idOk=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const num=(v:unknown,field:string)=>{if(typeof v!=='number'||!Number.isFinite(v))bad(field);};
/** Never mutates the input. Throws before returning anything, so a caller cannot half-save. */
export function migrateV1Project(v1:LabProjectV1):MigrationResult {
 // Untrusted input: members are checked one by one below, so the loose type stays local to this function.
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const p=v1 as unknown as Record<string,any>;
 if(!p||typeof p!=='object'||p.schemaVersion!==1)bad('schemaVersion');
 const {design,world}=p;
 if(!design||!world||!['service','valetudo'].includes(design.chassis)||!['lidar','depth'].includes(design.sensor))bad('design');
 if(!Array.isArray(world.points)||!Array.isArray(world.obstacles))bad('world');
 for(const x of [p.revision,design.revision,world.revision])if(!Number.isSafeInteger(x)||x<1)bad('revision');
 num(design.trays,'design.trays');num(world.width,'world.width');num(world.height,'world.height');
 if(![p.id,world.id].every(idOk))throw new ModelError('MIGRATION_ID_INVALID',String(p.id));
 if(typeof p.name!=='string'||!p.name.trim()||Number.isNaN(Date.parse(p.updatedAt)))bad('name');
 for(const pt of world.points){if(typeof pt?.id!=='string'||typeof pt.name!=='string'||!pt.name)bad('world.point');if(!idOk(pt.id))throw new ModelError('MIGRATION_ID_INVALID',pt.id);num(pt.x,'point.x');num(pt.y,'point.y');}
 for(const o of world.obstacles){if(typeof o?.id!=='string')bad('world.obstacle');if(!idOk(o.id))throw new ModelError('MIGRATION_ID_INVALID',o.id);for(const k of ['x','y','width','height'])num(o[k],`obstacle.${k}`);}
 const asset=serviceAmrAsset(design),service=design.chassis==='service',warnings=new Set<string>();
 // v1 geometry is a catalog illustration; Valetudo has no footprint at all. Neither is a measurement.
 warnings.add(service?'GEOMETRY_ILLUSTRATIVE':'FOOTPRINT_UNKNOWN');
 warnings.add('ASSET_SELECTION_REQUIRED_BEFORE_SIL');
 if(world.points.length)warnings.add('HANDOFF_YAW_UNKNOWN');
 warnings.add('V1_DESIGN_PARAMETERS_NOT_CARRIED');
 const projectV2:LabProjectV2={schemaVersion:2,id:p.id,name:p.name,revision:p.revision+1,updatedAt:new Date(p.updatedAt).toISOString(),
  entities:[{id:'amr-1',kind:'amr',assetRef:{id:asset.id,revision:asset.revision,contentHash:asset.contentHash}}],
  world:{id:world.id,revision:world.revision+1,width:world.width,height:world.height,
   points:structuredClone(world.points),obstacles:structuredClone(world.obstacles),
   handoffPoints:world.points.map((pt:{id:string;name:string;kind:'table'|'kitchen'|'parking'|'dock';x:number;y:number})=>({id:pt.id,name:pt.name,kind:pt.kind,position:[pt.x,pt.y,0] as [number,number,number],yawRad:null}))}};
 return {projectV2,assets:[asset],warnings:[...warnings]};
}
