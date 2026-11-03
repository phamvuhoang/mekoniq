import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import type { JsonObject } from "../../packages/contracts/src/index";
type Lab = Awaited<ReturnType<typeof createRestaurantLab>>;
const lab$ = async (body: (lab: Lab) => Promise<void>) => { const lab = await createRestaurantLab(); try { await body(lab); } finally { await lab.close(); } };

test("a guest cannot price a weighed item by keying their own weight", () => lab$(async lab => {
  const r = await lab.command("manager", "Catalog.Publish", { version: 2, currency: "VND", items: [{ id: "beef", name: "Bò", stationId: "kitchen", unitMinor: "200000", available: true, weighed: { unitMass: "1000", unit: "g" } }] });
  expect(r.status, String(r.code)).toBe("accepted");
  await lab.command("cashier", "Session.Open", { sessionId: "session-1", tableId: "table-1" });
  const token = await lab.guestToken("session-1");
  const g = await lab.guestCommand(token, "Order.Place", { menuVersion: 2, items: [{ itemId: "beef", quantity: "1", measure: { mass: "1", source: "manual" } }] });
  expect(g.status).toBe("rejected");
  expect(g.code).toBe("FORBIDDEN");
}));

test("a malformed recipe quantity is a rejection, not a crash", () => lab$(async lab => {
  for (const quantity of ["1.2345678", "abc", ""]) {
    const r = await lab.command("manager", "Recipe.Publish", { recipeVersion: "bad-" + quantity.length, itemId: "rice", lines: [{ ingredientId: "rice-raw", quantity, unit: "g" }] });
    expect(r.status).toBe("rejected");
    expect(r.code).toMatch(/INVALID_QUANTITY|INVALID_ID/);
  }
}));

test("a cash deposit confirmed later still enters the drawer", () => lab$(async lab => {
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "0" });
  const dep = { depositId: "late", amountMinor: "200000", method: "cash" };
  await lab.command("cashier", "Deposit.Receive", { ...dep, status: "unknown" });
  const day = new Date(lab.clock.nowMs).toISOString().slice(0, 10);
  expect(((await lab.report("shifts", day)).rows as JsonObject[])[0]).toMatchObject({ cashInMinor: "0" });
  expect((await lab.command("cashier", "Deposit.Receive", { ...dep, status: "paid" })).status).toBe("accepted");
  expect(((await lab.report("shifts", day)).rows as JsonObject[])[0]).toMatchObject({ cashInMinor: "200000", expectedMinor: "200000" });
}));

test("erasing a customer also masks their name and phone on bookings", () => lab$(async lab => {
  await lab.command("cashier", "Customer.Upsert", { customerId: "c9", name: "Eva", phone: "0911111111" });
  const [a, b] = ["2026-10-30T18:00:00.000Z", "2026-10-30T19:00:00.000Z"];
  await lab.command("cashier", "Booking.Create", { bookingId: "bk9", tableId: "table-1", startsAt: a, endsAt: b, partySize: 2, name: "Eva", phone: "0911111111", customerId: "c9" });
  await lab.command("manager", "Customer.Erase", { customerId: "c9", reason: "yêu cầu của khách" });
  const bk = await lab.state<JsonObject>("booking", "bk9");
  expect(bk.name).toBe("(đã xóa)");
  expect(bk.phone).toBeUndefined();
  expect(bk.status).toBe("requested"); // the table reservation itself stands
}));

test("a voucher use is restored only by a refund of the bill it was spent on", () => lab$(async lab => {
  await lab.command("manager", "Voucher.Issue", { voucherId: "VR", limit: 1, restoreOnRefund: true });
  await lab.command("cashier", "Voucher.Redeem", { voucherId: "VR", billId: "bill-A" });
  await lab.seed("refund", "other", { paymentId: "p", billId: "bill-B", amountMinor: "1" });
  await lab.seed("refund", "mine", { paymentId: "p", billId: "bill-A", amountMinor: "1" });
  const release = (src: string) => lab.command("manager", "Voucher.Release", { voucherId: "VR", ref: "bill-A", reason: "hoàn", reversalSource: src });
  expect((await release("other")).code).toBe("REFUND_NOT_FOR_BILL");
  expect((await release("mine")).status).toBe("accepted");
}));

test("two open stocktake sheets cannot cover the same ingredient", () => lab$(async lab => {
  expect((await lab.command("manager", "Stocktake.Open", { stocktakeId: "A", ingredientIds: ["rice-raw"] })).status).toBe("accepted");
  expect((await lab.command("manager", "Stocktake.Open", { stocktakeId: "B", ingredientIds: ["rice-raw"] })).code).toBe("STOCKTAKE_IN_PROGRESS");
  expect((await lab.command("manager", "Stocktake.Open", { stocktakeId: "C" })).code).toBe("STOCKTAKE_IN_PROGRESS"); // "all ingredients" includes it too
}));

test("a count adjustment applies even to an ingredient that blocks negative sales", () => lab$(async lab => {
  await lab.seed("stock-item", "saffron", { name: "Saffron", baseUnit: "g", conversions: {}, negativePolicy: "block", currency: "VND", onHand: "10", valueMinor: "100", movementSeq: 0 });
  await lab.command("manager", "Stocktake.Open", { stocktakeId: "S", ingredientIds: ["saffron"] });
  await lab.command("chef", "Stocktake.Count", { stocktakeId: "S", ingredientId: "saffron", counted: "0", reasonCode: "spoilage", expectedVersion: 1 });
  await lab.command("manager", "Inventory.RecordWaste", { sourceEventId: "w", ingredientId: "saffron", quantity: "3", reason: "rơi" }); // sold/lost after the checkpoint
  await lab.command("owner", "Stocktake.Approve", { stocktakeId: "S", expectedVersion: 2 });
  const r = await lab.command("owner", "Stocktake.Apply", { stocktakeId: "S", expectedVersion: 3 });
  expect(r.status, String(r.code)).toBe("accepted");
  expect((await lab.state<{ onHand: string }>("stock-item", "saffron")).onHand).toBe("-3"); // the shelf was really empty: the books say so
}));
