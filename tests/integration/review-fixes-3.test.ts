import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import type { JsonObject, Snapshot } from "../../packages/contracts/src/index";
type Lab = Awaited<ReturnType<typeof createRestaurantLab>>;
type Item = { onHand: string; valueMinor: string };
const lab$ = async (body: (lab: Lab) => Promise<void>) => { const lab = await createRestaurantLab(); try { await body(lab); } finally { await lab.close(); } };
const day = (lab: Lab) => new Date(lab.clock.nowMs).toISOString().slice(0, 10);
const snaps = async (lab: Lab): Promise<Snapshot[]> => (await lab.getStore("coordinator")).snapshots(lab.scope);
const items = (combo: JsonObject = {}): JsonObject[] => [
  { id: "rice", name: "Cơm", stationId: "kitchen", unitMinor: "50000", available: true },
  { id: "tea", name: "Trà", stationId: "bar", unitMinor: "20000", available: true },
  { id: "burger", name: "Burger", stationId: "kitchen", unitMinor: "60000", available: true },
  { id: "set", name: "Combo", stationId: "kitchen", unitMinor: "80000", available: true, combo: { components: [{ itemId: "burger", quantity: "1" }, { itemId: "tea", quantity: "2" }], ...combo } },
];
async function menu(lab: Lab, combo: JsonObject = {}) {
  const r = await lab.command("manager", "Catalog.Publish", { version: 2, currency: "VND", items: items(combo), pricing: { taxProfiles: [], defaultTaxProfileId: null, service: null, discountOrder: "before_tax", discounts: [] } });
  expect(r.status, String(r.code)).toBe("accepted");
}
async function patty(lab: Lab, extras = false) {
  await lab.seed("stock-item", "patty", { name: "Patty", baseUnit: "piece", conversions: {}, negativePolicy: "allow", currency: "VND", onHand: "100", valueMinor: "500000", movementSeq: 0 });
  await lab.seed("stock-item", "box", { name: "Hộp", baseUnit: "piece", conversions: {}, negativePolicy: "allow", currency: "VND", onHand: "100", valueMinor: "100000", movementSeq: 0 });
  expect((await lab.command("manager", "Recipe.Publish", { recipeVersion: "burger-v1", itemId: "burger", lines: [{ ingredientId: "patty", quantity: "1", unit: "piece" }] })).status).toBe("accepted");
  if (extras) expect((await lab.command("manager", "Recipe.Publish", { recipeVersion: "set-v1", itemId: "set", lines: [{ ingredientId: "box", quantity: "1", unit: "piece" }] })).status).toBe("accepted");
}
const place = async (lab: Lab, sessionId: string, tableId: string, its: JsonObject[], extra: JsonObject = {}, actor = "manager") => lab.command(actor, "Order.Place", { sessionId, tableId, menuVersion: 2, items: its, ...extra });
async function promo(lab: Lab) {
  await lab.command("manager", "Promotion.Publish", { promotionId: "member", name: "Hội viên", kind: "percent", valueBps: 1000, priority: 1, requiresVoucher: true });
  await lab.command("manager", "Voucher.Issue", { voucherId: "VM", promotionId: "member", limit: 1 });
}

test("P1-1 a voucher that already discounted an order cannot be released and used again", () => lab$(async lab => {
  await menu(lab); await promo(lab);
  for (const [s, t] of [["s1", "table-1"], ["s2", "table-2"]] as const) await lab.command("cashier", "Session.Open", { sessionId: s, tableId: t });
  await lab.command("cashier", "Voucher.Reserve", { voucherId: "VM", ref: "s1" });
  const first = await place(lab, "s1", "table-1", [{ itemId: "rice", quantity: "1" }], { discountIds: ["member"], voucherId: "VM" });
  expect(first.status, String(first.code)).toBe("accepted");
  expect((await lab.command("manager", "Voucher.Release", { voucherId: "VM", ref: "s1", reason: "đổi ý" })).code).toBe("VOUCHER_APPLIED_TO_ORDER");
  expect((await lab.command("cashier", "Voucher.Reserve", { voucherId: "VM", ref: "s2" })).code).toBe("VOUCHER_EXHAUSTED");
  // once the discounted order is cancelled the use may be given back
  const order = await lab.state<{ version: number }>("order", String(first.value.orderId));
  expect((await lab.command("manager", "Order.Cancel", { orderId: String(first.value.orderId), reason: "hủy", expectedVersion: order.version })).status).toBe("accepted");
  expect((await lab.command("manager", "Voucher.Release", { voucherId: "VM", ref: "s1", reason: "đơn đã hủy" })).status).toBe("accepted");
}));

