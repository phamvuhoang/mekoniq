import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { rangesOverlap } from "../../packages/domain/src/reservations/resource";
import type { JsonObject } from "../../packages/contracts/src/index";
type Lab = Awaited<ReturnType<typeof createRestaurantLab>>;
type Deposit = { paidMinor: string; appliedMinor: string; returnedMinor?: string; forfeitedMinor?: string; status?: string };
type Booking = { status: string; provisional?: boolean; sessionId?: string; lateMs?: number; version: number };
const lab$ = async (body: (lab: Lab) => Promise<void>) => { const lab = await createRestaurantLab(); try { await body(lab); } finally { await lab.close(); } };
const T = (iso: string) => Date.parse(iso);
const at = (lab: Lab, iso: string) => { lab.clock.nowMs = T(iso); };
const book = (lab: Lab, id: string, startsAt: string, endsAt: string, extra: JsonObject = {}, actor = "cashier") =>
  lab.command(actor, "Booking.Create", { bookingId: id, tableId: "table-1", startsAt, endsAt, partySize: 2, name: "Lan", ...extra });
const NOW = "2026-03-10T10:00:00.000Z";
const slot = (h: number, m = 0, len = 60) => { const s = T("2026-03-10T00:00:00.000Z") + (h * 60 + m) * 60000; return [new Date(s).toISOString(), new Date(s + len * 60000).toISOString()] as const; };

test("a paid deposit is applied to a bill only once", () => lab$(async lab => {
  await lab.seed("bill", "bill-1", { status: "prepared", totalMinor: "300000", paidMinor: "0", refundedMinor: "0", unappliedMinor: "0", currency: "VND", orderIds: [], lines: [], sessionId: null });
  await lab.seed("deposit", "dep-1", { paidMinor: "200000", appliedMinor: "0" });
  const p = { depositId: "dep-1", billId: "bill-1", amountMinor: "200000" };
  await lab.command("cashier", "Deposit.Apply", p, "dep-a");
  await lab.command("cashier", "Deposit.Apply", p, "dep-b");
  expect(await lab.count("DepositApplied")).toBe(1);
  expect((await lab.state<Deposit>("deposit", "dep-1")).appliedMinor).toBe("200000");
  expect((await lab.state<{ paidMinor: string }>("bill", "bill-1")).paidMinor).toBe("200000");
}));

test("the deposit settles the bill as a tender; it never becomes sales on its own", () => lab$(async lab => {
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "0" });
  const r = await lab.command("cashier", "Deposit.Receive", { depositId: "dep-2", amountMinor: "200000", method: "cash" });
  expect(r.status).toBe("accepted");
  const day = new Date(lab.clock.nowMs).toISOString().slice(0, 10);
  const sales = await lab.report("sales", day), shifts = await lab.report("shifts", day);
  expect((sales.totals as JsonObject).grossMinor).toBe("0"); // liability, not revenue
  expect((shifts.rows as JsonObject[])[0]).toMatchObject({ cashInMinor: "200000", expectedMinor: "200000" }); // but the cash really is in the drawer
  await lab.seed("bill", "bill-2", { status: "prepared", totalMinor: "150000", paidMinor: "0", refundedMinor: "0", unappliedMinor: "0", currency: "VND", orderIds: [], lines: [], sessionId: null });
  expect((await lab.command("cashier", "Deposit.Apply", { depositId: "dep-2", billId: "bill-2", amountMinor: "150001" })).code).toBe("AMOUNT_EXCEEDS_DUE");
  expect((await lab.command("cashier", "Deposit.Apply", { depositId: "dep-2", billId: "bill-2", amountMinor: "150000" })).status).toBe("accepted");
  await lab.seed("bill", "bill-3", { status: "prepared", totalMinor: "90000", paidMinor: "0", refundedMinor: "0", unappliedMinor: "0", currency: "VND", orderIds: [], lines: [], sessionId: null });
  expect((await lab.command("cashier", "Deposit.Apply", { depositId: "dep-2", billId: "bill-3", amountMinor: "60000" })).code).toBe("DEPOSIT_EXCEEDS_BALANCE"); // only 50 000 is left
  expect((await lab.command("cashier", "Deposit.Apply", { depositId: "dep-2", billId: "bill-3", amountMinor: "50000" })).status).toBe("accepted");
  await lab.seed("bill", "bill-closed", { status: "closed", totalMinor: "1", paidMinor: "1", refundedMinor: "0", unappliedMinor: "0", currency: "VND", orderIds: [], lines: [], sessionId: null });
  await lab.seed("deposit", "dep-3", { paidMinor: "10", appliedMinor: "0" });
  expect((await lab.command("cashier", "Deposit.Apply", { depositId: "dep-3", billId: "bill-closed", amountMinor: "1" })).code).toBe("BILL_CLOSED");
  const pay = (await (await lab.getStore("coordinator")).snapshots(lab.scope)).filter(s => s.ref.kind === "payment" && s.state.method === "deposit");
  expect(pay).toHaveLength(2);
  expect(pay[0]!.state).toMatchObject({ status: "captured", depositId: "dep-2" });
}));

