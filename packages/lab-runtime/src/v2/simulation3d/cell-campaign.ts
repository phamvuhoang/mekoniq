/** Registered current cell campaign. The production runner owns Source state; observers never synthesize ACKs. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat,readdir,mkdtemp,rm,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {readCampaignJournal,verifyCampaignOutcome} from '../control/campaign-source-evidence';
import {driveManifest,type HostArch} from '../control/drive-run';
import {worldDriveBundle,worldPlantDigest,type DriveExperimentId} from '../control/drive-experiments';
import {buildWorldDriveReport} from './world-drive-report';
import campaign from '../../../../../robotics/simulation-mujoco/campaigns/mj-cell-bv01-v1.json';
import {createScenarioRun,type ScenarioRun} from '../scenario-runner';
import {serviceAmrAsset} from '../assets';
import {defaultCatalog} from '../capabilities';
import {hashJson} from '../hash';
import {mujocoWorldPorts} from './mujoco-world-ports';
import {spawnMujocoWorker} from './worker-client';
import {WorkerLostError} from '../navigation2d/plant';
import {lockDigestOf} from '../../engineering/linkforge';
import {readRetainedWorldAdmission} from './world-arm-report';
import {readWorldEvidence} from './world-evidence';
import {evaluateWorldSweep} from './world-sweep';
import type {WorldFactoryInput,WorldPlantBindings} from './world-ports';
import type {RunReport} from '../report';
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex'),json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
export const CELL_CAMPAIGN=campaign;
export const CELL_CASES=[...campaign.nominalSeeds.map(seed=>({id:`nominal-${seed}`,seed,kind:'nominal'})),...campaign.faults.map(f=>({id:f.id,seed:f.seed,kind:f.id}))];
interface Artifact {path:string;sha256:string;bytes:number}
export async function cellArtifacts(root:string,base=''):Promise<Artifact[]>{
 const rootStat=await lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('CELL_ARTIFACT_PATH');
 const rows:Artifact[]=[];for(const name of (await readdir(join(root,base))).sort()){
  const path=base?`${base}/${name}`:name;if(path==='case.json')continue;if(!/^[\w.-]+(?:\/[\w.-]+)*$/.test(path)||path.split('/').some(s=>s==='..'||s==='.'))throw Error('CELL_ARTIFACT_PATH');
  const s=await lstat(join(root,path));if(s.isSymbolicLink())throw Error('CELL_ARTIFACT_SYMLINK');if(s.isDirectory())rows.push(...await cellArtifacts(root,path));else if(s.isFile()){if(s.size>256*1024*1024)throw Error('CELL_ARTIFACT_LIMIT');const b=await readFile(join(root,path));rows.push({path,sha256:sha(b),bytes:b.length});}else throw Error('CELL_ARTIFACT_TYPE');
 }if(rows.length>20000||rows.reduce((n,r)=>n+r.bytes,0)>2*1024**3)throw Error('CELL_ARTIFACT_LIMIT');return rows;
}
export interface CellCampaignVerdict {expectedRuns:number;completedCases:number;missingArtifacts:string[];issues:string[]}
export async function runCellCampaign(o:{root:string;out:string;sourceCommit:string;python?:string;caseId?:string;signal?:AbortSignal;/** run the same cases through a registered virtual drive (the CIL campaign) */driveExperimentId?:import('../control/drive-experiments').DriveExperimentId}):Promise<CellCampaignVerdict>{
 o.signal?.throwIfAborted();
 if(!/^[a-f0-9]{40}$/.test(o.sourceCommit))throw Error('CELL_SOURCE_COMMIT_REQUIRED');
 if(o.caseId&&!CELL_CASES.some(c=>c.id===o.caseId))throw Error('CAMPAIGN_CASE_UNREGISTERED');
 await mkdir(o.out);await writeFile(join(o.out,'campaign.json'),json({campaign,sourceCommit:o.sourceCommit,accepted:false,execution:'actual_mujoco',calibration:'not_calibrated',...o.driveExperimentId?{driveExperimentId:o.driveExperimentId,driveProfileRegistry:'cil-v2',hostArch:process.arch==='arm64'?'arm64':'x86_64'}:{}}));
 const workerRoot=join(o.root,'robotics/simulation-mujoco'),project=JSON.parse(await readFile(join(workerRoot,'fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
 for(const spec of CELL_CASES.filter(c=>!o.caseId||c.id===o.caseId)){
  const dir=join(o.out,spec.id);await mkdir(dir);const directory=join(dir,'run');await mkdir(directory);let input!:WorldFactoryInput,bindings!:WorldPlantBindings,worker:Awaited<ReturnType<typeof spawnMujocoWorker>>|undefined,drop=false,opens=0,action=0;
  const trace:{requestId:string;op:string;targetTick:number;delivered:boolean;responseDigest?:string}[]=[],fault=campaign.faults.find(f=>f.id===spec.id);
  const factory=mujocoWorldPorts({python:o.python??join(o.root,'.venv-mujoco/bin/python'),workerRoot,schemaDir:join(o.root,'packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0',...fault&&'presetId'in fault?{cellDisturbance:{presetId:fault.presetId as 'world-dock-drift-v1'|'world-cup-fall-v1',cupId:'cup-1'}}:{}},async options=>{
   opens++;worker=await spawnMujocoWorker(options);const original=worker.request.bind(worker);return {...worker,async request(request){const observation={requestId:request.requestId,op:request.op,targetTick:request.expectedTick+1,delivered:false,responseDigest:undefined as string|undefined};trace.push(observation);const response=await original(request),lost=drop&&request.op==='step';observation.delivered=!lost;if(response.ok)observation.responseDigest=hashJson(response.result);if(lost){drop=false;await writeFile(join(dir,'lost-ack-native-response.json'),json({request,response}));throw new WorkerLostError('ACK_TIMEOUT','unknown','registered current campaign: dropped actual native response');}return response;}};
  });
  const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)},manifest={project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:spec.seed,mode:'simulation' as const,access:'simulated' as const,backendSetId:'engineering-mujoco-cell-v1',sourceCommit:o.sourceCommit,...o.driveExperimentId?{driveExperimentId:o.driveExperimentId}:{}},providers={directory,catalog,assets:[serviceAmrAsset({id:'service-robot',revision:1,chassis:'service',trays:3,sensor:'lidar'})],enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],worldPorts:async(i:WorldFactoryInput)=>{input=i;bindings=await factory(i);return bindings;}};
  let run:ScenarioRun|undefined,error:string|null=null,report:RunReport|undefined;const started=performance.now();
  try{
   run=await createScenarioRun(manifest,providers);const act=async(kind:string,payload:object={})=>{const v=await run!.snapshot();return run!.action({actionId:`cell-campaign-${++action}`,expectedRevision:v.run.runRevision,kind,payload});};
   await run.start();let v=await run.snapshot();const early=['cancel-held','worker-loss','lost-ack'].includes(spec.kind),held=()=>v.coffee?.cups.some(c=>c.cupId==='cup-1'&&c.ownerKind==='arm');
   while(v.tick<campaign.maxTicks&&!['completed','needs_attention','cancelled'].includes(v.run.status)&&!(early&&held())){o.signal?.throwIfAborted();if(performance.now()-started>campaign.nativeDeadlineSecondsPerCase*1000)throw Error('CELL_CASE_TIMEOUT');v=await act('step',{ticks:25});}
   if(early){if(!held()||!bindings.snapshot().arms?.[0]?.gripper?.heldPropIds.includes('cup-1'))throw Error('CELL_FAULT_PREREQUISITE');await writeFile(join(dir,'fault-before.json'),json({view:v,snapshot:bindings.snapshot()}));
    if(spec.kind==='cancel-held')await act('cancel');else{
     if(spec.kind==='worker-loss'){if(!worker?.pid)throw Error('OWNED_WORKER_REQUIRED');process.kill(worker.pid,'SIGKILL');}else drop=true;
     try{await act('step',{ticks:1});throw Error('FAULT_NOT_DETECTED');}catch(e){if(String(e).includes('FAULT_NOT_DETECTED'))throw e;}
     const n=trace.length;try{await act('step',{ticks:1});throw Error('RETRY_NOT_REFUSED');}catch(e){if(!String(e).includes('WORLD_TERMINAL'))throw e;}if(trace.length!==n)throw Error('FAULT_REDISPATCH');
    }
   }
   report=await run.report();await writeFile(join(dir,'report.json'),json(report));await writeFile(join(dir,'source-journal.json'),json(await input.context.source.journal()));await writeFile(join(dir,'controller-state.json'),json(input.state.arm));await writeFile(join(dir,'physical-custody.json'),json(bindings.coffee.report().cupLedger));
  }catch(e){error=String(e);await writeFile(join(dir,'error.txt'),String((e as Error).stack??e));}
  finally{await run?.close();await writeFile(join(dir,'trace.json'),json({opens,workerPid:worker?.pid??null,requests:trace,elapsedMs:performance.now()-started,error}));}
  if(['worker-loss','lost-ack'].includes(spec.kind)&&!error){
   // Inspect a read-only recovery session on a private copy. Its restart attention must not
   // change the checkpoint against which the original report is verified.
   const copy=await mkdtemp(join(tmpdir(),'cell-reopen-'));
   try{await cp(directory,copy,{recursive:true});const reopened=await createScenarioRun(manifest,{...providers,directory:copy});
    try{if(opens!==1||(await reopened.snapshot()).tick!==report!.outcome.tick)throw Error('CELL_RESPAWN_OR_HORIZON');
     if(o.driveExperimentId&&hashJson((await reopened.report()).driveEvidence)!==hashJson(report!.driveEvidence))throw Error('CELL_REOPEN_DRIVE_REPORT');
    }finally{await reopened.close();}
   }finally{await rm(copy,{recursive:true,force:true});}
  }
  await writeFile(join(dir,'case.json'),json({schemaVersion:1,case:spec,sourceCommit:o.sourceCommit,accepted:false,execution:'actual_mujoco',engineVersion:'3.17.0',artifacts:await cellArtifacts(dir)}));if(o.signal?.aborted)break;
 }
 const verdict=await verifyCellCampaign(o.out);await writeFile(join(o.out,'summary.json'),json({accepted:false,...verdict}));return o.caseId?{...verdict,expectedRuns:1,completedCases:verdict.missingArtifacts.includes(o.caseId)?0:1,missingArtifacts:verdict.missingArtifacts.filter(id=>id===o.caseId),issues:verdict.issues.filter(x=>x.startsWith(o.caseId+':')||!x.includes(':'))}:verdict;
}
async function readCellJson(root:string,path:string){
 if(!/^[\w.-]+(?:\/[\w.-]+)*$/.test(path)||path.split('/').some(p=>p==='.'||p==='..'))throw Error('CELL_ARTIFACT_PATH');let current=root;if((await lstat(current)).isSymbolicLink())throw Error('CELL_ARTIFACT_PATH');for(const part of path.split('/')){current=join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('CELL_ARTIFACT_PATH');}const st=await lstat(current);if(!st.isFile()||st.size>64*1024*1024)throw Error('CELL_ARTIFACT_LIMIT');return JSON.parse(await readFile(current,'utf8'));
}
export async function verifyCellCampaign(root:string,onlyIds?:string[],historicalDrive?:boolean):Promise<CellCampaignVerdict>{
 const selected=CELL_CASES.filter(s=>!onlyIds||onlyIds.includes(s.id));
 const v:CellCampaignVerdict={expectedRuns:selected.length,completedCases:0,missingArtifacts:[],issues:[]};let source:string|undefined,experiment:DriveExperimentId|undefined,host:HostArch|undefined,legacyProfile=false,driveRegistry:string|undefined;
 try{const c=await readCellJson(root,'campaign.json');if(c.accepted!==false||c.execution!=='actual_mujoco'||c.calibration!=='not_calibrated'||hashJson(c.campaign)!==hashJson(campaign)||!/^[a-f0-9]{40}$/.test(c.sourceCommit))throw Error();source=c.sourceCommit;experiment=c.driveExperimentId;host=c.hostArch;driveRegistry=c.driveProfileRegistry;
  if(experiment){legacyProfile=c.driveProfileRegistry===undefined;if((!legacyProfile&&c.driveProfileRegistry!=='cil-v2')||(historicalDrive!==undefined&&historicalDrive!==legacyProfile)||!['arm64','x86_64'].includes(c.hostArch))throw Error();}
 }catch{v.issues.push('CELL_CAMPAIGN_IDENTITY');v.missingArtifacts=selected.map(x=>x.id);return v;}
 for(const spec of selected){const dir=join(root,spec.id),check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};try{
  const rec=await readCellJson(dir,'case.json');check(rec.schemaVersion===1&&rec.accepted===false&&rec.execution==='actual_mujoco'&&rec.engineVersion==='3.17.0'&&rec.sourceCommit===source&&hashJson(rec.case)===hashJson(spec),'CELL_CASE_IDENTITY');
  const files=await cellArtifacts(dir);check(hashJson(files)===hashJson(rec.artifacts),'CELL_ARTIFACT_INVENTORY');const paths=new Set(files.map(f=>f.path));for(const p of ['report.json','source-journal.json','controller-state.json','physical-custody.json','trace.json','run/run.json','run/journal.db','run/world-evidence/manifest.json'])check(paths.has(p),'CELL_ARTIFACT_MISSING:'+p);
  const read=(p:string)=>readCellJson(dir,p),report=await read('report.json') as RunReport,cp=await read('run/run.json'),trace=await read('trace.json');check(trace.opens===1&&!trace.error&&trace.requests.length>1,'CELL_ACTUAL_WORKER_REQUIRED');
  check(cp.manifest.seed===spec.seed&&cp.manifest.sourceCommit===source&&report.manifest.sourceCommit===source&&report.manifest.seed===spec.seed&&cp.runId===report.manifest.runId&&cp.tick===report.outcome.tick,'CELL_RUN_IDENTITY');
  const admission=await readRetainedWorldAdmission(join(dir,'run'),cp.world.snapshot.sceneDigest),world=await readWorldEvidence(join(dir,'run/world-evidence'),admission),rows=world.records,unknown=['worker-loss','lost-ack'].includes(spec.kind);check(rows.length===cp.tick+1&&rows[0]?.snapshot.tick===0&&rows.at(-1)?.snapshot.tick===cp.tick,'CELL_WORLD_HORIZON');check(unknown?world.issues.length===1&&world.issues[0]==='WORLD_EVIDENCE_INCOMPLETE':world.complete&&world.issues.length===0,'CELL_WORLD_COMPLETENESS');
  if(unknown){const m=await read('run/world-evidence/manifest.json');check(!m.complete&&typeof m.terminal==='string'&&m.gaps.length===1&&m.gaps[0].reason===m.terminal&&m.gaps[0].targetTick===cp.tick+1&&m.gaps[0].lastCommittedTick===cp.tick&&m.gaps[0].ackTick===null,'CELL_WORLD_FAILURE_BOUNDARY');}
  check(cp.world.snapshot.runId===cp.runId&&rows.every(r=>r.snapshot.runId===cp.runId),'CELL_WORLD_RUN_BINDING');
  const drivePresent=experiment!==undefined;
  check((drivePresent||(host===undefined&&driveRegistry===undefined))&&[admission.scene.engine?.driveModelRef,admission.scene.engine?.controlProfileRef,cp.manifest.drive,report.manifest.drive,report.driveEvidence].every(value=>(value!==undefined)===drivePresent),'CELL_DRIVE_IDENTITY');
  if(drivePresent)check(cp.manifest.drive?.experimentId===experiment&&hashJson(cp.manifest.drive)===hashJson(report.manifest.drive),'CELL_DRIVE_IDENTITY');
  const steps=trace.requests.filter((x:{op:string})=>x.op==='step');check(steps.length===cp.tick+(unknown?1:0)&&new Set(trace.requests.map((x:{requestId:string})=>x.requestId)).size===trace.requests.length&&trace.workerPid===rows[0]!.snapshot.worldStep!.workerPid,'CELL_REQUEST_COVERAGE');for(const [i,step]of steps.entries())check(step.targetTick===i+1&&step.delivered===(i<cp.tick)&&(i>=cp.tick||step.responseDigest===hashJson(rows[i+1]!.snapshot)),'CELL_REQUEST_CORRELATION');
  const raw=await read('source-journal.json'),journal=await readCampaignJournal(join(dir,'run'),cp.runId);
  check(hashJson(raw)===hashJson(journal.entries),'CELL_SOURCE_JOURNAL');
  verifyCampaignOutcome(cp,journal,report,'CELL',unknown&&cp.reclaimed===true&&cp.world.pending?.ackTick===null);
  if(experiment){
   const registryRoot=fileURLToPath(new URL('../../../../../robotics/simulation-mujoco/',import.meta.url));
   const expected=await worldDriveBundle(registryRoot,experiment,admission.scene.armCell.arm.armId,worldPlantDigest(admission.scene),legacyProfile);
   check(hashJson(admission.scene.engine)===hashJson(expected.refs)&&hashJson(report.manifest.drive)===hashJson(driveManifest(expected,experiment,host)),'CELL_DRIVE_IDENTITY');
   const drive=buildWorldDriveReport(admission,rows,world.complete?[]:['WORLD_FAILED']);
   check(hashJson(drive)===hashJson(report.driveEvidence)&&!drive.issues.some(i=>i!=='WORLD_FAILED'),'CELL_DRIVE_NOT_FROM_STREAM');
   if(!unknown)check(drive.complete,'CELL_DRIVE_INCOMPLETE');
  }
  const sweep=evaluateWorldSweep(rows,admission,raw,{runId:cp.runId,bootId:cp.world.snapshot.bootId,sceneDigest:cp.world.snapshot.sceneDigest,lastCommittedTick:cp.tick,businessEpochMs:cp.manifest.clock.businessEpochMs},world.complete);
  for(const row of rows){const s=row.snapshot;check(s.bootId===cp.world.snapshot.bootId&&s.sceneDigest===admission.scene.sceneDigest&&s.worldStep?.modelCount===1&&s.worldStep.physicsSubsteps===(s.tick+1)*10&&s.worldStep.workerPid===rows[0]!.snapshot.worldStep!.workerPid,'CELL_SHARED_WORLD');}
  if(spec.kind==='nominal'){check(report.outcome.status==='completed'&&report.outcome.served==='2'&&report.attention.length===0&&sweep.status==='pass','CELL_NOMINAL_OUTCOME');check(report.businessEvents.filter(e=>e.type==='CupHandedOff').length===2&&report.businessEvents.filter(e=>e.type==='CupTransferConfirmed').length===4,'CELL_CONFIRMED_CUSTODY');const poses=new Map<string,number[]>();for(const row of rows)for(const p of row.snapshot.props??[]){const prev=poses.get(p.propId);if(prev)check(Math.hypot(...p.position.map((n,i)=>n-prev[i]!))<=.02,'CELL_PROP_CONTINUITY');poses.set(p.propId,p.position);}check(rows.flatMap(r=>r.interactions).length===4,'CELL_INTERACTIONS');}
  else{const fault=campaign.faults.find(f=>f.id===spec.id)!;check(report.outcome.served==='0'&&!report.businessEvents.some(e=>e.type==='CupHandedOff'),'CELL_FALSE_SERVED');check(journal.states.get('cup/cup-1')?.ownerKind===fault.lastSourceOwner&&report.coffee?.cups.find(c=>c.cupId==='cup-1')?.ownerKind===fault.lastSourceOwner,'CELL_LAST_SOURCE_CUSTODY');if(unknown){check(report.attention.some(a=>a.reason===fault.expectedCode),'CELL_FAULT_CODE');check(cp.world.pending?.targetTick===cp.tick+1&&cp.world.pending.stage==='sent'&&cp.world.pending.ackTick===null,'CELL_UNKNOWN_BOUNDARY');check(report.coffee?.physicalCustody?.find(c=>c.cupId==='cup-1')?.status==='unknown','CELL_UNKNOWN_CUSTODY');if(spec.kind==='lost-ack'){const ack=await read('lost-ack-native-response.json');check(ack.response.ok&&ack.response.tick===cp.tick+1&&ack.response.result.arms[0].gripper.heldPropIds.includes('cup-1'),'CELL_LOST_ACTUAL_ACK');}}
   else if(spec.kind==='cancel-held')check(report.coffee?.armTrace.stop?.reason==='CELL_CANCELLED'&&rows.at(-1)?.snapshot.arms?.[0]?.gripper?.heldPropIds.includes('cup-1'),'CELL_CANCEL_HOLD');
   else{check(report.attention.some(a=>a.reason===fault.expectedCode),'CELL_FAULT_CODE');const disturbed=rows.flatMap(r=>r.snapshot.worldStep?.disturbances??[]);check(disturbed.length===1&&disturbed[0]?.presetId===('presetId'in fault?fault.presetId:null),'CELL_ACTUAL_DISTURBANCE');}
  }
  v.completedCases++;
 }catch(e){v.missingArtifacts.push(spec.id);v.issues.push(`${spec.id}:${(e as Error).message}`);}}
 return v;
}
