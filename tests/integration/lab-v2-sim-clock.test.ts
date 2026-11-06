// SIM-07 / SIM-08 / SYS01-SYS03: semantic barriers with clock mapping evidence, pause that only completes on every provider's ACK, telemetry
// ingest that orders by boot/seq and never writes business state, and a fault registry that resolves typed injectors only.
import {afterEach,expect,test} from 'vitest';
import {createBarrierCoordinator,coordinatePause,requireStep} from '../../packages/lab-runtime/src/v2/backends/clock-barrier';
import {createTelemetryIngest} from '../../packages/lab-runtime/src/v2/backends/telemetry-ingest';
import {createFaultRegistry,scheduleFaults,SIL_FAULTS} from '../../packages/lab-runtime/src/v2/backends/fault-schedule';
import {TelemetryRecorder} from '../../packages/lab-runtime/src/v2/telemetry';
import {createClock} from '../../packages/lab-runtime/src/v2/clock';
import type {BackendCapability} from '../../packages/lab-runtime/src/v2/backends/gazebo-nav2';
import {cleanupSil,makeSilRig} from '../support/sil-rig';
afterEach(cleanupSil);
const mono=()=>{let n=1_000_000n;return {now:()=>n,advance(ns:bigint){n+=ns;}};};
const RUN='3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c'; // TwinSample run ids are UUIDs (twin-sample-v2 schema)

test('a transfer barrier completes only with every participant ACK and records clock mapping and skew as evidence',async()=>{
 const clock=mono(),c=createBarrierCoordinator({monotonicNs:clock.now,timeoutNs:5_000_000_000n});
 const waiting=c.awaitTransferBarrier('cup-ready:coffee-job-1',['coffee_io_sim','linuxcnc_sim','gazebo_nav2']);
 c.ack('cup-ready:coffee-job-1','coffee_io_sim',{simTimeNs:'20000000000',clockNs:'1700000000000000000'});
 clock.advance(2_000_000n);
 c.ack('cup-ready:coffee-job-1','linuxcnc_sim',{simTimeNs:null,clockNs:'1700000000003000000'});
 expect(c.records()[0]).toMatchObject({status:'pending',missing:['gazebo_nav2']});
 c.ack('cup-ready:coffee-job-1','gazebo_nav2',{simTimeNs:'20000000000',clockNs:'1700000000001000000'});
 const done=await waiting;
 expect(done.barrierId).toBe('cup-ready:coffee-job-1');
 expect(done.evidence).toEqual([{id:'barrier:cup-ready:coffee-job-1',sha256:expect.stringMatching(/^[0-9a-f]{64}$/)}]);
 const r=c.records()[0]!;
 expect(r).toMatchObject({status:'complete',missing:[],skewNs:'2000000',skewBasis:'coordinator_receipt'});
 expect(r.acks.map(a=>a.participant)).toEqual(['coffee_io_sim','linuxcnc_sim','gazebo_nav2']);
 expect(r.acks.map(a=>a.receivedMonotonicNs)).toEqual(['1000000','3000000','3000000']);
 // a duplicate ACK is absorbed; an ACK for an unknown participant is refused
 c.ack('cup-ready:coffee-job-1','gazebo_nav2',{simTimeNs:'20000000000',clockNs:'1700000000001000000'});
 expect(c.records()[0]!.acks).toHaveLength(3);
 expect(()=>c.ack('cup-ready:coffee-job-1','browser',{simTimeNs:null,clockNs:'1'})).toThrow('BARRIER_PARTICIPANT_UNKNOWN');
});

test('a barrier that misses an ACK times out naming the silent backend and keeps the run in attention',async()=>{
 const clock=mono(),c=createBarrierCoordinator({monotonicNs:clock.now,timeoutNs:1_000_000_000n});
 const waiting=c.awaitTransferBarrier('arm-transfer-complete:t-1',['linuxcnc_sim','gazebo_nav2']);
 c.ack('arm-transfer-complete:t-1','gazebo_nav2',{simTimeNs:'1',clockNs:'1'});
 clock.advance(999_999_999n);c.tick();
 expect(c.records()[0]!.status).toBe('pending');
 clock.advance(1n);c.tick();
 await expect(waiting).rejects.toThrow('BARRIER_TIMEOUT:linuxcnc_sim');
 expect(c.records()[0]).toMatchObject({status:'timeout',missing:['linuxcnc_sim']});
 expect(c.attention()).toEqual([{reason:'BARRIER_TIMEOUT',barrierId:'arm-transfer-complete:t-1',missing:['linuxcnc_sim']}]);
 // a late ACK after the timeout does not complete it
 c.ack('arm-transfer-complete:t-1','linuxcnc_sim',{simTimeNs:null,clockNs:'2'});
 expect(c.records()[0]!.status).toBe('timeout');
 expect(()=>c.awaitTransferBarrier('bad id',['x'])).toThrow('BARRIER_ID_INVALID');
});

