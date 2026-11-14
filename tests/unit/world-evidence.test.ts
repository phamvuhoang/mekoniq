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
const dirs:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
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
 const unlink=fs.unlink;vi.spyOn(fs,'unlink').mockImplementation(async path=>{if(boundary==='intent'&&path===join(h.directory,'write.intent'))throw Error('PUBLICATION_CLEANUP_FAILED');return unlink(path);});
 await expect(h.rec.append(h.snapshot(1,true),command)).rejects.toThrow('PUBLICATION_CLEANUP_FAILED');
 const published=h.rec.manifest().chunks;expect(published.map(c=>[c.firstTick,c.lastTick])).toEqual([[0,1]]);
 const raw=await readFile(join(h.directory,published[0]!.path));const finishError=await h.rec.finish().then(()=>null,e=>e);
 expect(h.rec.manifest().chunks.map(c=>[c.firstTick,c.lastTick])).toEqual([[0,1]]);expect(finishError).toBeNull();
 expect(h.rec.manifest().chunks).toEqual(published);expect(await readFile(join(h.directory,published[0]!.path))).toEqual(raw);
 const r=await readWorldEvidence(h.directory,h.admission);expect(r.records.map(r=>r.snapshot.tick)).toEqual([0,1]);expect(r.issues).toEqual(['WORLD_EVIDENCE_INCOMPLETE','WORLD_EVIDENCE_UNPUBLISHED']);
});
