import {expect,test} from 'vitest';
import {resourceDecision} from '../../scripts/native-sim/host-preflight.mjs';
const gib=1024**3;
test('VM and system budgets cannot spend the same free bytes twice',()=>{
 expect(resourceDecision({systemFreeBytes:125*gib,vmFreeBytes:125*gib,sameVolume:true,memoryBytes:16*gib})).toMatchObject({canProvision:false,runConcurrently:false,blockers:['VM_STORAGE_INSUFFICIENT']});
 expect(resourceDecision({systemFreeBytes:25*gib,vmFreeBytes:125*gib,sameVolume:false,memoryBytes:16*gib})).toMatchObject({canProvision:true,runConcurrently:false});
 expect(resourceDecision({systemFreeBytes:5*gib,vmFreeBytes:125*gib,sameVolume:false,memoryBytes:32*gib})).toMatchObject({canProvision:false,blockers:['SYSTEM_RESERVE_INSUFFICIENT']});
});
test('a file is never a usable VM destination even when its filesystem has space',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{hostPreflight}=await import('../../scripts/native-sim/host-preflight.mjs');const dir=await mkdtemp(join(tmpdir(),'vm-preflight-'));
 try{const file=join(dir,'file');await writeFile(file,'x');expect(await hostPreflight(file)).toMatchObject({status:'blocked_external',blockers:expect.arrayContaining(['VM_ROOT_NOT_DIRECTORY'])});}finally{await rm(dir,{recursive:true,force:true});}
});
