import {join} from 'node:path';
import {LinuxcncArmAdapter,loadArmProfile} from '../../packages/lab-runtime/src/v2/arm/adapter';
import {createArmSession,loadArmModel,tsChecker} from '../../packages/lab-runtime/src/v2/arm/session';
import {createPlantSession} from '../../packages/lab-runtime/src/v2/beverage/plant-session';
import type {CoffeeState,CoffeeContext} from '../../packages/lab-runtime/src/v2/scenarios/coffee';
import {ArmBridgeDouble} from './arm-bridge-double';
import {createScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {createMockCoffeePorts} from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import type {CoffeePlantPorts} from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import {act,amrAsset,coffeeProject,manifestFor,runDirectory,stepUntil} from './lab-v2';
/** Source SQLite session + production dispatcher. Doubles supply plant facts only. */
export async function runBv01Case(name:'happy'|'missing-grip'|'receiver-moves'|'reboot-after-stage'):Promise<{served:number;transferCount:number;attention:string[];motionStarts:number;physicalParents:string[]}>{
 return executeCase(name,false);
}
export async function runBv01Correlated(){return executeCase('happy',true);}
async function executeCase(name:'happy'|'missing-grip'|'receiver-moves'|'reboot-after-stage',nativeEvidence:boolean){
 const directory=await runDirectory();let motionStarts=0,lastPorts:CoffeePlantPorts|undefined;
 let staged=false,cut=true;
 const input={...manifestFor('BV01',{seed:42,project:coffeeProject()}),backendSetId:'mock-default'};
 const providers={directory,assets:[amrAsset],enabledBackends:['mock_amr','mock_coffee','mock_arm'],coffeePorts:async(st:CoffeeState,ctx:CoffeeContext,boot:()=>string):Promise<CoffeePlantPorts>=>{
  if(nativeEvidence||name==='missing-grip'||name==='reboot-after-stage'){
   const profile=loadArmProfile('integrations/arm-controller/configs/sim/puma560/profile.json'),bridge=new ArmBridgeDouble(profile,ctx.nowMs);
   const send=bridge.send.bind(bridge);bridge.send=async m=>{const reply=await send(m);if(m.command?.capability==='start_job'&&reply.kind==='arm.reply.v1'&&reply.status==='accepted')motionStarts++;return reply;};
   const adapter=new LinuxcncArmAdapter({port:bridge,profile,runId:ctx.runId,cellId:st.cellId,deviceId:st.armId,nowMs:ctx.nowMs,journalPath:join(directory,'arm.sqlite'),afterJournal:phase=>{if(phase==='stage_accepted'){staged=true;if(name==='reboot-after-stage'&&cut)throw new Error('STAGE_CRASH_CUT');}}});
   await adapter.open();
   const session=createArmSession({model:loadArmModel('integrations/arm-controller/models/puma560-reference'),checker:tsChecker(),entityId:st.armId,runId:ctx.runId,providerId:'protocol_double',staleMs:500});
   adapter.onStatus(status=>session.ingest(status,String(process.hrtime.bigint())));
   const plant=createPlantSession({runId:ctx.runId,cellId:st.cellId,armId:st.armId,nowMs:ctx.nowMs,newBootId:boot,receiver:ctx.receiver,dock:ctx.dock,traySensor:()=>false,coffeeState:st.plant,arm:{adapter,session},receiptMonotonicNs:()=>process.hrtime.bigint()});
   const ports=plant.ports(),receiverReports:import('../../packages/cell-adapters/src/contract').CellReport[]=[];
   let observationSeq=0;
   const drain=ports.drain.bind(ports);
   return {...ports,drain:()=>[...drain(),...receiverReports.splice(0)],async advance(){await ports.advance();bridge.emitStatus();for(const [id,status] of bridge.outcomes)if(status==='running'){
    const command=bridge.log.find(m=>m.command?.commandId===id)!.command!;
    const cup=st.plant.cups.find(c=>c.cupId===st.workload.find(w=>w.jobId===(command.payload as {jobId:string}).jobId)?.cupId),toRobot=command.programRef?.id==='cup-place';
    const transferId=`${String((command.payload as {jobId:string}).jobId)}:${toRobot?'place':'pick'}`;
    const seq=String(bridge.seq+1),at=String(process.hrtime.bigint());
    const observation={observationId:`native-double-${++observationSeq}`,runId:ctx.runId,cupId:cup!.cupId,transferId,commandId:id,payloadHash:command.payloadHash,deviceId:st.armId,observerId:'virtual-grip-double',bootId:bridge.bootId,controlEpoch:command.controlEpoch,seq,producer:'linuxcnc_virtual_grip' as const,fidelity:'modeled' as const,phase:toRobot?'release' as const:'grasp' as const,parent:toRobot?'robot:amr-1/tray:1':`arm:${st.armId}/tcp`,grip:toRobot?{closed:false,objectPresent:false}:{closed:true,objectPresent:true},liftPoseReached:!toRobot,clockDomain:'double-clock',observedMonotonicNs:at,receivedMonotonicNs:at,quality:'valid' as const};
    bridge.finish(id,'completed',{controlEpoch:command.controlEpoch,payloadHash:command.payloadHash,deviceId:st.armId,evidence:nativeEvidence?{source:'protocol_double',transferObservation:observation}:{source:'protocol_double',grip:null}});
    if(nativeEvidence&&toRobot){const receiver={...observation,observationId:`tray-double-${observationSeq}`,phase:'receive' as const,deviceId:'amr-1',observerId:'independent-tray-double',bootId:ctx.dock().bootId,seq:String(observationSeq),producer:'gazebo_tray' as const,grip:null};receiverReports.push({deviceId:receiver.deviceId,bootId:receiver.bootId,seq:receiver.seq,observedAt:new Date(ctx.nowMs()).toISOString(),evidence:{source:'protocol_double',transferObservation:receiver}});}

   }}};
  }
  const mock=createMockCoffeePorts(st,ctx,boot),arm=mock.adapters[1]!,execute=arm.execute.bind(arm);
  arm.execute=async command=>{if(command.capability==='start_job')motionStarts++;return execute(command);};
  return {...mock,drain(){return mock.drain().map(r=>{
   if(name==='receiver-moves'&&r.evidence?.released===true){const dock=ctx.dock;ctx.dock=()=>({...dock(),moving:true});}
   return r;
  });}};
 }};
 const factory=providers.coffeePorts;providers.coffeePorts=async(st,ctx,boot)=>{lastPorts=await factory(st,ctx,boot);return lastPorts;};
 const run=await createScenarioRun(input,providers);
 try{
  await run.start();
  if(name==='reboot-after-stage'){
   await stepUntil(run,()=>staged,10);await run.close();cut=false;
   const reopened=await createScenarioRun(input,providers);
   try{await act(reopened,'step',{ticks:1});const r=await reopened.report();return {served:Number(r.outcome.served),transferCount:r.businessEvents.filter(e=>e.type==='CupTransferConfirmed').length,attention:r.attention.map(a=>a.reason),motionStarts,physicalParents:[]};}finally{await reopened.close();}
  }
  await stepUntil(run,undefined,100);const r=await run.report(),events=r.businessEvents;
  const loaded=events.findIndex(e=>e.type==='CargoLoaded'),served=events.findIndex(e=>e.type==='DeliveryHandedOff');
  if(Number(r.outcome.served)>0&&(loaded<0||served<=loaded))throw new Error('CARGO_LOAD_ORDER_VIOLATION');
  return {served:Number(r.outcome.served),transferCount:events.filter(e=>e.type==='CupTransferConfirmed').length,attention:r.attention.map(a=>a.reason),motionStarts,
   physicalParents:(lastPorts?.report().cupLedger??[]).flatMap(c=>c.parent===null?[]:[c.parent])};
 }finally{await run.close();}
}