test('pause shows paused only after every provider ACKs; a missing ACK is partial, and the mock domain clock is untouched',async()=>{
 const ack=(acknowledged:boolean)=>({pause:async(p:boolean)=>({acknowledged,paused:acknowledged?p:null})});
 expect(await coordinatePause({gazebo_nav2:ack(true),coffee_io_sim:ack(true)},true)).toEqual({status:'paused',acknowledged:['coffee_io_sim','gazebo_nav2'],missing:[]});
 expect(await coordinatePause({gazebo_nav2:ack(true),linuxcnc_sim:ack(false)},true)).toEqual({status:'partial',acknowledged:['gazebo_nav2'],missing:['linuxcnc_sim']});
 expect(await coordinatePause({gazebo_nav2:{pause:async()=>{throw new Error('WORKER_TIMEOUT');}}},true)).toEqual({status:'unknown',acknowledged:[],missing:['gazebo_nav2']});
 const domain=createClock(Date.parse('2026-11-01T00:00:00Z'));domain.advance(5);domain.pause();
 const before=domain.nowMs();await coordinatePause({gazebo_nav2:ack(true)},true);
 expect(domain.nowMs()).toBe(before);expect(domain.tick).toBe(5);
 const gazebo:BackendCapability={backendId:'gazebo_nav2',available:true,step:false,version:'1',reasons:[],evidence:'sil',bootId:'b',robots:[]};
 expect(()=>requireStep(gazebo)).toThrow('STEP_UNSUPPORTED');
 expect(requireStep({...gazebo,step:true})).toBe(true);
});

const sample=(o:Record<string,unknown>)=>({schemaVersion:2,runId:RUN,entityId:'amr-1',providerId:'gazebo_nav2',bootId:'boot-1',seq:'1',simTimeNs:'20000000',observedAt:'2026-11-05T08:00:00.020Z',receivedMonotonicNs:'0',frameId:'map',origin:'physics_sim',quality:'valid',reasonCodes:[],commanded:null,observed:{xM:1,yM:1,yawRad:0},estimated:null,causationId:null,...o});
test('telemetry ingest: accepted, duplicate, stale, gap and rejected by boot/seq identity; the gateway stamps receipt time',()=>{
 const clock=mono(),recorder=new TelemetryRecorder(),ingest=createTelemetryIngest(recorder,{runId:RUN,monotonicNs:clock.now});
 expect(ingest.accept(sample({seq:'1'}))).toEqual({status:'accepted',reasonCodes:[]});
 expect(ingest.accept(sample({seq:'1'}))).toEqual({status:'duplicate',reasonCodes:['SEQ_REPEATED']});
 expect(ingest.accept(sample({seq:'2',observed:{xM:1.1,yM:1,yawRad:0}}))).toEqual({status:'accepted',reasonCodes:[]});
 expect(ingest.accept(sample({seq:'1',observed:{xM:9,yM:9,yawRad:0}}))).toEqual({status:'stale',reasonCodes:['SEQ_REGRESSED']});
 expect(ingest.accept(sample({seq:'7',observed:{xM:1.5,yM:1,yawRad:0}}))).toEqual({status:'gap',reasonCodes:['SEQ_GAP:4']});
 expect(ingest.accept(sample({bootId:'boot-2',seq:'1',observed:{xM:2,yM:1,yawRad:0}}))).toEqual({status:'gap',reasonCodes:['BOOT_CHANGED']});
 expect(ingest.accept(sample({bootId:'boot-1',seq:'8'}))).toEqual({status:'stale',reasonCodes:['BOOT_SUPERSEDED']}); // an old boot can never clear or advance anything
 expect(ingest.accept(sample({runId:'9f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c',seq:'3'}))).toEqual({status:'rejected',reasonCodes:['RUN_MISMATCH']});
 expect(ingest.accept({...sample({seq:'3'}),topic:'/cmd_vel'})).toEqual({status:'rejected',reasonCodes:['ENDPOINT_FORBIDDEN']});
 expect(ingest.accept('nope')).toEqual({status:'rejected',reasonCodes:['INVALID_FIELD']});
 const latest=recorder.latest().find(s=>s.entityId==='amr-1')!;
 expect(latest).toMatchObject({bootId:'boot-2',seq:'1',observed:{xM:2}});
 expect(latest.receivedMonotonicNs).toBe('1000000'); // stamped on receipt, not trusted from the provider
 expect(recorder.gaps.map(g=>g.reason)).toEqual(['SEQ_GAP:4','BOOT_CHANGED']);
});

