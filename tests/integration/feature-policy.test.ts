import { expect,test } from 'vitest';
import { evaluateFeature } from '../../packages/domain/src/policy/evaluate';
test('draining blocks new work while allowing accepted work',()=>{
  expect(evaluateFeature({status:'draining',intent:'new',revision:2}).allowed).toBe(false);
  expect(evaluateFeature({status:'draining',intent:'finish_existing',revision:2}).allowed).toBe(true);
});
import {preset} from '../../packages/domain/src/policy/presets';
import {validateDependencies} from '../../packages/domain/src/policy/registry';
import {transitionFeature} from '../../packages/domain/src/policy/transition';
test('permission and policy remain active for existing work',()=>{
 expect(evaluateFeature({status:'disabled',intent:'finish_existing',revision:3,permitted:false}).reason).toBe('PERMISSION_DENIED');
 expect(evaluateFeature({status:'enabled',intent:'new',revision:3,policyRevision:2}).reason).toBe('POLICY_STALE');
});
test('trial preset only introduces required dependencies',()=>{
 const base=preset('trial-service');expect(base.features.inventory.status).toBe('disabled');expect(base.features.catalog.status).toBe('disabled');
 const order=preset('trial-service',{order:true});expect(order.features.catalog.status).toBe('enabled');expect(order.features['payment.cash'].status).toBe('disabled');
 expect(()=>preset('trial-service',{madeUp:true})).toThrow('UNKNOWN_TRIAL_FLAG');
 expect(validateDependencies(base.features)).toEqual([]);
});
test('dependency cycles and unavailable robot capabilities are denied',()=>{
 expect(validateDependencies({a:{status:'enabled',revision:1},b:{status:'enabled',revision:1}}, {a:{id:'a',dependencies:['b'],group:'F',permission:'p'},b:{id:'b',dependencies:['a'],group:'F',permission:'p'}}).some(e=>e.startsWith('DEPENDENCY_CYCLE'))).toBe(true);
 expect(evaluateFeature({status:'enabled',intent:'new',revision:1,feature:'robot.delivery',readiness:{robot:false}}).reason).toBe('NOT_READY');
 expect(transitionFeature(false,1)).toBe('draining');expect(transitionFeature(false,0)).toBe('disabled');
});
import {beforeAll,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {publishConfiguration,readConfiguration,applyConfiguration} from '../../apps/cloud-web/src/server/modules/configuration/publish';
import type {Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
let db:Awaited<ReturnType<typeof setupWave02>>;const scope={organizationId:'policy-org-'+randomUUID(),venueId:'venue-a'};
const owner:Actor={id:'manager',organizationId:scope.organizationId,venueIds:[scope.venueId],permissions:['*'],role:'owner'};
beforeAll(async()=>{db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Policy venue')`;});afterAll(async()=>{if(db)await db.close();});
test('configuration publication stays pending until the current owner acknowledges',async()=>{
 const features=preset('cash-only').features;const published=await publishConfiguration(owner,scope,{expectedRevision:0,features});expect(published.status).toBe('pending_venue');
 expect((await readConfiguration(owner,scope)).status).toBe('published');
 await expect(publishConfiguration(owner,scope,{expectedRevision:0,features})).rejects.toThrow('VERSION_CONFLICT');
 const device={...owner,deviceId:'coordinator',deviceEpoch:'epoch-a'};
 await expect(applyConfiguration(device,scope,{revision:1,coordinatorEpoch:1,receiptHash:'a'.repeat(64)})).rejects.toThrow('OWNER_REQUIRED');
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','coordinator','epoch-a',1,'active')`;
 await expect(applyConfiguration(device,scope,{revision:1,coordinatorEpoch:1,receiptHash:'a'.repeat(64)})).rejects.toThrow('CONFIGURATION_RECEIPT_PENDING');
 const keys=generateKeyPairSync('ec',{namedCurve:'P-256'});await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','epoch-a',${db.admin.json(keys.publicKey.export({format:'jwk'}) as Record<string,string>)},'active')`;
 const state={revision:1,features:published.features,readiness:{},appliedAt:new Date().toISOString()},input={revision:1,features:published.features,readiness:{}},originalHash=hashPayload(input);
 const payload={events:[{type:'ConfigurationApplied',data:{kind:'configuration',id:'applied',state}}],mutations:[{ref:{...scope,kind:'configuration',id:'applied'},expectedVersion:0,newState:state}],operationType:'Configuration.Apply',commandPayloadHash:originalHash};
 const entry={schemaVersion:1,...scope,entryId:randomUUID(),operationId:'config-proof-1',deviceId:'coordinator',deviceEpoch:'epoch-a',sequence:'1',coordinatorEpoch:1,aggregateType:'configuration',aggregateId:'applied',expectedVersion:0,resultingVersion:1,kind:'accepted_fact',occurredAt:new Date().toISOString(),recordedAt:new Date().toISOString(),timezone:'UTC',businessDate:'2026-10-30',clockConfidence:'trusted',actorRef:owner.id,payload,payloadHash:hashPayload(payload),signature:''};
 entry.signature=sign('sha256',canonicalBytes(journalSigningPayload(entry)),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');expect((await ingestSignedBatch(scope,[entry])).entries[0].status).toBe('applied');
 await applyConfiguration(device,scope,{revision:1,coordinatorEpoch:1,receiptHash:hashPayload({operationId:entry.operationId,revision:1,payloadHash:originalHash})});expect((await readConfiguration(owner,scope)).status).toBe('applied');
});
import {generateKeyPairSync,sign} from 'node:crypto';
import {ingestSignedBatch,journalSigningPayload} from '../../apps/cloud-web/src/server/modules/sync/ingest';
import {canonicalBytes,hashPayload} from '../../packages/contracts/src/canonical';
import {signedConfiguration} from '../../apps/cloud-web/src/server/modules/configuration/publish';
test('offline config catch-up serves each revision in order and has an explicit caught-up response',async()=>{
 process.env.DEVICE_GRANT_PRIVATE_KEY=JSON.stringify(generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'}));
 const features=preset('cash-only').features;await publishConfiguration(owner,scope,{expectedRevision:1,features});await publishConfiguration(owner,scope,{expectedRevision:2,features});
 expect((await signedConfiguration(owner,scope,1)).revision).toBe(2);expect((await signedConfiguration(owner,scope,2)).revision).toBe(3);
 expect((await signedConfiguration(owner,scope,3)).publication).toBeNull();
});
