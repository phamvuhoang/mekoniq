import { expect, test } from "vitest";
import { stocktakeAdjustment } from "../../packages/domain/src/inventory/stocktake";
import { applyAdjustment } from "../../packages/domain/src/inventory/stocktake";
import { stockValuation } from "../../packages/domain/src/inventory/valuation";
import { createRestaurantLab } from "../support/restaurant-lab";
import type { JsonObject } from "../../packages/contracts/src/index";
type Item = { onHand: string; valueMinor: string; movementSeq: number };
type Sheet = { status: string; items: { ingredientId: string; atCheckpoint: string; counted?: string; delta?: string; applied?: boolean; needsReview?: boolean }[]; version: number };
const lab$ = async (body: (lab: Awaited<ReturnType<typeof createRestaurantLab>>) => Promise<void>) => {
  const lab = await createRestaurantLab();
  try { await body(lab); } finally { await lab.close(); }
};
const sheet = (lab: Awaited<ReturnType<typeof createRestaurantLab>>, id = "st-1") => lab.state<Sheet>("stocktake", id);
async function counted(lab: Awaited<ReturnType<typeof createRestaurantLab>>, value: string, extra: JsonObject = {}) {
  await lab.command("manager", "Stocktake.Open", { stocktakeId: "st-1" });
  await lab.command("chef", "Stocktake.Count", { stocktakeId: "st-1", ingredientId: "rice-raw", counted: value, expectedVersion: (await sheet(lab)).version, ...extra });
}

test("stocktake preserves movements after the counted checkpoint", () => {
  expect(stocktakeAdjustment({ atCheckpoint: "100", counted: "90" })).toBe("-10");
  expect(applyAdjustment({ current: "120", delta: "-10" })).toBe("110");
});

test("a sale between count and apply survives: the adjustment is a delta, not an overwrite", () => lab$(async lab => {
  await counted(lab, "9800"); // checkpoint 10000 -> 200 g short
  await lab.command("chef", "Inventory.Consume", { sourceEventId: "sale-after-checkpoint", recipeVersion: "rice-v1", quantity: "2" }); // 400 g leaves meanwhile
  await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version });
  const r = await lab.command("owner", "Stocktake.Apply", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version });
  expect(r.status).toBe("accepted");
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9400"); // 10000 - 400 sold - 200 counted short
  expect((await sheet(lab)).status).toBe("applied");
  expect(await lab.count("StockAdjusted")).toBe(1);
}));

test("opening snapshots the ledger watermark and an unchanged count adjusts nothing", () => lab$(async lab => {
  await counted(lab, "10000");
  const s = await sheet(lab);
  expect(s.items[0]).toMatchObject({ ingredientId: "rice-raw", atCheckpoint: "10000", counted: "10000", delta: "0" });
  await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: s.version });
  await lab.command("owner", "Stocktake.Apply", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version });
  expect(await lab.count("StockAdjusted")).toBe(0);
  expect((await lab.state<Item>("stock-item", "rice-raw")).movementSeq).toBe(0);
}));

test("approval is separate from counting by default and stale approvals are refused", () => lab$(async lab => {
  await counted(lab, "9000");
  const v = (await sheet(lab)).version;
  expect((await lab.command("manager", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: v })).code).toBe("SELF_APPROVAL_FORBIDDEN");
  expect((await lab.command("chef", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: v })).code).toBe("FORBIDDEN");
  await lab.command("chef", "Stocktake.Count", { stocktakeId: "st-1", ingredientId: "rice-raw", counted: "9100", expectedVersion: v }); // recount after the manager looked
  expect((await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: v })).code).toBe("VERSION_CONFLICT");
  expect((await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version })).status).toBe("accepted");
  expect((await lab.command("owner", "Stocktake.Apply", { stocktakeId: "st-1", expectedVersion: 0 })).code).toBe("VERSION_CONFLICT");
}));

test("approval separation can be switched off by policy", () => lab$(async lab => {
  await lab.seed("inventory-policy", "current", { separateApproval: false });
  await counted(lab, "9000");
  expect((await lab.command("manager", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version })).status).toBe("accepted");
}));

test("a count from an untrusted clock needs an explicit review before approval", () => lab$(async lab => {
  await counted(lab, "9000", { clockConfidence: "low" });
  const v = (await sheet(lab)).version;
  expect((await sheet(lab)).items[0]!.needsReview).toBe(true);
  expect((await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: v })).code).toBe("REVIEW_REQUIRED");
  expect((await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: v, acknowledgeReview: true })).status).toBe("accepted");
}));

