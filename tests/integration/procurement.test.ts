import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { receivable } from "../../packages/domain/src/procurement/purchase-order";
import type { JsonObject } from "../../packages/contracts/src/index";
type Item = { onHand: string; valueMinor: string; movementSeq: number };
type Po = { status: string; lines: { ingredientId: string; ordered: string; received: string; returned: string }[]; version: number };
const lab$ = async (body: (lab: Awaited<ReturnType<typeof createRestaurantLab>>) => Promise<void>) => {
  const lab = await createRestaurantLab();
  try { await body(lab); } finally { await lab.close(); }
};
const receipt = (data: JsonObject = {}) => ({ purchaseId: "po-1", supplierReceipt: "SUP-10", ingredientId: "rice-raw", quantity: "1000", ...data });

test("repeated delivery note does not receive twice", () => lab$(async lab => {
  const p = { purchaseId: "po-1", supplierReceipt: "SUP-10", ingredientId: "rice-raw", quantity: "1000" };
  await lab.command("manager", "Goods.Receive", p, "receive-a");
  await lab.command("manager", "Goods.Receive", p, "receive-b");
  expect(await lab.count("GoodsReceived")).toBe(1);
  const rice = await lab.state<Item>("stock-item", "rice-raw");
  expect(rice.onHand).toBe("11000");
  expect(rice.valueMinor).toBe("220000"); // 200000 on hand + 1000 g x 20 minor/g received
}));

test("the same supplier note reused with an altered payload is refused", () => lab$(async lab => {
  await lab.command("manager", "Goods.Receive", receipt());
  expect((await lab.command("manager", "Goods.Receive", receipt({ quantity: "1200" }), "again")).code).toBe("SUPPLIER_RECEIPT_REUSED");
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("11000");
}));

test("partial receipts accumulate up to the ordered quantity and the PO closes itself", () => lab$(async lab => {
  expect((await lab.command("manager", "Goods.Receive", receipt({ quantity: "3000" }))).status).toBe("accepted");
  expect((await lab.state<Po>("purchase", "po-1")).status).toBe("partially_received");
  expect((await lab.command("manager", "Goods.Receive", receipt({ supplierReceipt: "SUP-11", quantity: "2001" }))).code).toBe("OVER_RECEIVED");
  expect((await lab.command("manager", "Goods.Receive", receipt({ supplierReceipt: "SUP-11", quantity: "2000" }))).status).toBe("accepted");
  expect((await lab.state<Po>("purchase", "po-1")).status).toBe("received");
  expect((await lab.command("manager", "Goods.Receive", receipt({ supplierReceipt: "SUP-12", quantity: "1" }))).code).toBe("PURCHASE_NOT_RECEIVABLE");
  expect(receivable("5000", "3000", "0")).toBe("2000");
  expect(receivable("5000", "5000", "250")).toBe("250");
}));

test("an approved tolerance allows a bounded over-delivery", () => lab$(async lab => {
  await lab.seed("purchase", "po-tol", { supplierId: "supplier-1", currency: "VND", status: "approved", lines: [{ ingredientId: "rice-raw", unit: "g", ordered: "1000", received: "0", returned: "0", tolerance: "100", unitCostMinor: "20", perBase: "1" }], version: 2 });
  expect((await lab.command("manager", "Goods.Receive", receipt({ purchaseId: "po-tol", quantity: "1101" }))).code).toBe("OVER_RECEIVED");
  expect((await lab.command("manager", "Goods.Receive", receipt({ purchaseId: "po-tol", quantity: "1100" }))).status).toBe("accepted");
}));

test("concurrent receipts can never exceed the order", () => lab$(async lab => {
  const rs = await Promise.all(["A", "B", "C"].map(id => lab.command("manager", "Goods.Receive", receipt({ supplierReceipt: "N-" + id, quantity: "2500" }), "r-" + id)));
  const accepted = rs.filter(r => r.status === "accepted").length;
  expect(accepted).toBeLessThanOrEqual(2);
  const po = await lab.state<Po>("purchase", "po-1");
  expect(BigInt(po.lines[0]!.received)).toBe(BigInt(accepted) * 2500n);
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe(String(10000n + BigInt(accepted) * 2500n));
}));

