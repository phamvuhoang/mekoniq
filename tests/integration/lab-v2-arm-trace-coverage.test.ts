import {expect,test} from 'vitest';
import {createArmSession,loadArmModel,tsChecker,type ArmStatusLike} from '../../packages/lab-runtime/src/v2/arm/session';

const model=loadArmModel('integrations/arm-controller/models/puma560-reference');
const world={world:[],worldRevision:{id:'cell',revision:1,hash:'0'.repeat(64)},assetRef:{id:'arm',revision:1}};
const q=[0,-30,20,0,45,0].map(x=>x*Math.PI/180);
const status=(seq:string,extra:Partial<ArmStatusLike>&{reasonCodes?:string[];monotonicNs?:string}={}):ArmStatusLike=>({
 seq,bootId:'boot-1',controllerEpoch:1,observedAt:'2026-11-06T00:00:00Z',
 task:{state:'on',interp:'running',homed:true,fault:null},joints:{actualRad:q,commandedRad:q},
 tcp:null,program:{id:'cup-pick',state:'running'},...extra,
});
function rig(){
 let now=0n;
 const options={model,checker:tsChecker(),entityId:'arm-1',runId:'coverage-review',providerId:'linuxcnc_sim',staleMs:500,monotonicNs:()=>now};
 return {session:createArmSession(options),advance:(ns:bigint)=>{now=ns;}};
}

test('an explicit dropped-status marker cannot become a clear ARM03 interval',async()=>{
 const {session:s}=rig();s.ingest(status('1'),'0');
 s.ingest(status('100',{reasonCodes:['SEQ_GAP:98']}),'50000000');
 expect(await s.collisionEvidence(world)).toMatchObject({result:'not_run',reasonCodes:expect.arrayContaining(['TRACE_SEQUENCE_GAP:1'])});
 expect(s.samples()[1]).toMatchObject({quality:'unknown',reasonCodes:expect.arrayContaining(['SEQ_GAP:98'])});
 // A later healthy status cannot erase a hole in the recorded trajectory.
 s.ingest(status('101'),'100000000');
 expect((await s.collisionEvidence(world)).result).toBe('not_run');
});

test.each([
 ['receipt gap',status('2'),'60000000000','TRACE_RECEIPT_GAP:1'],
 ['provider gap',status('2',{monotonicNs:'60000000000'}),'50000000','TRACE_PROVIDER_GAP:1'],
 ['controller reboot',status('2',{bootId:'boot-2'}),'50000000','TRACE_BOOT_CHANGED:1'],
 ['epoch changed',status('2',{controllerEpoch:2}),'50000000','TRACE_EPOCH_CHANGED:1'],
 ['duplicate',status('1'),'50000000','TRACE_SEQUENCE_REORDERED:1'],
 ['reordered',status('0'),'50000000','TRACE_SEQUENCE_REORDERED:1'],
 ['receipt reversed',status('2'),'-1','TRACE_RECEIPT_INVALID:1'],
 ['provider reversed',status('2',{monotonicNs:'0'}),'50000000','TRACE_PROVIDER_REORDERED:1'],
] as const)('%s blocks a false ARM03 pass',async(_label,next,received,reason)=>{
 const {session:s}=rig();s.ingest(status('1',{monotonicNs:'1'}),'0');s.ingest(next,received);
 expect(await s.collisionEvidence(world)).toMatchObject({result:'not_run',reasonCodes:expect.arrayContaining([reason])});
});

test('event sequence numbers between healthy statuses do not imply lost status samples',async()=>{
 const {session:s}=rig();s.ingest(status('1',{monotonicNs:'1'}),'0');
 s.ingest(status('7',{monotonicNs:'50000001'}),'50000000');
 expect((await s.collisionEvidence(world)).result).toBe('pass');
});

test('nonfinite joint values cannot be reported as valid telemetry',async()=>{
 const {session:s}=rig();s.ingest(status('1',{joints:{actualRad:[NaN,...q.slice(1)],commandedRad:q}}),'0');
 expect(s.samples()[0]).toMatchObject({quality:'unknown',observed:null});
 expect(await s.collisionEvidence(world)).toMatchObject({result:'not_run',reasonCodes:['TRACE_INCOMPLETE:0']});
});

test('closed-loop availability expires when controller status stops arriving',()=>{
 const {session:s,advance}=rig();s.ingest(status('1'),'0');expect(s.capability().closedLoop).toBe(true);
 advance(501000000n);expect(s.capability()).toMatchObject({closedLoop:false,feedback:'none'});
 s.ingest(status('2'),'501000000');expect(s.capability().closedLoop).toBe(false); // this sample announces a coverage gap
 advance(551000000n);s.ingest(status('3'),'551000000');expect(s.capability().closedLoop).toBe(true);
});

test.each(['stale','unknown'] as const)('provider-declared %s feedback cannot supply ARM03 coverage',async quality=>{
 const {session:s}=rig();const frame={...status('1'),freshness:{quality,staleMs:500}};s.ingest(frame,'0');
 expect(s.samples()[0]).toMatchObject({quality:'unknown'});
 expect(s.capability().closedLoop).toBe(false);
 expect(await s.collisionEvidence(world)).toMatchObject({result:'not_run',reasonCodes:[`TRACE_PROVIDER_${quality.toUpperCase()}:0`]});
});

test('trace inspection cannot erase a recorded continuity failure',async()=>{
 const {session:s}=rig();s.ingest(status('1'),'0');const returned=s.ingest(status('3',{reasonCodes:['SEQ_GAP:1']}),'50000000');
 returned.reasonCodes.length=0;s.trace()[1]!.reasonCodes.length=0;
 expect((await s.collisionEvidence(world)).result).toBe('not_run');
});

test('collision evidence reports the immutable trace span actually checked',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),checker=tsChecker();
 const s=createArmSession({model,entityId:'arm-1',runId:'coverage-review',providerId:'linuxcnc_sim',staleMs:500,
  checker:{describe:checker.describe,async check(input){await gate;return checker.check(input);}}});
 s.ingest(status('1'),'0');s.ingest(status('2'),'50000000');
 const pending=s.collisionEvidence(world);
 s.ingest(status('4',{reasonCodes:['SEQ_GAP:1']}),'100000000');release();
 expect(await pending).toMatchObject({result:'pass',trace:{samples:2,fromTick:0,toTick:1}});
 expect((await s.collisionEvidence(world)).result).toBe('not_run');
});
