import type { JsonObject } from '../../../contracts/src/index';
import { issue, receive } from './movement';
/**
 * A signed correction of a stock item. A shortage leaves at the weighted average like any other loss; a surplus has no purchase behind it, so it is
 * valued at the current average and marked `estimated` (zero when nothing is on hand — then `costKnown:false`). The report says so, nothing hides it.
 */
export function adjust(item: JsonObject, delta: bigint): { next: JsonObject; valueMinor: bigint; costKnown: boolean; estimated: boolean } {
  if (delta < 0n) { const r = issue(item, -delta); return { next: r.next, valueMinor: -r.costMinor, costKnown: r.costKnown, estimated: false }; }
  const onHand = BigInt(String(item.onHand)), value = BigInt(String(item.valueMinor)), estimate = onHand > 0n ? (value * delta * 2n + onHand) / (2n * onHand) : 0n;
  return { next: receive(item, delta, estimate), valueMinor: estimate, costKnown: onHand > 0n, estimated: true };
}
