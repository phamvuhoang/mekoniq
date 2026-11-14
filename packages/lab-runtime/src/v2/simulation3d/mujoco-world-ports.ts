/** Source-only B05 factory. No browser transport URL and no published cell scenario.
 * B06 owns production journal correlation and full workflow qualification. */
import {mkdir,writeFile} from 'node:fs/promises';
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
import {readXArmFixture} from './arm-cell-scene';
import {mujocoProgramSet} from './mujoco-arm-ports';
import {MUJOCO_SLOT,type MujocoRuntimeOptions} from './mujoco';
import {spawnMujocoWorker} from './worker-client';
import {readWorldFixture,validateWorldObservation,worldArmObstacles,type WorldInteractionIntent} from './world-scene';
import {openWorldRecorder,prepareWorldAdmission} from './world-evidence';
import type {WorldPortsFactory,WorldTickCommand} from './world-ports';

export function mujocoWorldPorts(runtime:MujocoRuntimeOptions):WorldPortsFactory{return async input=>{
 if(runtime.physicsOverride||runtime.padFrictionOverride!==undefined||runtime.armExtraStatics)throw Error('WORLD_PROFILE_OVERRIDE_UNSUPPORTED');
 if(activeRunCount(MUJOCO_SLOT)>0)throw Error('MUJOCO_CAPACITY');holdSlot(MUJOCO_SLOT,input.runId);
 let worker:Awaited<ReturnType<typeof spawnMujocoWorker>>|undefined,closing:Promise<void>|undefined;
 const oldArm=input.state.arm;
 const close=()=>closing??=(async()=>{await worker?.close('world closed');releaseSlot(MUJOCO_SLOT,input.runId);})();
 try{
  const {scene,files}=await readWorldFixture(runtime.workerRoot),st=input.state,ctx=input.context;
  if(scene.inputs.projectDigest!==hashJson(input.manifest.project)||st.armId!==scene.armCell.arm.armId||st.arm.programs.length||hashJson([...new Set([...st.plant.cups.map(c=>c.cupId),...st.workload.map(w=>w.cupId)])].sort())!==hashJson(scene.propBindings.map(p=>p.cupId).sort()))throw Error('WORLD_SOURCE_ADMISSION_MISMATCH');
  scene.armCell.engineSeed=input.manifest.seed;scene.armCell.sceneDigest=documentDigest(scene.armCell,'sceneDigest');scene.sceneDigest=documentDigest(scene,'sceneDigest');
  const admission=prepareWorldAdmission(scene,files),doc=<T>(p:string)=>JSON.parse(Buffer.from(files.get(p)!).toString()) as T;
  const physical=doc<RobotPhysicalModelV1>(scene.models.mobilePhysical.path),load=doc<LoadProfileV1>(scene.models.emptyLoad.path),programDoc=doc<{programs:ArmProgramSet;digest:string;table:{waypoint:string;q:number[];positionErrorM:number;orientationErrorRad:number;condition:number}[]}>(scene.programsRef.path);
  const fixture=readXArmFixture(runtime.workerRoot),oracle=loadOracleProfile().profile.mujocoArm!;
  const support=load.supports.find(s=>s.supportId===scene.supportMap.mobileSupportId)!;
  const programs=mujocoProgramSet({...fixture,programs:programDoc.programs},oracle,[]);
  programs.contact={...programs.contact!,releaseObservationRequired:true,releaseSettleTicks:25};
  programs.collision!.allowedPairs=['gripper','held-cup'].flatMap(a=>[[a,'support/nozzle-stand'],[a,`${scene.navigation.robots[0]!.robotId}/${support.parentBodyId}/c0`]] as [string,string][]);
  try{await mkdir(join(input.directory,'mujoco-world'),{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('WORLD_RESTART_UNKNOWN');throw e;}
  const bundle=join(input.directory,'mujoco-world','bundle');await mkdir(bundle,{recursive:true,mode:0o700});
  for(const [name,b] of files){const path=join(bundle,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,b);}
  await writeFile(join(bundle,'lab-world-scene.json'),JSON.stringify(scene));
  worker=await spawnMujocoWorker({python:runtime.python,workerRoot:runtime.workerRoot,runId:input.runId,bundleRoot:bundle,runDirectory:join(input.directory,'mujoco-world','run'),lockDigest:runtime.lockDigest,schemaDir:runtime.schemaDir,sceneDigest:scene.sceneDigest,...runtime.entry?{entry:runtime.entry}:{}});
  let requests=0,engineTick=0,failed=false,sent=false,durableTick=-1,pending:WorldTickCommand|null=null,decisions:Decision[]=[],last:Sim3DSnapshotV1,observing:Sim3DSnapshotV1|undefined;
  const ask=async(op:string,payload:unknown)=>{const r=await worker!.request({protocol:'mekoniq-sim3d/1',requestId:`world-${++requests}`,runId:input.runId,expectedTick:engineTick,op,payload} as Parameters<NonNullable<typeof worker>['request']>[0]);if(!r.ok)throw Error(r.error.code);return r.result as Sim3DSnapshotV1;};
  last=await ask('create',{sceneRef:'lab-world-scene.json',seed:input.manifest.seed});validateWorldObservation(last,scene,[]);await ask('start',{});
  const recorder=await openWorldRecorder({directory:join(input.directory,'world-evidence'),admission,runId:input.runId,bootId:last.bootId});
  const controller=createNavigationController(scene.navigation,{ramp:'previous-sent-command-v1'}),rid=scene.navigation.robots[0]!.robotId;
  const adapter=createIRSimNavigationAdapter({robotId:rid,scene:scene.navigation,controller,now:ctx.nowMs,mapId:'lab-world',mapRevision:String((input.manifest.project as LabProjectV2).world.revision),identity:{id:'mujoco_3d',version:runtime.engineVersion,model:'mujoco_shared_world'}});
  st.arm={...MockArmPlant.initial(st.armId,st.arm.bootId,programs),plantId:'mujoco_arm'};
  let dockTicks=0;const docked=(s:Sim3DSnapshotV1)=>{const r=s.robots[0]!,p=scene.navigation.robots[0]!.initialPoseMap;return Math.hypot(r.poseDriveMap[0]!-p[0]!,r.poseDriveMap[1]!-p[1]!)<=.01&&Math.abs(Math.atan2(Math.sin(r.poseDriveMap[2]!-p[2]!),Math.cos(r.poseDriveMap[2]!-p[2]!)))<=.02&&Math.abs(r.bodyVelocity[0]!)<=.01&&Math.abs(r.bodyVelocity[1]!)<=.02;};
  const base=createMockCoffeePorts(st,{...ctx,receiver:()=>docked(observing??last)&&dockTicks>=10?{robotId:rid,slot:1}:null},input.newBootId,{tracking:oracle,programs,model:XARM6_SI,advanceArm:false}),arm=base.mockArm!;
  const history:WorldInteractionIntent[]=[],removed=new Set<string>(),inverse=invertPose(scene.armCell.arm.baseInMap);
  const setScene=(s:Sim3DSnapshotV1)=>arm.setCollisionScene({available:true,scope:'self_scene_robot',revision:scene.sceneDigest,profileRevision:1,tick:s.tick,world:worldArmObstacles(scene,physical,s),robotPoses:[]});setScene(last);
  const release=(s:Sim3DSnapshotV1):PlantExtras['releaseObservation']=>{const id=st.arm.holding;if(!id)return undefined;const p=s.props?.find(p=>p.propId===id),l=s.physics?.loads.find(l=>l.propId===id),xy=l?.poseInSupport?.positionM,poly=support.polygonM,margin=scene.armCell.props.find(p=>p.propId===id)!.radiusM+.005;
   const inside=!!xy&&poly.every((a,i)=>{const b=poly[(i+1)%poly.length]!;return (b[0]!-a[0]!)*(xy[1]!-a[1]!)-(b[1]!-a[1]!)*(xy[0]!-a[0]!)>=margin*Math.hypot(b[0]!-a[0]!,b[1]!-a[1]!);});
   return {propId:id,valid:!!p&&p.restingOn===support.supportId&&inside&&!s.arms![0]!.gripper!.heldPropIds.includes(id)};
  };
  const coffee={...base,report:()=>({...base.report(),cupLedger:[],armPlant:{engine:'mujoco_3d' as const,engineVersion:runtime.engineVersion,control:'position_actuator' as const,grip:'contact' as const,dynamics:'manufacturer_nominal+assumed' as const,calibration:'not_calibrated' as const,tracking:trackingStats(st.arm.tracking!)},armCell:{waypoints:{digest:programDoc.digest,table:programDoc.table},inputs:{componentDigest:scene.models.armComponent.sha256,physicsDigest:scene.models.armPhysics.sha256,sceneDigest:scene.sceneDigest},allowedContacts:scene.allowedContactRules.map(r=>({a:r.a,b:r.b})),releaseTimeoutTicks:programs.contact!.releaseTimeoutTicks,notes:['One shared MuJoCo world; raw birth/removal/grip/support observations are not Source custody receipts.','New world numerical/contact profile; not_calibrated. B06 owns the full Source-correlated workflow.']}}),setArmScene:()=>setScene(observing??last),custodyResolved:async(cupId:string,parent:string)=>{await base.custodyResolved?.(cupId,parent);if(parent.startsWith('table:'))removed.add(cupId);}};
  const project=input.manifest.project as LabProjectV2,navigation={mapId:'lab-world',mapRevision:String(project.world.revision),bindings:Object.fromEntries(project.world.points.map(p=>[p.id,{waypointId:p.id,mapId:'lab-world',mapRevision:String(project.world.revision),frame:'map' as const,x:p.x,y:p.y,yaw:p.kind==='parking'||p.kind==='coffee_pickup'?scene.navigation.robots[0]!.initialPoseMap[2]!:0}]))};
  return {navigation,metadata:{models:[{id:'mujoco_shared_world',revision:'1',hash:scene.sceneDigest,provenance:'manufacturer_nominal+assumed'},{id:'mock_coffee',revision:'1',hash:hashJson(MOCK_COFFEE_PARAMS),provenance:'illustrative'}],profiles:[{id:scene.numericalPolicy.id,revision:1,hash:hashJson(scene.numericalPolicy),provenance:'assumed'}],armProgram:{fixture:{id:scene.id,revision:String(scene.revision)},physicsDigest:scene.models.armPhysics.sha256,programs:structuredClone(programs),programsDigest:hashJson(programs as never),waypointsDigest:programDoc.digest}},robots:new Map([[rid,adapter]]),coffee,snapshot:()=>structuredClone(last),
   evidence:{append:async s=>{await recorder.append(s,s.tick===0?null:pending);durableTick=s.tick;},fail:async f=>{failed=true;await recorder.fail(f);},finish:()=>recorder.finish()},
   world:{prepareTick(targetTick){if(failed||pending)throw Error('WORLD_TERMINAL');if(targetTick!==last.tick+1||targetTick>30000)throw Error('WORLD_TARGET_TICK_INVALID');
     const prepared=structuredClone(st.arm),preview=new MockArmPlant(prepared,ctx.nowMs,input.newBootId,{take:()=>null,put:()=>{}},()=>null,XARM6_SI,oracle,programs);preview.advance();
     const nav=controller.advance(last,{});decisions=nav.decisions;
     const propPlacements:WorldTickCommand['propPlacements']=[],worldInteractions:NonNullable<WorldTickCommand['worldInteractions']>=[];
     for(const binding of scene.propBindings){const born=history.some(i=>i.propId===binding.propId&&i.kind==='birth'),gone=history.some(i=>i.propId===binding.propId&&i.kind==='remove');
      const kind=!born&&st.plant.cups.some(c=>c.cupId===binding.cupId&&c.at==='nozzle')?'birth':born&&!gone&&removed.has(binding.cupId)?'remove':null;if(!kind)continue;
      propPlacements.push({propId:binding.propId,pose:kind==='birth'?{position:[.49,0,.151],quaternionXyzw:[0,0,0,1]}:null});worldInteractions.push({eventId:`source:${input.runId}:${binding.cupId}:${kind}`,cupId:binding.cupId,propId:binding.propId,kind,targetTick});
     }
     pending={targetTick,velocities:nav.velocities,actorUpdates:[],jointTargets:[{armId:st.armId,positionsRad:prepared.commandedQ??prepared.q}],gripperTargets:[{armId:st.armId,openingM:prepared.gripperCommandM??programs.contact!.openM}],propPlacements,...worldInteractions.length?{worldInteractions}:{}};return structuredClone(pending);
    },async step(command){if(failed||sent||!pending||hashJson(command as never)!==hashJson(pending as never))throw Error('WORLD_COMMAND_INVALID');sent=true;try{const s=await ask('step',command);engineTick=s.tick;validateWorldObservation(s,scene,[...history,...(command.worldInteractions??[]).map(i=>({...i,tick:i.targetTick}))]);return s;}catch(e){failed=true;throw e;}},
    async commit(s){if(failed||!pending||s.tick!==pending.targetTick||durableTick!==s.tick)throw Error('WORLD_COMMIT_INVALID');observing=s;try{
      setScene(s);dockTicks=docked(s)?dockTicks+1:0;arm.advance();const a=s.arms![0]!,extras:PlantExtras={gripper:a.gripper,releaseObservation:release(s),props:(s.props??[]).map(p=>{const q=composePose(inverse,{position:p.position,quaternionXyzw:p.quaternionXyzw});return {propId:p.propId,position:q.position,restingOn:p.restingOn,inMap:{positionM:p.position as [number,number,number],quaternionXyzw:p.quaternionXyzw as [number,number,number,number]}};})};arm.observe(a.positionsRad,a.collisionIds,extras);const t=st.arm.tracking!;(t.props??=[]).push({tick:s.tick,props:(extras.props??[]).map(p=>({propId:p.propId,positionM:p.inMap!.positionM,quaternionXyzw:p.inMap!.quaternionXyzw,restingOn:p.restingOn,held:a.gripper!.heldPropIds.includes(p.propId)}))});
      adapter.sink.observe(s);for(const d of decisions)adapter.sink.decide(d);history.push(...(pending.worldInteractions??[]).map(i=>({...i,tick:i.targetTick})));last=structuredClone(s);pending=null;sent=false;
     }catch(e){failed=true;throw e;}finally{observing=undefined;}},close}
  };
 }catch(e){input.state.arm=oldArm;await close();throw e;}
};}
