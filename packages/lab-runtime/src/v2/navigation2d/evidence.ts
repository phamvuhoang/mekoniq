// Durable navigation evidence (workers-runtime §5). The plant record of one run, kept apart from the lossy TelemetryRecorder ring and from the business journal:
// per-tick pose/velocity/collision, the control ledger (what the source sent, at which observation tick), LiDAR publications at the sensor cadence, and the engine
// contact records. NDJSON lines, gzip chunks over tick ranges, SHA-256 of the stored bytes and an ordered manifest written atomically after the chunk is on disk.
// Readers verify every chunk (bytes, hash, gzip, line ticks, order, coverage) and report what is missing; nothing is repaired, adopted or guessed.
import {createHash,randomBytes} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {link,lstat,mkdir,open,readdir,readFile,realpath,rename,unlink} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {arch,platform,release} from 'node:os';
import {assessTrajectory,type Contact,type ContactSource,type TrajectoryAssessment} from './oracle';
import {baseInMap,yawOf} from '../../engineering/navigation-model';
import {framePose} from '../../engineering/inertia';
import {quaternionFromYaw} from '../frames';
import {hashJson} from '../hash';
import type {IRSimSnapshotV1,LidarScanV1,NavigationRunEvidenceV1,NavigationSceneV1} from './contracts';

export type EvidenceStream='trajectory'|'sensors'|'control'|'collisions';
export const STREAMS:readonly EvidenceStream[]=['trajectory','sensors','control','collisions'];
/** workers-runtime §2: 100 MiB stored per run, 30,000 ticks (10 min simulated). Exceeding either ends the recording incomplete with a reason. */
export const EVIDENCE_LIMITS={maxBytes:100*1024*1024,maxTicks:30000};
export const EVIDENCE_FORMAT='navigation-evidence-ndjson-gzip-v1',DIGEST_ALGORITHM='navigation-evidence-digest-v1';
/** Everything the normalized digests leave out, and nothing else: the digests hash the record lines themselves, so chunking and file names never matter. */
export const NORMALIZED_OMITS=['runId','worker bootId','artifacts.*.path (random chunk names)','chunk boundaries (artifacts.*.sha256/bytes/firstTick/lastTick)','wall-clock time (never recorded in chunks)'];
const CHUNK_NAME=/^(trajectory|sensors|control|collisions)-\d{6}-[0-9a-f]{8}\.ndjson\.gz$/,MANIFEST='manifest.json',LOCK='writer.lock',MiB=1024*1024;
/** Reader caps for untrusted evidence (an import is as untrusted as a tampered disk): stored and inflated bytes per chunk and in total (inflated: 4x the stored quota),
 * bytes per record line, lines per chunk, chunks per stream, manifest size and recorded gaps. Past a cap the chunk is refused with EVIDENCE_READ_LIMIT, never read on. */
export const READ_LIMITS={chunkBytes:16*MiB,chunkInflated:64*MiB,totalInflated:4*EVIDENCE_LIMITS.maxBytes,lineBytes:256*1024,linesPerChunk:65536,chunksPerStream:2000,manifestBytes:8*MiB,gaps:10000};
/** The writer splits a flush into chunks at tick boundaries within half the reader's caps (12 MiB inflated keeps the stored size under its 16 MiB cap too), so its own
 * output always reads back; what still would not (one tick above a cap, too many chunks or gaps, the total inflate cap) ends the recording with EVIDENCE_READ_LIMIT. */
const WRITE_CHUNK={inflated:12*MiB,lines:READ_LIMITS.linesPerChunk/2};

export interface ChunkRef{path:string;sha256:string;bytes:number;firstTick:number;lastTick:number}
export type Chunks=Record<EvidenceStream,ChunkRef[]>;
export interface Gap{fromTick:number;toTick:number;reason:string}
export interface StepPayload{targetTick:number;velocities:{robotId:string;vMps:number;omegaRadps:number}[];actorUpdates:unknown[];singleStep?:boolean}
/** Observed plant state at `tick` (drive frame, as the engine reports it). */
export interface TrajectoryRecord{tick:number;simTimeNs:string;robots:{robotId:string;poseDriveMap:[number,number,number];bodyVelocity:[number,number];collisionIds:string[]}[]}
/** The velocities the source sent: computed from the observation of `tick`, applied by the step to `targetTick`. Never reconstructed from the trajectory. */
export interface ControlRecord{tick:number;targetTick:number;singleStep:boolean;velocities:StepPayload['velocities'];actorUpdates:unknown[]}
export interface SensorRecord{tick:number;robotId:string;scan:LidarScanV1}
export interface CollisionRecord{tick:number;robotId:string;collisionIds:string[]}
/** The recorder's committed listing: chunks, the gaps it recorded, the terminal reason (null: not ended early) and the last durable tick. */
export interface Committed{chunks:Chunks;gaps:Gap[];terminal:string|null;lastTick:number|null;bytes:number}
/** A listing to read: the recorder's committed one, or an imported document's `{chunks:artifacts,...recording}`; `runTick` is the run's logical tick when it was exported. */
export interface Listing{chunks:Chunks;gaps?:Gap[];terminal?:string|null;lastTick?:number|null;runTick?:number|null}
interface Manifest{schemaVersion:1;format:typeof EVIDENCE_FORMAT;runId:string;sceneDigest:string;chunks:Chunks;gaps:Gap[];terminal:string|null;lastTick:number|null;lastKey:string|null;bytes:number;inflated:number;boots:{bootId:string;firstTick:number}[]}

const sha256=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const nat=(x:unknown):x is number=>Number.isSafeInteger(x)&&(x as number)>=0,finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const text=(x:unknown,max=200):x is string=>typeof x==='string'&&x.length>0&&x.length<=max;
const obj=(x:unknown,keys:readonly string[]):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const isGap=(g:unknown)=>obj(g,['fromTick','toTick','reason'])&&nat(g.fromTick)&&nat(g.toTick)&&g.toTick>=g.fromTick&&text(g.reason,500);
const isRef=(r:unknown)=>obj(r,['path','sha256','bytes','firstTick','lastTick'])&&text(r.path,512)&&typeof r.sha256==='string'&&/^[0-9a-f]{64}$/.test(r.sha256)&&nat(r.bytes)&&nat(r.firstTick)&&nat(r.lastTick)&&r.lastTick>=r.firstTick;
/** What a listing (the manifest, or an imported evidence document's artifacts + recording) must look like before any chunk is opened; null when it does. */
function listingProblem(l:{chunks?:unknown;gaps?:unknown;terminal?:unknown;lastTick?:unknown;runTick?:unknown}):string|null{
 const c=l.chunks;
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!(STREAMS as readonly string[]).includes(k)))return 'chunks must list only the four streams';
 for(const s of STREAMS){const list=(c as Record<string,unknown>)[s];if(list===undefined)continue;if(!Array.isArray(list)||list.length>READ_LIMITS.chunksPerStream||!list.every(isRef))return `${s}: at most ${READ_LIMITS.chunksPerStream} well-formed chunk refs`;}
 if(l.gaps!==undefined&&(!Array.isArray(l.gaps)||l.gaps.length>READ_LIMITS.gaps||!l.gaps.every(isGap)))return 'gaps must be well-formed tick ranges';
 if(l.terminal!==undefined&&l.terminal!==null&&!text(l.terminal,500))return 'terminal must be a reason or null';
 if(l.lastTick!==undefined&&l.lastTick!==null&&!nat(l.lastTick))return 'lastTick must be a tick or null';
 if(l.runTick!==undefined&&l.runTick!==null&&!nat(l.runTick))return 'runTick must be a tick or null';
 return null;
}
const empty=():Chunks=>({trajectory:[],sensors:[],control:[],collisions:[]});
async function syncDir(dir:string){const h=await open(dir,'r');try{await h.sync();}finally{await h.close();}}
/** tmp file, fsync, rename, fsync the directory: after this returns the bytes survive a crash under `name`. */
async function writeDurable(dir:string,name:string,bytes:Uint8Array|string){
 const tmp=join(dir,`.${name}.tmp`),h=await open(tmp,'w',0o600);
 try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
 await rename(tmp,join(dir,name));await syncDir(dir);
}

