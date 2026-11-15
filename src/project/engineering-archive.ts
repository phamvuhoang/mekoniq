import Ajv from 'ajv';
import type {ErrorObject} from 'ajv';
import componentSchema from '../shared/engineering-schemas/engineering-component.schema.json' with {type:'json'};
import projectSchema from '../shared/engineering-schemas/engineering-project.schema.json';
import archiveSchema from '../shared/engineering-schemas/engineering-project-archive.schema.json';
import assetSchema from '../shared/engineering-schemas/asset-revision.schema.json';
import recipeSchema from '../shared/engineering-schemas/coffee-recipe.schema.json';
import addFormats from 'ajv-formats';
import type {ComponentRevision,EngineeringArchive,EngineeringProject} from '../shared/engineering';
import {validateProjectV2} from './schema';
import {canonicalJson,hashJson,sha256Hex} from '../twin/hash';
import {verifyAssetHash} from '../twin/model';
import type {AssetRevision} from '../shared/types';

/** The manifest plus the bytes of every blob it lists, keyed by the manifest's relative file name. Lab-only: the wire form is EngineeringArchive. */
export interface EngineeringArchiveFiles {manifest:EngineeringArchive;files:Record<string,Uint8Array>}
export const MAX_ARCHIVE_JSON_BYTES=2*1024*1024;
export const MAX_ARCHIVE_BLOB_BYTES=200*1024*1024;
export type ArchiveCheck={ok:true;value:EngineeringArchiveFiles;missing:string[]}|{ok:false;problems:string[]};

const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
// The runtime project, assets and recipes keep Lab's own validators; the engineering schemas guard everything that is new.
const patched=(schema:object,edit:(s:any)=>void)=>{const s=clone(schema);edit(s);return s;};
const ajv=new Ajv({allErrors:true,strict:true,discriminator:true});
addFormats(ajv);
ajv.addSchema(assetSchema,'asset-revision.schema.json');
ajv.addSchema(recipeSchema,'coffee-recipe.schema.json');
ajv.addSchema(componentSchema,'engineering-component.schema.json');
ajv.addSchema(patched(projectSchema,s=>{s.properties.runtimeProject={type:'object'};}),'engineering-project.schema.json');
ajv.addSchema(patched(archiveSchema,s=>{s.properties.assets.items={type:'object'};s.properties.recipes.items={type:'object'};}),'engineering-project-archive.schema.json');
const where=(e:ErrorObject)=>`${e.instancePath||'/'} ${e.message??'invalid'}`;
const run=(key:string,value:unknown,code:string):string[]=>{const v=ajv.getSchema(key)!;return v(value)?[]:(v.errors??[]).slice(0,5).map(e=>`${code}:${where(e)}`);};

export const validateEngineeringProjectShape=(project:unknown):string[]=>{
  const problems=run('engineering-project.schema.json',project,'PROJECT_INVALID');
  if (problems.length) return problems;
  const runtime=(project as EngineeringProject).runtimeProject;
  try {validateProjectV2(runtime);} catch (e) {return [`PROJECT_INVALID:runtimeProject ${(e as Error).message}`];}
  return [];
};
// An archive is data to hand to another person or machine: nothing in it may carry authority, a session or a secret, wherever it hides.
const FORBIDDEN=new Set(['credentials','password','privatekey','secret','token','accesstoken','refreshtoken','controllerendpoint','endpoint','session','sessionid','commandqueue','missionqueue','proof','reclaimtoken','controlepoch','grants','robotip']);
function forbiddenKeys(value:unknown,path='',depth=0):string[] {
  if (depth>60||!value||typeof value!=='object'||value instanceof Uint8Array) return [];
  if (Array.isArray(value)) return value.flatMap((v,i)=>forbiddenKeys(v,`${path}/${i}`,depth+1));
  return Object.entries(value).flatMap(([k,v])=>(FORBIDDEN.has(k.toLowerCase().replace(/[_-]/g,''))?[`FORBIDDEN_FIELD:${path}/${k}`]:[]).concat(forbiddenKeys(v,`${path}/${k}`,depth+1)));
}
// full source schema first, then the hash: a self-consistent hash over a malformed document proves nothing
const fits=(key:string,value:unknown)=>ajv.getSchema(key)!(value) as boolean;
const isAsset=(a:unknown):boolean=>{try {return fits('asset-revision.schema.json',a)&&verifyAssetHash(a as AssetRevision);} catch {return false;}};
const isRecipe=(r:unknown):boolean=>{
  if (!fits('coffee-recipe.schema.json',r)) return false;
  const {hash,...rest}=r as {hash:string}&Record<string,unknown>;
  return hash===hashJson(rest);
};
export const validateComponentShape=(component:unknown):string[]=>run('engineering-component.schema.json',component,'COMPONENT_INVALID');
/** Content digest of a component revision, the key instances use to refer to it. */
export const componentDigest=(c:ComponentRevision):string=>sha256Hex(new TextEncoder().encode(canonicalJson(c)));

