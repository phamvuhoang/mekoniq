import { expect, test } from 'vitest';
import { allocateMinor } from '../../packages/domain/src/shared/money';
import { quoteTaxExclusive, extractTaxInclusive } from '../../packages/domain/src/pricing/tax';
import { ModuleRegistry } from '../../packages/domain/src/modules';
import { registerRestaurantModules } from '../../packages/domain/src/restaurant';
import { hashPayload } from '../../packages/contracts/src/canonical';
import restaurantFixture from '../fixtures/restaurant-v1.json';
import type { CommandEnvelope, JsonObject, Snapshot } from '../../packages/contracts/src/index';

const registry = new ModuleRegistry(); registerRestaurantModules(registry);
const snap = (kind:string,id:string,state:JsonObject,version=1):Snapshot => ({ref:{organizationId:'org-a',venueId:'venue-a',kind,id},version,state});
const ctx = [snap('configuration','applied',restaurantFixture.configuration), ...restaurantFixture.stations.map(s=>snap('station',s.id,s))];
function run(type:string,payload:JsonObject,snapshots:Snapshot[],occurredAt='2026-10-30T05:00:00Z',recordedAt=occurredAt) {
 const command:CommandEnvelope={schemaVersion:1,organizationId:'org-a',venueId:'venue-a',operationId:'op-1',type,actorRef:'cashier',deviceId:'device-a',deviceEpoch:'epoch-a',coordinatorEpoch:1,policyRevision:1,occurredAt,recordedAt,payload,payloadHash:hashPayload(payload)};
 return registry.decide(command,[...ctx,...snapshots]);
}
const pricing = (extra:JsonObject={}):JsonObject => ({taxProfiles:[{id:'vat10',name:'VAT 10%',rateBps:1000,inclusive:false}],defaultTaxProfileId:'vat10',service:null,discountOrder:'before_tax',discounts:[],...extra});
const base = {version:3,currency:"VND"};
const rice = {id:'rice',name:'Cơm',stationId:'kitchen',unitMinor:'50000',available:true};
const tea = {id:'tea',name:'Trà',stationId:'bar',unitMinor:'20000',available:true};
const menuOf = (items:JsonObject[],p:JsonObject=pricing()) => snap('catalog','current',{...base,items,pricing:p});
const quote = (payload:JsonObject,menu:Snapshot,at?:string,more:Snapshot[]=[]) => { const r = run('Catalog.Quote',payload,[menu,...more],at); return r.ok ? r.value : r; };
const sum = (xs:string[]) => xs.map(BigInt).reduce((a,b)=>a+b,0n);

