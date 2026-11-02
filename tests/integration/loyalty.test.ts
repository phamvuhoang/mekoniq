import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { hasConsent } from "../../packages/domain/src/customers/consent";
import type { JsonObject } from "../../packages/contracts/src/index";
type Lab = Awaited<ReturnType<typeof createRestaurantLab>>;
type Account = { balance: string; earned: string; redeemed: string; pending?: string; tier?: string; version: number };
const lab$ = async (body: (lab: Lab) => Promise<void>) => { const lab = await createRestaurantLab(); try { await body(lab); } finally { await lab.close(); } };
const account = (lab: Lab, id = "customer-1") => lab.state<Account>("loyalty-account", id);
const snapshots = async (lab: Lab) => (await lab.getStore("coordinator")).snapshots(lab.scope);

test("duplicate settlement cannot award duplicate loyalty", () => lab$(async lab => {
  const p = { customerId: "customer-1", settlementId: "pay-1", points: "50" };
  await lab.command("cashier", "Loyalty.Earn", p, "earn-a");
  await lab.command("cashier", "Loyalty.Earn", p, "earn-b");
  expect(await lab.count("LoyaltyEarned")).toBe(1);
  expect((await account(lab)).balance).toBe("50");
}));

test("points come from a captured settlement, within the policy rate, once per settlement", () => lab$(async lab => {
  const earn = (extra: JsonObject = {}) => lab.command("cashier", "Loyalty.Earn", { customerId: "customer-1", settlementId: "pay-1", points: "50", ...extra });
  expect((await earn({ points: "101" })).code).toBe("EARN_EXCEEDS_SETTLEMENT"); // pay-1 is 100 000 VND at 1 point per 1 000
  expect((await earn({ settlementId: "ghost" })).code).toBe("SETTLEMENT_NOT_FOUND");
  await lab.seed("payment", "pay-pending", { billId: "bill-pay-1", status: "pending", capturedMinor: "0", appliedMinor: "0" });
  expect((await earn({ settlementId: "pay-pending" })).code).toBe("SETTLEMENT_NOT_SETTLED");
  expect((await earn({ points: "0" })).code).toBe("INVALID_POINTS");
  expect((await earn()).status).toBe("accepted");
  expect((await earn({ points: "60" })).code).toBe("EARN_ALREADY_RECORDED"); // same settlement, other amount
  expect((await account(lab)).tier).toBe("member");
}));

test("earning needs an active customer who consented to the programme", () => lab$(async lab => {
  const earn = (customerId: string) => lab.command("cashier", "Loyalty.Earn", { customerId, settlementId: "pay-1", points: "10" });
  expect((await earn("nobody")).code).toBe("CUSTOMER_NOT_FOUND");
  await lab.command("cashier", "Customer.Upsert", { customerId: "c-new", name: "Lan" });
  expect((await earn("c-new")).code).toBe("CONSENT_REQUIRED");
  await lab.command("cashier", "Consent.Record", { customerId: "c-new", purpose: "loyalty", channel: "program", granted: true, policyVersion: "2026-01" });
  expect((await earn("c-new")).status).toBe("accepted");
  await lab.command("cashier", "Consent.Record", { customerId: "c-new", purpose: "loyalty", channel: "program", granted: false, policyVersion: "2026-01" });
  expect((await lab.command("cashier", "Loyalty.Earn", { customerId: "c-new", settlementId: "pay-1", points: "5" })).code).toBe("EARN_ALREADY_RECORDED"); // checked before consent: the first earn stands
  await lab.seed("payment", "pay-2", { billId: "bill-pay-1", capturedMinor: "50000", appliedMinor: "50000" });
  expect((await lab.command("cashier", "Loyalty.Earn", { customerId: "c-new", settlementId: "pay-2", points: "5" })).code).toBe("CONSENT_REQUIRED"); // withdrawn
}));

