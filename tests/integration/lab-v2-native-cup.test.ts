// Portable protocol_double; native LinuxCNC/Gazebo execution is not_run.
import {afterEach,expect,test} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LinuxcncArmAdapter,type ArmProfile,type SimSceneUpdate} from '../../packages/lab-runtime/src/v2/arm/adapter';
import {validateArmCommand,type ArmCommand} from '../../packages/lab-runtime/src/v2/contracts';
import {ArmBridgeDouble} from '../support/arm-bridge-double';
const directories:string[]=[];const temporary=(prefix:string)=>{const d=mkdtempSync(join(tmpdir(),prefix));directories.push(d);return d;};afterEach(()=>{for(const d of directories.splice(0))rmSync(d,{recursive:true,force:true});});
const runId='3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c';
const profile=()=>JSON.parse(readFileSync('integrations/arm-controller/configs/sim/puma560/profile.json','utf8')) as ArmProfile;
const scene:SimSceneUpdate={runId,worldRevision:'world-r1',sceneSeq:'9007199254740993',transferId:'transfer-1',commandId:'cmd-1',cup:{id:'cup-1',present:true,positionM:[.4,.1,.2]},receiver:null,faults:[]};
function setup(native=false){const p=profile(),port=new ArmBridgeDouble(p,()=>1793865600000);const adapter=new LinuxcncArmAdapter({port,profile:p,runId,cellId:'coffee-1',deviceId:'arm-1',nowMs:()=>1793865600000,journalPath:join(temporary('native-cup-'),'arm.sqlite'),...native?{simulationScene:{worldRevision:'world-r1'}}:{}});return {port,adapter};}
test('strict one shape and bounded scene context, no arbitrary HAL or nonfinite geometry',async()=>{
 const {port,adapter}=setup();await adapter.open();const acquire=port.log[0]!;
 expect(validateArmCommand({...acquire,simScene:scene}).ok).toBe(false);
 const base={...acquire};delete base.acquire;expect(validateArmCommand({...base,simScene:scene}).ok).toBe(true);
 for(const simScene of [{...scene,cup:{...scene.cup,positionM:[NaN,0,0]}},{...scene,faults:['raw_hal']},{...scene,halcmd:'setp motion.digital-out-00 1'}]){
  const msg={...base,simScene} as unknown as ArmCommand;expect(validateArmCommand(msg).ok).toBe(false);
 }
 await adapter.close();
});
test('old bridge refuses negotiated scene before any job or scene send',async()=>{
 const {port,adapter}=setup(true);await expect(adapter.open()).rejects.toThrow('SIM_SCENE_CAPABILITY_REQUIRED');expect(port.sends).toBe(0);expect(port.log.some(m=>m.simScene)).toBe(false);await adapter.close();
});
test('scene ACK cannot manufacture transfer proof; simulation pin enforced on client',async()=>{
 const {port,adapter}=setup(true);port.simulationSceneCapability=true;await adapter.open();
 const reports:unknown[]=[];adapter.observe(r=>reports.push(r));await adapter.updateSimScene(scene);expect(reports).toEqual([]);
 await expect(adapter.updateSimScene({...scene,runId:'other'})).rejects.toThrow('SIM_SCENE_PIN_MISMATCH');
 await expect(adapter.updateSimScene(scene)).rejects.toThrow('SIM_SCENE_SEQUENCE_REPLAY');await adapter.close();
});

