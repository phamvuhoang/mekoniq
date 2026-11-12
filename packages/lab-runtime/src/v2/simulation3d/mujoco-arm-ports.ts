// mujoco_arm (R2a): the CoffeePlantPorts of a run whose arm is a MuJoCo xArm 6 that picks a cup by contact. The coffee machine and the AMR stay mocks; the arm is the mock's program state machine in
// tracking + contact mode: each tick it generates the commanded joints and gripper opening, the MuJoCo worker steps the cell once (20 ms), and what the engine reports (joints, collisions, the
// measured opening, the cups between the pads, each cup's pose and support) becomes the arm state. Cups enter the cell when the coffee plant puts them under the nozzle and leave it when delivered.
// A lost worker leaves the running program unknown; a refused step latches the arm. Nothing is resent and no worker is started in its place.
import {join} from 'node:path';
import type {LabProjectV2} from '../contracts';
import type {RunProviders} from '../scenario-runner';
import {createMockCoffeePorts,type CoffeePlantPorts,type ArmPlantReport} from '../beverage/coffee-ports';
import {MockArmPlant,type ArmProgramSet,type PlantExtras} from '../../../../cell-adapters/src/mock-arm';
import {loadOracleProfile} from '../algorithm/checker';
import {WorkerLostError} from '../navigation2d/plant';
import {holdSlot,irsimCapacity,releaseSlot} from '../navigation2d/runner';
import type {ArmCellSceneV1,Sim3DSnapshotV1} from '../navigation2d/contracts';
import {composePose,invertPose,qconj,qrotate} from '../frames';
import {DEFAULT_ARM_GEOMETRY,type ArmObstacle} from '../models/arm-collision';
import {XARM6_SI} from '../models/arm-kinematics';
import {buildArmCellScene,readXArmFixture,writeArmCellBundle,type CellLayout,type XArmFixture} from './arm-cell-scene';
import {trackingStats} from './arm-ports';
import {MUJOCO_MAX_ACTIVE_RUNS,MUJOCO_SLOT,type MujocoRuntimeOptions} from './mujoco';
import {SIM3D_FATAL_CODES,spawnMujocoWorker} from './worker-client';

/** Assumed, in neither the spec nor the oracle profile: how long (ticks, 200 = 4 s) the arm waits at the place pose, gripper open, for the cup to rest on the tray before the release fails
 * (RELEASE_NOT_ON_RECEIVER). A controller timeout, not an acceptance threshold. */
export const MUJOCO_ARM_RELEASE_TIMEOUT_TICKS=200;
/** A cup put under the nozzle enters the cell this far (m) above the stand top and settles onto it (the worker tests' placement clearance). */
const PLACE_CLEAR_M=0.001;
type Pose={position:number[];quaternionXyzw:number[]};

/** The fixture's programs verbatim, plus grip by contact (open = the gripper's full opening, closed = 0, counts and lift from the oracle profile) and the ARM03 capsule geometry of the xArm:
 * its capsule radii, the cup of the layout lying across the tool (the cup stands upright while the tool approaches it sideways: its axis in the tool frame is the map vertical seen from the
 * pick grasp frame) and the scene's allowed contacts as sweep pairs. No IK at run time. */
export function mujocoProgramSet(fixture:Pick<XArmFixture,'programs'|'physics'|'layout'>,oracle:{gripSettleTicks:number;dropTicks:number;liftMinM:number},allowed:ArmCellSceneV1['allowedContacts']):ArmProgramSet{
 const {physics,layout}=fixture,axis=qrotate(qconj(layout.grasp.pick.quaternionXyzw),[0,0,1]);
 return {...structuredClone(fixture.programs),
  contact:{openM:physics.gripper.openingMaxM,closedM:0,gripSettleTicks:oracle.gripSettleTicks,dropTicks:oracle.dropTicks,liftMinM:oracle.liftMinM,releaseTimeoutTicks:MUJOCO_ARM_RELEASE_TIMEOUT_TICKS},
  collision:{geometry:{...DEFAULT_ARM_GEOMETRY,provenance:'assumed',linkRadiiM:[...physics.capsuleRadiusM],cupRadiusM:layout.cup.radiusM,cupHeightM:layout.cup.heightM,cupAxisInTool:[axis[0]!,axis[1]!,axis[2]!]},
   allowedPairs:allowed.map(c=>[c.a==='held_prop'?'held-cup':c.a,c.b] as const)}};
}
/** The cell's two supports as ARM03 obstacles (arm base frame, the layout's boxes, ids as in the scene): the gripper and the held cup may touch them through the allowed pairs, nothing else may. */
export const cellSupports=(layout:Pick<CellLayout,'nozzleStand'|'tray'>):ArmObstacle[]=>([['nozzle-stand',layout.nozzleStand],['tray',layout.tray]] as const).map(([id,b])=>
 ({id,kind:'box',min:b.centerM.map((c,i)=>c-b.sizeM[i]!/2),max:b.centerM.map((c,i)=>c+b.sizeM[i]!/2)}));
