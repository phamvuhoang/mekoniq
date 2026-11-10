import {defaultCatalog,type CapabilityCatalog} from './capabilities';
import {scenarioRegistry,resolveRoles} from './scenario-registry';
import {validateProjectV2} from './contracts';
import {validateArmCollisionProfile} from './models/arm-scene';
import {PUMA560_SI} from './models/arm-kinematics';
import {hashJson} from './hash';
import {TICK_MS} from './clock';
import {resolveBackends} from './scenario-matrix';
export interface ReadinessCheck {id:string;status:'ready'|'blocked'|'unknown';reasonCodes:string[];evidenceRef:string|null}
export interface ReadinessSnapshot {checkedAt:string;expiresAt:string;scenarioId:string;backendSetId:string;checks:ReadinessCheck[];canStart:boolean}
/** `engineering`: the bundle the gateway admitted for this session (engineering sets only); never a caller-chosen path. `runId`: the existing run asking (start/resume), server-set. */
export interface ReadinessContext {scenarioId:string;backendSetId:string;project?:unknown;engineering?:{bundleDigest:string;projectDigest:string};runId?:string}
export type ReadinessProbe=(context:ReadinessContext,signal:AbortSignal)=>Promise<Omit<ReadinessCheck,'id'>>;
export type NativeReadinessChecks=(context:ReadinessContext,signal:AbortSignal)=>Promise<ReadinessCheck[]>;
/** `portableChecks` answer for portable_python sets (irsim_2d) only; `nativeChecks` for the native simulation sets only. */
export interface ReadinessOptions {nativeChecks?:NativeReadinessChecks;portableChecks?:NativeReadinessChecks;catalog?:CapabilityCatalog;enabledBackends:readonly string[];now?:()=>number;probes?:Readonly<Record<string,ReadinessProbe>>}
export function canStartFromChecks(checks:readonly ReadinessCheck[],expired:boolean):boolean{return !expired&&checks.length>0&&checks.every(c=>c.status==='ready'&&c.reasonCodes.length===0);}
const check=(id:string,reasonCodes:string[],status:ReadinessCheck['status']='blocked'):ReadinessCheck=>({id,status:reasonCodes.length?status:'ready',reasonCodes,evidenceRef:null});
async function probe(id:string,fn:ReadinessProbe,context:ReadinessContext):Promise<ReadinessCheck>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([
   Promise.resolve().then(()=>fn(context,controller.signal)).then(r=>{
    if(!r||!['ready','blocked','unknown'].includes(r.status)||!Array.isArray(r.reasonCodes)||r.reasonCodes.length>30||r.reasonCodes.some(x=>typeof x!=='string'||x.length>200)||r.status==='ready'&&r.reasonCodes.length)return check(id,['PROBE_INVALID'],'unknown');
    return {id,status:r.status,reasonCodes:[...r.reasonCodes],evidenceRef:typeof r.evidenceRef==='string'&&r.evidenceRef.length<=500?r.evidenceRef:null};
   }).catch(()=>check(id,['PROBE_FAILED'],'unknown')),
   new Promise<ReadinessCheck>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(check(id,['PROBE_TIMEOUT'],'unknown'));},5000);}),
  ]);
 }finally{clearTimeout(timer);}
}
/** Server-owned provider checks replace the placeholder model/clock/fixture/profile/runner/gripper rows; anything malformed or late is unknown, never ready. */
const WEBOTS_BUDGET_MS=45000;
async function providerChecks(checks:ReadinessCheck[],context:ReadinessContext,fn:NativeReadinessChecks,prefix:string,id:string,ms:number){
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const values=await Promise.race([fn(context,controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error(`${prefix}_PROBE_TIMEOUT`));},ms);})]);
  const allowed=new Set(['model','clock','fixture','profile','runner','gripper']),ids=new Set<string>();
  if(!Array.isArray(values)||values.length>6||values.some(v=>!v||!allowed.has(v.id)||ids.has(v.id)||!ids.add(v.id)||!['ready','blocked','unknown'].includes(v.status)||!Array.isArray(v.reasonCodes)||v.reasonCodes.length>30||v.reasonCodes.some(x=>typeof x!=='string'||x.length>200)||v.status==='ready'&&v.reasonCodes.length||v.evidenceRef!==null&&(typeof v.evidenceRef!=='string'||v.evidenceRef.length>500)))throw new Error(`${prefix}_PROBE_INVALID`);
  for(const value of values){const index=checks.findIndex(c=>c.id===value.id);if(index>=0)checks[index]=structuredClone(value);}
 }catch(error){checks.push(check(id,[error instanceof Error&&[`${prefix}_PROBE_TIMEOUT`,`${prefix}_PROBE_INVALID`].includes(error.message)?error.message:`${prefix}_PROBE_FAILED`],'unknown'));}
 finally{clearTimeout(timer);}
}
/** Read-only server-owned probes. These checks never authorize hardware or turn imported evidence into live readiness. */
export async function collectReadiness(context:ReadinessContext,o:ReadinessOptions):Promise<ReadinessSnapshot>{
 const catalog=o.catalog??defaultCatalog,now=o.now??Date.now,started=now(),checks:ReadinessCheck[]=[];
 const scenario=scenarioRegistry.get(context.scenarioId),set=Object.hasOwn(catalog.sets,context.backendSetId)?catalog.sets[context.backendSetId]:undefined;
 checks.push(check('scenario',scenario?[]:['SCENARIO_UNKNOWN']),check('backend-set',set?[]:['BACKEND_SET_UNKNOWN']));
 if(scenario&&set){
  // provider policy: native simulation (Gazebo/ROS/LinuxCNC) needs Linux and its native probes; the portable provider runs on macOS or Linux and answers through portableChecks
  const portable=set.execution?.host==='portable_python',native=set.mode==='simulation'&&!portable,provider=native||portable,missing=(code:string)=>native?[code]:portable?['IRSIM_PROVIDER_UNAVAILABLE']:[];
  const hostReasons=[...process.versions.node.startsWith('24.')?[]:['NODE_24_REQUIRED'],...native&&process.platform!=='linux'?['HOST_NOT_LINUX']:[],...portable&&!['darwin','linux'].includes(process.platform)?['HOST_UNSUPPORTED']:[]];
  checks.push({...check('host',hostReasons),evidenceRef:`${process.platform}/${process.arch}/node-${process.versions.node}`},
   {...check('protocol',[]),evidenceRef:'protocol-major:2'},
   {...check('model',missing('MODEL_PROVIDER_UNAVAILABLE'),'unknown'),evidenceRef:provider?null:scenario.coffee?`${PUMA560_SI.id}:${hashJson(PUMA560_SI)}`:'mock_amr'},
   {...check('clock',missing('CLOCK_PROVIDER_UNAVAILABLE'),'unknown'),evidenceRef:provider?null:`fixed-tick-ms:${TICK_MS}`},
   check('fixture',missing('NATIVE_FIXTURE_UNAVAILABLE'),'unknown'),
   check('profile',missing('PROFILE_PROVIDER_UNAVAILABLE'),'unknown'));
  if(context.project!==undefined){
   const valid=validateProjectV2(context.project),reasons:string[]=[];
   if(!valid.ok)reasons.push(...valid.issues.map(i=>i.code));
   else try{resolveRoles(scenario,valid.value);if(!provider&&valid.value.armCollisionProfile)validateArmCollisionProfile(valid.value.armCollisionProfile);}catch(e){reasons.push(e instanceof Error?e.message:'PROJECT_INVALID');}
   checks.push({...check('world',reasons),evidenceRef:valid.ok?`world:${valid.value.world.id}:r${valid.value.world.revision}:${hashJson(valid.value.world)}`:null});
  }else if(provider)checks.push(check('world',['WORLD_PROVIDER_UNAVAILABLE'],'unknown'));
  if(set.mode==='hardware'||set.access!=='simulated')checks.push(check('mode',['MODE_UNSUPPORTED']));
  else{
   const resolution=resolveBackends(scenario,set.mode,context.backendSetId,catalog);
   if(!resolution.ok)checks.push(check('scenario',resolution.reasonCodes));
   for(const id of resolution.required){
    const b=catalog.backends.find(x=>x.id===id),reasons:string[]=[];
    if(!set.backends.includes(id))reasons.push(`BACKEND_NOT_IN_SET:${id}`);
    if(!b)reasons.push(`BACKEND_UNKNOWN:${id}`);
    else{
     if(!b.modes.includes(set.mode)||!b.accesses.includes(set.access))reasons.push(`MODE_BACKEND_MISMATCH:${id}`);
     for(const [key,code] of [['installed','BACKEND_NOT_INSTALLED'],['compatible','BACKEND_INCOMPATIBLE'],['reachable','BACKEND_UNREACHABLE'],['commissioned','BACKEND_NOT_COMMISSIONED']] as const)if(!b[key])reasons.push(`${code}:${id}`);
    }
    if(!o.enabledBackends.includes(id))reasons.push(`BACKEND_NOT_ENABLED:${id}`);
    checks.push(check(`backend:${id}`,reasons));
   }
   // The current gateway owns only mock RunHandles; provider availability alone cannot manufacture a native runner.
   checks.push(check('runner',set.mode==='mock'?[]:portable?['IRSIM_RUNNER_UNAVAILABLE']:['NATIVE_RUNNER_UNAVAILABLE']));
   if(set.mode==='simulation'&&scenario.coffee)checks.push(check('gripper',['GRIP_PROVIDER_UNAVAILABLE']));
  }
 }
 const portableSet=set?.execution?.host==='portable_python';
 if(scenario&&set?.mode==='simulation'&&!portableSet&&o.nativeChecks)await providerChecks(checks,context,o.nativeChecks,'NATIVE','native-provider',5000);
 // the IR-SIM create smoke may need its full 15 s startup budget on a cold host; a Webots start is slower (a GUI process), so its smoke gets 45 s under its own name, and the abort closes it
 const webots=set?.providers?.amr==='webots_3d';
 if(scenario&&set?.mode==='simulation'&&portableSet&&o.portableChecks)await providerChecks(checks,context,o.portableChecks,webots?'WEBOTS':'IRSIM',webots?'webots-provider':'irsim-provider',webots?WEBOTS_BUDGET_MS:15000);
 const entries=Object.entries(o.probes??{});
 if(entries.length>20)checks.push(check('probes',['PROBE_LIMIT']));
 else if(scenario&&set)checks.push(...await Promise.all(entries.map(([id,fn])=>probe(`probe:${id}`,fn,context))));
 const finished=now(),expired=finished-started>(webots?WEBOTS_BUDGET_MS+5000:15000)||finished<started;
 if(expired)checks.push(check('deadline',['READINESS_DEADLINE_EXCEEDED'],'unknown'));
 return {checkedAt:new Date(finished).toISOString(),expiresAt:new Date(finished+30000).toISOString(),scenarioId:context.scenarioId,backendSetId:context.backendSetId,checks,canStart:canStartFromChecks(checks,expired)};
}
