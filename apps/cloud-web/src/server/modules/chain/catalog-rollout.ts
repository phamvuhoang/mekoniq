import {randomUUID} from 'node:crypto';
import type {JsonObject} from '../../../../../../packages/contracts/generated/wire';
import {compareItems,overlayItems} from '../../../../../../packages/domain/src/chain/overlay';
import type {Actor} from '../identity/rbac';
import {withOrganization,withTenant} from '../identity/tenant-context';
import {publishConfiguration,readConfiguration} from '../configuration/publish';
import {relayCatalogPublication} from '../configuration/catalog';
import {latestChainRevision,readBranchOverride} from './branch-overrides';
import {requireChain,rolloutStatus,venueEffective} from './rollout-state';
type Snapshot={currency:string;items:JsonObject[];pricing?:JsonObject;features?:JsonObject};
function snapshotOf(raw:unknown):Snapshot{
 const s=raw as JsonObject|null;
 if(!s||typeof s!=='object'||Array.isArray(s)||(s.items===undefined&&s.features===undefined))throw new Error('INVALID_CHAIN_SNAPSHOT');
 if(s.items!==undefined&&(!Array.isArray(s.items)||!s.items.length||s.items.length>1000||typeof s.currency!=='string'||!/^[A-Z]{3}$/.test(s.currency)))throw new Error('INVALID_CHAIN_SNAPSHOT');
 return s as unknown as Snapshot;
}
/** Creates the next immutable chain revision. Nothing reaches a venue until it is published. */
export async function createChainRevision(actor:Actor,organizationId:string,input:{expectedRevision:number;snapshot:unknown;note?:string}){
 requireChain(actor,'chain.publish',organizationId,actor.venueIds);
 const snapshot=snapshotOf(input.snapshot);
 return insertRevision(actor,organizationId,input.expectedRevision,snapshot,null,input.note);
}
async function insertRevision(actor:Actor,organizationId:string,expected:number,snapshot:Snapshot,restores:number|null,note?:string){
 return withOrganization(organizationId,async sql=>{
  await sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify(['chain-revision',organizationId])}))`;
  const [cur]=await sql`SELECT max(revision) AS r FROM chain_revision WHERE organization_id=${organizationId}`;
  if(Number(cur?.r??0)!==expected)throw new Error('VERSION_CONFLICT');
  const revision=expected+1;
  await sql`INSERT INTO chain_revision(organization_id,revision,snapshot,restores,note,created_by) VALUES(${organizationId},${revision},${sql.json(snapshot as unknown as JsonObject)},${restores},${note?.slice(0,500)??null},${actor.id})`;
  return {revision,restores};
 });
}
/** Roll back FORWARD: the old snapshot becomes a brand-new revision, so revisions never decrease and history stays whole. Orders already accepted keep their own frozen price snapshots. */
export async function rollBackForward(actor:Actor,organizationId:string,input:{expectedRevision:number;toRevision:number;note?:string}){
 requireChain(actor,'chain.publish',organizationId,actor.venueIds);
 const target=await latestChainRevision(organizationId,input.toRevision);if(!target)throw new Error('CHAIN_REVISION_NOT_FOUND');
 return insertRevision(actor,organizationId,input.expectedRevision,snapshotOf(target.snapshot),input.toRevision,input.note);
}
type Plan={venueId:string;catalog?:{version:number;payload:{currency:string;items:JsonObject[];pricing?:JsonObject};diff:ReturnType<typeof compareItems>};configuration?:{features:JsonObject};error?:string};
async function planVenue(organizationId:string,venueId:string,snapshot:Snapshot):Promise<Plan>{
 const effective=await venueEffective({organizationId,venueId}),plan:Plan={venueId};
 if(snapshot.items){
  const override=(await readBranchOverride(organizationId,venueId)).patch,items=overlayItems(snapshot.items,override);
  const missing=items.find(i=>!effective.stationIds.has(String(i.stationId)));
  if(missing)return {venueId,error:'STATION_NOT_FOUND:'+String(missing.stationId)};
  plan.catalog={version:effective.catalogVersion+1,payload:{currency:snapshot.currency,items,...(snapshot.pricing?{pricing:snapshot.pricing}:{})},diff:compareItems(effective.items,items)};
 }
 if(snapshot.features)plan.configuration={features:snapshot.features};
 return plan;
}
/** Dry run: what each branch would receive, the item-level diff against what it runs now, and why a branch cannot take it. Sends nothing. */
export async function previewRollout(actor:Actor,organizationId:string,input:{revision:number;venues:string[]}){
 requireChain(actor,'chain.read',organizationId,input.venues);
 const chain=await latestChainRevision(organizationId,input.revision);if(!chain)throw new Error('CHAIN_REVISION_NOT_FOUND');
 const snapshot=snapshotOf(chain.snapshot);
 return {revision:input.revision,venues:await Promise.all(input.venues.map(v=>planVenue(organizationId,v,snapshot)))};
}
/**
 * Chain.Publish. Per branch and independently: record the desired version, relay it, and let the branch's own acknowledgement (its synced catalog version / applied configuration) decide "effective".
 * One branch failing or being offline never blocks the others. Calling it again for the same revision is the retry: a live (unexpired or unanswered) relay is left alone, an applied branch is untouched.
 */
export async function chainPublish(actor:Actor,organizationId:string,input:{revision:number;venues:string[]}){
 requireChain(actor,'chain.publish',organizationId,input.venues);
 const chain=await latestChainRevision(organizationId,input.revision);if(!chain)throw new Error('CHAIN_REVISION_NOT_FOUND');
 const snapshot=snapshotOf(chain.snapshot);
 for(const venueId of input.venues){
  const scope={organizationId,venueId},plan=await planVenue(organizationId,venueId,snapshot);
  if(plan.error){await recordTarget(organizationId,input.revision,venueId,'catalog',0,null,'rejected',plan.error.split(':')[0]!);continue;}
  if(plan.catalog)await dispatchCatalog(actor,organizationId,input.revision,scope,plan.catalog);
  if(plan.configuration)await dispatchConfiguration(actor,organizationId,input.revision,scope,plan.configuration.features);
 }
 return rolloutStatus(actor,organizationId,input.revision);
}
async function existingTarget(organizationId:string,revision:number,venueId:string,kind:string){
 const [row]=await withOrganization(organizationId,sql=>sql`SELECT desired_version,operation_id,status,attempts FROM chain_rollout_target WHERE organization_id=${organizationId} AND revision=${revision} AND venue_id=${venueId} AND kind=${kind}`);return row;
}
async function recordTarget(organizationId:string,revision:number,venueId:string,kind:string,desired:number,operationId:string|null,status:'dispatched'|'rejected',code:string|null,attempts=1){
 await withOrganization(organizationId,sql=>sql`INSERT INTO chain_rollout_target(organization_id,revision,venue_id,kind,desired_version,operation_id,status,code,attempts) VALUES(${organizationId},${revision},${venueId},${kind},${desired},${operationId},${status},${code},${attempts}) ON CONFLICT(organization_id,revision,venue_id,kind) DO UPDATE SET desired_version=EXCLUDED.desired_version,operation_id=EXCLUDED.operation_id,status=EXCLUDED.status,code=EXCLUDED.code,attempts=EXCLUDED.attempts,updated_at=now()`);
}
async function dispatchCatalog(actor:Actor,organizationId:string,revision:number,scope:{organizationId:string;venueId:string},plan:NonNullable<Plan['catalog']>){
 const prior=await existingTarget(organizationId,revision,scope.venueId,'catalog'),effective=(await venueEffective(scope)).catalogVersion;
 if(prior?.status==='dispatched'&&effective>=Number(prior.desired_version))return; // dispatched and acknowledged: nothing to send. A refused target never reached the branch, whatever its recorded version.
 if(prior?.status==='dispatched'&&prior.operation_id){
  const [relay]=await withTenant(scope,sql=>sql`SELECT status,expires_at FROM relay_command WHERE organization_id=${organizationId} AND venue_id=${scope.venueId} AND operation_id=${prior.operation_id}`);
  if(relay&&(relay.status==='unknown'||(relay.status==='pending'&&Date.parse(relay.expires_at)>Date.now())))return; // still in flight: never a second copy
 }
 const attempts=Number(prior?.attempts??0)+1,operationId=`chain-${revision}-${scope.venueId}-c${attempts}-${randomUUID().slice(0,8)}`;
 try{
  await relayCatalogPublication(actor,scope,{operationId,version:plan.version,currency:plan.payload.currency,items:plan.payload.items,...(plan.payload.pricing?{pricing:plan.payload.pricing}:{})});
  await recordTarget(organizationId,revision,scope.venueId,'catalog',plan.version,operationId,'dispatched',null,attempts);
 }catch(error){await recordTarget(organizationId,revision,scope.venueId,'catalog',plan.version,null,'rejected',error instanceof Error?error.message.slice(0,100):'REJECTED',attempts);}
}
async function dispatchConfiguration(actor:Actor,organizationId:string,revision:number,scope:{organizationId:string;venueId:string},features:JsonObject){
 const prior=await existingTarget(organizationId,revision,scope.venueId,'configuration');
 if(prior&&prior.status!=='rejected')return; // a configuration revision is durable in the cloud; the venue pulls it whenever it returns. A refused one is retried by publishing again.
 try{
  // the chain states the features it manages; every other feature of the branch keeps its current setting (a missing feature would read as DISABLED)
  const current=await readConfiguration(actor,scope),
   merged={...((current.features??{}) as JsonObject),...features},result=await publishConfiguration(actor,scope,{expectedRevision:Number(current.revision),features:merged as never});
  await recordTarget(organizationId,revision,scope.venueId,'configuration',result.revision,null,'dispatched',null);
 }catch(error){await recordTarget(organizationId,revision,scope.venueId,'configuration',0,null,'rejected',error instanceof Error?error.message.split(':')[0]!.slice(0,100):'REJECTED');}
}
/** Side-by-side effective menus of two branches. Reads only what the branches have synced, so a lagging branch shows its older menu rather than the chain's wish. */
export async function compareBranches(actor:Actor,organizationId:string,a:string,b:string){
 requireChain(actor,'chain.read',organizationId,[a,b]);
 const [x,y]=await Promise.all([venueEffective({organizationId,venueId:a}),venueEffective({organizationId,venueId:b})]);
 return {a:{venueId:a,catalogVersion:x.catalogVersion},b:{venueId:b,catalogVersion:y.catalogVersion},differences:compareItems(x.items,y.items)};
}
export async function listChainRevisions(actor:Actor,organizationId:string){
 requireChain(actor,'chain.read',organizationId,actor.venueIds);
 const rows=await withOrganization(organizationId,sql=>sql`SELECT revision,restores,note,created_by,created_at FROM chain_revision WHERE organization_id=${organizationId} ORDER BY revision DESC LIMIT 50`);
 return {revisions:rows.map(r=>({revision:Number(r.revision),restores:r.restores===null?null:Number(r.restores),note:r.note as string|null,createdBy:String(r.created_by),createdAt:new Date(r.created_at as string).toISOString()}))};
}
