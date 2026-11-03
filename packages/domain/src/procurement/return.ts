import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { changed, created, done, fail, find, handle, note, text } from '../restaurant-context';
import { movementId, sourceId, toBase } from '../inventory/movement';
import type { PoLine } from './purchase-order';
export function registerReturns(registry: ModuleRegistry): void {
  // Goods.Return {sourceEventId,receiptId,ingredientId,quantity,unit?,reason}: stock goes back to the supplier at the value it came in with on THAT receipt (not today's average),
  // never more than that receipt delivered. Returning does not reopen the purchase order.
  handle(registry, 'Goods.Return', (c, s) => {
    const reason = note(c.payload.reason, 'REASON_REQUIRED'), source = text(c.payload.sourceEventId), receipt = find(s, 'goods-receipt', text(c.payload.receiptId)) ?? fail('RECEIPT_NOT_FOUND');
    const ingredientId = text(c.payload.ingredientId), item = find(s, 'stock-item', ingredientId) ?? fail('INGREDIENT_UNKNOWN');
    const base = BigInt(toBase(item.state, text(c.payload.quantity, 'INVALID_QUANTITY'), c.payload.unit === undefined ? undefined : text(c.payload.unit, 'UNKNOWN_UNIT')));
    if (base <= 0n) return fail('INVALID_QUANTITY');
    const id = sourceId('ret', source), prior = find(s, 'goods-return', id);
    if (prior) return prior.state.baseQuantity === String(base) && prior.state.receiptId === receipt.ref.id && prior.state.ingredientId === ingredientId ? done([], { returnId: id, duplicate: true }) : fail('SOURCE_REUSED');
    const lines = receipt.state.lines as JsonObject[], line = lines.find(l => l.ingredientId === ingredientId) ?? fail('LINE_NOT_ON_RECEIPT');
    const delivered = BigInt(String(line.baseQuantity));
    if (BigInt(String(line.returned)) + base > delivered) return fail('RETURN_EXCEEDS_RECEIPT');
    if (item.state.negativePolicy === 'block' && BigInt(String(item.state.onHand)) < base) return fail('INSUFFICIENT_STOCK');
    const cost = (BigInt(String(line.valueMinor)) * base * 2n + delivered) / (2n * delivered), onHand = BigInt(String(item.state.onHand)) - base, value = BigInt(String(item.state.valueMinor)) - cost;
    const next = { onHand: String(onHand), valueMinor: String(onHand <= 0n || value < 0n ? 0n : value), movementSeq: Number(item.state.movementSeq) + 1 }, mid = movementId(id, ingredientId, 'return');
    const po = find(s, 'purchase', String(receipt.state.purchaseId));
    return done([created('GoodsReturned', 'goods-return', id, { receiptId: receipt.ref.id, purchaseId: receipt.state.purchaseId, ingredientId, baseQuantity: String(base), valueMinor: String(cost), reason, actorRef: c.actorRef, occurredAt: c.occurredAt }),
      changed('GoodsReturnBooked', receipt, { lines: lines.map(l => l === line ? { ...l, returned: String(BigInt(String(l.returned)) + base) } : l) }),
      created('StockMovementRecorded', 'stock-movement', mid, { kind: 'return', ingredientId, sourceEventId: id, deltaBase: String(-base), valueMinor: String(-cost), seq: next.movementSeq, actorRef: c.actorRef, occurredAt: c.occurredAt }), changed('StockLevelChanged', item, next),
      ...(po ? [changed('PurchaseReturnBooked', po, { lines: (po.state.lines as unknown as PoLine[]).map(l => l.ingredientId === ingredientId ? { ...l, returned: String(BigInt(l.returned) + base) } : l) as unknown as JsonObject[] })] : [])], { returnId: id });
  });
}
