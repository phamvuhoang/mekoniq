import {beforeAll,afterAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {relayVenueCommand,readVenueRecords} from '../../apps/cloud-web/src/server/modules/relay/venue-command';
import type {Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import {rolePermissions} from '../../apps/cloud-web/src/server/modules/identity/rbac';
let db:Awaited<ReturnType<typeof setupWave02>>;const scope={organizationId:'backoffice-org-'+randomUUID(),venueId:'venue-a'};
const actor=(role:string):Actor=>({id:role,organizationId:scope.organizationId,venueIds:[scope.venueId],permissions:rolePermissions(role),role});
beforeAll(async()=>{db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Backoffice venue')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},${scope.venueId},1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','coordinator','epoch-coordinator',1,'active')`;
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},'promotion','p1',1,'{"name":"10%"}','promo-fixture')`;
});afterAll(async()=>{if(db)await db.close();});
test('a manager relays an allowlisted back-office command as a pending intent; the cloud writes no domain state',async()=>{
 const input={type:'Promotion.Publish',operationId:'promo-1',payload:{promotionId:'p2',name:'5%',kind:'percent',valueBps:500}};
 const first=await relayVenueCommand(actor('manager'),scope,input);expect(first.status).toBe('pending');
 expect((await relayVenueCommand(actor('manager'),scope,input)).duplicate).toBe(true);
 const [row]=await db.admin`SELECT command FROM relay_command WHERE organization_id=${scope.organizationId} AND operation_id='promo-1'`;
 expect(row.command.type).toBe('Promotion.Publish');expect(row.command.deviceId).toBe('cloud-web');
 expect((await readVenueRecords(actor('manager'),scope,'promotion')).records.map(r=>r.id)).toEqual(['p1']); // p2 only exists once the venue accepts it
});
test('commands outside the allowlist, without the right permission, or for unreadable kinds are refused',async()=>{
 await expect(relayVenueCommand(actor('manager'),scope,{type:'Payment.RecordCash',payload:{}})).rejects.toThrow('COMMAND_NOT_RELAYABLE');
 await expect(relayVenueCommand(actor('cashier'),scope,{type:'Promotion.Publish',payload:{promotionId:'x',name:'x',kind:'percent',valueBps:1}})).rejects.toThrow('PERMISSION_DENIED');
 await expect(readVenueRecords(actor('cashier'),scope,'promotion')).rejects.toThrow('PERMISSION_DENIED');
 await expect(readVenueRecords(actor('manager'),scope,'payment')).rejects.toThrow('KIND_NOT_READABLE');
});
test('customer records are personal data: not readable by a cashier or by another organisation',async()=>{
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},'customer','c1',1,'{"name":"An","status":"active"}','customer-fixture')`;
 expect((await readVenueRecords(actor('manager'),scope,'customer')).records.map(r=>r.id)).toEqual(['c1']);
 await expect(readVenueRecords(actor('cashier'),scope,'customer')).rejects.toThrow('PERMISSION_DENIED');
 await expect(readVenueRecords({...actor('manager'),organizationId:'other-org'},scope,'customer')).rejects.toThrow('SCOPE_DENIED');
 const sent=await relayVenueCommand(actor('manager'),scope,{type:'Customer.Erase',operationId:'erase-1',payload:{customerId:'c1',reason:'yêu cầu của khách'}});expect(sent.status).toBe('pending');
});
