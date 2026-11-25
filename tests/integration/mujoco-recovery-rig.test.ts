// V13 / REC01–REC04: the recovery table on the real engine. The failed grip is injected as a held-open gripper for the first N attempts of cup-1 (rig/test option, never a request field):
// the cup is untouched on its stand, so the failure is known and recoverable. See the V13 ledger for why a pushed cup (R4-D33) cannot provide it in this cell.
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,describe,expect,test} from 'vitest';
import {runPickRig} from '../../packages/lab-runtime/src/v2/perception/pick-rig';
import {readBeliefEvidence,readBeliefManifest} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
import {readRetainedWorldAdmission} from '../../packages/lab-runtime/src/v2/simulation3d/world-arm-report';
import {readWorldEvidence} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {runCellCampaign} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
import {readCampaignJournal} from '../../packages/lab-runtime/src/v2/control/campaign-source-evidence';
import {loadOracleProfile} from '../../packages/lab-runtime/src/v2/algorithm/checker';
import type {RunReport} from '../../packages/lab-runtime/src/v2/report';
import type {ArmPlantState} from '../../packages/cell-adapters/src/mock-arm';
const root=resolve('robotics/simulation-mujoco'),dirs:string[]=[],retained=process.env.RECOVERY_RIG_EVIDENCE_DIR?resolve(process.env.RECOVERY_RIG_EVIDENCE_DIR):undefined;
// Opt-in raw diagnostics are written directly outside Git so an interrupted run
// also survives. Every execution gets a fresh directory; no evidence is replaced.
afterEach(async()=>{for(const d of dirs.splice(0))if(!retained)await rm(d,{recursive:true,force:true});});
const sourceCommit=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
async function directory(label:string){
 if(retained)await mkdir(retained,{recursive:true});const dir=await mkdtemp(join(retained??tmpdir(),`rec-rig-${label}-`));dirs.push(dir);
 await writeFile(join(dir,'integration-context.json'),JSON.stringify({accepted:false,qualification:false,label,sourceCommit:sourceCommit(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!==''}));return dir;
}
async function retainedRun(dir:string){
 const report=JSON.parse(await readFile(join(dir,'report.json'),'utf8')) as RunReport,checkpoint=JSON.parse(await readFile(join(dir,'run/run.json'),'utf8'));
 const admission=await readRetainedWorldAdmission(join(dir,'run'),checkpoint.world.snapshot.sceneDigest),world=await readWorldEvidence(join(dir,'run/world-evidence'),admission);
 expect(world.complete).toBe(true);expect(world.issues).toEqual([]);return {report,checkpoint,world,arm:checkpoint.coffee.arm as ArmPlantState};
}
const runtime=async()=>({python:resolve('.venv-mujoco/bin/python'),workerRoot:root,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0'});
async function rig(gripHoldAttempts:number,recoveryPolicyId:string|null='pick-recovery-v1',lossy=false){
 const dir=await directory(lossy?'rec03':`hold-${gripHoldAttempts}-${recoveryPolicyId??'none'}`);
 const r=await runPickRig({seed:lossy?18:1,mode:lossy?'belief_estimated':'belief_ground_truth',truthOffsetM:0,profileId:lossy?'perception-lossy-v1':null,nudge:false,recoveryPolicyId,gripHoldAttempts,directory:dir,sourceCommit:sourceCommit()},await runtime() as never);
 const ev=join(dir,'run/belief-evidence'),e=await readBeliefEvidence(ev,await readBeliefManifest(ev));
 const attempts=[...new Map(e.attempts.map(a=>[a.attemptId,a])).values()].filter(a=>a.cupId==='cup-1');
 return {dir,r,e,attempts,steps:[...new Map(e.recovery.map(s=>[s.stepId,s])).values()]};
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
  const {dir,r,e,attempts,steps}=await rig(3);
  const pend=e.recovery.filter(x=>x.result==='pending');expect(pend.length).toBeGreaterThanOrEqual(8);expect(new Set(pend.map(x=>x.commandId)).size).toBe(pend.length); // R04: every step of every round has its own command id
  expect(e.attempts.filter(a=>a.cupId==='cup-1').map(a=>a.stage)).toContain('outcome');
  expect(attempts.map(a=>a.outcome)).toEqual(['grip_not_established','grip_not_established','grip_not_established']);
  expect(steps.filter(s=>s.action==='open_gripper')).toHaveLength(2);
  expect(r).toMatchObject({attention:true,recovered:false});
  const {report,arm,world}=await retainedRun(dir),pick=arm.programs.find(p=>p.program==='cup-pick')!;
  expect(pick).toMatchObject({state:'failed',evidence:{objectPresent:false,cupId:null,stopReason:'RECOVERY_EXHAUSTED',failedGripObservation:{tick:r.ticks,propId:'cup-1',restingOn:'nozzle-stand',heldPropIds:[]}}});
  expect(arm.stop).toMatchObject({latched:true,reconcileRequired:true,reason:'RECOVERY_EXHAUSTED'});expect(arm.holding).toBeNull();
  expect(report.outcome).toMatchObject({status:'needs_attention',served:'0'});expect(report.coffee!.cups.find(c=>c.cupId==='cup-1')).toMatchObject({ownerKind:'cell',ownerId:'coffee-1'});
  expect(report.businessEvents.some(e=>['CupTransferConfirmed','CupHandedOff'].includes(e.type))).toBe(false);
  const receipt=report.businessEvents.find(e=>e.type==='CupTransferObserved'&&e.id==='cup-1'&&(e.state.pendingTransfer as {commandId?:string}|null)?.commandId===pick.commandId);
  expect(receipt?.state.pendingTransfer).toMatchObject({lastResult:'failed',commandId:pick.commandId});
  const source=await readCampaignJournal(join(dir,'run'),report.manifest.runId);expect(source.states.get('cup/cup-1')).toMatchObject({ownerKind:'cell',ownerId:'coffee-1'});
  const last=world.records.at(-1)!.snapshot;expect(last.arms![0]!.gripper!.heldPropIds).toEqual([]);expect(last.props!.find(p=>p.propId==='cup-1')?.restingOn).toBe('nozzle-stand');
 },900_000);
 test('REC03: registered lossy seed 18 waits at the approach on stale belief, commits only fresh belief, and waits for a new observation after retreat before retry',async()=>{
  const {dir,r,e,attempts,steps}=await rig(1,'pick-recovery-v1',true),{world,report}=await retainedRun(dir);
  expect(e.issues).toEqual([]);expect(r).toMatchObject({outcome:'lifted',attempts:2,recovered:true,attention:false,unexpectedContacts:0});
  expect(attempts.map(a=>a.outcome)).toEqual(['grip_not_established','lifted']);
  const commits=e.attempts.filter(a=>a.cupId==='cup-1'&&a.stage==='commit'),first=commits[0]!,retry=commits[1]!;
  expect(commits).toHaveLength(2);expect(first.beliefUsed!.publishedTick).toBe(first.decidedTick);
  const prior=e.beliefs.filter(b=>b.objectId==='cup-1'&&b.belief&&b.tick<first.decidedTick).at(-1)!.belief!;
  const profile=JSON.parse(await readFile(join(root,'fixtures/perception-v1/perception-lossy-v1.json'),'utf8')),reach=loadOracleProfile().profile.mujocoArm!.reachTolRad;
  const atCommit=world.records[first.decidedTick]!,q=atCommit.command!.jointTargets![0]!.positionsRad;
  const same=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const hold=world.records.filter(row=>row.snapshot.tick>prior.publishedTick+profile.maxAgeTicks&&row.snapshot.tick<first.decidedTick&&row.command?.worldControl?.program?.waypoint==='pickApproach'&&same(row.command.jointTargets![0]!.positionsRad,q)&&row.snapshot.arms![0]!.positionsRad.every((v,i)=>Math.abs(v-q[i]!)<=reach));
  expect(hold.length).toBeGreaterThan(5);expect(hold.at(-1)!.snapshot.tick).toBe(first.decidedTick-1);
  for(const [i,row] of hold.entries()){
   if(i)expect(row.snapshot.tick).toBe(hold[i-1]!.snapshot.tick+1);
   expect(row.command!.worldControl!.program).toMatchObject({stage:0,waypoint:'pickApproach'});expect(row.snapshot.arms![0]!.gripper!.heldPropIds).toEqual([]);expect(row.command!.gripperTargets![0]!.openingM).toBeGreaterThan(.08);
  }
  expect(first.beliefUsed!.observedTick).toBeGreaterThan(hold[0]!.snapshot.tick);expect(first.beliefUsed!.ageTicks).toBeLessThanOrEqual(profile.maxAgeTicks);
  expect(steps.map(s=>[s.action,s.result])).toEqual([['open_gripper','done'],['retreat_pick_approach','done'],['await_fresh_belief','done'],['retry_pick','done']]);
  const retreat=steps.find(s=>s.action==='retreat_pick_approach')!,wait=steps.find(s=>s.action==='await_fresh_belief')!;
  expect(wait.completedTick!-wait.recordedTick).toBeGreaterThan(1);expect(retry.beliefUsed!.observedTick).toBeGreaterThan(retreat.completedTick!);expect(retry.decidedTick).toBeGreaterThan(wait.completedTick!);
  for(const s of steps){const records=e.recovery.filter(row=>row.stepId===s.stepId);expect(records.map(row=>row.result)).toEqual(['pending','done']);expect(records[0]!.recordedTick).toBeLessThanOrEqual(records[1]!.completedTick!);}
  expect(report.outcome.served).toBe('0');expect(report.coffee!.cups.find(c=>c.cupId==='cup-1')?.ownerKind).toBe('arm');
 },900_000);
 test('without a recovery policy the same failed grip is the R2b behaviour: no recovery step, never recovered',async()=>{
  const {e,attempts}=await rig(1,null);
  expect(e.recovery).toEqual([]);expect(attempts).toHaveLength(1);expect(attempts[0]!.outcome).not.toBe('lifted'); // never a second attempt, never a recovery step
 },900_000);
 test('REC04 (cup pushed off its support): the registered nudge (14.4 N, +x) at the start of the descent knocks the cup off the stand; the table does NOT recover it: facts missing, no recovery step, the gripper is not opened, nothing is served',async()=>{
  const dir=await directory('rec04-fallen');
  const r=await runPickRig({seed:1,mode:'belief_ground_truth',truthOffsetM:0,profileId:null,nudge:true,recoveryPolicyId:'pick-recovery-v1',directory:dir},await runtime() as never);
  const ev=join(dir,'run/belief-evidence'),e=await readBeliefEvidence(ev,await readBeliefManifest(ev)),report=JSON.parse(await readFile(join(dir,'report.json'),'utf8'));
  expect(e.recovery).toEqual([]);expect(r).toMatchObject({outcome:'grip_not_established',attention:true,recovered:false});
  expect(report.coffee.armTrace.stop.reason).toBe('RECOVERY_FACTS_MISSING');expect(report.outcome.served).toBe('0');
  expect(JSON.stringify(report).includes('world-cup-nudge-v1')).toBe(true);
  const {arm}=await retainedRun(dir);expect(arm.programs.find(p=>p.program==='cup-pick')!.state).toBe('unknown');expect(arm.gripperCommandM).toBe(0);expect(arm.holding).toBeNull();
 },900_000);
 test('REC04: cancelling a native held cup with belief/recovery enabled never recovers, opens the gripper or falsely serves',async()=>{
  const dir=await directory('rec04-cancel-held'),out=join(dir,'campaign');
  const verdict=await runCellCampaign({root:resolve('.'),out,sourceCommit:sourceCommit(),caseId:'cancel-held',belief:{graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1'}});
  expect(verdict).toEqual({expectedRuns:1,completedCases:1,missingArtifacts:[],issues:[]});
  const runDir=join(out,'cancel-held'),{report,arm,world}=await retainedRun(runDir),before=JSON.parse(await readFile(join(runDir,'fault-before.json'),'utf8'));
  const ev=join(runDir,'run/belief-evidence'),e=await readBeliefEvidence(ev,await readBeliefManifest(ev));expect(e.issues).toEqual([]);expect(e.recovery).toEqual([]);
  expect(arm).toMatchObject({holding:'cup-1',gripperCommandM:0,stop:{latched:true,reconcileRequired:true,reason:'CELL_CANCELLED'}});
  expect(world.records.at(-1)!.snapshot).toEqual(before.snapshot);expect(before.snapshot.arms[0].gripper.heldPropIds).toContain('cup-1');
  const held=world.records.filter(row=>row.snapshot.arms?.[0]?.gripper?.heldPropIds.includes('cup-1'));expect(held.length).toBeGreaterThan(0);for(const row of held)expect(row.command!.gripperTargets![0]!.openingM).toBe(0);
  expect(report.outcome.served).toBe('0');expect(report.coffee!.cups.find(c=>c.cupId==='cup-1')?.ownerKind).toBe('arm');expect(report.businessEvents.filter(e=>e.type==='CupHandedOff')).toEqual([]);
 },900_000);
});
