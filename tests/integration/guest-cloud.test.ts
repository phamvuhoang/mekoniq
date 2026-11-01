import {afterAll,beforeAll,expect,test} from 'vitest';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {testPublicJwk,testSigner} from '../support/storage-cases';
import {canonicalBytes} from '../../packages/contracts/src/index';
import type {JsonObject} from '../../packages/contracts/src/index';
import {encodeGuestToken,guestTokenCapability} from '../../packages/domain/src/service/guest-token';
import {guestMenu,guestMenuImage,guestSession,submitGuestCommand} from '../../apps/cloud-web/src/server/modules/guest/api';
import {pendingRelay,recordVenueReceipt} from '../../apps/cloud-web/src/server/modules/relay/commands';
import {dispatchRequest} from '../../apps/cloud-web/src/server/route-registry';
import {rolePermissions,type Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
let db:Awaited<ReturnType<typeof setupWave02>>;
const scope={organizationId:'guest-org-'+randomUUID(),venueId:'venue-a'};
const coordinator:Actor={id:'owner',organizationId:scope.organizationId,venueIds:[scope.venueId],permissions:['*'],role:'owner',deviceId:'coordinator',deviceEpoch:'epoch-c'};
function token(overrides:JsonObject={}) {
 const now=Date.now(),capability={schemaVersion:1,id:'guest-token-'+randomUUID(),...scope,sessionId:'s1',tableId:'table-1',revision:0,channel:'qr',issuerDeviceId:'coordinator',issuerDeviceEpoch:'epoch-c',issuerEpoch:1,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),expiresAtMs:now+3600000,...overrides};
 return encodeGuestToken({...capability,signature:testSigner(canonicalBytes(guestTokenCapability(capability)))});
}
const project=(kind:string,id:string,state:JsonObject)=>db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},${kind},${id},1,${db.admin.json(state)},${'entry-'+kind+id})`;
beforeAll(async()=>{
 db=await setupWave02();
 const signer=generateKeyPairSync('ec',{namedCurve:'P-256'});process.env.DEVICE_GRANT_PRIVATE_KEY=JSON.stringify(signer.privateKey.export({format:'jwk'}));
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Guest venue')`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','coordinator','epoch-c',1,'active')`;
 await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','epoch-c',${db.admin.json(testPublicJwk as JsonObject)},'active')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},${scope.venueId},1,1)`;
 await project('session','s1',{tableId:'table-1',status:'open',revision:0,orderIds:['o1']});
 await project('session','s2',{tableId:'table-2',status:'open',revision:0,orderIds:['o2']});
 await project('table','table-1',{name:'Bàn 01',activeSessionId:'s1'});
 await project('order','o1',{sessionId:'s1',status:'open',currency:'VND',totalMinor:'20000',lines:[{name:'Trà',quantity:'1',unitMinor:'20000'}]});
 await project('order','o2',{sessionId:'s2',status:'open',currency:'VND',totalMinor:'50000',lines:[{name:'Cơm',quantity:'1'}]});
 await project('service-call','c2',{sessionId:'s2',kind:'staff',status:'open'});
 await project('catalog','current',{version:1,currency:'VND',items:[{id:'tea',name:'Trà',stationId:'bar',unitMinor:'20000',available:true,imageManifestId:'map-asset'}],pricing:{discounts:[{id:'staff-50',kind:'percent'}]}});
 await db.admin`INSERT INTO asset_manifest(organization_id,venue_id,id,kind,object_path,expected_bytes,mime,expected_hash,status,created_by,expires_at) VALUES(${scope.organizationId},${scope.venueId},'map-asset','map',${scope.organizationId+'/venue-a/map-asset'},10,'application/json',${'a'.repeat(64)},'ready','owner',now()+interval '1 hour')`;
});
afterAll(async()=>{if(db)await db.close();});

test('a guest sees only its own seating, never other sessions or staff pricing data',async()=>{
 const view=await guestSession(token());
 expect(view).toMatchObject({session:'open',tableName:'Bàn 01',organizationId:scope.organizationId});
 expect(view.orders.map(o=>o.id)).toEqual(['o1']);expect(view.calls).toEqual([]);
 expect(JSON.stringify(view)).not.toContain('Cơm');
 const menu=await guestMenu(scope);
 expect(menu.items).toEqual([{id:'tea',name:'Trà',unitMinor:'20000',available:true,imageManifestId:'map-asset'}]);
 expect(JSON.stringify(menu)).not.toContain('staff-50');
 expect((await guestSession(token({revision:1}))).session).toBe('expired');
 expect((await guestSession(token({revision:1}))).orders).toEqual([]);
});