test("a cash deposit needs an open shift and a signed amount; a customer's word is not a deposit", () => lab$(async lab => {
  expect((await lab.command("cashier", "Deposit.Receive", { depositId: "d", amountMinor: "1000", method: "cash" })).code).toBe("ACTIVE_SHIFT_REQUIRED");
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "0" });
  expect((await lab.command("cashier", "Deposit.Receive", { depositId: "d", amountMinor: "0", method: "cash" })).code).toBe("INVALID_AMOUNT");
  expect((await lab.command("cashier", "Deposit.Receive", { depositId: "d", amountMinor: "1000", method: "transfer_manual" })).code).toBe("REFERENCE_REQUIRED");
  expect((await lab.command("guest", "Deposit.Receive", { depositId: "d", amountMinor: "1000", method: "cash" })).code).toBe("FORBIDDEN");
  const a = await lab.command("cashier", "Deposit.Receive", { depositId: "d", amountMinor: "1000", method: "cash" }, "r1");
  expect((await lab.command("cashier", "Deposit.Receive", { depositId: "d", amountMinor: "1000", method: "cash" }, "r2")).status).toBe("accepted");
  expect((await lab.command("cashier", "Deposit.Receive", { depositId: "d", amountMinor: "2000", method: "cash" }, "r3")).code).toBe("DEPOSIT_CONFLICT");
  expect(a.status).toBe("accepted");
  expect(await lab.count("DepositReceived")).toBe(1);
}));

test("tables are never double-booked: one winner under concurrency, adjacent slots both fit", () => lab$(async lab => {
  at(lab, NOW);
  expect(rangesOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
  const [a, b] = slot(18);
  const rs = await Promise.all(["x", "y"].map(id => book(lab, "race-" + id, a, b, {}, "cashier")));
  expect(rs.filter(r => r.status === "accepted")).toHaveLength(1);
  expect(rs.find(r => r.status === "rejected")!.code).toMatch(/TABLE_UNAVAILABLE|VERSION_CONFLICT/);
  const [c, d] = slot(19);
  expect((await book(lab, "adjacent", c, d)).status).toBe("accepted");
  const [e, f] = slot(18, 30);
  expect((await book(lab, "overlap", e, f)).code).toBe("TABLE_UNAVAILABLE");
  expect((await book(lab, "other-table", e, f, { tableId: "table-2" })).status).toBe("accepted");
}));

test("a hold lapses for overlap purposes unless a deposit is unresolved; confirming re-checks the slot", () => lab$(async lab => {
  at(lab, NOW);
  const [a, b] = slot(18);
  await book(lab, "first", a, b, { holdMinutes: 15 });
  at(lab, "2026-03-10T10:10:00.000Z");
  expect((await book(lab, "second", a, b)).code).toBe("TABLE_UNAVAILABLE"); // the hold is still live
  at(lab, "2026-03-10T10:20:00.000Z");
  expect((await book(lab, "second", a, b)).status).toBe("accepted"); // lapsed hold no longer blocks; "first" is not cancelled by the clock
  expect((await lab.state<Booking>("booking", "first")).status).toBe("requested");
  await lab.command("manager", "Booking.Confirm", { bookingId: "second", expectedVersion: (await lab.state<Booking>("booking", "second")).version });
  expect((await lab.command("manager", "Booking.Confirm", { bookingId: "first", expectedVersion: (await lab.state<Booking>("booking", "first")).version })).code).toBe("TABLE_UNAVAILABLE");
  // a booking whose deposit result is unknown keeps its hold however long it takes
  const [c, d] = slot(20);
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "0" });
  await book(lab, "held", c, d, { holdMinutes: 15 });
  await lab.command("cashier", "Deposit.Receive", { depositId: "dep-held", bookingId: "held", amountMinor: "100000", method: "transfer_manual", reference: "FT1", status: "unknown" });
  at(lab, "2026-03-11T10:00:00.000Z");
  at(lab, "2026-03-10T11:00:00.000Z");
  expect((await book(lab, "squatter", c, d)).code).toBe("TABLE_UNAVAILABLE");
}));