test('replaying recorded telemetry through the ingest sends no effect and writes no business state',async()=>{
 const rig=await makeSilRig({nativeResult:'completed'});
 try{
  await rig.startDelivery();
  const journalBefore=(await rig.source.journal()).length,effectsBefore=(await rig.source.effects()).map(e=>[e.id,e.status,e.attempts]);
  const recorder=new TelemetryRecorder(),ingest=createTelemetryIngest(recorder,{runId:RUN,monotonicNs:()=>1n});
  for(let i=1;i<=50;i++)ingest.accept(sample({seq:String(i),observed:{xM:1+i*0.01,yM:1,yawRad:0}}));
  const replay=new TelemetryRecorder(),again=createTelemetryIngest(replay,{runId:RUN,monotonicNs:()=>2n});
  for(const s of recorder.report().samples)again.accept(s);
  expect(replay.report().samples).toHaveLength(50);
  expect((await rig.source.journal()).length).toBe(journalBefore);
  expect((await rig.source.effects()).map(e=>[e.id,e.status,e.attempts])).toEqual(effectsBefore);
  expect((await rig.mission()).status).toBe('executing');
 }finally{await rig.close();}
});

test('fault registry resolves typed injectors only; topic/shell/endpoint payloads and unknown ids are refused; schedules are due by tick',()=>{
 const registry=createFaultRegistry();
 const applied:string[]=[];
 registry.register({faultId:'blocker-on',scope:'entity',fields:{obstacleId:'id'},inject:(target,payload)=>{applied.push(`${target}:${String(payload.obstacleId)}`);}});
 expect(registry.ids()).toEqual(['blocker-on']);
 expect(registry.resolve('blocker-on',{obstacleId:'chair'})).toMatchObject({ok:true});
 expect(registry.resolve('teleport',{})).toEqual({ok:false,reasonCodes:['FAULT_UNKNOWN']});
 expect(registry.resolve('blocker-on',{obstacleId:'chair',topic:'/model/x/cmd_vel'})).toEqual({ok:false,reasonCodes:['ENDPOINT_FORBIDDEN']});
 expect(registry.resolve('blocker-on',{obstacleId:'chair',shell:'rm -rf /'})).toEqual({ok:false,reasonCodes:['RAW_COMMAND_FORBIDDEN']});
 expect(registry.resolve('blocker-on',{obstacleId:'chair',script:'x'})).toEqual({ok:false,reasonCodes:['RAW_COMMAND_FORBIDDEN']});
 expect(registry.resolve('blocker-on',{})).toEqual({ok:false,reasonCodes:['FIELD_REQUIRED:obstacleId']});
 expect(registry.resolve('blocker-on',{obstacleId:'../x'})).toEqual({ok:false,reasonCodes:['INVALID_FIELD:obstacleId']});
 const r=registry.resolve('blocker-on',{obstacleId:'chair'});if(r.ok)r.injector.inject('robot-1',{obstacleId:'chair'});
 expect(applied).toEqual(['robot-1:chair']);
 expect(()=>registry.register({faultId:'blocker-on',scope:'run',fields:{},inject:()=>{}})).toThrow('FAULT_DUPLICATE');
 const schedule=scheduleFaults([{atTick:30,faultId:'blocker-on',entityId:'robot-1',payload:{obstacleId:'chair'}},{atTick:10,faultId:'blocker-on',entityId:'robot-1',payload:{obstacleId:'cart'}}],registry);
 expect(schedule.issues).toEqual([]);
 expect(schedule.due(10).map(e=>e.payload.obstacleId)).toEqual(['cart']);
 expect(schedule.due(10)).toEqual([]);                      // each entry fires once
 expect(schedule.due(29)).toEqual([]);expect(schedule.due(31).map(e=>e.payload.obstacleId)).toEqual(['chair']); // late ticks still fire due entries once
 expect(scheduleFaults([{atTick:1,faultId:'nope',payload:{}}],registry).issues).toEqual([{index:0,reasonCodes:['FAULT_UNKNOWN']}]);
 // the SIL fault catalog is a closed enum
 expect(SIL_FAULTS).toEqual(['blocker-on','blocker-off','pedestrian-cross','sensor-stale','sensor-drop','disconnect','reboot','localization-lost','map-changed','duplicate-observation','reorder-observation']);
});
test('native telemetry coverage gaps use mapped run ticks rather than sequence indices',()=>{
 const recorder=new TelemetryRecorder(),origin=10000000000n,ingest=createTelemetryIngest(recorder,{runId:RUN,monotonicNs:()=>1n,sampleTick:s=>Number((BigInt(s.simTimeNs!)-origin)/20000000n)});
 ingest.accept(sample({seq:'700',simTimeNs:'10000000000'}));ingest.accept(sample({seq:'705',simTimeNs:'10100000000'}));expect(recorder.gaps).toEqual([{reason:'SEQ_GAP:4',fromTick:0,toTick:5}]);
});
