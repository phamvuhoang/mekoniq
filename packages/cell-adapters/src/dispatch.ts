// Outbox -> cell adapter. Same rules as robot dispatch: a claimed/unknown device command is settled by reconcile only, never resent; a stale epoch,
// expiry or a command the domain no longer expects fails the row explicitly; a missing adapter is a failure, not a silent skip.
import {hashPayload} from '../../contracts/src/canonical';
import type {JsonObject,JsonValue,Scope,Snapshot} from '../../contracts/src/index';
import type {CellAdapter,CellCommand,CellReport} from './contract';
export interface CellEffectStore {
 effects(scope:Scope,type?:string):Promise<JsonObject[]>;
 claimEffect(scope:Scope,id:string):Promise<boolean>;
 completeEffect(scope:Scope,id:string,status:'confirmed'|'unknown'|'failed'):Promise<void>;
 snapshots(scope:Scope):Promise<Snapshot[]>;
}
const KEYS=['commandId','deviceId','controlEpoch','expiresAt','recipeRevision','programRef','capability','payloadHash','payload'] as const;
/** The device envelope of an outbox row, bound to the cell session/run id by the bridge. */
export function toCellCommand(effect:JsonObject,runId:string):CellCommand {
 const command={runId,...Object.fromEntries(KEYS.map(k=>[k,effect[k]]))} as unknown as CellCommand;
 if(hashPayload(command.payload as unknown as JsonValue)!==command.payloadHash)throw new Error('PAYLOAD_HASH_MISMATCH');
 return command;
}
/** Is the domain still waiting for this exact command (a running job step, or the pending cup transfer)? */
function expected(snapshots:Snapshot[],commandId:string){
 return snapshots.some(s=>s.ref.kind==='coffee-job'&&((s.state.steps??[]) as JsonObject[]).some(st=>st.commandId===commandId&&st.status==='running'))
  ||snapshots.some(s=>s.ref.kind==='cup'&&(s.state.pendingTransfer as JsonObject|null)?.commandId===commandId);
}
export async function dispatchCellEffects(store:CellEffectStore,scope:Scope,adapters:readonly CellAdapter[],nowMs:number,runId:string):Promise<{id:string;status:string}[]> {
 const manifests=await Promise.all(adapters.map(async a=>({adapter:a,manifest:await a.describe()})));
 for(const m of manifests)if(m.manifest.validation!=='simulated'&&m.adapter.executor!=='native')throw new Error('NATIVE_EXECUTOR_REQUIRED');
 const rows=(await store.effects(scope)).filter(e=>e.type==='cell.execute'&&!['confirmed','failed'].includes(String(e.status))),out:{id:string;status:string}[]=[];
 for(const row of rows){
  const id=String(row.id),p=row.payload as JsonObject,owner=manifests.find(m=>m.manifest.deviceIds.includes(String(p.deviceId)));
  const done=async(status:'confirmed'|'unknown'|'failed')=>{await store.completeEffect(scope,id,status);out.push({id,status});};
  if(!owner){await done('failed');continue;}
  if(row.status==='dispatching'||row.status==='unknown'){
   const state=await owner.adapter.reconcile(String(p.commandId));
   await done(state.status==='not_found'||state.status==='unknown'?'unknown':'confirmed');continue;
  }
  const snapshots=await store.snapshots(scope),device=snapshots.find(s=>s.ref.kind==='cell-device'&&s.ref.id===p.deviceId);
  if(!device||device.state.controlEpoch!==p.controlEpoch||Date.parse(String(p.expiresAt))<=nowMs||!expected(snapshots,String(p.commandId))||!owner.manifest.capabilities.includes(p.capability as CellCommand['capability'])){await done('failed');continue;}
  let command:CellCommand;try{command=toCellCommand(p,runId);}catch{await done('failed');continue;}
  if(!await store.claimEffect(scope,id))continue;
  try{const r=await owner.adapter.execute(command);await done(r.unknown?'unknown':r.accepted?'confirmed':'failed');}catch{await done('unknown');}
 }
 return out;
}
/** Device report -> Coffee.ObserveDevice payload (the station is added by the caller). Cup presence goes to Coffee.ObserveCup instead. */
export function cellReportPayload(report:CellReport,stationId:string):JsonObject {
 return {stationId,deviceId:report.deviceId,bootId:report.bootId,seq:report.seq,observedAt:report.observedAt,
  ...report.status?{status:report.status as unknown as JsonObject}:{},...report.observation?{observation:report.observation as unknown as JsonObject}:{},...report.measurement?{measurement:report.measurement as unknown as JsonObject}:{}};
}