/** Every digest the design needs besides the JSON in the manifest: documents, meshes and the model JSON files its ModelRefs name. */
export function requiredDigests(components:readonly ComponentRevision[]):string[] {
  const out=new Set<string>();
  for (const c of components) {
    for (const d of c.documents) out.add(d.digest);
    for (const m of c.models) out.add(m.digest);
    for (const l of c.links) for (const s of [...l.visual,...l.collision]) if (s.geometry.kind==='mesh') out.add(s.geometry.blobSha256);
  }
  return [...out].sort();
}
/** Validates before anything is stored: schema, declared hashes and sizes, relative paths, and that the missing list says exactly what is absent. */
export function checkArchive(input:unknown):ArchiveCheck {
  const a=input as Partial<EngineeringArchiveFiles>|null;
  if (!a||typeof a!=='object'||!a.manifest||typeof a.files!=='object'||!a.files) return {ok:false,problems:['ARCHIVE_SHAPE_INVALID']};
  if (new TextEncoder().encode(JSON.stringify(a.manifest)).length>MAX_ARCHIVE_JSON_BYTES) return {ok:false,problems:['ARCHIVE_TOO_LARGE:metadata']};
  const problems=run('engineering-project-archive.schema.json',a.manifest,'ARCHIVE_SCHEMA_INVALID');
  if (problems.length) return {ok:false,problems};
  const m=a.manifest;
  problems.push(...forbiddenKeys(m),...m.assets.flatMap((a,i)=>isAsset(a)?[]:[`ASSET_INVALID:${i}`]),...m.recipes.flatMap((r,i)=>isRecipe(r)?[]:[`RECIPE_INVALID:${i}`]),...validateEngineeringProjectShape(m.project),...m.components.flatMap((c,i)=>validateComponentShape(c).map(p=>`${p} (#${i})`)));
  const known=new Set(m.components.map(componentDigest));
  for (const i of m.project.assembly.instances) if (!known.has(i.componentDigest)) problems.push(`COMPONENT_MISSING:${i.id}`);
  let total=0;const declared=new Set<string>();
  for (const b of m.blobs) {
    if (declared.has(b.digest)) problems.push(`DUPLICATE_BLOB:${b.digest}`);
    declared.add(b.digest);
    if (b.file!==`blobs/${b.digest}`) {problems.push(`BLOB_PATH_INVALID:${b.file}`);continue;}
    const bytes=a.files[b.file];
    if (!(bytes instanceof Uint8Array)) {problems.push(`BLOB_FILE_MISSING:${b.digest}`);continue;}
    total+=bytes.length;
    if (bytes.length!==b.sizeBytes) problems.push(`BLOB_SIZE_MISMATCH:${b.digest}`);
    if (sha256Hex(bytes)!==b.digest) problems.push(`BLOB_HASH_MISMATCH:${b.digest}`);
  }
  if (total>MAX_ARCHIVE_BLOB_BYTES) problems.push('ARCHIVE_TOO_LARGE:blobs');
  for (const file of Object.keys(a.files)) if (!m.blobs.some(b=>b.file===file)) problems.push(`FILE_NOT_DECLARED:${file}`);
  const required=requiredDigests(m.components),missing=required.filter(d=>!declared.has(d));
  if (JSON.stringify([...m.missingDigests].sort())!==JSON.stringify(missing)) problems.push('MISSING_LIST_INCONSISTENT');
  return problems.length?{ok:false,problems}:{ok:true,value:a as EngineeringArchiveFiles,missing};
}
