/** Source-owned continuous world factory: one engine, journal-correlated custody,
 * bounded durable observations and no browser transport or hardware route. */
import {worldArmGeometry,worldAllowedPairs,validateWorldControl} from './world-control';
import {WORLD_DISTURBANCE_PRESETS,worldExperiment} from './world-disturbance';
import {boundWorldArmHistory,WORLD_HISTORY_POLICY} from './world-history';
import {materializeWorldArmReport} from './world-arm-report';
import {defaultCatalog} from '../capabilities';
import type {JsonObject,DomainEvent} from '../../../../contracts/src/index';
import type {CellAdapter,CellReport,CellCommand} from '../../../../cell-adapters/src/contract';
import type {CupLedger,PendingTransferIdentity,TransferObservation} from '../beverage/cup-ledger';
import {evaluateDockWindow,evaluateTrayReceipt,type DockSample,type ReceiptSample} from './handoff-policy';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {MOCK_COFFEE_PARAMS} from '../../../../cell-adapters/src/mock-coffee';
import {trackingStats} from './arm-ports';
import {MockArmPlant,type ArmProgramSet,type PlantExtras} from '../../../../cell-adapters/src/mock-arm';
import {createMockCoffeePorts} from '../beverage/coffee-ports';
import {loadOracleProfile} from '../algorithm/checker';
import {createNavigationController,type Decision} from '../navigation2d/controller';
import {createIRSimNavigationAdapter} from '../navigation2d/adapter';
import {holdSlot,releaseSlot,activeRunCount} from '../navigation2d/runner';
import type {Sim3DSnapshotV1,RobotPhysicalModelV1,LoadProfileV1} from '../navigation2d/contracts';
import {documentDigest} from '../navigation2d/contracts';
import type {LabProjectV2} from '../contracts';
import {hashJson} from '../hash';
import {XARM6_SI} from '../models/arm-kinematics';
import {invertPose,composePose} from '../frames';
import {MUJOCO_ARM_RELEASE_TIMEOUT_TICKS} from './mujoco-arm-ports';
import {MUJOCO_SLOT,type MujocoRuntimeOptions} from './mujoco';
import {spawnMujocoWorker} from './worker-client';
import {readWorldFixture,validateWorldObservation,worldArmObstacles,type WorldInteractionIntent} from './world-scene';
import {openWorldRecorder,prepareWorldAdmission} from './world-evidence';
import {worldDriveBundle,worldPlantDigest} from '../control/drive-experiments';
import {admitDriveDocuments,driveManifest,driveWireCommand,mobileDrive,type MobileDrive,BASE_CONTROLLER_DEFAULTS} from '../control/drive-run';
import {splitDriveSnapshot} from '../control/drive-io';
import {buildDriveEvidence} from '../control/drive-report';
import type {DriveRecord} from '../control/drive-metrics';
import type {ControllerEvent} from '../control/controller';
import {jointTrajectoryFollowerV1,type JointFollowerState} from '../control/joint-follower';
import type {WorldPortsFactory,WorldTickCommand} from './world-ports';