test("P2-3 an amendment takes its session from the order, and a payload that disagrees is refused", () => lab$(async lab => {
  await menu(lab); await promo(lab);
  for (const [s, t] of [["s1", "table-1"], ["s2", "table-2"]] as const) await lab.command("cashier", "Session.Open", { sessionId: s, tableId: t });
  await lab.command("cashier", "Voucher.Reserve", { voucherId: "VM", ref: "s1" });
  const o2 = await place(lab, "s2", "table-2", [{ itemId: "rice", quantity: "1" }]);
  const order = await lab.state<{ version: number }>("order", String(o2.value.orderId));
  const amend = await lab.command("manager", "Order.Amend", { orderId: String(o2.value.orderId), expectedVersion: order.version, sessionId: "s1", items: [{ itemId: "rice", quantity: "1" }], discountIds: ["member"], voucherId: "VM" });
  expect(amend.status).toBe("rejected");
  expect(amend.code).toBe("SESSION_MISMATCH");
}));

test("P1-2 refunding a combo part after a pre-payment cancellation returns the live share only, also on a split bill", () => lab$(async lab => {
  await menu(lab);
  await lab.command("cashier", "Shift.Open", { shiftId: "sh", currency: "VND", openingMinor: "0" });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "2" }], {}, "cashier");
  const line = String((placed.value.lineIds as string[])[0]), order = await lab.state<{ version: number }>("order", String(placed.value.orderId));
  expect((await lab.command("cashier", "Order.Amend", { lineId: line, cancelQuantity: "1", reason: "đổi ý", expectedVersion: order.version })).status).toBe("accepted");
  const prep = await lab.command("cashier", "Bill.Prepare", { sessionId: "s1" });
  const billId = String(prep.value.billId), bill = await lab.state<{ version: number }>("bill", billId);
  const paid = await lab.command("cashier", "Payment.RecordCash", { billId, expectedVersion: bill.version, amountMinor: "80000", currency: "VND" });
  expect(paid.status, String(paid.code)).toBe("accepted");
  const refund = async (extra: JsonObject) => lab.command("manager", "Refund.Record", { paymentId: String(paid.value.paymentId), reason: "trà hỏng", expectedVersion: (await lab.state<{ version: number }>("payment", String(paid.value.paymentId))).version, ...extra });
  expect((await refund({ amountMinor: "64000", component: { lineId: line, itemId: "tea" } })).code).toBe("COMPONENT_AMOUNT_MISMATCH"); // the tea of BOTH combos
  expect((await refund({ amountMinor: "32000", component: { lineId: line, itemId: "tea" } })).status).toBe("accepted"); // the tea of the one combo that was sold
}));

