import type {JournalEntry,Mutation,JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {canonicalBytes,hashPayload,verifyEs256,type PublicEcJwk} from '../../../../../../packages/contracts/src/index';
import type {CloudTransaction,TenantScope} from '../identity/tenant-context';
function mutations(entry:JournalEntry):Mutation[]{
 if(!Array.isArray(entry.payload.mutations))return [{ref:{organizationId:entry.organizationId,venueId:entry.venueId,kind:entry.aggregateType,id:entry.aggregateId},expectedVersion:entry.expectedVersion,newState:entry.payload}];
 return entry.payload.mutations.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_FACT_MUTATION');
  const m=value as JsonObject,ref=m.ref as JsonObject;
  if(!ref||ref.organizationId!==entry.organizationId||ref.venueId!==entry.venueId||typeof ref.kind!=='string'||typeof ref.id!=='string'||!Number.isSafeInteger(m.expectedVersion)||Number(m.expectedVersion)<0||!m.newState||Array.isArray(m.newState)||typeof m.newState!=='object')throw new Error('INVALID_FACT_MUTATION');
  return {ref:{organizationId:ref.organizationId,venueId:ref.venueId,kind:ref.kind,id:ref.id},expectedVersion:Number(m.expectedVersion),newState:m.newState as JsonObject};
 });
}
const record=(value:unknown):JsonObject=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_AUTHORITY_FACT');return value as JsonObject;};
function verifyFencing(proof:JsonObject,key:JsonObject,expected:{scope:TenantScope;resourceId:string;oldEpoch:number;oldOwner:string;newOwner:string;handoffId:JsonObject[string];checkpointHash:JsonObject[string]}){
 const {signature,...unsigned}=proof;
 if(proof.organizationId!==expected.scope.organizationId||proof.venueId!==expected.scope.venueId||proof.resourceId!==expected.resourceId||proof.status!=='fenced'||proof.oldEpoch!==expected.oldEpoch||proof.newEpoch!==expected.oldEpoch+1||proof.oldOwnerDeviceId!==expected.oldOwner||proof.newOwnerDeviceId!==expected.newOwner||proof.handoffId!==expected.handoffId||proof.checkpointHash!==expected.checkpointHash||typeof signature!=='string'||!verifyEs256(canonicalBytes(unsigned),signature,key as PublicEcJwk))throw new Error('FENCING_PROOF_INVALID');
}
export async function applyJournalProjection(sql:CloudTransaction,scope:TenantScope,entry:JournalEntry) {
 // Read projections never invoke command handlers or physical/financial effects.
 if(entry.kind==='intent')return {status:'pending' as const,reason:'INTENT_REQUIRES_OWNER'};
 let changes:Mutation[];try{changes=mutations(entry);}catch{return {status:'quarantined' as const,reason:'INVALID_FACT_MUTATION'};}
 const keys=new Set<string>(),projections:{change:Mutation;aggregateType:string;previous?:{version:number;state:JsonObject}}[]=[];
 for(const change of changes){
  const aggregateType=entry.kind==='accepted_fact'?change.ref.kind:`${entry.kind}:${entry.deviceId}:${change.ref.kind}`;
  const key=JSON.stringify([aggregateType,change.ref.id]);if(keys.has(key))return {status:'quarantined' as const,reason:'DUPLICATE_FACT_MUTATION'};keys.add(key);
  const [current]=await sql`SELECT version,state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type=${aggregateType} AND aggregate_id=${change.ref.id} FOR UPDATE`;
  if((current||entry.kind==='accepted_fact')&&change.expectedVersion!==(current?.version??0))return {status:'pending' as const,reason:'AGGREGATE_VERSION_GAP'};
  projections.push({change,aggregateType,previous:current as {version:number;state:JsonObject}|undefined});
 }
 let ownerUpdate:{deviceId:string;deviceEpoch:string;epoch:number;checkpointHash:string;publicJwk:JsonObject}|undefined,policyUpdate:number|undefined;
 const robotUpdates:{resourceId:string;deviceId:string;deviceEpoch:string;epoch:number}[]=[];
 let currentOwner:Record<string,unknown>|undefined;
 try{
  if(entry.kind==='accepted_fact'){
   const [owner]=await sql`SELECT owner_device_id,owner_device_epoch,epoch,status FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator' FOR UPDATE`;
   currentOwner=owner;
   if(!owner||owner.status!=='active'||owner.owner_device_id!==entry.deviceId||owner.owner_device_epoch!==entry.deviceEpoch||Number(owner.epoch)!==entry.coordinatorEpoch)throw new Error('SOURCE_NOT_OWNER');
   const [oldDevice]=await sql`SELECT public_jwk FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${entry.deviceId} AND device_epoch=${entry.deviceEpoch}`;
   if(oldDevice)currentOwner={...owner,public_jwk:oldDevice.public_jwk};
   for(const projection of projections){
    const {change,previous}=projection,state=change.newState;
    if(change.ref.kind==='ownership'&&state.status==='active'){
     if(change.ref.id!==scope.venueId||state.fenced!==true||state.executorEpochAck!==true||state.cursorComplete!==true||state.epoch!==Number(owner.epoch)+1||typeof state.owner!=='string'||typeof state.deviceEpoch!=='string'||typeof state.handoffId!=='string'||typeof state.checkpointHash!=='string'||!Array.isArray(state.proofs))throw new Error('OWNERSHIP_HANDOFF_INVALID');
     const [replacement]=await sql`SELECT public_jwk FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${state.owner} AND device_epoch=${state.deviceEpoch} AND status='active'`;
     if(!replacement||hashPayload(record(state.publicJwk))!==hashPayload(replacement.public_jwk))throw new Error('REPLACEMENT_NOT_ENROLLED');
     const proof=state.proofs.map(record).find(p=>p.resourceId==='coordinator');if(!proof||!oldDevice)throw new Error('FENCING_PROOF_REQUIRED');
     verifyFencing(proof,oldDevice.public_jwk,{scope,resourceId:'coordinator',oldEpoch:Number(owner.epoch),oldOwner:entry.deviceId,newOwner:state.owner,handoffId:state.handoffId,checkpointHash:state.checkpointHash});
     const resources=await sql`SELECT resource_id,owner_device_id,epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id LIKE 'robot:%' FOR UPDATE`;
     for(const resource of resources){
      const robotProof=state.proofs.map(record).find(p=>p.resourceId===resource.resource_id);if(!robotProof)throw new Error('ROBOT_FENCING_PROOF_REQUIRED');
      const [robot]=await sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='robot' AND aggregate_id=${resource.resource_id.slice(6)}`;
      if(!robot)throw new Error('ROBOT_FENCE_KEY_MISSING');
      const oldEpoch=resource.owner_device_id===state.owner?Number(resource.epoch)-1:Number(resource.epoch);
      verifyFencing(robotProof,record(robot.state.executorPublicJwk),{scope,resourceId:resource.resource_id,oldEpoch,oldOwner:entry.deviceId,newOwner:state.owner,handoffId:state.handoffId,checkpointHash:state.checkpointHash});
      robotUpdates.push({resourceId:resource.resource_id,deviceId:state.owner,deviceEpoch:state.deviceEpoch,epoch:Number(robotProof.newEpoch)});
     }
     ownerUpdate={deviceId:state.owner,deviceEpoch:state.deviceEpoch,epoch:Number(state.epoch),checkpointHash:state.checkpointHash,publicJwk:replacement.public_jwk};
    }
    if(change.ref.kind==='configuration'&&change.ref.id==='applied'){
     const revision=state.revision;if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1||(previous?revision!==Number(previous.state.revision)+1:revision!==1))throw new Error('CONFIGURATION_REVISION_GAP');
     const [published]=await sql`SELECT features FROM configuration_revision WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND revision=${revision}`;
     if(!published)throw new Error('CONFIGURATION_NOT_PUBLISHED');
     const actual=record(state.features),desired=record(published.features);
     if(Object.keys(actual).sort().join('\0')!==Object.keys(desired).sort().join('\0'))throw new Error('CONFIGURATION_FEATURE_MISMATCH');
     for(const key of Object.keys(actual)){const a=record(actual[key]),d=record(desired[key]);if(a.revision!==revision||!['enabled','draining','disabled'].includes(String(a.status))||(d.status==='enabled'?a.status!=='enabled':a.status==='enabled'))throw new Error('CONFIGURATION_FEATURE_MISMATCH');}
     policyUpdate=revision;
    }
    if(change.ref.kind==='robot'&&previous){
     const [resource]=await sql`SELECT owner_device_id,owner_device_epoch,epoch FROM venue_ownership WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id=${'robot:'+change.ref.id} FOR UPDATE`;
     if(resource&&(state.ownerDeviceId!==resource.owner_device_id||Number(state.controlEpoch)!==Number(resource.epoch))){
      const proof=record(state.fencingProof);if(typeof state.ownerDeviceId!=='string'||Number(state.controlEpoch)!==Number(resource.epoch)+1)throw new Error('ROBOT_FENCE_INVALID');
      const [replacement]=await sql`SELECT device_epoch FROM device_enrollment WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND device_id=${state.ownerDeviceId} AND status='active'`;
      if(!replacement)throw new Error('REPLACEMENT_NOT_ENROLLED');
      const context=changes.find(m=>m.ref.kind==='ownership'&&m.ref.id===scope.venueId)?.newState??(await sql`SELECT state FROM sync_projection WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND aggregate_type='ownership' AND aggregate_id=${scope.venueId}`)[0]?.state;
      if(!context||context.newDeviceId!==state.ownerDeviceId)throw new Error('ROBOT_HANDOFF_CONTEXT_REQUIRED');
      verifyFencing(proof,record(previous.state.executorPublicJwk),{scope,resourceId:'robot:'+change.ref.id,oldEpoch:Number(resource.epoch),oldOwner:resource.owner_device_id,newOwner:state.ownerDeviceId,handoffId:context.handoffId,checkpointHash:context.checkpointHash});
      robotUpdates.push({resourceId:'robot:'+change.ref.id,deviceId:state.ownerDeviceId,deviceEpoch:replacement.device_epoch,epoch:Number(state.controlEpoch)});
     }
    }
   }
  }
 }catch(error){return {status:'quarantined' as const,reason:error instanceof Error?error.message:'INVALID_AUTHORITY_FACT'};}
 // Validate every CAS, enrollment and fencing basis before any write.
 for(const {change,aggregateType} of projections)await sql`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id)
 VALUES(${scope.organizationId},${scope.venueId},${aggregateType},${change.ref.id},${change.expectedVersion+1},${sql.json(change.newState)},${entry.entryId})
 ON CONFLICT(organization_id,venue_id,aggregate_type,aggregate_id) DO UPDATE SET version=EXCLUDED.version,state=EXCLUDED.state,entry_id=EXCLUDED.entry_id`;
 for(const robot of robotUpdates)await sql`UPDATE venue_ownership SET owner_device_id=${robot.deviceId},owner_device_epoch=${robot.deviceEpoch},epoch=${robot.epoch},status='active' WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id=${robot.resourceId}`;
 if(ownerUpdate)await sql`UPDATE venue_ownership SET owner_device_id=${ownerUpdate.deviceId},owner_device_epoch=${ownerUpdate.deviceEpoch},epoch=${ownerUpdate.epoch},checkpoint_hash=${ownerUpdate.checkpointHash},status='active' WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId} AND resource_id='coordinator'`;
 if(ownerUpdate||policyUpdate!==undefined){
  const epoch=ownerUpdate?.epoch??Number(currentOwner!.epoch),policy=policyUpdate??Number((await sql`SELECT policy_revision FROM authority WHERE organization_id=${scope.organizationId} AND venue_id=${scope.venueId}`)[0]?.policy_revision??1);
  const deviceId=ownerUpdate?.deviceId??String(currentOwner!.owner_device_id),deviceEpoch=ownerUpdate?.deviceEpoch??String(currentOwner!.owner_device_epoch),publicJwk=ownerUpdate?.publicJwk??record(currentOwner!.public_jwk);
  await sql`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision,owner_device_id,owner_device_epoch,public_jwk) VALUES(${scope.organizationId},${scope.venueId},${epoch},${policy},${deviceId},${deviceEpoch},${JSON.stringify(publicJwk)}) ON CONFLICT(organization_id,venue_id) DO UPDATE SET coordinator_epoch=EXCLUDED.coordinator_epoch,policy_revision=EXCLUDED.policy_revision,owner_device_id=EXCLUDED.owner_device_id,owner_device_epoch=EXCLUDED.owner_device_epoch,public_jwk=EXCLUDED.public_jwk`;
 }
 return {status:'applied' as const,reason:null};
}
