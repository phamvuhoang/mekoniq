// Task 3.3 (R13): a MuJoCo ACK carries `scans` only on the publish tick; the worker client carries the last publication forward, so what consumers and
// evidence see is byte-identical to the recorded run. Replays the first ticks of a recorded world run through the real client and a stdlib ACK double.
import {afterEach,expect,test} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnMujocoWorker} from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';
import {validateSim3DResponse,validateSim3DSnapshot,validateWorldEvidenceRecordShape,type Sim3DSnapshotV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type {IRSimWorkerClient} from '../../packages/lab-runtime/src/v2/navigation2d/worker-client';

const evidence=resolve('docs/implementation/evidence/web-lab-to-physical/final-recording/public-readbacks/retained-corpus-copy/cell-nominal-7/world-evidence');
const chunk=readdirSync(evidence).find(f=>f.startsWith('world-000000-'))!;
const records=gunzipSync(readFileSync(join(evidence,chunk))).toString().split('\n').filter(Boolean).slice(0,13);
const K=5; // coffee-delivery-cell-v1 lidar publishEveryTicks
const roots:string[]=[],clients:IRSimWorkerClient[]=[];
afterEach(async()=>{for(const c of clients.splice(0))await c.close('test over');for(const d of roots.splice(0))await rm(d,{recursive:true,force:true});});
const wireAck=(s:Sim3DSnapshotV1)=>{const r=structuredClone(s);if(s.tick%K)for(const rb of r.robots)delete (rb as {scans?:unknown}).scans;return {protocol:'mekoniq-sim3d/1',requestId:'x',runId:s.runId,bootId:s.bootId,tick:s.tick,ok:true,result:r};};
const spawn=async(acks:unknown[],runId:string)=>{
 const root=await mkdtemp(join(tmpdir(),'mekoniq-scan-carry-'));roots.push(root);const file=join(root,'acks.ndjson');
 await writeFile(file,acks.map(a=>JSON.stringify(a)).join('\n')+'\n');
 const c=await spawnMujocoWorker({python:'/usr/bin/python3',workerRoot:resolve('tests/support/irsim_doubles'),runId,bundleRoot:root,runDirectory:join(root,'run'),lockDigest:'a'.repeat(64),schemaDir:resolve('packages/contracts/schemas'),entry:[resolve('tests/support/irsim_doubles/replay_acks.py'),file]});
 clients.push(c);return c;
};
const req=(runId:string,op:string,expectedTick:number,payload:unknown)=>({protocol:'mekoniq-sim3d/1',requestId:`${op}-${expectedTick}`,runId,expectedTick,op,payload});

test('a recorded world run replayed through scan-less non-publish ACKs comes out byte-identical, every robot with its last publication',async()=>{
 const recorded=records.map(l=>JSON.parse(l) as {snapshot:Sim3DSnapshotV1;command:unknown});const runId=recorded[0]!.snapshot.runId;
 expect(recorded.map(r=>r.snapshot.tick)).toEqual([...Array(13).keys()]);
 const acks=recorded.map(r=>wireAck(r.snapshot));
 for(const a of acks){expect(validateSim3DResponse(a).ok).toBe(true);expect('scans' in a.result.robots[0]!).toBe(a.tick%K===0);}
 const c=await spawn(acks,runId),got:Sim3DSnapshotV1[]=[];
 for(const r of recorded){const t=r.snapshot.tick,a=await c.request(t===0?req(runId,'create',0,{sceneRef:'lab-world-scene.json',seed:7}):req(runId,'step',t-1,r.command));expect(a.ok).toBe(true);got.push((a as unknown as {result:Sim3DSnapshotV1}).result);}
 // the same bytes the recorder wrote: identical key order and values, the carried scan keeps its own publish tick
 expect(got.map(s=>JSON.stringify(s))).toEqual(recorded.map(r=>JSON.stringify(r.snapshot)));
 expect(got.map(s=>s.robots[0]!.scans[0]!.tick)).toEqual(got.map(s=>s.tick-s.tick%K));
 for(const [i,s] of got.entries()){expect(validateSim3DSnapshot(s)).toBe(true);expect(validateWorldEvidenceRecordShape({...recorded[i]!,snapshot:s})).toBe(true);}
 // a carried scan is a copy: a consumer that mutates one tick's scan does not change the next
 expect(got[1]!.robots[0]!.scans[0]).not.toBe(got[2]!.robots[0]!.scans[0]);
},20_000);

test('a snapshot without scans is a wire ACK only: the strict snapshot and world evidence still reject it',()=>{
 const r=JSON.parse(records[1]!) as {snapshot:Sim3DSnapshotV1;command:unknown},ack=wireAck(r.snapshot);
 expect(validateSim3DResponse(ack).ok).toBe(true);
 expect(validateSim3DSnapshot(ack.result)).toBe(false);
 expect(validateWorldEvidenceRecordShape({...r,snapshot:ack.result})).toBe(false);
});

test('a robot that was never published is a protocol fault, not an empty scan',async()=>{
 const s=(JSON.parse(records[0]!) as {snapshot:Sim3DSnapshotV1}).snapshot,ack=wireAck(s);for(const rb of ack.result.robots)delete (rb as {scans?:unknown}).scans;
 const c=await spawn([ack],s.runId);
 await expect(c.request(req(s.runId,'create',0,{sceneRef:'lab-world-scene.json',seed:7}))).rejects.toThrow(/WORKER_PROTOCOL.*no LiDAR publication/);
},20_000);
