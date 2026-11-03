import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { preset } from "../../packages/domain/src/policy/presets";
import type { JsonObject } from "../../packages/contracts/src/index";
type Lab = Awaited<ReturnType<typeof createRestaurantLab>>;
const lab$ = async (body: (lab: Lab) => Promise<void>) => { const lab = await createRestaurantLab(); try { await body(lab); } finally { await lab.close(); } };
const items: JsonObject[] = [
  { id: "rice", name: "Cơm", stationId: "kitchen", unitMinor: "50000", available: true },
  { id: "tea", name: "Trà", stationId: "bar", unitMinor: "20000", available: true },
  { id: "burger", name: "Burger", stationId: "kitchen", unitMinor: "60000", available: true },
  { id: "set", name: "Combo burger", stationId: "kitchen", unitMinor: "80000", available: true, combo: { components: [{ itemId: "burger", quantity: "1" }, { itemId: "tea", quantity: "2" }] } },
  { id: "fish", name: "Cá theo cân", stationId: "kitchen", unitMinor: "200000", available: true, weighed: { unitMass: "1000", unit: "g" } },
  { id: "bf-adult", name: "Buffet người lớn", stationId: "wash", unitMinor: "300000", available: true, buffet: { durationMinutes: 90, extendMinutes: 30, extendItemId: "bf-extra" } },
  { id: "bf-extra", name: "Gia hạn 30 phút", stationId: "wash", unitMinor: "50000", available: true },
];
async function menu(lab: Lab, extra: JsonObject = {}) {
  const r = await lab.command("manager", "Catalog.Publish", { version: 2, currency: "VND", items, pricing: { taxProfiles: [], defaultTaxProfileId: null, service: null, discountOrder: "before_tax", discounts: [{ id: "ten", name: "10%", kind: "percent", valueBps: 1000 }] }, ...extra });
  expect(r.status, String(r.code)).toBe("accepted");
}
const place = (lab: Lab, actor: string, its: JsonObject[], extra: JsonObject = {}) => lab.command(actor, "Order.Place", { sessionId: "session-1", tableId: "table-1", menuVersion: 2, items: its, ...extra });
async function open(lab: Lab) { await lab.command("cashier", "Session.Open", { sessionId: "session-1", tableId: "table-1" }); }

test("the catalog accepts weighed, combo and buffet items only when they are well-formed", () => lab$(async lab => {
  const publish = (bad: JsonObject) => lab.command("manager", "Catalog.Publish", { version: 2, currency: "VND", items: [...items.slice(0, 3), bad] });
  expect((await publish({ id: "w", name: "w", stationId: "kitchen", unitMinor: "1", available: true, weighed: { unitMass: "0", unit: "g" } })).code).toBe("INVALID_MODEL");
  expect((await publish({ id: "w", name: "w", stationId: "kitchen", unitMinor: "1", available: true, weighed: { unitMass: "100", unit: "lb" } })).code).toBe("INVALID_MODEL");
  expect((await publish({ id: "c", name: "c", stationId: "kitchen", unitMinor: "1", available: true, combo: { components: [{ itemId: "ghost", quantity: "1" }] } })).code).toBe("INVALID_MODEL");
  expect((await publish({ id: "c", name: "c", stationId: "kitchen", unitMinor: "1", available: true, combo: { components: [{ itemId: "c", quantity: "1" }] } })).code).toBe("INVALID_MODEL");
  expect((await publish({ id: "b", name: "b", stationId: "kitchen", unitMinor: "1", available: true, buffet: { durationMinutes: 90, extendMinutes: 30, extendItemId: "ghost" } })).code).toBe("INVALID_MODEL");
  await menu(lab);
}));

