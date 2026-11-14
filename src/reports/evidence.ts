// Immutable local evidence. Editing a design changes its applicability, never the saved report or its historical outcome.
import type {LabProjectV2} from '../shared/types';
import type {RunReport} from '../scenarios/controls';
import {hashJson} from '../twin/hash';
type ScopeHashes=Record<'model'|'world'|'recipe'|'profile',string>;
/** 'assembly' exists only for engineering evidence: the project digest the run was compiled from. */
export type EvidenceScope=keyof ScopeHashes|'assembly';
export interface SavedEvidence {payloadBundle?:import('../twin/payload').PayloadBundle;origin?:'local'|'imported';id:string;capturedAt:string;report:RunReport;project:LabProjectV2;hash:string;inputs:ScopeHashes;runtime:ScopeHashes;engineering?:{bundleDigest:string;projectDigest:string}}
const sorted=<T,>(rows:T[])=>[...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function inputScopes(project:LabProjectV2):ScopeHashes {
 return {model:hashJson(sorted(project.entities.map(e=>({id:e.id,kind:e.kind,assetRef:e.assetRef})))),world:hashJson(project.world),
  recipe:hashJson(sorted(project.entities.flatMap(e=>(e.recipeRefs??[]).map(r=>({entityId:e.id,...r}))))),
  profile:hashJson({amr:sorted(project.entities.filter(e=>e.kind==='amr').map(e=>({id:e.id,speedLimitMps:e.speedLimitMps??null}))),armCollisionProfile:project.armCollisionProfile??null})};
}
function runtimeScopes(report:RunReport):ScopeHashes {
 const m=report.manifest;
 return {model:hashJson({assets:m.assets,models:m.models??null}),world:m.world.hash,
  recipe:hashJson(m.recipes??[]),profile:hashJson({profiles:m.profiles??[],adapterHash:m.adapterHash??null,backends:m.backends,calibration:m.calibration??null})};
}
export function captureEvidence(report:RunReport,project:LabProjectV2,payloadBundle?:import('../twin/payload').PayloadBundle|null):SavedEvidence {
 const snapshot=structuredClone(report),input=structuredClone(project),hash=hashJson({report:snapshot,project:input});
 return {id:`${report.manifest.runId}:${hash}`,capturedAt:new Date().toISOString(),report:snapshot,project:input,hash,...payloadBundle?{payloadBundle:structuredClone(payloadBundle)}:{},inputs:inputScopes(input),runtime:runtimeScopes(snapshot),...snapshot.manifest.engineering?{engineering:{...snapshot.manifest.engineering}}:{}};
}
export function evidenceStatus(saved:SavedEvidence,project:LabProjectV2,currentReport?:RunReport|null,current_?:{engineeringProjectDigest?:string}){
 const current=inputScopes(project),runtime=currentReport?runtimeScopes(currentReport):null;
 const scopes:EvidenceScope[]=(Object.keys(current) as (keyof ScopeHashes)[]).filter(k=>current[k]!==saved.inputs[k]||runtime&&runtime[k]!==saved.runtime[k]);
 // engineering evidence applies only to the design it was compiled from; an unknown current design is not proof it still applies
 if(saved.engineering&&current_?.engineeringProjectDigest!==saved.engineering.projectDigest)scopes.push('assembly');
 return {stale:scopes.length>0,scopes,runtimeChecked:runtime!==null};
}
export class EvidenceStore {
 private connection:Promise<IDBDatabase>|null=null;
 constructor(readonly name='mekoniq-robot-lab-evidence'){}
 private database(){
  if(!this.connection)this.connection=new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(this.name,1);
   request.onupgradeneeded=()=>request.result.createObjectStore('reports',{keyPath:'id'});
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.connection=null;};resolve(db);};
   request.onerror=()=>{this.connection=null;reject(request.error);};
  });return this.connection;
 }
 async save(evidence:SavedEvidence):Promise<void>{
  if(hashJson({report:evidence.report,project:evidence.project})!==evidence.hash||evidence.id!==`${evidence.report.manifest.runId}:${evidence.hash}`)throw new Error('EVIDENCE_HASH_MISMATCH');
  const db=await this.database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('reports','readwrite'),store=tx.objectStore('reports'),existing=store.get(evidence.id);
   existing.onsuccess=()=>{if(!existing.result)store.add(structuredClone(evidence));};
   tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error??new Error('EVIDENCE_SAVE_FAILED'));
  });
 }
 async list():Promise<SavedEvidence[]>{const db=await this.database();return new Promise((resolve,reject)=>{const request=db.transaction('reports').objectStore('reports').getAll();request.onsuccess=()=>resolve((request.result as SavedEvidence[]).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt)));request.onerror=()=>reject(request.error);});}
 async close(){if(this.connection)(await this.connection).close();this.connection=null;}
}
