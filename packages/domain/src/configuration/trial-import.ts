import type {CommandEnvelope,JsonObject,JsonValue,Snapshot} from '../../../contracts/src/index';
import {hashPayload} from '../../../contracts/src/index';
import {stateEvent,type ModuleRegistry} from '../modules';
import {guarded,find,ok} from '../continuity/shared';
import {preset,trialFlagFeatures} from '../policy/presets';
import {driverRegistry} from '../fleet/capabilities';
/**
 * Read-only import of a USER-EXPORTED trial site.json (spec §13). Two commands, both through the production registry:
 *  Trial.ImportPreview {input}              dry-run: the report, no events, no effects
 *  Trial.ImportApply   {input,previewHash}  writes station/table points, non-dispatchable robots and one `trial-import` record (menu draft, timing, feature plan)
 * Whitelist: name/points/robots/menu/timing/features. Runtime state (missions, orders, bills, ...) or an unknown field rejects the whole input.
 * The active configuration is never changed here (the feature plan is a proposal for Configuration.Apply) and the catalog is never published.
 */
const IMPORTABLE=['name','points','robots','menu','timing','features'];
/** Static trial settings with no production counterpart (yet): reported, never silently dropped. */
const UNMAPPED:Record<string,string>={
 rev:'TRIAL_REVISION_NOT_CARRIED',trays:'SET_AT_ROBOT_COMMISSIONING',dishPoint:'DERIVED_FROM_POINT_KIND',roles:'PRODUCTION_RBAC_REPLACES_TRIAL_ROLES',
 featurePolicyVersion:'USED_ONLY_TO_MIGRATE_LEGACY_FEATURES',serviceProfile:'NO_PRODUCTION_SETTING',customerCancel:'NO_PRODUCTION_SETTING',service:'NO_PRODUCTION_SETTING',
 notes:'NO_PRODUCTION_SETTING',floor:'FLOOR_PLAN_IS_NOT_A_MAP_IDENTITY',map:'ROUTE_GRAPH_IS_NOT_A_MAP_IDENTITY_REBIND_WITH_ROBOT_BINDMAP',sim:'TRIAL_SIMULATOR_SETTINGS',payment:'BANK_DETAILS_NOT_IMPORTED_STAFF_VERIFICATION_IS_PRODUCTION_POLICY',
};
const RUNTIME=new Set(['missions','mission','orders','order','bills','bill','sessions','session','payments','payment_events','events','queue','state','context','telemetry','robotState','shifts','tickets','calls','requests','log','history']);
const FLAGS=['callStaff','requestBill','guide','order','pay','busRobot'];
const TIMING=['loadSec','handoffSec','remindSec','standbySec','lowBattery','chargedBattery'];
const KINDS:Record<string,'station'|'table'|'dock'>={station:'station',dish:'station',entrance:'station',table:'table',dock:'dock'};
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const isObject=(v:unknown):v is JsonObject=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
type Blocking={path:string;code:string};
type Plan={name:string|null;points:{id:string;name:string;kind:string;role:'station'|'table'|'dock'}[];robots:JsonObject[];menuDraft:JsonObject|null;timing:JsonObject;featurePlan:JsonObject;legacyFeatures:JsonObject;schema:JsonObject};
export type TrialImportReport=JsonObject;
export function buildTrialImportReport(input:JsonValue|undefined,snapshots:Snapshot[]):{report:TrialImportReport;blocking:Blocking[];plan:Plan|null} {
 const blocking:Blocking[]=[],rejectedFields:JsonObject[]=[],unmappedFields:JsonObject[]=[];
 const block=(path:string,code:string)=>{blocking.push({path,code});};
 if(!isObject(input)){
  const report={status:'rejected',liveEffects:'none',previewHash:null,rejectedFields,unmappedFields,blocking:[{path:'',code:'INVALID_INPUT'}]};
  return {report,blocking:[{path:'',code:'INVALID_INPUT'}],plan:null};
 }
 for(const key of Object.keys(input)) {
  if(IMPORTABLE.includes(key)) continue;
  if(own(UNMAPPED,key)) unmappedFields.push({field:key,reason:UNMAPPED[key]!});
  else rejectedFields.push({field:key,reason:RUNTIME.has(key)?'RUNTIME_STATE':'UNKNOWN_FIELD'});
 }
 if(rejectedFields.length) block('',rejectedFields.some(f=>f.reason==='RUNTIME_STATE')?'RUNTIME_STATE_REJECTED':'UNKNOWN_FIELD_REJECTED');
 // schema: only v2 and pre-v2 (absent/1) are known; anything newer is refused instead of guessed
 const version=input.featurePolicyVersion,migrated=version!==2;
 if(version!==undefined&&version!==1&&version!==2) block('featurePolicyVersion','UNSUPPORTED_SCHEMA_VERSION');
 const schema:JsonObject={featurePolicyVersion:typeof version==='number'?version:null,migrated};
 let name:string|null=null;
 if(input.name!==undefined) { if(typeof input.name==='string'&&input.name.trim()&&input.name.length<=128) name=input.name; else block('name','INVALID_NAME'); }
 // points
 const points:Plan['points']=[],pointKinds=new Map<string,string>();
 if(input.points!==undefined) {
  if(!isObject(input.points)||Object.keys(input.points).length>200) block('points','INVALID_POINTS');
  else for(const [id,raw] of Object.entries(input.points)) {
   const path=`points.${id}`;
   if(!ID.test(id)||!isObject(raw)||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>128) { block(path,'INVALID_POINT'); continue; }
   const role=own(KINDS,String(raw.kind))?KINDS[String(raw.kind)]!:undefined;
   if(!role) { block(`${path}.kind`,'INVALID_POINT_KIND'); continue; }
   points.push({id,name:raw.name,kind:String(raw.kind),role});pointKinds.set(id,String(raw.kind));
   // x/y are trial floor-plan coordinates: no map identity, so they are never turned into a binding
   for(const k of Object.keys(raw)) if(!['name','kind'].includes(k)) unmappedFields.push({field:`${path}.${k}`,reason:'NO_MAP_IDENTITY_REBIND_WITH_ROBOT_BINDMAP'});
   const existing=role==='dock'?undefined:find(snapshots,role==='station'?'table':'station',id);
   if(existing) block(path,'POINT_KIND_CONFLICT');
  }
 }
 // points already in the venue are kept as they are; say which, and where the venue's name differs from the trial's
 const keptExisting=points.filter(p=>p.role!=='dock'&&find(snapshots,p.role,p.id)).map(p=>{const existing=String(find(snapshots,p.role,p.id)!.state.name??'');return {id:p.id,kind:p.role,venueName:existing,trialName:p.name,nameDiffers:existing!==p.name};});
 const isKind=(id:unknown,kinds:string[])=>typeof id==='string'&&kinds.includes(pointKinds.get(id)??'');
 // robots: identity and dock only. Teaching points (valetudo.points) and the topic are trial/vendor specific and are never bound.
 const robots:JsonObject[]=[];
 if(input.robots!==undefined) {
  if(!Array.isArray(input.robots)||input.robots.length>10) block('robots','INVALID_ROBOTS');
  else {
   const ids=new Set<string>();
   input.robots.forEach((raw,i)=>{
    const path=`robots[${i}]`;
    if(!isObject(raw)||typeof raw.id!=='string'||!ID.test(raw.id)||ids.has(raw.id)) { block(path,'INVALID_ROBOT'); return; }
    ids.add(raw.id);
    if(find(snapshots,'robot',raw.id)) block(path,'ROBOT_EXISTS');
    const trialDriver=raw.driver===undefined||raw.driver==='sim'?'simulator':raw.driver;
    if(typeof trialDriver!=='string'||!own(driverRegistry,trialDriver)) block(`${path}.driver`,'UNKNOWN_DRIVER');
    if(raw.dock!==undefined&&raw.dock!==null&&!isKind(raw.dock,['dock'])) block(`${path}.dock`,'STALE_POINT_REFERENCE');
    if(raw.valetudo!==undefined) {
     const v=isObject(raw.valetudo)?raw.valetudo:{};
     if(isObject(v.points)) for(const id of Object.keys(v.points)) if(!pointKinds.has(id)) block(`${path}.valetudo.points.${id}`,'STALE_POINT_REFERENCE');
     unmappedFields.push({field:`${path}.valetudo`,reason:'TEACHING_POINTS_AND_TOPIC_NEED_MAP_IDENTITY_REVALIDATION'});
    }
    for(const k of Object.keys(raw)) if(!['id','driver','dock','valetudo'].includes(k)) unmappedFields.push({field:`${path}.${k}`,reason:'UNKNOWN_ROBOT_FIELD'});
    const driver=typeof trialDriver==='string'?trialDriver:'';
    robots.push({id:raw.id,driver,trialDriver:typeof raw.driver==='string'?raw.driver:null,dock:typeof raw.dock==='string'?raw.dock:null,
     // capped at integration_tested (a simulator stays `simulated`); never dispatchable on import: no map, no bindings, no claimed capability
     validation:driver==='simulator'?'simulated':'integration_tested',dispatchable:false,
     reasons:['MAP_NOT_REPORTED','TARGET_UNBOUND','CAPABILITY_UNSUPPORTED',...(driver==='simulator'?[]:['VALIDATION_INSUFFICIENT'])]});
   });
  }
 }
 // menu: kept as a draft (never published to the catalog); prices are whole currency units -> minor-unit strings
 let menuDraft:JsonObject|null=null;
 if(input.menu!==undefined) {
  const m=input.menu,cats=isObject(m)?m.cats:undefined,items=isObject(m)?m.items:undefined;
  if(!isObject(m)||!Array.isArray(cats)||!Array.isArray(items)||cats.length>50||items.length>500) block('menu','INVALID_MENU');
  else {
   const label=(o:JsonObject)=>typeof o.vi==='string'?o.vi:typeof o.name==='string'?o.name:typeof o.en==='string'?o.en:'';
   const catIds=new Set<string>(),outCats:JsonObject[]=[],outItems:JsonObject[]=[],itemIds=new Set<string>();
   cats.forEach((c,i)=>{
    if(!isObject(c)||typeof c.id!=='string'||!c.id||catIds.has(c.id)||!label(c)) { block(`menu.cats[${i}]`,'INVALID_MENU_CATEGORY'); return; }
    catIds.add(c.id);
    if(!isKind(c.station,['station','dish','entrance'])) block(`menu.cats[${i}].station`,'STALE_POINT_REFERENCE');
    outCats.push({id:c.id,name:label(c),names:{vi:typeof c.vi==='string'?c.vi:null,en:typeof c.en==='string'?c.en:null},stationId:typeof c.station==='string'?c.station:null});
   });
   items.forEach((it,i)=>{
    if(!isObject(it)||typeof it.id!=='string'||!it.id||itemIds.has(it.id)||!label(it)) { block(`menu.items[${i}]`,'INVALID_MENU_ITEM'); return; }
    itemIds.add(it.id);
    if(typeof it.price!=='number'||!Number.isSafeInteger(it.price)||it.price<0) { block(`menu.items[${i}].price`,'INVALID_PRICE'); return; }
    if(typeof it.cat!=='string'||!catIds.has(it.cat)) block(`menu.items[${i}].cat`,'STALE_CATEGORY_REFERENCE');
    outItems.push({id:it.id,name:label(it),names:{vi:typeof it.vi==='string'?it.vi:null,en:typeof it.en==='string'?it.en:null},categoryId:typeof it.cat==='string'?it.cat:null,priceMinor:String(it.price)});
   });
   menuDraft={status:'draft_not_published',categories:outCats,items:outItems};
  }
 }
 // timing: recorded for the commissioning/operations settings that will own it; the importer enforces nothing
 const timing:JsonObject={};
 if(input.timing!==undefined) {
  if(!isObject(input.timing)) block('timing','INVALID_TIMING');
  else for(const [k,v] of Object.entries(input.timing)) {
   if(!TIMING.includes(k)) unmappedFields.push({field:`timing.${k}`,reason:'UNKNOWN_TIMING_FIELD'});
   else if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0) block(`timing.${k}`,'INVALID_TIMING');
   else timing[k]=v;
  }
 }
 // features: pre-v2 `call` meant callStaff+requestBill and busRobot was implicitly on; absent flags are off
 const raw=input.features===undefined?{}:input.features;
 const legacyFeatures:JsonObject={};
 if(!isObject(raw)) block('features','INVALID_FEATURES');
 else {
  const f=raw as JsonObject,legacyDefault:Record<string,boolean>=migrated?{callStaff:f.call===true,requestBill:f.call===true,busRobot:true}:{};
  for(const key of FLAGS) {
   const v=f[key];
   if(v!==undefined&&typeof v!=='boolean') block(`features.${key}`,'INVALID_FEATURE_VALUE');
   legacyFeatures[key]=typeof v==='boolean'?v:legacyDefault[key]??false;
  }
  for(const key of Object.keys(f)) if(!FLAGS.includes(key)&&!(migrated&&key==='call')) unmappedFields.push({field:`features.${key}`,reason:'UNKNOWN_FEATURE_FLAG'});
 }
 let featurePlan:JsonObject={};
 if(!blocking.some(b=>b.path.startsWith('features'))) {
  const p=preset('trial-service',Object.fromEntries(FLAGS.map(k=>[k,legacyFeatures[k]===true])));
  featurePlan={preset:'trial-service',presetVersion:p.version,enabled:Object.entries(p.features).filter(([,v])=>v.status==='enabled').map(([k])=>k),dependenciesAdded:p.dependenciesAdded,
   mapping:Object.fromEntries(FLAGS.map(k=>[k,trialFlagFeatures[k]!])),appliedBy:'Configuration.Apply'};
 }
 const plan:Plan={name,points,robots:robots.map(({id,driver,trialDriver,dock,validation})=>({id,driver,trialDriver,dock,validation})),menuDraft,timing,featurePlan,legacyFeatures,schema};
 const planHash=hashPayload({plan} as unknown as JsonObject);
 // the same plan applied before is reported as that, not as a pile of per-robot collisions with its own earlier import
 if(!blocking.some(b=>b.path===''&&b.code.endsWith('_REJECTED'))&&find(snapshots,'trial-import',importId(planHash))) blocking.splice(0,blocking.length,{path:'',code:'TRIAL_IMPORT_ALREADY_APPLIED'});
 const previewHash=blocking.length?null:planHash;
 const report:TrialImportReport={status:blocking.length?'rejected':'ready',liveEffects:'none',previewHash,schema,name,rejectedFields,unmappedFields,blocking,legacyFeatures,featurePlan,keptExisting,
  points:{stations:points.filter(p=>p.role==='station').map(p=>p.id),tables:points.filter(p=>p.role==='table').map(p=>p.id),docks:points.filter(p=>p.role==='dock').map(p=>p.id)},
  robots,menu:menuDraft?{status:'draft_not_published',categories:(menuDraft.categories as JsonObject[]).length,items:(menuDraft.items as JsonObject[]).length}:null,timing};
 return {report,blocking,plan};
}
function previewImport(c:CommandEnvelope,s:Snapshot[]) {
 return ok([],buildTrialImportReport(c.payload.input,s).report);
}
const importId=(hash:string)=>`trial-${hash.slice(0,32)}`;
function applyImport(c:CommandEnvelope,s:Snapshot[]) {
 const {report,blocking,plan}=buildTrialImportReport(c.payload.input,s);
 if(blocking.length||!plan) throw new Error(blocking[0]?.code??'INVALID_INPUT');
 if(c.payload.previewHash!==report.previewHash) throw new Error('PREVIEW_CHANGED');
 const id=importId(String(report.previewHash));
 const authority=find(s,'__scope__','authority')?.state,events=[];
 for(const p of plan.points) {
  if(p.role==='dock') continue;
  if(find(s,p.role,p.id)) continue;
  events.push(stateEvent(p.role==='station'?'StationConfigured':'TableConfigured',p.role,p.id,{id:p.id,name:p.name,trialKind:p.kind,source:'trial-import',...(p.role==='table'?{activeSessionId:null}:{}),version:1}));
 }
 for(const r of plan.robots) {
  events.push(stateEvent('TrialRobotImported','robot',String(r.id),{id:r.id,driver:r.driver,validation:r.validation,capabilities:[],trays:0,maxLoadMinor:'0',battery:null,minBattery:20,availability:'idle',goalState:'idle',
   controlEpoch:1,ownerDeviceId:typeof authority?.ownerDeviceId==='string'?authority.ownerDeviceId:null,offlineExecution:false,bindings:{},chargingDock:r.dock,
   imported:{source:'trial',importId:id,trialDriver:r.trialDriver},version:1}));
 }
 events.push(stateEvent('TrialConfigurationImported','trial-import',id,{id,name:plan.name,previewHash:report.previewHash,schema:plan.schema,featurePlan:plan.featurePlan,legacyFeatures:plan.legacyFeatures,menuDraft:plan.menuDraft,timing:plan.timing,
  unmappedFields:report.unmappedFields,importedBy:c.actorRef,importedAt:c.recordedAt,version:1}));
 return ok(events,{importId:id,stations:(report.points as JsonObject).stations,tables:(report.points as JsonObject).tables,robots:plan.robots.map(r=>r.id),previewHash:report.previewHash});
}
export function registerTrialImport(registry:ModuleRegistry) {
 registry.register('Trial.ImportPreview',guarded(previewImport));
 registry.register('Trial.ImportApply',guarded(applyImport));
}