export interface RecorderOptions{directory:string;scene:NavigationSceneV1;runId:string;maxBytes?:number;maxTicks?:number;/** ticks per chunk before an automatic flush */chunkTicks?:number}
export interface NavigationRecorder{
 readonly directory:string;
 /** Set once a limit or a write failure ended the recording; nothing after it is recorded. */
 readonly terminal:string|null;
 readonly lastTick:number|null;
 /** Whether the plant may advance to `tick` and still be recorded (the tick limit is checked before the step is sent). */
 admits(tick:number):boolean;
 /** Records the snapshot of `snapshot.tick` and the step that produced it (null for the created plant). An exact duplicate is a no-op; any other repeat is refused. */
 append(snapshot:IRSimSnapshotV1,controls:StepPayload|null):Promise<void>;
 /** Makes buffered records durable when at least `minTicks` are buffered. */
 flush(minTicks?:number):Promise<void>;
 /** A hole the recorder itself cannot see (a restart lost the buffered tail): recorded, never filled. */
 gap(gap:Gap):Promise<void>;
 /** Ends the recording incomplete (a run limit reached elsewhere). */
 terminate(reason:string):Promise<void>;
 /** The committed manifest (plus a gap or terminal reason whose manifest write is still being retried: claimed, never dropped). */
 committed():Committed;
 /** Releases the writer lock (after pending writes); the recorder accepts nothing afterwards. */
 close():Promise<void>;
}

/** The manifest on disk (null when there is none yet), size-capped and validated: a manifest that is not one the recorder wrote is refused, never repaired. */
async function readManifest(dir:string):Promise<Manifest|null>{
 const file=join(dir,MANIFEST),st=await lstat(file).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;});
 if(!st)return null;
 const bad=()=>new Error('EVIDENCE_MANIFEST_INVALID');
 if(!st.isFile()||st.size>READ_LIMITS.manifestBytes)throw bad();
 let x:unknown;try{x=JSON.parse(await readFile(file,'utf8'));}catch{throw bad();}
 const keys=['schemaVersion','format','runId','sceneDigest','chunks','gaps','terminal','lastTick','lastKey','bytes','inflated','boots'] as const;
 if(!obj(x,keys)||x.schemaVersion!==1||!text(x.runId)||!text(x.sceneDigest)||!obj(x.chunks,STREAMS)||!Array.isArray(x.gaps)||listingProblem(x as never)||!nat(x.bytes)||!nat(x.inflated)
  ||!(x.lastKey===null||typeof x.lastKey==='string')||!(x.lastTick===null||nat(x.lastTick))||!Array.isArray(x.boots)||!x.boots.every(b=>obj(b,['bootId','firstTick'])&&text(b.bootId)&&nat(b.firstTick)))throw bad();
 return x as unknown as Manifest;
}
const errno=(e:unknown)=>(e as NodeJS.ErrnoException).code;
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e){return errno(e)==='EPERM';}};
/** The pid a lock file names (`{"pid":..}`, or a bare pid from an older writer); null for anything else. */
const holderOf=(t:string)=>{try{const x=JSON.parse(t) as unknown,pid=typeof x==='number'?x:(x as {pid?:unknown}|null)?.pid;return Number.isSafeInteger(pid)&&(pid as number)>0?pid as number:null;}catch{return null;}};
/**
 * One writer per recording directory, across processes. The lock is published complete with link() (atomic, EEXIST when held). A lock naming another live process
 * refuses this one; a dead holder's lock (a crash), an unreadable one or this process's own is removed under an exclusive takeover guard after re-reading it unchanged,
 * then the exclusive create is tried again: two takers never both win. Returns the lock text, which release compares before removing the file.
 * ponytail: pid liveness only (a reused pid keeps a stale lock until removed by hand; one process may reopen its own directory: the run registry refuses doubles)
 */
