// Single geometry source for viewer, collision and footprint. Copy of source/packages/lab-runtime/src/v2/assets.ts (identical apart from the type import).
// TODO(interim-copy): replace with the pinned source artifact or a generated import; until then tests/integration/lab-v2-model.test.ts in source fails on any drift from the source file.
import type {AssetRevision} from '../shared/types';
import {buildFrameGraph,qrotate,ModelError,type FrameGraph,type Pose,type Vec3} from './frames';
import {hashJson} from './hash';
export type Box3={min:Vec3;max:Vec3};
export type Shape=({kind:'box';sizeM:Vec3}|{kind:'cylinder';radiusM:number;heightM:number}|{kind:'sphere';radiusM:number})&{frameId:string;/** pose in the asset root frame */pose:Pose};
export interface CompiledAsset {
 visual:{shapes:Shape[];bounds:Box3|null};
 collision:{shapes:Shape[];bounds:Box3|null;footprint:{min:[number,number];max:[number,number]}|null;/** circumscribed radius about the root frame origin */radiusM:number|null;/** visual-vs-collision bound deviation; primitives are shared so it is exactly 0, a mesh simplifier must report its measured bound here */deviationM:number};
 frames:FrameGraph;
 capabilities:{visual:boolean;collision:boolean;kinematics:boolean;dynamics:boolean;geometryProvenance:string|null;unknown:{parameter:string;reason:string}[]};
}
const MEASURED=new Set(['measured','vendor_spec','vendor_cad']);
const without=<T extends object>(o:T,key:string)=>Object.fromEntries(Object.entries(o).filter(([k])=>k!==key));
export const assetContentHash=(a:AssetRevision):string=>hashJson(without(a,'contentHash'));
export const sealAsset=(a:AssetRevision):AssetRevision=>({...a,contentHash:assetContentHash(a)});
export const verifyAssetHash=(a:AssetRevision):boolean=>a.contentHash===assetContentHash(a);
/** Hash of a world without its revision counter, so a changed model yields a new revision identity. */
export const worldHash=<W extends {revision:number}>(w:W):string=>hashJson(without(w,'revision'));
function bounds(s:Shape):Box3 {
 const R=(v:Vec3)=>qrotate(s.pose.quaternionXyzw,v),h=[0,0,0];
 if(s.kind==='box'){const cols=[R([1,0,0]),R([0,1,0]),R([0,0,1])];for(let k=0;k<3;k++)h[k]=cols.reduce((a,c,i)=>a+Math.abs(c[k]!)*s.sizeM[i]!/2,0);}
 else if(s.kind==='sphere')h.fill(s.radiusM);
 else{const ax=R([0,0,1]);for(let k=0;k<3;k++)h[k]=s.radiusM*Math.sqrt(Math.max(0,1-ax[k]!**2))+s.heightM/2*Math.abs(ax[k]!);}
 const p=s.pose.position;return {min:[p[0]-h[0]!,p[1]-h[1]!,p[2]-h[2]!],max:[p[0]+h[0]!,p[1]+h[1]!,p[2]+h[2]!]};
}
const union=(bs:Box3[]):Box3|null=>bs.length?{min:[0,1,2].map(k=>Math.min(...bs.map(b=>b.min[k]!))) as unknown as Vec3,max:[0,1,2].map(k=>Math.max(...bs.map(b=>b.max[k]!))) as unknown as Vec3}:null;
/** Compile one asset revision. Invalid frame graphs or dangling geometry throw ModelError; unknown measurements stay unknown with a reason. */
export function compileAsset(asset:AssetRevision):CompiledAsset {
 const frames=buildFrameGraph(asset.frames);
 const shapes:Shape[]=asset.geometry.map(g=>{
  if(!frames.has(g.frameId))throw new ModelError('ASSET_GEOMETRY_FRAME_UNKNOWN',g.frameId);
  const {frameId,kind,...dims}=g as Record<string,unknown>&{frameId:string;kind:string};
  return {...dims,kind,frameId,pose:frames.poseOf(g.frameId)} as unknown as Shape;
 });
 const b=union(shapes.map(bounds));
 const footprint=b?{min:[b.min[0],b.min[1]] as [number,number],max:[b.max[0],b.max[1]] as [number,number]}:null;
 const prov=(p:string)=>asset.provenance.find(e=>e.parameter===p)?.source??null;
 const unknown:{parameter:string;reason:string}[]=[];
 if(!asset.inertial)unknown.push({parameter:'inertial.massKg',reason:'NOT_PROVIDED'});
 else if(!MEASURED.has(prov('inertial.massKg')??''))unknown.push({parameter:'inertial.massKg',reason:'PROVENANCE_NOT_MEASURED'});
 if(!shapes.length)unknown.push({parameter:'geometry',reason:'NOT_PROVIDED'});
 if(!asset.kinematics&&asset.kind==='arm')unknown.push({parameter:'kinematics',reason:'NOT_PROVIDED'});
 return {
  visual:{shapes,bounds:b},
  collision:{shapes:[...shapes],bounds:b&&{min:[...b.min] as unknown as Vec3,max:[...b.max] as unknown as Vec3},footprint,radiusM:footprint&&Math.max(...[footprint.min[0],footprint.max[0]].flatMap(x=>[footprint.min[1],footprint.max[1]].map(y=>Math.hypot(x,y)))),deviationM:0},
  frames,
  capabilities:{visual:shapes.length>0,collision:shapes.length>0,kinematics:!!asset.kinematics,dynamics:!!asset.inertial&&MEASURED.has(prov('inertial.massKg')??''),geometryProvenance:prov('geometry'),unknown},
 };
}
// ---- illustrative service AMR, from the same numbers as lab/fixtures/catalog/service-illustrative.json (x forward, y left, z up; metres) ----
const ITEM={base:[0.6,0.55,0.15],battery:[0.25,0.2,0.12],drive:[0.2,0.5,0.15],tray:[0.4,0.45,0.02],tablet:[0.12,0.2,0.01],lidar:{r:0.04,h:0.06},depth:[0.03,0.09,0.03]} as const;
export const SERVICE_AMR_ITEMS=ITEM;
export const MAX_SERVICE_TRAYS=10;
const safeId=(s:string)=>/^[A-Za-z0-9_.:-]{1,200}$/.test(s);
export function serviceAmrAsset(design:{id:string;revision:number;chassis:'service'|'valetudo';trays:number;sensor:'lidar'|'depth'}):AssetRevision {
 const id=`${design.id}-asset`;
 if(!safeId(id))throw new ModelError('MIGRATION_ID_INVALID',design.id);
 const fr=(fid:string,parentId:string|null,t:number[]):AssetRevision['frames'][number]=>({id:fid,parentId,translationM:t,quaternionXyzw:[0,0,0,1]});
 const base={schemaVersion:2 as const,id,revision:design.revision,contentHash:'0'.repeat(64),hashAlgorithm:'sha256-canonical-json-v1' as const,kind:'amr' as const,visual:null,collision:null};
 if(design.chassis==='valetudo')return sealAsset({...base,frames:[fr('base_link',null,[0,0,0])],geometry:[],provenance:[{parameter:'geometry',source:'illustrative',reference:'UNMEASURED: v1 valetudo chassis has no footprint'}]});
 const trays=Math.min(MAX_SERVICE_TRAYS,Math.max(0,Math.floor(design.trays))),top=0.5+Math.max(0,trays-1)*0.31;
 const frames=[fr('base_link',null,[0,0,0]),fr('chassis','base_link',[0,0,0.2]),fr('drive','base_link',[0,0,0.14]),fr('battery','base_link',[-0.04,0,0.37]),fr('sensor','base_link',[0.25,0,0.38]),fr('tablet','base_link',[-0.11,0,top+0.35])];
 const geometry:AssetRevision['geometry']=[{kind:'box',frameId:'chassis',sizeM:[...ITEM.base]},{kind:'box',frameId:'drive',sizeM:[...ITEM.drive]},{kind:'box',frameId:'battery',sizeM:[...ITEM.battery]},
  design.sensor==='lidar'?{kind:'cylinder',frameId:'sensor',radiusM:ITEM.lidar.r,heightM:ITEM.lidar.h}:{kind:'box',frameId:'sensor',sizeM:[...ITEM.depth]},{kind:'box',frameId:'tablet',sizeM:[...ITEM.tablet]}];
 for(let i=0;i<trays;i++){frames.push(fr(`tray_${i+1}`,'base_link',[0,0,0.5+i*0.31]));geometry.push({kind:'box',frameId:`tray_${i+1}`,sizeM:[...ITEM.tray]});}
 return sealAsset({...base,frames,geometry,provenance:[{parameter:'geometry',source:'illustrative',reference:'fixtures/catalog/service-illustrative.json'},{parameter:'frames',source:'illustrative'}]});
}
