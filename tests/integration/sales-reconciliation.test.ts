import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import type { Lab } from "../support/lab";
import { createSimulator, completeSimulatedTravel } from "../support/restaurant-journey";
import fixture from "../fixtures/restaurant-v1.json";
import type { JsonObject, Snapshot } from "../../packages/contracts/src/index";
import { buildReport, reportCsv, csvCell } from "../../packages/domain/src/reporting/report";
import { netSales } from "../../packages/domain/src/reporting/sales";

test("late historical receipt adjusts the original business day", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.importApproved([{sourceType:"paper",sourceSeries:"M1",sourceNumber:"2",
      occurredAt:"2026-10-29T14:00:00Z",businessDate:"2026-10-29",
      totalMinor:"50000",paidCashMinor:"50000",fulfilled:true}]);
    expect((await lab.report("sales","2026-10-29")).netMinor).toBe("50000");
    expect((await lab.report("sales","2026-10-30")).netMinor).toBe("0");
    // it counts on its own day, flagged as applied later (import date), never on the import date
    const day = await lab.report("sales","2026-10-29");
    expect(day.lateAdjustments).toMatchObject([{kind:"historical-receipt",amountMinor:"50000",businessDate:"2026-10-29",appliedBusinessDate:"2026-10-30"}]);
    expect(day.historical).toMatchObject({count:1,totalMinor:"50000",paidCashMinor:"50000"});
    expect(day.status).toBe("current");
  } finally { await lab.close(); }
});

const ok = (r: { status: string; code?: string }) => { expect(r.code ?? r.status).toBe("accepted"); return r as { status: string; value: JsonObject }; };
const pricing = { taxProfiles: [{ id: "vat8", name: "VAT 8%", rateBps: 800, inclusive: false }], defaultTaxProfileId: "vat8", service: { rateBps: 500, taxable: false }, discountOrder: "before_tax", discounts: [{ id: "ten", name: "10%", kind: "percent", valueBps: 1000 }] };
type Bill = JsonObject & { totalMinor: string; paidMinor: string; refundedMinor: string; summary: Record<string, string>; version: number };
async function bill(lab: Lab, sessionId: string, tableId: string, items: JsonObject[], coupon = true) {
  ok(await lab.command("cashier","Session.Open",{sessionId,tableId}));
  const placed = ok(await lab.command("manager","Order.Place",{sessionId,tableId,menuVersion:1,items,...(coupon ? {discountIds:["ten"]} : {})}));
  return { placed, billId: String(ok(await lab.command("cashier","Bill.Prepare",{sessionId})).value.billId) };
}
const sum = (xs: unknown[]) => String(xs.reduce<bigint>((a, x) => a + BigInt(String(x)), 0n));