async function lockWriter(dir:string):Promise<string>{
 const file=join(dir,LOCK),guard=join(dir,`.${LOCK}.takeover`),mine=JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),nonce:randomBytes(8).toString('hex')});
 for(let i=0;i<100;i++){
  const tmp=join(dir,`.${LOCK}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`),h=await open(tmp,'wx',0o600);
  try{await h.writeFile(mine);await h.sync();}finally{await h.close();}
  try{await link(tmp,file);await syncDir(dir);return mine;}catch(e){if(errno(e)!=='EEXIST')throw e;}finally{await unlink(tmp).catch(()=>{});}
  const seen=await readFile(file,'utf8').catch(()=>null);if(seen===null)continue;
  const pid=holderOf(seen);
  if(pid!==null&&pid!==process.pid&&alive(pid))throw new Error('EVIDENCE_WRITER_LOCKED');
  // a guard left by a crash in the middle of a takeover is cleared after 10 s
  try{await (await open(guard,'wx',0o600)).close();}
  catch(e){if(errno(e)!=='EEXIST')throw e;const g=await lstat(guard).catch(()=>null);if(g&&Date.now()-g.mtimeMs>10_000)await unlink(guard).catch(()=>{});await new Promise(r=>setTimeout(r,5));continue;}
  try{if(await readFile(file,'utf8').catch(()=>null)===seen)await unlink(file);}finally{await unlink(guard).catch(()=>{});}
 }
 throw new Error('EVIDENCE_WRITER_LOCKED');
}
const unlockWriter=async(dir:string,mine:string)=>{const file=join(dir,LOCK);if(await readFile(file,'utf8').catch(()=>null)===mine)await unlink(file).catch(()=>{});};
/** Opens (or reopens after a crash) the run's recorder: committed chunks come from the manifest on disk; files it does not list are never adopted. */
export async function openNavigationRecorder(o:RecorderOptions):Promise<NavigationRecorder>{
 const dir=o.directory,maxBytes=o.maxBytes??EVIDENCE_LIMITS.maxBytes,maxTicks=o.maxTicks??EVIDENCE_LIMITS.maxTicks,chunkTicks=o.chunkTicks??250;
 await mkdir(dir,{recursive:true,mode:0o700});
 const lock=await lockWriter(dir);
 let m:Manifest,orphanBytes=0;
 try{
  m=await readManifest(dir)??{schemaVersion:1,format:EVIDENCE_FORMAT,runId:o.runId,sceneDigest:o.scene.sceneDigest,chunks:empty(),gaps:[],terminal:null,lastTick:null,lastKey:null,bytes:0,inflated:0,boots:[]};
  if(m.runId!==o.runId||m.sceneDigest!==o.scene.sceneDigest||m.format!==EVIDENCE_FORMAT)throw new Error('EVIDENCE_IDENTITY_MISMATCH');
  // files the manifest does not list (a chunk or tmp file a crash left behind) are never adopted, but they are stored bytes: they count against the quota
  const listedNames=new Set(STREAMS.flatMap(s=>m.chunks[s].map(r=>r.path)));
  for(const f of await readdir(dir))if(f!==MANIFEST&&f!==LOCK&&!listedNames.has(f))orphanBytes+=(await lstat(join(dir,f)).catch(()=>({size:0}))).size;
 }catch(e){await unlockWriter(dir,lock);throw e;}
 const every=new Map(o.scene.robots.flatMap(r=>r.model.sensors.map(s=>[`${r.robotId}/${s.id}`,s.publishEveryTicks] as const)));
 let buf:Record<EvidenceStream,{tick:number;line:string}[]>={trajectory:[],sensors:[],control:[],collisions:[]},last={tick:m.lastTick,key:m.lastKey},bufBoots:Manifest['boots']=[],writing=Promise.resolve(),closed=false;
 // dirty: the manifest in memory holds a gap or terminal reason that is not on disk yet; every later flush writes it again until one succeeds
 let dirty=false;
 const saveManifest=async()=>{dirty=true;await writeDurable(dir,MANIFEST,JSON.stringify(m));dirty=false;};
 const end=async(reason:string,gap?:Gap)=>{
  if(m.terminal)return;
  m.terminal=reason;if(gap&&gap.toTick>=gap.fromTick)m.gaps.push(gap);
  buf={trajectory:[],sensors:[],control:[],collisions:[]};bufBoots=[];
  await saveManifest().catch(()=>{}); // a failing disk may refuse this too: the terminal state is then also held in memory and the run stops
 };
 const bufferRange=():Gap|undefined=>{const t=buf.trajectory;return t.length?{fromTick:t[0]!.tick,toTick:t.at(-1)!.tick,reason:''}:undefined;};
 /** Lines of one stream in chunks cut at tick boundaries (sensors and contacts hold several lines per tick) within WRITE_CHUNK. */
 const pack=(lines:{tick:number;line:string}[])=>{
  const out:{tick:number;line:string}[][]=[];let cur:typeof lines=[],size=0;
  for(let i=0;i<lines.length;){
   let j=i,n=0;while(j<lines.length&&lines[j]!.tick===lines[i]!.tick){n+=Buffer.byteLength(lines[j]!.line)+1;j++;}
   if(cur.length&&(size+n>WRITE_CHUNK.inflated||cur.length+j-i>WRITE_CHUNK.lines)){out.push(cur);cur=[];size=0;}
   cur.push(...lines.slice(i,j));size+=n;i=j;
  }
  if(cur.length)out.push(cur);return out;
 };
 const doFlush=async(min:number)=>{
  if(m.terminal||!buf.trajectory.length||buf.trajectory.length<min){if(dirty)await saveManifest().catch(()=>{});return;}
  const range=bufferRange()!;
  const parts=STREAMS.flatMap(s=>pack(buf[s]).map((lines,k)=>{const body=lines.map(x=>x.line+'\n').join('');return {s,k,lines,inflated:Buffer.byteLength(body),bytes:gzipSync(body)};}));
  const add=parts.reduce((n,p)=>n+p.bytes.length,0),inflated=parts.reduce((n,p)=>n+p.inflated,0);
  // the quota counts every stored byte: the chunks and the manifest that lists them
  if(m.bytes+orphanBytes+add+JSON.stringify(m).length+256*(parts.length+1)>maxBytes)return end('EVIDENCE_QUOTA_EXCEEDED',{...range,reason:'EVIDENCE_QUOTA_EXCEEDED'});
  // never commit what the reader refuses: a chunk above its caps, more chunks per stream than it lists, more inflated bytes than it reads in total
  if(m.inflated+inflated>READ_LIMITS.totalInflated||STREAMS.some(s=>m.chunks[s].length+parts.filter(p=>p.s===s).length>READ_LIMITS.chunksPerStream)
   ||parts.some(p=>p.inflated>READ_LIMITS.chunkInflated||p.bytes.length>READ_LIMITS.chunkBytes||p.lines.length>READ_LIMITS.linesPerChunk||p.lines.some(l=>l.line.length>READ_LIMITS.lineBytes)))
   return end('EVIDENCE_READ_LIMIT',{...range,reason:'EVIDENCE_READ_LIMIT'});
  const refs:[EvidenceStream,ChunkRef][]=[],before={bytes:m.bytes,inflated:m.inflated,lastTick:m.lastTick,lastKey:m.lastKey,boots:m.boots.length};
  try{
   for(const p of parts){
    const path=`${p.s}-${String(m.chunks[p.s].length+p.k+1).padStart(6,'0')}-${randomBytes(4).toString('hex')}.ndjson.gz`;
    await writeDurable(dir,path,p.bytes);
    refs.push([p.s,{path,sha256:sha256(p.bytes),bytes:p.bytes.length,firstTick:p.lines[0]!.tick,lastTick:p.lines.at(-1)!.tick}]);
   }
   for(const [s,r] of refs)m.chunks[s].push(r);
   m.bytes+=add;m.inflated+=inflated;m.lastTick=last.tick;m.lastKey=last.key;m.boots.push(...bufBoots);
   await saveManifest();
  }catch(e){
   // nothing of this flush is claimed: the manifest in memory goes back to what is on disk (the written chunks stay unlisted orphans, counted in the quota)
   for(const [s,r] of refs){const i=m.chunks[s].indexOf(r);if(i>=0)m.chunks[s].splice(i,1);orphanBytes+=r.bytes;}
   m.bytes=before.bytes;m.inflated=before.inflated;m.lastTick=before.lastTick;m.lastKey=before.lastKey;m.boots.length=before.boots;
   return end(`EVIDENCE_WRITE_FAILED:${(e as NodeJS.ErrnoException).code??'IO'}`,{...range,reason:'EVIDENCE_WRITE_FAILED'});
  }
  buf={trajectory:[],sensors:[],control:[],collisions:[]};bufBoots=[];
 };
 const serial=<T>(f:()=>Promise<T>)=>{const p=writing.then(()=>{if(closed)throw new Error('EVIDENCE_RECORDER_CLOSED');return f();});writing=p.then(()=>{},()=>{});return p;};
 return {
  directory:dir,
  get terminal(){return m.terminal;},
  get lastTick(){return last.tick;},
  admits:tick=>!m.terminal&&tick<=maxTicks,
  append:(s,controls)=>serial(async()=>{
   if(m.terminal)throw new Error(`EVIDENCE_TERMINAL:${m.terminal}`);
   const tick=s.tick;
   if(!Number.isSafeInteger(tick)||tick<0||s.sceneDigest!==m.sceneDigest||s.runId!==m.runId)throw new Error('EVIDENCE_SNAPSHOT_FOREIGN');
   // what is buffered is still stored; only the tick beyond the limit is not
   if(tick>maxTicks){await doFlush(0);return end('EVIDENCE_TICK_LIMIT',{fromTick:tick,toTick:tick,reason:'EVIDENCE_TICK_LIMIT'});}
   const traj:TrajectoryRecord={tick,simTimeNs:s.simTimeNs,robots:s.robots.map(r=>({robotId:r.robotId,poseDriveMap:[...r.poseDriveMap] as [number,number,number],bodyVelocity:[...r.bodyVelocity] as [number,number],collisionIds:[...r.collisionIds]}))};
   const ctl:ControlRecord|null=controls&&{tick:tick-1,targetTick:tick,singleStep:controls.singleStep===true,velocities:controls.velocities.map(v=>({robotId:v.robotId,vMps:v.vMps,omegaRadps:v.omegaRadps})),actorUpdates:structuredClone(controls.actorUpdates)};
   const scans=s.robots.flatMap(r=>r.scans.flatMap(scan=>{const k=every.get(`${r.robotId}/${scan.sensorId}`);if(k===undefined||scan.tick!==tick)throw new Error('EVIDENCE_SENSOR_FOREIGN');return tick%k===0?[{tick,robotId:r.robotId,scan}]:[];}));
   const lines={trajectory:JSON.stringify(traj),control:ctl&&JSON.stringify(ctl),sensors:scans.map(x=>JSON.stringify(x))};
   const key=sha256(JSON.stringify([lines,s.bootId]));
   if(last.tick!==null&&tick<=last.tick){if(tick===last.tick&&key===last.key)return;throw new Error('EVIDENCE_APPEND_CONFLICT');}
   // the created plant (tick 0 of a fresh recording) has no step; every later tick was produced by exactly the step recorded with it
   if(controls?controls.targetTick!==tick:last.tick!==null)throw new Error('EVIDENCE_CONTROL_MISMATCH');
   if(last.tick!==null&&tick>last.tick+1){if(m.gaps.length>=READ_LIMITS.gaps-1)return end('EVIDENCE_READ_LIMIT',{fromTick:last.tick+1,toTick:tick,reason:'EVIDENCE_READ_LIMIT'});m.gaps.push({fromTick:last.tick+1,toTick:tick-1,reason:'TICK_GAP'});}
   const boots=[...m.boots,...bufBoots];if(boots.at(-1)?.bootId!==s.bootId)bufBoots.push({bootId:s.bootId,firstTick:tick});
   buf.trajectory.push({tick,line:lines.trajectory});
   if(lines.control)buf.control.push({tick:tick-1,line:lines.control});
   for(const l of lines.sensors)buf.sensors.push({tick,line:l});
   for(const r of traj.robots)if(r.collisionIds.length)buf.collisions.push({tick,line:JSON.stringify({tick,robotId:r.robotId,collisionIds:r.collisionIds} satisfies CollisionRecord)});
   last={tick,key};
   if(buf.trajectory.length>=chunkTicks)await doFlush(0);
  }),
  flush:(min=0)=>serial(()=>doFlush(min)),
  // a gap that cannot be written stays in memory (claimed by committed()) and the manifest stays dirty: every later flush writes it again
  gap:g=>serial(async()=>{if(g.toTick<g.fromTick)return;if(m.gaps.length>=READ_LIMITS.gaps-1)return end('EVIDENCE_READ_LIMIT',{...g,reason:'EVIDENCE_READ_LIMIT'});m.gaps.push(g);await saveManifest();}),
  terminate:reason=>serial(async()=>{await doFlush(0);await end(reason);}),
  committed:()=>structuredClone({chunks:m.chunks,gaps:m.gaps,terminal:m.terminal,lastTick:m.lastTick,bytes:m.bytes}),
  close:()=>serial(async()=>{closed=true;await unlockWriter(dir,lock);}),
 };
}

