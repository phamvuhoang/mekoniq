import {mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {hashJson} from '../v2/hash';
import {ESPRESSO,ICED_MILK_COFFEE} from '../v2/scenarios/coffee';
import type {AssetRevision,CoffeeRecipe,LabProjectV2} from '../v2/contracts';
import {EngineeringInputError,prepareEngineeringCompileInput,resolveAssembly} from './assembly';
import {createBundleStore,type BundleManifest} from './bundle-store';
import {loadCatalog,type CatalogResult} from './catalog';
import {validateBundleReceipt,validateEngineeringProject,validateEngineeringRef} from './contracts';
import type {BundleReceipt,EngineeringCompileInput,EngineeringProject,EngineeringRef,Problem} from './contracts';

/** Production implementation arrives with B02; A04 only defines the port and runs a test double through it. */
export interface CompilerPort{
 version:string;
 compileResolved(input:EngineeringCompileInput,outDir:string):Promise<{sceneDigest:string;files:{path:string;sha256:string}[]}>;
 /** Whether bundles from this compiler can execute natively. Absent means false: compiled-but-not-runnable. */
 runnable?():boolean|Promise<boolean>;
}
export interface EngineeringLimits{timeoutMs:number;maxJsonBytes:number;maxLinks:number;maxBundleBytes:number}
export const DEFAULT_LIMITS:EngineeringLimits={timeoutMs:60_000,maxJsonBytes:2*1024*1024,maxLinks:1000,maxBundleBytes:200*1024*1024};
export interface EngineeringServiceOptions{directory:string;catalogRoot:string;compiler:CompilerPort;recipes?:CoffeeRecipe[];limits?:Partial<EngineeringLimits>}
/** Typed failure mapped to HTTP by the v2 gateway: 400 shape/capability, 403 ownership, 409 identity/closure, 503 timeout. */
export class EngineeringError extends Error{constructor(readonly code:string,readonly status:number,readonly reasonCodes:string[]=[]){super(code);this.name='EngineeringError';}}
export interface LockedEngineering{ref:EngineeringRef;project:EngineeringProject;runtimeProjection:{project:LabProjectV2;assets:AssetRevision[]}}
export const ENGINEERING_CAPABILITY='engineering_bundle_v1';

const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const SEGMENT=/^(?!\.+$)[A-Za-z0-9._-]+$/;
const json=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const blockingFirst=(problems:Problem[])=>problems.slice(0,500);
function withTimeout<T>(work:Promise<T>,ms:number):Promise<T>{
 let timer:NodeJS.Timeout|undefined;
 return Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new EngineeringError('ENGINEERING_COMPILE_TIMEOUT',503)),ms);})]).finally(()=>clearTimeout(timer));
}

