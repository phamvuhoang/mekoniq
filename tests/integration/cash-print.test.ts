import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import type { Lab } from "../support/lab";
import fixture from "../fixtures/restaurant-v1.json";
import type { JsonObject } from "../../packages/contracts/src/index";
import { spoolEffectSnapshots } from "../../integrations/printing/src/spool";

test("printer timeout cannot undo the recorded sale", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("bill","bill-1",{status:"closed",paidMinor:"50000"});
    await lab.fault("printer-timeout");
    await lab.command("cashier","Print.Request",{billId:"bill-1"});
    expect((await lab.state<{status:string}>("bill","bill-1")).status).toBe("closed");
    expect(await lab.effectCount("printer.send")).toBe(1);
  } finally { await lab.close(); }
});

type Job = { status: string; attempts: { effectId: string; number: number; reprint: boolean; reprintNumber: number; status: string; reason: string | null; by: string; code?: string }[]; version: number };
const ok = (r: { status: string; code?: string }) => expect(r.code ?? r.status).toBe("accepted");
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
async function closedBill(lab: Lab, extra: JsonObject = {}) {
  await lab.seed("bill","bill-1",{status:"closed",totalMinor:"50000",paidMinor:"50000",refundedMinor:"0",currency:"VND",lines:[{id:"l1",name:"Cơm",quantity:"1",totalMinor:"50000"}],summary:{subtotalMinor:"50000",discountMinor:"0",serviceMinor:"0",taxMinor:"0",taxIncludedMinor:"0",totalMinor:"50000"},...extra});
}
const printerLab = async () => { const lab = await createRestaurantLab(); await closedBill(lab); return lab; };

test("an unknown print is never retried; the user's reprint is a new marked attempt with audit and the sale is untouched", async () => {
  const lab = await printerLab();
  try {
    await lab.fault("printer-timeout");
    const r = await lab.command("cashier","Print.Request",{billId:"bill-1"});
    ok(r); const jobId = String(r.value.jobId);
    expect((await lab.state<Job>("print-job",jobId)).status).toBe("unknown");
    expect((await lab.state<Job>("print-job",jobId)).attempts[0]).toMatchObject({ status: "unknown", code: "PRINTER_TIMEOUT", reprint: false });
    // the spool never resends an unknown attempt, however often it runs
    await lab.runSpool(); await lab.runSpool();
    expect(await lab.effectCount("printer.send")).toBe(1);
    expect(lab.printed).toHaveLength(0);
    // a second "original" is refused: the only way to a new copy is a confirmed reprint
    expect((await lab.command("cashier","Print.Request",{billId:"bill-1"})).code).toBe("ALREADY_PRINTED");
    const job = await lab.state<Job>("print-job",jobId);
    expect((await lab.command("cashier","Print.ConfirmReprint",{jobId,reason:"  "})).code).toBe("REASON_REQUIRED");
    expect((await lab.command("guest","Print.ConfirmReprint",{jobId,reason:"x"})).code).toBe("FORBIDDEN");
    // unknown goes to reconciliation first: nobody can reprint an unresolved unknown attempt
    expect((await lab.command("cashier","Print.ConfirmReprint",{jobId,reason:"paper jammed, nothing came out"})).code).toBe("UNKNOWN_UNRESOLVED");
    const effectId = (await lab.state<Job>("print-job",jobId)).attempts[0]!.effectId;
    ok(await lab.command("manager","Print.Resolve",{jobId,effectId,outcome:"not_printed",reason:"checked the printer: no paper came out"}));
    const again = await lab.command("cashier","Print.ConfirmReprint",{jobId,reason:"paper jammed, nothing came out"});
    ok(again);
    const after = await lab.state<Job>("print-job",jobId);
    expect(after.version).toBeGreaterThan(job.version);
    expect(after.attempts.map(a => [a.number,a.reprint,a.status])).toEqual([[1,false,"unknown"],[2,true,"confirmed"]]);
    expect(after.attempts[0]).toMatchObject({ resolution: { outcome: "not_printed", by: "manager", reason: "checked the printer: no paper came out" } });
    expect(after.attempts[1]).toMatchObject({ reprintNumber: 1, reason: "paper jammed, nothing came out", by: "cashier" });
    expect(after.status).toBe("confirmed");
    expect(await lab.effectCount("printer.send")).toBe(2);
    expect(lab.printed).toHaveLength(1);
    expect(text(lab.printed[0]!.bytes)).toContain("REPRINT #1");
    expect((await lab.state<{status:string;paidMinor:string}>("bill","bill-1"))).toMatchObject({ status: "closed", paidMinor: "50000" });
  } finally { await lab.close(); }
});