// ---- reading (pure artifact decoding; no worker, no source session) ----
export interface EvidenceIssue{path:string;code:string;detail:string;/** stream and chunk index (or the stream, or 'listing'): what assertion details name instead of the random chunk path */at:string}
export interface EvidenceRead{trajectory:TrajectoryRecord[];control:ControlRecord[];sensors:SensorRecord[];collisions:CollisionRecord[];issues:EvidenceIssue[];gaps:Gap[];horizon:number|null;complete:boolean;
 /** Why the read is incomplete besides issues and gaps: the end of the recording is unknown, the evidence runs ahead of the run, the sensor cadence was not verifiable. */reasons:string[];
 /** The listed terminal reason (null when the listing says the recording was not ended early, or says nothing: see EVIDENCE_END_UNKNOWN). */terminal:string|null;
 /** Uncompressed record text per stream, in tick order: what the normalized digests hash. */text:Record<EvidenceStream,string>}
type Parsed={text:string;records:{tick:number}[]};
/** Decoded chunks by stream and stored-byte hash: content only (never a verdict about a listing), deeply frozen so no reader of a result can change the next read. */
const cache=new Map<string,Parsed>();
const freeze=<T>(x:T):T=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))freeze(v);}return x;};
const vec=(x:unknown,n:number)=>Array.isArray(x)&&x.length===n&&x.every(finite);
const ids=(x:unknown)=>Array.isArray(x)&&x.length<=64&&x.every(y=>text(y));
const BEAMS=new Set<unknown>(['hit','no_return','below_min','invalid']),NS=BigInt(20_000_000);
const SCAN_KEYS=['sensorId','frameId','tick','simTimeNs','angleMinRad','angleIncrementRad','rangeMinM','rangeMaxM','rangesM','states'] as const;
const RANGE_TOL=1e-6;
/** A scan at its tick's sim time whose ranges agree with their beam states (snapshot.py): a hit carries a finite range within [rangeMin, rangeMax]; no_return,
 * below_min and invalid carry none. A negative range, a range on a beam that did not hit or a hit without a range is not a scan the engine produced. */
const scanOk=(x:unknown,tick:unknown)=>obj(x,SCAN_KEYS)&&text(x.sensorId)&&text(x.frameId)&&nat(tick)&&x.tick===tick&&x.simTimeNs===String(BigInt(tick)*NS)&&finite(x.angleMinRad)&&finite(x.angleIncrementRad)
 &&finite(x.rangeMinM)&&x.rangeMinM>=0&&finite(x.rangeMaxM)&&x.rangeMaxM>x.rangeMinM&&Array.isArray(x.rangesM)&&Array.isArray(x.states)&&x.rangesM.length<=1080&&x.rangesM.length===x.states.length&&x.states.every(v=>BEAMS.has(v))
 &&x.rangesM.every((v,i)=>(x.states as unknown[])[i]==='hit'?finite(v)&&v>=(x.rangeMinM as number)-RANGE_TOL&&v<=(x.rangeMaxM as number)+RANGE_TOL:v===null);
/** The record shape of each stream, as the recorder writes it: exact keys, finite numbers (a JSON 1e999 parses as Infinity and is refused), bounded arrays. */
const RECORD:Record<EvidenceStream,(r:unknown)=>boolean>={
 trajectory:r=>obj(r,['tick','simTimeNs','robots'])&&nat(r.tick)&&r.simTimeNs===String(BigInt(r.tick)*NS)&&Array.isArray(r.robots)&&r.robots.length>0&&r.robots.length<=32
  &&r.robots.every(x=>obj(x,['robotId','poseDriveMap','bodyVelocity','collisionIds'])&&text(x.robotId)&&vec(x.poseDriveMap,3)&&vec(x.bodyVelocity,2)&&ids(x.collisionIds)),
 control:r=>obj(r,['tick','targetTick','singleStep','velocities','actorUpdates'])&&nat(r.tick)&&r.targetTick===r.tick+1&&typeof r.singleStep==='boolean'&&Array.isArray(r.velocities)&&r.velocities.length<=32
  &&r.velocities.every(v=>obj(v,['robotId','vMps','omegaRadps'])&&text(v.robotId)&&finite(v.vMps)&&finite(v.omegaRadps))&&Array.isArray(r.actorUpdates)&&r.actorUpdates.length<=1000,
 sensors:r=>obj(r,['tick','robotId','scan'])&&nat(r.tick)&&text(r.robotId)&&scanOk(r.scan,r.tick),
 collisions:r=>obj(r,['tick','robotId','collisionIds'])&&nat(r.tick)&&text(r.robotId)&&ids(r.collisionIds)&&(r.collisionIds as unknown[]).length>0,
};
/**
 * Reads one listed chunk of stream `s` inside `root`. The name must be a recorder chunk name of that stream (no directories, no traversal), the file a regular file inside
 * the root (no symlink) whose size is the recorded one before a byte is read; it inflates within the caps and every line is a record of that stream in tick order.
 */
