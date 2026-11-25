#!/usr/bin/env node
// Build on the target OS/architecture after pnpm build. No downloads: compiled UI dependencies,
// the pinned bundled runtime, contract schemas, dependency lock and this host's Node are vendored.
import {access,cp,copyFile,mkdir,readFile,readdir,writeFile,rename,rm,chmod,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {checkedRuntime} from './runtime-artifact.mjs';
const here=fileURLToPath(new URL('.',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function inventory(root,prefix=''){
 const files={};
 for(const name of (await readdir(join(root,prefix))).sort()){
  const relative=prefix?`${prefix}/${name}`:name,path=join(root,relative),s=await lstat(path);
  if(s.isSymbolicLink())throw new Error(`OFFLINE_SYMLINK:${relative}`);
  if(s.isDirectory())Object.assign(files,await inventory(root,relative));
  else if(s.isFile())files[relative]={sha256:hash(await readFile(path)),bytes:s.size};
  else throw new Error(`OFFLINE_UNSUPPORTED_FILE:${relative}`);
 }
 return files;
}
export async function buildOffline(root,out){
 if(process.versions.node.split('.')[0]!=='24')throw new Error('UNSUPPORTED_NODE:24 required');
 if(!['darwin','linux'].includes(process.platform))throw new Error('UNSUPPORTED_OS');
 try{await access(out);throw new Error('OFFLINE_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 const {lock,file}=await checkedRuntime(root);
 const uiLock=JSON.parse(await readFile(join(root,'dist/source-runtime.lock.json'),'utf8'));
 if(uiLock.artifactSha256!==lock.artifactSha256||uiLock.sourceCommit!==lock.sourceCommit||uiLock.schemaHash!==lock.schemaHash)throw new Error('OFFLINE_UI_PIN_MISMATCH');
 await access(join(root,'dist/index.html'));
 const staging=`${out}.staging-${randomUUID()}`;
 try{
  await mkdir(join(staging,'bin'),{recursive:true});
  await cp(join(root,'dist'),join(staging,'ui'),{recursive:true,dereference:false});
  await cp(resolve(file,'..'),join(staging,'runtime'),{recursive:true,dereference:false});
  await copyFile(process.execPath,join(staging,'bin/node'),constants.COPYFILE_FICLONE);await chmod(join(staging,'bin/node'),0o755);
  await copyFile(join(root,'pnpm-lock.yaml'),join(staging,'pnpm-lock.yaml'));
  await copyFile(resolve(process.execPath,'../../LICENSE'),join(staging,'LICENSE-Node.txt'));
  await copyFile(join(here,'../node_modules/three/LICENSE'),join(staging,'LICENSE-Three.txt'));
  await copyFile(join(here,'offline-start.mjs'),join(staging,'start.mjs'));
  await writeFile(join(staging,'start'),'#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nexec ./bin/node ./start.mjs "$@"\n',{mode:0o755});
  await writeFile(join(staging,'README.txt'),`MEKONIQ Lab offline mock\nTarget: ${process.platform}/${process.arch}, Node ${process.version}\nRun ./start (no install, pnpm, npm or network download). UI: http://127.0.0.1:4175\nPair using the one-use code printed in this terminal. Data defaults to ./runs.\nThis bundle contains compiled third-party dependencies and the pinned source runtime.\nMock evidence does not validate physical robots. Build separately on Linux for Linux.\nSource: ${lock.sourceCommit}\n`);
  const manifest={schema:'mekoniq-offline-1',platform:process.platform,arch:process.arch,node:process.version,sourceCommit:lock.sourceCommit,artifactSha256:lock.artifactSha256,files:await inventory(staging)};
  await writeFile(join(staging,'offline-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await rename(staging,out);return manifest;
 }finally{await rm(staging,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);let root=resolve(here,'..'),out;
  for(let i=0;i<args.length;i++){if(args[i]==='--root')root=resolve(args[++i]);else if(args[i]==='--out')out=resolve(args[++i]);else throw new Error(`UNKNOWN_ARGUMENT:${args[i]}`);}
  if(!out)throw new Error('Usage: node scripts/build-offline.mjs --out <new-directory>');
  const m=await buildOffline(root,out);console.log(`Offline bundle: ${out} (${m.platform}/${m.arch}, ${Object.keys(m.files).length} files)`);
 }catch(e){console.error(e.message);process.exitCode=1;}
}
