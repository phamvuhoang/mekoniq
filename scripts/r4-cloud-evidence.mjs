// Validation shared by the preflight, HTTP producer and offline CLD03 reader.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {completedWheelBench,measuredWheelTrace,WHEEL_AXES} from './r4-wheel-bench-readback.mjs';
import {CLOSING_GATES_R4} from './sim-extension-r4.mjs';

export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const must=(ok,code)=>{if(!ok)throw Error(code);};
export const service='mekoniq-lab-runtime',region='asia-southeast1',project='mekoniq';
export const macPath='inputs/cil/cell/nominal-7/report.json',nativePath='inputs/container/container.json';
export const scenarios={cell:['MJ-CELL-BV01','engineering-mujoco-cell-v1'],bench:['MJ-BENCH-WHEEL','engineering-mujoco-bench-v1']};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const hex=/^[0-9a-f]{64}$/,git=/^[0-9a-f]{40}$/,positive=x=>Number.isFinite(x)&&x>0,empty=x=>Array.isArray(x)&&x.length===0;
const signal={kind:'step',amplitude:2,atTick:10};
const limits={cell:14000,bench:500};
export const digestRef=new RegExp('^asia-southeast1-docker\\.pkg\\.dev/mekoniq/lab/mekoniq-lab-runtime@sha256:[a-f0-9]{64}$');

