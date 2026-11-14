import {expect,test} from 'vitest';
import {mkdtemp,writeFile,readFile,mkdir,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
// @ts-expect-error CLI JavaScript boundary
import {installRuntime,checkedRuntime,rollbackRuntime} from '../../scripts/runtime-artifact.mjs';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'lab-artifact-test-'));const from=join(dir,'export');const dest=join(dir,'lab');await mkdir(from);await mkdir(dest);const js='export const testArtifact = true;\n';const manifest={sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64),protocolMajor:1,nodeMajor:24,dirty:false,packageVersion:'0.1.0',toolchain:{node:'v24.22.2'},entrypoint:'runtime.mjs',artifactSha256:digest(js)};await writeFile(join(from,'runtime.mjs'),js);await writeFile(join(from,'manifest.json'),JSON.stringify(manifest));return {dir,from,dest,js,manifest};}
test('installs only an integrity-checked runtime and pins identity',async()=>{const f=await fixture();try{await installRuntime(f.from,f.dest);expect(await readFile(join(f.dest,'.runtime',f.manifest.artifactSha256,'runtime.mjs'),'utf8')).toBe(f.js);expect(JSON.parse(await readFile(join(f.dest,'config/source-runtime.lock.json'),'utf8')).sourceCommit).toBe('a'.repeat(40));}finally{await rm(f.dir,{recursive:true,force:true});}});
test('tampered artifact cannot replace an installed runtime',async()=>{const f=await fixture();try{await mkdir(join(f.dest,'.runtime'));await writeFile(join(f.dest,'.runtime/runtime.mjs'),'known');await writeFile(join(f.from,'runtime.mjs'),'tampered');await expect(installRuntime(f.from,f.dest)).rejects.toThrow('ARTIFACT_HASH_MISMATCH');expect(await readFile(join(f.dest,'.runtime/runtime.mjs'),'utf8')).toBe('known');}finally{await rm(f.dir,{recursive:true,force:true});}});
test('entrypoint traversal rejected before filesystem writes',async()=>{const f=await fixture();try{await writeFile(join(f.from,'manifest.json'),JSON.stringify({...f.manifest,entrypoint:'../../secret'}));await expect(installRuntime(f.from,f.dest)).rejects.toThrow('INVALID_RUNTIME_MANIFEST');}finally{await rm(f.dir,{recursive:true,force:true});}});
test('refuses dirty source builds and preserves build provenance',async()=>{const f=await fixture();try{await writeFile(join(f.from,'manifest.json'),JSON.stringify({...f.manifest,dirty:true}));await expect(installRuntime(f.from,f.dest)).rejects.toThrow('DIRTY_SOURCE_ARTIFACT');await writeFile(join(f.from,'manifest.json'),JSON.stringify({...f.manifest,dirty:false,packageVersion:'0.1.0',toolchain:{node:'v24.22.2'}}));await installRuntime(f.from,f.dest);const lock=JSON.parse(await readFile(join(f.dest,'config/source-runtime.lock.json'),'utf8'));expect(lock).toMatchObject({dirty:false,packageVersion:'0.1.0',toolchain:{node:'v24.22.2'}});}finally{await rm(f.dir,{recursive:true,force:true});}});
test('installed schema tampering is rejected before launch or offline repackaging',async()=>{
 const f=await fixture();try{
  const name='proof.schema.json',schema='{"type":"object"}\n';await mkdir(join(f.from,'schemas'));await writeFile(join(f.from,'schemas',name),schema);
  const manifest={...f.manifest,protocolMajor:2,schemas:[name],schemaHash:digest(name+'\n'+schema)};
  await writeFile(join(f.from,'manifest.json'),JSON.stringify(manifest));
  const lock=await installRuntime(f.from,f.dest);await checkedRuntime(f.dest);
  await writeFile(join(f.dest,'.runtime',f.manifest.artifactSha256,'schemas',name),'{}');
  await expect(checkedRuntime(f.dest)).rejects.toThrow('SCHEMA_HASH_MISMATCH');
  await writeFile(join(f.dest,'.runtime/rollback.lock.json'),JSON.stringify(lock));
  await expect(rollbackRuntime(f.dest)).rejects.toThrow('SCHEMA_HASH_MISMATCH');
  const {schemas:_,...withoutSchemas}=manifest;
  await writeFile(join(f.dest,'.runtime',f.manifest.artifactSha256,'manifest.json'),JSON.stringify(withoutSchemas));
  await expect(checkedRuntime(f.dest)).rejects.toThrow('SCHEMA_SET_MISMATCH');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

const paddedManifest=(manifest:object,size:number)=>{const base={...manifest,note:''},empty=Buffer.byteLength(JSON.stringify(base)+'\n');return Buffer.from(JSON.stringify({...base,note:'x'.repeat(size-empty)})+'\n');};
test('valid runtime manifests above64KiB and at the256KiB boundary install with identical provenance',async()=>{
 for(const size of [65537,256*1024]){const f=await fixture();try{await writeFile(join(f.from,'manifest.json'),paddedManifest(f.manifest,size));const lock=await installRuntime(f.from,f.dest);expect(lock.sourceCommit).toBe(f.manifest.sourceCommit);expect(lock.artifactSha256).toBe(f.manifest.artifactSha256);await checkedRuntime(f.dest);}finally{await rm(f.dir,{recursive:true,force:true});}}
});
test('manifest cap+1 refuses before new destination or existing pin/artifact mutation',async()=>{
 const f=await fixture();try{await installRuntime(f.from,f.dest);const pin=await readFile(join(f.dest,'config/source-runtime.lock.json')),names=await readdir(join(f.dest,'.runtime'));await writeFile(join(f.from,'manifest.json'),paddedManifest(f.manifest,256*1024+1));await expect(installRuntime(f.from,f.dest)).rejects.toThrow('INVALID_RUNTIME_MANIFEST');expect(await readFile(join(f.dest,'config/source-runtime.lock.json'))).toEqual(pin);expect(await readdir(join(f.dest,'.runtime'))).toEqual(names);expect(await readFile(join(f.dest,'.runtime',f.manifest.artifactSha256,'runtime.mjs'),'utf8')).toBe(f.js);const absent=join(f.dir,'never-created');await expect(installRuntime(f.from,absent)).rejects.toThrow('INVALID_RUNTIME_MANIFEST');await expect(readdir(absent)).rejects.toMatchObject({code:'ENOENT'});}finally{await rm(f.dir,{recursive:true,force:true});}
});
