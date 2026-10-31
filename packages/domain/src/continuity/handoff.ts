import type {CommandEnvelope,Snapshot} from '../../../contracts/src/index';
import {canonicalBytes,hashPayload,verifyEs256,type PublicEcJwk} from '../../../contracts/src/index';
import {recoveryInventory} from './recovery-inventory';
import {activeDeviceCheckpointsComplete} from './checkpoint';
import {find,requireState,text,change,ok,object,objects} from './shared';
export function canActivate(s:{fenced:boolean;cursorComplete:boolean;unknownResources:number}){return s.fenced&&s.cursorComplete&&s.unknownResources===0;}
export function prepareHandoff(c:CommandEnvelope,s:Snapshot[]) {
  const authority=requireState(s,'__scope__','authority').state;
  const current=find(s,'ownership',c.venueId)?.state??{owner:authority.ownerDeviceId,epoch:c.coordinatorEpoch};
  const newDeviceId=text(c.payload.newDeviceId);
  if(newDeviceId===current.owner)throw new Error('OWNER_UNCHANGED');
  const replacement=requireState(s,'device',newDeviceId);if(replacement.state.status!=='active')throw new Error('REPLACEMENT_NOT_ENROLLED');
  object(replacement.state.publicJwk);
  const cursorComplete=activeDeviceCheckpointsComplete(s,Number(authority.nowMs));
  const checkpointHash=hashPayload(s.filter(x=>x.ref.kind!=='ownership'&&x.ref.kind!=='__scope__').map(x=>({kind:x.ref.kind,id:x.ref.id,version:x.version})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  return ok([change('OwnershipHandoffPrepared','ownership',c.venueId,{...current,newDeviceId,status:'preparing',fenced:false,cursorComplete,checkpointHash,handoffId:c.operationId,preparedAt:c.recordedAt})],{handoffId:c.operationId,checkpointHash,oldEpoch:c.coordinatorEpoch,newEpoch:c.coordinatorEpoch+1,cursorComplete});
}
export function fenceOwner(c:CommandEnvelope,s:Snapshot[]) {
  const state=requireState(s,'ownership',c.venueId).state;
  if(state.status!=='preparing'||state.newDeviceId!==c.payload.newDeviceId)throw new Error('HANDOFF_NOT_PREPARED');
  if(!Array.isArray(c.payload.proofs))throw new Error('FENCING_EVIDENCE_REQUIRED');
  const proofs=objects(c.payload.proofs),authority=requireState(s,'__scope__','authority').state;
  if(!activeDeviceCheckpointsComplete(s,Number(authority.nowMs)))throw new Error('CHECKPOINT_INCOMPLETE');
  const resources=[{id:'coordinator',epoch:c.coordinatorEpoch,owner:String(authority.ownerDeviceId),key:object(authority.publicJwk)},...s.filter(x=>x.ref.kind==='robot').map(robot=>({id:`robot:${robot.ref.id}`,epoch:Number(robot.state.controlEpoch),owner:String(robot.state.ownerDeviceId),key:object(robot.state.executorPublicJwk)}))];
  const events=[];
  for(const resource of resources) {
    const proof=proofs.find(p=>p.resourceId===resource.id);if(!proof)throw new Error('FENCING_EVIDENCE_REQUIRED');
    const signature=text(proof.signature),unsigned=Object.fromEntries(Object.entries(proof).filter(([key])=>key!=='signature'));
    if(proof.organizationId!==c.organizationId||proof.venueId!==c.venueId||proof.handoffId!==state.handoffId||proof.checkpointHash!==state.checkpointHash||proof.status!=='fenced'||proof.oldEpoch!==resource.epoch||proof.newEpoch!==resource.epoch+1||proof.oldOwnerDeviceId!==resource.owner||proof.newOwnerDeviceId!==state.newDeviceId)throw new Error('FENCING_PROOF_MISMATCH');
    if(!verifyEs256(canonicalBytes(unsigned),signature,resource.key as PublicEcJwk))throw new Error('FENCING_SIGNATURE_INVALID');
    if(resource.id.startsWith('robot:')) {
      const robot=requireState(s,'robot',resource.id.slice(6));
      events.push(change('RobotOwnerFenced','robot',robot.ref.id,{...robot.state,ownerDeviceId:state.newDeviceId,controlEpoch:resource.epoch+1,fencingProof:proof}));
    }
  }
  events.push(change('OwnershipFenced','ownership',c.venueId,{...state,fenced:true,status:'fenced',proofs,fencedBy:c.actorRef,executorEpochAck:true}));
  return ok(events);
}
export function activateOwner(c:CommandEnvelope,s:Snapshot[]) {
  const inventory=recoveryInventory(s);
  if(inventory.unknownRobots.length||inventory.unknownGrants.length||inventory.missingDevices.length||inventory.loadedMissions.length||inventory.unknownReservations.length)throw new Error('RESOURCE_UNRECONCILED');
  const state=requireState(s,'ownership',c.venueId).state;
  if(state.fenced!==true||state.executorEpochAck!==true)throw new Error('FENCING_REQUIRED');
  if(state.cursorComplete!==true||!activeDeviceCheckpointsComplete(s,Number(requireState(s,'__scope__','authority').state.nowMs)))throw new Error('CHECKPOINT_INCOMPLETE');
  if(state.newDeviceId!==c.payload.newDeviceId)throw new Error('HANDOFF_DEVICE_MISMATCH');
  const epoch=typeof state.epoch==='number'?state.epoch:c.coordinatorEpoch;
  const replacement=requireState(s,'device',String(state.newDeviceId));if(replacement.state.status!=='active')throw new Error('REPLACEMENT_NOT_ENROLLED');
  return ok([change('OwnershipActivated','ownership',c.venueId,{...state,owner:state.newDeviceId,deviceEpoch:replacement.state.deviceEpoch,publicJwk:object(replacement.state.publicJwk),epoch:epoch+1,status:'active',activatedAt:c.recordedAt})],{coordinatorEpoch:epoch+1});
}
