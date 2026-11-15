import {expect,test} from 'vitest';
import {readFile,writeFile,rm,symlink,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeHandoffFixture,digest} from '../fixtures/native-handoff';
import {validateNativeHandoff,exportNativeHandoff,readHandoffFile} from '../../packages/lab-runtime/src/v2/sil/native-handoff';
// Shared production closure inventory.
import {nativeToolClosure} from '../../scripts/native-sim/tool-identity.mjs';
const attr='robotics/manipulation/vendor-source/.gitattributes';
async function currentPuma(){
 const f=await nativeHandoffFixture('native_apt'),closure=nativeToolClosure(process.cwd());
 for(const entry of closure.files as {path:string;bytes:number;sha256:string}[]){
  const existing=Object.entries(f.manifest.refs).flatMap(([role,refs])=>refs.map(ref=>({role,ref}))).find(({role,ref})=>(role==='schema'?'packages/contracts/schemas/'+ref.sourcePath:ref.sourcePath)===entry.path);
  if(existing){expect(existing.ref).toMatchObject({sha256:entry.sha256,bytes:entry.bytes});continue;}
  await f.put('tool','native-source/'+entry.path,await readFile(entry.path),entry.path);
 }
 await f.reseal();const runtimeRef=f.manifest.refs.runtimeManifest[0],runtime=JSON.parse(await readFile(join(f.root,runtimeRef.path),'utf8'));runtime.nativeTools=closure;f.manifest.subject.nativeClosureHash=closure.digest;const bytes=JSON.stringify(runtime);await writeFile(join(f.root,runtimeRef.path),bytes);Object.assign(runtimeRef,{sha256:digest(bytes),bytes:Buffer.byteLength(bytes)});await writeFile(join(f.root,'manifest.json'),JSON.stringify(f.manifest));
 return {...f,closure,attribute:f.manifest.refs.tool.find(r=>r.sourcePath===attr)!};
}
test('current PUMA complete native closure prepares and exports every actual member including vendor gitattributes',async()=>{
 const f=await currentPuma(),out=f.root+'-export';try{
  expect(f.closure.files).toContainEqual({path:attr,bytes:99,sha256:'37991456045b2f43a9a624e14f2af90c33645175a0a3eabc14b19c4da83359fc'});
  expect(await validateNativeHandoff(f.root,f.manifest)).toMatchObject({prepared:true,nativeReady:false});expect(await exportNativeHandoff(f.root,out)).toMatchObject({prepared:true,nativeReady:false});
  for(const entry of f.closure.files as {path:string;bytes:number;sha256:string}[]){const refs=Object.entries(f.manifest.refs).flatMap(([role,rs])=>rs.map(ref=>({role,ref}))),ref=refs.find(({role,ref})=>(role==='schema'?'packages/contracts/schemas/'+ref.sourcePath:ref.sourcePath)===entry.path)!.ref;const bytes=await readFile(join(out,ref.path));expect(bytes.length).toBe(entry.bytes);expect(digest(bytes)).toBe(entry.sha256);}
 }finally{await rm(f.root,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});
test('the exact gitattributes leaf is admitted directly while its source identity stays bound',async()=>{
 const f=await currentPuma();try{const bytes=await readFile(join(f.root,f.attribute.path));await writeFile(join(f.root,'.gitattributes'),bytes);f.attribute.path='.gitattributes';expect(await validateNativeHandoff(f.root,f.manifest)).toMatchObject({prepared:true,nativeReady:false});}finally{await rm(f.root,{recursive:true,force:true});}
});
test.each(['remove','corrupt','symlink','secret','collision'])('admitted current PUMA gitattributes still refuses %s',async kind=>{
 const f=await currentPuma();try{expect((await validateNativeHandoff(f.root,f.manifest)).prepared).toBe(true);const path=join(f.root,f.attribute.path);
  if(kind==='remove')await rm(path);if(kind==='corrupt')await writeFile(path,'changed');if(kind==='symlink'){await rm(path);await symlink(join(process.cwd(),attr),path);}if(kind==='secret'){const bytes='-----BEGIN PRIVATE KEY-----';await writeFile(path,bytes);Object.assign(f.attribute,{sha256:digest(bytes),bytes:Buffer.byteLength(bytes)});}if(kind==='collision')f.manifest.refs.archive=[{...f.attribute}];
  const result=await validateNativeHandoff(f.root,f.manifest);expect(result.prepared).toBe(false);if(kind==='secret')expect(result.issues.map(i=>i.code)).toContain('SECRET_CONTENT_FORBIDDEN');if(kind==='collision')expect(result.issues.map(i=>i.code)).toContain('REF_PATH_COLLISION');if(kind==='symlink')expect(result.issues.map(i=>i.code)).toContain('REF_SYMLINK');if(kind==='corrupt')expect(result.issues.map(i=>i.code)).toContain('REF_HASH_MISMATCH');if(kind==='remove')expect(result.issues.some(i=>i.code.startsWith('ENOENT:'))).toBe(true);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test.each(['path','sourcePath'] as const)('schema %s retains hidden-directory, control and length refusals on coherent current PUMA',async field=>{
 const f=await currentPuma();try{expect((await validateNativeHandoff(f.root,f.manifest)).prepared).toBe(true);const original=f.attribute[field];
  for(const bad of ['.git/config','.env','x/.hidden','x/.gitattributes/child','normal\n','x/.gitattributes\n','x'.repeat(241)]){f.attribute[field]=bad;expect((await validateNativeHandoff(f.root,f.manifest)).issues.some(i=>i.code==='HANDOFF_SCHEMA_INVALID'&&i.path.endsWith('/'+field)),bad).toBe(true);}f.attribute[field]=original;
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test.each(['.git/config','.env','normal/.hidden','normal/.gitattributes/child','../normal','/normal','normal/../x','normal//x','normal\\x','normal\u0000x','normal\n','.gitattributes\n','normal/.gitattributes\n'])('handoff paths match the complete safe string and refuse %j',async path=>{
 const root=await mkdtemp(join(tmpdir(),'handoff-path-'));try{await writeFile(join(root,'normal\n'),'must not read');await expect(readHandoffFile(root,path)).rejects.toThrow('REF_PATH_FORBIDDEN');}finally{await rm(root,{recursive:true,force:true});}
});
