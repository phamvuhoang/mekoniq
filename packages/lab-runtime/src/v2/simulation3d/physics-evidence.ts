/** Independent physics stream. ACK append fsyncs a bounded WAL before the runner may commit.
 * Only immutable, hashed published chunks are readable evidence; a WAL/crash intent is a coverage failure.
 * Profile identities are SHA-256 of admitted file bytes, independently of each document's canonical digest. */
import {createHash,randomBytes} from 'node:crypto';
import {lstat,mkdir,open,readFile,readdir,realpath,unlink} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {READ_LIMITS,EVIDENCE_LIMITS,writeDurable} from '../navigation2d/evidence';
import {validatePhysicsTickShape,validatePhysicsEvidenceShape,type PhysicsEvidenceV1,type PhysicsTickRecord,type NavigationSceneV1,type LoadProfileV1,type RobotPhysicalModelV1} from '../navigation2d/contracts';
import {validateLoadProfile} from './load-profile';
import {rollPitch} from './physics-metrics';
import {hashJson} from '../hash';
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const MANIFEST='manifest.json',WAL='pending.ndjson',INTENT='write.intent',NAME=/^physics-\d{6}-[a-f0-9]{8}\.ndjson\.gz$/;
export interface PhysicsAdmission {maxAbsRollPitchRad?:number;robotId:string;props:{propId:string;supportId:string|null}[];contactIds:string[];tickMs:number;substeps:number;driveFrameInBase:{xyzM:number[];quaternionXyzw:number[]}}
export interface PhysicsRead {complete:boolean;records:PhysicsTickRecord[];gaps:PhysicsEvidenceV1['gaps'];issues:string[]}
export interface PhysicsRecorderOptions {directory:string;identity:PhysicsEvidenceV1['identity'];admission:PhysicsAdmission;metricsPolicyDigest:string;assumptions:PhysicsEvidenceV1['assumptions'];maxBytes?:number;maxTicks?:number;chunkTicks?:number}
export interface PhysicsRecorder {directory:string;append(record:PhysicsTickRecord):Promise<void>;flush():Promise<void>;finish(reason:string|null):Promise<void>;gap(firstTick:number,lastTick:number,reason:string):Promise<void>;manifest():PhysicsEvidenceV1}
/** Byte verified closure already admitted by lockScene; verify again here rather than trusting observation IDs. */
export async function preparePhysicsAdmission(scene:NavigationSceneV1,read:(path:string)=>Promise<Uint8Array>){
 if(scene.engine.id!=='mujoco_3d'||scene.robots.length!==1||scene.clock.tickMs!==20||scene.engine.substeps!==10||scene.engine.timestepMs!==2||!scene.engine.stopPolicyRef)throw new Error('PHYSICS_PROFILE_UNSUPPORTED');
 const doc=async(ref:{path:string;sha256:string})=>{const f=scene.files.find(f=>f.path===ref.path),b=await read(ref.path);if(!f||f.sha256!==ref.sha256||f.bytes!==b.length||sha(b)!==ref.sha256)throw new Error('PHYSICS_PROFILE_HASH_MISMATCH');return JSON.parse(Buffer.from(b).toString());};
 const load=await doc(scene.engine.loadProfileRef) as LoadProfileV1;if(!validateLoadProfile(load).ok)throw new Error('PHYSICS_LOAD_INVALID');
 const physical=await doc(load.modelRef) as RobotPhysicalModelV1,robot=scene.robots[0]!;
 const policy=await doc(scene.engine.stopPolicyRef);
 const admission:PhysicsAdmission={maxAbsRollPitchRad:policy.maxAbsRollPitchRad,robotId:robot.robotId,props:load.props.map(p=>({propId:p.propId,supportId:p.attachment.kind==='free'?p.attachment.supportId:null})),contactIds:['floor',...physical.links.flatMap(l=>l.collision.map((_,i)=>`${robot.robotId}/${l.id}/c${i}`)),...load.props.map(p=>`prop/${p.propId}`),...[...scene.world.obstacles,...scene.world.boundaries].map(o=>`static/${o.id}`)],tickMs:20,substeps:10,driveFrameInBase:robot.model.driveFrameInBase};
 return {admission,assumptions:load.assumptions,metricsPolicyDigest:scene.engine.stopPolicyRef.sha256,loadProfileDigest:scene.engine.loadProfileRef.sha256,physicsProfileDigest:scene.engine.physicsProfileRef.sha256};
}
export function validatePhysicsRecord(input:unknown,a:PhysicsAdmission,expectedTick?:number):asserts input is PhysicsTickRecord{
 if(!validatePhysicsTickShape(input))throw new Error('PHYSICS_OBSERVATION_INVALID');
 const r=input as PhysicsTickRecord,fail=()=>{throw new Error('PHYSICS_OBSERVATION_INVALID');};
 if(a.tickMs!==20||a.substeps!==10||r.tick>EVIDENCE_LIMITS.maxTicks||(expectedTick!==undefined&&r.tick!==expectedTick)||r.simTimeNs!==String(BigInt(r.tick)*BigInt(a.tickMs)*1_000_000n))fail();
 const finite=(x:unknown):boolean=>typeof x==='number'?Number.isFinite(x):Array.isArray(x)?x.every(finite):x!==null&&typeof x==='object'?Object.values(x).every(finite):true;
 const pose=(p:{positionM:number[];quaternionXyzw:number[]})=>Number.isFinite(Math.hypot(...p.quaternionXyzw))&&Math.abs(Math.hypot(...p.quaternionXyzw)-1)<1e-6;
 if(!finite(r)||[r.base,r.wheels,r.odometry].some(xs=>xs.length!==1||xs[0]!.robotId!==a.robotId)||r.loads.length!==a.props.length||new Set(r.loads.map(p=>p.propId)).size!==a.props.length)fail();
 if(r.wheels[0]!.saturatedSubsteps>a.substeps)fail();
 for(const b of r.base){if(!pose(b.poseMap))fail();const [roll,pitch]=rollPitch(b.poseMap.quaternionXyzw);if(Math.abs(Math.atan2(Math.sin(roll-b.rollRad),Math.cos(roll-b.rollRad)))>1e-6||Math.abs(pitch-b.pitchRad)>1e-6)fail();}
 for(const l of r.loads){const p=a.props.find(p=>p.propId===l.propId);if(!p||p.supportId!==l.supportId||!pose(l.poseMap)||(p.supportId!==null&&!l.poseInSupport)||(l.poseInSupport&&!pose(l.poseInSupport)))fail();}
 const pairs=new Set<string>();for(const c of r.contacts){const key=JSON.stringify([c.a,c.b]);if(c.a>=c.b||!a.contactIds.includes(c.a)||!a.contactIds.includes(c.b)||pairs.has(key)||c.samples>a.substeps||c.normalImpulseNs>c.peakNormalN*c.samples*.002+1e-9)fail();pairs.add(key);}
}
async function sizeOf(dir:string){let bytes=0;for(const name of await readdir(dir)){const st=await lstat(join(dir,name));if(!st.isFile())throw new Error('PHYSICS_PATH_REJECTED');bytes+=st.size;}return bytes;}
async function boundedFile(root:string,name:string,max:number){
 const file=join(root,name),st=await lstat(file);if(!st.isFile()||st.size>max)throw new Error('PHYSICS_READ_LIMIT_OR_PATH');
 const realRoot=await realpath(root),real=await realpath(file);if(!real.startsWith(realRoot+sep))throw new Error('PHYSICS_PATH_REJECTED');
 const b=await readFile(file);if(b.length!==st.size||b.length>max)throw new Error('PHYSICS_READ_LIMIT');return b;
}
export async function readPhysicsManifest(root:string):Promise<PhysicsEvidenceV1>{
 const m:unknown=JSON.parse((await boundedFile(root,MANIFEST,READ_LIMITS.manifestBytes)).toString());if(!validatePhysicsEvidenceShape(m))throw new Error('PHYSICS_MANIFEST_INVALID');return m as PhysicsEvidenceV1;
}
export async function openPhysicsRecorder(o:PhysicsRecorderOptions):Promise<PhysicsRecorder>{
 const maxBytes=o.maxBytes??EVIDENCE_LIMITS.maxBytes,maxTicks=o.maxTicks??EVIDENCE_LIMITS.maxTicks,chunkTicks=o.chunkTicks??250;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>EVIDENCE_LIMITS.maxBytes||!Number.isSafeInteger(maxTicks)||maxTicks<0||maxTicks>EVIDENCE_LIMITS.maxTicks||!Number.isSafeInteger(chunkTicks)||chunkTicks<1||chunkTicks>30000)throw new Error('PHYSICS_LIMIT_INVALID');
 await mkdir(o.directory,{recursive:true,mode:0o700});
 let m:PhysicsEvidenceV1={schemaVersion:1,documentType:'physics-evidence',identity:structuredClone(o.identity),streams:[{stream:'physics',chunks:[]}],coverage:{firstTick:0,lastTick:0,complete:false},gaps:[],terminalReason:null,metricsPolicyDigest:o.metricsPolicyDigest,assumptions:o.assumptions};
 let queue:Promise<void>=Promise.resolve();
 const serial=(fn:()=>Promise<void>)=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
 let last=-1,lines:string[]=[],inflated=0,totalInflated=0,closed=false;
 // Every atomic publication temporarily coexists with all existing bytes, including its old
 // target and any orphan/tmp file. Reserve one worst-case terminal + gap document before
 // healthy writes: JSON control-character escapes cost six bytes per UTF-16 code unit.
 const quota=async(extra:number)=>{if(await sizeOf(o.directory)+extra>maxBytes)throw new Error('PHYSICS_QUOTA_EXCEEDED');};
 const intentBytes=Buffer.byteLength(JSON.stringify({lastTick:Number.MAX_SAFE_INTEGER}));
 const reserve=(manifest:PhysicsEvidenceV1)=>manifest.terminalReason?0:Buffer.byteLength(JSON.stringify({...manifest,coverage:{...manifest.coverage,complete:false},terminalReason:'\u0000'.repeat(200),gaps:[...manifest.gaps,{firstTick:Number.MAX_SAFE_INTEGER,lastTick:Number.MAX_SAFE_INTEGER,reason:'\u0000'.repeat(200)}]}))+intentBytes;
 const publish=async(name:string,bytes:Uint8Array|string,extra=0)=>{await quota(Buffer.byteLength(bytes)+extra);await writeDurable(o.directory,name,bytes);};
 const save=()=>publish(MANIFEST,JSON.stringify(m),reserve(m));
 if((await readdir(o.directory)).length){const old=await readPhysicsManifest(o.directory);if(!validatePhysicsEvidenceShape(old)||hashJson(old.identity)!==hashJson(o.identity))throw new Error('PHYSICS_IDENTITY_MISMATCH');m=old as PhysicsEvidenceV1;m.coverage.complete=false;m.terminalReason??='PHYSICS_RESTART';closed=true;await save();}
 else await save();
 const end=async(reason:string)=>{m.terminalReason??=reason.slice(0,200);m.coverage.complete=false;closed=true;await save().catch(()=>{});};
 const flush=async()=>{
  if(!lines.length)return;
  const bytes=gzipSync(lines.join('')),chunks=m.streams[0]!.chunks;
  if(chunks.length>=READ_LIMITS.chunksPerStream||bytes.length>READ_LIMITS.chunkBytes||totalInflated+inflated>READ_LIMITS.totalInflated)throw new Error('PHYSICS_READ_LIMIT');
  const path=`physics-${String(chunks.length).padStart(6,'0')}-${randomBytes(4).toString('hex')}.ndjson.gz`,next=structuredClone(m),intent=JSON.stringify({lastTick:last});
  next.streams[0]!.chunks.push({path,sha256:sha(bytes),bytes:bytes.length});next.coverage.lastTick=last;next.coverage.complete=!next.terminalReason&&!next.gaps.length;
  await quota(bytes.length+Buffer.byteLength(intent)+Buffer.byteLength(JSON.stringify(next))+reserve(next));
  await publish(INTENT,intent);await publish(path,bytes);m=next;
  await save();await publish(WAL,'');await unlink(join(o.directory,INTENT));totalInflated+=inflated;inflated=0;lines=[];
 };
 return {directory:o.directory,manifest:()=>structuredClone(m),append(record){return serial(async()=>{
  if(closed||m.terminalReason)throw new Error('PHYSICS_RECORDER_TERMINAL');
  const attempted=last+1;
  try{validatePhysicsRecord(record,o.admission,last+1);if(record.tick>maxTicks)throw new Error('PHYSICS_TICK_LIMIT');const line=JSON.stringify(record)+'\n',n=Buffer.byteLength(line);if(n>READ_LIMITS.lineBytes)throw new Error('PHYSICS_READ_LIMIT');if(inflated+n>12*1024*1024)await flush();await quota(n+reserve(m));
   const h=await open(join(o.directory,WAL),'a',0o600);try{await h.writeFile(line);await h.sync();}finally{await h.close();}const d=await open(o.directory,'r');try{await d.sync();}finally{await d.close();}
   lines.push(line);inflated+=n;last=record.tick;if(lines.length>=chunkTicks)await flush();
  }catch(e){const reason=(e as Error).message;m.gaps.push({firstTick:attempted,lastTick:Math.max(attempted,Number.isSafeInteger(record?.tick)?record.tick:attempted),reason:reason.slice(0,200)});await end(reason);throw e;}
 });},flush(){return serial(async()=>{try{await flush();}catch(e){await end((e as Error).message);throw e;}});},finish(reason){return serial(async()=>{if(reason)await end(reason);try{await flush();if(!reason)closed=true;}catch(e){await end((e as Error).message);throw e;}await save();});},gap(firstTick,lastTick,reason){return serial(async()=>{m.gaps.push({firstTick,lastTick,reason:reason.slice(0,200)});await end(reason);});}};
}
export async function readPhysicsEvidence(root:string,manifest:unknown,options?:{admission:PhysicsAdmission;identity?:PhysicsEvidenceV1['identity'];metricsPolicyDigest?:string;runTick?:number}):Promise<PhysicsRead>{
 const records:PhysicsTickRecord[]=[],issues:string[]=[],result=():PhysicsRead=>({complete:!issues.length,records,gaps:validatePhysicsEvidenceShape(manifest)?(manifest as PhysicsEvidenceV1).gaps:[],issues});
 if(!validatePhysicsEvidenceShape(manifest)||Buffer.byteLength(JSON.stringify(manifest))>READ_LIMITS.manifestBytes){issues.push('PHYSICS_MANIFEST_INVALID');return result();}
 const m=manifest as PhysicsEvidenceV1,refs=m.streams[0]?.chunks??[];
 if(!options?.admission){issues.push('PHYSICS_ADMISSION_REQUIRED');return result();}
 if(options.metricsPolicyDigest&&options.metricsPolicyDigest!==m.metricsPolicyDigest)issues.push('PHYSICS_POLICY_MISMATCH');
 if(options.identity&&hashJson(options.identity)!==hashJson(m.identity))issues.push('PHYSICS_IDENTITY_MISMATCH');
 if(!m.coverage.complete||m.gaps.length||m.terminalReason)issues.push('PHYSICS_COVERAGE_INCOMPLETE');
 if(refs.length>READ_LIMITS.chunksPerStream||m.coverage.firstTick!==0||m.coverage.lastTick>EVIDENCE_LIMITS.maxTicks){issues.push('PHYSICS_READ_LIMIT');return result();}
 try{if(await sizeOf(root)>EVIDENCE_LIMITS.maxBytes)throw new Error('PHYSICS_QUOTA_EXCEEDED');if((await lstat(join(root,WAL)).catch(()=>null))?.size||await lstat(join(root,INTENT)).catch(()=>null))issues.push('PHYSICS_UNPUBLISHED_TAIL');}catch(e){issues.push((e as Error).message);return result();}
 let inflated=0;const names=new Set<string>();
 for(const ref of refs){try{
  if(!NAME.test(ref.path)||names.has(ref.path))throw new Error('PHYSICS_PATH_REJECTED');names.add(ref.path);
  if(ref.bytes>READ_LIMITS.chunkBytes)throw new Error('PHYSICS_READ_LIMIT');const b=await boundedFile(root,ref.path,READ_LIMITS.chunkBytes);if(b.length!==ref.bytes||sha(b)!==ref.sha256)throw new Error('PHYSICS_HASH_MISMATCH');
  const body=gunzipSync(b,{maxOutputLength:Math.min(READ_LIMITS.chunkInflated,READ_LIMITS.totalInflated-inflated)});inflated+=body.length;
  const text=body.toString('utf8');if(!text.endsWith('\n'))throw new Error('PHYSICS_TRUNCATED');const lines=text.slice(0,-1).split('\n');if(lines.length>READ_LIMITS.linesPerChunk)throw new Error('PHYSICS_READ_LIMIT');
  for(const line of lines){if(Buffer.byteLength(line)>READ_LIMITS.lineBytes||records.length> EVIDENCE_LIMITS.maxTicks)throw new Error('PHYSICS_READ_LIMIT');const r:unknown=JSON.parse(line);validatePhysicsRecord(r,options.admission,records.length);records.push(r);}
 }catch(e){issues.push((e as Error).message);break;}}
 if(!records.length||records.at(-1)!.tick!==m.coverage.lastTick||(options.runTick!==undefined&&records.at(-1)?.tick!==options.runTick))issues.push('PHYSICS_COVERAGE_MISMATCH');
 return result();
}
