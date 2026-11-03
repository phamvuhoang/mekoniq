import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { refundableComponents } from "../../packages/domain/src/pricing/combo";
import type { JsonObject, Snapshot } from "../../packages/contracts/src/index";
type Lab = Awaited<ReturnType<typeof createRestaurantLab>>;
type Item = { onHand: string; valueMinor: string };
type V = { version: number };
const lab$ = async (body: (lab: Lab) => Promise<void>) => { const lab = await createRestaurantLab(); try { await body(lab); } finally { await lab.close(); } };
const day = (lab: Lab) => new Date(lab.clock.nowMs).toISOString().slice(0, 10);
const snaps = async (lab: Lab): Promise<Snapshot[]> => (await lab.getStore("coordinator")).snapshots(lab.scope);
const items = (set = "80000", unit = { burger: "60000", tea: "20000" }): JsonObject[] => [
  { id: "rice", name: "Cơm", stationId: "kitchen", unitMinor: "50000", available: true },
  { id: "tea", name: "Trà", stationId: "bar", unitMinor: unit.tea, available: true },
  { id: "burger", name: "Burger", stationId: "kitchen", unitMinor: unit.burger, available: true },
  { id: "set", name: "Combo", stationId: "kitchen", unitMinor: set, available: true, combo: { components: [{ itemId: "burger", quantity: "1" }, { itemId: "tea", quantity: "2" }] } },
];
async function menu(lab: Lab, set?: string, unit?: { burger: string; tea: string }) {
  const r = await lab.command("manager", "Catalog.Publish", { version: 2, currency: "VND", items: items(set, unit), pricing: { taxProfiles: [], defaultTaxProfileId: null, service: null, discountOrder: "before_tax", discounts: [] } });
  expect(r.status, String(r.code)).toBe("accepted");
}
const place = (lab: Lab, sessionId: string, tableId: string, its: JsonObject[], extra: JsonObject = {}, actor = "manager") => lab.command(actor, "Order.Place", { sessionId, tableId, menuVersion: 2, items: its, ...extra });
const bill$ = async (lab: Lab, id: string) => (await snaps(lab)).find(s => s.ref.kind === "bill" && s.ref.id === id)!;
async function twoCombosSplitAndMerged(lab: Lab) {
  await menu(lab);
  await lab.command("cashier", "Shift.Open", { shiftId: "sh", currency: "VND", openingMinor: "0" });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "2" }], {}, "cashier"), line = String((placed.value.lineIds as string[])[0]);
  const billId = String((await lab.command("cashier", "Bill.Prepare", { sessionId: "s1" })).value.billId);
  const split = await lab.command("cashier", "Bill.Split", { billId, expectedVersion: (await bill$(lab, billId)).version, mode: "quantity", parts: [{ items: [{ lineId: line, quantity: "1" }] }, { items: [{ lineId: line, quantity: "1" }] }] });
  expect(split.status, String(split.code)).toBe("accepted");
  const merged = await lab.command("cashier", "Bill.Merge", { bills: await Promise.all([1, 2].map(async n => ({ billId: `${billId}.${n}`, expectedVersion: (await bill$(lab, `${billId}.${n}`)).version }))), billId: "merged" });
  expect(merged.status, String(merged.code)).toBe("accepted");
  return line;
}

test("R4-1 a split-then-merged bill refunds a combo part once, as the sum of every line that shares its id", () => lab$(async lab => {
  const line = await twoCombosSplitAndMerged(lab);
  const paid = await lab.command("cashier", "Payment.RecordCash", { billId: "merged", expectedVersion: (await bill$(lab, "merged")).version, amountMinor: "160000", currency: "VND" });
  expect(paid.status, String(paid.code)).toBe("accepted");
  const refund = async (amountMinor: string) => lab.command("manager", "Refund.Record", { paymentId: String(paid.value.paymentId), reason: "trà hỏng", expectedVersion: (await lab.state<V>("payment", String(paid.value.paymentId))).version, amountMinor, component: { lineId: line, itemId: "tea" } });
  expect((await refund("32000")).code).toBe("COMPONENT_AMOUNT_MISMATCH");
  expect((await refund("64000")).status).toBe("accepted");
  expect((await refund("64000")).code).toBe("COMPONENT_ALREADY_REFUNDED");
}));

test("R4-2 the tablet's refundable parts are the domain's: live after a cancellation, summed after merge", () => lab$(async lab => {
  await menu(lab);
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "2" }], {}, "cashier"), line = String((placed.value.lineIds as string[])[0]);
  expect((await lab.command("cashier", "Order.Amend", { lineId: line, cancelQuantity: "1", reason: "đổi ý", expectedVersion: (await lab.state<V>("order", String(placed.value.orderId))).version })).status).toBe("accepted");
  const billId = String((await lab.command("cashier", "Bill.Prepare", { sessionId: "s1" })).value.billId);
  const parts = refundableComponents((await bill$(lab, billId)).state.lines as JsonObject[]);
  expect(parts.map(p => [p.itemId, p.minor])).toEqual([["burger", "48000"], ["tea", "32000"]]);
}));

