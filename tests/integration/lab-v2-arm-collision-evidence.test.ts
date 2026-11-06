// A05 / ARM03: the arm session hands the plan 02 geometric checker a joint trace, frame/model/scene hashes, cup attachment windows and the
// transfer phase, and turns the checked intervals into an evidence record. Nominal clear, self-collision, held-cup collision between clear
// endpoints, phase-scoped allowed contact, geometry revision mismatch, incomplete trace and an unavailable checker are all exercised; the
// Python checker (plan 02 SIM-05) is compared when its interpreter is present. Illustrative geometry: never a physical claim.
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {expect,test} from 'vitest';
import {createArmSession,loadArmModel,tsChecker,pythonChecker,buildArmCollisionEvidence,type ArmCheckerPort,type ArmStatusLike} from '../../packages/lab-runtime/src/v2/arm/session';
import {validateEvidenceV2} from '../../packages/lab-runtime/src/v2/contracts';
import {checkArmSweep,DEFAULT_ARM_GEOMETRY,type ArmObstacle} from '../../packages/lab-runtime/src/v2/models/arm-collision';
import {forwardKinematics} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
import {qrotate} from '../../packages/lab-runtime/src/v2/frames';
import {scenarioMatrix,validateMatrix} from '../../packages/lab-runtime/src/v2/scenario-matrix';
const MODEL=loadArmModel('integrations/arm-controller/models/puma560-reference'),RUN='3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c';
const WORLD={id:'coffee-cell-world',revision:3,hash:'0'.repeat(64)},ASSET={id:'arm-puma-reference',revision:1,contentHash:'f'.repeat(64)};
const deg=(v:number)=>v*Math.PI/180;
const status=(seq:number,actual:number[]|null,commanded=actual):ArmStatusLike=>({seq:String(seq),bootId:'b1',observedAt:new Date(Date.parse('2026-11-05T08:00:00Z')+seq*50).toISOString(),controllerEpoch:1,task:{state:'on',interp:'running',homed:true,fault:null},joints:{actualRad:actual,commandedRad:commanded},tcp:null,program:{id:'cup-pick',state:'running'}});
function session(checker:ArmCheckerPort=tsChecker()){return createArmSession({model:MODEL,checker,entityId:'arm-1',runId:RUN,providerId:'linuxcnc_sim',staleMs:500});}
const path=(from:number[],to:number[],n:number)=>Array.from({length:n+1},(_,i)=>from.map((q,k)=>q+(to[k]!-q)*i/n));
const cupMid=(q:number[])=>{const fk=forwardKinematics(MODEL,q),z=qrotate(fk.tcp.quaternionXyzw,[0,0,DEFAULT_ARM_GEOMETRY.gripperLengthM+DEFAULT_ARM_GEOMETRY.cupHeightM/2]);return fk.tcp.position.map((v,i)=>v+z[i]!) as [number,number,number];};

test('nominal clear path over the controller trace passes with the checker identity, coverage and span',async()=>{
 const s=session();path([0,deg(-30),deg(20),0,deg(45),0],[deg(40),deg(-30),deg(20),0,deg(45),0],8).forEach((q,i)=>s.ingest(status(i,q),'1'));
 const r=await s.collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET});
 expect(r).toMatchObject({id:'ARM03',result:'pass',reasonCodes:[],engine:'capsule-sweep-v1',modelRevision:MODEL.revision,worldRevision:WORLD,trace:{samples:9,fromTick:0,toTick:8},coverage:{intervals:8,uncertain:0},provenance:'geometric_checker',fidelity:'modeled'});
 expect(r.colliding).toEqual([]);expect(r.attachments).toEqual([]);expect(r.method).toMatchObject({kind:'adaptive-subdivision'});
});

