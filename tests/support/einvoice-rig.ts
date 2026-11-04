import {randomUUID} from 'node:crypto';
import {registerRigKind} from './provider-rig';
import {setupWave02} from './wave02-db';
import {collectInvoiceRequests,issueInvoice,reconcileInvoice,reconcileInvoices,setInvoiceProviderResolver,resolveInvoiceProvider} from '../../apps/cloud-web/src/server/modules/invoices/issuer';
import {createSimInvoiceProvider} from '../../integrations/einvoice/src/sim-provider';
import type {JsonObject} from '../../packages/contracts/src/index';
export interface EinvoiceRigApi {
  sim:ReturnType<typeof createSimInvoiceProvider>;scope:{organizationId:string;venueId:string};admin:Awaited<ReturnType<typeof setupWave02>>['admin'];
  fault(name:'issue-response-lost'|'issue-dropped'|'issue-rate-limit'|'query-fails'):Promise<void>;
  addBill(billId:string,over?:{totalMinor?:string;taxMinor?:string}):Promise<void>;
  /** the cloud picks up the venue's request for this bill (the rig plays the venue's `Invoice.Request`) and issues once */
  issue(billId:string):Promise<{status:string}>;reconcile(billId:string):Promise<{status:string}>;reconcileAll():ReturnType<typeof reconcileInvoices>;
  state(billId:string):Promise<{status:string;attempts:number;invoice_code:string|null;venue_status:string|null}>;relayCount(type:string):Promise<number>;
}
declare module './provider-rig' { interface RigApis { einvoice:EinvoiceRigApi } }
/** E-invoice simulator rig: the REAL cloud issuer and Postgres against our EMULATED provider (rig.emulated is true). */
registerRigKind<EinvoiceRigApi>('einvoice',async base=>{
 process.env.INTEGRATION_RUNTIME='sandbox';
 const db=await setupWave02(),scope={organizationId:'inv-org-'+randomUUID(),venueId:'venue-a'};
 await db.admin`INSERT INTO venue(organization_id,id,name) VALUES(${scope.organizationId},'venue-a','A')`;
 await db.admin`INSERT INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision) VALUES(${scope.organizationId},'venue-a',1,1)`;
 await db.admin`INSERT INTO venue_ownership(organization_id,venue_id,resource_id,owner_device_id,owner_device_epoch,epoch,status) VALUES(${scope.organizationId},'venue-a','coordinator','coordinator','epoch-coordinator',1,'active')`;
 const sim=createSimInvoiceProvider(base.profile),count=<A extends unknown[],R>(name:string,fn:(...a:A)=>Promise<R>)=>(...a:A)=>{base.calls.push({name,at:Date.now()});return fn(...a);};
 const counted={...sim.provider,issue:count('issue',sim.provider.issue),query:count('query',sim.provider.query),amend:count('amend',sim.provider.amend!),cancel:count('cancel',sim.provider.cancel!)};
 const previous=resolveInvoiceProvider;setInvoiceProviderResolver(()=>counted);
 const put=(kind:string,id:string,state:JsonObject)=>db.admin`INSERT INTO sync_projection(organization_id,venue_id,aggregate_type,aggregate_id,version,state,entry_id) VALUES(${scope.organizationId},'venue-a',${kind},${id},1,${db.admin.json(state)},${'rig-'+kind+id}) ON CONFLICT(organization_id,venue_id,aggregate_type,aggregate_id) DO NOTHING`;
 const rid=(billId:string)=>`inv-${billId}`;
 const rig:EinvoiceRigApi={sim,scope,admin:db.admin,
  async fault(name){const f=sim.faults;if(name==='issue-response-lost')f.issueResponseLostNext=1;else if(name==='issue-dropped')f.issueDropNext=1;else if(name==='issue-rate-limit')f.issueRateLimitNext=1;else f.queryFailNext=1;},
  async addBill(billId,over={}){
   const total=over.totalMinor??'110000',tax=over.taxMinor??'10000';
   await put('bill',billId,{status:'closed',currency:'VND',totalMinor:total,paidMinor:total,refundedMinor:'0',closedAt:new Date().toISOString(),summary:{subtotalMinor:String(BigInt(total)-BigInt(tax)),taxMinor:tax}});
   await put('invoice-request',rid(billId),{billId,status:'requested',buyer:{name:'Công ty ABC',taxCode:'0312345678'},currency:'VND',totalMinor:total,summary:{subtotalMinor:String(BigInt(total)-BigInt(tax)),taxMinor:tax}});
  },
  async issue(billId){const existing=await db.admin`SELECT 1 FROM sync_projection WHERE organization_id=${scope.organizationId} AND aggregate_type='bill' AND aggregate_id=${billId}`;if(!existing.length)await rig.addBill(billId);await collectInvoiceRequests(scope,base.profile.id);return issueInvoice(scope,rid(billId));},
  reconcile:billId=>reconcileInvoice(scope,rid(billId)),
  reconcileAll:()=>reconcileInvoices(scope),
  state:async billId=>(await db.admin`SELECT status,attempts,invoice_code,venue_status FROM invoice_request WHERE organization_id=${scope.organizationId} AND request_id=${rid(billId)}`)[0] as never,
  relayCount:async type=>Number((await db.admin`SELECT count(*)::int AS n FROM relay_command WHERE organization_id=${scope.organizationId} AND command->>'type'=${type}`)[0]!.n)};
 return Object.assign(rig,{close:async()=>{setInvoiceProviderResolver(previous);await db.close();}});
});
