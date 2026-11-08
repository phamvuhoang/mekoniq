// Durable navigation evidence (B05): chunk integrity, crash/reopen, limits, and metrics computed only from what was read back from disk.
import {afterEach,expect,test,vi} from 'vitest';
import {chmod,mkdir,mkdtemp,readFile,readdir,rm,truncate,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {gunzipSync,gzipSync} from 'node:zlib';
import {buildNavigationEvidence,compareEvidence,evidenceDigests,evidenceAssertions,navigationMetrics,openNavigationRecorder,readNavigationEvidence,replayAt,NORMALIZED_OMITS,READ_LIMITS,type Assertion,type EvidenceIdentity,type StepPayload} from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import {validateNavigationEvidence} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type {IRSimSnapshotV1,NavigationSceneV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {assessTrajectory} from '../../packages/lab-runtime/src/v2/navigation2d/oracle';
import {navigationScene} from '../support/navigation2d';

const serve=navigationScene('serve'),offset=navigationScene('offset-axle'),dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0)){await chmod(d,0o700).catch(()=>{});await rm(d,{recursive:true,force:true});}});
const temp=async()=>{const d=await mkdtemp(join(tmpdir(),'nav-evidence-'));dirs.push(d);return d;};
type Pose=[number,number,number];
// the scene's LiDAR declares 360 beams: beam 2 has no return, every other beam hits at `range`
const scan=(tick:number,sensorId:string,range:number,beams=360)=>({sensorId,frameId:'lidar',tick,simTimeNs:String(tick*20_000_000),angleMinRad:0,angleIncrementRad:2*Math.PI/beams,rangeMinM:0.05,rangeMaxM:10,
 rangesM:Array.from({length:beams},(_,i)=>i===2?null:range),states:Array.from({length:beams},(_,i)=>i===2?'no_return':'hit') as ('hit'|'no_return')[]});
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
const read=(dir:string,rec:{committed():ReturnType<Awaited<ReturnType<typeof openNavigationRecorder>>['committed']>},scene=serve)=>readNavigationEvidence(dir,rec.committed(),{scene});
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
  const c=structuredClone(good);await edit(c);const r=await readNavigationEvidence(dir,c,{scene:serve});
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
 expect((await readNavigationEvidence(dir,good,{scene:serve})).complete).toBe(true); // nothing was repaired: the original bytes verify again
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
 expect(navigationMetrics(serve,await readNavigationEvidence(dir,prefix,{scene:serve})).horizon).toBe(79);
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
 expect(navigationMetrics(serve,await readNavigationEvidence(dir,edited,{scene:serve})).collisionEpisodes).toBe(0);
 // the original manifest no longer matches those bytes: unavailable, never "no contact"
 const stale=navigationMetrics(serve,await readNavigationEvidence(dir,rec.committed(),{scene:serve}));
 expect([stale.coverage,stale.collisionEpisodes]).toEqual(['incomplete',null]);
});

