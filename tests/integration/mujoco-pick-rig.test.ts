// V12 / BEL05: the pick rig on the real engine. One run each: the cup born 20 mm off the nominal centre is lifted from a ground-truth belief; the artifacts are the retained belief stream and the run record.
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,describe,expect,test} from 'vitest';
import {runPerceptionStudy,verifyPerceptionStudy} from '../../packages/lab-runtime/src/v2/perception/perception-study';
import {runPickRig} from '../../packages/lab-runtime/src/v2/perception/pick-rig';
import {readBeliefEvidence,readBeliefManifest} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
import {lockDigestOf} from '../../packages/lab-runtime/src/engineering/linkforge';
const root=resolve('robotics/simulation-mujoco'),dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const runtime=async()=>({python:resolve('.venv-mujoco/bin/python'),workerRoot:root,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(root,'requirements.lock')),engineVersion:'3.17.0'});
describe.skipIf(!existsSync(resolve('.venv-mujoco/bin/python')))('pick rig on the real engine (requires .venv-mujoco)',()=>{
 test('belief_ground_truth, cup born 20 mm off the centre (seed 6): lifted at the first attempt, the belief error at commit is zero, the run record matches the retained stream',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pick-rig-'));dirs.push(dir);
  const r=await runPickRig({seed:6,mode:'belief_ground_truth',truthOffsetM:0.02,profileId:null,nudge:false,recoveryPolicyId:null,directory:dir},await runtime() as never);
  expect(r).toMatchObject({outcome:'lifted',attempts:1,recovered:false,attention:false,beliefErrorAtCommitM:0});
  const rec=JSON.parse(await readFile(join(dir,'rig-run.json'),'utf8'));expect(Math.hypot(...(rec.offsetM as [number,number]))).toBeCloseTo(0.02,9);
  const evDir=join(dir,'run/belief-evidence'),e=await readBeliefEvidence(evDir,await readBeliefManifest(evDir));
  expect(e.issues).toEqual([]);expect(e.attempts.filter(a=>a.cupId==='cup-1').at(-1)!.outcome).toBe('lifted');
 },900_000);
 test('seed 4 puts the cup 17 mm toward the arm: the arm self-collision gate (ARM03 capsules) refuses before any motion, and the rig records it as a refusal, not a miss',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pick-rig-'));dirs.push(dir);
  const r=await runPickRig({seed:4,mode:'belief_ground_truth',truthOffsetM:0.02,profileId:null,nudge:false,recoveryPolicyId:null,directory:dir},await runtime() as never);
  expect(r).toMatchObject({outcome:'refused',attempts:1,attention:true});
  const evDir=join(dir,'run/belief-evidence'),e=await readBeliefEvidence(evDir,await readBeliefManifest(evDir));
  expect(e.attempts.at(-1)).toMatchObject({refusal:'ARM_COLLISION',gates:{belief:'pass',region:'pass',ik:'pass',sweep:'ARM_COLLISION'}});
 },900_000);
 test('the study runner records a registered point and the verifier recomputes it from the artifacts; an edited run record is refused',async()=>{
  const out=join(await mkdtemp(join(tmpdir(),'study-')),'out');dirs.push(join(out,'..'));
  const verdict=await runPerceptionStudy({root:resolve('.'),out,sourceCommit:'a'.repeat(40),pointId:'truth-0'});
  expect(verdict).toMatchObject({expectedRuns:1,completedRuns:1,missingArtifacts:[],issues:[]});
  expect(verdict.study!.points[0]).toMatchObject({id:'truth-0',runs:1,firstTry:1,attention:0,outcomes:{lifted:1}});expect(verdict.study!.points[0]!.firstTryInterval.high).toBe(1);
  const file=join(out,'truth-0/s1/rig-run.json'),rec=JSON.parse(await readFile(file,'utf8'));rec.result.outcome='refused';await writeFile(file,JSON.stringify(rec));
  const edited=await verifyPerceptionStudy(out,'truth-0');expect(edited.completedRuns).toBe(0);expect(edited.issues.join()).toContain('ARTIFACT_HASH_MISMATCH');
 },900_000);
 test('REC06 measurement: the registered nudge (14.4 N, the largest force that keeps the cup on its stand) is applied after the belief grasp committed and the gripper still lifts the cup; 15 N knocks it off the stand instead (scan in the V13 ledger)',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pick-rig-'));dirs.push(dir);
  const r=await runPickRig({seed:1,mode:'belief_ground_truth',truthOffsetM:0,profileId:null,nudge:true,recoveryPolicyId:null,directory:dir},await runtime() as never);
  expect((await readFile(join(dir,'report.json'),'utf8')).includes('world-cup-nudge-v1')).toBe(true); // intent and receipt are in the report
  expect(r).toMatchObject({outcome:'lifted',attempts:1,attention:false}); // so there is nothing to recover: no force satisfies both conditions of R4-D33 in this cell
 },900_000);
});
