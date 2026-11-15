// Read original observations. Derived summaries never replace missing/contradictory raw evidence.
import {isDeepStrictEqual as same} from 'node:util';
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {probeFile,sha256,analyseWire} from './mujoco-probe-evidence.mjs';
const read=async(root,path)=>JSON.parse((await probeFile(root,path)).toString());
export async function readSealedWire(root,runId){
 if(await lstat(join(root,'wire.jsonl.incomplete')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('WIRE_INCOMPLETE_MARKER');
 const bytes=await probeFile(root,'wire.jsonl'),seal=await read(root,'wire.jsonl.seal');
 if(seal.complete!==true||seal.totalBytes!==bytes.length||!bytes.length||bytes.at(-1)!==10)throw Error('WIRE_BYTE_ACCOUNTING');
 const wire=bytes.toString('utf8').slice(0,-1).split('\n').map(s=>JSON.parse(s));
 let last=-Infinity;
 for(const e of wire){if(e.runId!==runId||!Number.isSafeInteger(e.pid)||e.pid<2||!Number.isFinite(e.atMs)||e.atMs<last)throw Error('WIRE_SCOPE_OR_ORDER');last=e.atMs;}
 if(!analyseWire(wire).valid)throw Error('WIRE_LIFECYCLE');return wire;
}
export async function verifyBusinessRaw(root,spec,raw,subject){
 const issues=[],check=(ok,code)=>{if(!ok)issues.push(code);};
 try{
  const report=await read(root,'report.json'),runId=report.manifest.runId,wire=await readSealedWire(root,runId);
  check(same(report,raw.report)&&report.manifest.sourceCommit===subject.sourceCommit&&report.schemaHash===subject.schemaHash,'SUBJECT_READER');
  check(same(wire,raw.wire)&&same(wire,await read(root,'run-wire.json')),'WIRE_DERIVATION');
  check(same(await read(root,'requests.json'),raw.requests),'HTTP_REQUEST_BYTES');
  const copies=await read(root,'runtime-copies.json');
  check(copies.afterRuntimeClose===true&&copies.copies.some(c=>c.path.endsWith('/journal.db')),'SQLITE_VERIFIED_COPY');
  const checkpoints=[];
  for(const r of copies.copies){const b=await probeFile(root,r.path);check(b.length===r.bytes&&sha256(b)===r.sha256,'RUNTIME_COPY_HASH');if(r.path.endsWith('/run.json')){const c=JSON.parse(b);if(c.runId===runId)checkpoints.push({path:r.path,value:c});}}
  check(checkpoints.length===1&&same(checkpoints[0].value,raw.checkpoint),'SOURCE_CHECKPOINT_BYTES');
  const runRoot=checkpoints[0]?.path.slice(0,-'run.json'.length);
  const traceRef=copies.copies.find(r=>r.path===runRoot+report.arm.trace.path),propsRef=copies.copies.find(r=>r.path===runRoot+report.arm.props.path);
  check(traceRef?.sha256===report.arm.trace.sha256&&propsRef?.sha256===report.arm.props.sha256,'SUBJECT_TRACE_REFS');
  if(traceRef&&propsRef)check(same(await read(root,traceRef.path),raw.trace)&&same(await read(root,propsRef.path),raw.props),'SUBJECT_TRACE_BYTES');
  if(spec.kind==='worker_loss'){
   const injection=await read(root,'injection.json'),spawn=wire[0],exit=wire.at(-1);
   check(same(injection,raw.injection),'INJECTION_BYTES');
   check(injection.kind==='owned_pid_sigkill'&&spawn.event==='spawn'&&spawn.pid===injection.pid&&exit.event==='exit'&&exit.pid===injection.pid&&exit.signal==='SIGKILL'&&injection.atMs>=spawn.atMs&&injection.atMs<=exit.atMs&&!wire.some(e=>e.event==='ack'&&e.atMs>injection.atMs&&e.value.ok),'NO_POST_LOSS_ACK');
  }
 }catch(e){issues.push('RAW_OBSERVATION_UNREADABLE:'+e.message);}
 return issues;
}

export async function verifyBadStateRaw(root,raw,baseline){
 const issues=[],check=(ok,code)=>{if(!ok)issues.push(code);};
 try{
  const {readStateNpz}=await import('./mujoco-probe-npz.mjs');
  const states={};for(const key of ['before','injected','after'])states[key]=readStateNpz(await probeFile(root,'engine/'+key+'-state.npz',1024*1024));
  const injection=await read(root,'engine/injection.json'),snapshots=await read(root,'engine/snapshots.json');
  check(same(injection,raw.injection)&&same(injection,{kind:'qvel_nan',atTick:1,index:0,joint:'J1'}),'BAD_STATE_INJECTION_BYTES');
  check(Object.values(states.before).every(a=>a.every(Number.isFinite)),'BAD_STATE_BEFORE_FINITE');
  for(const key of ['qpos','qvel','qacc','ctrl']){
   check(states.before[key].length===baseline.badStateCompiled.stateSizes[key],'BAD_STATE_MODEL_DIMENSIONS');
   const expected=[...states.before[key]];if(key==='qvel')expected[0]=NaN;
   check(same(states.injected[key],expected)&&states.after[key].length===expected.length,'BAD_STATE_SINGLE_QVEL_INJECTION');
  }
  check(same({tick:snapshots.before.tick,state:snapshots.before.state},raw.before)&&same({tick:snapshots.after.tick,state:snapshots.after.state},raw.after),'BAD_STATE_SNAPSHOT_BYTES');
  const warningKeys=Object.keys(snapshots.before.warnings);check(same([...warningKeys].sort(),['BADQACC','BADQPOS','BADQVEL'])&&same(warningKeys.sort(),Object.keys(snapshots.after.warnings).sort()),'BAD_STATE_WARNING_KEYS');
  const delta=Object.fromEntries(warningKeys.map(k=>[k,snapshots.after.warnings[k]-snapshots.before.warnings[k]]));
  check(Object.values(snapshots.before.warnings).every(n=>Number.isInteger(n)&&n>=0)&&Object.values(snapshots.after.warnings).every(n=>Number.isInteger(n)&&n>=0)&&same(delta,raw.warningDelta),'BAD_STATE_WARNING_BYTES');
  const scene=await read(root,'engine/arm-cell-scene.json');check(same(scene,baseline.world),'BAD_STATE_SCENE_BYTES');
  for(const name of ['component.json','physics.json']){const expected=baseline.files.find(r=>r.path==='robotics/simulation-mujoco/fixtures/xarm6-g2-v1/'+name);check(expected&&sha256(await probeFile(root,'engine/'+name))===expected.sha256,'BAD_STATE_INPUT_BYTES:'+name);}
  check(sha256(await probeFile(root,'engine/compiled.xml'))===baseline.badStateCompiled.sha256,'BAD_STATE_COMPILED_BYTES');
  const payload={targetTick:1,velocities:[],actorUpdates:[],jointTargets:[{armId:'arm-1',positionsRad:baseline.world.arm.homeRad}]};
  const expected=['create','start','step','step'].map((op,i)=>({protocol:'mekoniq-sim3d/1',requestId:'probe-'+i,runId:'native-bad-state',expectedTick:0,op,payload:i===0?{sceneRef:'arm-cell-scene.json',seed:42,arms:[{armId:'arm-1',sceneRef:'arm-cell-scene.json'}]}:i<2?{}:payload}));
  const requests=await read(root,'engine/requests.json'),responses=await read(root,'engine/responses.json');
  check(same(requests,expected),'BAD_STATE_REQUEST_BYTES');
  check(responses.length===4&&responses.every((r,i)=>r.requestId===expected[i].requestId)&&responses[0].ok===true&&responses[1].ok===true&&same(responses[2],raw.response)&&same(responses[3],raw.postFault),'BAD_STATE_RESPONSE_BYTES');
 }catch(e){issues.push('BAD_STATE_RAW_UNREADABLE:'+e.message);}
 return issues;
}