test("a required deposit must be paid in full (across receipts) before the booking is confirmed", () => lab$(async lab => {
  at(lab, NOW);
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "0" });
  const [a, b] = slot(18);
  await book(lab, "dbk", a, b, { depositRequiredMinor: "200000" });
  const v = async () => (await lab.state<Booking>("booking", "dbk")).version;
  expect((await lab.command("manager", "Booking.Confirm", { bookingId: "dbk", expectedVersion: await v() })).code).toBe("DEPOSIT_REQUIRED");
  await lab.command("cashier", "Deposit.Receive", { depositId: "p1", bookingId: "dbk", amountMinor: "50000", method: "cash" });
  await lab.command("cashier", "Deposit.Receive", { depositId: "p2", bookingId: "dbk", amountMinor: "100000", method: "transfer_manual", reference: "FT9", status: "pending" });
  expect((await lab.command("manager", "Booking.Confirm", { bookingId: "dbk", expectedVersion: await v() })).code).toBe("DEPOSIT_REQUIRED"); // pending money is not money
  await lab.command("cashier", "Deposit.Receive", { depositId: "p2", bookingId: "dbk", amountMinor: "100000", method: "transfer_manual", reference: "FT9", status: "paid" });
  expect((await lab.command("manager", "Booking.Confirm", { bookingId: "dbk", expectedVersion: await v() })).code).toBe("DEPOSIT_REQUIRED"); // 150 000 of 200 000
  await lab.command("cashier", "Deposit.Receive", { depositId: "p3", bookingId: "dbk", amountMinor: "50000", method: "cash" });
  expect((await lab.command("manager", "Booking.Confirm", { bookingId: "dbk", expectedVersion: await v() })).status).toBe("accepted");
}));

test("an isolated booking is provisional: it guarantees nothing until the venue confirms it", () => lab$(async lab => {
  at(lab, NOW);
  const [a, b] = slot(18);
  expect((await book(lab, "iso", a, b, { isolated: true })).status).toBe("accepted");
  expect((await lab.state<Booking>("booking", "iso")).provisional).toBe(true);
  expect((await book(lab, "real", a, b)).status).toBe("accepted"); // did not block
  await lab.command("manager", "Booking.Confirm", { bookingId: "real", expectedVersion: (await lab.state<Booking>("booking", "real")).version });
  expect((await lab.command("manager", "Booking.Confirm", { bookingId: "iso", expectedVersion: (await lab.state<Booking>("booking", "iso")).version })).code).toBe("TABLE_UNAVAILABLE");
}));

test("check-in binds a new table session; early, unconfirmed and occupied-table cases are refused", () => lab$(async lab => {
  at(lab, NOW);
  const [a, b] = slot(12); // 12:00-13:00, now is 10:00
  await book(lab, "ci", a, b);
  const v = async () => (await lab.state<Booking>("booking", "ci")).version;
  expect((await lab.command("cashier", "Booking.CheckIn", { bookingId: "ci", expectedVersion: await v() })).code).toBe("BOOKING_NOT_CONFIRMED");
  await lab.command("manager", "Booking.Confirm", { bookingId: "ci", expectedVersion: await v() });
  expect((await lab.command("cashier", "Booking.CheckIn", { bookingId: "ci", expectedVersion: await v() })).code).toBe("CHECK_IN_TOO_EARLY");
  at(lab, "2026-03-10T12:25:00.000Z");
  await lab.command("cashier", "Session.Open", { sessionId: "walk-in", tableId: "table-1" });
  expect((await lab.command("cashier", "Booking.CheckIn", { bookingId: "ci", expectedVersion: await v() })).code).toBe("TABLE_OCCUPIED");
  await lab.command("cashier", "Session.Close", { sessionId: "walk-in" });
  const r = await lab.command("cashier", "Booking.CheckIn", { bookingId: "ci", expectedVersion: await v() });
  expect(r.status).toBe("accepted");
  const bk = await lab.state<Booking>("booking", "ci");
  expect(bk).toMatchObject({ status: "checked_in", lateMs: 25 * 60000 });
  expect(await lab.state<JsonObject>("session", String(bk.sessionId))).toMatchObject({ tableId: "table-1", status: "open" });
  expect(await lab.state<JsonObject>("table", "table-1")).toMatchObject({ activeSessionId: bk.sessionId });
}));

