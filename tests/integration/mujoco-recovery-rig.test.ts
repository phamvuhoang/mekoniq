// V13 / REC01, REC02, REC04 (stop on facts): the recovery table on the real engine. The failed grip is injected as a held-open gripper for the first N attempts of cup-1 (rig/test option, never a request field):
// the cup is untouched on its stand, so the failure is known and recoverable. See the V13 ledger for why a pushed cup (R4-D33) cannot provide it in this cell.
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,describe,expect,test} from 'vitest';
import {runPickRig} from '../../packages/lab-runtime/src/v2/perception/pick-rig';
import {readBeliefEvidence,readBeliefManifest} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
const root=resolve('robotics/simulation-mujoco'),dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const runtime=async()=>({python:resolve('.venv-mujoco/bin/python'),workerRoot:root,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0'});
async function rig(gripHoldAttempts:number,recoveryPolicyId:string|null='pick-recovery-v1'){
 const dir=await mkdtemp(join(tmpdir(),'rec-rig-'));dirs.push(dir);
 const r=await runPickRig({seed:1,mode:'belief_ground_truth',truthOffsetM:0,profileId:null,nudge:false,recoveryPolicyId,gripHoldAttempts,directory:dir},await runtime() as never);
 const ev=join(dir,'run/belief-evidence'),e=await readBeliefEvidence(ev,await readBeliefManifest(ev));
 const attempts=[...new Map(e.attempts.map(a=>[a.attemptId,a])).values()].filter(a=>a.cupId==='cup-1');
 return {r,e,attempts,steps:[...new Map(e.recovery.map(s=>[s.stepId,s])).values()]};
}
describe.skipIf(!existsSync(resolve('.venv-mujoco/bin/python')))('recovery on the real engine (requires .venv-mujoco)',()=>{
 test('REC01: a grip that did not form is recovered: every step recorded before it is done, the retry lifts, the cup is served as one pick',async()=>{
  const {r,e,attempts,steps}=await rig(1);
  expect(e.issues).toEqual([]);
  expect(attempts.map(a=>[a.attemptId,a.outcome])).toEqual([['cup-1#0','grip_not_established'],['cup-1#1','lifted']]);
  expect(steps.map(s=>[s.action,s.result])).toEqual([['open_gripper','done'],['retreat_pick_approach','done'],['await_fresh_belief','done'],['retry_pick','done']]);
  // the step was on the stream (pending) before it was done: the raw records carry both, in this order
  const order=e.recovery.map(s=>`${s.action}:${s.result}`);for(const a of ['open_gripper','retreat_pick_approach','await_fresh_belief','retry_pick'])expect(order.indexOf(`${a}:pending`),a).toBeLessThan(order.indexOf(`${a}:done`));
  expect(attempts[1]!.decidedTick).toBeGreaterThan(steps.at(-2)!.completedTick!);
  expect(r).toMatchObject({outcome:'lifted',attempts:2,recovered:true,attention:false});
 },900_000);
 test('REC02: a grip that never forms is tried twice more, then RECOVERY_EXHAUSTED asks for a person; nothing is served',async()=>{
  const {r,attempts,steps}=await rig(3);
  expect(attempts.map(a=>a.outcome)).toEqual(['grip_not_established','grip_not_established','grip_not_established']);
  expect(steps.filter(s=>s.action==='open_gripper')).toHaveLength(2);
  expect(r).toMatchObject({attention:true,recovered:false});
 },900_000);
 test('without a recovery policy the same failed grip is the R2b behaviour: no recovery step, never recovered',async()=>{
  const {e,attempts}=await rig(1,null);
  expect(e.recovery).toEqual([]);expect(attempts).toHaveLength(1);expect(attempts[0]!.outcome).not.toBe('lifted'); // never a second attempt, never a recovery step
 },900_000);
 test('REC04 (cup pushed off its support): the registered nudge (14.4 N, +x) at the start of the descent knocks the cup off the stand; the table does NOT recover it: facts missing, no recovery step, the gripper is not opened, nothing is served',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rec-rig-'));dirs.push(dir);
  const r=await runPickRig({seed:1,mode:'belief_ground_truth',truthOffsetM:0,profileId:null,nudge:true,recoveryPolicyId:'pick-recovery-v1',directory:dir},await runtime() as never);
  const ev=join(dir,'run/belief-evidence'),e=await readBeliefEvidence(ev,await readBeliefManifest(ev)),report=JSON.parse(await readFile(join(dir,'report.json'),'utf8'));
  expect(e.recovery).toEqual([]);expect(r).toMatchObject({outcome:'grip_not_established',attention:true,recovered:false});
  expect(report.coffee.armTrace.stop.reason).toBe('RECOVERY_FACTS_MISSING');expect(report.outcome.served).toBe('0');
  expect(JSON.stringify(report).includes('world-cup-nudge-v1')).toBe(true);
 },900_000);
});
