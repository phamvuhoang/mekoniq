// CL01 supplements an immutable R2a qualification. This checks stored evidence only;
// it never edits that qualification, deploys a service or grants human acceptance.
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
