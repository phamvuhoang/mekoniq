import {expect,test,vi} from 'vitest';
import {createBarrierCoordinator,coordinatePause} from '../../packages/lab-runtime/src/v2/backends/clock-barrier';
test('cross-VM barriers measure coordinator receipt spread instead of subtracting unrelated provider clocks',async()=>{
 let now=1000n;const c=createBarrierCoordinator({monotonicNs:()=>now,timeoutNs:10000n});const p=c.awaitTransferBarrier('transfer:grasp',['arm','amr']);
 c.ack('transfer:grasp','arm',{simTimeNs:null,clockNs:'9000000000000000000'});now=1050n;c.ack('transfer:grasp','amr',{simTimeNs:'200',clockNs:'30'});
 await p;expect(c.records()[0]!.skewNs).toBe('50');
});
test('reusing a barrier ID with different participants is a conflict',async()=>{
 const c=createBarrierCoordinator({monotonicNs:()=>1n,timeoutNs:100n});const p=c.awaitTransferBarrier('transfer:grasp',['arm']);
 expect(()=>c.awaitTransferBarrier('transfer:grasp',['arm','amr'])).toThrow('BARRIER_PARTICIPANTS_CONFLICT');
 c.ack('transfer:grasp','arm',{simTimeNs:null,clockNs:'2'});await p;
});
test('transport acknowledgement without observed paused state cannot complete a coordinated pause',async()=>{
 expect(await coordinatePause({arm:{pause:async()=>({acknowledged:true})}},true)).toMatchObject({status:'partial',acknowledged:[],missing:['arm']});
 expect(await coordinatePause({},true)).toMatchObject({status:'unknown'});
});
test('a correlated barrier refuses old epochs, missing challenges and replayed samples',async()=>{
 const c=createBarrierCoordinator({monotonicNs:()=>10n,timeoutNs:1000n});
 const policy={nonce:'nonce-1',expected:{arm:{bootId:'boot-2',controllerEpoch:2,afterSeq:'10'}},state:'stationary' as const};
 const p=c.awaitTransferBarrier('transfer:release',['arm'],policy);
 expect(()=>c.ack('transfer:release','arm',{simTimeNs:null,clockNs:'1'})).toThrow('BARRIER_PROOF_MISMATCH');
 expect(()=>c.ack('transfer:release','arm',{simTimeNs:null,clockNs:'1',nonce:'nonce-1',bootId:'boot-1',controllerEpoch:2,seq:'11',state:'stationary'})).toThrow('BARRIER_PROOF_MISMATCH');
 expect(()=>c.ack('transfer:release','arm',{simTimeNs:null,clockNs:'1',nonce:'nonce-1',bootId:'boot-2',controllerEpoch:2,seq:'10',state:'stationary'})).toThrow('BARRIER_PROOF_MISMATCH');
 c.ack('transfer:release','arm',{simTimeNs:null,clockNs:'1',nonce:'nonce-1',bootId:'boot-2',controllerEpoch:2,seq:'11',state:'stationary'});await p;
 expect(c.records()[0]).toMatchObject({status:'complete',proofKind:'correlated_observation'});
});

test('a silent pause provider is bounded and does not hide the other acknowledgement',async()=>{
 vi.useFakeTimers();try{
  const pending=coordinatePause({arm:{pause:()=>new Promise(()=>{})},amr:{pause:async()=>({acknowledged:true,paused:true})}},true,100);
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toEqual({status:'partial',acknowledged:['amr'],missing:['arm']});
 }finally{vi.useRealTimers();}
});
test('a wider ACK object cannot substitute another participant for the validated identity',async()=>{
 const c=createBarrierCoordinator({monotonicNs:()=>10n,timeoutNs:100n});
 const p=c.awaitTransferBarrier('transfer:identity',['arm','amr'],{nonce:'n1',expected:{arm:{bootId:'a',afterSeq:'0'},amr:{bootId:'b',afterSeq:'0'}}});
 const wider={participant:'amr',simTimeNs:null,clockNs:'1',receivedMonotonicNs:'10',nonce:'n1',bootId:'a',seq:'1'};
 c.ack('transfer:identity','arm',wider);
 expect(c.records()[0]!.missing).toEqual(['amr']);expect(c.records()[0]!.acks[0]!.participant).toBe('arm');
 c.ack('transfer:identity','amr',{simTimeNs:null,clockNs:'1',nonce:'n1',bootId:'b',seq:'1'});await p;
});
