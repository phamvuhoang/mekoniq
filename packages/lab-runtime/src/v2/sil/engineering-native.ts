// Canonical AMR native path. No legacy fixture or coffee/arm provider participates.
import {createHash} from 'node:crypto';
import {readFile,lstat,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isDeepStrictEqual as same} from 'node:util';
import {hashJson} from '../hash';
import {readCompiledWorld,startGazeboBackend,type CompiledWorld,type GazeboBackend} from '../backends/gazebo-nav2';
import canonicalManifest from '../../../../../robotics/simulation/fixtures/engineering-navigation-v1/compiler-manifest.json';
import {validNativeProfileReport} from '../../../../../scripts/native-sim/profile-report.mjs';
import canonicalProject from '../../../../../robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json';
import canonicalScene from '../../../../../robotics/simulation-3d/fixtures/serve-3d-v1/navigation-scene.json';
import canonicalPhysical from '../../../../../robotics/simulation-3d/fixtures/serve-3d-v1/physical-model-amr-1.json';
export const ENGINEERING_TOPICS=['/clock','/amr_1/tf','/amr_1/tf_static','/amr_1/odom','/amr_1/joint_states','/amr_1/scan','/amr_1/cmd_vel','/amr_1/amcl_pose','/model/amr_1/pose','/model/amr_1/contacts','/amr_1/navigate_to_pose/_action/status'];
export interface ClockMapping {providerSimNs:string;sourceTick:number;receiveMonotonicNs:string}
export class EngineeringClock {
 mapping:ClockMapping[]=[];tick=0;failure:string|null=null;private origin:bigint|null=null;private last:bigint|null=null;private receipt:bigint|null=null;
 observe(value:string,now:bigint){
  if(this.failure)throw Error(this.failure);
  if(!/^\d+$/.test(value)||now<0n){this.failure='CLOCK_INVALID';throw Error(this.failure);}
  const ns=BigInt(value);if(this.last!==null&&(ns<this.last||now<this.receipt!)){this.failure='CLOCK_RESET';throw Error(this.failure);}
  this.origin??=ns;this.tick=Number((ns-this.origin)/20_000_000n);
  if(ns!==this.last){this.receipt=now;this.mapping.push({providerSimNs:value,sourceTick:this.tick,receiveMonotonicNs:String(now)});}
  this.last=ns;
 }
 assertFresh(now=process.hrtime.bigint()){
  if(!this.failure&&(this.receipt===null||now-this.receipt>500_000_000n))this.failure='FEEDBACK_STALE';
  if(this.failure)throw Error(this.failure);
 }
}
export function engineeringNativeAdmission(project:unknown,scenario:string,set:string,profile:string){
 if(scenario!=='FD01'||set!=='engineering-rigid-v1')throw Error('ENGINEERING_SCENARIO_UNSUPPORTED');
 if(!/^engineering-(amd64|arm64)$/.test(profile))throw Error('ENGINEERING_PROFILE_REQUIRED');
 if(!same(project,canonicalProject.runtimeProject))throw Error('ENGINEERING_PROJECT_MISMATCH');
}
// Historical v1 libm output differs at five joint pitches. Pin the entire second
// manifest to the frozen model, changing only the two measured hash values.
const linuxManifest={
 ...canonicalManifest,
 manifestHash:'95576339954662f4ee1229304215dc9c00d0beecfdc07679ed4b2e4bcd77f5e5',
 outputs:canonicalManifest.outputs.map(file=>file.path==='robots/amr-1.urdf'
  ?{...file,sha256:'69a350c3f5d9b1ab23ea8613294cc1d550f9fd3e073375c5b3e98d7f0de01400'}:file),
};
const compilerFiles=new Set(['compiler-manifest.json',...canonicalManifest.outputs.map(file=>file.path)]);
const compilerDirs=new Set(canonicalManifest.outputs.map(file=>dirname(file.path)));
async function checkCompilerEntries(root:string,prefix=''){
 for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){
  const name=prefix+entry.name;
  if(entry.isFile()&&compilerFiles.has(name))continue;
  // The native worker owns these runtime artifacts. Neither directory supplies compiler inputs.
  if(entry.isDirectory()&&(name==='.native'||name==='.bridge'))continue;
  if(!entry.isDirectory()||!compilerDirs.has(name))throw Error('BUNDLE_PATH_INVALID');
  await checkCompilerEntries(root,name+'/');
 }
}
export async function readEngineeringCompiledWorld(directory:string){
 const root=resolve(directory),manifestPath=join(root,'compiler-manifest.json');
 if(!(await lstat(root)).isDirectory()||!(await lstat(manifestPath)).isFile())throw Error('BUNDLE_PATH_INVALID');
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 if(!same(manifest.compiler,{id:'engineering-gazebo-canonical',version:'1'}))throw Error('ENGINEERING_BUNDLE_REQUIRED');
 if(!same(manifest,canonicalManifest)&&!same(manifest,linuxManifest))throw Error('NATIVE_MAPPING_MISMATCH');
 const {manifestHash,...body}=manifest;if(hashJson(body)!==manifestHash)throw Error('BUNDLE_MANIFEST_MISMATCH');
 await checkCompilerEntries(root);
 const seen=new Set<string>();
 for(const file of manifest.outputs){
  const path=resolve(root,file.path);if(!path.startsWith(root+sep)||seen.has(file.path)||!(await lstat(path)).isFile())throw Error('BUNDLE_PATH_INVALID');seen.add(file.path);
  if(createHash('sha256').update(await readFile(path)).digest('hex')!==file.sha256)throw Error('BUNDLE_DIGEST_MISMATCH');
 }
 for(const [name,want] of [['engineering-project.json',canonicalProject],['navigation-scene.json',canonicalScene],['physical-model.json',canonicalPhysical],['runtime-project.json',canonicalProject.runtimeProject]] as const){
  if(!seen.has(name)||!same(JSON.parse(await readFile(join(root,name),'utf8')),want))throw Error('CANONICAL_INPUT_MISMATCH');
 }
 if(manifest.inputHash!==hashJson([canonicalProject,canonicalScene,canonicalPhysical]))throw Error('CANONICAL_INPUT_MISMATCH');
 return readCompiledWorld(root);
}
interface TopicCoverage {count:number;firstNs:string;lastNs:string;maxGapNs:string}
export interface EngineeringEvidence {producer:string;clockMapping:ClockMapping[];bag:{storageId:string;topics:Record<string,TopicCoverage>};blockers:string[];artifacts?:{path:string;sha256:string}[]}
export function assessEngineeringEvidence(e:EngineeringEvidence){
 const blockers=[...e.blockers],clock=e.clockMapping;
 if(e.producer!=='native')blockers.push('NATIVE_EXECUTION_NOT_OBSERVED');
 let valid=clock.length>=2;
 for(let i=0;i<clock.length;i++){
  const c=clock[i]!,p=clock[i-1];
  if(!/^\d+$/.test(c.providerSimNs)||!/^\d+$/.test(c.receiveMonotonicNs)||!Number.isSafeInteger(c.sourceTick)||c.sourceTick<0){valid=false;break;}
  if(p&&(BigInt(c.providerSimNs)<=BigInt(p.providerSimNs)||BigInt(c.receiveMonotonicNs)<BigInt(p.receiveMonotonicNs)))valid=false;
  if(c.sourceTick!==Number((BigInt(c.providerSimNs)-BigInt(clock[0]!.providerSimNs))/20_000_000n))valid=false;
 }
 if(!valid)blockers.push('CLOCK_MAPPING_INVALID');
 if(e.bag.storageId!=='sqlite3')blockers.push('BAG_STORAGE_INVALID');
 for(const topic of ENGINEERING_TOPICS){
  const t=e.bag.topics[topic];if(!t||!Number.isSafeInteger(t.count)||t.count<1){blockers.push(`BAG_TOPIC_MISSING:${topic}`);continue;}
  if(![t.firstNs,t.lastNs,t.maxGapNs].every(x=>/^\d+$/.test(x))){blockers.push(`BAG_TIME_COVERAGE:${topic}`);continue;}
  // Static TF is latched; AMCL, commands and action status are event-driven, not continuous sensors.
  const continuous=['/clock','/amr_1/tf','/amr_1/odom','/amr_1/joint_states','/amr_1/scan','/model/amr_1/pose','/model/amr_1/contacts'].includes(topic);
  if(valid&&continuous&&(t.count<2||BigInt(t.firstNs)>BigInt(clock[0]!.providerSimNs)+500_000_000n||BigInt(t.lastNs)+500_000_000n<BigInt(clock.at(-1)!.providerSimNs)||BigInt(t.maxGapNs)>500_000_000n))blockers.push(`BAG_TIME_COVERAGE:${topic}`);
 }
 return {result:blockers.length?'not_run' as const:'pass' as const,blockers:[...new Set(blockers)],accepted:false as const,calibration:'not_calibrated' as const};
}
export const ENGINEERING_CASES=['nominal','obstacle','no-path','cancel','worker-loss'] as const;
export interface EngineeringNativeFactory {
 kind:'engineering-gazebo-canonical-v1';nativeCase:string;fault:{status:string;commandId?:string;reason?:string};world:CompiledWorld;profile:string;clock:EngineeringClock;
 open(runId:string):Promise<GazeboBackend>;finish():Promise<EngineeringEvidence>;
}
export async function engineeringNativeProviderFactory(config:{bundleDirectory:string;environmentProfile:string;python?:string;simulationRoot:string;nativeCase?:string}):Promise<EngineeringNativeFactory>{
 engineeringNativeAdmission(canonicalProject.runtimeProject,'FD01','engineering-rigid-v1',config.environmentProfile);
 const nativeCase=config.nativeCase??'nominal';if(!(ENGINEERING_CASES as readonly string[]).includes(nativeCase))throw Error('ENGINEERING_CASE_INVALID');
 const fault:EngineeringNativeFactory['fault']={status:nativeCase==='nominal'?'not_requested':'pending'};
 const world=await readEngineeringCompiledWorld(config.bundleDirectory),clock=new EngineeringClock(),blockers:string[]=[];
 let backend:GazeboBackend|undefined,off:(()=>void)|undefined,closed=false;
 const close=async()=>{if(closed)return;closed=true;await backend?.close();off?.();};
 return {kind:'engineering-gazebo-canonical-v1',nativeCase,fault,world,profile:config.environmentProfile,clock,
  async open(runId){
   if(backend||closed)throw Error('NATIVE_REOPEN_RECONCILE_REQUIRED');
   backend=await startGazeboBackend(world,runId,{python:config.python,simulationRoot:config.simulationRoot,environmentProfile:config.environmentProfile,engineering:true,engineeringCase:nativeCase,startupTimeoutMs:120000});
   off=backend.onEvent(e=>{try{if(e.event==='clock-mapping')clock.observe(String(e.payload.providerSimNs),process.hrtime.bigint());if(e.event==='fatal')clock.failure=String(e.payload.reason);}catch(error){blockers.push((error as Error).message);}});
   const actual=backend;
   return {...actual,execute:async(r,c)=>{
    clock.assertFresh();
    if(fault.status==='pending'&&['obstacle','no-path'].includes(nativeCase)){
     fault.status='intent';const response=await actual.setBlocker!(true);fault.status=response.applied===true?'applied':'unknown';if(fault.status!=='applied')throw Error('FAULT_EFFECT_UNKNOWN');
    }
    const answer=await actual.execute(r,c);
    if(fault.status==='pending'&&answer.status==='accepted'){
     fault.status='intent';fault.commandId=c.commandId;
     // Source receives the original ACK; the selected fault runs once afterwards, never a replay.
     setTimeout(()=>{void (nativeCase==='cancel'?actual.cancel(r,c.commandId):actual.setBlocker!(true)).then(reply=>{fault.status=reply.acknowledged===true||reply.applied===true?'applied':'unknown';}).catch(error=>{fault.status=nativeCase==='worker-loss'&&/WORKER_EXITED:86/.test((error as Error).message)?'worker_lost':'unknown';fault.reason=(error as Error).message;});},50);
    }
    return answer;
   },close};
  },
  async finish(){
   await close();
   if(clock.failure&&!(nativeCase==='worker-loss'&&fault.status==='worker_lost'))blockers.push(clock.failure);
   let bag:EngineeringEvidence['bag']={storageId:'sqlite3',topics:{}};
   try{const result=await promisify(execFile)(config.python??'python3',['-m','bridge.engineering_bag','--input',join(world.outputDirectory,'..','rosbag2'),...nativeCase==='worker-loss'&&fault.status==='worker_lost'?['--retain-from',join(world.outputDirectory,'.native/raw-bag')]:[]],{cwd:config.simulationRoot,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:config.simulationRoot},timeout:30000,maxBuffer:8*1024*1024});bag=JSON.parse(result.stdout);}catch{blockers.push('BAG_REPLAY_FAILED');}
   const directory=resolve(world.outputDirectory,'..'),artifacts:{path:string;sha256:string}[]=[];
   const retain=async(name:string,from:string,json=true)=>{try{const bytes=await readFile(from);await writeFile(join(directory,name),bytes);artifacts.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex')});return json?JSON.parse(bytes.toString()):null;}catch{blockers.push('NATIVE_ARTIFACT_MISSING:'+name);return null;}};
   const inventory=await retain('native-inventory.json',join(world.outputDirectory,'.bridge/inventory.json'));
   if(!validNativeProfileReport(inventory,config.environmentProfile))blockers.push('NATIVE_INVENTORY_INVALID');
   await retain('native-events.jsonl',join(world.outputDirectory,'.bridge/native-events.jsonl'),false);
   await retain('native-commands.json',join(world.outputDirectory,'.bridge/nav2-commands.json'));
   const shutdown=nativeCase==='worker-loss'&&fault.status==='worker_lost'?null:await retain('native-shutdown.json',join(world.outputDirectory,'.native/shutdown.json'));
   if(shutdown?.blockers?.length)blockers.push(...shutdown.blockers);
   for(const name of await readdir(join(directory,'rosbag2')).catch(()=>[])){
    const path=join(directory,'rosbag2',name);if(!(await lstat(path)).isFile()||(await lstat(path)).isSymbolicLink()){blockers.push('BAG_FILE_INVALID');continue;}
    artifacts.push({path:'rosbag2/'+name,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
   }
   return {producer:'native',clockMapping:clock.mapping,bag,blockers,artifacts};
  },
 };
}

export function assessEngineeringFault(input:{nativeCase:string;fault:{status:string};status:string;served:string;effects:{attempts:number}[];observedCompleted:number}){
 if(!['no-path','cancel','worker-loss'].includes(input.nativeCase))return {result:'not_run' as const,reason:'NEGATIVE_CASE_REQUIRED'};
 if(!['applied','worker_lost'].includes(input.fault.status))return {result:'not_run' as const,reason:'FAULT_NOT_OBSERVED'};
 if(input.status!=='needs_attention'||input.served!=='0'||input.observedCompleted!==0||input.effects.some(e=>e.attempts>1))return {result:'fail' as const,reason:'FALSE_COMPLETION_OR_REPLAY'};
 return {result:'pass' as const,reason:'OBSERVED_FAULT_WITHOUT_COMPLETION_OR_REPLAY'};
}
