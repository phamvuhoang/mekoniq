// The drive fault studio's model (R4 V08/V09): what the runtime offers (health `faultCatalog`), the targets a preset has, a draft turned into an entry inside the advertised bounds, and the schedule file.
// The server stays the authority (`validate` and the run's own admission); everything here is a courtesy that keeps a person from composing what cannot be run.
export interface FaultBound {min:number;max:number;multipleOf?:number;required:boolean}
export interface FaultCatalogItem {id:string;layer:'command'|'drive'|'feedback'|'sensor';target:'axis'|'gripper'|'lidar';appliedBy:'worker'|'runtime';params:Record<string,FaultBound>}
export type FaultCatalog=readonly FaultCatalogItem[];
export interface DriveFaultEntry {id:string;faultId:string;targetId:string;trigger:{kind:'elapsed_sim_ms';value:number};durationMs:number;params:Record<string,number>}
export interface DriveFaultDraft {faultId:string;targetId:string;atMs:string;params:Record<string,string>}
export const DRIVE_FAULT_LAYERS=['command','drive','feedback','sensor'] as const;
export const MAX_DRIVE_FAULTS=16,MAX_TRIGGER_MS=3_600_000;
const LAYERS=new Set<string>(DRIVE_FAULT_LAYERS),TARGETS=new Set(['axis','gripper','lidar']),APPLIED=new Set(['worker','runtime']);
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const isBound=(b:unknown):b is FaultBound=>!!b&&typeof b==='object'&&finite((b as FaultBound).min)&&finite((b as FaultBound).max)&&(b as FaultBound).min<=(b as FaultBound).max&&typeof (b as FaultBound).required==='boolean'&&((b as FaultBound).multipleOf===undefined||finite((b as FaultBound).multipleOf));
/** The catalog a runtime's health advertises; a runtime that does not run drive faults (or sends something malformed) has none. */
export function faultCatalogOf(health:unknown):FaultCatalog{
 const raw=health&&typeof health==='object'?(health as {faultCatalog?:unknown}).faultCatalog:undefined;
 if(!Array.isArray(raw))return [];
 const out:FaultCatalogItem[]=[];
 for(const f of raw as Record<string,unknown>[]){
  if(!f||typeof f.id!=='string'||!/^[a-z][a-z0-9-]{0,40}$/.test(f.id)||!LAYERS.has(String(f.layer))||!TARGETS.has(String(f.target))||!APPLIED.has(String(f.appliedBy))||!f.params||typeof f.params!=='object'||!Object.values(f.params as object).every(isBound))return [];
  out.push({id:f.id,layer:f.layer as FaultCatalogItem['layer'],target:f.target as FaultCatalogItem['target'],appliedBy:f.appliedBy as FaultCatalogItem['appliedBy'],params:structuredClone(f.params) as Record<string,FaultBound>});
 }
 return out;
}
/** What a preset's drive runs on: the axes and the LiDAR a schedule may name. Only the MuJoCo drive presets have a drive; the runtime checks the real scene again. */
export interface DriveFaultContext {axes:readonly string[];lidars:readonly string[]}
export function driveFaultContext(presetId:string):DriveFaultContext|null{
 const wheels=['amr-1/wheel-left','amr-1/wheel-right'];
 if(presetId==='mujoco-cell')return {axes:[...[1,2,3,4,5,6].map(i=>`arm-1/J${i}`),'arm-1/gripper',...wheels],lidars:[]};
 if(presetId==='mujoco-payload')return {axes:wheels,lidars:['amr-1/lidar-2d']};
 return null;
}
export function faultTargets(item:FaultCatalogItem,ctx:DriveFaultContext):string[]{
 if(item.target==='lidar')return [...ctx.lidars];
 return ctx.axes.filter(a=>a.endsWith('/gripper')===(item.target==='gripper'));
}
export function defaultDraft(catalog:FaultCatalog,ctx:DriveFaultContext):DriveFaultDraft{
 const item=catalog.find(f=>faultTargets(f,ctx).length)??catalog[0];
 if(!item)return {faultId:'',targetId:'',atMs:'0',params:{}};
 return {faultId:item.id,targetId:faultTargets(item,ctx)[0]??'',atMs:'0',params:defaultParams(item)};
}
/** The middle of each advertised bound (rounded to its step), so a draft starts valid. */
export function defaultParams(item:FaultCatalogItem):Record<string,string>{
 return Object.fromEntries(Object.entries(item.params).map(([k,b])=>{
  let v=b.min===b.max?b.min:k==='durationMs'?Math.min(b.max,Math.max(b.min,300)):(b.min+b.max)/2;
  if(b.multipleOf)v=Math.min(b.max,Math.max(b.min,Math.round(v/b.multipleOf)*b.multipleOf));
  return [k,String(Number(v.toPrecision(6)))];
 }));
}
const inBound=(v:number,b:FaultBound)=>v>=b.min&&v<=b.max&&(b.multipleOf===undefined||Math.abs(v/b.multipleOf-Math.round(v/b.multipleOf))<1e-9);
const idSafe=/^[A-Za-z0-9_.:-]{1,200}$/,targetSafe=/^[A-Za-z0-9_./:-]{1,200}$/;
function check(e:Pick<DriveFaultEntry,'faultId'|'targetId'|'trigger'|'durationMs'|'params'>,catalog:FaultCatalog):string|null{
 const item=catalog.find(f=>f.id===e.faultId);if(!item)return 'FAULT_UNKNOWN';
 if(!finite(e.trigger.value)||e.trigger.value<0||e.trigger.value>MAX_TRIGGER_MS)return 'FAULT_TRIGGER_INVALID';
 if(!targetSafe.test(e.targetId))return 'FAULT_TARGET_INVALID';
 for(const [k,b] of Object.entries(item.params)){const v=k==='durationMs'?e.durationMs:e.params[k];if(!finite(v)||!inBound(v,b))return b.required||v!==undefined?'FAULT_PARAM_INVALID':null;}
 if(Object.keys(e.params).some(k=>!Object.hasOwn(item.params,k)||k==='durationMs'))return 'FAULT_PARAM_INVALID';
 return null;
}
export function draftToEntry(draft:DriveFaultDraft,catalog:FaultCatalog):{ok:true;entry:DriveFaultEntry}|{ok:false;code:string}{
 const item=catalog.find(f=>f.id===draft.faultId);if(!item)return {ok:false,code:'FAULT_UNKNOWN'};
 const at=Number(draft.atMs);if(draft.atMs.trim()===''||!Number.isInteger(at)||at<0||at>MAX_TRIGGER_MS)return {ok:false,code:'FAULT_TRIGGER_INVALID'};
 const nums:Record<string,number>={};
 for(const k of Object.keys(item.params)){const raw=(draft.params[k]??'').trim(),v=Number(raw);if(raw===''||!finite(v))return {ok:false,code:'FAULT_PARAM_INVALID'};nums[k]=v;}
 const {durationMs,...params}=nums;
 const entry:DriveFaultEntry={id:`${draft.faultId}-${crypto.randomUUID().slice(0,8)}`,faultId:draft.faultId,targetId:draft.targetId,trigger:{kind:'elapsed_sim_ms',value:at},durationMs:durationMs!,params};
 const bad=check(entry,catalog);return bad?{ok:false,code:bad}:{ok:true,entry};
}
export function serialiseSchedule(entries:readonly DriveFaultEntry[]):string{return JSON.stringify({schemaVersion:1,documentType:'drive-fault-schedule',entries},null,2)+'\n';}
/** A schedule file, whole or not at all: its own document type, at most 16 entries, unique ids, each inside the advertised bounds. It names no project and carries no code. */
export function parseDriveScheduleFile(text:string,catalog:FaultCatalog):{ok:true;entries:DriveFaultEntry[]}|{ok:false;code:string}{
 let doc:unknown;try{doc=JSON.parse(text);}catch{return {ok:false,code:'SCHEDULE_FILE_NOT_JSON'};}
 const d=doc as {schemaVersion?:unknown;documentType?:unknown;entries?:unknown};
 if(!d||typeof d!=='object'||d.schemaVersion!==1||d.documentType!=='drive-fault-schedule'||!Array.isArray(d.entries))return {ok:false,code:'SCHEDULE_FILE_INVALID'};
 if(d.entries.length>MAX_DRIVE_FAULTS)return {ok:false,code:'FAULT_SCHEDULE_TOO_LONG'};
 const ids=new Set<string>(),out:DriveFaultEntry[]=[];
 for(const raw of d.entries as Record<string,unknown>[]){
  const t=raw?.trigger as {kind?:unknown;value?:unknown}|undefined;
  if(!raw||typeof raw.id!=='string'||!idSafe.test(raw.id)||ids.has(raw.id)||typeof raw.faultId!=='string'||typeof raw.targetId!=='string'||t?.kind!=='elapsed_sim_ms'||!finite(t.value)||!finite(raw.durationMs)||!raw.params||typeof raw.params!=='object'||!Object.values(raw.params).every(finite))return {ok:false,code:'SCHEDULE_FILE_INVALID'};
  ids.add(raw.id);
  const e:DriveFaultEntry={id:raw.id,faultId:raw.faultId,targetId:raw.targetId,trigger:{kind:'elapsed_sim_ms',value:t.value},durationMs:raw.durationMs,params:{...raw.params as Record<string,number>}};
  const bad=check(e,catalog);if(bad)return {ok:false,code:bad};out.push(e);
 }
 return {ok:true,entries:out};
}

/** The runtime's verdict on a schedule, with the body it was asked about. */
export interface DriveCheck {state:'idle'|'checking'|'ok'|'refused';codes:string[];error?:string;key?:string}
/** What the studio may show: a verdict is for one exact body (schedule, experiment, set); after any edit, a check that was answered or is still in flight says nothing about the schedule now listed. */
export const visibleCheck=(c:DriveCheck,key:string):DriveCheck=>c.state==='idle'||c.key===key?c:{state:'idle',codes:[]};
/** A schedule needs a drive experiment: without one the run has no drive and the runtime refuses it (after the previous run was already closed by the new one). */
export const driveBlock=(entries:number,experiment:string|undefined):string|null=>entries>0&&!experiment?'FAULT_BACKEND_UNSUPPORTED':null;
