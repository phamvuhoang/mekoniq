import {freePort} from '../support/free-port';
import {afterEach, expect, test} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, cp, rm, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const lab=fileURLToPath(new URL('../../',import.meta.url)),dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'lab-offline-'));dirs.push(root);
 await mkdir(join(root,'dist'),{recursive:true});await mkdir(join(root,'config'));
 const lock=JSON.parse(await readFile(join(lab,'config/source-runtime.lock.json'),'utf8'));
 await writeFile(join(root,'dist/index.html'),'<!doctype html><title>Offline fixture</title>');
 await writeFile(join(root,'dist/source-runtime.lock.json'),JSON.stringify(lock));
 await cp(join(lab,'config/source-runtime.lock.json'),join(root,'config/source-runtime.lock.json'));
 await cp(join(lab,'.runtime',lock.artifactSha256),join(root,'.runtime',lock.artifactSha256),{recursive:true});
 await cp(join(lab,'pnpm-lock.yaml'),join(root,'pnpm-lock.yaml'));
 return root;
}
test('offline release contains its Node, runtime, built dependency assets and lock; boots with no package manager',async()=>{
 const root=await fixture(),out=join(root,'release');
 const result=spawnSync(process.execPath,[join(lab,'scripts/build-offline.mjs'),'--root',root,'--out',out],{encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);
 const manifest=JSON.parse(await readFile(join(out,'offline-manifest.json'),'utf8'));
 expect(manifest).toMatchObject({schema:'mekoniq-offline-1',platform:process.platform,arch:process.arch,node:process.version});
 expect(manifest.files).toHaveProperty('bin/node');expect(manifest.files).toHaveProperty('ui/index.html');
 expect(manifest.files).toHaveProperty('pnpm-lock.yaml');expect(manifest.files).toHaveProperty('runtime/runtime.mjs');
 expect(await readdir(out)).not.toContain('node_modules');
 const wrongPort=spawnSync(join(out,'bin/node'),[join(out,'start.mjs'),'--boot-only','--ui-port','1000'],{encoding:'utf8',timeout:10000});
 expect(wrongPort.status).toBe(1);expect(wrongPort.stderr).toContain('FORBIDDEN_PORT:1000');
 const boot=spawnSync(join(out,'bin/node'),[join(out,'start.mjs'),'--boot-only','--ui-port',String(await freePort()),'--runtime-port',String(await freePort()),'--data-dir',join(root,'data')],{encoding:'utf8',env:{...process.env,PATH:'/nonexistent'},timeout:30000});
 expect(boot.status,boot.stderr).toBe(0);expect(boot.stdout).toMatch(/Offline mock ready/);
 for(const wrong of [{platform:process.platform==='darwin'?'linux':'darwin'},{arch:process.arch==='arm64'?'x64':'arm64'}]){
  await writeFile(join(out,'offline-manifest.json'),JSON.stringify({...manifest,...wrong}));
  const rejected=spawnSync(join(out,'bin/node'),[join(out,'start.mjs'),'--boot-only'],{encoding:'utf8',timeout:10000});
  expect(rejected.status).toBe(1);expect(rejected.stderr).toContain('OFFLINE_PLATFORM_MISMATCH');
 }
 await writeFile(join(out,'offline-manifest.json'),JSON.stringify(manifest));
 // Startup validates every packaged file before it opens ports or starts a child.
 await writeFile(join(out,'ui/index.html'),'corrupted');
 const bad=spawnSync(join(out,'bin/node'),[join(out,'start.mjs'),'--boot-only'],{encoding:'utf8',timeout:10000});
 expect(bad.status).toBe(1);expect(bad.stderr).toContain('OFFLINE_HASH_MISMATCH:ui/index.html');
},60000);
test('offline builder refuses a UI built against another runtime and never overwrites an existing release',async()=>{
 const root=await fixture(),out=join(root,'release');
 await writeFile(join(root,'dist/source-runtime.lock.json'),'{}');
 const bad=spawnSync(process.execPath,[join(lab,'scripts/build-offline.mjs'),'--root',root,'--out',out],{encoding:'utf8'});
 expect(bad.status).toBe(1);expect(bad.stderr).toContain('OFFLINE_UI_PIN_MISMATCH');
 await mkdir(out);await writeFile(join(out,'keep.txt'),'owner data');
 const existing=spawnSync(process.execPath,[join(lab,'scripts/build-offline.mjs'),'--root',root,'--out',out],{encoding:'utf8'});
 expect(existing.status).toBe(1);expect(existing.stderr).toContain('OFFLINE_OUTPUT_EXISTS');
 expect(await readFile(join(out,'keep.txt'),'utf8')).toBe('owner data');
});
