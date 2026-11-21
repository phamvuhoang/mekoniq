// V11: the durable belief/attempts/recovery streams. Same rules as the physics stream: immutable hashed chunks, a bounded quota that ends the recording with a reason, an unpublished tail is a coverage failure.
import {mkdtemp,readFile,readdir,writeFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {openBeliefRecorder,readBeliefEvidence,readBeliefManifest} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
const identity={runId:'run-1',bootId:'boot-1',sceneDigest:'a'.repeat(64),perceptionProfileDigest:'b'.repeat(64),recoveryPolicyDigest:null,graspMode:'belief_estimated' as const,seed:7};
const belief=(tick:number)=>({tick,objectId:'cup-1',belief:{objectId:'cup-1',kind:'cup' as const,frameId:'arm-base',positionM:[0.5,0,0.15] as [number,number,number],sigmaM:[0.002,0.002,0] as [number,number,number],observedTick:tick-5,publishedTick:tick,ageTicks:0,source:'pose_estimator_sim' as const,valid:true},dropped:false,truthAtObservedTick:[0.5,0,0.15] as [number,number,number],errorM:0.001});
const attempt={attemptId:'cup-1#0',cupId:'cup-1',index:0,decidedTick:30,mode:'belief_estimated' as const,beliefUsed:null,beliefErrorAtCommitM:null,gates:{belief:'BELIEF_UNAVAILABLE',region:'not_evaluated',ik:'not_evaluated',sweep:'not_evaluated'},ikResidual:[],outcome:'refused' as const,refusal:'BELIEF_UNAVAILABLE'};
const step={stepId:'s1',attemptId:'cup-1#0',rule:'r',action:'open_gripper',commandId:'recovery-1',recordedTick:40,completedTick:null,result:'pending'};
const dirs:string[]=[];const tmp=async()=>{const d=await mkdtemp(join(tmpdir(),'belief-ev-'));dirs.push(d);return d;};
afterEach(()=>{dirs.length=0;});

test('records written round-trip through the reader, with the manifest complete',async()=>{
 const dir=await tmp(),rec=await openBeliefRecorder({directory:dir,identity,maxBytes:1<<20});
 for(let t=10;t<=100;t+=10)await rec.appendBelief(belief(t));
 await rec.appendAttempt(attempt);await rec.appendRecovery(step);await rec.finish(null);
 const m=await readBeliefManifest(dir),r=await readBeliefEvidence(dir,m,{identity});
 expect(r.issues).toEqual([]);expect(r.complete).toBe(true);expect(r.beliefs.map(b=>b.tick)).toEqual([10,20,30,40,50,60,70,80,90,100]);expect(r.attempts).toEqual([attempt]);expect(r.recovery).toEqual([step]);
 expect(m.coverage).toEqual({lastTick:100,complete:true});
});
test('a record outside the contract is refused and ends the recording with a gap, never a silent drop',async()=>{
 const dir=await tmp(),rec=await openBeliefRecorder({directory:dir,identity,maxBytes:1<<20});
 await rec.appendBelief(belief(10));
 await expect(rec.appendAttempt({...attempt,outcome:'maybe'} as never)).rejects.toThrow('BELIEF_RECORD_INVALID');
 await expect(rec.appendBelief(belief(20))).rejects.toThrow('BELIEF_RECORDER_TERMINAL');
 const m=await readBeliefManifest(dir);expect(m.terminalReason).toBe('BELIEF_RECORD_INVALID');expect(m.gaps.length).toBe(1);
 expect((await readBeliefEvidence(dir,m,{identity})).complete).toBe(false);
});
test('a chunk that was changed after publication is caught by its hash',async()=>{
 const dir=await tmp(),rec=await openBeliefRecorder({directory:dir,identity,maxBytes:1<<20});await rec.appendBelief(belief(10));await rec.finish(null);
 const chunk=(await readdir(dir)).find(n=>n.startsWith('belief-'))!,b=await readFile(join(dir,chunk));b[b.length-9]^=1;await writeFile(join(dir,chunk),b);
 const r=await readBeliefEvidence(dir,await readBeliefManifest(dir),{identity});expect(r.complete).toBe(false);expect(r.issues.join()).toMatch(/BELIEF_HASH_MISMATCH/);
});
test('an unpublished tail left by a crash is a coverage failure',async()=>{
 const dir=await tmp(),rec=await openBeliefRecorder({directory:dir,identity,maxBytes:1<<20});await rec.appendBelief(belief(10));await rec.finish(null);
 await appendFile(join(dir,'pending.ndjson'),'{"stream":"belief"}\n');
 expect((await readBeliefEvidence(dir,await readBeliefManifest(dir),{identity})).issues).toContain('BELIEF_UNPUBLISHED_TAIL');
});
test('another run identity is refused',async()=>{
 const dir=await tmp(),rec=await openBeliefRecorder({directory:dir,identity,maxBytes:1<<20});await rec.appendBelief(belief(10));await rec.finish(null);
 expect((await readBeliefEvidence(dir,await readBeliefManifest(dir),{identity:{...identity,seed:8}})).issues).toContain('BELIEF_IDENTITY_MISMATCH');
});
test('the quota ends the recording with a reason instead of cutting records',async()=>{
 const dir=await tmp(),rec=await openBeliefRecorder({directory:dir,identity,maxBytes:6000});let failed:string|null=null;
 for(let t=10;t<5000&&!failed;t++)try{await rec.appendBelief(belief(t));}catch(e){failed=(e as Error).message;}
 expect(failed).toBe('BELIEF_QUOTA_EXCEEDED');expect((await readBeliefManifest(dir)).terminalReason).toBe('BELIEF_QUOTA_EXCEEDED');
});
test('a recorder reopened over a directory with another identity refuses',async()=>{
 const dir=await tmp();await (await openBeliefRecorder({directory:dir,identity,maxBytes:1<<20})).finish(null);
 await expect(openBeliefRecorder({directory:dir,identity:{...identity,seed:9},maxBytes:1<<20})).rejects.toThrow('BELIEF_IDENTITY_MISMATCH');
});