test("a crash between completeEffect and Print.Observe is repaired by the next spool run without sending again", async () => {
  const lab = await printerLab();
  try {
    await lab.fault("print-observe-crash");
    await expect(lab.command("cashier","Print.Request",{billId:"bill-1"})).rejects.toThrow("INJECTED_CRASH_BEFORE_OBSERVE");
    const store = await lab.getStore("coordinator");
    const [effect] = await store.effects(lab.scope,"printer.send");
    expect(effect).toMatchObject({ status: "confirmed", attempts: 1 }); // sent and final in the outbox...
    const jobId = String((effect!.payload as JsonObject).jobId);
    expect((await lab.state<Job>("print-job",jobId)).status).toBe("pending"); // ...but the job never heard about it
    expect((await lab.command("cashier","Print.ConfirmReprint",{jobId,reason:"x"})).code).toBe("ATTEMPT_IN_FLIGHT");
    const sent = lab.printed.length;
    await lab.runSpool();
    expect(await lab.state<Job>("print-job",jobId)).toMatchObject({ status: "confirmed", attempts: [{ status: "confirmed", code: "OBSERVATION_RECOVERED" }] });
    expect(await lab.effectCount("printer.send")).toBe(1);
    expect(lab.printed).toHaveLength(sent);
    await lab.runSpool(); // idempotent
    expect(await lab.effectCount("printer.send")).toBe(1);
    // an unknown outcome is repaired the same way and stays unknown (not turned into success)
    await lab.seed("bill","bill-9",{status:"closed",totalMinor:"1",paidMinor:"1",currency:"VND"});
    await lab.fault("printer-timeout"); await lab.fault("print-observe-crash");
    await expect(lab.command("cashier","Print.Request",{billId:"bill-9"})).rejects.toThrow("INJECTED_CRASH_BEFORE_OBSERVE");
    await lab.runSpool();
    const job9 = (await (await lab.getStore("coordinator")).snapshots(lab.scope)).filter(j => j.ref.kind === "print-job").find(j => j.state.billId === "bill-9")!;
    expect(job9.state).toMatchObject({ status: "unknown" });
    expect(await lab.effectCount("printer.send")).toBe(2);
  } finally { await lab.close(); }
});

test("Print.Observe cannot be forged: it needs the spool's own outbox record and must match it", async () => {
  const lab = await printerLab();
  try {
    lab.autoSpool.on = false;
    const r = await lab.command("cashier","Print.Request",{billId:"bill-1"});
    const jobId = String(r.value.jobId), effectId = jobId;
    // through the API (no spool record): rejected for the spooler and even for the owner
    for (const actor of ["printer-spool","owner"]) for (const status of ["failed","confirmed","unknown"])
      expect((await lab.command(actor,"Print.Observe",{jobId,effectId,status})).code).toBe("EFFECT_STATE_UNAVAILABLE");
    expect((await lab.command("cashier","Print.Observe",{jobId,effectId,status:"failed"})).code).toBe("FORBIDDEN");
    // even with a spool record, the status must be the one the outbox holds (the effect is still pending)
    const store = await lab.getStore("coordinator");
    lab.trustedSnapshots = spoolEffectSnapshots(lab.scope, await store.effects(lab.scope,"printer.send"));
    expect((await lab.command("printer-spool","Print.Observe",{jobId,effectId,status:"failed"})).code).toBe("EFFECT_STATUS_MISMATCH");
    lab.trustedSnapshots = [];
    expect((await lab.state<Job>("print-job",jobId)).status).toBe("pending");
    expect((await lab.command("cashier","Print.Request",{billId:"bill-1"})).code).toBe("ALREADY_PRINTED"); // no unmarked duplicate original
  } finally { await lab.close(); }
});

