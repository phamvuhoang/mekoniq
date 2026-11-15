import {runOwnedProcess} from './owned-process.mjs';
// R90: admitted 6000s cell case plus 100s orchestration, never a resumed uncertain case.
export async function runR2bCaseCommand(command,args,options){
 if(!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>6100000)throw Error('R2B_CASE_DEADLINE_REQUIRED');
 return runOwnedProcess(command,args,options);
}