const SUPPORT_IDS=new Set(['nozzle-stand','tray']);
export const mujocoArmPlantReport=(engineVersion:string,st:{samples:number;peakRad:number[];sumSq:number[]}):ArmPlantReport=>({engine:'mujoco_3d',engineVersion,control:'position_actuator',grip:'contact',
 dynamics:'manufacturer_nominal+assumed',calibration:'not_calibrated',tracking:trackingStats(st)});

export function mujocoArmPorts(runtime:MujocoRuntimeOptions,run:{project:LabProjectV2;seed:number}):NonNullable<RunProviders['coffeePorts']>{
 return async(st,ctx,newBootId,directory)=>{
  if(!irsimCapacity(runtime.maxActiveRuns??MUJOCO_MAX_ACTIVE_RUNS,ctx.runId,MUJOCO_SLOT))throw new Error('MUJOCO_CAPACITY');
  holdSlot(MUJOCO_SLOT,ctx.runId); // from here to close (or a failed open) this run owns the host's MuJoCo slot
  const arm0=st.arm; // a failed open leaves the run's arm state as it was
  try{return await open();}catch(e){st.arm=arm0;releaseSlot(MUJOCO_SLOT,ctx.runId);throw e;}
  async function open():Promise<CoffeePlantPorts>{
  const oracle=loadOracleProfile().profile.mujocoArm;
  if(!oracle)throw new Error('ARM_ORACLE_PROFILE_MISSING: the oracle profile has no mujocoArm thresholds');
  const fixture=readXArmFixture(runtime.workerRoot),physics={...fixture.physics,...runtime.physicsOverride};
  // a run's coffee state starts with the mock arm at its home; the first open makes it the xArm at the fixture's home (assigned below, once nothing before the ports can throw).
  // A reopened run keeps its arm, which the ports then own.
  if(st.arm.plantId!=='mujoco_arm'&&st.arm.programs.length)throw new Error('ARM_STATE_MISMATCH: the arm already ran programs on another plant');
  const armState=st.arm.plantId==='mujoco_arm'?st.arm:{...MockArmPlant.initial(st.armId,st.arm.bootId,fixture.programs),plantId:'mujoco_arm' as const};
  // the cell's cups: those the coffee plant already has and those the run's workload will put under the nozzle (the plant learns a cup only when it is placed)
  const known=[...new Set([...st.plant.cups.map(c=>c.cupId),...st.workload.map(w=>w.cupId)])].sort();
  const scene=buildArmCellScene(run.project,{...fixture,physics},run.seed,{armId:st.armId,propIds:known,homeRad:armState.q,
   ...runtime.armExtraStatics?{extraStatics:runtime.armExtraStatics}:{},...runtime.padFrictionOverride!==undefined?{padFriction:runtime.padFrictionOverride}:{}});
  const programs=mujocoProgramSet({...fixture,physics},oracle,scene.allowedContacts),bundle=join(directory,'mujoco-arm','bundle');
  await writeArmCellBundle(bundle,scene,fixture,physics);
  st.arm=armState;
  const base=createMockCoffeePorts(st,ctx,newBootId,{tracking:{reachTolRad:oracle.reachTolRad,settleTicks:oracle.settleTicks,followTolRad:oracle.followTolRad,followTicks:oracle.followTicks},programs,model:XARM6_SI});
  // the run directory is the run's own (MuJoCo writes MUJOCO_LOG.TXT into its working directory on a warning), never a tool root
  const w=await spawnMujocoWorker({python:runtime.python,workerRoot:runtime.workerRoot,runId:ctx.runId,bundleRoot:bundle,runDirectory:join(directory,'mujoco-arm','run'),lockDigest:runtime.lockDigest,
   schemaDir:runtime.schemaDir,sceneDigest:scene.sceneDigest,...runtime.entry?{entry:runtime.entry}:{}});
  let n=0,tick=0,lost=false,refused=false,closed=false,held:readonly string[]=[];
  const ask=(op:string,payload:unknown)=>w.request({protocol:'mekoniq-sim3d/1',requestId:`${op}-${++n}`,runId:ctx.runId,expectedTick:tick,op,payload} as Parameters<typeof w.request>[0]);
  const release=async()=>{if(closed)return;closed=true;releaseSlot(MUJOCO_SLOT,ctx.runId);await w.close('run closed').catch(()=>{});};
  try{
   for(const [op,payload] of [['create',{sceneRef:'arm-cell-scene.json',seed:run.seed,arms:[{armId:st.armId,sceneRef:'arm-cell-scene.json'}]}],['start',{}]] as const){
    const r=await ask(op,payload);if(!r.ok)throw new Error(`MUJOCO_ARM_CREATE_FAILED: ${(r as {error:{code:string}}).error.code}`);
   }
  }catch(e){await w.close('create failed').catch(()=>{});throw e instanceof WorkerLostError?new Error(`MUJOCO_ARM_CREATE_FAILED: ${e.code}`):e;}
  const arm=base.mockArm!;
  // ARM03 sweeps the cell's supports: they join the arm's own obstacles (kept when a run sets its scene), replacing any earlier copy, so a reopened run never holds two
  arm.setCollisionWorld([...st.arm.collision!.world.filter(o=>!SUPPORT_IDS.has(o.id)),...cellSupports(fixture.layout)]);
  const openM=programs.contact!.openM,mapInBase=invertPose(scene.arm.baseInMap),inScene=new Set(known),placed=new Set<string>(),parked=new Set<string>(),unknown=new Set<string>();
  const L=fixture.layout,onStand=composePose(scene.arm.baseInMap,{position:[L.nozzleStand.centerM[0],L.nozzleStand.centerM[1],L.nozzleStand.centerM[2]+L.nozzleStand.sizeM[2]/2+L.cup.heightM/2+PLACE_CLEAR_M],quaternionXyzw:[0,0,0,1]});
  const standPose:Pose={position:[...onStand.position],quaternionXyzw:[...onStand.quaternionXyzw]};
  /** The engine is gone or failed: the running program's outcome is unknown, the arm is latched, the worker is not replaced. */
  const lose=(reason:string,detail?:string)=>{if(!lost){lost=true;arm.halt(reason,detail);}};
  /** This tick's placements: a cup the coffee plant has under the nozzle enters the cell once, on the stand; a delivered cup (on a tray) leaves it once. A cup the pads hold is never moved. */
  const due=()=>{
   const out:{propId:string;pose:Pose|null}[]=[];
   for(const c of st.plant.cups)if(c.at==='nozzle'&&!placed.has(c.cupId)){
    if(inScene.has(c.cupId))out.push({propId:c.cupId,pose:structuredClone(standPose)});
    else if(!unknown.has(c.cupId)){unknown.add(c.cupId);arm.halt('PROP_UNKNOWN');} // never a cup silently missing from the cell
   }
   for(const id of Object.values(st.trays))if(inScene.has(id)&&!parked.has(id)&&!held.includes(id))out.push({propId:id,pose:null});
   return out;
  };
  const extras=(s:Sim3DSnapshotV1,a:NonNullable<Sim3DSnapshotV1['arms']>[number]):PlantExtras=>({...a.gripper?{gripper:{openingM:a.gripper.openingM,heldPropIds:[...a.gripper.heldPropIds]}}:{},
   props:(s.props??[]).map(p=>{const at=qrotate(mapInBase.quaternionXyzw,p.position).map((v,k)=>v+mapInBase.position[k]!);
    return {propId:p.propId,position:at,restingOn:p.restingOn,inMap:{positionM:[p.position[0]!,p.position[1]!,p.position[2]!],quaternionXyzw:[p.quaternionXyzw[0]!,p.quaternionXyzw[1]!,p.quaternionXyzw[2]!,p.quaternionXyzw[3]!]}};})});
  return {...base,
   async advance(){
    await base.advance(); // coffee machine, then the arm's commanded joints and gripper (a latched arm holds where it stopped and keeps its gripper command)
    if(lost)return;
    // after a refusal nothing is placed any more: the refused content is never sent again
    const placements=refused?[]:due();
    try{
     const r=await ask('step',{targetTick:tick+1,velocities:[],actorUpdates:[],jointTargets:[{armId:st.armId,positionsRad:st.arm.commandedQ??st.arm.q}],
      gripperTargets:[{armId:st.armId,openingM:st.arm.gripperCommandM??openM}],...placements.length?{propPlacements:placements}:{}});
     if(!r.ok){
      const code=(r as {error:{code:string}}).error.code;
      // fatal: the worker has ended. A refused step that placed nothing means the plant cannot be commanded even to hold: lost too. Otherwise (a placement was refused) the tick did
      // not advance: the arm latches with the worker's code and the next ticks send the hold command without placements
      if((SIM3D_FATAL_CODES as readonly string[]).includes(code)||!placements.length)lose(code);else{refused=true;arm.halt(code);}
      return;
     }
     tick++;
     for(const p of placements)(p.pose?placed:parked).add(p.propId);
     const s=r.result as Sim3DSnapshotV1,a=s.arms?.[0];
     if(!a){lose('ARM_SNAPSHOT_MISSING');return;}
     held=a.gripper?.heldPropIds??[];
     arm.observe(a.positionsRad,a.collisionIds,extras(s,a));
    }catch(e){lose(e instanceof WorkerLostError?'WORKER_LOST':'WORKER_FAILED',e instanceof WorkerLostError?undefined:String((e as Error)?.message??e).slice(0,500));}
   },
   report:()=>({...base.report(),...st.arm.tracking?{armPlant:mujocoArmPlantReport(runtime.engineVersion,st.arm.tracking)}:{}}),
   async close(){try{await base.close();}finally{await release();}}} satisfies CoffeePlantPorts;
  }
 };
}
