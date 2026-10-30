import { AndroidStore } from '../../../packages/sync/src/storage/android';
import { createRouter,processCommand } from '../../../packages/sync/src/command-processor';
import { createProductionRegistry,authorizeVenueCommand } from '../../../packages/domain/src/application';
import {ingestContinuityObservation} from '../../../packages/sync/src/continuity-observations';
import {ingestSettlementObservation} from '../../../packages/sync/src/settlement-observations';
import {startCloudSync,type VerifiedCloudAuthorization} from './cloud-sync';
import {startSimulatedRobotRuntime} from './robot-runtime';
import type {PublicEcJwk} from '../../../packages/contracts/src/index';
import { Identity, Journal, Lan } from './lan-bridge';
import type { CommandEnvelope, CommandResult, JsonObject } from '../../../packages/contracts/src/index';

/** Fixed-owner runtime; native listener stops ACKing whenever this foreground loop stops. */
export async function startCoordinatorRuntime() {
  const initial=await Identity.session();
  const store=new AndroidStore(Journal,initial.isCoordinator?'venue':'local');
  const registry=createProductionRegistry();
  let stopped=false;
  const authorize=async(command:CommandEnvelope,actor?:JsonObject)=>{
    const session=await Identity.session();
    if(!actor&&session.mode==='capture-only'&&!['Continuity.CaptureTicket','Continuity.RecordPaymentObservation'].includes(command.type))return false;
    const permissions=actor?.permissions??session.permissions;
    const stations=actor?.stationIds??session.stationIds??[];
    const expiresAtMs=Date.parse(String(actor?.expiresAt??session.expiresAt??''));
    if(!Array.isArray(permissions)||!permissions.every(p=>typeof p==='string'))return false;
    if(!Array.isArray(stations)||!stations.every(p=>typeof p==='string'))return false;
    return authorizeVenueCommand({id:String(actor?.actorRef??session.actorId),deviceId:String(actor?.deviceId??session.deviceId),scope:{organizationId:session.organizationId,venueId:session.venueId},permissions:permissions as string[],expiresAtMs:Number.isFinite(expiresAtMs)?expiresAtMs:0,stationIds:stations as string[]},command,Date.now());
  };
  const router=createRouter(store,(c,s)=>registry.decide(c,s),c=>authorize(c));
  const dispatch=async(command:CommandEnvelope):Promise<CommandResult>=>{
    if((await Identity.session()).isCoordinator || ['Ownership.Fence','Ownership.Activate'].includes(command.type) || command.type.startsWith('Continuity.Capture') || command.type==='Continuity.RecordPaymentObservation'||command.type==='SettlementGrant.Use'||command.type==='SettlementGrant.Return')return router.dispatch(command);
    if(!await authorize(command))return {status:'rejected',code:'FORBIDDEN',operationId:command.operationId,value:{},duplicate:false,ack:'none'};
    return Lan.send({command});
  };
  if(initial.isCoordinator)await Lan.start();
  const dispatchAuthorized=async(command:CommandEnvelope,actor:VerifiedCloudAuthorization):Promise<CommandResult>=>{
    if(actor.receiptOnly || !(await Lan.heartbeat({storeWritable:true})).ready)return {status:'unknown',ack:'none',operationId:command.operationId,value:{},duplicate:false,code:'RUNTIME_UNAVAILABLE'};
    return processCommand(store,command,(c,s)=>registry.decide(c,s),c=>authorize(c,actor as unknown as JsonObject));
  };
  const cloud=initial.cloudIssuerPublicJwk?startCloudSync({store,scope:initial,deviceId:initial.deviceId,deviceEpoch:initial.deviceEpoch,isCoordinator:initial.isCoordinator,request:input=>Identity.cloudRequest(input),cloudPublicJwk:initial.cloudIssuerPublicJwk as PublicEcJwk,dispatchDelegated:dispatchAuthorized,applyConfiguration:dispatchAuthorized,receiveEntries:entries=>Journal.receiveCloudEntries({entries})}):undefined;
  const robots=initial.isCoordinator?startSimulatedRobotRuntime({store,scope:initial,registry,isActive:async()=> (await Lan.heartbeat({storeWritable:true})).ready}):undefined;
  let actingCoordinator=initial.isCoordinator;
  let checkpointAt=0;
  let timer:ReturnType<typeof setTimeout>;
  const tick=async()=>{
    if(stopped)return;
    try {
      const current=await Identity.session();
      if(actingCoordinator&&!current.isCoordinator){actingCoordinator=false;await Lan.stop();}
      if(Date.now()-checkpointAt>10000){checkpointAt=Date.now();await Journal.checkpoint();if(!current.isCoordinator)await Lan.exchangeCheckpoints().catch(()=>{});}
      await store.snapshots(current);
      await Lan.heartbeat({storeWritable:current.isCoordinator});
      if(!current.isCoordinator)await Lan.flushSettlementObservations();
      if(!current.isCoordinator)for(const effect of await store.pending(initial))if(effect.type==='command.intent')await Lan.send({command:effect.payload as unknown as CommandEnvelope});
      if(current.isCoordinator)for(const request of (await Lan.poll()).requests) {
        const result=request.command.type==='Sync.SettlementObservation'?await ingestSettlementObservation(store,request.authorization.__settlementEntry):request.command.type==='Sync.ContinuityObservation'?await ingestContinuityObservation(store,request.authorization.__settlementEntry):await processCommand(store,request.command,(c,s)=>registry.decide(c,s),c=>authorize(c,request.authorization));
        await Lan.complete({id:request.id,result});
      }
    } catch { await Lan.heartbeat({storeWritable:false}).catch(()=>{}); }
    finally { if(!stopped)timer=setTimeout(()=>{void tick();},500); }
  };
  void tick();
  return {store,dispatch,async close(){stopped=true;clearTimeout(timer);await cloud?.close();await robots?.close();await Lan.stop();await store.close();}};
}
