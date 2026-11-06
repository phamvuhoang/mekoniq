#!/usr/bin/env node
// Imports vendor files into robotics/catalog/documents/<sha256>. Bytes only: nothing downloaded is ever executed.
//   node scripts/import-engineering-vendor.mjs <manifest.json> [catalogRoot]
// manifest: {"sources":[{"url","sha256","license","commit","documentId"}]}
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ALLOWED_HOSTS=new Set(['raw.githubusercontent.com','github.com','codeload.github.com','www.ufactory.cc','www.ufactory.us']);
const MAX_BYTES=200*1024*1024;

export async function importVendor({root,sources,fetchImpl=fetch}){
 const imported=[];
 for(const s of sources){
  let url;try{url=new URL(s.url);}catch{throw new Error(`IMPORT_HOST_FORBIDDEN ${s.url}`);}
  if(url.protocol!=='https:'||!ALLOWED_HOSTS.has(url.hostname))throw new Error(`IMPORT_HOST_FORBIDDEN ${url.origin}`);
  if(!s.license)throw new Error(`IMPORT_LICENSE_REQUIRED ${s.url}`);
  if(!/^[0-9a-f]{7,40}$/.test(s.commit??''))throw new Error(`IMPORT_COMMIT_REQUIRED ${s.url}: pin a commit, not a branch`);
  if(!/^[0-9a-f]{64}$/.test(s.sha256??''))throw new Error(`IMPORT_HASH_REQUIRED ${s.url}`);
  const response=await fetchImpl(url,{redirect:'error'});
  if(!response.ok)throw new Error(`IMPORT_FETCH_FAILED ${s.url} ${response.status}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>MAX_BYTES)throw new Error(`IMPORT_TOO_LARGE ${s.url}`);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256!==s.sha256)throw new Error(`IMPORT_HASH_MISMATCH ${s.url}: declared ${s.sha256}, got ${sha256}`);
  const file=`documents/${sha256}`;
  await mkdir(join(root,'documents'),{recursive:true});
  await writeFile(join(root,file),bytes);
  imported.push({documentId:s.documentId,url:s.url,sha256,commit:s.commit,license:s.license,file});
 }
 // provenance ledger: append-only list of what was imported from where, at which commit and license
 const ledger=join(root,'imports.json'),previous=JSON.parse(await readFile(ledger,'utf8').catch(()=>'[]'));
 await writeFile(ledger,JSON.stringify([...previous,...imported],null,2)+'\n');
 return {imported};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [manifestPath,rootArg]=process.argv.slice(2);
 if(!manifestPath){console.error('usage: import-engineering-vendor.mjs <manifest.json> [catalogRoot]');process.exit(2);}
 const root=resolve(rootArg??join(dirname(fileURLToPath(import.meta.url)),'../robotics/catalog'));
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 console.log(JSON.stringify(await importVendor({root,sources:manifest.sources}),null,2));
}