test("consent is versioned per purpose and channel and keeps its history", () => lab$(async lab => {
  await lab.command("cashier", "Consent.Record", { customerId: "customer-1", purpose: "marketing", channel: "zalo", granted: true, policyVersion: "v1" });
  await lab.command("cashier", "Consent.Record", { customerId: "customer-1", purpose: "marketing", channel: "zalo", granted: false, policyVersion: "v2" });
  const s = await snapshots(lab);
  expect(hasConsent(s, "customer-1", "marketing", "zalo")).toBe(false);
  expect(hasConsent(s, "customer-1", "marketing", "sms")).toBe(false); // never asked
  expect(hasConsent(s, "customer-1", "loyalty", "program")).toBe(true); // the fixture customer enrolled
  const rec = s.find(x => x.ref.kind === "consent" && x.state.purpose === "marketing")!;
  expect((rec.state.history as JsonObject[]).map(h => [h.granted, h.policyVersion])).toEqual([[true, "v1"], [false, "v2"]]);
  expect((await lab.command("cashier", "Consent.Record", { customerId: "customer-1", purpose: "ads", channel: "zalo", granted: true, policyVersion: "v1" })).code).toBe("INVALID_CONSENT");
}));

test("a refund reverses at most what that settlement earned, once per refund", () => lab$(async lab => {
  await lab.command("cashier", "Loyalty.Earn", { customerId: "customer-1", settlementId: "pay-1", points: "100" });
  await lab.seed("refund", "rf-1", { paymentId: "pay-1", amountMinor: "50000", appliedMinor: "50000" });
  await lab.seed("refund", "rf-2", { paymentId: "pay-1", amountMinor: "100000", appliedMinor: "100000" });
  await lab.seed("refund", "rf-x", { paymentId: "other", amountMinor: "1000" });
  const reverse = (refundId: string, actor = "manager") => lab.command(actor, "Loyalty.Reverse", { customerId: "customer-1", refundId });
  expect((await reverse("rf-1", "cashier")).code).toBe("FORBIDDEN");
  expect((await reverse("rf-missing")).code).toBe("REFUND_NOT_FOUND");
  expect((await reverse("rf-x")).code).toBe("REFUND_NOT_FOR_SETTLEMENT");
  expect((await reverse("rf-1")).status).toBe("accepted");
  expect((await reverse("rf-1")).status).toBe("accepted"); // the same refund again changes nothing
  expect((await account(lab)).balance).toBe("50"); // half the money back, half the points
  expect((await reverse("rf-2")).status).toBe("accepted");
  expect((await account(lab)).balance).toBe("0"); // capped: the whole sale was refunded in total but only 100 points were ever earned
  expect(await lab.count("LoyaltyReversed")).toBe(2);
}));

test("redeeming needs the balance, is once per source and races have one winner", () => lab$(async lab => {
  await lab.command("cashier", "Loyalty.Earn", { customerId: "customer-1", settlementId: "pay-1", points: "100" });
  const redeem = (sourceEventId: string, points: string, op?: string) => lab.command("cashier", "Loyalty.Redeem", { customerId: "customer-1", sourceEventId, points }, op);
  expect((await redeem("rw-1", "101")).code).toBe("INSUFFICIENT_POINTS");
  const rs = await Promise.all([redeem("rw-a", "60", "a"), redeem("rw-b", "60", "b")]);
  expect(rs.filter(r => r.status === "accepted")).toHaveLength(1);
  expect((await account(lab)).balance).toBe("40");
  const winner = rs.find(r => r.status === "accepted") === rs[0] ? "rw-a" : "rw-b";
  expect((await redeem(winner, "60", "retry")).status).toBe("accepted");
  expect((await account(lab)).balance).toBe("40");
  expect((await redeem(winner, "30", "changed")).code).toBe("SOURCE_REUSED");
}));

test("a shared (chain) balance is never spent offline and offline earnings stay pending", () => lab$(async lab => {
  await lab.seed("loyalty-account", "customer-1", { balance: "500", earned: "500", redeemed: "0", scope: "chain", version: 1 });
  expect((await lab.command("cashier", "Loyalty.Redeem", { customerId: "customer-1", sourceEventId: "rw", points: "10" })).code).toBe("SHARED_BALANCE_OFFLINE_DENIED");
  expect((await lab.command("cashier", "Loyalty.Earn", { customerId: "customer-1", settlementId: "pay-1", points: "20" })).status).toBe("accepted");
  const a = await account(lab);
  expect(a).toMatchObject({ balance: "500", pending: "20" }); // spendable balance unchanged until the authority confirms
}));