test("units convert exactly and currency must match the order", () => lab$(async lab => {
  await lab.seed("purchase", "po-1", { supplierId: "supplier-1", currency: "VND", status: "approved", lines: [{ ingredientId: "rice-raw", unit: "g", ordered: "100000", received: "0", returned: "0", tolerance: "0", unitCostMinor: "20", perBase: "1" }], version: 2 });
  expect((await lab.command("manager", "Goods.Receive", receipt({ quantity: "1", unit: "bag" }))).status).toBe("accepted");
  expect((await lab.state<Item>("stock-item", "rice-raw")).onHand).toBe("35000");
  expect((await lab.command("manager", "Goods.Receive", receipt({ supplierReceipt: "S2", quantity: "1", unit: "piece" }))).code).toBe("UOM_CONVERSION_MISSING");
  expect((await lab.command("manager", "Goods.Receive", receipt({ supplierReceipt: "S3", currency: "USD" }))).code).toBe("CURRENCY_MISMATCH");
}));

test("create, approve and receive follow separate permissions and states", () => lab$(async lab => {
  const lines = [{ ingredientId: "rice-raw", quantity: "10", unit: "kg", unitCostMinor: "21000" }];
  expect((await lab.command("chef", "Purchase.Create", { purchaseId: "po-9", supplierId: "supplier-1", lines })).code).toBe("FORBIDDEN");
  expect((await lab.command("manager", "Purchase.Create", { purchaseId: "po-9", supplierId: "ghost", lines })).code).toBe("SUPPLIER_UNKNOWN");
  expect((await lab.command("manager", "Purchase.Create", { purchaseId: "po-9", supplierId: "supplier-1", lines })).status).toBe("accepted");
  expect((await lab.command("manager", "Goods.Receive", receipt({ purchaseId: "po-9", supplierReceipt: "X1", quantity: "1" }))).code).toBe("PURCHASE_NOT_RECEIVABLE");
  const draft = await lab.state<Po>("purchase", "po-9");
  expect((await lab.command("manager", "Purchase.Approve", { purchaseId: "po-9", expectedVersion: draft.version })).status).toBe("accepted");
  expect((await lab.command("manager", "Goods.Receive", receipt({ purchaseId: "po-9", supplierReceipt: "X1", quantity: "2", unit: "kg" }))).status).toBe("accepted");
  const rice = await lab.state<Item>("stock-item", "rice-raw");
  expect(rice.onHand).toBe("12000");
  expect(rice.valueMinor).toBe("242000"); // 2 kg at 21000 per kg = 42000 joins 200000
}));

test("a return leaves at the original receipt cost, within what was received", () => lab$(async lab => {
  const r = await lab.command("manager", "Goods.Receive", receipt());
  const ret = { sourceEventId: "ret-1", receiptId: String(r.value.receiptId), ingredientId: "rice-raw", quantity: "400", reason: "hỏng" };
  expect((await lab.command("manager", "Goods.Return", ret, "a")).status).toBe("accepted");
  expect((await lab.command("manager", "Goods.Return", ret, "b")).status).toBe("accepted");
  const rice = await lab.state<Item>("stock-item", "rice-raw");
  expect(rice.onHand).toBe("10600");
  expect(rice.valueMinor).toBe("212000"); // 400 g at the receipt's 20/g, not today's average
  expect(await lab.count("GoodsReturned")).toBe(1);
  expect((await lab.command("manager", "Goods.Return", { ...ret, sourceEventId: "ret-2", quantity: "601" })).code).toBe("RETURN_EXCEEDS_RECEIPT");
  expect((await lab.command("manager", "Goods.Return", { ...ret, sourceEventId: "ret-3", reason: " " })).code).toBe("REASON_REQUIRED");
  expect((await lab.state<Po>("purchase", "po-1")).lines[0]!.returned).toBe("400");
}));

test("short-closing an order stops further receipts but keeps its history", () => lab$(async lab => {
  await lab.command("manager", "Goods.Receive", receipt());
  expect((await lab.command("manager", "Purchase.Close", { purchaseId: "po-1", reason: "nhà cung cấp hết hàng", expectedVersion: (await lab.state<Po>("purchase", "po-1")).version })).status).toBe("accepted");
  expect((await lab.state<Po>("purchase", "po-1")).status).toBe("closed");
  expect((await lab.command("manager", "Goods.Receive", receipt({ supplierReceipt: "LATE", quantity: "1" }))).code).toBe("PURCHASE_NOT_RECEIVABLE");
}));
