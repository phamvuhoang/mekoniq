// Durable navigation evidence (workers-runtime §5). The plant record of one run, kept apart from the lossy TelemetryRecorder ring and from the business journal:
// per-tick pose/velocity/collision, the control ledger (what the source sent, at which observation tick), LiDAR publications at the sensor cadence, and the engine
// contact records. NDJSON lines, gzip chunks over tick ranges, SHA-256 of the stored bytes and an ordered manifest written atomically after the chunk is on disk.
// Readers verify every chunk (bytes, hash, gzip, line ticks, order, coverage) and report what is missing; nothing is repaired, adopted or guessed.
import {createHash,randomBytes} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {lstat,mkdir,open,readFile,realpath,rename} from 'node:fs/promises';
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
const CHUNK_NAME=/^(trajectory|sensors|control|collisions)-\d{6}-[0-9a-f]{8}\.ndjson\.gz$/,MANIFEST='manifest.json';

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
interface Manifest{schemaVersion:1;format:typeof EVIDENCE_FORMAT;runId:string;sceneDigest:string;chunks:Chunks;gaps:Gap[];terminal:string|null;lastTick:number|null;lastKey:string|null;bytes:number;boots:{bootId:string;firstTick:number}[]}

const sha256=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
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
 /** The committed manifest: only what is on disk. */
 committed():{chunks:Chunks;gaps:Gap[];terminal:string|null;lastTick:number|null;bytes:number};
}

