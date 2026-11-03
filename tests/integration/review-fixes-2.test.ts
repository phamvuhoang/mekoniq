import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { issue, receive } from "../../packages/domain/src/inventory/movement";
import type { JsonObject } from "../../packages/contracts/src/index";
type Lab = Awaited<ReturnType<typeof createRestaurantLab>>;
type Item = { onHand: string; valueMinor: string };
const lab$ = async (body: (lab: Lab) => Promise<void>) => { const lab = await createRestaurantLab(); try { await body(lab); } finally { await lab.close(); } };
const day = (lab: Lab) => new Date(lab.clock.nowMs).toISOString().slice(0, 10);
const burger: JsonObject[] = [
  { id: "rice", name: "Cơm", stationId: "kitchen", unitMinor: "50000", available: true },
  { id: "tea", name: "Trà", stationId: "bar", unitMinor: "20000", available: true },
  { id: "burger", name: "Burger", stationId: "kitchen", unitMinor: "60000", available: true },
  { id: "set", name: "Combo", stationId: "kitchen", unitMinor: "80000", available: true, combo: { components: [{ itemId: "burger", quantity: "1" }, { itemId: "tea", quantity: "2" }] } },
];
async function menu(lab: Lab, items = burger, extra: JsonObject = {}) {
  const r = await lab.command("manager", "Catalog.Publish", { version: 2, currency: "VND", items, pricing: { taxProfiles: [], defaultTaxProfileId: null, service: null, discountOrder: "before_tax", discounts: [] }, ...extra });
  expect(r.status, String(r.code)).toBe("accepted");
}
async function promo(lab: Lab) {
  expect((await lab.command("manager", "Promotion.Publish", { promotionId: "member", name: "Hội viên", kind: "percent", valueBps: 1000, priority: 1, requiresVoucher: true })).status).toBe("accepted");
  await lab.command("manager", "Voucher.Issue", { voucherId: "VM", promotionId: "member", limit: 1 });
}

test("#1 a single-use voucher discounts only the session that holds it, and only one order", () => lab$(async lab => {
  await menu(lab); await promo(lab);
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  await lab.command("cashier", "Session.Open", { sessionId: "s2", tableId: "table-2" });
  await lab.command("cashier", "Voucher.Reserve", { voucherId: "VM", ref: "s1" });
  const order = (sessionId: string, tableId: string) => lab.command("manager", "Order.Place", { sessionId, tableId, menuVersion: 2, items: [{ itemId: "rice", quantity: "1" }], discountIds: ["member"], voucherId: "VM", voucherRef: "s1" });
  expect((await order("s2", "table-2")).code).toBe("VOUCHER_NOT_HELD");
  const first = await order("s1", "table-1");
  expect(first.status, String(first.code)).toBe("accepted");
  expect((await lab.state<{ totalMinor: string }>("order", String(first.value.orderId))).totalMinor).toBe("45000");
  expect((await order("s1", "table-1")).code).toBe("VOUCHER_ALREADY_APPLIED");
}));

test("#2 one bank transfer reference is one deposit, however it is typed", () => lab$(async lab => {
  const d = (depositId: string, reference: string, extra: JsonObject = {}) => lab.command("cashier", "Deposit.Receive", { depositId, amountMinor: "100000", method: "transfer_manual", reference, ...extra });
  expect((await d("d1", "FT 123-ABC")).status).toBe("accepted");
  expect((await d("d2", "ft123abc")).code).toBe("DEPOSIT_REFERENCE_REUSED");
  expect(await lab.count("DepositReceived")).toBe(1);
  expect((await d("d3", "FT999")).status).toBe("accepted");
}));

test("#3 a refund after a customer merge takes the points back from the account that holds them", () => lab$(async lab => {
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "500000" });
  await lab.command("manager", "Shift.Open", { currency: "VND", openingMinor: "500000" });
  await lab.command("cashier", "Customer.Upsert", { customerId: "c-target", name: "Đích" });
  expect((await lab.command("cashier", "Loyalty.Earn", { customerId: "customer-1", settlementId: "pay-1", points: "100" })).status).toBe("accepted");
  expect((await lab.command("manager", "Customer.Merge", { sourceId: "customer-1", targetId: "c-target", reason: "trùng" })).status).toBe("accepted");
  const pay = await lab.state<{ version: number }>("payment", "pay-1");
  const refund = await lab.command("manager", "Refund.Record", { paymentId: "pay-1", amountMinor: "100000", reason: "khách trả", expectedVersion: pay.version });
  expect(refund.status, String(refund.code)).toBe("accepted");
  const r = await lab.command("manager", "Loyalty.Reverse", { customerId: "customer-1", refundId: String(refund.value.refundId) });
  expect(r.status, String(r.code)).toBe("accepted");
  expect((await lab.state<{ balance: string }>("loyalty-account", "c-target")).balance).toBe("0");
  expect((await lab.state<{ balance: string }>("loyalty-account", "customer-1")).balance).toBe("0");
}));

