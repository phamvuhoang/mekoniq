// Bench evidence I/O (K05; contracts §2.4, §2.5): one case trace as gzip NDJSON chunks named `<stream>-NNNNNN-<8hex>.ndjson.gz` (the first 8 hex of the chunk's
// SHA-256) plus `case.json`, and the `{hashAlgorithm, files}` manifest of a directory. Durable writes and the reader caps are lab-runtime's (K01 decision: reuse).
// Readers refuse instead of repairing: a chunk whose size, hash, gzip or lines are off is an error, never a shorter trace.
import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {READ_LIMITS,writeDurable} from '../../lab-runtime/src/v2/navigation2d/evidence';
import type {CaseTrace} from './cases/types';

export type FileRef={path:string;sha256:string;bytes:number};
export type Issue={code:string;path:string};
const sha256=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const refused=(code:string,detail:string)=>Object.assign(new Error(`${code}: ${detail}`),{code});
/** Chunks close at half the reader's caps, so the writer's own output always reads back (as navigation2d's WRITE_CHUNK). */
const CHUNK={lines:READ_LIMITS.linesPerChunk/2,inflated:12*1024*1024};

/** The rows of one stream, in order, as chunks in `dir`; returns their refs in order. */
export async function writeStream(dir:string,stream:'ticks'|'cycles',rows:readonly unknown[]):Promise<FileRef[]>{
 const refs:FileRef[]=[];let lines:string[]=[],size=0;
 const publish=async()=>{
  if(!lines.length)return;
  const bytes=gzipSync(lines.join('')),h=sha256(bytes),path=`${stream}-${String(refs.length).padStart(6,'0')}-${h.slice(0,8)}.ndjson.gz`;
  if(refs.length>=READ_LIMITS.chunksPerStream||bytes.length>READ_LIMITS.chunkBytes)throw refused('EVIDENCE_READ_LIMIT',path);
  await writeDurable(dir,path,bytes);refs.push({path,sha256:h,bytes:bytes.length});lines=[];size=0;
 };
 for(const r of rows){
  const line=JSON.stringify(r)+'\n',b=Buffer.byteLength(line);
  if(b>READ_LIMITS.lineBytes)throw refused('EVIDENCE_READ_LIMIT',`a ${stream} row of ${b} bytes`);
  if(lines.length>=CHUNK.lines||size+b>CHUNK.inflated)await publish();
  lines.push(line);size+=b;
 }
 await publish();
 return refs;
}
/** The rows of the chunks `refs` lists, each chunk checked (name, size, hash, caps) before it is inflated. */
export async function readStream(dir:string,refs:readonly FileRef[]):Promise<unknown[]>{
 if(!Array.isArray(refs)||refs.length>READ_LIMITS.chunksPerStream)throw refused('EVIDENCE_LISTING_INVALID',dir);
 const rows:unknown[]=[];
 for(const r of refs){
  if(typeof r?.path!=='string'||!/^(ticks|cycles)-\d{6}-[0-9a-f]{8}\.ndjson\.gz$/.test(r.path))throw refused('EVIDENCE_LISTING_INVALID',String(r?.path));
  const b=await readFile(join(dir,r.path));
  if(b.length!==r.bytes||b.length>READ_LIMITS.chunkBytes||sha256(b)!==r.sha256)throw refused('EVIDENCE_CHUNK_INVALID',r.path);
  const lines=gunzipSync(b,{maxOutputLength:READ_LIMITS.chunkInflated}).toString('utf8').split('\n');
  if(lines.pop()!==''||lines.length>READ_LIMITS.linesPerChunk||lines.some(l=>l.length>READ_LIMITS.lineBytes))throw refused('EVIDENCE_CHUNK_INVALID',r.path);
  for(const l of lines)rows.push(JSON.parse(l));
 }
 return rows;
}

/** One case: ticks and cycles as chunks, everything else of the trace in case.json next to their refs. `dir` exists and is empty. */
export async function writeTrace(dir:string,trace:CaseTrace):Promise<void>{
 const {ticks,cycles,...rest}=trace;
 await writeDurable(dir,'case.json',JSON.stringify({...rest,ticks:await writeStream(dir,'ticks',ticks),cycles:await writeStream(dir,'cycles',cycles)},null,1));
}
export async function readTrace(dir:string):Promise<CaseTrace>{
 const raw=await readFile(join(dir,'case.json'),'utf8');
 if(raw.length>READ_LIMITS.manifestBytes)throw refused('EVIDENCE_READ_LIMIT','case.json');
 const {ticks,cycles,...rest}=JSON.parse(raw) as Omit<CaseTrace,'ticks'|'cycles'>&{ticks:FileRef[];cycles:FileRef[]};
 return {...rest,ticks:await readStream(dir,ticks) as CaseTrace['ticks'],cycles:await readStream(dir,cycles) as CaseTrace['cycles']};
}

/** Every file under `dir` (anything that is not a directory, symlinks included), as sorted '/'-separated paths, without the root manifest.json. */
export async function listFiles(dir:string):Promise<string[]>{
 const all=await readdir(dir,{recursive:true,withFileTypes:true});
 return all.filter(e=>!e.isDirectory()).map(e=>relative(dir,join(e.parentPath,e.name)).split(sep).join('/')).filter(p=>p!=='manifest.json').sort();
}
const refOf=async(dir:string,path:string):Promise<FileRef>=>{const b=await readFile(join(dir,path));return {path,sha256:sha256(b),bytes:b.length};};
export async function fileRefs(dir:string,paths?:string[]):Promise<FileRef[]>{return Promise.all((paths??await listFiles(dir)).map(p=>refOf(dir,p)));}
/** Writes `dir/manifest.json` for every other file under `dir`; returns its files. */
export async function writeManifest(dir:string):Promise<FileRef[]>{
 const files=await fileRefs(dir);
 await writeDurable(dir,'manifest.json',JSON.stringify({hashAlgorithm:'sha256',files},null,1));
 return files;
}
/** `files` against the directory: listed but absent, wrong size, wrong hash, present but not listed. Only paths that exist under `dir` are ever opened. */
export async function checkManifest(dir:string,files:readonly FileRef[]):Promise<Issue[]>{
 const out:Issue[]=[],actual=new Set(await listFiles(dir)),listed=new Set<string>();
 for(const f of files){
  listed.add(f.path);
  if(!actual.has(f.path)){out.push({code:'FILE_MISSING',path:f.path});continue;}
  const r=await refOf(dir,f.path);
  if(r.bytes!==f.bytes)out.push({code:'SIZE_MISMATCH',path:f.path});else if(r.sha256!==f.sha256)out.push({code:'CHECKSUM_MISMATCH',path:f.path});
 }
 for(const p of actual)if(!listed.has(p))out.push({code:'FILE_UNEXPECTED',path:p});
 return out;
}