const worldProofs=new Map<string,{fixtureDigest:string;valid:boolean}>();
export const verifiedWorldRun=(runId:string,fixtureDigest:string)=>{const p=worldProofs.get(runId);return !!p?.valid&&p.fixtureDigest===fixtureDigest;};
export function mujocoWorldPorts(runtime:MujocoRuntimeOptions,spawn:typeof spawnMujocoWorker=spawnMujocoWorker):WorldPortsFactory{return async input=>{
 const set=defaultCatalog.sets[input.manifest.backendSetId],workflow=set?.execution?.composition==='single_world'&&set.scenarioIds?.includes(input.manifest.scenarioId)===true;
 if(!workflow)throw Error('WORLD_SCENARIO_UNSUPPORTED');
 if(runtime.physicsOverride||runtime.padFrictionOverride!==undefined||runtime.armExtraStatics)throw Error('WORLD_PROFILE_OVERRIDE_UNSUPPORTED');
 if(activeRunCount(MUJOCO_SLOT)>0)throw Error('MUJOCO_CAPACITY');holdSlot(MUJOCO_SLOT,input.runId);
 let worker:Awaited<ReturnType<typeof spawnMujocoWorker>>|undefined,closing:Promise<void>|undefined;
 const oldArm=input.state.arm,invalidate=()=>{const proof=worldProofs.get(input.runId);if(proof)proof.valid=false;};
 const close=()=>closing??=(async()=>{const p=worldProofs.get(input.runId);if(p)p.valid=false;await worker?.close('world closed');releaseSlot(MUJOCO_SLOT,input.runId);worldProofs.delete(input.runId);})();
 try{
  const {scene,files}=await readWorldFixture(runtime.workerRoot,'coffee-delivery-cell-v1'),st=input.state,ctx=input.context;
  if(scene.inputs.projectDigest!==hashJson(input.manifest.project)||st.armId!==scene.armCell.arm.armId||st.arm.programs.length||hashJson([...new Set([...st.plant.cups.map(c=>c.cupId),...st.workload.map(w=>w.cupId)])].sort())!==hashJson(scene.propBindings.map(p=>p.cupId).sort()))throw Error('WORLD_SOURCE_ADMISSION_MISMATCH');
  const fixtureDigest=scene.sceneDigest;
  const selected=worldExperiment(input.manifest);if(selected&&runtime.cellDisturbance)throw Error('WORLD_PERTURBATION_NOT_ADMITTED');
  if(selected??runtime.cellDisturbance){const o=(selected??runtime.cellDisturbance)!,b=scene.propBindings.find(b=>b.cupId===o.cupId);if(!b||!Object.hasOwn(WORLD_DISTURBANCE_PRESETS,o.presetId))throw Error('WORLD_PERTURBATION_NOT_ADMITTED');const preset=WORLD_DISTURBANCE_PRESETS[o.presetId];scene.disturbance={presetId:o.presetId,revision:1,cupId:o.cupId,targetId:o.presetId==='world-dock-drift-v1'?scene.navigation.robots[0]!.robotId:b.propId,trigger:preset.trigger};}
  // a registered drive experiment adds one combined drive model and control profile (nine axes) to the scene; without the field nothing is added and the scene is the R2b scene, byte for byte
  const driveBundle=input.manifest.driveExperimentId?await worldDriveBundle(runtime.workerRoot,input.manifest.driveExperimentId,scene.armCell.arm.armId,worldPlantDigest(scene)):undefined;
  if(driveBundle){for(const f of driveBundle.files){files.set(f.path,f.bytes);scene.files.push({path:f.path,sha256:createHash('sha256').update(f.bytes).digest('hex'),bytes:f.bytes.length});}scene.files.sort((a,b)=>a.path<b.path?-1:1);scene.engine={...driveBundle.refs};}
  scene.armCell.engineSeed=input.manifest.seed;scene.armCell.sceneDigest=documentDigest(scene.armCell,'sceneDigest');scene.sceneDigest=documentDigest(scene,'sceneDigest');
  const admission=prepareWorldAdmission(scene,files),doc=<T>(p:string)=>JSON.parse(Buffer.from(files.get(p)!).toString()) as T;
  const physical=doc<RobotPhysicalModelV1>(scene.models.mobilePhysical.path),load=doc<LoadProfileV1>(scene.models.emptyLoad.path),programDoc=doc<{programs:ArmProgramSet;digest:string;table:{waypoint:string;q:number[];positionErrorM:number;orientationErrorRad:number;condition:number}[]}>(scene.programsRef.path);
  const oracle=loadOracleProfile().profile.mujocoArm!,physics=doc<import('./arm-cell-scene').XArmPhysics>(scene.models.armPhysics.path);
  const support=load.supports.find(s=>s.supportId===scene.supportMap.mobileSupportId)!;
  const programs:ArmProgramSet={...structuredClone(programDoc.programs),contact:{openM:physics.gripper.openingMaxM,closedM:0,gripSettleTicks:oracle.gripSettleTicks,dropTicks:oracle.dropTicks,liftMinM:oracle.liftMinM,releaseTimeoutTicks:MUJOCO_ARM_RELEASE_TIMEOUT_TICKS,releaseObservationRequired:true,releaseSettleTicks:25},collision:{geometry:worldArmGeometry(scene,files),allowedPairs:[]}};
  try{await mkdir(join(input.directory,'mujoco-world'),{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('WORLD_RESTART_UNKNOWN');throw e;}
  const bundle=join(input.directory,'mujoco-world','bundle');await mkdir(bundle,{recursive:true,mode:0o700});
  for(const [name,b] of files){const path=join(bundle,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,b);}
  await writeFile(join(bundle,'lab-world-scene.json'),JSON.stringify(scene));
  worker=await spawn({python:runtime.python,workerRoot:runtime.workerRoot,runId:input.runId,bundleRoot:bundle,runDirectory:join(input.directory,'mujoco-world','run'),lockDigest:runtime.lockDigest,schemaDir:runtime.schemaDir,sceneDigest:scene.sceneDigest,...runtime.onRequestTiming?{onRequestTiming:runtime.onRequestTiming}:{},...runtime.entry?{entry:runtime.entry}:{}});
  let requests=0,engineTick=0,failed=false,sent=false,durableTick=-1,pending:WorldTickCommand|null=null,decisions:Decision[]=[],last:Sim3DSnapshotV1,observing:Sim3DSnapshotV1|undefined;
  const ask=async(op:string,payload:unknown)=>{const r=await worker!.request({protocol:'mekoniq-sim3d/1',requestId:`world-${++requests}`,runId:input.runId,expectedTick:engineTick,op,payload} as Parameters<NonNullable<typeof worker>['request']>[0]);if(!r.ok)throw Error(r.error.code);return r.result as Sim3DSnapshotV1;};
  // the architecture the worker runs on, from its own identity (not the runtime's: an emulated worker differs); only a drive run records it
  const hostArch=driveBundle?(await worker!.request({protocol:'mekoniq-sim3d/1',requestId:'world-describe',runId:input.runId,expectedTick:0,op:'describe',payload:{}} as Parameters<NonNullable<typeof worker>['request']>[0]).then(r=>r.ok?(r.result as {hostArch?:'arm64'|'x86_64'}).hostArch:undefined)):undefined;
  last=await ask('create',{sceneRef:'lab-world-scene.json',seed:input.manifest.seed});validateWorldObservation(last,scene,[]);await ask('start',{});
  const recorder=await openWorldRecorder({directory:join(input.directory,'world-evidence'),admission,runId:input.runId,bootId:last.bootId});
  if(!scene.controllerPolicy)throw Error('WORLD_CONTROLLER_POLICY_REQUIRED');
  const controller=createNavigationController(scene.navigation,{ramp:'previous-sent-command-v1',composition:'single_world',worldBounds:scene.controllerPolicy.bounds as {minM:[number,number];maxM:[number,number]},worldTolerances:scene.controllerPolicy.tolerances,...scene.controllerPolicy.braking?{worldBraking:scene.controllerPolicy.braking}: {},...scene.controllerPolicy.terminalApproachDistanceM!==undefined?{worldTerminalApproachM:scene.controllerPolicy.terminalApproachDistanceM,...scene.controllerPolicy.terminalApproachDirection?{worldTerminalApproachDirection:scene.controllerPolicy.terminalApproachDirection}:{}}: {}}),rid=scene.navigation.robots[0]!.robotId;
  const adapter=createIRSimNavigationAdapter({robotId:rid,scene:scene.navigation,controller,now:ctx.nowMs,mapId:'lab-world',mapRevision:String((input.manifest.project as LabProjectV2).world.revision),identity:{id:'mujoco_3d',version:runtime.engineVersion,model:'mujoco_shared_world'}});
  st.arm={...MockArmPlant.initial(st.armId,last.bootId,programs),plantId:'mujoco_arm',historyRetention:{...WORLD_HISTORY_POLICY,droppedTraceSamples:0,droppedPropsSamples:0,droppedDebugSamples:0}};
  const hp=doc<{robotId:string;armId:string;supportId:string;dock:{xyToleranceM:number;yawToleranceRad:number;maxLinearMps:number;maxAngularRadps:number;holdTicks:number};receiver:{maxRelativeMps:number;holdTicks:number;comMarginM:number};birth:{centerM:[number,number,number]}}>(scene.handoffPolicyRef.path);
  // the controllers of the drive: pure state machines on the measured feedback of the last verified snapshot; their events that need a person halt the cell like any other halted reason
  const driveDocs=driveBundle?await admitDriveDocuments(scene,async p=>files.get(p)!,runtime.workerRoot,worldPlantDigest(scene)):undefined;
  const armComponent=doc<{joints:{id:string;limits:{lower:{value:number};upper:{value:number}}}[]}>(scene.models.armComponent.path),gripLimits=armComponent.joints.find(j=>j.id==='drive_joint')!.limits,armId=scene.armCell.arm.armId;
  let baseDrive:MobileDrive|undefined,jointState:JointFollowerState|undefined;const driveRows:DriveRecord[]=[],driveEvents:ControllerEvent[]=[];if(driveDocs&&last.drives)driveRows.push({tick:last.tick,drives:last.drives});
  if(driveDocs){
   baseDrive=mobileDrive(driveDocs,{robotId:rid,...scene.navigation.robots[0]!.model.kinematics});
   jointState=jointTrajectoryFollowerV1.init({axes:[1,2,3,4,5,6].map(i=>`${armId}/J${i}`),gripperAxis:`${armId}/gripper`,gripperMap:{loRad:gripLimits.lower.value,hiRad:gripLimits.upper.value,openingMaxM:physics.gripper.openingMaxM},enableTimeoutTicks:BASE_CONTROLLER_DEFAULTS.enableTimeoutTicks,followTolRad:0.3,followTicks:25});
  }
  const driveWire=(c:WorldTickCommand):WorldTickCommand=>driveDocs?driveWireCommand(c):c;
  const dockPolicy={robotId:rid,trayId:support.supportId,maxXyM:hp.dock.xyToleranceM,maxYawRad:hp.dock.yawToleranceRad,maxVMps:hp.dock.maxLinearMps,maxOmegaRadps:hp.dock.maxAngularRadps,holdTicks:hp.dock.holdTicks};
  const dockSamples:DockSample[]=[],receiptSamples=new Map<string,ReceiptSample[]>(),transfers=new Map<string,{pending:PendingTransferIdentity;sourceEventId:string;sent:boolean;lost?:boolean;fallTicks?:number}>(),birthEvents=new Map<string,string>(),removeEvents=new Map<string,string>(),transferReports:CellReport[]=[];let ledger:CupLedger|undefined,disturbanceUsed=false,cellHalted:string|null=null;
  const dockSample=(s:Sim3DSnapshotV1):DockSample=>{const r=s.robots[0]!,p=scene.navigation.robots[0]!.initialPoseMap;return {tick:s.tick,robotId:r.robotId,trayId:support.supportId,xyErrorM:Math.hypot(r.poseDriveMap[0]!-p[0]!,r.poseDriveMap[1]!-p[1]!),yawErrorRad:Math.atan2(Math.sin(r.poseDriveMap[2]!-p[2]!),Math.cos(r.poseDriveMap[2]!-p[2]!)),vMps:r.bodyVelocity[0]!,omegaRadps:r.bodyVelocity[1]!,valid:true};};
  let dockTicks=0;const docked=(s:Sim3DSnapshotV1)=>{const r=s.robots[0]!,p=scene.navigation.robots[0]!.initialPoseMap;return Math.hypot(r.poseDriveMap[0]!-p[0]!,r.poseDriveMap[1]!-p[1]!)<=.01&&Math.abs(Math.atan2(Math.sin(r.poseDriveMap[2]!-p[2]!),Math.cos(r.poseDriveMap[2]!-p[2]!)))<=.02&&Math.abs(r.bodyVelocity[0]!)<=.01&&Math.abs(r.bodyVelocity[1]!)<=.02;};
  const base=createMockCoffeePorts(st,{...ctx,receiver:()=>docked(observing??last)&&dockTicks>=10?{robotId:rid,slot:1}:null},input.newBootId,{tracking:oracle,programs,model:XARM6_SI,advanceArm:false}),arm=base.mockArm!;st.arm.q=[...last.arms![0]!.positionsRad];
  const history:WorldInteractionIntent[]=[],removed=new Set<string>(),inverse=invertPose(scene.armCell.arm.baseInMap);
  const setScene=(s:Sim3DSnapshotV1)=>arm.setCollisionScene({available:true,scope:'self_scene_robot',revision:scene.sceneDigest,profileRevision:1,tick:s.tick,world:worldArmObstacles(scene,physical,s),robotPoses:[]});setScene(last);
  const release=(s:Sim3DSnapshotV1):PlantExtras['releaseObservation']=>{const id=st.arm.holding;if(!id)return undefined;const p=s.props?.find(p=>p.propId===id),l=s.physics?.loads.find(l=>l.propId===id),xy=l?.poseInSupport?.positionM,poly=support.polygonM,margin=scene.armCell.props.find(p=>p.propId===id)!.radiusM+.005;
   const inside=!!xy&&poly.every((a,i)=>{const b=poly[(i+1)%poly.length]!;return (b[0]!-a[0]!)*(xy[1]!-a[1]!)-(b[1]!-a[1]!)*(xy[0]!-a[0]!)>=margin*Math.hypot(b[0]!-a[0]!,b[1]!-a[1]!);});
   return {propId:id,valid:!!p&&p.restingOn===support.supportId&&inside&&!s.arms![0]!.gripper!.heldPropIds.includes(id)};
  };
  const coffee={...base,...workflow?{custodyEvidence:'correlated' as const}: {},...driveDocs?{driveReport:()=>buildDriveEvidence(driveDocs.model,driveRows,{complete:!failed,issues:failed?['WORLD_FAILED']:[],events:driveEvents})}:{},report:()=>({...base.report(),cupLedger:(ledger?.snapshot()??[]).map(c=>failed&&c.status==='known'?{...c,parent:null,status:'unknown' as const}:c),armPlant:{engine:'mujoco_3d' as const,engineVersion:runtime.engineVersion,control:'position_actuator' as const,grip:'contact' as const,dynamics:'manufacturer_nominal+assumed' as const,calibration:'not_calibrated' as const,tracking:trackingStats(st.arm.tracking!)},armCell:{waypoints:{digest:programDoc.digest,table:programDoc.table},inputs:{componentDigest:scene.models.armComponent.sha256,physicsDigest:scene.models.armPhysics.sha256,sceneDigest:scene.sceneDigest},allowedContactPolicy:'phase_region_v1' as const,allowedContacts:scene.allowedContactRules.map(r=>({a:r.a,b:r.b,phase:r.phase,regionId:r.regionId,sweepPair:[r.a==='held_prop'?'held-cup':r.a,r.regionId==='nozzle-stand'?'support/nozzle-stand':`${rid}/${support.parentBodyId}/c0`] as [string,string]})),releaseTimeoutTicks:programs.contact!.releaseTimeoutTicks,notes:['One shared MuJoCo world; raw birth/removal/grip/support observations are not Source custody receipts.','New world numerical/contact profile; modeled Source-correlated observations, not_calibrated. Logical arm/tray observers share one engine; no hardware sensor independence.']}}),setArmScene:()=>setScene(observing??last),custodyResolved:async(cupId:string,parent:string)=>{
   await base.custodyResolved?.(cupId,parent);
   if(parent.startsWith('table:')){
    if(workflow){if(!ledger)throw Error('WORLD_CUP_LEDGER_REQUIRED');if(last.arms![0]!.gripper!.heldPropIds.includes(scene.propBindings.find(b=>b.cupId===cupId)?.propId??''))throw Error('WORLD_MOVE_HELD_PROP');const cup=(await ctx.source.read('cup',cupId)).state;if(cup.ownerKind!=='customer'||parent!==`table:${String(cup.ownerId)}`||cup.pendingTransfer)throw Error('WORLD_RECIPIENT_NOT_CONFIRMED');const event=await sourceEvent('CupHandedOff',cupId);if(!event)throw Error('WORLD_RECIPIENT_EVENT_MISSING');removeEvents.set(cupId,event);await ledger.handoff(cupId,parent);}
    removed.add(cupId);
   }
  },...workflow?{
   holdMotion(reason:string){invalidate();cellHalted=reason;arm.halt(reason);},
   async armReportState(publicCommittedTick:number,source:import('../beverage/coffee-ports').WorldReportSource){if(observing||publicCommittedTick!==ctx.tick()||st.arm.tick!==publicCommittedTick)throw Error('WORLD_REPORT_HORIZON_INVALID');const critical=structuredClone(st.arm),capturedSource=structuredClone(source),capture=await recorder.capture({runId:input.runId,bootId:last.bootId,sceneDigest:scene.sceneDigest,admissionDigest:admission.digest,publicCommittedTick});return {materialize:(replay?:import('../beverage/coffee-ports').WorldReplaySink)=>materializeWorldArmReport(capture,admission,critical,capturedSource,replay)};},
   async canPickCup(missionId:string){if(!evaluateDockWindow(dockSamples,{...dockPolicy,expectedTick:last.tick}).ready||st.arm.programs.some(p=>p.state==='running'))return false;const m=(await ctx.source.read('mission',missionId)).state,stop=(m.stops as JsonObject[]).find(s=>s.id===m.currentStopId);return m.robotId===rid&&stop?.action==='load'&&stop.targetId===st.stationId&&stop.status==='awaiting_action';},
   bindLedger(value:CupLedger){if(ledger&&ledger!==value)throw Error('CUP_LEDGER_ALREADY_BOUND');ledger=value;},
   drain(){const reports=base.drain();return failed?[]:[...reports,...transferReports.splice(0)];},
   async advance(){await base.advance();for(const cup of st.plant.cups)if(cup.at==='nozzle'&&!birthEvents.has(cup.cupId)){const event=await sourceEvent('CupBound',cup.cupId);if(!event)throw Error('WORLD_CUP_BIRTH_EVENT_MISSING');const domain=(await ctx.source.read('cup',cup.cupId)).state;if(domain.ownerKind!=='cell'||domain.ownerId!==st.cellId)throw Error('WORLD_CUP_BIRTH_NOT_AUTHORIZED');birthEvents.set(cup.cupId,event);}},
   transferEvidence(transferId:string){const o=[...(ledger?.observations()??[])].reverse(),giver=o.find(x=>x.transferId===transferId&&x.phase==='release'),receiver=o.find(x=>x.transferId===transferId&&x.phase==='receive'),d=dockSample(last);return giver&&receiver?{giver,receiver,dock:{robotId:rid,slot:1,bootId:last.bootId,stationary:evaluateDockWindow(dockSamples,{...dockPolicy,expectedTick:last.tick}).ready,localizationValid:true,errorM:d.xyErrorM,receivedMonotonicNs:receiver.receivedMonotonicNs}}:null;}
  }: {}};
  async function sourceEvent(type:string,cupId:string,commandId?:string):Promise<string|null>{for(const entry of await ctx.source.journal()){const events=entry.payload.events as unknown as DomainEvent[];const i=events.findIndex(e=>e.type===type&&e.data.kind==='cup'&&e.data.id===cupId&&(!commandId||((e.data.state as JsonObject)?.pendingTransfer as JsonObject)?.commandId===commandId));if(i>=0)return `${entry.entryId}:${i}`;}return null;}
  if(workflow){
   const original=base.adapters[1]!,admitted:CellAdapter={describe:()=>original.describe(),cancel:id=>original.cancel(id),observe:fn=>original.observe(fn),reconcile:id=>original.reconcile(id),async execute(command:CellCommand){
    if(command.runId!==input.runId||command.deviceId!==st.armId||command.capability!=='start_job')return {accepted:false,unknown:false,reason:'WORLD_COMMAND_IDENTITY_MISMATCH'};
    const work=st.workload.find(w=>w.jobId===command.payload.jobId),cup=work?(await ctx.source.read('cup',work.cupId)).state:null,p=cup?.pendingTransfer as JsonObject|null;
    if(!work||!p||p.commandId!==command.commandId||p.payloadHash!==command.payloadHash||p.controlEpoch!==command.controlEpoch||!scene.propBindings.some(b=>b.cupId===work.cupId))return {accepted:false,unknown:false,reason:'WORLD_TRANSFER_IDENTITY_MISMATCH'};
    const to=p.to as unknown as PendingTransferIdentity['to'];if(to.kind==='arm'&&to.id!==st.armId||to.kind==='robot'&&(to.id!==rid||to.slot!==1))return {accepted:false,unknown:false,reason:'WORLD_TRANSFER_IDENTITY_MISMATCH'};if(command.programRef?.id!==(to.kind==='arm'?'cup-pick':'cup-place')||!evaluateDockWindow(dockSamples,{...dockPolicy,expectedTick:last.tick}).ready)return {accepted:false,unknown:false,reason:'WORLD_DOCK_NOT_READY'};
    const sourceEventId=await sourceEvent('CupTransferRequested',work.cupId,command.commandId);if(!sourceEventId)return {accepted:false,unknown:false,reason:'WORLD_TRANSFER_EVENT_MISSING'};
    const accepted=await original.execute(command);if(accepted.accepted&&!transfers.has(String(p.transferId)))transfers.set(String(p.transferId),{sourceEventId,pending:{runId:input.runId,cupId:work.cupId,transferId:String(p.transferId),commandId:command.commandId,payloadHash:command.payloadHash,controlEpoch:command.controlEpoch,deviceId:st.armId,to},sent:false});return accepted;
   }};coffee.adapters=[base.adapters[0]!,admitted];
  }
  function observeTransfers(s:Sim3DSnapshotV1){if(!workflow)return;
   const a=s.arms![0]!,d=dockSample(s);dockSamples.push(d);if(dockSamples.length>hp.dock.holdTicks)dockSamples.shift();
   for(const t of transfers.values()){
    const p=t.pending,binding=scene.propBindings.find(b=>b.cupId===p.cupId)!,prop=s.props?.find(x=>x.propId===binding.propId),load=s.physics?.loads.find(x=>x.propId===binding.propId),held=a.gripper!.heldPropIds.includes(binding.propId);
    const program=st.arm.programs.find(x=>x.commandId===p.commandId),parent=p.to.kind==='arm'?`arm:${st.armId}/tcp`:`robot:${p.to.id}/tray:${p.to.slot}`;
    const emit=(phase:TransferObservation['phase'])=>{const receiver=phase==='receive'||phase==='lost',ns=String(process.hrtime.bigint());const observation:TransferObservation={observationId:`world:${s.bootId}:${p.transferId}:${phase}:${s.tick}`,runId:p.runId,cupId:p.cupId,transferId:p.transferId,commandId:p.commandId,payloadHash:p.payloadHash,controlEpoch:p.controlEpoch,deviceId:receiver?rid:st.armId,observerId:`mujoco-world-${receiver?'tray':'arm'}:${receiver?rid:st.armId}`,bootId:s.bootId,clockDomain:`world:${s.bootId}`,seq:String(s.tick),producer:receiver?'mujoco_world_tray':'mujoco_world_arm',fidelity:'modeled',phase,parent:phase==='lost'?null:parent,grip:receiver?null:{closed:phase==='grasp',objectPresent:phase==='grasp'},observedMonotonicNs:s.simTimeNs,receivedMonotonicNs:ns,quality:'valid',...phase==='grasp'?{liftPoseReached:true}:{},world:{engine:'mujoco_3d',sceneDigest:s.sceneDigest,tick:s.tick,physicsSubsteps:s.worldStep!.physicsSubsteps}};transferReports.push({deviceId:observation.deviceId,bootId:observation.bootId,seq:observation.seq,observedAt:new Date(ctx.nowMs()).toISOString(),evidence:{source:observation.producer,transferObservation:observation}});};
    if(t.sent){if(p.to.kind==='robot'&&!t.lost&&ledger?.snapshot().some(x=>x.cupId===p.cupId&&x.status==='known'&&x.parent?.startsWith('robot:'))){const at=load?.poseInSupport?.positionM,bottom=at?.[2];t.fallTicks=!prop||bottom!==undefined&&bottom< -.05?(t.fallTicks??0)+1:0;if(t.fallTicks>=3){emit('lost');t.lost=true;invalidate();cellHalted='LOAD_FELL';arm.halt('LOAD_FELL',undefined,s.tick);adapter.sink.lost('LOAD_FELL');}}continue;}
    if(p.to.kind==='arm'){if(prop&&held&&st.arm.holding===p.cupId&&program?.evidence.liftPoseReached===true&&prop.position[2]!>=hp.birth.centerM[2]+programs.contact!.liftMinM){emit('grasp');t.sent=true;}continue;}
    const xy=load?.poseInSupport?.positionM,margin=scene.armCell.props.find(x=>x.propId===binding.propId)!.radiusM+hp.receiver.comMarginM,inside=!!xy&&support.polygonM.every((v,i)=>{const w=support.polygonM[(i+1)%support.polygonM.length]!;return (w[0]!-v[0]!)*(xy[1]!-v[1]!)-(w[1]!-v[1]!)*(xy[0]!-v[0]!)>=margin*Math.hypot(w[0]!-v[0]!,w[1]!-v[1]!);});
    const sample:ReceiptSample={...d,commandId:p.commandId,controlEpoch:p.controlEpoch,cupId:p.cupId,propId:binding.propId,supportId:prop?.restingOn??null,relativeSpeedMps:xy&&last.tick===s.tick-1&&last.physics?.loads.find(x=>x.propId===binding.propId)?.poseInSupport?Math.hypot(...xy.map((v,i)=>v-last.physics!.loads.find(x=>x.propId===binding.propId)!.poseInSupport!.positionM[i]!))/.02:Infinity,insideSupportMargin:inside,held};
    const samples=receiptSamples.get(p.transferId)??[];samples.push(sample);if(samples.length>hp.receiver.holdTicks)samples.shift();receiptSamples.set(p.transferId,samples);
    const receiver=evaluateTrayReceipt(samples,{...dockPolicy,commandId:p.commandId,controlEpoch:p.controlEpoch,cupId:p.cupId,propId:binding.propId,supportId:support.supportId,maxRelativeMps:hp.receiver.maxRelativeMps,holdTicks:hp.receiver.holdTicks,expectedTick:s.tick}).ready;
    const giver=!!prop&&!held&&a.gripper!.openingM>=programs.contact!.openM-.002&&st.arm.gripperCommandM===programs.contact!.openM;
    if(receiver&&giver){emit('release');emit('receive');t.sent=true;}
   }
  }

  worldProofs.set(input.runId,{fixtureDigest,valid:true});
  const project=input.manifest.project as LabProjectV2,navigation={mapId:'lab-world',mapRevision:String(project.world.revision),bindings:Object.fromEntries(project.world.points.map(p=>[p.id,{waypointId:p.id,mapId:'lab-world',mapRevision:String(project.world.revision),frame:'map' as const,x:p.x,y:p.y,yaw:p.kind==='parking'||p.kind==='coffee_pickup'?scene.navigation.robots[0]!.initialPoseMap[2]!:0}]))};
  return {displayScene:()=>structuredClone(scene),navigation,metadata:{...driveDocs?{drive:driveManifest(driveDocs,input.manifest.driveExperimentId,hostArch)}:{},clock:{tickMs:20,businessEpochMs:ctx.nowMs()},worldExtent:{...scene.controllerPolicy.bounds,controller:{id:scene.controllerPolicy.id,version:scene.controllerPolicy.version,hash:hashJson(scene.controllerPolicy)}},models:[{id:'mujoco_shared_world',revision:'1',hash:scene.sceneDigest,provenance:'manufacturer_nominal+assumed'},{id:'mock_coffee',revision:'1',hash:hashJson(MOCK_COFFEE_PARAMS),provenance:'illustrative'}],profiles:[{id:WORLD_HISTORY_POLICY.mode,revision:1,hash:hashJson(WORLD_HISTORY_POLICY),provenance:'source_derived_cache'},...scene.disturbance?[{id:scene.disturbance.presetId,revision:1,hash:hashJson({admission:scene.disturbance,preset:WORLD_DISTURBANCE_PRESETS[scene.disturbance.presetId]}),provenance:'registered_disturbance'}]:[],{id:scene.controllerPolicy.id,revision:Number(scene.controllerPolicy.version),hash:hashJson(scene.controllerPolicy),provenance:'assumed'},{id:scene.numericalPolicy.id,revision:1,hash:hashJson(scene.numericalPolicy),provenance:'assumed'}],armProgram:{fixture:{id:scene.id,revision:String(scene.revision)},physicsDigest:scene.models.armPhysics.sha256,programs:structuredClone(programs),programsDigest:hashJson(programs as never),waypointsDigest:programDoc.digest}},robots:new Map([[rid,adapter]]),coffee,snapshot:()=>structuredClone(last),
   evidence:{append:async s=>{await recorder.append(s,s.tick===0?null:pending);durableTick=s.tick;},fail:async f=>{failed=true;invalidate();await recorder.fail(f);},finish:()=>recorder.finish()},
   world:{prepareTick(targetTick){if(failed||pending)throw Error('WORLD_TERMINAL');if(targetTick!==last.tick+1||targetTick>30000)throw Error('WORLD_TARGET_TICK_INVALID');
     const active=st.arm.programs.find(p=>p.state==='running');programs.collision!.allowedPairs=worldAllowedPairs(scene,files,active?.program??null);
     const prepared=structuredClone(st.arm),preview=new MockArmPlant(prepared,ctx.nowMs,input.newBootId,{take:()=>null,put:()=>{}},()=>null,XARM6_SI,oracle,programs);preview.advance();
     const interlocked=!!cellHalted||st.arm.holding!==null||st.arm.programs.some(p=>p.state==='running')||st.arm.stop?.latched,nav=interlocked?{velocities:[{robotId:rid,vMps:0,omegaRadps:0}],decisions:[]}:controller.advance(last,{});decisions=nav.decisions;
     const propPlacements:WorldTickCommand['propPlacements']=[],worldInteractions:NonNullable<WorldTickCommand['worldInteractions']>=[];
     for(const binding of scene.propBindings){const born=history.some(i=>i.propId===binding.propId&&i.kind==='birth'),gone=history.some(i=>i.propId===binding.propId&&i.kind==='remove');
      const kind=!born&&st.plant.cups.some(c=>c.cupId===binding.cupId&&c.at==='nozzle')&&(!workflow||birthEvents.has(binding.cupId))?'birth':born&&!gone&&removed.has(binding.cupId)?'remove':null;if(!kind)continue;
      if(workflow&&last.arms![0]!.gripper!.heldPropIds.includes(binding.propId))throw Error('WORLD_MOVE_HELD_PROP');
      propPlacements.push({propId:binding.propId,pose:kind==='birth'?{position:hp.birth.centerM,quaternionXyzw:[0,0,0,1]}:null});worldInteractions.push({eventId:workflow?(kind==='birth'?birthEvents:removeEvents).get(binding.cupId)!:`source:${input.runId}:${binding.cupId}:${kind}`,cupId:binding.cupId,propId:binding.propId,kind,targetTick});
     }
     let worldPerturbations:WorldTickCommand['worldPerturbations'];const fault=scene.disturbance;
     if(fault&&!disturbanceUsed){const b=scene.propBindings.find(b=>b.cupId===fault.cupId)!,held=last.arms![0]!.gripper!.heldPropIds.includes(b.propId),p=st.arm.programs.find(p=>p.state==='running'),at=last.props?.find(p=>p.propId===b.propId),origin=scene.navigation.robots[0]!.initialPoseMap,r=last.robots[0]!;
      const trigger=fault.trigger==='before_release'?held&&p?.program==='cup-place'&&p.index===0&&prepared.gripperCommandM===programs.contact!.closedM:at?.restingOn===support.supportId&&!held&&Math.abs(r.bodyVelocity[0]!)>.01&&Math.hypot(r.poseDriveMap[0]!-origin[0]!,r.poseDriveMap[1]!-origin[1]!)>.5&&ledger?.snapshot().some(x=>x.cupId===fault.cupId&&x.parent===`robot:${rid}/tray:1`);
      if(trigger){disturbanceUsed=true;worldPerturbations=[{eventId:`disturbance:${input.runId}:${fault.presetId}`,presetId:fault.presetId,revision:1,targetId:fault.targetId,targetTick}];}
     }
     const transfer=active?[...transfers.values()].find(t=>t.pending.commandId===active.commandId):undefined;if(active&&!transfer)throw Error('WORLD_CONTROL_INVALID');
     const worldControl:NonNullable<WorldTickCommand['worldControl']>={version:1,program:active?{commandId:active.commandId,transferId:transfer!.pending.transferId,cupId:transfer!.pending.cupId,sourceEventId:transfer!.sourceEventId,payloadHash:active.payloadHash,controlEpoch:active.controlEpoch,programId:active.program as 'cup-pick'|'cup-place',stage:active.index,waypoint:programs.choreography[active.program]![active.index]!.waypoint}:null,attachmentProxyPropId:st.arm.holding===null?null:scene.propBindings.find(b=>b.cupId===st.arm.holding)!.propId,movementInterlocked:!!interlocked,stopLatched:!!st.arm.stop?.latched};validateWorldControl(worldControl,scene,files);
     let driveCommands:WorldTickCommand['driveCommands'];
     if(driveDocs&&baseDrive&&jointState){
      const {feedback}=splitDriveSnapshot(last.drives??[]);if(!feedback.length)throw Error('DRIVE_FEEDBACK_MISSING');
      const v=nav.velocities[0]!,b=baseDrive.step(last.tick,{vMps:v.vMps,omegaRadps:v.omegaRadps,...interlocked?{stop:true}:{}},last),a=jointTrajectoryFollowerV1.step(jointState,{tick:last.tick,setpoint:{positionsRad:prepared.commandedQ??prepared.q,openingM:prepared.gripperCommandM??programs.contact!.openM},feedback});
      jointState=a.state;driveCommands=[...a.commands,...b.commands];
      driveEvents.push(...b.events,...a.events);
      for(const e of [...b.events,...a.events])if((e.code==='DRIVE_FAULT'||e.code==='DRIVE_NOT_READY')&&!cellHalted){invalidate();cellHalted=e.code;arm.halt(e.code,undefined,last.tick);}
     }
     pending={targetTick,worldControl,...driveCommands?{driveCommands}:{},...worldPerturbations?{worldPerturbations}:{},velocities:nav.velocities,actorUpdates:[],jointTargets:[{armId:st.armId,positionsRad:prepared.commandedQ??prepared.q}],gripperTargets:[{armId:st.armId,openingM:prepared.gripperCommandM??programs.contact!.openM}],propPlacements,...worldInteractions.length?{worldInteractions}:{}};return structuredClone(pending);
    },async step(command){if(failed||sent||!pending||hashJson(command as never)!==hashJson(pending as never))throw Error('WORLD_COMMAND_INVALID');sent=true;try{const s=await ask('step',driveWire(command));engineTick=s.tick;validateWorldObservation(s,scene,[...history,...(command.worldInteractions??[]).map(i=>({...i,tick:i.targetTick}))]);return s;}catch(e){failed=true;invalidate();throw e;}},
    async commit(s){if(failed||!pending||s.tick!==pending.targetTick||durableTick!==s.tick)throw Error('WORLD_COMMIT_INVALID');observing=s;try{
      if(driveDocs&&s.drives)driveRows.push({tick:s.tick,drives:s.drives});
      setScene(s);if(st.arm.holding&&!docked(s)&&st.arm.programs.some(p=>p.state==='running'&&p.program==='cup-place')&&st.arm.gripperCommandM===programs.contact!.closedM){invalidate();cellHalted='DOCK_OUT_OF_TOLERANCE';arm.halt(cellHalted,undefined,s.tick);}
      dockTicks=docked(s)?dockTicks+1:0;arm.advance();const a=s.arms![0]!,extras:PlantExtras={gripper:a.gripper,releaseObservation:release(s),props:(s.props??[]).map(p=>{const q=composePose(inverse,{position:p.position,quaternionXyzw:p.quaternionXyzw});return {propId:p.propId,position:q.position,restingOn:p.restingOn,inMap:{positionM:p.position as [number,number,number],quaternionXyzw:p.quaternionXyzw as [number,number,number,number]}};})};arm.observe(a.positionsRad,a.collisionIds,extras);const t=st.arm.tracking!;(t.props??=[]).push({tick:s.tick,props:(extras.props??[]).map(p=>({propId:p.propId,positionM:p.inMap!.positionM,quaternionXyzw:p.inMap!.quaternionXyzw,restingOn:p.restingOn,held:a.gripper!.heldPropIds.includes(p.propId)}))});
      boundWorldArmHistory(st.arm);observeTransfers(s);adapter.sink.observe(s);for(const d of decisions)adapter.sink.decide(d);history.push(...(pending.worldInteractions??[]).map(i=>({...i,tick:i.targetTick})));last=structuredClone(s);pending=null;sent=false;
     }catch(e){failed=true;invalidate();throw e;}finally{observing=undefined;}},close}
  };
 }catch(e){input.state.arm=oldArm;await close();throw e;}
};}