async function readChunk(root:string,realRoot:string,s:EvidenceStream,at:string,ref:ChunkRef,issues:EvidenceIssue[],budget:{left:number}):Promise<Parsed|null>{
 const bad=(code:string,detail:string)=>{issues.push({path:ref.path,code,detail,at});return null;};
 if(!CHUNK_NAME.test(ref.path))return bad('EVIDENCE_PATH_REJECTED','not a recorder chunk name');
 if(!ref.path.startsWith(`${s}-`))return bad('EVIDENCE_PATH_REJECTED',`a ${ref.path.split('-')[0]!} chunk listed under ${s}`);
 if(ref.bytes>READ_LIMITS.chunkBytes)return bad('EVIDENCE_READ_LIMIT',`${ref.bytes} bytes recorded, above the ${READ_LIMITS.chunkBytes}-byte chunk cap`);
 const file=join(root,ref.path);
 const st=await lstat(file).catch(()=>null);
 if(!st)return bad('EVIDENCE_CHUNK_MISSING','listed chunk is not on disk');
 if(!st.isFile())return bad('EVIDENCE_PATH_REJECTED','not a regular file');
 const real=await realpath(file);
 if(!real.startsWith(realRoot+sep))return bad('EVIDENCE_PATH_REJECTED','outside the recording root');
 if(st.size!==ref.bytes)return bad('EVIDENCE_CHUNK_TRUNCATED',`${st.size} bytes stored, ${ref.bytes} recorded`);
 const bytes=await readFile(file);
 if(bytes.length!==ref.bytes)return bad('EVIDENCE_CHUNK_TRUNCATED',`${bytes.length} bytes stored, ${ref.bytes} recorded`);
 const digest=sha256(bytes);
 if(digest!==ref.sha256)return bad('EVIDENCE_CHUNK_CORRUPT','stored bytes do not match the recorded SHA-256');
 const key=`${s}:${digest}`,p=cache.get(key)??decode(bytes,s,ref,budget,bad);if(!p)return null;
 cache.set(key,p);if(cache.size>4096)cache.delete(cache.keys().next().value!);
 // what the listing claims is checked on every read, a cache hit included: the cache holds decoded content, never a verdict
 if(!spans(p.records,ref))return bad('EVIDENCE_CHUNK_CORRUPT',`records span ${p.records[0]!.tick}..${p.records.at(-1)!.tick}, the listing says ${ref.firstTick}..${ref.lastTick}`);
 if(p.text.length>budget.left)return bad('EVIDENCE_READ_LIMIT','the recording inflates past the total read cap');
 budget.left-=p.text.length;return p;
}
const spans=(records:readonly {tick:number}[],ref:ChunkRef)=>records[0]!.tick===ref.firstTick&&records.at(-1)!.tick===ref.lastTick;
/** Inflates and parses one chunk's verified bytes within the caps; every line a record of stream `s`, in tick order, over the listed range (re-checked on cache hits). */
function decode(bytes:Buffer,s:EvidenceStream,ref:ChunkRef,budget:{left:number},bad:(code:string,detail:string)=>null):Parsed|null{
 if(budget.left<1)return bad('EVIDENCE_READ_LIMIT','the recording inflates past the total read cap');
 let body:string;
 try{body=gunzipSync(bytes,{maxOutputLength:Math.min(READ_LIMITS.chunkInflated,budget.left)}).toString('utf8');}
 catch(e){return (e as NodeJS.ErrnoException).code==='ERR_BUFFER_TOO_LARGE'?bad('EVIDENCE_READ_LIMIT','inflates past the read cap'):bad('EVIDENCE_CHUNK_CORRUPT','not a gzip stream');}
 if(!body.endsWith('\n'))return bad('EVIDENCE_CHUNK_CORRUPT','last record is not terminated');
 const lines=body.slice(0,-1).split('\n');
 if(lines.length>READ_LIMITS.linesPerChunk||lines.some(l=>l.length>READ_LIMITS.lineBytes))return bad('EVIDENCE_READ_LIMIT',`more than ${READ_LIMITS.linesPerChunk} records or a record above ${READ_LIMITS.lineBytes} bytes`);
 let records:unknown[];
 try{records=lines.map(l=>JSON.parse(l) as unknown);}catch{return bad('EVIDENCE_CHUNK_CORRUPT','a record is not JSON');}
 // trajectory and control hold one record per tick; sensors and contacts one per robot (and sensor) per tick
 const tickOf=(r:unknown)=>(r as {tick?:unknown}|null)?.tick,strict=s==='trajectory'||s==='control';
 if(!records.length||records.some((r,i)=>!nat(tickOf(r))||i>0&&(strict?tickOf(r)!<=tickOf(records[i-1])!:tickOf(r)!<tickOf(records[i-1])!)))
  return bad('EVIDENCE_CHUNK_CORRUPT','record ticks are out of order or repeat');
 if(!spans(records as {tick:number}[],ref))return bad('EVIDENCE_CHUNK_CORRUPT','record ticks do not match the chunk range');
 if(!records.every(RECORD[s]))return bad('EVIDENCE_RECORD_INVALID',`a record is not a ${s} record`);
 return freeze({text:body,records:records as {tick:number}[]});
}
export interface ReadOptions{
 /** The scene the recording was made for: the robots and every sensor's publication cadence are checked against it. Without it the read is never complete. */
 scene?:NavigationSceneV1;
 /** The run's committed logical tick: the evidence must reach it exactly (later ticks still buffered are EVIDENCE_PENDING; evidence beyond it is ahead of the checkpoint). */
 runTick?:number|null;
}
/**
 * Verifies and decodes the chunks a listing names: the recorder's manifest, or an imported evidence document's `{chunks:artifacts,...recording}`. The listing is checked first;
 * a chunk that is missing, truncated, corrupted, oversized, out of order, of the wrong stream, malformed or outside the root is reported and its records are left out. Each stream
 * is then held to its expectation (trajectory every tick from 0, one control record per recorded step, contact records equal to the trajectory's collision ids, LiDAR at
 * the scene's cadence) and the end of the recording must be known: a listing without its gaps, terminal reason and last tick cannot be complete.
 */