test("a weighed item is priced from an integer mass; a manual weight needs a manager and is recorded", () => lab$(async lab => {
  await menu(lab); await open(lab);
  const fish = (mass: string, source = "manual", extra: JsonObject = {}) => [{ itemId: "fish", quantity: "1", measure: { mass, source, ...extra } }];
  expect((await place(lab, "cashier", fish("375"))).code).toBe("FORBIDDEN"); // manual entry is an approval
  expect((await lab.command("manager", "WeighedItem.Quote", { itemId: "fish", measure: { mass: "375", source: "manual" } })).value.totalMinor).toBe("75000");
  expect((await place(lab, "manager", [{ itemId: "fish", quantity: "2", measure: { mass: "375", source: "manual" } }])).code).toBe("WEIGHED_QUANTITY_INVALID");
  expect((await place(lab, "manager", [{ itemId: "fish", quantity: "1" }])).code).toBe("MEASURE_REQUIRED");
  expect((await place(lab, "manager", fish("-5"))).code).toBe("INVALID_MASS");
  expect((await place(lab, "manager", fish("375", "scale", { scaleId: "scale-1" }))).code).toBe("SCALE_NOT_CONFIGURED"); // no hardware profile: no pretend scale
  const placed = await place(lab, "manager", fish("375"));
  expect(placed.status).toBe("accepted");
  const line = (await lab.state<{ lines: JsonObject[]; totalMinor: string }>("order", String(placed.value.orderId))).lines[0]!;
  expect(line).toMatchObject({ itemId: "fish", subtotalMinor: "75000", measure: { mass: "375", unit: "g", source: "manual", unitMass: "1000", approvedBy: "manager" } });
}));

test("an installed, venue-approved scale lets a cashier weigh without a manager", () => lab$(async lab => {
  await menu(lab); await open(lab);
  await lab.seed("scale", "scale-1", { validation: "venue_approved", model: "bench-scale-fixture", label: "FIXTURE scale profile (no hardware)" });
  const r = await place(lab, "cashier", [{ itemId: "fish", quantity: "1", measure: { mass: "500", source: "scale", scaleId: "scale-1" } }]);
  expect(r.status, String(r.code)).toBe("accepted");
  expect((await lab.state<{ totalMinor: string }>("order", String(r.value.orderId))).totalMinor).toBe("100000");
  await lab.seed("scale", "scale-2", { validation: "integration_tested" });
  expect((await place(lab, "cashier", [{ itemId: "fish", quantity: "1", measure: { mass: "500", source: "scale", scaleId: "scale-2" } }], { orderId: "o2" })).code).toBe("SCALE_NOT_CONFIGURED");
}));

test("a combo snapshots its parts with an exact share of price and of the discount", () => lab$(async lab => {
  await menu(lab); await open(lab);
  const q = await lab.command("manager", "Combo.Quote", { comboItemId: "set", quantity: "2", discountIds: ["ten"] });
  expect(q.status).toBe("accepted");
  const line = (q.value.lines as JsonObject[])[0]!, parts = line.components as { itemId: string; shareMinor: string; discountMinor: string; quantity: string }[];
  expect(line).toMatchObject({ subtotalMinor: "160000", discountMinor: "16000" });
  expect(parts.reduce((a, p) => a + BigInt(p.shareMinor), 0n)).toBe(160000n);
  expect(parts.reduce((a, p) => a + BigInt(p.discountMinor), 0n)).toBe(16000n);
  expect(parts.map(p => [p.itemId, p.quantity])).toEqual([["burger", "2"], ["tea", "4"]]);
  expect((await lab.command("manager", "Combo.Quote", { comboItemId: "rice", quantity: "1" })).code).toBe("NOT_A_COMBO");
  const placed = await place(lab, "manager", [{ itemId: "set", quantity: "2" }], { discountIds: ["ten"] });
  expect(placed.status).toBe("accepted");
  expect((await lab.state<{ lines: JsonObject[] }>("order", String(placed.value.orderId))).lines[0]!.components).toHaveLength(2);
}));