test("Print.Resolve: a manager reconciles an unknown attempt with a reason; it sends nothing and printed closes it, not_printed only unlocks a marked reprint", async () => {
  const lab = await printerLab();
  try {
    await lab.fault("printer-timeout");
    const r = await lab.command("cashier","Print.Request",{billId:"bill-1"});
    const jobId = String(r.value.jobId), effectId = jobId;
    const sent = await lab.effectCount("printer.send");
    expect((await lab.command("cashier","Print.Resolve",{jobId,effectId,outcome:"printed",reason:"saw it"})).code).toBe("FORBIDDEN");
    expect((await lab.command("manager","Print.Resolve",{jobId,effectId,outcome:"printed",reason:"  "})).code).toBe("REASON_REQUIRED");
    expect((await lab.command("manager","Print.Resolve",{jobId,effectId,outcome:"maybe",reason:"x"})).code).toBe("INVALID_OUTCOME");
    expect((await lab.command("manager","Print.Resolve",{jobId,effectId:"nope",outcome:"printed",reason:"x"})).code).toBe("NOT_FOUND");
    ok(await lab.command("manager","Print.Resolve",{jobId,effectId,outcome:"printed",reason:"receipt is in the customer's hand"}));
    expect(await lab.state<Job>("print-job",jobId)).toMatchObject({ status: "confirmed", attempts: [{ status: "confirmed", source: "staff", resolution: { outcome: "printed", by: "manager", reason: "receipt is in the customer's hand" } }] });
    expect((await lab.command("manager","Print.Resolve",{jobId,effectId,outcome:"not_printed",reason:"again"})).code).toBe("ATTEMPT_NOT_UNKNOWN");
    expect(await lab.effectCount("printer.send")).toBe(sent);
    expect(lab.printed).toHaveLength(0);
    // not_printed: still no unmarked original (a stalled printer may print it later); only a marked reprint is possible
    await lab.seed("bill","bill-2",{status:"closed",totalMinor:"1",paidMinor:"1",currency:"VND"});
    await lab.fault("printer-timeout");
    const j2 = await lab.command("cashier","Print.Request",{billId:"bill-2"});
    ok(await lab.command("owner","Print.Resolve",{jobId:String(j2.value.jobId),effectId:String(j2.value.jobId),outcome:"not_printed",reason:"printer was out of paper"}));
    expect((await lab.state<Job>("print-job",String(j2.value.jobId))).status).toBe("not_printed");
    expect((await lab.command("cashier","Print.Request",{billId:"bill-2"})).code).toBe("ALREADY_PRINTED");
    expect((await lab.command("manager","Print.Resolve",{jobId:String(j2.value.jobId),effectId:String(j2.value.jobId),outcome:"printed",reason:"again"})).code).toBe("ALREADY_RESOLVED");
    ok(await lab.command("cashier","Print.ConfirmReprint",{jobId:String(j2.value.jobId),reason:"paper reloaded"}));
    expect(text(lab.printed.at(-1)!.bytes)).toContain("REPRINT #1");
  } finally { await lab.close(); }
});

test("a lost printer ack is unknown, not confirmed, and not resent; unreachable (nothing sent) is failed and may be requested again", async () => {
  const lab = await printerLab();
  try {
    await lab.fault("printer-ack-lost");
    const lost = await lab.command("cashier","Print.Request",{billId:"bill-1"});
    ok(lost);
    expect(lab.printed).toHaveLength(1); // bytes did leave the device, but nobody confirmed the paper
    expect((await lab.state<Job>("print-job",String(lost.value.jobId))).attempts[0]).toMatchObject({ status: "unknown", code: "NO_PRINTER_ACK" });
    await lab.runSpool();
    expect(lab.printed).toHaveLength(1);
    // a different bill: the printer is unreachable, nothing is sent, the job is failed and a fresh request is allowed (it is still the original)
    await closedBill(lab,{}); await lab.seed("bill","bill-2",{status:"closed",totalMinor:"1000",paidMinor:"1000",currency:"VND"});
    await lab.fault("printer-unreachable");
    const down = await lab.command("cashier","Print.Request",{billId:"bill-2"});
    ok(down);
    expect((await lab.state<Job>("print-job",String(down.value.jobId))).attempts[0]).toMatchObject({ status: "failed", code: "NOT_SENT" });
    const retry = await lab.command("cashier","Print.Request",{billId:"bill-2"});
    ok(retry);
    expect((await lab.state<Job>("print-job",String(retry.value.jobId))).status).toBe("confirmed");
    expect(text(lab.printed.at(-1)!.bytes)).not.toContain("REPRINT");
  } finally { await lab.close(); }
});