export async function readNavigationEvidence(root:string,listed:Listing,o:ReadOptions={}):Promise<EvidenceRead>{
 const realRoot=await realpath(root),issues:EvidenceIssue[]=[],reasons:string[]=[],out={trajectory:[],control:[],sensors:[],collisions:[]} as unknown as Record<EvidenceStream,{tick:number}[]>,text={trajectory:'',sensors:'',control:'',collisions:''};
 const problem=listingProblem(listed),refused:[number,number][]=[];
 if(problem)issues.push({path:'listing',code:'EVIDENCE_LISTING_INVALID',detail:problem,at:'listing'});
 else{
  const budget={left:READ_LIMITS.totalInflated};
  for(const s of STREAMS){
   let prev=-1;
   for(const [i,ref] of (listed.chunks[s]??[]).entries()){
    if(!(ref.firstTick>prev)){issues.push({path:ref.path,code:'EVIDENCE_CHUNK_ORDER',detail:`starts at ${ref.firstTick}, the previous chunk ended at ${prev}`,at:`${s}[${i}]`});refused.push([ref.firstTick,ref.lastTick]);continue;}
    const p=await readChunk(root,realRoot,s,`${s}[${i}]`,ref,issues,budget);if(!p){refused.push([ref.firstTick,ref.lastTick]);continue;}
    prev=ref.lastTick;for(const r of p.records)out[s].push(r);text[s]+=p.text;
   }
  }
 }
 const traj=out.trajectory as TrajectoryRecord[],gaps=[...problem?[]:listed.gaps??[]];
 // every tick from 0 to the last recorded one exactly once; a hole is a gap whatever caused it
 let expect=0;
 for(const r of traj){if(r.tick>expect)gaps.push({fromTick:expect,toTick:r.tick-1,reason:'EVIDENCE_TICKS_MISSING'});if(r.tick<expect)issues.push({path:'trajectory',code:'EVIDENCE_TICK_DUPLICATE',detail:`tick ${r.tick}`,at:'trajectory'});expect=Math.max(expect,r.tick+1);}
 const horizon=traj.length?traj.at(-1)!.tick:null;
 // the other streams against the trajectory, outside the ranges of chunks already refused (those failed on their own)
 const skip=(t:number)=>refused.some(([a,b])=>t+1>=a&&t<=b),mismatch=(s:string,detail:string)=>issues.push({path:s,code:'EVIDENCE_STREAM_MISMATCH',detail,at:s});
 const same=(a:string[],b:string[])=>{if(a.length!==b.length)return false;a.sort();b.sort();return a.every((x,i)=>x===b[i]);};
 const steps=traj.flatMap(r=>r.tick>0&&!skip(r.tick-1)?[String(r.tick-1)]:[]),sent=(out.control as ControlRecord[]).filter(r=>!skip(r.tick)).map(r=>String(r.tick));
 if(!same(steps,sent))mismatch('control',`${sent.length} control records for ${steps.length} recorded steps`);
 const key=(t:number,id:string,c:string[])=>JSON.stringify([t,id,c]);
 const touching=traj.flatMap(r=>skip(r.tick)?[]:r.robots.filter(x=>x.collisionIds.length).map(x=>key(r.tick,x.robotId,x.collisionIds))),contacts=(out.collisions as CollisionRecord[]).filter(r=>!skip(r.tick)).map(r=>key(r.tick,r.robotId,r.collisionIds));
 if(!same(touching,contacts))mismatch('collisions',`${contacts.length} contact records for ${touching.length} recorded robot contacts`);
 if(o.scene){
  const robots=o.scene.robots.map(r=>r.robotId).sort().join('|'),pubs=o.scene.robots.flatMap(r=>r.model.sensors.map(s=>({robotId:r.robotId,id:s.id,every:s.publishEveryTicks})));
  if(traj.some(r=>r.robots.map(x=>x.robotId).sort().join('|')!==robots))mismatch('trajectory','recorded robots differ from the scene');
  const due=traj.flatMap(r=>skip(r.tick)?[]:pubs.filter(p=>r.tick%p.every===0).map(p=>`${r.tick}|${p.robotId}|${p.id}`)),published=(out.sensors as SensorRecord[]).filter(r=>!skip(r.tick)).map(r=>`${r.tick}|${r.robotId}|${r.scan.sensorId}`);
  if(!same(due,published))mismatch('sensors',`${published.length} LiDAR publications for ${due.length} due at the scene's cadence`);
  // each publication is a scan of the declared sensor: its beam count and range limits (the record check already tied ranges to beam states and the tick's time)
  const declared=new Map(o.scene.robots.flatMap(r=>r.model.sensors.map(x=>[`${r.robotId}|${x.id}`,x] as const)));
  const wrong=(out.sensors as SensorRecord[]).filter(r=>{if(skip(r.tick))return false;const d=declared.get(`${r.robotId}|${r.scan.sensorId}`);
   return !!d&&(r.scan.rangesM.length!==d.beamCount||Math.abs(r.scan.rangeMinM-d.rangeMinM)>RANGE_TOL||Math.abs(r.scan.rangeMaxM-d.rangeMaxM)>RANGE_TOL);});
  if(wrong.length)issues.push({path:'sensors',code:'SENSOR_SCAN_MISMATCH',detail:`${wrong.length} LiDAR publication(s) differ from the scene's sensor (beam count or range limits), first at tick ${wrong[0]!.tick}`,at:'sensors'});
 }else reasons.push('SENSOR_CADENCE_UNVERIFIED');
 // the end of the recording: what the recorder committed (its gaps, terminal reason and last durable tick) or nothing can be claimed about the tail
 if(listed.gaps===undefined||listed.terminal===undefined||listed.lastTick===undefined)reasons.push('EVIDENCE_END_UNKNOWN');
 else if(!problem&&listed.lastTick!==horizon)issues.push({path:'listing',code:'EVIDENCE_END_MISMATCH',detail:`the recording declares its last durable tick ${listed.lastTick}, the verified chunks end at ${horizon}`,at:'listing'});
 // the run's logical tick: given by the live run, or carried by an exported recording block (an export taken before the disk caught up stays incomplete)
 const runTick=o.runTick!==undefined?o.runTick:problem?null:listed.runTick??null;
 if(runTick!==null){
  const from=(horizon??-1)+1;
  if(from<=runTick&&!gaps.some(g=>g.fromTick<=from&&g.toTick>=runTick))gaps.push({fromTick:from,toTick:runTick,reason:'EVIDENCE_PENDING'});
  if(horizon!==null&&horizon>runTick)reasons.push(`EVIDENCE_AHEAD_OF_CHECKPOINT:${runTick+1}-${horizon}`);
 }
 const merged=gaps.filter((g,i)=>gaps.findIndex(x=>x.fromTick===g.fromTick&&x.toTick===g.toTick)===i).sort((a,b)=>a.fromTick-b.fromTick);
 const terminal=problem?null:listed.terminal??null;
 return {trajectory:traj,control:out.control as ControlRecord[],sensors:out.sensors as SensorRecord[],collisions:out.collisions as CollisionRecord[],issues,gaps:merged,horizon,reasons,terminal,
  complete:!issues.length&&!merged.length&&!reasons.length&&!problem&&listed.terminal===null&&horizon!==null,text};
}

// ---- metrics (computed from the durable read only; independent of any renderer and of the controller's own verdicts) ----
export interface CollisionEpisode{pair:[string,string];source:ContactSource;fromTick:number;toTick:number}
export interface NavigationMetrics{
 coverage:'complete'|'incomplete';horizon:number|null;
 /** robot base origin path length (T_map_base), summed only over consecutive recorded ticks */
 distanceM:Record<string,number>|null;
 /** drive-axle path length (the frame the engine reports) */
 driveDistanceM:Record<string,number>|null;
 contacts:Contact[];episodes:CollisionEpisode[];
 /** physical-contact episodes (engine_discrete or swept_oracle); safety_envelope breaches are counted apart */
 collisionEpisodes:number|null;safetyEnvelopeEpisodes:number|null;
 minSeparationM:number|null;minClearanceM:number|null;
 sensorPublications:{expected:number;recorded:number;complete:boolean};
 coverageReasons:string[];
}
/** Collision episode: one pair and source from clear to overlap to clear (consecutive ticks are one episode, never one per tick). */
export function collisionEpisodes(contacts:readonly Contact[]):CollisionEpisode[]{
 const open=new Map<string,CollisionEpisode>(),out:CollisionEpisode[]=[];
 for(const c of [...contacts].sort((a,b)=>a.tick-b.tick)){
  const key=`${c.pair.join('|')}|${c.source}`,e=open.get(key);
  if(e&&e.toTick>=c.tick-1)e.toTick=c.tick;else{const n={pair:c.pair,source:c.source,fromTick:c.tick,toTick:c.tick};open.set(key,n);out.push(n);}
 }
 return out;
}
const basePose=(scene:NavigationSceneV1,id:string,d:readonly number[])=>{const b=baseInMap({position:[d[0]!,d[1]!,0],quaternionXyzw:quaternionFromYaw(d[2]!)},framePose(scene.robots.find(x=>x.robotId===id)!.model.driveFrameInBase));return [b.position[0]!,b.position[1]!,yawOf(b.quaternionXyzw)] as const;};
const memo=new Map<string,{text:string;n:number;a:TrajectoryAssessment}>();
/**
 * The oracle over the read trajectory. A live run is reported again and again while it grows: when the verified record text extends the text assessed last time
 * (exact prefix), only the new ticks (and the one before them, for the sweep and the tick continuity) are assessed and the results merged.
 */
