import type { JsonObject, Snapshot } from '../../../contracts/src/index';
/** Stock on hand at weighted-average value. A negative or unvalued balance is `costKnown:false`: reports show the gap instead of pricing it at zero silently. */
export function stockValuation(snapshots: Snapshot[]): JsonObject[] {
  return snapshots.filter(s => s.ref.kind === 'stock-item').sort((a, b) => a.ref.id.localeCompare(b.ref.id)).map(s => {
    const onHand = BigInt(String(s.state.onHand)), value = BigInt(String(s.state.valueMinor)), known = onHand > 0n && value > 0n;
    return { ingredientId: s.ref.id, name: String(s.state.name ?? s.ref.id), baseUnit: s.state.baseUnit as string, onHand: String(onHand), valueMinor: String(value), avgCostMinorPerBase: known ? String((value * 2n + onHand) / (2n * onHand)) : null, costKnown: onHand <= 0n || known };
  });
}