test("#4 stock received over a negative balance is valued per unit, not as a lump", () => {
  const item = { onHand: "-10", valueMinor: "0", movementSeq: 0 };
  const r1 = receive(item, 20n, 200n);
  expect(r1).toMatchObject({ onHand: "10", valueMinor: "100" }); // 10 units cover the shortfall, 10 remain at 10 each
  expect(issue(r1, 1n).costMinor).toBe(10n);
  const r2 = receive({ onHand: "-5", valueMinor: "0", movementSeq: 0 }, 3n, 30n);
  expect(r2).toMatchObject({ onHand: "-2", valueMinor: "0" });
  expect(receive(r2, 10n, 100n)).toMatchObject({ onHand: "8", valueMinor: "80" });
  expect(receive({ onHand: "5", valueMinor: "50", movementSeq: 0 }, 5n, 100n)).toMatchObject({ onHand: "10", valueMinor: "150" }); // the normal case is unchanged
});

test("#5 + F19 kitchen ready deducts stock in the same decision, and discarded cooked food becomes waste", () => lab$(async lab => {
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await lab.command("cashier", "Order.Place", { sessionId: "s1", tableId: "table-1", menuVersion: 1, items: [{ itemId: "rice", quantity: "2" }] });
  expect(placed.status, String(placed.code)).toBe("accepted");
  const line = String((placed.value.lineIds as string[])[0]);
  expect((await lab.command("chef", "Kitchen.Ready", { lineId: line, stationId: "kitchen", quantity: "2", expectedVersion: 1 })).status).toBe("accepted");
  expect(await lab.count("StockConsumed")).toBe(1);
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9600");
  const order = await lab.state<{ version: number }>("order", String(placed.value.orderId));
  const cancel = await lab.command("cashier", "Order.Amend", { lineId: line, cancelQuantity: "1", reason: "khách đổi ý", expectedVersion: order.version });
  expect(cancel.status, String(cancel.code)).toBe("accepted");
  const disposed = await lab.command("chef", "Kitchen.DisposePrepared", { cancellationId: String(cancel.value.cancellationId), stationId: "kitchen", disposition: "waste", expectedVersion: 1 });
  expect(disposed.status, String(disposed.code)).toBe("accepted");
  expect(await lab.count("StockWasted")).toBe(1);
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9600"); // nothing is deducted a second time, nothing comes back
  expect(((await lab.report("food-cost", day(lab))).totals as JsonObject).preparedWasteCostMinor).toBe("4000");
}));

test("#6 a combo's ticket names its parts and the parts' recipes are consumed", () => lab$(async lab => {
  await menu(lab);
  await lab.command("manager", "Ingredient.Upsert", { ingredientId: "patty", name: "Patty", baseUnit: "piece" });
  await lab.seed("stock-item", "patty", { name: "Patty", baseUnit: "piece", conversions: {}, negativePolicy: "allow", currency: "VND", onHand: "100", valueMinor: "500000", movementSeq: 0 });
  await lab.command("manager", "Recipe.Publish", { recipeVersion: "burger-v1", itemId: "burger", lines: [{ ingredientId: "patty", quantity: "1", unit: "piece" }] });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await lab.command("cashier", "Order.Place", { sessionId: "s1", tableId: "table-1", menuVersion: 2, items: [{ itemId: "set", quantity: "2" }] });
  expect(placed.status, String(placed.code)).toBe("accepted");
  const line = String((placed.value.lineIds as string[])[0]);
  // the combo is made at two stations: each station's ticket names its own parts (burger at the kitchen, tea at the bar)
  const parts = (await (await lab.getStore("coordinator")).snapshots(lab.scope)).filter(t => t.ref.kind === "kitchen-ticket" && t.state.lineId === line).flatMap(t => t.state.components as { itemId: string; quantity: string }[]);
  expect(parts.map(p => [p.itemId, p.quantity]).sort()).toEqual([["burger", "2"], ["tea", "4"]]);
  expect((await lab.command("chef", "Kitchen.Ready", { lineId: line, stationId: "kitchen", quantity: "2", expectedVersion: 1 })).status).toBe("accepted");
  expect((await lab.state<Item>("stock-item", "patty")).onHand).toBe("98");
}));

test("F19 a ready event that cannot be costed opens a visible stock exception instead of passing silently", () => lab$(async lab => {
  await lab.seed("stock-item", "rice-raw", { name: "Gạo", baseUnit: "g", conversions: {}, negativePolicy: "block", currency: "VND", onHand: "100", valueMinor: "2000", movementSeq: 0 });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await lab.command("cashier", "Order.Place", { sessionId: "s1", tableId: "table-1", menuVersion: 1, items: [{ itemId: "rice", quantity: "2" }] });
  const line = String((placed.value.lineIds as string[])[0]);
  expect((await lab.command("chef", "Kitchen.Ready", { lineId: line, stationId: "kitchen", quantity: "2", expectedVersion: 1 })).status).toBe("accepted"); // the food is cooked either way
  expect(await lab.count("StockConsumed")).toBe(0);
  expect(await lab.count("StockExceptionOpened")).toBe(1);
}));

