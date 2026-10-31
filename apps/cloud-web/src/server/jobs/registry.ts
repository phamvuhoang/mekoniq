import type {JsonObject} from '../../../../../packages/contracts/generated/wire';
import type {TenantScope} from '../modules/identity/tenant-context';
import {collectOrphanAssets} from '../modules/storage/garbage-collection';
import {publishHint} from '../modules/relay/subscriptions';
export type JobContext={scope:TenantScope;id:string;payload:JsonObject;signal:AbortSignal};
export type JobResult={status:'confirmed'|'unknown'|'failed';value:JsonObject};
export type JobHandler={execute:(context:JobContext)=>Promise<JobResult>;reconcile:(context:JobContext)=>Promise<JobResult>};
export class JobRegistry {
 private handlers=new Map<string,JobHandler>();
 register(type:string,handler:JobHandler){if(this.handlers.has(type))throw new Error('DUPLICATE_JOB_HANDLER');this.handlers.set(type,handler);}
 get(type:string){return this.handlers.get(type);}
}
export function defaultJobRegistry(){
 const registry=new JobRegistry();registry.register('hint.publish',{
  execute:async c=>{await publishHint(c.scope,{ref:String(c.payload.ref),revision:Number(c.payload.revision),watermark:String(c.payload.watermark)});return {status:'confirmed',value:{}};},
  // Repeating a hint only wakes idempotent pull; it cannot trigger a physical/financial action.
  reconcile:async()=>({status:'confirmed',value:{hintMayHaveBeenLost:true}}),
 });registry.register('storage.gc',{
  execute:async c=>({status:'confirmed',value:await collectOrphanAssets(c.scope,20,c.signal)}),
  reconcile:async c=>({status:'confirmed',value:await collectOrphanAssets(c.scope,20,c.signal)}),
 });return registry;
}