/** Opens (or reopens after a crash) the run's recorder: committed chunks come from the manifest on disk; files it does not list are never adopted. */
export async function openNavigationRecorder(o:RecorderOptions):Promise<NavigationRecorder>{
 const dir=o.directory,maxBytes=o.maxBytes??EVIDENCE_LIMITS.maxBytes,maxTicks=o.maxTicks??EVIDENCE_LIMITS.maxTicks,chunkTicks=o.chunkTicks??250;
 await mkdir(dir,{recursive:true,mode:0o700});
 const raw=await readFile(join(dir,MANIFEST),'utf8').catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;});
 const m:Manifest=raw?JSON.parse(raw) as Manifest:{schemaVersion:1,format:EVIDENCE_FORMAT,runId:o.runId,sceneDigest:o.scene.sceneDigest,chunks:empty(),gaps:[],terminal:null,lastTick:null,lastKey:null,bytes:0,boots:[]};
 if(m.runId!==o.runId||m.sceneDigest!==o.scene.sceneDigest||m.format!==EVIDENCE_FORMAT)throw new Error('EVIDENCE_IDENTITY_MISMATCH');
 const every=new Map(o.scene.robots.flatMap(r=>r.model.sensors.map(s=>[`${r.robotId}/${s.id}`,s.publishEveryTicks] as const)));
 let buf:Record<EvidenceStream,{tick:number;line:string}[]>={trajectory:[],sensors:[],control:[],collisions:[]},last={tick:m.lastTick,key:m.lastKey},bufBoots:Manifest['boots']=[],writing=Promise.resolve();
 const saveManifest=async()=>{const text=JSON.stringify(m);await writeDurable(dir,MANIFEST,text);};
 const end=async(reason:string,gap?:Gap)=>{
  if(m.terminal)return;
  m.terminal=reason;if(gap&&gap.toTick>=gap.fromTick)m.gaps.push(gap);
  buf={trajectory:[],sensors:[],control:[],collisions:[]};bufBoots=[];
  await saveManifest().catch(()=>{}); // a failing disk may refuse this too: the terminal state is then also held in memory and the run stops
 };
 const bufferRange=():Gap|undefined=>{const t=buf.trajectory;return t.length?{fromTick:t[0]!.tick,toTick:t.at(-1)!.tick,reason:''}:undefined;};
 const doFlush=async(min:number)=>{
  if(m.terminal||!buf.trajectory.length||buf.trajectory.length<min)return;
  const range=bufferRange()!,seq=m.chunks.trajectory.length+1;
  const parts=STREAMS.flatMap(s=>buf[s].length?[{s,lines:buf[s],bytes:gzipSync(buf[s].map(x=>x.line+'\n').join(''))}]:[]);
  const add=parts.reduce((n,p)=>n+p.bytes.length,0);
  // the quota counts every stored byte: the chunks and the manifest that lists them
  if(m.bytes+add+JSON.stringify(m).length+256*(parts.length+1)>maxBytes)return end('EVIDENCE_QUOTA_EXCEEDED',{...range,reason:'EVIDENCE_QUOTA_EXCEEDED'});
  const refs:[EvidenceStream,ChunkRef][]=[];
  try{
   for(const p of parts){
    const path=`${p.s}-${String(seq).padStart(6,'0')}-${randomBytes(4).toString('hex')}.ndjson.gz`;
    await writeDurable(dir,path,p.bytes);
    refs.push([p.s,{path,sha256:sha256(p.bytes),bytes:p.bytes.length,firstTick:p.lines[0]!.tick,lastTick:p.lines.at(-1)!.tick}]);
   }
   for(const [s,r] of refs)m.chunks[s].push(r);
   m.bytes+=add;m.lastTick=last.tick;m.lastKey=last.key;m.boots.push(...bufBoots);
   await saveManifest();
  }catch(e){
   for(const [s,r] of refs){const i=m.chunks[s].indexOf(r);if(i>=0)m.chunks[s].splice(i,1);}
   return end(`EVIDENCE_WRITE_FAILED:${(e as NodeJS.ErrnoException).code??'IO'}`,{...range,reason:'EVIDENCE_WRITE_FAILED'});
  }
  buf={trajectory:[],sensors:[],control:[],collisions:[]};bufBoots=[];
 };
 const serial=<T>(f:()=>Promise<T>)=>{const p=writing.then(f);writing=p.then(()=>{},()=>{});return p;};
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
   if(last.tick!==null&&tick>last.tick+1)m.gaps.push({fromTick:last.tick+1,toTick:tick-1,reason:'TICK_GAP'});
   const boots=[...m.boots,...bufBoots];if(boots.at(-1)?.bootId!==s.bootId)bufBoots.push({bootId:s.bootId,firstTick:tick});
   buf.trajectory.push({tick,line:lines.trajectory});
   if(lines.control)buf.control.push({tick:tick-1,line:lines.control});
   for(const l of lines.sensors)buf.sensors.push({tick,line:l});
   for(const r of traj.robots)if(r.collisionIds.length)buf.collisions.push({tick,line:JSON.stringify({tick,robotId:r.robotId,collisionIds:r.collisionIds} satisfies CollisionRecord)});
   last={tick,key};
   if(buf.trajectory.length>=chunkTicks)await doFlush(0);
  }),
  flush:(min=0)=>serial(()=>doFlush(min)),
  gap:g=>serial(async()=>{if(g.toTick<g.fromTick)return;m.gaps.push(g);await saveManifest();}),
  terminate:reason=>serial(async()=>{await doFlush(0);await end(reason);}),
  committed:()=>structuredClone({chunks:m.chunks,gaps:m.gaps,terminal:m.terminal,lastTick:m.lastTick,bytes:m.bytes}),
 };
}

// ---- reading (pure artifact decoding; no worker, no source session) ----
export interface EvidenceIssue{path:string;code:string;detail:string}
export interface EvidenceRead{trajectory:TrajectoryRecord[];control:ControlRecord[];sensors:SensorRecord[];collisions:CollisionRecord[];issues:EvidenceIssue[];gaps:Gap[];horizon:number|null;complete:boolean;
 /** Uncompressed record text per stream, in tick order: what the normalized digests hash. */text:Record<EvidenceStream,string>}
