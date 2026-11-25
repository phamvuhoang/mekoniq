import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {hashJson} from '../v2/hash';
import {validateDeviceProfile,electricalDigest,type DeviceProfileV1} from './electrical/contracts';
import {crossCheckDescription,profileSources} from './electrical/profiles';
import {validateActuatorModel,validateComponentRevision,validateProcessModel,validateSensorModel,type Checked,type ComponentRevision,type Problem} from './contracts';

export interface Quote{amount:number;currency:string;quotedOn:string;}
/** Deterministic summary of a pinned EDS/ESI (scripts/describe-device.py); TS only reads it. */
export interface DescriptionSummary{kind:'eds'|'esi';fileSha256:string;vendorId:string;productCode:string;revision:string;supportedModes:string[];objects:{index:string;subindex:number;name:string;access:'ro'|'rw'|'wo';pdoMappable:boolean}[]}
export type CatalogModel=Record<string,unknown>&{kind:'actuator'|'sensor'|'process';id:string};
export interface CatalogResult{
 /** Keyed by canonical component digest. Components with blocking problems are still listed so the UI can show what is missing. */
 components:Record<string,ComponentRevision>;
 models:Record<string,CatalogModel>;
 /** Price only ever comes from a valid quotation; absence means unknown, never zero. */
 quotes:Record<string,Quote>;
 /** Keyed by profile digest. Optional catalog key `deviceProfiles`; a catalog without it loads exactly as before. */
 deviceProfiles:Record<string,DeviceProfileV1>;
 /** Keyed by the sha256 of the pinned description file. */
 descriptions:Record<string,DescriptionSummary>;
 /** Problem paths start with /components/<digest> or /catalog so callers can scope them to the components they use. */
 problems:Problem[];
}
const sha256=(bytes:Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');
const problem=(code:string,path:string,detail:string):Problem=>({code,path,blocking:true,detail});
const DIGEST=/^[0-9a-f]{64}$/;
/** Resolves a catalog-relative path; anything absolute or leaving the root is rejected. */
function inside(root:string,rel:unknown):string|null{
 if(typeof rel!=='string'||!rel||isAbsolute(rel))return null;
 const full=resolve(root,rel),back=relative(root,full);
 return back&&!back.startsWith('..')&&!isAbsolute(back)?full:null;
}
const read=async(path:string)=>readFile(path).catch(()=>null);
const parse=(bytes:Uint8Array|null):unknown=>{try{return bytes?JSON.parse(Buffer.from(bytes).toString('utf8')):undefined;}catch{return undefined;}};

/** Verifies bytes under documents/<digest>; the digest names the file, so a name that does not hash to itself is tampering. */
async function checkBlob(root:string,digest:string,path:string,out:Problem[]){
 if(!DIGEST.test(digest)){out.push(problem('BLOB_UNAVAILABLE',path,`invalid digest ${digest}`));return;}
 const bytes=await read(join(root,'documents',digest));
 if(!bytes)out.push(problem('BLOB_UNAVAILABLE',path,digest));
 else if(sha256(bytes)!==digest)out.push(problem('BLOB_HASH_MISMATCH',path,digest));
}
const MODEL_CHECK:Record<string,(v:unknown)=>Checked>={actuator:validateActuatorModel,sensor:validateSensorModel,process:validateProcessModel};

export async function loadCatalog(root:string):Promise<CatalogResult>{
 const result:CatalogResult={components:{},models:{},quotes:{},deviceProfiles:{},descriptions:{},problems:[]};
 const index=parse(await read(join(root,'catalog.json'))) as {schemaVersion?:number;components?:{file?:unknown;digest?:unknown}[];quotes?:unknown[];deviceProfiles?:{file?:unknown;digest?:unknown}[]}|undefined;
 if(!index||index.schemaVersion!==1||!Array.isArray(index.components)){result.problems.push(problem('CATALOG_UNREADABLE','/catalog','catalog.json missing or not schemaVersion 1'));return result;}
 for(const [n,entry] of index.components.entries()){
  const declared=String(entry.digest);
  const path=`/components/${DIGEST.test(declared)?declared:n}`;
  const file=inside(root,entry.file);
  if(!file){result.problems.push(problem('CATALOG_PATH_INVALID',path,String(entry.file)));continue;}
  const doc=parse(await read(file));
  if(doc===undefined){result.problems.push(problem('CATALOG_UNREADABLE',path,String(entry.file)));continue;}
  const shape=validateComponentRevision(doc);
  if(!shape.ok){result.problems.push(...shape.problems.map(p=>({...p,path:path+p.path})));continue;}
  const component=doc as ComponentRevision,digest=hashJson(component);
  if(digest!==declared){result.problems.push(problem('CATALOG_DIGEST_MISMATCH',path,`declared ${declared}, content ${digest}`));continue;}
  result.components[digest]=component;
  const own:Problem[]=[];
  for(const [i,d] of component.documents.entries())await checkBlob(root,d.digest,`${path}/documents/${i}`,own);
  for(const l of component.links)for(const kind of ['visual','collision'] as const)for(const [i,s] of l[kind].entries())if(s.geometry.kind==='mesh')await checkBlob(root,s.geometry.blobSha256,`${path}/links/${l.id}/${kind}/${i}`,own);
  for(const [i,ref] of component.models.entries()){
   const mpath=`${path}/models/${i}`,bytes=DIGEST.test(ref.digest)?await read(join(root,'models',`${ref.digest}.json`)):null,model=parse(bytes) as CatalogModel|undefined;
   if(!model){own.push(problem('MODEL_UNAVAILABLE',mpath,ref.digest));continue;}
   if(hashJson(model)!==ref.digest){own.push(problem('MODEL_HASH_MISMATCH',mpath,ref.digest));continue;}
   const checked=model.kind===ref.kind&&model.id===ref.id?MODEL_CHECK[ref.kind]!(model):{ok:false,problems:[problem('MODEL_KIND_MISMATCH','',`ref ${ref.kind}/${ref.id}`)]};
   if(!checked.ok){own.push(...checked.problems.map(p=>problem('MODEL_INVALID',mpath+p.path,`${p.code}: ${p.detail}`)));continue;}
   result.models[ref.digest]=model;
  }
  // a manufacturer/measured parameter must cite a document this component declares, with the same content hash
  const cited=(value:unknown,path:string)=>{
   if(Array.isArray(value))value.forEach((v,i)=>cited(v,`${path}/${i}`));
   else if(value&&typeof value==='object'){
    const r=value as {kind?:unknown;documentId?:unknown;contentSha256?:unknown};
    if((r.kind==='manufacturer'||r.kind==='measured')&&typeof r.documentId==='string'&&!component.documents.some(d=>d.id===r.documentId&&d.digest===r.contentSha256))own.push(problem('PROVENANCE_UNRESOLVED',path,`${r.documentId} is not a declared document with digest ${String(r.contentSha256)}`));
    for(const [k,v] of Object.entries(value))cited(v,`${path}/${k}`);
   }
  };
  cited({links:component.links,joints:component.joints,ports:component.ports,payloadRatings:component.payloadRatings,battery:component.battery,supportPoints:component.supportPoints},path);
  for(const ref of component.models)if(result.models[ref.digest])cited(result.models[ref.digest],`${path}/models/${ref.id}`);
  result.problems.push(...own);
 }
 await loadDeviceProfiles(root,index.deviceProfiles,result);
 for(const [i,raw] of (index.quotes??[]).entries()){
  const q=raw as {componentDigest?:string;amount?:number;currency?:string;quotedOn?:string;documentId?:string};
  const valid=typeof q.componentDigest==='string'&&q.componentDigest in result.components&&typeof q.amount==='number'&&Number.isFinite(q.amount)&&q.amount>0&&/^[A-Z]{3}$/.test(q.currency??'')&&/^\d{4}-\d{2}-\d{2}$/.test(q.quotedOn??'')&&!!q.documentId&&result.components[q.componentDigest!]!.documents.some(d=>d.id===q.documentId);
  if(!valid)result.problems.push(problem('PRICE_QUOTE_INVALID',`/catalog/quotes/${i}`,'quote needs a known component, a positive amount, ISO currency, date and a source document the component declares'));
  else result.quotes[q.componentDigest!]={amount:q.amount!,currency:q.currency!,quotedOn:q.quotedOn!};
 }
 return result;
}

/** Device profiles are siblings of components: a bad one is dropped (shape, digest, component) or listed with its problems (blobs, provenance, claims); it never breaks the catalog. */
async function loadDeviceProfiles(root:string,entries:{file?:unknown;digest?:unknown}[]|undefined,result:CatalogResult){
 if(!Array.isArray(entries))return;
 for(const [n,entry] of entries.entries()){
  const declared=String(entry.digest),path=`/deviceProfiles/${DIGEST.test(declared)?declared:n}`,file=inside(root,entry.file);
  if(!file){result.problems.push(problem('CATALOG_PATH_INVALID',path,String(entry.file)));continue;}
  const doc=parse(await read(file));
  if(doc===undefined){result.problems.push(problem('CATALOG_UNREADABLE',path,String(entry.file)));continue;}
  const shape=validateDeviceProfile(doc);
  if(!shape.ok){result.problems.push(...shape.problems.map(p=>({...p,path:path+p.path})));continue;}
  const profile=doc as DeviceProfileV1,digest=electricalDigest(profile);
  if(digest!==declared||digest!==profile.digest){result.problems.push(problem('CATALOG_DIGEST_MISMATCH',path,`declared ${declared}, document ${profile.digest}, content ${digest}`));continue;}
  if(!(profile.component.digest in result.components)){result.problems.push(problem('DEVICE_PROFILE_COMPONENT_UNAVAILABLE',path+'/component/digest',profile.component.digest));continue;}
  result.deviceProfiles[digest]=profile;
  const own:Problem[]=[],docs=new Map(profile.documents.map(d=>[d.id,d]));
  for(const [i,d] of profile.documents.entries())await checkBlob(root,d.digest,`${path}/documents/${i}`,own);
  for(const [i,s] of profileSources(profile).entries())if((s.kind==='manufacturer'||s.kind==='measured')&&docs.get(s.documentId)?.digest!==s.contentSha256)own.push(problem('PROVENANCE_UNRESOLVED',`${path}/sources/${i}`,`${s.documentId} is not a declared document with digest ${s.contentSha256}`));
  const claim=(c:{documentId:string;locator:string;certificate:{documentId:string;models:string[]}|null}|null,at:string)=>{
   if(!c)return;
   const d=docs.get(c.documentId),cert=c.certificate&&docs.get(c.certificate.documentId);
   if(!d||(d.kind!=='safety_manual'&&d.kind!=='manual'))own.push(problem('SAFETY_CLAIM_UNSUPPORTED',at,`${c.documentId} is not a manual or safety manual of this profile`));
   else if(c.certificate&&(!cert||cert.kind!=='certificate'||!profile.variant.orderCode||!c.certificate.models.includes(profile.variant.orderCode)))own.push(problem('SAFETY_CLAIM_UNSUPPORTED',at+'/certificate',`certificate ${c.certificate.documentId} does not name order code ${String(profile.variant.orderCode)}`));
  };
  profile.ioPoints.forEach((pt,i)=>claim(pt.safety,`${path}/ioPoints/${i}/safety`));claim(profile.drive?.stop.torqueOff??null,`${path}/drive/stop/torqueOff`);
  for(const d of profile.documents.filter(x=>x.kind==='description_file')){
   const summary=parse(await read(join(root,'descriptions',`${d.digest}.summary.json`))) as DescriptionSummary|undefined;
   if(!summary)continue;
   if(summary.fileSha256!==d.digest){own.push(problem('DESCRIPTION_HASH_MISMATCH',`${path}/documents/${d.id}`,summary.fileSha256));continue;}
   result.descriptions[d.digest]=summary;
   own.push(...crossCheckDescription(profile,summary).map(p=>({...p,path:path+p.path})));
  }
  result.problems.push(...own);
 }
}