test("buffet: the package is a normal priced order line; the timer, extensions and clock evidence are kept beside it", () => lab$(async lab => {
  await menu(lab); await open(lab);
  lab.clock.nowMs = Date.parse("2026-03-10T18:00:00.000Z");
  const start = await lab.command("cashier", "Buffet.Start", { buffetId: "bf-1", sessionId: "session-1", tableId: "table-1", menuVersion: 2, packageItemId: "bf-adult", guests: 3, clock: { bootId: "boot-1", monotonicMs: 1000 } });
  expect(start.status, String(start.code)).toBe("accepted");
  const bf = () => lab.state<JsonObject>("buffet", "bf-1");
  expect(await bf()).toMatchObject({ guests: 3, status: "active", durationMinutes: 90, plannedEndMs: Date.parse("2026-03-10T19:30:00.000Z") });
  expect((await lab.state<{ totalMinor: string }>("order", String(start.value.orderId))).totalMinor).toBe("900000"); // 3 x 300 000 on the bill
  expect((await lab.command("cashier", "Buffet.Start", { buffetId: "bf-2", sessionId: "session-1", tableId: "table-1", menuVersion: 2, packageItemId: "bf-adult", guests: 1 })).code).toBe("BUFFET_ACTIVE");
  expect((await lab.command("cashier", "Buffet.Start", { buffetId: "bf-3", sessionId: "session-1", tableId: "table-1", menuVersion: 2, packageItemId: "rice", guests: 1 })).code).toBe("NOT_A_BUFFET_PACKAGE");
  lab.clock.nowMs = Date.parse("2026-03-10T19:20:00.000Z");
  const ext = await lab.command("cashier", "Buffet.Extend", { buffetId: "bf-1", clock: { bootId: "boot-2", monotonicMs: 50 } }); // the tablet restarted in between
  expect(ext.status, String(ext.code)).toBe("accepted");
  expect(await bf()).toMatchObject({ plannedEndMs: Date.parse("2026-03-10T20:00:00.000Z"), flags: ["restarted"] });
  expect((await lab.state<{ totalMinor: string }>("order", String(ext.value.orderId))).totalMinor).toBe("150000"); // 3 guests x 50 000
  lab.clock.nowMs = Date.parse("2026-03-10T21:00:00.000Z"); // already over: the extension runs from now, not from the old end
  await lab.command("cashier", "Buffet.Extend", { buffetId: "bf-1" }, "late");
  expect(((await bf()).plannedEndMs as number)).toBe(Date.parse("2026-03-10T21:30:00.000Z"));
  expect(((await bf()).extensions as JsonObject[])).toHaveLength(2);
  expect((await lab.command("cashier", "Buffet.Extend", { buffetId: "nope" })).code).toBe("NOT_FOUND");
}));

test("a venue can run as a cafe or as robot-only from the same build, only by applying a preset", () => lab$(async lab => {
  await menu(lab);
  const apply = async (name: string) => {
    const cur = await lab.state<{ revision: number }>("configuration", "applied"), revision = cur.revision + 1;
    const features = Object.fromEntries(Object.entries(preset(name).features).map(([k, f]) => [k, { status: f.status, revision }]));
    const r = await lab.command("manager", "Configuration.Apply", { revision, features });
    expect(r.status, String(r.code)).toBe("accepted");
  };
  await apply("cafe");
  await open(lab);
  expect((await place(lab, "cashier", [{ itemId: "tea", quantity: "1" }])).status).toBe("accepted");
  const refused = ["FEATURE_DISABLED", "FEATURE_DRAINING"]; // draining while the fixture venue still has accepted robot work, disabled otherwise: both refuse new work
  expect(refused).toContain((await lab.command("cashier", "Mission.Create", { robotId: "sim-1", kind: "delivery", stops: [] })).code); // no robot mission in a cafe
  await apply("robot-only");
  expect(refused).toContain((await lab.command("cashier", "Catalog.Quote", { items: [{ itemId: "tea", quantity: "1" }] })).code); // robot-only does not need a menu
}));

test("the sales report shows the price basis of a weighed and a combo line and the bill still reconciles", () => lab$(async lab => {
  await menu(lab); await open(lab);
  await lab.command("cashier", "Shift.Open", { currency: "VND", openingMinor: "0" });
  await place(lab, "manager", [{ itemId: "fish", quantity: "1", measure: { mass: "375", source: "manual" } }, { itemId: "set", quantity: "1" }]);
  const bill = await lab.command("cashier", "Bill.Prepare", { sessionId: "session-1" });
  expect(bill.status, String(bill.code)).toBe("accepted");
  const billId = String(bill.value.billId), v = async () => (await lab.state<{ version: number; totalMinor: string }>("bill", billId));
  expect((await v()).totalMinor).toBe("155000"); // 75 000 by weight + the 80 000 combo
  await lab.command("cashier", "Payment.RecordCash", { billId, amountMinor: "155000", expectedVersion: (await v()).version });
  const closed = await lab.command("cashier", "Bill.Close", { billId, expectedVersion: (await v()).version });
  expect(closed.status, String(closed.code)).toBe("accepted");
  const sales = await lab.report("sales", new Date(lab.clock.nowMs).toISOString().slice(0, 10));
  expect(sales.units).toEqual(expect.arrayContaining([{ itemId: "fish", name: "Cá theo cân", quantity: "1", basis: "weighed", mass: "375" }, { itemId: "set", name: "Combo burger", quantity: "1", basis: "combo" }]));
  expect((sales.reconciliation as JsonObject).differenceMinor).toBe("0");
}));
