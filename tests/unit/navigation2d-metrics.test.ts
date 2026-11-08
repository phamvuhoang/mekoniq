// Durable navigation evidence (B05): chunk integrity, crash/reopen, limits, and metrics computed only from what was read back from disk.
import {afterEach,expect,test} from 'vitest';
import {chmod,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {compareEvidence,evidenceDigests,evidenceAssertions,navigationMetrics,openNavigationRecorder,readNavigationEvidence,replayAt,NORMALIZED_OMITS,type StepPayload} from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import type {IRSimSnapshotV1,NavigationSceneV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {assessTrajectory} from '../../packages/lab-runtime/src/v2/navigation2d/oracle';
import {navigationScene} from '../support/navigation2d';

const serve=navigationScene('serve'),offset=navigationScene('offset-axle'),dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0)){await chmod(d,0o700).catch(()=>{});await rm(d,{recursive:true,force:true});}});
const temp=async()=>{const d=await mkdtemp(join(tmpdir(),'nav-evidence-'));dirs.push(d);return d;};
type Pose=[number,number,number];
const scan=(tick:number,sensorId:string,range:number)=>({sensorId,frameId:'lidar',tick,simTimeNs:String(tick*20_000_000),angleMinRad:0,angleIncrementRad:Math.PI/4,rangeMinM:0.05,rangeMaxM:10,rangesM:[range,range,null,range,range,range,range,range],states:['hit','hit','no_return','hit','hit','hit','hit','hit'] as ('hit'|'no_return')[]});
const snap=(scene:NavigationSceneV1,tick:number,pose:Pose,o:{runId?:string;bootId?:string;collisions?:string[];range?:number}={}):IRSimSnapshotV1=>({schemaVersion:1,runId:o.runId??'run-a',bootId:o.bootId??'boot-a',tick,simTimeNs:String(tick*20_000_000),seq:String(tick+1),sceneDigest:scene.sceneDigest,
 robots:scene.robots.map(r=>({robotId:r.robotId,poseDriveMap:pose,bodyVelocity:[0.5,0] as [number,number],scans:r.model.sensors.map(s=>scan(tick,s.id,o.range??3)),collisionIds:o.collisions??[]}))});
const step=(tick:number,v=0.5):StepPayload=>({targetTick:tick,velocities:[{robotId:'amr-1',vMps:v,omegaRadps:0}],actorUpdates:[]});
const aisle=(t:number):Pose=>[3+t*0.01,6,0];
/** Records ticks 0..n-1 of `pose` and flushes. */
async function record(dir:string,n:number,pose:(t:number)=>Pose=aisle,o:{scene?:NavigationSceneV1;runId?:string;bootId?:string;chunkTicks?:number;maxBytes?:number;maxTicks?:number;collisions?:(t:number)=>string[];range?:(t:number)=>number;flush?:boolean}={}){
 const scene=o.scene??serve,rec=await openNavigationRecorder({directory:dir,scene,runId:o.runId??'run-a',chunkTicks:o.chunkTicks??40,...o.maxBytes?{maxBytes:o.maxBytes}:{},...o.maxTicks?{maxTicks:o.maxTicks}:{}});
 for(let t=0;t<n&&!rec.terminal;t++)await rec.append(snap(scene,t,pose(t),{runId:o.runId,bootId:o.bootId,collisions:o.collisions?.(t),range:o.range?.(t)}),t?step(t):null);
 if(o.flush!==false)await rec.flush();
 return rec;
}
const read=(dir:string,rec:{committed():ReturnType<Awaited<ReturnType<typeof openNavigationRecorder>>['committed']>})=>readNavigationEvidence(dir,rec.committed());
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const id={lockDigest:'a'.repeat(64),runSeed:5,controller:{id:'grid-diff-v1' as const,version:'1'}};