test("the same phone is flagged, never merged by itself; an explicit merge moves points and keeps history", () => lab$(async lab => {
  await lab.command("cashier", "Customer.Upsert", { customerId: "a", name: "An", phone: "0901 234 567" });
  const dup = await lab.command("cashier", "Customer.Upsert", { customerId: "b", name: "Bình", phone: "+84 901 234 567".replace("+84 ", "0") });
  expect(dup.value.possibleDuplicates).toEqual(["a"]);
  expect((await lab.state<JsonObject>("customer", "b")).status).toBe("active");
  await lab.command("cashier", "Consent.Record", { customerId: "a", purpose: "loyalty", channel: "program", granted: true, policyVersion: "v1" });
  await lab.command("cashier", "Loyalty.Earn", { customerId: "a", settlementId: "pay-1", points: "30" });
  await lab.command("cashier", "Customer.Upsert", { customerId: "t", name: "Target" });
  expect((await lab.command("cashier", "Customer.Merge", { sourceId: "a", targetId: "t", reason: "cùng một người" })).code).toBe("FORBIDDEN");
  expect((await lab.command("manager", "Customer.Merge", { sourceId: "a", targetId: "t", reason: "cùng một người" })).status).toBe("accepted");
  expect(await lab.state<JsonObject>("customer", "a")).toMatchObject({ status: "merged", mergedInto: "t" });
  expect((await account(lab, "a")).balance).toBe("0");
  expect((await account(lab, "t")).balance).toBe("30");
  expect((await lab.command("cashier", "Loyalty.Earn", { customerId: "a", settlementId: "pay-1", points: "1" })).code).toBe("CUSTOMER_MERGED");
  expect((await lab.command("manager", "Customer.Merge", { sourceId: "t", targetId: "t", reason: "x" })).code).toBe("INVALID_MERGE");
  const entries = (await snapshots(lab)).filter(s => s.ref.kind === "loyalty-entry" && s.state.customerId === "a").map(s => s.state.kind).sort();
  expect(entries).toEqual(["earn", "transfer_out"]); // history is kept, not rewritten
}));

test("an erasure request removes personal data but keeps the financial ledger", () => lab$(async lab => {
  await lab.command("cashier", "Customer.Upsert", { customerId: "e", name: "Eva", phone: "0911111111", email: "eva@example.com" });
  await lab.command("cashier", "Consent.Record", { customerId: "e", purpose: "loyalty", channel: "program", granted: true, policyVersion: "v1" });
  await lab.command("cashier", "Loyalty.Earn", { customerId: "e", settlementId: "pay-1", points: "10" });
  expect((await lab.command("cashier", "Customer.Erase", { customerId: "e", reason: "yêu cầu của khách" })).code).toBe("FORBIDDEN");
  expect((await lab.command("manager", "Customer.Erase", { customerId: "e", reason: " " })).code).toBe("REASON_REQUIRED");
  expect((await lab.command("manager", "Customer.Erase", { customerId: "e", reason: "yêu cầu của khách" })).status).toBe("accepted");
  const c = await lab.state<JsonObject>("customer", "e");
  expect(c).toMatchObject({ status: "erased", name: "(đã xóa)" });
  expect(c.phone).toBeUndefined(); expect(c.email).toBeUndefined();
  expect(hasConsent(await snapshots(lab), "e", "loyalty", "program")).toBe(false);
  expect((await account(lab, "e")).balance).toBe("10"); // the ledger is financial history
  expect((await lab.command("manager", "Customer.Erase", { customerId: "e", reason: "again" })).status).toBe("accepted");
  expect(await lab.count("CustomerErased")).toBe(1);
}));

test("loyalty can be switched off without hiding refunds or data requests", () => lab$(async lab => {
  const cfg = await lab.state<JsonObject>("configuration", "applied");
  await lab.seed("configuration", "applied", { ...cfg, features: { ...(cfg.features as JsonObject), loyalty: { status: "disabled", revision: 1 } }, version: Number(cfg.version) + 1 });
  expect((await lab.command("cashier", "Customer.Upsert", { customerId: "z", name: "Z" })).code).toBe("FEATURE_DISABLED");
  expect((await lab.command("manager", "Customer.Erase", { customerId: "customer-1", reason: "yêu cầu" })).status).toBe("accepted");
}));
