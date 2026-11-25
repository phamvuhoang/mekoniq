// Owned production preview for runtime E2E evidence. The archived files are the
// bytes fetched from the server, checked against the build before Ready is printed.
import {build,preview} from 'vite';
import {mkdtemp,mkdir,readFile,writeFile,rm,access,realpath,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {productionAssetDependencies} from './production-assets.mjs';
import {labIdentity} from '../../../scripts/repo-identity.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const entries=index=>[...new Set([...index.toString().matchAll(/(?:src|href)="(\/assets\/[A-Za-z0-9_.-]+\.(?:js|css))"/g)].map(m=>m[1].slice(1)))];
function identity(root){try{const {commit,dirty}=labIdentity(resolve(root,'../..'),root);return {labCommit:commit,labDirty:dirty};}catch{return {labCommit:null,labDirty:true};}}
async function fetchBytes(url,path){const r=await fetch(new URL(path,url),{signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw Error('PRODUCTION_HTTP_'+r.status);return Buffer.from(await r.arrayBuffer());}
async function close(server){server.httpServer.closeAllConnections?.();await new Promise((done,reject)=>server.httpServer.close(e=>e?reject(e):done()));}
export async function verifyProductionUi({url,evidenceDir}){
 const origin=new URL(url);if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('PRODUCTION_LOOPBACK_REQUIRED');
 const bytes=await readFile(join(evidenceDir,'production-ui.json')),receipt=JSON.parse(bytes);
 if(receipt.schemaVersion!==1||receipt.kind!=='lab-production-ui'||!Array.isArray(receipt.files))throw Error('PRODUCTION_RECEIPT_INVALID');
 const paths=receipt.files.map(f=>f.path);if(new Set(paths).size!==paths.length||!paths.includes('index.html')||!paths.includes('source-runtime.lock.json'))throw Error('PRODUCTION_FILES_REQUIRED');
 for(const f of receipt.files){
  if(!/^(?:index\.html|source-runtime\.lock\.json|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/.test(f.path))throw Error('PRODUCTION_PATH_INVALID');
  const content=await readFile(join(evidenceDir,'production-ui',f.path));
  if(sha(content)!==f.sha256||content.length!==f.bytes)throw Error('PRODUCTION_FILE_MISMATCH');
  if(f.path.endsWith('.js')&&productionAssetDependencies(f.path,content).some(path=>!paths.includes(path)))throw Error('PRODUCTION_DEPENDENCY_MISSING');
  if(!content.equals(await fetchBytes(origin,f.path==='index.html'?'/':'/'+f.path)))throw Error('PRODUCTION_SERVED_MISMATCH');
 }
 const index=await readFile(join(evidenceDir,'production-ui/index.html'));
 if(index.includes(Buffer.from('/@vite/client'))||!entries(index).some(p=>p.endsWith('.js'))||entries(index).some(p=>!paths.includes(p)))throw Error('PRODUCTION_ENTRY_REQUIRED');
 const pin=JSON.parse(await readFile(join(evidenceDir,'production-ui/source-runtime.lock.json'),'utf8'));
 if(pin.sourceCommit!==receipt.sourceCommit||pin.artifactSha256!==receipt.runtimeArtifact||pin.schemaHash!==receipt.schemaHash)throw Error('PRODUCTION_PIN_MISMATCH');
 return sha(bytes);
}
export async function startProductionUi({root,runtimeRoot=root,uiPort,runtimePort,evidenceDir}){
 root=await realpath(root);
 const pin=await readFile(join(root,'config/source-runtime.lock.json'));
 if(!pin.equals(await readFile(join(runtimeRoot,'config/source-runtime.lock.json'))))throw Error('PRODUCTION_RUNTIME_PIN_MISMATCH');
 const before=identity(root),owned=await mkdtemp(join(tmpdir(),'mekoniq-production-ui-')),directory=join(owned,'dist');let server;
 const cleanup=async()=>{try{if(server){const current=server;server=undefined;await close(current);}}finally{await rm(owned,{recursive:true,force:true});}};
 try{
  const configFile=await access(join(root,'vite.config.ts')).then(()=>join(root,'vite.config.ts'),()=>false);
  await build({root,configFile,logLevel:'error',plugins:[{name:'production-evidence-pin',enforce:'post',generateBundle(_,bundle){const old=bundle['source-runtime.lock.json'];if(old){if(old.type!=='asset'||!Buffer.from(old.source).equals(pin))throw Error('PRODUCTION_BUILD_PIN_MISMATCH');}else this.emitFile({type:'asset',fileName:'source-runtime.lock.json',source:pin});}}],build:{outDir:directory,emptyOutDir:false}});
  if(JSON.stringify(identity(root))!==JSON.stringify(before)||!pin.equals(await readFile(join(root,'config/source-runtime.lock.json'))))throw Error('PRODUCTION_BUILD_CHANGED');
  server=await preview({root,configFile,logLevel:'error',build:{outDir:directory},preview:{host:'127.0.0.1',port:uiPort,strictPort:true,proxy:{'/lab':{target:`http://127.0.0.1:${runtimePort}`,changeOrigin:false}}}});
  const address=server.httpServer.address();if(!address||typeof address==='string')throw Error('PRODUCTION_ADDRESS_REQUIRED');const url=`http://127.0.0.1:${address.port}/`;
  const index=await readFile(join(directory,'index.html')),files=[];
  const assets=(await readdir(join(directory,'assets'))).filter(name=>/\.(?:js|css)$/.test(name)).sort().map(name=>'assets/'+name);
  for(const path of ['index.html','source-runtime.lock.json',...assets]){
   const built=await readFile(join(directory,path)),served=await fetchBytes(url,path==='index.html'?'/':'/'+path);if(!built.equals(served))throw Error('PRODUCTION_SERVED_MISMATCH');
   const out=join(evidenceDir,'production-ui',path);await mkdir(join(out,'..'),{recursive:true});await writeFile(out,served);files.push({path,sha256:sha(served),bytes:served.length});
  }
  const lock=JSON.parse(pin),receipt={schemaVersion:1,kind:'lab-production-ui',...before,sourceCommit:lock.sourceCommit,runtimeArtifact:lock.artifactSha256,schemaHash:lock.schemaHash,files};
  await writeFile(join(evidenceDir,'production-ui.json'),JSON.stringify(receipt,null,2)+'\n');await verifyProductionUi({url,evidenceDir});
  return {url,close:cleanup};
 }catch(e){await cleanup();throw e;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let ui,stopping=false;const stop=async()=>{stopping=true;await ui?.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const [root,runtimeRoot,uiPort,runtimePort,evidenceDir]=process.argv.slice(2);ui=await startProductionUi({root,runtimeRoot,uiPort:Number(uiPort),runtimePort:Number(runtimePort),evidenceDir});if(stopping)await ui.close();else console.log('Production UI ready');}catch(e){console.error(e.message);process.exitCode=1;}
}
