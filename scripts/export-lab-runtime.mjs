#!/usr/bin/env node
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {nativeToolClosure} from './native-sim/tool-identity.mjs';
import {auditBundle} from './lab-runtime-audit.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(process.argv.slice(2).find(a=>!a.startsWith('--'))??join(root,'packages/lab-runtime/dist'));
if(out===root||out.startsWith(join(root,'packages/contracts')))throw new Error('UNSAFE_OUTPUT_DIRECTORY');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const dirty=git('status','--porcelain','--untracked-files=all');
if(dirty&&process.argv.includes('--clean-checkout')){
 // Export committed HEAD from a temporary worktree (deps from the local pnpm store, --offline: no download); the working tree is untouched.
 const tmp=mkdtempSync(join(tmpdir(),'mekoniq-clean-export-'));
 // only remove a worktree that was added, so a failing `worktree add` surfaces its own error; the mkdtemp directory is always removed
 let added=false;
 try{git('worktree','add','--detach',tmp,'HEAD');added=true;execFileSync('pnpm',['install','--frozen-lockfile','--offline'],{cwd:tmp,stdio:['ignore',2,2]});execFileSync(process.execPath,[join(tmp,'scripts/export-lab-runtime.mjs'),out],{cwd:tmp,stdio:'inherit'});}
 finally{if(added)git('worktree','remove','--force',tmp);rmSync(tmp,{recursive:true,force:true});}
 process.exit(0);
}
if(dirty&&!process.argv.includes('--allow-dirty'))throw new Error('CLEAN_SOURCE_CHECKOUT_REQUIRED');
const sourceCommit=git('rev-parse','HEAD'),nativeTools=nativeToolClosure(root);
const schemaDir=join(root,'packages/contracts/schemas');
const names=(await readdir(schemaDir)).filter(n=>n.endsWith('.json')).sort();
const hash=createHash('sha256');
const schemas=[];
for(const name of names){const bytes=await readFile(join(schemaDir,name));hash.update(name+'\n').update(bytes);schemas.push({name,bytes});}
const schemaHash=hash.digest('hex');
const localRequire=createRequire(join(root,'apps/tablet-web/package.json'));
const viteRequire=createRequire(localRequire.resolve('vite/package.json'));
const {build}=await import(pathToFileURL(viteRequire.resolve('esbuild')).href);
await mkdir(join(out,'schemas'),{recursive:true});
const migration=await readFile(join(root,'packages/sync/migrations/sqlite/001_journal.sql'),'utf8');
await build({entryPoints:[join(root,'packages/lab-runtime/src/cli.ts')],outfile:join(out,'runtime.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',packages:'bundle',banner:{js:"import {createRequire as __labCreateRequire} from 'node:module';const require=__labCreateRequire(import.meta.url);"},define:{__LAB_SOURCE_DIRTY__:JSON.stringify(Boolean(dirty)),__LAB_NATIVE_TOOLS__:JSON.stringify(nativeTools),__LAB_SOURCE_COMMIT__:JSON.stringify(sourceCommit),__LAB_SCHEMA_HASH__:JSON.stringify(schemaHash)},plugins:[{name:'embed-source-sqlite-migration',setup(builder){builder.onLoad({filter:/[/\\]sync[/\\]src[/\\]storage[/\\]sql-store\.ts$/},async({path})=>{const original=await readFile(path,'utf8');const needle="readFileSync(new URL('../../migrations/sqlite/001_journal.sql',import.meta.url),'utf8')";if(!original.includes(needle))throw new Error('SQLITE_MIGRATION_BUNDLE_HOOK_CHANGED');return {contents:original.replace(needle,JSON.stringify(migration)),loader:'ts'};});}}]});
for(const {name,bytes}of schemas)await writeFile(join(out,'schemas',name),bytes);
const bundle=await readFile(join(out,'runtime.mjs'));
auditBundle(bundle.toString('utf8'));
const artifactSha256=createHash('sha256').update(bundle).digest('hex');
const pkg=JSON.parse(await readFile(join(root,'packages/lab-runtime/package.json'),'utf8'));
// The Linux SIL tools (world compiler, Gazebo/Nav2 worker, actors, metrics, arm checker) ship separately with ROS 2; the mock package
// carries only their digest so a Linux host can prove it runs the same revision. Nothing from robotics/ enters runtime.mjs.
const simDir=join(root,'robotics/simulation'),simFiles=[];
const walk=async(d)=>{for(const e of (await readdir(d,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){if(e.name==='tests'||e.name==='__pycache__')continue;const p=join(d,e.name);if(e.isDirectory())await walk(p);else if(/\.(py|json|txt|xml|yaml|yml|sdf|urdf|launch\.py)$|^(CMakeLists\.txt|Dockerfile)$/.test(e.name))simFiles.push(p.slice(simDir.length+1));}};
await walk(simDir);
const simHash=createHash('sha256');for(const f of simFiles)simHash.update(f+'\n').update(await readFile(join(simDir,f)));
const imageLock=JSON.parse(await readFile(join(simDir,'image.lock.json'),'utf8'));
const simulationTools={distribution:'separate',path:'robotics/simulation',digest:simHash.digest('hex'),files:simFiles.length,image:imageLock.image,imageDigest:imageLock.digest,requires:['linux','ros2-jazzy','gazebo-harmonic','python3+rfc8785+jsonschema'],note:'not bundled; verify with scripts/lab-sil.mjs doctor on the Linux host'};
const manifest={sourceCommit,schemaHash,protocolMajor:2,protocolMajors:[1,2],artifactSha256,entrypoint:'runtime.mjs',nodeMajor:24,packageVersion:pkg.version,dirty:Boolean(dirty),schemas:names,toolchain:{node:process.version},simulationTools,nativeTools};
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output:out,...manifest},null,2));
