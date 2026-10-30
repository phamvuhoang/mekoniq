import type {Actor} from '../identity/rbac';
import {requirePermission} from '../identity/rbac';
import type {TenantScope} from '../identity/tenant-context';
import {authenticateDevice} from '../devices/enrollment';
import {hashPayload,assertJson} from '../../../../../../packages/contracts/src/canonical';
import {ingestSignedBatch,pullEntries,syncWatermark} from './ingest';
export async function syncActor(request:Request,body:unknown,actor:Actor|null){assertJson(body);return actor??await authenticateDevice(request,hashPayload(body));}
export async function pushEntries(actor:Actor,scope:TenantScope,entries:unknown[]){
 requirePermission(actor,'sync.write',scope);
 if(actor.deviceId&&entries.some(entry=>(entry as Record<string,unknown>).deviceId!==actor.deviceId||(entry as Record<string,unknown>).deviceEpoch!==actor.deviceEpoch))throw new Error('SCOPE_DENIED');
 return ingestSignedBatch(scope,entries);
}
export {pullEntries,syncWatermark};
