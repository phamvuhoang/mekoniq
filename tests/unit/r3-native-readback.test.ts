import {expect,test} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {ENGINEERING_TOPICS} from '../../packages/lab-runtime/src/v2/sil/engineering-native';
// @ts-expect-error plain ESM artifact reader
import {readEngineeringBag,readEngineeringObservation,readXarmObservation,readLinuxcncObservation} from '../../scripts/r3-native-readback.mjs';
// @ts-expect-error plain ESM artifact inventory
import {evidenceInventory} from '../../scripts/r2b-readback.mjs';
type Doc=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const commit='1'.repeat(40),sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex'),hex='a'.repeat(64);
async function engineering(){
 const root=await mkdtemp(join(tmpdir(),'r3-engineering-fixture-')),put=async(p:string,v:unknown)=>{await mkdir(join(root,p,'..'),{recursive:true});await writeFile(join(root,p),typeof v==='string'?v:JSON.stringify(v));};
 const p=spawnSync(resolve('.venv-irsim/bin/python'),['-m','compiler.engineering_native','--project',resolve('robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json'),'--out',join(root,'bundle')],{cwd:resolve('robotics/simulation'),encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:15000});expect(p.status,p.stderr).toBe(0);
 await mkdir(join(root,'rosbag2'));const db=new DatabaseSync(join(root,'rosbag2/observations.db3'));db.exec('CREATE TABLE topics(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE messages(id INTEGER PRIMARY KEY,topic_id INTEGER,timestamp INTEGER,data BLOB)');let id=0;for(const [i,topic]of ENGINEERING_TOPICS.entries()){db.prepare('INSERT INTO topics VALUES(?,?)').run(i,topic);for(let j=0;j<11;j++)db.prepare('INSERT INTO messages VALUES(?,?,?,?)').run(++id,i,1_000_000_000+j*100_000_000,Buffer.from('synthetic CDR fixture'));}db.close();
 const bag=await readEngineeringBag(join(root,'rosbag2')),clockMapping=[{providerSimNs:'1000000000',sourceTick:0,receiveMonotonicNs:'100'},{providerSimNs:'2000000000',sourceTick:50,receiveMonotonicNs:'1000000100'}];
 const inventory:Doc={id:'engineering-amd64',available:true,reasonCodes:[],installation:'native_apt',headless:true,image:null,profileSha256:hex,inventorySha256:hex,actual:{platform:'linux',arch:'amd64',os:'ubuntu24.04',packages:{ros:'fixture'},digests:{'/fixture':hex},aptProvenance:{sources:{'/fixture':hex}},runtime:{rosDistro:'jazzy',amentPrefixes:[],overlayManifests:{},pythonPath:'',libraryPath:'',gazeboPluginPath:'',executables:Object.fromEntries(['ros2','gz','python3'].map(k=>[k,{path:'/fixture/'+k,sha256:hex}]))}}};
 await put('engineering-native-evidence.json',{producer:'native',nativeCase:'nominal',clockMapping,bag,blockers:[]});await put('native-inventory.json',inventory);await put('native-events.jsonl',clockMapping.map(payload=>JSON.stringify({event:'clock-mapping',payload})).join('\n'));await put('native-commands.json',{commands:[]});await put('journal.json',[{events:[{type:'CargoLoaded',state:{}},{type:'RobotCommandObserved',state:{status:'completed'}},{type:'DeliveryHandedOff',state:{}}]}]);await put('effects.json',[{attempts:1}]);
 const m:Doc={sourceCommit:commit,runId:'synthetic-r3',evidence:'sil',mode:'simulation',access:'simulated',backendSetId:'engineering-rigid-v1',scenario:{id:'FD01'},backendCapability:{evidence:'sil',available:true},status:'completed',seed:7};
 const seal=async()=>{m.outputs=evidenceInventory(root).filter((f:Doc)=>f.file!=='run-manifest.json'&&!f.file.startsWith('bundle/')).map((f:Doc)=>({path:f.file,sha256:f.sha256}));const {manifestHash:old,...body}=m;void old;m.manifestHash=hashJson(body);await put('run-manifest.json',m);};await seal();
 return {root,m,inventory,put,seal,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('R3 engineering adapter replays copied SQLite bytes and supported observations without promoting them to a complete native case',async()=>{
 const f=await engineering();try{const before=sha(await readFile(join(f.root,'rosbag2/observations.db3')));expect(await readEngineeringObservation(f.root,{sourceCommit:commit},'engineering-amd64')).toMatchObject({rawCoverage:'tested',businessFaultReadback:'tested',qualification:'not_run'});expect(sha(await readFile(join(f.root,'rosbag2/observations.db3')))).toBe(before);}finally{await f.cleanup();}
});
test.each(['unavailable inventory','missing bag','missing raw clock','fake evidence','wrong source','wrong architecture','replayed command','skipped raw topic'])('R3 engineering rejects %s after complete coherent artifact reseal',async mutation=>{
 const f=await engineering();try{
  if(mutation==='unavailable inventory'){await f.put('native-inventory.json',{...f.inventory,available:false,reasonCodes:['INVENTORY_UNRESOLVED']});}
  if(mutation==='missing bag')await rm(join(f.root,'rosbag2/observations.db3'));
  if(mutation==='missing raw clock')await f.put('native-events.jsonl','');
  if(mutation==='fake evidence')f.m.evidence='protocol_double';
  if(mutation==='wrong source')f.m.sourceCommit='e'.repeat(40);
  if(mutation==='wrong architecture'){f.inventory.actual.arch='arm64';await f.put('native-inventory.json',f.inventory);}
  if(mutation==='replayed command')await f.put('effects.json',[{attempts:2}]);
  if(mutation==='skipped raw topic'){const db=new DatabaseSync(join(f.root,'rosbag2/observations.db3'));db.exec('DELETE FROM messages WHERE topic_id=0');db.close();const e=JSON.parse(await readFile(join(f.root,'engineering-native-evidence.json'),'utf8'));e.bag=await readEngineeringBag(join(f.root,'rosbag2'));await f.put('engineering-native-evidence.json',e);}
  await f.seal();await expect(readEngineeringObservation(f.root,{sourceCommit:commit},'engineering-amd64')).rejects.toThrow();
 }finally{await f.cleanup();}
});
test('R3 arm readers reject summary-only contact, absent raw controller traces and foreign branch evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'r3-arm-reader-'));try{
  await writeFile(join(root,'run-manifest.json'),JSON.stringify({sourceCommit:commit,dirty:false,targetProfileId:'xarm6-jazzy-sim-v1',subjectProfileId:'engineering-amd64',accepted:false,mode:'X2',evidenceKind:'gazebo_actual',profileHash:hashJson((await import('../../robotics/manipulation/profiles/xarm6-jazzy-sim.json')).default),motion:{result:'pass'},contact:{result:'pass'},artifacts:[]}));await expect(readXarmObservation(root,{sourceCommit:commit},{architecture:'amd64'})).rejects.toThrow('R3_RAW_BAG_MISSING');
  await expect(readLinuxcncObservation(root,{sourceCommit:commit})).rejects.toThrow();await writeFile(join(root,'actual-joint-trace.json'),JSON.stringify({sourceCommit:commit,evidenceKind:'protocol_double',backend:'xarm'}));await expect(readLinuxcncObservation(root,{sourceCommit:commit})).rejects.toThrow('R3_LINUXCNC_NATIVE_TRACE_REQUIRED');
 }finally{await rm(root,{recursive:true,force:true});}
});

