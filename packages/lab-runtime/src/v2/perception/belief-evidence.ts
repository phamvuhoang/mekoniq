// R4-B §7: the durable belief, attempts and recovery streams of one run. Same rules as the physics stream: an append is fsynced to a WAL before the runner may go on, only immutable hashed
// chunks are evidence, a quota that is hit ends the recording with a reason (never a silent cut), and an unpublished tail or a hash that does not match is a coverage failure.
import {createHash,randomBytes} from 'node:crypto';
import {lstat,mkdir,open,readFile,readdir,realpath,unlink} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {BeliefEvidenceManifestV1,BeliefRecord,GraspAttempt,RecoveryStep} from '../../../../contracts/generated/navigation2d';
import {READ_LIMITS,writeDurable} from '../navigation2d/evidence';
import {hashJson} from '../hash';
import {validateBeliefManifestShape,validateBeliefRecordShape,validateGraspAttemptShape,validateRecoveryStepShape} from './perception-contracts';
export type {BeliefRecord,GraspAttempt,RecoveryStep};
type Stream='belief'|'attempts'|'recovery';
type Identity=BeliefEvidenceManifestV1['identity'];
const MANIFEST='manifest.json',WAL='pending.ndjson',NAME=/^(belief|attempts|recovery)-\d{6}-[a-f0-9]{8}\.ndjson\.gz$/,STREAMS:Stream[]=['belief','attempts','recovery'],MiB=1024*1024;
/** Spec: 8 MiB compressed, the three streams together. */
export const BELIEF_EVIDENCE_MAX_BYTES=8*MiB;
const CHUNK_LINES=500,TERMINAL_RESERVE=4096;
const shape:Record<Stream,(v:unknown)=>boolean>={belief:v=>validateBeliefRecordShape(v) as boolean,attempts:v=>validateGraspAttemptShape(v) as boolean,recovery:v=>validateRecoveryStepShape(v) as boolean};
const tickOf=(s:Stream,r:unknown)=>s==='belief'?(r as BeliefRecord).tick:s==='attempts'?((r as GraspAttempt).recordedTick??(r as GraspAttempt).decidedTick):(r as RecoveryStep).recordedTick;
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function dirBytes(dir:string){let n=0;for(const name of await readdir(dir)){const st=await lstat(join(dir,name));if(!st.isFile())throw new Error('BELIEF_PATH_REJECTED');n+=st.size;}return n;}
async function readBounded(root:string,name:string,max:number){
 const file=join(root,name),st=await lstat(file);if(!st.isFile()||st.size>max)throw new Error('BELIEF_READ_LIMIT_OR_PATH');
 if(!(await realpath(file)).startsWith((await realpath(root))+sep))throw new Error('BELIEF_PATH_REJECTED');
 return readFile(file);
}
export async function readBeliefManifest(root:string):Promise<BeliefEvidenceManifestV1>{
 const m:unknown=JSON.parse((await readBounded(root,MANIFEST,READ_LIMITS.manifestBytes)).toString());if(!validateBeliefManifestShape(m))throw new Error('BELIEF_MANIFEST_INVALID');return m as BeliefEvidenceManifestV1;
}
export interface BeliefRecorder {appendBelief(r:BeliefRecord):Promise<void>;appendAttempt(a:GraspAttempt):Promise<void>;appendRecovery(s:RecoveryStep):Promise<void>;finish(reason:string|null):Promise<void>;/** Publish what is buffered as chunks now (a hot read of a running recording). */checkpoint():Promise<void>;manifest():BeliefEvidenceManifestV1}
export async function openBeliefRecorder(o:{directory:string;identity:Identity;maxBytes?:number}):Promise<BeliefRecorder>{
 const maxBytes=o.maxBytes??BELIEF_EVIDENCE_MAX_BYTES;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>BELIEF_EVIDENCE_MAX_BYTES)throw new Error('BELIEF_LIMIT_INVALID');
 await mkdir(o.directory,{recursive:true,mode:0o700});
 let m:BeliefEvidenceManifestV1={schemaVersion:1,documentType:'belief-evidence',identity:structuredClone(o.identity),streams:STREAMS.map(stream=>({stream,chunks:[],records:0})),coverage:{lastTick:0,complete:false},gaps:[],terminalReason:null};
 let queue:Promise<void>=Promise.resolve(),closed=false;const serial=<T,>(fn:()=>Promise<T>)=>{const p=queue.then(fn);queue=p.then(()=>{},()=>{});return p;};
 const buffers:Record<Stream,string[]>={belief:[],attempts:[],recovery:[]};
 const save=()=>writeDurable(o.directory,MANIFEST,JSON.stringify(m));
 if((await readdir(o.directory)).length){
  const old=await readBeliefManifest(o.directory);if(hashJson(old.identity as never)!==hashJson(o.identity as never))throw new Error('BELIEF_IDENTITY_MISMATCH');
  m=old;m.coverage.complete=false;m.terminalReason??='BELIEF_RESTART';closed=true;await save();
 }else await save();
 const end=async(reason:string,gap?:{firstTick:number;lastTick:number})=>{if(gap)m.gaps.push({...gap,reason:reason.slice(0,200)});m.terminalReason??=reason.slice(0,200);m.coverage.complete=false;closed=true;await save().catch(()=>{});};
 const flush=async()=>{
  const next=structuredClone(m);let any=false;
  for(const stream of STREAMS){
   const lines=buffers[stream];if(!lines.length)continue;any=true;
   const bytes=gzipSync(lines.join('')),refs=next.streams.find(s=>s.stream===stream)!.chunks;
   if(refs.length>=512||bytes.length>READ_LIMITS.chunkBytes)throw new Error('BELIEF_READ_LIMIT');
   const sr=next.streams.find(s=>s.stream===stream)!;sr.records=(sr.records??0)+lines.length;
   const path=`${stream}-${String(refs.length).padStart(6,'0')}-${randomBytes(4).toString('hex')}.ndjson.gz`;
   if(await dirBytes(o.directory)+bytes.length+TERMINAL_RESERVE>maxBytes)throw new Error('BELIEF_QUOTA_EXCEEDED');
   await writeDurable(o.directory,path,bytes);refs.push({path,sha256:sha(bytes),bytes:bytes.length});
  }
  if(!any)return;
  m=next;await save();await writeDurable(o.directory,WAL,'');for(const s of STREAMS)buffers[s]=[];
 };
 const append=(stream:Stream,record:unknown)=>serial(async()=>{
  const tick=Number.isSafeInteger(tickOf(stream,record))?tickOf(stream,record):m.coverage.lastTick;
  if(closed||m.terminalReason)throw new Error('BELIEF_RECORDER_TERMINAL');
  try{
   if(!shape[stream](record))throw new Error('BELIEF_RECORD_INVALID');
   const line=JSON.stringify({stream,record})+'\n',n=Buffer.byteLength(line);if(n>READ_LIMITS.lineBytes)throw new Error('BELIEF_READ_LIMIT');
   if(await dirBytes(o.directory)+n+TERMINAL_RESERVE>maxBytes)throw new Error('BELIEF_QUOTA_EXCEEDED');
   const h=await open(join(o.directory,WAL),'a',0o600);try{await h.writeFile(line);await h.sync();}finally{await h.close();}
   const d=await open(o.directory,'r');try{await d.sync();}finally{await d.close();}
   buffers[stream].push(JSON.stringify(record)+'\n');m.coverage.lastTick=Math.max(m.coverage.lastTick,tick);
   if(buffers[stream].length>=CHUNK_LINES)await flush();
  }catch(e){await end((e as Error).message,{firstTick:tick,lastTick:tick});throw e;}
 });
 return {manifest:()=>structuredClone(m),checkpoint:()=>serial(async()=>{if(!closed&&!m.terminalReason)try{await flush();}catch(e){await end((e as Error).message);throw e;}}),appendBelief:r=>append('belief',r),appendAttempt:a=>append('attempts',a),appendRecovery:s=>append('recovery',s),
  finish:reason=>serial(async()=>{if(reason)await end(reason);try{await flush();if(!reason&&!m.terminalReason&&!m.gaps.length){m.coverage.complete=true;closed=true;}}catch(e){await end((e as Error).message);throw e;}await save();await unlink(join(o.directory,WAL)).catch(()=>{});})};
}
export interface BeliefRead {complete:boolean;beliefs:BeliefRecord[];attempts:GraspAttempt[];recovery:RecoveryStep[];issues:string[]}
export async function readBeliefEvidence(root:string,manifest:unknown,options?:{/** what the run that is being read is: every field given must match the manifest */identity?:Partial<Identity>}):Promise<BeliefRead>{
 const out:BeliefRead={complete:false,beliefs:[],attempts:[],recovery:[],issues:[]},issue=(s:string)=>{if(!out.issues.includes(s))out.issues.push(s);};
 if(!validateBeliefManifestShape(manifest)||Buffer.byteLength(JSON.stringify(manifest))>READ_LIMITS.manifestBytes){issue('BELIEF_MANIFEST_INVALID');return out;}
 const m=manifest as BeliefEvidenceManifestV1;
 if(options?.identity&&(Object.keys(options.identity) as (keyof Identity)[]).some(k=>hashJson((options.identity![k]??null) as never)!==hashJson((m.identity[k]??null) as never)))issue('BELIEF_IDENTITY_MISMATCH');
 if(!m.coverage.complete||m.gaps.length||m.terminalReason)issue('BELIEF_COVERAGE_INCOMPLETE');
 try{
  if(await dirBytes(root)>BELIEF_EVIDENCE_MAX_BYTES)throw new Error('BELIEF_QUOTA_EXCEEDED');
  if((await lstat(join(root,WAL)).catch(()=>null))?.size)issue('BELIEF_UNPUBLISHED_TAIL');
 }catch(e){issue((e as Error).message);return out;}
 const seen=new Set<string>();let inflated=0;
 for(const {stream,chunks,records} of m.streams){
  let lines=0;
  chunks.forEach((ref,i)=>{if(Number(ref.path.slice(stream.length+1,stream.length+7))!==i)issue('BELIEF_CHUNK_SEQUENCE');});
  for(const ref of chunks){
   try{
    if(!NAME.test(ref.path)||!ref.path.startsWith(stream+'-')||seen.has(ref.path))throw new Error('BELIEF_PATH_REJECTED');seen.add(ref.path);
    const b=await readBounded(root,ref.path,READ_LIMITS.chunkBytes);if(b.length!==ref.bytes||sha(b)!==ref.sha256)throw new Error('BELIEF_HASH_MISMATCH');
    const body=gunzipSync(b,{maxOutputLength:Math.min(READ_LIMITS.chunkInflated,READ_LIMITS.totalInflated-inflated)});inflated+=body.length;
    const text=body.toString('utf8');if(!text.endsWith('\n'))throw new Error('BELIEF_TRUNCATED');
    for(const line of text.slice(0,-1).split('\n')){
     if(Buffer.byteLength(line)>READ_LIMITS.lineBytes)throw new Error('BELIEF_READ_LIMIT');
     const r:unknown=JSON.parse(line);if(!shape[stream as Stream](r))throw new Error('BELIEF_RECORD_INVALID');
     (stream==='belief'?out.beliefs:stream==='attempts'?out.attempts:out.recovery).push(r as never);lines++;
    }
   }catch(e){issue((e as Error).message);}
  }
  // the manifest's own word is not coverage: how many records there must be, against what was read
  if(records===undefined)issue('BELIEF_COVERAGE_UNVERIFIABLE');else if(records!==lines)issue('BELIEF_RECORD_COUNT_MISMATCH');
 }
 // an attempt that used a belief: it is on the belief stream (object, observed and published tick)
 const known=new Set(out.beliefs.flatMap(b=>b.belief?[`${b.belief.objectId}|${b.belief.observedTick}|${b.belief.publishedTick}`]:[]));
 if(out.attempts.some(a=>a.beliefUsed&&!known.has(`${a.beliefUsed.objectId}|${a.beliefUsed.observedTick}|${a.beliefUsed.publishedTick}`)))issue('BELIEF_ATTEMPT_REFERENCE_MISSING');
 out.complete=!out.issues.length;return out;
}
