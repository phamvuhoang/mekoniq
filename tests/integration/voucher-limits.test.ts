import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import type { JsonObject } from "../../packages/contracts/src/index";
type Lab = Awaited<ReturnType<typeof createRestaurantLab>>;
type Voucher = { remaining: number; escrow?: Record<string, { count: number; revision: number }> };
const lab$ = async (body: (lab: Lab) => Promise<void>) => { const lab = await createRestaurantLab(); try { await body(lab); } finally { await lab.close(); } };
const uses = async (lab: Lab) => (await (await lab.getStore("coordinator")).snapshots(lab.scope)).filter(s => s.ref.kind === "voucher-use");

test("a single-use voucher cannot be spent twice concurrently", () => lab$(async lab => {
  await lab.seed("voucher", "V1", { remaining: 1, scope: "venue-a" });
  const rs = await Promise.all(["a", "b"].map(id => lab.command("cashier", "Voucher.Redeem",
    { voucherId: "V1", billId: id }, "voucher-" + id)));
  expect(rs.filter(r => r.status === "accepted")).toHaveLength(1);
  expect((await lab.state<Voucher>("voucher", "V1")).remaining).toBe(0);
}));

test("a retried redemption is one use; the limit is then enforced", () => lab$(async lab => {
  await lab.command("manager", "Voucher.Issue", { voucherId: "V2", limit: 2 });
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V2", billId: "b1" }, "r1")).status).toBe("accepted");
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V2", billId: "b1" }, "r1-retry")).status).toBe("accepted");
  expect((await lab.state<Voucher>("voucher", "V2")).remaining).toBe(1);
  expect(await lab.count("VoucherRedeemed")).toBe(1);
  await lab.command("cashier", "Voucher.Redeem", { voucherId: "V2", billId: "b2" });
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V2", billId: "b3" })).code).toBe("VOUCHER_EXHAUSTED");
}));

test("a reservation holds the use until it is explicitly released or redeemed; time never frees it", () => lab$(async lab => {
  await lab.command("manager", "Voucher.Issue", { voucherId: "V3", limit: 1 });
  expect((await lab.command("cashier", "Voucher.Reserve", { voucherId: "V3", ref: "session-1" })).status).toBe("accepted");
  await lab.command("cashier", "Voucher.Reserve", { voucherId: "V3", ref: "session-1" }, "retry");
  await lab.advance(72 * 3600_000); // payment result still unknown three days later: the hold stays
  expect((await lab.command("cashier", "Voucher.Reserve", { voucherId: "V3", ref: "session-2" })).code).toBe("VOUCHER_EXHAUSTED");
  expect((await lab.state<Voucher>("voucher", "V3")).remaining).toBe(0);
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V3", billId: "bill-1", reservedRef: "session-1" })).status).toBe("accepted");
  expect((await lab.state<Voucher>("voucher", "V3")).remaining).toBe(0); // converting a hold takes nothing more
  expect((await uses(lab))[0]!.state).toMatchObject({ status: "redeemed", billId: "bill-1" });
  await lab.command("manager", "Voucher.Issue", { voucherId: "V4", limit: 1 });
  await lab.command("cashier", "Voucher.Reserve", { voucherId: "V4", ref: "s9" });
  expect((await lab.command("cashier", "Voucher.Release", { voucherId: "V4", ref: "s9", reason: "khách đổi ý" })).status).toBe("accepted");
  expect((await lab.state<Voucher>("voucher", "V4")).remaining).toBe(1);
  expect((await lab.command("cashier", "Voucher.Release", { voucherId: "V3", ref: "bill-1", reason: "x" })).code).toBe("ALREADY_REDEEMED");
}));

test("a refund restores usage only under the snapshot policy and only once per refund", () => lab$(async lab => {
  await lab.command("manager", "Voucher.Issue", { voucherId: "V5", limit: 1, restoreOnRefund: true });
  await lab.command("manager", "Voucher.Issue", { voucherId: "V6", limit: 1 });
  for (const v of ["V5", "V6"]) await lab.command("cashier", "Voucher.Redeem", { voucherId: v, billId: "b-" + v });
  const restore = (v: string, source: string) => lab.command("manager", "Voucher.Release", { voucherId: v, ref: "b-" + v, reason: "hoàn tiền", reversalSource: source });
  expect((await restore("V5", "refund-1")).code).toBe("REFUND_NOT_FOUND");
  await lab.seed("refund", "refund-1", { paymentId: "p", amountMinor: "1" });
  await lab.seed("refund", "refund-2", { paymentId: "p", amountMinor: "1" });
  expect((await restore("V6", "refund-1")).code).toBe("RESTORE_NOT_ALLOWED");
  expect((await restore("V5", "refund-1")).status).toBe("accepted");
  expect((await restore("V5", "refund-1")).status).toBe("accepted"); // same refund again: nothing more is restored
  expect((await restore("V5", "refund-2")).code).toBe("ALREADY_REVERSED");
  expect((await lab.state<Voucher>("voucher", "V5")).remaining).toBe(1);
}));

