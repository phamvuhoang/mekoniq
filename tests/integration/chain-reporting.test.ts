import {afterAll,beforeAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {createRestaurantLab} from '../support/restaurant-lab';
import {rolePermissions,type Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import type {JsonObject} from '../../packages/contracts/src/index';
import {chainReport,chainReportCsv} from '../../apps/cloud-web/src/server/modules/chain/reports';
import {createSharedBalance,reserveSharedBalance,reconcileSharedBalance,readSharedBalance,remainingEscrow} from '../../apps/cloud-web/src/server/modules/chain/shared-entitlements';
type L={venueId:string;status:string;statusReason:string|null;pending:number;timeZone:string;timeZoneAssumed:boolean;totals:JsonObject|null};
type R={incompleteVenueIds:string[];complete:boolean;venues:L[];includedVenueIds:string[];totalsByCurrency:Record<string,Record<string,string>>;businessDateBasis:string};
let db:Awaited<ReturnType<typeof setupWave02>>;
const org='chain-rep-'+randomUUID(),date='2026-10-30';
const owner:Actor={id:'owner',organizationId:org,venueIds:['venue-a','venue-b','venue-c'],permissions:rolePermissions('owner'),role:'owner'};
async function venue(id:string,currency:string,sales:string|null){
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${org},${id},${id})`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${org},${id},1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${org},${id},'coordinator','coordinator','epoch-coordinator',1,'active')`;
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${org},${id},'catalog','current',1,${db.admin.json({version:1,currency,items:[]})},${'cat-'+id})`;
 if(sales===null)return; // this branch has never synced anything
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${org},${id},'bill','b1',1,${db.admin.json({status:'closed',closedAt:`${date}T05:00:00.000Z`,totalMinor:sales})},${'bill-'+id})`;
 await db.admin`INSERT INTO sync_inbox(organization_id,venue_id,device_id,device_epoch,producer_sequence,entry_id,operation_id,payload_hash,canonical_hash,aggregate_type,aggregate_id,resulting_version,raw_entry,status) VALUES(${org},${id},'d','e',1,${'in-'+id},${'op-'+id},'h','h','bill','b1',1,'{}','applied')`;
}
beforeAll(async()=>{db=await setupWave02();await venue('venue-a','VND','100000');await venue('venue-b','VND',null);await venue('venue-c','USD','500');});
afterAll(async()=>{if(db)await db.close();});
test('missing venue data remains visible instead of reporting zero sales',async()=>{
 const report=await chainReport(owner,org,'chain-sales',date) as unknown as R;
 expect(report.incompleteVenueIds).toContain('venue-b');expect(report.complete).toBe(false);
 const b=report.venues.find((v:L)=>v.venueId==='venue-b')!;expect(b.totals).toBeNull();expect(b.status).toBe('unsynced');
 expect(report.includedVenueIds).toEqual(['venue-a','venue-c']);
});
test('currencies are never added together and each branch states its own business-date zone',async()=>{
 const report=await chainReport(owner,org,'chain-sales',date) as unknown as R;
 expect(report.totalsByCurrency.VND.salesTotalMinor).toBe('100000');expect(report.totalsByCurrency.USD.salesTotalMinor).toBe('500');
 expect(report.businessDateBasis).toBe('venue-local');expect(report.venues[0].timeZone).toBe('UTC');expect(report.venues[0].timeZoneAssumed).toBe(true); // no venue layout synced: disclosed as assumed
});
test('a lagging branch (backlog) is flagged but its applied facts still count; a delayed import lands on its own business date',async()=>{
 await db.admin`INSERT INTO sync_inbox(organization_id,venue_id,device_id,device_epoch,producer_sequence,entry_id,operation_id,payload_hash,canonical_hash,aggregate_type,aggregate_id,resulting_version,raw_entry,status) VALUES(${org},'venue-a','d','e',2,'in-late','op-late','h','h','bill','b2',1,'{}','pending')`;
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${org},'venue-a','historical-receipt','r1',1,${db.admin.json({occurredAt:`${date}T03:00:00.000Z`,totalMinor:'40000',importedAt:'2026-11-02T00:00:00.000Z'})},'imp-1')`;
 const report=await chainReport(owner,org,'chain-sales',date) as unknown as R;
 const a=report.venues.find((v:L)=>v.venueId==='venue-a')!;
 expect(a.status).toBe('stale');expect(a.statusReason).toBe('backlog');expect(a.pending).toBe(1);expect(report.incompleteVenueIds).toContain('venue-a');
 expect(report.totalsByCurrency.VND.salesTotalMinor).toBe('140000'); // 100000 bill + 40000 imported receipt, imported once
 const other=await chainReport(owner,org,'chain-sales','2026-10-31') as unknown as R;expect(other.totalsByCurrency.VND.salesTotalMinor).toBe('0');
});
test('scope is never widened: a branch-limited actor sees only its own branch and is refused the others by name',async()=>{
 const branch:Actor={...owner,id:'mgr',venueIds:['venue-a'],permissions:rolePermissions('manager'),role:'manager'};
 const report=await chainReport(branch,org,'chain-sales',date) as unknown as R;
 expect(report.venues.map((v:L)=>v.venueId)).toEqual(['venue-a']);
 await expect(chainReport(branch,org,'chain-sales',date,['venue-a','venue-b'])).rejects.toThrow('SCOPE_DENIED');
 await expect(chainReport({...branch,permissions:rolePermissions('chef')},org,'chain-sales',date)).rejects.toThrow('PERMISSION_DENIED');
 await expect(chainReport(owner,org,'sales',date)).rejects.toThrow('REPORT_NOT_FOUND');
 await expect(chainReport(owner,org,'chain-sales','30/10/2026')).rejects.toThrow('INVALID_BUSINESS_DATE');
});
test('csv export carries the watermark and the completeness verdict',async()=>{
 const csv=chainReportCsv(await chainReport(owner,org,'chain-sales',date));
 expect(csv).toContain('# complete=false incomplete=');expect(csv.split('\n')[0]).toContain('as of ');
 expect(csv).toContain('venueId,status,statusReason,appliedAt,lagMs,pending,timeZone,currency');expect(csv).toMatch(/venue-b,unsynced,never-synced/);
});
// ---- shared pool -----------------------------------------------------------------------------------------------------
async function venueApplied(id:string,voucherId:string,slot:Record<string,number>){
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${org},${id},'voucher',${voucherId},1,${db.admin.json({scope:'shared',escrow:{[id]:slot}})},${'v-'+id+Math.random()}) ON CONFLICT(organization_id,venue_id,aggregate_type,aggregate_id) DO UPDATE SET state=EXCLUDED.state`;
}
test('shared pool: a grant is exact, once per operation, and venues together can never exceed the pool',async()=>{
 await createSharedBalance(owner,org,{balanceId:'pool',voucherId:'VS',total:10});
 const first=await reserveSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-a',count:6,operationId:'op-1'});
 expect(first).toMatchObject({duplicate:false,revision:1,relay:'pending'});
 const again=await reserveSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-a',count:6,operationId:'op-1'}); // caller timed out and retried
 expect(again.duplicate).toBe(true);expect((await readSharedBalance(owner,org,'pool')).available).toBe(4);
 await expect(reserveSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-c',count:5,operationId:'op-2'})).rejects.toThrow('SHARED_BALANCE_EXHAUSTED');
 await expect(reserveSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-c',count:1,operationId:'op-1'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 await reserveSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-c',count:4,operationId:'op-3'});
 const balance=await readSharedBalance(owner,org,'pool');expect(balance.available).toBe(0);expect(balance.grants.reduce((n,g)=>n+g.granted,0)).toBe(10);
 const relays=await db.admin`SELECT command->>'type' AS type,command->'payload' AS payload FROM relay_command WHERE organization_id=${org} AND command->>'type'='Voucher.ReceiveEscrow' ORDER BY created_at`;
 expect(relays).toHaveLength(2);expect(relays[0]!.payload).toMatchObject({voucherId:'VS',total:6,revision:1,limit:10});
});
test('reconcile: unconfirmed grants stay reserved, spent uses are final, returned uses go back exactly once',async()=>{
 const before=await reconcileSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-a'});
 expect(before).toMatchObject({issued:6,confirmedByVenue:0,unconfirmed:6,used:0,outstanding:'6'}); // branch has not acknowledged yet
 await venueApplied('venue-a','VS',{count:2,granted:6,revision:1}); // it received 6, spent 4 offline
 expect(await reconcileSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-a'})).toMatchObject({used:4,returned:0,outstanding:'2'});
 const ask=await reconcileSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-a',release:true});expect(ask.release).toBe('pending');
 const again=await reconcileSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-a',release:true});expect(again.release).toBeUndefined(); // the first return is unanswered: never doubled
 await venueApplied('venue-a','VS',{count:0,granted:6,revision:1,returned:2,returnRevision:1}); // the branch applied the return
 const done=await reconcileSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-a'});expect(done).toMatchObject({used:4,returned:2,outstanding:'0'});
 await reconcileSharedBalance(owner,org,{balanceId:'pool',venueId:'venue-a'}); // repeating must not credit twice
 expect((await readSharedBalance(owner,org,'pool')).available).toBe(2);
 expect(remainingEscrow('6','4','2')).toBe('0');
});
test('only the chain owner reserves; a branch manager cannot grant itself the pool',async()=>{
 const mgr:Actor={...owner,id:'mgr',venueIds:['venue-a'],permissions:rolePermissions('manager'),role:'manager'};
 await expect(reserveSharedBalance(mgr,org,{balanceId:'pool',venueId:'venue-a',count:1,operationId:'op-9'})).rejects.toThrow('PERMISSION_DENIED');
 await expect(reserveSharedBalance(owner,org,{balanceId:'nope',venueId:'venue-a',count:1,operationId:'op-9'})).rejects.toThrow('SHARED_BALANCE_NOT_FOUND');
});
test('a grant whose relay lapsed unanswered is delivered again under a new delivery id; a refused return is re-asked with what is still unspent',async()=>{
 await createSharedBalance(owner,org,{balanceId:'pool-r',voucherId:'VR',total:10});
 const first=await reserveSharedBalance(owner,org,{balanceId:'pool-r',venueId:'venue-b',count:10,operationId:'r-op-1'});expect(first.relay).toBe('pending');
 const sends=async(type:string)=>await db.admin`SELECT operation_id,status,command->'payload' AS payload FROM relay_command WHERE organization_id=${org} AND venue_id='venue-b' AND command->>'type'=${type} AND command->'payload'->>'voucherId'='VR' ORDER BY created_at`;
 expect(await sends('Voucher.ReceiveEscrow')).toHaveLength(1);
 const live=await reserveSharedBalance(owner,org,{balanceId:'pool-r',venueId:'venue-b',count:10,operationId:'r-op-1'});expect(live.duplicate).toBe(true);expect(await sends('Voucher.ReceiveEscrow')).toHaveLength(1); // still in flight: no second copy
 await db.admin`UPDATE relay_command SET expires_at=now()-interval '1 minute' WHERE organization_id=${org} AND venue_id='venue-b' AND command->'payload'->>'voucherId'='VR'`; // the branch stayed offline past the window
 await reserveSharedBalance(owner,org,{balanceId:'pool-r',venueId:'venue-b',count:10,operationId:'r-op-1'});
 const grants=await sends('Voucher.ReceiveEscrow');expect(grants).toHaveLength(2);expect(grants[1]!.payload).toMatchObject({total:10,revision:1}); // same cumulative grant, fresh delivery: the branch applies it once by revision
 await venueApplied('venue-b','VR',{count:10,granted:10,revision:1});
 expect((await reconcileSharedBalance(owner,org,{balanceId:'pool-r',venueId:'venue-b',release:true})).release).toBe('pending');
 await db.admin`UPDATE relay_command SET status='rejected',venue_receipt='{"status":"rejected","code":"ESCROW_INSUFFICIENT"}' WHERE organization_id=${org} AND venue_id='venue-b' AND command->>'type'='Voucher.ReturnEscrow' AND command->'payload'->>'voucherId'='VR'`; // a use was spent meanwhile
 await venueApplied('venue-b','VR',{count:9,granted:10,revision:1});
 expect((await reconcileSharedBalance(owner,org,{balanceId:'pool-r',venueId:'venue-b',release:true})).release).toBe('pending');
 const returns=await sends('Voucher.ReturnEscrow');expect(returns).toHaveLength(2);expect(returns[1]!.payload).toMatchObject({count:9,returnRevision:2});
});
test('reading a pool shows only branches the caller may read',async()=>{
 const onlyA:Actor={...owner,id:'only-a',venueIds:['venue-a']};
 await expect(readSharedBalance(onlyA,org,'pool-r')).rejects.toThrow('SCOPE_DENIED'); // pool-r has a grant at venue-b
 expect((await readSharedBalance(owner,org,'pool-r')).grants.map(g=>g.venueId)).toEqual(['venue-b']);
});
// ---- the venue side of the allocation ----------------------------------------------------------------------------------
test('venue: ReceiveEscrow is cumulative and idempotent; ReturnEscrow gives back only unspent uses; spending is limited to the slot',async()=>{
 const lab=await createRestaurantLab();
 try{
  type V={remaining:number;escrow:Record<string,{count:number;revision:number;granted:number;returned?:number}>};
  const recv=(total:number,revision:number,op:string)=>lab.command('cloud-web','Voucher.ReceiveEscrow',{voucherId:'VS',total,revision,limit:10},op);
  expect((await recv(6,1,'r1')).status).toBe('accepted');
  expect((await recv(6,1,'r1-again')).value.duplicate).toBe(true); // same revision: nothing added
  expect((await lab.state<V>('voucher','VS')).escrow['venue-a']!.count).toBe(6);
  expect((await recv(9,3,'r3')).status).toBe('accepted'); // revision 2 was lost; the cumulative total still lands exactly 3 more
  expect((await lab.state<V>('voucher','VS')).escrow['venue-a']).toMatchObject({count:9,granted:9,revision:3});
  expect((await recv(8,4,'r4')).code).toBe('ESCROW_TOTAL_REGRESSED');
  for(const bill of ['b1','b2'])expect((await lab.command('cashier','Voucher.Redeem',{voucherId:'VS',billId:bill})).status).toBe('accepted');
  expect((await lab.state<V>('voucher','VS')).escrow['venue-a']!.count).toBe(7);
  expect((await lab.command('cloud-web','Voucher.ReturnEscrow',{voucherId:'VS',count:8,returnRevision:1})).code).toBe('ESCROW_INSUFFICIENT');
  expect((await lab.command('cloud-web','Voucher.ReturnEscrow',{voucherId:'VS',count:7,returnRevision:1})).status).toBe('accepted');
  expect((await lab.command('cloud-web','Voucher.ReturnEscrow',{voucherId:'VS',count:7,returnRevision:1},'ret-again')).value.duplicate).toBe(true);
  expect((await lab.state<V>('voucher','VS')).escrow['venue-a']).toMatchObject({count:0,returned:7});
  expect((await lab.command('cashier','Voucher.Redeem',{voucherId:'VS',billId:'b3'})).code).toBe('SHARED_VOUCHER_OFFLINE_DENIED');
  expect((await lab.command('manager','Voucher.ReceiveEscrow',{voucherId:'VS',total:100000,revision:99})).code).toBe('CLOUD_SOURCE_REQUIRED'); // a branch manager cannot mint shared-pool uses on a tablet
  expect((await lab.command('cashier','Voucher.ReceiveEscrow',{voucherId:'VS',total:1,revision:9})).code).toBe('FORBIDDEN');
 }finally{await lab.close();}
});
