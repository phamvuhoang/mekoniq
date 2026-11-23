import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {SUITES_R4} from './sim-extension-r4.mjs';
import {checkPlaywrightProcess,playwrightAttempts} from './r4-playwright.mjs';

export const WEB10_SAMPLES=['drive-fault','belief-recovery'];
const sha=b=>createHash('sha256').update(b).digest('hex'),digest=/^[a-f0-9]{64}$/;
const suite=SUITES_R4.find(s=>s.id==='e2e-replay');
function observations(read,record){
 const actual=record.suites?.find(s=>s.id===suite.id);
 if(!actual||!actual.result)return null;
 if(checkPlaywrightProcess(suite,actual,read).length)throw Error('REPLAY_SUITE_PROCESS');
 const bytes=read(actual.result.file);if(!bytes||sha(bytes)!==actual.result.sha256)throw Error('REPLAY_SUITE_HASH');
 const out=new Map();
 for(const {result} of playwrightAttempts(suite,bytes)){
  const attachments=result.attachments??[];
  const decode=a=>{if(a.contentType!=='application/json'||typeof a.body!=='string')throw Error('REPLAY_ATTACHMENT');return JSON.parse(Buffer.from(a.body,'base64'));};
  for(const a of attachments.filter(a=>a.name==='r4-offline-replay')){
   const receipt=decode(a),previews=attachments.filter(a=>a.name==='replay-production-preview');
   if(previews.length!==1)throw Error('REPLAY_PREVIEW');
   const p=decode(previews[0]);
   if(!['owned','external'].includes(p.mode)||!/^http:\/\/127\.0\.0\.1:[0-9]+\/$/.test(p.url)||!digest.test(p.indexSha256)||!digest.test(p.pinSha256)||
    !p.entryAssets?.some(a=>/^\/assets\/[\w.-]+\.js$/.test(a.path)&&digest.test(a.sha256))||!WEB10_SAMPLES.includes(receipt.sampleId)||out.has(receipt.sampleId))throw Error('REPLAY_PREVIEW');
   out.set(receipt.sampleId,receipt);
  }
 }
 return out;
}
async function verifyRecovery(replay,tick,row){
 const r=replay.capturedReport,p=r.manifest.perception,e=r.perceptionEvidence,program=row.command?.worldControl?.program;
 if(p?.graspMode!=='belief_estimated'||p.recoveryPolicy?.id!=='pick-recovery-v1'||e?.schemaVersion!==1||e.issues?.length!==0||program?.programId!=='cup-pick'||!program.commandId)return false;
 const {validateRecoveryStepShape,validateGraspAttemptShape,validateBeliefRecordShape}=await tsImport('../packages/lab-runtime/src/v2/perception/perception-contracts.ts',import.meta.url);
 return e.recovery?.some(step=>{
  if(!validateRecoveryStepShape(step)||step.result!=='done'||!Number.isSafeInteger(step.completedTick)||step.completedTick<step.recordedTick||step.completedTick>replay.manifest.horizon.tick||
   ![step.recordedTick,step.completedTick].includes(tick)||!step.commandId.startsWith('recovery:'+program.commandId+':'))return false;
  const a=e.attempts?.find(a=>a.attemptId===step.attemptId&&a.cupId===program.cupId&&a.mode===p.graspMode&&validateGraspAttemptShape(a));
  return !!a&&row.snapshot.props?.some(prop=>prop.propId===a.cupId)&&e.beliefs?.some(b=>b.objectId===a.cupId&&b.tick<=replay.manifest.horizon.tick&&b.belief?.objectId===a.cupId&&validateBeliefRecordShape(b));
 });
}
async function verifySample(read,entry,bytes,receipt){
 const id=entry.id;
 if(sha(bytes)!==entry.manifestSha256)throw Error('SAMPLE');
 const {openReplayPackage}=await tsImport('../packages/lab-runtime/src/v2/replay/reader.ts',import.meta.url);
 const replay=await openReplayPackage(bytes,async function*(asset){
  const b=read('inputs/web/replays/'+id+'/'+asset.path+(asset.encoding==='gzip'?'.bin':''));if(!b)throw Error('ASSET');yield b;
 });
 try{
  const m=replay.manifest,r=replay.capturedReport;
  if(m.provenance.calibration!=='not_calibrated'||m.provenance.accepted!==false||m.runId!==entry.recording||entry.horizon!==m.horizon.tick||r.manifest.scenario?.id!=='MJ-CELL-BV01'||
   r.manifest.backendSetId!=='engineering-mujoco-cell-v1'||r.manifest.mode!=='simulation'||r.manifest.access!=='simulated'||!m.coverage.prefixCovered||!m.streams.some(s=>s.kind==='world'))throw Error('SAMPLE');
  if(receipt&&(receipt.manifestSha256!==entry.manifestSha256||receipt.runId!==m.runId||!Array.isArray(receipt.runtimeRequests)||receipt.runtimeRequests.length||!Number.isSafeInteger(receipt.cursorTick)))throw Error('RECEIPT');
  const recordedTick=id==='belief-recovery'?r.perceptionEvidence?.recovery?.find(step=>step.result==='done')?.recordedTick:r.faultReport?.entries?.find(e=>e.faultId==='drive-trip')?.injection?.appliedTick;
  const tick=receipt?.cursorTick??recordedTick,row=await replay.sampleAt('world',tick);
  if(row?.snapshot?.runId!==m.runId||row.snapshot.tick!==tick||row.command?.targetTick!==tick||!row.snapshot.arms?.length||!row.snapshot.robots?.length)throw Error('SAMPLE');
  if(id==='belief-recovery'){
   if(!await verifyRecovery(replay,tick,row))throw Error('RECOVERY');
  }else{
   const f=r.faultReport,axis='amr-1/wheel-right';
   if(f?.runId!==m.runId||f.accepted!==false||!f.entries?.some(e=>e.faultId==='drive-trip'&&e.targetId===axis&&e.verdict==='detected_in_time'&&e.injection?.appliedTick===tick)||
    !row.snapshot.drives?.some(d=>d.axisId===axis&&d.tick===tick&&d.state==='fault'&&d.fault==='EXTERNAL_TRIP'))throw Error('FAULT');
  }
  return receipt?null:'OFFLINE_RECEIPT_MISSING';
 }finally{replay.close();}
}
export async function verifyReplayRecord(read,record){
 const out={WEB08:[],WEB10:[]},catalogFile='inputs/web/replays/catalog.json',cat=read(catalogFile),ref=record.inputs?.webSamples;
 const both=issue=>({WEB08:[issue],WEB10:[issue]});
 if(!cat||!ref)return both('WEB_RECORD_MISSING:replay samples');
 if(ref.file!==catalogFile||sha(cat)!==ref.sha256)return both('WEB_RECORD_CORRUPT');
 let entries,seen;
 try{entries=JSON.parse(cat).replays;if(!Array.isArray(entries))throw Error();}catch{return both('WEB_RECORD_CORRUPT');}
 try{seen=observations(read,record);}catch{return both('WEB_OFFLINE_RESULT_INVALID');}
 for(const id of WEB10_SAMPLES){
  const entriesForId=entries.filter(e=>e?.id===id),e=entriesForId[0],bytes=read('inputs/web/replays/'+id+'/manifest.json');
  let problem;
  if(!e&&!bytes)problem='SAMPLE_MISSING';
  else if(entriesForId.length!==1||!bytes)problem='SAMPLE_FAILED';
  else try{
   problem=await verifySample(read,e,bytes,seen?.get(id));
   if(typeof e.provenance!=='string'||!e.provenance.includes('not_calibrated')||!e.provenance.includes('accepted:false'))out.WEB10.push('WEB10_LABEL_MISSING:'+id);
  }catch{problem='SAMPLE_FAILED';}
  if(problem){out.WEB10.push('WEB10_'+problem+':'+id);if(id==='drive-fault')out.WEB08.push('WEB08_'+problem+':'+id);}
 }
 return out;
}
