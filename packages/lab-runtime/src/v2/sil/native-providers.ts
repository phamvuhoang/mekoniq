// Server-owned production composition. The browser selects only a registered set/project.
import {fileURLToPath} from 'node:url';
import {nativeToolClosure} from '../../../../../scripts/native-sim/tool-identity.mjs';
declare const __LAB_SOURCE_COMMIT__:string;
declare const __LAB_SOURCE_DIRTY__:boolean;
declare const __LAB_NATIVE_TOOLS__: {version:number;digest:string;files:{path:string;sha256:string;bytes:number}[]};
const approvedTools:typeof __LAB_NATIVE_TOOLS__=typeof __LAB_NATIVE_TOOLS__!=='undefined'?__LAB_NATIVE_TOOLS__:nativeToolClosure(fileURLToPath(new URL('../../../../../',import.meta.url)));
import {readFile,realpath,writeFile,open,rename,mkdir,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
// @ts-expect-error server-owned ESM tunnel is also tested directly as JavaScript
import {startArmTunnel} from '../../../../../scripts/native-sim/arm-tunnel.mjs';
import {connectBridge,connectArmBackend,loadArmProfile,LinuxcncArmAdapter,LINUXCNC_SIM,type ArmBridgePort,type ArmStatus} from '../arm/adapter';
import {loadArmModel,createArmSession,tsChecker,modeledCupCenter} from '../arm/session';
import {createPlantSession} from '../beverage/plant-session';
import {COFFEE_IO_SIM} from '../../../../cell-adapters/src/coffee-io-sim';
import type {CellReport} from '../../../../cell-adapters/src/contract';
import {readCompiledWorld,startGazeboBackend,GAZEBO_NAV2,type GazeboBackend,type CompiledWorld} from '../backends/gazebo-nav2';
import {createBarrierCoordinator} from '../backends/clock-barrier';
import {hashJson} from '../hash';
import {resolveRoles,scenarioRegistry} from '../scenario-registry';
import {validateTwinSampleV2,validateProjectV2,type LabProjectV2,type TwinSampleV2} from '../contracts';
import type {JsonObject} from '../../../../contracts/src/index';
import type {ArmObstacle} from '../models/arm-collision';
import type {Vec3} from '../frames';
import type {TransferObservation} from '../beverage/cup-ledger';
import type {NativeProviderFactory,NativePlant,NativeObservedSnapshot} from './native-lifecycle';
import {createNativeScenarioRun,nativeProjectGeometry} from './native-lifecycle';
import type {NativeReadinessChecks} from '../readiness';
import {validateFaultSchedule,dueFaults,type FaultScheduleEntry,type FaultPhase} from '../fault-schedule';
import {validateNativeFaultExpectation,type NativeFaultExpectation,type NativeFaultBaseline} from './native-fault-oracle';
import {defaultCatalog} from '../capabilities';
export interface NativeFault {id:string;kind:'missing-cup'|'grip-failure'|'amr-disconnect'|'amr-delay'|'blocker'|'controller-restart'|'tunnel-loss';atSimMs:number;durationMs:number}
export interface NativeServerConfig {faultExpectation?:NativeFaultExpectation;restartOperator?:{mode:'operator';timeoutMs:number};faultSchedule?:FaultScheduleEntry[];faults?:NativeFault[];sourceRoot:string;bundleDirectory:string;environmentProfile:string;python?:string;arm:{socketPath?:string;tunnel?:{parentDir:string;alias:string;knownHosts:string}}}
/** Tests replace transports, never the source workflow. Injection is permanently protocol_double, even if hello says sil. */
type ControllerIdentity=Pick<ArmStatus,'bootId'|'controllerEpoch'>;
export interface NativeProtocolDoubles {observeController?():Promise<ControllerIdentity|null>;gazebo(world:CompiledWorld,runId:string):Promise<GazeboBackend>;arm():Promise<ArmBridgePort>;restartController?():Promise<void>}
interface Geometry {modelManifestSha256:string;worldFromArmBaseM:Vec3;poses:Record<string,{cupCenterWorldM:Vec3}>;nativeCandidate:{dockPositionM:Vec3;cupOffsetInRobotM:Vec3;dockYawRad:number}}
export async function nativeProviderFactory(config:NativeServerConfig,doubles?:NativeProtocolDoubles):Promise<NativeProviderFactory>{
 const faultExpectation=config.faultExpectation?validateNativeFaultExpectation(config.faultExpectation):undefined;
 const faults=config.faults??[];if(faults.length>100||new Set(faults.map(f=>f.id)).size!==faults.length||faults.some(f=>!/^[A-Za-z0-9_.:-]{1,100}$/.test(f.id)||!['missing-cup','grip-failure','amr-disconnect','amr-delay','blocker','controller-restart','tunnel-loss'].includes(f.kind)||!Number.isSafeInteger(f.atSimMs)||f.atSimMs<0||f.atSimMs>3_600_000||!Number.isSafeInteger(f.durationMs)||f.durationMs<1||f.durationMs>60_000))throw new Error('NATIVE_FAULT_CONFIG_INVALID');
 if(config.restartOperator&&(config.restartOperator.mode!=='operator'||!Number.isSafeInteger(config.restartOperator.timeoutMs)||config.restartOperator.timeoutMs<10||config.restartOperator.timeoutMs>60000))throw new Error('NATIVE_RESTART_POLICY_INVALID');
 if(faults.some(f=>f.kind==='controller-restart')&&!doubles?.restartController&&!config.restartOperator)throw new Error('NATIVE_CONTROLLER_RESTART_REQUIRES_EXTERNAL_OPERATOR');
 if(!isAbsolute(config.sourceRoot)||!isAbsolute(config.bundleDirectory))throw new Error('NATIVE_SERVER_PATH_REQUIRED');
 let approvedCommit:string|undefined;
 const embedded=typeof __LAB_NATIVE_TOOLS__!=='undefined';
 const checkCheckout=async()=>{const cwd=fileURLToPath(new URL('../../../../../',import.meta.url)),git=promisify(execFile);if((await git('git',['status','--porcelain','--untracked-files=all'],{cwd})).stdout.trim())throw new Error('NATIVE_CLEAN_SOURCE_REQUIRED');return (await git('git',['rev-parse','HEAD'],{cwd})).stdout.trim();};
 if(!doubles){if(embedded){if(typeof __LAB_SOURCE_DIRTY__==='undefined'||__LAB_SOURCE_DIRTY__)throw new Error('NATIVE_CLEAN_SOURCE_REQUIRED');approvedCommit=__LAB_SOURCE_COMMIT__;}else approvedCommit=await checkCheckout();}
 const root=await realpath(config.sourceRoot),tools=nativeToolClosure(root);if(tools.digest!==approvedTools.digest)throw new Error('NATIVE_TOOL_IDENTITY_MISMATCH');
 const toolBytes=new Map<string,Buffer>();for(const file of approvedTools.files){const bytes=await readFile(join(root,file.path));if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('NATIVE_TOOL_IDENTITY_MISMATCH');toolBytes.set(join(root,file.path),bytes);}
 const fixturePath=join(root,'tests/fixtures/digital-twin/sil/bv01.json');
 const fixtureBytes=await readFile(fixturePath);
 const fixture=JSON.parse(fixtureBytes.toString()) as {project:LabProjectV2;beverage:{cups:{fixtureId:string;gazeboModel:string;positionM:Vec3}[]}};
 const project=fixture.project,world=await readCompiledWorld(config.bundleDirectory),geometry=JSON.parse(await readFile(join(root,'integrations/arm-controller/configs/sim/puma560/cup-geometry.json'),'utf8')) as Geometry;
 const manifestBytes=await readFile(join(config.bundleDirectory,'compiler-manifest.json'));
 const manifest=JSON.parse(manifestBytes.toString()) as {outputs:{path:string;sha256:string}[]};
 const compiledRoot=await realpath(config.bundleDirectory),approved=new Map<string,Buffer>();approved.set(join(compiledRoot,'compiler-manifest.json'),manifestBytes);approved.set(fixturePath,fixtureBytes);
 for(const a of manifest.outputs){const actual=await realpath(join(compiledRoot,a.path));if(!actual.startsWith(compiledRoot+'/')||actual!==resolve(compiledRoot,a.path))throw new Error('NATIVE_BUNDLE_PATH_ESCAPE');const bytes=await readFile(actual);approved.set(actual,bytes);if(createHash('sha256').update(bytes).digest('hex')!==a.sha256)throw new Error('NATIVE_BUNDLE_DIGEST_MISMATCH');}
 const assets=await Promise.all((fixture as unknown as {assetFiles:string[]}).assetFiles.map(async file=>JSON.parse(await readFile(resolve(fixturePath,'..',file),'utf8'))));
 if(hashJson({project,assets,scenario:fixture})!==world.inputHash)throw new Error('NATIVE_COMPILED_FIXTURE_MISMATCH');
 const profile=loadArmProfile(join(root,'integrations/arm-controller/configs/sim/puma560/profile.json')),model=loadArmModel(join(root,'integrations/arm-controller/models/puma560-reference'));
 if(profile.model.manifestSha256!==geometry.modelManifestSha256)throw new Error('NATIVE_MODEL_PIN_MISMATCH');
 const dockPoint=project.world.points.find(p=>p.kind==='coffee_pickup');
 if(!dockPoint||dockPoint.x!==geometry.nativeCandidate.dockPositionM[0]||dockPoint.y!==geometry.nativeCandidate.dockPositionM[1])throw new Error('NATIVE_FIXTURE_GEOMETRY_MISMATCH');
 const validateSchedule=(entries:FaultScheduleEntry[])=>{validateFaultSchedule(entries,project.entities,'simulation');if(faultExpectation&&entries.some(e=>e.id!==faultExpectation.faultId))throw new Error('NATIVE_FAULT_CASE_EXTRA_SCHEDULE');if(entries.some(e=>['arm-reboot','controller-restart'].includes(e.faultId))&&!doubles?.restartController&&!config.restartOperator)throw new Error('NATIVE_CONTROLLER_RESTART_REQUIRES_EXTERNAL_OPERATOR');};validateSchedule(config.faultSchedule??[]);
 const factory:NativeProviderFactory={world,project,faultExpectation,validateSchedule,configurationHash:hashJson({approvedCommit:approvedCommit??null,nativeTools:approvedTools.digest,faultExpectation:faultExpectation??null,faults,schedule:config.faultSchedule??[],restartOperator:config.restartOperator??null,environmentProfile:config.environmentProfile,model:geometry.modelManifestSha256}),async open(input,runId,directory,signal){
  if(!doubles&&(input.sourceCommit!==approvedCommit||!embedded&&await checkCheckout()!==approvedCommit))throw new Error('NATIVE_SOURCE_COMMIT_MISMATCH');
  const roles=resolveRoles(scenarioRegistry.get(input.scenarioId)!,project),robotId=roles.robots[0]!.id,worldRevision=hashJson(project.world);
  const targetFor=(kind:NativeFault['kind'])=>kind==='missing-cup'?roles.coffee!.cellId:['grip-failure','controller-restart','tunnel-loss'].includes(kind)?roles.coffee!.armId:robotId;
  const schedules=[...faults.map(f=>({id:f.id,faultId:f.kind,targetId:targetFor(f.kind),trigger:{kind:'elapsed_sim_ms' as const,value:f.atSimMs},durationMs:f.durationMs})),...config.faultSchedule??[],...((input.project as LabProjectV2).faultSchedule??[])];validateSchedule(schedules);if(faultExpectation&&!schedules.some(e=>e.id===faultExpectation.faultId))throw new Error('NATIVE_FAULT_EXPECTATION_UNSCHEDULED');
  let backend:GazeboBackend|undefined,adapter:LinuxcncArmAdapter|undefined,tunnel:Awaited<ReturnType<typeof startArmTunnel>>|undefined,port:ArmBridgePort|undefined,closePromise:Promise<void>|undefined;
  const off:(()=>void)[]=[];let flushFaults=()=>Promise.resolve();
  const close=()=>closePromise??=(async()=>{for(const f of off)f();await flushFaults();await adapter?.close().catch(()=>{});if(!adapter)await port?.close().catch(()=>{});await backend?.close().catch(()=>{});await tunnel?.close();})();
  try{
   signal.throwIfAborted();
   // Validate against startup-approved bytes, never against a replacement manifest. Execute from a private run snapshot.
   for(const [path,bytes] of [...approved,...toolBytes]){if(await realpath(path)!==path||!bytes.equals(await readFile(path)))throw new Error('NATIVE_PIN_CHANGED');}
   const inputs=join(directory,'inputs'),workerRoot=join(inputs,'source'),bundle=join(inputs,'bundle');await mkdir(bundle,{recursive:true,mode:0o700});
   for(const [path,bytes] of approved){const dest=path===fixturePath?join(inputs,'scenario.json'):join(bundle,path.slice(compiledRoot.length+1));await mkdir(resolve(dest,'..'),{recursive:true,mode:0o700});await writeFile(dest,bytes,{mode:0o400});await chmod(dest,0o400);}
   for(const [path,bytes] of toolBytes){const dest=join(workerRoot,path.slice(root.length+1));await mkdir(resolve(dest,'..'),{recursive:true,mode:0o700});await writeFile(dest,bytes,{mode:0o400});await chmod(dest,0o400);}
   const runWorld=await readCompiledWorld(bundle);if(runWorld.inputHash!==world.inputHash||runWorld.manifestHash!==world.manifestHash||hashJson(runWorld.bindings)!==hashJson(world.bindings))throw new Error('NATIVE_PIN_CHANGED');
   backend=doubles?await doubles.gazebo(runWorld,runId):await startGazeboBackend(runWorld,runId,{simulationRoot:join(workerRoot,'robotics/simulation'),environmentProfile:config.environmentProfile,python:config.python,scenarioFile:join(inputs,'scenario.json')});
   signal.throwIfAborted();const cap=await backend.capability();if(!cap.available||!cap.beverage?.available)throw new Error(`NATIVE_GAZEBO_UNAVAILABLE:${cap.reasons.concat(cap.beverage?.reasonCodes??[]).join(',')}`);
   if(doubles)port=await doubles.arm();else if(config.arm.tunnel){tunnel=await startArmTunnel(config.arm.tunnel);port=await connectBridge(tunnel.socketPath);}else if(config.arm.socketPath)port=await connectBridge(config.arm.socketPath);else throw new Error('ARM_TRANSPORT_UNCONFIGURED');
   signal.throwIfAborted();
   let domainNow:()=>number=Date.now;
   adapter=new LinuxcncArmAdapter({port,profile,runId,cellId:roles.coffee!.cellId,deviceId:roles.coffee!.armId,nowMs:()=>domainNow(),journalPath:join(directory,'arm.sqlite'),simulationScene:{worldRevision},correlatedBarrier:true,wireDeadline:{}});
   const arm=createArmSession({model,checker:tsChecker(),entityId:roles.coffee!.armId,runId,providerId:'linuxcnc_sim',staleMs:profile.telemetry.staleMs});
   const openedMonotonicNs=String(process.hrtime.bigint());let firstSimTimeNs:string|null=null;
   let frozen=false,frozenSnapshot:NativeObservedSnapshot|undefined;const restartObservers=new Set<(s:ControllerIdentity)=>void>(),observationWindows=new Set<Promise<void>>();
   let blockerEnabled=false,clockOriginNs:string|undefined;
   let observeFault:(kind:NativeFault['kind'],proof:JsonObject)=>Promise<void>=async()=>{};
   let status:ArmStatus|undefined,runTick=0,sceneSeq=0,lastCoffeeTick=0,simTimeNs:string|null=null,lastRobot:TwinSampleV2|undefined,lastPoseReceipt=0n,dockReceipt=0n;
   let dock:NativeObservedSnapshot['dock']={robotId,errorM:100,moving:true,localizationValid:false,bootId:cap.bootId??'unknown'};
   let pose={x:0,y:0,yawRad:0};const tickMap:NonNullable<import('../reports/verification').RunVerification['armTickMap']>=[],armSamples:TwinSampleV2[]=[],pendingArmSamples:TwinSampleV2[]=[],transfers:TransferObservation[]=[],receiverReports:CellReport[]=[],events:unknown[]=[],contacts:JsonObject[]=[],sensors:JsonObject[]=[],blockers=new Set<string>(),bound=new Set<string>();
   let plant:ReturnType<typeof createPlantSession>|undefined,context:import('../scenarios/coffee').CoffeeContext|undefined,state:import('../scenarios/coffee').CoffeeState|undefined;
   const base=geometry.worldFromArmBaseM,toArm=(v:Vec3)=>v.map((n,i)=>n-base[i]!) as Vec3;
   const box=(id:string,center:Vec3,size:Vec3):ArmObstacle=>({id,kind:'box',min:toArm(center.map((n,i)=>n-size[i]!/2) as Vec3),max:toArm(center.map((n,i)=>n+size[i]!/2) as Vec3)});
   const trayCenter=():Vec3=>{const [ox,oy,oz]=geometry.nativeCandidate.cupOffsetInRobotM;return [pose.x+ox*Math.cos(pose.yawRad)-oy*Math.sin(pose.yawRad),pose.y+ox*Math.sin(pose.yawRad)+oy*Math.cos(pose.yawRad),oz];};
   const tableCenter=(id:string):Vec3=>{const p=project.world.points.find(p=>p.id===id);return p?[p.x,p.y,.795]:geometry.poses.pick!.cupCenterWorldM;};
   const scene=():ArmObstacle[]=>{
    const c=dock.moving?1:Math.abs(Math.cos(pose.yawRad)),s=dock.moving?1:Math.abs(Math.sin(pose.yawRad));
    const boxes:ArmObstacle[]=[box(`chassis:${robotId}`,[pose.x,pose.y,.2],[.6*c+.55*s,.6*s+.55*c,.15]),box(`drive:${robotId}`,[pose.x,pose.y,.1],[.2*c+.42*s,.2*s+.42*c,.2]),box(`tray:${robotId}`,[pose.x,pose.y,.5],[.4*c+.45*s,.4*s+.45*c,.02])];
    if(blockerEnabled)boxes.push(box('blocker:native_fault',[3.8,2.3,.85],[.6,.6,1.7]));
    for(const o of project.world.obstacles)boxes.push(box(`world:${o.id}`,[o.x+o.width/2,o.y+o.height/2,.375],[o.width,o.height,.75]));
    for(const w of state?.workload??[]){const parent=plant?.checkpoint().physical.find(c=>c.cupId===w.cupId)?.parent;if(parent?.startsWith('arm:'))continue;const at=parent?.startsWith('robot:')?trayCenter():parent?.startsWith('table:')?tableCenter(parent.slice(6)):geometry.poses.pick!.cupCenterWorldM;const cup=state?.plant.cups.find(c=>c.cupId===w.cupId);if(cup&&cup.at!=='removed')boxes.push({id:`cup:${w.cupId}`,kind:'sphere',center:toArm(at),radiusM:.035});}
    return boxes;
   };
   off.push(adapter.onStatus(s=>{
    if(frozen)return;status=s;if(s.virtualGrip?.state==='fault')void observeFault('grip-failure',{producer:'linuxcnc_virtual_grip',state:s.virtualGrip.state,reasonCodes:s.virtualGrip.reasonCodes}).catch(()=>blockers.add('FAULT_JOURNAL_FAILED'));for(const observe of restartObservers)observe(s);if(!lastRobot)return;if(lastRobot.quality!=='valid'||process.hrtime.bigint()-lastPoseReceipt>500_000_000n)blockers.add('ARM_SCENE_NAV_STALE');arm.setScene({revision:worldRevision,world:scene()});const t=arm.ingest(s,String(process.hrtime.bigint()));tickMap.push({sampleTick:t.tick,runTick:clockOriginNs&&simTimeNs?Number((BigInt(simTimeNs)-BigInt(clockOriginNs))/20_000_000n):runTick,entityId:roles.coffee!.armId,bootId:s.bootId,seq:s.seq});const sample=arm.latestSample()!;armSamples.push(sample);pendingArmSamples.push(sample);
   }));
   off.push(backend.onEvent(e=>{
    if(frozen)return;events.push(e);
    if(e.event==='clock'&&typeof e.payload.simTimeNs==='string'){if(simTimeNs!==null&&BigInt(e.payload.simTimeNs)<BigInt(simTimeNs))blockers.add('GAZEBO_CLOCK_REGRESSION');else {simTimeNs=e.payload.simTimeNs;firstSimTimeNs??=simTimeNs;}}
    if(e.event==='telemetry'){
     const parsed=validateTwinSampleV2(e.payload);if(!parsed.ok){blockers.add('NAV_SAMPLE_INVALID');return;}const sample=parsed.value;if(sample.entityId!==robotId||sample.runId!==runId)return;
     lastRobot=sample;lastPoseReceipt=process.hrtime.bigint();const p=sample.observed as {xM?:number;yM?:number;yawRad?:number}|null;
     if(p&&[p.xM,p.yM,p.yawRad].every(Number.isFinite))pose={x:p.xM!,y:p.yM!,yawRad:p.yawRad!};
    }
    if(e.event==='dock-observation'){
     const robots=e.payload.robots as Record<string,{poseFresh:boolean;localizationFresh:boolean;pose:{value:{position:{x:number;y:number;z:number};orientation:{z:number;w:number}};sequence:number;simTimeNs:number;receivedMonotonicNs:number}|null;localization:{value:{valid:boolean;positionM:Vec3};simTimeNs:number;receivedMonotonicNs:number}|null}>;
     const r=robots?.[robotId];if(!r?.pose||!r.localization)return;
     const p=r.pose.value.position,l=r.localization,previous=(dock as typeof dock&{previous?:{seq:number;time:number;x:number;y:number;yaw:number}}).previous;
     const yaw=2*Math.atan2(r.pose.value.orientation.z,r.pose.value.orientation.w),time=Number(e.payload.simTimeNs),dt=previous?(r.pose.simTimeNs-previous.time)/1e9:0;
     const fresh=r.poseFresh===true&&r.localizationFresh===true&&time-r.pose.simTimeNs>=0&&time-r.pose.simTimeNs<=500_000_000&&time-l.simTimeNs>=0&&time-l.simTimeNs<=500_000_000;
     const moving=!(previous&&previous.seq!==r.pose.sequence&&dt>0&&dt<=.5&&Math.hypot(p.x-previous.x,p.y-previous.y)/dt<=.02&&Math.abs(Math.atan2(Math.sin(yaw-previous.yaw),Math.cos(yaw-previous.yaw)))/dt<=.02);
     dock={robotId,bootId:cap.bootId??'unknown',errorM:Math.hypot(p.x-dockPoint.x,p.y-dockPoint.y),moving,localizationValid:fresh&&l.value.valid===true&&Math.hypot(p.x-l.value.positionM[0],p.y-l.value.positionM[1])<=.05};
     Object.assign(dock,{previous:{seq:r.pose.sequence,time:r.pose.simTimeNs,x:p.x,y:p.y,yaw}});dockReceipt=process.hrtime.bigint();
    }
    if(e.event==='transfer-observation'){
     const o={...e.payload,receivedMonotonicNs:String(process.hrtime.bigint())} as unknown as TransferObservation;
     if(o.runId!==runId){blockers.add('TRANSFER_RUN_MISMATCH');return;}transfers.push(o);receiverReports.push({deviceId:o.deviceId,bootId:o.bootId,seq:o.seq,observedAt:new Date().toISOString(),evidence:{transferObservation:o,source:'gazebo_tray'}});
    }
    if(e.event==='contact')contacts.push(e.payload);if(e.event==='contact-sensor')sensors.push({...e.payload,coordinatorSimTimeNs:simTimeNs});
   }));
   await adapter.open();
   const latest=():NativeObservedSnapshot=>{if(frozenSnapshot)return structuredClone(frozenSnapshot);const fresh=process.hrtime.bigint()-dockReceipt<=500_000_000n,valid=lastRobot?.quality==='valid'&&process.hrtime.bigint()-lastPoseReceipt<=500_000_000n,d={...dock,localizationValid:dock.localizationValid&&fresh,moving:dock.moving||!fresh};return {simTimeNs,entities:lastRobot?[{id:robotId,kind:'amr',pose,quality:valid?'valid':'stale',moving:d.moving,hold:null,goal:null,path:[],distanceM:0}]:[],dock:d,receiver:d.localizationValid&&!d.moving&&d.errorM<=.05?{robotId,slot:1}:null};};
   const barriers=createBarrierCoordinator({monotonicNs:()=>process.hrtime.bigint(),timeoutNs:5_000_000_000n}),watch=setInterval(()=>barriers.tick(),20);watch.unref();off.push(()=>clearInterval(watch));
   const baselines:NativeFaultBaseline[]=[],dispatches:JsonObject[]=[];
   const missingCups=new Set<string>(),fired=new Set<string>(),faultLog:JsonObject[]=[],windows=new Map<string,{entry:FaultScheduleEntry;kind:NativeFault['kind'];expires:number}>();
   const aliases:Record<string,NativeFault['kind']>={'cup-removed':'missing-cup','arm-drop':'grip-failure','arm-reboot':'controller-restart','delay-observation':'amr-delay'};
   const kindOf=(entry:FaultScheduleEntry)=>(aliases[entry.faultId]??entry.faultId) as NativeFault['kind'];
   let faultPersistence=Promise.resolve();flushFaults=()=>faultPersistence;
   const saveFaults=()=>{const bytes=JSON.stringify(faultLog);faultPersistence=faultPersistence.then(async()=>{const path=join(directory,'native-faults.json'),tmp=path+'.tmp';await writeFile(tmp,bytes,{mode:0o600});const file=await open(tmp,'r');try{await file.sync();}finally{await file.close();}await rename(tmp,path);const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}});return faultPersistence;};
   observeFault=async(kind,proof)=>{for(const [id,w] of windows)if(w.kind===kind&&runTick*20<=w.expires&&!faultLog.some(r=>r.id===id&&r.status==='observed')){faultLog.push({id,kind,status:'observed',tick:runTick,proof});await saveFaults();}};
   const active=(kind:NativeFault['kind'])=>[...windows.values()].some(w=>w.kind===kind&&runTick*20<w.expires);
   const phase=async():Promise<FaultPhase>=>{let delivery=false;for(const w of state?.workload??[]){const cup=(await context!.source.read('cup',w.cupId)).state,p=cup.pendingTransfer as JsonObject|null;if(p)return (p.to as JsonObject).kind==='robot'?'handoff':'grasp';const job=(await context!.source.read('coffee-job',w.jobId)).state;if(['loaded','delivered'].includes(String(job.status)))delivery=true;}return delivery?'delivery':'brew';};
   const injectFault=async(entry:FaultScheduleEntry)=>{
    validateSchedule([entry]);if(fired.has(entry.id))return;const baseline=await result.evidence(),cursor=(await context!.source.journal()).at(-1)?.sequence??'0',cups:JsonObject[]=[];for(const w of state?.workload??[]){const cup=await context!.source.read('cup',w.cupId);if(cup.version)cups.push(structuredClone(cup.state));}
    baselines.push({id:entry.id,kind:kindOf(entry),sourceCursor:cursor,arm:baseline.arm,armTickMap:baseline.armTickMap,armSamples:baseline.raw['arm-telemetry.json'] as unknown[],armTrace:baseline.raw['arm-trace.json'] as NativeFaultBaseline['armTrace'],navSamples:structuredClone(events.filter(e=>(e as {event:string}).event==='telemetry').map(e=>(e as {payload:unknown}).payload)),contacts:baseline.raw['contacts.json'] as NativeFaultBaseline['contacts'],cups,blockers:baseline.blockers});
    fired.add(entry.id);const kind=kindOf(entry),atPhase=await phase(),pending=[];
    for(const w of state?.workload??[]){const p=(await context!.source.read('cup',w.cupId)).state.pendingTransfer;if(p)pending.push(p);}
    const identity={id:entry.id,kind,tick:runTick,targetId:entry.targetId,phase:atPhase,entry:entry as unknown as JsonObject,pendingTransfers:pending};faultLog.push({...identity,status:'intent'});await saveFaults();windows.set(entry.id,{entry,kind,expires:runTick*20+entry.durationMs});
    if(kind==='missing-cup'){for(const work of state?.workload??[]){missingCups.add(work.cupId);await backend!.setCupPose!({worldRevision:world.manifestHash,fixtureId:work.cupId,positionM:[50,50,0]});const cup=state!.plant.cups.find(c=>c.cupId===work.cupId);if(cup)cup.at='removed';}plant?.plant.reportCup();await observeFault(kind,{producer:'modeled_coffee_sensor',cupIds:[...missingCups],present:false});}
    if(kind==='blocker'){if(!backend!.setBlocker)throw new Error('NATIVE_BLOCKER_UNSUPPORTED');await backend!.setBlocker(true);blockerEnabled=true;await observeFault(kind,{producer:'gazebo_world',blocker:'native_fault',applied:true});}
    if(kind==='controller-restart'){
     const before=status?{bootId:status.bootId,controllerEpoch:status.controllerEpoch}:null;if(!before)throw new Error('RESTART_IDENTITY_MISSING');
     faultLog.push({...identity,status:'awaiting_operator',before,deadlineWallMs:Date.now()+(config.restartOperator?.timeoutMs??5000)});await saveFaults();
     let resolveWindow!:()=>void;const observationWindow=new Promise<void>(resolve=>{resolveWindow=resolve;});observationWindows.add(observationWindow);
     let settled=false,pollTimer:ReturnType<typeof setTimeout>|undefined;const finish=(observed:ControllerIdentity|null,reason:string)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(pollTimer);restartObservers.delete(observe);if(!observed)blockers.add('CONTROLLER_RESTART_UNPERFORMED');faultLog.push({...identity,status:observed?'observed_transition':'unperformed',reason,before,after:observed?{bootId:observed.bootId,controllerEpoch:observed.controllerEpoch}:null});void saveFaults().catch(()=>blockers.add('FAULT_JOURNAL_FAILED')).finally(()=>{observationWindows.delete(observationWindow);resolveWindow();});};
     const observe=(s:ControllerIdentity)=>{if(s.bootId!==before.bootId&&s.controllerEpoch!==before.controllerEpoch)finish(s,'BOOT_AND_EPOCH_CHANGED');};restartObservers.add(observe);const timer=setTimeout(()=>finish(null,'OPERATOR_DEADLINE_EXCEEDED'),config.restartOperator?.timeoutMs??5000);off.push(()=>finish(null,'RUN_CLOSED_BEFORE_RESTART'));
     const pollIdentity=async()=>{if(settled)return;try{let identity:ControllerIdentity|null=null;if(doubles){identity=await doubles.observeController?.()??null;}else{const probe=await connectArmBackend({socketPath:tunnel?.socketPath??config.arm.socketPath??'',timeoutMs:1000});try{if(probe.machineId===profile.machineId&&probe.bootId&&probe.controllerEpoch!==undefined)identity={bootId:probe.bootId,controllerEpoch:probe.controllerEpoch};}finally{await probe.port?.close();}}if(identity&&!settled)observe(identity);}catch{/* failure is not an observed restart; the original deadline stays live */}if(!settled)pollTimer=setTimeout(()=>{void pollIdentity();},100);};
     context!.attention({reason:'CONTROLLER_RESTART_OPERATOR_REQUESTED',subjectId:entry.id});void pollIdentity();if(doubles?.restartController)await doubles.restartController();return;
    }
    if(kind==='tunnel-loss'){await port!.close();await tunnel?.close();await observeFault(kind,{producer:'transport',closed:true});faultLog.push({...identity,status:'fired'});await saveFaults();context!.attention({reason:'INJECTED_TUNNEL_LOSS',subjectId:entry.id});return;}
    faultLog.push({...identity,status:'fired'});await saveFaults();
   };
   const linked: GazeboBackend={...backend,execute:async(r,c)=>{if(active('amr-disconnect')){await observeFault('amr-disconnect',{producer:'native_navigation_transport',request:'rejected_disconnected'});throw new Error('INJECTED_AMR_DISCONNECT');}if(active('amr-delay')){const delay=Math.min(1000,[...windows.values()].find(w=>w.kind==='amr-delay')!.entry.durationMs);await new Promise(resolve=>setTimeout(resolve,delay));await observeFault('amr-delay',{producer:'native_navigation_transport',delayMs:delay});}signal.throwIfAborted();dispatches.push({provider:'gazebo_nav2',commandId:c.commandId,tick:runTick});return backend!.execute(r,c);},query:async(r,c)=>{if(active('amr-disconnect')){await observeFault('amr-disconnect',{producer:'native_navigation_transport',request:'rejected_disconnected'});throw new Error('INJECTED_AMR_DISCONNECT');}return backend!.query(r,c);}};
   let portsClosed=false;
   const result:NativePlant={backend:linked,evidenceKind:doubles?'protocol_double':'native',descriptors:[GAZEBO_NAV2,LINUXCNC_SIM,COFFEE_IO_SIM],models:[{id:model.id,revision:model.revision,hash:hashJson(model),provenance:'illustrative_reference'}],profiles:[{id:'native-tool-closure',revision:1,hash:approvedTools.digest,provenance:'simulation'},{id:profile.machineId,revision:1,hash:hashJson(profile),provenance:'simulation'},{id:'native-fault-policy',revision:1,hash:hashJson({schedules,restartOperator:config.restartOperator??null}),provenance:'simulation'}],latest,injectFault,async awaitObservationWindow(){await Promise.all([...observationWindows]);await faultPersistence;},freeze(){frozenSnapshot=latest();frozen=true;},samples:()=>pendingArmSamples.splice(0),
    async coffeePorts(st,ctx){
     context=ctx;domainNow=ctx.nowMs;state=st;plant=createPlantSession({runId,cellId:st.cellId,armId:st.armId,nowMs:ctx.nowMs,newBootId:randomUUID,receiver:()=>latest().receiver,dock:()=>latest().dock,traySensor:()=>false,coffeeState:st.plant,arm:{adapter:adapter!,session:arm},receiptMonotonicNs:()=>process.hrtime.bigint(),parentTransform:parent=>({translationM:[...(parent.startsWith('table:')?tableCenter(parent.slice(6)):parent.startsWith('robot:')?trayCenter():geometry.poses.pick!.cupCenterWorldM)],quaternionXyzw:[0,0,0,1]})});
     const ports=plant.ports(),drain=ports.drain,place=plant.plant.placeCup.bind(plant.plant);plant.plant.placeCup=(id,type)=>{if(!missingCups.has(id)){place(id,type);return;}if(!st.plant.cups.some(c=>c.cupId===id))st.plant.cups.push({cupId:id,cupType:type,at:'removed',liquidUl:0,iceMg:0});plant!.plant.reportCup();};
     return {...ports,adapters:ports.adapters.map(a=>a!==adapter?a:{executor:'native' as const,describe:()=>a.describe(),observe:l=>a.observe(l),reconcile:id=>a.reconcile(id),cancel:id=>a.cancel(id),async execute(command){dispatches.push({provider:'linuxcnc_sim',commandId:command.commandId,capability:command.capability,tick:runTick});if(command.capability==='start_job')await result.barrier(`${runId}:${command.commandId}:before-motion`,robotId);signal.throwIfAborted();return a.execute(command);}}),drain(){const reports=[...drain(),...receiverReports.splice(0)];for(const r of reports){const o=r.evidence?.transferObservation as TransferObservation|undefined;if(o?.producer==='linuxcnc_virtual_grip')transfers.push(o);}return reports;},async advance(){const delta=ctx.tick()-lastCoffeeTick;if(delta<0||delta>5000)throw new Error('COFFEE_CLOCK_COVERAGE_GAP');for(let i=0;i<delta;i++)await ports.advance();lastCoffeeTick=ctx.tick();},async close(){if(portsClosed)return;portsClosed=true;/* factory owns the adapter exactly once */}};
    },
    async poll(tick,origin){
     signal.throwIfAborted();runTick=tick;clockOriginNs=origin;
     for(const entry of dueFaults(schedules,fired,tick*20,await phase())){await injectFault(entry);if(signal.aborted)return;}
     for(const [id,w] of windows)if(tick*20>=w.expires&&!faultLog.some(x=>x.id===id&&x.status==='window-ended')){if(w.kind==='blocker'){await backend!.setBlocker!(false);blockerEnabled=false;}faultLog.push({id,kind:w.kind,tick,status:'window-ended'});await saveFaults();}
     if(tunnel&&tunnel.status()!=='ready')throw new Error('ARM_TUNNEL_LOST');
     if(!adapter!.hasOwner)throw new Error('ARM_OWNER_LOST');
     if(status&&(status.reasonCodes.some(c=>c==='OWNER_LOST')||status.reconcileRequired))throw new Error('ARM_RECONCILE_REQUIRED');
     if(!state||!context)return;
     for(const work of state.workload){
      const cup=(await context.source.read('cup',work.cupId)).state,p=cup.pendingTransfer as JsonObject|null;
      const parent=plant?.checkpoint().physical.find(c=>c.cupId===work.cupId)?.parent;
      let modeled:Vec3|undefined;if(parent?.startsWith('robot:'))modeled=trayCenter();else if(cup.ownerKind==='customer')modeled=tableCenter(String(cup.ownerId));else if(parent?.startsWith('arm:')&&status?.joints.actualRad&&status.tcp)modeled=modeledCupCenter(model,status.joints.actualRad,status.tcp.positionM as Vec3,base);
      if(modeled&&!missingCups.has(work.cupId))await backend!.setCupPose!({worldRevision:world.manifestHash,fixtureId:work.cupId,positionM:[...modeled] as [number,number,number]});
      if(!p)continue;
      const to=p.to as JsonObject,release=to.kind==='robot',d=latest().dock;
      if(release&&!bound.has(String(p.transferId))){if(!backend!.bindTransfer)throw new Error('TRAY_BIND_UNSUPPORTED');await backend!.bindTransfer({worldRevision:world.manifestHash,cupId:work.cupId,fixtureId:work.cupId,transferId:String(p.transferId),commandId:String(p.commandId),payloadHash:String(p.payloadHash),controlEpoch:Number(p.controlEpoch),robotId,slot:1});bound.add(String(p.transferId));}
      const pc=state.plant.cups.find(c=>c.cupId===work.cupId);
      if(missingCups.has(work.cupId))await backend!.setCupPose!({worldRevision:world.manifestHash,fixtureId:work.cupId,positionM:[50,50,0]});
      await adapter!.updateSimScene({runId,worldRevision,sceneSeq:String(++sceneSeq),transferId:String(p.transferId),commandId:String(p.commandId),cup:{id:work.cupId,present:!!pc&&pc.at!=='removed'&&!missingCups.has(work.cupId),positionM:[...geometry.poses.pick!.cupCenterWorldM]},receiver:release?{robotId,slot:1,stationary:!d.moving,localizationValid:d.localizationValid,poseErrorM:d.errorM,trayPresent:true}:null,faults:[...missingCups.has(work.cupId)?['missing_cup' as const]:[],...active('grip-failure')?['gripper_stuck' as const]:[]]});
      // Giver modeled position follows actual joints/TCP only. Receiver truth still comes from independent Gazebo TF.
      if(!missingCups.has(work.cupId)&&status?.joints.actualRad&&status.tcp&&status.virtualGrip&&['held','released'].includes(status.virtualGrip.state)){
       await backend!.setCupPose!({worldRevision:world.manifestHash,fixtureId:work.cupId,positionM:[...modeledCupCenter(model,status.joints.actualRad,status.tcp.positionM as Vec3,base)] as [number,number,number]});
      }
     }
    },
    async pause(){throw new Error('NATIVE_PAUSE_UNSUPPORTED');},
    async barrier(key,robot){
     if(!lastRobot||!status)throw new Error('BARRIER_SAMPLES_MISSING');
     const nonce=randomUUID(),policy={nonce,state:'stationary' as const,expected:{[robot]:{bootId:lastRobot.bootId,afterSeq:lastRobot.seq},[roles.coffee!.armId]:{bootId:status.bootId,controllerEpoch:status.controllerEpoch,afterSeq:status.seq}}};
     const completion=barriers.awaitTransferBarrier(key,[robot,roles.coffee!.armId],policy);void completion.catch(()=>{});
     const replies=await Promise.all([backend!.barrier(key,[robot],{nonce,bootId:lastRobot.bootId,afterSeq:lastRobot.seq,state:'stationary'}),adapter!.barrier({barrierId:key,nonce,bootId:status.bootId,afterSeq:status.seq,state:'stationary'})]);
     for(const a of (replies[0]!.acks as JsonObject[]??[]))barriers.ack(key,String(a.participant),a as unknown as Parameters<typeof barriers.ack>[2]);
     barriers.ack(key,roles.coffee!.armId,replies[1] as unknown as Parameters<typeof barriers.ack>[2]);await completion;
    },
    async holdForReconcile(){await Promise.all([backend!.stop(robotId,'NATIVE_RECONCILE_HOLD'),adapter!.holdForReconcile()]);},
    async evidence(){
     await faultPersistence;const mapping=structuredClone(tickMap),trace=arm.trace(),samples=structuredClone(armSamples);
     const reportBlockers=new Set(blockers);if(!doubles&&!status?.inventory)reportBlockers.add('CONTROLLER_INVENTORY_MISSING');if(status?.inventory&&(status.inventory.profileSha256!==hashJson(profile)||status.inventory.bridgeCodeSha256!==createHash('sha256').update(JSON.stringify(approvedTools.files.filter(f=>f.path.startsWith('integrations/arm-controller/bridge/')&&f.path.endsWith('.py')))).digest('hex')))reportBlockers.add('CONTROLLER_INVENTORY_MISMATCH');for(const e of schedules)if(!fired.has(e.id))reportBlockers.add(`NATIVE_FAULT_NOT_FIRED:${e.id}`);if(restartObservers.size)reportBlockers.add('CONTROLLER_RESTART_PENDING');
     const armEvidence=await arm.collisionEvidence({world:scene(),worldRevision:{id:project.world.id,revision:project.world.revision,hash:worldRevision},assetRef:project.entities.find(e=>e.kind==='arm')!.assetRef as unknown as JsonObject,sceneRevision:worldRevision});
     if(!sensors.some(s=>s.alive===true))reportBlockers.add('CONTACT_SENSOR_SILENT');if(contacts.length)reportBlockers.add('GAZEBO_CONTACT');if(sensors.some(s=>s.alive!==true))reportBlockers.add('CONTACT_SENSOR_COVERAGE_GAP');
     const sensorTimes=sensors.map(s=>BigInt(String(s.simTimeNs??s.coordinatorSimTimeNs??'0')));if(sensorTimes.length<2||firstSimTimeNs!==null&&sensorTimes.length&&sensorTimes[0]!-BigInt(firstSimTimeNs)>500_000_000n||sensorTimes.some((t,i)=>i>0&&(t<sensorTimes[i-1]!||t-sensorTimes[i-1]!>500_000_000n))||simTimeNs!==null&&sensorTimes.length&&BigInt(simTimeNs)-sensorTimes.at(-1)!>500_000_000n)reportBlockers.add('CONTACT_SENSOR_COVERAGE_GAP');
     return {arm:armEvidence,armTickMap:mapping,transfers:structuredClone(transfers),raw:{'wire-deadlines.json':adapter!.wireDeadlineEvidence(),'native-tool-identity.json':structuredClone(approvedTools),'native-inventory.json':{gazebo:cap,controller:status?{machineId:status.machineId,bootId:status.bootId,controllerEpoch:status.controllerEpoch,capabilities:status.capabilities??[],units:status.units,inventory:status.inventory??null}:null,profileSha256:hashJson(profile),codeSha256:approvedTools.digest,environmentProfile:config.environmentProfile},'fault-baselines.json':structuredClone(baselines),'native-command-dispatch.json':structuredClone(dispatches),'coverage-window.json':{policy:'first-provider-observation-through-workflow-completion',openedMonotonicNs,fromSimTimeNs:firstSimTimeNs,toSimTimeNs:simTimeNs,frozen,contactSamples:sensors.length,armSamples:trace.length},'fault-evidence.json':structuredClone(faultLog),'contacts.json':{available:!reportBlockers.has('CONTACT_SENSOR_SILENT')&&!reportBlockers.has('CONTACT_SENSOR_COVERAGE_GAP'),contacts:structuredClone(contacts),sensors:structuredClone(sensors)},'arm-trace.json':trace,'arm-telemetry.json':samples,'arm-checker.json':armEvidence,'provider-events.json':events,'barriers.json':barriers.records(),'cup-ledger.json':plant?.checkpoint().physical??[],'cup-plant-projection.json':plant?.checkpoint()??null},blockers:[...reportBlockers]};
    },close,
   };
   return result;
  }catch(e){await close();throw e;}
 }};return factory;
}
/** Explicit opt-in startup; the offline runtime never invokes this module by default. */
export async function nativeRuntimeOptions(config:NativeServerConfig){
 const factory=await nativeProviderFactory(config),enabled=['gazebo_nav2','coffee_io_sim','linuxcnc_sim'];
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>enabled.includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
 const nativeChecks:NativeReadinessChecks=async(context,signal)=>{
  const blockers:string[]=[];if(context.scenarioId!=='BV01')blockers.push('NATIVE_SCENARIO_UNSUPPORTED');if(context.project){const parsed=validateProjectV2(context.project);if(!parsed.ok||hashJson(nativeProjectGeometry(parsed.value))!==hashJson(nativeProjectGeometry(factory.project)))blockers.push('NATIVE_FIXTURE_MISMATCH:select native-bv01 project');else try{factory.validateSchedule?.(parsed.value.faultSchedule??[]);}catch(e){blockers.push((e as Error).message);}}
  signal.throwIfAborted();
  // No lease/motion on readiness. The factory rechecks availability + negotiated grip when creating the session.
  if(!config.arm.socketPath&&!config.arm.tunnel)blockers.push('ARM_TRANSPORT_UNCONFIGURED');
  let tunnel:Awaited<ReturnType<typeof startArmTunnel>>|undefined;
  try{
   if(nativeToolClosure(config.sourceRoot).digest!==approvedTools.digest)throw new Error('NATIVE_TOOL_IDENTITY_MISMATCH');
   const inventory=await promisify(execFile)(config.python??'python3',['-m','bridge.native_profile','--profile',config.environmentProfile],{cwd:join(config.sourceRoot,'robotics/simulation'),env:{...process.env,PYTHONPATH:join(config.sourceRoot,'robotics/simulation')+':'+join(config.sourceRoot,'robotics/agent')},timeout:3000,signal});
   const profile=JSON.parse(inventory.stdout);if(profile.available!==true)blockers.push('NATIVE_ENVIRONMENT_UNAVAILABLE');
   if(config.arm.tunnel)tunnel=await startArmTunnel({...config.arm.tunnel,timeoutMs:1500});
   const arm=await connectArmBackend({socketPath:tunnel?.socketPath??config.arm.socketPath??'',timeoutMs:1000});
   if(!arm.available)blockers.push(...arm.reasons);await arm.port?.close();
  }catch(error){blockers.push(`NATIVE_PROBE_FAILED:${(error as Error).message.slice(0,120)}`);}finally{await tunnel?.close();}
  return ['model','clock','fixture','profile','runner','gripper'].map(id=>({id,status:blockers.length?'blocked':'ready',reasonCodes:blockers,evidenceRef:`server-native:${hashJson({config:{environmentProfile:config.environmentProfile},project:factory.project})}`}));
 };
 return {enabledBackends:[...enabled,'mock_amr','mock_coffee','mock_arm'],catalog,nativeChecks,simulationFactory:(input:import('../scenario-runner').RunManifestInput,p:import('../scenario-runner').RunProviders)=>createNativeScenarioRun(input,p,factory)};
}
/** Remote doctor probes the configured bridge through the same pinned tunnel; no local LinuxCNC import is substituted. */
export async function doctorNativeArm(config:NativeServerConfig){
 let tunnel:Awaited<ReturnType<typeof startArmTunnel>>|undefined;
 try{if(config.arm.tunnel)tunnel=await startArmTunnel(config.arm.tunnel);const c=await connectArmBackend({socketPath:tunnel?.socketPath??config.arm.socketPath??'',timeoutMs:2000});await c.port?.close();return {backend:'linuxcnc_sim',prerequisitesMet:c.available,checks:[{id:'remote-controller-bridge',ok:c.available,detail:c.reasons.join(',')||`controller ${c.bootId}/${c.controllerEpoch}`}],evidence:'preflight_only'};}
 catch(e){return {backend:'linuxcnc_sim',prerequisitesMet:false,checks:[{id:'remote-controller-bridge',ok:false,detail:(e as Error).message}],evidence:'preflight_only'};}finally{await tunnel?.close();}
}