test("a crash while sending leaves the attempt unknown, never resent", async () => {
  const lab = await printerLab();
  try {
    lab.autoSpool.on = false;
    const r = await lab.command("cashier","Print.Request",{billId:"bill-1"});
    const store = await lab.getStore("coordinator");
    const [effect] = await store.effects(lab.scope,"printer.send");
    expect(effect).toMatchObject({ status: "pending", attempts: 0 });
    expect(await store.claimEffect(lab.scope,String(effect!.id))).toBe(true); // claimed (sent), then the process died before recording the outcome
    await lab.runSpool();
    expect((await store.effects(lab.scope,"printer.send"))[0]).toMatchObject({ status: "unknown", attempts: 1 });
    expect(lab.printed).toHaveLength(0);
    expect((await lab.state<Job>("print-job",String(r.value.jobId))).attempts[0]).toMatchObject({ status: "unknown", code: "INTERRUPTED_IN_FLIGHT" });
    expect(await lab.effectCount("printer.send")).toBe(1);
  } finally { await lab.close(); }
});

test("printer readiness comes from the installed profile: bluetooth and unverified usb are unsupported, and printing never blocks the kitchen", async () => {
  const lab = await printerLab();
  try {
    const printer = fixture.printer as JsonObject;
    for (const [patch, label] of [[{ transport: "bluetooth", validation: "venue_approved" }, "bluetooth"], [{ transport: "usb" }, "unverified usb"], [{ status: "removed" }, "not installed"], [{ model: "" }, "no model"], [{ validation: "claimed" }, "unvalidated"]] as [JsonObject, string][]) {
      await lab.seed("printer",String(printer.id),{ ...printer, ...patch, version: 2 });
      const r = await lab.command("cashier","Print.Request",{billId:"bill-1"});
      expect([label, r.code]).toEqual([label, "NOT_READY"]);
    }
    expect(await lab.effectCount("printer.send")).toBe(0);
    // KDS / sales do not depend on the printer
    await lab.seed("order-line","line-1",{ordered:"1"});
    ok(await lab.command("chef","Kitchen.Accept",{lineId:"line-1",stationId:"kitchen",expectedVersion:1}));
    // a physically verified usb printer is ready; a disabled feature is refused even then
    await lab.seed("printer",String(printer.id),{ ...printer, transport: "usb", validation: "venue_approved", version: 3 });
    ok(await lab.command("cashier","Print.Request",{billId:"bill-1"}));
    const features = { ...fixture.configuration.features, printing: { status: "disabled", revision: 1 } };
    await lab.seed("configuration","applied",{ ...fixture.configuration, features, version: 2 } as JsonObject);
    await lab.seed("bill","bill-3",{status:"closed",totalMinor:"1",paidMinor:"1"});
    expect((await lab.command("cashier","Print.Request",{billId:"bill-3"})).code).toBe("FEATURE_DISABLED");
  } finally { await lab.close(); }
});