function assess(scene:NavigationSceneV1,snaps:IRSimSnapshotV1[],text:string):TrajectoryAssessment{
 const hit=memo.get(scene.sceneDigest);let a:TrajectoryAssessment;
 if(hit&&hit.n>0&&snaps.length>=hit.n&&text.startsWith(hit.text)){
  const tail=assessTrajectory(scene,snaps.slice(hit.n-1)),key=(c:Contact)=>`${c.tick}|${c.pair}|${c.source}`,seen=new Set(hit.a.contacts.map(key));
  const both=hit.a.coverage==='complete'&&tail.coverage==='complete',min=(x:number|null,y:number|null)=>!both?null:x===null?y:y===null?x:Math.min(x,y);
  a={contacts:[...hit.a.contacts,...tail.contacts.filter(c=>!seen.has(key(c)))],minSeparationM:min(hit.a.minSeparationM,tail.minSeparationM),minClearanceM:min(hit.a.minClearanceM,tail.minClearanceM),coverage:both?'complete':'incomplete'};
 }else a=assessTrajectory(scene,snaps);
 memo.set(scene.sceneDigest,{text,n:snaps.length,a});if(memo.size>16)memo.delete(memo.keys().next().value!);
 return a;
}
export function navigationMetrics(scene:NavigationSceneV1,read:EvidenceRead):NavigationMetrics{
 const snaps=read.trajectory.map(r=>({schemaVersion:1,runId:'',bootId:'',tick:r.tick,simTimeNs:r.simTimeNs,seq:'0',sceneDigest:scene.sceneDigest,robots:r.robots.map(x=>({...x,scans:[]}))}) as IRSimSnapshotV1);
 const a=assess(scene,snaps,read.text.trajectory),complete=read.complete&&a.coverage==='complete',episodes=collisionEpisodes(a.contacts);
 const reasons=[...read.issues.map(i=>i.code),...read.gaps.map(g=>`${g.reason}:${g.fromTick}-${g.toTick}`),...read.reasons,...read.horizon===null?['NO_TRAJECTORY_RECORDED']:a.coverage==='complete'?[]:['ORACLE_COVERAGE_INCOMPLETE']].filter((x,i,l)=>l.indexOf(x)===i);
 const distance:Record<string,number>={},drive:Record<string,number>={};
 for(const r of scene.robots){distance[r.robotId]=0;drive[r.robotId]=0;}
 read.trajectory.forEach((s,i)=>{const p=read.trajectory[i-1];if(!p||s.tick!==p.tick+1)return;
  for(const r of s.robots){const q=p.robots.find(x=>x.robotId===r.robotId);if(!q||distance[r.robotId]===undefined)continue;
   drive[r.robotId]!+=Math.hypot(r.poseDriveMap[0]-q.poseDriveMap[0],r.poseDriveMap[1]-q.poseDriveMap[1]);
   const b=basePose(scene,r.robotId,r.poseDriveMap),c=basePose(scene,r.robotId,q.poseDriveMap);distance[r.robotId]!+=Math.hypot(b[0]-c[0],b[1]-c[1]);}});
 const pubs=scene.robots.flatMap(r=>r.model.sensors.map(s=>({robotId:r.robotId,id:s.id,every:s.publishEveryTicks})));
 const expected=read.horizon===null?0:pubs.reduce((n,p)=>n+Math.floor(read.horizon!/p.every)+1,0);
 const recorded=read.sensors.length,sensorsOk=complete&&recorded===expected&&pubs.every(p=>read.sensors.filter(x=>x.robotId===p.robotId&&x.scan.sensorId===p.id).every((x,i)=>x.tick===i*p.every));
 return {coverage:complete?'complete':'incomplete',horizon:read.horizon,distanceM:complete?distance:null,driveDistanceM:complete?drive:null,contacts:a.contacts,episodes,
  collisionEpisodes:complete?episodes.filter(e=>e.source!=='safety_envelope').length:null,safetyEnvelopeEpisodes:complete?episodes.filter(e=>e.source==='safety_envelope').length:null,
  minSeparationM:complete?a.minSeparationM:null,minClearanceM:complete?a.minClearanceM:null,sensorPublications:{expected,recorded,complete:sensorsOk},coverageReasons:reasons};
}

// ---- identity, digests and the report extension ----
/** irsim-env-seed-v1 (contracts §3): SHA-256 canonical {runSeed, sensors sorted by robotId/sensorId}, first 8 hex digits as unsigned32. One NumPy generator per environment. */
export function engineSeedOf(runSeed:number,scene:NavigationSceneV1){
 const sensors=scene.robots.flatMap(r=>r.model.sensors.map(s=>({robotId:r.robotId,sensorId:s.id,noiseSeed:s.noise.seed}))).sort((a,b)=>a.robotId<b.robotId?-1:a.robotId>b.robotId?1:a.sensorId<b.sensorId?-1:a.sensorId>b.sensorId?1:0);
 return {engineSeed:Number.parseInt(hashJson({runSeed,sensors}).slice(0,8),16),sensorSeeds:sensors};
}
export interface EvidenceIdentity{
 runId:string;sourceCommit:string;sceneRef:{path:string;sha256:string;bytes:number};lockDigest:string;
 engine:{version:string;pythonVersion:string};numpyVersion:string;runSeed:number;actorRng:{algorithm:string;seed:number};
 controller:{id:'grid-diff-v1';version:string};businessEpochMs:number;
}
export interface Assertion{id:string;result:'pass'|'fail'|'inconclusive'|'not_run';detail:string}
/** Assertions the evidence alone can decide. Repeatability needs a second run and stays not_run here; cross-platform stays not_run until a platform is qualified.
 * Details never name a chunk file (random names): an issue is named by its stream and chunk index, so two runs failing the same way assert the same text. */
export function evidenceAssertions(read:EvidenceRead,m:NavigationMetrics,runTick:number|null,terminal:string|null):Assertion[]{
 const reasons=m.coverageReasons.join(', ').slice(0,900)||'none',end=terminal??read.terminal,unknownEnd=read.reasons.includes('EVIDENCE_END_UNKNOWN');
 return [
  {id:'EVIDENCE_INTEGRITY',result:read.issues.length?'fail':'pass',detail:read.issues.length?`chunks failed verification: ${read.issues.map(i=>`${i.code} ${i.at}`).join('; ').slice(0,900)}`:'every listed chunk matched its size and SHA-256, decoded in order and agreed with the other streams'},
  {id:'EVIDENCE_COVERAGE',result:m.coverage==='complete'&&(runTick===null||read.horizon===runTick)?'pass':'inconclusive',detail:m.coverage==='complete'?`ticks 0..${read.horizon} recorded without a gap${runTick!==null&&read.horizon!==runTick?`; the run is at tick ${runTick}, the durable evidence does not match it`:''}`:`incomplete: ${reasons}`},
  {id:'EVIDENCE_LIMITS',result:end?'fail':unknownEnd?'inconclusive':'pass',detail:end?`recording ended early: ${end}`:unknownEnd?'the end of the recording is unknown: no committed terminal record was given':`within ${EVIDENCE_LIMITS.maxTicks} ticks and the stored-bytes quota`},
  {id:'NO_PHYSICAL_CONTACT',result:m.coverage!=='complete'?'inconclusive':m.collisionEpisodes?'fail':'pass',detail:m.coverage!=='complete'?'not decidable without complete trajectory evidence':`${m.collisionEpisodes} contact episode(s) from engine_discrete/swept_oracle; ${m.safetyEnvelopeEpisodes} safety-envelope breach episode(s)`},
  {id:'SENSOR_PUBLICATIONS',result:m.sensorPublications.complete?'pass':m.sensorPublications.expected===0?'not_run':'inconclusive',detail:`${m.sensorPublications.recorded} of ${m.sensorPublications.expected} LiDAR publications recorded and verified`},
  {id:'REPEATABILITY_SAME_PLATFORM',result:'not_run',detail:'needs a rerun with the same lock, platform and seed; compare the normalized digests'},
  {id:'REPEATABILITY_CROSS_PLATFORM',result:'not_run',detail:'no second platform is qualified; only declared tolerances could be compared'},
 ];
}
/** The host that ran the source and spawned the worker (same host). Part of every digest: a same-platform rerun matches, another platform never does by omission. */
export interface HostIdentity{platform:string;os:string;arch:string;node:string}
export const hostIdentity=():HostIdentity=>({platform:`${platform()}-${arch()}`,os:`${platform()} ${release()}`,arch:arch(),node:process.version});
type DigestIdentity=Pick<EvidenceIdentity,'lockDigest'|'runSeed'|'controller'>&Partial<EvidenceIdentity>;
const digestOf=(header:unknown,...texts:string[])=>{const h=createHash('sha256').update(JSON.stringify(header)+'\n');for(const t of texts)h.update(t).update('\u0000');return h.digest('hex');};
/**
 * Normalized digests: the record text of the streams under a header holding every input, version and platform field of the run (the identity without its runId, the
 * scene/policy/compiler identity, the host) and what the read found (horizon, gaps, issue codes, reasons, terminal). NORMALIZED_OMITS is everything left out.
 * The trajectory digest covers the control ledger and the contact records with the trajectory: the same motion under different commands is not the same run.
 */
