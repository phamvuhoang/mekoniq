// Synthetic reader fixture, never engine/qualification evidence. Real registered bundle,
// valid signed Source journal and valid complete world stream; tests alter independent facts.
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync} from 'node:zlib';
import {canonicalBytes,hashPayload,type JsonObject} from '../../packages/contracts/src/index';
import type {WorldEvidenceRecord,GraspAttempt,RecoveryStep} from '../../packages/contracts/generated/navigation2d';
import {documentDigest} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import {prepareWorldAdmission} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {cellArtifacts} from '../../packages/lab-runtime/src/v2/simulation3d/cell-campaign';
import {PICK_RIG_ENDPOINT_PROTOCOL,type RigReport} from '../../packages/lab-runtime/src/v2/perception/pick-rig-evidence';
import {PERCEPTION_STUDY_POINTS,rigOffsetM} from '../../packages/lab-runtime/src/v2/perception/perception-study';
import {openBeliefRecorder} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
import {WORLD_DISTURBANCE_PRESETS} from '../../packages/lab-runtime/src/v2/simulation3d/world-disturbance';
import type {RigRunRecord} from '../../packages/lab-runtime/src/v2/perception/pick-rig';
import {tick} from './physics';
import campaign from '../../robotics/simulation-mujoco/campaigns/perception-gap-v1.json';
import {scenarioRegistry,scenarioHash} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {instantiateBackends} from '../../packages/lab-runtime/src/v2/backend-registry';
export const STUDY_COMMIT='c'.repeat(40),EPOCH=Date.UTC(2026,0,1);
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const time=(t:number)=>new Date(EPOCH+t*20).toISOString();
export async function studyFixture(pointId='truth-0',seed=1){
 const point=PERCEPTION_STUDY_POINTS.find(p=>p.id===pointId)!,root=await mkdtemp(join(tmpdir(),'study-endpoint-')),directory=join(root,pointId,`s${seed}`),run=join(directory,'run'),runId=`unit-${pointId}-${seed}`,bootId='world-boot',commandId='pick-1',payloadHash='b'.repeat(64),offset=rigOffsetM(seed,point.truthOffsetM),position=[.49+offset[0],offset[1],.151],h=30;
 await mkdir(run,{recursive:true});
 const f=await readWorldFixture(resolve('robotics/simulation-mujoco'),'pick-rig-v1');
 if(point.nudge)f.scene.disturbance={presetId:'world-cup-nudge-v1',revision:1,cupId:'cup-1',targetId:'cup-1',trigger:'after_belief_commit'};
 f.scene.armCell.engineSeed=seed;f.scene.armCell.sceneDigest=documentDigest(f.scene.armCell,'sceneDigest');f.scene.sceneDigest=documentDigest(f.scene,'sceneDigest');
 const admission=prepareWorldAdmission(f.scene,f.files),sceneDigest=f.scene.sceneDigest,records:WorldEvidenceRecord[]=[],transfer={commandId,payloadHash,controlEpoch:1,transferId:'job-1:pick',to:{kind:'arm',id:'arm-1'}},confirmed={commandId,transferId:'job-1:pick',objectPresent:true,liftPoseReached:true,world:{tick:h,sceneDigest}};
 const events=[{type:'CupBound',kind:'cup',id:'cup-1',tick:0,state:{cupId:'cup-1'}},{type:'CupTransferRequested',kind:'cup',id:'cup-1',tick:1,state:{pendingTransfer:transfer}},{type:'CupTransferObserved',kind:'cup',id:'cup-1',tick:h,state:{pendingTransfer:{...transfer,lastResult:'completed'}}},{type:'CupTransferConfirmed',kind:'cup',id:'cup-1',tick:h,state:{movements:[{to:{kind:'arm',id:'arm-1'},evidence:confirmed}]}}];
 const sourceEvents=events.map((e,i)=>({sequence:String(i+1),at:time(e.tick),type:e.type,kind:e.kind,id:e.id,state:e.state as unknown as JsonObject}));
 for(let n=0;n<=h;n++){
  const physics=tick(n);physics.contacts=[];physics.loads=n?[{propId:'cup-1',poseMap:{positionM:[position[0]!+(point.nudge&&n>=5?.005:0),position[1]!,n===h?.32:position[2]!],quaternionXyzw:[0,0,0,1]},linearVelocityMapMps:[0,0,0],angularVelocityMapRadps:[0,0,0],supportId:'amr-1/tray-1',poseInSupport:{positionM:[0,0,0],quaternionXyzw:[0,0,0,1]}}]:[];
  for(const b of physics.base){b.robotId='amr-1';b.poseMap={positionM:[.35,.48591366218667575,.09],quaternionXyzw:[0,0,Math.SQRT1_2,Math.SQRT1_2]};b.rollRad=0;b.pitchRad=0;}for(const w of physics.wheels)w.robotId='amr-1';for(const o of physics.odometry){o.robotId='amr-1';o.poseDriveMap=[.35,.48591366218667575,Math.PI/2];}
  const snapshot:WorldEvidenceRecord['snapshot']={schemaVersion:1,runId,bootId,seq:String(n+1),tick:n,simTimeNs:String(n*20_000_000),sceneDigest,worldStep:{workerPid:1,modelCount:1,physicsSubsteps:(n+1)*10,primingSubsteps:10,nq:35,nv:32,nbody:admission.modelCounts.nbody,ngeom:admission.modelCounts.ngeom},robots:[{robotId:'amr-1',poseDriveMap:[.35,.48591366218667575,Math.PI/2],bodyVelocity:[0,0],collisionIds:[],scans:[],pose3d:{z:.09,roll:0,pitch:0},wheels:{leftRadS:0,rightRadS:0}}],arms:[{armId:'arm-1',positionsRad:f.scene.armCell.arm.homeRad,velocitiesRadS:Array(6).fill(0),collisionIds:[],gripper:{openingM:.08,heldPropIds:n===h?['cup-1']:[]}}],props:n?[{propId:'cup-1',position:physics.loads[0]!.poseMap.positionM,quaternionXyzw:[0,0,0,1],restingOn:n===h?null:'nozzle-stand'}]:[],physics};
  const command:WorldEvidenceRecord['command']=n?{targetTick:n,velocities:[{robotId:'amr-1',vMps:0,omegaRadps:0}],actorUpdates:[],jointTargets:[{armId:'arm-1',positionsRad:f.scene.armCell.arm.homeRad}],gripperTargets:[{armId:'arm-1',openingM:.08}],propPlacements:n===1?[{propId:'cup-1',pose:{position,quaternionXyzw:[0,0,0,1]}}]:[],...n===1?{worldInteractions:[{eventId:'entry-1:0',cupId:'cup-1',propId:'cup-1',kind:'birth',targetTick:n}]}:{},worldControl:{version:1,program:n>=2?{commandId,payloadHash,controlEpoch:1,transferId:'job-1:pick',cupId:'cup-1',sourceEventId:'entry-2:0',programId:'cup-pick',stage:2,waypoint:'lift'}:null,attachmentProxyPropId:null,movementInterlocked:n>=2,stopLatched:false}}:null;
  if(n===1)snapshot.worldStep!.birthObservations=[{method:'mujoco-freejoint-body-before-step-v1',frame:'map',propId:'cup-1',cupId:'cup-1',eventId:'entry-1:0',targetTick:n,runId,bootId,sceneDigest,requestId:`world-${n+2}`,requestDigest:hashJson(command),physicsSubstepsBefore:10,qposPositionM:[...position],bodyPositionM:[...position],quaternionXyzw:[0,0,0,1]}];
  if(point.nudge&&n===5){command!.worldPerturbations=[{eventId:'nudge-1',presetId:'world-cup-nudge-v1',revision:1,targetId:'cup-1',targetTick:n}];snapshot.worldStep!.disturbances=[{...command!.worldPerturbations[0]!,runId,bootId,sceneDigest,requestId:`world-${n+2}`,requestDigest:hashJson(command),frame:'map',forceMapN:[14.4,0,0],durationSubsteps:WORLD_DISTURBANCE_PRESETS['world-cup-nudge-v1'].durationSubsteps,beforePositionM:records.at(-1)!.snapshot.props![0]!.position,afterPositionM:snapshot.props![0]!.position}];}
  records.push({snapshot,command,interactions:n===1?[{eventId:'entry-1:0',cupId:'cup-1',propId:'cup-1',kind:'birth',tick:n,commandDigest:hashJson(command),reason:'source_nozzle_birth',before:null,after:{position:snapshot.props![0]!.position,quaternionXyzw:[0,0,0,1]}}]:[]});
 }
 const attempts:GraspAttempt[]=point.mode==='fixed_program'?[]:[['plan',2,'unknown'],['commit',4,'unknown'],['outcome',h,'lifted']].map(([stage,recordedTick,outcome])=>({attemptId:'cup-1#0',cupId:'cup-1',index:0,decidedTick:2,mode:point.mode,beliefUsed:null,beliefErrorAtCommitM:0,gates:{belief:'pass',region:'pass',ik:'pass',sweep:'pass'},ikResidual:[],stage,recordedTick,outcome} as GraspAttempt));
 const programs=[{commandId,payloadHash,controlEpoch:1,program:'cup-pick',index:3,state:'completed',waiting:0,accepted:{accepted:true,unknown:false},evidence:{source:'mujoco_arm',grip:'contact',forceModel:'none',gripperClosed:true,objectPresent:true,liftPoseReached:true,cupId:'cup-1'}}];
 const report={schemaVersion:2,pickRig:{endpointProtocol:PICK_RIG_ENDPOINT_PROTOCOL,maxTicks:12000},manifest:{runId,sourceCommit:STUDY_COMMIT,seed,clock:{tickMs:20,businessEpochMs:EPOCH},models:[{id:'mujoco_shared_world',hash:sceneDigest}],profiles:point.nudge?[{id:'world-cup-nudge-v1',provenance:'registered_disturbance'}]:[],armProgram:{fixture:{id:'pick-rig-v1'},programs:{contact:{liftMinM:.14}}},calibration:{status:'not_calibrated'}},outcome:{status:'running',served:'0',tick:h,simTimeNs:String(h*20_000_000)},coffee:{cellEffects:[{type:'cell.execute',payload:{...transfer,cupId:'cup-1',programRef:{id:'cup-pick'}}}]},businessEvents:sourceEvents,worldSweep:{scope:{publicCommittedTick:h,prefixCovered:true,identity:{runId,bootId,sceneDigest,admissionDigest:admission.digest}},nativeContacts:{status:'pass',aggregateRows:0,unexpected:0,firstUnexpected:null}},arm:{worldTrace:{firstTick:0,lastTick:h,samples:h+1,publicCommittedTick:h,prefixCovered:true,reasonCodes:[]}}} as unknown as RigReport;
 const scenario=scenarioRegistry.get('MJ-CELL-BV01')!,set=defaultCatalog.sets['engineering-mujoco-cell-v1']!,catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>({...b,installed:true,compatible:true,reachable:true}))},project=JSON.parse(Buffer.from(f.files.get('project.json')!).toString());
 Object.assign(report.manifest,{mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-cell-v1',backends:instantiateBackends('engineering-mujoco-cell-v1',catalog,set.backends).descriptors,scenario:{id:scenario.id,revision:scenario.revision,hash:scenarioHash(scenario)},project:{id:project.id,revision:project.revision,hash:hashJson(project)}});report.attention=[];
 const checkpoint={runId,tick:h,manifest:report.manifest,started:true,cancelled:false,paused:false,attention:report.attention,confirmations:{},workload:[],roles:{robots:[{id:'amr-1',parkingId:'parking'}]},coffee:{workload:[{jobId:'job-1',lineId:'line-1',missionId:'mission-1',status:'reserved'}],arm:{programs}},world:{snapshot:{bootId,tick:h}}};
 const sourceStates=new Map<string,JsonObject>([['fulfillment/line-1',{served:'0'}],['mission/mission-1',{status:'running'}],['coffee-job/job-1',{status:'reserved'}]]),recovery:RecoveryStep[]=[];
 if(point.mode!=='fixed_program'){
  const bytes=await readFile(`robotics/simulation-mujoco/fixtures/perception-v1/${point.profileId??'perception-ground-truth-v1'}.json`),profile=JSON.parse(bytes.toString());
  report.manifest.perception={graspMode:point.mode,profile:{id:profile.id,revision:profile.revision,digest:profile.digest,sha256:sha(bytes)},recoveryPolicy:null};
 }
 const input:RigRunRecord['input']={seed,mode:point.mode,truthOffsetM:point.truthOffsetM,profileId:point.profileId,nudge:point.nudge,recoveryPolicyId:null,sourceCommit:STUDY_COMMIT,maxTicks:12000};
 const result={runId,outcome:'lifted',attempts:1,recovered:false,attention:false,ticks:h,unexpectedContacts:0,beliefErrorAtCommitM:point.mode==='fixed_program'?null:0,directory,endpoint:{protocol:PICK_RIG_ENDPOINT_PROTOCOL,cupId:'cup-1',commandId,reason:'resolved',firstTick:0,lastTick:h,tickMs:20},birth:{tick:1,cupId:'cup-1',propId:'cup-1',eventId:'entry-1:0',positionM:position,firstPostStepPositionM:[...position],method:'mujoco-freejoint-body-before-step-v1',physicsSubstepsBefore:10,fixtureId:'pick-rig-v1',handoffPolicySha256:f.scene.handoffPolicyRef.sha256}};
 const record={schemaVersion:2,endpointProtocol:PICK_RIG_ENDPOINT_PROTOCOL,accepted:false,calibration:'not_calibrated',input,offsetM:offset,result} as RigRunRecord;
 const props={schemaVersion:1,frame:'map',samples:records.map(r=>({tick:r.snapshot.tick,props:r.snapshot.props!.map(p=>({propId:p.propId,positionM:[...p.position],quaternionXyzw:[...p.quaternionXyzw],restingOn:p.restingOn,held:r.snapshot.arms![0]!.gripper!.heldPropIds.includes(p.propId)}))}))};
 const key=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const write=async()=>{
  sourceEvents.forEach((e,i)=>{e.sequence=String(i+1);});
  await writeFile(join(root,'campaign.json'),JSON.stringify({campaign,endpointProtocol:PICK_RIG_ENDPOINT_PROTOCOL,sourceCommit:STUDY_COMMIT,accepted:false,execution:'actual_mujoco',calibration:'not_calibrated'}));
  for(const [path,bytes]of [...f.files,['lab-world-scene.json',Buffer.from(JSON.stringify(f.scene))] as const]){const file=join(run,'mujoco-world/bundle',path);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);}
  await mkdir(join(run,'world-evidence'),{recursive:true});const raw=gzipSync(records.map(r=>JSON.stringify(r)+'\n').join('')),path='world-000000-00000000.ndjson.gz';await writeFile(join(run,'world-evidence',path),raw);await writeFile(join(run,'world-evidence/manifest.json'),JSON.stringify({schemaVersion:1,documentType:'world-evidence',runId,bootId,sceneDigest,admissionDigest:admission.digest,chunks:[{path,sha256:sha(raw),bytes:raw.length,firstTick:0,lastTick:records.at(-1)!.snapshot.tick}],lastTick:records.at(-1)!.snapshot.tick,complete:true,terminal:null,gaps:[]}));
  const trace=JSON.stringify(props),digest=sha(trace);report.arm!.props={path:`arm-props-trace-${digest}.json`,sha256:digest,samples:props.samples.length};await writeFile(join(run,report.arm!.props.path),trace);
  if(point.mode!=='fixed_program'){
   const dir=join(run,'belief-evidence');await rm(dir,{recursive:true,force:true});const profile=JSON.parse(await readFile(`robotics/simulation-mujoco/fixtures/perception-v1/${point.profileId??'perception-ground-truth-v1'}.json`,'utf8'));
   const recorder=await openBeliefRecorder({directory:dir,identity:{runId,bootId,sceneDigest,perceptionProfileDigest:profile.digest,recoveryPolicyDigest:report.manifest.perception!.recoveryPolicy?.digest??null,graspMode:point.mode,seed}});
   // Intentionally no belief sample in the nudge window: only actual props see it.
   for(const a of attempts)await recorder.appendAttempt(a);for(const s of recovery)await recorder.appendRecovery(s);await recorder.finish(null);
  }
  await rm(join(run,'journal.db'),{force:true});await writeFile(join(run,'signing-key.json'),JSON.stringify(key.publicKey.export({format:'jwk'})));
  const db=new DatabaseSync(join(run,'journal.db'));try{db.exec('CREATE TABLE journal (producer_sequence TEXT, entry_json TEXT)');for(const [i,e]of sourceEvents.entries()){
   const payload={mutations:i===sourceEvents.length-1?[...sourceStates].map(([key,newState])=>{const [kind,id]=key.split('/');return {ref:{kind,id},expectedVersion:0,newState};}):[],events:[{type:e.type,data:{kind:e.kind,id:e.id,state:e.state}}]},unsigned={schemaVersion:1,entryId:`entry-${i+1}`,operationId:`op-${i+1}`,organizationId:`lab-${runId}`,venueId:'simulation',deviceId:'lab-coordinator',deviceEpoch:'lab-epoch-1',sequence:String(i+1),coordinatorEpoch:1,aggregateType:'cup',aggregateId:'cup-1',expectedVersion:i,resultingVersion:i+1,kind:'accepted_fact',occurredAt:e.at,recordedAt:e.at,timezone:'UTC',businessDate:'2026-01-01',clockConfidence:'trusted',actorRef:'test',payload,payloadHash:hashPayload(payload as JsonObject)},entry={...unsigned,signature:sign('sha256',canonicalBytes(unsigned as unknown as JsonObject),{key:key.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};db.prepare('INSERT INTO journal VALUES (?,?)').run(String(i+1),JSON.stringify(entry));
  }}finally{db.close();}
  await writeFile(join(run,'run.json'),JSON.stringify(checkpoint));await writeFile(join(directory,'report.json'),JSON.stringify(report));await writeFile(join(directory,'rig-run.json'),JSON.stringify(record));await rehash();
 };
 const rehash=async()=>writeFile(join(directory,'case.json'),JSON.stringify({sourceCommit:STUDY_COMMIT,artifacts:await cellArtifacts(directory)}));
 await write();return {root,directory,run,admission,records,report,checkpoint,record,input,props,attempts,recovery,sourceEvents,sourceStates,write,rehash};
}
