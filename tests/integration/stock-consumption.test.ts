import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { toBase } from "../../packages/domain/src/inventory/uom";
import type { JsonObject } from "../../packages/contracts/src/index";
type Item = { onHand: string; valueMinor: string; movementSeq: number; version: number };
const lab$ = async (body: (lab: Awaited<ReturnType<typeof createRestaurantLab>>) => Promise<void>) => {
  const lab = await createRestaurantLab();
  try { await body(lab); } finally { await lab.close(); }
};
const consume = (data: JsonObject) => ({ sourceEventId: "prep-1", recipeVersion: "rice-v1", quantity: "2", ...data });

test("replayed preparation consumes stock once", () => lab$(async lab => {
  const data = { sourceEventId: "prep-1", recipeVersion: "rice-v1", quantity: "2" };
  await lab.command("chef", "Inventory.Consume", data, "stock-a");
  await lab.command("chef", "Inventory.Consume", data, "stock-b");
  expect(await lab.count("StockConsumed")).toBe(1);
  const rice = await lab.state<Item>("stock-item", "rice-raw");
  expect(rice.onHand).toBe("9600"); // 2 portions x 200 g, deducted exactly once
  expect(rice.valueMinor).toBe("192000"); // weighted average 20 minor/g leaves with the stock
}));

test("the same source with another recipe version or quantity is refused, never consumed twice", () => lab$(async lab => {
  await lab.command("chef", "Inventory.Consume", consume({}), "c1");
  await lab.command("manager", "Recipe.Publish", { recipeVersion: "rice-v2", itemId: "rice", lines: [{ ingredientId: "rice-raw", quantity: "300", unit: "g" }] });
  expect((await lab.command("chef", "Inventory.Consume", consume({ recipeVersion: "rice-v2" }), "c2")).code).toBe("SOURCE_CONSUMED_DIFFERENTLY");
  expect((await lab.command("chef", "Inventory.Consume", consume({ quantity: "3" }), "c3")).code).toBe("SOURCE_CONSUMED_DIFFERENTLY");
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9600");
}));

test("a recipe published mid-order never changes what an earlier version consumed", () => lab$(async lab => {
  await lab.command("manager", "Recipe.Publish", { recipeVersion: "rice-v2", itemId: "rice", lines: [{ ingredientId: "rice-raw", quantity: "0.3", unit: "kg" }] });
  expect((await lab.state<JsonObject>("recipe-pointer", "rice")).recipeVersion).toBe("rice-v2");
  expect((await lab.command("manager", "Recipe.Publish", { recipeVersion: "rice-v1", itemId: "rice", lines: [{ ingredientId: "rice-raw", quantity: "1", unit: "g" }] })).code).toBe("RECIPE_VERSION_EXISTS");
  await lab.command("chef", "Inventory.Consume", consume({ sourceEventId: "old" }));
  await lab.command("chef", "Inventory.Consume", { sourceEventId: "new", itemId: "rice", quantity: "1" });
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9300"); // v1 200 g x2 + v2 300 g x1
}));

test("conversions are exact and need a declared dimension or factor", async () => {
  const rice = { baseUnit: "g", conversions: { bag: "25000" } };
  expect(toBase(rice, "0.25", "kg")).toBe("250");
  expect(toBase(rice, "2", "bag")).toBe("50000");
  expect(() => toBase(rice, "1", "piece")).toThrow("UOM_CONVERSION_MISSING");
  expect(() => toBase(rice, "0.0005", "kg")).toThrow("INEXACT_QUANTITY");
  expect(() => toBase(rice, "1", "furlong")).toThrow("UNKNOWN_UNIT");
  expect(() => toBase({ baseUnit: "piece" }, "1", "kg")).toThrow("UOM_CONVERSION_MISSING");
});

test("publishing a recipe rejects unknown ingredients, duplicates and unconvertible units", () => lab$(async lab => {
  const publish = (lines: JsonObject[]) => lab.command("manager", "Recipe.Publish", { recipeVersion: "x-v1", itemId: "rice", lines });
  expect((await publish([{ ingredientId: "ghost", quantity: "1", unit: "g" }])).code).toBe("INGREDIENT_UNKNOWN");
  expect((await publish([{ ingredientId: "rice-raw", quantity: "1", unit: "g" }, { ingredientId: "rice-raw", quantity: "2", unit: "g" }])).code).toBe("DUPLICATE_INGREDIENT");
  expect((await publish([{ ingredientId: "rice-raw", quantity: "1", unit: "piece" }])).code).toBe("UOM_CONVERSION_MISSING");
  expect((await lab.command("chef", "Recipe.Publish", { recipeVersion: "x-v1", itemId: "rice", lines: [] })).code).toBe("FORBIDDEN");
}));

test("fractional portions must land on whole base units", () => lab$(async lab => {
  expect((await lab.command("chef", "Inventory.Consume", consume({ sourceEventId: "half", quantity: "0.5" }))).status).toBe("accepted");
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9900");
  expect((await lab.command("chef", "Inventory.Consume", consume({ sourceEventId: "tiny", quantity: "0.001" }))).code).toBe("INEXACT_QUANTITY");
}));

