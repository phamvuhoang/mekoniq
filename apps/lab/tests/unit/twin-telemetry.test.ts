import {expect,test} from 'vitest';
import {TwinStore,type TwinSample} from '../../src/twin/store';
import {freshness,FRESHNESS_MS} from '../../src/twin/freshness';
let clock=0;const now=()=>clock;
const sample=(o:Partial<TwinSample>&{observed?:Record<string,unknown>|null}={}):TwinSample=>({schemaVersion:2,runId:'r1',entityId:'amr-1',providerId:'mock_amr',bootId:'boot-a',seq:'1',simTimeNs:String(BigInt(o.seq??'1')*20000000n),observedAt:null,
 receivedMonotonicNs:'1',frameId:'map',origin:'mock',quality:'valid',reasonCodes:[],commanded:null,observed:{xM:0,yM:0,yawRad:0},estimated:null,causationId:null,...o} as TwinSample);

test('orders samples per provider by bootId+seq: a late older sample never overwrites a newer one; duplicates are ignored',()=>{
 const store=new TwinStore({now});
 expect(store.apply(sample({seq:'7',observed:{x:2}}))).toBe('applied');
 expect(store.apply(sample({seq:'6',observed:{x:9}}))).toBe('out_of_order');
 expect((store.entity('amr-1')!.observed as {x:number}).x).toBe(2);
 expect(store.apply(sample({seq:'7',observed:{x:5}}))).toBe('duplicate');
 expect((store.entity('amr-1')!.observed as {x:number}).x).toBe(2);
 // seq is a decimal string: compared numerically (BigInt), not lexically, and beyond 2^53
 expect(store.apply(sample({seq:'10',observed:{x:3}}))).toBe('applied');
 expect(store.apply(sample({seq:'18446744073709551615',observed:{x:4}}))).toBe('applied');
 expect(store.apply(sample({seq:'18446744073709551614',observed:{x:0}}))).toBe('out_of_order');
 expect(store.stats).toMatchObject({applied:3,duplicates:1,outOfOrder:2});
});

test('epoch reset: a new bootId is accepted and restarts the sequence; samples of a retired boot are rejected',()=>{
 const store=new TwinStore({now});clock=1000;
 store.apply(sample({seq:'50',observed:{xM:1,yM:1,yawRad:0}}));
 clock=1100;expect(store.apply(sample({bootId:'boot-b',seq:'3',observed:{xM:1.5,yM:1,yawRad:0}}))).toBe('epoch_reset');
 expect(store.entity('amr-1')).toMatchObject({bootId:'boot-b',seq:'3',epochResetAtMs:1100});
 expect(store.apply(sample({bootId:'boot-a',seq:'51'}))).toBe('stale_epoch'); // delayed sample of the old boot
 expect(store.apply(sample({bootId:'boot-b',seq:'4'}))).toBe('applied');
 expect(store.stats).toMatchObject({epochResets:1,staleEpoch:1});
 // a different provider cannot take over an entity's authority silently
 expect(store.apply(sample({providerId:'other',bootId:'x',seq:'99'}))).toBe('foreign_provider');
});

test('bounded buffer: 60 s window then 1 Hz downsampling, hard cap per entity; counts are reported, nothing silent',()=>{
 const store=new TwinStore({now,windowMs:60000,maxPerEntity:650});
 for(let i=1;i<=1500;i++){clock=i*100;store.apply(sample({seq:String(i)}));} // 150 s at 10 Hz
 const h=store.history('amr-1');
 expect(h).toHaveLength(650);
 expect(h.filter(s=>s.receivedAtMs>clock-60000)).toHaveLength(600); // the last 60 s stay at full rate
 const old=h.filter(s=>s.receivedAtMs<=clock-60000);expect(new Set(old.map(s=>Math.floor(s.receivedAtMs/1000))).size).toBe(old.length); // older: 1 per second
 expect(store.stats.downsampled).toBeGreaterThan(0);expect(store.stats.dropped).toBeGreaterThan(0);
 expect(store.stats.downsampled+store.stats.dropped).toBe(1500-h.length);
});

