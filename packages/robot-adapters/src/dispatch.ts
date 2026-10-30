import type { JsonObject, Scope, Snapshot } from '../../contracts/src/index';
import { validateRobotCommand } from '../../contracts/src/validate';
import type { NativeAcceptance, NativeExecutionState, RobotAdapter, RobotEvent } from './contract';
export interface RobotEffectStore {
 effects(scope:Scope,type?:string):Promise<JsonObject[]>;
 claimEffect(scope:Scope,id:string):Promise<boolean>;
 completeEffect(scope:Scope,id:string,status:'confirmed'|'unknown'|'failed'):Promise<void>;
 snapshots(scope:Scope):Promise<Snapshot[]>;
}
/** Only native adapters with durable command IDs may be used here; this is not an HTTP retry loop. */
export async function dispatchRobotEffects(store:RobotEffectStore,scope:Scope,adapter:RobotAdapter,nowMs:number):Promise<{id:string;result:NativeAcceptance|NativeExecutionState|JsonObject}[]> {
 const manifest=await adapter.describe();
 if(manifest.validation!=='simulated') throw new Error('NATIVE_EXECUTOR_REQUIRED');
 const rows=(await store.effects(scope)).filter(e=>['robot.execute','robot.cancel','robot.requestStop'].includes(String(e.type))&&!['confirmed','failed'].includes(String(e.status)));
 const results:{id:string;result:NativeAcceptance|NativeExecutionState|JsonObject}[]=[];
 for(const row of rows) {
  const id=String(row.id),payload=row.payload as JsonObject;
  if(payload.robotId!==manifest.id) continue;
  const snapshots=await store.snapshots(scope);
  const robot=snapshots.find(s=>s.ref.kind==='robot'&&s.ref.id===manifest.id);
  if(!robot||payload.controlEpoch!==robot.state.controlEpoch) {await store.completeEffect(scope,id,'failed');continue;}
  if(row.status==='dispatching'||row.status==='unknown') {
   const state=await adapter.reconcile(String(payload.commandId));
   await store.completeEffect(scope,id,state.status==='unknown'||state.status==='sending'?'unknown':'confirmed');
   results.push({id,result:state});continue;
  }
  if(row.type==='robot.execute') {
   const command=validateRobotCommand(payload);
   const mission=snapshots.find(s=>s.ref.kind==='mission'&&s.ref.id===command.missionId);
   if(command.organizationId!==scope.organizationId||command.venueId!==scope.venueId||command.issuerDeviceId!==robot.state.ownerDeviceId||Date.parse(command.expiresAt)<=nowMs||mission?.state.commandId!==command.commandId||!['assigned','executing'].includes(String(mission.state.status))) {
    await store.completeEffect(scope,id,'failed');continue;
   }
   if(!await store.claimEffect(scope,id))continue;
   try {
    const result=await adapter.execute(command);
    await store.completeEffect(scope,id,result.unknown?'unknown':result.accepted?'confirmed':'failed');results.push({id,result});
   } catch {await store.completeEffect(scope,id,'unknown');}
  } else if(row.type==='robot.cancel') {
   if(!await store.claimEffect(scope,id))continue;
   const result=await adapter.cancel(String(payload.commandId));
   await store.completeEffect(scope,id,result.unknown?'unknown':result.acknowledged?'confirmed':'failed');results.push({id,result:{...result}});
  } else {
   if(!await store.claimEffect(scope,id))continue;
   const result=await adapter.requestStop(String(payload.reason));
   await store.completeEffect(scope,id,result.acknowledged?'confirmed':'unknown');results.push({id,result:{...result}});
  }
 }
 return results;
}
export function robotEventCommand(event:RobotEvent):JsonObject {
 return {...event.payload,type:event.type,commandId:event.commandId,eventId:event.id,bootId:event.bootId,sequence:event.sequence};
}
