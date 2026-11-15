import {describe,expect,test} from 'vitest';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createXarmSimProvider,xarmProgramHash,xarmNativeCapability,mapXarmJoints,type XarmPort} from '../../packages/lab-runtime/src/v2/sil/xarm-provider';
import {XARM6_SI,forwardKinematics} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import {defaultCatalog,admitBackend} from '../../packages/lab-runtime/src/v2/capabilities';
import type {CellCommand} from '../../packages/cell-adapters/src/contract';
const q=[0,0,-1,0,0,0];
const command=(id='a'):CellCommand=>({commandId:id,runId:'run-1',deviceId:'arm-1',controlEpoch:1,expiresAt:'2099-01-01T00:00:00.000Z',recipeRevision:null,programRef:{id:'motion-probe',hash:xarmProgramHash('motion-probe')},capability:'start_job',payloadHash:'a'.repeat(64),payload:{jobId:'job-1'}});
async function rig(answer:unknown={accepted:true,unknown:false}){
 const directory=await mkdtemp(join(tmpdir(),'xarm-contract-'));let sends=0;const calls:string[]=[];
 const port:XarmPort={request:async(method)=>{calls.push(method);if(method==='execute'){sends++;return answer;}return {status:'unknown',evidence:{}};},close:async()=>{},onSample:()=>()=>{}};
 const provider=await createXarmSimProvider({sourceRoot:resolve('.'),runDirectory:directory,runId:'run-1',deviceId:'arm-1',cellId:'cell-1',mode:'X1',environmentProfile:'engineering-arm64'},port);
 return {provider,calls,sends:()=>sends};
}
describe('xArm native preparation (protocol_double)',()=>{
 test('separate capability and scope; no contact admission',async()=>{
  const {provider}=await rig();expect(provider.evidenceKind).toBe('protocol_double');expect((await provider.adapter.describe()).validation).toBe('simulated');
  expect(xarmNativeCapability().reachable).toBe(false);
  expect(defaultCatalog.backends.find(x=>x.id==='moveit_gazebo_arm')?.reason).toContain('XARM_NATIVE_NOT_QUALIFIED');
  expect(admitBackend('simulation',defaultCatalog.sets['engineering-contact-v1']!.backends,defaultCatalog).ok).toBe(false);
 });
 test('only approved program and current run; no browser trajectory or live IP',async()=>{
  const {provider,sends}=await rig();expect((await provider.adapter.execute({...command(),runId:'other'})).accepted).toBe(false);
  expect((await provider.adapter.execute({...command(),programRef:{id:'grip',hash:'x'}})).accepted).toBe(false);
  expect(sends()).toBe(0);
  await expect(createXarmSimProvider({sourceRoot:resolve('.'),runDirectory:'/tmp',runId:'x',deviceId:'a',cellId:'c',mode:'X1',environmentProfile:'engineering-arm64',robotIp:'127.0.0.1'} as never)).rejects.toThrow('XARM_CONFIG_INVALID');
 });
 test('one flight, duplicate receipt, unknown never resends or completes',async()=>{
  const {provider,sends}=await rig({accepted:false,unknown:true});expect((await provider.adapter.execute(command())).unknown).toBe(true);
  expect((await provider.adapter.execute(command())).unknown).toBe(true);expect(sends()).toBe(1);
  expect((await provider.adapter.execute(command('b'))).unknown).toBe(true);expect(sends()).toBe(1);
  expect((await provider.adapter.reconcile('a')).status).toBe('unknown');
 });
 test('native unavailable is a refusal, never a protocol fallback',async()=>{
  await expect(createXarmSimProvider({sourceRoot:resolve('.'),runDirectory:await mkdtemp(join(tmpdir(),'xarm-native-')),runId:'x',deviceId:'a',cellId:'c',mode:'X2',environmentProfile:'engineering-arm64'})).rejects.toThrow('XARM_NATIVE_NOT_QUALIFIED');
 });
 test('canonical joints have positive radian signs and R2a FK parity',async()=>{
  const golden=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/xarm6-g2-v1/fk-golden.json','utf8'));
  for(const p of golden.poses){const actual=mapXarmJoints(['joint6','joint5','joint4','joint3','joint2','joint1'],[...p.q].reverse());expect(actual).toEqual(p.q);const fk=forwardKinematics(XARM6_SI,actual);expect(Math.hypot(...fk.flange.position.map((n,i)=>n-p.flangeChainM[i]))).toBeLessThan(4e-6);}
  expect(()=>mapXarmJoints(['joint1'],q)).toThrow();expect(()=>mapXarmJoints(['joint1','joint2','joint3','joint4','joint5','joint6'],[0,0,NaN,0,0,0])).toThrow();
 });
});

