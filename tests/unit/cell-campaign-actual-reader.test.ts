import {readRetainedWorldAdmission} from '../../packages/lab-runtime/src/v2/simulation3d/world-arm-report';
import {readWorldEvidence} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
// Explicit retained-input reader regression. Uses historical B06 bytes; never current-tuple execution evidence.
import {expect,test} from 'vitest';import {mkdtemp,cp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {CELL_CAMPAIGN,CELL_CASES,cellArtifacts,verifyCellCampaign} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
// @ts-expect-error ESM retained evidence admission
import {retainedInput} from '../../scripts/retained-inputs.mjs';
test('historical actual B06 dirty-producer identity cannot masquerade as a clean current cell campaign',async()=>{
 const original=retainedInput('cell-nominal-7'),root=await mkdtemp(join(tmpdir(),'b10-actual-cell-reader-'));try{
  const dir=join(root,'nominal-7');await mkdir(dir);await cp(original,join(dir,'run'),{recursive:true});const report=JSON.parse(await readFile(join(original,'nominal-report.json'),'utf8')),sourceCommit=report.manifest.sourceCommit;
  for(const [from,to]of [['nominal-report.json','report.json'],['nominal-source-journal.json','source-journal.json'],['nominal-controller-state.json','controller-state.json'],['nominal-physical-custody.json','physical-custody.json']])await cp(join(original,from!),join(dir,to!));
  // Synthetic observer envelope exercises readback only. The world and journal bytes are unmodified actual B06 output.
  const admission=await readRetainedWorldAdmission(original,report.worldSweep.scope.identity.sceneDigest),world=await readWorldEvidence(join(original,'world-evidence'),admission);const trace={opens:1,workerPid:world.records[0]!.snapshot.worldStep!.workerPid,requests:[{requestId:'create',op:'create',delivered:true},...world.records.slice(1).map(row=>({requestId:'step-'+row.snapshot.tick,op:'step',targetTick:row.snapshot.tick,delivered:true,responseDigest:hashJson(row.snapshot)}))],error:null};await writeFile(join(dir,'trace.json'),JSON.stringify(trace));await writeFile(join(root,'campaign.json'),JSON.stringify({campaign:CELL_CAMPAIGN,sourceCommit,accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'}));await writeFile(join(dir,'case.json'),JSON.stringify({schemaVersion:1,case:CELL_CASES[0],sourceCommit,accepted:false,execution:'actual_mujoco',engineVersion:'3.17.0',artifacts:await cellArtifacts(dir)}));
  const read=await verifyCellCampaign(root);expect(read.issues).toContain('CELL_CAMPAIGN_IDENTITY');expect(read.issues).toContain('nominal-7:CELL_CASE_IDENTITY');expect(read.completedCases).toBe(0);expect(read.missingArtifacts).toHaveLength(8);

 }finally{await rm(root,{recursive:true,force:true});}
},120000);
