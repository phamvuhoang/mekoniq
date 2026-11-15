// Read-only adapters for the observations existing L02–L04 producers actually retain.
// Original bags are byte-copied and verified before SQLite is opened.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {tsImport} from 'tsx/esm/api';
import xarmProfile from '../robotics/manipulation/profiles/xarm6-jazzy-sim.json' with {type:'json'};
import {boundedEvidenceRead as bytes,evidenceInventory} from './r2b-readback.mjs';
export const ENGINEERING_RUNS=[... [7,42,99].map(seed=>({directory:'nominal-'+seed,nativeCase:'nominal',seed})),...['obstacle','no-path','cancel','worker-loss'].map(nativeCase=>({directory:nativeCase+'-7',nativeCase,seed:7}))];
export const XARM_RUNS=['X1','X2'].flatMap(mode=>['nominal','cancel','restart'].map(nativeCase=>({directory:mode+'-'+nativeCase,mode,nativeCase})));
const sha=b=>createHash('sha256').update(b).digest('hex'),read=(root,p)=>JSON.parse(bytes(root,p));
export async function readEngineeringBag(root){
 const all=evidenceInventory(root);if(all.some(f=>/\.db3-(wal|shm)$/.test(f.file)))throw Error('R3_BAG_SNAPSHOT_REQUIRED');
 const entries=all.filter(f=>/^[\w.-]+\.db3$/.test(f.file));if(!entries.length)throw Error('R3_RAW_BAG_MISSING');
 const temp=await mkdtemp(join(tmpdir(),'r3-bag-readback-'));try{
  const {DatabaseSync}=await import('node:sqlite'),topics=new Map();let count=0;
  for(const f of entries){const b=bytes(root,f.file);if(sha(b)!==f.sha256)throw Error('R3_BAG_CHANGED');const path=join(temp,f.file);await writeFile(path,b,{flag:'wx'});if(sha(await readFile(path))!==f.sha256)throw Error('R3_BAG_COPY');
   const db=new DatabaseSync(path,{readOnly:true});try{
    if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('R3_BAG_CORRUPT');
    const query=db.prepare('SELECT topics.name AS topic,messages.timestamp AS stamp,length(messages.data) AS bytes FROM messages JOIN topics ON topics.id=messages.topic_id ORDER BY messages.timestamp');query.setReadBigInts(true);
    for(const row of query.iterate()){if(++count>2_000_000||row.bytes<=0n||row.stamp<0n)throw Error('R3_BAG_MESSAGE_INVALID');const a=topics.get(row.topic)??[];a.push(row.stamp);topics.set(row.topic,a);}
   }finally{db.close();}
  }
  if(!same(all,evidenceInventory(root)))throw Error('R3_BAG_CHANGED');
  return {storageId:'sqlite3',topics:Object.fromEntries([...topics].sort(([a],[b])=>a.localeCompare(b)).map(([name,stamps])=>{stamps.sort((a,b)=>a<b?-1:a>b?1:0);let gap=0n;for(let i=1;i<stamps.length;i++)if(stamps[i]-stamps[i-1]>gap)gap=stamps[i]-stamps[i-1];return [name,{count:stamps.length,firstNs:String(stamps[0]),lastNs:String(stamps.at(-1)),maxGapNs:String(gap)}];}))};
 }finally{await rm(temp,{recursive:true,force:true});}
}
export async function readEngineeringObservation(root,subject,profile){
 evidenceInventory(root);const m=read(root,'run-manifest.json'),e=read(root,'engineering-native-evidence.json');
 const {hashJson}=await tsImport('../packages/lab-runtime/src/v2/hash.ts',import.meta.url);
 const {manifestHash,...body}=m;if(hashJson(body)!==manifestHash)throw Error('R3_RUN_MANIFEST_HASH');
 if(m.sourceCommit!==subject.sourceCommit||m.evidence!=='sil'||m.mode!=='simulation'||m.access!=='simulated'||m.backendSetId!=='engineering-rigid-v1'||m.scenario?.id!=='FD01'||m.backendCapability?.evidence!=='sil'||m.backendCapability?.available!==true||e.producer!=='native')throw Error('R3_ENGINEERING_IDENTITY');
 if(!Array.isArray(m.outputs)||new Set(m.outputs.map(f=>f.path)).size!==m.outputs.length)throw Error('R3_OUTPUTS');
 for(const f of m.outputs)if(sha(bytes(root,f.path))!==f.sha256)throw Error('R3_OUTPUT_HASH:'+f.path);
 for(const p of ['engineering-native-evidence.json','native-inventory.json','native-events.jsonl','native-commands.json','journal.json','effects.json'])if(!m.outputs.some(f=>f.path===p))throw Error('R3_OUTPUT_MISSING:'+p);
 const {validNativeProfileReport}=await import('./native-sim/profile-report.mjs'),inventory=read(root,'native-inventory.json');if(inventory.available!==true||!validNativeProfileReport(inventory,profile))throw Error('R3_NATIVE_PROFILE_INVENTORY');
 const api=await tsImport('../packages/lab-runtime/src/v2/sil/engineering-native.ts',import.meta.url);await api.readEngineeringCompiledWorld(join(root,'bundle'));
 const bag=await readEngineeringBag(join(root,'rosbag2'));if(!same(bag,e.bag))throw Error('R3_BAG_REPLAY_MISMATCH');
 for(const f of evidenceInventory(join(root,'rosbag2')))if(!m.outputs.some(x=>x.path==='rosbag2/'+f.file&&x.sha256===f.sha256))throw Error('R3_BAG_NOT_BOUND');
 const events=bytes(root,'native-events.jsonl').toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),rawClock=events.filter(x=>x.event==='clock-mapping').map(x=>x.payload);
 if(rawClock.length<2||!Array.isArray(e.clockMapping)||!e.clockMapping.every(x=>rawClock.some(y=>y.providerSimNs===x.providerSimNs&&y.sourceTick===x.sourceTick)))throw Error('R3_RAW_CLOCK_MAPPING_MISSING');
 const assessment=api.assessEngineeringEvidence({...e,bag});if(assessment.result!=='pass')throw Error('R3_ENGINEERING_COVERAGE:'+assessment.blockers.join(','));
 const journal=read(root,'journal.json'),effects=read(root,'effects.json'),domain=journal.flatMap(x=>x.events),observedCompleted=domain.filter(x=>x.type==='RobotCommandObserved'&&x.state.status==='completed').length;
 if(!Array.isArray(effects)||effects.some(x=>!Number.isSafeInteger(x.attempts)||x.attempts>1))throw Error('R3_COMMAND_REPLAY');
 if(['no-path','cancel','worker-loss'].includes(e.nativeCase)){
  const fault=api.assessEngineeringFault({nativeCase:e.nativeCase,fault:e.fault,status:m.status,served:domain.some(x=>x.type==='DeliveryHandedOff')?'1':'0',effects,observedCompleted});if(fault.result!=='pass')throw Error('R3_FAULT:'+fault.reason);
  if(e.nativeCase==='cancel'?!domain.some(x=>x.type==='RobotCommandObserved'&&x.state.status==='cancelled'):!events.some(x=>x.event==='native-fault'&&x.payload.case===e.nativeCase&&x.payload.status==='applied'))throw Error('R3_RAW_FAULT_MISSING');
 }else{
  const types=domain.map(x=>x.type);if(!['nominal','obstacle'].includes(e.nativeCase)||m.status!=='completed'||!observedCompleted||types.indexOf('CargoLoaded')<0||types.indexOf('DeliveryHandedOff')<=types.indexOf('CargoLoaded'))throw Error('R3_NATIVE_BUSINESS_INCOMPLETE');
  if(e.nativeCase==='obstacle'&&!events.some(x=>x.event==='native-fault'&&x.payload.case==='obstacle'&&x.payload.status==='applied'))throw Error('R3_RAW_FAULT_MISSING');
 }
 return {nativeCase:e.nativeCase,seed:m.seed,runId:m.runId,rawCoverage:'tested',businessFaultReadback:'tested',qualification:'not_run',limitations:['TF_PAYLOAD_AND_COMMAND_CORRELATION_NOT_INDEPENDENTLY_VERIFIED','ISOLATION_INSTALL_TRUST_AND_REPLAY_QUALIFICATION_INCOMPLETE']};
}
export async function readXarmObservation(root,subject,profile){
 evidenceInventory(root);const m=read(root,'run-manifest.json'),{hashJson}=await tsImport('../packages/lab-runtime/src/v2/hash.ts',import.meta.url);
 if(m.sourceCommit!==subject.sourceCommit||m.dirty!==false||m.targetProfileId!==xarmProfile.id||m.subjectProfileId!=='engineering-'+profile.architecture||m.accepted!==false||!['X1','X2'].includes(m.mode)||m.evidenceKind!==xarmProfile.modes[m.mode].evidenceKind||m.profileHash!==hashJson(xarmProfile))throw Error('R3_XARM_IDENTITY');
 if(!Array.isArray(m.artifacts)||new Set(m.artifacts.map(f=>f.path)).size!==m.artifacts.length)throw Error('R3_XARM_ARTIFACTS');
 for(const f of m.artifacts)if(sha(bytes(root,f.path))!==f.sha256)throw Error('R3_XARM_ARTIFACT_HASH');
 const bags=m.artifacts.filter(f=>f.path.startsWith('verified-bag/')&&f.path.endsWith('.db3'));if(!bags.length)throw Error('R3_RAW_BAG_MISSING');
 const required=['source-lifecycle.json','source-command.json','source-outcome.json','native-started.json','source-xarm-journal.json','native-journal.json','mapping.json','expanded.urdf','bag-coverage.json','observations.jsonl'];
 for(const path of required)if(!m.artifacts.some(f=>f.path===path))throw Error('R3_XARM_TRACE_MISSING:'+path);
 const bag=await readEngineeringBag(join(root,'verified-bag'));if(!same(bag,read(root,'bag-coverage.json')))throw Error('R3_BAG_REPLAY_MISMATCH');
 for(const topic of ['/joint_states','/tf','/tf_static','/xarm6_traj_controller/controller_state','/xarm6_traj_controller/follow_joint_trajectory/_action/status',...m.mode==='X2'?['/clock']:[]])if(!bag.topics[topic]?.count)throw Error('R3_XARM_BAG_TOPIC:'+topic);
 const {validateXarmMappingRecord}=await tsImport('../packages/lab-runtime/src/v2/sil/xarm-mapping.ts',import.meta.url),mapping=read(root,'mapping.json');
 if(mapping.evidenceKind!==m.evidenceKind||mapping.mode!==m.mode)throw Error('R3_XARM_MAPPING_KIND');
 validateXarmMappingRecord(bytes(root,'expanded.urdf').toString(),mapping,{sourceCommit:subject.sourceCommit,profileId:m.subjectProfileId,architecture:profile.architecture,modelSha256:profile.modelSha256});
 const samples=bytes(root,'observations.jsonl').toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(x=>x.kind==='sample').map(x=>x.sample);
 if(samples.length<2)throw Error('R3_XARM_ACTUAL_SAMPLES_MISSING');
 for(const [i,s]of samples.entries()){
  if(!s||!Number.isSafeInteger(s.seq)||!Number.isSafeInteger(s.stampNs)||!Number.isSafeInteger(s.clockNs)||s.stampNs<0||s.clockNs<s.stampNs||!Number.isFinite(s.receivedMs)||s.receivedMs<0||!['actualRad','commandedRad','tcpM'].every(k=>Array.isArray(s[k])&&s[k].length===(k==='tcpM'?3:6)&&s[k].every(Number.isFinite)))throw Error('R3_XARM_SAMPLE_INVALID');
  if(i&&(s.seq<=samples[i-1].seq||s.stampNs<=samples[i-1].stampNs||s.clockNs<samples[i-1].clockNs||s.receivedMs<samples[i-1].receivedMs||s.bootId!==samples[0].bootId||s.epoch!==samples[0].epoch))throw Error('R3_XARM_SAMPLE_EPOCH_OR_CLOCK');
 }
 const start=read(root,'native-started.json'),source=read(root,'source-xarm-journal.json'),native=read(root,'native-journal.json'),command=read(root,'source-command.json').command;
 if(start.mode!==m.mode||start.runId!==source.runId||start.runId!==native.runId||start.runId!==command.runId||source.evidenceKind!==m.evidenceKind||native.evidenceKind!==m.evidenceKind||native.bootId!==samples[0].bootId||native.epoch!==samples[0].epoch||native.receipts?.[command.commandId]?.hash!==hashJson(command)||!Array.isArray(source.receipts)||source.receipts.length!==1||!same(source.receipts[0].command,command))throw Error('R3_XARM_RUN_COMMAND_BINDING');
 return {mode:m.mode,nativeCase:m.nativeCase,evidenceKind:m.evidenceKind,modelMapping:'tested',sampleCoverage:'tested',qualification:'not_run',limitations:['CONTROLLER_RESTART_NOT_OBSERVED','COLLISION_PLANNING_NOT_OBSERVED','G2_CONTACT_NOT_OBSERVED','DIRECT_TRAJECTORY_SUMMARY_IS_NOT_QUALIFICATION','BAG_ACTION_PAYLOAD_SEMANTICS_NOT_INDEPENDENTLY_VERIFIED']};
}
export async function readLinuxcncObservation(root,subject){
 evidenceInventory(root);const trace=read(root,'actual-joint-trace.json');if(trace.sourceCommit!==subject.sourceCommit||trace.evidenceKind!=='native_capture')throw Error('R3_LINUXCNC_NATIVE_TRACE_REQUIRED');
 const {validateLinuxcncTrace}=await tsImport('../packages/lab-runtime/src/v2/algorithm/linuxcnc-trace.ts',import.meta.url);const v=validateLinuxcncTrace(trace);
 return {samples:v.trace.samples.length,segments:v.segments,qualification:'not_run',limitations:['CONTROLLER_SAMPLE_TIME_UNAVAILABLE','FIELD_SYNCHRONY_UNAVAILABLE','CONTROLLER_CARTESIAN_DH_TCP_ENDPOINT_NOT_ESTABLISHED','CONTINUOUS_MOTION_AND_ATOMIC_FENCING_NOT_QUALIFIED','TERMINAL_GUI_PACKAGE_TRUST_NOT_QUALIFIED']};
}
