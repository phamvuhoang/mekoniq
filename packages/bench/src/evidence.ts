// Bench evidence I/O (K05; contracts §2.4, §2.5): one case trace as gzip NDJSON chunks named `<stream>-NNNNNN-<8hex>.ndjson.gz` (the first 8 hex of the chunk's
// SHA-256) plus `case.json`, and the `{hashAlgorithm, files}` manifest of a directory. Durable writes and the reader caps are lab-runtime's (K01 decision: reuse).
// Readers refuse instead of repairing: a chunk whose size, hash, gzip or lines are off is an error, never a shorter trace. Readers treat the directory as hostile:
// they open only regular files (lstat on the walk, O_NOFOLLOW|O_NONBLOCK and fstat on open), never follow a symlink, check the size before reading, and throw
// errors whose `code` is an Issue code (FILE_MISSING, SIZE_MISMATCH, RECORD_SCHEMA_INVALID, EVIDENCE_CHUNK_INVALID) for the record reader to report.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {READ_LIMITS,writeDurable} from '../../lab-runtime/src/v2/navigation2d/evidence';
import type {CaseTrace} from './cases/types';

export type FileRef={path:string;sha256:string;bytes:number};
export type Issue={code:string;path:string};
export const sha256=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
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
/** A regular file only (a symlink fails to open, a FIFO or device is refused after fstat) of at most `cap` bytes, checked before reading. */
export async function readRegular(path:string,cap:number=READ_LIMITS.chunkBytes):Promise<Buffer>{
 let h;
 try{h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(e){throw refused((e as {code?:string}).code==='ENOENT'?'FILE_MISSING':'RECORD_SCHEMA_INVALID',path);}
 try{
  const st=await h.stat();
  if(!st.isFile())throw refused('RECORD_SCHEMA_INVALID',path);
  if(st.size>cap)throw refused('SIZE_MISMATCH',path);
  return await h.readFile();
 }finally{await h.close();}
}
/** A JSON document (at most READ_LIMITS.manifestBytes); a parse error is RECORD_SCHEMA_INVALID. */
export async function readJsonFile(path:string):Promise<unknown>{
 const b=await readRegular(path,READ_LIMITS.manifestBytes);
 try{return JSON.parse(b.toString('utf8'));}catch{throw refused('RECORD_SCHEMA_INVALID',path);}
}
const isRef=(r:unknown):r is FileRef=>!!r&&typeof r==='object'&&!Array.isArray(r)&&typeof (r as FileRef).path==='string'&&(r as FileRef).path.length>0&&(r as FileRef).path.length<=512
 &&typeof (r as FileRef).sha256==='string'&&/^[0-9a-f]{64}$/.test((r as FileRef).sha256)&&Number.isSafeInteger((r as FileRef).bytes)&&(r as FileRef).bytes>=0;
const refList=(x:unknown,max:number):x is FileRef[]=>Array.isArray(x)&&x.length<=max&&x.every(isRef);
/** `dir/manifest.json` as {files}; throws FILE_MISSING, SIZE_MISMATCH or RECORD_SCHEMA_INVALID (not an object, files not a list of well-formed refs). */
export async function readManifest(dir:string):Promise<FileRef[]>{
 const m=await readJsonFile(join(dir,'manifest.json')) as {files?:unknown}|null;
 if(!m||typeof m!=='object'||!refList(m.files,READ_LIMITS.chunksPerStream*64))throw refused('RECORD_SCHEMA_INVALID',join(dir,'manifest.json'));
 return m.files;
}

/** The rows of the chunks `refs` lists, each chunk checked (name, size, hash, caps) before it is inflated; `budget.left` caps the inflated bytes of a whole trace. */
export async function readStream(dir:string,refs:readonly FileRef[],budget={left:READ_LIMITS.totalInflated}):Promise<unknown[]>{
 const rows:unknown[]=[];
 for(const r of refs){
  if(!/^(ticks|cycles)-\d{6}-[0-9a-f]{8}\.ndjson\.gz$/.test(r.path))throw refused('RECORD_SCHEMA_INVALID',r.path);
  const b=await readRegular(join(dir,r.path),READ_LIMITS.chunkBytes);
  if(b.length!==r.bytes||sha256(b)!==r.sha256)throw refused('EVIDENCE_CHUNK_INVALID',r.path);
  let text:string;
  try{text=gunzipSync(b,{maxOutputLength:Math.max(1,Math.min(READ_LIMITS.chunkInflated,budget.left))}).toString('utf8');}
  catch(e){throw refused((e as {code?:string}).code==='ERR_BUFFER_TOO_LARGE'?'SIZE_MISMATCH':'EVIDENCE_CHUNK_INVALID',r.path);}
  budget.left-=text.length;
  const lines=text.split('\n');
  if(lines.pop()!==''||lines.length>READ_LIMITS.linesPerChunk||lines.some(l=>l.length>READ_LIMITS.lineBytes))throw refused('EVIDENCE_CHUNK_INVALID',r.path);
  try{for(const l of lines)rows.push(JSON.parse(l));}catch{throw refused('EVIDENCE_CHUNK_INVALID',r.path);}
 }
 return rows;
}

/** One case: ticks and cycles as chunks, everything else of the trace in case.json next to their refs. `dir` exists and is empty. */
export async function writeTrace(dir:string,trace:CaseTrace):Promise<void>{
 const {ticks,cycles,...rest}=trace;
 await writeDurable(dir,'case.json',JSON.stringify({...rest,ticks:await writeStream(dir,'ticks',ticks),cycles:await writeStream(dir,'cycles',cycles)},null,1));
}
export async function readTrace(dir:string):Promise<CaseTrace>{
 const c=await readJsonFile(join(dir,'case.json')) as Omit<CaseTrace,'ticks'|'cycles'>&{ticks:unknown;cycles:unknown};
 if(!c||typeof c!=='object'||Array.isArray(c)||!refList(c.ticks,READ_LIMITS.chunksPerStream)||!refList(c.cycles,READ_LIMITS.chunksPerStream)||!Array.isArray(c.prompts))throw refused('RECORD_SCHEMA_INVALID',join(dir,'case.json'));
 const {ticks,cycles,...rest}=c,budget={left:READ_LIMITS.totalInflated};
 return {...rest,ticks:await readStream(dir,ticks,budget) as CaseTrace['ticks'],cycles:await readStream(dir,cycles,budget) as CaseTrace['cycles']};
}

/** Walks `dir` without following links: regular files with their lstat size, and every other entry (symlink, FIFO, device, socket) as `others`.
 * Paths are '/'-separated, sorted, relative to `dir`; the root manifest.json is left out. */
export async function walk(dir:string):Promise<{files:Map<string,number>;others:string[]}>{
 const files=new Map<string,number>(),others:string[]=[];
 const visit=async(rel:string)=>{
  for(const e of await readdir(join(dir,rel),{withFileTypes:true})){
   const p=rel?`${rel}/${e.name}`:e.name;
   if(e.isDirectory())await visit(p);
   else if(e.isFile())files.set(p,(await lstat(join(dir,p))).size);
   else others.push(p);
  }
 };
 await visit('');files.delete('manifest.json');
 return {files:new Map([...files].sort(([a],[b])=>a<b?-1:a>b?1:0)),others:others.sort()};
}
export async function listFiles(dir:string):Promise<string[]>{return [...(await walk(dir)).files.keys()];}
const refOf=async(dir:string,path:string):Promise<FileRef>=>{const b=await readRegular(join(dir,path));return {path,sha256:sha256(b),bytes:b.length};};
export async function fileRefs(dir:string,paths?:string[]):Promise<FileRef[]>{return Promise.all((paths??await listFiles(dir)).map(p=>refOf(dir,p)));}
/** Writes `dir/manifest.json` for every other regular file under `dir`; returns its files. */
export async function writeManifest(dir:string):Promise<FileRef[]>{
 const files=await fileRefs(dir);
 await writeDurable(dir,'manifest.json',JSON.stringify({hashAlgorithm:'sha256',files},null,1));
 return files;
}
/** `files` against the directory: listed but absent, wrong size or over the per-file cap (never read), wrong hash, present but not listed, not a regular file.
 * Only regular files the walk found are ever opened. */
export async function checkManifest(dir:string,files:readonly FileRef[]):Promise<Issue[]>{
 const out:Issue[]=[],{files:actual,others}=await walk(dir),listed=new Set<string>();
 for(const f of files){
  listed.add(f.path);
  const size=actual.get(f.path);
  if(size===undefined){if(!others.includes(f.path))out.push({code:'FILE_MISSING',path:f.path});continue;}
  if(size!==f.bytes||size>READ_LIMITS.chunkBytes){out.push({code:'SIZE_MISMATCH',path:f.path});continue;}
  try{if((await refOf(dir,f.path)).sha256!==f.sha256)out.push({code:'CHECKSUM_MISMATCH',path:f.path});}
  catch(e){out.push({code:(e as {code?:string}).code??'RECORD_SCHEMA_INVALID',path:f.path});}   // replaced between walk and open
 }
 for(const p of actual.keys())if(!listed.has(p))out.push({code:'FILE_UNEXPECTED',path:p});
 for(const p of others)out.push({code:'FILE_UNEXPECTED',path:p});
 return out;
}