test('self-collision of non-adjacent links is detected and named',async()=>{
 let found:number[]|null=null;
 for(const q2 of [-200,-180,-150,-120,-90]){for(const q3 of [-215,-200,-180,-150,-120,-90,-45]){for(const q5 of [-100,-45,0,45,100]){
  const q=[0,deg(q2),deg(q3),0,deg(q5),0],r=checkArmSweep(MODEL,q,q,{world:[]});
  if(!r.ok&&r.reason==='COLLISION'&&r.pair!.every(p=>p.startsWith('link-'))){found=q;break;}}if(found)break;}if(found)break;}
 expect(found,'a folded configuration that self-collides in the capsule model').not.toBeNull();
 const s=session();[found!,found!].forEach((q,i)=>s.ingest(status(i,q),'1'));
 const r=await s.collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET});
 expect(r.result).toBe('fail');expect(r.colliding[0]!.pair.every(p=>p.startsWith('link-'))).toBe(true);expect(r.reasonCodes).toEqual(['COLLISION']);
});

test('a held cup hits a fixture between two clear endpoints; the same path without the cup is clear',async()=>{
 const a=[deg(-20),deg(-30),deg(20),0,deg(45),0],b=[deg(20),deg(-30),deg(20),0,deg(45),0],mid=cupMid([0,deg(-30),deg(20),0,deg(45),0]);
 const world:ArmObstacle[]=[{id:'fixture:tray-edge',kind:'sphere',center:mid,radiusM:0.01}];
 const held=session();path(a,b,4).forEach((q,i)=>held.ingest(status(i,q),'1'));held.attach('cup-1',0,{parent:'arm:arm-1/tcp'});
 const r=await held.collisionEvidence({world,worldRevision:WORLD,assetRef:ASSET});
 expect(r.result).toBe('fail');expect(r.colliding[0]).toMatchObject({pair:['held-cup','fixture:tray-edge']});expect(r.colliding[0]!.interval.fromTick).toBeGreaterThanOrEqual(1);
 expect(r.attachments).toEqual([{cupId:'cup-1',fromTick:0,toTick:4}]);
 const empty=session();path(a,b,4).forEach((q,i)=>empty.ingest(status(i,q),'1'));
 expect((await empty.collisionEvidence({world,worldRevision:WORLD,assetRef:ASSET})).result).toBe('pass');
});

test('a grasp-phase contact between the gripper and the cup at the nozzle is allowed only inside its window; the cup leaves the world once attached',async()=>{
 const approach=[0,deg(-30),deg(20),0,deg(45),0],grasp=[0,deg(-32),deg(22),0,deg(45),0],lift=[0,deg(-40),deg(20),0,deg(45),0];
 // the cup sits where the held cup will be (clear of the last link, touching the gripper tip): gripper radius 0.02 + 0.03 > the 0.045 m gap
 const fk=forwardKinematics(MODEL,grasp),z=qrotate(fk.tcp.quaternionXyzw,[0,0,DEFAULT_ARM_GEOMETRY.gripperLengthM+DEFAULT_ARM_GEOMETRY.cupHeightM/2]);
 const world:ArmObstacle[]=[{id:'cup:cup-1',kind:'sphere',center:fk.tcp.position.map((v,i)=>v+z[i]!) as [number,number,number],radiusM:0.03}];
 const bare=session();[approach,grasp,lift].forEach((q,i)=>bare.ingest(status(i,q),'1'));
 const r0=await bare.collisionEvidence({world,worldRevision:WORLD,assetRef:ASSET});
 expect(r0.result).toBe('fail');expect(r0.colliding[0]!.pair).toEqual(['gripper','cup:cup-1']);
 const s=session();[approach,grasp,lift].forEach((q,i)=>s.ingest(status(i,q),'1'));s.attach('cup-1',1,{parent:'arm:arm-1/tcp'});
 const r=await s.collisionEvidence({world,worldRevision:WORLD,assetRef:ASSET});
 expect(r.result).toBe('pass');expect(r.allowedContacts).toEqual([{pair:['gripper','cup:cup-1'],phase:'grasp',fromTick:0,toTick:1,revision:WORLD.revision},{pair:['held-cup','cup:cup-1'],phase:'grasp',fromTick:0,toTick:1,revision:WORLD.revision}]);
 expect(r.coverage!.allowedContactsApplied).toBeGreaterThan(0);expect(r.attachments).toEqual([{cupId:'cup-1',fromTick:1,toTick:2}]);
 expect(s.transferPhase(0)).toBe('approach');expect(s.transferPhase(1)).toBe('grasp');expect(s.transferPhase(2)).toBe('carry');
});

