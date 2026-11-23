// The native recorder runs the complete population once outside the suite.
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {test,expect} from 'vitest';
import {verifyRecoveryCampaign} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
const directory=process.env.RECOVERY_RECORDED_DIR;
test.skipIf(!directory||!existsSync(join(directory,'campaign.json')))('REC06 validates eleven retained full-cell cases',async()=>{
 expect(await verifyRecoveryCampaign(directory!)).toEqual({expectedRuns:11,completedCases:11,missingArtifacts:[],issues:[]});
},900_000);
import {readFile} from 'node:fs/promises';
import {readRetainedWorldAdmission} from '../../packages/lab-runtime/src/v2/simulation3d/world-arm-report';
import {readWorldEvidence} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {verifyNativeRecoveryCase} from '../../packages/lab-runtime/src/v2/perception/recovery-cell-evidence';
import type {RunReport} from '../../packages/lab-runtime/src/v2/report';
test.skipIf(!directory||!existsSync(join(directory,'pulse-42/report.json')))('the seed42 native proof rejects altered decisions, recovery, program and world commands',async()=>{
 const dir=join(directory!,'pulse-42'),report=JSON.parse(await readFile(join(dir,'report.json'),'utf8')) as RunReport;
 const admission=await readRetainedWorldAdmission(join(dir,'run'),report.worldSweep!.scope!.identity.sceneDigest),world=await readWorldEvidence(join(dir,'run/world-evidence'),admission);
 expect(world.issues).toEqual([]);
 const spec={seed:42,kind:'pulse'},verify=(r:RunReport,rows=world.records)=>verifyNativeRecoveryCase(r,admission,rows,spec);
 for(const mutate of [
  (r:RunReport)=>{r.manifest.seed=7;},
  (r:RunReport)=>{r.manifest.perception!.graspMode='belief_ground_truth';},
  (r:RunReport)=>{r.manifest.perception!.profile.id='perception-ground-truth-v1';},
  (r:RunReport)=>{r.manifest.armProgram!.programs.contact!.captureM=.0889;},
  (r:RunReport)=>{r.perceptionEvidence!.attemptRecords.find(a=>a.outcome==='grip_not_established')!.outcome='unknown';},
  (r:RunReport)=>{r.perceptionEvidence!.recovery.reverse();},
  (r:RunReport)=>{r.perceptionEvidence!.attemptRecords.find(a=>a.attemptId==='cup-1#1')!.beliefUsed!.observedTick-=20;}
 ]){const copy=structuredClone(report);mutate(copy);await expect(verify(copy)).rejects.toThrow();}
 const miss=report.perceptionEvidence!.attemptRecords.find(a=>a.outcome==='grip_not_established')!,end=miss.recordedTick!,rows=world.records.slice();
 const held=structuredClone(rows[end]!);held.snapshot.arms![0]!.gripper!.heldPropIds=['cup-1'];rows[end]=held;
 await expect(verify(report,rows)).rejects.toThrow(/MISS_OBSERVATION/);
 const change=(tick:number)=>{rows[tick]=structuredClone(world.records[tick]!);return rows[tick]!;};
 rows[end]=world.records[end]!;
 for(let t=miss.decidedTick;t<=end;t++)change(t).command!.gripperTargets![0]!.openingM=.0889;
 await expect(verify(report,rows)).rejects.toThrow(/CAPTURE/);
 const pulse=world.records.slice(),first=miss.decidedTick+1;pulse[first]=structuredClone(pulse[first]!);
 pulse[first]!.snapshot.worldStep!.disturbances![0]!.requestDigest='1'.repeat(64);
 await expect(verify(report,pulse)).rejects.toThrow(/PERTURBATION/);
},300_000);
