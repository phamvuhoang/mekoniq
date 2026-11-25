// The native recorder runs the complete population once outside the suite.
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {test,expect} from 'vitest';
import {verifyRecoveryCampaign} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
const directory=process.env.RECOVERY_RECORDED_DIR;
test.skipIf(!directory||!existsSync(join(directory,'campaign.json')))('REC06 validates eleven retained full-cell cases',async()=>{
 expect(await verifyRecoveryCampaign(directory!)).toEqual({expectedRuns:11,completedCases:11,missingArtifacts:[],issues:[]});
},900_000);
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {cellArtifacts} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
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

test.skipIf(!directory||!existsSync(join(directory,'pulse-42/report.json')))('retreat completion and continuing guards are proved by the recorded native rows',async()=>{
 const dir=join(directory!,'pulse-42'),report=JSON.parse(await readFile(join(dir,'report.json'),'utf8')) as RunReport;
 const admission=await readRetainedWorldAdmission(join(dir,'run'),report.worldSweep!.scope!.identity.sceneDigest),world=await readWorldEvidence(join(dir,'run/world-evidence'),admission);
 expect(world.issues).toEqual([]);
 const verify=(r:RunReport,rows=world.records)=>verifyNativeRecoveryCase(r,admission,rows,{seed:42,kind:'pulse'});
 const copy=structuredClone(report),steps=copy.perceptionEvidence!.recovery,early=steps[2]!.recordedTick;
 steps[3]!.completedTick=early;steps[4]!.recordedTick=steps[5]!.recordedTick=early+1;
 expect(world.records[early]!.command!.worldControl!.program!.waypoint).toBe('pick');
 await expect.soft(verify(copy)).rejects.toThrow(/RETREAT/);
 const shortOpen=structuredClone(report),open=shortOpen.perceptionEvidence!.recovery;
 open[1]!.completedTick=open[1]!.completedTick!-1;open[2]!.recordedTick--;open[3]!.recordedTick--;
 await expect.soft(verify(shortOpen)).rejects.toThrow(/OPEN/);
 const unsettled=world.records.slice(),arrival=report.perceptionEvidence!.recovery[3]!.completedTick!;
 unsettled[arrival]=structuredClone(unsettled[arrival]!);
 unsettled[arrival]!.snapshot.arms![0]!.positionsRad=[...world.records[early]!.snapshot.arms![0]!.positionsRad];
 await expect.soft(verify(report,unsettled)).rejects.toThrow(/RETREAT_SETTLE/);
 for(const tick of [early+1,report.perceptionEvidence!.recovery[5]!.completedTick!+1]){
  const rows=world.records.slice(),row=structuredClone(rows[tick]!);rows[tick]=row;
  row.snapshot.props!.find(p=>p.propId==='cup-1')!.restingOn=null;
  await expect.soft(verify(report,rows)).rejects.toThrow(/RECOVERY_GUARD/);
 }
},300_000);
test.skipIf(!directory||!existsSync(join(directory,'lost-ack/report.json')))('resealed fault cases bind the pending command and lost ACK session',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'recovery-fault-readback-'));
 try{
  await cp(join(directory!,'campaign.json'),join(temp,'campaign.json'));
  const reseal=async(dir:string)=>{
   const file=join(dir,'case.json'),c=JSON.parse(await readFile(file,'utf8'));c.artifacts=await cellArtifacts(dir);await writeFile(file,JSON.stringify(c));
  };
  for(const id of ['worker-loss','lost-ack']){
   const dir=join(temp,id);await cp(join(directory!,id),dir,{recursive:true});
   const name=id==='worker-loss'?'trace.json':'lost-ack-native-response.json',file=join(dir,name),doc=JSON.parse(await readFile(file,'utf8'));
   if(id==='worker-loss')doc.requests.at(-1).requestDigest='0'.repeat(64);else doc.response.bootId=doc.request.runId;
   await writeFile(file,JSON.stringify(doc));
   await reseal(dir);
  }
  const v=await verifyRecoveryCampaign(temp);
  expect.soft(v.completedCases).toBe(0);expect.soft(v.issues).toContain('worker-loss:RECOVERY_PENDING_REQUEST');expect.soft(v.issues).toContain('lost-ack:RECOVERY_LOST_NATIVE_ACK');
  // Even a response whose trace digest matches must be the *next* native observation.
  const dir=join(temp,'lost-ack'),file='lost-ack-native-response.json',ack=JSON.parse(await readFile(join(directory!,'lost-ack',file),'utf8'));
  const trace=JSON.parse(await readFile(join(dir,'trace.json'),'utf8'));
  ack.response.result.tick--;trace.requests.at(-1).responseDigest=hashJson(ack.response.result);
  await writeFile(join(dir,file),JSON.stringify(ack));await writeFile(join(dir,'trace.json'),JSON.stringify(trace));await reseal(dir);
  expect((await verifyRecoveryCampaign(temp)).issues).toContain('lost-ack:WORLD_EVIDENCE_IDENTITY_INVALID');
 }finally{await rm(temp,{recursive:true,force:true});}
},300_000);