test('raw URDF mapping is independently checked, including resealed tampering',async()=>{
 const {validateXarmUrdf}=await import('../../packages/lab-runtime/src/v2/sil/xarm-mapping');
 const xml=await readFile('tests/fixtures/xarm-native-protocol.urdf','utf8');
 expect(validateXarmUrdf(xml,'X2').scope).toBe('arm_motion_kinematics_only');
 for(const bad of [xml.replace('0.172','0.142'),xml.replace('name="joint1"','name="joint9"'),xml.replace('xyz="0 0 1"','xyz="0 0 -1"'),xml.replace('mass value="2.7"','mass value="3.7"'),xml.replace('GazeboSimSystem','UFRobotSystemHardware'),xml.replace('</robot>','<joint name="joint1" type="fixed"/></robot>'),'<!DOCTYPE robot [<!ENTITY bad "evil">]>'+xml])expect(()=>validateXarmUrdf(bad,'X2')).toThrow();
});

test('L00 accepts checked arm mapping artifacts independently of unresolved native environment',async()=>{
 const {nativeHandoffFixture}=await import('../fixtures/native-handoff');const {validateNativeHandoff}=await import('../../packages/lab-runtime/src/v2/sil/native-handoff');const {writeFile}=await import('node:fs/promises');
 const f=await nativeHandoffFixture('ros_xarm');
 await f.put('nativeMapping','native/expanded.urdf',await readFile('tests/fixtures/xarm-native-protocol.urdf'),'native-xarm/expanded.urdf');
 await f.put('nativeMapping','native/mapping.json',JSON.stringify({schemaVersion:1,mode:'X2',scope:'arm_motion_kinematics_only',urdfSha256:f.manifest.refs.nativeMapping.at(-1)!.sha256,profileId:'xarm6-jazzy-sim-v1',producer:'native_xarm.robot_description.v1',sourceCommit:f.manifest.subject.sourceCommit,subjectProfileId:f.manifest.profile.id,environmentProfile:'engineering-amd64',sourceModelSha256:f.manifest.profile.modelSha256,vendorCommit:'d837f2e17f7f36043103b367fca3af8172626245',evidenceKind:'protocol_double',syntheticSimModelSelector:'XI13050520BB00'}),'native-xarm/mapping.json');await f.reseal();
 let r=await validateNativeHandoff(f.root,f.manifest);expect(r.prepared).toBe(true);expect(r.issues.map(x=>x.code)).not.toContain('NATIVE_MODEL_MAPPING_UNRESOLVED');expect(r.issues.map(x=>x.code)).toContain('NATIVE_ENGINE_PROFILE_UNRESOLVED');expect(r.nativeReady).toBe(false);
 await writeFile(join(f.root,'native/expanded.urdf'),(await readFile('tests/fixtures/xarm-native-protocol.urdf','utf8')).replace('0.172','0.142'));await f.reseal();r=await validateNativeHandoff(f.root,f.manifest);expect(r.prepared).toBe(false);
});

test('generated artifacts cannot replace immutable portable/native closure members',async()=>{
 const {nativeHandoffFixture}=await import('../fixtures/native-handoff');const {validateNativeHandoff}=await import('../../packages/lab-runtime/src/v2/sil/native-handoff');
 for(const mode of ['ros_xarm','native_apt'] as const){const f=await nativeHandoffFixture(mode);const removed=f.manifest.refs.tool.pop()!;f.manifest.refs.nativeMapping=[removed];await f.put('nativeMapping','native/extra.json','{}','native-xarm/mapping.json');const r=await validateNativeHandoff(f.root,f.manifest);expect(r.issues.map(x=>x.code)).toContain('CLOSURE_FILE_MISSING');if(mode==='native_apt')expect(r.issues.map(x=>x.code)).toContain('NATIVE_CLOSURE_FILE_MISSING');}
});