test("R4-3 a voucher released after its order was cancelled can discount the replacement order", () => lab$(async lab => {
  await menu(lab);
  await lab.command("manager", "Promotion.Publish", { promotionId: "member", name: "Hội viên", kind: "percent", valueBps: 1000, priority: 1, requiresVoucher: true });
  await lab.command("manager", "Voucher.Issue", { voucherId: "VM", promotionId: "member", limit: 1 });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  await lab.command("cashier", "Voucher.Reserve", { voucherId: "VM", ref: "s1" });
  const first = await place(lab, "s1", "table-1", [{ itemId: "rice", quantity: "1" }], { discountIds: ["member"], voucherId: "VM" });
  expect(first.status, String(first.code)).toBe("accepted");
  const order = await lab.state<V>("order", String(first.value.orderId));
  await lab.command("manager", "Order.Cancel", { orderId: String(first.value.orderId), reason: "hủy", expectedVersion: order.version });
  expect((await lab.command("manager", "Voucher.Release", { voucherId: "VM", ref: "s1", reason: "đơn đã hủy" })).status).toBe("accepted");
  expect((await lab.command("cashier", "Voucher.Reserve", { voucherId: "VM", ref: "s1" })).status).toBe("accepted");
  const again = await place(lab, "s1", "table-1", [{ itemId: "rice", quantity: "1" }], { discountIds: ["member"], voucherId: "VM" });
  expect(again.status, String(again.code)).toBe("accepted");
  expect((await lab.state<JsonObject>("order", String(again.value.orderId))).totalMinor).toBe("45000");
  const use = (await snaps(lab)).find(s => s.ref.kind === "voucher-use")!;
  expect(use.state.orderId).toBe(again.value.orderId);
  expect(use.state.previousOrderIds).toEqual([first.value.orderId]); // the audit trail of the first hold survives
}));

test("R4-4 a combo made at one station only can be cancelled: that station disposes of its food, the others drop their part", () => lab$(async lab => {
  await menu(lab);
  await lab.seed("stock-item", "patty", { name: "Patty", baseUnit: "piece", conversions: {}, negativePolicy: "allow", currency: "VND", onHand: "100", valueMinor: "500000", movementSeq: 0 });
  await lab.command("manager", "Recipe.Publish", { recipeVersion: "burger-v1", itemId: "burger", lines: [{ ingredientId: "patty", quantity: "1", unit: "piece" }] });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "1" }]), line = String((placed.value.lineIds as string[])[0]);
  const kitchen = (await snaps(lab)).find(t => t.ref.kind === "kitchen-ticket" && t.state.stationId === "kitchen")!;
  expect((await lab.command("chef", "Kitchen.Ready", { lineId: kitchen.ref.id, stationId: "kitchen", quantity: "1", expectedVersion: kitchen.version })).status).toBe("accepted");
  const amend = await lab.command("manager", "Order.Amend", { lineId: line, cancelQuantity: "1", reason: "khách đổi ý", expectedVersion: (await lab.state<V>("order", String(placed.value.orderId))).version });
  expect(amend.status, String(amend.code)).toBe("accepted");
  const all = await snaps(lab), request = all.find(s => s.ref.kind === "kitchen-cancellation")!, delta = all.find(s => s.ref.kind === "kitchen-delta")!;
  expect(request.state).toMatchObject({ stationId: "kitchen", quantity: "1", status: "requested" });
  expect(delta.state).toMatchObject({ stationId: "bar", kind: "cancel", quantity: "1" });
  expect((await lab.state<JsonObject>("order", String(placed.value.orderId))).status).toBe("cancelled");
  const disposed = await lab.command("chef", "Kitchen.DisposePrepared", { cancellationId: request.ref.id, stationId: "kitchen", disposition: "waste", note: "bỏ", expectedVersion: request.version });
  expect(disposed.status, String(disposed.code)).toBe("accepted");
  expect(await lab.count("StockWasted")).toBe(1); // the cooked burger is waste in the ledger
  expect((await lab.state<Item>("stock-item", "patty")).onHand).toBe("99"); // and nothing goes back on the shelf
}));

