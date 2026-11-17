import {afterEach,expect,test,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openWorldRecorder,readWorldEvidence,prepareWorldAdmission} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import * as durable from '../../packages/lab-runtime/src/v2/navigation2d/evidence';
import {tick} from '../support/physics';
import type {Sim3DSnapshotV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,unlink:vi.fn(actual.unlink)};});
const dirs:string[]=[];afterEach(async()=>{vi.restoreAllMocks();vi.mocked(fs.unlink).mockImplementation((await vi.importActual<typeof fs>('node:fs/promises')).unlink);for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function setup(extra:{maxBytes?:number;chunkTicks?:number}={}){const f=await readWorldFixture(resolve('robotics/simulation-mujoco')),admission=prepareWorldAdmission(f.scene,f.files),directory=await mkdtemp(join(tmpdir(),'world-evidence-'));dirs.push(directory);
 const snapshot=(n:number,active=false):Sim3DSnapshotV1=>{const p=tick(n);p.loads=active?[{...p.loads[0]!,propId:'cup-1',supportId:f.scene.supportMap.mobileSupportId}]:[];p.contacts=[];for(const b of p.base)b.robotId='amr-1';for(const w of p.wheels)w.robotId='amr-1';for(const o of p.odometry)o.robotId='amr-1';return {schemaVersion:1,worldStep:{workerPid:1,modelCount:1,physicsSubsteps:(n+1)*10,primingSubsteps:10,nq:35,nv:32,nbody:30,ngeom:27},runId:'rig',bootId:'boot',seq:String(n+1),tick:n,simTimeNs:String(n*20_000_000),sceneDigest:f.scene.sceneDigest,robots:[{robotId:'amr-1',poseDriveMap:[0,0,0],bodyVelocity:[0,0],collisionIds:[],scans:[],pose3d:{z:0,roll:0,pitch:0},wheels:{leftRadS:0,rightRadS:0}}],arms:[{armId:'arm-1',positionsRad:f.scene.armCell.arm.homeRad,velocitiesRadS:Array(6).fill(0),collisionIds:[],gripper:{openingM:.0889,heldPropIds:[]}}],props:active?[{propId:'cup-1',position:p.loads[0]!.poseMap.positionM,quaternionXyzw:p.loads[0]!.poseMap.quaternionXyzw,restingOn:null}]:[],physics:p};};
 return {admission,directory,snapshot,rec:await openWorldRecorder({directory,admission,runId:'rig',bootId:'boot',...extra})};}
const command={targetTick:1,velocities:[],actorUpdates:[],jointTargets:[],gripperTargets:[],propPlacements:[{propId:'cup-1',pose:{position:[.49,0,.151] as [number,number,number],quaternionXyzw:[0,0,0,1] as [number,number,number,number]}}],worldInteractions:[{eventId:'rig:birth:1',cupId:'cup-1',propId:'cup-1',kind:'birth' as const,targetTick:1}]};
test('world lifecycle records are durable and hash-covered; initial empty tray is independently admitted',async()=>{const h=await setup();await h.rec.append(h.snapshot(0),null);await h.rec.append(h.snapshot(1,true),command);expect(await readFile(join(h.directory,'pending.ndjson'),'utf8')).toContain('rig:birth:1');expect((await readWorldEvidence(h.directory,h.admission)).complete).toBe(false);await h.rec.finish();const r=await readWorldEvidence(h.directory,h.admission);expect(r.issues).toEqual([]);expect(r.records[1]!.interactions[0]!.before).toBeNull();expect(r.records[1]!.interactions[0]!.after).not.toBeNull();});
test.each(['absent','binding','tick','duplicate','physics','arm'])('world recorder rejects %s and records advanced gap',async mode=>{const h=await setup();await h.rec.append(h.snapshot(0),null);const c=structuredClone(command),s=h.snapshot(1,true);if(mode==='absent')delete (c as Partial<typeof c>).worldInteractions;if(mode==='binding')c.worldInteractions[0]!.cupId='other';if(mode==='tick')c.worldInteractions[0]!.targetTick=2;if(mode==='duplicate')c.worldInteractions.push(c.worldInteractions[0]!);if(mode==='physics')delete s.physics;if(mode==='arm')s.arms=[];await expect(h.rec.append(s,c)).rejects.toThrow();await h.rec.finish();expect((await readWorldEvidence(h.directory,h.admission)).complete).toBe(false);});
test('world reader refuses missing immutable records and extra bytes count against quota',async()=>{const h=await setup();await h.rec.append(h.snapshot(0),null);await h.rec.finish();const m=JSON.parse(await readFile(join(h.directory,'manifest.json'),'utf8'));await writeFile(join(h.directory,m.chunks[0].path),'corrupt');expect((await readWorldEvidence(h.directory,h.admission)).complete).toBe(false);});

test('free-joint and rotation-matrix quaternions may differ by roundoff/sign but never by a physical rotation',async()=>{const h=await setup();await h.rec.append(h.snapshot(0),null);const s=h.snapshot(1,true);s.physics!.loads[0]!.poseMap.quaternionXyzw=[1e-16,0,0,-1];await h.rec.append(s,command);await h.rec.finish();expect((await readWorldEvidence(h.directory,h.admission)).complete).toBe(true);
 const bad=await setup();await bad.rec.append(bad.snapshot(0),null);const wrong=bad.snapshot(1,true);wrong.physics!.loads[0]!.poseMap.quaternionXyzw=[0,0,1,0];await expect(bad.rec.append(wrong,command)).rejects.toThrow('WORLD_PROP_OBSERVATION_MISMATCH');});

test.each([[[0,0,0,0]],[[0,0,0,2]]])('world recorder rejects invalid quaternion %j before publishing',async q=>{const h=await setup();await h.rec.append(h.snapshot(0),null);const s=h.snapshot(1,true);s.props![0]!.quaternionXyzw=q;await expect(h.rec.append(s,command)).rejects.toThrow();});

test('world quotas refuse increased caps and include orphan/WAL/publication bytes',async()=>{await expect(setup({maxBytes:101*1024*1024})).rejects.toThrow('WORLD_EVIDENCE_LIMIT_INVALID');const h=await setup({maxBytes:6000});await writeFile(join(h.directory,'orphan'),Buffer.alloc(4500));await expect(h.rec.append(h.snapshot(0),null)).rejects.toThrow('WORLD_EVIDENCE_QUOTA_EXCEEDED');expect((await readWorldEvidence(h.directory,h.admission)).complete).toBe(false);});

test('published prefixes remain incomplete until successful finish, including a crash before the next ACK append',async()=>{const h=await setup({chunkTicks:1});await h.rec.append(h.snapshot(0),null);expect((await readWorldEvidence(h.directory,h.admission)).complete).toBe(false);await expect(openWorldRecorder({directory:h.directory,admission:h.admission,runId:'rig',bootId:'boot'})).rejects.toThrow('WORLD_EVIDENCE_RESTART_UNKNOWN');await h.rec.finish();expect((await readWorldEvidence(h.directory,h.admission)).complete).toBe(true);});

for(const boundary of ['chunk','wal-cleanup'] as const)test(`automatic flush ${boundary} failure retains the attempted horizon and published prefix after close`,async()=>{
 const h=await setup({chunkTicks:2});await h.rec.append(h.snapshot(0),null);
 const write=durable.writeDurable;let injected=false;
 vi.spyOn(durable,'writeDurable').mockImplementation(async(dir,name,bytes)=>{if(dir===h.directory&&!injected&&(boundary==='chunk'?name.endsWith('.ndjson.gz'):name==='pending.ndjson'&&bytes==='')){injected=true;throw Error('INJECTED_FLUSH_FAILURE');}return write(dir,name,bytes);});
 await expect(h.rec.append(h.snapshot(1,true),command)).rejects.toThrow('INJECTED_FLUSH_FAILURE');
 expect(h.rec.manifest().gaps).toEqual([{targetTick:1,lastCommittedTick:0,ackTick:1,reason:'INJECTED_FLUSH_FAILURE'}]);
 // The Source owner, not an append-local snapshot, owns the logical commit boundary.
 await h.rec.fail({targetTick:1,lastCommittedTick:0,ackTick:1,reason:'SOURCE_APPEND_FAILED'});
 expect(h.rec.manifest().gaps).toEqual([{targetTick:1,lastCommittedTick:0,ackTick:1,reason:'SOURCE_APPEND_FAILED'}]);
 const published=h.rec.manifest().chunks,raw=await Promise.all(published.map(c=>readFile(join(h.directory,c.path))));
 await h.rec.finish();await expect(h.rec.append(h.snapshot(2,true),{...command,targetTick:2})).rejects.toThrow('WORLD_EVIDENCE_TERMINAL');
 if(boundary==='wal-cleanup'){expect(h.rec.manifest().chunks).toEqual(published);for(let i=0;i<published.length;i++)expect(await readFile(join(h.directory,published[i]!.path))).toEqual(raw[i]);}
 const r=await readWorldEvidence(h.directory,h.admission);expect(r.complete).toBe(false);expect(r.records.map(r=>r.snapshot.tick)).toEqual([0,1]);expect(r.issues).not.toContain('WORLD_EVIDENCE_ORDER');expect(h.rec.manifest().chunks.map(c=>[c.firstTick,c.lastTick])).toEqual([[0,1]]);
});

test.each(['wal','intent','manifest'])('terminal finish never republishes manifest-owned rows when %s publication cleanup fails',async boundary=>{
 const h=await setup({chunkTicks:2});await h.rec.append(h.snapshot(0),null);const write=durable.writeDurable;
 let injected=false;vi.spyOn(durable,'writeDurable').mockImplementation(async(dir,name,bytes)=>{if(dir===h.directory&&((boundary==='wal'&&name==='pending.ndjson'&&bytes==='')||(boundary==='manifest'&&!injected&&name==='manifest.json'&&JSON.parse(String(bytes)).chunks.length))){injected=true;throw Error('PUBLICATION_CLEANUP_FAILED');}return write(dir,name,bytes);});
 const unlink=(await vi.importActual<typeof fs>('node:fs/promises')).unlink;vi.spyOn(fs,'unlink').mockImplementation(async path=>{if(boundary==='intent'&&path===join(h.directory,'write.intent'))throw Error('PUBLICATION_CLEANUP_FAILED');return unlink(path);});
 await expect(h.rec.append(h.snapshot(1,true),command)).rejects.toThrow('PUBLICATION_CLEANUP_FAILED');
 const published=h.rec.manifest().chunks;expect(published.map(c=>[c.firstTick,c.lastTick])).toEqual([[0,1]]);
 const raw=await readFile(join(h.directory,published[0]!.path));const finishError=await h.rec.finish().then(()=>null,e=>e);
 expect(h.rec.manifest().chunks.map(c=>[c.firstTick,c.lastTick])).toEqual([[0,1]]);expect(finishError).toBeNull();
 expect(h.rec.manifest().chunks).toEqual(published);expect(await readFile(join(h.directory,published[0]!.path))).toEqual(raw);
 const r=await readWorldEvidence(h.directory,h.admission);expect(r.records.map(r=>r.snapshot.tick)).toEqual([0,1]);expect(r.issues).toEqual(['WORLD_EVIDENCE_INCOMPLETE','WORLD_EVIDENCE_UNPUBLISHED']);
});
test('world recorder refuses an unadmitted physical disturbance even with a shaped matching native receipt',async()=>{
 const h=await setup();await h.rec.append(h.snapshot(0),null);const s=h.snapshot(1),c={targetTick:1,velocities:[],actorUpdates:[],jointTargets:[],gripperTargets:[],propPlacements:[],worldPerturbations:[{eventId:'disturbance:test',presetId:'world-dock-drift-v1' as const,revision:1 as const,targetId:'amr-1',targetTick:1}]};
 s.worldStep!.disturbances=[{...c.worldPerturbations[0]!,runId:s.runId,bootId:s.bootId,sceneDigest:s.sceneDigest,requestId:'world-3',requestDigest:(await import('../../packages/lab-runtime/src/v2/hash')).hashJson(c),frame:'map',forceMapN:[2000,0,0],durationSubsteps:10,beforePositionM:[0,0,0],afterPositionM:[0,0,0]}];
 await expect(h.rec.append(s,c)).rejects.toThrow('WORLD_PERTURBATION_EVIDENCE_INVALID');
});
const prefixAuthority=(h:Awaited<ReturnType<typeof setup>>,publicCommittedTick:number)=>({runId:'rig',bootId:'boot',sceneDigest:h.admission.scene.sceneDigest,admissionDigest:h.admission.digest,publicCommittedTick});
const idleCommand=(targetTick:number)=>({targetTick,velocities:[],actorUpdates:[],jointTargets:[],gripperTargets:[],propPlacements:[]});
test('Source prefix capture excludes a durable uncommitted ACK and keeps active/terminal scope distinct from completion',async()=>{
 const h=await setup();await h.rec.append(h.snapshot(0),null);await h.rec.append(h.snapshot(1,true),command);
 const {materializeWorldPrefix}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-evidence');const captured=await h.rec.capture(prefixAuthority(h,0));const p=await materializeWorldPrefix(captured,h.admission);
 expect(p.covered).toBe(true);expect(p.records.map(r=>r.snapshot.tick)).toEqual([0]);expect(p.publication).toMatchObject({streamFinalized:false,terminal:null,uncommittedTicks:1});
 await expect(h.rec.capture(prefixAuthority(h,0),1)).rejects.toThrow('WORLD_PREFIX_HORIZON_INVALID');await expect(h.rec.capture({...prefixAuthority(h,0),bootId:'wrong'})).rejects.toThrow('WORLD_PREFIX_AUTHORITY_MISMATCH');
 await h.rec.fail({targetTick:1,lastCommittedTick:0,ackTick:1,reason:'SOURCE_COMMIT_FAILED'});const failed=await materializeWorldPrefix(await h.rec.capture(prefixAuthority(h,0)),h.admission);expect(failed.covered).toBe(true);expect(failed.publication).toMatchObject({streamFinalized:false,terminal:'SOURCE_COMMIT_FAILED',uncommittedTicks:1});
});
test('captured chunk refs and durable tail stay consistent across later flush/finish without duplication or publication changes',async()=>{
 const h=await setup({chunkTicks:2}),{materializeWorldPrefix}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-evidence');await h.rec.append(h.snapshot(0),null);await h.rec.append(h.snapshot(1,true),command);await h.rec.append(h.snapshot(2,true),idleCommand(2));const capture=await h.rec.capture(prefixAuthority(h,2));
 await h.rec.append(h.snapshot(3,true),idleCommand(3));await h.rec.finish();const before=new Map(await Promise.all((await fs.readdir(h.directory)).map(async n=>[n,await readFile(join(h.directory,n))] as const)));
 const old=await materializeWorldPrefix(capture,h.admission);expect(old.covered).toBe(true);expect(old.records.map(r=>r.snapshot.tick)).toEqual([0,1,2]);expect(old.publication.streamFinalized).toBe(false);
 const now=await materializeWorldPrefix(await h.rec.capture(prefixAuthority(h,3)),h.admission);expect(now.records.map(r=>r.snapshot.tick)).toEqual([0,1,2,3]);expect(now.publication.streamFinalized).toBe(true);
 for(const [n,b] of before)expect(await readFile(join(h.directory,n))).toEqual(b);expect(await fs.readdir(h.directory)).toEqual([...before.keys()]);
});
test('quota byte counter follows created, overwritten and removed files exactly like a fresh readdir+lstat',async()=>{
 const {physicsDirectoryBytes}=await import('../../packages/lab-runtime/src/v2/simulation3d/physics-evidence'),h=await setup({chunkTicks:2}),same=async()=>expect(h.rec.storedBytes()).toBe(await physicsDirectoryBytes(h.directory));
 await same();await h.rec.append(h.snapshot(0),null);await same();
 await h.rec.append(h.snapshot(1,true),command);expect(h.rec.manifest().chunks).toHaveLength(1);await same(); // intent created+removed, chunk created, manifest and WAL overwritten
 await h.rec.append(h.snapshot(2,true),idleCommand(2));await same();await h.rec.finish();await same();
 await writeFile(join(h.directory,'orphan'),Buffer.alloc(10));expect(h.rec.storedBytes()).toBe(await physicsDirectoryBytes(h.directory)-10); // a foreign file is seen only by the next rescan
});
for(const mode of ['corrupt-tail','oversize-tail','write-intent','missing-chunk'] as const)test(`Source prefix capture ${mode} never claims covered history`,async()=>{
 const h=await setup({chunkTicks:2}),{materializeWorldPrefix}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-evidence');await h.rec.append(h.snapshot(0),null);await h.rec.append(h.snapshot(1,true),command);
 if(mode==='corrupt-tail')await writeFile(join(h.directory,'pending.ndjson'),'invalid\n');if(mode==='oversize-tail')await writeFile(join(h.directory,'pending.ndjson'),Buffer.alloc(13*1024*1024));if(mode==='write-intent')await writeFile(join(h.directory,'write.intent'),'{}');if(mode==='missing-chunk')await fs.unlink(join(h.directory,h.rec.manifest().chunks[0]!.path));
 const p=await materializeWorldPrefix(await h.rec.capture(prefixAuthority(h,1)),h.admission);expect(p.covered).toBe(false);expect(p.issues.length).toBeGreaterThan(0);expect(p.publication.streamFinalized).toBe(false);
});
test('full world arm report reconstructs all committed samples including stop tick without changing critical state or legacy cache',async()=>{
 const h=await setup(),{materializeWorldArmReport}=await import('../../packages/lab-runtime/src/v2/simulation3d/world-arm-report'),{MockArmPlant}=await import('../../packages/cell-adapters/src/mock-arm');
 const q=h.admission.scene.armCell.arm.homeRad,cmd=(n:number)=>({...idleCommand(n),velocities:[{robotId:'amr-1',vMps:0,omegaRadps:0}],jointTargets:[{armId:'arm-1',positionsRad:q}],gripperTargets:[{armId:'arm-1',openingM:.0889}]});
 await h.rec.append(h.snapshot(0),null);for(let n=1;n<=2;n++){const s=h.snapshot(n);s.arms![0]!.positionsRad=q.map((v,i)=>v+(i===0?n*1e-7:0));await h.rec.append(s,cmd(n));}
 const critical=MockArmPlant.initial('arm-1');critical.tracking={gen:q,settled:0,followCount:0,samples:1,peakRad:Array(6).fill(0),sumSq:Array(6).fill(0),trace:[],props:[]};critical.stop={latched:true,reconcileRequired:true,reason:'TEST_STOP',events:[{tick:2,stage:'observed',reason:'TEST_STOP',provenance:'modelled'}]};const before=structuredClone(critical);
 const capture=await h.rec.capture(prefixAuthority(h,2)),r=await materializeWorldArmReport(capture,h.admission,critical,{journal:[],businessEpochMs:0});expect(critical).toEqual(before);expect(r.state.stop).toEqual(critical.stop);expect(r.state.tracking!.samples).toBe(1);expect(r.state.tracking!.trace.map(s=>s.tick)).toEqual([0,1,2]);expect(r.state.tracking!.props!.map(s=>s.tick)).toEqual([0,1,2]);expect(r.state.tracking!.trace[2]!.actualRad[0]).toBe(q[0]!+2e-7);expect(r.worldTrace).toMatchObject({method:'world-committed-trace-v1',scope:'all_world_ticks',publicCommittedTick:2,prefixCovered:true,streamFinalized:false,trackingStatisticsScope:'active_program_ticks',trackingSamples:1});expect(r.worldSweep?.complete).toBe(false);expect(r.worldSweep?.scope).toMatchObject({kind:'source_committed_prefix',publicCommittedTick:2,streamFinalized:false});
});