type Parsed={text:string;records:{tick:number}[]};
const cache=new Map<string,Parsed>();
/** Reads one listed chunk inside `root`. The name must be a recorder chunk name (no directories, no traversal), the file a regular file inside the root (no symlink). */
async function readChunk(root:string,realRoot:string,ref:ChunkRef,issues:EvidenceIssue[]):Promise<Parsed|null>{
 const bad=(code:string,detail:string)=>{issues.push({path:String(ref.path),code,detail});return null;};
 if(typeof ref.path!=='string'||!CHUNK_NAME.test(ref.path))return bad('EVIDENCE_PATH_REJECTED','not a recorder chunk name');
 const file=join(root,ref.path);
 const st=await lstat(file).catch(()=>null);
 if(!st)return bad('EVIDENCE_CHUNK_MISSING','listed chunk is not on disk');
 if(!st.isFile())return bad('EVIDENCE_PATH_REJECTED','not a regular file');
 const real=await realpath(file);
 if(!real.startsWith(realRoot+sep))return bad('EVIDENCE_PATH_REJECTED','outside the recording root');
 const bytes=await readFile(file);
 if(bytes.length!==ref.bytes)return bad('EVIDENCE_CHUNK_TRUNCATED',`${bytes.length} bytes stored, ${ref.bytes} recorded`);
 const digest=sha256(bytes);
 if(digest!==ref.sha256)return bad('EVIDENCE_CHUNK_CORRUPT','stored bytes do not match the recorded SHA-256');
 const hit=cache.get(digest);if(hit)return hit;
 let lines:string[];
 try{lines=gunzipSync(bytes).toString('utf8').split('\n');}catch{return bad('EVIDENCE_CHUNK_CORRUPT','not a gzip stream');}
 if(lines.pop()!=='')return bad('EVIDENCE_CHUNK_CORRUPT','last record is not terminated');
 let records:{tick:number}[];
 try{records=lines.map(l=>JSON.parse(l) as {tick:number});}catch{return bad('EVIDENCE_CHUNK_CORRUPT','a record is not JSON');}
 if(!records.length||records.some((r,i)=>!Number.isSafeInteger(r.tick)||i>0&&r.tick<records[i-1]!.tick)||records[0]!.tick!==ref.firstTick||records.at(-1)!.tick!==ref.lastTick)return bad('EVIDENCE_CHUNK_CORRUPT','record ticks do not match the chunk range');
 const parsed={text:lines.map(l=>l+'\n').join(''),records};cache.set(digest,parsed);if(cache.size>4096)cache.delete(cache.keys().next().value!);
 return parsed;
}
/**
 * Verifies and decodes the chunks an evidence document (or the recorder's manifest) lists. A chunk that is missing, truncated, corrupted, out of order or outside the root
 * is reported and its records are left out; the trajectory must then cover every tick from 0 to the horizon or the read is incomplete.
 */
