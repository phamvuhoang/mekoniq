// V11 / BEL04: a belief grasp on the real engine: MJ-CELL-BV01 picks from a belief world fed by the simulated estimator; the fixed program stays the R2b run.
import {existsSync} from 'node:fs';
import {rm,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {afterEach,describe,expect,test} from 'vitest';
import {openCell,cellUntil,cellCampaign} from '../support/mujoco-cell';
import {readBeliefEvidence,readBeliefManifest} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
type Cell=Awaited<ReturnType<typeof openCell>>;
const open:Cell[]=[];
afterEach(async()=>{for(const h of open.splice(0)){await h.run.close().catch(()=>{});await rm(h.directory,{recursive:true,force:true});}});
const deadline=cellCampaign.nativeDeadlineSecondsPerCase*1000;
const finalAttempts=<T extends {attemptId:string}>(list:T[])=>[...new Map(list.map(a=>[a.attemptId,a])).values()];
async function evidence(h:Cell){const dir=join(h.directory,'belief-evidence'),m=await readBeliefManifest(dir);return {m,...await readBeliefEvidence(dir,m)};}

describe.skipIf(!existsSync(resolve('.venv-mujoco/bin/python')))('belief grasp on the real engine (requires .venv-mujoco)',()=>{
 test('a hot belief report proves its flushed live prefix and refuses a corrupted native world without throwing away the report',async()=>{
  const h=await openCell(7,'belief-prefix',{rig:{offsetM:[0,0]}},{graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1'});open.push(h);
  await h.run.start();await cellUntil(h.run,()=>false,200,20);const report=await h.run.report();
  expect(report.perceptionEvidence).toMatchObject({complete:false,issues:[],policy:{ageBasis:'publishedTick',profile:{id:'perception-nominal-v1',maxAgeTicks:50}},coverage:{scope:'belief_evaluations',firstTick:0,lastTick:report.outcome.tick,prefixCovered:true,streamFinalized:false}});
  expect(report.perceptionEvidence!.beliefs.length).toBeGreaterThan(0);expect(report.arm!.worldTrace!.prefixCovered).toBe(true);
  const manifest=JSON.parse(await readFile(join(h.directory,'world-evidence/manifest.json'),'utf8'));
  if(manifest.chunks.length)await writeFile(join(h.directory,'world-evidence',manifest.chunks[0].path),'corrupt');
  else await writeFile(join(h.directory,'world-evidence/pending.ndjson'),'corrupt\n');
  const bad=await h.run.report();expect(bad.perceptionEvidence!.coverage!.prefixCovered).toBe(false);expect(bad.perceptionEvidence!.issues).toContain('BELIEF_WORLD_COVERAGE');
 },120000);
 test('belief_ground_truth, seed 7: two coffees served, one lifted attempt per cup, the attempt before any grasp motion',async()=>{
  const h=await openCell(7,'belief-gt',{},{graspMode:'belief_ground_truth'});open.push(h);
  await h.run.start();await cellUntil(h.run,()=>false,cellCampaign.maxTicks,50);
  const saved=await h.save('belief-gt'),report=saved.report;
  expect(report.outcome,JSON.stringify(report.attention)).toMatchObject({status:'completed',served:'2'});expect(report.attention).toEqual([]);
  expect(report.manifest.perception).toMatchObject({graspMode:'belief_ground_truth',profile:{id:'perception-ground-truth-v1'},recoveryPolicy:null});
  await h.run.close();const e=await evidence(h);
  expect(e.issues).toEqual([]);expect(e.complete).toBe(true);
  const attempts=finalAttempts(e.attempts);expect(attempts.map(a=>[a.cupId,a.index,a.outcome])).toEqual([['cup-1',0,'lifted'],['cup-2',0,'lifted']]);
  expect(attempts.every(a=>a.gates.belief==='pass'&&a.gates.region==='pass'&&a.gates.ik==='pass'&&a.gates.sweep==='pass'&&a.beliefErrorAtCommitM===0)).toBe(true);
  expect(e.beliefs.every(b=>b.errorM===null||b.errorM===0)).toBe(true);
  // the report of the run carries the stream (R4.4 report section), the same records the reader found
  expect(report.perceptionEvidence).toMatchObject({schemaVersion:1,issues:[]});expect(report.perceptionEvidence!.beliefs.length).toBe(e.beliefs.length);expect(report.perceptionEvidence!.attempts.map(a=>a.outcome)).toEqual(['lifted','lifted']);
 },deadline);
 test('a lossy estimator (seed 54: the one estimate it ever gave ages out and no fresh one comes) never gives a usable belief: after beliefWaitTicks the run asks for a person, no grasp is planned',async()=>{
  // seed 54 is a registered-profile seed whose dropout chain covers the wait of cup-1 (chosen with the pure estimator, not by looking at this test's result)
  const h=await openCell(54,'belief-lossy',{},{graspMode:'belief_estimated',perceptionProfileId:'perception-lossy-v1'});open.push(h);
  await h.run.start();await cellUntil(h.run,()=>false,cellCampaign.maxTicks,50);
  const report=(await h.save('belief-lossy')).report;
  expect(report.outcome.status).toBe('needs_attention');expect(report.attention.map(a=>a.reason)).toContain('TRANSFER_FAILED');expect(report.outcome.served).toBe('0');
  await h.run.close();const e=await evidence(h),attempts=finalAttempts(e.attempts);
  expect(e.issues).toEqual([]);expect(attempts.map(a=>[a.cupId,a.outcome,a.refusal])).toEqual([['cup-1','refused','BELIEF_STALE']]);
  expect(attempts[0]!.decidedTick-e.beliefs.find(b=>b.belief)!.tick).toBeGreaterThanOrEqual(0);expect(attempts[0]!.waypointsRad).toBeUndefined();expect(attempts[0]!.gates.belief).toBe('BELIEF_STALE');
 },deadline);
 test('a bias that puts the belief outside the registered region is refused before any grasp motion',async()=>{
  const h=await openCell(7,'belief-out-of-region',{},{graspMode:'belief_estimated',perceptionProfileId:'perception-bias-out-of-region-v1'});open.push(h);
  await h.run.start();await cellUntil(h.run,()=>false,cellCampaign.maxTicks,50);
  const report=(await h.save('belief-out-of-region')).report;
  expect(report.outcome.status).toBe('needs_attention');expect(report.attention.map(a=>a.reason)).toContain('TRANSFER_FAILED');
  await h.run.close();const e=await evidence(h),attempts=finalAttempts(e.attempts);
  expect(attempts.map(a=>[a.cupId,a.outcome,a.refusal,a.gates.region,a.gates.ik])).toEqual([['cup-1','refused','BELIEF_OUT_OF_REGION','BELIEF_OUT_OF_REGION','not_evaluated']]);
 },deadline);
});