async function xarm(){
 const f=await engineering(),profile=(await import('../../robotics/manipulation/profiles/xarm6-jazzy-sim.json')).default,target=(await import('../../robotics/manipulation/profiles/xarm6-native-mapping.json')).default;
 const {cp}=await import('node:fs/promises');await cp(join(f.root,'rosbag2'),join(f.root,'verified-bag'),{recursive:true});const db=new DatabaseSync(join(f.root,'verified-bag/observations.db3'));
 const topics=['/clock','/joint_states','/tf','/tf_static','/xarm6_traj_controller/controller_state','/xarm6_traj_controller/follow_joint_trajectory/_action/status'];for(const [i,topic]of topics.entries())db.prepare('UPDATE topics SET name=? WHERE id=?').run(topic,i);db.close();await f.put('bag-coverage.json',await readEngineeringBag(join(f.root,'verified-bag')));
 const xml=await readFile('tests/fixtures/xarm-native-protocol.urdf','utf8');await f.put('expanded.urdf',xml);
 const {validateXarmUrdf}=await import('../../packages/lab-runtime/src/v2/sil/xarm-mapping');const mapping={...validateXarmUrdf(xml,'X2'),producer:'native_xarm.robot_description.v1',sourceCommit:commit,subjectProfileId:'engineering-amd64',environmentProfile:'engineering-amd64',sourceModelSha256:target.sourceModelSha256,vendorCommit:profile.vendorCommit,syntheticSimModelSelector:profile.syntheticSimModelSelector,evidenceKind:profile.modes.X2.evidenceKind,controller:{joints:profile.jointMap.map(j=>j.native),commandInterfaces:['position'],stateInterfaces:['position'],srdf:'<robot name="unit"/>'}};await f.put('mapping.json',mapping);
 const command={commandId:'c1',runId:'xarm-X2-nominal'},sample=(i:number)=>({seq:i+1,bootId:'boot',epoch:1,receivedMs:1000+i*100,stampNs:1000000000+i*100000000,clockNs:1000000000+i*100000000,actualRad:[0,0,-1,0,0,0],commandedRad:[0,0,-1,0,0,0],tcpM:[0,0,0]});
 await f.put('observations.jsonl',[0,1].map(i=>JSON.stringify({kind:'sample',sample:sample(i)})).join('\n'));await f.put('source-command.json',{command,ack:{accepted:true,unknown:false}});await f.put('source-outcome.json',{status:'completed'});await f.put('source-lifecycle.json',{startup:'ready'});await f.put('native-started.json',{runId:command.runId,mode:'X2'});await f.put('native-journal.json',{runId:command.runId,bootId:'boot',epoch:1,evidenceKind:profile.modes.X2.evidenceKind,receipts:{c1:{hash:hashJson(command),status:'completed'}}});await f.put('source-xarm-journal.json',{runId:command.runId,mode:'X2',evidenceKind:profile.modes.X2.evidenceKind,receipts:[{command,status:'completed'}]});
 const m:Doc={sourceCommit:commit,dirty:false,targetProfileId:profile.id,subjectProfileId:'engineering-amd64',profileHash:hashJson(profile),accepted:false,mode:'X2',nativeCase:'nominal',evidenceKind:profile.modes.X2.evidenceKind};
 const seal=async()=>{m.artifacts=evidenceInventory(f.root).filter((r:Doc)=>r.file!=='run-manifest.json').map((r:Doc)=>({path:r.file,sha256:r.sha256}));await f.put('run-manifest.json',m);};await seal();return {...f,m,mapping,seal,profile:{architecture:'amd64',modelSha256:target.sourceModelSha256}};
}
test('R3 xArm reader recomputes pinned model and raw sample coverage while preserving unqualified native scope',async()=>{
 const f=await xarm();try{expect(await readXarmObservation(f.root,{sourceCommit:commit},f.profile)).toMatchObject({mode:'X2',modelMapping:'tested',sampleCoverage:'tested',qualification:'not_run'});}finally{await f.cleanup();}
});
test.each(['fake producer','wrong mapping','missing actual samples','crossed run'])('R3 xArm reader refuses %s after coherent artifact reseal',async mutation=>{
 const f=await xarm();try{if(mutation==='fake producer')f.m.evidenceKind='protocol_double';if(mutation==='wrong mapping'){f.mapping.sourceModelSha256=hex;await f.put('mapping.json',f.mapping);}if(mutation==='missing actual samples')await f.put('observations.jsonl','');if(mutation==='crossed run')await f.put('native-started.json',{runId:'other-run',mode:'X2'});await f.seal();await expect(readXarmObservation(f.root,{sourceCommit:commit},f.profile)).rejects.toThrow();}finally{await f.cleanup();}
});

