import {createHash} from 'node:crypto';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function mujocoCases(){return [
 ...Array.from({length:10},(_,i)=>({id:`m00-${i+1}`,kind:'m00',seed:i+1,scope:'frozen_m00_recipe'})),
 ...[7,42,99].map(seed=>({id:`mj-bv01-${seed}`,kind:'business',seed,scope:'unchanged_runtime'})),
 {id:'bad-state',kind:'bad_state',seed:42,scope:'instrumented_historical_worker'},
 {id:'worker-loss',kind:'worker_loss',seed:42,scope:'unchanged_runtime'},
 {id:'long-run',kind:'long_run',seed:42,scope:'frozen_m00_recipe'}];}
export function probePrerequisites(manifest,inventory,host,engine){
 const issues=[];
 if(!inventory?.provenance||inventory.provenance.emulation!=='none'||inventory.provenance.origin!=='linux_native')issues.push('HOST_PROVENANCE_UNRESOLVED');
 if(JSON.stringify(inventory?.image)!==JSON.stringify(manifest?.subject?.image))issues.push('HOST_IMAGE_MISMATCH');
 if(host?.os?.platform!=='linux'||host.architecture!==manifest.profile.architecture||host.provenance?.origin!=='linux_native'||host.provenance.emulation!=='none')issues.push('ACTUAL_HOST_NOT_NATIVE');
 if(!engine||engine.version!=='3.17.0'||!Array.isArray(engine.artifacts)||!engine.artifacts.length||engine.artifacts.some(f=>!/^sha256:[a-f0-9]{64}$/.test(f.digest)||!Number.isInteger(f.bytes)||f.bytes<1)||!engine.artifacts.some(f=>f.path.includes('libmujoco')))issues.push('ENGINE_ARTIFACT_MISSING');
 return [...new Set(issues)];
}
const finite=v=>typeof v==='number'&&Number.isFinite(v),positive=v=>finite(v)&&v>0;
const quantiles=a=>Array.isArray(a)&&a.length>0&&a.every(v=>finite(v)&&v>=0);
export function assessCase(spec,raw){
 const issues=[],check=(v,code)=>{if(!v)issues.push(code);};
 check(raw?.scope===spec.scope,'CASE_SCOPE');check(raw?.engineVersion==='3.17.0','ENGINE_VERSION');
 if(spec.kind==='bad_state'){
  check(raw?.injection?.kind==='qvel_nan'&&raw.injection.atTick===1&&raw.before?.tick===0&&raw.before?.state==='running','BAD_STATE_INJECTION');
  check(Object.entries(raw?.warningDelta??{}).some(([k,n])=>['BADQPOS','BADQVEL','BADQACC'].includes(k)&&Number.isInteger(n)&&n>0),'REAL_ENGINE_WARNING_REQUIRED');
  check(raw?.response?.ok===false&&raw.response.error?.code==='PLANT_UNSTABLE'&&raw.after?.state==='failed'&&raw.after.tick===0&&raw.postFault?.ok===false,'FAULT_STOP');
  check(finite(raw?.elapsedMs)&&raw.elapsedMs<5000,'FAULT_BOUND');
 }else if(spec.kind==='m00'){
  const r=raw?.trial;check(r?.seed===spec.seed&&!r.nan&&r.heldAllCarry===true&&r.notHeldCarry===0,'GRASP_HELD');
  check(finite(r?.liftM)&&r.liftM>=0.15&&finite(r?.slipM)&&r.slipM<=0.005&&positive(r?.dropTicks)&&r.dropTicks<=50&&finite(r?.placeErrM)&&r.placeErrM<=0.01,'GRASP_LIMITS');
  check(finite(r?.peakFollowRad)&&r.peakFollowRad<=0.05&&Object.values(r?.settle??{}).length===7&&Object.values(r.settle).every(s=>positive(s.ticks)&&s.ticks<=25),'TRACKING_LIMITS');
  check(r?.warnings&&typeof r.warnings==='object'&&Object.values(r.warnings).every(n=>n===0),'ENGINE_WARNINGS');
  check(Array.isArray(raw?.trace)&&raw.trace.length>=800&&raw.trace.every(t=>Array.isArray(t.q)&&t.q.length===6&&t.q.every(finite)&&Array.isArray(t.cup)&&t.cup.every(finite)&&Array.isArray(t.cupquat)&&t.cupquat.every(finite)&&typeof t.held==='boolean'),'RAW_CONTACT_POSE_REQUIRED');
  check(quantiles(raw?.tickMs)&&raw.tickMs.length===raw.trace?.length,'TICK_TIMING_REQUIRED');
  try{
   const t=raw.trace,close=t.filter(s=>s.label==='close:settle').at(-1),lift=t.filter(s=>s.label==='move:lift').at(-1),place=t.filter(s=>s.label==='dwell:place').at(-1);
   const from=t.indexOf(close),to=t.indexOf(place),carry=t.slice(from+1,to+1),opened=t.filter(s=>s.label==='open'||s.label==='open:settle');
   check(from>=0&&to>from&&carry.length>0&&carry.every(s=>s.held&&s.L&&s.R),'RAW_GRASP_CONTINUITY');
   check(!!lift&&!!close&&lift.cup[2]-close.cup[2]>=0.15&&carry.every(s=>s.rel?.length===3&&Math.hypot(...s.rel.map((v,i)=>v-close.rel[i]))<=0.005),'RAW_LIFT_SLIP');
   const settled=opened.findIndex((_,i)=>opened.slice(i).every(s=>s.tray&&!s.L&&!s.R&&s.cupv<0.005&&s.cupw<0.05));
   check(settled>=0&&settled<50&&Math.hypot(opened.at(-1).cup[0]-0.35,opened.at(-1).cup[1]-0.35)<=0.01,'RAW_RELEASE');
   check(t.every(s=>s.arm===false&&s.cmd?.length===6&&s.q.every((q,i)=>Math.abs(q-s.cmd[i])<=0.05)),'RAW_TRACKING_CONTACT');
  }catch{check(false,'RAW_GRASP_RECIPE_INCOMPLETE');}

 }else if(spec.kind==='long_run'){
  check(raw?.ticks===180000&&raw?.substeps===1800000&&finite(raw?.driftS)&&Math.abs(raw.driftS)<=1e-5,'LONG_RUN_DRIFT');
  check(quantiles(raw?.tickMs)&&raw.tickMs.length===180000&&raw?.warnings&&typeof raw.warnings==='object'&&Object.values(raw.warnings).every(n=>n===0),'LONG_RUN_OBSERVATIONS');
  check(Array.isArray(raw?.lastPose)&&raw.lastPose.length===6&&raw.lastPose.every(finite),'RAW_POSE_REQUIRED');
 }else{
  const report=raw?.report,trace=raw?.trace,props=raw?.props,steps=raw?.requests;
  check(report?.manifest?.scenario?.id==='MJ-BV01'&&report.manifest.seed===spec.seed&&report.manifest.mode==='simulation'&&report.manifest.access==='simulated'&&report.manifest.backendSetId==='engineering-mujoco-arm-v1','BUSINESS_MANIFEST');
  check(report?.arm?.armPlant?.engineVersion==='3.17.0'&&report.arm.armPlant.calibration==='not_calibrated','BUSINESS_ENGINE');
  check(Array.isArray(trace?.samples)&&trace.samples.length>0&&trace.samples.every(s=>s.actualRad?.length===6&&s.actualRad.every(finite))&&Array.isArray(props?.samples)&&props.samples.length===trace.samples.length&&props.frame==='map','RAW_CONTACT_POSE_REQUIRED');
  check(Array.isArray(steps)&&steps.length>0&&new Set(steps.map(x=>x.actionId)).size===steps.length&&steps.every(x=>x.received===true)&&raw?.workerObservation?.maxActive===1,'SERIAL_NO_RESEND');
  const wire=Array.isArray(raw?.wire)?analyseWire(raw.wire):{valid:false,ipcMs:[]};
  check(wire.valid,'WORKER_WIRE_REQUIRED');
  check(quantiles(raw?.ipcMs)&&JSON.stringify(raw.ipcMs)===JSON.stringify(wire.ipcMs),'IPC_TIMING_REQUIRED');
  if(spec.kind==='business'){
   check(wire.pending?.length===0,'WIRE_ACK_MISSING');
   check(report?.outcome?.status==='completed'&&String(report.outcome.served)==='2'&&report.coffee?.cups?.length===2&&report.coffee.cups.every(c=>c.ownerKind==='customer'&&c.ownerId==='table-1'),'BUSINESS_OUTCOME');
   check(report?.coffee?.armTrace?.stop===null&&report?.arm?.collision?.result==='pass','NOMINAL_ARM_STOP');
  }else{
   check(raw?.injection?.kind==='owned_pid_sigkill'&&Number.isInteger(raw.injection.pid)&&raw.injection.pid>1,'WORKER_LOSS_INJECTION');
   check(report?.outcome?.status==='needs_attention'&&String(report.outcome.served)==='0'&&report.coffee?.armTrace?.stop?.reason==='WORKER_LOST'&&report.coffee.armTrace.stop.latched===true,'WORKER_LOSS_STOP');
   check(Array.isArray(raw?.checkpoint?.coffee?.arm?.programs)&&raw.checkpoint.coffee.arm.programs.length===1&&raw.checkpoint.coffee.arm.programs[0].state==='unknown','SOURCE_UNKNOWN');
   check(raw?.workerObservation?.spawned?.length===1&&raw.workerObservation.spawned[0]===raw.injection?.pid&&raw.workerObservation.afterLoss?.length===0&&raw.afterLossSteps>=5,'NO_RESPAWN');
  }
 }
 if(spec.kind!=='bad_state')check(positive(raw?.maxRssKiB),'MEMORY_REQUIRED');
 return {passed:issues.length===0,issues};
}
// Shared strict reader: regular non-symlink files, no traversal, bounded reads, no input imports.
export async function probeFile(root,path,max=64*1024*1024){
 if(typeof path!=='string'||path.length>240||!/^[-A-Za-z0-9_.]+(?:\/[-A-Za-z0-9_.]+)*$/.test(path)||path.split('/').some(p=>p==='.'||p==='..'))throw Error('PROBE_PATH_REJECTED');
 const base=await realpath(root);let file=base;for(const p of path.split('/')){file=join(file,p);if((await lstat(file)).isSymbolicLink())throw Error('PROBE_PATH_REJECTED');}
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=await handle.stat();if(!before.isFile()||before.size>max)throw Error('PROBE_FILE_LIMIT');const b=Buffer.alloc(before.size+1);let n=0;while(n<b.length){const r=await handle.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}const after=await handle.stat(),pathStat=await lstat(file);if(n!==before.size||after.size!==before.size||after.ctimeMs!==before.ctimeMs||pathStat.ino!==after.ino||pathStat.dev!==after.dev||await realpath(file)!==file)throw Error('PROBE_FILE_CHANGED');return b.subarray(0,n);}finally{await handle.close();}
}
export async function probeArtifacts(root,base='',budget={files:0,bytes:0}){
 const result=[];for(const name of (await readdir(join(root,base))).sort()){if(!base&&name==='manifest.json')continue;const path=base?base+'/'+name:name;if(++budget.files>10000||path.split('/').length>14)throw Error('PROBE_ARTIFACT_LIMIT');const st=await lstat(join(root,path));if(st.isSymbolicLink())throw Error('PROBE_PATH_REJECTED');if(st.isDirectory())result.push(...await probeArtifacts(root,path,budget));else{const b=await probeFile(root,path);budget.bytes+=b.length;if(budget.bytes>1024**3)throw Error('PROBE_ARTIFACT_LIMIT');result.push({path,bytes:b.length,sha256:sha256(b)});}}return result;
}
export function analyseWire(events){
 const seen=new Set(),pending=new Map(),spawned=[],ipcMs=[],issues=[];let maxActive=0,active=new Set();
 for(const e of events){
  if(e.event==='spawn'){if(spawned.includes(e.pid))issues.push('WIRE_DUPLICATE_SPAWN');spawned.push(e.pid);active.add(e.pid);maxActive=Math.max(maxActive,active.size);}
  else if(e.event==='exit'){if(!active.has(e.pid))issues.push('WIRE_EXIT_WITHOUT_SPAWN');active.delete(e.pid);}
  else if(e.event==='request'){
   const key=e.pid+':'+e.value?.requestId;if(!active.has(e.pid)||seen.has(key)||pending.has(e.pid)||!Number.isFinite(e.atMs))issues.push('WIRE_RESEND_OR_OVERLAP');seen.add(key);pending.set(e.pid,e);
  }else if(e.event==='ack'){
   const p=pending.get(e.pid);if(!active.has(e.pid)||!p||p.value?.requestId!==e.value?.requestId||!Number.isFinite(e.atMs)||e.atMs<p.atMs)issues.push('WIRE_ACK_MISMATCH');else if(p.value.op==='step')ipcMs.push(e.atMs-p.atMs);pending.delete(e.pid);
  }else issues.push('WIRE_OBSERVATION_INCOMPLETE');
 }
 if(active.size)issues.push('WIRE_EXIT_MISSING');
 if(spawned.length!==1||maxActive!==1)issues.push('WIRE_RESPAWN_OR_MISSING');
 return {valid:issues.length===0,issues,spawned,maxActive,ipcMs,pending:[...pending.values()],active:[...active]};
}
export function timingSummary(values){
 if(!quantiles(values))throw Error('TIMING_SAMPLES_INVALID');const sorted=[...values].sort((a,b)=>a-b);
 return {samples:sorted.length,p50Ms:sorted[Math.ceil(sorted.length*0.5)-1],p95Ms:sorted[Math.ceil(sorted.length*0.95)-1],maxMs:sorted.at(-1)};
}
// Shared by execution and independent readback; registry and measured package policy are symmetric.
export function imagePrerequisites(handoff,engine,historicalRegistryDigest){
 const issues=[],normalize=s=>s.toLowerCase().replace(/[-_.]+/g,'-');
 if(handoff.subject?.image?.manifestDigest!==historicalRegistryDigest)issues.push('HISTORICAL_IMAGE_RESOLUTION_REQUIRED');
 const required=handoff.profile.requiredPackages,packages=engine?.packages;
 if(!Array.isArray(required)||required.length!==1)issues.push('UNMEASURED_PACKAGE_LOCK');
 if(!Array.isArray(packages)||packages.some(p=>!Array.isArray(p)||typeof p[0]!=='string'||typeof p[1]!=='string'))issues.push('IMAGE_PACKAGE_MEASUREMENT');
 else{
  if(packages.some(([name])=>handoff.profile.forbiddenPackages.some(p=>normalize(p)===normalize(name))))issues.push('IMAGE_FORBIDDEN_PACKAGE');
  if(packages.filter(([name,version])=>normalize(name)==='mujoco'&&version==='3.17.0').length!==1)issues.push('IMAGE_ENGINE_PACKAGE');
 }
 const lib=engine?.artifacts?.find(f=>f.path.includes('libmujoco')),lock=required?.find(p=>p.name==='mujoco');
 if(!lock||lock.version!=='3.17.0'||'sha256:'+lock.sha256!==lib?.digest)issues.push('ENGINE_ARTIFACT_LOCK_MISMATCH');
 return issues;
}