test('snapshotAt is read-only: frozen copies of the latest sample at or before the cursor',()=>{
 const store=new TwinStore({now});
 for(let i=1;i<=10;i++){clock=i;store.apply(sample({seq:String(i*5),observed:{xM:i,yM:0,yawRad:0}}));}
 const snap=store.snapshotAt(String(23n*20000000n)); // tick 23 -> sample seq 20
 expect((snap['amr-1']!.observed as {xM:number}).xM).toBe(4);
 expect(Object.isFrozen(snap['amr-1'])).toBe(true);
 expect(()=>{(snap['amr-1']!.observed as {xM:number}).xM=99;}).toThrow();
 expect((store.entity('amr-1')!.observed as {xM:number}).xM).toBe(10);
 expect(store.snapshotAt('0')['amr-1']).toBeUndefined();
});

test('explicit gaps from the stream are kept with their dropped counts',()=>{
 const store=new TwinStore({now});clock=5;
 store.gap({reason:'BACKPRESSURE',dropped:3});store.gap({reason:'RECONNECT',fromTick:50,toTick:70,samplesNotSent:12});
 expect(store.gaps).toEqual([{reason:'BACKPRESSURE',dropped:3,atMs:5},{reason:'RECONNECT',fromTick:50,toTick:70,samplesNotSent:12,atMs:5}]);
 expect(store.stats.gapDropped).toBe(15);
});

test('freshness: heartbeat alive does not refresh a pose that stopped updating; paused sim is FROZEN_SIM; lost link is disconnected',()=>{
 const store=new TwinStore({now});clock=10000;store.apply(sample({seq:'5'}));
 const e=store.entity('amr-1');
 const link=(o={})=>({state:'live' as const,lastHeartbeatMs:clock,paused:false,...o});
 expect(freshness(e,link(),clock+100)).toMatchObject({state:'live',ageMs:100});
 // heartbeats keep arriving (lastHeartbeat = now) but the measurement is 800 ms old
 expect(freshness(e,link({lastHeartbeatMs:clock+800}),clock+800)).toMatchObject({state:'stale',ageMs:800,reason:'AGE_EXCEEDED'});
 expect(FRESHNESS_MS.pose).toBe(500);
 // acknowledged pause of a mock run: frozen with the real age, no stale alarm
 expect(freshness(e,link({lastHeartbeatMs:clock+5000,paused:true}),clock+5000)).toMatchObject({state:'frozen_sim',ageMs:5000});
 // hardware has no pause-age exception
 store.apply(sample({entityId:'amr-hw',providerId:'valetudo',origin:'hardware',seq:'1'}));
 expect(freshness(store.entity('amr-hw'),link({lastHeartbeatMs:clock+5000,paused:true}),clock+5000)).toMatchObject({state:'stale'});
 // no heartbeat for > 2 s: disconnected regardless of pause; link states other than live too
 expect(freshness(e,link({lastHeartbeatMs:clock}),clock+2500)).toMatchObject({state:'disconnected',reason:'HEARTBEAT_LOST'});
 expect(freshness(e,link({state:'reconnecting'}),clock+100)).toMatchObject({state:'disconnected',reason:'reconnecting'});
 // device status allows 2 s; a sample that says unknown stays unknown with its reason, never "live"
 store.apply(sample({entityId:'arm-1',providerId:'mock_arm',seq:'5',quality:'unknown',observed:null,reasonCodes:['NO_ENCODER_MOCK']}));
 expect(freshness(store.entity('arm-1'),link(),clock+100)).toMatchObject({state:'unknown',reason:'NO_ENCODER_MOCK'});
 store.apply(sample({entityId:'coffee-1',providerId:'mock_coffee',seq:'5',frameId:'cell_base'}));
 expect(freshness(store.entity('coffee-1'),link({lastHeartbeatMs:clock+1500}),clock+1500,'status')).toMatchObject({state:'live'});
 expect(freshness(undefined,link(),clock)).toMatchObject({state:'unknown',ageMs:null,reason:'NO_SAMPLE'});
});
