import {afterAll,beforeAll,expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {setupWave02} from '../support/wave02-db';
import {createSupabaseActor} from '../support/supabase-auth';
import {createRestaurantLab} from '../support/restaurant-lab';
import fixture from '../fixtures/restaurant-v1.json';
import type {JsonObject} from '../../packages/contracts/src/index';
import {dispatchRequest} from '../../apps/cloud-web/src/server/route-registry';
import {actorFromToken} from '../../apps/cloud-web/src/server/modules/identity/session';
import {rolePermissions} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import {createClient,submitAndResolve,deliveryCapableRobots,readyDeliveries,deliveryCommand,MekoniqError,type EventRecord} from '../../integrations/sdk/src/client';
import {signRequest,verifyRequest} from '../../integrations/sdk/src/webhook-verifier';
import {AUTOMATION_PENDING_LIMIT} from '../../apps/cloud-web/src/server/modules/automation/api';
// ---- the venue's own policy is the last word -----------------------------------------------------------------------
test('automation cannot bypass disabled delivery or access robot transport',async()=>{
 const lab=await createRestaurantLab();
 try{
  const features=(fixture.configuration as unknown as {features:Record<string,unknown>}).features;
  await lab.seed('configuration','applied',{...fixture.configuration,features:{...features,'robot.delivery':{status:'disabled',revision:2}}} as JsonObject);
  expect((await lab.command('integration','Mission.Create',{target:'table-1'})).code).toBe('FEATURE_DISABLED');
  expect((await dispatchRequest(new Request('http://x/internal/robot/publish',{method:'POST'}))).status).toBe(404);
  for(const type of ['Robot.RequestStop','Payment.RecordCash','Refund.Request','Configuration.Apply'])expect((await lab.command('integration',type,{})).code).toBe('FORBIDDEN');
 }finally{await lab.close();}
});
test('a replayed trigger produces one mission',async()=>{
 const lab=await createRestaurantLab();
 try{
  const payload={missionId:'delivery-s1',target:'table-1'};
  const first=await lab.command('integration','Mission.Create',payload,'delivery-s1'),again=await lab.command('integration','Mission.Create',payload,'delivery-s1');
  expect(first.status).toBe('accepted');expect(again.duplicate).toBe(true);
  const missions=(await (await lab.getStore('coordinator')).snapshots(lab.scope)).filter(s=>s.ref.kind==='mission');expect(missions).toHaveLength(1);
 }finally{await lab.close();}
});
// ---- cloud: scoped service account, real Supabase tokens -------------------------------------------------------------
let db:Awaited<ReturnType<typeof setupWave02>>,bot:Awaited<ReturnType<typeof createSupabaseActor>>;
const org='auto-org-'+randomUUID(),scope={organizationId:org,venueId:'venue-a'},otherOrg='auto-other-'+randomUUID();
const api=(token:string,method:string,path:string,body?:unknown)=>dispatchRequest(new Request('http://x'+path,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
beforeAll(async()=>{
 db=await setupWave02();bot=await createSupabaseActor(db.admin,scope,'integration');
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${org},'venue-a',1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${org},'venue-a','coordinator','coordinator','epoch-coordinator',1,'active')`;
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${otherOrg},'venue-x','Other tenant')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${otherOrg},'venue-x',1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${otherOrg},'venue-x','coordinator','coordinator','epoch-coordinator',1,'active')`;
 const put=(kind:string,id:string,state:JsonObject)=>db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${org},'venue-a',${kind},${id},1,${db.admin.json(state)},${'e-'+randomUUID()})`;
 await put('allocation','al-1',{status:'reserved',sessionId:'s1'});await put('allocation','al-2',{status:'reserved',sessionId:'s1'});await put('allocation','al-3',{status:'reserved',sessionId:'s2',missionId:'m-old'});
 await put('robot','sim-1',{trays:2,mapRevision:'map-7',driver:'simulator',status:'idle'});await put('robot','sim-stale',{trays:2,mapRevision:'map-3',driver:'simulator'});
 await put('bill','b-1',{status:'closed'});
});
afterAll(async()=>{if(bot)await bot.cleanup();if(db)await db.close();});
const mission=(operationId:string,over:JsonObject={})=>({type:'Mission.Create',operationId,payload:{missionId:operationId,kind:'delivery',allocationIds:['al-1','al-2'],...over}});
test('the service account sends an allowlisted command once, follows it with the same id, and reads only its own results',async()=>{
 const actor=await actorFromToken(bot.accessToken);expect(actor!.permissions.sort()).toEqual(rolePermissions('integration').sort());expect(actor!.permissions).not.toContain('*');
 const first=await api(bot.accessToken,'POST','/v1/automation/venues/venue-a/commands',mission('delivery-s1'));expect(first.status).toBe(202);
 const again=await api(bot.accessToken,'POST','/v1/automation/venues/venue-a/commands',mission('delivery-s1'));expect((await again.json()).duplicate).toBe(true);
 expect((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${org} AND operation_id='delivery-s1'`)[0].n).toBe(1);
 const [row]=await db.admin`SELECT command FROM relay_command WHERE organization_id=${org} AND operation_id='delivery-s1'`;expect(row.command).toMatchObject({type:'Mission.Create',actorRef:bot.id,deviceId:'cloud-web'});
 expect(await (await api(bot.accessToken,'GET','/v1/automation/venues/venue-a/commands/delivery-s1')).json()).toMatchObject({status:'pending',ack:'none'});
 await db.admin`UPDATE relay_command SET status='rejected',venue_receipt='{"status":"rejected","code":"FEATURE_DISABLED","ack":"venue"}' WHERE organization_id=${org} AND operation_id='delivery-s1'`;
 expect(await (await api(bot.accessToken,'GET','/v1/automation/venues/venue-a/commands/delivery-s1')).json()).toMatchObject({status:'rejected',code:'FEATURE_DISABLED',ack:'venue'});
 await db.admin`INSERT INTO relay_command(organization_id,venue_id,operation_id,payload_hash,command,coordinator_epoch,expires_at) VALUES(${org},'venue-a','someone-elses','h',${db.admin.json({type:'Mission.Create',actorRef:'another-user'})},1,now()+interval '1 minute')`;
 expect((await api(bot.accessToken,'GET','/v1/automation/venues/venue-a/commands/someone-elses')).status).toBe(404);
});
test('allowlist, tenant spoof, role limits and a disabled feature are refused before anything is queued',async()=>{
 const post=(body:unknown,venue='venue-a')=>api(bot.accessToken,'POST',`/v1/automation/venues/${venue}/commands`,body);
 for(const type of ['Payment.RecordCash','Robot.RequestStop','Configuration.Apply','Promotion.Publish'])expect((await post({type,operationId:'x-'+type.replace('.','-'),payload:{}})).status).toBe(400);
 expect((await post({type:'Mission.Create',payload:{}})).status).toBe(400); // operationId is required: no server-made ids
 expect((await post({type:'Mission.Create',operationId:'bad id!',payload:{}})).status).toBe(400);
 expect((await post(mission('spoof'),'venue-x')).status).toBe(403); // another tenant's venue, even though the body/path name it
 expect((await post({...mission('spoof2'),organizationId:otherOrg,venueId:'venue-x'})).status).toBe(202); // body fields are ignored: it went to OUR venue
 expect((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${otherOrg}`)[0].n).toBe(0);
 expect((await api(bot.accessToken,'GET','/v1/automation/venues/venue-a/events?kind=bill')).status).toBe(403); // not an automation kind
 await db.admin`INSERT INTO configuration_revision(organization_id,venue_id,revision,features,status,published_by) VALUES(${org},'venue-a',1,${db.admin.json({'robot.delivery':{status:'disabled',revision:1}})},'applied','t')`;
 const off=await post(mission('delivery-off'));expect(off.status).toBe(409);expect((await off.json()).code).toBe('FEATURE_DISABLED');
 expect((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${org} AND operation_id='delivery-off'`)[0].n).toBe(0);
 await db.admin`UPDATE configuration_revision SET features=${db.admin.json({'robot.delivery':{status:'enabled',revision:2}})} WHERE organization_id=${org}`;
 expect((await post(mission('delivery-on'))).status).toBe(202);
});
test('too many unanswered commands are rate limited, but re-sending an existing one is not counted',async()=>{
 const open=(await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${org} AND command->>'actorRef'=${bot.id} AND status IN('pending','unknown')`)[0].n;
 for(let i=open;i<AUTOMATION_PENDING_LIMIT;i++)expect((await api(bot.accessToken,'POST','/v1/automation/venues/venue-a/commands',mission('fill-'+i))).status).toBe(202);
 expect((await api(bot.accessToken,'POST','/v1/automation/venues/venue-a/commands',mission('one-too-many'))).status).toBe(429);
 expect((await api(bot.accessToken,'POST','/v1/automation/venues/venue-a/commands',mission('fill-'+open))).status).toBe(202);
});
test('a revoked token stops working at once',async()=>{
 const temp=await createSupabaseActor(db.admin,scope,'integration');
 try{
  expect((await api(temp.accessToken,'GET','/v1/automation/venues/venue-a/events?kind=robot')).status).toBe(200);
  await db.admin`UPDATE venue_membership SET active=false WHERE user_id=${temp.id}::uuid`;
  expect((await api(temp.accessToken,'GET','/v1/automation/venues/venue-a/events?kind=robot')).status).toBe(401);
 }finally{await temp.cleanup();}
});
// ---- the SDK against the real routes ----------------------------------------------------------------------------------
test('SDK: ready deliveries become one command each; capability check declines a stale map; pending is followed with the same id',async()=>{
 const client=createClient({baseUrl:'http://x',token:bot.accessToken,fetch:((url:string,init?:RequestInit)=>dispatchRequest(new Request(url,init))) as unknown as typeof fetch});
 const allocations=(await client.listEvents('venue-a','allocation')).records,robots=(await client.listEvents('venue-a','robot')).records;
 const groups=readyDeliveries(allocations);expect(groups).toEqual([{groupId:'s1',allocationIds:['al-1','al-2']}]); // al-3 already has a mission
 expect(deliveryCapableRobots(robots,'map-7').map(r=>r.id)).toEqual(['sim-1']);expect(deliveryCapableRobots(robots,'map-9')).toEqual([]); // stale map: leave it to staff
 await db.admin`UPDATE relay_command SET status='pending',venue_receipt=NULL WHERE organization_id=${org} AND operation_id='delivery-s1'`; // the venue has not answered yet
 const sleeps:number[]=[];
 const result=await submitAndResolve(client,deliveryCommand('venue-a',groups[0]!),{attempts:2,delayMs:5,sleep:async ms=>{sleeps.push(ms);if(sleeps.length===1)await db.admin`UPDATE relay_command SET status='accepted',venue_receipt='{"status":"accepted","ack":"venue"}' WHERE organization_id=${org} AND operation_id='delivery-s1'`;}});
 expect(result).toMatchObject({operationId:'delivery-s1',status:'accepted',ack:'venue'});expect(sleeps).toHaveLength(1);
 await expect(client.submitCommand({venueId:'venue-a',operationId:'p',type:'Payment.RecordCash',payload:{}})).rejects.toBeInstanceOf(MekoniqError);
 const noToken=createClient({baseUrl:'http://x',token:'forged',fetch:((url:string,init?:RequestInit)=>dispatchRequest(new Request(url,init))) as unknown as typeof fetch});
 await expect(noToken.listEvents('venue-a','robot')).rejects.toMatchObject({status:401});
});
test('SDK webhook helpers sign and verify the exact bytes',()=>{
 const raw='{"a": 1}',h=signRequest('ck_x','secret',raw,1700000000000);
 const headers=new Headers(h);expect(verifyRequest('secret',raw,headers,1700000000000)).toEqual({ok:true});
 expect(verifyRequest('secret','{"a":1}',headers,1700000000000)).toMatchObject({ok:false});
});
// ---- the example flow and the guide -------------------------------------------------------------------------------------
type FlowNode={id:string;type:string;func?:string;url?:string;wires?:string[][]};
const flows=JSON.parse(readFileSync('integrations/node-red/flows.json','utf8')) as FlowNode[];
test('the Node-RED example has no secrets and no database, MQTT or robot transport',()=>{
 const text=readFileSync('integrations/node-red/flows.json','utf8');
 expect(flows.filter(n=>/mqtt|postgres|mysql|tcp|udp|serial|websocket|exec|ros|valetudo/i.test(n.type))).toEqual([]);
 expect(text).not.toMatch(/Bearer [A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}/); // no literal token
 expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
 for(const n of flows.filter(x=>x.type==='http request'))expect(n.url).toBe(''); // every URL is built in code from the environment
 expect(flows.filter(n=>n.type==='function').every(n=>n.func!.includes("env.get('MEKONIQ_TOKEN')")||!/Authorization/.test(n.func!))).toBe(true);
});
function runFunction(name:string,msg:Record<string,unknown>,flowStore:Record<string,unknown>,envValues:Record<string,string>){
 const node=flows.find(n=>n.type==='function'&&(n as unknown as {name:string}).name===name)!;
 const sandbox={msg,flow:{get:(k:string)=>flowStore[k],set:(k:string,v:unknown)=>{flowStore[k]=v;}},env:{get:(k:string)=>envValues[k]},node:{error:()=>{},warn:()=>{}}};
 return runInNewContext(`(function(){${node.func}})()`,sandbox) as unknown;
}
const envValues={MEKONIQ_BASE_URL:'https://sandbox.example',MEKONIQ_VENUE_ID:'venue-a',MEKONIQ_TOKEN:'t',MEKONIQ_MAP_REVISION:'map-7'};
test('the example flow asks for one delivery per session with a stable id, and nothing without a capable robot',()=>{
 const records:EventRecord[]=[{id:'al-1',version:1,state:{status:'reserved',sessionId:'s1'}},{id:'al-2',version:1,state:{status:'reserved',sessionId:'s1'}},{id:'al-3',version:1,state:{status:'reserved',sessionId:'s2',missionId:'m'}}];
 const robotsOk=[{id:'sim-1',version:1,state:{trays:2,mapRevision:'map-7',driver:'simulator'}}];
 const run=(robots:unknown[])=>runFunction('capability check + group',{payload:{records}},{robots},envValues) as [{operationId:string;payload:{type:string;payload:{allocationIds:string[]}}}[],{payload:{reason:string}}[]];
 const [out,left]=run(robotsOk);expect(out).toHaveLength(1);expect(out[0]).toMatchObject({operationId:'delivery-s1',payload:{type:'Mission.Create',operationId:'delivery-s1',payload:{allocationIds:['al-1','al-2']}}});expect(left).toEqual([]);
 expect(run(robotsOk)[0][0]!.operationId).toBe(out[0]!.operationId); // a replayed poll is the same command
 const [none,staff]=run([{id:'old',version:1,state:{trays:2,mapRevision:'map-3',driver:'simulator'}}]);expect(none).toEqual([]);expect(staff[0]!.payload.reason).toBe('NO_CAPABLE_ROBOT');
 const pending=runFunction('pending? same operationId',{operationId:'delivery-s1',payload:{status:'pending'}},{},envValues) as [{method:string;url:string}|null,unknown];
 expect(pending[0]).toMatchObject({method:'GET'});expect(pending[0]!.url).toMatch(/\/commands\/delivery-s1$/);
});
test('the developer guide documents the limits the code enforces',()=>{
 const guide=readFileSync('docs/integrations/developer-guide.md','utf8');
 expect(guide).toContain(`at most ${AUTOMATION_PENDING_LIMIT} unanswered commands`);expect(guide).toMatch(/Evolution/);expect(guide).toMatch(/sandbox venue first/i);
 for(const p of ['/commands','/commands/:operationId','/events'])expect(guide).toContain(p);
 const routes=readFileSync('apps/cloud-web/src/server/modules/routes.ts','utf8'),client=readFileSync('integrations/sdk/src/client.ts','utf8');
 for(const piece of ["'/v1/automation/venues/:venueId/commands'","'/v1/automation/venues/:venueId/commands/:operationId'","'/v1/automation/venues/:venueId/events'"])expect(routes).toContain(piece);
 for(const piece of ['/commands`','/events?kind='])expect(client).toContain(piece); // client and routes name the same three endpoints
});
