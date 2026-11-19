// V05: the drive stream in the physics evidence of an AMR run: recorded with the tick, read back, and refused when it is missing, wrong, corrupt, cut or over quota.
import {expect,test} from 'vitest';
import {cp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openPhysicsRecorder,preparePhysicsAdmission,readPhysicsEvidence,readPhysicsManifest,type PhysicsAdmission} from '../../packages/lab-runtime/src/v2/simulation3d/physics-evidence';
import type {NavigationSceneV1,PhysicsTickRecord} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {act,setup,temp} from '../support/mujoco-drive';

type Drive={drives?:unknown[]};
/** A real run of 60 ticks on drive-nominal-v1, closed, and what its physics directory holds. */
async function recorded(experiment?:string){
 const h=await setup(experiment?{driveExperimentId:experiment}:{});
 await h.run.start();for(let i=0;i<3;i++)await act(h.run,'step',{ticks:20});
 const report=await h.run.report();await h.run.close();
 const scene=JSON.parse(Buffer.from(await h.service.bundleFile(h.receipt.bundleDigest!,'navigation-scene.json')).toString()) as NavigationSceneV1;
 const prepared=await preparePhysicsAdmission(scene,p=>h.service.bundleFile(h.receipt.bundleDigest!,p));
 const dir=join(h.runDirectory,'physics'),manifest=await readPhysicsManifest(dir),read=await readPhysicsEvidence(dir,manifest,{admission:prepared.admission,metricsPolicyDigest:prepared.metricsPolicyDigest});
 return {h,report,prepared,dir,manifest,read};
}
const fresh=async(r:Awaited<ReturnType<typeof recorded>>,over:{admission?:PhysicsAdmission;maxBytes?:number}={})=>openPhysicsRecorder({directory:join(await temp(),'p'),identity:r.manifest.identity,admission:over.admission??r.prepared.admission,metricsPolicyDigest:r.prepared.metricsPolicyDigest,assumptions:r.prepared.assumptions,...over.maxBytes?{maxBytes:over.maxBytes}:{}});
const clone=<T,>(v:T)=>JSON.parse(JSON.stringify(v)) as T;

