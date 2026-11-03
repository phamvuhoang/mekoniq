import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { amount, changed, created, done, expectVersion, fail, find, handle, note, record, records, text } from '../restaurant-context';
import { toBase } from '../inventory/movement';
/** What a line can still take: ordered + approved tolerance - already received (returns never reopen an order). */
export function receivable(ordered: string, received: string, tolerance: string) {
  return String(BigInt(ordered) + BigInt(tolerance) - BigInt(received));
}
export type PoLine = { ingredientId: string; unit: string; ordered: string; received: string; returned: string; tolerance: string; unitCostMinor: string; perBase: string };
export function registerPurchasing(registry: ModuleRegistry): void {
  // Purchase.Create {purchaseId,supplierId,lines:[{ingredientId,quantity,unit?,unitCostMinor}]}: a draft; cost is per ordering unit, quantities are frozen in base units.
  handle(registry, 'Purchase.Create', (c, s) => {
    const id = text(c.payload.purchaseId), supplier = find(s, 'supplier', text(c.payload.supplierId)) ?? fail('SUPPLIER_UNKNOWN');
    if (find(s, 'purchase', id)) return fail('PURCHASE_EXISTS');
    const seen = new Set<string>(), lines = records(c.payload.lines).map((line): JsonObject => {
      const ingredientId = text(line.ingredientId), item = find(s, 'stock-item', ingredientId) ?? fail('INGREDIENT_UNKNOWN');
      if (seen.has(ingredientId)) return fail('DUPLICATE_INGREDIENT');
      seen.add(ingredientId);
      if (item.state.currency !== supplier.state.currency) return fail('CURRENCY_MISMATCH');
      const unit = line.unit === undefined ? String(item.state.baseUnit) : text(line.unit, 'UNKNOWN_UNIT'), ordered = toBase(item.state, text(line.quantity, 'INVALID_QUANTITY'), unit);
      if (BigInt(ordered) <= 0n) return fail('INVALID_QUANTITY');
      return { ingredientId, unit, ordered, received: '0', returned: '0', tolerance: '0', unitCostMinor: amount(line.unitCostMinor), perBase: toBase(item.state, '1', unit) };
    });
    return done([created('PurchaseCreated', 'purchase', id, { supplierId: supplier.ref.id, currency: supplier.state.currency, status: 'draft', lines, createdBy: c.actorRef, createdAt: c.occurredAt })], { purchaseId: id });
  });
  // Purchase.Approve {purchaseId,expectedVersion,tolerance?:{ingredientId:'quantity in the line unit'}}: only an approved order can be received; over-delivery needs an explicit tolerance here.
  handle(registry, 'Purchase.Approve', (c, s) => {
    const po = find(s, 'purchase', text(c.payload.purchaseId)) ?? fail('NOT_FOUND'); expectVersion(c, po);
    if (po.state.status !== 'draft') return fail('PURCHASE_STATE_CONFLICT');
    const tolerance = c.payload.tolerance === undefined ? {} : record(c.payload.tolerance);
    const lines = (po.state.lines as unknown as PoLine[]).map(l => {
      if (tolerance[l.ingredientId] === undefined) return l;
      const item = find(s, 'stock-item', l.ingredientId) ?? fail('INGREDIENT_UNKNOWN');
      return { ...l, tolerance: toBase(item.state, text(tolerance[l.ingredientId], 'INVALID_QUANTITY'), l.unit) };
    });
    if (Object.keys(tolerance).some(k => !lines.some(l => l.ingredientId === k))) return fail('LINE_NOT_ON_PURCHASE');
    return done([changed('PurchaseApproved', po, { status: 'approved', lines: lines as unknown as JsonObject[], approvedBy: c.actorRef, approvedAt: c.occurredAt })], { purchaseId: po.ref.id });
  });
  // Purchase.Close {purchaseId,reason,expectedVersion}: the supplier will not deliver the rest. Receipts already booked stay; nothing more can arrive.
  handle(registry, 'Purchase.Close', (c, s) => {
    const po = find(s, 'purchase', text(c.payload.purchaseId)) ?? fail('NOT_FOUND'); expectVersion(c, po);
    const reason = note(c.payload.reason, 'REASON_REQUIRED');
    if (!['approved', 'partially_received'].includes(String(po.state.status))) return fail('PURCHASE_STATE_CONFLICT');
    return done([changed('PurchaseClosed', po, { status: 'closed', closeReason: reason, closedBy: c.actorRef, closedAt: c.occurredAt })], { purchaseId: po.ref.id });
  });
}
