import {afterEach,expect,test} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertRecordableIdentity,assertRecordedRegressionIdentity,assertStableRecording,captureRegressionIdentity,type RegressionIdentity,type RegressionIdentityRecord} from '../support/regression-identity';
const roots:string[]=[];
const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const write=(repo:string,file:string,value:string)=>writeFileSync(join(repo,file),value);
const commit=(repo:string)=>{git(repo,'add','.');git(repo,'commit','-qm','fixture');};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'regression-identity-'));roots.push(root);const source=join(root,'source'),lab=join(root,'lab');
 for(const repo of [source,lab]){
  mkdirSync(join(repo,'src'),{recursive:true});mkdirSync(join(repo,'docs'),{recursive:true});mkdirSync(join(repo,'config'),{recursive:true});
  git(repo,'init','-q');git(repo,'config','user.name','Identity fixture');git(repo,'config','user.email','fixture@example.invalid');
  write(repo,'src/main.ts','export const value=1;\n');write(repo,'README.md','Documentation\n');write(repo,'docs/evidence.json','{}\n');
  write(repo,'config/source-runtime.lock.json','{"sourceCommit":"pinned"}\n');write(repo,'config/simulation-compatibility.json','{}\n');commit(repo);
 }
 return {source,lab,start:captureRegressionIdentity(source,lab)};
}
const recording=(start:RegressionIdentity):RegressionIdentityRecord=>({revisions:{source:start.source.commit,sourceDirty:false,lab:start.lab.commit,labDirty:false},identity:{schema:'regression-identity/1',start:structuredClone(start),end:structuredClone(start),checkpoints:[{id:'suite:before',identity:structuredClone(start)},{id:'suite:after',identity:structuredClone(start)}]},commands:[{id:'suite'}]});
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
test('recording captures a Git tree larger than 1 MiB without losing entries at its end',()=>{
 const f=fixture(),files=Array.from({length:5000},(_,i)=>`docs/${String(i).padStart(5,'0')}-${'e'.repeat(170)}.json`);
 for(const path of files)write(f.source,path,'{}\n');commit(f.source);
 const listing=execFileSync('git',['ls-tree','-r','-z','HEAD'],{cwd:f.source,maxBuffer:16*1024*1024});
 expect(listing.byteLength).toBeGreaterThan(1024*1024);
 const before=captureRegressionIdentity(f.source,f.lab);
 expect(()=>assertRecordableIdentity(before)).not.toThrow();expect(before.source.codeHash).toMatch(/^[a-f0-9]{64}$/);
 write(f.source,files.at(-1)!,'{"changed":true}\n');commit(f.source);
 const after=captureRegressionIdentity(f.source,f.lab);
 expect(after.source.codeHash).not.toBe(before.source.codeHash);
});
test.each(['source','lab'] as const)('recording rejects dirty %s code before executing suites',repo=>{
 const f=fixture();write(f[repo],'src/main.ts','changed');expect(()=>assertRecordableIdentity(captureRegressionIdentity(f.source,f.lab))).toThrow(/CODE_DIRTY/);
});
test('staged code changes remain dirty when the working copy has been restored to HEAD',()=>{
 const f=fixture();write(f.lab,'src/main.ts','changed');git(f.lab,'add','src/main.ts');write(f.lab,'src/main.ts','export const value=1;\n');
 expect(()=>assertRecordableIdentity(captureRegressionIdentity(f.source,f.lab))).toThrow('LAB_CODE_DIRTY');
});
test('the recorder rejects a clean mid-run revision change, including documentation-only commits',()=>{
 const f=fixture();write(f.lab,'docs/evidence.json','{"new":true}');commit(f.lab);
 expect(()=>assertStableRecording(f.start,captureRegressionIdentity(f.source,f.lab))).toThrow('LAB_REVISION_CHANGED_DURING_RECORDING');
});
test('command checkpoints reject sampled code changes even if the final tree is restored',()=>{
 const f=fixture(),record=recording(f.start);write(f.lab,'src/main.ts','changed');record.identity.checkpoints[1]!.identity=captureRegressionIdentity(f.source,f.lab);
 write(f.lab,'src/main.ts','export const value=1;\n');expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).toThrow('LAB_CODE_DIRTY');
});
test('documentation/evidence outputs can change during recording and documentation-only Lab HEADs remain acceptable later',()=>{
 const f=fixture(),record=recording(f.start);
 write(f.lab,'docs/evidence.json','{"fresh":true}');write(f.lab,'README.md','Updated documentation');write(f.lab,'config/simulation-compatibility.json','{"updated":true}');
 expect(()=>assertStableRecording(f.start,captureRegressionIdentity(f.source,f.lab))).not.toThrow();
 expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).not.toThrow();commit(f.lab);
 expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).not.toThrow();
});
test('stored results are stale after a clean Lab code commit',()=>{
 const f=fixture(),record=recording(f.start);write(f.lab,'src/main.ts','changed');commit(f.lab);
 expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).toThrow('LAB_CODE_STALE');
});
test('the pinned source runtime lock is code identity, not mutable evidence metadata',()=>{
 const f=fixture(),record=recording(f.start);write(f.lab,'config/source-runtime.lock.json','{"sourceCommit":"different"}');
 expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).toThrow('LAB_CODE_DIRTY');commit(f.lab);
 expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).toThrow('LAB_CODE_STALE');
});
test('source must stay fully clean and at the exact recorded HEAD even for documentation changes',()=>{
 const f=fixture(),record=recording(f.start);write(f.source,'README.md','Changed documentation');
 expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).toThrow('SOURCE_CODE_DIRTY');commit(f.source);
 expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).toThrow('SOURCE_REVISION_STALE');
});
test('recorded dirty Lab state and incomplete command checkpoints cannot be accepted',()=>{
 const f=fixture(),record=recording(f.start);record.revisions.labDirty=true;
 expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).toThrow('RECORDED_CODE_DIRTY');
 record.revisions.labDirty=false;record.identity.checkpoints.pop();expect(()=>assertRecordedRegressionIdentity(record,f.source,f.lab)).toThrow('REGRESSION_CHECKPOINT_MISSING');
});
// One repository (apps/lab): the same code must hash the same as the two standalone repositories did, so records compare across the merge.
function embedded(){
 const f=fixture(),root=mkdtempSync(join(tmpdir(),'regression-identity-one-'));roots.push(root);
 execFileSync('cp',['-R',`${f.source}/.`,root]);rmSync(join(root,'.git'),{recursive:true,force:true});mkdirSync(join(root,'apps/lab'),{recursive:true});execFileSync('cp',['-R',`${f.lab}/.`,join(root,'apps/lab')]);rmSync(join(root,'apps/lab/.git'),{recursive:true,force:true});
 git(root,'init','-q');git(root,'config','user.name','Identity fixture');git(root,'config','user.email','fixture@example.invalid');commit(root);
 return {...f,root,lab:join(root,'apps/lab')};
}
test('merged repository: source and Lab hashes equal the standalone ones, and each side is dirty on its own paths',()=>{
 const f=embedded(),one=captureRegressionIdentity(f.root,f.lab);
 expect(one.source.codeHash).toBe(f.start.source.codeHash);expect(one.lab.codeHash).toBe(f.start.lab.codeHash);
 expect(()=>assertRecordableIdentity(one)).not.toThrow();
 write(f.root,'src/main.ts','changed');expect(()=>assertRecordableIdentity(captureRegressionIdentity(f.root,f.lab))).toThrow('SOURCE_CODE_DIRTY');
 write(f.root,'src/main.ts','export const value=1;\n');write(f.lab,'src/main.ts','changed');
 const dirtyLab=captureRegressionIdentity(f.root,f.lab);expect(dirtyLab.lab.dirtyCodePaths).toEqual(['src/main.ts']);expect(dirtyLab.source.dirtyCodePaths).toEqual([]);
 write(f.lab,'docs/evidence.json','{"fresh":true}');write(f.lab,'src/main.ts','export const value=1;\n');
 expect(()=>assertRecordableIdentity(captureRegressionIdentity(f.root,f.lab))).not.toThrow();
});
test('merged repository: a recording validates, a Lab-only code commit makes it stale on the Lab side only',()=>{
 const f=embedded(),start=captureRegressionIdentity(f.root,f.lab),record=recording(start);
 expect(()=>assertRecordedRegressionIdentity(record,f.root,f.lab)).not.toThrow();
 write(f.lab,'src/main.ts','changed');commit(f.root);
 expect(()=>assertRecordedRegressionIdentity(record,f.root,f.lab)).toThrow('LAB_CODE_STALE');
});