test('the drive snapshots are recorded with the physics tick, in model order, and read back equal; the report section is built from them',async()=>{
 const r=await recorded('drive-nominal-v1');
 expect(r.read.issues).toEqual([]);expect(r.read.complete).toBe(true);expect(r.read.records).toHaveLength(61);
 expect(r.prepared.admission.driveAxes).toEqual(['amr-1/wheel-left','amr-1/wheel-right']);
 for(const [t,rec] of r.read.records.entries()){const d=(rec as Drive).drives as {axisId:string;tick:number}[];expect(d.map(x=>x.axisId)).toEqual(['amr-1/wheel-left','amr-1/wheel-right']);expect(d.every(x=>x.tick===t)).toBe(true);}
 const section=r.report.driveEvidence!;
 expect(section).toMatchObject({testLevel:'controller_in_the_loop',complete:true,issues:[],ticks:61});
 expect(section.axes.map(a=>a.axisId)).toEqual(['amr-1/wheel-left','amr-1/wheel-right']);
 expect(section.axes[0]!.states.map(s=>s.state)).toEqual(['disabled','ready','enabled']);   // the enable sequence is in the evidence
 expect(section.axes[0]!.enabledAtTick).toBeGreaterThan(1);expect(section.axes[0]!.trackingRms.available).toBe(true);
});
test('a run without a drive records no drives and its report has no drive section; a record that carries drives is then refused',async()=>{
 const r=await recorded();
 expect(r.read.complete).toBe(true);expect(r.read.records.every(x=>(x as Drive).drives===undefined)).toBe(true);expect(r.report.driveEvidence).toBeUndefined();
 expect(r.prepared.admission.driveAxes).toBeUndefined();
 const rec=await fresh(r);const first=clone(r.read.records[0]!) as PhysicsTickRecord&Drive;first.drives=[];
 await expect(rec.append(first as never)).rejects.toThrow('PHYSICS_OBSERVATION_INVALID');
});
test('the recorder refuses a tick whose drives are missing, short, foreign, out of order, or of another tick — and records the gap',async()=>{
 const r=await recorded('drive-nominal-v1'),good=r.read.records[0]! as PhysicsTickRecord&{drives:{axisId:string;tick:number;targetApplied:number}[]};
 const variants:[string,(x:typeof good)=>void][]=[
  ['missing',x=>{delete (x as Drive).drives;}],['one axis short',x=>{x.drives=x.drives.slice(0,1);}],['an axis of another robot',x=>{x.drives[1]!.axisId='amr-2/wheel-right';}],
  ['axes swapped',x=>{x.drives=[x.drives[1]!,x.drives[0]!];}],['another tick',x=>{x.drives[0]!.tick=7;}],['saturation above the substeps',x=>{(x.drives[0] as unknown as {saturatedSubsteps:number}).saturatedSubsteps=11;}],
  ['a state that does not exist',x=>{(x.drives[0] as unknown as {state:string}).state='running';}]];
 for(const [name,mutate] of variants){
  const rec=await fresh(r),bad=clone(good);mutate(bad);
  await expect(rec.append(bad as never),name).rejects.toThrow('PHYSICS_OBSERVATION_INVALID');
  expect(rec.manifest().gaps.length,name).toBe(1);expect(rec.manifest().terminalReason,name).toBe('PHYSICS_OBSERVATION_INVALID');
 }
});
test('every written record round-trips: appended, published and read again with the same drives',async()=>{
 const r=await recorded('drive-nominal-v1'),rec=await fresh(r);
 for(const x of r.read.records.slice(0,40))await rec.append(x);
 await rec.finish(null);
 const again=await readPhysicsEvidence(rec.directory,rec.manifest(),{admission:r.prepared.admission,metricsPolicyDigest:r.prepared.metricsPolicyDigest});
 expect(again.issues).toEqual([]);expect(again.records).toEqual(r.read.records.slice(0,40));
});
test('the reader catches a corrupt chunk, a missing chunk, a truncated chunk and an unpublished tail left by a kill between two flushes',async()=>{
 const r=await recorded('drive-nominal-v1'),opts={admission:r.prepared.admission,metricsPolicyDigest:r.prepared.metricsPolicyDigest};
 const copy=async()=>{const d=join(await temp(),'p');await cp(r.dir,d,{recursive:true});return d;};
 const chunks=(await readdir(r.dir)).filter(n=>n.endsWith('.ndjson.gz'));expect(chunks.length).toBeGreaterThan(0);
 let d=await copy();const bytes=await readFile(join(d,chunks[0]!));bytes[bytes.length-9]=bytes[bytes.length-9]!^0xff;await writeFile(join(d,chunks[0]!),bytes);
 expect((await readPhysicsEvidence(d,r.manifest,opts)).issues.some(i=>/HASH|PHYSICS_/.test(i))).toBe(true);
 d=await copy();await rm(join(d,chunks[0]!));expect((await readPhysicsEvidence(d,r.manifest,opts)).complete).toBe(false);
 d=await copy();const whole=await readFile(join(d,chunks[0]!));await writeFile(join(d,chunks[0]!),whole.subarray(0,whole.length>>1));expect((await readPhysicsEvidence(d,r.manifest,opts)).issues.length).toBeGreaterThan(0);
 // killed between an append and its flush: the WAL holds a tick no published chunk covers
 const rec=await fresh(r);for(const x of r.read.records.slice(0,10))await rec.append(x);   // 10 < chunkTicks: only in the WAL
 const killed=await readPhysicsEvidence(rec.directory,rec.manifest(),opts);expect(killed.issues).toContain('PHYSICS_UNPUBLISHED_TAIL');expect(killed.complete).toBe(false);
});
test('a quota too small for the stream ends the recording with PHYSICS_QUOTA_EXCEEDED and a gap; it never truncates silently',async()=>{
 const r=await recorded('drive-nominal-v1'),rec=await fresh(r,{maxBytes:40_000});let failed:string|null=null;
 try{for(const x of r.read.records)await rec.append(x);await rec.finish(null);}catch(e){failed=(e as Error).message;}
 expect(failed).toBe('PHYSICS_QUOTA_EXCEEDED');expect(rec.manifest().coverage.complete).toBe(false);expect(rec.manifest().gaps.length).toBeGreaterThan(0);
});
