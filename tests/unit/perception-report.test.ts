// V12: the report section of a belief run is rebuilt from the durable stream: hot (the recorder still open, nothing lost) and cold (after the run, the same bytes).
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {openBeliefRecorder} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
import {buildPerceptionReport} from '../../packages/lab-runtime/src/v2/perception/perception-report';
const identity={runId:'run-1',bootId:'boot-1',sceneDigest:'a'.repeat(64),perceptionProfileDigest:'b'.repeat(64),recoveryPolicyDigest:null,graspMode:'belief_estimated' as const,seed:7};
const belief=(tick:number)=>({tick,objectId:'cup-1',belief:{objectId:'cup-1',kind:'cup' as const,frameId:'arm-base',positionM:[0.5,0,0.15] as [number,number,number],sigmaM:[0.002,0.002,0] as [number,number,number],observedTick:tick-5,publishedTick:tick,ageTicks:0,source:'pose_estimator_sim' as const,valid:true},dropped:false,truthAtObservedTick:[0.5,0,0.15] as [number,number,number],errorM:0.001});
const attempt=(outcome:'unknown'|'lifted')=>({attemptId:'cup-1#0',cupId:'cup-1',index:0,decidedTick:30,mode:'belief_estimated' as const,beliefUsed:null,beliefErrorAtCommitM:0.001,gates:{belief:'pass',region:'pass',ik:'pass',sweep:'pass'},ikResidual:[],outcome});
test('a hot read sees every record appended so far; the final outcome of an attempt wins; a finished run reads the same and complete',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'perc-rep-')),rec=await openBeliefRecorder({directory:dir,identity,maxBytes:1<<20});
 await rec.appendBelief(belief(10));await rec.appendAttempt(attempt('unknown'));
 const hot=await buildPerceptionReport(dir,{checkpoint:()=>rec.checkpoint(),manifest:()=>rec.manifest()});
 expect(hot.beliefs.map(b=>b.tick)).toEqual([10]);expect(hot.attempts.map(a=>a.outcome)).toEqual(['unknown']);expect(hot.complete).toBe(false);expect(hot.issues).toEqual([]);
 await rec.appendAttempt(attempt('lifted'));await rec.finish(null);
 const cold=await buildPerceptionReport(dir);
 expect(cold.attempts.map(a=>a.outcome)).toEqual(['lifted']);expect(cold.complete).toBe(true);expect(cold.issues).toEqual([]);expect(cold.beliefs).toEqual(hot.beliefs);
});
test('a directory with no recording says so instead of an empty section',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'perc-rep-'));const r=await buildPerceptionReport(dir);
 expect(r.complete).toBe(false);expect(r.issues).toEqual(['BELIEF_EVIDENCE_MISSING']);expect(r.beliefs).toEqual([]);
});
