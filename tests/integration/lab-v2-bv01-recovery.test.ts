// Recovery uses the production PlantSession ports; only process/observer facts are doubles.
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,expect,test,vi} from 'vitest';
import type {CellReport} from '../../packages/cell-adapters/src/contract';
import type {JsonObject} from '../../packages/contracts/src/index';
import {LinuxcncArmAdapter,loadArmProfile} from '../../packages/lab-runtime/src/v2/arm/adapter';
import {createArmSession,loadArmModel,tsChecker} from '../../packages/lab-runtime/src/v2/arm/session';
import {createPlantSession} from '../../packages/lab-runtime/src/v2/beverage/plant-session';
import type {TransferObservation} from '../../packages/lab-runtime/src/v2/beverage/cup-ledger';
import {createScenarioRun,type ScenarioRun,type RunProviders} from '../../packages/lab-runtime/src/v2/scenario-runner';
import type {CoffeeContext,CoffeeState} from '../../packages/lab-runtime/src/v2/scenarios/coffee';
import {scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {ArmBridgeDouble} from '../support/arm-bridge-double';
import {act,amrAsset,cleanupRuns,coffeeProject,manifestFor,runDirectory,stepUntil} from '../support/lab-v2';
afterEach(cleanupRuns);
async function fixture(options:{virtualGrip?:boolean}={}){
 const directory=await runDirectory(),profile=loadArmProfile('integrations/arm-controller/configs/sim/puma560/profile.json');
 const scenario=structuredClone(scenarioRegistry.get('BV01')!);scenario.coffee!.orders=scenario.coffee!.orders.slice(0,1);
 let ctx!:CoffeeContext,st!:CoffeeState,bridge!:ArmBridgeDouble,adapter!:LinuxcncArmAdapter,run!:ScenarioRun;
 let cut:string|null=null,docked=true,fatalRecovery=false;const input={...manifestFor('BV01',{seed:42,project:coffeeProject()}),backendSetId:'mock-default'};
 const external:CellReport[]=[];
 const providers:RunProviders={directory,assets:[amrAsset],enabledBackends:['mock_amr','mock_coffee','mock_arm'],scenarios:new Map([['BV01',scenario]]),coffeePorts:async(state,context,boot)=>{
  ctx=context;st=state;const sourceDock=ctx.dock;ctx.dock=()=>({...sourceDock(),moving:!docked||sourceDock().moving});if(!bridge)bridge=new ArmBridgeDouble(profile,ctx.nowMs);bridge.simulationSceneCapability=options.virtualGrip??false;
  adapter=new LinuxcncArmAdapter({port:bridge,profile,runId:ctx.runId,cellId:st.cellId,deviceId:st.armId,nowMs:()=>ctx.nowMs(),journalPath:join(directory,'arm.sqlite'),...options.virtualGrip?{simulationScene:{worldRevision:'fixture-world'}}:{},afterJournal:phase=>{if(cut===phase)throw new Error(`CUT:${phase}`);}});bridge.emitStatus();await adapter.open();
  const session=createArmSession({model:loadArmModel('integrations/arm-controller/models/puma560-reference'),checker:tsChecker(),entityId:st.armId,runId:ctx.runId,providerId:'protocol_double',staleMs:500});
  const plant=createPlantSession({runId:ctx.runId,cellId:st.cellId,armId:st.armId,nowMs:ctx.nowMs,newBootId:boot,receiver:ctx.receiver,dock:ctx.dock,traySensor:()=>false,coffeeState:st.plant,arm:{adapter,session}});
  // A receiver observer supplies its own records; it does not replace production recovery.
  const ports=plant.ports();if(fatalRecovery)return {...ports,async recover(){throw new Error('SQLITE_IOERR');}};return {...ports,drain:()=>[...ports.drain(),...external.splice(0)],async advance(){await ports.advance();bridge.emitStatus();}};
 }};
 const open=async()=>{run=await createScenarioRun(input,providers);return run;};await open();
 const command=()=>[...bridge.log].reverse().find(m=>m.command?.capability==='start_job')!.command!;
 const observation=async(phase:'grasp'|'release'|'receive',id:string):Promise<TransferObservation>=>{
  const cup=(await ctx.source.read('cup','cup-1')).state,p=cup.pendingTransfer as JsonObject,c=command(),at=String(process.hrtime.bigint()),receiver=phase==='receive';
  return {observationId:id,runId:ctx.runId,cupId:'cup-1',transferId:String(p.transferId),commandId:c.commandId,payloadHash:c.payloadHash,deviceId:receiver?'amr-1':st.armId,observerId:receiver?'tray-observer':'virtual-grip-observer',bootId:receiver?ctx.dock().bootId:bridge.bootId,controlEpoch:c.controlEpoch,seq:String(receiver?1:bridge.seq+1),producer:receiver?'gazebo_tray':'linuxcnc_virtual_grip',fidelity:'modeled',phase,parent:phase==='grasp'?`arm:${st.armId}/tcp`:'robot:amr-1/tray:1',grip:phase==='grasp'?{closed:true,objectPresent:true}:phase==='release'?{closed:false,objectPresent:false}:null,liftPoseReached:phase==='grasp',clockDomain:receiver?'receiver-clock':'arm-clock',observedMonotonicNs:at,receivedMonotonicNs:at,quality:'valid'};
 };
 const finish=(o:TransferObservation)=>{const c=command();bridge.finish(c.commandId,'completed',{controlEpoch:c.controlEpoch,payloadHash:c.payloadHash,deviceId:st.armId,evidence:{source:'protocol_double',transferObservation:o}});};
 const enqueue=(o:TransferObservation)=>{if(o.phase!=='receive')bridge.seq=Number(o.seq);external.push({deviceId:o.deviceId,bootId:o.bootId,seq:o.seq,observedAt:new Date(ctx.nowMs()).toISOString(),evidence:{source:'protocol_double',transferObservation:o}});};
 return {get run(){return run;},get bridge(){return bridge;},get adapter(){return adapter;},get ctx(){return ctx;},open,command,observation,finish,enqueue,sampleGrip:(o:TransferObservation)=>bridge.emitGrip(command(),o),finishWithoutProof:()=>{const c=command();bridge.finish(c.commandId,'completed',{controlEpoch:c.controlEpoch,payloadHash:c.payloadHash,deviceId:st.armId,evidence:{source:'protocol_double',gripperClosed:null,objectPresent:null,released:null}});},setFatalRecovery:()=>{fatalRecovery=true;},setCut:(value:string|null)=>{cut=value;},setDocked:(value:boolean)=>{docked=value;},
  async startPick(){await run.start();await stepUntil(run,()=>bridge.log.some(m=>m.command?.capability==='start_job'),25);},
  async startPlace(){const grasp=await observation('grasp','pick-grasp');finish(grasp);await act(run,'step',{ticks:1});await stepUntil(run,()=>command().programRef?.id==='cup-place',25);},
  writes:()=>bridge.log.filter(m=>m.command&&['stage_program','start_job'].includes(m.command.capability)).map(m=>m.command!),
  cup:async()=>(await ctx.source.read('cup','cup-1')).state};
}

test('unknown custody reopens as an available suspended run with visible attention and reconciliation',async()=>{
 const f=await fixture();try{
  await f.startPick();f.finish({...await f.observation('grasp','unknown-grasp'),quality:'unknown',parent:null,grip:null});await act(f.run,'step',{ticks:1});
  await f.run.close();const before=f.writes().length;await f.open();
  expect((await f.run.snapshot()).attention.map(a=>a.reason)).toContain('CUP_RECONCILE_REQUIRED:PHYSICAL_UNKNOWN');
  await act(f.run,'step',{ticks:100});expect(f.writes()).toHaveLength(before);expect((await f.run.report()).outcome.served).toBe('0');
  await act(f.run,'reconcile',{subjectId:'coffee-job-1'});expect((await f.run.report()).reconciliations).toHaveLength(1);
 }finally{await f.run.close();}
});

test('stale paired proof reopens held, accepts fresh replacement observations, and starts no motion',async()=>{
 const f=await fixture();try{
  await f.startPick();await f.startPlace();f.setDocked(false);
  f.finish(await f.observation('release','place-release'));f.enqueue(await f.observation('receive','place-receiver'));await act(f.run,'step',{ticks:1});
  await f.run.close();await new Promise(r=>setTimeout(r,550));f.setDocked(true);const before=f.writes().length;await f.open();
  expect((await f.run.snapshot()).attention.some(a=>a.reason.startsWith('INVALID_TRANSFER_EVIDENCE:')&&a.reason.includes('OBSERVATION_STALE_OR_FUTURE'))).toBe(true);
  const release=await f.observation('release','fresh-release');f.enqueue(release);const receiver=await f.observation('receive','fresh-receiver');receiver.seq='2';f.enqueue(receiver);await act(f.run,'step',{ticks:1});
  expect(await f.cup()).toMatchObject({ownerKind:'robot',ownerId:'amr-1',pendingTransfer:null});expect(f.writes()).toHaveLength(before);
  expect((await f.run.report()).businessEvents.filter(e=>e.type==='CupTransferConfirmed')).toHaveLength(2);
 }finally{await f.run.close();}
});

test('ordinary reopen calls production adapter recovery and visibly holds an accepted running job',async()=>{
 const f=await fixture();try{
  await f.startPick();await f.run.close();const before=f.writes().length,queries=f.bridge.log.length;await f.open();
  expect((await f.run.snapshot()).attention.map(a=>a.reason)).toContain('RECOVERY_UNKNOWN');
  expect(f.bridge.log.slice(queries).some(m=>m.command?.capability==='query_outcome'||m.reconcile)).toBe(true);
  await act(f.run,'step',{ticks:100});expect(f.writes()).toHaveLength(before);
 }finally{await f.run.close();}
});

test.each(['completed','queued'])('completion cut at %s is recovered through durable proof without replaying motion',async(phase)=>{
 const f=await fixture();try{
  await f.startPick();const proof=await f.observation('grasp','durable-grasp');if(phase==='completed')f.setCut('completed');
  if(phase==='completed')expect(()=>f.finish(proof)).toThrow('CUT:completed');else f.finish(proof);
  expect((await f.cup()).pendingTransfer).not.toBeNull();await f.run.close();f.setCut(null);const before=f.writes().length;await f.open();await act(f.run,'step',{ticks:1});
  const r=await f.run.report();expect(f.writes()).toHaveLength(before);
  expect(r.businessEvents.filter(e=>e.type==='CupTransferConfirmed')).toHaveLength(1);expect(await f.cup()).toMatchObject({ownerKind:'arm',pendingTransfer:null});
 }finally{await f.run.close();}
});


test('a crash after source custody commit but before adapter acknowledgment replays proof idempotently',async()=>{
 const f=await fixture();try{
  await f.startPick();f.finish(await f.observation('grasp','ack-cut-grasp'));
  vi.spyOn(f.adapter,'acknowledgeCompletion').mockImplementationOnce(()=>{throw new Error('CUT_BEFORE_ACK');});
  await expect(act(f.run,'step',{ticks:1})).rejects.toThrow('CUT_BEFORE_ACK');expect(await f.cup()).toMatchObject({ownerKind:'arm',pendingTransfer:null});
  const rejections=(await f.run.report()).rejectedObservations;await f.run.close();const before=f.writes().length;await f.open();const r=await f.run.report();
  expect(r.businessEvents.filter(e=>e.type==='CupTransferConfirmed')).toHaveLength(1);expect(f.writes()).toHaveLength(before);expect(r.rejectedObservations).toEqual(rejections);
 }finally{await f.run.close();}
});
test('recovered undrained completion retains its original receipt age and refuses stale proof',async()=>{
 const f=await fixture();try{
  await f.startPick();f.finish(await f.observation('grasp','expired-undrained-grasp'));await f.run.close();await new Promise(r=>setTimeout(r,550));const before=f.writes().length;await f.open();
  const r=await f.run.report();expect(r.attention.map(a=>a.reason)).toContain('INVALID_TRANSFER_OBSERVATION:OBSERVATION_STALE_OR_FUTURE');
  expect(r.businessEvents.filter(e=>e.type==='CupTransferConfirmed')).toHaveLength(0);expect(f.writes()).toHaveLength(before);
 }finally{await f.run.close();}
});
test('a legacy completed journal entry without retained proof reopens in an explicit custody hold',async()=>{
 const f=await fixture();try{
  await f.startPick();f.finish(await f.observation('grasp','legacy-grasp'));const path=f.adapter.journalPath!;await f.run.close();
  const db=new DatabaseSync(path);try{const row=db.prepare('SELECT id,record FROM arm_jobs').get()!;const record=JSON.parse(String(row.record));delete record.completion;db.prepare('UPDATE arm_jobs SET record=? WHERE id=?').run(JSON.stringify(record),String(row.id));}finally{db.close();}
  const before=f.writes().length;await f.open();expect((await f.run.snapshot()).attention.map(a=>a.reason)).toContain('COMPLETION_PROOF_MISSING');expect(f.writes()).toHaveLength(before);
 }finally{await f.run.close();}
});
test('unexpected storage recovery failures remain fatal and close the native port',async()=>{
 const f=await fixture();try{
  await f.startPick();await f.run.close();const closes=f.bridge.closed;f.setFatalRecovery();await expect(f.open()).rejects.toThrow('SQLITE_IOERR');expect(f.bridge.closed).toBe(closes+1);
 }finally{await f.run.close();}
});


test.each(['release-first','completion-first'] as const)('separate virtual release and null completion (%s) wait for delayed independent tray proof before CargoLoaded',async(order)=>{
 const f=await fixture({virtualGrip:true});try{
  await f.startPick();await f.startPlace();
  if(order==='release-first'){f.sampleGrip(await f.observation('release','separate-release'));await act(f.run,'step',{ticks:1});}
  expect(await f.cup()).toMatchObject({ownerKind:'arm'});expect((await f.cup()).pendingTransfer).not.toBeNull();
  f.finishWithoutProof();await act(f.run,'step',{ticks:4});
  const waiting=await f.run.report();expect(waiting.attention.map(a=>a.reason)).not.toContain('RELEASE_EVIDENCE_MISSING');expect(waiting.businessEvents.filter(e=>e.type==='CargoLoaded')).toHaveLength(0);expect(waiting.outcome.served).toBe('0');
  if(order==='completion-first'){f.sampleGrip(await f.observation('release','separate-release'));await act(f.run,'step',{ticks:1});}
  f.enqueue(await f.observation('receive','independent-delayed-receive'));await act(f.run,'step',{ticks:1});
  expect(await f.cup()).toMatchObject({ownerKind:'robot',pendingTransfer:null});
  await act(f.run,'step',{ticks:5});const after=await f.run.report();expect(after.businessEvents.filter(e=>e.type==='CargoLoaded')).toHaveLength(1);expect(after.businessEvents.filter(e=>e.type==='CupTransferConfirmed'&&(e.state.movements as JsonObject[]).at(-1)?.transferId==='coffee-job-1:place')).toHaveLength(1);expect(after.attention.map(a=>a.reason)).not.toContain('RELEASE_EVIDENCE_MISSING');
 }finally{await f.run.close();}
});


test.each(['reboot','controller-epoch','failed','unknown','job-identity'] as const)('undrained virtual grasp is fenced during %s recovery before source custody can advance',async(change)=>{
 const f=await fixture({virtualGrip:true});try{
  await f.startPick();const command=f.command(),proof=await f.observation('grasp','pre-crash-undrained');f.sampleGrip(proof);
  const receipt=f.adapter.completionReceipt(proof.observationId);expect((await f.cup()).pendingTransfer).not.toBeNull();await f.run.close();
  const writes=f.writes().length;
  if(change==='reboot'){f.bridge.reboot('ctl-after-crash');f.bridge.outcomes.set(command.commandId,'completed');}
  else if(change==='controller-epoch'){f.bridge.epoch++;f.bridge.outcomes.set(command.commandId,'completed');}
  else if(change==='job-identity'){const outcome=f.bridge.outcome.bind(f.bridge);f.bridge.outcome=id=>{const result=outcome(id);if(id===command.commandId)result.evidence.commandIdentity.payloadHash='conflicting-payload';return result;};}
  else f.bridge.outcomes.set(command.commandId,change);
  expect(process.hrtime.bigint()-BigInt(receipt!)).toBeLessThan(500000000n);await f.open();const report=await f.run.report();
  expect(report.businessEvents.filter(e=>e.type==='CupTransferConfirmed')).toHaveLength(0);expect(await f.cup()).toMatchObject({ownerKind:'cell'});expect((await f.cup()).pendingTransfer).not.toBeNull();expect(report.attention.map(a=>a.reason)).toContain('RECOVERY_UNKNOWN');expect(f.writes()).toHaveLength(writes);expect(f.adapter.completionReceipt(proof.observationId)).toBe(receipt);
 }finally{await f.run.close();}
});