test("cost leaves at weighted average and a shortfall is flagged, not invented", () => lab$(async lab => {
  await lab.command("manager", "Ingredient.Upsert", { ingredientId: "salt", name: "Muối", baseUnit: "g" });
  await lab.command("manager", "Recipe.Publish", { recipeVersion: "salty-v1", itemId: "tea", lines: [{ ingredientId: "salt", quantity: "10", unit: "g" }] });
  const r = await lab.command("chef", "Inventory.Consume", { sourceEventId: "p9", recipeVersion: "salty-v1", quantity: "1" });
  expect(r.status).toBe("accepted"); // default policy never blocks service
  const salt = await lab.state<Item>("stock-item", "salt");
  expect(salt.onHand).toBe("-10");
  const movement = (await lab.state<JsonObject>("consumption", String(r.value.consumptionId))).lines as JsonObject[];
  expect(movement[0]).toMatchObject({ ingredientId: "salt", costKnown: false, costMinor: "0" });
}));

test("an ingredient set to block refuses to go negative", () => lab$(async lab => {
  await lab.command("manager", "Ingredient.Upsert", { ingredientId: "saffron", name: "Saffron", baseUnit: "g", negativePolicy: "block" });
  await lab.command("manager", "Recipe.Publish", { recipeVersion: "saf-v1", itemId: "tea", lines: [{ ingredientId: "saffron", quantity: "1", unit: "g" }] });
  expect((await lab.command("chef", "Inventory.Consume", { sourceEventId: "p10", recipeVersion: "saf-v1", quantity: "1" })).code).toBe("INSUFFICIENT_STOCK");
  expect(await lab.count("StockConsumed")).toBe(0);
}));

test("cancelling a prepared dish records waste and never restocks", () => lab$(async lab => {
  await lab.command("chef", "Inventory.Consume", consume({ quantity: "2" }));
  const w = { sourceEventId: "waste-1", consumedSourceEventId: "prep-1", quantity: "1", reason: "khách hủy món đã làm" };
  expect((await lab.command("chef", "Inventory.RecordWaste", w, "w-a")).status).toBe("accepted");
  expect((await lab.command("chef", "Inventory.RecordWaste", w, "w-b")).status).toBe("accepted");
  expect(await lab.count("StockWasted")).toBe(1);
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9600"); // already left at preparation; nothing comes back
  expect((await lab.command("chef", "Inventory.RecordWaste", { ...w, sourceEventId: "waste-2", quantity: "2" })).code).toBe("WASTE_EXCEEDS_CONSUMED");
  expect((await lab.command("chef", "Inventory.RecordWaste", { ...w, sourceEventId: "waste-3", reason: " " })).code).toBe("REASON_REQUIRED");
}));

test("raw spoilage deducts stock under its own source id", () => lab$(async lab => {
  const w = { sourceEventId: "spoil-1", ingredientId: "rice-raw", quantity: "0.5", unit: "kg", reason: "ẩm mốc" };
  expect((await lab.command("manager", "Inventory.RecordWaste", w)).status).toBe("accepted");
  await lab.command("manager", "Inventory.RecordWaste", w, "again");
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("9500");
}));

test("a historical source without its recipe opens an exception instead of using today's recipe", () => lab$(async lab => {
  const r = await lab.command("manager", "Inventory.Consume", { sourceEventId: "old-1", recipeVersion: "gone-v0", quantity: "1", historical: true });
  expect(r.status).toBe("accepted");
  expect(r.value.exception).toBe(true);
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("10000");
  expect(await lab.count("StockConsumed")).toBe(0);
  expect((await lab.command("chef", "Inventory.Consume", { sourceEventId: "live-1", recipeVersion: "gone-v0", quantity: "1" })).code).toBe("RECIPE_NOT_FOUND");
  await lab.command("manager", "Inventory.Consume", { sourceEventId: "old-1", recipeVersion: "gone-v0", quantity: "1", historical: true }, "again");
  expect(await lab.count("StockExceptionOpened")).toBe(1);
}));

test("inventory off blocks new recipes but a draining kitchen still deducts what it cooked", () => lab$(async lab => {
  const cfg = await lab.state<JsonObject>("configuration", "applied");
  const features = { ...(cfg.features as JsonObject), inventory: { status: "draining", revision: 1 } };
  await lab.seed("configuration", "applied", { ...cfg, features, version: (cfg.version as number) + 1 });
  expect((await lab.command("chef", "Inventory.Consume", consume({}))).status).toBe("accepted");
  expect((await lab.command("manager", "Recipe.Publish", { recipeVersion: "n-v1", itemId: "rice", lines: [{ ingredientId: "rice-raw", quantity: "1", unit: "g" }] })).code).toBe("FEATURE_DRAINING");
}));
