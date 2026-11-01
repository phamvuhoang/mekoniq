import {test,expect} from '@playwright/test';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {startCloud} from '../support/cloud-server';
import {canonicalBytes} from '../../packages/contracts/src/canonical';
type JsonObject=Record<string,never>|Record<string,unknown>;
// The venue coordinator's enrolled key (fixture); the token is signed exactly as the coordinator store signs it at Guest.IssueToken.
const key=generateKeyPairSync('ec',{namedCurve:'P-256'}),testPublicJwk=key.publicKey.export({format:'jwk'}),testSigner=(bytes:Uint8Array)=>sign('sha256',bytes,{key:key.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
let db:Awaited<ReturnType<typeof setupWave02>>,api:Awaited<ReturnType<typeof startCloud>>;
const scope={organizationId:'guest-browser-'+randomUUID(),venueId:'venue-a'};
const project=(kind:string,id:string,state:JsonObject)=>db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},${kind},${id},1,${db.admin.json(state as never)},${'guest-browser-'+kind+id})`;
test.beforeAll(async()=>{
 db=await setupWave02();
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Guest browser venue')`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','coordinator','epoch-c',1,'active')`;
 await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','epoch-c',${db.admin.json(testPublicJwk as never)},'active')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},${scope.venueId},1,1)`;
 await project('session','s1',{tableId:'table-1',status:'open',revision:0,orderIds:[]});
 await project('table','table-1',{name:'Bàn 01',activeSessionId:'s1'});
 await project('catalog','current',{version:1,currency:'VND',items:[{id:'tea',name:'Trà',stationId:'bar',unitMinor:'20000',available:true}]});
 api=await startCloud({databaseUrl:process.env.DATABASE_URL!,port:0});
});
test.afterAll(async()=>{if(api)await api.close();if(db)await db.close();});
test('a QR guest order stays pending until the venue receipt and says so when the venue never answers',async({page})=>{
 const now=Date.now(),capability={schemaVersion:1,id:'guest-token-browser',...scope,sessionId:'s1',tableId:'table-1',revision:0,channel:'qr',issuerDeviceId:'coordinator',issuerDeviceEpoch:'epoch-c',issuerEpoch:1,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),expiresAtMs:now+3600000};
 // Same wire form as encodeGuestToken (the domain module pulls JSON-schema imports Playwright's loader cannot read).
 const token=Buffer.from(JSON.stringify({...capability,signature:testSigner(canonicalBytes(capability))})).toString('base64url');
 const landing=await page.goto(`${api.url}/table/${token}`);
 expect(landing?.headers()['referrer-policy']).toBe('no-referrer'); // the token in the URL never leaks via Referer
 await expect(page.getByRole('heading',{name:'Bàn 01'})).toBeVisible({timeout:20000});
 await page.getByRole('button',{name:'Thêm Trà / Add Trà'}).click();
 const sent=page.waitForResponse(r=>r.url().endsWith('/v1/guest/commands'));
 await page.getByRole('button',{name:'Gửi món / Send order'}).click();expect((await sent).status()).toBe(202);
 await expect(page.getByLabel('Yêu cầu đã gửi / Sent requests')).toContainText('Đang chờ nhà hàng xác nhận');
 const rows=await db.admin`SELECT command FROM relay_command WHERE organization_id=${scope.organizationId}`;
 expect(rows).toHaveLength(1);expect(rows[0].command).toMatchObject({type:'Guest.PlaceOrder',actorRef:'guest:guest-token-browser'});
 await db.admin`UPDATE relay_command SET expires_at=now()-interval '1 second' WHERE organization_id=${scope.organizationId}`;
 await expect(page.getByLabel('Yêu cầu đã gửi / Sent requests')).toContainText('Chưa rõ, nhân viên sẽ kiểm tra',{timeout:10000});
 await page.getByRole('button',{name:'Thêm Trà / Add Trà'}).click();
 await expect(page.getByRole('button',{name:'Gửi món / Send order'})).toBeDisabled();
 await expect(page.getByLabel('Yêu cầu đã gửi / Sent requests')).not.toContainText('did not receive');
 await page.screenshot({path:'.lab/guest-table.png',fullPage:true});
 await page.goto(`${api.url}/table/not-a-valid-token-value`);
 await expect(page.getByRole('status')).toContainText('Vui lòng gọi nhân viên');
});
