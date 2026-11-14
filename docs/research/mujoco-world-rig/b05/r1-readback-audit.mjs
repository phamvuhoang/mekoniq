// Run from Source: node .../r1-readback-audit.mjs <retained-campaign> <new-output-directory>
// Reads the immutable campaign; only writes the separate R1 output directory.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]),source=process.cwd();
await mkdir(out); // Refuse to overwrite a prior audit.
const sha=b=>createHash('sha256').update(b).digest('hex');
const {readWorldFixture}=await tsImport(join(source,'packages/lab-runtime/src/v2/simulation3d/world-scene.ts'),import.meta.url);
const {prepareWorldAdmission,readWorldEvidence,openWorldRecorder}=await tsImport(join(source,'packages/lab-runtime/src/v2/simulation3d/world-evidence.ts'),import.meta.url);
const inventoryBytes=await readFile(join(root,'campaign-integrity.json')),inventory=JSON.parse(inventoryBytes),fixture=await readWorldFixture(join(source,'robotics/simulation-mujoco')),admission=prepareWorldAdmission(fixture.scene,fixture.files);
const trials=[];let verifiedFiles=0;
for(const t of inventory.trials){
 const dir=join(root,`trial-${t.trial}`),evidence=join(dir,'evidence');
 const files=[{path:join(dir,'summary.json'),sha256:t.summary.sha256},{path:join(dir,'native-readback.json'),sha256:t.nativeReadback.sha256},{path:join(evidence,'manifest.json'),sha256:t.manifest.sha256},...t.chunks.map(c=>({path:join(evidence,c.path),sha256:c.sha256}))];
 for(const f of files)if(sha(await readFile(f.path))!==f.sha256)throw Error(`RETAINED_FILE_CHANGED:${f.path}`);
 const read=await readWorldEvidence(evidence,admission);if(!read.complete||read.records.length!==2503)throw Error(`R1_READ_FAILED:${t.trial}:${read.issues}`);
 if(t.trial===1){
  const recorder=await openWorldRecorder({directory:join(out,'normal-record-replay'),admission,runId:t.runId,bootId:t.bootId});
  for(const r of read.records)await recorder.append(r.snapshot,r.command);await recorder.finish();
  const chunks=recorder.manifest().chunks;if(chunks.length!==t.chunks.length)throw Error('NORMAL_CHUNK_COUNT_CHANGED');
  for(let i=0;i<chunks.length;i++){const a=chunks[i],b=t.chunks[i];if(a.sha256!==b.sha256||a.bytes!==b.bytes||a.firstTick!==b.firstTick||a.lastTick!==b.lastTick)throw Error('NORMAL_RECORD_BYTES_CHANGED');}
 }
 for(const f of files)if(sha(await readFile(f.path))!==f.sha256)throw Error(`READER_CHANGED_FILE:${f.path}`);
 verifiedFiles+=files.length;trials.push({trial:t.trial,records:read.records.length,complete:read.complete,issues:read.issues});
}
if(sha(await readFile(join(root,'campaign-integrity.json')))!==sha(inventoryBytes))throw Error('INVENTORY_CHANGED');
const result={accepted:false,scope:'R1 recorder-only reread of retained production trials; no new physics or Source custody qualification',priorInventorySha256:sha(inventoryBytes),readerSha256:sha(await readFile(join(source,'packages/lab-runtime/src/v2/simulation3d/world-evidence.ts'))),verifiedImmutableFiles:verifiedFiles,normalReplay:{trial:1,records:2503,chunks:11,compressedChunkBytesIdentical:true,randomChunkFilenamesExcluded:true},trials};
await writeFile(join(out,'readback-audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
