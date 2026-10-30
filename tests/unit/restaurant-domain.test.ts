import { test, expect } from 'vitest';
import { ModuleRegistry } from '../../packages/domain/src/modules';
import { registerRestaurantModules } from '../../packages/domain/src/restaurant';
import { hashPayload } from '../../packages/contracts/src/canonical';
import restaurantFixture from '../fixtures/restaurant-v1.json';
import type { CommandEnvelope, JsonObject, Snapshot } from '../../packages/contracts/src/index';
const registry = new ModuleRegistry(); registerRestaurantModules(registry);
const snap = (kind:string,id:string,state:JsonObject,version=1):Snapshot => ({ref:{organizationId:'org-a',venueId:'venue-a',kind,id},version,state});
const menu = snap('catalog','current',{version:1,currency:'VND',items:[{id:'rice',name:'Cơm',stationId:'kitchen',unitMinor:'50000',available:true}]});
function run(type:string,payload:JsonObject,snapshots:Snapshot[]=[],actorRef='cashier') {
 const command:CommandEnvelope={schemaVersion:1,organizationId:'org-a',venueId:'venue-a',operationId:'op-1',type,actorRef,deviceId:'device-a',deviceEpoch:'epoch-a',coordinatorEpoch:1,policyRevision:1,occurredAt:'2026-10-30T00:00:00Z',recordedAt:'2026-10-30T00:00:00Z',payload,payloadHash:hashPayload(payload)};
 return registry.decide(command,snapshots.some(x=>x.ref.kind==='configuration')?snapshots:[snap('configuration','applied',restaurantFixture.configuration),...snapshots]);
}
test('catalog quote uses authoritative price and quantity snapshot',()=>{
 const r=run('Catalog.Quote',{items:[{itemId:'rice',quantity:'2',price:'1'}]},[menu]);
 expect(r.ok).toBe(true); if(r.ok) expect(r.value.totalMinor).toBe('100000');
 expect(run('Catalog.Quote',{items:[{itemId:'rice',quantity:'0'}]},[menu])).toMatchObject({ok:false,code:'INVALID_QUANTITY'});
});
test('prepared bill blocks late stale order amendments',()=>{
 const order=snap('order','order-1',{status:'billed',version:2,billId:'bill-1',lines:[]},2);
 expect(run('Order.Amend',{orderId:'order-1',expectedVersion:2,items:[{itemId:'rice',quantity:'1'}]},[menu,order])).toMatchObject({ok:false,code:'ORDER_FROZEN'});
});
test('readiness cannot be allocated twice beyond available quantity',()=>{
 const portion=snap('fulfillment','line-1',{ready:'1',allocated:'1',served:'0',quantity:'1',version:1});
 expect(run('Fulfillment.Allocate',{lineId:'line-1',quantity:'1',expectedVersion:1},[portion])).toMatchObject({ok:false,code:'INSUFFICIENT_READY'});
});
test('loaded mission cancellation retains cargo until return/unload',()=>{
 const m=snap('mission','m-1',{status:'executing',loaded:true,source:'kitchen',currentStopId:'table-stop',revision:2,robotId:'sim-1',stops:[{id:'table-stop',action:'handoff',targetId:'table-1',status:'awaiting_action'}],allocationIds:[]},2);
 const r=run('Mission.Cancel',{missionId:'m-1',expectedVersion:2},[m]);
 expect(r.ok).toBe(true); if(r.ok) {
  const state=r.events.find(e=>e.data.kind==='mission')?.data.state as JsonObject;
  expect(state.loaded).toBe(true);
  expect((state.stops as JsonObject[]).some(s=>s.action==='return')).toBe(true);
  expect(r.events.some(e=>e.type==='DeliveryHandedOff')).toBe(false);
 }
});
test('customer payment claim is an observation and never money',()=>{
 const bill=snap('bill','bill-1',{status:'prepared',totalMinor:'100000',paidMinor:'0',version:1});
 const r=run('Payment.Claim',{billId:'bill-1',method:'transfer'},[bill],'guest');
 expect(r.ok).toBe(true); if(r.ok) expect(r.events.every(e=>e.data.kind!=='bill')).toBe(true);
 expect(run('Bill.Close',{billId:'bill-1',expectedVersion:1},[bill])).toMatchObject({ok:false,code:'BALANCE_DUE'});
});
test('new robot work is denied by the same applied feature policy as the API',()=>{
 const configuration=snap('configuration','applied',{revision:1,features:{'robot.delivery':{status:'disabled',revision:1}},readiness:{robot:true}});
 expect(run('Mission.Create',{stops:[{action:'standby',targetId:'table-1'}]},[configuration])).toMatchObject({ok:false,code:'FEATURE_DISABLED'});
});