test('EVI chunks: gzip NDJSON over tick ranges, SHA-256 over the stored bytes, ordered, and the read covers every tick with control and LiDAR publications',async()=>{
 const dir=await temp(),rec=await record(dir,101),c=rec.committed();
 expect(c.chunks.trajectory.map(x=>[x.firstTick,x.lastTick])).toEqual([[0,39],[40,79],[80,100]]);
 for(const ref of [...c.chunks.trajectory,...c.chunks.sensors,...c.chunks.control]){
  const bytes=await readFile(join(dir,ref.path));
  expect(ref.path).toMatch(/^(trajectory|sensors|control)-\d{6}-[0-9a-f]{8}\.ndjson\.gz$/);
  expect([bytes.length,sha(bytes)]).toEqual([ref.bytes,ref.sha256]);
  expect(gunzipSync(bytes).toString().endsWith('\n')).toBe(true);
 }
 const r=await read(dir,rec);
 expect(r.complete).toBe(true);expect(r.issues).toEqual([]);expect(r.gaps).toEqual([]);
 expect(r.trajectory.map(x=>x.tick)).toEqual([...Array(101).keys()]);
 // the control ledger is what was sent, keyed by the observation it was computed from; tick 0 (created plant) has none
 expect(r.control.map(x=>[x.tick,x.targetTick])).toEqual([...Array(100).keys()].map(t=>[t,t+1]));
 expect(r.control[0]!.velocities).toEqual([{robotId:'amr-1',vMps:0.5,omegaRadps:0}]);
 // 10 Hz publications (every 5 ticks), with null ranges and beam states kept
 expect(r.sensors.map(x=>x.tick)).toEqual([...Array(21).keys()].map(k=>k*5));
 expect(r.sensors[0]!.scan.rangesM[2]).toBeNull();expect(r.sensors[0]!.scan.states[2]).toBe('no_return');
 const m=navigationMetrics(serve,r);
 expect(m).toMatchObject({coverage:'complete',horizon:100,collisionEpisodes:0,minSeparationM:null,sensorPublications:{expected:21,recorded:21,complete:true}});
 expect(m.distanceM!['amr-1']).toBeCloseTo(1,9);expect(m.minClearanceM).toBeGreaterThan(0.3);
});

test('EVI append: an exact duplicate is a no-op, a different repeat or a mismatched control is refused, a skipped tick is a recorded gap',async()=>{
 const dir=await temp(),rec=await openNavigationRecorder({directory:dir,scene:serve,runId:'run-a'});
 await rec.append(snap(serve,0,aisle(0)),null);await rec.append(snap(serve,1,aisle(1)),step(1));
 await rec.append(snap(serve,1,aisle(1)),step(1)); // the same step ACK seen twice
 await expect(rec.append(snap(serve,1,aisle(2)),step(1))).rejects.toThrow('EVIDENCE_APPEND_CONFLICT');
 await expect(rec.append(snap(serve,0,aisle(0)),null)).rejects.toThrow('EVIDENCE_APPEND_CONFLICT');
 await expect(rec.append(snap(serve,2,aisle(2)),step(3))).rejects.toThrow('EVIDENCE_CONTROL_MISMATCH');
 await expect(rec.append(snap(serve,2,aisle(2)),null)).rejects.toThrow('EVIDENCE_CONTROL_MISMATCH');
 await expect(rec.append(snap(serve,2,aisle(2),{runId:'other'}),step(2))).rejects.toThrow('EVIDENCE_SNAPSHOT_FOREIGN');
 await rec.append(snap(serve,5,aisle(5)),step(5));await rec.flush();
 const r=await read(dir,rec);
 expect(r.trajectory.map(x=>x.tick)).toEqual([0,1,5]);
 expect(r.gaps).toEqual([{fromTick:2,toTick:4,reason:'TICK_GAP'}]);
 expect(r.complete).toBe(false);
 expect(navigationMetrics(serve,r)).toMatchObject({coverage:'incomplete',distanceM:null,collisionEpisodes:null,minClearanceM:null});
});

