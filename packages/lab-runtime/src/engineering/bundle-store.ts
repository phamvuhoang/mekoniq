import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hashJson} from '../v2/hash';

export interface BundleFile{path:string;sha256:string;sizeBytes:number}
export interface ManifestMeta{projectDigest:string;assemblyDigest:string;sceneDigest:string;profile:string;compilerVersion:string;catalogDigest?:string;[extra:string]:unknown}
export type BundleManifest=ManifestMeta&{schemaVersion:1;files:BundleFile[]};
export type BlobRead={bytes:Uint8Array}|{missing:true}|{corrupt:true};
const DIGEST=/^[0-9a-f]{64}$/;
const SEGMENT=/^(?!\.+$)[A-Za-z0-9._-]+$/;
const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const exists=(path:string)=>stat(path).then(()=>true,()=>false);
const readJson=async<T>(path:string):Promise<T|null>=>{try{return JSON.parse(await readFile(path,'utf8')) as T;}catch{return null;}};

/**
 * Content-addressed bundle store. Blobs live once under blobs/<sha256>; a bundle is just its manifest, published last by an atomic rename,
 * so an interrupted publish leaves unreferenced blobs but never a visible half bundle. Nothing is ever garbage-collected here: archive or
 * session expiry must not remove the closure a saved report still references.
 */
export function createBundleStore(root:string){
 const blobs=join(root,'blobs'),bundles=join(root,'bundles'),runs=join(root,'runs');
 // Session access lives in memory by design: a restarted runtime grants nothing until a run proof is presented (grantBundle).
 const access=new Map<string,Set<string>>();
 const allow=(session:string,digest:string)=>{const set=access.get(session)??new Set<string>();set.add(digest);access.set(session,set);};
 const manifestOf=async(digest:string):Promise<BundleManifest|null>=>{
  if(!DIGEST.test(digest))return null;
  const manifest=await readJson<BundleManifest>(join(bundles,digest,'manifest.json'));
  return manifest&&hashJson(manifest)===digest?manifest:null;
 };
 const blobOf=async(digest:string):Promise<BlobRead>=>{
  if(!DIGEST.test(digest))return {missing:true};
  const bytes=await readFile(join(blobs,digest)).catch(()=>null);
  if(!bytes)return {missing:true};
  return sha256(bytes)===digest?{bytes}:{corrupt:true};
 };
 return {
  async publish(session:string,files:{path:string;bytes:Uint8Array}[],meta:ManifestMeta):Promise<{bundleDigest:string;manifest:BundleManifest}>{
   const seen=new Set<string>();
   for(const f of files){
    if(!f.path.split('/').every(s=>SEGMENT.test(s))||seen.has(f.path))throw new Error(`BUNDLE_PATH_INVALID ${f.path}`);
    seen.add(f.path);
   }
   await mkdir(blobs,{recursive:true});await mkdir(bundles,{recursive:true});
   const entries:BundleFile[]=[];
   for(const f of files){
    const digest=sha256(f.bytes);entries.push({path:f.path,sha256:digest,sizeBytes:f.bytes.length});
    if(await exists(join(blobs,digest)))continue;
    const tmp=join(blobs,`.tmp-${randomUUID()}`);await writeFile(tmp,f.bytes,{mode:0o600});await rename(tmp,join(blobs,digest));
   }
   const manifest:BundleManifest={schemaVersion:1,...meta,files:entries.sort((a,b)=>a.path<b.path?-1:1)};
   const bundleDigest=hashJson(manifest);
   if(!await exists(join(bundles,bundleDigest))){
    const stage=join(bundles,`.stage-${randomUUID()}`);
    try{await mkdir(stage);await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest),{mode:0o600});await rename(stage,join(bundles,bundleDigest));}
    finally{await rm(stage,{recursive:true,force:true});}
   }
   allow(session,bundleDigest);
   return {bundleDigest,manifest};
  },
  readManifest:manifestOf,
  readBlob:blobOf,
  /** True when this session compiled the bundle or was granted it by a valid run proof. A digest on its own is never a credential. */
  async authorizeBundle(session:string,digest:string):Promise<boolean>{return access.get(session)?.has(digest)??false;},
  async authorizeBlob(session:string,digest:string):Promise<boolean>{
   for(const bundle of access.get(session)??[])if((await manifestOf(bundle))?.files.some(f=>f.sha256===digest))return true;
   return false;
  },
  /** Called after a run proof was verified: the session may read exactly this bundle, never control the run. */
  async grantBundle(session:string,digest:string):Promise<void>{if(await manifestOf(digest))allow(session,digest);},
  /** Durable run → bundle association, written before a run creation is acknowledged. */
  async bindRun(runId:string,ref:{bundleDigest:string;projectDigest:string}):Promise<void>{
   await mkdir(runs,{recursive:true});await writeFile(join(runs,`${runId}.json`),JSON.stringify({runId,...ref}),{mode:0o600});
  },
  readRunBinding:(runId:string)=>readJson<{runId:string;bundleDigest:string;projectDigest:string}>(join(runs,`${runId}.json`)),
  /** Codes of everything that stops this bundle being reused: empty means every referenced blob is present and intact. */
  async verifyClosure(digest:string):Promise<string[]>{
   const manifest=await manifestOf(digest);
   if(!manifest)return ['MANIFEST_MISSING'];
   const problems:string[]=[];
   for(const f of manifest.files){const blob=await blobOf(f.sha256);if('missing' in blob)problems.push(`BLOB_MISSING ${f.path}`);else if('corrupt' in blob)problems.push(`BLOB_CORRUPT ${f.path}`);}
   return problems;
  },
 };
}
export type BundleStore=ReturnType<typeof createBundleStore>;
