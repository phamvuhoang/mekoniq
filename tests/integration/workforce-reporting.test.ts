import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { attendanceDuration } from "../../packages/domain/src/workforce/attendance";
import { reportCsv } from "../../packages/domain/src/reporting/report";
import type { JsonObject } from "../../packages/contracts/src/index";
type Lab = Awaited<ReturnType<typeof createRestaurantLab>>;
const lab$ = async (body: (lab: Lab) => Promise<void>) => {
  const lab = await createRestaurantLab();
  try { await body(lab); } finally { await lab.close(); }
};
const at = (lab: Lab, iso: string) => { lab.clock.nowMs = Date.parse(iso); };
const rowsOf = (r: JsonObject) => r.rows as JsonObject[];

test("a kitchen actor cannot grant itself refund permission", () => lab$(async lab => {
  expect((await lab.command("chef", "Staff.SetPermissions", { userId: "chef", permissions: ["refund"] })).code).toBe("FORBIDDEN");
  // even a manager cannot do it from the venue: permissions change only through the cloud identity workflow
  expect((await lab.command("manager", "Staff.SetPermissions", { userId: "chef", permissions: ["refund"] })).code).toBe("IDENTITY_WORKFLOW_REQUIRED");
}));

test("durations are never negative", () => {
  expect(attendanceDuration(1000, 4000)).toBe(3000);
  expect(() => attendanceDuration(4000, 1000)).toThrow("NEGATIVE_DURATION");
});

test("clock in and out are immutable facts; a duplicate offline punch is a no-op", () => lab$(async lab => {
  at(lab, "2026-03-10T01:00:00.000Z");
  expect((await lab.command("chef", "Staff.ClockIn", { punchId: "p1" }, "in-a")).status).toBe("accepted");
  expect((await lab.command("chef", "Staff.ClockIn", { punchId: "p1" }, "in-b")).status).toBe("accepted"); // same punch replayed from another path
  expect((await lab.command("chef", "Staff.ClockIn", { punchId: "p2" })).code).toBe("ALREADY_CLOCKED_IN");
  expect(await lab.count("StaffClockedIn")).toBe(1);
  at(lab, "2026-03-10T09:30:00.000Z");
  expect((await lab.command("chef", "Staff.ClockOut", { punchId: "p3" })).status).toBe("accepted");
  expect((await lab.command("chef", "Staff.ClockOut", { punchId: "p3" }, "again")).status).toBe("accepted");
  expect((await lab.command("chef", "Staff.ClockOut", { punchId: "p4" })).code).toBe("NOT_CLOCKED_IN");
  expect(await lab.count("StaffClockedOut")).toBe(1);
  const att = (await (await lab.getStore("coordinator")).snapshots(lab.scope)).find(s => s.ref.kind === "attendance")!;
  expect(att.state).toMatchObject({ userId: "chef", status: "closed", clockInAt: "2026-03-10T01:00:00.000Z", clockOutAt: "2026-03-10T09:30:00.000Z" });
}));

test("staff clock only themselves; a manager can punch for someone with the reason on record", () => lab$(async lab => {
  expect((await lab.command("chef", "Staff.ClockIn", { punchId: "p1", userId: "cashier" })).code).toBe("FORBIDDEN");
  expect((await lab.command("manager", "Staff.ClockIn", { punchId: "p1", userId: "cashier" })).code).toBe("REASON_REQUIRED");
  expect((await lab.command("manager", "Staff.ClockIn", { punchId: "p1", userId: "cashier", reason: "quên bấm" })).status).toBe("accepted");
  expect((await lab.command("manager", "Staff.ClockIn", { punchId: "p9", userId: "manager", reason: "tự bấm" })).status).toBe("accepted");
}));

test("a punch recorded from another device is flagged, and an end before the start is refused", () => lab$(async lab => {
  at(lab, "2026-03-10T08:00:00.000Z");
  await lab.command("chef", "Staff.ClockIn", { punchId: "p1" }); // device-kds
  at(lab, "2026-03-10T07:00:00.000Z"); // a device whose clock is behind
  expect((await lab.command("manager", "Staff.ClockOut", { punchId: "p2", userId: "chef", reason: "quên bấm" })).code).toBe("NEGATIVE_DURATION");
  at(lab, "2026-03-10T16:00:00.000Z");
  expect((await lab.command("manager", "Staff.ClockOut", { punchId: "p3", userId: "chef", reason: "quên bấm" })).status).toBe("accepted"); // device-a
  const row = rowsOf(await lab.report("attendance", "2026-03-10"))[0]!;
  expect(row).toMatchObject({ userId: "chef", deviceMismatch: true, durationMs: String(8 * 3600_000) });
}));