test("no-show waits for the grace period and funds follow an explicit, permitted disposition", () => lab$(async lab => {
  at(lab, NOW);
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "0" });
  const [a, b] = slot(12);
  await book(lab, "ns", a, b);
  await lab.command("cashier", "Deposit.Receive", { depositId: "dns", bookingId: "ns", amountMinor: "100000", method: "cash" });
  const v = async () => (await lab.state<Booking>("booking", "ns")).version;
  await lab.command("manager", "Booking.Confirm", { bookingId: "ns", expectedVersion: await v() });
  expect((await lab.command("manager", "Booking.NoShow", { bookingId: "ns", expectedVersion: await v(), reason: "không đến" })).code).toBe("NO_SHOW_TOO_EARLY");
  at(lab, "2026-03-10T12:20:00.000Z");
  expect((await lab.command("manager", "Booking.NoShow", { bookingId: "ns", expectedVersion: await v(), reason: "không đến", forfeitDeposit: true })).code).toBe("FORFEIT_NOT_PERMITTED"); // policy default
  expect((await lab.command("manager", "Booking.NoShow", { bookingId: "ns", expectedVersion: await v(), reason: " " })).code).toBe("REASON_REQUIRED");
  expect((await lab.command("manager", "Booking.NoShow", { bookingId: "ns", expectedVersion: await v(), reason: "không đến" })).status).toBe("accepted");
  const dep = await lab.state<Deposit>("deposit", "dns");
  expect(dep).toMatchObject({ paidMinor: "100000", appliedMinor: "0" }); // still a liability until someone decides
  expect((await lab.command("cashier", "Deposit.Return", { depositId: "dns", amountMinor: "100000", method: "cash", reason: "hoàn cọc" })).code).toBe("FORBIDDEN");
  expect((await lab.command("manager", "Deposit.Return", { depositId: "dns", amountMinor: "100001", method: "cash", reason: "hoàn cọc" })).code).toBe("DEPOSIT_EXCEEDS_BALANCE");
  expect((await lab.command("manager", "Deposit.Return", { depositId: "dns", amountMinor: "40000", method: "cash", reason: "hoàn một phần" })).status).toBe("accepted");
  expect((await lab.state<Deposit>("deposit", "dns")).returnedMinor).toBe("40000");
  const shifts = await lab.report("shifts", new Date(lab.clock.nowMs).toISOString().slice(0, 10));
  expect((shifts.rows as JsonObject[])[0]).toMatchObject({ cashInMinor: "100000", cashOutMinor: "40000", expectedMinor: "60000" });
}));

test("a venue policy can allow forfeiting a no-show deposit, which then leaves the liability and is recorded", () => lab$(async lab => {
  at(lab, NOW);
  await lab.seed("reservation-policy", "current", { noShowForfeit: true, graceMinutes: 10 });
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "0" });
  const [a, b] = slot(12);
  await book(lab, "fx", a, b);
  await lab.command("cashier", "Deposit.Receive", { depositId: "dfx", bookingId: "fx", amountMinor: "100000", method: "cash" });
  await lab.command("manager", "Booking.Confirm", { bookingId: "fx", expectedVersion: (await lab.state<Booking>("booking", "fx")).version });
  at(lab, "2026-03-10T12:11:00.000Z");
  const nv = (await lab.state<Booking>("booking", "fx")).version;
  expect((await lab.command("cashier", "Booking.NoShow", { bookingId: "fx", expectedVersion: nv, reason: "không đến", forfeitDeposit: true })).code).toBe("FORBIDDEN"); // forfeiting needs deposit.manage
  expect((await lab.command("manager", "Booking.NoShow", { bookingId: "fx", expectedVersion: nv, reason: "không đến", forfeitDeposit: true })).status).toBe("accepted");
  expect(await lab.state<Deposit>("deposit", "dfx")).toMatchObject({ forfeitedMinor: "100000" });
  expect((await lab.command("manager", "Deposit.Return", { depositId: "dfx", amountMinor: "1", method: "cash", reason: "x" })).code).toBe("DEPOSIT_EXCEEDS_BALANCE");
}));

