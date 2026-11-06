// Explicit protocol doubles: production native factory, coordinator and domain remain unchanged.
import {join} from 'node:path';
import type {JsonObject,RobotCommand} from '../../packages/contracts/src/index';
import type {GazeboBackend,WorkerEvent} from '../../packages/lab-runtime/src/v2/backends/gazebo-nav2';
import {ArmBridgeDouble} from './arm-bridge-double';
import {loadArmProfile} from '../../packages/lab-runtime/src/v2/arm/adapter';
import type {NativeProtocolDoubles} from '../../packages/lab-runtime/src/v2/sil/native-providers';
import type {TransferObservation} from '../../packages/lab-runtime/src/v2/beverage/cup-ledger';
export function nativeBv01Double(root:string,mode:'happy'|'no-samples'|'missing-grip'|'tunnel-loss'='happy'){
 const bridge=new ArmBridgeDouble(loadArmProfile(join(root,'integrations/arm-controller/configs/sim/puma560/profile.json')),Date.now);bridge.simulationSceneCapability=true;
 let sampling=mode!=='no-samples',stopCalls=0;
 const blockerCalls:boolean[]=[],cupPoses:unknown[]=[];
 let backendClosed=0,sim=0,seq=0,x=.8,y=.8,runId='';const finished=new Set<string>(),goals=new Map<string,RobotCommand>(),listeners=new Set<(e:WorkerEvent)=>void>(),bindings=new Map<string,Record<string,unknown>>();let interval:ReturnType<typeof setInterval>|undefined;
 const emit=(event:string,payload:unknown)=>{for(const l of listeners)l({event,payload:payload as JsonObject});};
 const sample=()=>{if(!sampling)return;sim+=40_000_000;seq++;const time=process.hrtime.bigint();emit('clock',{simTimeNs:String(sim)});emit('telemetry',{schemaVersion:2,runId,entityId:'amr-1',providerId:'gazebo_nav2',bootId:'nav-double',seq:String(seq),simTimeNs:String(sim),observedAt:null,receivedMonotonicNs:'0',frameId:'map',origin:'physics_sim',quality:'valid',reasonCodes:[],commanded:null,observed:{xM:x,yM:y,yawRad:0},estimated:null,causationId:null});emit('dock-observation',{simTimeNs:String(sim),robots:{'amr-1':{poseFresh:true,localizationFresh:true,pose:{value:{position:{x,y,z:0},orientation:{z:0,w:1}},sequence:seq,simTimeNs:sim,receivedMonotonicNs:Number(time)},localization:{value:{valid:true,positionM:[x,y,0]},simTimeNs:sim,receivedMonotonicNs:Number(time)}}}});emit('contact-sensor',{robot:'amr-1',alive:true});bridge.emitStatus();};
 const send=bridge.send.bind(bridge);bridge.send=async m=>{
  if(m.barrier){bridge.emitStatus();return {schemaVersion:1,kind:'arm.reply.v1',commandId:null,status:'accepted',lifecycle:'immediate',duplicate:false,reasonCodes:[],outcome:{status:'completed',evidence:{...m.barrier,seq:String(bridge.seq),controllerEpoch:bridge.epoch,clockNs:String(process.hrtime.bigint()),simTimeNs:null}}};}
  const r=await send(m);if(m.acquire&&r.kind==='arm.reply.v1')r.capabilities=[...(r.capabilities??[]),'correlated_barrier.v1'];
  if(m.simScene){const scene=m.simScene,command=bridge.log.find(l=>l.command?.commandId===scene.commandId)?.command;
   if(command&&bridge.outcomes.get(command.commandId)==='running'&&!finished.has(command.commandId)){
    finished.add(command.commandId);if(mode==='tunnel-loss'){bridge.unreachable=true;throw new Error('BRIDGE_UNREACHABLE');}
    if(mode!=='missing-grip'&&!scene.faults.length){
     const release=command.programRef?.id==='cup-place',at=String(process.hrtime.bigint()),observation:TransferObservation={observationId:`grip-${command.commandId}`,runId,cupId:scene.cup.id,transferId:scene.transferId,commandId:command.commandId,payloadHash:command.payloadHash,deviceId:command.deviceId,observerId:'virtual-grip-double',bootId:bridge.bootId,controlEpoch:command.controlEpoch,seq:String(bridge.seq+1),producer:'linuxcnc_virtual_grip',fidelity:'modeled',phase:release?'release':'grasp',parent:release?'robot:amr-1/tray:1':'arm:arm-1/tcp',grip:release?{closed:false,objectPresent:false}:{closed:true,objectPresent:true},liftPoseReached:!release,clockDomain:'double-controller-clock',observedMonotonicNs:at,receivedMonotonicNs:at,quality:'valid'};
     bridge.emitGrip(command,observation);
     if(release){const binding=bindings.get(scene.transferId);if(!binding)throw new Error('DOUBLE_TRAY_UNBOUND');emit('transfer-observation',{...observation,observationId:`receiver-${command.commandId}`,phase:'receive',deviceId:'amr-1',observerId:'independent-tray-double',bootId:'nav-double',seq:String(++seq),producer:'gazebo_tray',grip:null,clockDomain:'double-gazebo-clock'});}
    }
    bridge.finish(command.commandId,'completed',{controlEpoch:command.controlEpoch,payloadHash:command.payloadHash,deviceId:command.deviceId});
   }
  }
  return r;
 };
 const transports:NativeProtocolDoubles={restartController:async()=>{bridge.reboot('controller-restarted');},arm:async()=>bridge,gazebo:async(world,id)=>{runId=id;interval=setInterval(sample,5);return {world,runId:id,capability:async()=>({backendId:'gazebo_nav2',available:true,step:false,version:'1',reasons:[],evidence:'sil',bootId:'nav-double',robots:['amr-1'],beverage:{available:true,reasonCodes:[]}}),onEvent:l=>{listeners.add(l);return()=>{listeners.delete(l);};},execute:async(_robot,c)=>{goals.set(c.commandId,c);return {status:'accepted',nativeGoalId:c.commandId};},query:async(_r,id)=>{const c=goals.get(id);if(c){x=Number(c.target.x);y=Number(c.target.y);}return {status:c?'completed':'unknown'};},cancel:async()=>({acknowledged:true}),stop:async()=>{stopCalls++;return {acknowledged:true};},pause:async p=>({acknowledged:true,paused:p}),barrier:async(key,participants,proof)=>{sample();return {barrierId:key,acks:participants.map(participant=>({participant,...proof,seq:String(seq),simTimeNs:String(sim),clockNs:String(process.hrtime.bigint())}))};},bindTransfer:async i=>{bindings.set(i.transferId,i);return {bound:true};},setCupPose:async p=>{cupPoses.push(p);return {applied:true};},setBlocker:async enabled=>{blockerCalls.push(enabled);return {applied:true};},close:async()=>{backendClosed++;clearInterval(interval);}} satisfies GazeboBackend;}};
 return {transports,bridge,blockerCalls,cupPoses,setSampling(value:boolean){sampling=value;},get stopCalls(){return stopCalls;},get backendClosed(){return backendClosed;}};
}