test("validity is checked on the venue business date, not UTC", () => lab$(async lab => {
  await lab.seed("venue-layout", "current", { timezone: "Asia/Ho_Chi_Minh" });
  await lab.command("manager", "Voucher.Issue", { voucherId: "V7", limit: 5, validFrom: "2026-03-10", validTo: "2026-03-10" });
  lab.clock.nowMs = Date.parse("2026-03-10T16:30:00.000Z"); // 23:30 on the 10th in Vietnam
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V7", billId: "late-ok" })).status).toBe("accepted");
  lab.clock.nowMs = Date.parse("2026-03-10T17:30:00.000Z"); // 00:30 on the 11th
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V7", billId: "too-late" })).code).toBe("VOUCHER_EXPIRED");
  lab.clock.nowMs = Date.parse("2026-03-09T16:30:00.000Z"); // 23:30 on the 9th
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V7", billId: "too-early" })).code).toBe("VOUCHER_NOT_STARTED");
}));

test("per-customer limits need a customer and count holds as well as redemptions", () => lab$(async lab => {
  await lab.command("manager", "Voucher.Issue", { voucherId: "V8", limit: 10, perCustomerLimit: 1 });
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V8", billId: "x1" })).code).toBe("CUSTOMER_REQUIRED");
  expect((await lab.command("cashier", "Voucher.Reserve", { voucherId: "V8", ref: "s1", customerId: "c1" })).status).toBe("accepted");
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V8", billId: "x2", customerId: "c1" })).code).toBe("CUSTOMER_LIMIT_REACHED");
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "V8", billId: "x3", customerId: "c2" })).status).toBe("accepted");
}));

test("a venue-scoped voucher is refused elsewhere; a shared one is denied offline without an exclusive allocation", () => lab$(async lab => {
  await lab.seed("voucher", "VX", { remaining: 5, scope: "venue-b" });
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "VX", billId: "b" })).code).toBe("VOUCHER_SCOPE_DENIED");
  await lab.command("manager", "Voucher.Issue", { voucherId: "VS", limit: 10, scope: "shared" });
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "VS", billId: "b1" })).code).toBe("SHARED_VOUCHER_OFFLINE_DENIED");
  expect((await lab.command("manager", "Voucher.GrantEscrow", { voucherId: "VS", venueId: "venue-a", count: 11 })).code).toBe("VOUCHER_EXHAUSTED");
  expect((await lab.command("manager", "Voucher.GrantEscrow", { voucherId: "VS", venueId: "venue-a", count: 2 })).status).toBe("accepted");
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "VS", billId: "b2", grantRevision: 99 })).code).toBe("STALE_GRANT");
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "VS", billId: "b2", grantRevision: 1 })).status).toBe("accepted");
  await lab.command("cashier", "Voucher.Redeem", { voucherId: "VS", billId: "b3" });
  expect((await lab.command("cashier", "Voucher.Redeem", { voucherId: "VS", billId: "b4" })).code).toBe("SHARED_VOUCHER_OFFLINE_DENIED");
  const v = await lab.state<Voucher>("voucher", "VS");
  expect(v.remaining).toBe(8); // the pool only gave away what was explicitly granted
  expect(v.escrow!["venue-a"]!.count).toBe(0);
}));

test("only a manager publishes promotions and vouchers; a cashier cannot", () => lab$(async lab => {
  expect((await lab.command("cashier", "Voucher.Issue", { voucherId: "VC", limit: 1 })).code).toBe("FORBIDDEN");
  expect((await lab.command("cashier", "Promotion.Publish", { promotionId: "p", name: "x", kind: "percent", valueBps: 100 })).code).toBe("FORBIDDEN");
}));

// ---- promotions in pricing: deterministic, capped, exclusive groups -------------------------------------------------
const promo = (lab: Lab, id: string, extra: JsonObject = {}) => lab.command("manager", "Promotion.Publish", { promotionId: id, name: id, kind: "percent", valueBps: 1000, ...extra });
async function order(lab: Lab, actor: string, discountIds: string[], extra: JsonObject = {}, sessionId = "session-1") {
  await lab.command("cashier", "Session.Open", { sessionId, tableId: sessionId === "session-1" ? "table-1" : "table-2" });
  return lab.command(actor, "Order.Place", { sessionId, tableId: sessionId === "session-1" ? "table-1" : "table-2", menuVersion: 1, items: [{ itemId: "rice", quantity: "2" }], discountIds, ...extra });
}
const total = async (lab: Lab, r: { value: JsonObject }) => (await lab.state<{ totalMinor: string }>("order", String(r.value.orderId))).totalMinor;