test("waitlist is first-come-first-served; skipping the queue needs a recorded reason; a seat must really be free", () => lab$(async lab => {
  at(lab, NOW);
  await lab.seed("table", "table-3", { name: "Bàn 03", seats: 2, activeSessionId: null });
  const join = (id: string, size: number) => lab.command("cashier", "Waitlist.Join", { waitId: id, name: id, partySize: size });
  await join("w1", 2); lab.clock.advance(60000); await join("w2", 2); lab.clock.advance(60000);
  await join("big", 6);
  const promote = (id: string, extra: JsonObject = {}) => lab.command("cashier", "Waitlist.Promote", { waitId: id, tableId: "table-3", ...extra });
  expect((await promote("w2")).code).toBe("WAITLIST_ORDER");
  expect((await promote("big")).code).toBe("CAPACITY_EXCEEDED");
  expect((await promote("w2", { skipReason: "w1 đã rời đi" })).status).toBe("accepted");
  expect((await lab.state<JsonObject>("waitlist", "w2")).status).toBe("promoted");
  expect((await promote("w1")).code).toBe("TABLE_UNAVAILABLE"); // the seat is taken for the promoted party's slot
  expect(await lab.count("WaitlistPromoted")).toBe(1);
}));

test("ranges are UTC instants with a sane length; unknown tables and oversize parties are refused", () => lab$(async lab => {
  at(lab, NOW);
  await lab.seed("table", "table-3", { name: "Bàn 03", seats: 2, activeSessionId: null });
  const [a, b] = slot(18);
  expect((await book(lab, "n1", "2026-03-10T18:00:00", "2026-03-10T19:00:00")).code).toBe("INVALID_RANGE");
  expect((await book(lab, "n2", b, a)).code).toBe("INVALID_RANGE");
  expect((await book(lab, "n3", a, new Date(T(a) + 9 * 3600_000).toISOString())).code).toBe("INVALID_RANGE");
  expect((await book(lab, "n4", a, b, { tableId: "nope" })).code).toBe("TABLE_UNKNOWN");
  expect((await book(lab, "n5", a, b, { tableId: "table-3", partySize: 3 })).code).toBe("CAPACITY_EXCEEDED");
  expect((await book(lab, "n6", "2026-03-10T08:00:00.000Z", "2026-03-10T09:00:00.000Z")).code).toBe("BOOKING_IN_PAST");
  expect((await book(lab, "n7", a, b, { holdMinutes: 5000 })).code).toBe("INVALID_HOLD");
}));

test("cancelling frees the slot and leaves any deposit as an explicit liability", () => lab$(async lab => {
  at(lab, NOW);
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "0" });
  const [a, b] = slot(18);
  await book(lab, "cx", a, b);
  await lab.command("cashier", "Deposit.Receive", { depositId: "dcx", bookingId: "cx", amountMinor: "50000", method: "cash" });
  expect((await lab.command("cashier", "Booking.Cancel", { bookingId: "cx", expectedVersion: (await lab.state<Booking>("booking", "cx")).version, reason: "khách hủy" })).status).toBe("accepted");
  expect((await book(lab, "after", a, b)).status).toBe("accepted");
  expect((await lab.state<Deposit>("deposit", "dcx")).paidMinor).toBe("50000");
  expect((await lab.command("cashier", "Booking.Cancel", { bookingId: "cx", expectedVersion: 1, reason: "x" })).code).toBe("BOOKING_STATE_CONFLICT");
}));
