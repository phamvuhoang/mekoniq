import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { renderEscPos, fold, ESC } from "../../integrations/printing/src/escpos";
import { printerSupport } from "../../integrations/printing/src/profile";
import type { Receipt } from "../../integrations/printing/src/receipt";
import fixture from "../fixtures/restaurant-v1.json";

const dir = new URL("../fixtures/printing/", import.meta.url);
const receipt = JSON.parse(readFileSync(new URL("receipt-cash-change.json", dir), "utf8")) as Receipt;
const golden = (name: string) => readFileSync(new URL(name, dir), "utf8").trim();
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

test("ESC/POS output matches the golden byte fixtures (42 and 32 columns, reprint mark top and bottom)", () => {
  expect(hex(renderEscPos(receipt, { columns: 42 }))).toBe(golden("receipt-cash-change.42col.hex"));
  expect(hex(renderEscPos(receipt, { columns: 32 }))).toBe(golden("receipt-cash-change.32col.hex"));
  const reprint = hex(renderEscPos(receipt, { columns: 42, reprint: { number: 1 } }));
  expect(reprint).toBe(golden("receipt-cash-change.42col.reprint1.hex"));
  expect(Buffer.from(reprint, "hex").toString("latin1").match(/IN LAI \/ REPRINT #1/g)).toHaveLength(2);
  expect(hex(renderEscPos(receipt, { columns: 42 }))).not.toContain(Buffer.from("REPRINT").toString("hex"));
});

test("output starts with ESC @, ends with feed + cut, only prints ASCII text and no line exceeds the columns", () => {
  for (const columns of [24, 32, 42, 48, 64]) {
    const bytes = renderEscPos(receipt, { columns });
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.slice(-7)]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0x00]);
    const body = Object.values(ESC).reduce((t, cmd) => t.replaceAll(Buffer.from(cmd).toString("latin1"), ""), Buffer.from(bytes).toString("latin1"));
    for (const line of body.split("\n")) expect(line.length).toBeLessThanOrEqual(columns);
    expect([...bytes].every(b => b < 0x80)).toBe(true);
  }
});

test("Vietnamese text folds to ASCII until a code page is verified on the device", () => {
  expect(fold("Cơm gà Đà Nẵng — 100%")).toBe("Com ga Da Nang ? 100%");
});

test("printer readiness: network ok, usb only when physically approved, bluetooth/uninstalled/incomplete never", () => {
  const p = fixture.printer;
  expect(printerSupport(p)).toEqual({ ready: true, reason: "OK" });
  expect(printerSupport({ ...p, transport: "usb" })).toEqual({ ready: false, reason: "USB_UNVERIFIED" });
  expect(printerSupport({ ...p, transport: "usb", validation: "venue_approved" }).ready).toBe(true);
  expect(printerSupport({ ...p, transport: "bluetooth", validation: "venue_approved" })).toEqual({ ready: false, reason: "BLUETOOTH_UNSUPPORTED" });
  expect(printerSupport({ ...p, transport: "serial" }).reason).toBe("TRANSPORT_UNSUPPORTED");
  expect(printerSupport({ ...p, status: "pending" }).reason).toBe("PRINTER_NOT_INSTALLED");
  expect(printerSupport({ ...p, columns: 10 }).reason).toBe("PRINTER_PROFILE_INCOMPLETE");
  expect(printerSupport({ ...p, validation: "claimed" }).reason).toBe("PRINTER_UNVALIDATED");
});
