/** Complete shared-world observations. Raw tick zero includes the one priming interval;
 * interval metrics use (0,lastTick]. Source lifecycle records are facts about physical
 * birth/removal, never a receipt for grip, handoff, withdrawal or business custody. */
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,open,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {WorldEvidenceV1,WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import {validateWorldEvidenceShape,validateWorldEvidenceRecordShape,type Sim3DSnapshotV1,type LabWorldSceneV1} from '../navigation2d/contracts';
import {EVIDENCE_LIMITS,READ_LIMITS,writeDurable} from '../navigation2d/evidence';
import {physicsDirectoryBytes,readBoundedPhysicsFile,validatePhysicsRecord,type PhysicsAdmission} from './physics-evidence';
import {activeWorldProps,validateWorldScene,validateWorldObservation,type WorldInteractionIntent} from './world-scene';
import type {WorldFailure,WorldTickCommand} from './world-ports';
import {hashJson} from '../hash';
/** The same free-joint pose and matrix pose differ at floating-point roundoff; q and -q are equivalent. No raw values are changed. */
export const WORLD_POSE_CONSISTENCY_TOLERANCE=1e-10;
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
export interface WorldAdmission {scene:LabWorldSceneV1;physics:PhysicsAdmission;modelCounts:{nbody:number;ngeom:number};digest:string}
export function prepareWorldAdmission(scene:LabWorldSceneV1,files:ReadonlyMap<string,Uint8Array>):WorldAdmission {
 validateWorldScene(scene);for(const f of scene.files){const b=files.get(f.path);if(!b||b.length!==f.bytes||sha(b)!==f.sha256)throw Error('WORLD_CLOSURE_INVALID');}
 const doc=(path:string)=>JSON.parse(Buffer.from(files.get(path)!).toString()) as {links:{id:string;collision:unknown[]}[]};
 const mobile=doc(scene.models.mobilePhysical.path),arm=doc(scene.models.armComponent.path),rid=scene.navigation.robots[0]!.robotId,aid=scene.armCell.arm.armId;
 const physics:PhysicsAdmission={robotId:rid,props:[],contactIds:['floor',...mobile.links.flatMap(l=>l.collision.map((_,i)=>`${rid}/${l.id}/c${i}`)),...arm.links.flatMap(l=>l.collision.map((_,i)=>`${aid}/${l.id}/c${i}`)),`${aid}/palm`,`${aid}/pad/0`,`${aid}/pad/1`,...scene.armCell.supports.filter(s=>s.id!==scene.supportMap.replacedStaticSupportId).map(s=>`support/${s.id}`),...scene.armCell.statics.map(s=>`static/${s.id}`),...[...scene.navigation.world.boundaries,...scene.navigation.world.obstacles].map(s=>`static/${s.id}`),...scene.propBindings.map(p=>`prop/${p.propId}`)],tickMs:20,substeps:10,driveFrameInBase:scene.navigation.robots[0]!.model.driveFrameInBase};
 const modelCounts={nbody:1+arm.links.length+mobile.links.length+scene.propBindings.length,ngeom:1+arm.links.reduce((n,l)=>n+l.collision.length,0)+3+mobile.links.reduce((n,l)=>n+l.collision.length,0)+scene.armCell.supports.length-1+scene.armCell.statics.length+scene.navigation.world.boundaries.length+scene.navigation.world.obstacles.length+scene.propBindings.length};
 return {scene:structuredClone(scene),physics,modelCounts,digest:hashJson({scene,physics,modelCounts} as never)};
}
const pose=(s:Sim3DSnapshotV1|undefined,id:string)=>{const p=s?.props?.find(p=>p.propId===id);return p?{position:p.position,quaternionXyzw:p.quaternionXyzw}:null;};
function validateRecord(r:WorldEvidenceRecord,a:WorldAdmission,history:WorldInteractionIntent[],previous:Sim3DSnapshotV1|undefined,identity:{runId:string;bootId:string}){
 if(!validateWorldEvidenceRecordShape(r))throw Error('WORLD_EVIDENCE_RECORD_INVALID');
 const s=r.snapshot,c=r.command,tick=previous?previous.tick+1:0;
 if((previous&&s.worldStep?.workerPid!==previous.worldStep?.workerPid)||s.seq!==String(tick+1)||s.tick!==tick||s.runId!==identity.runId||s.bootId!==identity.bootId||(tick===0?c!==null:!c||c.targetTick!==tick))throw Error('WORLD_EVIDENCE_IDENTITY_INVALID');
 const placements=c?.propPlacements??[],intents=c?.worldInteractions??[];
 if(intents.length!==placements.length||r.interactions.length!==intents.length)throw Error('WORLD_INTERACTION_MISSING');
 const next=[...history];
 for(let i=0;i<intents.length;i++){
  const intent=intents[i]!,p=placements[i]!,record=r.interactions[i]!;
  if(intent.targetTick!==tick||p.propId!==intent.propId||(intent.kind==='birth')!==(p.pose!==null)||record.eventId!==intent.eventId||record.cupId!==intent.cupId||record.propId!==intent.propId||record.kind!==intent.kind||record.tick!==tick||record.commandDigest!==hashJson(c as never)||hashJson(record.before as never)!==hashJson(pose(previous,intent.propId) as never)||hashJson(record.after as never)!==hashJson(pose(s,intent.propId) as never)||(intent.kind==='birth'?(record.before!==null||record.after===null):(record.before===null||record.after!==null)))throw Error('WORLD_INTERACTION_INVALID');
  next.push({eventId:intent.eventId,cupId:intent.cupId,propId:intent.propId,kind:intent.kind,tick});
 }
 validateWorldObservation(s,a.scene,next);if(s.worldStep!.nbody!==a.modelCounts.nbody||s.worldStep!.ngeom!==a.modelCounts.ngeom)throw Error('WORLD_MODEL_COUNTS_INVALID');if(!s.physics)throw Error('WORLD_PHYSICS_REQUIRED');
 const ids=activeWorldProps(a.scene,next,tick);validatePhysicsRecord(s.physics,{...a.physics,props:ids.map(propId=>({propId,supportId:a.scene.supportMap.mobileSupportId}))},tick);
 for(const p of s.props??[]){const l=s.physics.loads.find(l=>l.propId===p.propId)!;if(Math.hypot(...l.poseMap.positionM.map((v,i)=>v-p.position[i]!))>WORLD_POSE_CONSISTENCY_TOLERANCE||Math.min(Math.hypot(...l.poseMap.quaternionXyzw.map((v,i)=>v-p.quaternionXyzw[i]!)),Math.hypot(...l.poseMap.quaternionXyzw.map((v,i)=>v+p.quaternionXyzw[i]!)))>WORLD_POSE_CONSISTENCY_TOLERANCE)throw Error('WORLD_PROP_OBSERVATION_MISMATCH');}
 return next;
}
export async function openWorldRecorder(o:{directory:string;admission:WorldAdmission;runId:string;bootId:string;maxBytes?:number;chunkTicks?:number}){
 const max=o.maxBytes??EVIDENCE_LIMITS.maxBytes,chunkTicks=o.chunkTicks??250;
 if(!Number.isSafeInteger(max)||max<1||max>EVIDENCE_LIMITS.maxBytes||!Number.isSafeInteger(chunkTicks)||chunkTicks<1||chunkTicks>30000)throw Error('WORLD_EVIDENCE_LIMIT_INVALID');
 await mkdir(o.directory,{recursive:true,mode:0o700});if((await readdir(o.directory)).length)throw Error('WORLD_EVIDENCE_RESTART_UNKNOWN');
 let m:WorldEvidenceV1={schemaVersion:1,documentType:'world-evidence',runId:o.runId,bootId:o.bootId,sceneDigest:o.admission.scene.sceneDigest,admissionDigest:o.admission.digest,chunks:[],lastTick:-1,complete:false,terminal:null,gaps:[]};
 let lines:string[]=[],bytes=0,totalInflated=0,previous:Sim3DSnapshotV1|undefined,history:WorldInteractionIntent[]=[],closed=false,sourceFailure=false,queue:Promise<void>=Promise.resolve();
 const serial=(f:()=>Promise<void>)=>{const p=queue.then(f);queue=p.catch(()=>{});return p;};
 // Reuse B03 path/byte guards and atomic fsync publication. Reserve one worst-case
 // terminal record before admitting any bytes, including temporary publication copies.
 const reserve=()=>Buffer.byteLength(JSON.stringify({...m,terminal:'\u0000'.repeat(200),gaps:[...m.gaps,{targetTick:30000,lastCommittedTick:30000,ackTick:30000,reason:'\u0000'.repeat(200)}]}))+64;
 const quota=async(extra:number)=>{if(await physicsDirectoryBytes(o.directory)+extra>max)throw Error('WORLD_EVIDENCE_QUOTA_EXCEEDED');};
 const save=async()=>{const b=JSON.stringify(m);if(Buffer.byteLength(b)>READ_LIMITS.manifestBytes)throw Error('WORLD_EVIDENCE_READ_LIMIT');await quota(Buffer.byteLength(b)+(m.terminal?0:reserve()));await writeDurable(o.directory,'manifest.json',b);};
 // Append/finish know only their local observation horizon. The Source owner may
 // replace that provisional failure once with its authoritative logical boundary.
 const fail=async(f:WorldFailure,sourceOwned=false)=>{if(!m.terminal||(sourceOwned&&!sourceFailure)){m.terminal=f.reason.slice(0,200)||'WORLD_UNKNOWN';m.gaps=[{...f,reason:m.terminal}];sourceFailure=sourceOwned;}m.complete=false;closed=true;await save();};
 const flush=async()=>{if(!lines.length)return;const b=gzipSync(lines.join(''));if(b.length>READ_LIMITS.chunkBytes||m.chunks.length>=READ_LIMITS.chunksPerStream||totalInflated+bytes>READ_LIMITS.totalInflated)throw Error('WORLD_EVIDENCE_READ_LIMIT');
  const ref={path:`world-${String(m.chunks.length).padStart(6,'0')}-${randomBytes(4).toString('hex')}.ndjson.gz`,sha256:sha(b),bytes:b.length,firstTick:m.lastTick+1,lastTick:previous!.tick};
  const next={...m,chunks:[...m.chunks,ref],lastTick:ref.lastTick,complete:false};await quota(b.length+64+Buffer.byteLength(JSON.stringify(next))+reserve());
  await writeDurable(o.directory,'write.intent',JSON.stringify({lastTick:ref.lastTick}));await writeDurable(o.directory,ref.path,b);m=next;
  // The new manifest owns these rows, even if publication or subsequent cleanup
  // throws. A terminal save/finish must never publish the same rows a second time.
  totalInflated+=bytes;lines=[];bytes=0;await save();await writeDurable(o.directory,'pending.ndjson','');await unlink(join(o.directory,'write.intent'));
 };
 await save();
 return {manifest:()=>structuredClone(m),append(snapshot:Sim3DSnapshotV1,command:WorldTickCommand|null){return serial(async()=>{if(closed)throw Error('WORLD_EVIDENCE_TERMINAL');const lastCommittedTick=previous?.tick??0,targetTick=Math.min(30000,previous?previous.tick+1:0);try{
  const interactions=(command?.worldInteractions??[]).map(i=>({eventId:i.eventId,cupId:i.cupId,propId:i.propId,kind:i.kind,tick:i.targetTick,commandDigest:hashJson(command as never),reason:(i.eventId.startsWith('rig:')?(i.kind==='birth'?'rig_birth':'rig_removal'):(i.kind==='birth'?'source_nozzle_birth':'source_recipient_removal')) as WorldEvidenceRecord['interactions'][number]['reason'],before:pose(previous,i.propId),after:pose(snapshot,i.propId)}));
  const r:WorldEvidenceRecord={snapshot,command,interactions},next=validateRecord(r,o.admission,history,previous,o),line=JSON.stringify(r)+'\n',n=Buffer.byteLength(line);
  if(n>READ_LIMITS.lineBytes||totalInflated+bytes+n>READ_LIMITS.totalInflated)throw Error('WORLD_EVIDENCE_READ_LIMIT');if(bytes+n>12*1024*1024)await flush();await quota(n+reserve());
  const h=await open(join(o.directory,'pending.ndjson'),'a',0o600);try{await h.writeFile(line);await h.sync();}finally{await h.close();}const dir=await open(o.directory,'r');try{await dir.sync();}finally{await dir.close();}
  lines.push(line);bytes+=n;previous=structuredClone(snapshot);history=next;if(lines.length>=chunkTicks)await flush();
 }catch(e){await fail({targetTick,lastCommittedTick,ackTick:snapshot.tick,reason:(e as Error).message}).catch(()=>{});throw e;}});},fail(f:WorldFailure){return serial(()=>fail(f,true));},finish(){return serial(async()=>{try{await flush();closed=true;m.complete=!!previous&&!m.terminal&&!m.gaps.length;await save();}catch(e){await fail({targetTick:previous?.tick??0,lastCommittedTick:previous?.tick??0,ackTick:previous?.tick??null,reason:(e as Error).message}).catch(()=>{});throw e;}});}};
}
export async function readWorldEvidence(directory:string,admission:WorldAdmission){
 const records:WorldEvidenceRecord[]=[],issues:string[]=[];let history:WorldInteractionIntent[]=[];
 try{const m:WorldEvidenceV1=JSON.parse((await readBoundedPhysicsFile(directory,'manifest.json',READ_LIMITS.manifestBytes)).toString());if(!validateWorldEvidenceShape(m)||m.sceneDigest!==admission.scene.sceneDigest||m.admissionDigest!==admission.digest)throw Error('WORLD_EVIDENCE_MANIFEST_INVALID');if(!m.complete||m.terminal||m.gaps.length)issues.push('WORLD_EVIDENCE_INCOMPLETE');
  if(await physicsDirectoryBytes(directory)>EVIDENCE_LIMITS.maxBytes)throw Error('WORLD_EVIDENCE_QUOTA_EXCEEDED');const names=await readdir(directory);if(names.includes('write.intent')||(names.includes('pending.ndjson')&&(await readBoundedPhysicsFile(directory,'pending.ndjson',12*1024*1024)).length))issues.push('WORLD_EVIDENCE_UNPUBLISHED');let inflated=0;const seen=new Set<string>();
  for(const ref of m.chunks){if(seen.has(ref.path)||ref.firstTick!==records.length)throw Error('WORLD_EVIDENCE_ORDER');seen.add(ref.path);const b=await readBoundedPhysicsFile(directory,ref.path,READ_LIMITS.chunkBytes);if(b.length!==ref.bytes||sha(b)!==ref.sha256)throw Error('WORLD_EVIDENCE_HASH_MISMATCH');const raw=gunzipSync(b,{maxOutputLength:Math.min(READ_LIMITS.chunkInflated,READ_LIMITS.totalInflated-inflated)});inflated+=raw.length;const text=raw.toString();if(!text.endsWith('\n'))throw Error('WORLD_EVIDENCE_TRUNCATED');const lines=text.slice(0,-1).split('\n');if(lines.length>READ_LIMITS.linesPerChunk)throw Error('WORLD_EVIDENCE_READ_LIMIT');for(const line of lines){if(Buffer.byteLength(line)>READ_LIMITS.lineBytes||records.length>EVIDENCE_LIMITS.maxTicks)throw Error('WORLD_EVIDENCE_READ_LIMIT');const r:WorldEvidenceRecord=JSON.parse(line);history=validateRecord(r,admission,history,records.at(-1)?.snapshot,m);records.push(r);}if(records.at(-1)?.snapshot.tick!==ref.lastTick)throw Error('WORLD_EVIDENCE_ORDER');}
  if(!records.length||records.at(-1)!.snapshot.tick!==m.lastTick)issues.push('WORLD_EVIDENCE_COVERAGE');
 }catch(e){issues.push((e as Error).message);}return {complete:!issues.length,records,issues};
}
