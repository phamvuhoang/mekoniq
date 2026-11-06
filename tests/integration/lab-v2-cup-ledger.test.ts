import {existsSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
import {createPlantSession} from '../../packages/lab-runtime/src/v2/beverage/plant-session';
import {cleanupRuns,runDirectory} from '../support/lab-v2';
import {createCupTransferRig} from '../support/beverage-transfer-lab';
import {cleanupCoffee,STATION,ARM} from '../support/coffee';
import type {JsonObject} from '../../packages/contracts/src/index';
import type {PendingTransferIdentity,CorrelatedTransferEvidence} from '../../packages/lab-runtime/src/v2/beverage/cup-ledger';
import type {TransferObservation} from '../../packages/contracts/generated/lab-v2';
afterEach(cleanupRuns);
afterEach(cleanupCoffee);
const observation:TransferObservation={liftPoseReached:true,observationId:'obs-1',runId:'run-1',cupId:'cup-1',transferId:'transfer-1',commandId:'command-1',payloadHash:'0'.repeat(64),deviceId:'arm-1',observerId:'arm-observer',bootId:'boot-1',controlEpoch:1,seq:'1',producer:'mock_arm',fidelity:'modeled',phase:'grasp',parent:'arm:arm-1/tcp',grip:{closed:true,objectPresent:true},clockDomain:'mock-1',observedMonotonicNs:'10',receivedMonotonicNs:'10',quality:'valid'};
const pending={runId:'run-1',cupId:'cup-1',transferId:'transfer-1',commandId:'command-1',payloadHash:'0'.repeat(64),controlEpoch:1,deviceId:'arm-1',to:{kind:'arm' as const,id:'arm-1'}};
const options={runId:'run-1',cellId:'cell-1',armId:'arm-1',nowMs:()=>0,receiver:()=>null,dock:()=>({robotId:'amr-1',errorM:0,moving:false,localizationValid:true,bootId:'amr-boot'}),traySensor:()=>false};
async function module(){expect(existsSync('packages/lab-runtime/src/v2/beverage/cup-ledger.ts')).toBe(true);return import('../../packages/lab-runtime/src/v2/beverage/cup-ledger');}
test('an unobserved cup has unknown parent instead of an invented nozzle',()=>{
 const session=createPlantSession(options);expect(session.attachments('unknown')).toMatchObject({physical:{parent:null},resolved:false});
});
test('projection has one parent, replay is stable, and unknown/lost clear the parent',async()=>{
 const {applyCupObservation}=await module();
 const held=applyCupObservation([],observation);expect(held).toEqual([{cupId:'cup-1',parent:'arm:arm-1/tcp',status:'known',lastObservationId:'obs-1'}]);
 expect(applyCupObservation(held,observation)).toEqual(held);
 const unknown=applyCupObservation(held,{...observation,observationId:'obs-2',seq:'2',quality:'unknown'});expect(unknown[0]).toMatchObject({parent:null,status:'unknown'});
 expect(applyCupObservation(held,{...observation,observationId:'obs-3',seq:'3',phase:'lost',parent:null})[0]).toMatchObject({parent:null,status:'lost'});
 expect(()=>applyCupObservation(held,{...observation,observationId:'obs-4',phase:'grasp',parent:'robot:amr-1/tray:1'})).toThrow('PARENT');
});
test('durable journal replays a crash after projection and before domain confirm, preserving dedupe and ordering',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'};
 const effects:string[]=[],confirm=vi.fn(async()=>{domain={pending:null,parent:'arm:arm-1/tcp'};});
 const base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,applyEffect:async(o:TransferObservation)=>{if(!effects.includes(o.observationId))effects.push(o.observationId);},confirm};
 let journal=createCupLedger({...base,afterCommit:()=>{throw new Error('CRASH_AFTER_PROJECTION');}});
 await expect(journal.ingest(observation)).rejects.toThrow('CRASH_AFTER_PROJECTION');expect(journal.snapshot()[0]).toMatchObject({parent:'arm:arm-1/tcp'});expect(confirm).not.toHaveBeenCalled();journal.close();
 journal=createCupLedger(base);await journal.recover();expect(effects).toEqual(['obs-1']);expect(confirm).toHaveBeenCalledTimes(1);
 await journal.ingest(observation);expect(confirm).toHaveBeenCalledTimes(1);
 await expect(journal.ingest({...observation,parent:null})).rejects.toThrow('OBSERVATION_ID_CONFLICT');
 domain={pending,parent:'cell:cell-1/nozzle'};
 await expect(journal.ingest({...observation,observationId:'obs-2',seq:'0'})).rejects.toThrow('SEQUENCE');
 await expect(journal.ingest({...observation,observationId:'obs-2',seq:'2',controlEpoch:0})).rejects.toThrow('INVALID_TRANSFER_OBSERVATION');
 await expect(journal.ingest({...observation,observationId:'obs-2',seq:'2',quality:'stale'})).rejects.toThrow('INVALID_TRANSFER_OBSERVATION');
 journal.close();
});
test('recovery queries domain after confirm committed and refuses conflicting custody without resending a command',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'},crash=true,effects=0,confirmations=0;
 const base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,applyEffect:async()=>{effects++;},confirm:async()=>{confirmations++;domain={pending:null,parent:'arm:arm-1/tcp'};if(crash)throw new Error('CRASH_AFTER_DOMAIN');}};
 let journal=createCupLedger(base);await expect(journal.ingest(observation)).rejects.toThrow('CRASH_AFTER_DOMAIN');journal.close();crash=false;
 journal=createCupLedger(base);await journal.recover();expect(confirmations).toBe(1);expect(effects).toBe(1);journal.close();
 const second=join(dirname(path),'conflict.db');domain={pending,parent:'cell:cell-1/nozzle'};journal=createCupLedger({...base,path:second,afterCommit:()=>{throw new Error('CUT');}});await expect(journal.ingest(observation)).rejects.toThrow('CUT');journal.close();
 domain={pending:null,parent:'robot:other/tray:1'};journal=createCupLedger({...base,path:second});await expect(journal.recover()).rejects.toThrow('CUP_RECONCILE_REQUIRED');expect(confirmations).toBe(1);journal.close();
});
test('plant projection persists before takeCup and idempotently removes nozzle obstacle after reopen',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'};
 const base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm:async()=>{domain={pending:null,parent:'arm:arm-1/tcp'};}};
 let journal=createCupLedger({...base,afterCommit:()=>{throw new Error('CUT');}});
 let session=createPlantSession({...options,ledger:journal});session.plant.placeCup('cup-1','paper');
 await expect(session.observeTransfer(observation)).rejects.toThrow('CUT');const coffeeState=structuredClone(session.plant.state);journal.close();
 journal=createCupLedger(base);session=createPlantSession({...options,coffeeState,ledger:journal});const take=vi.spyOn(session.plant,'takeCup');await session.recover();await session.observeTransfer(observation);
 expect(take).toHaveBeenCalledTimes(1);expect(session.plant.cup('cup-1')?.at).toBe('taken');expect(session.attachments('cup-1')).toMatchObject({physical:{parent:'arm:arm-1/tcp'}});
 expect(session.cupObstacles()).toEqual([]);journal.close();
});
test('independent tray evidence and fresh matching dock are required before release confirms custody',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 const p={...pending,to:{kind:'robot' as const,id:'amr-1',slot:1}};
 let domain:{pending:typeof p|null;parent:string|null}={pending:p,parent:'arm:arm-1/tcp'};
 const confirm=vi.fn(async(_e:unknown)=>{domain={pending:null,parent:'robot:amr-1/tray:1'};});
 const dock={robotId:'amr-1',slot:1,bootId:'amr-boot',stationary:true,localizationValid:true,errorM:0,receivedMonotonicNs:'10'};
 let journal=createCupLedger({path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm,dock:()=>dock});
 const release={...observation,phase:'release' as const,parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false}};
 await journal.ingest(release);expect(confirm).not.toHaveBeenCalled();journal.close();
 journal=createCupLedger({path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm,dock:()=>dock});
 const receiver={...release,phase:'receive' as const,observationId:'tray-1',deviceId:'amr-1',observerId:'tray-observer',producer:'mock_amr' as const,bootId:'amr-boot',clockDomain:'tray-clock',grip:null};
 await journal.ingest(receiver);expect(confirm).toHaveBeenCalledTimes(1);expect(confirm.mock.calls[0]?.[0]).toMatchObject({giver:release,receiver,dock});journal.close();
});
test('journal detects old duplicate ids after intervening observations and observer reboot across restart',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 const p={...pending,to:{kind:'robot' as const,id:'amr-1',slot:1}},release={...observation,phase:'release' as const,parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false}};
 const base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>({pending:p,parent:'arm:arm-1/tcp'}),confirm:async()=>{}};
 let journal=createCupLedger(base);await journal.ingest({...release,seq:'9007199254740993'});await journal.ingest({...release,observationId:'obs-2',seq:'9007199254740994'});journal.close();
 journal=createCupLedger(base);await journal.ingest({...release,seq:'9007199254740993'});expect(journal.snapshot()).toHaveLength(1);
 await expect(journal.ingest({...release,seq:'9007199254740993',grip:null})).rejects.toThrow('OBSERVATION_ID_CONFLICT');
 await expect(journal.ingest({...release,observationId:'obs-3',seq:'1',bootId:'reboot'})).rejects.toThrow('OBSERVER_CHANGED');journal.close();
});
test('legacy controller completion flags never create a grasp or take a coffee cup',async()=>{
 let listener:((r:import('../../packages/cell-adapters/src/contract').CellReport)=>void)|undefined;
 const adapter={observe:(l:typeof listener)=>{listener=l;return ()=>{};}} as import('../../packages/cell-adapters/src/contract').CellAdapter;
 const arm={capability:()=>({armController:'test-controller'}),trace:()=>[],attach:vi.fn(),detach:vi.fn()} as unknown as import('../../packages/lab-runtime/src/v2/arm/session').ArmSession;
 const session=createPlantSession({...options,arm:{adapter,session:arm}});session.plant.placeCup('cup-1','paper');
 listener!({deviceId:'arm-1',bootId:'boot-1',seq:'1',observedAt:'1970-01-01T00:00:00Z',observation:{schemaVersion:2,commandId:'arbitrary',deviceId:'arm-1',payloadHash:'0'.repeat(64),controlEpoch:1,bootId:'boot-1',seq:'1',result:'completed',observedAt:null,reasonCodes:[]},evidence:{cupId:'cup-1',gripperClosed:true,objectPresent:true,source:'test'}});
 expect(session.attachments('cup-1')).toMatchObject({physical:{parent:'cell:cell-1/nozzle'}});expect(session.plant.cup('cup-1')?.at).toBe('nozzle');expect(arm.attach).not.toHaveBeenCalled();
});
test('a callback without a source custody commit cannot mark an observation confirmed',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 const journal=createCupLedger({path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>({pending,parent:'cell:cell-1/nozzle'}),confirm:async()=>{}});
 await expect(journal.ingest(observation)).rejects.toThrow('CUP_RECONCILE_REQUIRED:DOMAIN_CONFIRM_NOT_COMMITTED');journal.close();
});
test('recovery applies receiver effects before confirming a paired release after its projection cut',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 const p={...pending,to:{kind:'robot' as const,id:'amr-1',slot:1}},release={...observation,phase:'release' as const,parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false}},receiver={...release,phase:'receive' as const,observationId:'tray',observerId:'tray-observer',deviceId:'amr-1',bootId:'tray-boot',producer:'mock_amr' as const,grip:null};
 let domain:{pending:typeof p|null;parent:string|null}={pending:p,parent:'arm:arm-1/tcp'},cut=false;
 const applied:string[]=[],base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,dock:()=>({robotId:'amr-1',slot:1,bootId:'robot-boot',stationary:true,localizationValid:true,errorM:0,receivedMonotonicNs:'10'}),applyEffect:async(o:TransferObservation)=>{applied.push(o.phase);},confirm:async()=>{expect(applied).toEqual(['release','receive']);domain={pending:null,parent:'robot:amr-1/tray:1'};}};
 let journal=createCupLedger({...base,afterCommit:()=>{if(cut)throw new Error('CUT');}});await journal.ingest(release);cut=true;await expect(journal.ingest(receiver)).rejects.toThrow('CUT');journal.close();
 journal=createCupLedger(base);await journal.recover();expect(domain.pending).toBeNull();journal.close();
});
test('plant restores finished journal effects from an older plant checkpoint without re-confirming',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'};const confirm=vi.fn(async()=>{domain={pending:null,parent:'arm:arm-1/tcp'};});
 const base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm};
 let journal=createCupLedger(base),session=createPlantSession({...options,ledger:journal});session.plant.placeCup('cup-1','paper');const before=session.checkpoint();await session.observeTransfer(observation);journal.close();
 journal=createCupLedger(base);session=createPlantSession({...options,state:before,ledger:journal});await session.recover();expect(session.plant.cup('cup-1')?.at).toBe('taken');expect(session.cupObstacles()).toEqual([]);expect(confirm).toHaveBeenCalledTimes(1);journal.close();
});
test('unknown physical state stays parentless through checkpoint and a release adds one tray obstacle at its world transform',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let domain:{pending:typeof pending|{to:{kind:'robot';id:string;slot:number}}&Omit<typeof pending,'to'>|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'};
 const ledger=createCupLedger({path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm:async()=>{domain={pending:null,parent:'arm:arm-1/tcp'};}});
 let session=createPlantSession({...options,ledger,parentTransform:()=>({translationM:[2,3,0.5],quaternionXyzw:[0,0,0,1]})});session.plant.placeCup('cup-1','paper');await session.observeTransfer(observation);
 domain={pending:{...pending,transferId:'place',commandId:'place-command',to:{kind:'robot',id:'amr-1',slot:2}},parent:'arm:arm-1/tcp'};
 await session.observeTransfer({...observation,observationId:'release',transferId:'place',commandId:'place-command',seq:'2',phase:'release',parent:'robot:amr-1/tray:2',grip:{closed:false,objectPresent:false}});
 expect(session.cupObstacles()).toEqual([{id:'cup:cup-1',kind:'sphere',center:[2,3,0.5],radiusM:0.035}]);
 await expect(session.observeTransfer({...observation,observationId:'unknown',transferId:'place',commandId:'place-command',seq:'3',phase:'lost',quality:'unknown',parent:null})).rejects.toThrow('PHYSICAL_UNKNOWN');
 expect(session.attachments('cup-1')).toMatchObject({physical:{parent:null},resolved:false});const state=session.checkpoint();ledger.close();
 session=createPlantSession({...options,state});expect(session.attachments('cup-1')).toMatchObject({physical:{parent:null},resolved:false});
});
test('an older plant checkpoint is rebuilt before retrying a domain confirmation with committed effects',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'},cut=true;
 let session:ReturnType<typeof createPlantSession>;
 const base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm:async()=>{expect(session.plant.cup('cup-1')?.at).toBe('taken');if(cut)throw new Error('CUT_BEFORE_DOMAIN');domain={pending:null,parent:'arm:arm-1/tcp'};}};
 let ledger=createCupLedger(base);session=createPlantSession({...options,ledger});session.plant.placeCup('cup-1','paper');const checkpoint=session.checkpoint();await expect(session.observeTransfer(observation)).rejects.toThrow('CUT_BEFORE_DOMAIN');ledger.close();cut=false;
 ledger=createCupLedger(base);session=createPlantSession({...options,state:checkpoint,ledger});await session.recover();expect(domain.pending).toBeNull();ledger.close();
});
test('controller observations are queued, envelope-correlated and drained once before physical changes',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let listener:((r:import('../../packages/cell-adapters/src/contract').CellReport)=>void)|undefined;
 const adapter={observe:(l:typeof listener)=>{listener=l;return ()=>{};}} as import('../../packages/cell-adapters/src/contract').CellAdapter;
 const attached:import('../../packages/lab-runtime/src/v2/arm/session').ArmAttachment[]=[];
 const arm={capability:()=>({armController:'test-controller'}),trace:()=>[],attachments:()=>attached,attach:vi.fn((cupId:string,tick:number,a:{parent:string})=>attached.push({cupId,fromTick:tick,toTick:null,parent:a.parent})),detach:vi.fn()} as unknown as import('../../packages/lab-runtime/src/v2/arm/session').ArmSession;
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'};
 const ledger=createCupLedger({path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm:async()=>{domain={pending:null,parent:'arm:arm-1/tcp'};}});
 const session=createPlantSession({...options,ledger,arm:{adapter,session:arm}});session.plant.placeCup('cup-1','paper');
 const report={deviceId:'arm-1',bootId:'boot-1',seq:'1',observedAt:'1970-01-01T00:00:00Z',observation:{schemaVersion:2 as const,commandId:'wrong',deviceId:'arm-1',payloadHash:'0'.repeat(64),controlEpoch:1,bootId:'boot-1',seq:'1',result:'completed' as const,observedAt:null,reasonCodes:[]},evidence:{transferObservation:observation,source:'test'}};
 listener!(report);expect(session.plant.cup('cup-1')?.at).toBe('nozzle');await expect(session.drainTransfers()).rejects.toThrow('TRANSFER_REPORT_IDENTITY_MISMATCH');expect(ledger.observations()).toEqual([]);ledger.close();
});
test('same pending identity with reordered object properties still correlates persisted giver and receiver',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 const p={...pending,to:{kind:'robot' as const,id:'amr-1',slot:1}},release={...observation,phase:'release' as const,parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false}},receiver={...release,phase:'receive' as const,observationId:'tray',observerId:'tray-observer',deviceId:'amr-1',producer:'mock_amr' as const,grip:null};
 let domain:{pending:typeof p|null;parent:string|null}={pending:p,parent:'arm:arm-1/tcp'},count=0;
 const ledger=createCupLedger({path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,dock:()=>({robotId:'amr-1',slot:1,bootId:'robot-boot',stationary:true,localizationValid:true,errorM:0,receivedMonotonicNs:'10'}),confirm:async()=>{count++;domain={pending:null,parent:'robot:amr-1/tray:1'};}});
 await ledger.ingest(release);domain={...domain,pending:Object.fromEntries(Object.entries(p).reverse()) as typeof p};await ledger.ingest(receiver);expect(count).toBe(1);ledger.close();
});
test('an unresolved unknown observation prevents later receipts from silently choosing custody',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'};
 const ledger=createCupLedger({path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm:async()=>{domain={pending:null,parent:'arm:arm-1/tcp'};}});
 await expect(ledger.ingest({...observation,quality:'unknown',parent:null})).rejects.toThrow('PHYSICAL_UNKNOWN');
 await expect(ledger.ingest({...observation,observationId:'obs-2',seq:'2'})).rejects.toThrow('PHYSICAL_UNKNOWN');expect(ledger.snapshot()[0]).toMatchObject({parent:null,status:'unknown'});ledger.close();
});
test('journal restart completes the real SQLite beverage domain transfer once using the two existing confirmation sides',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 const rig=await createCupTransferRig();
 try{
  await rig.pickVerifiedCup();await rig.armReleaseAck();
  const domain=async()=>{
   const cup=await rig.cup(),p=cup.pendingTransfer as JsonObject|null;
   return {pending:p?{runId:'run-1',cupId:'cup-1',transferId:String(p.transferId),commandId:String(p.commandId),payloadHash:String(p.payloadHash),controlEpoch:Number(p.controlEpoch),deviceId:ARM,to:{kind:'robot' as const,id:'amr-1',slot:1}}:null,parent:cup.ownerKind==='robot'?`robot:${String(cup.ownerId)}/tray:${String(cup.slot)}`:`arm:${String(cup.ownerId)}/tcp`};
  };
  const p=(await domain()).pending!,release={...observation,...p,observationId:'real-release',phase:'release' as const,parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false}};
  // Identity is from the domain's pending command; observations remain explicitly modeled test inputs.
  const {to:_to,...giver}=release;void _to;
  const receiver={...giver,observationId:'real-tray',phase:'receive' as const,deviceId:'amr-1',observerId:'tray-observer',producer:'mock_amr' as const,grip:null};
  let cut=false,confirmations=0;
  const base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain,dock:()=>({robotId:'amr-1',slot:1,bootId:rig.state.bootId,stationary:true,localizationValid:true,errorM:0.01,receivedMonotonicNs:'10'}),confirm:async(value:TransferObservation|CorrelatedTransferEvidence,identity:PendingTransferIdentity)=>{
   expect('giver' in value).toBe(true);confirmations++;
   const evidence=value as CorrelatedTransferEvidence;
   for(const side of ['giver','receiver'] as const){
    const o=evidence[side],result=await rig.venue.submit('Cup.ConfirmTransfer',{stationId:STATION,transferId:identity.transferId,cupId:identity.cupId,provenance:'sensor',side,evidence:{commandId:o.commandId,transferId:o.transferId,bootId:o.bootId,seq:o.seq,observedAt:new Date(rig.venue.now()).toISOString(),...side==='giver'?{released:true}:{receiverPresent:true,dockInTolerance:true,poseErrorM:evidence.dock.errorM},producer:o.producer,fidelity:o.fidelity}},`observer:${side==='giver'?ARM:'amr-1'}`);
    expect(result.status).toBe('accepted');
   }
  }};
  let ledger=createCupLedger({...base,afterCommit:()=>{if(cut)throw new Error('CUT');}});await ledger.ingest(giver);expect(await rig.cupOwner()).toBe('arm:arm-1');cut=true;await expect(ledger.ingest(receiver)).rejects.toThrow('CUT');ledger.close();
  ledger=createCupLedger(base);await ledger.recover();await ledger.ingest(receiver);expect(confirmations).toBe(1);expect(await rig.cupOwner()).toBe('robot:amr-1');expect((await rig.cup()).movements).toHaveLength(2);ledger.close();
 }finally{await rig.close();}
});
test('a cut immediately after takeCup reopens with the taken checkpoint and never takes the cup twice',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'};
 const base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm:async()=>{domain={pending:null,parent:'arm:arm-1/tcp'};}};
 let ledger=createCupLedger(base),session=createPlantSession({...options,ledger});session.plant.placeCup('cup-1','paper');
 const take=session.plant.takeCup.bind(session.plant),firstTake=vi.spyOn(session.plant,'takeCup').mockImplementationOnce(cupId=>{take(cupId);throw new Error('CUT_AFTER_TAKE');});
 await expect(session.observeTransfer(observation)).rejects.toThrow('CUT_AFTER_TAKE');expect(firstTake).toHaveBeenCalledTimes(1);const state=session.checkpoint();ledger.close();
 ledger=createCupLedger(base);session=createPlantSession({...options,state,ledger});const nextTake=vi.spyOn(session.plant,'takeCup');await session.recover();expect(nextTake).not.toHaveBeenCalled();expect(domain.pending).toBeNull();expect(session.plant.cup('cup-1')?.at).toBe('taken');ledger.close();
});
test('physical grasp without lift keeps domain pending until a fresh matching lift observation, without another takeCup',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 let now=20n;
 let domain:{pending:typeof pending|null;parent:string|null}={pending,parent:'cell:cell-1/nozzle'};
 const confirm=vi.fn(async()=>{domain={pending:null,parent:'arm:arm-1/tcp'};});
 const ledger=createCupLedger({path,runId:'run-1',nowMonotonicNs:()=>now,freshnessNs:100n,domain:async()=>domain,confirm});
 const session=createPlantSession({...options,ledger});session.plant.placeCup('cup-1','paper');const take=vi.spyOn(session.plant,'takeCup');
 const {liftPoseReached:_lift,...grasp}=observation;void _lift;
 await session.observeTransfer(grasp);expect(confirm).not.toHaveBeenCalled();expect(domain.pending).toEqual(pending);expect(session.plant.cup('cup-1')?.at).toBe('taken');
 await session.observeTransfer({...observation,observationId:'not-lifted',seq:'2',liftPoseReached:false});expect(confirm).not.toHaveBeenCalled();
 now=1000n;
 await session.observeTransfer({...observation,observationId:'lift',seq:'3',liftPoseReached:true,observedMonotonicNs:'1000',receivedMonotonicNs:'1000'});expect(confirm).toHaveBeenCalledTimes(1);expect(domain.pending).toBeNull();expect(take).toHaveBeenCalledTimes(1);ledger.close();
});
test('expired paired evidence can be refreshed after restart without dropping history or confirming early',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 const p={...pending,to:{kind:'robot' as const,id:'amr-1',slot:1}},release={...observation,phase:'release' as const,parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false}};
 let now=20n,domain:{pending:typeof p|null;parent:string|null}={pending:p,parent:'arm:arm-1/tcp'};
 const confirm=vi.fn(async()=>{domain={pending:null,parent:'robot:amr-1/tray:1'};});
 const base={path,runId:'run-1',nowMonotonicNs:()=>now,freshnessNs:100n,domain:async()=>domain,confirm,dock:()=>({robotId:'amr-1',slot:1,bootId:'robot-boot',stationary:true,localizationValid:true,errorM:0,receivedMonotonicNs:String(now)})};
 let ledger=createCupLedger(base);await ledger.ingest(release);now=200n;
 const receiver={...release,observationId:'fresh-tray',phase:'receive' as const,deviceId:'amr-1',observerId:'tray-observer',producer:'mock_amr' as const,grip:null,observedMonotonicNs:'200',receivedMonotonicNs:'200'};
 await expect(ledger.ingest(receiver)).rejects.toThrow('INVALID_TRANSFER_EVIDENCE');expect(confirm).not.toHaveBeenCalled();expect(domain.pending).toEqual(p);expect(ledger.observations()).toHaveLength(2);ledger.close();
 ledger=createCupLedger(base);await expect(ledger.recover()).rejects.toThrow('INVALID_TRANSFER_EVIDENCE');
 const refreshed={...release,observationId:'fresh-release',seq:'2',observedMonotonicNs:'200',receivedMonotonicNs:'200'};
 await ledger.ingest(refreshed);expect(confirm).toHaveBeenCalledTimes(1);expect(domain.pending).toBeNull();expect(ledger.observations()).toEqual([release,receiver,refreshed]);
 await ledger.ingest(refreshed);await ledger.recover();expect(confirm).toHaveBeenCalledTimes(1);ledger.close();
});
test.each(['grasp','release'] as const)('unknown %s closes known arm custody and prevents a normal collision verdict',async(phase)=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'cups.db');mkdirSync(dirname(path),{recursive:true});
 const {createArmSession,loadArmModel,tsChecker}=await import('../../packages/lab-runtime/src/v2/arm/session');
 const arm=createArmSession({model:loadArmModel('integrations/arm-controller/models/puma560-reference'),checker:tsChecker(),entityId:'arm-1',runId:'run-1',providerId:'linuxcnc_sim',staleMs:500});
 const adapter={observe:()=>()=>{}} as unknown as import('../../packages/cell-adapters/src/contract').CellAdapter;
 const confirm=vi.fn(async()=>{}),domain={pending,parent:'cell:cell-1/nozzle'};
 const ledger=createCupLedger({path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm});
 const session=createPlantSession({...options,ledger,arm:{adapter,session:arm}});session.plant.placeCup('cup-1','paper');await session.observeTransfer({...observation,liftPoseReached:false});
 const q=[0,-30,20,0,45,0].map(n=>n*Math.PI/180),status={seq:'1',bootId:'boot-1',observedAt:null,controllerEpoch:1,task:{state:'on',interp:'running',homed:true,fault:null},joints:{actualRad:q,commandedRad:q},tcp:null,program:{id:'cup-pick',state:'running'}};
 arm.ingest(status,'10');const input={world:[],worldRevision:{id:'world',revision:1,hash:'0'.repeat(64)},assetRef:{id:'arm',revision:1}};
 expect((await arm.collisionEvidence(input)).result).toBe('pass');
 await expect(session.observeTransfer({...observation,observationId:'unknown-custody',seq:'2',phase,quality:'unknown',parent:null,grip:null})).rejects.toThrow('PHYSICAL_UNKNOWN');
 expect(session.attachments('cup-1')).toMatchObject({physical:{parent:null}});expect(arm.attachments().filter(a=>a.toTick===null)).toEqual([]);
 arm.ingest({...status,seq:'2'},'20');expect(await arm.collisionEvidence(input)).toMatchObject({result:'not_run',reasonCodes:expect.arrayContaining(['CUP_CUSTODY_UNKNOWN:cup-1:1'])});
 await expect(session.observeTransfer({...observation,observationId:'later-valid',seq:'3'})).rejects.toThrow('PHYSICAL_UNKNOWN');expect(confirm).not.toHaveBeenCalled();ledger.close();
});
test('domain table delivery durably clears tray occupancy and survives cuts before and after its physical effect',async()=>{
 const {createCupLedger}=await module(),path=join(await runDirectory(),'table.db');mkdirSync(dirname(path),{recursive:true});
 let domain:{pending:PendingTransferIdentity|null;parent:string|null}={pending:{...pending,to:{kind:'robot',id:'amr-1',slot:1}},parent:'arm:arm-1/tcp'};
 const base={path,runId:'run-1',nowMonotonicNs:()=>20n,freshnessNs:100n,domain:async()=>domain,confirm:async()=>{domain={pending:null,parent:'robot:amr-1/tray:1'};},dock:()=>({robotId:'amr-1',slot:1,bootId:'amr-boot',stationary:true,localizationValid:true,errorM:0,receivedMonotonicNs:'10'})};
 let ledger=createCupLedger(base),session=createPlantSession({...options,ledger,parentTransform:p=>({translationM:p==='table:T01'?[4,5,.795]:[0,0,.5],quaternionXyzw:[0,0,0,1]})});session.plant.placeCup('cup-1','paper');
 const release={...observation,phase:'release' as const,parent:'robot:amr-1/tray:1',grip:{closed:false,objectPresent:false}};await session.observeTransfer(release);await session.observeTransfer({...release,observationId:'receive',phase:'receive',deviceId:'amr-1',observerId:'tray',seq:'1',grip:null});
 const old=structuredClone(session.checkpoint());expect(old.trays).toEqual({'amr-1':'cup-1'});
 domain={pending:null,parent:'table:T01'}; // authoritative delivery committed; crash before the workflow callback
 ledger.close();ledger=createCupLedger(base);session=createPlantSession({...options,ledger,state:old});await session.recover();
 expect(session.checkpoint().physical[0]).toMatchObject({parent:'table:T01'});expect(session.checkpoint().trays).toEqual({});
 await session.custodyResolved('cup-1','table:T01');await session.custodyResolved('cup-1','table:T01');expect(session.attachments('cup-1').resolved).toBe(true);
 ledger.close();ledger=createCupLedger(base);session=createPlantSession({...options,ledger,state:old});await session.recover();expect(session.checkpoint().physical[0]).toMatchObject({parent:'table:T01'});expect(session.checkpoint().trays).toEqual({});expect(ledger.observations()).toHaveLength(2);ledger.close();
});