export function evidenceDigests(scene:NavigationSceneV1,id:DigestIdentity,read:EvidenceRead,m:NavigationMetrics,assertions:readonly Assertion[],host:HostIdentity=hostIdentity()){
 const {runId:_,...inputs}=id;void _;
 const header={algorithm:DIGEST_ALGORITHM,evidenceFormat:EVIDENCE_FORMAT,scene:{sceneDigest:scene.sceneDigest,policy:scene.policy.hash,compilerVersion:scene.compilerVersion,schemaHash:scene.schemaHash},inputs,host,
  seed:{runSeed:id.runSeed,engineSeed:engineSeedOf(id.runSeed,scene).engineSeed},horizon:read.horizon,gaps:read.gaps,issues:read.issues.map(i=>`${i.code} ${i.at}`),reasons:read.reasons,terminal:read.terminal};
 return {trajectoryDigest:digestOf({...header,stream:'trajectory+control+collisions'},read.text.trajectory,read.text.control,read.text.collisions),
  sensorDigest:digestOf({...header,stream:'sensors'},read.text.sensors),
  assertionDigest:hashJson({header,assertions,episodes:m.episodes,coverage:m.coverage,horizon:m.horizon}),algorithm:DIGEST_ALGORITHM as typeof DIGEST_ALGORITHM,normalizedOmits:[...NORMALIZED_OMITS]};
}
/** The report extension (navigation-run-evidence-v1) for the evidence as read from disk now. Artifact paths are relative to the recording root; `recording` is the
 * recorder's own end-of-recording record plus the run's logical tick at export (runTick), which an import passes back to readNavigationEvidence with the artifacts. */
export function buildNavigationEvidence(scene:NavigationSceneV1,id:EvidenceIdentity,listed:Omit<Committed,'bytes'>,read:EvidenceRead,m:NavigationMetrics,runTick:number|null,host:HostIdentity=hostIdentity()):NavigationRunEvidenceV1{
 const terminal=listed.terminal??read.terminal,assertions=evidenceAssertions(read,m,runTick,terminal),{engineSeed,sensorSeeds}=engineSeedOf(id.runSeed,scene);
 const metric=(name:string,ok:boolean,why:string|null)=>({metric:name,status:ok?'available' as const:'unavailable' as const,reason:ok?null:(why??'EVIDENCE_INCOMPLETE').slice(0,500)});
 const why=m.coverageReasons.join(', ')||null,complete=m.coverage==='complete';
 return {schemaVersion:1,documentType:'navigation-run-evidence',runId:id.runId,sceneDigest:scene.sceneDigest,sceneRef:id.sceneRef,modelDigests:scene.robots.map(r=>r.model.modelDigest),
  policyRef:{id:scene.policy.id,revision:scene.policy.revision,hash:scene.policy.hash},controller:id.controller,
  engine:{id:'irsim_2d',version:id.engine.version,pythonVersion:id.engine.pythonVersion,platform:host.platform,lockDigest:id.lockDigest},
  identity:{sourceCommit:id.sourceCommit,compilerVersion:scene.compilerVersion,sceneSchemaHash:scene.schemaHash,evidenceFormat:EVIDENCE_FORMAT,os:host.os,arch:host.arch,node:host.node},
  clock:{tickMs:20,tickHorizon:Math.min(read.horizon??0,EVIDENCE_LIMITS.maxTicks),businessEpochMs:id.businessEpochMs},
  seed:{runSeed:id.runSeed,engineSeed,engineSeedAlgorithm:'irsim-env-seed-v1',sensorSeeds,actorRng:id.actorRng,engineRng:{library:'numpy',version:id.numpyVersion,algorithm:'numpy.random.default_rng(engineSeed) PCG64, one generator per environment',seed:engineSeed}},
  validationReportRef:null,artifacts:structuredClone(listed.chunks),digests:evidenceDigests(scene,id,read,m,assertions,host),assertions,
  metricCoverage:[metric('travelledDistanceM',complete,why),metric('collisionEpisodes',complete,why),metric('minObstacleClearanceM',m.minClearanceM!==null,why),
   metric('minRobotSeparationM',m.minSeparationM!==null,complete?'ONE_ROBOT':why),metric('sensorPublications',m.sensorPublications.complete,why??'SENSOR_PUBLICATIONS_INCOMPLETE')],
  recordingGaps:read.gaps.slice(0,500),completeness:{status:complete?'complete':'incomplete',reasons:[...terminal?[terminal]:[],...m.coverageReasons].slice(0,50)},
  recording:{gaps:structuredClone(listed.gaps).slice(0,READ_LIMITS.gaps),terminal:listed.terminal,lastTick:listed.lastTick,runTick},
  limitations:['planar kinematic plant (IR-SIM diff drive): no dynamics, contact physics or hardware behaviour','LiDAR publications are recorded at the sensor cadence (publishEveryTicks); the engine scan between publications is not recorded',
   'actor schedule: none (scripted actors arrive with C02); every control record carries its actorUpdates','cross-platform repeatability not qualified (not_run)',
   'the evidence is not anchored or signed: a chunk edited together with a re-hashed manifest or listing is not detected (only stored-byte hashes against the listing are verified)']};
}

// ---- replay and comparison (read-only) ----
/** State at a replay cursor: only samples at or before `tick`; a cursor inside a gap has no pose. Business events (if given) are cut at the cursor's sim time. */
export function replayAt<E extends {at:string}>(read:EvidenceRead,tick:number,business?:{events:readonly E[];epochMs:number}){
 const until=business?business.epochMs+tick*20:0,events=business?business.events.filter(e=>Date.parse(e.at)<=until):[];
 const pose=read.trajectory.find(r=>r.tick===tick)??null,scans=new Map<string,SensorRecord>();
 for(const s of read.sensors){if(s.tick>tick)break;scans.set(`${s.robotId}/${s.scan.sensorId}`,s);}
 return {tick,available:!!pose,robots:pose?.robots??null,scans:[...scans.values()],collisions:read.collisions.filter(c=>c.tick<=tick),controls:read.control.filter(c=>c.tick<=tick),gaps:read.gaps.filter(g=>g.fromTick<=tick),events};
}
/** Same-platform repeatability: ticks, collision ids and beam states exact; poses within poseTol (m/rad), ranges within lidarTol (m). Returns the first mismatches. */
export function compareEvidence(a:EvidenceRead,b:EvidenceRead,tol={pose:1e-9,lidar:1e-6}){
 const out:string[]=[],note=(s:string)=>{if(out.length<20)out.push(s);};
 if(a.trajectory.length!==b.trajectory.length)note(`trajectory ${a.trajectory.length} vs ${b.trajectory.length} ticks`);
 a.trajectory.forEach((x,i)=>{const y=b.trajectory[i];if(!y||y.tick!==x.tick)return note(`tick ${x.tick}`);
  x.robots.forEach((r,j)=>{const q=y.robots[j];if(!q||q.robotId!==r.robotId||JSON.stringify(q.collisionIds)!==JSON.stringify(r.collisionIds))return note(`robot/collisions at ${x.tick}`);
   if(r.poseDriveMap.some((v,k)=>Math.abs(v-q.poseDriveMap[k]!)>tol.pose))note(`pose ${r.robotId} at ${x.tick}`);});});
 if(a.control.length!==b.control.length||a.control.some((c,i)=>{const d=b.control[i]!;return c.tick!==d.tick||c.velocities.length!==d.velocities.length||c.velocities.some((v,k)=>Math.abs(v.vMps-d.velocities[k]!.vMps)>tol.pose||Math.abs(v.omegaRadps-d.velocities[k]!.omegaRadps)>tol.pose);}))note('control ledger');
 if(a.sensors.length!==b.sensors.length)note(`sensors ${a.sensors.length} vs ${b.sensors.length}`);
 a.sensors.forEach((s,i)=>{const t=b.sensors[i];if(!t||t.tick!==s.tick||t.robotId!==s.robotId||JSON.stringify(t.scan.states)!==JSON.stringify(s.scan.states))return note(`beam states at ${s.tick}`);
  if(s.scan.rangesM.some((v,k)=>{const w=t.scan.rangesM[k];return v===null||w===null||w===undefined?v!==w:Math.abs(v-w)>tol.lidar;}))note(`ranges at ${s.tick}`);});
 return {match:!out.length,mismatches:out};
}
