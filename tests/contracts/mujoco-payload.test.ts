import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import type {LoadProfileV1} from '../../packages/contracts/generated/navigation2d';
import {validateLoadProfile} from '../../packages/lab-runtime/src/v2/simulation3d/load-profile';
import {sealDocument,validateNavigationDocument,validateSim3DResponse} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
type Prop=LoadProfileV1['props'][number];
type FreeProp=Omit<Prop,'attachment'>&{attachment:Extract<Prop['attachment'],{kind:'free'}>};
type TestProfile=Omit<LoadProfileV1,'props'>&{props:FreeProp[];hidden?:boolean};
const fixture=():TestProfile=>JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/serve-payload-v1/cup-center.json','utf8'));
test('the generated free cup profile is admissible',()=>expect(validateLoadProfile(fixture())).toEqual({ok:true,reasonCodes:[]}));
test.each([
 ['non-positive mass',(p:TestProfile)=>{p.props[0]!.massKg=0;},'LOAD_MASS_INVALID'],
 ['negative mass',(p:TestProfile)=>{p.props[0]!.massKg=-1;},'LOAD_MASS_INVALID'],
 ['impossible inertia',(p:TestProfile)=>{p.props[0]!.inertiaKgM2=[1,0,0,1,0,3];},'LOAD_INERTIA_INVALID'],
 ['unnormalized quaternion',(p:TestProfile)=>{p.props[0]!.attachment.initialPoseInSupport.quaternionXyzw=[0,0,0,2];},'QUATERNION_NOT_NORMALIZED'],
 ['duplicate prop',(p:TestProfile)=>{p.props.push(p.props[0]!);},'LOAD_DUPLICATE_PROP'],
 ['unsupported footprint',(p:TestProfile)=>{p.props[0]!.attachment.initialPoseInSupport.positionM[1]=0.22;},'LOAD_OUTSIDE_SUPPORT'],
 ['path escape',(p:TestProfile)=>{p.modelRef.path='../escape.json';},'LOAD_SCHEMA_INVALID'],
 ['nine props',(p:TestProfile)=>{p.props=Array.from({length:9},(_,i)=>({...p.props[0]!,propId:`cup-${i}`}));},'LOAD_SCHEMA_INVALID'],
 ['unknown field',(p:TestProfile)=>{p.hidden=true;},'LOAD_SCHEMA_INVALID'],
 ['non-finite mass',(p:TestProfile)=>{p.props[0]!.massKg=Infinity;},'LOAD_MASS_INVALID'],
] as const)('rejects %s',(_,mutate,code)=>{const p=fixture();mutate(p);const value=sealDocument(p,'digest');expect(validateLoadProfile(value)).toEqual({ok:false,reasonCodes:[code]});});
test('rejects a stale content digest',()=>{const p=fixture();p.revision++;expect(validateLoadProfile(p).reasonCodes).toContain('DIGEST_MISMATCH');});
test('MuJoCo navigation requires profile refs and retains the physical projection hash',()=>{
 const s=JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/serve-payload-v1/navigation-scene.json','utf8'));
 expect(s.engine).toMatchObject({timestepMs:2,substeps:10});expect(validateNavigationDocument(s).ok).toBe(true);delete s.engine.loadProfileRef;expect(validateNavigationDocument(sealDocument(s,'sceneDigest')).ok).toBe(false);
});
test('physics observations accept bounded records and reject more than 256 contact pairs',()=>{
 const physics={schemaVersion:1,tick:0,simTimeNs:'0',contacts:[],loads:[],wheels:[],odometry:[],base:[]};
 const response={protocol:'mekoniq-sim3d/1',requestId:'r',runId:'run',bootId:'boot',tick:0,ok:true,result:{schemaVersion:1,runId:'run',bootId:'boot',tick:0,seq:'0',simTimeNs:'0',sceneDigest:'a'.repeat(64),robots:[],physics}};
 expect(validateSim3DResponse(response).ok).toBe(true);
 const contact={a:'floor',b:'wheel',samples:10,peakNormalN:1,normalImpulseNs:0.02,netImpulseMapNs:[0,0,0.02],pointAtPeakMapM:[0,0,0],expected:true};
 expect(validateSim3DResponse({...response,result:{...response.result,physics:{...physics,contacts:Array(257).fill(contact)}}}).ok).toBe(false);
});
test('a mobile world refuses a second AMR before compilation',()=>{
 const s=JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/serve-payload-v1/navigation-scene.json','utf8'));
 const r=structuredClone(s.robots[0]);r.robotId='amr-2';r.model=sealDocument({...r.model,robotId:'amr-2'},'modelDigest');s.robots.push(r);
 expect(validateNavigationDocument(sealDocument(s,'sceneDigest')).ok).toBe(false);
});
test('MuJoCo substep duration must multiply to the logical tick',()=>{
 const s=JSON.parse(readFileSync('robotics/simulation-mujoco/fixtures/serve-payload-v1/navigation-scene.json','utf8'));s.engine.substeps=9;
 const result=validateNavigationDocument(sealDocument(s,'sceneDigest'));
 expect(result.ok?[]:result.issues.map(i=>i.code)).toContain('PHYSICS_CLOCK_MISMATCH');
});
