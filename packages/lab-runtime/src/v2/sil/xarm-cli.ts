// Server-owned native motion probe. This is separate from the AMR/coffee scenario admission surface.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile,readdir,open,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createXarmSimProvider,xarmProgramHash,type XarmServerConfig} from './xarm-provider';
import profile from '../../../../../robotics/manipulation/profiles/xarm6-jazzy-sim.json';
import {hashJson} from '../hash';
interface CaseConfig {sourceRoot:string;out:string;mode:'X1'|'X2';environmentProfile:XarmServerConfig['environmentProfile'];nativeCase:'nominal'|'cancel'|'restart';python?:string}
export async function runXarmCase(c:CaseConfig){
 if(!['X1','X2'].includes(c.mode)||!['nominal','cancel','restart'].includes(c.nativeCase))throw Error('XARM_CASE_INVALID');
 await mkdir(c.out,{recursive:false});
 const git=async(...args:string[])=>(await promisify(execFile)('git',args,{cwd:c.sourceRoot,timeout:10000})).stdout.trim();
 const sourceCommit=await git('rev-parse','HEAD'),dirty=Boolean(await git('status','--porcelain','--untracked-files=all'));
 const config:XarmServerConfig={sourceRoot:c.sourceRoot,runDirectory:c.out,runId:'xarm-'+c.mode+'-'+c.nativeCase,cellId:'native-motion-cell',deviceId:'xarm6-sim',mode:c.mode,environmentProfile:c.environmentProfile,...c.python?{python:c.python}:{}};
 const manifest={schemaVersion:1,sourceCommit,dirty,subjectProfileId:c.environmentProfile,targetProfileId:profile.id,requestedProfile:profile.requestedProfile,profileHash:hashJson(profile),mode:c.mode,nativeCase:c.nativeCase,evidenceKind:profile.modes[c.mode].evidenceKind,checkerScope:'source_snapshot_not_git_graph_attestation',motion:{status:'not_run',result:'blocked_external',reason:''},contact:{status:'not_run',result:'blocked_external',reason:profile.contact.reason,trialsExecuted:0,trialsRequired:10},accepted:false,dynamics:'not_calibrated',artifacts:[] as {path:string;sha256:string}[]};
 let provider:Awaited<ReturnType<typeof createXarmSimProvider>>|undefined;
 const lifecycle={phase:'provider_start_requested',startup:'unknown',command:'not_attempted',shutdownErrors:[] as string[]};
 const durable=async(name:string,value:unknown)=>{const path=join(c.out,name),tmp=path+'.tmp';const fd=await open(tmp,'w');try{await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}await rename(tmp,path);const dir=await open(c.out,'r');try{await dir.sync();}finally{await dir.close();}};
 const persistLifecycle=()=>durable('source-lifecycle.json',lifecycle);
 const failure=(e:unknown)=>{const reason=(e as Error).message;const preflight=lifecycle.phase==='provider_start_requested'&&reason.startsWith('XARM_NATIVE_NOT_QUALIFIED:');if(preflight){lifecycle.startup='preflight_refused';lifecycle.phase='preflight_refused';}return {status:preflight?'not_run':'executed',result:preflight?'blocked_external':'fail',reason};};
 await persistLifecycle();
 try{
  provider=await createXarmSimProvider(config);manifest.evidenceKind=provider.evidenceKind;lifecycle.startup='ready';lifecycle.phase='provider_ready';await persistLifecycle();
  const command={commandId:'motion-probe-1',runId:config.runId,deviceId:config.deviceId,controlEpoch:1,expiresAt:new Date(Date.now()+60000).toISOString(),recipeRevision:null,programRef:{id:'motion-probe',hash:xarmProgramHash('motion-probe')},capability:'start_job' as const,payloadHash:hashJson({jobId:'native-motion-probe'}),payload:{jobId:'native-motion-probe'}};
  await durable('source-command.json',{command,ack:null});lifecycle.phase='command_attempted';lifecycle.command='unknown';await persistLifecycle();
  const ack=await provider.adapter.execute(command);await durable('source-command.json',{command,ack});lifecycle.command=ack.unknown?'unknown':ack.accepted?'accepted':'rejected';await persistLifecycle();
  if(!ack.accepted)throw Error(ack.reason??'MOTION_NOT_ACCEPTED');
  if(c.nativeCase!=='nominal'){await new Promise(r=>setTimeout(r,200));const cancel=await provider.adapter.cancel(command.commandId);await writeFile(join(c.out,'source-cancel.json'),JSON.stringify(cancel));if(!cancel.acknowledged||cancel.unknown)throw Error('CANCEL_UNKNOWN');}
  const end=Date.now()+65000;let state=await provider.adapter.reconcile(command.commandId);
  while(['accepted','running'].includes(state.status)&&Date.now()<end){await new Promise(r=>setTimeout(r,100));state=await provider.adapter.reconcile(command.commandId);}
  await writeFile(join(c.out,'source-outcome.json'),JSON.stringify(state,null,2));
  if(c.nativeCase==='nominal'&&state.status!=='completed')throw Error('MOTION_OUTCOME_'+state.status);
  if(c.nativeCase!=='nominal'&&(state.status!=='failed'||state.evidence.terminalReason!=='canceled'))throw Error('STOP_OUTCOME_'+state.status);
  if(c.nativeCase==='restart'){
   await provider.close();provider=undefined;let refused=false;try{await createXarmSimProvider(config);}catch(e){refused=(e as Error).message==='XARM_RESTART_RECONCILE_REQUIRED';}if(!refused)throw Error('RESTART_NOT_REFUSED');
  }
  manifest.motion={status:'executed',result:'pass',reason:c.nativeCase==='nominal'?'ACTUAL_TARGET_AND_RESULT_OBSERVED':'TERMINAL_STOP_OBSERVED_NO_RESEND'};
 }catch(e){manifest.motion=failure(e);}
 finally{try{await provider?.close();}catch(e){lifecycle.shutdownErrors.push((e as Error).message);if(manifest.motion.result==='pass')manifest.motion=failure(e);}await persistLifecycle();}
 for(const name of await readdir(c.out)){if(!/\.(json|jsonl|urdf|log)$/.test(name))continue;const bytes=await readFile(join(c.out,name));manifest.artifacts.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex')});}
 for(const name of await readdir(join(c.out,'verified-bag')).catch(()=>[])){const path='verified-bag/'+name;manifest.artifacts.push({path,sha256:createHash('sha256').update(await readFile(join(c.out,path))).digest('hex')});}
 await writeFile(join(c.out,'run-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
}
export async function xarmMain(argv:string[]){
 const options:Record<string,string>={};for(let i=0;i<argv.length;i+=2){const key=argv[i]!,value=argv[i+1];if(!['--out','--mode','--environment-profile','--case'].includes(key)||!value||value.startsWith('--')||options[key])throw Error('XARM_CLI_INVALID');options[key]=value;}
 if(!options['--out']||!['X1','X2'].includes(options['--mode']??'')||!['engineering-amd64','engineering-arm64'].includes(options['--environment-profile']??''))throw Error('XARM_CLI_INVALID');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));const result=await runXarmCase({sourceRoot:root,out:resolve(options['--out']),mode:options['--mode'] as 'X1'|'X2',environmentProfile:options['--environment-profile'] as XarmServerConfig['environmentProfile'],nativeCase:(options['--case']??'nominal') as CaseConfig['nativeCase']});
 console.log(JSON.stringify(result));return result.motion.result==='pass'?0:result.motion.status==='not_run'?2:1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))xarmMain(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(e=>{console.error((e as Error).message);process.exitCode=2;});
