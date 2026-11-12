// Twin state projection for the mock backends: plant/device state -> TwinSampleV2 per entity. Telemetry only: it never feeds the journal,
// and commanded/observed/estimated stay apart. The mock arm has no encoder (commanded only); AMR pose comes from the mock plant (origin mock).
import type {TwinSampleV2} from './contracts';
import type {PlantRobot} from './backends/mock-amr';
import type {CoffeeState} from './scenarios/coffee';
export interface ProjectionInput {runId:string;seq:string;simTimeNs:string;nowMs:number;robots:readonly PlantRobot[];coffee?:CoffeeState}
/** Samples carry a run publication sequence independent of sim time, including action boundaries within a paused tick. */
export function projectSamples(i:ProjectionInput,receivedMonotonicNs:string):TwinSampleV2[]{
 const base={schemaVersion:2 as const,runId:i.runId,seq:i.seq,simTimeNs:i.simTimeNs,observedAt:new Date(i.nowMs).toISOString(),receivedMonotonicNs,origin:'mock' as const,estimated:null};
 const out:TwinSampleV2[]=i.robots.map(r=>{const g=r.goals.find(x=>x.state==='executing')??null;
  return {...base,entityId:r.id,providerId:'mock_amr',bootId:r.bootId,frameId:'map',quality:r.stale?'stale':'valid',reasonCodes:r.stale?['POSE_REBUILT_FROM_SOURCE']:[],
   commanded:g?{goalCommandId:g.commandId,goalState:g.state}:null,observed:{xM:r.pose.x,yM:r.pose.y,yawRad:r.pose.yawRad,moving:r.moving,hold:r.hold},causationId:g?.commandId??null};});
 const c=i.coffee;if(!c)return out;
 const arm=c.arm,running=arm.programs.find(p=>p.state==='running');
 // tracking = the arm is a plant (webots_arm, or the one arm.plantId names): q is what the engine reported, commandedQ what the state machine asked for. A contact plant (mujoco_arm) also
 // reports the measured gripper opening and every cup of its cell (map frame), with the cup's owner as the plant state says
 if(arm.tracking){
  const providerId=arm.plantId??'webots_arm',owner=(cupId:string)=>{const robot=Object.entries(c.trays??{}).find(([,v])=>v===cupId)?.[0];
   return arm.holding===cupId?{ownerKind:'arm' as const,ownerId:c.armId}:robot?{ownerKind:'robot' as const,ownerId:robot}:c.plant.cups.some(x=>x.cupId===cupId&&x.at==='nozzle')?{ownerKind:'cell' as const,ownerId:c.cellId}:{ownerKind:'unknown' as const,ownerId:null};};
  out.push({...base,origin:'physics_sim' as const,entityId:c.armId,providerId,bootId:arm.bootId,frameId:'arm_base',quality:'valid',reasonCodes:[],
   commanded:{jointsRad:[...(arm.commandedQ??arm.q)],gripper:arm.gripper,limitsOk:arm.limitsOk},observed:{jointsRad:[...arm.q],limitsOk:arm.limitsOk,...arm.gripperOpeningM!==undefined?{gripperOpeningM:arm.gripperOpeningM}:{}},causationId:running?.commandId??null});
  for(const p of arm.props??[])if(p.inMap)out.push({...base,origin:'physics_sim' as const,entityId:p.propId,providerId,bootId:arm.bootId,frameId:'map',quality:'valid',reasonCodes:[],commanded:null,
   observed:{...owner(p.propId),positionM:[...p.inMap.positionM],quaternionXyzw:[...p.inMap.quaternionXyzw],restingOn:p.restingOn},causationId:null});
 }else out.push({...base,entityId:c.armId,providerId:'mock_arm',bootId:arm.bootId,frameId:'arm_base',quality:'unknown',reasonCodes:['NO_ENCODER_MOCK'],
  commanded:{jointsRad:[...arm.q],gripper:arm.gripper,limitsOk:arm.limitsOk},observed:null,causationId:running?.commandId??null});
 const machine=c.plant.devices.find(d=>d.role==='machine')!,cmd=c.plant.commands.find(x=>x.state==='running'||x.state==='settling');
 out.push({...base,entityId:c.cellId,providerId:'mock_coffee',bootId:machine.bootId,frameId:'cell_base',quality:'valid',reasonCodes:[],commanded:null,
  observed:{cycleState:cmd?cmd.resource:'idle',cupPresent:c.plant.cups.some(x=>x.at==='nozzle'),machineStatus:machine.status},causationId:cmd?.commandId??null});
 return out;
}
