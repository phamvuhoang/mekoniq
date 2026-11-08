import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {hashJson} from '../v2/hash';
import {ESPRESSO,ICED_MILK_COFFEE} from '../v2/scenarios/coffee';
import type {AssetRevision,CoffeeRecipe,LabProjectV2} from '../v2/contracts';
import {EngineeringInputError,prepareEngineeringCompileInput,resolveAssembly} from './assembly';
import {createBundleStore,type BundleManifest} from './bundle-store';
import {loadCatalog,type CatalogResult} from './catalog';
import {validateBundleReceipt,validateEngineeringProject,validateEngineeringRef} from './contracts';
import type {BundleReceipt,EngineeringCompileInput,EngineeringProject,EngineeringRef,Problem,ResolvedAssembly} from './contracts';
import {incompleteReport,validationCacheKey,type RobotModelValidator} from './linkforge';
import {projectPhysicalModel} from './physical-model';
import {createValidationStore} from './validation-store';
import {NAVIGATION_SCHEMA_HASH,validateNavigationDocument} from '../v2/navigation2d/contracts';
import type {ArtifactRef,ModelValidationReportV1} from '../v2/navigation2d/contracts';

/** Production implementation arrives with B02; A04 only defines the port and runs a test double through it. */
export interface CompilerPort{
 version:string;
 compileResolved(input:EngineeringCompileInput,outDir:string):Promise<{sceneDigest:string;files:{path:string;sha256:string}[]}>;
 /** Whether bundles from this compiler can execute natively. Absent means false: compiled-but-not-runnable. */
 runnable?():boolean|Promise<boolean>;
}
export interface EngineeringLimits{timeoutMs:number;maxJsonBytes:number;maxLinks:number;maxBundleBytes:number}
export const DEFAULT_LIMITS:EngineeringLimits={timeoutMs:60_000,maxJsonBytes:2*1024*1024,maxLinks:1000,maxBundleBytes:200*1024*1024};
export interface EngineeringServiceOptions{
 directory:string;catalogRoot:string;compiler:CompilerPort;
 /** Compilers by requested profile. A profile listed in IR_PROFILES never falls back to `compiler` (the native one): without its own compiler the receipt is blocked. */
 compilers?:Partial<Record<string,CompilerPort>>;recipes?:CoffeeRecipe[];limits?:Partial<EngineeringLimits>;
 /** LinkForge shadow validation. Absent means every validation is `not_run` with `validationUnavailable` as the reason; compile and run never depend on it. */
 validator?:RobotModelValidator;validationUnavailable?:string;
}
/** Typed failure mapped to HTTP by the v2 gateway: 400 shape/capability, 403 ownership, 409 identity/closure, 503 timeout. */
export class EngineeringError extends Error{constructor(readonly code:string,readonly status:number,readonly reasonCodes:string[]=[]){super(code);this.name='EngineeringError';}}
/** `navigation` (portable profiles only): the bundle's navigation scene identity, pinned at admission so the run executes exactly that scene. */
export interface LockedEngineering{ref:EngineeringRef;project:EngineeringProject;runtimeProjection:{project:LabProjectV2;assets:AssetRevision[]};navigation?:{path:'navigation-scene.json';sha256:string;sceneDigest:string}}
export const ENGINEERING_CAPABILITY='engineering_bundle_v1';
/** Profiles whose bundles are produced by the portable compiler only. */
export const PORTABLE_PROFILES:readonly string[]=['engineering-irsim-2d-v1'];

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
 const validations=createValidationStore(join(options.directory,'validations'));
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

  const compiler=options.compilers?.[profile]??(PORTABLE_PROFILES.includes(profile)?undefined:options.compiler);
  if(!compiler)return blocked([{code:'PROFILE_COMPILER_UNAVAILABLE',path:'/requestedProfile',blocking:true,detail:`no compiler is registered for profile ${profile}; it is not compiled by another profile's compiler`}]);
  const staging=join(options.directory,'staging',randomUUID());
  await mkdir(staging,{recursive:true});
  try{
   let output:Awaited<ReturnType<CompilerPort['compileResolved']>>;
   try{output=await withTimeout(compiler.compileResolved(input,staging),limits.timeoutMs);}
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
   const runnable=(await compiler.runnable?.())===true;
   const {bundleDigest}=await store.publish(sessionId,files,{projectDigest,assemblyDigest:resolved.assemblyDigest,sceneDigest:output.sceneDigest,profile,compilerVersion:compiler.version,catalogDigest:hashJson([...used].sort())});
   const receipt:BundleReceipt={projectDigest,profile,state:'compiled',bundleDigest,assemblyDigest:resolved.assemblyDigest,sceneDigest:output.sceneDigest,runnable,
    problems:runnable?[]:[{code:'MODEL_UNQUALIFIED',path:'/compiler',blocking:false,detail:`compiler ${compiler.version} has no native qualification; the bundle can be inspected but not run`}]};
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
 const ROBOT_ID=/^[A-Za-z0-9_.:-]{1,200}$/;
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
   if(!PORTABLE_PROFILES.includes(manifest.profile))return {ref:r,project,runtimeProjection:{project:runtime,assets}};
   // the navigation scene the run will execute: validated here and pinned by hash, never taken from the caller
   const entry=manifest.files.find(f=>f.path==='navigation-scene.json'),scene=await readFileJson<{sceneDigest?:string;inputs?:{project?:{digest?:string}}}>(manifest,'navigation-scene.json');
   const checked=validateNavigationDocument(scene);
   if(!entry||!checked.ok||checked.value.documentType!=='navigation-scene'||scene.inputs?.project?.digest!==r.projectDigest)throw new EngineeringError('ENGINEERING_IDENTITY_MISMATCH',409,['NAVIGATION_SCENE']);
   return {ref:r,project,runtimeProjection:{project:runtime,assets},navigation:{path:'navigation-scene.json',sha256:entry.sha256,sceneDigest:String(scene.sceneDigest)}};
  },
  /**
   * Shadow validation of one robot of a compiled bundle. The physical model is re-derived from the bundle's own files (never from caller input), the URDF is the
   * one the compiler published, and the report is stored beside the bundle so its digest never changes. Cached by full identity; only `ran` reports are cached.
   */
  async validateRobotModel(sessionId:string,ref:unknown,robotId:unknown):Promise<{report:ModelValidationReportV1;cached:boolean}>{
   if(typeof robotId!=='string'||!ROBOT_ID.test(robotId))throw new EngineeringError('INVALID_ROBOT_ID',400);
   if(!validateEngineeringRef(ref).ok)throw new EngineeringError('INVALID_ENGINEERING_REF',400);
   const r=ref as EngineeringRef;
   if(!await store.authorizeBundle(sessionId,r.bundleDigest))throw new EngineeringError('ENGINEERING_BUNDLE_FORBIDDEN',403);
   const manifest=await store.readManifest(r.bundleDigest);
   if(!manifest)throw new EngineeringError('ENGINEERING_CLOSURE_MISSING',409,['MANIFEST']);
   if(manifest.projectDigest!==r.projectDigest)throw new EngineeringError('ENGINEERING_IDENTITY_MISMATCH',409);
   const closure=await store.verifyClosure(r.bundleDigest);
   if(closure.length)throw new EngineeringError('ENGINEERING_CLOSURE_MISSING',409,closure);
   const project=await readFileJson<EngineeringProject>(manifest,'engineering-project.json');
   if(hashJson(project)!==r.projectDigest)throw new EngineeringError('ENGINEERING_IDENTITY_MISMATCH',409);
   const input:EngineeringCompileInput={schemaVersion:1,project,projectDigest:r.projectDigest,resolved:await readFileJson<ResolvedAssembly>(manifest,'resolved-assembly.json'),
    runtimeProjection:{project:await readFileJson<LabProjectV2>(manifest,'runtime-project.json'),assets:await readFileJson<AssetRevision[]>(manifest,'assets.json')},recipes:await readFileJson<CoffeeRecipe[]>(manifest,'recipes.json')};
   let model;
   try{model=projectPhysicalModel(input,robotId,NAVIGATION_SCHEMA_HASH);}
   catch(e){if(e instanceof EngineeringInputError)throw new EngineeringError('PHYSICAL_MODEL_UNAVAILABLE',422,[...new Set(e.problems.map(p=>p.code))]);throw e;}
   const checked=validateNavigationDocument(model);
   if(!checked.ok)throw new EngineeringError('PHYSICAL_MODEL_UNAVAILABLE',422,[...new Set(checked.issues.map(i=>i.code))]);
   const urdfPath=`robots/${robotId}.urdf`,entry=manifest.files.find(f=>f.path===urdfPath);
   if(!entry)throw new EngineeringError('ENGINEERING_CLOSURE_MISSING',409,[urdfPath]);
   const urdf:ArtifactRef={path:urdfPath,sha256:entry.sha256,bytes:entry.sizeBytes};
   const remember=(report:ModelValidationReportV1,cacheKey:string|null)=>validations.putReport({bundleDigest:r.bundleDigest,cacheKey,report});
   if(!options.validator){
    const report=incompleteReport(model,urdf,'not_run',options.validationUnavailable??'LINKFORGE_DISABLED','shadow validation is not enabled on this runtime');
    await remember(report,null);return {report,cached:false};
   }
   const key=validationCacheKey(options.validator.identity,model.modelDigest,urdf.sha256),hit=await validations.findCached(key);
   if(hit){await remember(hit.report,null);return {report:hit.report,cached:true};}
   const root=await mkdtemp(join(tmpdir(),'lf-bundle-'));
   try{
    // only what the worker may read: the entity URDF and the mesh closure, laid out like the bundle so relative mesh paths resolve
    for(const f of manifest.files.filter(x=>x.path===urdfPath||x.path.startsWith('meshes/'))){
     await mkdir(dirname(join(root,f.path)),{recursive:true});
     await writeFile(join(root,f.path),await this.readBlobUnchecked(f.sha256),{mode:0o600});
    }
    const report=await options.validator.validate({model,urdf,bundleRoot:root,putArtifact:async(name,bytes)=>({path:`validation-artifacts/${name}`,...await validations.putArtifact(bytes)})});
    await remember(report,report.execution==='ran'?key:null);
    return {report,cached:false};
   }finally{await rm(root,{recursive:true,force:true});}
  },
  async readBlobUnchecked(digest:string):Promise<Uint8Array>{const blob=await store.readBlob(digest);if('bytes' in blob)return blob.bytes;throw new EngineeringError('ENGINEERING_CLOSURE_MISSING',409,[digest]);},
  /** A report is readable by any session that may read one of the bundles it was produced for; everyone else gets the same 404 as for an unknown digest. */
  async readValidation(sessionId:string,reportDigest:string):Promise<ModelValidationReportV1>{
   const stored=await validations.readReport(reportDigest);
   if(stored)for(const b of stored.bundleDigests)if(await store.authorizeBundle(sessionId,b))return stored.report;
   throw new EngineeringError('NOT_FOUND',404);
  },
  /** Server-internal read of one file of a bundle a session was already admitted to (admitRun); verified against the manifest digest. */
  async bundleFile(bundleDigest:string,path:string):Promise<Uint8Array>{
   const manifest=await store.readManifest(bundleDigest),entry=manifest?.files.find(f=>f.path===path),blob=entry&&await store.readBlob(entry.sha256);
   if(!blob||!('bytes' in blob)||sha256(blob.bytes)!==entry!.sha256)throw new EngineeringError('ENGINEERING_CLOSURE_MISSING',409,[path]);
   return blob.bytes;
  },
  bindRun:store.bindRun,
  verifyClosure:store.verifyClosure,
  /** After a verified reclaim proof: read access to this run's bundle for the new session, nothing else. */
  grantRun:(sessionId:string,ref:EngineeringRef)=>store.grantBundle(sessionId,ref.bundleDigest),
 };
}
export type EngineeringService=ReturnType<typeof createEngineeringService>;