test("P1-2b a split bill keeps the combo shares conserved", () => lab$(async lab => {
  await menu(lab);
  await lab.command("cashier", "Shift.Open", { shiftId: "sh", currency: "VND", openingMinor: "0" });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "2" }], {}, "cashier");
  const line = String((placed.value.lineIds as string[])[0]);
  const prep = await lab.command("cashier", "Bill.Prepare", { sessionId: "s1" }), billId = String(prep.value.billId);
  const split = await lab.command("cashier", "Bill.Split", { billId, expectedVersion: (await lab.state<{ version: number }>("bill", billId)).version, mode: "quantity", parts: [{ items: [{ lineId: line, quantity: "1" }] }, { items: [{ lineId: line, quantity: "1" }] }] });
  expect(split.status, String(split.code)).toBe("accepted");
  const child = `${billId}.1`, paid = await lab.command("cashier", "Payment.RecordCash", { billId: child, expectedVersion: (await lab.state<{ version: number }>("bill", child)).version, amountMinor: "80000", currency: "VND" });
  expect(paid.status, String(paid.code)).toBe("accepted");
  const refund = async (amountMinor: string) => lab.command("manager", "Refund.Record", { paymentId: String(paid.value.paymentId), reason: "trà hỏng", expectedVersion: (await lab.state<{ version: number }>("payment", String(paid.value.paymentId))).version, amountMinor, component: { lineId: line, itemId: "tea" } });
  expect((await refund("64000")).code).toBe("COMPONENT_AMOUNT_MISMATCH");
  expect((await refund("32000")).status).toBe("accepted");
}));

test("F07 a multi-station combo gets a ticket per station and is ready for the guest only when every station is done", () => lab$(async lab => {
  await menu(lab);
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "1" }]);
  const line = String((placed.value.lineIds as string[])[0]);
  const tickets = (await snaps(lab)).filter(s => s.ref.kind === "kitchen-ticket");
  expect(tickets.map(t => [t.state.stationId, t.state.lineId]).sort()).toEqual([["bar", line], ["kitchen", line]]);
  const bar = tickets.find(t => t.state.stationId === "bar")!, kitchen = tickets.find(t => t.state.stationId === "kitchen")!;
  expect((bar.state.components as JsonObject[]).map(p => p.itemId)).toEqual(["tea"]);
  expect((kitchen.state.components as JsonObject[]).map(p => p.itemId)).toEqual(["burger"]);
  expect((await lab.command("chef", "Kitchen.Ready", { lineId: kitchen.ref.id, stationId: "kitchen", quantity: "1", expectedVersion: 1 })).status).toBe("accepted");
  expect((await lab.state<{ ready: string }>("fulfillment", line)).ready).toBe("0"); // the bar has not finished
  expect((await lab.command("manager", "Kitchen.Ready", { lineId: bar.ref.id, stationId: "bar", quantity: "1", expectedVersion: 1 })).status).toBe("accepted");
  expect((await lab.state<{ ready: string }>("fulfillment", line)).ready).toBe("1");
}));

test("P2-4 cancelling part of a combo leaves per-combo stock use unchanged", () => lab$(async lab => {
  await menu(lab); await patty(lab);
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "2" }]);
  const line = String((placed.value.lineIds as string[])[0]), order = await lab.state<{ version: number }>("order", String(placed.value.orderId));
  expect((await lab.command("manager", "Order.Amend", { lineId: line, cancelQuantity: "1", reason: "đổi ý", expectedVersion: order.version })).status).toBe("accepted");
  const kitchen = (await snaps(lab)).find(t => t.ref.kind === "kitchen-ticket" && t.state.stationId === "kitchen")!;
  expect((await lab.command("chef", "Kitchen.Ready", { lineId: kitchen.ref.id, stationId: "kitchen", quantity: "1", expectedVersion: kitchen.version })).status).toBe("accepted");
  expect((await lab.state<Item>("stock-item", "patty")).onHand).toBe("99"); // one burger, not two
}));

test("F26 a combo recipe is either the whole dish or declared extras on top of its parts, never both by accident", () => lab$(async lab => {
  const ready = async (stockMode?: string) => {
    await menu(lab, stockMode ? { stockMode } : {}); await patty(lab, true);
    await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
    const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "1" }]);
    const kitchen = (await snaps(lab)).find(t => t.ref.kind === "kitchen-ticket" && t.state.stationId === "kitchen" && t.state.orderId === placed.value.orderId)!;
    await lab.command("chef", "Kitchen.Ready", { lineId: kitchen.ref.id, stationId: "kitchen", quantity: "1", expectedVersion: kitchen.version });
  };
  await ready(); // default "parts": the part's recipe + the combo recipe as declared extras (the box)
  expect(await lab.state<Item>("stock-item", "patty")).toMatchObject({ onHand: "99" });
  expect(await lab.state<Item>("stock-item", "box")).toMatchObject({ onHand: "99" });
}));

