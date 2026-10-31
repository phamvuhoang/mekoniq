import { createLab } from './lab';
import { actors } from './actors';
import {requiredPermissions} from '../../packages/domain/src/application';
import { registerPolicyModule } from '../../packages/domain/src/policy/module';
import { registerContinuityModules } from '../../packages/domain/src/continuity/module';
import { registerRestaurantModules } from '../../packages/domain/src/restaurant';
import fixture from '../fixtures/restaurant-v1.json';
import {quoteOrder} from '../../packages/domain/src/pricing/quote';
import type { JsonObject, Snapshot } from '../../packages/contracts/src/index';
export async function createRestaurantLab() {
 const lab=await createLab(registry=>{registerRestaurantModules(registry);registerContinuityModules(registry);registerPolicyModule(registry);});
 lab.addAuthorization((actor,type,payload)=>{
  const principal=actors[actor],needed=requiredPermissions(type,payload);
  if(!principal||!needed.length) return false;
  if(actor==='chef'&&type.startsWith('Kitchen.')&&payload.stationId!=='kitchen') return false;
  return needed.every(permission=>principal.permissions.includes('*')||principal.permissions.includes(permission));
 });
 await lab.seed('configuration','applied',fixture.configuration as JsonObject);
 await lab.seed('catalog','current',fixture.menu as JsonObject);
 await lab.seed('catalog-version','1',fixture.menu as JsonObject);
 for(const station of fixture.stations) await lab.seed('station',station.id,station);
 for(const table of fixture.tables) await lab.seed('table',table.id,table);
 await lab.seed('robot',fixture.robot.id,fixture.robot as JsonObject);
 const seedAggregate=lab.seed.bind(lab);
 lab.seed=(kind,id,overrides)=>kind==='order-line'?seedOrderLine(lab,seedAggregate,id,overrides):kind==='payment'?seedPayment(lab,seedAggregate,id,overrides):seedAggregate(kind,id,overrides);
 return lab;
}

/**
 * Fixture factory behind lab.seed('order-line', lineId, {ordered,prepared,allocated,served,version,...}); plan §4 allows partial seeds that expand into the
 * aggregates the production handlers need. It writes one open session (on table-1) holding one order with this single priced line (quoted by the
 * production quoteOrder from the fixture menu), plus the line's kitchen-ticket and fulfillment. ordered -> line/ticket/fulfillment quantity;
 * prepared -> ticket.prepared; fulfillment.ready = prepared - served; allocated -> fulfillment.allocated (the allocation records themselves are not
 * created); `version` is the ORDER's version (the one Order.Amend expectedVersion targets), every other aggregate starts at version 1.
 * Optional: itemId (rice), tableId, sessionId, orderId, stationId, course. Counts must satisfy served + allocated <= prepared <= ordered.
 */
async function seedOrderLine(lab:Awaited<ReturnType<typeof createLab>>,seed:(kind:string,id:string,state:JsonObject)=>Promise<void>,lineId:string,o:JsonObject) {
 const n=(key:string,fallback:string)=>BigInt(String(o[key]??fallback)),ordered=n('ordered','1'),prepared=n('prepared','0'),allocated=n('allocated','0'),served=n('served','0');
 if(ordered<1n||prepared>ordered||served+allocated>prepared) throw new Error('INVALID_ORDER_LINE_FIXTURE');
 const itemId=String(o.itemId??'rice'),tableId=String(o.tableId??'table-1'),sessionId=String(o.sessionId??`session-${lineId}`),orderId=String(o.orderId??`order-${lineId}`);
 const menu={ref:{organizationId:lab.scope.organizationId,venueId:lab.scope.venueId,kind:'catalog',id:'current'},version:1,state:fixture.menu as JsonObject} as Snapshot;
 const quote=quoteOrder({menu,items:[{itemId,quantity:String(ordered)}],at:new Date(lab.clock.nowMs).toISOString(),timeZone:'UTC',policyRevision:1});
 const priced=quote.lines[0]!,course=typeof o.course==='number'?o.course:1;
 const line:JsonObject={...priced,id:lineId,orderId,sessionId,course};
 const stationId=String(priced.stationId),common={lineId,orderId,sessionId,stationId};
 await seed('table',tableId,{...(fixture.tables.find(t=>t.id===tableId)??{id:tableId,name:tableId}),activeSessionId:sessionId});
 await seed('session',sessionId,{tableId,status:'open',orderIds:[orderId],revision:0,openedBy:'fixture',version:1});
 await seed('order',orderId,{sessionId,tableId,menuVersion:1,currency:quote.currency,lines:[line],totalMinor:quote.totalMinor,summary:{subtotalMinor:quote.subtotalMinor,discountMinor:quote.discountMinor,serviceMinor:quote.serviceMinor,taxMinor:quote.taxMinor,taxIncludedMinor:quote.taxIncludedMinor,totalMinor:quote.totalMinor},status:'open',policyRevision:1,version:typeof o.version==='number'?o.version:1});
 await seed('kitchen-ticket',lineId,{...common,name:priced.name,quantity:String(ordered),prepared:String(prepared),course,status:course>1?'held':prepared===ordered?'ready':prepared>0n?'partially_ready':'queued',version:1});
 await seed('fulfillment',lineId,{...common,quantity:String(ordered),ready:String(prepared-served),allocated:String(allocated),served:String(served),status:'open',version:1});
}

/**
 * Fixture factory behind lab.seed('payment', id, overrides) (plan §4, ruling R-T03): a captured cash payment merged over defaults. Unless overrides name
 * a billId, it also writes its parents: a closed bill `bill-<id>` the payment fully settled and the cashier's open shift `shift-<id>` that took the cash.
 * `version` is the PAYMENT's version (the one Refund.Record expectedVersion targets).
 */
async function seedPayment(lab:Awaited<ReturnType<typeof createLab>>,seed:(kind:string,id:string,state:JsonObject)=>Promise<void>,id:string,o:JsonObject) {
 const captured=String(o.capturedMinor??'100000'),currency=String(o.currency??'VND'),shiftId=String(o.shiftId??`shift-${id}`),billId=String(o.billId??`bill-${id}`);
 if(o.billId===undefined) {
  await seed('bill',billId,{status:'closed',totalMinor:captured,paidMinor:captured,refundedMinor:'0',unappliedMinor:'0',currency,orderIds:[],lines:[],sessionId:null,closedAt:new Date(lab.clock.nowMs).toISOString(),version:3});
  await seed('shift',shiftId,{cashierId:'cashier',status:'open',currency,openingMinor:'0',cashMinor:captured,openedAt:new Date(lab.clock.nowMs).toISOString(),version:2});
  await seed('cashier-shift','cashier',{shiftId,status:'open',version:1});
 }
 await seed('payment',id,{billId,shiftId,currency,method:'cash',status:'captured',capturedMinor:captured,appliedMinor:captured,unappliedMinor:'0',tenderedMinor:captured,changeMinor:'0',refundedMinor:'0',feeMinor:'0',actorRef:'cashier',occurredAt:new Date(lab.clock.nowMs).toISOString(),...o,version:typeof o.version==='number'?o.version:1});
}
