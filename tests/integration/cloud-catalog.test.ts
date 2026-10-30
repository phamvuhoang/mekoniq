import {beforeAll,afterAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {readCatalog,relayCatalogPublication} from '../../apps/cloud-web/src/server/modules/configuration/catalog';
import type {Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
let db:Awaited<ReturnType<typeof setupWave02>>;const scope={organizationId:'catalog-org-'+randomUUID(),venueId:'venue-a'};
const owner:Actor={id:'owner',organizationId:scope.organizationId,venueIds:[scope.venueId],permissions:['*'],role:'owner'};
const menu={version:1,currency:'VND',items:[{id:'rice',name:'Cơm',stationId:'kitchen',unitMinor:'50000',available:true}]};
beforeAll(async()=>{db=await setupWave02();await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Catalog venue')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},${scope.venueId},1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','coordinator','epoch-coordinator',1,'active')`;
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},'catalog','current',1,${db.admin.json(menu)},'catalog-fixture')`;
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},'station','kitchen',1,'{"name":"Bếp"}','station-fixture')`;
});afterAll(async()=>{if(db)await db.close();});
test('cloud menu publication persists intent and leaves current venue snapshot unchanged',async()=>{
 const input={operationId:'catalog-publish',version:2,currency:'VND',items:[{...menu.items[0],unitMinor:'60000'}]};
 const first=await relayCatalogPublication(owner,scope,input);expect(first.status).toBe('pending');expect((await relayCatalogPublication(owner,scope,input)).duplicate).toBe(true);
 const read=await readCatalog(owner,scope);expect(read.catalog.version).toBe(1);expect(read.catalog.items[0].unitMinor).toBe('50000');expect(read.pending[0].version).toBe(2);
});
test('catalog validates exact prices, known stations and scoped permissions',async()=>{
 const input={version:2,currency:'VND',items:[{...menu.items[0],unitMinor:'1.5'}]};
 await expect(relayCatalogPublication(owner,scope,input)).rejects.toThrow('INVALID_CATALOG_ITEM');
 await expect(relayCatalogPublication(owner,scope,{...input,items:[{...menu.items[0],stationId:'unknown'}]})).rejects.toThrow('INVALID_CATALOG_ITEM');
 const chef={...owner,permissions:['catalog.read','relay.write'],role:'chef'};await expect(relayCatalogPublication(chef,scope,{...input,items:menu.items})).rejects.toThrow('PERMISSION_DENIED');
});
import {readVenueLayout,relayVenueLayout} from '../../apps/cloud-web/src/server/modules/configuration/venue-layout';
test('fresh venue layout is a pending owner intent rather than fixture state',async()=>{
 const fresh=await readVenueLayout(owner,scope);expect(fresh.version).toBe(0);expect(fresh.tables).toHaveLength(0);
 const input={operationId:'layout-setup',expectedVersion:0,stations:[{id:'kitchen',name:'Bếp'}],tables:[{id:'table-1',name:'Bàn 01'}],simulatedRobots:[{id:'sim-1',trays:2,maxLoadMinor:'20000'}]};
 expect((await relayVenueLayout(owner,scope,input)).status).toBe('pending');expect((await readVenueLayout(owner,scope)).tables).toHaveLength(0);
 await expect(relayVenueLayout(owner,scope,{...input,simulatedRobots:[{...input.simulatedRobots[0],driver:'valetudo'}]})).rejects.toThrow('REAL_ROBOT_NOT_CONFIGURED');
});