export function checkCandidate(q){
 must(q.release==='r4'&&q.accepted===false&&q.identity?.identityStable===true&&git.test(q.identity.before?.sourceCommit)&&git.test(q.lab?.commit)&&
  q.lab.pin?.sourceCommit===q.identity.before.sourceCommit&&hex.test(q.lab.pin.schemaHash)&&hex.test(q.lab.pin.artifactSha256),'CANDIDATE_IDENTITY');
 must(CLOSING_GATES_R4.every(k=>q.gates?.[k]?.accepted===false&&q.gates[k].status===(k==='G-CLOUD2'?'not_run':'tested'))&&
  q.cases?.CLD01?.status==='tested'&&q.cases?.CLD02?.status==='tested'&&q.cases?.CLD03?.status==='not_run','R4_RECORD_NOT_SUPPLEMENTABLE');
}
export function checkCandidateInputs(q,macBytes,nativeBytes){
 checkCandidate(q);
 must(q.inputs?.containerRecord?.file===nativePath&&q.inputs.containerRecord.sha256===sha(nativeBytes)&&
  q.artifacts?.find(a=>a.file===macPath)?.sha256===sha(macBytes),'CANDIDATE_INPUT_HASH');
 const mac=JSON.parse(macBytes),native=JSON.parse(nativeBytes).cld02;
 must(native?.status==='tested'&&native.platform==='linux/amd64'&&native.sourceCommit===q.lab.pin.sourceCommit&&/^sha256:[0-9a-f]{64}$/.test(native.imageId),'NATIVE_IMAGE_INVALID');
 checkCell(mac,'arm64',q.lab.pin.sourceCommit);
 return {mac,native};
}
function ready(status){return Array.isArray(status?.conditions)&&status.conditions.filter(c=>c.type==='Ready').length===1&&status.conditions.some(c=>c.type==='Ready'&&c.status==='True');}
function checkSpec(spec,annotations,d){
 must(spec?.serviceAccountName===service+'@mekoniq.iam.gserviceaccount.com'&&spec.timeoutSeconds===3600&&spec.containerConcurrency===20&&
  annotations?.['run.googleapis.com/execution-environment']==='gen2'&&annotations?.['autoscaling.knative.dev/maxScale']==='1'&&
  (annotations['autoscaling.knative.dev/minScale']??'0')==='0'&&spec.containers?.length===1,'SERVICE_CONFIG_MISMATCH');
 const [container]=spec.containers,env=container.env;
 must(container.image===d.image&&['1','1000m'].includes(container.resources?.limits?.cpu)&&container.resources?.limits?.memory==='2Gi'&&env?.length===3,'SERVICE_CONFIG_MISMATCH');
 const entry=name=>env.find(e=>e.name===name);
 must(equal(entry('LAB_PUBLIC_HOST'),{name:'LAB_PUBLIC_HOST',value:new URL(d.url).host})&&equal(entry('LAB_ALLOW_ORIGIN'),{name:'LAB_ALLOW_ORIGIN',value:d.origin})&&
  equal(entry('MEKONIQ_LAB_ACCESS_KEY'),{name:'MEKONIQ_LAB_ACCESS_KEY',valueFrom:{secretKeyRef:{key:'latest',name:'lab-access-key'}}}),'ENV_OR_SECRET_REFERENCE_MISMATCH');
}
export function checkDeployment(d,svc,rev,promotion,native){
 const endpoint=new URL(d.url);
 must(d.project===project&&d.region===region&&d.service===service&&d.url===endpoint.origin&&endpoint.protocol==='https:'&&endpoint.hostname.endsWith('.run.app')&&
  new URL(d.origin).protocol==='https:'&&new URL(d.origin).origin===d.origin&&d.platform==='linux/amd64'&&digestRef.test(d.image)&&
  /^mekoniq-lab-runtime-[a-z0-9-]+$/.test(d.revision),'DEPLOYMENT_MISMATCH');
 must(svc.metadata?.name===service&&svc.metadata.labels?.['cloud.googleapis.com/location']===region&&ready(svc.status)&&svc.status.url===d.url&&svc.status.latestReadyRevisionName===d.revision&&
  Array.isArray(svc.status.traffic)&&svc.status.traffic.filter(t=>t.percent>0).length===1&&svc.status.traffic.some(t=>t.revisionName===d.revision&&t.percent===100),'SERVICE_TRAFFIC_OR_IDENTITY');
 must(rev.metadata?.name===d.revision&&rev.metadata.labels?.['serving.knative.dev/service']===service&&rev.metadata.labels?.['cloud.googleapis.com/location']===region&&
  ready(rev.status)&&rev.status.imageDigest===d.image,'REVISION_NOT_READY_OR_IMAGE_MISMATCH');
 checkSpec(svc.spec?.template?.spec,svc.spec?.template?.metadata?.annotations,d);
 checkSpec(rev.spec,rev.metadata.annotations,d);
 must(promotion.Id===native.imageId&&promotion.Os==='linux'&&promotion.Architecture==='amd64'&&promotion.Config?.Labels?.['org.opencontainers.image.revision']===d.sourceCommit&&
  Array.isArray(promotion.RepoDigests)&&promotion.RepoDigests.includes(d.image),'NATIVE_PROMOTION_MISMATCH');
}
export function checkHealth(h,pin,origin){
 must(h.sourceCommit===pin.sourceCommit&&h.schemaHash===pin.schemaHash&&h.allowOrigin===origin&&h.protocolMajor===2&&h.deployment?.bind==='public'&&h.features?.bearer===true&&h.features?.readiness===true,'HEALTH_IDENTITY_OR_ORIGIN');
 must(['mujoco_3d','mujoco_arm','mock_coffee'].every(id=>h.backends?.some(b=>b.id===id&&['installed','reachable','compatible','enabled','commissioned'].every(k=>b[k]===true)))&&
  ['mujoco_3d','mujoco_arm'].every(id=>['geometry','inertia','drive','contact','sensing'].every(k=>h.modelMaturity?.[id]?.[k]==='assumed'))&&empty(h.benchReadiness?.reasonCodes),'HEALTH_NOT_READY');
 const p=h.benchCatalog?.['MJ-BENCH-WHEEL']?.startingProfile;
 must(typeof p?.id==='string'&&p.id.length&&Number.isSafeInteger(p.revision)&&p.revision>0&&hex.test(p.digest),'BENCH_PROFILE_UNAVAILABLE');
}
export function checkReadiness(kind,r){
 const [scenario,set]=scenarios[kind];
 must(r?.scenarioId===scenario&&r.backendSetId===set&&r.canStart===true&&Array.isArray(r.checks)&&
  r.checks.every(c=>c.status==='ready'&&empty(c.reasonCodes))&&['host','runner','backend:mujoco_3d',...(kind==='cell'?['backend:mujoco_arm','backend:mock_coffee']:[])].every(id=>r.checks.some(c=>c.id===id)),'RUN_NOT_READY');
}
function completed(kind,r,commit){
 const m=r?.manifest,o=r?.outcome,[scenario,set]=scenarios[kind];
 must(m?.sourceCommit===commit&&uuid.test(m.runId)&&m.scenario?.id===scenario&&m.scenario.revision===1&&m.backendSetId===set&&m.mode==='simulation'&&m.access==='simulated'&&
  m.seed===(kind==='cell'?7:3)&&m.calibration?.status==='not_calibrated'&&m.clock?.tickMs===20&&o?.status==='completed'&&Number.isSafeInteger(o.tick)&&o.tick>0&&o.tick<=limits[kind]&&
  o.simTimeNs===String(o.tick*20_000_000),'RUN_IDENTITY_OR_OUTCOME');
}
// The registered nominal world ID resolves to the same no-disturbance configuration as the default.
function nominalSelection(m){
 return (m.worldExperimentId===undefined||m.worldExperimentId==='world-nominal-v1')&&m.graspProgramId===undefined;
}
export function checkCell(r,arch,commit){
 completed('cell',r,commit);
 const m=r.manifest,d=m.drive,e=r.driveEvidence,program=m.armProgram,jobs=r.coffee?.jobs;
 must(nominalSelection(m)&&d?.hostArch===arch&&d.experimentId==='drive-nominal-v1'&&d.testLevel==='controller_in_the_loop'&&hex.test(d.controlProfileDigest)&&hex.test(d.driveModelDigest)&&
  m.backends?.some(b=>b.id==='mujoco_3d'&&b.model==='mujoco_shared_world'&&b.dynamics===true)&&m.backends.some(b=>b.id==='mujoco_arm'&&b.dynamics===true)&&
  m.models?.some(v=>v.id==='mujoco_shared_world'&&hex.test(v.hash))&&m.project?.id==='coffee-delivery-world-v1'&&hex.test(m.project.hash)&&m.world?.id==='coffee-delivery-world'&&hex.test(m.world.hash)&&
  program?.fixture?.id==='coffee-delivery-cell-v1'&&hex.test(program.programsDigest)&&hex.test(program.waypointsDigest)&&!program.graspProgram&&!m.perception&&!m.driveFaultSchedule&&!m.faultSchedule&&
  !r.faultReport&&!r.perceptionEvidence&&Array.isArray(m.profiles)&&m.profiles.length>0&&m.profiles.every(p=>hex.test(p.hash)&&p.provenance!=='registered_disturbance')&&
  r.arm?.armPlant?.engine==='mujoco_3d'&&r.arm.armPlant.calibration==='not_calibrated'&&r.worldSweep?.accepted===false&&r.worldSweep.calibration==='not_calibrated','CELL_NOMINAL_SCOPE');
 must(r.outcome.served==='2'&&empty(r.attention)&&jobs?.length===2&&jobs.every(j=>j.status==='delivered'&&j.attentionReason===null&&j.jobId)&&new Set(jobs.map(j=>j.jobId)).size===2&&
  e?.testLevel==='controller_in_the_loop'&&e.complete===true&&empty(e.issues)&&e.axes?.length===9&&e.axes.every(a=>empty(a.faults))&&positive(r.metrics?.distanceM?.['amr-1']),'CELL_NOT_COMPLETED');
}
export function checkBench(r,trace,h,arch,commit){
 completed('bench',r,commit);const t=r.tuning;
 const expected={schemaVersion:1,scenarioId:scenarios.bench[0],axis:'wheels',signal,driveExperimentId:'drive-nominal-v1',controlProfile:h.benchCatalog['MJ-BENCH-WHEEL'].startingProfile};
 must(equal(r.bench?.request,expected)&&completedWheelBench(r)&&t.engine.hostArch===arch&&equal(t.axisIds,WHEEL_AXES)&&
  ['rmsError','peakTorqueNm','saturationRatio'].every(k=>{const v=t.metrics?.[k];return v?.available===true&&v.basis==='actual'&&Number.isFinite(v.value)&&v.samples>0;}),'BENCH_NOT_COMPLETED');
 must(measuredWheelTrace(trace,t),'BENCH_TRACE_INVALID');
}
export function comparison(mac,cell){
 const a=mac.manifest,b=cell.manifest;
 must(nominalSelection(a)&&nominalSelection(b)&&a.runId!==b.runId&&['project','world','scenario','models','profiles','backends'].every(k=>equal(a[k],b[k]))&&
  ['driveModelDigest','controlProfileDigest','controllers','experimentId'].every(k=>equal(a.drive[k],b.drive[k]))&&['fixture','physicsDigest','programsDigest','waypointsDigest'].every(k=>equal(a.armProgram[k],b.armProgram[k])),'MAC_INPUT_MISMATCH');
 const distanceMacM=mac.metrics.distanceM['amr-1'],distanceCloudM=cell.metrics.distanceM['amr-1'],relativeTolerance=0.05;
 must(Math.abs(distanceCloudM-distanceMacM)<=relativeTolerance*distanceMacM,'MAC_DISTANCE_MISMATCH');
 return {servedMac:mac.outcome.served,servedCloud:cell.outcome.served,distanceMacM,distanceCloudM,relativeTolerance};
}
export function elapsed(kind,a,r){
 const id=r.manifest.runId,c=a.created,start=a.start,steps=a.steps;
 must(c?.runId===id&&c.tick===0&&c.status==='ready'&&c.runRevision===0&&Array.isArray(steps)&&steps.length>0&&steps.length<=limits[kind]/100,'ACTION_SEQUENCE_INVALID');
 let revision=c.runRevision,tick=0,end=-1n;const ids=new Set();
 for(const [i,row] of [start,...steps].entries()){
  must(row?.runId===id&&row.expectedRevision===revision&&row.runRevision===++revision&&row.startTick===tick&&Number.isSafeInteger(row.endTick)&&
   typeof row.actionId==='string'&&row.actionId.length>0&&!ids.has(row.actionId)&&/^\d{1,24}$/.test(row.startNs)&&/^\d{1,24}$/.test(row.endNs)&&
   BigInt(row.startNs)>=end&&BigInt(row.endNs)>BigInt(row.startNs),'ACTION_RECEIPT_INVALID');
  ids.add(row.actionId);end=BigInt(row.endNs);
  must(i===0?row.kind==='start'&&row.endTick===0&&row.status==='running':
   row.kind==='step'&&row.ticks===100&&row.endTick>tick&&row.endTick<=tick+100&&
    (i===steps.length?row.status==='completed':row.status==='running'&&row.endTick===tick+100),'ACTION_TICKS_INVALID');
  tick=row.endTick;
 }
 must(tick===r.outcome.tick,'ACTION_FINAL_TICK');
 return Number(end-BigInt(steps[0].startNs))/1e6/tick;
}
export function timing(actions,cell,bench){
 must(cell.manifest.runId!==bench.manifest.runId,'RUN_ID_COLLISION');
 const cellMsPerTick=elapsed('cell',actions.cell,cell),benchMsPerTick=elapsed('bench',actions.bench,bench);
 return {cellTicks:cell.outcome.tick,benchTicks:bench.outcome.tick,cellMsPerTick,benchMsPerTick,realtimeFactor:cell.manifest.clock.tickMs/cellMsPerTick};
}
export function validateSupplement(q,r4Bytes,files){
 const bytes=k=>{const b=files.get(k+'.json');must(b,'ARTIFACT_MISSING:'+k);return b;},get=k=>JSON.parse(bytes(k));
 const {mac,native}=checkCandidateInputs(q,bytes('mac-cell-report'),bytes('native-container')),d=get('deployment'),s=get('summary'),pin=q.lab.pin;
 must(d.schema==='mekoniq-cloud-run-deployment/2'&&d.accepted===false&&d.qualification?.sha256===sha(r4Bytes)&&d.qualification.candidateId===q.candidateId&&d.sourceCommit===pin.sourceCommit&&d.labCommit===q.lab.commit&&d.schemaHash===pin.schemaHash&&d.artifactSha256===pin.artifactSha256,'CANDIDATE_BINDING');
 checkDeployment(d,get('service'),get('revision'),get('promotion'),native);
 must(s.schema==='mekoniq-cloud-run-r4-smoke/1'&&s.accepted===false&&s.mode==='qualification'&&s.status==='tested'&&s.expectedCommit===pin.sourceCommit&&s.service===d.url&&s.origin===d.origin&&
  ['health','cell','bench'].every(k=>s.cases?.[k]==='tested'),'CLD03_NOT_TESTED');
 const health=get('health'),readiness=get('readiness'),cell=get('cell-report'),bench=get('bench-report');
 checkHealth(health,pin,d.origin);for(const kind of Object.keys(scenarios))checkReadiness(kind,readiness[kind]);
 must(cell.schemaHash===pin.schemaHash&&bench.schemaHash===pin.schemaHash,'REPORT_SCHEMA_MISMATCH');
 checkCell(cell,'x86_64',d.sourceCommit);checkBench(bench,get('bench-trace'),health,'x86_64',d.sourceCommit);
 must(equal(comparison(mac,cell),s.macComparison),'MAC_COMPARISON_MISMATCH');
 must(equal(timing(get('actions'),cell,bench),s.timing),'TIMING_MISMATCH');
 must(equal(s.cleanup,[cell,bench].map(r=>({runId:r.manifest.runId,archived:true}))),'SMOKE_CLEANUP_INCOMPLETE');
}
