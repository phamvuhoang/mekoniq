// Historical L01 policy is unchanged; current campaigns use their own explicit deadline policy.
import {runOwnedProcess} from './owned-process.mjs';
export async function runProbeCommand(command,args,options){
 if(!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>1800000)throw Error('PROBE_DEADLINE_REQUIRED');
 return runOwnedProcess(command,args,options);
}
