import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { currentMenu } from '../catalog/menu';
import { placeOrder } from '../orders/module';
import { quoteForCommand } from './quote';
import { changed, created, done, fail, find, handle, requireFeature, stableId, text } from '../restaurant-context';
const CLOCK_TOLERANCE_MS = 2 * 60_000;
type Evidence = { bootId: string; monotonicMs: number };
const evidence = (v: unknown): Evidence | undefined => {
  if (v === undefined) return undefined;
  const e = v as JsonObject;
  return e && typeof e === 'object' && typeof e.bootId === 'string' && e.bootId && Number.isFinite(e.monotonicMs) && (e.monotonicMs as number) >= 0 ? { bootId: e.bootId, monotonicMs: e.monotonicMs as number } : fail('INVALID_CLOCK_EVIDENCE');
};
/** Time left on a buffet by the wall clock (the price never depends on it). */
export function buffetStatus(b: { plannedEndMs: number }, nowMs: number) { const remainingMs = b.plannedEndMs - nowMs; return { remainingMs, expired: remainingMs <= 0 }; }
/**
 * Monotonic evidence cross-checks the wall clock: a different boot means the tablet restarted (elapsed time cannot be proved from it), a wall-clock jump of more than two
 * minutes against the monotonic elapsed time is `clock_skew`. Flags are for the manager's eyes; they never change the price or the planned end.
 */
export function clockFlags(b: { startedMs: number; clock?: Evidence | undefined }, now: Evidence, nowMs: number): string[] {
  if (!b.clock) return ['no_start_evidence'];
  if (b.clock.bootId !== now.bootId) return ['restarted'];
  return Math.abs((now.monotonicMs - b.clock.monotonicMs) - (nowMs - b.startedMs)) > CLOCK_TOLERANCE_MS ? ['clock_skew'] : [];
}
function sub(c: { payload: JsonObject } & object, payload: JsonObject) { return { ...(c as object), payload } as Parameters<typeof placeOrder>[0]; }
export function registerServiceModels(registry: ModuleRegistry): void {
  // Combo.Quote {comboItemId,quantity?,discountIds?} / WeighedItem.Quote {itemId,measure}: the same server-side quote as Catalog.Quote, but only for the model it names, so a screen
  // can show the frozen parts / the weighed price before anything is ordered.
  handle(registry, 'Combo.Quote', (c, s) => {
    const item = (currentMenu(s).state.items as JsonObject[]).find(i => i.id === c.payload.comboItemId);
    if (!item?.combo) return fail('NOT_A_COMBO');
    return done([], quoteForCommand(sub(c, { items: [{ itemId: String(item.id), quantity: String(c.payload.quantity ?? '1') }], ...(c.payload.discountIds === undefined ? {} : { discountIds: c.payload.discountIds }) }), s));
  });
  handle(registry, 'WeighedItem.Quote', (c, s) => {
    const item = (currentMenu(s).state.items as JsonObject[]).find(i => i.id === c.payload.itemId);
    if (!item?.weighed) return fail('NOT_A_WEIGHED_ITEM');
    return done([], quoteForCommand(sub(c, { items: [{ itemId: String(item.id), quantity: '1', measure: c.payload.measure! }] }), s));
  });
  // Buffet.Start {buffetId?,sessionId,tableId,menuVersion,packageItemId,guests,clock?}: the package is an ordinary priced order line (price x guests, tax and discount as any item),
  // and the buffet aggregate keeps the timer beside it. One active buffet per session.
  handle(registry, 'Buffet.Start', (c, s) => {
    requireFeature(c, s, 'pos.order');
    const item = (currentMenu(s).state.items as JsonObject[]).find(i => i.id === c.payload.packageItemId), cfg = item?.buffet as JsonObject | undefined;
    if (!item || !cfg) return fail('NOT_A_BUFFET_PACKAGE');
    const guests = Number.isInteger(c.payload.guests) && (c.payload.guests as number) >= 1 && (c.payload.guests as number) <= 200 ? c.payload.guests as number : fail('INVALID_GUESTS'), sessionId = text(c.payload.sessionId);
    if (s.some(x => x.ref.kind === 'buffet' && x.state.sessionId === sessionId && x.state.status === 'active')) return fail('BUFFET_ACTIVE');
    const id = c.payload.buffetId === undefined ? stableId('buffet', c) : text(c.payload.buffetId);
    if (find(s, 'buffet', id)) return fail('BUFFET_EXISTS');
    const placed = placeOrder(sub(c, { sessionId, tableId: c.payload.tableId!, menuVersion: c.payload.menuVersion!, items: [{ itemId: String(item.id), quantity: String(guests) }] }), s);
    if (!placed.ok) return placed;
    const startedMs = Date.parse(c.occurredAt), clock = evidence(c.payload.clock);
    return done([...placed.events, created('BuffetStarted', 'buffet', id, { sessionId, tableId: c.payload.tableId!, packageItemId: String(item.id), guests, orderId: placed.value.orderId!, startedAt: c.occurredAt, startedMs, durationMinutes: Number(cfg.durationMinutes), plannedEndMs: startedMs + Number(cfg.durationMinutes) * 60_000, extensions: [], flags: [], ...(clock ? { clock } : {}), status: 'active', startedBy: c.actorRef })], { ...placed.value, buffetId: id });
  });
  // Buffet.Extend {buffetId,clock?}: adds the package's extension (another priced item x guests, as its own order line) and moves the planned end by `extendMinutes` — from the old end
  // while it is still running, from now once it has run out.
  handle(registry, 'Buffet.Extend', (c, s) => {
    const b = find(s, 'buffet', text(c.payload.buffetId)) ?? fail('NOT_FOUND');
    if (b.state.status !== 'active') return fail('BUFFET_NOT_ACTIVE');
    requireFeature(c, s, 'pos.order');
    const menu = currentMenu(s), cfg = (menu.state.items as JsonObject[]).find(i => i.id === b.state.packageItemId)?.buffet as JsonObject | undefined;
    if (!cfg) return fail('NOT_A_BUFFET_PACKAGE');
    const placed = placeOrder(sub(c, { sessionId: b.state.sessionId!, tableId: b.state.tableId!, menuVersion: menu.state.version!, items: [{ itemId: String(cfg.extendItemId), quantity: String(b.state.guests) }] }), s);
    if (!placed.ok) return placed;
    const now = Date.parse(c.occurredAt), clock = evidence(c.payload.clock), flags = clock ? clockFlags({ startedMs: Number(b.state.startedMs), clock: b.state.clock as Evidence | undefined }, clock, now) : [];
    const plannedEndMs = Math.max(Number(b.state.plannedEndMs), now) + Number(cfg.extendMinutes) * 60_000;
    return done([...placed.events, changed('BuffetExtended', b, { plannedEndMs, extensions: [...(b.state.extensions as JsonObject[]), { orderId: placed.value.orderId!, minutes: Number(cfg.extendMinutes), at: c.occurredAt, by: c.actorRef }], flags: [...new Set([...(b.state.flags as string[]), ...flags])], ...(clock ? { lastClock: clock } : {}) })], { ...placed.value, buffetId: b.ref.id, plannedEndMs });
  });
}