test("schedules reject overlap and impossible ranges; overnight shifts keep their start day", () => lab$(async lab => {
  const s = (scheduleId: string, startsAt: string, endsAt: string) => lab.command("manager", "Staff.Schedule", { scheduleId, userId: "chef", startsAt, endsAt, stationId: "kitchen" });
  expect((await s("s1", "2026-03-10T15:00:00.000Z", "2026-03-10T23:00:00.000Z")).status).toBe("accepted"); // 22:00-06:00 in Ho Chi Minh
  expect((await s("s2", "2026-03-10T22:00:00.000Z", "2026-03-11T02:00:00.000Z")).code).toBe("SCHEDULE_OVERLAP");
  expect((await s("s3", "2026-03-10T23:00:00.000Z", "2026-03-11T05:00:00.000Z")).status).toBe("accepted"); // adjacent is fine
  expect((await s("s4", "2026-03-12T10:00:00.000Z", "2026-03-12T09:00:00.000Z")).code).toBe("INVALID_RANGE");
  expect((await s("s5", "2026-03-12T00:00:00.000Z", "2026-03-13T01:00:00.000Z")).code).toBe("INVALID_RANGE"); // longer than 24 h
  expect((await lab.command("cashier", "Staff.Schedule", { scheduleId: "x", userId: "chef", startsAt: "2026-03-14T00:00:00.000Z", endsAt: "2026-03-14T08:00:00.000Z" })).code).toBe("FORBIDDEN");
}));

test("an overnight attendance belongs to the business date it started on, in venue time", () => lab$(async lab => {
  await lab.seed("venue-layout", "current", { timezone: "Asia/Ho_Chi_Minh" });
  at(lab, "2026-03-10T15:30:00.000Z"); // 22:30 on 10 March in Vietnam
  await lab.command("chef", "Staff.ClockIn", { punchId: "n1" });
  at(lab, "2026-03-10T23:00:00.000Z"); // 06:00 on 11 March
  await lab.command("chef", "Staff.ClockOut", { punchId: "n2" });
  const start = await lab.report("attendance", "2026-03-10"), next = await lab.report("attendance", "2026-03-11");
  expect(rowsOf(start)).toHaveLength(1);
  expect(rowsOf(start)[0]).toMatchObject({ userId: "chef", durationMs: String(7.5 * 3600_000), status: "closed" });
  expect(rowsOf(next)).toHaveLength(0);
  expect((start.totals as JsonObject).totalDurationMs).toBe(String(7.5 * 3600_000));
  expect(start.basis).toMatch(/not payroll/i);
}));

test("a late correction is a manager amendment beside the source punch, never an edit of it", () => lab$(async lab => {
  at(lab, "2026-03-10T01:00:00.000Z");
  await lab.command("chef", "Staff.ClockIn", { punchId: "p1" });
  at(lab, "2026-03-10T09:00:00.000Z");
  await lab.command("chef", "Staff.ClockOut", { punchId: "p2" });
  const attendanceId = String((await (await lab.getStore("coordinator")).snapshots(lab.scope)).find(s => s.ref.kind === "attendance")!.ref.id);
  const fix = { attendanceId, clockOutAt: "2026-03-10T10:00:00.000Z", reason: "quên bấm ra, quản lý xác nhận" };
  expect((await lab.command("chef", "Staff.ApproveCorrection", fix)).code).toBe("FORBIDDEN");
  expect((await lab.command("manager", "Staff.ApproveCorrection", { ...fix, reason: " " })).code).toBe("REASON_REQUIRED");
  expect((await lab.command("manager", "Staff.ApproveCorrection", { ...fix, clockOutAt: "2026-03-09T00:00:00.000Z" })).code).toBe("NEGATIVE_DURATION");
  expect((await lab.command("manager", "Staff.ApproveCorrection", fix, "c1")).status).toBe("accepted");
  expect((await lab.command("manager", "Staff.ApproveCorrection", fix, "c2")).status).toBe("accepted"); // same correction again: no second record
  expect(await lab.count("AttendanceCorrected")).toBe(1);
  expect((await lab.state<JsonObject>("attendance", attendanceId)).clockOutAt).toBe("2026-03-10T09:00:00.000Z");
  const row = rowsOf(await lab.report("attendance", "2026-03-10"))[0]!;
  expect(row).toMatchObject({ clockOutAt: "2026-03-10T10:00:00.000Z", durationMs: String(9 * 3600_000), corrected: true, sourceClockOutAt: "2026-03-10T09:00:00.000Z" });
}));