test('duplicate arm attachment cannot widen contact windows or silently hold a second cup',async()=>{
 const {createArmSession,loadArmModel,tsChecker}=await import('../../packages/lab-runtime/src/v2/arm/session');
 const s=createArmSession({model:loadArmModel('integrations/arm-controller/models/puma560-reference'),checker:tsChecker(),entityId:'arm-1',runId,providerId:'protocol_double',staleMs:500});
 s.attach('cup-1',2,{parent:'arm:arm-1/tcp'});s.attach('cup-1',3,{parent:'arm:arm-1/tcp'});expect(s.attachments()).toHaveLength(1);expect(s.attachments()[0]!.fromTick).toBe(2);
 expect(()=>s.attach('cup-2',3,{parent:'arm:arm-1/tcp'})).toThrow('ARM_ATTACHMENT_CONFLICT');
});
test('unknown cup state removes nozzle availability and never falls back to a nozzle obstacle',async()=>{
 const {createPlantSession}=await import('../../packages/lab-runtime/src/v2/beverage/plant-session');const {createCupLedger}=await import('../../packages/lab-runtime/src/v2/beverage/cup-ledger');
 const pending={runId,cupId:'cup-1',transferId:'t-1',commandId:'c-1',payloadHash:'a'.repeat(64),controlEpoch:1,deviceId:'arm-1',to:{kind:'arm' as const,id:'arm-1'}};
 const ledger=createCupLedger({path:join(temporary('unknown-cup-'),'cup.sqlite'),runId,nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>({pending,parent:'cell:coffee-1/nozzle'}),confirm:async()=>{throw new Error('unexpected confirm');}});
 const s=createPlantSession({runId,cellId:'coffee-1',armId:'arm-1',nowMs:()=>0,ledger,receiver:()=>null,dock:()=>({robotId:'amr-1',errorM:0,moving:false,localizationValid:true,bootId:'gz-1'}),traySensor:()=>false});s.plant.placeCup('cup-1','paper');
 const identity:Omit<typeof pending,'to'>={...pending};delete (identity as Partial<typeof pending>).to;await expect(s.observeTransfer({...identity,observationId:'unknown-1',observerId:'linuxcnc-grip:b1',bootId:'b1',seq:'1',producer:'linuxcnc_virtual_grip',fidelity:'modeled',phase:'grasp',parent:null,grip:null,clockDomain:'controller-clock',observedMonotonicNs:'10',receivedMonotonicNs:'10',quality:'unknown'})).rejects.toThrow('PHYSICAL_UNKNOWN');
 expect(s.plant.cup('cup-1')!.at).toBe('taken');expect(s.attachments('cup-1').physical.parent).toBeNull();expect(s.cupObstacles()).toEqual([]);ledger.close();
});

test('a modeled drop after confirmed grasp clears attachment while domain custody needs reconciliation',async()=>{
 const {createCupLedger}=await import('../../packages/lab-runtime/src/v2/beverage/cup-ledger');
 const pending={runId,cupId:'cup-1',transferId:'t-1',commandId:'c-1',payloadHash:'a'.repeat(64),controlEpoch:1,deviceId:'arm-1',to:{kind:'arm' as const,id:'arm-1'}};
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:coffee-1/nozzle'};
 const ledger=createCupLedger({path:join(temporary('drop-cup-'),'cup.sqlite'),runId,nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm:async()=>{domain={pending:null,parent:'arm:arm-1/tcp'};}});
 const identity:Omit<typeof pending,'to'>={...pending};delete (identity as Partial<typeof pending>).to;const grasp={...identity,observationId:'held-1',observerId:'linuxcnc-grip:b1',bootId:'b1',seq:'1',producer:'linuxcnc_virtual_grip' as const,fidelity:'modeled' as const,phase:'grasp' as const,parent:'arm:arm-1/tcp',grip:{closed:true,objectPresent:true},clockDomain:'controller-clock',observedMonotonicNs:'10',receivedMonotonicNs:'10',quality:'valid' as const,liftPoseReached:true};
 await ledger.ingest(grasp);expect(domain.pending).toBeNull();
 await expect(ledger.ingest({...grasp,observationId:'lost-2',seq:'2',phase:'lost',parent:null,grip:{closed:true,objectPresent:false}})).rejects.toThrow('PHYSICAL_UNKNOWN');
 expect(ledger.snapshot()[0]).toMatchObject({parent:null,status:'lost'});expect(domain.parent).toBe('arm:arm-1/tcp');ledger.close();
});

