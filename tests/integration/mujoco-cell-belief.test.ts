// V13 / REC05: the cell at belief_estimated with the nominal profile and the recovery policy serves 2 on three seeds, and the five R2b fault cases keep their detection / custody / served outcome (the shared cell campaign verdict).
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterAll,describe,expect,test} from 'vitest';
import {runCellCampaign} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
const dirs:string[]=[];afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true});});
describe.skipIf(!existsSync(resolve('.venv-mujoco/bin/python')))('cell at belief_estimated with recovery (requires .venv-mujoco)',()=>{
 test('three nominal seeds serve 2 and the five fault cases detect/custody/served as at baseline',async()=>{
  const out=join(await mkdtemp(join(tmpdir(),'cell-belief-')),'out');dirs.push(join(out,'..'));
  const verdict=await runCellCampaign({root:resolve('.'),out,sourceCommit:'a'.repeat(40),belief:{graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1'}}) as {completedCases:number;expectedRuns:number;issues:string[];missingArtifacts:string[];faultCases?:{detected:boolean;falseServed:boolean}[]};
  expect(verdict).toMatchObject({completedCases:verdict.expectedRuns,issues:[],missingArtifacts:[]});expect((verdict.faultCases??[]).every(c=>c.detected&&!c.falseServed)).toBe(true);
  for(const seed of [7,42,99]){const r=JSON.parse(await readFile(join(out,`nominal-${seed}`,'report.json'),'utf8'));expect(r.outcome,`nominal-${seed}`).toMatchObject({status:'completed',served:'2'});expect(r.perceptionEvidence.issues).toEqual([]);}
 },5_400_000);
});