test('forged, kiosk-only and expired tokens are refused by the cloud before any relay',async()=>{
 const forged=JSON.parse(Buffer.from(token(),'base64url').toString());forged.sessionId='s2';
 await expect(guestSession(Buffer.from(JSON.stringify(forged)).toString('base64url'))).rejects.toThrow('GUEST_TOKEN_INVALID');
 await expect(guestSession(token({channel:'kiosk'}))).rejects.toThrow('GUEST_CHANNEL_MISMATCH');
 await expect(guestSession(token({expiresAtMs:Date.now()-1}))).rejects.toThrow('GUEST_TOKEN_EXPIRED');
 await expect(guestSession(token({issuerEpoch:2}))).rejects.toThrow('GUEST_TOKEN_INVALID');
 await expect(submitGuestCommand(token(),'Payment.RecordCash',{billId:'b'},'op-1')).rejects.toThrow('GUEST_COMMAND_FORBIDDEN');
});

test('guest commands relay with guest-only rights and stay pending until the venue receipt',async()=>{
 const t=token(),sent=await submitGuestCommand(t,'Order.Place',{items:[{itemId:'tea',quantity:'1'}],menuVersion:1,sessionId:'s2',tableId:'table-2',discountIds:['staff-50']},'client-op-1');
 expect(sent).toMatchObject({status:'pending',duplicate:false});
 expect((await submitGuestCommand(t,'Order.Place',{items:[{itemId:'tea',quantity:'1'}],menuVersion:1},'client-op-1')).duplicate).toBe(true);
 const [row]=await db.admin`SELECT command FROM relay_command WHERE organization_id=${scope.organizationId} AND operation_id=${sent.operationId}`;
 expect(row.command).toMatchObject({type:'Guest.PlaceOrder',deviceId:'cloud-guest'});expect(row.command.actorRef).toMatch(/^guest:guest-token-/);
 expect(Object.keys(row.command.payload).sort()).toEqual(['guestToken','items','menuVersion']);
 const relayed=(await pendingRelay(coordinator,scope)).find(q=>q.command.operationId===sent.operationId)!;
 expect(relayed.authorization.grant).toMatchObject({receiptOnly:false,permissions:rolePermissions('guest')});
 expect((await guestSession(t)).requests).toEqual([{operationId:sent.operationId,type:'Guest.PlaceOrder',status:'pending',code:null}]);
 await recordVenueReceipt(coordinator,scope,{coordinatorEpoch:1,result:{status:'rejected',code:'SESSION_EXPIRED',value:{},duplicate:false,ack:'venue',operationId:sent.operationId}});
 expect((await guestSession(t)).requests[0]).toMatchObject({status:'rejected',code:'SESSION_EXPIRED'});
 const later=await submitGuestCommand(t,'Guest.CallStaff',{},'client-op-2');
 await db.admin`UPDATE relay_command SET expires_at=now()-interval '1 second' WHERE organization_id=${scope.organizationId} AND operation_id=${later.operationId}`;
 expect((await guestSession(t)).requests.find(r=>r.operationId===later.operationId)?.status).toBe('unreachable');
});

test('guest HTTP routes need no staff session and never serve non-menu assets',async()=>{
 const post=(path:string,body:JsonObject)=>dispatchRequest(new Request('http://localhost'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
 const accepted=await post('/v1/guest/commands',{token:token(),type:'Guest.RequestBill',payload:{},operationId:'route-op-1'});
 expect(accepted.status).toBe(202);
 expect((await post('/v1/guest/commands',{token:token(),type:'Bill.Close',payload:{},operationId:'route-op-2'})).status).toBe(403);
 expect((await post('/v1/guest/session',{token:'garbage-token-value-xx'})).status).toBe(400);
 expect((await dispatchRequest(new Request(`http://localhost/v1/guest/menu/${scope.organizationId}/${scope.venueId}`))).status).toBe(200);
 await expect(guestMenuImage(scope,'map-asset')).rejects.toThrow('ASSET_NOT_FOUND');
 expect((await dispatchRequest(new Request(`http://localhost/v1/guest/menu/${scope.organizationId}/${scope.venueId}/images/map-asset`))).status).toBe(404);
});
