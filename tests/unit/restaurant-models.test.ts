import { expect, test } from "vitest";
import { priceByMass } from "../../packages/domain/src/pricing/weighed";
import { comboComponents, componentRefundMinor } from "../../packages/domain/src/pricing/combo";
import { buffetStatus, clockFlags } from "../../packages/domain/src/pricing/buffet";
import { preset } from "../../packages/domain/src/policy/presets";
import { IMPLEMENTED_FEATURES, presetAcceptance, presetMigrationPreview, PRESET_NAMES } from "../../packages/domain/src/policy/preset-acceptance";
import { commandFeatures } from "../../packages/domain/src/restaurant-context";
import { featureRegistry } from "../../packages/domain/src/policy/registry";

test("weighed pricing uses integer mass rather than float multiplication", () => {
  expect(priceByMass("200000", "375", "1000")).toBe("75000");
  expect(() => priceByMass("200000", "-1", "1000")).toThrow();
});

test("weighed pricing rounds half up, allows zero and survives huge masses", () => {
  expect(priceByMass("200000", "0", "1000")).toBe("0");
  expect(priceByMass("1", "1", "2")).toBe("1"); // 0.5 rounds up
  expect(priceByMass("3", "1", "3")).toBe("1");
  expect(priceByMass("999999999999999999", "1000000000000", "1")).toBe("999999999999999999000000000000"); // no float anywhere
  expect(() => priceByMass("200000", "100", "0")).toThrow("INVALID_MASS");
  expect(() => priceByMass("200000", "1.5", "1000")).toThrow();
});

test("a combo's price is allocated to its parts exactly, discount included, so one part can be refunded", () => {
  const catalog = [{ id: "burger", name: "Burger", unitMinor: "60000", stationId: "kitchen" }, { id: "fries", name: "Khoai", unitMinor: "30000", stationId: "kitchen" }, { id: "cola", name: "Cola", unitMinor: "10000", stationId: "bar" }];
  const combo = { id: "set", combo: { components: [{ itemId: "burger", quantity: "1" }, { itemId: "fries", quantity: "1" }, { itemId: "cola", quantity: "2" }] } };
  const parts = comboComponents(combo, catalog, 2, "160000", "10000");
  expect(parts.reduce((a, p) => a + BigInt(p.shareMinor), 0n)).toBe(160000n);
  expect(parts.reduce((a, p) => a + BigInt(p.discountMinor), 0n)).toBe(10000n);
  expect(parts.map(p => p.quantity)).toEqual(["2", "2", "4"]); // per combo x number of combos
  const fries = parts.find(p => p.itemId === "fries")!;
  expect(componentRefundMinor({ components: parts }, "fries")).toBe(String(BigInt(fries.shareMinor) - BigInt(fries.discountMinor)));
  expect(() => componentRefundMinor({ components: parts }, "nope")).toThrow("COMPONENT_NOT_FOUND");
  expect(comboComponents({ id: "free", combo: { components: [{ itemId: "x", quantity: "1" }, { itemId: "y", quantity: "1" }] } }, [{ id: "x", unitMinor: "0" }, { id: "y", unitMinor: "0" }], 1, "10", "0").map(p => p.shareMinor)).toEqual(["5", "5"]); // zero list prices split evenly
});

test("buffet time comes from the wall clock, and monotonic evidence flags restarts and clock jumps without changing the price", () => {
  const b = { startedMs: 1_000_000, plannedEndMs: 1_000_000 + 90 * 60_000, clock: { bootId: "A", monotonicMs: 5_000 } };
  expect(buffetStatus(b, 1_000_000 + 30 * 60_000)).toMatchObject({ remainingMs: 60 * 60_000, expired: false });
  expect(buffetStatus(b, 1_000_000 + 91 * 60_000)).toMatchObject({ expired: true });
  expect(clockFlags(b, { bootId: "A", monotonicMs: 5_000 + 600_000 }, 1_000_000 + 600_000)).toEqual([]);
  expect(clockFlags(b, { bootId: "A", monotonicMs: 5_000 + 600_000 }, 1_000_000 + 900_000)).toEqual(["clock_skew"]); // wall clock jumped 5 minutes
  expect(clockFlags(b, { bootId: "B", monotonicMs: 100 }, 1_000_000 + 600_000)).toEqual(["restarted"]);
  expect(clockFlags({ ...b, clock: undefined }, { bootId: "B", monotonicMs: 1 }, 2_000_000)).toEqual(["no_start_evidence"]);
});

