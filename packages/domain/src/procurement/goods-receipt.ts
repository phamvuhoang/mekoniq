import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { hashPayload } from '../../../contracts/src/canonical';
import { changed, created, done, fail, find, handle, records, text } from '../restaurant-context';
import { backfillOf, movementId, receive, toBase } from '../inventory/movement';
import { lineValue } from './cost';
import { receivable, type PoLine } from './purchase-order';
export function registerReceiving(registry: ModuleRegistry): void {
  // Goods.Receive {purchaseId,supplierReceipt,currency?, lines:[{ingredientId,quantity,unit?}] | ingredientId+quantity+unit?}: the supplier's delivery note number is unique per
  // supplier (and venue) — the same note again with the same lines is a no-op, with different lines SUPPLIER_RECEIPT_REUSED. A receipt may take only what the order still allows.
  handle(registry, 'Goods.Receive', (c, s) => {
    const po = find(s, 'purchase', text(c.payload.purchaseId)) ?? fail('NOT_FOUND'), number = text(c.payload.supplierReceipt, 'SUPPLIER_RECEIPT_REQUIRED');
    const raw = c.payload.lines === undefined ? [{ ingredientId: c.payload.ingredientId!, quantity: c.payload.quantity!, ...(c.payload.unit === undefined ? {} : { unit: c.payload.unit }) }] : records(c.payload.lines);
    if (c.payload.currency !== undefined && c.payload.currency !== po.state.currency) return fail('CURRENCY_MISMATCH');
    const seen = new Set<string>(), poLines = po.state.lines as unknown as PoLine[];
    const lines = raw.map(line => {
      const ingredientId = text(line.ingredientId), item = find(s, 'stock-item', ingredientId) ?? fail('INGREDIENT_UNKNOWN');
      if (seen.has(ingredientId)) return fail('DUPLICATE_INGREDIENT');
      seen.add(ingredientId);
      if (item.state.currency !== po.state.currency) return fail('CURRENCY_MISMATCH');
      const base = toBase(item.state, text(line.quantity, 'INVALID_QUANTITY'), line.unit === undefined ? undefined : text(line.unit, 'UNKNOWN_UNIT'));
      if (BigInt(base) <= 0n) return fail('INVALID_QUANTITY');
      return { ingredientId, item, base, po: poLines.find(l => l.ingredientId === ingredientId) ?? fail('LINE_NOT_ON_PURCHASE') };
    });
    const id = `rcpt-${hashPayload({ supplierId: po.state.supplierId, number }).slice(0, 32)}`, payloadHash = hashPayload({ purchaseId: po.ref.id, lines: lines.map(l => ({ i: l.ingredientId, b: l.base })) });
    const prior = find(s, 'goods-receipt', id);
    if (prior) return prior.state.payloadHash === payloadHash ? done([], { receiptId: id, duplicate: true }) : fail('SUPPLIER_RECEIPT_REUSED');
    if (!['approved', 'partially_received'].includes(String(po.state.status))) return fail('PURCHASE_NOT_RECEIVABLE');
    for (const l of lines) if (BigInt(l.base) > BigInt(receivable(l.po.ordered, l.po.received, l.po.tolerance))) return fail('OVER_RECEIVED');
    const events = [], out: JsonObject[] = [];
    for (const l of lines) {
      const value = lineValue(BigInt(l.base), BigInt(l.po.unitCostMinor), BigInt(l.po.perBase)), mid = movementId(id, l.ingredientId, 'receipt'), next = receive(l.item.state, BigInt(l.base), value), backfill = backfillOf(l.item.state, BigInt(l.base), value);
      out.push({ ingredientId: l.ingredientId, baseQuantity: l.base, valueMinor: String(value), returned: '0', movementId: mid });
      events.push(created('StockMovementRecorded', 'stock-movement', mid, { kind: 'receipt', ingredientId: l.ingredientId, sourceEventId: id, deltaBase: l.base, valueMinor: String(value), ...(backfill > 0n ? { backfillMinor: String(backfill) } : {}), seq: next.movementSeq!, actorRef: c.actorRef, occurredAt: c.occurredAt }), changed('StockLevelChanged', l.item, next));
    }
    const updated = poLines.map(p => { const l = lines.find(x => x.ingredientId === p.ingredientId); return l ? { ...p, received: String(BigInt(p.received) + BigInt(l.base)) } : p; });
    const full = updated.every(p => BigInt(p.received) >= BigInt(p.ordered));
    return done([created('GoodsReceived', 'goods-receipt', id, { purchaseId: po.ref.id, supplierId: po.state.supplierId, supplierReceipt: number, payloadHash, currency: po.state.currency, lines: out, actorRef: c.actorRef, occurredAt: c.occurredAt }),
      changed('PurchaseReceived', po, { lines: updated as unknown as JsonObject[], status: full ? 'received' : 'partially_received' }), ...events], { receiptId: id });
  });
}