test('mapping records reject cross-subject/profile/evidence kind even after coherent resealing',async()=>{
 const {validateXarmMappingRecord,validateXarmUrdf}=await import('../../packages/lab-runtime/src/v2/sil/xarm-mapping');const xml=await readFile('tests/fixtures/xarm-native-protocol.urdf','utf8');
 const subject={sourceCommit:'1'.repeat(40),profileId:'engineering-amd64',architecture:'amd64',modelSha256:'0e2f40ef5a4569ea3e76879ed078fffd55d514b42c25c60072ebd7d27af3445a'};
 const record={...validateXarmUrdf(xml,'X2'),producer:'native_xarm.robot_description.v1',sourceCommit:subject.sourceCommit,subjectProfileId:subject.profileId,environmentProfile:'engineering-amd64',sourceModelSha256:subject.modelSha256,vendorCommit:'d837f2e17f7f36043103b367fca3af8172626245',evidenceKind:'gazebo_actual',syntheticSimModelSelector:'XI13050520BB00',controller:{joints:['joint1','joint2','joint3','joint4','joint5','joint6'],commandInterfaces:['position'],stateInterfaces:['position'],srdf:'<robot name="protocol_fixture"/>'}};
 expect(()=>validateXarmMappingRecord(xml,record,subject)).not.toThrow();
 for(const [key,value]of Object.entries({sourceCommit:'2'.repeat(40),subjectProfileId:'other',environmentProfile:'engineering-arm64',sourceModelSha256:'a'.repeat(64),vendorCommit:'3'.repeat(40),evidenceKind:'ros2_fake_system',producer:'browser',syntheticSimModelSelector:'XI13050120BB00',scope:'contact',mode:'X1',urdfSha256:'a'.repeat(64)}))expect(()=>validateXarmMappingRecord(xml,{...record,[key]:value},subject)).toThrow();
});

test('concurrent motion intent permits exactly one transport send',async()=>{
 const {provider,sends}=await rig();const answers=await Promise.all([provider.adapter.execute(command()),provider.adapter.execute(command('b'))]);expect(sends()).toBe(1);expect(answers.filter(a=>a.accepted)).toHaveLength(1);
});

test('fixed server CLI records real native refusal with separate motion/contact outcomes',async()=>{
 const {runXarmCase}=await import('../../packages/lab-runtime/src/v2/sil/xarm-cli');
 const directory=await mkdtemp(join(tmpdir(),'xarm-case-'));
 const result=await runXarmCase({sourceRoot:resolve('.'),out:join(directory,'X2'),mode:'X2',environmentProfile:'engineering-arm64',nativeCase:'nominal'});
 expect(result.motion).toMatchObject({status:'not_run',result:'blocked_external'});expect(result.contact.status).toBe('not_run');expect(result.accepted).toBe(false);
 const manifest=JSON.parse(await readFile(join(directory,'X2','run-manifest.json'),'utf8'));expect(manifest.sourceCommit).toMatch(/^[a-f0-9]{40}$/);expect(manifest.motion.reason).toContain('XARM_NATIVE_NOT_QUALIFIED');
});

test('native mapping requires explicit G2/1305 mesh readback',async()=>{
 const {validateXarmUrdf}=await import('../../packages/lab-runtime/src/v2/sil/xarm-mapping');const xml=await readFile('tests/fixtures/xarm-native-protocol.urdf','utf8');
 expect(()=>validateXarmUrdf(xml.replace(/<link [\s\S]*?<\/link>/g,''),'X2')).toThrow();
});

test('a late result cannot revive Source completion after close',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'xarm-late-'));let reply:((value:unknown)=>void)|undefined;
 const port:XarmPort={request:async(method)=>method==='execute'?{accepted:true,unknown:false}:new Promise(r=>{reply=r;}),close:async()=>{},onSample:()=>()=>{}};
 const p=await createXarmSimProvider({sourceRoot:resolve('.'),runDirectory:directory,runId:'run-1',deviceId:'arm-1',cellId:'cell-1',mode:'X1',environmentProfile:'engineering-arm64'},port);
 await p.adapter.execute(command());const query=p.adapter.reconcile('a');await p.close();reply!({status:'completed',evidence:{}});expect((await query).status).toBe('unknown');
});
