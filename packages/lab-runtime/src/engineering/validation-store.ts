import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {documentDigest,validateNavigationDocument} from '../v2/navigation2d/contracts';
import type {ArtifactRef,ModelValidationReportV1} from '../v2/navigation2d/contracts';

const DIGEST=/^[0-9a-f]{64}$/;
const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function atomicWrite(path:string,data:string|Uint8Array){const tmp=`${path}.tmp-${randomUUID()}`;await writeFile(tmp,data,{mode:0o600});await rename(tmp,path);}
export interface StoredValidation{bundleDigests:string[];report:ModelValidationReportV1}

/**
 * Validation reports live beside, never inside, the immutable bundle store: appending a report must not change the digest of a bundle a run already pinned.
 * Reports and artifacts are content-addressed and re-verified on every read; the cache maps a full identity key to a report digest.
 */
export function createValidationStore(root:string){
 const reports=join(root,'reports'),artifacts=join(root,'artifacts'),cache=join(root,'cache');
 // read-merge-write of one report is serialized per digest in this process, so concurrent owners cannot overwrite each other's association
 const writing=new Map<string,Promise<void>>();
 const ready=Promise.all([reports,artifacts,cache].map(d=>mkdir(d,{recursive:true})));
 return {
  root,
  async putArtifact(bytes:Uint8Array):Promise<Pick<ArtifactRef,'sha256'|'bytes'>>{await ready;const digest=sha256(bytes);await atomicWrite(join(artifacts,digest),bytes);return {sha256:digest,bytes:bytes.length};},
  async readArtifact(digest:string):Promise<Uint8Array|null>{
   if(!DIGEST.test(digest))return null;
   const bytes=await readFile(join(artifacts,digest)).catch(()=>null);
   return bytes&&sha256(bytes)===digest?bytes:null;
  },
  /** Only reports that ran are cached (cacheKey): a transient failure must not be replayed as the answer. */
  async putReport(entry:{bundleDigest:string;cacheKey:string|null;report:ModelValidationReportV1}):Promise<void>{
   await ready;
   const {report}=entry;
   if(documentDigest(report,'reportDigest')!==report.reportDigest)throw new Error('VALIDATION_REPORT_DIGEST_MISMATCH');
   const turn=(writing.get(report.reportDigest)??Promise.resolve()).then(()=>this.merge(entry));
   const settled=turn.catch(()=>undefined);
   writing.set(report.reportDigest,settled);
   void settled.then(()=>{if(writing.get(report.reportDigest)===settled)writing.delete(report.reportDigest);});
   return turn;
  },
  async merge(entry:{bundleDigest:string;cacheKey:string|null;report:ModelValidationReportV1}):Promise<void>{
   const {report}=entry;
   // the same report can serve several bundles (identical model and URDF): remember every one, so each owner session may read it
   const known=(await this.readReport(report.reportDigest))?.bundleDigests??[];
   await atomicWrite(join(reports,`${report.reportDigest}.json`),JSON.stringify({bundleDigests:[...new Set([...known,entry.bundleDigest])].sort(),report}));
   if(entry.cacheKey&&DIGEST.test(entry.cacheKey))await atomicWrite(join(cache,entry.cacheKey),report.reportDigest);
  },
  async readReport(digest:string):Promise<StoredValidation|null>{
   if(!DIGEST.test(digest))return null;
   try{
    const stored=JSON.parse(await readFile(join(reports,`${digest}.json`),'utf8')) as StoredValidation;
    const check=validateNavigationDocument(stored.report);
    return check.ok&&stored.report.reportDigest===digest&&Array.isArray(stored.bundleDigests)&&stored.bundleDigests.every(b=>DIGEST.test(b))?stored:null;
   }catch{return null;}
  },
  async findCached(cacheKey:string):Promise<StoredValidation|null>{
   const digest=DIGEST.test(cacheKey)?await readFile(join(cache,cacheKey),'utf8').catch(()=>null):null;
   return digest?this.readReport(digest.trim()):null;
  },
 };
}
export type ValidationStore=ReturnType<typeof createValidationStore>;