test('R3 LinuxCNC validates the exact supplied actual-joint format but never promotes a native_capture label or numeric summary to ALG04',async()=>{
 const root=await mkdtemp(join(tmpdir(),'r3-cnc-fixture-'));try{
  const digest=async(p:string)=>sha(await readFile(p)),base='integrations/arm-controller/',model='models/puma560-reference/';
  const trace={schemaVersion:1,kind:'linuxcnc_actual_joint_trace',backend:'linuxcnc_sim',provenance:'controller_sim',evidenceKind:'native_capture',sourceCommit:commit,controller:{version:'unit-only',identityMethod:'linux-proc-boot-id-pid-starttime'},model:{id:'puma560-reference',manifestSha256:await digest(base+model+'manifest.json'),dhSha256:await digest(base+model+'modified-dh.json'),framesSha256:await digest(base+model+'frames.json'),profileSha256:await digest(base+'configs/sim/puma560/profile.json'),baseFrame:'arm_base',tcpFrame:'tcp',toolRevision:'tool-0-notool'},units:{rawJoint:'deg',joint:'rad',receiveTime:'ns'},clock:{receive:'host_monotonic',controller:'unavailable'},samples:[0,1].map(i=>({sequence:i,epoch:'boot:task:'+i,receiveMonotonicNs:[String(100+i*100),String(110+i*100)],controllerTime:null,synchrony:'unavailable',actual:{sampleId:'a'+i,rawDeg:[0,0,0,0,0,0],rad:[0,0,0,0,0,0]},commanded:{sampleId:'c'+i,rawDeg:[0,0,0,0,0,0],rad:[0,0,0,0,0,0]}}))};
  await writeFile(join(root,'actual-joint-trace.json'),JSON.stringify(trace));await writeFile(join(root,'algorithm-results.json'),JSON.stringify({numericVerdict:'pass',verdict:'pass'}));
  const r=await readLinuxcncObservation(root,{sourceCommit:commit});expect(r.qualification).toBe('not_run');expect(r.segments).toHaveLength(2);expect(r.limitations).toContain('CONTROLLER_SAMPLE_TIME_UNAVAILABLE');
  trace.model.id='xarm6';await writeFile(join(root,'actual-joint-trace.json'),JSON.stringify(trace));await expect(readLinuxcncObservation(root,{sourceCommit:commit})).rejects.toThrow('PUMA_MODEL_FRAME_HASH_MISMATCH');
 }finally{await rm(root,{recursive:true,force:true});}
});
