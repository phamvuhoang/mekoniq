// @ts-expect-error explicit digest-verified retained evidence tooling
import {retainedInput} from '../../scripts/retained-inputs.mjs';
import {afterEach,expect,test} from 'vitest';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readRetainedWorldAdmission,materializeWorldArmReport} from '../../packages/lab-runtime/src/v2/simulation3d/world-arm-report';
import {captureWorldPrefixDisk} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {createScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {amrAsset} from '../support/lab-v2';
import {exportWebReplay} from '../../packages/lab-runtime/src/v2/replay/export';
const original=retainedInput('cell-nominal-7'),roots:string[]=[];afterEach(async()=>{for(const d of roots.splice(0))await rm(d,{recursive:true,force:true});});
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function root(){const d=await mkdtemp(join(tmpdir(),'replay-capture-'));roots.push(d);return d;}
test('actual retained reopen captures both exports without a world spawn and leaves original bytes unchanged',async()=>{
 const originalBytes=await readFile(join(original,'run.json')),owned=await root(),directory=join(owned,'run');await cp(original,directory,{recursive:true,errorOnExist:true});const cpState=JSON.parse(await readFile(join(directory,'run.json'),'utf8')),project=JSON.parse(await readFile(join(directory,'mujoco-world/bundle/project.json'),'utf8'));let opens=0;const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
 const run=await createScenarioRun({project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-cell-v1',sourceCommit:cpState.manifest.sourceCommit},{directory,catalog,assets:[amrAsset],enabledBackends:['mujoco_arm','mujoco_3d','mock_coffee'],worldPorts:async()=>{opens++;throw Error('RESPAWN_FORBIDDEN');}});
 try{const [a,b]=await Promise.all([run.captureReplay!(),run.captureReplay!()]);expect(opens).toBe(0);expect(a.world!.records.length).toBe(10851);expect(b.world!.records.at(-1)!.snapshot.tick).toBe(10850);expect(a.report.worldSweep!.scope!.streamFinalized).toBe(true);a.world!.records[0]!.snapshot.robots[0]!.poseDriveMap[0]=999;expect(b.world!.records[0]!.snapshot.robots[0]!.poseDriveMap[0]).not.toBe(999);const manifest=await exportWebReplay(b,join(owned,'export'));expect(manifest.horizon.tick).toBe(10850);expect((await run.report()).outcome.tick).toBe(10850);expect(await readFile(join(original,'run.json'))).toEqual(originalBytes);}finally{await run.close();}
},30000);
test('replay sink sees only H7, owns its copies, and a failed/aborted sink cannot damage a later report',async()=>{
 const expected=JSON.parse(await readFile(join(original,'nominal-report.json'),'utf8')),state=JSON.parse(await readFile(join(original,'run.json'),'utf8')).coffee.arm,a=await readRetainedWorldAdmission(original,expected.worldSweep.scope.identity.sceneDigest),m=JSON.parse(await readFile(join(original,'world-evidence/manifest.json'),'utf8')),first=gunzipSync(await readFile(join(original,'world-evidence',m.chunks[0].path))).toString().trim().split('\n').slice(0,9),compressed=gzipSync(first.join('\n')+'\n'),directory=await root();
 const ref={path:'world-000000-12345678.ndjson.gz',sha256:sha(compressed),bytes:compressed.length,firstTick:0,lastTick:8};await writeFile(join(directory,ref.path),compressed);await writeFile(join(directory,'pending.ndjson'),'');await writeFile(join(directory,'manifest.json'),JSON.stringify({...m,chunks:[ref],lastTick:8,complete:false}));const authority={...expected.worldSweep.scope.identity,publicCommittedTick:7},capture=await captureWorldPrefixDisk(directory,a,authority),source={journal:JSON.parse(await readFile(join(original,'nominal-source-journal.json'),'utf8')),businessEpochMs:expected.manifest.clock.businessEpochMs};
 await expect(materializeWorldArmReport(capture,a,state,source,async()=>{throw Error('REPLAY_ABORTED');})).rejects.toThrow('REPLAY_ABORTED');let ticks:number[]=[];const report=await materializeWorldArmReport(capture,a,state,source,async w=>{ticks=w.records.map(r=>r.snapshot.tick);w.records[0]!.snapshot.tick=999;w.admission.scene.sceneDigest='changed';});expect(ticks).toEqual([0,1,2,3,4,5,6,7]);expect(report.state.tracking!.trace.map(r=>r.tick)).toEqual(ticks);expect(report.worldSweep.scope!.publication!.uncommittedTicks).toBe(1);expect(a.scene.sceneDigest).not.toBe('changed');expect((await materializeWorldArmReport(capture,a,state,source)).worldTrace.lastTick).toBe(7);
});
