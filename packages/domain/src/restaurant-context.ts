import type { CommandEnvelope, Decision, DomainEvent, Handler, JsonObject, JsonValue, Snapshot } from '../../contracts/src/index';
import { hashPayload } from '../../contracts/src/canonical';
import { stateEvent, type ModuleRegistry } from './modules';
import { canonicalMinor } from './shared/money';
import { evaluateFeature } from './policy/evaluate';
import type { FeatureConfig } from './policy/registry';
import {reserveDecisionMovement} from './fleet/reservations';
import {runtimeReadiness} from './policy/readiness';
export class DomainFault extends Error {}
export const fail = (code: string): never => { throw new DomainFault(code); };
export const text = (value: JsonValue | undefined, code = 'INVALID_ID'): string => typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : fail(code);
export const amount = (value: JsonValue | undefined, positive = false): string => {
  const result = text(value, 'INVALID_AMOUNT');
  try { canonicalMinor(result); } catch { return fail('INVALID_AMOUNT'); }
  if (BigInt(result) < 0n || (positive && BigInt(result) === 0n)) return fail('INVALID_AMOUNT');
  return result;
};
export const quantity = (value: JsonValue | undefined): string => typeof value === 'string' && /^[1-9][0-9]{0,29}$/.test(value) ? value : fail('INVALID_QUANTITY');
export const record = (value: JsonValue | undefined): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : fail('INVALID_OBJECT');
export const records = (value: JsonValue | undefined): JsonObject[] => Array.isArray(value) && value.length > 0 && value.length <= 100 ? value.map(record) : fail('INVALID_ITEMS');
export const all = (snapshots: Snapshot[], kind: string): Snapshot[] => snapshots.filter(s => s.ref.kind === kind);
export const find = (snapshots: Snapshot[], kind: string, id: string): Snapshot | undefined => snapshots.find(s => s.ref.kind === kind && s.ref.id === id);
export const requireState = (snapshots: Snapshot[], kind: string, id: string): Snapshot => find(snapshots, kind, id) ?? fail('NOT_FOUND');
export const stableId = (prefix: string, command: CommandEnvelope, suffix = ''): string => `${prefix}-${hashPayload({operationId:command.operationId,suffix}).slice(0,32)}`;
/** External payment reference {provider,merchantId,transactionId}; its id is unique per scope, so one transaction is one payment aggregate. */
/** Human-entered justification (reason, evidence reference): trimmed, never blank. */
export const note = (value: JsonValue | undefined, code: string): string => text(typeof value === 'string' ? value.trim() : value, code);
/**
 * External payment reference {provider,merchantId,transactionId}, normalized before it becomes an id: references are typed by hand, so
 * " VCB" / "vcb" and "ft 123" / "FT123" must be the same transaction. provider/merchantId: trimmed, inner whitespace collapsed, lower-cased.
 * transactionId: all whitespace removed, upper-cased (a false match only blocks a second entry visibly; a missed match would collect twice).
 */
export const externalReference = (value: JsonValue | undefined): JsonObject => {
  const r = value === undefined ? fail('REFERENCE_REQUIRED') : record(value), field = (v: JsonValue | undefined, fold: (s: string) => string) => text(typeof v === 'string' ? fold(v) : v, 'REFERENCE_REQUIRED');
  const party = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return { provider: field(r.provider, party), merchantId: field(r.merchantId, party), transactionId: field(r.transactionId, s => s.replace(/\s+/g, '').toUpperCase()) };
};
export const externalPaymentId = (ref: JsonObject): string => `ext-${hashPayload({ provider: ref.provider!, merchantId: ref.merchantId!, transactionId: ref.transactionId! }).slice(0, 32)}`;
export const updated = (snapshot: Snapshot, change: JsonObject): JsonObject => ({ ...snapshot.state, ...change, version: snapshot.version + 1 });
export const changed = (type:string,snapshot:Snapshot,change:JsonObject):DomainEvent => stateEvent(type,snapshot.ref.kind,snapshot.ref.id,updated(snapshot,change));
export const created = (type:string,kind:string,id:string,state:JsonObject):DomainEvent => stateEvent(type,kind,id,{...state,version:1});
export function expectVersion(command:CommandEnvelope,snapshot:Snapshot): void {
  const expected=command.expectedVersion ?? command.payload.expectedVersion;
  if(expected === undefined) return fail('VERSION_REQUIRED');
  if(expected !== snapshot.version) return fail('VERSION_CONFLICT');
}
export const done=(events:DomainEvent[],value:JsonObject={}):Decision=>({ok:true,events,value});
export function handle(registry:ModuleRegistry,type:string,handler:Handler):void {
 registry.register(type,(command,snapshots)=>{
   try {
    guardFeature(command,snapshots);
    return reserveDecisionMovement(command,snapshots,handler(command,snapshots));
   }
   catch(error) { if(error instanceof DomainFault) return {ok:false,code:error.message}; throw error; }
 });
}