test("F26 stockMode whole consumes the combo recipe only", () => lab$(async lab => {
  await menu(lab, { stockMode: "whole" }); await patty(lab, true);
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "set", quantity: "1" }]);
  const kitchen = (await snaps(lab)).find(t => t.ref.kind === "kitchen-ticket" && t.state.stationId === "kitchen")!;
  expect((await lab.command("chef", "Kitchen.Ready", { lineId: kitchen.ref.id, stationId: "kitchen", quantity: "1", expectedVersion: kitchen.version })).status).toBe("accepted");
  expect((await lab.state<Item>("stock-item", "patty")).onHand).toBe("100");
  expect((await lab.state<Item>("stock-item", "box")).onHand).toBe("99");
  void placed;
}));

test("P2-5 resolving a pending deposit cannot swap its reference or currency", () => lab$(async lab => {
  const d = (depositId: string, reference: string, extra: JsonObject = {}) => lab.command("cashier", "Deposit.Receive", { depositId, amountMinor: "100000", method: "transfer_manual", reference, ...extra });
  expect((await d("d1", "A1", { status: "pending" })).status).toBe("accepted");
  expect((await d("d2", "B2")).status).toBe("accepted");
  expect((await d("d1", "B2", { status: "paid" })).code).toBe("DEPOSIT_CONFLICT");
  expect((await d("d1", "A1", { status: "paid", currency: "USD" })).code).toBe("DEPOSIT_CONFLICT");
  expect((await d("d1", "a-1", { status: "paid" })).status).toBe("accepted"); // same reference, however typed
}));

test("P2-6 stock received over a negative balance leaves the covered value in the ledgers", () => lab$(async lab => {
  await lab.seed("stock-item", "rice-raw", { name: "Gạo", baseUnit: "g", conversions: {}, negativePolicy: "allow", currency: "VND", onHand: "-10", valueMinor: "0", movementSeq: 0 });
  await lab.seed("purchase", "po-neg", { supplierId: "supplier-1", currency: "VND", status: "approved", lines: [{ ingredientId: "rice-raw", unit: "g", ordered: "100", received: "0", returned: "0", tolerance: "0", unitCostMinor: "10", perBase: "1" }], version: 2 });
  expect((await lab.command("manager", "Goods.Receive", { purchaseId: "po-neg", supplierReceipt: "N1", ingredientId: "rice-raw", quantity: "20" })).status).toBe("accepted");
  expect((await lab.state<Item>("stock-item", "rice-raw")).valueMinor).toBe("100");
  const mv = (await snaps(lab)).find(s => s.ref.kind === "stock-movement" && s.state.kind === "receipt")!;
  expect(mv.state).toMatchObject({ valueMinor: "200", backfillMinor: "100" });
  const stock = await lab.report("stock", day(lab)), cost = (await lab.report("food-cost", day(lab))).totals as JsonObject;
  expect(((stock.totals as JsonObject).valueByKind as Record<string, { valueMinor: string }>).receipt!.valueMinor).toBe("100"); // reconciles to the balance
  expect(cost.backfillCostMinor).toBe("100");
  expect(cost.foodCostMinor).toBe("100");
}));

