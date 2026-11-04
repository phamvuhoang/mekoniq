import {createHmac,randomUUID} from 'node:crypto';
import {profileFor} from '../../../../../../integrations/core/src/connector';
import {cloudDatabase,withTenant,type TenantScope} from '../identity/tenant-context';
import {requirePermission,type Actor} from '../identity/rbac';
/** Channel secrets are derived from a server-side master, so nothing secret is stored and revoking a key id is enough. Missing master = no channel can authenticate (fail closed). */
export function channelSecret(keyId:string):string{
 const master=process.env.CHANNEL_SECRET_MASTER;if(!master||master.length<32)throw new Error('CHANNEL_SECRETS_UNAVAILABLE');
 return createHmac('sha256',master).update('channel:'+keyId).digest('base64url');
}
export type Credential={organizationId:string;venueId:string;providerId:string;merchantId:string;unavailablePolicy:'hold'|'reject';status:string};
export async function lookupCredential(keyId:string):Promise<Credential|null>{
 if(!/^ck_[A-Za-z0-9_-]{8,64}$/.test(keyId))return null;
 const [row]=await cloudDatabase()`SELECT * FROM public.channel_credential_lookup(${keyId})`;
 return row?{organizationId:String(row.organization_id),venueId:String(row.venue_id),providerId:String(row.provider_id),merchantId:String(row.merchant_id),unavailablePolicy:row.unavailable_policy,status:String(row.status)}:null;
}
/** Issued once to the channel operator. Only an enabled profile can get a credential, scoped to exactly one tenant, venue and merchant. */
export async function issueChannelCredential(actor:Actor,scope:TenantScope,input:{provider:string;merchantId:string;unavailablePolicy?:'hold'|'reject'}){
 requirePermission(actor,'channel.operate',scope);
 const profile=profileFor(input.provider);if(profile.authentication!=='hmac')throw new Error('INVALID_PROVIDER_AUTH');
 if(!/^[A-Za-z0-9._-]{1,60}$/.test(input.merchantId))throw new Error('INVALID_MERCHANT');
 const policy=input.unavailablePolicy??'hold';if(policy!=='hold'&&policy!=='reject')throw new Error('INVALID_POLICY');
 const keyId='ck_'+randomUUID().replace(/-/g,'');
 await withTenant(scope,sql=>sql`INSERT INTO channel_credential(key_id,organization_id,venue_id,provider_id,merchant_id,unavailable_policy,created_by) VALUES(${keyId},${scope.organizationId},${scope.venueId},${input.provider},${input.merchantId},${policy},${actor.id})`);
 return {keyId,secret:channelSecret(keyId)};
}
export async function revokeChannelCredential(actor:Actor,scope:TenantScope,keyId:string){
 requirePermission(actor,'channel.operate',scope);
 const rows=await withTenant(scope,sql=>sql`UPDATE channel_credential SET status='revoked' WHERE key_id=${keyId} AND organization_id=${scope.organizationId} AND venue_id=${scope.venueId} RETURNING key_id`);
 if(rows.length!==1)throw new Error('CREDENTIAL_NOT_FOUND');return {keyId,status:'revoked'};
}