test('a geometry revision mismatch, an incomplete trace or an unavailable checker is not_run, never a pass',async()=>{
 const s=session();s.setScene({revision:'scene-A'});path([0,deg(-30),deg(20),0,deg(45),0],[deg(10),deg(-30),deg(20),0,deg(45),0],2).forEach((q,i)=>s.ingest(status(i,q),'1'));
 expect(await s.collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET,sceneRevision:'scene-B'})).toMatchObject({result:'not_run',reasonCodes:['GEOMETRY_REVISION_MISMATCH:scene-A!=scene-B']});
 expect((await s.collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET,sceneRevision:'scene-A'})).result).toBe('pass');
 const gap=session();[0,1,2].forEach(i=>gap.ingest(status(i,i===1?null:[0,deg(-30),deg(20),0,deg(45),0]),'1'));
 expect(await gap.collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET})).toMatchObject({result:'not_run',reasonCodes:['TRACE_INCOMPLETE:1']});
 expect(await session().collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET})).toMatchObject({result:'not_run',reasonCodes:['TRACE_EMPTY']});
 const off=session({describe:()=>({engine:'none',available:false,reason:'CHECKER_NOT_INSTALLED'}),check:async()=>{throw new Error('unreachable');}});
 [0,1].forEach(i=>off.ingest(status(i,[0,deg(-30),deg(20),0,deg(45),0]),'1'));
 expect(await off.collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET})).toMatchObject({result:'not_run',reasonCodes:['CHECKER_UNAVAILABLE:CHECKER_NOT_INSTALLED']});
});

test('the ARM03 evidence record is schema-valid, carries the matrix requirements and the record result; the ARM rows validate',async()=>{
 const s=session();path([0,deg(-30),deg(20),0,deg(45),0],[deg(10),deg(-30),deg(20),0,deg(45),0],2).forEach((q,i)=>s.ingest(status(i,q),'1'));
 const record=await s.collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET});
 const e=buildArmCollisionEvidence({schemaHash:'b'.repeat(64),runId:RUN,inputs:{projectHash:'a'.repeat(64),sourceCommit:'c'.repeat(40),seed:1,mode:'simulation',access:'simulated',backends:['gazebo_nav2','linuxcnc_sim','coffee_io_sim']},record});
 expect(validateEvidenceV2(e).ok).toBe(true);
 expect(e).toMatchObject({id:`ARM03:${RUN}:arm-collision`,scenarioId:'ARM03',result:'pass',actualFidelity:'modeled',requirementIds:scenarioMatrix.find(r=>r.id==='ARM03')!.requirementIds});
 expect(e.assertions.map(a=>a.id)).toEqual(['any-collision','self-collision','scene-collision','attached-cup-swept-path','coverage']);
 for(const id of ['ARM01','ARM02','ARM03','ARM04','ARM05','ARM06'])expect(scenarioMatrix.find(r=>r.id===id),id).toMatchObject({cell:true,backendSupport:{mock:true,simulation:true,hardware:false}});
 expect(validateMatrix(scenarioMatrix,{exists:p=>existsSync(p)})).toEqual({ok:true,issues:[]});
 expect(buildArmCollisionEvidence({schemaHash:'b'.repeat(64),runId:RUN,inputs:{projectHash:'a'.repeat(64),sourceCommit:'c'.repeat(40),seed:1,mode:'simulation',access:'simulated',backends:[]},record:{...record,result:'not_run',reasonCodes:['CHECKER_UNAVAILABLE:X']}})).toMatchObject({result:'not_run'});
});

