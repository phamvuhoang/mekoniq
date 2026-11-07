import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {hashJson} from '../v2/hash';
import {validateActuatorModel,validateComponentRevision,validateProcessModel,validateSensorModel,type Checked,type ComponentRevision,type Problem} from './contracts';

export interface Quote{amount:number;currency:string;quotedOn:string;}
export type CatalogModel=Record<string,unknown>&{kind:'actuator'|'sensor'|'process';id:string};
export interface CatalogResult{
 /** Keyed by canonical component digest. Components with blocking problems are still listed so the UI can show what is missing. */
 components:Record<string,ComponentRevision>;
 models:Record<string,CatalogModel>;
 /** Price only ever comes from a valid quotation; absence means unknown, never zero. */
 quotes:Record<string,Quote>;
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
 const result:CatalogResult={components:{},models:{},quotes:{},problems:[]};
 const index=parse(await read(join(root,'catalog.json'))) as {schemaVersion?:number;components?:{file?:unknown;digest?:unknown}[];quotes?:unknown[]}|undefined;
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
 for(const [i,raw] of (index.quotes??[]).entries()){
  const q=raw as {componentDigest?:string;amount?:number;currency?:string;quotedOn?:string;documentId?:string};
  const valid=typeof q.componentDigest==='string'&&q.componentDigest in result.components&&typeof q.amount==='number'&&Number.isFinite(q.amount)&&q.amount>0&&/^[A-Z]{3}$/.test(q.currency??'')&&/^\d{4}-\d{2}-\d{2}$/.test(q.quotedOn??'')&&!!q.documentId;
  if(!valid)result.problems.push(problem('PRICE_QUOTE_INVALID',`/catalog/quotes/${i}`,'quote needs a known component, a positive amount, ISO currency, date and source document'));
  else result.quotes[q.componentDigest!]={amount:q.amount!,currency:q.currency!,quotedOn:q.quotedOn!};
 }
 return result;
}
