#!/usr/bin/env node
// Read-only campaign -> browser evidence folder. Copies only public, hash-bound inputs/traces; never journals/signing keys/worker state.
// node scripts/export-payload-replay.mjs <campaign case directory> <new output directory>
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const [input,output]=process.argv.slice(2);if(!input||!output)throw new Error('USAGE: export-payload-replay.mjs CASE NEW_OUTPUT');
const root=resolve(input),out=resolve(output),read=async p=>JSON.parse(await readFile(p,'utf8'));
const r=await read(join(root,'report.json')),digest=r.manifest.engineering?.bundleDigest;
if(!/^[a-f0-9]{64}$/.test(digest)||r.navigation2d?.engine.id!=='mujoco_3d')throw new Error('PAYLOAD_REPORT_REQUIRED');
const engineering=join(dirname(root),'engineering'),m=await read(join(engineering,'bundles',digest,'manifest.json'));
const safe=p=>typeof p==='string'&&/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const copy=async(src,path,sha,size)=>{if(!safe(path))throw new Error('UNSAFE_PATH');const b=await readFile(src);if(b.length!==size||createHash('sha256').update(b).digest('hex')!==sha)throw new Error(`HASH_MISMATCH:${path}`);await mkdir(dirname(join(out,path)),{recursive:true});await writeFile(join(out,path),b);};
await mkdir(out);// refuse existing output; source remains untouched
await copyFile(join(root,'report.json'),join(out,'report.json'));
const project=m.files.find(f=>f.path==='runtime-project.json');if(!project)throw new Error('PROJECT_MISSING');
await copy(join(engineering,'blobs',project.sha256),'project.json',project.sha256,project.sizeBytes);
for(const f of m.files)await copy(join(engineering,'blobs',f.sha256),`bundle/${f.path}`,f.sha256,f.sizeBytes);
for(const refs of Object.values(r.navigation2d.artifacts))for(const f of refs)await copy(join(root,'run/evidence',f.path),`evidence/${f.path}`,f.sha256,f.bytes);
for(const stream of r.physicsEvidence?.manifest.streams??[])for(const f of stream.chunks)await copy(join(root,'run/physics',f.path),`physics/${f.path}`,f.sha256,f.bytes);
console.log(`Wrote read-only replay folder ${out}; metrics are not recomputed by this exporter.`);
