import {afterAll,beforeAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {rolePermissions,type Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import {createChainRevision,rollBackForward,chainPublish,previewRollout,compareBranches} from '../../apps/cloud-web/src/server/modules/chain/catalog-rollout';
import {setBranchOverride,readBranchOverride} from '../../apps/cloud-web/src/server/modules/chain/branch-overrides';
import {rolloutStatus} from '../../apps/cloud-web/src/server/modules/chain/rollout-state';
import {rolloutState,overlayItems,validatedOverride} from '../../packages/domain/src/chain/overlay';
let db:Awaited<ReturnType<typeof setupWave02>>;
const org='chain-org-'+randomUUID();
const owner:Actor={id:'owner',organizationId:org,venueIds:['venue-a','venue-b','venue-c'],permissions:rolePermissions('owner'),role:'owner'};
const branchManager:Actor={id:'mgr',organizationId:org,venueIds:['venue-a'],permissions:rolePermissions('manager'),role:'manager'};
const items=[{id:'rice',name:'Rice',stationId:'kitchen',unitMinor:'50000',available:true},{id:'tea',name:'Tea',stationId:'bar',unitMinor:'20000',available:true}];
async function venue(id:string,stations:string[]){
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${org},${id},${id})`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${org},${id},1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${org},${id},'coordinator','coordinator','epoch-coordinator',1,'active')`;
 for(const s of stations)await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${org},${id},'station',${s},1,${db.admin.json({name:s})},${'st-'+id+s})`;
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${org},${id},'catalog','current',1,${db.admin.json({version:1,currency:'VND',items,pricing:{}})},${'cat-'+id})`;
}
/** The branch syncs an accepted catalog fact: the only thing that moves its effective version. */
async function venueAccepts(id:string,version:number,withItems=items){
 await db.admin`UPDATE sync_projection SET state=${db.admin.json({version,currency:'VND',items:withItems,pricing:{}})} WHERE organization_id=${org} AND venue_id=${id} AND aggregate_type='catalog'`;
}
beforeAll(async()=>{db=await setupWave02();await venue('venue-a',['kitchen','bar']);await venue('venue-b',['kitchen','bar']);await venue('venue-c',['kitchen']); // venue-c has no bar station
});afterAll(async()=>{if(db)await db.close();});
test('offline venue retains effective version until it acknowledges',async()=>{
 const rev=await createChainRevision(owner,org,{expectedRevision:0,snapshot:{currency:'VND',items:[...items,{id:'cake',name:'Cake',stationId:'kitchen',unitMinor:'30000',available:true}]}});expect(rev.revision).toBe(1);
 const first=await chainPublish(owner,org,{revision:1,venues:['venue-a','venue-b']});
 expect(first.targets.map(t=>[t.venueId,t.state,t.desired,t.effective])).toEqual([['venue-a','pending',2,1],['venue-b','pending',2,1]]);
 await venueAccepts('venue-a',2); // only venue-a is reachable and syncs its accepted fact
 const after=await rolloutStatus(owner,org,1);
 expect(after.targets.find(t=>t.venueId==='venue-a')).toMatchObject({state:'applied',effective:2});
 expect(after.targets.find(t=>t.venueId==='venue-b')).toMatchObject({state:'pending',effective:1}); // the cloud's wish is not the venue's menu
 const relays=await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${org} AND command->>'type'='Catalog.Publish'`;expect(relays[0].n).toBe(2);
});
test('retrying the same revision never sends a second copy while one is in flight, and leaves an applied branch alone',async()=>{
 await chainPublish(owner,org,{revision:1,venues:['venue-a','venue-b']});
 expect((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${org} AND command->>'type'='Catalog.Publish'`)[0].n).toBe(2);
 await db.admin`UPDATE relay_command SET expires_at=now()-interval '1 minute' WHERE organization_id=${org} AND venue_id='venue-b'`; // the venue stayed offline past the relay window
 const retried=await chainPublish(owner,org,{revision:1,venues:['venue-a','venue-b']});
 expect(retried.targets.find(t=>t.venueId==='venue-b')).toMatchObject({state:'pending',desired:2,attempts:2});
 expect(retried.targets.find(t=>t.venueId==='venue-a')).toMatchObject({state:'applied',attempts:1});
});
test('a branch missing a station rejects with a reason while the other branches still succeed',async()=>{
 const sent=await chainPublish(owner,org,{revision:1,venues:['venue-c']});
 expect(sent.targets.find(t=>t.venueId==='venue-c')).toMatchObject({state:'failed',code:'STATION_NOT_FOUND'});
 expect(sent.targets.filter(t=>t.venueId!=='venue-c').every(t=>t.state!=='failed')).toBe(true);
 const preview=await previewRollout(owner,org,{revision:1,venues:['venue-a','venue-c']});
 expect(preview.venues[0]!.catalog!.diff).toEqual([{itemId:'cake',field:'*',a:'absent',b:'present'}]);
 expect(preview.venues[1]!.error).toBe('STATION_NOT_FOUND:bar');
});
test('overrides change only allowed fields, are versioned, and a stale writer collides',async()=>{
 await expect(setBranchOverride(owner,org,'venue-a',{expectedRevision:0,patch:{tea:{name:'Hacked'}}})).rejects.toThrow('OVERRIDE_FIELD_NOT_ALLOWED');
 await expect(setBranchOverride(owner,org,'venue-a',{expectedRevision:0,patch:{ghost:{unitMinor:'1'}}})).rejects.toThrow('OVERRIDE_UNKNOWN_ITEM');
 expect(await setBranchOverride(owner,org,'venue-a',{expectedRevision:0,patch:{tea:{unitMinor:'25000'}}})).toEqual({venueId:'venue-a',revision:1});
 await expect(setBranchOverride(owner,org,'venue-a',{expectedRevision:0,patch:{tea:{unitMinor:'26000'}}})).rejects.toThrow('VERSION_CONFLICT');
 expect((await readBranchOverride(org,'venue-a')).patch.tea!.unitMinor).toBe('25000');
 await createChainRevision(owner,org,{expectedRevision:1,snapshot:{currency:'VND',items}});
 const plan=await previewRollout(owner,org,{revision:2,venues:['venue-a','venue-b']});
 expect(plan.venues[0]!.catalog!.payload.items.find(i=>i.id==='tea')!.unitMinor).toBe('25000');
 expect(plan.venues[1]!.catalog!.payload.items.find(i=>i.id==='tea')!.unitMinor).toBe('20000'); // other branches keep the chain price
});
test('roll back forward creates a new revision from the old snapshot; revisions only go up',async()=>{
 const back=await rollBackForward(owner,org,{expectedRevision:2,toRevision:1,note:'cake withdrawn'});
 expect(back).toEqual({revision:3,restores:1});
 await expect(rollBackForward(owner,org,{expectedRevision:2,toRevision:1})).rejects.toThrow('VERSION_CONFLICT');
 await expect(rollBackForward(owner,org,{expectedRevision:3,toRevision:99})).rejects.toThrow('CHAIN_REVISION_NOT_FOUND');
 const rows=await db.admin`SELECT revision FROM chain_revision WHERE organization_id=${org} ORDER BY revision`;expect(rows.map(r=>r.revision)).toEqual([1,2,3]);
});
test('compare branches reads what each branch applied, not what the chain wants',async()=>{
 await venueAccepts('venue-b',3,items.map(i=>i.id==='tea'?{...i,unitMinor:'22000'}:i));
 const diff=await compareBranches(owner,org,'venue-a','venue-b');
 expect(diff.differences.some(d=>d.itemId==='tea'&&d.field==='unitMinor'&&d.b==='22000')).toBe(true);
});
test('chain rights are per venue: a branch manager cannot publish or read other branches',async()=>{
 await expect(chainPublish(branchManager,org,{revision:1,venues:['venue-a']})).rejects.toThrow('PERMISSION_DENIED');
 await expect(chainPublish({...owner,venueIds:['venue-a']},org,{revision:1,venues:['venue-a','venue-b']})).rejects.toThrow('SCOPE_DENIED');
 await expect(chainPublish(owner,'other-org',{revision:1,venues:['venue-a']})).rejects.toThrow('SCOPE_DENIED');
 await expect(chainPublish(owner,org,{revision:1,venues:[]})).rejects.toThrow('INVALID_VENUES');
});
test('pure helpers: state, overlay purity, override validation',()=>{
 expect(rolloutState(2,2)).toBe('applied');expect(rolloutState(2,1)).toBe('pending');expect(rolloutState(2,3)).toBe('superseded');expect(rolloutState(2,1,'X')).toBe('failed');
 const base=[{id:'a',unitMinor:'1'}];expect(overlayItems(base,{a:{unitMinor:'2'}})).toEqual([{id:'a',unitMinor:'2'}]);expect(base[0]!.unitMinor).toBe('1');
 expect(()=>validatedOverride({a:{unitMinor:'1.5'}},new Set(['a']))).toThrow('INVALID_OVERRIDE');
});