test("R4-5 resolving an exception after the food was thrown away records the waste, once", () => lab$(async lab => {
  await menu(lab);
  await lab.seed("stock-item", "rice-raw", { name: "Gạo", baseUnit: "g", conversions: {}, negativePolicy: "block", currency: "VND", onHand: "100", valueMinor: "2000", movementSeq: 0 });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "rice", quantity: "2" }], {}, "cashier"), line = String((placed.value.lineIds as string[])[0]);
  await lab.command("chef", "Kitchen.Ready", { lineId: line, stationId: "kitchen", quantity: "2", expectedVersion: 1 });
  const amend = await lab.command("manager", "Order.Amend", { lineId: line, cancelQuantity: "1", reason: "bỏ", expectedVersion: (await lab.state<V>("order", String(placed.value.orderId))).version });
  expect(amend.status, String(amend.code)).toBe("accepted");
  const request = (await snaps(lab)).find(s => s.ref.kind === "kitchen-cancellation")!;
  expect((await lab.command("chef", "Kitchen.DisposePrepared", { cancellationId: request.ref.id, stationId: "kitchen", disposition: "waste", expectedVersion: request.version })).status).toBe("accepted");
  expect(await lab.count("StockWasted")).toBe(0); // nothing was ever booked to reclassify yet
  await lab.seed("stock-item", "rice-raw", { name: "Gạo", baseUnit: "g", conversions: {}, negativePolicy: "block", currency: "VND", onHand: "10000", valueMinor: "200000", movementSeq: 1 });
  const exc = (await snaps(lab)).find(s => s.ref.kind === "stock-exception")!;
  const r = await lab.command("manager", "Inventory.ResolveException", { exceptionId: exc.ref.id, disposition: "consume", reason: "đã nhập gạo", expectedVersion: exc.version });
  expect(r.status, String(r.code)).toBe("accepted");
  const totals = (await lab.report("food-cost", day(lab))).totals as JsonObject;
  expect(totals).toMatchObject({ consumedCostMinor: "8000", preparedWasteCostMinor: "4000", openStockExceptions: 0 });
  expect(await lab.count("StockWasted")).toBe(1);
  expect((await lab.command("manager", "Inventory.ResolveException", { exceptionId: exc.ref.id, disposition: "consume", reason: "lại", expectedVersion: exc.version + 1 })).code).toBe("EXCEPTION_RESOLVED");
  expect(await lab.count("StockWasted")).toBe(1);
}));

test("R4-6 splitting a bill shares the frozen combo amounts out, so every part's refund right is conserved", () => lab$(async lab => {
  await menu(lab, "3", { burger: "1", tea: "1" }); // two parts of equal weight, price 3 for one combo
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "2" }], {}, "cashier"), line = String((placed.value.lineIds as string[])[0]);
  const billId = String((await lab.command("cashier", "Bill.Prepare", { sessionId: "s1" })).value.billId);
  const whole = refundableComponents((await bill$(lab, billId)).state.lines as JsonObject[]);
  const split = await lab.command("cashier", "Bill.Split", { billId, expectedVersion: (await bill$(lab, billId)).version, mode: "quantity", parts: [{ items: [{ lineId: line, quantity: "1" }] }, { items: [{ lineId: line, quantity: "1" }] }] });
  expect(split.status, String(split.code)).toBe("accepted");
  const children = await Promise.all([1, 2].map(async n => refundableComponents((await bill$(lab, `${billId}.${n}`)).state.lines as JsonObject[])));
  for (const w of whole) expect(children.reduce((a, ch) => a + BigInt(String(ch.find(p => p.itemId === w.itemId)!.minor)), 0n)).toBe(BigInt(String(w.minor)));
  for (const ch of children) expect(ch.reduce((a, p) => a + BigInt(String(p.minor)), 0n)).toBe(3n); // and each child still adds up to its own bill
  const eq = await lab.command("cashier", "Bill.Split", { billId: `${billId}.1`, expectedVersion: (await bill$(lab, `${billId}.1`)).version, mode: "equal", parts: 2 });
  expect(eq.status, String(eq.code)).toBe("accepted");
}));

test("R4-4b after one station's food was cancelled, the remaining combo is ready for the guest only when every station made it", () => lab$(async lab => {
  await menu(lab);
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "2" }]), line = String((placed.value.lineIds as string[])[0]);
  const ticket = async (station: string) => (await snaps(lab)).find(t => t.ref.kind === "kitchen-ticket" && t.state.stationId === station)!;
  const ready = async (station: string, actor: string) => { const t = await ticket(station); return lab.command(actor, "Kitchen.Ready", { lineId: t.ref.id, stationId: station, quantity: "1", expectedVersion: t.version }); };
  expect((await ready("kitchen", "chef")).status).toBe("accepted");
  expect((await lab.command("manager", "Order.Amend", { lineId: line, cancelQuantity: "1", reason: "đổi ý", expectedVersion: (await lab.state<V>("order", String(placed.value.orderId))).version })).status).toBe("accepted");
  expect((await ready("bar", "manager")).status).toBe("accepted");
  const guest = async () => (await lab.state<{ ready: string; held: string }>("fulfillment", line));
  expect(await guest()).toMatchObject({ ready: "0", held: "1" }); // the burger made is waiting for its disposition, the one combo left has no burger yet
  expect((await ready("kitchen", "chef")).status).toBe("accepted");
  expect((await guest()).ready).toBe("1");
}));
