/* eslint-disable @typescript-eslint/no-explicit-any -- coherent portable JSON artifacts */
import {expect,test} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {openReplayPackage} from '../../packages/lab-runtime/src/v2/replay/reader';
// @ts-expect-error standalone qualification reader
import {collectR2bArtifactDispositions,evidenceInventory,verifyR2bDirectory} from '../../scripts/r2b-readback.mjs';
import {web05Fixture,sha} from '../support/r2b-web05';
async function check(mutate:(f:ReturnType<typeof web05Fixture>)=>void=()=>{}){
 const f=web05Fixture();mutate(f);const bytes=(p:string)=>Buffer.isBuffer(f.files[p])?f.files[p] as Buffer:Buffer.from(JSON.stringify(f.files[p]));
 // Every mutation still admits a complete valid replay and recomputes every inventory/hash.
 const replay=await openReplayPackage(bytes('replay/manifest.json'),async function*(a){yield bytes('replay/'+a.path);});expect(replay.manifest.coverage.prefixCovered).toBe(true);replay.close();
 const root=mkdtempSync(join(tmpdir(),'b10-i3-'));try{for(const [p]of Object.entries(f.files)){const path=join(root,'inputs/container',p);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes(p));}const m={scope:'full',identity:{before:{sourceCommit:f.source}},lab:{commit:'f'.repeat(40),pin:{schemaHash:f.schema}},containerRecord:{file:'inputs/container/web05.json',sha256:sha(bytes('web05.json'))},artifacts:evidenceInventory(root)};
 const r=await collectR2bArtifactDispositions(root,m);writeFileSync(join(root,'qualification.json'),JSON.stringify({...m,artifactDispositions:r.artifactDispositions}));const publicIssues=await verifyR2bDirectory(root);expect(publicIssues).not.toContain('ARTIFACT_INVENTORY_MISMATCH');expect(publicIssues.filter((x:string)=>x.startsWith('WEB05_'))).toEqual(r.issues.filter((x:string)=>x.startsWith('WEB05_')));return r.artifactDispositions.WEB05;}finally{rmSync(root,{recursive:true,force:true});}}
test('complete raw lifecycle and opened replay reach tested WEB05 boundary',async()=>expect(await check()).toEqual({status:'tested',issues:[]}));
const cases:Record<string,(f:ReturnType<typeof web05Fixture>)=>void>={
 'unrelated valid opened replay':f=>f.put('replay/manifest.json',f.replay('unrelated')),
 'opened report source differs at same run':f=>{const m=f.files['replay/manifest.json'] as any,r=JSON.parse(String(f.files['replay/report.json']));r.manifest.sourceCommit='9'.repeat(40);const bytes=Buffer.from(JSON.stringify(r));f.put('replay/report.json',bytes);Object.assign(m.assets[0],{sha256:sha(bytes),decodedSha256:sha(bytes),bytes:bytes.length,decodedBytes:bytes.length});},
 'crossed recovery volume':f=>{const o=f.observations.find(o=>o.id==='container'),v=JSON.parse(o.stdout);v[0].Mounts[0].Name='other-volume';o.stdout=JSON.stringify(v);},
 'observations reordered':f=>{const o=f.observations.find(o=>o.id==='reclaim');o.startedAtEpochMs=1000;o.finishedAtEpochMs=1001;},
 'other active run':f=>{(f.files['before-crash-report.json'] as any).manifest.runId='other';},
 'wrong image':f=>{(f.files['image-inspect.json'] as any).Id='sha256:'+'9'.repeat(64);f.observations.find(o=>o.id==='image').stdout=JSON.stringify([f.files['image-inspect.json']]);},
 'wrong health tuple':f=>{(f.files['health.json'] as any).sourceCommit='9'.repeat(40);},
 'empty chunks':f=>{f.put('committed-before.json',{});f.put('committed-after.json',{});for(const id of ['chunksBefore','chunksAfter'])f.observations.find(o=>o.id===id).stdout='{}';},
 'successful competing writer':f=>{f.observations.find(o=>o.id==='contenderWait').stdout='0';f.observations.find(o=>o.id==='contenderLogs').stdout='started';},
 'failed crash':f=>{f.observations.find(o=>o.id==='kill').exitCode=1;},
 'failed restart':f=>{f.observations.find(o=>o.id==='restart').exitCode=1;},
 'reclaim writable':f=>{f.observations.find(o=>o.id==='reclaim').response.controlAccess='control';},
 'resume accepted':f=>{const o=f.observations.find(o=>o.id==='resume');o.status=200;o.response={};},
 'worker remains':f=>{f.observations.find(o=>o.id==='workers').stdout='1';},
 'changed recovery state':f=>{(f.files['after-crash-report.json'] as any).outcome.status='running';},
 'cross invocation':f=>{(f.files['lifecycle-observations.json'] as any).invocationId='different';},
};
for(const [name,mutate]of Object.entries(cases))test('rejects '+name+' after hash and replay admission',async()=>{const r=await check(mutate);expect(r.status).toBe('failed');expect(r.issues.some((s:string)=>s.startsWith('WEB05_'))).toBe(true);});