test('discount cents remain conserved across a three-way split', () => {
  const shares = allocateMinor('10001', [1n,1n,1n]);
  expect(shares.map(BigInt).reduce((a,b)=>a+b,0n)).toBe(10001n);
  expect(quoteTaxExclusive('100000',1000)).toBe('10000');
});
test('tax rounds half-up on positive amounts, rejects bad rates, extracts inclusive tax', () => {
  expect(quoteTaxExclusive('5',1000)).toBe('1');   // 0.5 -> 1
  expect(quoteTaxExclusive('4',1000)).toBe('0');   // 0.4 -> 0
  expect(quoteTaxExclusive('0',1000)).toBe('0');
  for (const bad of [-1,1.5,Number.NaN]) expect(() => quoteTaxExclusive('100',bad)).toThrow('INVALID_RATE');
  expect(extractTaxInclusive('110000',1000)).toBe('10000');
  expect(extractTaxInclusive('1',1000)).toBe('0');
});
test('exclusive tax adds on top, inclusive tax is already inside the price and both are itemised', () => {
  const ex = quote({items:[{itemId:'rice',quantity:'2'}]},menuOf([rice])) as JsonObject;
  expect(ex).toMatchObject({subtotalMinor:'100000',taxMinor:'10000',taxIncludedMinor:'0',totalMinor:'110000',menuVersion:3});
  const inc = quote({items:[{itemId:'rice',quantity:'2'}]},menuOf([rice],pricing({taxProfiles:[{id:'vat10',name:'VAT',rateBps:1000,inclusive:true}]}))) as JsonObject;
  expect(inc).toMatchObject({subtotalMinor:'100000',taxMinor:'0',taxIncludedMinor:'9091',totalMinor:'100000'});
  const line = (inc.lines as JsonObject[])[0]!;
  expect((line.charges as JsonObject[]).find(c=>c.kind==='tax')).toMatchObject({minor:'9091',effect:'included'});
  expect(line.pricing).toMatchObject({profileRevision:3,policyRevision:1,steps:['base','modifier','discount','service','tax'],tax:{id:'vat10',rateBps:1000,inclusive:true}});
});
test('service charge is taxed only when the profile says so; discount order is a profile setting', () => {
  const coupon = {id:'c10',name:'10%',kind:'percent',valueBps:1000};
  const before = quote({items:[{itemId:'rice',quantity:'1'}],discountIds:['c10']},menuOf([rice],pricing({service:{rateBps:500,taxable:true},discounts:[coupon]}))) as JsonObject;
  // 50000 - 5000 = 45000; service 2250; tax (45000 + 2250) * 10% = 4725
  expect(before).toMatchObject({subtotalMinor:'50000',discountMinor:'5000',serviceMinor:'2250',taxMinor:'4725',totalMinor:'51975'});
  const after = quote({items:[{itemId:'rice',quantity:'1'}],discountIds:['c10']},menuOf([rice],pricing({discountOrder:'after_tax',service:{rateBps:500,taxable:false},discounts:[coupon]}))) as JsonObject;
  // service 2500, tax 5000 on gross, discount subtracted last
  expect(after).toMatchObject({discountMinor:'5000',serviceMinor:'2500',taxMinor:'5000',totalMinor:'52500'});
  expect(((after.lines as JsonObject[])[0]!.pricing as JsonObject).steps).toEqual(['base','modifier','service','tax','discount']);
});
test('modifiers: min/max, zero-price options, size price and sold-out options', () => {
  const sizes = {id:'size',name:'Size',kind:'size',min:1,max:1,options:[{id:'s',name:'S',priceMinor:'40000'},{id:'l',name:'L',priceMinor:'60000'}]};
  const toppings = {id:'top',name:'Topping',kind:'addon',min:0,max:2,options:[{id:'egg',name:'Egg',priceMinor:'7000'},{id:'none',name:'Plain',priceMinor:'0'},{id:'cheese',name:'Cheese',priceMinor:'5000'},{id:'ham',name:'Ham',priceMinor:'9000',available:false}]};
  const menu = menuOf([{...rice,modifierGroups:[sizes,toppings]}],pricing({taxProfiles:[],defaultTaxProfileId:null}));
  const q = (modifiers:JsonObject[],quantity='2') => quote({items:[{itemId:'rice',quantity,modifiers}]},menu) as JsonObject;
  expect(q([{groupId:'size',optionId:'l'},{groupId:'top',optionId:'egg'},{groupId:'top',optionId:'none'}])).toMatchObject({subtotalMinor:'134000',totalMinor:'134000'});
  const line = (q([{groupId:'size',optionId:'s'},{groupId:'top',optionId:'none'}]).lines as JsonObject[])[0]!;
  expect(line).toMatchObject({unitMinor:'40000',totalMinor:'80000'});
  expect(line.modifiers).toEqual([{groupId:'size',optionId:'s',name:'S',priceMinor:'40000',kind:'size'},{groupId:'top',optionId:'none',name:'Plain',priceMinor:'0',kind:'addon'}]);
  expect((line.charges as JsonObject[]).filter(c=>c.kind==='modifier').map(c=>c.minor)).toEqual(['0']);
  expect(q([])).toMatchObject({ok:false,code:'MODIFIER_SELECTION_INVALID'});
  expect(q([{groupId:'size',optionId:'s'},{groupId:'size',optionId:'l'}])).toMatchObject({code:'MODIFIER_SELECTION_INVALID'});
  expect(q([{groupId:'size',optionId:'s'},{groupId:'top',optionId:'egg'},{groupId:'top',optionId:'none'},{groupId:'top',optionId:'cheese'}])).toMatchObject({code:'MODIFIER_SELECTION_INVALID'});
  expect(q([{groupId:'size',optionId:'s'},{groupId:'top',optionId:'ham'}])).toMatchObject({code:'MODIFIER_SOLD_OUT'});
  expect(q([{groupId:'size',optionId:'s'},{groupId:'top',optionId:'egg'},{groupId:'top',optionId:'egg'}])).toMatchObject({code:'DUPLICATE_MODIFIER'});
  expect(q([{groupId:'size',optionId:'s'},{groupId:'nope',optionId:'x'}])).toMatchObject({code:'MODIFIER_GROUP_NOT_FOUND'});
  expect(q([{groupId:'size',optionId:'zzz'}])).toMatchObject({code:'MODIFIER_NOT_FOUND'});
});
test('currency mismatch between cart and menu rejects, matching currency passes', () => {
  expect(quote({currency:'USD',items:[{itemId:'rice',quantity:'1'}]},menuOf([rice]))).toMatchObject({ok:false,code:'CURRENCY_MISMATCH'});
  expect(quote({currency:'VND',items:[{itemId:'rice',quantity:'1'}]},menuOf([rice]))).toMatchObject({currency:'VND'});
});
test('repeated and stacked coupons allocate exactly and never exceed the line; duplicates are rejected', () => {
  const discounts: JsonObject[] = [{id:'fix',name:'-10001',kind:'fixed',amountMinor:'10001'},{id:'pct',name:'7%',kind:'percent',valueBps:700},{id:'tea-only',name:'tea -100000',kind:'fixed',amountMinor:'100000',itemIds:['tea']},{id:'big',name:'big',kind:'fixed',amountMinor:'999999999'}];
  const menu = menuOf([rice,tea],pricing({taxProfiles:[],defaultTaxProfileId:null,discounts}));
  const items = [{itemId:'rice',quantity:'1'},{itemId:'tea',quantity:'1'},{itemId:'tea',quantity:'1'}];
  const q = quote({items,discountIds:['fix','pct']},menu) as JsonObject;
  const lines = q.lines as JsonObject[];
  const discountCharges = lines.map(l=>(l.charges as JsonObject[]).filter(c=>c.kind==='discount').map(c=>c.minor as string));
  expect(sum(discountCharges.flat())).toBe(10001n + ((90000n-10001n)*700n+5000n)/10000n);
  expect(sum(discountCharges[0]!)).toBe(BigInt(lines[0]!.discountMinor as string));
  expect(sum(lines.map(l=>l.totalMinor as string))).toBe(BigInt(q.totalMinor as string));
  expect(q.totalMinor).toBe(String(90000n-BigInt(q.discountMinor as string)));
  expect(quote({items,discountIds:['fix','pct']},menu)).toEqual(q); // repeating is deterministic
  expect(quote({items,discountIds:['fix','fix']},menu)).toMatchObject({code:'DUPLICATE_DISCOUNT'});
  expect(quote({items,discountIds:['ghost']},menu)).toMatchObject({code:'DISCOUNT_NOT_FOUND'});
  expect(quote({items:[{itemId:'rice',quantity:'1'}],discountIds:['tea-only']},menu)).toMatchObject({code:'DISCOUNT_NOT_APPLICABLE'});
  const capped = quote({items,discountIds:['big','fix']},menu) as JsonObject; // fully discounted: the second coupon has nothing left
  expect(capped).toMatchObject({totalMinor:'0',discountMinor:'90000'});
});
test('availability windows use the venue timezone and the command time, across midnight', () => {
  const night = {...rice,availability:{windows:[{days:[5],from:'22:00',to:'02:00'}]}}; // Friday 22:00 -> Saturday 02:00 local
  const menu = menuOf([night]), vn = snap('venue-layout','current',{timezone:'Asia/Ho_Chi_Minh'}), la = snap('venue-layout','current',{timezone:'America/Los_Angeles'});
  const q = (at:string,layout:Snapshot) => quote({items:[{itemId:'rice',quantity:'1'}]},menu,at,[layout]);
  expect(q('2026-10-30T15:30:00Z',vn)).toMatchObject({menuVersion:3});   // Fri 22:30 VN
  expect(q('2026-10-30T17:30:00Z',vn)).toMatchObject({menuVersion:3});                                       // Sat 00:30 VN, still Friday's window
  expect(q('2026-10-30T19:30:00Z',vn)).toMatchObject({code:'ITEM_UNAVAILABLE_NOW'});                          // Sat 02:30 VN
  expect(q('2026-10-30T14:59:00Z',vn)).toMatchObject({code:'ITEM_UNAVAILABLE_NOW'});                          // Fri 21:59 VN
  expect(q('2026-10-31T06:00:00Z',la)).toMatchObject({menuVersion:3});                                           // Fri 23:00 PDT
  expect(q('2026-10-31T04:59:00Z',la)).toMatchObject({code:'ITEM_UNAVAILABLE_NOW'});                          // Fri 21:59 PDT
});
test('availability decisions come from the command timestamp, not the wall clock or recordedAt', () => {
  const menu = menuOf([{...rice,availability:{windows:[{days:[1,2,3,4,5,6,7],from:'10:00',to:'11:00'}]}}]);
  const payload = {items:[{itemId:'rice',quantity:'1'}]};
  expect(run('Catalog.Quote',payload,[menu],'2026-10-30T10:30:00Z','2026-10-30T23:00:00Z').ok).toBe(true);
  expect(run('Catalog.Quote',payload,[menu],'2026-10-30T23:00:00Z','2026-10-30T10:30:00Z')).toMatchObject({ok:false,code:'ITEM_UNAVAILABLE_NOW'});
});
test('publish validates tax/service/modifier/availability data and keeps it in the immutable version', () => {
  const old = snap('catalog','current',{...base,version:1,items:[rice]});
  const publish = (payload:JsonObject) => run('Catalog.Publish',{version:2,currency:'VND',items:[rice],...payload},[old]);
  expect(publish({pricing:pricing()}).ok).toBe(true);
  expect(publish({pricing:pricing({taxProfiles:[{id:'x',name:'x',rateBps:-1,inclusive:false}]})})).toMatchObject({code:'INVALID_PRICING_PROFILE'});
  expect(publish({pricing:pricing({service:{rateBps:500,taxable:true},taxProfiles:[{id:'vat10',name:'v',rateBps:1000,inclusive:true}]})})).toMatchObject({code:'INVALID_PRICING_PROFILE'});
  expect(publish({pricing:pricing({defaultTaxProfileId:'ghost'})})).toMatchObject({code:'INVALID_PRICING_PROFILE'});
  expect(publish({items:[{...rice,taxProfileId:'ghost'}],pricing:pricing()})).toMatchObject({code:'TAX_PROFILE_NOT_FOUND'});
  expect(publish({items:[{...rice,modifierGroups:[{id:'g',name:'g',min:2,max:1,options:[{id:'a',name:'a',priceMinor:'0'}]}]}]})).toMatchObject({code:'INVALID_MODIFIER_GROUP'});
  expect(publish({items:[{...rice,availability:{windows:[{from:'25:00',to:'02:00'}]}}]})).toMatchObject({code:'INVALID_AVAILABILITY'});
  const carried = run('Catalog.Publish',{version:2,prices:{rice:'60000'}},[snap('catalog','current',{...base,version:1,items:[{...rice,taxProfileId:'vat10'}],pricing:pricing()})]);
  expect(carried.ok && (carried.events.find(e=>e.data.kind==='catalog-version')!.data.state as JsonObject)).toMatchObject({pricing:{defaultTaxProfileId:'vat10'},items:[{taxProfileId:'vat10',unitMinor:'60000'}]});
});
const open = [snap('session','s1',{tableId:'table-1',status:'open',orderIds:[]}),snap('table','table-1',{activeSessionId:'s1'})];
test('order lines and the prepared bill carry immutable, exactly apportionable charge lines; a stale cart is an explicit re-confirm', () => {
  const sizes = {id:'size',name:'Size',kind:'size',min:1,max:1,options:[{id:'l',name:'L',priceMinor:'60001'}]};
  const menu = menuOf([{...rice,modifierGroups:[sizes]}],pricing({service:{rateBps:500,taxable:true},discounts:[{id:'c',name:'c',kind:'fixed',amountMinor:'10001'}]}));
  const payload = {sessionId:'s1',tableId:'table-1',menuVersion:3,discountIds:['c'],items:[{itemId:'rice',quantity:'3',modifiers:[{groupId:'size',optionId:'l'}]}]};
  const placed = run('Order.Place',payload,[menu,...open]);
  expect(placed.ok).toBe(true); if(!placed.ok) return;
  const order = placed.events.find(e=>e.data.kind==='order')!.data.state as JsonObject;
  const line = (order.lines as JsonObject[])[0]!;
  expect(line.pricing).toMatchObject({profileRevision:3,policyRevision:1});
  const charges = line.charges as JsonObject[];
  const signed = (cs:JsonObject[]) => cs.reduce((a,c)=>a+(c.effect==='subtract'?-1n:c.effect==='add'?1n:0n)*BigInt(c.minor as string),0n);
  expect(signed(charges)).toBe(BigInt(line.totalMinor as string));
  expect(order.totalMinor).toBe(line.totalMinor);
  // a split into three can apportion every charge exactly
  for (const c of charges) expect(sum(allocateMinor(c.minor as string,[1n,1n,1n]))).toBe(BigInt(c.minor as string));
  // the menu moves on; the order keeps its own snapshot and a stale cart must re-confirm
  const newer = snap('catalog','current',{...menu.state,version:4,items:[{...rice,unitMinor:'1'}]});
  expect(run('Order.Place',payload,[newer,...open])).toMatchObject({ok:false,code:'STALE_QUOTE'});
  expect(run('Catalog.Quote',{...payload,menuVersion:3},[newer])).toMatchObject({ok:false,code:'STALE_QUOTE'});
  const orderSnap = snap('order','o1',order);
  expect((orderSnap.state.lines as JsonObject[])[0]!.totalMinor).toBe(line.totalMinor);
  const billed = run('Bill.Prepare',{sessionId:'s1',billId:'b1'},[snap('session','s1',{tableId:'table-1',status:'open',orderIds:['o1']}),orderSnap]);
  expect(billed.ok).toBe(true); if(!billed.ok) return;
  const bill = billed.events.find(e=>e.data.kind==='bill')!.data.state as JsonObject;
  expect(bill.lines).toEqual(order.lines);
  expect(bill.summary).toMatchObject({totalMinor:bill.totalMinor,discountMinor:'10001'});
  expect(bill.pricingRevisions).toEqual([{menuVersion:3,policyRevision:1}]);
});
test('Order.Place rejects a foreign currency and Order.Amend appends priced lines to the order summary', () => {
  const menu = menuOf([rice]);
  const items = [{itemId:'rice',quantity:'1'}];
  expect(run('Order.Place',{sessionId:'s1',tableId:'table-1',menuVersion:3,currency:'USD',items},[menu,...open])).toMatchObject({ok:false,code:'CURRENCY_MISMATCH'});
  const placed = run('Order.Place',{sessionId:'s1',tableId:'table-1',menuVersion:3,items},[menu,...open]);
  expect(placed.ok).toBe(true); if(!placed.ok) return;
  const order = snap('order','o1',placed.events.find(e=>e.data.kind==='order')!.data.state as JsonObject);
  const amended = run('Order.Amend',{orderId:'o1',expectedVersion:1,menuVersion:3,items:[{itemId:'rice',quantity:'2'}]},[menu,order,snap('session','s1',{tableId:'table-1',status:'open',orderIds:['o1']})]);
  expect(amended.ok).toBe(true); if(!amended.ok) return;
  const next = amended.events.find(e=>e.data.kind==='order')!.data.state as JsonObject;
  expect(next).toMatchObject({totalMinor:'165000',summary:{subtotalMinor:'150000',taxMinor:'15000',totalMinor:'165000'}});
  expect(next.lines as JsonObject[]).toHaveLength(2);
});
