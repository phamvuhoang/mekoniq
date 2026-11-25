// AMR derivations for the twin: footprint at the observed pose, and observed-vs-commanded inspector rows. Pure.
import type {AmrView,RunReport} from '../scenarios/controls';
import type {AssetRevision,LabProjectV2} from '../shared/types';
import {compileAsset} from './model';
import {tr} from '../i18n';
export type Source='observed'|'commanded'|'modeled'|'derived'|'unknown';
export interface Row {key:string;label:string;observed:string;commanded:string;unit:string;source:Source;ageMs:number|null}
export const fmt=(n:number,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';
/** Footprint corners in world metres, or null when the asset is not supplied/has no geometry (unknown, never a default box). */
export function amrFootprint(asset:AssetRevision|undefined,pose:{x:number;y:number;yawRad:number}):[number,number][]|null {
 if(!asset)return null;
 const f=compileAsset(asset).collision.footprint;if(!f)return null;
 const c=Math.cos(pose.yawRad),s=Math.sin(pose.yawRad);
 return ([[f.min[0],f.min[1]],[f.max[0],f.min[1]],[f.max[0],f.max[1]],[f.min[0],f.max[1]]] as [number,number][]).map(([x,y])=>[pose.x+x*c-y*s,pose.y+x*s+y*c]);
}
export const assetOf=(project:LabProjectV2,assets:AssetRevision[],entityId:string)=>{const ref=project.entities.find(e=>e.id===entityId)?.assetRef;return ref?assets.find(a=>a.contentHash===ref.contentHash&&a.id===ref.id):undefined;};
/** Did the runtime resolve this entity's geometry? false = the run used a point model, so footprint/contacts are unknown for the run. */
export const runtimeResolved=(report:RunReport|null,project:LabProjectV2,entityId:string)=>{const ref=project.entities.find(e=>e.id===entityId)?.assetRef;const a=report?.manifest.assets.find(x=>x.contentHash===ref?.contentHash);return a?a.resolved:null;};
export function amrRows(a:AmrView,ageMs:number,resolved:boolean|null):Row[] {
 const goal=a.path[a.path.length-1],deg=a.pose.yawRad*180/Math.PI;
 return [
  {key:'pose-x',label:'x',observed:fmt(a.pose.x),commanded:goal?fmt(goal[0]):'—',unit:'m',source:'observed',ageMs},
  {key:'pose-y',label:'y',observed:fmt(a.pose.y),commanded:goal?fmt(goal[1]):'—',unit:'m',source:'observed',ageMs},
  {key:'yaw',label:tr('Hướng','方位','Heading'),observed:`${fmt(a.pose.yawRad,3)} (${fmt(deg,1)}°)`,commanded:'—',unit:'rad',source:'observed',ageMs},
  {key:'quality',label:tr('Chất lượng pose','姿勢品質','Pose quality'),observed:a.quality==='valid'?tr('hợp lệ','有効','valid'):tr('cũ / chưa rõ','古い・不明','stale / unknown'),commanded:'—',unit:'',source:a.quality==='valid'?'observed':'unknown',ageMs},
  {key:'goal',label:tr('Mục tiêu','目標','Goal'),observed:a.moving?tr('đang di chuyển','移動中','moving'):tr('đứng yên','停止','stopped'),commanded:a.goal?`${a.goal.state} · ${a.goal.commandId.slice(-8)}`:'—',unit:'',source:'commanded',ageMs},
  {key:'hold',label:tr('Giữ tại chỗ','保持','Hold'),observed:a.hold??'—',commanded:'—',unit:'',source:'observed',ageMs},
  {key:'distance',label:tr('Quãng đường','走行距離','Distance'),observed:fmt(a.distanceM),commanded:'—',unit:'m',source:'observed',ageMs},
  {key:'footprint',label:tr('Hình học va chạm','衝突形状','Collision geometry'),observed:resolved===false?tr('chưa rõ · runtime dùng mô hình điểm','不明 · 点モデルで実行','unknown · runtime used a point model'):resolved?tr('đã phân giải','解決済み','resolved'):'—',commanded:'—',unit:'',source:resolved?'modeled':'unknown',ageMs:null},
  {key:'lidar',label:tr('Cảm biến LiDAR','LiDARセンサー','LiDAR sensor'),observed:tr('không có dữ liệu · mock không mô phỏng cảm biến','データなし · モックはセンサー非対応','no data · mock has no sensor model'),commanded:'—',unit:'',source:'unknown',ageMs:null},
 ];
}