export const commandFeatures:Record<string,{feature:string;intent:'new'|'finish_existing'}>={
 'Catalog.Quote':{feature:'catalog',intent:'new'},
 'Session.Open':{feature:'sessions',intent:'new'},
 'Order.Place':{feature:'pos.order',intent:'new'},
 'Order.Amend':{feature:'pos.order',intent:'new'},
 'Session.Move':{feature:'sessions',intent:'finish_existing'},
 'Session.Merge':{feature:'sessions',intent:'finish_existing'},
 'Order.SendCourse':{feature:'pos.order',intent:'finish_existing'},
 'Kitchen.Accept':{feature:'kitchen',intent:'finish_existing'},
 'Kitchen.AckDelta':{feature:'kitchen',intent:'finish_existing'},
 'Kitchen.DisposePrepared':{feature:'kitchen',intent:'finish_existing'},
 'Kitchen.Ready':{feature:'kitchen',intent:'finish_existing'},
 'Fulfillment.Allocate':{feature:'fulfillment',intent:'finish_existing'},
 'Fulfillment.HandOff':{feature:'fulfillment',intent:'finish_existing'},
 'Mission.Create':{feature:'robot.delivery',intent:'new'},
 'Shift.Open':{feature:'cash.shift',intent:'new'},
 // Closing and moving cash finish an existing shift (allowed while the feature drains); a new print attempt needs a ready printer, recording what the spool saw does not.
 'Shift.Close':{feature:'cash.shift',intent:'finish_existing'},
 'Cash.RecordMovement':{feature:'cash.shift',intent:'finish_existing'},
 'Print.Request':{feature:'printing',intent:'new'},
 'Print.ConfirmReprint':{feature:'printing',intent:'new'},
 'Print.Observe':{feature:'printing',intent:'finish_existing'},
 'Print.Resolve':{feature:'printing',intent:'finish_existing'},
 'Bill.Prepare':{feature:'billing',intent:'finish_existing'},
 'Payment.RecordCash':{feature:'payment.cash',intent:'finish_existing'},
 'Bill.Close':{feature:'billing',intent:'finish_existing'},
 'Bill.Split':{feature:'billing',intent:'finish_existing'},
 'Bill.Merge':{feature:'billing',intent:'finish_existing'},
 'Bill.Void':{feature:'billing',intent:'finish_existing'},
 'Payment.RecordTerminal':{feature:'payment.terminal',intent:'new'},
 'Payment.VerifyManual':{feature:'payment.transfer.manual',intent:'new'},
 // Refunds settle money already received: allowed by permission even when the refund/sales features are off (capability matrix §4).
 'Refund.Record':{feature:'refund',intent:'finish_existing'},
 // Closing a seating and handing out its guest link finish existing work; ordering channels are separate flags (qr/kiosk/robot.order).
 'Session.Close':{feature:'sessions',intent:'finish_existing'},
 'Guest.IssueToken':{feature:'sessions',intent:'finish_existing'},
 'Guest.PlaceOrder':{feature:'qr.order',intent:'new'},
 'Guest.CallStaff':{feature:'guest.call',intent:'new'},
 'Guest.ReportIssue':{feature:'guest.call',intent:'new'},
 'Guest.RequestBill':{feature:'guest.bill',intent:'new'},
 'Guest.AcknowledgeCall':{feature:'guest.call',intent:'finish_existing'},
 'Mission.Guide':{feature:'robot.guide',intent:'new'},
 'Mission.Bus':{feature:'robot.bussing',intent:'new'},
 // Binding and releasing a zone never start business, so they work while the fleet drains; a reservation is new movement unless it serves an open mission of that same robot.
 'Robot.BindMap':{feature:'fleet',intent:'finish_existing'},
 'Mission.Resume':{feature:'fleet',intent:'finish_existing'},
 'Zone.Reserve':{feature:'fleet',intent:'new'},
 'Zone.Release':{feature:'fleet',intent:'finish_existing'},
 // Recipes and ingredients are new inventory configuration; consuming/wasting stock records what the kitchen already did, so it never waits on the flag.
 'Ingredient.Upsert':{feature:'inventory',intent:'new'},
 'Recipe.Publish':{feature:'inventory',intent:'new'},
 'Inventory.Consume':{feature:'inventory',intent:'finish_existing'},
 'Inventory.RecordWaste':{feature:'inventory',intent:'finish_existing'},
 'Inventory.ResolveException':{feature:'inventory',intent:'finish_existing'},
 // Suppliers and new purchase orders are new procurement work; approving, closing and booking what physically arrived finish existing work.
 'Supplier.Upsert':{feature:'procurement',intent:'new'},
 'Purchase.Create':{feature:'procurement',intent:'new'},
 'Purchase.Approve':{feature:'procurement',intent:'finish_existing'},
 'Purchase.Close':{feature:'procurement',intent:'finish_existing'},
 'Goods.Receive':{feature:'procurement',intent:'finish_existing'},
 'Goods.Return':{feature:'procurement',intent:'finish_existing'},
 'Stocktake.Open':{feature:'inventory',intent:'new'},
 'Stocktake.Count':{feature:'inventory',intent:'finish_existing'},
 'Stocktake.Approve':{feature:'inventory',intent:'finish_existing'},
 'Stocktake.Apply':{feature:'inventory',intent:'finish_existing'},
 'Staff.Schedule':{feature:'workforce',intent:'new'},
 'Staff.ClockIn':{feature:'workforce',intent:'new'},
 'Staff.ClockOut':{feature:'workforce',intent:'finish_existing'},
 'Staff.ApproveCorrection':{feature:'workforce',intent:'finish_existing'},
 // New promotions/vouchers and new holds are new work; spending an existing hold, releasing or restoring one finishes existing work.
 'Promotion.Publish':{feature:'promotion',intent:'new'},
 'Voucher.Issue':{feature:'promotion',intent:'new'},
 'Voucher.GrantEscrow':{feature:'promotion',intent:'new'},
 'Voucher.Reserve':{feature:'promotion',intent:'new'},
 'Voucher.Redeem':{feature:'promotion',intent:'finish_existing'},
 'Voucher.Release':{feature:'promotion',intent:'finish_existing'},
 // Enrolling a customer and spending points are new loyalty work; recording what a settlement earned, reversing it and the data-governance commands finish existing work (never blocked by the flag).
 'Customer.Upsert':{feature:'loyalty',intent:'new'},
 'Consent.Record':{feature:'loyalty',intent:'new'},
 'Loyalty.Redeem':{feature:'loyalty',intent:'new'},
 'Loyalty.Earn':{feature:'loyalty',intent:'finish_existing'},
 'Loyalty.Reverse':{feature:'loyalty',intent:'finish_existing'},
 'Customer.Merge':{feature:'loyalty',intent:'finish_existing'},
 'Customer.Erase':{feature:'loyalty',intent:'finish_existing'},
 // New bookings, waitlist entries/promotions and deposits are new reservation work; confirming, seating, cancelling, applying or returning what exists finishes existing work.
 'Booking.Create':{feature:'reservations',intent:'new'},
 'Waitlist.Join':{feature:'reservations',intent:'new'},
 'Waitlist.Promote':{feature:'reservations',intent:'new'},
 'Deposit.Receive':{feature:'reservations',intent:'new'},
 'Booking.Confirm':{feature:'reservations',intent:'finish_existing'},
 'Booking.CheckIn':{feature:'reservations',intent:'finish_existing'},
 'Booking.NoShow':{feature:'reservations',intent:'finish_existing'},
 'Booking.Cancel':{feature:'reservations',intent:'finish_existing'},
 'Deposit.Apply':{feature:'reservations',intent:'finish_existing'},
 'Deposit.Return':{feature:'reservations',intent:'finish_existing'},
 // Pricing models (W08-T04): quoting a combo/weighed item is catalog work; a buffet is a package order plus a timer, and extending it finishes what was started.
 'Combo.Quote':{feature:'catalog',intent:'new'},
 'WeighedItem.Quote':{feature:'catalog',intent:'new'},
 'Buffet.Start':{feature:'service.models',intent:'new'},
 'Buffet.Extend':{feature:'service.models',intent:'finish_existing'},
};
/** Ordering channel flags; a guest token's channel is signed (verified in service/guest-token.ts), a tokenless guest order is a paired robot screen. */
const guestChannels:Record<string,string>={qr:'qr.order',kiosk:'kiosk.order',robot:'robot.order'};
const guestOrderFeature=(payload:JsonObject):string=>{const token=payload.guestToken;return guestChannels[token&&typeof token==='object'&&!Array.isArray(token)?String(token.channel):'robot'] ?? 'qr.order';};
/** Resolving a terminal charge already observed (pending/unknown -> final) finishes existing work; only a new reference is new business. */
const knownTerminalCharge=(command:CommandEnvelope,snapshots:Snapshot[]):boolean=>{ try { return Boolean(find(snapshots,'payment',externalPaymentId(externalReference(command.payload.reference)))); } catch { return false; } };
const openMission=(command:CommandEnvelope,snapshots:Snapshot[]):boolean=>{const m=typeof command.payload.missionId==='string'?find(snapshots,'mission',command.payload.missionId):undefined;return Boolean(m&&m.state.robotId===command.payload.robotId&&!['completed','cancelled','failed'].includes(String(m.state.status)));};
function guardFeature(command:CommandEnvelope,snapshots:Snapshot[]):void {
 const mapped=commandFeatures[command.type];
 if(!mapped) return;
 // Cancelling a line of an existing order finishes existing work; only adding items is new work.
 // A robot/safety problem report is not a commercial feature (capability matrix §4): the guest.call flag cannot block it.
 const intent=(command.type==='Order.Amend'&&command.payload.lineId!==undefined)||(command.type==='Guest.ReportIssue'&&['robot','safety'].includes(String(command.payload.category)))||(command.type==='Payment.RecordTerminal'&&knownTerminalCharge(command,snapshots))||(command.type==='Zone.Reserve'&&openMission(command,snapshots))?'finish_existing':mapped.intent;
 requireFeature(command,snapshots,command.type==='Guest.PlaceOrder' ? guestOrderFeature(command.payload) : command.type==='Mission.Create' ? command.payload.kind==='bus'?'robot.bussing':command.payload.kind==='guide'?'robot.guide':mapped.feature : mapped.feature,intent);
}
/** Same applied-policy check the per-command guard uses, for a feature a payload opts into (e.g. coupons). */
export function requireFeature(command:CommandEnvelope,snapshots:Snapshot[],feature:string,intent:'new'|'finish_existing'='new'):void {
 const policy=find(snapshots,'configuration','applied') ?? fail('CONFIGURATION_REQUIRED');
 const features=policy.state.features as unknown as FeatureConfig;
 const result=evaluateFeature({feature,status:features?.[feature]?.status ?? 'disabled',intent,revision:Number(policy.state.revision),policyRevision:command.policyRevision,features,readiness:runtimeReadiness(snapshots)});
 if(!result.allowed) return fail(result.reason);
}
