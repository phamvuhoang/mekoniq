import {expect,test} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as cell from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
test('current cell campaign requires three nominal seeds and five fault artifacts, not an all-pass summary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cell-campaign-check-'));try{await writeFile(join(root,'summary.json'),JSON.stringify({accepted:false,passed:true,cases:[]}));const v=await cell.verifyCellCampaign(root);expect(v.expectedRuns).toBe(8);expect(v.completedCases).toBe(0);expect(v.issues).toContain('CELL_CAMPAIGN_IDENTITY');expect(v.missingArtifacts).toHaveLength(8);}finally{await rm(root,{recursive:true,force:true});}
});
test('cell reader rejects a synthetic/double case even when it lists artifacts and a valid source SHA',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cell-campaign-double-'));try{await mkdir(join(root,'nominal-7'));await writeFile(join(root,'nominal-7/case.json'),JSON.stringify({sourceCommit:'a'.repeat(40),execution:'double',accepted:false,artifacts:[]}));const v=await cell.verifyCellCampaign(root);expect(v.completedCases).toBe(0);expect(v.issues.some(x=>x.includes('CELL_CASE_IDENTITY'))).toBe(true);}finally{await rm(root,{recursive:true,force:true});}
});
test.each(['missing','malformed','invalid registry'])('campaign header (%s) rejects every case and retains bounded envelope diagnostics',async variant=>{
 const root=await mkdtemp(join(tmpdir(),'cell-header-')),sourceCommit='b'.repeat(40);
 try{
  if(variant==='malformed')await writeFile(join(root,'campaign.json'),'{');
  if(variant==='invalid registry')await writeFile(join(root,'campaign.json'),JSON.stringify({campaign:cell.CELL_CAMPAIGN,sourceCommit,accepted:false,execution:'actual_mujoco',calibration:'not_calibrated',driveExperimentId:'drive-nominal-v1',hostArch:'arm64',driveProfileRegistry:'unregistered'}));
  const spec=cell.CELL_CASES[0]!,dir=join(root,spec.id);await mkdir(dir);
  await writeFile(join(dir,'case.json'),JSON.stringify({schemaVersion:1,case:spec,sourceCommit:variant==='missing'?undefined:sourceCommit,accepted:false,execution:'actual_mujoco',engineVersion:'3.17.0'}));
  const v=await cell.verifyCellCampaign(root);
  expect(v.completedCases).toBe(0);expect(v.missingArtifacts).toEqual(cell.CELL_CASES.map(c=>c.id));
  expect(v.issues).toContain('CELL_CAMPAIGN_IDENTITY');expect(v.issues).toContain(spec.id+':CELL_CASE_IDENTITY');
 }finally{await rm(root,{recursive:true,force:true});}
});
