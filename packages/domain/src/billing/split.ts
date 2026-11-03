import type { ModuleRegistry } from '../modules';
import type { JsonObject, JsonValue } from '../../../contracts/src/index';
import { allocateMinor } from '../shared/money';
import { netOf, summarize } from '../pricing/quote';
import { liveComponents, splitComponents, type ComboPart } from '../pricing/combo';
import { changed, created, done, expectVersion, fail, find, handle, requireState, text } from '../restaurant-context';
import { assertUncollected } from './bill';

const MAX_PARTS = 20;
const KEYS = ['subtotalMinor', 'discountMinor', 'serviceMinor', 'taxMinor', 'taxIncludedMinor'] as const;
const GROUPS: Record<string, string> = { base: 'subtotalMinor', modifier: 'subtotalMinor', discount: 'discountMinor', service: 'serviceMinor' };
const groupOf = (ch: JsonObject): string => ch.kind === 'tax' ? (ch.effect === 'included' ? 'taxIncludedMinor' : 'taxMinor') : GROUPS[String(ch.kind)] ?? fail('BILL_SNAPSHOT_CORRUPT');
const signOf = (ch: JsonObject): bigint => ch.effect === 'add' ? 1n : ch.effect === 'subtract' ? -1n : 0n;
const big = (v: JsonValue | undefined): bigint => BigInt(String(v ?? '0'));
/** Line amounts recomputed from its charges with the identity quoteOrder uses: total = subtotal - discount + service + exclusive tax. */
export function amountsOf(charges: JsonObject[]): JsonObject {
  const [sub, disc, svc, tax, inc] = KEYS.map(key => charges.filter(ch => groupOf(ch) === key).reduce((a, ch) => a + big(ch.minor), 0n)) as [bigint, bigint, bigint, bigint, bigint];
  return { subtotalMinor: String(sub), discountMinor: String(disc), serviceMinor: String(svc), taxMinor: String(tax), taxIncludedMinor: String(inc), totalMinor: String(sub - disc + svc + tax) };
}
/**
 * The live part of a frozen bill line: its immutable snapshot minus Order.Amend cancellations, netted with the same netOf the order summary uses.
 * Each charge group (subtotal = base+modifiers, discount, service, tax) is re-apportioned to that net amount by largest remainder, so charges and amounts agree.
 */
