import type {CommandEnvelope,Snapshot,JsonObject} from '../../../contracts/src/index';
import {find,change,ok,requireState} from './shared';
import {grantBlocksReissue} from '../billing/settlement-grant';
import {hashPayload} from '../../../contracts/src/index';
function checkpointHash(s:Snapshot[]){return hashPayload(s.filter(x=>!['maintenance','__scope__'].includes(x.ref.kind)).map(x=>({kind:x.ref.kind,id:x.ref.id,version:x.version})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}
export function prepareMaintenance(c:CommandEnvelope,s:Snapshot[]) {
  const missing=c.payload.missingDevices??[];
  if(!Array.isArray(missing)||missing.some(x=>typeof x!=='string'))throw new Error('INVALID_DEVICE_INVENTORY');
  const checkpoints:JsonObject[]=s.filter(x=>x.ref.kind==='device-checkpoint').map(x=>({deviceId:x.ref.id,...x.state}));
  const missingDevices=[...new Set([...missing,...s.filter(x=>x.ref.kind==='device'&&x.state.status==='active'&&!checkpoints.some(checkpoint=>checkpoint.deviceId===x.ref.id&&checkpoint.deviceEpoch===x.state.deviceEpoch&&checkpoint.status==='complete'&&checkpoint.pendingCount===0&&checkpoint.receivedCursor===checkpoint.appliedCursor)).map(x=>x.ref.id)])];
  return ok([change('MaintenancePrepared','maintenance','current',{status:'prepared',id:c.operationId,mode:c.payload.mode??'full_shutdown',checkpointHash:checkpointHash(s),checkpoints,missingDevices,preparedBy:c.actorRef,preparedAt:c.recordedAt})],{checkpoints,missingDevices});
}
export function enterMaintenance(c:CommandEnvelope,s:Snapshot[]) {
  if(c.payload.mode!=='full_shutdown'&&c.payload.mode!=='cloud_only')throw new Error('INVALID_MAINTENANCE_MODE');
  if(c.payload.mode==='full_shutdown') {
    if(s.some(x=>x.ref.kind==='mission'&&x.state.loaded===true&&!['completed','cancelled'].includes(String(x.state.status))))throw new Error('UNRESOLVED_CARGO');
    if(s.some(x=>x.ref.kind==='grant'&&grantBlocksReissue(String(x.state.status))))throw new Error('GRANT_UNRECONCILED');
    const prepared=find(s,'maintenance','current');
    if(!prepared||prepared.state.status!=='prepared')throw new Error('CHECKPOINT_REQUIRED');
    if(Array.isArray(prepared.state.missingDevices)&&prepared.state.missingDevices.length)throw new Error('MISSING_DEVICE_CHECKPOINTS');
    if(prepared.state.checkpointHash!==checkpointHash(s))throw new Error('CHECKPOINT_CHANGED');
  }
  return ok([change('MaintenanceEntered','maintenance','current',{...find(s,'maintenance','current')?.state,status:'active',mode:c.payload.mode,enteredAt:c.recordedAt,enteredBy:c.actorRef})]);
}
export function resumeMaintenance(c:CommandEnvelope,s:Snapshot[]) {
  const maintenance=requireState(s,'maintenance','current');
  if(maintenance.state.status!=='active')throw new Error('MAINTENANCE_NOT_ACTIVE');
  if(s.some(x=>x.ref.kind==='conflict'&&x.state.status==='open'))throw new Error('CONFLICTS_UNRESOLVED');
  return ok([change('MaintenanceResumed','maintenance','current',{...maintenance.state,status:'resumed',resumedAt:c.recordedAt,resumedBy:c.actorRef})]);
}
