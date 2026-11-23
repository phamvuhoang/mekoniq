import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {afterEach,beforeEach,expect,test} from 'vitest';
// @ts-expect-error plain ESM script
import {verifyWebRecord,artifactDispositionsFromGroups} from '../../scripts/r4-readback.mjs';
// @ts-expect-error plain ESM script
import {SUITES_R4} from '../../scripts/sim-extension-r4.mjs';
const suite=SUITES_R4.find((s:{id:string})=>s.id==='e2e-replay');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'r4-replay-'));});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
function put(file:string,b:string|Buffer){mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),b);return {file,sha256:sha(b)};}
function sample(id:string,change:string){
 const runId='run-'+id,path='inputs/web/replays/'+id+'/',sceneDigest='d'.repeat(64),cupId='cup-1',attemptId=cupId+'#0',tick=1;
 const asset=(pathInPackage:string,role:string,mediaType:string,raw:string)=>{
  const plain=Buffer.from(raw),stored=gzipSync(plain);put(path+pathInPackage+'.bin',stored);
  return {path:pathInPackage,role,mediaType,encoding:'gzip',bytes:stored.length,sha256:sha(stored),decodedBytes:plain.length,decodedSha256:sha(plain)};
 };
 const belief={objectId:cupId,kind:'cup',frameId:'arm-base',positionM:[0,0,0],sigmaM:[0,0,0],observedTick:0,publishedTick:0,ageTicks:0,source:'pose_estimator_sim',valid:true};
 const attempt={attemptId,cupId,index:0,decidedTick:0,mode:'belief_estimated',beliefUsed:belief,beliefErrorAtCommitM:0,gates:{belief:'pass',region:'pass',ik:'pass',sweep:'pass'},ikResidual:[],outcome:'grip_not_established'};
 const step={stepId:attemptId+'/grip/0',attemptId,rule:'grip',action:'open_gripper',commandId:'recovery:cell-1:g0:0',recordedTick:1,completedTick:1,result:'done'};
 const entry={faultId:'drive-trip',targetId:'amr-1/wheel-right',verdict:'detected_in_time',injection:{appliedTick:tick},plantResponse:{axisState:'fault',axisFault:'EXTERNAL_TRIP'}};
 const report={manifest:{runId,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-cell-v1',scenario:{id:change==='cell'?'MJ-BV01':'MJ-CELL-BV01'},drive:{experimentId:'drive-nominal-v1'},perception:{graspMode:'belief_estimated',recoveryPolicy:{id:'pick-recovery-v1'}}},outcome:{tick},
  worldSweep:{scope:{identity:{runId,bootId:'boot',sceneDigest},publicCommittedTick:tick,prefixCovered:true,streamFinalized:false}},
  faultReport:{runId,accepted:false,entries:[entry]},driveEvidence:{events:[{tick,code:'DRIVE_FAULT',axisId:entry.targetId}]},
  perceptionEvidence:{schemaVersion:1,issues:[],beliefs:[{tick:0,objectId:cupId,belief,dropped:false,truthAtObservedTick:[0,0,0],errorM:0}],attempts:[attempt],recovery:['no recovery','no recovery or receipt'].includes(change)?[]:[{...step,completedTick:null,result:'pending'},step]}};
 const rows=[0,1].map(t=>({snapshot:{runId,bootId:'boot',sceneDigest,tick:t,simTimeNs:String(t*20000000),arms:[{armId:'arm-1'}],robots:[{robotId:'amr-1'}],props:[{propId:cupId}],drives:[{axisId:entry.targetId,tick:t,state:'fault',fault:'EXTERNAL_TRIP'}]},
  command:{targetTick:t,worldControl:{program:{programId:'cup-pick',commandId:change==='other command'?'other':'cell-1',cupId}}}}));
 const chunk='world/chunk.ndjson.gz',assets=[asset('report.json.gz','report','application/json',JSON.stringify(report)),asset('scene.json.gz','scene','application/json',JSON.stringify({sceneDigest,files:[]})),asset(chunk,'world','application/x-ndjson',rows.map(v=>JSON.stringify(v)).join('\n')+'\n')];
 const manifest={schemaVersion:1,documentType:'web-replay-package',runId,horizon:{tick,tickMs:20},provenance:{kind:'imported_integrity_only',accepted:false,calibration:'not_calibrated',scope:'display_only_not_requalification',reportTransform:'credential_redaction_v1',rawReportSha256:sha(JSON.stringify(report))},coverage:{prefixCovered:true,streamFinalized:false,sampled:false,terminal:null,gaps:[],issues:[]},assets,streams:[{kind:'world',chunks:[chunk],firstTick:0,lastTick:1,samples:2}],licensing:[]};
 const manifestSha256=put(path+'manifest.json',JSON.stringify(manifest)).sha256;
 if(change==='missing scene')rmSync(join(root,path+'scene.json.gz.bin'));
 return {id,recording:runId,manifestSha256,horizon:tick,provenance:'not_calibrated accepted:false'};
}
function evidence(change:string,belief=true){
 const replays=[sample('drive-fault',change==='missing scene'?change:''),...belief?[sample('belief-recovery',change)]:[]];
 const ref=put('inputs/web/replays/catalog.json',JSON.stringify({schemaVersion:1,replays})),file='replay-offline.spec.ts';
 const attachment=(name:string,x:unknown)=>({name,contentType:'application/json',body:Buffer.from(JSON.stringify(x)).toString('base64')});
 const preview={mode:'owned',url:'http://127.0.0.1:12345/',indexSha256:'a'.repeat(64),pinSha256:'b'.repeat(64),entryAssets:[{path:'/assets/site.js',sha256:'c'.repeat(64)}]};
 const specs=replays.map(e=>({id:e.id,file,title:e.id+' sample: offline cursor',ok:true,tests:[{status:'expected',expectedStatus:'passed',results:[{status:'passed',errors:[],attachments:[attachment('replay-production-preview',preview),...['no receipt','no recovery or receipt'].includes(change)?[]:[attachment('r4-offline-replay',{sampleId:e.id,runId:change==='wrong run'?'different':e.recording,manifestSha256:change==='other bytes'?'f'.repeat(64):e.manifestSha256,cursorTick:1,runtimeRequests:[]})]]}]}]}));
 const result=put('suites/e2e-replay/result.json',JSON.stringify({errors:[],suites:[{file,specs}],stats:{startTime:'2026-11-22T00:00:01Z',duration:1000,expected:specs.length,unexpected:0,flaky:0,skipped:0}}));
 const process=put('suites/e2e-replay/process.json',JSON.stringify({command:'node',args:suite.command,startedAt:'2026-11-22T00:00:00Z',finishedAt:'2026-11-22T00:00:05Z',status:'completed',exitCode:0,exitSignal:null,spawnError:null,writeError:null})).file;
 return {inputs:{webSamples:ref},suites:[{id:suite.id,repo:'lab',kind:'playwright',process,exitCode:0,result}]};
}
test('admits the fault gzip aliases but refuses an unregistered recovery fixture even with a matching browser observation',async()=>{
 const v=await verifyWebRecord(root,evidence(''));expect(v.WEB08).toEqual([]);expect(v.WEB10).toEqual(['WEB10_SAMPLE_FAILED:belief-recovery']);
});
test.each(['missing scene','no recovery','cell','other command','wrong run','other bytes','no receipt'])('refuses %s in otherwise digest-consistent packages and results',async change=>{
 const v=await verifyWebRecord(root,evidence(change));expect(v.WEB10.length).toBeGreaterThan(0);
 if(['missing scene','wrong run','other bytes','no receipt'].includes(change))expect(v.WEB08.length).toBeGreaterThan(0);
});
test('an absent belief-recovery sample leaves WEB10 not_run and retains a verified drive-fault WEB08',async()=>{
 const v=await verifyWebRecord(root,evidence('',false));expect(v.WEB08).toEqual([]);expect(artifactDispositionsFromGroups(v).WEB10.status).toBe('not_run');
});

test('a missing browser observation does not hide a recovery sample with no recorded recovery',async()=>{
 const v=await verifyWebRecord(root,evidence('no recovery or receipt'));
 expect(v.WEB10).toContain('WEB10_SAMPLE_FAILED:belief-recovery');
});
