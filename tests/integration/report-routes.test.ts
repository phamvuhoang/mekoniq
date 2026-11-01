import {afterAll,beforeAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {createSupabaseActor} from '../support/supabase-auth';
import {dispatchRequest} from '../../apps/cloud-web/src/server/route-registry';
import type {JsonObject} from '../../packages/contracts/src/index';
let db:Awaited<ReturnType<typeof setupWave02>>,manager:Awaited<ReturnType<typeof createSupabaseActor>>,cashier:Awaited<ReturnType<typeof createSupabaseActor>>;
const scope={organizationId:'report-org-'+randomUUID(),venueId:'venue-a'};
const project=(kind:string,id:string,state:JsonObject)=>db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},${kind},${id},1,${db.admin.json(state)},${'entry-'+kind+id})`;
let sequence=0;
const inbox=(status:string)=>{sequence++;return db.admin`INSERT INTO sync_inbox(organization_id,venue_id,device_id,device_epoch,producer_sequence,entry_id,operation_id,payload_hash,canonical_hash,aggregate_type,aggregate_id,resulting_version,raw_entry,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','epoch-c',${sequence},${'e-'+sequence},${'op-'+sequence},'h','h','bill','b1',1,${db.admin.json({kind:'accepted_fact'})},${status})`;};
const get=(path:string,token?:string)=>dispatchRequest(new Request('http://localhost'+path,{headers:token?{Authorization:`Bearer ${token}`}:{}}));
beforeAll(async()=>{
 db=await setupWave02();manager=await createSupabaseActor(db.admin,scope,'manager');cashier=await createSupabaseActor(db.admin,scope,'cashier');
 // Venue in Vietnam; the bill closed at 18:30 UTC on Oct 30 belongs to Oct 31 there.
 await project('venue-layout','current',{timezone:'Asia/Ho_Chi_Minh',stations:[],tables:[]});
 await project('bill','b1',{status:'closed',totalMinor:'50000',paidMinor:'50000',refundedMinor:'0',currency:'VND',orderIds:['o1'],summary:{subtotalMinor:'50000',discountMinor:'0',serviceMinor:'0',taxMinor:'0',taxIncludedMinor:'0',totalMinor:'50000'},closedAt:'2026-10-30T18:30:00.000Z'});
 await project('order','o1',{status:'closed',lines:[{itemId:'rice',name:'Cơm',quantity:'1'}]});
 await project('payment','p1',{billId:'b1',method:'cash',status:'captured',capturedMinor:'50000',appliedMinor:'50000',unappliedMinor:'0',tenderedMinor:'50000',changeMinor:'0',feeMinor:'0',occurredAt:'2026-10-30T18:29:00.000Z'});
 await project('refund','r1',{paymentId:'p1',billId:'b1',method:'cash',amountMinor:'1000',appliedMinor:'1000',unappliedMinor:'0',reason:'@SUM(A1)',occurredAt:'2026-10-30T18:40:00.000Z',recordedAt:'2026-10-30T18:40:00.000Z'});
});
afterAll(async()=>{await manager?.cleanup();await cashier?.cleanup();if(db)await db.close();});

test('reports need report.read in the venue: no session 401, cashier and another venue 403',async()=>{
 expect((await get(`/v1/reports/sales?venueId=venue-a&businessDate=2026-10-31`)).status).toBe(401);
 expect((await get(`/v1/reports/sales?venueId=venue-a&businessDate=2026-10-31`,cashier.accessToken)).status).toBe(403);
 expect((await get(`/v1/reports/sales?venueId=venue-b&businessDate=2026-10-31`,manager.accessToken)).status).toBe(403);
 expect((await get(`/v1/reports/payroll?venueId=venue-a&businessDate=2026-10-31`,manager.accessToken)).status).toBe(404);
 expect((await get(`/v1/reports/sales?venueId=venue-a&businessDate=31-10-2026`,manager.accessToken)).status).toBe(400);
});

test('a projection with no applied sync shows no figures; once applied the venue-date report reconciles and exports escaped CSV',async()=>{
 const unsynced=await (await get(`/v1/reports/sales?venueId=venue-a&businessDate=2026-10-31`,manager.accessToken)).json();
 expect(unsynced).toMatchObject({status:'unsynced',totals:null,netMinor:null,watermark:{source:'cloud-projection',appliedAt:null}});
 await inbox('applied');
 const response=await get(`/v1/reports/sales?venueId=venue-a&businessDate=2026-10-31`,manager.accessToken);
 expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
 const r=await response.json();
 expect(r).toMatchObject({status:'current',timeZone:'Asia/Ho_Chi_Minh',netMinor:'49000',totals:{salesTotalMinor:'50000',returnsMinor:'1000'},units:[{itemId:'rice',quantity:'1'}],reconciliation:{differenceMinor:'0'}});
 expect(r.watermark.appliedAt).toEqual(expect.any(String));
 // UTC date of the same facts is a different business day
 expect((await (await get(`/v1/reports/sales?venueId=venue-a&businessDate=2026-10-30`,manager.accessToken)).json()).netMinor).toBe('0');
 const csv=await get(`/v1/reports/sales?venueId=venue-a&businessDate=2026-10-31&format=csv`,manager.accessToken);
 expect(csv.headers.get('Content-Type')).toContain('text/csv');expect(csv.headers.get('Content-Disposition')).toBe('attachment; filename="sales-2026-10-31.csv"');
 const text=await csv.text();expect(text).toContain(`"'@SUM(A1)"`);expect(text).not.toMatch(/,@SUM/);
 // a backlog not yet applied marks the figures stale instead of silently current
 await inbox('pending');
 expect((await (await get(`/v1/reports/shifts?venueId=venue-a&businessDate=2026-10-31`,manager.accessToken)).json()).status).toBe('stale');
 expect((await (await get(`/v1/reports/robot-kpi?venueId=venue-a&businessDate=2026-10-31`,manager.accessToken)).json()).totals).toMatchObject({missions:0});
});