test("P2-7 a stock exception is reported and can be closed with its link to source and recipe", () => lab$(async lab => {
  await menu(lab);
  await lab.seed("stock-item", "rice-raw", { name: "Gạo", baseUnit: "g", conversions: {}, negativePolicy: "block", currency: "VND", onHand: "100", valueMinor: "2000", movementSeq: 0 });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await place(lab, "s1", "table-1", [{ itemId: "rice", quantity: "2" }], {}, "cashier");
  const line = String((placed.value.lineIds as string[])[0]);
  await lab.command("chef", "Kitchen.Ready", { lineId: line, stationId: "kitchen", quantity: "2", expectedVersion: 1 });
  const totals = async () => (await lab.report("food-cost", day(lab))).totals as JsonObject;
  expect(await totals()).toMatchObject({ openStockExceptions: 1, missingCostLines: 1 });
  const exc = (await snaps(lab)).find(s => s.ref.kind === "stock-exception")!;
  expect(exc.state).toMatchObject({ recipeVersion: "rice-v1", status: "open" });
  expect((await lab.command("chef", "Inventory.ResolveException", { exceptionId: exc.ref.id, disposition: "waive", reason: "x", expectedVersion: exc.version })).code).toBe("FORBIDDEN");
  expect((await lab.command("manager", "Inventory.ResolveException", { exceptionId: exc.ref.id, disposition: "consume", reason: "đã nhập gạo", expectedVersion: exc.version })).code).toBe("INSUFFICIENT_STOCK");
  await lab.seed("stock-item", "rice-raw", { name: "Gạo", baseUnit: "g", conversions: {}, negativePolicy: "block", currency: "VND", onHand: "10000", valueMinor: "200000", movementSeq: 1 });
  const r = await lab.command("manager", "Inventory.ResolveException", { exceptionId: exc.ref.id, disposition: "consume", reason: "đã nhập gạo", expectedVersion: exc.version });
  expect(r.status, String(r.code)).toBe("accepted");
  expect(await lab.count("StockConsumed")).toBe(1);
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9600");
  expect(await lab.state<JsonObject>("stock-exception", exc.ref.id)).toMatchObject({ status: "resolved", disposition: "consume" });
  expect(await totals()).toMatchObject({ openStockExceptions: 0 });
}));

test("P2-8 a cash deposit return needs a drawer in the deposit's currency", () => lab$(async lab => {
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "500000" });
  await lab.command("manager", "Shift.Open", { currency: "VND", openingMinor: "500000" });
  expect((await lab.command("cashier", "Deposit.Receive", { depositId: "usd", amountMinor: "1000", method: "transfer_manual", reference: "USD-1", currency: "USD" })).status).toBe("accepted");
  expect((await lab.command("manager", "Deposit.Return", { depositId: "usd", amountMinor: "1000", method: "cash", reason: "hoàn" })).code).toBe("CURRENCY_MISMATCH");
}));

test("W09 note: a merge carries the chain-pending points too, so a later reversal finds them", () => lab$(async lab => {
  await lab.command("cashier", "Customer.Upsert", { customerId: "c-target", name: "Đích" });
  await lab.seed("loyalty-account", "customer-1", { balance: "0", earned: "0", redeemed: "0", pending: "0", scope: "chain" });
  expect((await lab.command("cashier", "Loyalty.Earn", { customerId: "customer-1", settlementId: "pay-1", points: "100" })).status).toBe("accepted");
  expect((await lab.state<{ pending: string }>("loyalty-account", "customer-1")).pending).toBe("100");
  expect((await lab.command("manager", "Customer.Merge", { sourceId: "customer-1", targetId: "c-target", reason: "trùng" })).status).toBe("accepted");
  const pay = await lab.state<{ version: number }>("payment", "pay-1");
  await lab.command("manager", "Shift.Open", { currency: "VND", openingMinor: "500000" });
  const refund = await lab.command("manager", "Refund.Record", { paymentId: "pay-1", amountMinor: "100000", reason: "khách trả", expectedVersion: pay.version });
  expect(refund.status, String(refund.code)).toBe("accepted");
  expect((await lab.command("manager", "Loyalty.Reverse", { customerId: "customer-1", refundId: String(refund.value.refundId) })).status).toBe("accepted");
  expect((await lab.state<{ pending: string }>("loyalty-account", "customer-1")).pending).toBe("0");
  expect((await lab.state<{ pending: string }>("loyalty-account", "c-target")).pending).toBe("0");
}));