export function netLine(l: JsonObject): JsonObject {
  const gross = (l.charges as JsonObject[] | undefined) ?? [{ kind: 'base', minor: String(l.subtotalMinor ?? l.totalMinor), effect: 'add' }];
  const charges = gross.map(ch => ({ ...ch }));
  for (const key of new Set(gross.map(groupOf))) {
    const idx = gross.flatMap((ch, i) => groupOf(ch) === key ? [i] : []), weights = idx.map(i => big(gross[i]!.minor)), net = netOf(l, key, key === 'subtotalMinor' ? 'totalMinor' : undefined);
    const shares = net === 0n ? idx.map(() => '0') : net < 0n || weights.every(w => w === 0n) ? fail('BILL_SNAPSHOT_CORRUPT') : allocateMinor(String(net), weights);
    idx.forEach((i, k) => { charges[i] = { ...gross[i]!, minor: shares[k]! }; });
  }
  const rest = Object.fromEntries(Object.entries(l).filter(([k]) => !['cancelled', 'cancelledQuantity', 'cancellations'].includes(k))) as JsonObject;
  const quantity = String(big(l.quantity) - big(l.cancelledQuantity));
  // a combo's parts are netted with the line, so every later split deals out what is really still sold
  return { ...rest, quantity, charges, ...amountsOf(charges), ...(Array.isArray(l.components) && l.components.length ? { components: liveComponents(l) as unknown as JsonObject[], comboCount: quantity } : {}) };
}
/** weights[line][part]: units of each net line per part (equal mode: 1 each, every part takes a portion of every line). */
function splitWeights(mode: JsonValue | undefined, parts: JsonValue | undefined, lines: JsonObject[]): bigint[][] {
  const bad = (): never => fail('INVALID_SPLIT');
  if (mode === 'equal') {
    const n = typeof parts === 'number' && Number.isInteger(parts) && parts >= 2 && parts <= MAX_PARTS ? parts : bad();
    return lines.map(() => Array<bigint>(n).fill(1n));
  }
  if ((mode !== 'lines' && mode !== 'quantity') || !Array.isArray(parts) || parts.length < 2 || parts.length > MAX_PARTS) return bad();
  const index = new Map(lines.map((l, i) => [String(l.id), i]));
  if (index.size !== lines.length) return bad(); // duplicate line ids (a merged bill): only an equal split is unambiguous
  const weights = lines.map(() => Array<bigint>(parts.length).fill(0n));
  parts.forEach((raw, j) => {
    const part = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : bad();
    const items = (mode === 'lines'
      ? (Array.isArray(part.lineIds) ? part.lineIds : bad()).map(id => ({ lineId: id, quantity: lines[index.get(String(id)) ?? bad()]!.quantity! }))
      : Array.isArray(part.items) ? part.items : bad()) as JsonObject[];
    if (!items.length) bad();
    for (const item of items) {
      const i = index.get(String(item?.lineId)) ?? bad(), q = typeof item.quantity === 'string' && /^[1-9][0-9]{0,29}$/.test(item.quantity) ? BigInt(item.quantity) : bad();
      if (weights[i]![j]! > 0n) bad();
      weights[i]![j] = q;
    }
  });
  weights.forEach((w, i) => { if (w.reduce((a, b) => a + b, 0n) !== big(lines[i]!.quantity)) bad(); });
  return weights;
}
/** Every charge of every line is allocated across the parts, so per charge the parts sum to the original exactly. */
function apportion(lines: JsonObject[], weights: bigint[][], n: number, equal: boolean): JsonObject[][] {
  const out = Array.from({ length: n }, () => [] as JsonObject[]), running = Array<bigint>(n).fill(0n);
  lines.forEach((line, li) => {
    const w = weights[li]!, per = Array.from({ length: n }, () => [] as JsonObject[]), capacity = Array<bigint>(n).fill(0n);
    const charges = line.charges as JsonObject[];
    // A combo's discount must stay within each child's goods (subtotal), or a child's part would have a negative net: a discount that fits the whole line's goods is held to that in every child
    const goods = charges.reduce((a, ch) => groupOf(ch) === 'subtotalMinor' ? a + big(ch.minor) : a, 0n), cap = Array.isArray(line.components) && line.components.length > 0 && big(line.discountMinor) <= goods, used = Array<bigint>(n).fill(0n);
    const room = (j: number): bigint => { if (!cap) return capacity[j]!; const left = per[j]!.reduce((a, ch) => groupOf(ch) === 'subtotalMinor' ? a + big(ch.minor) : a, 0n) - used[j]!; return left < capacity[j]! ? left : capacity[j]!; };
    // Allocate positive capacity first, then constrain reversals to each child's remaining line value.
    for (const index of charges.map((_, i) => i).sort((a, b) => Number(signOf(charges[b]!) - signOf(charges[a]!)))) {
      const ch = charges[index]!;
      // equal: remainders go to the parts with the lowest running total (the highest, for a discount), so equal parts stay within a unit or so
      const sign = signOf(ch), order = equal ? [...Array(n).keys()].sort((a, b) => sign === 0n || running[a] === running[b] ? a - b : (running[a]! < running[b]!) === (sign > 0n) ? -1 : 1) : [...Array(n).keys()];
      const alloc = allocateMinor(String(ch.minor), order.map(j => w[j]!)), shares: string[] = [];
      order.forEach((j, k) => { shares[j] = alloc[k]!; });
      if (sign < 0n) {
        let overflow = 0n;
        const limit = Array.from({ length: n }, (_, j) => room(j));
        shares.forEach((m, j) => { if (BigInt(m) > limit[j]!) { overflow += BigInt(m) - limit[j]!; shares[j] = String(limit[j]); } });
        for (const j of order) {
          const spare = limit[j]! - BigInt(shares[j]!); const move = spare < overflow ? spare : overflow;
          shares[j] = String(BigInt(shares[j]!) + move); overflow -= move;
        }
        if (overflow !== 0n) fail('BILL_SNAPSHOT_CORRUPT');
      }
      shares.forEach((m, j) => { if (sign < 0n) used[j] = used[j]! + BigInt(m); per[j]![index] = { ...ch, minor: m }; capacity[j] = capacity[j]! + sign * BigInt(m); running[j] = running[j]! + sign * BigInt(m); });
    }
    const amounts = per.map(charges => amountsOf(charges)), parts = Array.isArray(line.components) && line.components.length ? (line.components as unknown as ComboPart[]) : undefined;
    // the line's frozen part money is dealt out ONCE here (never re-rounded per child), so a part adds up across the children and each child's parts add up to its line
    const comps = parts ? splitComponents(parts, amounts.map(a => big(a.subtotalMinor)), amounts.map(a => big(a.discountMinor)), (p, j) => equal ? p.quantity : String(big(p.quantity) * w[j]! / big(line.quantity))) ?? fail('SPLIT_NOT_CONSERVED') : undefined;
    per.forEach((charges, j) => { if (w[j]! > 0n) out[j]!.push({ ...line, quantity: equal ? line.quantity! : String(w[j]), ...(equal ? { portion: { part: j + 1, parts: n } } : {}), charges, ...amounts[j]!, ...(comps ? { components: comps[j] as unknown as JsonObject[], comboCount: equal ? line.quantity! : String(w[j]) } : {}) }); });
  });
  return out;
}
/**
 * Bill.Split {billId,expectedVersion,mode:'lines'|'quantity'|'equal',parts}: lines -> [{lineIds}], quantity -> [{items:[{lineId,quantity}]}], equal -> part count.
 * Works only from the bill's frozen snapshot (never the current menu/pricing), only on a bill that took no money. The original stays as history
 * (status split, childBillIds); children are ordinary prepared bills `<billId>.<n>` with the parent's orders/session refs.
 */
