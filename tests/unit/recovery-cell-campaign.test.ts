import {expect,test} from 'vitest';
// @ts-expect-error plain ESM script without types
import {artifactDispositionsFromGroups,CAMPAIGNS} from '../../scripts/r4-readback.mjs';
// @ts-expect-error plain ESM script without types
import {CASES_R4} from '../../scripts/sim-extension-r4.mjs';
test('REC06 requires verified recovery campaign input and an executed native suite',()=>{
 expect(CASES_R4.REC06).toMatchObject({input:'recoveryCampaign',suites:['rec-unit','rec-engine']});
 expect(CAMPAIGNS.recoveryCampaign.ids).toEqual(['mj-cell-recovery-v2']);
 for(const [issues,status] of [[['RECOVERY_CAMPAIGN_MISSING'],'not_run'],[['RECOVERY_CAMPAIGN_CORRUPT'],'failed'],[[],'tested']] as const)
  expect(artifactDispositionsFromGroups({recoveryCampaign:issues}).REC06.status).toBe(status);
});
import * as proof from '../../packages/lab-runtime/src/v2/perception/recovery-cell-evidence';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
test('private pre-send intent binds the complete command, request and executed grasp',()=>{
 const command={targetTick:91,worldPerturbations:[{segmentIndex:2}]},snapshot={runId:'x',bootId:'b',sceneDigest:'s',parse:1};
 const receipt={requestId:'world-93',requestDigest:hashJson(command),segmentIndex:2},execution='a'.repeat(64);
 const intent={schemaVersion:1,runId:'x',bootId:'b',sceneDigest:'s',requestId:'world-93',requestDigest:receipt.requestDigest,graspProgramExecutionDigest:execution,command};
 const validate=(stored:unknown)=>proof.verifyRecoveryIntent(stored,{command,snapshot} as never,receipt as never,execution);
 expect(()=>validate(intent)).not.toThrow();
 for(const change of [{command:{...command,targetTick:92}},{requestId:'different'},{requestDigest:'b'.repeat(64)},{graspProgramExecutionDigest:'c'.repeat(64)},{runId:'other'}])expect(()=>validate({...intent,...change})).toThrow(/INTENT/);
});
test('a held-open trace cannot stand in for the registered capture at a known miss',()=>{
 const rows=(targets:number[])=>targets.map((openingM,tick)=>({snapshot:{tick,arms:[{gripper:{heldPropIds:[]}}]},command:{worldControl:{program:{waypoint:'pick',commandId:'pick-1',cupId:'cup-1',programId:'cup-pick'}},gripperTargets:[{armId:'arm-1',openingM}]}}));
 const check=(targets:number[])=>proof.verifyCaptureTargets(rows(targets) as never,'arm-1','cup-1','pick-1',{openM:.0889,captureM:.07,closedM:0,gripSettleTicks:2} as never,false);
 expect(()=>check([.0889,.07,.07])).not.toThrow();
 for(const targets of [[.0889,.0889,.0889],[.07,.0889,.0889],[.07,.07,0]])expect(()=>check(targets)).toThrow(/CAPTURE/);
});
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {RECOVERY_CAMPAIGN,verifyRecoveryCampaign} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
// @ts-expect-error plain ESM script without types
import {verifyOneCampaign} from '../../scripts/r4-readback.mjs';
test('an absent input, incomplete population, and malformed or wrong producer tuple have distinct dispositions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rec06-registry-')),dir=join(root,'inputs/recovery'),source='a'.repeat(40),key='recoveryCampaign',spec=CAMPAIGNS[key];
 const verify=(inputs:unknown)=>verifyOneCampaign(root,{inputs},key,spec,source);
 try{
  expect(await verify({})).toEqual(['RECOVERY_CAMPAIGN_MISSING']);
  await mkdir(dir,{recursive:true});expect(await verify({})).toEqual(['RECOVERY_CAMPAIGN_CORRUPT']);
  const bytes=JSON.stringify({campaign:RECOVERY_CAMPAIGN,sourceCommit:'b'.repeat(40),accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'});
  await writeFile(join(dir,'campaign.json'),bytes);
  const issues=await verify({[key]:{file:'inputs/recovery/campaign.json',sha256:createHash('sha256').update(bytes).digest('hex')}});
  expect(issues).toContain('RECOVERY_CAMPAIGN_TUPLE_MISMATCH');
  const v=await verifyRecoveryCampaign(dir);expect(v.expectedRuns).toBe(11);expect(v.completedCases).toBe(0);expect(v.missingArtifacts).toHaveLength(11);
  expect(artifactDispositionsFromGroups({recoveryCampaign:issues}).REC06.status).toBe('failed');
 }finally{await rm(root,{recursive:true,force:true});}
});