test("promotions apply by priority, never stack inside an exclusion group and never push a total below zero", () => lab$(async lab => {
  await promo(lab, "pct", { priority: 10, itemIds: ["rice"] });
  await promo(lab, "fixed", { kind: "fixed", amountMinor: "999999", priority: 5 });
  await promo(lab, "g1", { exclusionGroup: "loyalty" });
  await promo(lab, "g2", { exclusionGroup: "loyalty", valueBps: 2000 });
  const first = await order(lab, "manager", ["pct"]);
  expect(first.status).toBe("accepted");
  expect(await total(lab, first)).toBe("90000"); // 10% of 100 000
  expect((await order(lab, "manager", ["g1", "g2"], {}, "session-2")).code).toBe("PROMOTION_EXCLUDED");
  const capped = await lab.command("manager", "Catalog.Quote", { items: [{ itemId: "rice", quantity: "2" }], discountIds: ["fixed", "pct"] });
  expect(capped.status).toBe("accepted");
  expect(capped.value.totalMinor).toBe("0"); // deterministic plan: pct (priority 10) first, then the fixed coupon, capped to what is left
  expect((capped.value.lines as JsonObject[])[0]!.discountMinor).toBe("100000");
}));

test("eligibility: channel, customer, items, retired and unknown promotions", () => lab$(async lab => {
  await promo(lab, "qr-only", { channels: ["qr"] });
  await promo(lab, "vip", { customerIds: ["c-vip"] });
  await promo(lab, "tea-only", { itemIds: ["tea"] });
  await promo(lab, "old", { status: "retired" });
  const quote = (ids: string[], extra: JsonObject = {}) => lab.command("manager", "Catalog.Quote", { items: [{ itemId: "rice", quantity: "1" }], discountIds: ids, ...extra });
  expect((await quote(["qr-only"])).code).toBe("PROMOTION_NOT_ELIGIBLE");
  expect((await quote(["qr-only"], { channel: "qr" })).status).toBe("accepted");
  expect((await quote(["vip"])).code).toBe("PROMOTION_NOT_ELIGIBLE");
  expect((await quote(["vip"], { customerId: "c-vip" })).status).toBe("accepted");
  expect((await quote(["tea-only"])).code).toBe("PROMOTION_NOT_ELIGIBLE");
  expect((await quote(["old"])).code).toBe("PROMOTION_INACTIVE");
  expect((await quote(["ghost"])).code).toBe("DISCOUNT_NOT_FOUND");
}));

test("time windows are evaluated in venue time", () => lab$(async lab => {
  await lab.seed("venue-layout", "current", { timezone: "Asia/Ho_Chi_Minh" });
  await promo(lab, "happy", { window: { fromDate: "2026-03-10", toDate: "2026-03-10", startMinute: 900, endMinute: 1020 } }); // 15:00-17:00 local
  const quote = () => lab.command("manager", "Catalog.Quote", { items: [{ itemId: "rice", quantity: "1" }], discountIds: ["happy"] });
  lab.clock.nowMs = Date.parse("2026-03-10T08:30:00.000Z"); // 15:30 local
  expect((await quote()).status).toBe("accepted");
  lab.clock.nowMs = Date.parse("2026-03-10T10:30:00.000Z"); // 17:30 local
  expect((await quote()).code).toBe("PROMOTION_NOT_ELIGIBLE");
  lab.clock.nowMs = Date.parse("2026-03-10T17:30:00.000Z"); // 00:30 on the 11th local
  expect((await quote()).code).toBe("PROMOTION_NOT_ELIGIBLE");
}));

test("a voucher-gated promotion prices only against the voucher's own live hold", () => lab$(async lab => {
  await promo(lab, "member", { requiresVoucher: true });
  await lab.command("manager", "Voucher.Issue", { voucherId: "VM", promotionId: "member", limit: 1 });
  const quote = (extra: JsonObject = {}) => lab.command("manager", "Catalog.Quote", { items: [{ itemId: "rice", quantity: "1" }], discountIds: ["member"], ...extra });
  expect((await quote()).code).toBe("PROMOTION_REQUIRES_VOUCHER");
  expect((await quote({ voucherId: "VM", voucherRef: "session-1" })).code).toBe("VOUCHER_NOT_HELD");
  await lab.command("cashier", "Voucher.Reserve", { voucherId: "VM", ref: "session-1" });
  expect((await quote({ voucherId: "VM", voucherRef: "session-1" })).status).toBe("accepted");
  expect((await quote({ voucherId: "VM", voucherRef: "session-2" })).code).toBe("VOUCHER_NOT_HELD");
  expect((await lab.command("manager", "Voucher.Issue", { voucherId: "VO", promotionId: "other", limit: 1 })).code).toBe("PROMOTION_UNKNOWN");
}));