export function registerBillSplit(registry: ModuleRegistry): void {
  handle(registry, 'Bill.Split', (c, s) => {
    const bill = requireState(s, 'bill', text(c.payload.billId)); expectVersion(c, bill); assertUncollected(s, bill);
    const lines = ((bill.state.lines ?? []) as JsonObject[]).map(netLine).filter(l => big(l.quantity) > 0n);
    if (!lines.length || lines.reduce((a, l) => a + big(l.totalMinor), 0n) !== big(bill.state.totalMinor)) return fail('BILL_SNAPSHOT_MISMATCH');
    const equal = c.payload.mode === 'equal', weights = splitWeights(c.payload.mode, c.payload.parts, lines), n = weights[0]!.length;
    const ids = Array.from({ length: n }, (_, j) => `${bill.ref.id}.${j + 1}`);
    if (ids.some(id => id.length > 128 || find(s, 'bill', id))) return fail('BILL_EXISTS');
    const parts = apportion(lines, weights, n, equal), totals = parts.map(p => p.reduce((a, l) => a + big(l.totalMinor), 0n));
    if (totals.reduce((a, b) => a + b, 0n) !== big(bill.state.totalMinor)) return fail('SPLIT_NOT_CONSERVED');
    const children = parts.map((childLines, j) => created('BillSplitPrepared', 'bill', ids[j]!, {
      parentBillId: bill.ref.id, splitIndex: j + 1, sessionId: bill.state.sessionId ?? null, ...(bill.state.sessionIds ? { sessionIds: bill.state.sessionIds } : {}), tableId: bill.state.tableId ?? null,
      currency: bill.state.currency ?? 'VND', totalMinor: String(totals[j]), paidMinor: '0', refundedMinor: '0', status: 'prepared', orderIds: bill.state.orderIds ?? [],
      lines: childLines, summary: summarize(childLines), pricingRevisions: bill.state.pricingRevisions ?? [], preparedAt: c.recordedAt,
    }));
    return done([changed('BillSplit', bill, { status: 'split', childBillIds: ids, split: { mode: String(c.payload.mode), parts: n, by: c.actorRef, at: c.recordedAt } }), ...children], { billId: bill.ref.id, childBillIds: ids, totals: totals.map(String) });
  });
}
