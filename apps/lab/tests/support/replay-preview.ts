import {test as base} from '@playwright/test';
import {build,preview,type PreviewServer} from 'vite';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

export interface ReplayPreviewOptions {replayPreviewMode:'owned'|'external'}
interface PreviewBinding {url:string;mode:ReplayPreviewOptions['replayPreviewMode'];directory:string;indexSha256:string;pinSha256:string;entryAssets:{path:string;sha256:string}[];invocationId:string|null}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function servedBuild(url:string,directory:string):Promise<Omit<PreviewBinding,'mode'|'directory'>>{
 const origin=new URL(url);if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/')throw Error('REPLAY_PREVIEW_LOOPBACK_REQUIRED');
 const fetchBytes=async(path:string)=>{const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw Error('REPLAY_PREVIEW_HTTP_'+response.status);return Buffer.from(await response.arrayBuffer());};
 const index=await readFile(join(directory,'index.html')),served=await fetchBytes('/');if(!index.equals(served)||served.includes(Buffer.from('/@vite/client')))throw Error('REPLAY_PRODUCTION_INDEX_MISMATCH');
 const pin=await readFile(join(directory,'source-runtime.lock.json')),current=JSON.parse(await readFile(resolve('config/source-runtime.lock.json'),'utf8'));
 if(!pin.equals(await fetchBytes('/source-runtime.lock.json'))||JSON.stringify(JSON.parse(pin.toString()))!==JSON.stringify(current))throw Error('REPLAY_PRODUCTION_PIN_MISMATCH');
 const paths=[...index.toString().matchAll(/(?:src|href)="(\/assets\/[A-Za-z0-9_.-]+\.(?:js|css))"/g)].map(match=>match[1]!);if(!paths.some(path=>path.endsWith('.js')))throw Error('REPLAY_PRODUCTION_ENTRY_MISSING');
 const entryAssets=[];for(const path of [...new Set(paths)]){const bytes=await readFile(join(directory,path.slice(1)));if(!bytes.equals(await fetchBytes(path)))throw Error('REPLAY_PRODUCTION_ASSET_MISMATCH');entryAssets.push({path,sha256:sha(bytes)});}
 const invocationId=process.env.LAB_BROWSER_INVOCATION??null;
 if(invocationId){const evidence=process.env.LAB_B07B_EVIDENCE;if(!evidence)throw Error('REPLAY_PRODUCTION_INVOCATION_MISSING');const invocation=JSON.parse(await readFile(join(evidence,'browser-invocation.json'),'utf8'));if(invocation.invocationId!==invocationId||invocation.before?.sourceCommit!==current.sourceCommit||invocation.before?.runtimeArtifact!==current.artifactSha256)throw Error('REPLAY_PRODUCTION_INVOCATION_MISMATCH');
  for(const [path,bytes] of [['index.html',index],['source-runtime.lock.json',pin]] as const){const ref=invocation.before.files?.find((file:{path:string})=>file.path===path);if(ref?.sha256!==sha(bytes)||ref?.bytes!==bytes.length)throw Error('REPLAY_PRODUCTION_INVOCATION_BUILD_MISMATCH');}}
 return {url:origin.href,indexSha256:sha(index),pinSha256:sha(pin),entryAssets,invocationId};
}
async function closePreview(server:PreviewServer){if('closeAllConnections' in server.httpServer)server.httpServer.closeAllConnections();await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(Error('REPLAY_PREVIEW_CLOSE_TIMEOUT')),5000);server.httpServer.close(error=>{clearTimeout(timer);if(error)reject(error);else done();});});}
export const test=base.extend<{replayPreviewEvidence:void},ReplayPreviewOptions&{replayPreview:PreviewBinding}>({
 replayPreviewMode:['owned',{option:true,scope:'worker'}],
 replayPreview:[async({replayPreviewMode},use,info)=>{
  if(replayPreviewMode==='external'){
   // B07 already owns the production preview and full build/invocation binding. Never replace or close it.
   const url=info.project.use.baseURL;if(!url)throw Error('REPLAY_EXTERNAL_PREVIEW_REQUIRED');const directory=resolve('dist');await use({mode:'external',directory,...await servedBuild(url,directory)});return;
  }
  const root=resolve('.'),owned=await mkdtemp(join(tmpdir(),'mekoniq-replay-preview-')),directory=join(owned,'dist');let server:PreviewServer|undefined;
  try{
   await build({root,configFile:join(root,'vite.config.ts'),logLevel:'error',build:{outDir:directory,emptyOutDir:false}});
   server=await preview({root,configFile:join(root,'vite.config.ts'),logLevel:'error',build:{outDir:directory},preview:{host:'127.0.0.1',port:0,strictPort:true}});
   const address=server.httpServer.address();if(!address||typeof address==='string')throw Error('REPLAY_PREVIEW_ADDRESS_MISSING');await use({mode:'owned',directory,...await servedBuild(`http://127.0.0.1:${address.port}/`,directory)});
  }finally{try{if(server)await closePreview(server);}finally{await rm(owned,{recursive:true,force:true});}}
 },{scope:'worker'}],
 baseURL:async({replayPreview},use)=>{await use(replayPreview.url);},
 replayPreviewEvidence:[async({replayPreview},use,info)=>{await info.attach('replay-production-preview',{body:Buffer.from(JSON.stringify(replayPreview,null,2)),contentType:'application/json'});await use();},{auto:true}],
});
export {expect} from '@playwright/test';
