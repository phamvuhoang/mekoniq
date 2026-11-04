import {randomUUID} from 'node:crypto';
import {registerRigKind} from './provider-rig';
import {setupWave02} from './wave02-db';
import {rolePermissions,type Actor} from '../../apps/cloud-web/src/server/modules/identity/rbac';
import {bindMerchant,createPaymentIntent,paymentWebhookSecret,receivePaymentWebhook,setPaymentProviderResolver,resolvePaymentProvider,unappliedFunds,reconcilePaymentIntents} from '../../apps/cloud-web/src/server/modules/payments/provider';
import {createSimPaymentProvider} from '../../integrations/payments/src/sim-provider';
import type {ProviderState} from '../../integrations/payments/src/provider-adapter';
export interface PaymentRigApi {
  sim:ReturnType<typeof createSimPaymentProvider>;scope:{organizationId:string;venueId:string};owner:Actor;admin:Awaited<ReturnType<typeof setupWave02>>['admin'];
  newIntent(amountMinor?:string):Promise<string>;
  /** Programs the emulated provider from the fixture and delivers a correctly signed webhook for the current (or a new) intent. */
  deliverFixture(name:string,options?:{intentId?:string;eventId?:string}):Promise<{duplicate:boolean;outcome?:string}>;
  signedWebhook(intentId:string,eventId:string):{raw:string;headers:Headers};
  reconcile():ReturnType<typeof reconcilePaymentIntents>;
  settledCount():Promise<number>;unappliedFundsCount():Promise<number>;relayCount(type:string):Promise<number>;currentIntent():string|undefined;
}
declare module './provider-rig' { interface RigApis { payment:PaymentRigApi } }
/** Payment simulator rig. It exercises the REAL cloud payment module and Postgres against our EMULATED provider; nothing here is evidence about a real provider (rig.emulated is true). */
registerRigKind<PaymentRigApi>('payment',async base=>{
 process.env.INTEGRATION_RUNTIME='sandbox';process.env.CHANNEL_SECRET_MASTER??='m'.repeat(40);
 const db=await setupWave02(),scope={organizationId:'pay-org-'+randomUUID(),venueId:'venue-a'};
 const owner:Actor={id:'owner',organizationId:scope.organizationId,venueIds:[scope.venueId],permissions:rolePermissions('owner'),role:'owner'};
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},'venue-a','A')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},'venue-a',1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},'venue-a','coordinator','coordinator','epoch-coordinator',1,'active')`;
 await db.admin`INSERT INTO configuration_revision(organization_id,venue_id,revision,features,status,published_by) VALUES(${scope.organizationId},'venue-a',1,${db.admin.json({'payment.provider':{status:'enabled',revision:1}})},'applied','rig')`;
 await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},'venue-a','bill','bill-1',1,${db.admin.json({status:'prepared',totalMinor:'100000',paidMinor:'0',refundedMinor:'0',currency:'VND'})},'rig-bill')`;
 const sim=createSimPaymentProvider(base.profile),counted={...sim.provider,
  createIntent:(i:Parameters<typeof sim.provider.createIntent>[0])=>{base.calls.push({name:'createIntent',at:Date.now()});return sim.provider.createIntent(i);},
  query:(r:Parameters<typeof sim.provider.query>[0])=>{base.calls.push({name:'query',at:Date.now()});return sim.provider.query(r);},
  refund:(i:Parameters<NonNullable<typeof sim.provider.refund>>[0])=>{base.calls.push({name:'refund',at:Date.now()});return sim.provider.refund!(i);},
  queryRefund:(r:{refundId:string})=>{base.calls.push({name:'queryRefund',at:Date.now()});return sim.provider.queryRefund!(r);}};
 const previous=resolvePaymentProvider;setPaymentProviderResolver(()=>counted);
 await bindMerchant(owner,scope,{profileId:base.profile.id,merchantId:'merchant-1',bin:'970436',account:'0123456789'});
 let current:string|undefined,billCounter=0;
 const tag=randomUUID().slice(0,8); // provider event ids are unique per provider; fixtures reuse names across rigs, so each rig suffixes its own
 const secret=paymentWebhookSecret(base.profile);
 const rig:PaymentRigApi={sim,scope,owner,admin:db.admin,
  async newIntent(amountMinor='100000'){const bill=billCounter++?'bill-'+billCounter:'bill-1';
   if(bill!=='bill-1')await db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},'venue-a','bill',${bill},1,${db.admin.json({status:'prepared',totalMinor:'100000',paidMinor:'0',refundedMinor:'0',currency:'VND'})},${'rig-'+bill})`;
   const made=await createPaymentIntent(owner,scope,{billId:bill,amountMinor,profileId:base.profile.id});current=made.intentId;return made.intentId;},
  signedWebhook(intentId,eventId){return sim.webhook(secret,{eventId,reference:intentId,type:'payment.event'});},
  async deliverFixture(name,options={}){
   const fx=base.fixture('payment-'+name),body=fx.body as {intent:{amountMinor:string};provider:ProviderState;webhook:{eventId:string}};
   const intentId=options.intentId??current??await rig.newIntent(body.intent.amountMinor);current=intentId;
   sim.program(intentId,body.provider);
   const hook=rig.signedWebhook(intentId,(options.eventId??body.webhook.eventId)+'-'+tag);
   const r=await receivePaymentWebhook({profileId:base.profile.id,rawBody:hook.raw,headers:hook.headers});
   return {duplicate:r.duplicate,...('outcome' in r?{outcome:r.outcome}:{})};
  },
  reconcile:()=>reconcilePaymentIntents(scope),
  settledCount:async()=>Number((await db.admin`SELECT count(*)::int AS n FROM payment_intent WHERE organization_id=${scope.organizationId} AND status='captured'`)[0]!.n),
  unappliedFundsCount:async()=>(await unappliedFunds(owner,scope)).intents.length,
  relayCount:async type=>Number((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${scope.organizationId} AND command->>'type'=${type}`)[0]!.n),
  currentIntent:()=>current};
 return Object.assign(rig,{close:async()=>{setPaymentProviderResolver(previous);await db.close();}});
});
