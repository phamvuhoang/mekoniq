#!/usr/bin/env node
// Read-only UTM host preflight. This never installs apps, downloads images or removes files.
import {constants} from 'node:fs';
import {statfs,stat,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {cpus,totalmem,platform,arch} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function resourceDecision({systemFreeBytes,vmFreeBytes,sameVolume,memoryBytes}){
 const gib=1024**3,blockers=[];
 if(systemFreeBytes<20*gib)blockers.push('SYSTEM_RESERVE_INSUFFICIENT');
 if(vmFreeBytes<(sameVolume?140:120)*gib)blockers.push('VM_STORAGE_INSUFFICIENT');
 if(memoryBytes<12*gib)blockers.push('HOST_MEMORY_INSUFFICIENT');
 return {canProvision:blockers.length===0,blockers,runConcurrently:memoryBytes>=32*gib,vmBudgetGiB:120,systemReserveGiB:20};
}
export async function hostPreflight(vmRoot=process.cwd()){
 const path=resolve(vmRoot),[vm,system,vs,ss]=await Promise.all([statfs(path),statfs('/'),stat(path),stat('/')]);
 const memoryBytes=totalmem(),storage={systemFreeBytes:system.bavail*system.bsize,vmFreeBytes:vm.bavail*vm.bsize,sameVolume:vs.dev===ss.dev},decision=resourceDecision({...storage,memoryBytes});
 let installed=false;try{await access('/Applications/UTM.app');installed=true;}catch{/* missing app */}
 let macOS=null;if(platform()==='darwin')macOS=execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8',timeout:5000}).trim();
 const destination=[];if(!vs.isDirectory())destination.push('VM_ROOT_NOT_DIRECTORY');else{try{await access(path,constants.W_OK|constants.X_OK);}catch{destination.push('VM_ROOT_NOT_WRITABLE');}}
 const blockers=[...decision.blockers,...destination,...platform()==='darwin'?[]:['HOST_NOT_MACOS']];
 return {schemaVersion:1,taskId:'N01',kind:'host_preflight',recordedAt:new Date().toISOString(),host:{platform:platform(),architecture:arch(),cpuCores:cpus().length,memoryBytes,macOS},storage:{...storage,vmRoot:path,...decision,canProvision:decision.canProvision&&!destination.length&&platform()==='darwin'},utm:{installed},execution:'not_run',result:'not_run',status:blockers.length?'blocked_external':'ready_to_provision',blockers,actions:{imagesDownloaded:false,vmsCreated:false,vmsStarted:false,userDataDeleted:false},claims:{nativeSimulationVerified:false,hardwareValidated:false,productionReady:false}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--vm-root'))throw new Error('usage: host-preflight.mjs [--vm-root EXISTING_DIRECTORY]');
 const report=await hostPreflight(args[1]);console.log(JSON.stringify(report,null,2));process.exitCode=report.blockers.length?2:0;
}