test("every preset template only enables implemented modules, with dependencies satisfied", () => {
  for (const name of PRESET_NAMES) {
    const a = presetAcceptance(name);
    expect(a.dependencyErrors, name).toEqual([]);
    expect(a.unimplemented, name).toEqual([]);
    expect(a.ok, name).toBe(true);
  }
  expect(PRESET_NAMES).toEqual(expect.arrayContaining(["trial-service", "cafe", "table-service", "buffet", "robot-only", "no-robot", "chain"]));
});

test("the implemented-module list covers every feature a command is gated by, and never claims a missing one", () => {
  const gated = new Set(Object.values(commandFeatures).map(f => f.feature));
  for (const f of gated) expect(IMPLEMENTED_FEATURES.has(f), f).toBe(true);
  for (const f of ["chain", "einvoice", "integrations", "payment.provider", "payment.transfer"]) expect(IMPLEMENTED_FEATURES.has(f), f).toBe(false);
  for (const f of IMPLEMENTED_FEATURES) expect(featureRegistry[f], f).toBeDefined();
});

test("templates match the capability matrix: cafe/no-robot hide robots, robot-only needs no menu, buffet adds service models, chain defers what does not exist", () => {
  const on = (n: string) => Object.entries(preset(n).features).filter(([, v]) => v.status === "enabled").map(([k]) => k);
  expect(on("cafe")).toEqual(expect.arrayContaining(["pos.order", "billing", "payment.cash", "cash.shift", "kitchen"]));
  expect(on("cafe")).not.toContain("loyalty"); // optional modules are switched on by the venue, not by the template
  expect(on("cafe").some(k => k.startsWith("robot") || k === "fleet")).toBe(false);
  expect(on("no-robot").some(k => k.startsWith("robot") || k === "fleet")).toBe(false);
  expect(on("robot-only")).not.toContain("pos.order");
  expect(on("robot-only")).not.toContain("catalog");
  expect(on("table-service")).toEqual(expect.arrayContaining(["sessions", "kitchen", "billing", "fulfillment"]));
  expect(on("table-service")).not.toContain("reservations");
  expect(on("buffet")).toEqual(expect.arrayContaining(["service.models", "sessions"]));
  expect(on("table-service")).not.toContain("service.models");
  expect(on("chain")).not.toContain("chain"); // W09 does not exist yet
  expect(presetAcceptance("chain").deferred).toEqual(expect.arrayContaining(["chain"]));
  // the trial preset is exactly what W06-T06 verified
  expect(on("trial-service").sort()).toEqual(["fleet", "fulfillment", "robot.bussing", "robot.delivery"]);
  expect(presetAcceptance("trial-service").deferred).toEqual([]);
});

test("a preset change is previewed, never applied, and never silently enables something that does not exist", () => {
  const current = preset("cafe").features;
  const plan = presetMigrationPreview(current, "table-service");
  expect(plan.enable).toEqual(["fulfillment"]);
  expect(plan.applied).toBe(false);
  expect(presetMigrationPreview(preset("cafe").features, "chain").blocked).toEqual(expect.arrayContaining(["chain"]));
  expect(presetMigrationPreview(preset("cafe").features, "chain").enable).not.toContain("chain");
  const same = presetMigrationPreview(preset("cafe").features, "cafe");
  expect(same.enable).toEqual([]); expect(same.drain).toEqual([]);
  const back = presetMigrationPreview(preset("table-service").features, "cafe");
  expect(back.drain).toEqual(["fulfillment"]); // turning a module off drains it: accepted work finishes
  expect(() => presetMigrationPreview(current, "nope")).toThrow("UNKNOWN_PRESET");
});