test("the receipt carries lines, charges, payments, change and refunds from the bill ledger, and a prepared bill prints as provisional", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("bill","bill-7",{status:"closed",totalMinor:"142380",paidMinor:"142380",refundedMinor:"0",currency:"VND",
      lines:[{id:"a",name:"Cơm",quantity:"3",cancelledQuantity:"1",totalMinor:"135000",cancelled:{totalMinor:"67500"},modifiers:[{name:"Thêm trứng"}]}],
      summary:{subtotalMinor:"130000",discountMinor:"13000",serviceMinor:"5850",taxMinor:"9530",taxIncludedMinor:"0",totalMinor:"142380"}});
    await lab.seed("payment","pay-7",{billId:"bill-7",capturedMinor:"142380",appliedMinor:"142380",tenderedMinor:"150000",changeMinor:"7620"});
    ok(await lab.command("cashier","Print.Request",{billId:"bill-7"}));
    const job = await lab.state<{ receipt: JsonObject }>("print-job",(await lab.runSpool(), lab.printed[0]!.jobId));
    expect(job.receipt).toMatchObject({ kind: "receipt", totalMinor: "142380", dueMinor: "0", lines: [{ name: "Cơm", quantity: "2", totalMinor: "67500", modifiers: ["Thêm trứng"] }],
      charges: { discountMinor: "13000", serviceMinor: "5850", taxMinor: "9530" }, payments: [{ method: "cash", tenderedMinor: "150000", changeMinor: "7620" }] });
    const bytes = text(lab.printed[0]!.bytes);
    expect(bytes).toContain("HOA DON"); expect(bytes).toContain("2 x Com"); expect(bytes).toContain("142.380d"); expect(bytes).toContain("Tien thoi");
    await lab.seed("bill","bill-8",{status:"prepared",totalMinor:"1000",paidMinor:"0",currency:"VND"});
    ok(await lab.command("cashier","Print.Request",{billId:"bill-8"}));
    expect(text(lab.printed.at(-1)!.bytes)).toContain("TAM TINH");
  } finally { await lab.close(); }
});

test("historical import enqueues no print effect", async () => {
  const lab = await printerLab();
  try {
    const receipt = { sourceType: "paper", sourceSeries: "M1", sourceNumber: "001", totalMinor: "50000", paidCashMinor: "50000", fulfilled: true, occurredAt: "2026-10-29T13:00:00Z" } as JsonObject;
    expect((await lab.importApproved([receipt])).status).toBe("accepted");
    expect(await lab.effectCount("printer.send")).toBe(0);
    expect((await (await lab.getStore("coordinator")).pending(lab.scope)).every(e => e.type === "sync.journal")).toBe(true);
  } finally { await lab.close(); }
});

// ---------------------------------------------------------------- shifts and cashbook
type Shift = { status: string; version: number; cashierId: string; countedMinor?: string; expectedMinor?: string; varianceMinor?: string; varianceReason?: string | null; approvedBy?: string | null; closedBy?: string; counterDriftMinor?: string; ledger?: Record<string,string> };
async function drawer(lab: Lab) {
  ok(await lab.command("cashier","Shift.Open",{shiftId:"s1",currency:"VND",openingMinor:"100000"}));
  await lab.seed("bill","b1",{totalMinor:"50000",paidMinor:"0",refundedMinor:"0",currency:"VND",status:"prepared",version:1});
  const paid = await lab.command("cashier","Payment.RecordCash",{billId:"b1",expectedVersion:1,amountMinor:"60000",currency:"VND"});
  ok(paid);
  ok(await lab.command("cashier","Cash.RecordMovement",{shiftId:"s1",direction:"in",amountMinor:"20000",reason:"float top-up"}));
  ok(await lab.command("cashier","Cash.RecordMovement",{shiftId:"s1",direction:"out",amountMinor:"5000",reason:"ice delivery"}));
  const pay = await lab.state<{ version: number }>("payment",String(paid.value.paymentId));
  ok(await lab.command("manager","Refund.Record",{paymentId:String(paid.value.paymentId),amountMinor:"10000",reason:"guest complaint",expectedVersion:pay.version}));
  // opening 100000 + receipts 60000 (tendered) + in 20000 - out 5000 - refunds 10000 - change 10000
  return "155000";
}

