import {openReplayPackage,parseReplayManifest,REPLAY_LIMITS,type ReplayAsset,type ReplayReader,type ReplayReadAsset} from './replay-package';
export function catalogueRoot(id:string):string{if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw Error('REPLAY_CATALOGUE_ID');return `/replays/${id}/`;}
/** The caller owns only this response. Cancellation always cancels and releases its reader. No retry loop on capacity refusal. */
export async function* streamResponse(response:Response,options:{signal:AbortSignal;maxBytes:number}):AsyncGenerator<Uint8Array>{
 if(!response.ok){let code=`HTTP_${response.status}`;const r=response.body?.getReader();if(r){let text='',bytes=0;const cancel=()=>{void r.cancel().catch(()=>{});};options.signal.addEventListener('abort',cancel,{once:true});try{while(true){if(options.signal.aborted)break;const {done,value}=await r.read();if(done)break;if((bytes+=value.length)>4096)break;text+=new TextDecoder().decode(value);}if(bytes<=4096){const body=JSON.parse(text);code=typeof body.error==='string'?body.error:typeof body.code==='string'?body.code:code;}}catch{/* capacity/refusal is never retried */}finally{options.signal.removeEventListener('abort',cancel);await r.cancel().catch(()=>{});r.releaseLock();}}throw Error(String(code));}
 const reader=response.body?.getReader();if(!reader)throw Error('REPLAY_BODY_UNAVAILABLE');let bytes=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};options.signal.addEventListener('abort',abort,{once:true});
 try{while(true){if(options.signal.aborted)throw Error('REPLAY_ABORTED');const {done,value}=await reader.read();if(options.signal.aborted)throw Error('REPLAY_ABORTED');if(done)break;bytes+=value.byteLength;if(bytes>options.maxBytes)throw Error('REPLAY_ASSET_SIZE_LIMIT');yield value;}}
 finally{options.signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function boundedBytes(response:Response,maxBytes:number,signal:AbortSignal){const chunks:Uint8Array[]= [];let n=0;for await(const c of streamResponse(response,{maxBytes,signal})){chunks.push(c);n+=c.length;}const all=new Uint8Array(n);let i=0;for(const c of chunks){all.set(c,i);i+=c.length;}return all;}
export async function openCatalogueReplay(id:string,signal:AbortSignal):Promise<ReplayReader>{
 const root=catalogueRoot(id),manifest=await boundedBytes(await fetch(root+'manifest.json',{signal}),REPLAY_LIMITS.manifestBytes,signal);
 return openReplayPackage(manifest,async function*(asset,opts){yield* streamResponse(await fetch(root+asset.path+(asset.encoding==='gzip'?'.bin':''),{signal:opts.signal}),opts);},{signal});
}
export function fileReplayTransport(files:File[]):{manifest:File;readAsset:ReplayReadAsset}{
 if(files.length>1024)throw Error('REPLAY_FILE_COUNT');const byPath=new Map<string,File>();let size=0;
 for(const f of files){const stored=f.webkitRelativePath?f.webkitRelativePath.split('/').slice(1).join('/'):f.name,path=stored.endsWith('.bin')?stored.slice(0,-4):stored;if(byPath.has(path))throw Error('REPLAY_DUPLICATE_FILE');byPath.set(path,f);size+=f.size;if(size>REPLAY_LIMITS.packageBytes)throw Error('REPLAY_PACKAGE_LIMIT');}
 const manifest=byPath.get('manifest.json');if(!manifest||manifest.size>REPLAY_LIMITS.manifestBytes)throw Error('REPLAY_MANIFEST_LIMIT');
 return {manifest,readAsset:async function*(asset,opts){const file=byPath.get(asset.path);if(!file||file.size!==asset.bytes)throw Error('REPLAY_ASSET_SIZE');yield* streamResponse(new Response(file.stream()),opts);}};
}
export async function openFileReplay(files:File[],signal:AbortSignal){const t=fileReplayTransport(files);return openReplayPackage(new Uint8Array(await t.manifest.arrayBuffer()),t.readAsset,{signal});}
/** Reads one owner's immutable export version, using numeric admitted asset indexes only. */
export async function openLiveReplay(base:string,manifest:Uint8Array,init:RequestInit,signal:AbortSignal){
 const parsed=parseReplayManifest(manifest);
 return openReplayPackage(manifest,async function*(asset:Readonly<ReplayAsset>,opts){const index=parsed.assets.findIndex(a=>a.path===asset.path);if(index<0)throw Error('REPLAY_ASSET_NOT_ADMITTED');yield* streamResponse(await fetch(`${base}/assets/${index}`,{...init,signal:opts.signal}),opts);},{signal});
}
