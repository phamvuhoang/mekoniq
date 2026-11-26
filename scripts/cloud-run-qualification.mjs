// CL01 supplements an immutable R2a qualification. This checks stored evidence only;
// it never edits that qualification, deploys a service or grants human acceptance.
import {validateSupplement,checkDeployment} from './r4-cloud-evidence.mjs';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hex=/^[a-f0-9]{64}$/;
const safe=p=>typeof p==='string'&&/^[A-Za-z0-9_./-]+$/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const localGates=['G-MA1','G-MA2','G-RT1','G-RT2','G-UI1','G-INT4','G-REG3'];
const provenanceFiles=['api-enable.log','authorization.json','deploy-command.json','deploy-dry-run.log','deploy.log','export-reproducibility.json',
 'host-update-command.json','host-update.log','image-build.log','image-push.log','mock-project.json','provision.jsonl',
 ...[1,2,3,4].map(n=>`provision-${n}.log`),...['health','mock-report','mujoco-report','stream-reconnect','summary'].map(n=>`local-http-smoke/${n}.json`)];

export function checkCloudRunEvidence(read,r2aBytes){
 const errors=[],fail=(condition,code)=>{if(!condition)errors.push(code);};
 let checks,q;
 try{checks=JSON.parse(read('checksums.json'));q=JSON.parse(r2aBytes);}catch{return ['RECORD_INVALID'];}
 if(!checks||checks.algorithm!=='sha256'||!checks.files||Array.isArray(checks.files)||typeof checks.files!=='object'||!q)return ['RECORD_INVALID'];
 const files=new Map();
 for(const [path,digest] of Object.entries(checks.files)){
  if(!safe(path)){errors.push(`ARTIFACT_PATH_INVALID:${path}`);continue;}
  if(!hex.test(digest)){errors.push(`ARTIFACT_HASH_INVALID:${path}`);continue;}
  let bytes;try{bytes=read(path);}catch{bytes=null;}
  if(!bytes){errors.push(`ARTIFACT_MISSING:${path}`);continue;}
  if(sha(bytes)!==digest){errors.push(`ARTIFACT_HASH_MISMATCH:${path}`);continue;}
  files.set(path,bytes);
 }
 const parse=path=>{
  if(!files.has(path)){errors.push(`ARTIFACT_MISSING:${path}`);return null;}
  try{const value=JSON.parse(files.get(path));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{errors.push(`ARTIFACT_JSON_INVALID:${path}`);return null;}
 };
 const d=parse('deployment.json'),revision=parse('revision.json');
 fail(files.has('smoke.mjs'),'ARTIFACT_MISSING:smoke.mjs');
 for(const path of provenanceFiles)fail(files.has(path),`ARTIFACT_MISSING:${path}`);
 if(!d||!revision||errors.length)return [...new Set(errors)];
 if(!safe(d.cl01)||!d.cl01.endsWith('/summary.json'))return ['CL01_PATH_INVALID'];
 const dir=d.cl01.slice(0,-'/summary.json'.length);
 const s=parse(d.cl01),health=parse(`${dir}/health.json`),mock=parse(`${dir}/mock-report.json`),arm=parse(`${dir}/mujoco-report.json`),stream=parse(`${dir}/stream-reconnect.json`);
 fail(files.has(`${dir}.log`),`ARTIFACT_MISSING:${dir}.log`);
 if(errors.length)return [...new Set(errors)];
 fail(d.schema==='mekoniq-cloud-run-deployment/1'&&s.schema==='mekoniq-cloud-run-http-smoke/1','RECORD_INVALID');
 fail(d.accepted===false&&s.accepted===false&&q.accepted===false,'ACCEPTANCE_FORBIDDEN');
 fail(q.release==='r2a'&&q.identity?.identityStable===true&&localGates.every(g=>q.gates?.[g]?.status==='tested'&&q.gates[g].accepted===false),'R2A_NOT_TESTED');
 fail(d.qualification?.sha256===sha(r2aBytes)&&d.qualification?.candidateId===q.candidateId,'R2A_HASH_MISMATCH');
 const commit=q.identity?.before?.sourceCommit,pin=q.lab?.pin;
 fail(/^[a-f0-9]{40}$/.test(commit)&&hex.test(pin?.schemaHash)&&hex.test(pin?.artifactSha256)&&
  [pin?.sourceCommit,d.sourceCommit,s.expectedCommit,health.sourceCommit,mock.manifest?.sourceCommit,arm.manifest?.sourceCommit].every(c=>c===commit)&&
  d.labCommit===q.lab?.commit&&d.artifactSha256===pin?.artifactSha256&&[health.schemaHash,mock.schemaHash,arm.schemaHash].every(h=>h===pin?.schemaHash),'IDENTITY_MISMATCH');
 const env=Array.isArray(d.environment)?d.environment:[],value=name=>env.find(e=>e.name===name)?.value;
 let cloudUrl=false,validOrigin=false;try{const u=new URL(d.url);cloudUrl=u.protocol==='https:'&&u.hostname.endsWith('.run.app')&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&value('LAB_PUBLIC_HOST')===u.hostname;}catch{/* fails below */}
 try{const origin=value('LAB_ALLOW_ORIGIN'),u=new URL(origin);validOrigin=u.protocol==='https:'&&u.origin===origin;}catch{/* fails below */}
 fail(cloudUrl&&validOrigin&&typeof d.revision==='string'&&/^[a-z][a-z0-9-]{0,62}$/.test(d.revision)&&d.platform==='linux/amd64'&&/@sha256:[a-f0-9]{64}$/.test(d.image)&&revision.status?.imageDigest===d.image&&
  revision.metadata?.name===d.revision&&revision.status?.conditions?.some(c=>c.type==='Ready'&&c.status==='True')&&
  Array.isArray(d.traffic)&&d.traffic.filter(t=>t.percent>0).length===1&&d.traffic.some(t=>t.revisionName===d.revision&&t.percent===100)&&
  s.service===d.url&&s.origin===value('LAB_ALLOW_ORIGIN'),'DEPLOYMENT_MISMATCH');
 const secret=env.find(e=>e.name==='MEKONIQ_LAB_ACCESS_KEY');
 fail(secret&&secret.value===undefined&&typeof secret.valueFrom?.secretKeyRef?.name==='string','SECRET_REFERENCE_REQUIRED');
 fail(s.status==='tested'&&['health','pairing','streamReconnect','mock','mujoco'].every(k=>s.cases?.[k]==='tested'),'CL01_NOT_TESTED');
 fail(health.features?.bearer===true&&health.deployment?.bind==='public'&&health.backends?.some(b=>b.id==='mujoco_arm'&&b.installed===true&&b.reachable===true),'HEALTH_NOT_READY');
 fail(mock.manifest?.scenario?.id==='FD01'&&mock.manifest?.backendSetId==='mock-amr'&&mock.manifest?.mode==='mock'&&mock.manifest?.access==='simulated'&&mock.outcome?.status==='completed','MOCK_NOT_COMPLETED');
 fail(arm.manifest?.scenario?.id==='MJ-BV01'&&arm.manifest?.backendSetId==='engineering-mujoco-arm-v1'&&arm.manifest?.mode==='simulation'&&arm.manifest?.access==='simulated'&&
  arm.outcome?.status==='completed'&&arm.outcome?.served==='2'&&arm.outcome?.tick===4800&&s.mujoco?.tick===4800&&s.mujoco?.status==='completed'&&
  Number.isFinite(s.mujoco?.wallMs)&&s.mujoco.wallMs>0&&arm.arm?.armPlant?.engine==='mujoco_3d'&&arm.arm?.armPlant?.calibration==='not_calibrated'&&
  arm.manifest?.clock?.tickMs===20&&arm.outcome?.simTimeNs==='96000000000'&&arm.coffee?.armTrace?.stop===null&&Array.isArray(arm.attention)&&arm.attention.length===0&&
  Array.isArray(arm.coffee?.jobs)&&arm.coffee.jobs.length===2&&arm.coffee.jobs.every(j=>j.status==='delivered'&&!j.attentionReason&&typeof j.jobId==='string'&&j.jobId.length>0)&&
  new Set(arm.coffee.jobs.map(j=>j.jobId)).size===2,'MUJOCO_NOT_COMPLETED');
 fail(Array.isArray(s.cleanup)&&s.cleanup.length===2&&[mock.manifest?.runId,arm.manifest?.runId].every(id=>typeof id==='string'&&id.length>0&&s.cleanup.some(c=>c.runId===id&&c.archived===true)),'SMOKE_CLEANUP_INCOMPLETE');
 let contiguous=false;
 if(/^[0-9]+$/.test(stream.after)&&/^[0-9]+$/.test(stream.through)&&Array.isArray(stream.first)&&Array.isArray(stream.resumed)){
  const ids=stream.resumed.filter(e=>e.event==='business').map(e=>e.id);
  contiguous=ids.length>0&&ids.at(-1)===stream.through&&stream.first.some(e=>e.event==='business'&&e.id===stream.after)&&
   ![...stream.first,...stream.resumed].some(e=>e.event==='reset')&&ids.every((id,i)=>/^[0-9]+$/.test(id)&&BigInt(id)===BigInt(stream.after)+BigInt(i+1));
 }
 fail(contiguous,'STREAM_NOT_CONTIGUOUS');
 return [...new Set(errors)];
}

/** CLD03 supplements an immutable R4 record after ONE deployment ordered by the user. Stored evidence only: it never deploys, edits the record or accepts anything.
 * The producer records checksums, public runtime receipts, deployment readbacks and candidate artifacts. */
export const checkCloudRunR4Evidence=(read,r4Bytes)=>checkedSupplement(read,r4Bytes,validateSupplement);
/** checksums.json lists every file with its SHA-256; each is read and hashed before `validate(record, recordBytes, files)` sees it. */
function checkedSupplement(read,recordBytes,validate){
 const errors=[];let checks,q;
 try{checks=JSON.parse(read('checksums.json'));q=JSON.parse(recordBytes);}catch{return ['RECORD_INVALID'];}
 if(!checks||checks.algorithm!=='sha256'||!checks.files||typeof checks.files!=='object'||Array.isArray(checks.files)||!q)return ['RECORD_INVALID'];
 const files=new Map();
 for(const [path,digest] of Object.entries(checks.files)){
  if(!safe(path)){errors.push(`ARTIFACT_PATH_INVALID:${path}`);continue;}
  if(!hex.test(digest)){errors.push(`ARTIFACT_HASH_INVALID:${path}`);continue;}
  let bytes;try{bytes=read(path);}catch{bytes=null;}
  if(!bytes){errors.push(`ARTIFACT_MISSING:${path}`);continue;}
  if(sha(bytes)!==digest){errors.push(`ARTIFACT_HASH_MISMATCH:${path}`);continue;}
  files.set(path,bytes);
 }
 if(errors.length)return errors;
 try{validate(q,recordBytes,files);return [];}catch(error){return [error.message];}
}

// ---- CLD06 (R5) --------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Supplements an immutable R5 record after ONE deployment ordered by the user (contracts §8–§9: CLD06 follows CLD03). The R5 record itself keeps CLD06 not_run (deploy_order_pending);
// this evidence binds to the SHA-256 of its exact qualification.json bytes, its source commit, Lab pin and schema hash. Evidence: health (commit, schema hash, electrical capability),
// the three options compiled on Cloud Run with the full bundle digests of the Mac (the record's CLD04 evidence, which the R5 reader recompiled on the host), and one S1 emergency
// stop run compared with the Mac's own run of the stop-v1 campaign (stop tick exact, status and served equal, end tick and distance within 5 %). Producer: scripts/record-r5-cloud.mjs.
export const R5_CLOUD={container:'inputs/container/container.json',cld04:'inputs/container/cld04.json',macStop:'inputs/stop/s1-emergency-coast/report.json',
 options:['serve-hw-a-v1','serve-hw-b-v1','serve-hw-c-v1'],states:['blocked','compiled','compiled'],stopEntry:{id:'s1',function:'emergency',trigger:{kind:'elapsed_sim_ms',value:8220}},
 scenario:'MJ-TRAY01',seed:7,driveExperimentId:'drive-hw-c-coast-v1',relativeTolerance:0.05};
const must=(ok,code)=>{if(!ok)throw Error(code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function checkR5Candidate(q){
 must(q?.release==='r5'&&q.accepted===false&&q.acceptedBy===null&&q.identity?.identityStable===true&&/^[a-f0-9]{40}$/.test(q.identity.before?.sourceCommit)&&/^[a-f0-9]{40}$/.test(q.lab?.commit)&&
  q.lab.pin?.sourceCommit===q.identity.before.sourceCommit&&hex.test(q.lab.pin.schemaHash)&&hex.test(q.lab.pin.artifactSha256),'CANDIDATE_IDENTITY');
 must(q.cases?.CLD04?.status==='tested'&&q.cases?.CLD05?.status==='tested'&&q.cases?.CLD06?.status==='not_run'&&/deploy_order_pending/.test(q.cases.CLD06.reason??'')&&
  Object.values(q.gates??{}).every(g=>g.accepted===false),'R5_RECORD_NOT_SUPPLEMENTABLE');
}
/** The Mac side, from the record's own bytes: the container record (CLD04 digests, CLD05 native image) and the Mac's S1 emergency coast run of stop-v1. */
export function checkR5CandidateInputs(q,containerBytes,cld04Bytes,macBytes){
 checkR5Candidate(q);
 const art=f=>q.artifacts?.find(a=>a.file===f)?.sha256,container=JSON.parse(containerBytes),cld04=JSON.parse(cld04Bytes),mac=JSON.parse(macBytes),pin=q.lab.pin;
 must(q.inputs?.containerRecord?.file===R5_CLOUD.container&&q.inputs.containerRecord.sha256===sha(containerBytes)&&art(R5_CLOUD.cld04)===sha(cld04Bytes)&&
  container.cld04?.evidence?.sha256===sha(cld04Bytes)&&art(R5_CLOUD.macStop)===sha(macBytes),'CANDIDATE_INPUT_HASH');
 const native=container.cld05;
 must(container.sourceCommit===pin.sourceCommit&&native?.status==='tested'&&native.platform==='linux/amd64'&&native.sourceCommit===pin.sourceCommit&&/^sha256:[0-9a-f]{64}$/.test(native.imageId),'NATIVE_IMAGE_INVALID');
 must(cld04.sourceCommit===pin.sourceCommit&&cld04.schemaHash===pin.schemaHash&&same(R5_CLOUD.options.map(o=>cld04.options?.[o]?.state),R5_CLOUD.states)&&R5_CLOUD.options.every(o=>hex.test(cld04.options[o].digest))&&
  same(cld04.stop?.entry,R5_CLOUD.stopEntry)&&Number.isSafeInteger(cld04.stop.scheduledTick)&&cld04.stop.tick===cld04.stop.scheduledTick,'MAC_DIGESTS_INVALID');
 checkStopRun(mac,'arm64',pin.sourceCommit,cld04.stop.scheduledTick);
 return {container,cld04,native,mac};
}
const emergencyTick=r=>r?.attention?.find(a=>a.reason==='EMERGENCY_STOP')?.tick;
export function checkStopRun(r,arch,commit,tick){
 const m=r?.manifest,o=r?.outcome;
 must(m?.sourceCommit===commit&&m.scenario?.id===R5_CLOUD.scenario&&m.scenario.revision===1&&m.seed===R5_CLOUD.seed&&m.mode==='simulation'&&m.access==='simulated'&&m.backendSetId==='engineering-mujoco-3d-v1'&&
  same(m.stopSchedule?.entries,[R5_CLOUD.stopEntry])&&hex.test(m.stopSchedule.hash)&&m.drive?.experimentId===R5_CLOUD.driveExperimentId&&m.drive.hostArch===arch&&m.calibration?.status==='not_calibrated'&&
  !m.driveFaultSchedule&&!m.faultSchedule,'STOP_RUN_SCOPE');
 must(o?.status==='needs_attention'&&o.served==='0'&&Number.isSafeInteger(o.tick)&&o.tick>tick&&emergencyTick(r)===tick&&Number.isFinite(r.metrics?.distanceM?.['amr-1']),'STOP_RUN_OUTCOME');
}
export function compareStop(mac,cloud){
 const a=mac.manifest,b=cloud.manifest,t=R5_CLOUD.relativeTolerance;
 must(a.runId!==b.runId&&same(a.scenario,b.scenario)&&a.seed===b.seed&&a.stopSchedule.hash===b.stopSchedule.hash&&['experimentId','driveModelDigest','controlProfileDigest'].every(k=>a.drive[k]===b.drive[k]),'MAC_INPUT_MISMATCH');
 must(emergencyTick(mac)===emergencyTick(cloud)&&mac.outcome.status===cloud.outcome.status&&mac.outcome.served===cloud.outcome.served,'MAC_STOP_RESULT_MISMATCH');
 const tickMac=mac.outcome.tick,tickCloud=cloud.outcome.tick,distanceMacM=mac.metrics.distanceM['amr-1'],distanceCloudM=cloud.metrics.distanceM['amr-1'];
 must(Math.abs(tickCloud-tickMac)<=t*tickMac&&Math.abs(distanceCloudM-distanceMacM)<=t*distanceMacM,'MAC_TOLERANCE_EXCEEDED');
 return {stopTick:emergencyTick(cloud),status:cloud.outcome.status,served:cloud.outcome.served,tickMac,tickCloud,distanceMacM,distanceCloudM,relativeTolerance:t};
}
/** `local` (the producer's loopback diagnostic only) accepts a runtime that is not bound publicly. */
export function checkR5Health(h,pin,origin,local=false){
 must(h?.sourceCommit===pin.sourceCommit&&h.schemaHash===pin.schemaHash&&h.allowOrigin===origin&&h.protocolMajor===2&&(local||h.deployment?.bind==='public')&&h.features?.bearer===true,'HEALTH_IDENTITY_OR_ORIGIN');
 must(Array.isArray(h.capabilities)&&h.capabilities.includes('electrical_bundle_v1')&&h.backends?.some(b=>b.id==='mujoco_3d'&&['installed','reachable','enabled'].every(k=>b[k]===true)),'HEALTH_NOT_READY');
}
export function validateR5Supplement(q,r5Bytes,files){
 const bytes=k=>{const b=files.get(k+'.json');must(b,'ARTIFACT_MISSING:'+k);return b;},get=k=>JSON.parse(bytes(k));
 const {cld04,native,mac}=checkR5CandidateInputs(q,bytes('container-record'),bytes('cld04'),bytes('mac-stop-report')),pin=q.lab.pin,d=get('deployment'),s=get('summary');
 must(d.schema==='mekoniq-cloud-run-deployment/2'&&d.accepted===false&&d.qualification?.sha256===sha(r5Bytes)&&d.qualification.candidateId===q.candidateId&&d.sourceCommit===pin.sourceCommit&&
  d.labCommit===q.lab.commit&&d.schemaHash===pin.schemaHash&&d.artifactSha256===pin.artifactSha256,'CANDIDATE_BINDING');
 checkDeployment(d,get('service'),get('revision'),get('promotion'),native);
 must(s.schema==='mekoniq-cloud-run-r5-smoke/1'&&s.accepted===false&&s.mode==='qualification'&&s.status==='tested'&&s.expectedCommit===pin.sourceCommit&&s.service===d.url&&s.origin===d.origin&&
  ['health','electrical','stop'].every(k=>s.cases?.[k]==='tested'),'CLD06_NOT_TESTED');
 checkR5Health(get('health'),pin,d.origin);
 const e=get('electrical');
 must(e.projectDigest===cld04.project?.digest&&R5_CLOUD.options.every(o=>e.options?.[o]?.state===cld04.options[o].state&&e.options[o].digest===cld04.options[o].digest),'CLOUD_DIGEST_MISMATCH');
 const cloud=get('stop-report');
 must(cloud.schemaHash===pin.schemaHash,'REPORT_SCHEMA_MISMATCH');
 checkStopRun(cloud,'x86_64',pin.sourceCommit,cld04.stop.scheduledTick);
 must(same(compareStop(mac,cloud),s.macComparison),'MAC_COMPARISON_MISMATCH');
 must(same(s.cleanup,[{runId:cloud.manifest.runId,archived:true}]),'SMOKE_CLEANUP_INCOMPLETE');
}
export const checkCloudRunR5Evidence=(read,r5Bytes)=>checkedSupplement(read,r5Bytes,validateR5Supplement);
