import {fileURLToPath} from 'node:url';
// Server-only fixed xArm motion provider. Never installed into a browser-selected contact/hardware set.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {open,writeFile,rename,realpath,readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {CellAdapter,CellCommand,CellReport,CellAcceptance,CellExecutionState} from '../../../../cell-adapters/src/contract';
import type {JsonObject} from '../../../../contracts/src/index';
import type {ArmStatusLike} from '../arm/session';
import type {BackendCapability} from '../capabilities';
import {hashJson} from '../hash';
import profile from '../../../../../robotics/manipulation/profiles/xarm6-jazzy-sim.json';
export {XARM_NATIVE_UNCONFIGURED as xarmNativeCapabilityValue} from '../capabilities';
export interface XarmServerConfig {sourceRoot:string;runDirectory:string;runId:string;deviceId:string;cellId:string;mode:'X1'|'X2';environmentProfile:'engineering-amd64'|'engineering-arm64';python?:string}
export interface XarmPort {request(method:'execute'|'query'|'cancel',args:Record<string,unknown>):Promise<unknown>;onSample(listener:(sample:Record<string,unknown>)=>void):()=>void;close():Promise<void>}
export function xarmNativeCapability():BackendCapability{return {id:'moveit_gazebo_arm',modes:['simulation'],accesses:['simulated'],installed:false,compatible:false,reachable:false,commissioned:true,reason:'XARM_NATIVE_NOT_QUALIFIED: motion and contact require separate native evidence'};}
export function xarmProgramHash(id:string){const program=profile.programs[id as keyof typeof profile.programs];if(!program)throw Error('PROGRAM_NOT_APPROVED');return hashJson(program);}
export function mapXarmJoints(names:string[],values:number[]){if(names.length!==values.length||new Set(names).size!==names.length||!values.every(Number.isFinite)||!profile.jointMap.every(j=>names.includes(j.native)))throw Error('JOINT_FEEDBACK_INVALID');return profile.jointMap.map(j=>values[names.indexOf(j.native)]!*j.sign+j.offsetRad);}
function configGuard(c:XarmServerConfig){
 const keys=['sourceRoot','runDirectory','runId','deviceId','cellId','mode','environmentProfile','python'];
 if(Object.keys(c).some(k=>!keys.includes(k))||!isAbsolute(c.sourceRoot)||!isAbsolute(c.runDirectory)||!['X1','X2'].includes(c.mode)||!['engineering-amd64','engineering-arm64'].includes(c.environmentProfile)||[c.runId,c.deviceId,c.cellId].some(s=>typeof s!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(s))||c.python!==undefined&&!isAbsolute(c.python))throw Error('XARM_CONFIG_INVALID');
}
async function nativePort(c:XarmServerConfig):Promise<XarmPort>{
 const root=join(c.sourceRoot,'robotics/manipulation');
 const child=spawn(c.python??'python3',['-m','native_xarm.worker','--directory',c.runDirectory,'--run-id',c.runId,'--mode',c.mode,'--environment-profile',c.environmentProfile],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:root+':'+join(c.sourceRoot,'robotics/simulation')},stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
 let failure:string|undefined,closed=false,next=0,ready:(()=>void)|undefined,failReady:((e:Error)=>void)|undefined;
 const listeners=new Set<(s:Record<string,unknown>)=>void>(),pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const fail=(reason:string)=>{failure??=reason;failReady?.(Error(failure));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(failure));}pending.clear();};
 let stderr='';child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-8000);});child.on('error',e=>fail(e.message));child.on('exit',code=>fail('XARM_WORKER_EXITED:'+code+':'+stderr));
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{const m=JSON.parse(line);if(m.kind==='ready'){ready?.();return;}if(m.kind==='sample'){for(const l of listeners)l(m.sample);return;}if(m.kind==='refusal'){fail('XARM_NATIVE_NOT_QUALIFIED:'+m.reasons.join(','));return;}const p=pending.get(m.id);if(!p)throw Error('XARM_REPLY_CORRELATION');pending.delete(m.id);clearTimeout(p.timer);p.resolve(m.result);}catch(e){fail((e as Error).message);}});
 const close=async()=>{if(closed)return;closed=true;fail('XARM_CLOSED');lines.close();child.stdin.end();if(child.pid){const kill=(signal:NodeJS.Signals)=>{try{process.kill(-child.pid!,signal);}catch{child.kill(signal);}};kill('SIGINT');if(child.exitCode===null)await new Promise<void>(r=>{const timer=setTimeout(r,35000);timer.unref();child.once('exit',()=>{clearTimeout(timer);r();});});if(child.exitCode===null)kill('SIGKILL');}};
 try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{fail('XARM_STARTUP_TIMEOUT');},120000);ready=()=>{clearTimeout(timer);resolve();};failReady=e=>{clearTimeout(timer);reject(e);};if(failure)failReady(Error(failure));});}catch(e){await close();throw e;}
 return {request(method,args){if(failure)return Promise.reject(Error(failure));if(pending.size)return Promise.reject(Error('XARM_ONE_FLIGHT'));const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>fail('XARM_REPLY_UNKNOWN'),10000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,args})+'\n');});},onSample(l){listeners.add(l);return()=>listeners.delete(l);},close};
}
export async function createXarmSimProvider(config:XarmServerConfig,double?:XarmPort){
 configGuard(config);const c=structuredClone(config);
 if(!double&&await realpath(c.sourceRoot)!==await realpath(fileURLToPath(new URL('../../../../../',import.meta.url))))throw Error('XARM_SOURCE_ROOT_MISMATCH');
 // Persist before connecting: a lost process or startup is never a resume permission for the same run.
 const journal=join(c.runDirectory,'source-xarm-journal.json');const fd=await open(journal,'wx').catch(()=>{throw Error('XARM_RESTART_RECONCILE_REQUIRED');});await fd.writeFile('{}');await fd.sync();await fd.close();
 const port=double??await nativePort(c),evidenceKind=double?'protocol_double':profile.modes[c.mode].evidenceKind;
 const listeners=new Set<(r:CellReport)=>void>();let fatal:string|null=null,inFlight=false,intentPending=false,seq=0;
 const receipts=new Map<string,{command:CellCommand;answer:CellAcceptance;status:CellExecutionState['status']}>();
 let writes=Promise.resolve();
 const persist=()=>{const bytes=JSON.stringify({schemaVersion:1,runId:c.runId,mode:c.mode,evidenceKind,fatal,receipts:[...receipts.values()]});writes=writes.then(async()=>{const tmp=journal+'.tmp';await writeFile(tmp,bytes);const f=await open(tmp,'r');await f.sync();await f.close();await rename(tmp,journal);const d=await open(c.runDirectory,'r');await d.sync();await d.close();});return writes;};
 const unknown=async(reason:string)=>{fatal??=reason;for(const r of receipts.values())if(!['completed','failed'].includes(r.status)){r.status='unknown';r.answer={accepted:false,unknown:true,reason:fatal};}await persist();};
 const request=async(method:'execute'|'cancel'|'query',args:Record<string,unknown>)=>{if(inFlight)throw Error('XARM_ONE_FLIGHT');inFlight=true;try{return await port.request(method,args) as Record<string,unknown>;}finally{inFlight=false;}};
 const adapter:CellAdapter={
  async describe(){return {cellId:c.cellId,deviceIds:[c.deviceId],adapter:'moveit_gazebo_arm',version:'1',model:profile.modelId,validation:'simulated',capabilities:['start_job','query_outcome']};},
  async execute(command){
   const prior=receipts.get(command.commandId);if(prior){if(!isDeepStrictEqual(prior.command,command))return {accepted:false,unknown:false,reason:'COMMAND_ID_CONFLICT'};return prior.answer;}
   if(fatal)return {accepted:false,unknown:true,reason:fatal};
   if(intentPending||inFlight||[...receipts.values()].some(r=>r.status==='accepted'||r.status==='running'))return {accepted:false,unknown:false,reason:'TRAJECTORY_BUSY'};
   if(command.runId!==c.runId||command.deviceId!==c.deviceId||command.controlEpoch!==1||!Number.isFinite(Date.parse(command.expiresAt))||Date.parse(command.expiresAt)<=Date.now()||command.capability!=='start_job'||command.programRef?.id!=='motion-probe'||command.programRef.hash!==xarmProgramHash('motion-probe'))return {accepted:false,unknown:false,reason:'PROGRAM_NOT_APPROVED'};
   const r={command:structuredClone(command),answer:{accepted:false,unknown:true} as CellAcceptance,status:'unknown' as CellExecutionState['status']};receipts.set(command.commandId,r);intentPending=true;
   try{await persist();if(fatal)throw Error(fatal);const result=await request('execute',{commandId:command.commandId,payloadHash:hashJson(command),points:profile.programs['motion-probe']});if(fatal)throw Error(fatal);if(typeof result.accepted!=='boolean'||typeof result.unknown!=='boolean'||result.unknown)throw Error('ACK_UNKNOWN');r.answer={accepted:result.accepted,unknown:false,...typeof result.reason==='string'?{reason:result.reason}:{}};r.status=result.accepted?'accepted':'failed';await persist();}catch(e){await unknown((e as Error).message);}finally{intentPending=false;}
   return r.answer;
  },
  async cancel(commandId){if(intentPending){await unknown('CANCEL_DURING_INTENT');return {acknowledged:false,unknown:true};}if(fatal)return {acknowledged:false,unknown:true};try{const r=await request('cancel',{commandId});if(r.acknowledged!==true||r.unknown!==false)throw Error('CANCEL_UNKNOWN');return {acknowledged:true,unknown:false};}catch(e){await unknown((e as Error).message);return {acknowledged:false,unknown:true};}},
  observe(l){listeners.add(l);return()=>listeners.delete(l);},
  async reconcile(commandId):Promise<CellExecutionState>{const r=receipts.get(commandId);if(!r)return {status:'not_found',evidence:{}};if(fatal||intentPending)return {status:'unknown',evidence:{reason:fatal??'INTENT_PENDING'}};
   try{const result=await request('query',{commandId});if(fatal)throw Error(fatal);if(!['accepted','running','completed','failed'].includes(String(result.status)))throw Error('RESULT_UNKNOWN');r.status=result.status as CellExecutionState['status'];await persist();if(fatal)throw Error(fatal);if(r.status==='completed'||r.status==='failed')for(const l of listeners)l({deviceId:c.deviceId,bootId:c.runId,seq:String(++seq),observedAt:new Date().toISOString(),observation:{schemaVersion:2,commandId,deviceId:c.deviceId,controlEpoch:1,payloadHash:r.command.payloadHash,bootId:c.runId,seq:String(seq),result:r.status,observedAt:null,reasonCodes:[]},evidence:{source:evidenceKind}});return {status:r.status,evidence:{...typeof result.evidence==='object'&&result.evidence!==null&&!Array.isArray(result.evidence)?result.evidence as JsonObject:{},source:evidenceKind}};}catch(e){await unknown((e as Error).message);return {status:'unknown',evidence:{reason:fatal!}};}
  },
 };
 return {adapter,evidenceKind,profileId:profile.id,contact:{available:false,reason:profile.contact.reason},onObservation(listener:(s:ArmStatusLike&{evidenceKind:string})=>void){return port.onSample(sample=>{
   const actual=sample.actualRad as number[],commanded=sample.commandedRad as number[];
   if(!Array.isArray(actual)||!Array.isArray(commanded)||actual.length!==6||commanded.length!==6||![...actual,...commanded].every(Number.isFinite)){void unknown('ACTUAL_FEEDBACK_MISSING');return;}
   listener({evidenceKind,seq:String(sample.seq),bootId:String(sample.bootId),controllerEpoch:Number(sample.epoch),observedAt:null,monotonicNs:undefined,task:{state:'on',interp:'unknown',homed:false,fault:null},joints:{actualRad:actual,commandedRad:commanded},tcp:{positionM:sample.tcpM as number[]},program:{id:null,state:'unknown'},freshness:{quality:'valid',staleMs:profile.freshnessMs},reasonCodes:[]});
  });},async close(){try{await unknown('XARM_CLOSED');}finally{await port.close();}if(!double){const shutdown=JSON.parse(await readFile(join(c.runDirectory,'native-shutdown.json'),'utf8'));if(shutdown.closed!==true||!Array.isArray(shutdown.blockers)||shutdown.blockers.length)throw Error('XARM_SHUTDOWN_UNVERIFIED');}}};
}
