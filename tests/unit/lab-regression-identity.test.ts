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
