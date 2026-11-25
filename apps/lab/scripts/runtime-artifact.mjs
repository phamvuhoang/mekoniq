import {readFile,writeFile,mkdir,rename,stat,rm,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {auditBundle} from './runtime-audit.mjs';
export const digest=(value)=>createHash('sha256').update(value).digest('hex');
// Protocol majors this Lab speaks: v1 (S01 business_sim) and v2 (twin, FD01/BV01). An artifact offering anything else needs a Lab update first.
export const LAB_PROTOCOL_MAJORS=[1,2];
/** Incoming UTF-8 manifest bound, matched by the Source exporter; closure/schema/path limits remain separate. */
export const RUNTIME_MANIFEST_MAX_BYTES=256*1024;
const SCHEMA_NAME=/^[a-z0-9][a-z0-9.-]*\.json$/;
export function validateManifest(m) {
 if(m?.dirty!==false)throw new Error('DIRTY_SOURCE_ARTIFACT');
 if(!m||typeof m!=='object'||!Number.isInteger(m.protocolMajor)||m.nodeMajor!==24||typeof m.packageVersion!=='string'||!/^v?24\.\d+\.\d+$/.test(m.toolchain?.node)||m.entrypoint!=='runtime.mjs'||!/^[a-f0-9]{40}$/.test(m.sourceCommit)||!/^[a-f0-9]{64}$/.test(m.schemaHash)||!/^[a-f0-9]{64}$/.test(m.artifactSha256)) throw new Error('INVALID_RUNTIME_MANIFEST');
 const majors=m.protocolMajors??[m.protocolMajor];
 if(!Array.isArray(majors)||!majors.includes(m.protocolMajor)||!majors.every(n=>LAB_PROTOCOL_MAJORS.includes(n)))throw new Error(`UNSUPPORTED_PROTOCOL:${majors}`);
 if(m.schemas!==undefined&&(!Array.isArray(m.schemas)||m.schemas.length>256||!m.schemas.every(n=>typeof n==='string'&&SCHEMA_NAME.test(n))))throw new Error('INVALID_RUNTIME_MANIFEST');
 if(m.portableSimulationTools!==undefined)validatePortableTools(m.portableSimulationTools);
 return m;
}
// ---- portableSimulationTools (IR-SIM 2D / LinkForge, developer Mac): distributed separately from runtime.mjs; the closure names every file the workers may load. ----
const SHA=/^[a-f0-9]{64}$/,TOOL_PATH=/^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
const safeToolPath=(p)=>typeof p==='string'&&p.length<=512&&TOOL_PATH.test(p)&&p.split('/').every(s=>s!=='.'&&s!=='..');
/** Closed shape, self-consistent digest, every tool root and lock inside the closure. Anything else is INVALID_PORTABLE_TOOLS: the importer never guesses. */
export function validatePortableTools(p){
 const bad=(why)=>{throw new Error(`INVALID_PORTABLE_TOOLS:${why}`);};
 if(!p||typeof p!=='object'||p.distribution!=='separate'||p.version!==1||p.python?.implementation!=='cpython'||p.python?.version!=='3.11')bad('shape');
 const c=p.closure,files=c?.files;
 if(!c||c.version!==1||!SHA.test(c.digest)||!Array.isArray(files)||!files.length||files.length>4096)bad('closure');
 for(const [i,f] of files.entries())if(!f||Object.keys(f).sort().join()!=='bytes,path,sha256'||!safeToolPath(f.path)||!SHA.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0||i&&!(files[i-1].path<f.path))bad(`file:${f?.path}`);
 if(digest(JSON.stringify(files))!==c.digest)bad('digest');
 if(!Array.isArray(p.roots)||!p.roots.length||p.roots.length>16||!p.roots.every(safeToolPath)||files.some(f=>!p.roots.some(r=>f.path.startsWith(r+'/'))))bad('roots');
 if(!Array.isArray(p.tools)||!p.tools.length||p.tools.length>16)bad('tools');
 for(const t of p.tools){
  if(!t||typeof t.id!=='string'||!/^[a-z0-9_]{1,64}$/.test(t.id)||!safeToolPath(t.root)||!files.some(f=>f.path.startsWith(t.root+'/')))bad(`tool:${t?.id}`);
  if(t.lock!==undefined&&(!safeToolPath(t.lock.path)||!t.lock.path.startsWith(t.root+'/')||files.find(f=>f.path===t.lock.path)?.sha256!==t.lock.sha256))bad(`lock:${t.id}`);
 }
 for(const id of ['irsim_worker','linkforge_worker'])if(!p.tools.find(t=>t.id===id)?.lock)bad(`tool:${id}`);
 return p;
}
const SKIP=new Set(['.pytest_cache','.venv','tests']);
// bytecode is never part of the closure: a __pycache__ directory or a .pyc/.pyo under a tool root fails closed (Python could run it instead of the pinned source)
const BYTECODE=/\.py[co]$/;
/** Re-hash the tool tree the launcher is about to run against the pinned closure: same walk rules as the source exporter, so an extra, missing or changed file
 * (or any symlink) under a tool root is a mismatch. Returns the mismatching paths (empty = the tree is exactly the pinned closure). */
export async function verifyPortableTree(p,sourceRoot){
 validatePortableTools(p);
 const root=await realpath(resolve(sourceRoot)),seen=new Map(),problems=[];
 const walk=async(relative)=>{
  const path=join(root,relative);let entries;
  try{if((await lstat(path)).isSymbolicLink()||await realpath(path)!==path)return void problems.push(`${relative}:SYMLINK`);entries=await readdir(path,{withFileTypes:true});}catch{return void problems.push(`${relative}:MISSING`);}
  for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   if(SKIP.has(e.name))continue;const r=`${relative}/${e.name}`;
   if(e.isSymbolicLink())problems.push(`${r}:SYMLINK`);else if(e.name==='__pycache__'||BYTECODE.test(e.name))problems.push(`${r}:BYTECODE`);else if(e.isDirectory())await walk(r);else if(e.isFile())seen.set(r,digest(await readFile(join(root,r))));
  }
 };
 for(const r of p.roots)await walk(r);
 for(const f of p.closure.files){const actual=seen.get(f.path);if(actual===undefined)problems.push(`${f.path}:MISSING`);else if(actual!==f.sha256)problems.push(`${f.path}:CHANGED`);seen.delete(f.path);}
 for(const extra of seen.keys())problems.push(`${extra}:UNLISTED`);
 return problems;
}
/** The manifest of the pinned, installed artifact (already hash-checked by checkedRuntime). */
export async function installedManifest(root,lock){return validateManifest(JSON.parse(await readFile(join(root,'.runtime',lock.artifactSha256,'manifest.json'),'utf8')));}
const lockOf=(m)=>({dirty:false,packageVersion:m.packageVersion,toolchain:{node:m.toolchain.node},sourceCommit:m.sourceCommit,schemaHash:m.schemaHash,protocolMajor:m.protocolMajor,...(m.protocolMajors?{protocolMajors:m.protocolMajors}:{}),nodeMajor:m.nodeMajor,artifactSha256:m.artifactSha256,entrypoint:m.entrypoint,...(m.portableSimulationTools?{portableToolsDigest:m.portableSimulationTools.closure.digest}:{})});
/** Write JSON through a temporary sibling and one rename: a crash leaves the old file or the new one, never half of one. */
async function writeAtomic(file,value){const tmp=join(resolve(file,'..'),`.${randomUUID()}.tmp`);try{await writeFile(tmp,JSON.stringify(value,null,2)+'\n');await rename(tmp,file);}finally{await rm(tmp,{force:true});}}
async function writeLock(root,lock){await mkdir(join(root,'config'),{recursive:true});await writeAtomic(join(root,'config','source-runtime.lock.json'),lock);}
const intact=async(directory,sha)=>{try{return digest(await readFile(join(directory,'runtime.mjs')))===sha;}catch{return false;}};
const readLock=async(root)=>{try{return JSON.parse(await readFile(join(root,'config/source-runtime.lock.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function readSchemas(input,manifest){
 const schemas=[];
 if((manifest.protocolMajors??[manifest.protocolMajor]).includes(2)&&(!Array.isArray(manifest.schemas)||!manifest.schemas.length))throw new Error('SCHEMA_SET_MISMATCH');
 if(manifest.schemas){
  const names=[...manifest.schemas].sort(),hash=createHash('sha256');
  if(JSON.stringify((await readdir(join(input,'schemas'))).filter(n=>n.endsWith('.json')).sort())!==JSON.stringify(names))throw new Error('SCHEMA_SET_MISMATCH');
  for(const name of names){const b=await readFile(join(input,'schemas',name));hash.update(name+'\n').update(b);schemas.push([name,b]);}
  if(hash.digest('hex')!==manifest.schemaHash)throw new Error('SCHEMA_HASH_MISMATCH');
 }
 return schemas;
}
/** One transaction: manifest/protocol check, runtime hash, contract schemas re-hashed against the manifest, staged content-addressed copy, then one atomic lock rename.
 * Any failure leaves the current lock and installed artifacts untouched. The previous lock is kept in .runtime/rollback.lock.json (its artifact stays installed). */
export async function installRuntime(from,destination) {
 const input=resolve(from),root=resolve(destination);
 if((await stat(join(input,'manifest.json'))).size>RUNTIME_MANIFEST_MAX_BYTES) throw new Error('INVALID_RUNTIME_MANIFEST');
 const manifest=validateManifest(JSON.parse(await readFile(join(input,'manifest.json'),'utf8')));
 if((await stat(join(input,'runtime.mjs'))).size>64*1024*1024) throw new Error('ARTIFACT_TOO_LARGE');
 const bytes=await readFile(join(input,'runtime.mjs'));
 if(digest(bytes)!==manifest.artifactSha256)throw new Error('ARTIFACT_HASH_MISMATCH');
 auditBundle(bytes.toString('utf8'));
 const schemas=await readSchemas(input,manifest);
 const runtimes=join(root,'.runtime'),directory=join(runtimes,manifest.artifactSha256),staging=join(runtimes,`.staging-${randomUUID()}`);
 // an installed, verified copy of the same SHA stays where it is: removing it before the rename would leave the lock pointing at nothing
 if(!await intact(directory,manifest.artifactSha256)){
 await mkdir(join(staging,'schemas'),{recursive:true});
 try{
  await writeFile(join(staging,'runtime.mjs'),bytes);
  await writeFile(join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const [name,b] of schemas)await writeFile(join(staging,'schemas',name),b);
  await rm(directory,{recursive:true,force:true});
  await rename(staging,directory);
 }finally{await rm(staging,{recursive:true,force:true});}
 }else await checkedInstalled(root,lockOf(manifest));
 const previous=await readLock(root),lock=lockOf(manifest);
 await writeLock(root,lock);
 // the rollback record is written only once the new lock is in place, and atomically
 if(previous&&previous.artifactSha256!==lock.artifactSha256)await writeAtomic(join(runtimes,'rollback.lock.json'),previous);
 return lock;
}
/** Re-select the previously pinned artifact (swap with the current one) after verifying it is still installed intact. */
export async function rollbackRuntime(destination) {
 const root=resolve(destination),file=join(root,'.runtime/rollback.lock.json');
 const previous=validateManifest(JSON.parse(await readFile(file,'utf8').catch(()=>{throw new Error('NO_ROLLBACK_RUNTIME');})));
 await checkedInstalled(root,previous);
 const current=await readLock(root);
 await writeLock(root,previous);
 if(current)await writeAtomic(file,current);
 return previous;
}
async function checkedInstalled(root,lock){
 const directory=join(root,'.runtime',lock.artifactSha256),file=join(directory,lock.entrypoint);
 const bytes=await readFile(file);
 if(digest(bytes)!==lock.artifactSha256)throw new Error('ARTIFACT_HASH_MISMATCH');
 const manifest=validateManifest(JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')));
 if(JSON.stringify(lock.protocolMajors??[lock.protocolMajor])!==JSON.stringify(manifest.protocolMajors??[manifest.protocolMajor]))throw new Error('INSTALLED_MANIFEST_PIN_MISMATCH');
 for(const [key,value] of Object.entries(lockOf(manifest)))if(JSON.stringify(lock[key])!==JSON.stringify(value))throw new Error('INSTALLED_MANIFEST_PIN_MISMATCH');
 await readSchemas(directory,manifest);
 return file;
}
export async function checkedRuntime(root) {
 const lock=validateManifest(JSON.parse(await readFile(join(root,'config/source-runtime.lock.json'),'utf8')));
 return {lock,file:await checkedInstalled(root,lock)};
}