test('EVI02 integrity: a truncated, corrupted, missing, reordered or escaping chunk is detected on read, left out, and the metrics are unavailable',async()=>{
 const dir=await temp(),rec=await record(dir,120),good=rec.committed();
 const verify=async(edit:(c:typeof good)=>Promise<void>|void,code:string)=>{
  const c=structuredClone(good);await edit(c);const r=await readNavigationEvidence(dir,c);
  expect(r.issues.map(i=>i.code),code).toContain(code);expect(r.complete).toBe(false);
  const m=navigationMetrics(serve,r);expect(m.coverage).toBe('incomplete');expect(m.distanceM).toBeNull();expect(m.collisionEpisodes).toBeNull();
  const a=evidenceAssertions(r,m,119,null);
  expect(a.find(x=>x.id==='EVIDENCE_INTEGRITY')!.result).toBe('fail');expect(a.find(x=>x.id==='NO_PHYSICAL_CONTACT')!.result).toBe('inconclusive');
  return r;
 };
 const t1=good.chunks.trajectory[1]!,file=join(dir,t1.path),original=await readFile(file);
 // truncated
 await writeFile(file,original.subarray(0,original.length-7));
 const truncated=await verify(()=>{},'EVIDENCE_CHUNK_TRUNCATED');
 expect(truncated.gaps).toEqual([{fromTick:40,toTick:79,reason:'EVIDENCE_TICKS_MISSING'}]);
 // same size, one byte flipped
 const flipped=Buffer.from(original);flipped[20]^=0xff;await writeFile(file,flipped);
 await verify(()=>{},'EVIDENCE_CHUNK_CORRUPT');
 // a chunk whose recorded hash was rewritten to match different content still has to decode to the range it claims
 const forged=gzipSync('{"tick":1}\n');await writeFile(file,forged);
 await verify(c=>{c.chunks.trajectory[1]={...t1,sha256:sha(forged),bytes:forged.length};},'EVIDENCE_CHUNK_CORRUPT');
 await writeFile(file,original);
 expect((await readNavigationEvidence(dir,good)).complete).toBe(true); // nothing was repaired: the original bytes verify again
 const s0=join(dir,good.chunks.sensors[0]!.path),kept=await readFile(s0);
 await rm(s0);
 await verify(()=>{},'EVIDENCE_CHUNK_MISSING');
 await writeFile(s0,kept);
 await verify(c=>{c.chunks.trajectory=[c.chunks.trajectory[1]!,c.chunks.trajectory[0]!,c.chunks.trajectory[2]!];},'EVIDENCE_CHUNK_ORDER');
 await verify(c=>{c.chunks.control[0]={...c.chunks.control[0]!,path:'../outside.ndjson.gz'};},'EVIDENCE_PATH_REJECTED');
 await verify(c=>{c.chunks.control[0]={...c.chunks.control[0]!,path:'/etc/passwd'};},'EVIDENCE_PATH_REJECTED');
});

test('EVI crash/reopen: committed chunks are neither lost nor duplicated, the unflushed tail is a recorded gap, stray files are never adopted',async()=>{
 const dir=await temp(),first=await record(dir,60,aisle,{flush:false});
 // 0..39 were flushed by the 40-tick chunk size; 40..59 are only in memory when the process dies
 const committed=first.committed();
 expect(committed.lastTick).toBe(39);
 await writeFile(join(dir,'trajectory-000002-deadbeef.ndjson.gz'),gzipSync('{"tick":40}\n')); // a chunk written but never listed (crash before the manifest)
 const again=await openNavigationRecorder({directory:dir,scene:serve,runId:'run-a',chunkTicks:40});
 expect(again.committed()).toEqual(committed);
 expect(again.lastTick).toBe(39);
 await again.append(snap(serve,39,aisle(39)),step(39)); // the last durable tick again: same bytes, no duplicate
 await expect(again.append(snap(serve,39,aisle(40)),step(39))).rejects.toThrow('EVIDENCE_APPEND_CONFLICT');
 await again.gap({fromTick:40,toTick:59,reason:'RUNTIME_RESTART'});
 for(let t=60;t<70;t++)await again.append(snap(serve,t,aisle(t),{bootId:'boot-b'}),step(t));
 await again.flush();
 const r=await read(dir,again);
 expect(r.trajectory.map(x=>x.tick)).toEqual([...Array(40).keys(),...Array.from({length:10},(_,i)=>60+i)]);
 expect(r.gaps).toEqual([{fromTick:40,toTick:59,reason:'RUNTIME_RESTART'}]);
 expect(r.complete).toBe(false);
 expect(again.committed().chunks.trajectory.map(c=>c.path)).not.toContain('trajectory-000002-deadbeef.ndjson.gz');
 expect(new Set(again.committed().chunks.trajectory.map(c=>c.path)).size).toBe(again.committed().chunks.trajectory.length);
 await expect(openNavigationRecorder({directory:dir,scene:offset,runId:'run-a'})).rejects.toThrow('EVIDENCE_IDENTITY_MISMATCH');
 await expect(openNavigationRecorder({directory:dir,scene:serve,runId:'run-b'})).rejects.toThrow('EVIDENCE_IDENTITY_MISMATCH');
});