test("#7 a second attendance amendment is checked against the already amended times", () => lab$(async lab => {
  await lab.seed("attendance", "att-1", { userId: "chef", status: "closed", clockInAt: "2026-10-30T08:00:00.000Z", clockOutAt: "2026-10-30T16:00:00.000Z" });
  const fix = (extra: JsonObject) => lab.command("manager", "Staff.ApproveCorrection", { attendanceId: "att-1", reason: "quên bấm", ...extra });
  expect((await fix({ clockOutAt: "2026-10-30T10:00:00.000Z" })).status).toBe("accepted");
  expect((await fix({ clockInAt: "2026-10-30T12:00:00.000Z" })).code).toBe("NEGATIVE_DURATION");
  expect((await fix({ clockInAt: "2026-10-30T09:00:00.000Z" })).status).toBe("accepted");
}));

test("#8 a booking cannot be confirmed on a deposit that was returned", () => lab$(async lab => {
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "500000" });
  const [a, b] = ["2026-10-30T18:00:00.000Z", "2026-10-30T19:00:00.000Z"];
  await lab.command("cashier", "Booking.Create", { bookingId: "bk", tableId: "table-1", startsAt: a, endsAt: b, partySize: 2, name: "An", depositRequiredMinor: "100000" });
  await lab.command("cashier", "Deposit.Receive", { depositId: "d", bookingId: "bk", amountMinor: "100000", method: "cash" });
  expect((await lab.command("manager", "Deposit.Return", { depositId: "d", amountMinor: "100000", method: "cash", reason: "khách đổi ý" })).status).toBe("accepted");
  const v = (await lab.state<{ version: number }>("booking", "bk")).version;
  expect((await lab.command("manager", "Booking.Confirm", { bookingId: "bk", expectedVersion: v })).code).toBe("DEPOSIT_REQUIRED");
}));

test("#9 with service.models off, combo items cannot be sold through the order path", () => lab$(async lab => {
  await menu(lab);
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const place = () => lab.command("cashier", "Order.Place", { sessionId: "s1", tableId: "table-1", menuVersion: 2, items: [{ itemId: "set", quantity: "1" }] });
  const first = await place(); expect(first.status, String(first.code)).toBe("accepted");
  const cfg = await lab.state<JsonObject>("configuration", "applied");
  await lab.seed("configuration", "applied", { ...cfg, features: { ...(cfg.features as JsonObject), "service.models": { status: "disabled", revision: 1 } }, version: Number(cfg.version) + 1 });
  const again = await lab.command("cashier", "Order.Place", { sessionId: "s1", tableId: "table-1", menuVersion: 2, items: [{ itemId: "set", quantity: "1" }] });
  expect(again.status).toBe("rejected");
  expect(String(again.code)).not.toBe("accepted");
  expect((await lab.command("cashier", "Order.Place", { sessionId: "s1", tableId: "table-1", menuVersion: 2, items: [{ itemId: "rice", quantity: "1" }] })).status).toBe("accepted"); // plain items still sell
}));

test("a single part of a combo can be refunded at its frozen share, once", () => lab$(async lab => {
  await menu(lab);
  await lab.command("cashier", "Shift.Open", { shiftId: "s1", currency: "VND", openingMinor: "0" });
  await lab.command("cashier", "Session.Open", { sessionId: "s1", tableId: "table-1" });
  const placed = await lab.command("cashier", "Order.Place", { sessionId: "s1", tableId: "table-1", menuVersion: 2, items: [{ itemId: "set", quantity: "1" }] });
  const prep = await lab.command("cashier", "Bill.Prepare", { sessionId: "s1" });
  expect(prep.status, String(prep.code)).toBe("accepted");
  const billId = String(prep.value.billId), bill = await lab.state<{ lines: JsonObject[]; version: number }>("bill", billId);
  const paid = await lab.command("cashier", "Payment.RecordCash", { billId, expectedVersion: bill.version, amountMinor: "80000", currency: "VND" });
  expect(paid.status, String(paid.code)).toBe("accepted");
  const lineId = String(bill.lines[0]!.id), parts = bill.lines[0]!.components as { itemId: string; shareMinor: string; discountMinor: string }[];
  const tea = parts.find(p => p.itemId === "tea")!, share = String(BigInt(tea.shareMinor) - BigInt(tea.discountMinor));
  const refund = async (extra: JsonObject) => lab.command("manager", "Refund.Record", { paymentId: String(paid.value.paymentId), reason: "trà hỏng", expectedVersion: (await lab.state<{ version: number }>("payment", String(paid.value.paymentId))).version, ...extra });
  expect((await refund({ amountMinor: "1", component: { lineId, itemId: "tea" } })).code).toBe("COMPONENT_AMOUNT_MISMATCH");
  expect((await refund({ amountMinor: share, component: { lineId, itemId: "ghost" } })).code).toBe("COMPONENT_NOT_FOUND");
  const ok = await refund({ amountMinor: share, component: { lineId, itemId: "tea" } });
  expect(ok.status, String(ok.code)).toBe("accepted");
  expect((await refund({ amountMinor: share, component: { lineId, itemId: "tea" } })).code).toBe("COMPONENT_ALREADY_REFUNDED");
  void placed;
}));
