import {beforeAll,afterAll,expect,test} from 'vitest';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {startCloud} from '../support/cloud-server';
import {createRestaurantLab} from '../support/restaurant-lab';
import {testSigner,testPublicJwk,command as makeCommand} from '../support/storage-cases';
import {canonicalBytes,hashPayload} from '../../packages/contracts/src/index';
import type {JsonObject,CommandEnvelope,JournalEntry} from '../../packages/contracts/src/index';
import {authorizeVenueCommand} from '../../packages/domain/src/application';
import type {VerifiedCloudAuthorization} from '../../apps/tablet-android/src/cloud-sync';
import {startCloudSync} from '../../apps/tablet-android/src/cloud-sync';
import {processCommand} from '../../packages/sync/src/command-processor';
let db:Awaited<ReturnType<typeof setupWave02>>,api:Awaited<ReturnType<typeof startCloud>>;
const cloudKeys=generateKeyPairSync('ec',{namedCurve:'P-256'});
beforeAll(async()=>{
 db=await setupWave02();process.env.DEVICE_GRANT_PRIVATE_KEY=JSON.stringify(cloudKeys.privateKey.export({format:'jwk'}));
 api=await startCloud({databaseUrl:process.env.DATABASE_URL!});
});
afterAll(async()=>{await api?.close();await db?.close();});
async function setup(){
 const lab=await createRestaurantLab(),scope=lab.scope;
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},${scope.venueId},'Native cloud sync')`;
 await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','epoch-1',${db.admin.json(testPublicJwk as Record<string,string>)},'active')`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},${scope.venueId},'coordinator','coordinator','epoch-1',1,'active')`;
 for(const initial of lab.initialSnapshots())await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},${scope.venueId},${initial.kind},${initial.id},${initial.version},${db.admin.json(initial.state)},'fixture-genesis')`;
 const requestAs=async(input:{method:'GET'|'POST';path:string;body?:JsonObject},deviceId='coordinator',deviceEpoch='epoch-1')=>{
  const body=input.body ?? {};
  const payload={...scope,deviceId,deviceEpoch,method:input.method,path:input.path,bodyHash:hashPayload(body),nonce:randomUUID(),issuedAt:new Date().toISOString()};
  const proof={payload,signature:testSigner(canonicalBytes(payload))};
  const response=await fetch(api.url+input.path,{method:input.method,headers:{'Content-Type':'application/json','x-mekoniq-device-proof':Buffer.from(JSON.stringify(proof)).toString('base64url')},body:input.method==='POST'?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json() as JsonObject};
 };
 const request=(input:{method:'GET'|'POST';path:string;body?:JsonObject})=>requestAs(input);
 const store=await lab.getStore('coordinator');
 const dispatch=async(command:CommandEnvelope,authorization:VerifiedCloudAuthorization)=>processCommand(store,command,(c,s)=>lab.registry.decide(c,s),async()=>authorizeVenueCommand({id:authorization.actorRef,deviceId:authorization.deviceId,scope,permissions:authorization.permissions,stationIds:authorization.stationIds,expiresAtMs:Date.parse(authorization.expiresAt)},command,Date.now()));
 return {lab,scope,store,request,requestAs,dispatch};
}
test('native cloud loop preserves pending journal after lost HTTP ACK then commits original entries once',async()=>{
 const f=await setup();let loop:ReturnType<typeof startCloudSync>|undefined;
 try{
  await f.lab.command('cashier','Session.Open',{sessionId:'native-cloud-session',tableId:'table-1'},'native-cloud-order');
  let lost=true;
  loop=startCloudSync({store:f.store,scope:f.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:false,cloudPublicJwk:cloudKeys.publicKey.export({format:'jwk'}),autostart:false,dispatchDelegated:f.dispatch,applyConfiguration:f.dispatch,request:async(input:{method:'GET'|'POST';path:string;body?:JsonObject})=>{
   const result=await f.request(input);if(lost&&input.path==='/v1/sync/push'&&result.status===200){lost=false;throw new Error('CLOUD_ACK_LOST');}return result;
  }});
  expect((await loop.tick()).status).toBe('unavailable');
  const committed=await db.admin`SELECT count(*)::int AS n FROM sync_inbox WHERE organization_id=${f.scope.organizationId}`;
  expect(committed[0].n).toBe(1);expect(await f.lab.pendingCount()).toBeGreaterThan(0);
  expect((await loop.tick()).status).toBe('synced');expect(await f.lab.pendingCount()).toBe(0);
  const entries=await db.admin`SELECT raw_entry FROM sync_inbox WHERE organization_id=${f.scope.organizationId}`;
  expect(entries).toHaveLength(1);expect(entries[0].raw_entry).toEqual((await f.store.journal(f.scope))[0]);
 }finally{await loop?.close();await f.lab.close();}
});
test('signed cloud configuration and relay commit through native coordinator and acknowledge only real receipts',async()=>{
 const f=await setup();let loop:ReturnType<typeof startCloudSync>|undefined,actor:Awaited<ReturnType<typeof import('../support/supabase-auth').createSupabaseActor>>|undefined;
 try{
  const {createSupabaseActor}=await import('../support/supabase-auth');actor=await createSupabaseActor(db.admin,f.scope,'owner');
  const config=await f.lab.state<JsonObject>('configuration','applied');
  const features=Object.fromEntries(Object.entries(config.features as JsonObject).map(([key,value])=>[key,{...(value as JsonObject),revision:2}]));
  await db.admin`INSERT INTO configuration_revision(organization_id,venue_id,revision,features,status,published_by) VALUES(${f.scope.organizationId},${f.scope.venueId},2,${db.admin.json(features)},'published',${actor.id})`;
  const relayPayload={sessionId:'signed-relay-session',tableId:'table-1'};
  const command=makeCommand('signed-relay-op',relayPayload,{...f.scope,type:'Session.Open',actorRef:actor.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1',policyRevision:2});
  const enqueue=await fetch(api.url+'/v1/relay/commands',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor.accessToken},body:JSON.stringify({command,expiresAt:new Date(Date.now()+60000).toISOString()})});
  expect(enqueue.status).toBe(202);
  loop=startCloudSync({store:f.store,scope:f.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:true,cloudPublicJwk:cloudKeys.publicKey.export({format:'jwk'}),autostart:false,dispatchDelegated:f.dispatch,applyConfiguration:f.dispatch,request:f.request});
  const pending=await loop.tick();expect(pending.errors).toContain('CLOUD_HTTP_503');
  expect((await f.lab.state<JsonObject>('configuration','applied')).revision).toBe(2);
  const report=await loop.tick();expect(report.errors).toEqual([]);expect(report.relayed).toBe(1);
  expect((await f.lab.state<JsonObject>('session','signed-relay-session')).status).toBe('open');
  const row=await db.admin`SELECT status,venue_receipt FROM relay_command WHERE organization_id=${f.scope.organizationId} AND operation_id='signed-relay-op'`;
  expect(row[0].status).toBe('accepted');expect(row[0].venue_receipt.ack).toBe('venue');
  expect((await db.admin`SELECT status FROM configuration_revision WHERE organization_id=${f.scope.organizationId}`)[0].status).toBe('applied');
 }finally{await loop?.close();await actor?.cleanup();await f.lab.close();}
});
test('configuration ACK lost before HTTP delivery remains durable and is retried without reapplying policy',async()=>{
 const f=await setup();let loop:ReturnType<typeof startCloudSync>|undefined;
 try{
  const config=await f.lab.state<JsonObject>('configuration','applied');
  const features=Object.fromEntries(Object.entries(config.features as JsonObject).map(([key,value])=>[key,{...(value as JsonObject),revision:2}]));
  await db.admin`INSERT INTO configuration_revision(organization_id,venue_id,revision,features,status,published_by) VALUES(${f.scope.organizationId},${f.scope.venueId},2,${db.admin.json(features)},'published','fixture-owner')`;
  let lost=true;
  loop=startCloudSync({store:f.store,scope:f.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:true,cloudPublicJwk:cloudKeys.publicKey.export({format:'jwk'}),autostart:false,dispatchDelegated:f.dispatch,applyConfiguration:f.dispatch,request:async(input:{method:'GET'|'POST';path:string;body?:JsonObject})=>{
   if(lost&&input.path.endsWith('/configuration/apply')){lost=false;throw new Error('CONFIGURATION_ACK_LOST');}return f.request(input);
  }});
  expect((await loop.tick()).errors).toContain('CONFIGURATION_ACK_LOST');
  expect((await f.lab.state<JsonObject>('configuration','applied')).revision).toBe(2);
  expect((await f.store.effects(f.scope,'cloud.configurationAck'))[0].status).toBe('unknown');
  expect((await loop.tick()).errors).toEqual([]);
  expect((await f.store.effects(f.scope,'cloud.configurationAck'))[0].status).toBe('confirmed');
  expect(await f.lab.count('ConfigurationApplied')).toBe(1);
  expect((await db.admin`SELECT status FROM configuration_revision WHERE organization_id=${f.scope.organizationId}`)[0].status).toBe('applied');
 }finally{await loop?.close();await f.lab.close();}
});
test('lost relay ACK followed by actor revocation reports the existing durable acceptance without new execution',async()=>{
 const f=await setup();let loop:ReturnType<typeof startCloudSync>|undefined,actor:Awaited<ReturnType<typeof import('../support/supabase-auth').createSupabaseActor>>|undefined;
 try{
  const {createSupabaseActor}=await import('../support/supabase-auth');actor=await createSupabaseActor(db.admin,f.scope,'owner');
  const command=makeCommand('relay-revoked-op',{sessionId:'already-accepted',tableId:'table-1'},{...f.scope,type:'Session.Open',actorRef:actor.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1'});
  const enqueue=await fetch(api.url+'/v1/relay/commands',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor.accessToken},body:JSON.stringify({command,expiresAt:new Date(Date.now()+60000).toISOString()})});expect(enqueue.status).toBe(202);
  let lost=true,dispatches=0;
  loop=startCloudSync({store:f.store,scope:f.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:true,cloudPublicJwk:cloudKeys.publicKey.export({format:'jwk'}),autostart:false,dispatchDelegated:async(c,a)=>{dispatches++;return f.dispatch(c,a);},request:async(input:{method:'GET'|'POST';path:string;body?:JsonObject})=>{
   if(lost&&input.path.endsWith('/relay/receipt')){lost=false;throw new Error('RELAY_ACK_LOST');}return f.request(input);
  }});
  expect((await loop.tick()).errors).toContain('RELAY_ACK_LOST');expect(await f.lab.count('SessionOpened')).toBe(1);
  await db.admin`UPDATE venue_membership SET active=false WHERE user_id=${actor.id}::uuid AND organization_id=${f.scope.organizationId}`;
  expect((await loop.tick()).errors).toEqual([]);expect(dispatches).toBe(1);expect(await f.lab.count('SessionOpened')).toBe(1);
  expect((await db.admin`SELECT status FROM relay_command WHERE organization_id=${f.scope.organizationId}`)[0].status).toBe('accepted');
 }finally{await loop?.close();await actor?.cleanup();await f.lab.close();}
});
test('relay delegation tampering is rejected before any live command dispatch',async()=>{
 const f=await setup();let loop:ReturnType<typeof startCloudSync>|undefined,actor:Awaited<ReturnType<typeof import('../support/supabase-auth').createSupabaseActor>>|undefined;
 try{
  const {createSupabaseActor}=await import('../support/supabase-auth');actor=await createSupabaseActor(db.admin,f.scope,'owner');
  const command=makeCommand('relay-forged-op',{sessionId:'never-opened',tableId:'table-1'},{...f.scope,type:'Session.Open',actorRef:actor.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1'});
  const enqueue=await fetch(api.url+'/v1/relay/commands',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor.accessToken},body:JSON.stringify({command,expiresAt:new Date(Date.now()+60000).toISOString()})});expect(enqueue.status).toBe(202);
  let dispatches=0;
  loop=startCloudSync({store:f.store,scope:f.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:true,cloudPublicJwk:cloudKeys.publicKey.export({format:'jwk'}),autostart:false,dispatchDelegated:async(c,a)=>{dispatches++;return f.dispatch(c,a);},request:async(input:{method:'GET'|'POST';path:string;body?:JsonObject})=>{
   const result=await f.request(input);
   if(input.path.endsWith('/relay/pull')){const rows=result.body.commands as JsonObject[];const grant=(rows[0].authorization as JsonObject).grant as JsonObject;grant.actorRef='forged-actor';}
   return result;
  }});
  expect((await loop.tick()).errors).toContain('CLOUD_SIGNATURE_INVALID');expect(dispatches).toBe(0);expect(await f.lab.count('SessionOpened')).toBe(0);
 }finally{await loop?.close();await actor?.cleanup();await f.lab.close();}
});
test('one bounded push batch sends at most one hundred original entries and leaves the remainder pending',async()=>{
 const f=await setup();let loop:ReturnType<typeof startCloudSync>|undefined;
 try{
  for(let n=0;n<105;n++)expect((await f.lab.command('cashier','Catalog.Quote',{items:[{itemId:'rice',quantity:'1'}]},'bounded-'+n)).status).toBe('accepted');
  loop=startCloudSync({store:f.store,scope:f.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:false,cloudPublicJwk:cloudKeys.publicKey.export({format:'jwk'}),autostart:false,maxBatches:1,dispatchDelegated:f.dispatch,request:f.request});
  const first=await loop.tick();expect(first.errors).toEqual([]);expect(first.pushed).toBe(100);expect(first.pendingJournal).toBe(5);
  expect((await loop.tick()).pushed).toBe(5);expect(await f.lab.pendingCount()).toBe(0);
 }finally{await loop?.close();await f.lab.close();}
});
test('fresh native authority revision one accepts the first signed configuration before any venue work',async()=>{
 const f=await setup();let loop:ReturnType<typeof startCloudSync>|undefined;
 try{
  const config=await f.lab.state<JsonObject>('configuration','applied');
  const {DatabaseSync}=await import('node:sqlite');
  const fixture=new DatabaseSync(f.lab.directory+'/coordinator.db');
  fixture.prepare("DELETE FROM aggregate_snapshot WHERE organization_id=? AND venue_id=? AND kind='configuration' AND id='applied'").run(f.scope.organizationId,f.scope.venueId);fixture.close();
  await db.admin`DELETE FROM sync_projection WHERE organization_id=${f.scope.organizationId} AND aggregate_type='configuration' AND aggregate_id='applied'`;
  await db.admin`INSERT INTO configuration_revision(organization_id,venue_id,revision,features,status,published_by) VALUES(${f.scope.organizationId},${f.scope.venueId},1,${db.admin.json(config.features as JsonObject)},'published','bootstrap-fixture')`;
  loop=startCloudSync({store:f.store,scope:f.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:true,cloudPublicJwk:cloudKeys.publicKey.export({format:'jwk'}),autostart:false,dispatchDelegated:f.dispatch,request:f.request});
  const first=await loop.tick();expect(first.errors).toContain('CLOUD_HTTP_503');
  const report=await loop.tick();expect(report.errors).toEqual([]);
  expect((await f.lab.state<JsonObject>('configuration','applied')).revision).toBe(1);expect(await f.lab.count('ConfigurationApplied')).toBe(1);
  expect((await db.admin`SELECT status FROM configuration_revision WHERE organization_id=${f.scope.organizationId}`)[0].status).toBe('applied');
 }finally{await loop?.close();await f.lab.close();}
});
test('relay for a future policy remains pending until sequential configuration catch-up reaches that revision',async()=>{
 const f=await setup();let loop:ReturnType<typeof startCloudSync>|undefined,actor:Awaited<ReturnType<typeof import('../support/supabase-auth').createSupabaseActor>>|undefined;
 try{
  const {createSupabaseActor}=await import('../support/supabase-auth');actor=await createSupabaseActor(db.admin,f.scope,'owner');
  const config=await f.lab.state<JsonObject>('configuration','applied');
  for(const revision of [2,3]){
   const features=Object.fromEntries(Object.entries(config.features as JsonObject).map(([key,value])=>[key,{...(value as JsonObject),revision}]));
   await db.admin`INSERT INTO configuration_revision(organization_id,venue_id,revision,features,status,published_by) VALUES(${f.scope.organizationId},${f.scope.venueId},${revision},${db.admin.json(features)},'published',${actor.id})`;
  }
  const command=makeCommand('future-policy-op',{sessionId:'future-policy-session',tableId:'table-1'},{...f.scope,type:'Session.Open',actorRef:actor.id,deviceId:'cloud-web',deviceEpoch:'cloud-web-v1',policyRevision:3});
  expect((await fetch(api.url+'/v1/relay/commands',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor.accessToken},body:JSON.stringify({command,expiresAt:new Date(Date.now()+60000).toISOString()})})).status).toBe(202);
  loop=startCloudSync({store:f.store,scope:f.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:true,cloudPublicJwk:cloudKeys.publicKey.export({format:'jwk'}),autostart:false,dispatchDelegated:f.dispatch,request:f.request});
  const first=await loop.tick();expect(first.errors).toContain('CLOUD_HTTP_503');expect(first.relayed).toBe(0);
  expect((await f.lab.state<JsonObject>('configuration','applied')).revision).toBe(2);
  expect((await db.admin`SELECT status FROM relay_command WHERE organization_id=${f.scope.organizationId}`)[0].status).toBe('pending');
  const second=await loop.tick();expect(second.errors).toContain('CLOUD_HTTP_503');expect(second.relayed).toBe(0);
  expect((await f.lab.state<JsonObject>('configuration','applied')).revision).toBe(3);
  const third=await loop.tick();expect(third.errors).toEqual([]);expect(third.relayed).toBe(1);
  expect(await f.lab.count('SessionOpened')).toBe(1);
 }finally{await loop?.close();await actor?.cleanup();await f.lab.close();}
});
test('peer intent and owner accepted fact preserve one operation lifecycle without quarantining the business fact',async()=>{
 const f=await setup();let loop:ReturnType<typeof startCloudSync>|undefined;
 try{
  await db.admin`INSERT INTO device_enrollment(organization_id,venue_id,device_id,device_epoch,public_jwk,status) VALUES(${f.scope.organizationId},${f.scope.venueId},'device-a','epoch-1',${db.admin.json(testPublicJwk as Record<string,string>)},'active')`;
  const payload={sessionId:'lifecycle-session',tableId:'table-1'},original=makeCommand('lifecycle-op',payload,{...f.scope,type:'Session.Open',actorRef:'cashier',deviceId:'device-a',deviceEpoch:'epoch-1'});
  const eventPayload={commandEnvelope:original as unknown as JsonObject};
  const entry:JournalEntry={schemaVersion:1,entryId:randomUUID(),operationId:'lifecycle-op',...f.scope,deviceId:'device-a',deviceEpoch:'epoch-1',sequence:'1',coordinatorEpoch:1,aggregateType:'command-intent',aggregateId:'lifecycle-op',expectedVersion:0,resultingVersion:1,kind:'intent',occurredAt:original.occurredAt,recordedAt:original.recordedAt,timezone:'UTC',businessDate:'2026-10-30',clockConfidence:'trusted',actorRef:'cashier',payload:eventPayload,payloadHash:hashPayload(eventPayload),signature:''};
  entry.signature=testSigner(canonicalBytes(Object.fromEntries(Object.entries(entry).filter(([key])=>key!=='signature'))));
  const intent=await f.requestAs({method:'POST',path:'/v1/sync/push',body:{entries:[entry as unknown as JsonObject]}},'device-a');
  expect(intent.status).toBe(200);expect(intent.body.receivedCursor).toBe('1');expect(intent.body.appliedCursor).toBe('0');
  expect((await f.lab.command('cashier','Session.Open',payload,'lifecycle-op')).status).toBe('accepted');
  loop=startCloudSync({store:f.store,scope:f.scope,deviceId:'coordinator',deviceEpoch:'epoch-1',isCoordinator:false,cloudPublicJwk:cloudKeys.publicKey.export({format:'jwk'}),autostart:false,dispatchDelegated:f.dispatch,request:f.request});
  expect((await loop.tick()).errors).toEqual([]);
  const rows=await db.admin`SELECT raw_entry,status FROM sync_inbox WHERE organization_id=${f.scope.organizationId} AND operation_id='lifecycle-op'`;
  expect(rows).toHaveLength(2);expect(rows.find(row=>row.raw_entry.kind==='intent')?.status).toBe('applied');expect(rows.find(row=>row.raw_entry.kind==='accepted_fact')?.status).toBe('applied');
  expect(await f.lab.count('SessionOpened')).toBe(1);
  const [peerMark]=await db.admin`SELECT applied_cursor::text FROM sync_watermark WHERE organization_id=${f.scope.organizationId} AND venue_id=${f.scope.venueId} AND device_id='device-a' AND device_epoch='epoch-1'`;expect(peerMark?.applied_cursor).toBe('1');
 }finally{await loop?.close();await f.lab.close();}
});