test("expected cash is recomputed from ledger facts and a close records counted cash, variance and the approver", async () => {
  const lab = await createRestaurantLab();
  try {
    const expected = await drawer(lab);
    const shift = await lab.state<Shift>("shift","s1");
    expect(shift).toMatchObject({ cashMinor: "50000", cashInMinor: "20000", cashOutMinor: "5000", cashRefundedMinor: "10000" });
    // a cashier cannot close with a mismatch, and cannot approve herself (approve needs shift.approve)
    expect((await lab.command("cashier","Shift.Close",{shiftId:"s1",countedMinor:"154000",expectedVersion:shift.version})).code).toBe("VARIANCE_APPROVAL_REQUIRED");
    expect((await lab.command("cashier","Shift.Close",{shiftId:"s1",countedMinor:"154000",approve:true,reason:"ok",expectedVersion:shift.version})).code).toBe("FORBIDDEN");
    expect((await lab.command("cashier","Shift.Close",{shiftId:"s1",countedMinor:"154000",expectedVersion:shift.version - 1})).code).toBe("VERSION_CONFLICT");
    // the manager recounts, must give a reason, and is recorded as approver
    expect((await lab.command("manager","Shift.Close",{shiftId:"s1",countedMinor:"154000",approve:true,expectedVersion:shift.version})).code).toBe("REASON_REQUIRED");
    const closed = await lab.command("manager","Shift.Close",{shiftId:"s1",countedMinor:"154000",approve:true,reason:"1,000 short, coins miscounted",expectedVersion:shift.version});
    ok(closed);
    expect(closed.value).toMatchObject({ expectedMinor: expected, countedMinor: "154000", varianceMinor: "-1000" });
    expect(await lab.state<Shift>("shift","s1")).toMatchObject({ status: "closed", expectedMinor: expected, countedMinor: "154000", varianceMinor: "-1000", varianceReason: "1,000 short, coins miscounted", approvedBy: "manager", closedBy: "manager", counterDriftMinor: "0",
      ledger: { openingMinor: "100000", receiptsMinor: "60000", cashInMinor: "20000", cashOutMinor: "5000", refundsMinor: "10000", changeMinor: "10000" } });
    expect(await lab.state<{ status: string }>("cashier-shift","cashier")).toMatchObject({ status: "closed" });
  } finally { await lab.close(); }
});

test("a matching count closes by the cashier alone; a drifting running counter never overrides the ledger", async () => {
  const lab = await createRestaurantLab();
  try {
    const expected = await drawer(lab);
    const shift = await lab.state<Shift>("shift","s1");
    await lab.seed("shift","s1",{ ...shift, cashMinor: "999999", version: shift.version + 1 });
    const closed = await lab.command("cashier","Shift.Close",{shiftId:"s1",countedMinor:expected,expectedVersion:shift.version + 1});
    ok(closed);
    expect(await lab.state<Shift>("shift","s1")).toMatchObject({ varianceMinor: "0", approvedBy: null, varianceReason: null, counterDriftMinor: String(999999 - 50000) });
    ok(await lab.command("cashier","Shift.Open",{shiftId:"s2",currency:"VND"})); // the cashier can start a new shift
  } finally { await lab.close(); }
});

test("a closed shift is immutable; late cash goes to a manager-approved adjustment beside it", async () => {
  const lab = await createRestaurantLab();
  try {
    const expected = await drawer(lab);
    const shift = await lab.state<Shift>("shift","s1");
    ok(await lab.command("cashier","Shift.Close",{shiftId:"s1",countedMinor:expected,expectedVersion:shift.version}));
    const closed = await lab.state<Shift>("shift","s1");
    expect((await lab.command("cashier","Shift.Close",{shiftId:"s1",countedMinor:expected,expectedVersion:closed.version})).code).toBe("SHIFT_CLOSED");
    expect((await lab.command("cashier","Cash.RecordMovement",{shiftId:"s1",direction:"in",amountMinor:"1000",reason:"late"})).code).toBe("SHIFT_CLOSED");
    await lab.seed("bill","b2",{totalMinor:"10000",paidMinor:"0",refundedMinor:"0",currency:"VND",status:"prepared",version:1});
    expect((await lab.command("cashier","Payment.RecordCash",{billId:"b2",expectedVersion:1,amountMinor:"10000",currency:"VND"})).code).toBe("ACTIVE_SHIFT_REQUIRED");
    // the adjustment path: closed shifts only, manager only, with a reason
    expect((await lab.command("cashier","Cash.RecordMovement",{shiftId:"s1",direction:"in",amountMinor:"1000",reason:"late",adjustment:true})).code).toBe("FORBIDDEN");
    expect((await lab.command("manager","Cash.RecordMovement",{shiftId:"s1",direction:"in",amountMinor:"1000",adjustment:true})).code).toBe("REASON_REQUIRED");
    const adj = await lab.command("manager","Cash.RecordMovement",{shiftId:"s1",direction:"in",amountMinor:"2500",reason:"tip jar found after close",adjustment:true});
    ok(adj);
    expect(await lab.state<Shift>("shift","s1")).toEqual(closed);
    expect(await lab.state("cash-movement",String(adj.value.movementId))).toMatchObject({ adjustment: true, afterClose: true, shiftId: "s1", amountMinor: "2500", actorRef: "manager" });
    await lab.seed("shift","s3",{cashierId:"cashier-2",status:"open",currency:"VND",openingMinor:"0",cashMinor:"0",version:1});
    expect((await lab.command("manager","Cash.RecordMovement",{shiftId:"s3",direction:"in",amountMinor:"1",reason:"x",adjustment:true})).code).toBe("ADJUSTMENT_REQUIRES_CLOSED_SHIFT");
  } finally { await lab.close(); }
});