test("counting is closed after approval, a recount replaces the value, and reasons are validated", () => lab$(async lab => {
  await counted(lab, "9000", { reasonCode: "spoilage", evidence: "asset-photo-1" });
  expect((await sheet(lab)).items[0]).toMatchObject({ counted: "9000", delta: "-1000", reasonCode: "spoilage", evidence: "asset-photo-1" });
  const bad = await lab.command("chef", "Stocktake.Count", { stocktakeId: "st-1", ingredientId: "rice-raw", counted: "9000", reasonCode: "gift", expectedVersion: (await sheet(lab)).version });
  expect(bad.code).toBe("REASON_CODE_INVALID");
  const same = await lab.command("chef", "Stocktake.Count", { stocktakeId: "st-1", ingredientId: "rice-raw", counted: "9000", reasonCode: "spoilage", evidence: "asset-photo-1", expectedVersion: (await sheet(lab)).version }, "dup");
  expect(same.status).toBe("accepted");
  await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version });
  expect((await lab.command("chef", "Stocktake.Count", { stocktakeId: "st-1", ingredientId: "rice-raw", counted: "1", expectedVersion: (await sheet(lab)).version })).code).toBe("STOCKTAKE_NOT_OPEN");
}));

test("a positive adjustment is valued at the average and flagged as an estimate", () => lab$(async lab => {
  await counted(lab, "10500", { unit: "g" });
  await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version });
  await lab.command("owner", "Stocktake.Apply", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version });
  const rice = await lab.state<Item>("stock-item", "rice-raw");
  expect(rice.onHand).toBe("10500");
  expect(rice.valueMinor).toBe("210000"); // +500 g at the 20 minor/g average
  const rows = stockValuation(await (await lab.getStore("coordinator")).snapshots(lab.scope));
  expect(rows.find(r => r.ingredientId === "rice-raw")).toMatchObject({ onHand: "10500", valueMinor: "210000", avgCostMinorPerBase: "20", costKnown: true });
}));

test("a count adjustment follows the shelf even for an ingredient that blocks negative sales", () => lab$(async lab => {
  await lab.seed("stock-item", "saffron", { name: "Saffron", baseUnit: "g", conversions: {}, negativePolicy: "block", currency: "VND", onHand: "100", valueMinor: "1000", movementSeq: 0 });
  await lab.command("manager", "Stocktake.Open", { stocktakeId: "st-2", ingredientIds: ["saffron"] });
  await lab.command("chef", "Stocktake.Count", { stocktakeId: "st-2", ingredientId: "saffron", counted: "0", expectedVersion: 1 }); // shelf is empty at the checkpoint
  await lab.command("manager", "Inventory.RecordWaste", { sourceEventId: "w", ingredientId: "saffron", quantity: "50", reason: "rơi vãi" }); // 50 g go after it
  await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-2", expectedVersion: 2 });
  expect((await lab.command("owner", "Stocktake.Apply", { stocktakeId: "st-2", expectedVersion: 3 })).status).toBe("accepted");
  expect((await lab.state<Item>("stock-item", "saffron")).onHand).toBe("-50"); // the books say what the count found
}));

test("partial apply is recoverable: applied items are skipped when the apply is run again", () => lab$(async lab => {
  await lab.command("manager", "Ingredient.Upsert", { ingredientId: "salt", name: "Muối", baseUnit: "g" });
  await lab.command("manager", "Stocktake.Open", { stocktakeId: "st-1" });
  let v = (await sheet(lab)).version;
  for (const [ingredientId, n] of [["rice-raw", "9000"], ["salt", "50"]]) { await lab.command("chef", "Stocktake.Count", { stocktakeId: "st-1", ingredientId, counted: n, expectedVersion: v }); v = (await sheet(lab)).version; }
  await lab.command("owner", "Stocktake.Approve", { stocktakeId: "st-1", expectedVersion: v });
  const first = await lab.command("owner", "Stocktake.Apply", { stocktakeId: "st-1", ingredientIds: ["salt"], expectedVersion: (await sheet(lab)).version });
  expect(first.status).toBe("accepted");
  expect((await sheet(lab)).status).toBe("approved"); // rice still pending
  const rest = await lab.command("owner", "Stocktake.Apply", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version });
  expect(rest.status).toBe("accepted");
  expect((await sheet(lab)).status).toBe("applied");
  expect(await lab.count("StockAdjusted")).toBe(2); // salt once, rice once
  expect((await lab.state<Item>("stock-item", "salt")).onHand).toBe("50");
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9000");
  expect((await lab.command("owner", "Stocktake.Apply", { stocktakeId: "st-1", expectedVersion: (await sheet(lab)).version })).code).toBe("STOCKTAKE_STATE_CONFLICT");
}));
