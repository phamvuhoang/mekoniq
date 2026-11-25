// The builder packages production campaign code and the exact consumed module graph into the immutable image context.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceCommit as repoSourceCommit,sourceDirty} from './repo-identity.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),[out,exportDir]=process.argv.slice(2),sha=b=>createHash('sha256').update(b).digest('hex');
if(!out||!exportDir)throw Error('USAGE: build-r2b-campaign.mjs CONTEXT EXPORT_DIR');
if(sourceDirty(root))throw Error('CAMPAIGN_BUILD_DIRTY');
const sourceCommit=repoSourceCommit(root),runtime=JSON.parse(await readFile(join(exportDir,'manifest.json'),'utf8'));
if(runtime.dirty!==false||runtime.sourceCommit!==sourceCommit||runtime.artifactSha256!==sha(await readFile(join(exportDir,'runtime.mjs'))))throw Error('CAMPAIGN_EXPORT_TUPLE_MISMATCH');
const localRequire=createRequire(join(root,'apps/tablet-web/package.json')),viteRequire=createRequire(localRequire.resolve('vite/package.json')),{build}=await import(pathToFileURL(viteRequire.resolve('esbuild')).href);
const result=await build({absWorkingDir:root,entryPoints:['scripts/r2b-campaign-entry.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:join(out,'r2b-campaign.mjs'),metafile:true,packages:'bundle',plugins:[{name:'embed-source-sqlite-migration',setup(builder){builder.onLoad({filter:/[/\\]sync[/\\]src[/\\]storage[/\\]sql-store\.ts$/},async({path})=>{const original=await readFile(path,'utf8'),needle="readFileSync(new URL('../../migrations/sqlite/001_journal.sql',import.meta.url),'utf8')";if(!original.includes(needle))throw Error('SQLITE_MIGRATION_BUNDLE_HOOK_CHANGED');return {contents:original.replace(needle,JSON.stringify(await readFile(join(root,'packages/sync/migrations/sqlite/001_journal.sql'),'utf8'))),loader:'ts'};});}}],banner:{js:"import { createRequire as __r2bCreateRequire } from 'node:module'; const require=__r2bCreateRequire(import.meta.url);"}});
const engineObserver=await readFile(join(root,'scripts/native-sim/r2b-engine-inventory.py'));await writeFile(join(out,'r2b-engine-inventory.py'),engineObserver,{flag:'wx'});
const inputs=[];for(const path of [...new Set([...Object.keys(result.metafile.inputs),'packages/sync/migrations/sqlite/001_journal.sql','scripts/native-sim/r2b-engine-inventory.py'])].sort()){const b=await readFile(join(root,path));inputs.push({path,sha256:sha(b),bytes:b.length});}
if(inputs.some(f=>f.path.startsWith('tests/')))throw Error('CAMPAIGN_TEST_IMPORT');
await writeFile(join(out,'r2b-campaign-package.json'),JSON.stringify({version:1,kind:'r2b-payload-cell-package',documentProfile:'mujoco_cell_v1',payloadRegistrySha256:sha(await readFile(join(root,'robotics/simulation-mujoco/campaigns/payload-v1.json'))),cellRegistrySha256:sha(await readFile(join(root,'robotics/simulation-mujoco/campaigns/mj-cell-bv01-v1.json'))),sourceCommit,runtimeArtifactSha256:sha(await readFile(join(exportDir,'runtime.mjs'))),schemaHash:runtime.schemaHash,portableToolsDigest:runtime.portableSimulationTools.closure.digest,engineObserverSha256:sha(engineObserver),bundleSha256:sha(await readFile(join(out,'r2b-campaign.mjs'))),campaigns:['payload-v1','mj-cell-bv01-v1'],imageFiles:runtime.portableSimulationTools.closure.files.filter(f=>f.path.startsWith('robotics/simulation-mujoco/')||f.path.startsWith('packages/contracts/schemas/')),inputs},null,2)+'\n',{flag:'wx'});