test('the evidence result follows the checker record: an unclassified colliding pair can never pass, and a fail stays a fail',async()=>{
 const s=session();path([0,deg(-30),deg(20),0,deg(45),0],[deg(10),deg(-30),deg(20),0,deg(45),0],2).forEach((q,i)=>s.ingest(status(i,q),'1'));
 const record=await s.collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET});
 const inputs={projectHash:'a'.repeat(64),sourceCommit:'c'.repeat(40),seed:1,mode:'simulation' as const,access:'simulated' as const,backends:['linuxcnc_sim']};
 // a pair outside every name bucket (upper arm vs gripper; an obstacle id without a known prefix) must still fail the record
 for(const pair of [['link-3','gripper'],['gripper','obstacle-without-prefix']] as [string,string][]){
  const failed={...record,result:'fail' as const,reasonCodes:['COLLISION'],colliding:[{pair,reason:'COLLISION',fraction:0.5,clearanceM:-0.01,interval:{fromTick:0,toTick:1}}]};
  const e=buildArmCollisionEvidence({schemaHash:'b'.repeat(64),runId:RUN,inputs,record:failed});
  expect(e.result,pair.join('/')).toBe('fail');expect(e.assertions.find(a=>a.id==='any-collision')).toMatchObject({passed:false,detail:expect.stringContaining(pair.join('/'))});
 }
 const uncertain={...record,result:'fail' as const,reasonCodes:['SWEEP_UNCERTAIN'],colliding:[{pair:['link-2','fixture:x'] as [string,string],reason:'SWEEP_UNCERTAIN',fraction:0.5,clearanceM:0.0001,interval:{fromTick:0,toTick:1}}]};
 expect(buildArmCollisionEvidence({schemaHash:'b'.repeat(64),runId:RUN,inputs,record:uncertain}).result).toBe('fail');
 expect(buildArmCollisionEvidence({schemaHash:'b'.repeat(64),runId:RUN,inputs,record}).assertions.map(a=>a.id)).toEqual(['any-collision','self-collision','scene-collision','attached-cup-swept-path','coverage']);
});

const PY=resolve('.venv/bin/python'),pyOk=existsSync(PY)&&spawnSync(PY,['-c','import rfc8785'],{encoding:'utf8'}).status===0;
test.skipIf(!pyOk)('the Python checker of plan 02 agrees with the TypeScript port on the clear and the held-cup cases',async()=>{
 const py=pythonChecker({python:PY,simDir:resolve('robotics/simulation')});
 expect(py.describe()).toMatchObject({engine:'capsule-sweep-py-v1',available:true});
 const a=[deg(-20),deg(-30),deg(20),0,deg(45),0],b=[deg(20),deg(-30),deg(20),0,deg(45),0],mid=cupMid([0,deg(-30),deg(20),0,deg(45),0]);
 const world:ArmObstacle[]=[{id:'fixture:tray-edge',kind:'sphere',center:mid,radiusM:0.01}];
 for(const [checker,engine] of [[tsChecker(),'capsule-sweep-v1'],[py,'capsule-sweep-py-v1']] as const){
  const s=session(checker);path(a,b,4).forEach((q,i)=>s.ingest(status(i,q),'1'));s.attach('cup-1',0,{parent:'arm:arm-1/tcp'});
  const r=await s.collisionEvidence({world,worldRevision:WORLD,assetRef:ASSET});
  expect(r,engine).toMatchObject({result:'fail',engine});expect(r.colliding[0]!.pair,engine).toEqual(['held-cup','fixture:tray-edge']);
  const clear=session(checker);path(a,b,4).forEach((q,i)=>clear.ingest(status(i,q),'1'));
  expect((await clear.collisionEvidence({world:[],worldRevision:WORLD,assetRef:ASSET})).result,engine).toBe('pass');
 }
},30000);
