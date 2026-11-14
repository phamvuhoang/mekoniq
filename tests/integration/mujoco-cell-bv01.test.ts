import {existsSync} from 'node:fs';
import {describe,expect,test} from 'vitest';
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openCell,cellUntil,cellCampaign} from '../support/mujoco-cell';
import {evaluateWorldSweep} from '../../packages/lab-runtime/src/v2/simulation3d/world-sweep';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
describe.skipIf(!existsSync(resolve('.venv-mujoco/bin/python')))('shared world native checks (requires .venv-mujoco)',()=>{
for(const seed of cellCampaign.nominalSeeds)test(`Source continuous cell serves two confirmed coffees, seed ${seed}`,async()=>{
 const h=await openCell(seed,'nominal');let saved!:Awaited<ReturnType<typeof h.save>>;
 try{await h.run.start();await cellUntil(h.run,()=>false,cellCampaign.maxTicks,50);saved=await h.save('nominal');console.log('B06 nominal',JSON.stringify({seed,directory:h.directory,outcome:saved.report.outcome,attention:saved.report.attention,armStop:saved.report.coffee?.armTrace.stop}));}
 finally{await h.run.close();expect(h.processes.processes()).toEqual([]);}
 const {report,rawJournal}=saved,read=await h.readback(),worldSweep=evaluateWorldSweep(read.records,read.admission,rawJournal,read.authority,read.complete);await writeFile(join(h.directory,'world-full-sweep.json'),JSON.stringify(worldSweep,null,2));expect(worldSweep.status).toBe('pass');expect(worldSweep.geometry.checkedIntervals).toBe(report.outcome.tick);expect(report.worldSweep?.geometry).toEqual(worldSweep.geometry);expect(report.worldSweep?.nativeContacts).toEqual(worldSweep.nativeContacts);expect(report.worldSweep?.scope).toMatchObject({publicCommittedTick:report.outcome.tick,prefixCovered:true,streamFinalized:false});
 await writeFile(join(h.directory,'readback-summary.json'),JSON.stringify({accepted:false,calibration:'not_calibrated',complete:read.complete,issues:read.issues,rows:read.records.length,sceneDigest:read.records[0]?.snapshot.sceneDigest},null,2));
 expect(report.outcome).toMatchObject({status:'completed',served:'2'});expect(report.attention).toEqual([]);expect(report.coffee!.armTrace.stop).toBeNull();
 expect(report.coffee!.cups.map(c=>[c.ownerKind,c.ownerId])).toEqual([['customer','table-1'],['customer','table-1']]);
 expect(report.businessEvents.filter(e=>e.type==='CupHandedOff')).toHaveLength(2);expect(report.businessEvents.filter(e=>e.type==='CupTransferConfirmed')).toHaveLength(4);
 expect(report.manifest.worldExtent).toMatchObject({minM:[-.6,-.6],maxM:[6,4],controller:{id:'grid-diff-world-v4',version:'4'}});
 expect(read.complete).toBe(true);expect(read.issues).toEqual([]);expect(read.records).toHaveLength(report.outcome.tick+1);
 const first=read.records[0]!.snapshot;expect(first.worldStep!.modelCount).toBe(1);expect(first.worldStep!.nq).toBe(35);
 let maxJump=0;const poses=new Map<string,number[]>();
 for(const row of read.records){const s=row.snapshot;expect(s.bootId).toBe(first.bootId);expect(s.sceneDigest).toBe(first.sceneDigest);expect(s.worldStep!.workerPid).toBe(first.worldStep!.workerPid);expect(s.worldStep!.physicsSubsteps).toBe((s.tick+1)*10);
  for(const p of s.props??[]){const prev=poses.get(p.propId);if(prev)maxJump=Math.max(maxJump,Math.hypot(...p.position.map((v,i)=>v-prev[i]!)));poses.set(p.propId,p.position);expect(['cup-1','cup-2']).toContain(p.propId);}
 }
 expect(maxJump).toBeLessThanOrEqual(.02);
 const interactions=read.records.flatMap(r=>r.interactions);expect(interactions.map(i=>[i.cupId,i.kind]).sort()).toEqual([['cup-1','birth'],['cup-1','remove'],['cup-2','birth'],['cup-2','remove']].sort());
 for(const i of interactions){const entry=rawJournal.find(e=>i.eventId.startsWith(e.entryId+':'))!;expect(entry).toBeDefined();const index=Number(i.eventId.split(':').at(-1)),events=entry.payload.events as unknown as {type:string;data:{id:string}}[];expect(events[index]).toMatchObject({type:i.kind==='birth'?'CupBound':'CupHandedOff',data:{id:i.cupId}});}
 expect(read.records.every(r=>!r.command?.worldPerturbations?.length&&!r.snapshot.worldStep!.disturbances?.length)).toBe(true);
 expect(hashJson(h.input().manifest.project)).toBe(read.scene.inputs.projectDigest);expect(report.manifest.project.hash).toBe(read.scene.inputs.projectDigest);expect(report.manifest.models.find(m=>m.id==='mujoco_shared_world')?.hash).toBe(first.sceneDigest);expect(report.manifest.armProgram?.physicsDigest).toBe(read.scene.models.armPhysics.sha256);
 const forbidden=read.records.flatMap(r=>(r.snapshot.physics?.contacts??[]).filter(c=>{const pair=[c.a,c.b];return pair.some(x=>x.startsWith('amr-1/'))&&pair.some(x=>x.startsWith('arm-1/')||x.startsWith('support/'));}));expect(forbidden).toEqual([]);
},cellCampaign.nativeDeadlineSecondsPerCase*1000);
});
