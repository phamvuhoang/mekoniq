// webots_arm (R1.1): the CoffeePlantPorts of a run whose arm is a Webots plant. The coffee machine and the cup are the mock's; the arm is the mock's program state machine in `tracking` mode:
// each tick it generates the commanded joints, the Webots worker steps the arm to them (position servo, 20 ms), and what the engine reports becomes the arm state (ARM03 on the actual joints).
// Gripping is an event of the state machine, never physics. A lost worker leaves the running program unknown; nothing is resent and no worker is started in its place.
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {LabProjectV2} from '../contracts';
import type {RunProviders} from '../scenario-runner';
import {createMockCoffeePorts,type CoffeePlantPorts,type ArmPlantReport} from '../beverage/coffee-ports';
import {loadOracleProfile} from '../algorithm/checker';
import {WorkerLostError} from '../navigation2d/plant';
import {holdSlot,irsimCapacity,releaseSlot} from '../navigation2d/runner';
import type {Sim3DSnapshotV1} from '../navigation2d/contracts';
import {buildArmScene3D,readArmFixture} from './arm-scene';
import {WEBOTS_AMR,type WebotsRuntimeOptions} from './webots';
import {spawnSim3DWorker} from './worker-client';

/** The arm shares the Webots engine (and its one-per-host slot) with webots_3d. */
export const WEBOTS_SLOT=WEBOTS_AMR.id;
export interface ArmRunInput {project:LabProjectV2;seed:number}
/** Per-joint |actual - commanded| over the programs that ran: peak and RMS. */
export const trackingStats=(st:{samples:number;peakRad:number[];sumSq:number[]}):ArmPlantReport['tracking']=>({samples:st.samples,peakRad:[...st.peakRad],rmsRad:st.sumSq.map(v=>st.samples?Math.sqrt(v/st.samples):0)});
export const armPlantReport=(st:{samples:number;peakRad:number[];sumSq:number[]}):ArmPlantReport=>({engine:'webots_3d',control:'position_servo',grip:'event',dynamics:'assumed',calibration:'not_calibrated',tracking:trackingStats(st)});

export function webotsArmPorts(runtime:WebotsRuntimeOptions,run:ArmRunInput):NonNullable<RunProviders['coffeePorts']>{
 return async(st,ctx,newBootId,directory)=>{
  if(!irsimCapacity(runtime.maxActiveRuns??1,ctx.runId,WEBOTS_SLOT))throw new Error('WEBOTS_CAPACITY');
  holdSlot(WEBOTS_SLOT,ctx.runId); // from here to close (or a failed create) this run owns the host's one Webots
  try{return await open();}catch(e){releaseSlot(WEBOTS_SLOT,ctx.runId);throw e;}
  async function open():Promise<CoffeePlantPorts>{
  const profile=loadOracleProfile().profile.webotsArm;
  if(!profile)throw new Error('ARM_ORACLE_PROFILE_MISSING: the oracle profile has no webotsArm thresholds');
  const fixture=readArmFixture(runtime.workerRoot,runtime.armFixtureDir),scene=buildArmScene3D(run.project,fixture,run.seed,{armId:st.armId,homeRad:st.arm.q,...runtime.armExtraStatics?{extraStatics:runtime.armExtraStatics}:{}});
  const bundle=join(directory,'webots-arm','bundle');
  await mkdir(bundle,{recursive:true,mode:0o700});
  await writeFile(join(bundle,'arm-scene.json'),JSON.stringify(scene),{mode:0o600});
  await writeFile(join(bundle,'arm-component.json'),fixture.componentText,{mode:0o600});
  const base=createMockCoffeePorts(st,ctx,newBootId,{tracking:{reachTolRad:profile.reachTolRad,settleTicks:profile.settleTicks,followTolRad:profile.followTolRad,followTicks:profile.followTicks}});
  const w=await spawnSim3DWorker({python:runtime.python,workerRoot:runtime.workerRoot,runId:ctx.runId,bundleRoot:bundle,runDirectory:join(directory,'webots-arm','run'),lockDigest:runtime.lockDigest,schemaDir:runtime.schemaDir,
   sceneDigest:scene.sceneDigest,webotsHome:runtime.webotsHome,...runtime.entry?{entry:runtime.entry}:{}});
  let n=0,tick=0,lost=false,closed=false;
  const ask=(op:string,payload:unknown)=>w.request({protocol:'mekoniq-sim3d/1',requestId:`${op}-${++n}`,runId:ctx.runId,expectedTick:tick,op,payload} as Parameters<typeof w.request>[0]);
  const release=async()=>{if(closed)return;closed=true;releaseSlot(WEBOTS_SLOT,ctx.runId);await w.close('run closed').catch(()=>{});};
  try{
   const c=await ask('create',{sceneRef:'arm-scene.json',seed:run.seed,arms:[{armId:st.armId,sceneRef:'arm-scene.json'}]});
   if(!c.ok)throw new Error(`WEBOTS_ARM_CREATE_FAILED: ${(c as {error:{code:string}}).error.code}`);
   const s=await ask('start',{});
   if(!s.ok)throw new Error(`WEBOTS_ARM_CREATE_FAILED: ${(s as {error:{code:string}}).error.code}`);
  }catch(e){await w.close('create failed').catch(()=>{});throw e instanceof WorkerLostError?new Error(`WEBOTS_ARM_CREATE_FAILED: ${e.code}`):e;}
  const arm=base.mockArm!;
  /** The engine is gone or refused a tick: the running program's outcome is unknown, the arm is latched, and the worker is not replaced. */
  const lose=(reason:string)=>{if(!lost){lost=true;arm.halt(reason);}};
  return {...base,
   async advance(){
    await base.advance(); // coffee machine and the arm's commanded joints
    if(lost)return;
    const target=st.arm.commandedQ??st.arm.q;
    try{
     const r=await ask('step',{targetTick:tick+1,velocities:[],actorUpdates:[],jointTargets:[{armId:st.armId,positionsRad:target}]});
     if(!r.ok){lose((r as {error:{code:string}}).error.code);return;}
     tick++;
     const a=(r.result as Sim3DSnapshotV1).arms?.[0];
     if(!a)lose('ARM_SNAPSHOT_MISSING');else arm.observe(a.positionsRad,a.collisionIds);
    }catch(e){lose(e instanceof WorkerLostError?'WORKER_LOST':'WORKER_FAILED');}
   },
   report:()=>({...base.report(),...st.arm.tracking?{armPlant:armPlantReport(st.arm.tracking)}:{}}),
   async close(){try{await base.close();}finally{await release();}}} satisfies CoffeePlantPorts;
  }
 };
}