test('distance: the report measures the robot base origin path, not the drive axle (offset-axle robot turning in place)',async()=>{
 const scene=offset,start=scene.robots[0]!.initialPoseMap as Pose,dir=await temp();
 const rec=await record(dir,51,t=>[start[0],start[1],start[2]+t*0.02],{scene});
 const m=navigationMetrics(scene,await read(dir,rec,scene));
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

// ---- review B05: unknown, incomplete, unflushed or unverifiable evidence is never reported as pass, available or clean ----
const ident:EvidenceIdentity={runId:'run-a',sourceCommit:'c0ffee',sceneRef:{path:'bundle/navigation-scene.json',sha256:'b'.repeat(64),bytes:100},lockDigest:'a'.repeat(64),engine:{version:'2.12.0',pythonVersion:'3.11.9'},numpyVersion:'2.4.6',runSeed:5,actorRng:{algorithm:'xoshiro128** v1',seed:5},controller:{id:'grid-diff-v1',version:'1'},businessEpochMs:1};
type Listing=ReturnType<Awaited<ReturnType<typeof openNavigationRecorder>>['committed']>;
type Line=Record<string,unknown>&{tick:number};
let forged=0;
/** Lists a rewritten copy of one chunk (new file, recorded size, hash and range) as a tampered or foreign export would; the original file stays as it was. */
async function rewrite(dir:string,l:Listing,s:'trajectory'|'sensors'|'control'|'collisions',i:number,edit:(lines:Line[])=>Line[]|string){
 const ref=l.chunks[s][i]!,lines=gunzipSync(await readFile(join(dir,ref.path))).toString().trim().split('\n').map(x=>JSON.parse(x) as Line),out=edit(lines);
 const bytes=gzipSync(typeof out==='string'?out:out.map(x=>JSON.stringify(x)+'\n').join('')),path=ref.path.replace(/-[0-9a-f]{8}\./,`-${(++forged).toString(16).padStart(8,'0')}.`);
 await writeFile(join(dir,path),bytes);
 l.chunks[s][i]={...ref,path,sha256:sha(bytes),bytes:bytes.length,...typeof out==='string'?{}:{firstTick:out[0]!.tick,lastTick:out.at(-1)!.tick}};
}
const verdicts=(a:Assertion[])=>Object.fromEntries(a.map(x=>[x.id,x.result]));

test('review B05 #1: ticks the run reached but the disk does not hold yet make every evidence verdict incomplete; evidence ahead of the checkpoint is not a pass either',async()=>{
 // flushed 0..130, buffered 131..160, an engine contact at 150 that only the unflushed tail knows about
 const dir=await temp(),rec=await record(dir,161,aisle,{flush:false,chunkTicks:131,collisions:t=>t===150?['table-05']:[]}),c=rec.committed();
 expect(c.lastTick).toBe(130);
 const r=await readNavigationEvidence(dir,c,{scene:serve,runTick:160}),m=navigationMetrics(serve,r),a=evidenceAssertions(r,m,160,null);
 expect(r.complete).toBe(false);expect(r.gaps).toContainEqual({fromTick:131,toTick:160,reason:'EVIDENCE_PENDING'});
 expect(m).toMatchObject({coverage:'incomplete',collisionEpisodes:null,distanceM:null,minClearanceM:null,sensorPublications:{complete:false}});
 expect(verdicts(a)).toMatchObject({EVIDENCE_COVERAGE:'inconclusive',NO_PHYSICAL_CONTACT:'inconclusive',SENSOR_PUBLICATIONS:'inconclusive'});
 const doc=buildNavigationEvidence(serve,ident,c,r,m,160);
 expect(doc.completeness!.status).toBe('incomplete');expect(doc.completeness!.reasons.join()).toContain('EVIDENCE_PENDING');
 expect(doc.metricCoverage.filter(x=>x.status==='available')).toEqual([]);
 // M18: EVIDENCE_COVERAGE compares with the run tick on its own too (a read taken without it)
 const plain=await readNavigationEvidence(dir,c,{scene:serve}),pm=navigationMetrics(serve,plain);
 expect(plain.complete).toBe(true);
 expect(evidenceAssertions(plain,pm,160,null).find(x=>x.id==='EVIDENCE_COVERAGE')!.result).toBe('inconclusive');
 expect(evidenceAssertions(plain,pm,130,null).find(x=>x.id==='EVIDENCE_COVERAGE')!.result).toBe('pass');
 // a crash image whose checkpoint is behind the durable evidence: the evidence describes ticks the run never committed
 const ahead=await readNavigationEvidence(dir,c,{scene:serve,runTick:10}),am=navigationMetrics(serve,ahead);
 expect(ahead.complete).toBe(false);expect(ahead.reasons).toContain('EVIDENCE_AHEAD_OF_CHECKPOINT:11-130');
 expect(verdicts(evidenceAssertions(ahead,am,10,null))).toMatchObject({EVIDENCE_COVERAGE:'inconclusive',NO_PHYSICAL_CONTACT:'inconclusive',SENSOR_PUBLICATIONS:'inconclusive'});
});

test('review B05 #2: a recorded gap is on disk at once (M26)',async()=>{
 const dir=await temp(),rec=await record(dir,20);
 await rec.gap({fromTick:20,toTick:20,reason:'STEP_ACK_LOST'});
 const again=await openNavigationRecorder({directory:dir,scene:serve,runId:'run-a',chunkTicks:40});
 expect(again.committed().gaps).toEqual([{fromTick:20,toTick:20,reason:'STEP_ACK_LOST'}]);
 const r=await readNavigationEvidence(dir,again.committed(),{scene:serve,runTick:19});
 expect([r.complete,verdicts(evidenceAssertions(r,navigationMetrics(serve,r),19,null)).NO_PHYSICAL_CONTACT]).toEqual([false,'inconclusive']);
});

test('review B05 #3: gaps and the terminal reason travel with the exported document; an import without them cannot claim a complete recording (M09)',async()=>{
 const q=await temp(),quota=await record(q,400,aisle,{maxBytes:6000,chunkTicks:20}),c=quota.committed();
 const committed=await readNavigationEvidence(q,c,{scene:serve}),doc=buildNavigationEvidence(serve,ident,c,committed,navigationMetrics(serve,committed),null);
 expect(doc.recording).toEqual({gaps:c.gaps,terminal:'EVIDENCE_QUOTA_EXCEEDED',lastTick:c.lastTick,runTick:null});
 expect(validateNavigationEvidence(doc)).toMatchObject({ok:true});
 const imported=await readNavigationEvidence(q,{chunks:doc.artifacts,...doc.recording},{scene:serve}),im=navigationMetrics(serve,imported);
 expect(imported.complete).toBe(false);expect(imported.terminal).toBe('EVIDENCE_QUOTA_EXCEEDED');
 expect(imported.gaps).toContainEqual(c.gaps.at(-1));
 expect(verdicts(evidenceAssertions(imported,im,null,null))).toMatchObject({EVIDENCE_LIMITS:'fail',EVIDENCE_COVERAGE:'inconclusive',NO_PHYSICAL_CONTACT:'inconclusive'});
 const bare=await readNavigationEvidence(q,{chunks:doc.artifacts},{scene:serve}),bm=navigationMetrics(serve,bare);
 expect(bare.complete).toBe(false);expect(bare.reasons).toContain('EVIDENCE_END_UNKNOWN');
 expect(verdicts(evidenceAssertions(bare,bm,null,null))).toMatchObject({EVIDENCE_LIMITS:'inconclusive',EVIDENCE_COVERAGE:'inconclusive',NO_PHYSICAL_CONTACT:'inconclusive'});
 // a clean recording imported with its recording block is complete; a listing cut short against its declared last tick is not
 const d=await temp(),clean=await record(d,100),cc=clean.committed(),cr=await readNavigationEvidence(d,cc,{scene:serve});
 const cdoc=buildNavigationEvidence(serve,ident,cc,cr,navigationMetrics(serve,cr),99);
 expect((await readNavigationEvidence(d,{chunks:cdoc.artifacts,...cdoc.recording!},{scene:serve})).complete).toBe(true);
 const cut={chunks:{...cdoc.artifacts,trajectory:cdoc.artifacts.trajectory.slice(0,-1),sensors:cdoc.artifacts.sensors.slice(0,-1),control:cdoc.artifacts.control.slice(0,-1)},...cdoc.recording!};
 const short=await readNavigationEvidence(d,cut,{scene:serve});
 expect(short.complete).toBe(false);expect(short.issues.map(i=>i.code)).toContain('EVIDENCE_END_MISMATCH');
 // M09: a terminal reason alone (no gap) is never complete
 expect((await readNavigationEvidence(d,{...cc,terminal:'EVIDENCE_TICK_LIMIT'},{scene:serve})).complete).toBe(false);
 // a restart gap survives the export
 const g=await temp(),gr=await record(g,60,aisle,{flush:false});
 const reopened=await openNavigationRecorder({directory:g,scene:serve,runId:'run-a',chunkTicks:40});await reopened.gap({fromTick:40,toTick:59,reason:'RUNTIME_RESTART'});void gr;
 const gc=reopened.committed(),gread=await readNavigationEvidence(g,gc,{scene:serve}),gdoc=buildNavigationEvidence(serve,ident,gc,gread,navigationMetrics(serve,gread),59);
 const gi=await readNavigationEvidence(g,{chunks:gdoc.artifacts,...gdoc.recording!},{scene:serve});
 expect(gi.gaps).toContainEqual({fromTick:40,toTick:59,reason:'RUNTIME_RESTART'});expect(gi.complete).toBe(false);
 // the recording block is re-validated on read
 const bad=await readNavigationEvidence(d,{chunks:cdoc.artifacts,gaps:[{fromTick:'x'}] as never,terminal:null,lastTick:99},{scene:serve});
 expect(bad.complete).toBe(false);expect(bad.issues.map(i=>i.code)).toContain('EVIDENCE_LISTING_INVALID');
});

test('review B05 #4: untrusted chunks are read within size, inflate, line and record limits; malformed or non-finite records reject the chunk, never throw, never complete',async()=>{
 const dir=await temp(),rec=await record(dir,100),good=rec.committed();
 const t0=good.chunks.trajectory[0]!,file=join(dir,t0.path),original=await readFile(file);
 const check=async(l:Listing,code:string)=>{const r=await readNavigationEvidence(dir,l,{scene:serve});expect(r.issues.map(i=>i.code),code).toContain(code);expect(r.complete).toBe(false);
  const m=navigationMetrics(serve,r);expect(m.coverage).toBe('incomplete');expect(evidenceAssertions(r,m,99,null).find(a=>a.id==='NO_PHYSICAL_CONTACT')!.result).toBe('inconclusive');return r;};
 // a listed file far larger than recorded is refused from its size, not read (a 3 GiB sparse file would not even fit a buffer)
 await truncate(file,3*2**30);
 await check(good,'EVIDENCE_CHUNK_TRUNCATED');
 await writeFile(file,original);
 // a gzip bomb: a few KB stored, more than the per-chunk inflate cap when expanded
 const bomb=gzipSync(Buffer.alloc(READ_LIMITS.chunkInflated+1024,0x20));
 await writeFile(file,bomb);
 await check({...good,chunks:{...good.chunks,trajectory:[{...t0,sha256:sha(bomb),bytes:bomb.length},...good.chunks.trajectory.slice(1)]}},'EVIDENCE_READ_LIMIT');
 await writeFile(file,original);
 // a stored size above the per-chunk cap is refused before reading
 await check({...good,chunks:{...good.chunks,trajectory:[{...t0,bytes:READ_LIMITS.chunkBytes+1},...good.chunks.trajectory.slice(1)]}},'EVIDENCE_READ_LIMIT');
 // a record line above the line cap
 let l=structuredClone(good);await rewrite(dir,l,'trajectory',0,x=>[{...x[0]!,pad:'x'.repeat(READ_LIMITS.lineBytes)},...x.slice(1)]);await check(l,'EVIDENCE_READ_LIMIT');
 // records that are JSON but not trajectory records
 l=structuredClone(good);await rewrite(dir,l,'trajectory',0,x=>x.map(y=>({tick:y.tick})));
 const shape=await check(l,'EVIDENCE_RECORD_INVALID');
 expect(()=>navigationMetrics(serve,shape)).not.toThrow();
 // a pose of 1e999 parses as Infinity
 l=structuredClone(good);await rewrite(dir,l,'trajectory',0,x=>x.map(y=>JSON.stringify(y)).join('\n').replace(/"poseDriveMap":\[[^,]+,/g,'"poseDriveMap":[1e999,')+'\n');
 const inf=await check(l,'EVIDENCE_RECORD_INVALID');
 expect(navigationMetrics(serve,inf).distanceM).toBeNull();
 // more chunks than a recording can hold
 const many={...good,chunks:{...good.chunks,collisions:Array.from({length:READ_LIMITS.chunksPerStream+1},(_,i)=>({...t0,path:`collisions-${String(i).padStart(6,'0')}-00000000.ndjson.gz`}))}};
 await check(many,'EVIDENCE_LISTING_INVALID');
 await writeFile(file,original);
});

test('review B05 #4: a reopened manifest is size-capped and validated; a write that fails leaves nothing claimed; orphans count in the quota; a live second writer is refused',async()=>{
 const dir=await temp();await record(dir,30);
 const manifest=join(dir,'manifest.json'),text=await readFile(manifest,'utf8');
 const open=()=>openNavigationRecorder({directory:dir,scene:serve,runId:'run-a'});
 await writeFile(manifest,JSON.stringify({...JSON.parse(text) as object,chunks:{trajectory:'nope'}}));
 await expect(open()).rejects.toThrow('EVIDENCE_MANIFEST_INVALID');
 await writeFile(manifest,'{"x":"'+'y'.repeat(READ_LIMITS.manifestBytes)+'"}');
 await expect(open()).rejects.toThrow('EVIDENCE_MANIFEST_INVALID');
 await writeFile(manifest,'{not json');
 await expect(open()).rejects.toThrow('EVIDENCE_MANIFEST_INVALID');
 await writeFile(manifest,text);
 // another live process holds the directory
 await writeFile(join(dir,'writer.lock'),String(process.ppid));
 await expect(open()).rejects.toThrow('EVIDENCE_WRITER_LOCKED');
 await writeFile(join(dir,'writer.lock'),'999999999'); // a dead writer (crash): taken over
 await open();
 // orphan chunks and tmp files left by a crash are stored bytes: they count against the quota
 const q=await temp();await writeFile(join(q,'trajectory-000009-deadbeef.ndjson.gz'),Buffer.alloc(5000));await writeFile(join(q,'.manifest.json.tmp'),Buffer.alloc(500));
 const quota=await record(q,60,aisle,{maxBytes:6000,chunkTicks:20});
 expect(quota.terminal).toBe('EVIDENCE_QUOTA_EXCEEDED');
});

test('review B05 #4: a manifest write that fails rolls back the in-memory recording; the reopened disk shows only what was committed',async()=>{
 const dir=await temp(),rec=await record(dir,40,aisle,{flush:false,chunkTicks:1000});
 await rec.flush();const before=rec.committed();
 for(let t=40;t<60;t++)await rec.append(snap(serve,t,aisle(t)),step(t));
 // the chunks can be written but the manifest cannot be replaced
 await mkdir(join(dir,'.manifest.json.tmp'));
 await rec.flush();
 await rm(join(dir,'.manifest.json.tmp'),{recursive:true});
 expect(rec.terminal).toMatch(/^EVIDENCE_WRITE_FAILED/);
 const c=rec.committed();
 expect([c.lastTick,c.bytes,c.chunks]).toEqual([before.lastTick,before.bytes,before.chunks]);
 const r=await readNavigationEvidence(dir,c,{scene:serve,runTick:59});
 expect(r.complete).toBe(false);
});

test('review B05 #5: every stream is held to its expectation; a stream left out, mislabelled, duplicated or off cadence is incomplete (M13, M28)',async()=>{
 const dir=await temp(),rec=await record(dir,100,aisle,{collisions:t=>t>=90?['table-05']:[]}),good=rec.committed();
 expect((await readNavigationEvidence(dir,good,{scene:serve})).complete).toBe(true);
 const check=async(l:Listing,code:string)=>{const r=await readNavigationEvidence(dir,l,{scene:serve});expect(r.issues.map(i=>i.code),code).toContain(code);expect(r.complete).toBe(false);
  expect(verdicts(evidenceAssertions(r,navigationMetrics(serve,r),99,null))).toMatchObject({EVIDENCE_INTEGRITY:'fail',NO_PHYSICAL_CONTACT:'inconclusive'});return r;};
 for(const s of ['control','sensors','collisions'] as const)await check({...good,chunks:{...good.chunks,[s]:[]}},'EVIDENCE_STREAM_MISMATCH');
 // a trajectory chunk listed under control: refused by name, and comparing it later never crashes
 const swapped=await check({...good,chunks:{...good.chunks,control:[good.chunks.trajectory[0]!,...good.chunks.control.slice(1)]}},'EVIDENCE_PATH_REJECTED');
 expect(()=>compareEvidence(swapped,swapped)).not.toThrow();
 const renamed=structuredClone(good),tp=good.chunks.trajectory[0]!.path,cp0=tp.replace(/^trajectory/,'control');
 await writeFile(join(dir,cp0),await readFile(join(dir,tp)));renamed.chunks.control[0]={...good.chunks.trajectory[0]!,path:cp0};
 await check(renamed,'EVIDENCE_RECORD_INVALID');
 // M13: a duplicated control record inside one chunk
 let l=structuredClone(good);await rewrite(dir,l,'control',0,x=>[x[0]!,...x]);await check(l,'EVIDENCE_CHUNK_CORRUPT');
 // control coverage: one step missing from the ledger
 l=structuredClone(good);await rewrite(dir,l,'control',0,x=>[x[0]!,...x.slice(2)]);await check(l,'EVIDENCE_STREAM_MISMATCH');
 // M28: same count, wrong cadence (a publication moved from tick 5 to tick 6)
 l=structuredClone(good);await rewrite(dir,l,'sensors',0,x=>x.map(y=>y.tick===5?{...y,tick:6,scan:{...(y.scan as object),tick:6,simTimeNs:String(6*20_000_000)}}:y));
 const cadence=await check(l,'EVIDENCE_STREAM_MISMATCH');
 expect(navigationMetrics(serve,cadence).sensorPublications.complete).toBe(false);
 // contact records that disagree with the trajectory's collision ids
 l=structuredClone(good);await rewrite(dir,l,'collisions',0,x=>x.slice(1));await check(l,'EVIDENCE_STREAM_MISMATCH');
 // without the scene the sensor cadence cannot be verified: never complete
 const blind=await readNavigationEvidence(dir,good);
 expect(blind.complete).toBe(false);expect(blind.reasons).toContain('SENSOR_CADENCE_UNVERIFIED');
});

test('review B05 #5: the trajectory digest covers the control ledger (M27)',async()=>{
 const a=await temp(),b=await temp();await record(a,60);
 const rb=await openNavigationRecorder({directory:b,scene:serve,runId:'run-a',chunkTicks:40});
 for(let t=0;t<60;t++)await rb.append(snap(serve,t,aisle(t)),t?step(t,t===30?0.4:0.5):null); // same observed motion, one different command sent
 await rb.flush();
 const digest=async(d:string)=>{const r=await readNavigationEvidence(d,(await openNavigationRecorder({directory:d,scene:serve,runId:'run-a'})).committed(),{scene:serve}),m=navigationMetrics(serve,r);return evidenceDigests(serve,ident,r,m,evidenceAssertions(r,m,59,null));};
 const [da,db]=[await digest(a),await digest(b)];
 expect(db.trajectoryDigest).not.toBe(da.trajectoryDigest);expect(db.sensorDigest).toBe(da.sensorDigest);
});

test('review B05 #6: every input, version and platform field is in the digests; only the listed omissions are left out; assertion details carry no random names',async()=>{
 const dir=await temp(),r=await readNavigationEvidence(dir,(await record(dir,60)).committed(),{scene:serve}),m=navigationMetrics(serve,r),as=evidenceAssertions(r,m,59,null);
 const host={platform:'darwin-arm64',os:'darwin 25.0.0',arch:'arm64',node:'v24.22.2'};
 const base=evidenceDigests(serve,ident,r,m,as,host),pick=(d:typeof base)=>[d.trajectoryDigest,d.sensorDigest,d.assertionDigest];
 const leaves=(o:object,prefix:string[]=[]):string[][]=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?leaves(v as object,[...prefix,k]):[[...prefix,k]]);
 const perturb=<T extends object>(o:T,path:string[]):T=>{const c=structuredClone(o) as Record<string,unknown>;let x=c;for(const k of path.slice(0,-1))x=x[k] as Record<string,unknown>;const k=path.at(-1)!,v=x[k];x[k]=typeof v==='number'?v+1:`${String(v)}-other`;return c as T;};
 for(const p of leaves(ident)){
  const d=evidenceDigests(serve,perturb(ident,p),r,m,as,host),changed=pick(d).map((x,i)=>x!==pick(base)[i]);
  if(p.join('.')==='runId')expect(changed,'runId is omitted').toEqual([false,false,false]);
  else expect(changed,p.join('.')).toEqual([true,true,true]);
 }
 for(const p of leaves(host))expect(pick(evidenceDigests(serve,ident,r,m,as,perturb(host,p))).map((x,i)=>x!==pick(base)[i]),p.join('.')).toEqual([true,true,true]);
 expect(NORMALIZED_OMITS).toEqual(['runId','worker bootId','artifacts.*.path (random chunk names)','chunk boundaries (artifacts.*.sha256/bytes/firstTick/lastTick)','wall-clock time (never recorded in chunks)']);
 // boot id, chunk names and boundaries, and the wall clock leave every digest unchanged
 const other=await temp(),ro=await readNavigationEvidence(other,(await record(other,60,aisle,{runId:'run-z',bootId:'boot-z',chunkTicks:7})).committed(),{scene:serve});
 vi.useFakeTimers();vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
 try{const mo=navigationMetrics(serve,ro);expect(evidenceDigests(serve,{...ident,runId:'run-z'},ro,mo,evidenceAssertions(ro,mo,59,null),host)).toEqual(base);}finally{vi.useRealTimers();}
 // two runs corrupted the same way (different random chunk names) give the same assertions and assertion digest
 const corrupt=async()=>{const d=await temp(),c=(await record(d,60)).committed(),f=join(d,c.chunks.trajectory[1]!.path);await writeFile(f,(await readFile(f)).subarray(0,10));
  const x=await readNavigationEvidence(d,c,{scene:serve}),xm=navigationMetrics(serve,x),xa=evidenceAssertions(x,xm,59,null);return {xa,d:evidenceDigests(serve,ident,x,xm,xa,host)};};
 const [c1,c2]=[await corrupt(),await corrupt()];
 expect(c2.xa).toEqual(c1.xa);expect(c2.d.assertionDigest).toBe(c1.d.assertionDigest);
});

// ---- review 4 (independent reproductions at be13475) ----
const notPassed=(r:Awaited<ReturnType<typeof readNavigationEvidence>>,runTick:number|null)=>{const m=navigationMetrics(serve,r),v=verdicts(evidenceAssertions(r,m,runTick,null));
 expect(r.complete).toBe(false);expect(m.coverage).toBe('incomplete');expect(v).toMatchObject({EVIDENCE_COVERAGE:'inconclusive',NO_PHYSICAL_CONTACT:'inconclusive'});expect(v.SENSOR_PUBLICATIONS).not.toBe('pass');};

test('review4 #1: an export taken while the run is ahead of the durable evidence stays incomplete when imported',async()=>{
 // the run reached tick 5, the disk holds 0..3
 const dir=await temp(),rec=await record(dir,6,aisle,{flush:false,chunkTicks:4}),c=rec.committed();
 expect(c.lastTick).toBe(3);
 const live=await readNavigationEvidence(dir,c,{scene:serve,runTick:5}),doc=buildNavigationEvidence(serve,ident,c,live,navigationMetrics(serve,live),5);
 expect(doc.recordingGaps).toEqual([{fromTick:4,toTick:5,reason:'EVIDENCE_PENDING'}]);
 expect(validateNavigationEvidence(doc)).toMatchObject({ok:true});
 const imported=await readNavigationEvidence(dir,{chunks:doc.artifacts,...doc.recording},{scene:serve});
 expect(imported.gaps).toContainEqual({fromTick:4,toTick:5,reason:'EVIDENCE_PENDING'});
 notPassed(imported,null);
 // a checkpoint behind the evidence travels too
 const ahead=await readNavigationEvidence(dir,c,{scene:serve,runTick:1}),adoc=buildNavigationEvidence(serve,ident,c,ahead,navigationMetrics(serve,ahead),1);
 const ai=await readNavigationEvidence(dir,{chunks:adoc.artifacts,...adoc.recording},{scene:serve});
 expect(ai.reasons).toContain('EVIDENCE_AHEAD_OF_CHECKPOINT:2-3');expect(ai.complete).toBe(false);
});

test('review4 #2: a gap whose manifest write failed is retried by the next flush, even with nothing buffered, and survives a reopen',async()=>{
 const dir=await temp(),rec=await record(dir,20);
 await mkdir(join(dir,'.manifest.json.tmp')); // the manifest cannot be replaced for now
 await expect(rec.gap({fromTick:20,toTick:20,reason:'STEP_ACK_LOST'})).rejects.toThrow();
 expect(rec.committed().gaps).toEqual([{fromTick:20,toTick:20,reason:'STEP_ACK_LOST'}]); // still claimed in memory: never complete
 await rec.flush(); // still failing: kept for the next one, no throw
 await rm(join(dir,'.manifest.json.tmp'),{recursive:true});
 await rec.flush();
 const again=await openNavigationRecorder({directory:dir,scene:serve,runId:'run-a'});
 expect(again.committed().gaps).toEqual([{fromTick:20,toTick:20,reason:'STEP_ACK_LOST'}]);
 notPassed(await readNavigationEvidence(dir,again.committed(),{scene:serve,runTick:19}),19);
});

test('review4 #4: data a read or a replay returns is not shared with the decode cache',async()=>{
 const dir=await temp(),rec=await record(dir,60),first=await read(dir,rec),before=JSON.stringify(first.trajectory)+JSON.stringify(first.sensors);
 const at=replayAt(first,10);
 const tamper=(f:()=>void)=>{try{f();}catch{/* frozen data refuses the write: also isolated */}};
 tamper(()=>{at.robots![0]!.poseDriveMap[0]+=10;});tamper(()=>{at.scans[0]!.scan.rangesM[0]=99;});tamper(()=>{first.control[0]!.velocities[0]!.vMps=7;});
 const again=await read(dir,rec);
 expect(JSON.stringify(again.trajectory)+JSON.stringify(again.sensors)).toBe(before);
 expect(again.control[0]!.velocities[0]!.vMps).toBe(0.5);
 expect(navigationMetrics(serve,again).distanceM!['amr-1']).toBeCloseTo(0.59,9);
});

test('review4 #5: a cache hit still checks the listing: a chunk listed under the wrong tick range is refused after a correct read',async()=>{
 // the last trajectory chunk really holds 80..99; the forged listing says 81..100 (same bytes, size and hash)
 const dir=await temp(),rec=await record(dir,100),good=rec.committed(),last=good.chunks.trajectory.at(-1)!;
 expect([last.firstTick,last.lastTick]).toEqual([80,99]);
 const wrong={...good,chunks:{...good.chunks,trajectory:[...good.chunks.trajectory.slice(0,-1),{...last,firstTick:81,lastTick:100}]}};
 expect((await readNavigationEvidence(dir,wrong,{scene:serve})).issues.map(i=>i.code)).toContain('EVIDENCE_CHUNK_CORRUPT'); // refused by the decode that fills the cache
 expect((await readNavigationEvidence(dir,good,{scene:serve})).complete).toBe(true);
 const r=await readNavigationEvidence(dir,wrong,{scene:serve});
 expect(r.issues.map(i=>i.code)).toContain('EVIDENCE_CHUNK_CORRUPT');
 notPassed(r,99);
});

test('review4 #6: a LiDAR publication must carry the scene beam count, its tick time and ranges consistent with their states',async()=>{
 const dir=await temp(),rec=await record(dir,100),good=rec.committed();
 expect((await readNavigationEvidence(dir,good,{scene:serve})).complete).toBe(true);
 type ScanLine=Line&{scan:{simTimeNs:string;rangesM:(number|null)[];states:string[]}};
 const edit=(f:(s:ScanLine['scan'])=>void,tick=5)=>(x:Line[])=>x.map(y=>{if(y.tick!==tick)return y;const c=structuredClone(y) as ScanLine;f(c.scan);return c;});
 const cases:[string,(x:Line[])=>Line[]][]=[
  ['empty beams',x=>x.map(y=>{const c=structuredClone(y) as ScanLine;c.scan.rangesM=[];c.scan.states=[];return c;})],
  ['timestamp 0 at tick 5',edit(s=>{s.simTimeNs='0';})],
  ['negative range',edit(s=>{s.rangesM[0]=-1;})],
  ['hit beyond rangeMax',edit(s=>{s.rangesM[0]=11;})],
  ['a range on a no-return beam',edit(s=>{s.rangesM[2]=3;})],
  ['a hit without a range',edit(s=>{s.rangesM[0]=null;})],
  ['fewer beams than the scene declares',x=>x.map(y=>{const c=structuredClone(y) as ScanLine;c.scan.rangesM=c.scan.rangesM.slice(0,8);c.scan.states=c.scan.states.slice(0,8);return c;})],
 ];
 for(const [name,f] of cases){
  const l=structuredClone(good);await rewrite(dir,l,'sensors',0,f);
  const r=await readNavigationEvidence(dir,l,{scene:serve}),m=navigationMetrics(serve,r);
  expect(r.complete,name).toBe(false);expect(m.sensorPublications.complete,name).toBe(false);
  expect(evidenceAssertions(r,m,99,null).find(a=>a.id==='SENSOR_PUBLICATIONS')!.result,name).not.toBe('pass');
 }
});

test('review4 #7: the writer never commits a chunk its own reader refuses (16 LiDAR x 1,080 beams published every tick)',async()=>{
 const big=structuredClone(serve),r0=big.robots[0]!,base=r0.model.sensors[0]!;
 r0.model.sensors=Array.from({length:16},(_,k)=>({...base,id:`lidar-${k}`,beamCount:1080,publishEveryTicks:1}));
 const dir=await temp(),rec=await openNavigationRecorder({directory:dir,scene:big,runId:'run-a'});
 for(let t=0;t<=250;t++){
  const s=snap(big,t,aisle(t));
  s.robots[0]!.scans=r0.model.sensors.map((x,k)=>({...scan(t,x.id,3,1080),rangesM:Array.from({length:1080},(_,i)=>i===2?null:3+t*1e-7+k*1e-9+i*1e-11)}));
  await rec.append(s,t?step(t):null);
 }
 await rec.flush();
 expect(rec.terminal).toBeNull();
 const c=rec.committed();
 for(const ref of STREAMS_ALL.flatMap(s=>c.chunks[s])){
  const bytes=await readFile(join(dir,ref.path));
  expect(bytes.length).toBeLessThanOrEqual(READ_LIMITS.chunkBytes);
  expect(gunzipSync(bytes).length,ref.path).toBeLessThanOrEqual(READ_LIMITS.chunkInflated);
 }
 const r=await readNavigationEvidence(dir,c,{scene:big});
 expect(r.issues).toEqual([]);expect(r.complete).toBe(true);
 expect(r.sensors).toHaveLength(251*16);
},120_000);
const STREAMS_ALL=['trajectory','sensors','control','collisions'] as const;

/** A would-be writer in its own process (tests/support/evidence-writer-child.mjs). */
function writer(dir:string){
 const child=spawn(process.execPath,['--import','tsx','tests/support/evidence-writer-child.mjs'],{cwd:process.cwd(),env:{...process.env,MEKONIQ_TEST_EVIDENCE:dir},stdio:['pipe','pipe','inherit']});
 const out=createInterface({input:child.stdout!}),lines:string[]=[],waiters:(()=>void)[]=[];
 out.on('line',l=>{lines.push(l);for(const w of waiters.splice(0))w();});
 const next=async(skip=0)=>{while(lines.length<=skip)await new Promise<void>(r=>waiters.push(r));return lines[skip]!;};
 return {child,ready:()=>next(0),answer:()=>next(1),send:(l:string)=>child.stdin!.write(l+'\n'),exit:()=>new Promise<void>(r=>{child.once('exit',()=>r());child.stdin!.write('exit\n');})};
}
test('review4 #8: two processes opening one evidence directory at once: exactly one writer, the other refused; a dead writer is taken over; close releases the lock',async()=>{
 for(let round=0;round<4;round++){
  const dir=await temp(),[a,b]=[writer(dir),writer(dir)];
  try{
   await Promise.all([a.ready(),b.ready()]);
   a.send('go');b.send('go');
   const answers=(await Promise.all([a.answer(),b.answer()])).sort();
   expect(answers,`round ${round}`).toEqual(['refused:EVIDENCE_WRITER_LOCKED','won']);
  }finally{for(const w of [a,b])w.child.kill('SIGKILL');}
 }
 // the winner dies (SIGKILL: no release); its lock names a dead pid and is taken over
 const dir=await temp(),w=writer(dir);await w.ready();w.send('go');expect(await w.answer()).toBe('won');
 const holder=await readFile(join(dir,'writer.lock'),'utf8');
 await expect(openNavigationRecorder({directory:dir,scene:serve,runId:'run-a'})).rejects.toThrow('EVIDENCE_WRITER_LOCKED');
 await new Promise<void>(r=>{w.child.once('exit',()=>r());w.child.kill('SIGKILL');});
 const mine=await openNavigationRecorder({directory:dir,scene:serve,runId:'run-a'});
 expect(await readFile(join(dir,'writer.lock'),'utf8')).not.toBe(holder);
 // an explicit close releases it: another process may write, and this one may reopen after that one closed
 await mine.close();
 await expect(readFile(join(dir,'writer.lock'))).rejects.toThrow();
 const other=writer(dir);await other.ready();other.send('go');expect(await other.answer()).toBe('won');await other.exit();
 await (await openNavigationRecorder({directory:dir,scene:serve,runId:'run-a'})).close();
},120_000);