export function createEngineeringService(options:EngineeringServiceOptions){
 const limits={...DEFAULT_LIMITS,...options.limits},store=createBundleStore(options.directory),recipes=options.recipes??([ESPRESSO,ICED_MILK_COFFEE] as unknown as CoffeeRecipe[]);
 let catalog:Promise<CatalogResult>|undefined;
 // ponytail: catalog is read once per process; restart (or a future explicit reload) picks up catalog edits.
 const loadedCatalog=()=>catalog??=loadCatalog(options.catalogRoot);

 async function compileEngineeringProject(project:EngineeringProject,sessionId:string):Promise<BundleReceipt>{
  if(Buffer.byteLength(JSON.stringify(project))>limits.maxJsonBytes)throw new EngineeringError('ENGINEERING_TOO_LARGE',400);
  const shape=validateEngineeringProject(project);
  if(!shape.ok)throw new EngineeringError('INVALID_ENGINEERING_PROJECT',400,[...new Set(shape.problems.map(p=>p.code))]);
  const projectDigest=hashJson(project),profile=project.requestedProfile;
  const blocked=(problems:Problem[]):BundleReceipt=>({projectDigest,profile,problems:blockingFirst(problems),state:'blocked',bundleDigest:null,assemblyDigest:null,sceneDigest:null,runnable:false});

  const cat=await loadedCatalog(),used=new Set(project.assembly.instances.map(i=>i.componentDigest));
  // catalog problems only matter for the components this project actually uses
  const scoped=cat.problems.filter(p=>p.blocking&&(p.path.startsWith('/catalog')||[...used].some(d=>p.path.startsWith(`/components/${d}`))));
  const {problems,resolved}=resolveAssembly(project,cat.components,{models:cat.models,quotes:cat.quotes});
  if(!resolved||scoped.length)return blocked([...scoped,...problems]);
  if(resolved.links.length>limits.maxLinks)return blocked([{code:'BUNDLE_BUDGET_EXCEEDED',path:'/links',blocking:true,detail:`${resolved.links.length} links exceed ${limits.maxLinks}`}]);
  const refs=project.runtimeProject.entities.flatMap(e=>e.recipeRefs??[]);
  let input:EngineeringCompileInput;
  try{input=prepareEngineeringCompileInput(project,resolved,recipes.filter(r=>refs.some(x=>x.id===r.id&&x.revision===r.revision)));}
  catch(e){if(e instanceof EngineeringInputError)return blocked(e.problems);throw e;}

  const staging=join(options.directory,'staging',randomUUID());
  await mkdir(staging,{recursive:true});
  try{
   let output:Awaited<ReturnType<CompilerPort['compileResolved']>>;
   try{output=await withTimeout(options.compiler.compileResolved(input,staging),limits.timeoutMs);}
   catch(e){
    if(e instanceof EngineeringError)throw e;
    return blocked([{code:'COMPILER_FAILED',path:'/compiler',blocking:true,detail:e instanceof Error?e.message:String(e)}]);
   }
   const invalid=(detail:string)=>blocked([{code:'COMPILER_OUTPUT_INVALID',path:'/compiler',blocking:true,detail}]);
   const files:{path:string;bytes:Uint8Array}[]=[
    {path:'engineering-project.json',bytes:json(project)},{path:'runtime-project.json',bytes:json(input.runtimeProjection.project)},{path:'assets.json',bytes:json(input.runtimeProjection.assets)},
    {path:'recipes.json',bytes:json(input.recipes)},{path:'resolved-assembly.json',bytes:json(resolved)},{path:'bom.json',bytes:json(resolved.bom)}];
   const taken=new Set(files.map(f=>f.path));
   for(const f of output.files){
    if(!f.path.split('/').every(s=>SEGMENT.test(s))||taken.has(f.path))return invalid(`unusable path ${f.path}`);
    const bytes=await readFile(join(staging,f.path)).catch(()=>null);
    if(!bytes||sha256(bytes)!==f.sha256)return invalid(`${f.path} is missing or does not match its declared digest`);
    taken.add(f.path);files.push({path:f.path,bytes});
   }
   const scene=files.find(f=>f.path==='scene.json');
   if(!scene||sha256(scene.bytes)!==output.sceneDigest)return invalid('sceneDigest does not match scene.json');
   // the closure carries every mesh the resolved links reference, so a bundle never depends on the catalog still being present
   for(const l of resolved.links)for(const s of [...l.visual,...l.collision])if(s.geometry.kind==='mesh'&&!taken.has(`meshes/${s.geometry.blobSha256}`)){
    const bytes=await readFile(join(options.catalogRoot,'documents',s.geometry.blobSha256)).catch(()=>null);
    if(!bytes||sha256(bytes)!==s.geometry.blobSha256)return blocked([{code:'BLOB_UNAVAILABLE',path:`/links/${l.id}`,blocking:true,detail:s.geometry.blobSha256}]);
    taken.add(`meshes/${s.geometry.blobSha256}`);files.push({path:`meshes/${s.geometry.blobSha256}`,bytes});
   }
   const total=files.reduce((n,f)=>n+f.bytes.length,0);
   if(total>limits.maxBundleBytes)return blocked([{code:'BUNDLE_BUDGET_EXCEEDED',path:'/bundle',blocking:true,detail:`${total} bytes exceed ${limits.maxBundleBytes}`}]);
   const runnable=(await options.compiler.runnable?.())===true;
   const {bundleDigest}=await store.publish(sessionId,files,{projectDigest,assemblyDigest:resolved.assemblyDigest,sceneDigest:output.sceneDigest,profile,compilerVersion:options.compiler.version,catalogDigest:hashJson([...used].sort())});
   const receipt:BundleReceipt={projectDigest,profile,state:'compiled',bundleDigest,assemblyDigest:resolved.assemblyDigest,sceneDigest:output.sceneDigest,runnable,
    problems:runnable?[]:[{code:'MODEL_UNQUALIFIED',path:'/compiler',blocking:false,detail:`compiler ${options.compiler.version} has no native qualification; the bundle can be inspected but not run`}]};
   const check=validateBundleReceipt(receipt);
   if(!check.ok)throw new Error(`RECEIPT_INVALID ${check.problems.map(p=>p.code).join(',')}`);
   return receipt;
  }finally{await rm(staging,{recursive:true,force:true});}
 }

 async function readFileJson<T>(manifest:BundleManifest,path:string):Promise<T>{
  const entry=manifest.files.find(f=>f.path===path),blob=entry&&await store.readBlob(entry.sha256);
  if(!blob||!('bytes' in blob))throw new EngineeringError('ENGINEERING_CLOSURE_MISSING',409,[`${path}`]);
  return JSON.parse(Buffer.from(blob.bytes).toString('utf8')) as T;
 }
 return {
  store,
  compileEngineeringProject,
  authorizeBundle:store.authorizeBundle,
  async readManifest(sessionId:string,digest:string){
   if(!await store.authorizeBundle(sessionId,digest))throw new EngineeringError('ENGINEERING_BUNDLE_FORBIDDEN',403);
   const manifest=await store.readManifest(digest);
   if(!manifest)throw new EngineeringError('ENGINEERING_CLOSURE_MISSING',409,['MANIFEST']);
   return manifest;
  },
  async readBlob(sessionId:string,digest:string):Promise<Uint8Array>{
   if(!await store.authorizeBlob(sessionId,digest))throw new EngineeringError('ENGINEERING_BUNDLE_FORBIDDEN',403);
   const blob=await store.readBlob(digest);
   if('bytes' in blob)return blob.bytes;
   throw new EngineeringError('missing' in blob?'ENGINEERING_CLOSURE_MISSING':'ENGINEERING_BLOB_CORRUPT',409);
  },
  /** Everything a run needs from its bundle, derived server-side; the caller's project (if any) may only equal it. */
  async admitRun(sessionId:string,ref:unknown,backendSetId:string,supplied:unknown):Promise<LockedEngineering>{
   const shape=validateEngineeringRef(ref);
   if(!shape.ok)throw new EngineeringError('INVALID_ENGINEERING_REF',400);
   const r=ref as EngineeringRef;
   if(!await store.authorizeBundle(sessionId,r.bundleDigest))throw new EngineeringError('ENGINEERING_BUNDLE_FORBIDDEN',403);
   const manifest=await store.readManifest(r.bundleDigest);
   if(!manifest)throw new EngineeringError('ENGINEERING_CLOSURE_MISSING',409,['MANIFEST']);
   if(manifest.projectDigest!==r.projectDigest)throw new EngineeringError('ENGINEERING_IDENTITY_MISMATCH',409);
   if(manifest.profile!==backendSetId)throw new EngineeringError('ENGINEERING_PROFILE_MISMATCH',409);
   const closure=await store.verifyClosure(r.bundleDigest);
   if(closure.length)throw new EngineeringError('ENGINEERING_CLOSURE_MISSING',409,closure);
   const project=await readFileJson<EngineeringProject>(manifest,'engineering-project.json');
   if(hashJson(project)!==r.projectDigest)throw new EngineeringError('ENGINEERING_IDENTITY_MISMATCH',409);
   const runtime=await readFileJson<LabProjectV2>(manifest,'runtime-project.json'),assets=await readFileJson<AssetRevision[]>(manifest,'assets.json');
   if(supplied!==undefined&&hashJson(supplied)!==hashJson(runtime))throw new EngineeringError('ENGINEERING_IDENTITY_MISMATCH',409);
   return {ref:r,project,runtimeProjection:{project:runtime,assets}};
  },
  bindRun:store.bindRun,
  /** After a verified reclaim proof: read access to this run's bundle for the new session, nothing else. */
  grantRun:(sessionId:string,ref:EngineeringRef)=>store.grantBundle(sessionId,ref.bundleDigest),
 };
}
export type EngineeringService=ReturnType<typeof createEngineeringService>;