test("multi-cashier: nobody moves or closes another cashier's shift without manager approval; cash-out cannot exceed the drawer; managers cannot approve themselves", async () => {
  const lab = await createRestaurantLab();
  try {
    await drawer(lab);
    ok(await lab.command("cashier-2","Shift.Open",{shiftId:"s2",currency:"VND",openingMinor:"5000"}));
    const s1 = await lab.state<Shift>("shift","s1");
    expect((await lab.command("cashier-2","Cash.RecordMovement",{shiftId:"s1",direction:"out",amountMinor:"1000",reason:"theft"})).code).toBe("SHIFT_NOT_OWNED");
    expect((await lab.command("cashier-2","Shift.Close",{shiftId:"s1",countedMinor:"0",expectedVersion:s1.version})).code).toBe("SHIFT_NOT_OWNED");
    expect((await lab.command("cashier-2","Shift.Close",{shiftId:"s1",countedMinor:"0",approve:true,reason:"x",expectedVersion:s1.version})).code).toBe("FORBIDDEN");
    expect((await lab.command("cashier-2","Cash.RecordMovement",{shiftId:"s2",direction:"out",amountMinor:"5001",reason:"too much"})).code).toBe("INSUFFICIENT_CASH");
    ok(await lab.command("cashier-2","Cash.RecordMovement",{shiftId:"s2",direction:"out",amountMinor:"5000",reason:"supplier"}));
    expect((await lab.command("cashier-2","Cash.RecordMovement",{shiftId:"s2",direction:"in",amountMinor:"0",reason:"x"})).code).toBe("INVALID_AMOUNT");
    // the manager's own shift: variance cannot be self-approved, a second approver (owner) can
    ok(await lab.command("manager","Shift.Open",{shiftId:"sm",currency:"VND",openingMinor:"1000"}));
    const sm = await lab.state<Shift>("shift","sm");
    expect((await lab.command("manager","Shift.Close",{shiftId:"sm",countedMinor:"900",approve:true,reason:"mine",expectedVersion:sm.version})).code).toBe("SELF_APPROVAL_FORBIDDEN");
    const byOwner = await lab.command("owner","Shift.Close",{shiftId:"sm",countedMinor:"900",approve:true,reason:"counted twice",expectedVersion:sm.version});
    ok(byOwner);
    expect(await lab.state<Shift>("shift","sm")).toMatchObject({ varianceMinor: "-100", approvedBy: "owner" });
    // a manager may close another cashier's shift when it balances (explicit approve)
    const s2 = await lab.state<Shift>("shift","s2");
    ok(await lab.command("manager","Shift.Close",{shiftId:"s2",countedMinor:"0",approve:true,expectedVersion:s2.version}));
    expect(await lab.state<Shift>("shift","s2")).toMatchObject({ status: "closed", closedBy: "manager", approvedBy: "manager", varianceMinor: "0" });
  } finally { await lab.close(); }
});
