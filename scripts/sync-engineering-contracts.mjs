#!/usr/bin/env node
// Copies the generated engineering contract types from the sibling source checkout (one definition, never hand-edited here) and records where they came from.
//   node scripts/sync-engineering-contracts.mjs [--check]
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=(p)=>fileURLToPath(new URL(p,import.meta.url));
const sourceRoot=here('../../source/'),target=here('../src/shared/engineering.ts');
const generated=await readFile(here('../../source/packages/contracts/generated/engineering.ts'),'utf8');
// Lab owns its LabProjectV2/AssetRevision copies (shared/types); CoffeeRecipe is only carried through, never inspected here.
const body=generated.replace("import type { LabProjectV2, AssetRevision, CoffeeRecipe } from './lab-v2';","import type {LabProjectV2,AssetRevision} from './types';\nexport type CoffeeRecipe=Record<string,unknown>;");
if(body===generated)throw new Error('GENERATED_IMPORT_CHANGED');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain','--','packages/contracts'],{cwd:sourceRoot,encoding:'utf8'}).trim();
if(dirty)throw new Error('SOURCE_CONTRACTS_DIRTY: commit source before syncing');
const header=`// Synced from source packages/contracts/generated/engineering.ts @ ${commit} (sha256 ${createHash('sha256').update(generated).digest('hex')}). Run node scripts/sync-engineering-contracts.mjs; do not edit.\n`;
const output=header+body;
// Schemas the browser validates archives with (runtimeProject stays Lab's own validator; assets and recipes are validated against their full source schemas).
const SCHEMAS=['engineering-component','engineering-project','engineering-bundle','engineering-project-archive','engineering-candidate','asset-revision','coffee-recipe','robot-physical-model-v1','model-validation-report-v1','navigation-run-evidence-v1','physics-evidence-v1','load-profile-v1','navigation-scene-v1','navigation-model-2d-v1','twin-sample-v2','web-replay-package-v1','semantic-study-v1','drive-io-v1','control-profile-v1','control-evidence-v1','bench-request-v1','perception-profile-v1','belief-evidence-v1'];
// Navigation/validation types (IR-SIM 2D, LinkForge shadow) come from the same generator; their './engineering' import resolves to shared/engineering.ts here too.
const navigationGenerated=await readFile(here('../../source/packages/contracts/generated/navigation2d.ts'),'utf8'),navigationTarget=here('../src/shared/navigation2d.ts');
if(!navigationGenerated.includes("from './engineering';"))throw new Error('GENERATED_IMPORT_CHANGED');
const navigationOutput=`// Synced from source packages/contracts/generated/navigation2d.ts @ ${commit} (sha256 ${createHash('sha256').update(navigationGenerated).digest('hex')}). Run node scripts/sync-engineering-contracts.mjs; do not edit.\n`+navigationGenerated;
// The Serve demo fixture (portable IR-SIM profile) the Assembly page opens: copied byte for byte after its own manifest hashes verify.
const fixtureSource=here('../../source/robotics/navigation-2d/fixtures/serve-demo-v1/'),fixtureTarget=here('../fixtures/engineering/serve-demo-v1/'),FIXTURE_FILES=['manifest.json','serve-project.json','serve-fleet-project.json','serve-components.json','navigation-scene.json'];
const fixtureManifest=JSON.parse(await readFile(`${fixtureSource}manifest.json`,'utf8'));
const fixtureFiles=await Promise.all(FIXTURE_FILES.map(async(n)=>{const b=await readFile(`${fixtureSource}${n}`);if(n!=='manifest.json'&&fixtureManifest.files.find(f=>f.path===n)?.sha256!==createHash('sha256').update(b).digest('hex'))throw new Error(`SERVE_FIXTURE_HASH_MISMATCH:${n}`);return [n,b];}));
if(execFileSync('git',['status','--porcelain','--','robotics/navigation-2d/fixtures'],{cwd:sourceRoot,encoding:'utf8'}).trim())throw new Error('SOURCE_FIXTURES_DIRTY: commit source before syncing');
// The Webots 3D fixture (serve-3d-v1: Serve plus two casters), same rule: copied byte for byte after its own manifest hashes verify.
const fixture3dSource=here('../../source/robotics/simulation-3d/fixtures/serve-3d-v1/'),fixture3dTarget=here('../fixtures/engineering/serve-3d-v1/'),FIXTURE3D_FILES=['manifest.json','serve-3d-project.json','serve-3d-fleet-project.json','serve-3d-components.json','world3d.json'];
const fixture3dManifest=JSON.parse(await readFile(`${fixture3dSource}manifest.json`,'utf8'));
const fixture3dFiles=await Promise.all(FIXTURE3D_FILES.map(async(n)=>{const b=await readFile(`${fixture3dSource}${n}`);if(n!=='manifest.json'&&fixture3dManifest.files.find(f=>f.path===n)?.sha256!==createHash('sha256').update(b).digest('hex'))throw new Error(`SERVE3D_FIXTURE_HASH:${n}`);return [n,b];}));
if(execFileSync('git',['status','--porcelain','--','robotics/simulation-3d/fixtures'],{cwd:sourceRoot,encoding:'utf8'}).trim())throw new Error('SOURCE_FIXTURES_DIRTY: commit source before syncing');
// The Webots arm fixture (arm-ref-3d-v1): the Lab draws the arm's joint chain from its joint origins and axes, so the component and the FK golden are copied byte for byte after the manifest hashes verify.
const armSource=here('../../source/robotics/simulation-3d/fixtures/arm-ref-3d-v1/'),armTarget=here('../fixtures/engineering/arm-ref-3d-v1/'),ARM_FILES=['manifest.json','component.json','fk-golden.json'];
const armManifest=JSON.parse(await readFile(`${armSource}manifest.json`,'utf8'));
const armFiles=await Promise.all(ARM_FILES.map(async(n)=>{const b=await readFile(`${armSource}${n}`);if(n!=='manifest.json'&&armManifest.files.find(f=>f.path===n)?.sha256!==createHash('sha256').update(b).digest('hex'))throw new Error(`ARM_FIXTURE_HASH:${n}`);return [n,b];}));
// The MuJoCo arm fixture (xarm6-g2-v1): the 3D twin draws the xArm 6 from its visual meshes (D51). The JSON files go beside the other fixtures; the STL blobs and the
// vendor NOTICE (BSD-3-Clause, it travels with every copy of the meshes) are served by the Lab itself from public/. Every file is checked against the fixture's manifest
// (blobs by their sha256 name), the source fixture tree must be clean (no modified or untracked file), and the meshes stay within D51's 8 MB.
const xarmSource=here('../../source/robotics/simulation-mujoco/fixtures/xarm6-g2-v1/'),xarmTarget=here('../fixtures/engineering/xarm6-g2-v1/'),xarmPublic=here('../public/fixtures/xarm6-g2-v1/');
const XARM_FILES=['manifest.json','component.json','physics.json','cell-layout.json','fk-golden.json','coffee-cell-project.json'],XARM_MESH_LIMIT=8*1024*1024;
if(execFileSync('git',['status','--porcelain','--untracked-files=all','--','robotics/simulation-mujoco/fixtures'],{cwd:sourceRoot,encoding:'utf8'}).trim())throw new Error('SOURCE_FIXTURES_DIRTY: commit source before syncing');
const xarmManifest=JSON.parse(await readFile(`${xarmSource}manifest.json`,'utf8'));
const sha=(b)=>createHash('sha256').update(b).digest('hex');
const xarmFiles=await Promise.all([...XARM_FILES,'NOTICE'].map(async(n)=>{const b=await readFile(`${xarmSource}${n}`);if(n!=='manifest.json'&&xarmManifest.files.find(f=>f.path===n)?.sha256!==sha(b))throw new Error(`XARM_FIXTURE_HASH:${n}`);return [n,b];}));
const xarmBlobs=await Promise.all(xarmManifest.blobs.map(async({sha256})=>{const b=await readFile(`${xarmSource}blobs/${sha256}.stl`);if(sha(b)!==sha256)throw new Error(`XARM_BLOB_HASH:${sha256}`);return [`blobs/${sha256}.stl`,b];}));
if(xarmBlobs.reduce((n,[,b])=>n+b.length,0)>XARM_MESH_LIMIT)throw new Error('XARM_MESHES_TOO_LARGE: D51 allows 8 MB of visual meshes');
// the NOTICE cites vendor-manifest.json and manifest.json: each goes beside it when it is under 100 KB (the manifest is the fixture's own; the vendor manifest is checked by it)
const XARM_CITED=['vendor-manifest.json','manifest.json'],XARM_CITED_LIMIT=100*1024;
const xarmCited=(await Promise.all(XARM_CITED.map(async(n)=>{const b=n==='manifest.json'?xarmFiles.find(([f])=>f===n)[1]:await readFile(`${xarmSource}${n}`);if(n!=='manifest.json'&&xarmManifest.files.find(f=>f.path===n)?.sha256!==sha(b))throw new Error(`XARM_FIXTURE_HASH:${n}`);return [n,b];}))).filter(([,b])=>b.length<XARM_CITED_LIMIT);
const xarmOut=[...xarmFiles.map(([n,b])=>[n==='NOTICE'?`${xarmPublic}NOTICE`:`${xarmTarget}${n}`,b]),...xarmCited.map(([n,b])=>[`${xarmPublic}${n}`,b]),...xarmBlobs.map(([n,b])=>[`${xarmPublic}${n}`,b])];
/** Files under the two xArm target folders that the fixture does not list (a blob the manifest dropped, a stray file). */
const xarmExtra=async()=>{const want=new Set(xarmOut.map(([path])=>path)),found=[];for(const dir of [xarmTarget,xarmPublic])for(const e of await readdir(dir,{recursive:true,withFileTypes:true}).catch(()=>[]))if(e.isFile())found.push(`${e.parentPath.replace(/\/?$/,'/')}${e.name}`);return found.filter(f=>!want.has(f));};
const payloadSource=here('../../source/robotics/simulation-mujoco/fixtures/serve-payload-v1/'),payloadTarget=here('../fixtures/engineering/serve-payload-v1/');
const payloadManifest=JSON.parse(await readFile(`${payloadSource}manifest.json`,'utf8'));
const payloadFiles=await Promise.all(['manifest.json','serve-3d-project.json','physical-model-amr-1.json','navigation-scene.json','cup-center.json','cup-offset.json','empty.json','NOTICE'].map(async n=>{const b=await readFile(`${payloadSource}${n}`);if(n!=='manifest.json'&&payloadManifest.files.find(f=>f.path===n)?.sha256!==sha(b))throw new Error(`PAYLOAD_FIXTURE_HASH:${n}`);return [n,b];}));
// the tray fixture (V10): the two three-cup load profiles the twin admits, with the manifest that lists them and the NOTICE that cites it
const traySource=here('../../source/robotics/simulation-mujoco/fixtures/serve-tray-v1/'),trayTarget=here('../fixtures/engineering/serve-tray-v1/');
const trayManifest=JSON.parse(await readFile(`${traySource}manifest.json`,'utf8'));
const trayFiles=await Promise.all(['manifest.json','cup-triple.json','cup-triple-low-friction.json','NOTICE'].map(async n=>{const b=await readFile(`${traySource}${n}`);if(n!=='manifest.json'&&trayManifest.files.find(f=>f.path===n)?.sha256!==sha(b))throw new Error(`TRAY_FIXTURE_HASH:${n}`);return [n,b];}));
const replayReaderSource=await readFile(here('../../source/packages/lab-runtime/src/v2/replay/reader.ts'),'utf8'),replayReaderTarget=here('../src/reports/replay-package.ts'),replayReaderOutput='// Synced Source replay reader; run node scripts/sync-engineering-contracts.mjs; do not edit.\n'+replayReaderSource.replace("../../../../contracts/schemas/web-replay-package-v1.schema.json","../shared/engineering-schemas/web-replay-package-v1.schema.json");
const schemaDir=here('../src/shared/engineering-schemas/');
const schemaFiles=await Promise.all(SCHEMAS.map(async(n)=>[n,await readFile(here(`../../source/packages/contracts/schemas/${n}.schema.json`),'utf8')]));
if(process.argv.includes('--check')){
 if(await readFile(replayReaderTarget,'utf8').catch(()=>'')!==replayReaderOutput)throw Error('REPLAY_READER_DRIFT');
 const actual=await readFile(target,'utf8').catch(()=>'');
 // the commit in the header may lag unrelated source commits; only the content hash must match
 const strip=(s)=>s.replace(/^\/\/ Synced from .*\n/,'');
 if(strip(actual)!==strip(output)||actual.match(/sha256 ([0-9a-f]{64})/)?.[1]!==createHash('sha256').update(generated).digest('hex'))throw new Error('ENGINEERING_CONTRACTS_DRIFT: run node scripts/sync-engineering-contracts.mjs');
 for(const [n,text] of schemaFiles)if(await readFile(`${schemaDir}${n}.schema.json`,'utf8').catch(()=>'')!==text)throw new Error(`ENGINEERING_SCHEMA_DRIFT:${n}`);
 if(strip(await readFile(navigationTarget,'utf8').catch(()=>''))!==strip(navigationOutput))throw new Error('NAVIGATION_CONTRACTS_DRIFT: run node scripts/sync-engineering-contracts.mjs');
 for(const [n,b] of fixtureFiles)if(!b.equals(await readFile(`${fixtureTarget}${n}`).catch(()=>Buffer.alloc(0))))throw new Error(`SERVE_FIXTURE_DRIFT:${n}`);
 for(const [n,b] of fixture3dFiles)if(!b.equals(await readFile(`${fixture3dTarget}${n}`).catch(()=>Buffer.alloc(0))))throw new Error(`SERVE3D_FIXTURE_DRIFT:${n}`);
 for(const [n,b] of armFiles)if(!b.equals(await readFile(`${armTarget}${n}`).catch(()=>Buffer.alloc(0))))throw new Error(`ARM_FIXTURE_DRIFT:${n}`);
 for(const [path,b] of xarmOut)if(!b.equals(await readFile(path).catch(()=>Buffer.alloc(0))))throw new Error(`XARM_FIXTURE_DRIFT:${path}`);
 for(const [n,b] of payloadFiles)if(!b.equals(await readFile(`${payloadTarget}${n}`).catch(()=>Buffer.alloc(0))))throw new Error(`PAYLOAD_FIXTURE_DRIFT:${n}`);
 for(const [n,b] of trayFiles)if(!b.equals(await readFile(`${trayTarget}${n}`).catch(()=>Buffer.alloc(0))))throw new Error(`TRAY_FIXTURE_DRIFT:${n}`);
 const extra=await xarmExtra();if(extra.length)throw new Error(`XARM_FIXTURE_EXTRA:${extra.join(',')}`);
 console.log('Engineering contracts match source.');
}else{await writeFile(replayReaderTarget,replayReaderOutput);await mkdir(payloadTarget,{recursive:true});for(const [n,b] of payloadFiles)await writeFile(`${payloadTarget}${n}`,b);await mkdir(trayTarget,{recursive:true});for(const [n,b] of trayFiles)await writeFile(`${trayTarget}${n}`,b);await mkdir(schemaDir,{recursive:true});await mkdir(fixtureTarget,{recursive:true});await mkdir(fixture3dTarget,{recursive:true});for(const [n,b] of fixture3dFiles)await writeFile(`${fixture3dTarget}${n}`,b);await mkdir(armTarget,{recursive:true});for(const [n,b] of armFiles)await writeFile(`${armTarget}${n}`,b);for(const [n,text] of schemaFiles)await writeFile(`${schemaDir}${n}.schema.json`,text);for(const [n,b] of fixtureFiles)await writeFile(`${fixtureTarget}${n}`,b);await mkdir(xarmTarget,{recursive:true});await mkdir(`${xarmPublic}blobs`,{recursive:true});for(const [path,b] of xarmOut)await writeFile(path,b);for(const f of await xarmExtra())await rm(f);await writeFile(target,output);await writeFile(navigationTarget,navigationOutput);console.log(`Wrote ${target}, ${navigationTarget} and the Serve fixture`);}
