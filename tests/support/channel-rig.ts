import {randomUUID} from 'node:crypto';
import {registerRigKind} from './provider-rig';
import {setupWave02} from './wave02-db';
import {rolePermissions,type Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import {issueChannelCredential} from '../../apps/cloud-web/src/server/modules/channels/credentials';
import {receiveExternalOrder,receiveChannelCancellation,externalOrderStatus} from '../../apps/cloud-web/src/server/modules/channels/ingress';
import {refreshFromVenue,sweepExternalOrder,refreshCancellation} from '../../apps/cloud-web/src/server/modules/channels/restaurant-ack';
import {runJobBatch} from '../../apps/cloud-web/src/server/jobs/outbox-worker';
import {defaultJobRegistry,resolveConnector,setConnectorResolver} from '../../apps/cloud-web/src/server/jobs/registry';
import {createSandboxChannel} from '../../integrations/core/src/sandbox';
import {KEY_HEADER,SIGNATURE_HEADER,TIMESTAMP_HEADER,signWebhook} from '../../integrations/core/src/webhook-signature';
import type {JsonObject} from '../../packages/contracts/src/index';
export interface ChannelRigApi {
  sim:ReturnType<typeof createSandboxChannel>;scope:{organizationId:string;venueId:string};admin:Awaited<ReturnType<typeof setupWave02>>['admin'];owner:Actor;
  /** From now on the venue never answers (no relay receipt, no synced decision). */
  partitionVenue():Promise<void>;venueDecides(externalId:string,state:JsonObject):Promise<void>;
  deliverFixture(name:string,over?:JsonObject):Promise<{externalId:string;status:number;body:JsonObject}>;
  signed(path:'order'|'cancel',body:JsonObject,tamper?:boolean):{raw:string;headers:Headers};
  cancel(externalId:string,reason?:string):Promise<JsonObject>;refresh(externalId:string):Promise<unknown>;sweep(externalId:string,nowMs:number):ReturnType<typeof sweepExternalOrder>;
  status(externalId:string):Promise<JsonObject>;cancelStatus(externalId:string):Promise<JsonObject>;
  runEffects():Promise<void>;forceEffect(externalId:string,kind:string):Promise<void>;relayCount(type:string):Promise<number>;
}
declare module './provider-rig' { interface RigApis { channel:ChannelRigApi } }
/** Channel rig: the REAL ingress / sweeper / effect jobs / Postgres against the sandbox channel emulator (rig.emulated is true). `callCount('confirmRestaurantAccepted')` counts calls that told the channel the restaurant accepted. */
registerRigKind<ChannelRigApi>('channel',async base=>{
 process.env.INTEGRATION_RUNTIME='sandbox';process.env.CHANNEL_SECRET_MASTER??='m'.repeat(40);
 const db=await setupWave02(),scope={organizationId:'chan-org-'+randomUUID(),venueId:'venue-a'},tag=randomUUID().slice(0,6);
 const owner:Actor={id:'owner',organizationId:scope.organizationId,venueIds:[scope.venueId],permissions:rolePermissions('owner'),role:'owner'};
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},'venue-a','A')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},'venue-a',1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},'venue-a','coordinator','coordinator','epoch-coordinator',1,'active')`;
 const credential=await issueChannelCredential(owner,scope,{provider:base.profile.id,merchantId:'shop-1'});
 const sim=createSandboxChannel(base.profile.id as 'sandbox-channel'),names:Record<string,string>={'order.accepted':'confirmRestaurantAccepted','order.rejected':'reportRejected','order.expired':'reportExpired'};
 const counted={...sim.connector,execute:(i:Parameters<typeof sim.connector.execute>[0])=>{base.calls.push({name:names[i.kind]??i.kind,at:Date.now()});return sim.connector.execute(i);}};
 const previous=resolveConnector;setConnectorResolver(()=>counted);
 const id=(e:string)=>`${e}-${tag}`,key=(e:string)=>({provider:base.profile.id,merchantId:'shop-1',externalId:id(e)});
 const sign=(raw:string,ts=Date.now())=>new Headers({[KEY_HEADER]:credential.keyId,[TIMESTAMP_HEADER]:String(ts),[SIGNATURE_HEADER]:signWebhook(credential.secret,ts,raw)});
 let partitioned=false;
 const deadlines=new Map<string,string>(); // a fixture holds no clock: each order gets a 1 h deadline once, so a replay of it is byte-identical
 const rig:ChannelRigApi={sim,scope,admin:db.admin,owner,
  async partitionVenue(){partitioned=true;},
  async venueDecides(externalId,state){if(partitioned)return;await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},'venue-a','external-order',${`ext:${base.profile.id}:shop-1:${id(externalId)}`},2,${db.admin.json(state)},${'e-'+randomUUID()}) ON CONFLICT(organization_id,venue_id,aggregate_type,aggregate_id) DO UPDATE SET state=EXCLUDED.state`;await refreshFromVenue(scope,key(externalId));},
  async deliverFixture(name,over={}){
   const fx=base.fixture('channel-'+name),externalId=String(over.externalId??fx.body.externalId),deadline=deadlines.get(externalId)??new Date(Date.now()+3600_000).toISOString(),raw=JSON.stringify({...fx.body,expiresAt:deadline,...over,externalId:id(externalId)});deadlines.set(externalId,String(over.expiresAt??deadline));
   const r=await receiveExternalOrder({provider:base.profile.id,rawBody:raw,headers:sign(raw)});return {externalId,status:r.status,body:r.body};
  },
  signed(path,body,tamper=false){const raw=JSON.stringify(body);return {raw:tamper?raw+' ':raw,headers:sign(raw)};},
  async cancel(externalId,reason='customer changed their mind'){const raw=JSON.stringify({merchantId:'shop-1',externalId:id(externalId),reason});return (await receiveChannelCancellation({provider:base.profile.id,rawBody:raw,headers:sign(raw)})).body;},
  refresh:externalId=>refreshFromVenue(scope,key(externalId)),
  sweep:(externalId,nowMs)=>sweepExternalOrder(scope,key(externalId),1,nowMs),
  status:externalId=>externalOrderStatus({provider:base.profile.id,merchantId:'shop-1',externalId:id(externalId),headers:sign('')}),
  cancelStatus:externalId=>refreshCancellation(scope,key(externalId)),
  async runEffects(){let t=Date.now();for(let i=0;i<4;i++){t+=3600_000;await runJobBatch(scope,defaultJobRegistry(),{now:()=>t});}},
  async forceEffect(externalId,kind){await db.admin`INSERT INTO cloud_job(organization_id,venue_id,id,type,payload) VALUES(${scope.organizationId},'venue-a',${'forced-'+externalId+kind},'channel.effect',${db.admin.json({provider:base.profile.id,merchantId:'shop-1',externalId:id(externalId),kind})})`;},
  relayCount:async type=>Number((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${scope.organizationId} AND command->>'type'=${type}`)[0]!.n)};
 return Object.assign(rig,{close:async()=>{setConnectorResolver(previous);await db.close();}});
});