test('sampled grip has a durable outbox with original receipt; restart never reissues motion',async()=>{
 const p=profile(),port=new ArmBridgeDouble(p,()=>1793865600000);port.simulationSceneCapability=true;
 const path=join(temporary('grip-outbox-'),'arm.sqlite'),options={port,profile:p,runId,cellId:'coffee-1',deviceId:'arm-1',nowMs:()=>1793865600000,journalPath:path,simulationScene:{worldRevision:'world-r1'}};
 let adapter=new LinuxcncArmAdapter(options);const reports:import('../../packages/cell-adapters/src/contract').CellReport[]=[];adapter.observe(r=>reports.push(r));await adapter.open();
 const {hashPayload}=await import('../../packages/contracts/src/canonical');const payload={jobId:'job-1'};
 const command={commandId:'cmd-1',runId,deviceId:'arm-1',controlEpoch:1,expiresAt:new Date(1793865630000).toISOString(),recipeRevision:null,programRef:{id:'cup-pick',hash:p.programs['cup-pick']!.sha256},capability:'start_job',payloadHash:hashPayload(payload),payload} as import('../../packages/cell-adapters/src/contract').CellCommand;
 expect(await adapter.execute(command)).toEqual({accepted:true,unknown:false});
 const proof={observationId:'grip-proof-1',runId,cupId:'cup-1',transferId:'transfer-1',commandId:'cmd-1',payloadHash:command.payloadHash,deviceId:'arm-1',observerId:'linuxcnc-grip:ctl-double-1',bootId:'ctl-double-1',controlEpoch:1,seq:'1',producer:'linuxcnc_virtual_grip' as const,fidelity:'modeled' as const,phase:'grasp' as const,parent:'arm:arm-1/tcp',grip:{closed:true,objectPresent:true},clockDomain:'controller-monotonic:ctl-double-1',observedMonotonicNs:'10',receivedMonotonicNs:'10',quality:'valid' as const,liftPoseReached:true};
 port.emitGrip(command,proof);const original=reports.find(r=>r.evidence?.transferObservation)!;expect(original).toBeDefined();const receipt=adapter.completionReceipt(proof.observationId);expect(receipt).not.toBe('10');port.emitGrip(command,{...proof,parent:null,quality:'unknown'});expect(reports.at(-1)!.status?.reasonCodes).toEqual(['OBSERVATION_ID_CONFLICT']);
 await adapter.close();adapter=new LinuxcncArmAdapter(options);const restored:typeof reports=[];adapter.observe(r=>restored.push(r));await adapter.open();await adapter.recover();
 expect(restored.find(r=>r.evidence?.transferObservation)).toEqual(original);expect(adapter.completionReceipt(proof.observationId)).toBe(receipt);expect(port.sends).toBe(1);
 adapter.acknowledgeCompletion(command.commandId,proof.observationId);await adapter.close();adapter=new LinuxcncArmAdapter(options);const final:typeof reports=[];adapter.observe(r=>final.push(r));await adapter.open();await adapter.recover();expect(final.some(r=>r.evidence?.transferObservation)).toBe(false);expect(port.sends).toBe(1);await adapter.close();
});

test('reference handoff checks the actual asset chassis/tray with a bounded release window',async()=>{
 const {createArmSession,loadArmModel,tsChecker,modeledCupCenter}=await import('../../packages/lab-runtime/src/v2/arm/session');
 const f=JSON.parse(readFileSync('integrations/arm-controller/configs/sim/puma560/cup-geometry.json','utf8')) as {worldFromArmBaseM:[number,number,number];poses:Record<string,{qDeg:number[];positionM:[number,number,number];cupCenterWorldM:number[]}>;nativeCandidate:{dockPositionM:number[]}};
 const model=loadArmModel('integrations/arm-controller/models/puma560-reference'),s=createArmSession({model,checker:tsChecker(),entityId:'arm-1',runId,providerId:'protocol_double',staleMs:500});
 for(const [i,name] of ['pick-approach','pick','lift','tray-approach','place','retreat'].entries()){const p=f.poses[name]!,q=p.qDeg.map(v=>v*Math.PI/180);expect(modeledCupCenter(model,q,p.positionM,f.worldFromArmBaseM)).toEqual(p.cupCenterWorldM.map(v=>expect.closeTo(v,8)));
  s.ingest({seq:String(i+1),bootId:'b1',controllerEpoch:1,observedAt:null,task:{state:'on',interp:'running',homed:true,fault:null},joints:{actualRad:q,commandedRad:q},tcp:{positionM:p.positionM},program:{id:'cup-place',state:'running'}},'1');}
 s.attach('cup-1',1,{parent:'arm:arm-1/tcp'});s.attach('cup-1',2,{parent:'arm:arm-1/tcp'});s.detach('cup-1',4,{receiverId:'amr-1',parent:'robot:amr-1/tray:1'});
 const world=[{id:'robot:amr-1',pos:[0,0,.2],size:[.6,.55,.15]},{id:'tray:amr-1',pos:[0,0,.5],size:[.4,.45,.02]}].map(b=>{const c=b.pos.map((v,i)=>v+f.nativeCandidate.dockPositionM[i]!-f.worldFromArmBaseM[i]!);return {id:b.id,kind:'box' as const,min:c.map((v,i)=>v-b.size[i]!/2) as [number,number,number],max:c.map((v,i)=>v+b.size[i]!/2) as [number,number,number]};});
 const record=await s.collisionEvidence({world,worldRevision:{id:'native-reference',revision:1,hash:'a'.repeat(64)},assetRef:{id:'service-robot-sil',revision:1}});expect(record.result).toBe('pass');expect(record.allowedContacts).toEqual([{pair:['held-cup','tray:amr-1'],phase:'release',fromTick:3,toTick:5,revision:1}]);expect(record.attachments).toHaveLength(1);
});