test("a three-way split paid two ways with partial refunds reconciles to the bill, payment and refund ledger", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("catalog","current",{ ...fixture.menu, pricing } as JsonObject);
    // 3 rice (one cancelled before billing) + 2 tea, 10% coupon, 5% service, 8% VAT
    ok(await lab.command("cashier","Session.Open",{sessionId:"session-1",tableId:"table-1"}));
    const placed = ok(await lab.command("manager","Order.Place",{sessionId:"session-1",tableId:"table-1",menuVersion:1,items:[{itemId:"rice",quantity:"3"},{itemId:"tea",quantity:"2"}],discountIds:["ten"]}));
    ok(await lab.command("cashier","Order.Amend",{lineId:(placed.value.lineIds as string[])[0]!,cancelQuantity:"1",reason:"guest",expectedVersion:1}));
    const billId = String(ok(await lab.command("cashier","Bill.Prepare",{sessionId:"session-1"})).value.billId);
    const parent = await lab.state<Bill>("bill", billId);
    expect(parent.totalMinor).toBe("142380");
    const split = ok(await lab.command("cashier","Bill.Split",{billId,mode:"equal",parts:3,expectedVersion:parent.version}));
    const [a, b, c] = split.value.childBillIds as string[];
    ok(await lab.command("cashier","Shift.Open",{shiftId:"shift-1",currency:"VND",openingMinor:"100000"}));
    const child = (id: string) => lab.state<Bill>("bill", id);
    const A = await child(a!), B = await child(b!), C = await child(c!);
    // A: cash with change; B: card terminal with a fee; C: cash exact
    ok(await lab.command("cashier","Payment.RecordCash",{billId:a!,expectedVersion:A.version,amountMinor:String(BigInt(A.totalMinor)+7000n),currency:"VND",shiftId:"shift-1"}));
    const card = ok(await lab.command("cashier","Payment.RecordTerminal",{billId:b!,amountMinor:B.totalMinor,currency:"VND",status:"captured",feeMinor:"900",reference:{provider:"acme",merchantId:"m-1",transactionId:"t-1"}}));
    const cashC = ok(await lab.command("cashier","Payment.RecordCash",{billId:c!,expectedVersion:C.version,amountMinor:C.totalMinor,currency:"VND",shiftId:"shift-1"}));
    for (const id of [a!, b!, c!]) ok(await lab.command("cashier","Bill.Close",{billId:id,expectedVersion:(await child(id)).version}));
    // partial refunds after close: card (needs evidence) and cash (leaves the drawer); the reason is attacker-controlled text
    ok(await lab.command("manager","Refund.Record",{paymentId:String(card.value.paymentId),amountMinor:"5000",reason:"=HYPERLINK(\"http://evil\")",evidenceRef:"rf-1",expectedVersion:1}));
    ok(await lab.command("manager","Refund.Record",{paymentId:String(cashC.value.paymentId),amountMinor:"3000",reason:"cold, soup\n\"again\"",expectedVersion:1}));
    // a voided bill on another table never counts
    const voided = await bill(lab, "session-2", "table-2", [{itemId:"rice",quantity:"1"}]);
    ok(await lab.command("manager","Bill.Void",{billId:voided.billId,reason:"wrong table",expectedVersion:1}));

    const r = await lab.report("sales","2026-10-30");
    const t = r.totals as Record<string, string>;
    // split parent and children are not double counted: the three closed children sum to the parent snapshot exactly
    expect(r.bills).toMatchObject({closed:3,voided:1});
    expect(t.salesTotalMinor).toBe(parent.totalMinor);
    for (const k of ["subtotalMinor","discountMinor","serviceMinor","taxMinor"]) expect(t[k === "subtotalMinor" ? "grossMinor" : k]).toBe(parent.summary[k]);
    expect(t.returnsMinor).toBe("8000");
    expect(t.netMinor).toBe(netSales(t.grossMinor!, t.discountMinor!, "8000"));
    // units come from orders, not equal-split child lines (each child carries the full quantity + a portion)
    expect(r.units).toEqual([{itemId:"rice",name:"Cơm",quantity:"2"},{itemId:"tea",name:"Trà",quantity:"2"}]);
    const pay = Object.fromEntries((r.payments as JsonObject[]).map(p => [p.method, p]));
    expect(pay.cash).toMatchObject({count:2,appliedMinor:sum([A.totalMinor,C.totalMinor]),tenderedMinor:sum([A.totalMinor,C.totalMinor,"7000"]),changeMinor:"7000"});
    expect(pay["card-terminal"]).toMatchObject({count:1,appliedMinor:B.totalMinor,feeMinor:"900"});
    expect(Object.fromEntries((r.refunds as JsonObject[]).map(x => [x.method, x.amountMinor]))).toEqual({"card-terminal":"5000",cash:"3000"});
    // ledger collected (applied payments minus applied refunds) equals sales total minus returns
    expect(r.reconciliation).toMatchObject({expectedMinor:String(BigInt(parent.totalMinor)-8000n),collectedMinor:String(BigInt(parent.totalMinor)-8000n),differenceMinor:"0"});
    // nothing in the ledger was touched to make the report agree
    expect((await child(a!)).status).toBe("closed");

    // CSV: every effective/applied row, formula-looking text neutralised, quotes and newlines quoted
    const csv = reportCsv(r);
    expect(csv.split("\r\n")[0]).toBe("kind,id,businessDate,effectiveAt,appliedAt,method,status,amountMinor,reference,reason");
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"cold, soup\n""again"""`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);

    // shift report reuses the cash ledger: opening + tendered - change - cash refunds
    const expected = String(100000n + BigInt(A.totalMinor) + BigInt(C.totalMinor) - 3000n);
    const shift = await lab.state<JsonObject>("shift","shift-1");
    ok(await lab.command("cashier","Shift.Close",{shiftId:"shift-1",countedMinor:expected,expectedVersion:shift.version}));
    ok(await lab.command("manager","Cash.RecordMovement",{shiftId:"shift-1",direction:"out",amountMinor:"1000",reason:"late bank fee",adjustment:true}));
    const s = await lab.report("shifts","2026-10-30");
    expect(s.shifts).toMatchObject([{id:"shift-1",status:"closed",expectedMinor:expected,countedMinor:expected,varianceMinor:"0",reconciled:true,adjustmentMinor:"-1000",refundsMinor:"3000",changeMinor:"7000"}]);
    expect((s.shifts as JsonObject[])[0]!.adjustments).toMatchObject([{direction:"out",amountMinor:"1000",reason:"late bank fee"}]);
  } finally { await lab.close(); }
});

test("merged bills count once and units are not doubled", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("catalog","current",{ ...fixture.menu, pricing } as JsonObject);
    const one = await bill(lab, "s1", "table-1", [{itemId:"rice",quantity:"1"}]), two = await bill(lab, "s2", "table-2", [{itemId:"tea",quantity:"2"}]);
    const merged = ok(await lab.command("cashier","Bill.Merge",{bills:[{billId:one.billId,expectedVersion:1},{billId:two.billId,expectedVersion:1}]}));
    const target = await lab.state<Bill>("bill", String(merged.value.billId));
    ok(await lab.command("cashier","Shift.Open",{shiftId:"sh",currency:"VND"}));
    ok(await lab.command("cashier","Payment.RecordCash",{billId:String(merged.value.billId),expectedVersion:target.version,amountMinor:target.totalMinor,currency:"VND",shiftId:"sh"}));
    ok(await lab.command("cashier","Bill.Close",{billId:String(merged.value.billId),expectedVersion:target.version+1}));
    const r = await lab.report("sales","2026-10-30");
    expect(r.bills).toMatchObject({closed:1});
    expect((r.totals as JsonObject).salesTotalMinor).toBe(target.totalMinor);
    expect(r.units).toEqual([{itemId:"rice",name:"Cơm",quantity:"1"},{itemId:"tea",name:"Trà",quantity:"2"}]);
    expect(r.reconciliation).toMatchObject({differenceMinor:"0"});
  } finally { await lab.close(); }
});

test("business date follows the venue timezone: 18:30 UTC on Oct 30 is Oct 31 in Vietnam", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("venue-layout","current",{timezone:"Asia/Ho_Chi_Minh",stations:[],tables:[]});
    lab.clock.nowMs = Date.parse("2026-10-30T18:30:00Z");
    const { billId } = await bill(lab, "s1", "table-1", [{itemId:"tea",quantity:"1"}], false);
    ok(await lab.command("cashier","Shift.Open",{shiftId:"night",currency:"VND"}));
    ok(await lab.command("cashier","Payment.RecordCash",{billId,expectedVersion:1,amountMinor:"20000",currency:"VND",shiftId:"night"}));
    ok(await lab.command("cashier","Bill.Close",{billId,expectedVersion:2}));
    const vn = await lab.report("sales","2026-10-31"), utcDay = await lab.report("sales","2026-10-30");
    expect(vn).toMatchObject({timeZone:"Asia/Ho_Chi_Minh",totals:{salesTotalMinor:"20000"}});
    expect((utcDay.totals as JsonObject).salesTotalMinor).toBe("0");
    expect(((await lab.report("shifts","2026-10-31")).shifts as JsonObject[]).map(x => x.id)).toEqual(["night"]);
    expect((await lab.report("shifts","2026-10-30")).shifts).toEqual([]);
  } finally { await lab.close(); }
});

test("robot KPI derives missions and command outcomes per business date and keeps the simulated label", async () => {
  const lab = await createRestaurantLab();
  try {
    const simulator = await createSimulator(lab);
    const created = ok(await lab.command("cashier","Mission.Create",{stops:[{action:"standby",targetId:"table-1"}]}));
    const missionId = String(created.value.missionId);
    await completeSimulatedTravel(lab, simulator, missionId);
    const m = await lab.state<JsonObject>("mission", missionId);
    ok(await lab.command("cashier","Mission.ConfirmStop",{missionId,expectedVersion:m.version,missionRevision:m.revision,stopId:m.currentStopId}));
    const k = await lab.report("robot-kpi","2026-10-30");
    expect(k.totals).toMatchObject({missions:1,missionsCompleted:1,commands:1,commandsCompleted:1,commandsFailed:0,commandsUnknown:0});
    expect(k.robots).toMatchObject([{robotId:"sim-1",validation:"simulated",missions:1,missionsCompleted:1}]);
    expect((await lab.report("robot-kpi","2026-10-29")).totals).toMatchObject({missions:0,commands:0});
  } finally { await lab.close(); }
});

test("a projection that never synced shows no numbers instead of zeros, and CSV cells are escaped", () => {
  const r = buildReport("sales", [] as Snapshot[], { businessDate: "2026-10-30", timeZone: "UTC", watermark: { source: "cloud-projection", asOf: "2026-10-30T01:00:00.000Z", appliedAt: null, pending: 0 } });
  expect(r).toMatchObject({ status: "unsynced", totals: null, netMinor: null });
  expect(buildReport("sales", [], { businessDate: "2026-10-30", timeZone: "UTC", watermark: { source: "cloud-projection", asOf: "x", appliedAt: "2026-10-30T00:00:00.000Z", pending: 2 } }).status).toBe("stale");
  expect(buildReport("sales", [], { businessDate: "2026-10-30", timeZone: "UTC", watermark: { source: "tablet", asOf: "x", appliedAt: "x", pending: 0, mode: "isolated" } }).status).toBe("offline");
  for (const [raw, out] of [["=1+1","\"'=1+1\""],["+cmd","\"'+cmd\""],["-2+cmd","\"'-2+cmd\""],["@SUM(A1)","\"'@SUM(A1)\""],["\tx","\"'\tx\""],["\rx","\"'\rx\""],["plain","plain"],["a,b","\"a,b\""],["50000","50000"],["-5000","-5000"],[null,""]] as const) expect(csvCell(raw)).toBe(out);
  expect(() => buildReport("sales", [], { businessDate: "2026-13-40", timeZone: "UTC", watermark: { source: "tablet", asOf: "x", appliedAt: "x", pending: 0 } })).toThrow("INVALID_BUSINESS_DATE");
});

test("wave acceptance: staff cannot change policy for themselves, and nobody changes it on a device cut off from the coordinator", async () => {
  const lab = await createRestaurantLab();
  try {
    const before = await lab.state<JsonObject>("configuration","applied");
    const features = Object.fromEntries(Object.keys(before.features as JsonObject).map(k => [k, { status: "enabled", revision: Number(before.revision) + 1 }]));
    expect((await lab.command("cashier","Configuration.Apply",{revision:Number(before.revision)+1,features})).code).toBe("FORBIDDEN");
    await lab.partition("lan");
    const offline = await lab.command("manager","Configuration.Apply",{revision:Number(before.revision)+1,features});
    expect(offline.status).not.toBe("accepted");
    await lab.heal();
    expect(await lab.state<JsonObject>("configuration","applied")).toMatchObject({revision:before.revision,features:before.features});
  } finally { await lab.close(); }
});