test("attendance report shows open punches, lateness against the schedule and no-shows", () => lab$(async lab => {
  await lab.command("manager", "Staff.Schedule", { scheduleId: "a", userId: "chef", startsAt: "2026-03-10T01:00:00.000Z", endsAt: "2026-03-10T09:00:00.000Z" });
  await lab.command("manager", "Staff.Schedule", { scheduleId: "b", userId: "cashier", startsAt: "2026-03-10T01:00:00.000Z", endsAt: "2026-03-10T09:00:00.000Z" });
  at(lab, "2026-03-10T01:20:00.000Z");
  await lab.command("chef", "Staff.ClockIn", { punchId: "p1" });
  const r = await lab.report("attendance", "2026-03-10"), t = r.totals as JsonObject;
  expect(rowsOf(r).find(x => x.userId === "chef")).toMatchObject({ status: "open", durationMs: null, lateMs: String(20 * 60_000) });
  expect(t.open).toBe(1);
  expect(t.noShows).toEqual(["cashier"]);
  expect(reportCsv(r)).toContain("chef");
}));

test("stock and food-cost reports reconcile to the ledger and say when cost is missing or estimated", () => lab$(async lab => {
  await lab.command("manager", "Ingredient.Upsert", { ingredientId: "salt", name: "Muối", baseUnit: "g" });
  await lab.command("manager", "Recipe.Publish", { recipeVersion: "salty-v1", itemId: "tea", lines: [{ ingredientId: "salt", quantity: "10", unit: "g" }] });
  await lab.command("chef", "Inventory.Consume", { sourceEventId: "pr-1", recipeVersion: "rice-v1", quantity: "2" }); // 400 g rice, cost 8000
  await lab.command("chef", "Inventory.Consume", { sourceEventId: "pr-2", recipeVersion: "salty-v1", quantity: "1" }); // salt: none in stock, cost unknown
  await lab.command("chef", "Inventory.RecordWaste", { sourceEventId: "w-1", consumedSourceEventId: "pr-1", quantity: "1", reason: "khách hủy" });
  await lab.command("manager", "Goods.Receive", { purchaseId: "po-1", supplierReceipt: "S1", ingredientId: "rice-raw", quantity: "1000" });
  const day = new Date(lab.clock.nowMs).toISOString().slice(0, 10);
  const stock = await lab.report("stock", day), cost = await lab.report("food-cost", day);
  const ledger = (stock.ledger as JsonObject[]).find(l => l.ingredientId === "salt")!;
  expect(ledger).toMatchObject({ onHand: "-10", movementSumBase: "-10", driftBase: "0" });
  expect((stock.ledger as JsonObject[]).find(l => l.ingredientId === "rice-raw")).toMatchObject({ driftBase: "10000" }); // the fixture's opening balance has no movement behind it: shown, not hidden
  const kinds = new Map(rowsOf(stock).map(r => [String(r.movementKind) + ":" + String(r.ingredientId), r]));
  expect(kinds.get("consume:rice-raw")).toMatchObject({ deltaBase: "-400", valueMinor: "-8000", costKnown: true });
  expect(kinds.get("receipt:rice-raw")).toMatchObject({ deltaBase: "1000", valueMinor: "20000" });
  const t = cost.totals as JsonObject;
  expect(t).toMatchObject({ consumedCostMinor: "8000", wasteCostMinor: "4000", missingCostLines: 1 });
  expect(t.foodCostBasisPoints).toBeNull(); // no sales that day: a percentage of nothing is not 0
  expect(cost.basis).toMatch(/recipe/i);
  expect(rowsOf(cost).find(r => r.reference === "pr-1")).toMatchObject({ recipeVersion: "rice-v1", costMinor: "8000" });
  expect(reportCsv(stock).split("\r\n")[0]).toContain("ingredientId");
}));

test("concurrent permission changes leave identity untouched", () => lab$(async lab => {
  const rs = await Promise.all(["a", "b"].map(i => lab.command("manager", "Staff.SetPermissions", { userId: "chef", permissions: ["refund"] }, "perm-" + i)));
  expect(rs.map(r => r.code)).toEqual(["IDENTITY_WORKFLOW_REQUIRED", "IDENTITY_WORKFLOW_REQUIRED"]);
  expect(await lab.count("StaffClockedIn")).toBe(0);
}));