export async function readNavigationEvidence(root:string,listed:{chunks:Chunks;gaps?:Gap[];terminal?:string|null}):Promise<EvidenceRead>{
 const realRoot=await realpath(root),issues:EvidenceIssue[]=[],out={trajectory:[],control:[],sensors:[],collisions:[]} as unknown as Record<EvidenceStream,{tick:number}[]>,text={trajectory:'',sensors:'',control:'',collisions:''};
 for(const s of STREAMS){
  let prev=-1;
  for(const ref of listed.chunks[s]??[]){
   if(!(ref.firstTick>prev)){issues.push({path:String(ref.path),code:'EVIDENCE_CHUNK_ORDER',detail:`starts at ${ref.firstTick}, the previous chunk ended at ${prev}`});continue;}
   const p=await readChunk(root,realRoot,ref,issues);if(!p)continue;
   prev=ref.lastTick;for(const r of p.records)out[s].push(r);text[s]+=p.text;
  }
 }
 const traj=out.trajectory as TrajectoryRecord[],gaps=[...listed.gaps??[]];
 // every tick from 0 to the last recorded one exactly once; a hole is a gap whatever caused it
 let expect=0;
 for(const r of traj){if(r.tick>expect)gaps.push({fromTick:expect,toTick:r.tick-1,reason:'EVIDENCE_TICKS_MISSING'});if(r.tick<expect)issues.push({path:'trajectory',code:'EVIDENCE_TICK_DUPLICATE',detail:`tick ${r.tick}`});expect=Math.max(expect,r.tick+1);}
 const horizon=traj.length?traj.at(-1)!.tick:null;
 const merged=gaps.filter((g,i)=>gaps.findIndex(x=>x.fromTick===g.fromTick&&x.toTick===g.toTick)===i).sort((a,b)=>a.fromTick-b.fromTick);
 return {trajectory:traj,control:out.control as ControlRecord[],sensors:out.sensors as SensorRecord[],collisions:out.collisions as CollisionRecord[],issues,gaps:merged,horizon,
  complete:!issues.length&&!merged.length&&!listed.terminal&&horizon!==null,text};
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
 const reasons=[...read.issues.map(i=>i.code),...read.gaps.map(g=>`${g.reason}:${g.fromTick}-${g.toTick}`),...read.horizon===null?['NO_TRAJECTORY_RECORDED']:a.coverage==='complete'?[]:['ORACLE_COVERAGE_INCOMPLETE']].filter((x,i,l)=>l.indexOf(x)===i);
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
/** Assertions the evidence alone can decide. Repeatability needs a second run and stays not_run here; cross-platform stays not_run until a platform is qualified. */
export function evidenceAssertions(read:EvidenceRead,m:NavigationMetrics,runTick:number|null,terminal:string|null):Assertion[]{
 const reasons=m.coverageReasons.join(', ').slice(0,900)||'none';
 return [
  {id:'EVIDENCE_INTEGRITY',result:read.issues.length?'fail':'pass',detail:read.issues.length?`chunks failed verification: ${read.issues.map(i=>`${i.code} ${i.path}`).join('; ').slice(0,900)}`:'every listed chunk matched its size and SHA-256 and decoded in order'},
  {id:'EVIDENCE_COVERAGE',result:m.coverage==='complete'&&(runTick===null||read.horizon===runTick)?'pass':'inconclusive',detail:m.coverage==='complete'?`ticks 0..${read.horizon} recorded without a gap${runTick!==null&&read.horizon!==runTick?`; the run is at tick ${runTick}, later ticks are not yet durable`:''}`:`incomplete: ${reasons}`},
  {id:'EVIDENCE_LIMITS',result:terminal?'fail':'pass',detail:terminal?`recording ended early: ${terminal}`:`within ${EVIDENCE_LIMITS.maxTicks} ticks and the stored-bytes quota`},
  {id:'NO_PHYSICAL_CONTACT',result:m.coverage!=='complete'?'inconclusive':m.collisionEpisodes?'fail':'pass',detail:m.coverage!=='complete'?'not decidable without complete trajectory evidence':`${m.collisionEpisodes} contact episode(s) from engine_discrete/swept_oracle; ${m.safetyEnvelopeEpisodes} safety-envelope breach episode(s)`},
  {id:'SENSOR_PUBLICATIONS',result:m.sensorPublications.complete?'pass':m.sensorPublications.expected===0?'not_run':'inconclusive',detail:`${m.sensorPublications.recorded} of ${m.sensorPublications.expected} LiDAR publications recorded and verified`},
  {id:'REPEATABILITY_SAME_PLATFORM',result:'not_run',detail:'needs a rerun with the same lock, platform and seed; compare the normalized digests'},
  {id:'REPEATABILITY_CROSS_PLATFORM',result:'not_run',detail:'no second platform is qualified; only declared tolerances could be compared'},
 ];
}
const digestOf=(header:unknown,...texts:string[])=>{const h=createHash('sha256').update(JSON.stringify(header)+'\n');for(const t of texts)h.update(t).update('\u0000');return h.digest('hex');};
export function evidenceDigests(scene:NavigationSceneV1,id:Pick<EvidenceIdentity,'lockDigest'|'runSeed'|'controller'>,read:EvidenceRead,m:NavigationMetrics,assertions:readonly Assertion[]){
 const header={algorithm:DIGEST_ALGORITHM,sceneDigest:scene.sceneDigest,policy:scene.policy.hash,controller:id.controller,lockDigest:id.lockDigest,seed:{runSeed:id.runSeed,engineSeed:engineSeedOf(id.runSeed,scene).engineSeed},horizon:read.horizon,gaps:read.gaps,issues:read.issues.map(i=>i.code)};
 return {trajectoryDigest:digestOf({...header,stream:'trajectory+control+collisions'},read.text.trajectory,read.text.control,read.text.collisions),
  sensorDigest:digestOf({...header,stream:'sensors'},read.text.sensors),
  assertionDigest:hashJson({algorithm:DIGEST_ALGORITHM,assertions,episodes:m.episodes,coverage:m.coverage,horizon:m.horizon}),algorithm:DIGEST_ALGORITHM as typeof DIGEST_ALGORITHM,normalizedOmits:[...NORMALIZED_OMITS]};
}
/** The report extension (navigation-run-evidence-v1) for the evidence as read from disk now. Artifact paths are relative to the recording root. */
export function buildNavigationEvidence(scene:NavigationSceneV1,id:EvidenceIdentity,listed:{chunks:Chunks;terminal:string|null},read:EvidenceRead,m:NavigationMetrics,runTick:number|null):NavigationRunEvidenceV1{
 const assertions=evidenceAssertions(read,m,runTick,listed.terminal),{engineSeed,sensorSeeds}=engineSeedOf(id.runSeed,scene);
 const metric=(name:string,ok:boolean,why:string|null)=>({metric:name,status:ok?'available' as const:'unavailable' as const,reason:ok?null:(why??'EVIDENCE_INCOMPLETE').slice(0,500)});
 const why=m.coverageReasons.join(', ')||null,complete=m.coverage==='complete';
 return {schemaVersion:1,documentType:'navigation-run-evidence',runId:id.runId,sceneDigest:scene.sceneDigest,sceneRef:id.sceneRef,modelDigests:scene.robots.map(r=>r.model.modelDigest),
  policyRef:{id:scene.policy.id,revision:scene.policy.revision,hash:scene.policy.hash},controller:id.controller,
  engine:{id:'irsim_2d',version:id.engine.version,pythonVersion:id.engine.pythonVersion,platform:`${platform()}-${arch()}`,lockDigest:id.lockDigest},
  identity:{sourceCommit:id.sourceCommit,compilerVersion:scene.compilerVersion,sceneSchemaHash:scene.schemaHash,evidenceFormat:EVIDENCE_FORMAT,os:`${platform()} ${release()}`,arch:arch(),node:process.version},
  clock:{tickMs:20,tickHorizon:Math.min(read.horizon??0,EVIDENCE_LIMITS.maxTicks),businessEpochMs:id.businessEpochMs},
  seed:{runSeed:id.runSeed,engineSeed,engineSeedAlgorithm:'irsim-env-seed-v1',sensorSeeds,actorRng:id.actorRng,engineRng:{library:'numpy',version:id.numpyVersion,algorithm:'numpy.random.default_rng(engineSeed) PCG64, one generator per environment',seed:engineSeed}},
  validationReportRef:null,artifacts:structuredClone(listed.chunks),digests:evidenceDigests(scene,id,read,m,assertions),assertions,
  metricCoverage:[metric('travelledDistanceM',complete,why),metric('collisionEpisodes',complete,why),metric('minObstacleClearanceM',m.minClearanceM!==null,why),
   metric('minRobotSeparationM',m.minSeparationM!==null,complete?'ONE_ROBOT':why),metric('sensorPublications',m.sensorPublications.complete,why??'SENSOR_PUBLICATIONS_INCOMPLETE')],
  recordingGaps:read.gaps.slice(0,500),completeness:{status:read.complete?'complete':'incomplete',reasons:[...listed.terminal?[listed.terminal]:[],...m.coverageReasons].slice(0,50)},
  limitations:['planar kinematic plant (IR-SIM diff drive): no dynamics, contact physics or hardware behaviour','LiDAR publications are recorded at the sensor cadence (publishEveryTicks); the engine scan between publications is not recorded',
   'actor schedule: none (scripted actors arrive with C02); every control record carries its actorUpdates','cross-platform repeatability not qualified (not_run)']};
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
 if(a.control.length!==b.control.length||a.control.some((c,i)=>{const d=b.control[i]!;return c.tick!==d.tick||c.velocities.some((v,k)=>Math.abs(v.vMps-d.velocities[k]!.vMps)>tol.pose||Math.abs(v.omegaRadps-d.velocities[k]!.omegaRadps)>tol.pose);}))note('control ledger');
 if(a.sensors.length!==b.sensors.length)note(`sensors ${a.sensors.length} vs ${b.sensors.length}`);
 a.sensors.forEach((s,i)=>{const t=b.sensors[i];if(!t||t.tick!==s.tick||t.robotId!==s.robotId||JSON.stringify(t.scan.states)!==JSON.stringify(s.scan.states))return note(`beam states at ${s.tick}`);
  if(s.scan.rangesM.some((v,k)=>{const w=t.scan.rangesM[k];return v===null||w===null||w===undefined?v!==w:Math.abs(v-w)>tol.lidar;}))note(`ranges at ${s.tick}`);});
 return {match:!out.length,mismatches:out};
}