test('EVI02 limits: the stored-bytes quota and the tick limit end the recording incomplete with a reason; nothing after them is recorded or claimed',async()=>{
 const q=await temp(),quota=await record(q,400,aisle,{maxBytes:6000,chunkTicks:20});
 expect(quota.terminal).toBe('EVIDENCE_QUOTA_EXCEEDED');
 const c=quota.committed(),stored=(await readdir(q)).filter(f=>f.endsWith('.gz'));
 expect(c.bytes).toBeLessThanOrEqual(6000);
 expect(stored.sort()).toEqual([...c.chunks.trajectory,...c.chunks.sensors,...c.chunks.control].map(x=>x.path).sort());
 expect(c.gaps.at(-1)).toMatchObject({reason:'EVIDENCE_QUOTA_EXCEEDED',fromTick:c.lastTick!+1});
 await expect(quota.append(snap(serve,c.lastTick!+50,aisle(0)),step(c.lastTick!+50))).rejects.toThrow('EVIDENCE_TERMINAL:EVIDENCE_QUOTA_EXCEEDED');
 const r=await read(q,quota),m=navigationMetrics(serve,r),a=evidenceAssertions(r,m,null,c.terminal);
 expect(r.complete).toBe(false);expect(m.distanceM).toBeNull();
 expect(a.find(x=>x.id==='EVIDENCE_LIMITS')).toMatchObject({result:'fail',detail:expect.stringContaining('EVIDENCE_QUOTA_EXCEEDED')});
 const t=await temp(),ticks=await record(t,30,aisle,{maxTicks:20});
 expect(ticks.terminal).toBe('EVIDENCE_TICK_LIMIT');expect(ticks.admits(20)).toBe(false);
 expect((await read(t,ticks)).trajectory.at(-1)!.tick).toBe(20);
 const fresh=await openNavigationRecorder({directory:await temp(),scene:serve,runId:'r',maxTicks:20});
 expect([fresh.admits(20),fresh.admits(21)]).toEqual([true,false]);
});

test('EVI02 write failure: an evidence directory that refuses the write ends the recording incomplete instead of losing ticks silently',async()=>{
 const dir=await temp(),rec=await record(dir,30,aisle,{flush:false,chunkTicks:1000});
 await chmod(dir,0o500);
 await rec.flush();
 await chmod(dir,0o700);
 expect(rec.terminal).toMatch(/^EVIDENCE_WRITE_FAILED/);
 const r=await read(dir,rec);
 expect(r.trajectory).toEqual([]);expect(r.complete).toBe(false);
});

test('IR06/07 metrics from evidence: driving into table-05 is found by the oracle from the stored trace; editing the stored trace changes the metric',async()=>{
 // heading +y at x=10 from y=1.6: the footprint front reaches table-05 (y >= 2.6) part way
 const north=(t:number):Pose=>[10,1.6+t*0.01,Math.PI/2],dir=await temp();
 const rec=await record(dir,100,north,{collisions:t=>t>=70?['table-05']:[]});
 // a live report sees a growing prefix first: the incremental assessment of the longer read must equal the oracle over the whole trace
 const prefix=structuredClone(rec.committed());prefix.chunks.trajectory=prefix.chunks.trajectory.slice(0,2);
 expect(navigationMetrics(serve,await readNavigationEvidence(dir,prefix)).horizon).toBe(79);
 const r=await read(dir,rec),m=navigationMetrics(serve,r);
 const whole=assessTrajectory(serve,r.trajectory.map(x=>({schemaVersion:1,runId:'',bootId:'',tick:x.tick,simTimeNs:x.simTimeNs,seq:'0',sceneDigest:serve.sceneDigest,robots:x.robots.map(y=>({...y,scans:[]}))})));
 expect({contacts:m.contacts,minClearanceM:m.minClearanceM}).toEqual({contacts:whole.contacts,minClearanceM:whole.minClearanceM});
 expect(m.coverage).toBe('complete');
 const kinds=new Set(m.episodes.filter(e=>e.pair.includes('table-05')).map(e=>e.source));
 expect([...kinds].sort()).toEqual(['engine_discrete','safety_envelope','swept_oracle']);
 // one episode per pair and source (clear -> overlap -> clear), not one per tick
 expect(m.episodes.filter(e=>e.source==='engine_discrete')).toEqual([{pair:['amr-1','table-05'],source:'engine_discrete',fromTick:70,toTick:99}]);
 expect(m.collisionEpisodes).toBe(2);expect(m.safetyEnvelopeEpisodes).toBe(1);expect(m.minClearanceM).toBe(0);
 expect(evidenceAssertions(r,m,99,null).find(a=>a.id==='NO_PHYSICAL_CONTACT')!.result).toBe('fail');
 // the same run recorded along the aisle instead: no contact, a positive clearance
 const clean=await temp(),cr=await read(clean,await record(clean,100));
 const cm=navigationMetrics(serve,cr);
 expect([cm.collisionEpisodes,cm.episodes]).toEqual([0,[]]);
 expect(evidenceAssertions(cr,cm,99,null).find(a=>a.id==='NO_PHYSICAL_CONTACT')!.result).toBe('pass');
 // edit the stored trace and its recorded hashes: the metric follows the stored bytes, nothing held in memory
 const edited=structuredClone(rec.committed());
 for(const [i,ref] of edited.chunks.trajectory.entries()){
  const lines=gunzipSync(await readFile(join(dir,ref.path))).toString().trim().split('\n').map(l=>JSON.parse(l) as {tick:number;robots:{poseDriveMap:Pose;collisionIds:string[]}[]});
  for(const l of lines){l.robots[0]!.poseDriveMap=aisle(l.tick);l.robots[0]!.collisionIds=[];}
  const bytes=gzipSync(lines.map(l=>JSON.stringify(l)+'\n').join(''));await writeFile(join(dir,ref.path),bytes);edited.chunks.trajectory[i]={...ref,sha256:sha(bytes),bytes:bytes.length};
 }
 edited.chunks.collisions=[];
 expect(navigationMetrics(serve,await readNavigationEvidence(dir,edited)).collisionEpisodes).toBe(0);
 // the original manifest no longer matches those bytes: unavailable, never "no contact"
 const stale=navigationMetrics(serve,await readNavigationEvidence(dir,rec.committed()));
 expect([stale.coverage,stale.collisionEpisodes]).toEqual(['incomplete',null]);
});

test('distance: the report measures the robot base origin path, not the drive axle (offset-axle robot turning in place)',async()=>{
 const scene=offset,start=scene.robots[0]!.initialPoseMap as Pose,dir=await temp();
 const rec=await record(dir,51,t=>[start[0],start[1],start[2]+t*0.02],{scene});
 const m=navigationMetrics(scene,await read(dir,rec));
 expect(m.driveDistanceM!['amr-1']).toBe(0);
 // the base origin is 0.2 m behind the axle: turning 1 rad about the axle moves it along a 0.2 m arc
 expect(m.distanceM!['amr-1']).toBeCloseTo(0.2,4);
});

test('IR08 digests: normalized identity ignores run id, boot id, chunking and chunk names only; any pose, range or seed change moves the right digest',async()=>{
 const make=async(o:Parameters<typeof record>[3]={},pose=aisle)=>{const d=await temp(),r=await read(d,await record(d,90,pose,o));const m=navigationMetrics(serve,r);return {r,d:evidenceDigests(serve,id,r,m,evidenceAssertions(r,m,89,null))};};
 const a=await make(),b=await make({runId:'run-b',bootId:'boot-z',chunkTicks:7});
 expect(b.d).toEqual(a.d);
 expect(a.d.normalizedOmits).toEqual(NORMALIZED_OMITS);
 expect(compareEvidence(a.r,b.r)).toEqual({match:true,mismatches:[]});
 const pose=await make({},t=>t===50?[aisle(t)[0]+1e-7,6,0]:aisle(t));
 expect(pose.d.trajectoryDigest).not.toBe(a.d.trajectoryDigest);expect(pose.d.sensorDigest).toBe(a.d.sensorDigest);
 expect(compareEvidence(a.r,pose.r).match).toBe(false);
 expect(compareEvidence(a.r,pose.r,{pose:1e-6,lidar:1e-6}).match).toBe(true); // a looser declared tolerance (other platform) accepts it
 const range=await make({range:t=>t===45?3+1e-5:3});
 expect(range.d.sensorDigest).not.toBe(a.d.sensorDigest);expect(range.d.trajectoryDigest).toBe(a.d.trajectoryDigest);
 expect(compareEvidence(a.r,range.r).mismatches).toEqual(['ranges at 45']);
 const m=navigationMetrics(serve,a.r),seeded=evidenceDigests(serve,{...id,runSeed:6},a.r,m,evidenceAssertions(a.r,m,89,null));
 expect(seeded.trajectoryDigest).not.toBe(a.d.trajectoryDigest); // the seed is part of the identity: two runs never match by dropping it
});

test('EVI03 replay cursor: pose, scans, contacts and controls only from samples at or before the cursor; a cursor in a gap has no pose',async()=>{
 const dir=await temp(),rec=await openNavigationRecorder({directory:dir,scene:serve,runId:'run-a'});
 for(let t=0;t<30;t++)await rec.append(snap(serve,t,aisle(t),{range:3+t/100}),t?step(t):null);
 for(let t=40;t<50;t++)await rec.append(snap(serve,t,aisle(t)),step(t));
 await rec.flush();
 const r=await read(dir,rec),at=replayAt(r,17);
 expect(at.robots![0]!.poseDriveMap).toEqual(aisle(17));
 expect(at.scans.map(s=>s.tick)).toEqual([15]);expect(at.scans[0]!.scan.rangesM[0]).toBeCloseTo(3.15,12);
 expect(at.controls.at(-1)).toMatchObject({tick:17,targetTick:18}); // sent after observing tick 17
 expect(replayAt(r,35)).toMatchObject({available:false,robots:null,gaps:[{fromTick:30,toTick:39}]});
});
