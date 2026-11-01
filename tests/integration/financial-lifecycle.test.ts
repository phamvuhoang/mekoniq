import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import type { Lab } from "../support/lab";
import fixture from "../fixtures/restaurant-v1.json";
import type { JsonObject } from "../../packages/contracts/src/index";

test("concurrent refunds cannot exceed the captured balance", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("payment","pay-1",{capturedMinor:"100000",refundedMinor:"0",version:1});
    // adaptation: refunds require a reason (auditable refund); the plan snippet carried none
    const rs = await Promise.all([1,2].map(i=>lab.command("manager","Refund.Record",
      {paymentId:"pay-1",amountMinor:"70000",reason:"test",expectedVersion:1}, "refund-"+i)));
    expect(rs.filter(r=>r.status==="accepted")).toHaveLength(1);
  } finally { await lab.close(); }
});

const accepted = (r: { status: string; code?: string }) => { expect(r.code ?? r.status).toBe("accepted"); };
const KEYS = ["subtotalMinor","discountMinor","serviceMinor","taxMinor","taxIncludedMinor","totalMinor"] as const;
type Charge = { kind: string; minor: string; effect: string };
type Line = JsonObject & { id: string; quantity: string; cancelledQuantity?: string; charges: Charge[]; cancelled?: Record<string,string>; portion?: JsonObject } & Record<typeof KEYS[number], string>;
type Bill = { status: string; totalMinor: string; paidMinor: string; refundedMinor: string; unappliedMinor?: string; lines: Line[]; summary: Record<string,string>; orderIds: string[]; childBillIds?: string[]; parentBillId?: string; mergedFrom?: string[]; mergedInto?: string; sessionIds?: string[]; externalPaymentState?: string | null; version: number };
const sum = (values: unknown[]) => values.reduce<bigint>((a, v) => a + BigInt(String(v)), 0n);
const pricing = { taxProfiles: [{ id: "vat8", name: "VAT 8%", rateBps: 800, inclusive: false }], defaultTaxProfileId: "vat8", service: { rateBps: 500, taxable: false }, discountOrder: "before_tax", discounts: [{ id: "ten", name: "10%", kind: "percent", valueBps: 1000 }] };
const menu = { ...fixture.menu, pricing } as JsonObject;
const without = (o: JsonObject, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as JsonObject;
const due = (b: Bill) => BigInt(b.totalMinor) - BigInt(b.paidMinor) + BigInt(b.refundedMinor ?? "0");

/** Real flow: priced order (coupon, service, tax) with one rice cancelled before billing, then Bill.Prepare. */
async function preparedBill(lab: Lab, sessionId = "session-1", tableId = "table-1") {
  await lab.seed("catalog","current",menu);
  accepted(await lab.command("cashier","Session.Open",{sessionId,tableId}));
  const placed = await lab.command("manager","Order.Place",{sessionId,tableId,menuVersion:1,items:[{itemId:"rice",quantity:"3"},{itemId:"tea",quantity:"2"}],discountIds:["ten"]});
  accepted(placed);
  const [rice, tea] = placed.value.lineIds as string[];
  accepted(await lab.command("cashier","Order.Amend",{lineId:rice!,cancelQuantity:"1",reason:"guest",expectedVersion:1}));
  const bill = await lab.command("cashier","Bill.Prepare",{sessionId});
  accepted(bill);
  return { billId: String(bill.value.billId), rice: rice!, tea: tea!, orderId: String(placed.value.orderId) };
}

test("split by line, quantity and equal amounts apportions every charge exactly, nets cancellations and keeps the original", async () => {
  for (const mode of ["lines","quantity","equal"] as const) {
    const lab = await createRestaurantLab();
    try {
      const { billId, rice, tea } = await preparedBill(lab);
      const parent = await lab.state<Bill>("bill",billId);
      // 2 rice (one of three cancelled) + 2 tea, 10% coupon before 5% service and 8% VAT
      expect(parent.totalMinor).toBe("142380");
      // pricing changes after the bill was prepared never reach the bill or its children
      await lab.seed("catalog","current",{ ...menu, items: fixture.menu.items.map(i => ({ ...i, unitMinor: "99000" })), pricing: { ...pricing, taxProfiles: [{ id: "vat8", name: "VAT 10%", rateBps: 1000, inclusive: false }] } });
      const parts = mode === "lines" ? [{lineIds:[rice]},{lineIds:[tea]}] : mode === "quantity" ? [{items:[{lineId:rice,quantity:"1"},{lineId:tea,quantity:"1"}]},{items:[{lineId:rice,quantity:"1"},{lineId:tea,quantity:"1"}]}] : 3;
      expect((await lab.command("cashier","Bill.Split",{billId,mode,parts,expectedVersion:parent.version+1})).code).toBe("VERSION_CONFLICT");
      const r = await lab.command("cashier","Bill.Split",{billId,mode,parts,expectedVersion:parent.version});
      accepted(r);
      const ids = r.value.childBillIds as string[];
      const children = await Promise.all(ids.map(id => lab.state<Bill>("bill",id)));
      expect(children).toHaveLength(mode === "equal" ? 3 : 2);
      for (const child of children) expect(child).toMatchObject({ status: "prepared", parentBillId: billId, paidMinor: "0", orderIds: parent.orderIds });
      expect(sum(children.map(c => c.totalMinor))).toBe(BigInt(parent.totalMinor));
      for (const key of KEYS) expect(sum(children.map(c => c.summary[key]))).toBe(BigInt(parent.summary[key]!));
      for (const line of parent.lines) {
        const parts = children.flatMap(c => c.lines.filter(l => l.id === line.id));
        // each amount of the line, net of cancellations, is apportioned exactly
        for (const key of KEYS) expect(sum(parts.map(l => l[key]))).toBe(BigInt(line[key]) - BigInt(line.cancelled?.[key] ?? "0"));
        if (!line.cancelledQuantity) line.charges.forEach((charge, k) => expect(sum(parts.map(l => l.charges[k]!.minor))).toBe(BigInt(charge.minor)));
        for (const l of parts) expect(BigInt(l.totalMinor)).toBe(BigInt(l.subtotalMinor) - BigInt(l.discountMinor) + BigInt(l.serviceMinor) + BigInt(l.taxMinor));
        const net = BigInt(line.quantity) - BigInt(line.cancelledQuantity ?? "0");
        if (mode === "equal") expect(parts.every(l => BigInt(l.quantity) === net && l.portion)).toBe(true);
        else expect(sum(parts.map(l => l.quantity))).toBe(net);
      }
      if (mode === "equal") { const t = children.map(c => BigInt(c.totalMinor)); expect(t.reduce((a, b) => a > b ? a : b) - t.reduce((a, b) => a < b ? a : b) <= 1n).toBe(true); }
      expect(await lab.state<Bill>("bill",billId)).toMatchObject({ status: "split", childBillIds: ids, totalMinor: parent.totalMinor, lines: parent.lines, summary: parent.summary });
      // a split bill is history: it cannot be paid, split again or closed
      expect((await lab.command("cashier","Bill.Split",{billId,mode:"equal",parts:2,expectedVersion:parent.version+1})).code).toBe("BILL_STATE_CONFLICT");
      expect((await lab.command("cashier","Bill.Close",{billId,expectedVersion:parent.version+1})).code).toBe("BILL_STATE_CONFLICT");
    } finally { await lab.close(); }
  }
});

test("split rejects parts that do not cover the bill exactly, and bills that already took money", async () => {
  const lab = await createRestaurantLab();
  try {
    const { billId, rice, tea } = await preparedBill(lab);
    const split = (payload: JsonObject) => lab.command("cashier","Bill.Split",{billId,expectedVersion:1,...payload});
    expect((await split({mode:"quantity",parts:[{items:[{lineId:rice,quantity:"1"}]},{items:[{lineId:tea,quantity:"2"}]}]})).code).toBe("INVALID_SPLIT");
    expect((await split({mode:"quantity",parts:[{items:[{lineId:rice,quantity:"3"}]},{items:[{lineId:tea,quantity:"2"}]}]})).code).toBe("INVALID_SPLIT");
    expect((await split({mode:"lines",parts:[{lineIds:[rice,tea]}]})).code).toBe("INVALID_SPLIT");
    expect((await split({mode:"lines",parts:[{lineIds:[rice]},{lineIds:["nope"]}]})).code).toBe("INVALID_SPLIT");
    expect((await split({mode:"equal",parts:1})).code).toBe("INVALID_SPLIT");
    expect((await split({mode:"thirds",parts:3})).code).toBe("INVALID_SPLIT");
    accepted(await lab.command("cashier","Shift.Open",{shiftId:"shift-1",currency:"VND"}));
    accepted(await lab.command("cashier","Payment.RecordCash",{billId,expectedVersion:1,amountMinor:"10000",currency:"VND",shiftId:"shift-1"}));
    expect((await lab.command("cashier","Bill.Split",{billId,mode:"equal",parts:2,expectedVersion:2})).code).toBe("BILL_HAS_PAYMENTS");
  } finally { await lab.close(); }
});

test("partial and mixed tenders across split children never double-collect; the table closes with the last child", async () => {
  const lab = await createRestaurantLab();
  try {
    const { billId, orderId } = await preparedBill(lab);
    const parent = await lab.state<Bill>("bill",billId);
    const split = await lab.command("cashier","Bill.Split",{billId,mode:"equal",parts:2,expectedVersion:1});
    accepted(split);
    const [a, b] = split.value.childBillIds as string[];
    accepted(await lab.command("cashier","Shift.Open",{shiftId:"shift-1",currency:"VND"}));
    const childA = await lab.state<Bill>("bill",a!);
    // part cash, the rest on a card terminal with 5000 too much: the excess is kept as unapplied, the fee is separate
    const cash = await lab.command("cashier","Payment.RecordCash",{billId:a!,expectedVersion:1,amountMinor:"20000",currency:"VND",shiftId:"shift-1"});
    accepted(cash);
    expect(cash.value).toMatchObject({appliedMinor:"20000",changeMinor:"0"});
    const rest = due(childA) - 20000n;
    const card = await lab.command("cashier","Payment.RecordTerminal",{billId:a!,amountMinor:String(rest+5000n),currency:"VND",status:"captured",feeMinor:"300",reference:{provider:"acme-terminal",merchantId:"m-1",transactionId:"t-1"}});
    accepted(card);
    expect(card.value).toMatchObject({appliedMinor:String(rest),unappliedMinor:"5000"});
    let billA = await lab.state<Bill>("bill",a!);
    expect(billA).toMatchObject({paidMinor:childA.totalMinor,unappliedMinor:"5000"});
    expect((await lab.command("cashier","Payment.RecordCash",{billId:a!,expectedVersion:billA.version,amountMinor:"1000",currency:"VND",shiftId:"shift-1"})).code).toBe("NO_BALANCE_DUE");
    accepted(await lab.command("cashier","Bill.Close",{billId:a!,expectedVersion:billA.version}));
    // the sibling is still open, so the order and the table stay as they are
    expect(await lab.state("session","session-1")).toMatchObject({status:"open"});
    expect(await lab.state("order",orderId)).toMatchObject({status:"billed"});
    // the overpayment goes back to the card: it consumes the unapplied part first, so the closed bill stays settled
    const terminalPayment = String(card.value.paymentId);
    accepted(await lab.command("manager","Refund.Record",{paymentId:terminalPayment,amountMinor:"5000",reason:"overpaid",evidenceRef:"terminal-refund-1",expectedVersion:1}));
    billA = await lab.state<Bill>("bill",a!);
    expect(billA).toMatchObject({status:"closed",unappliedMinor:"0",refundedMinor:"0"});
    expect(due(billA)).toBe(0n);

    // manual bank transfer: the guest's claim stays unverified until a manager attests with reason + evidence
    const claim = await lab.command("guest","Payment.Claim",{billId:b!,method:"transfer"});
    accepted(claim);
    const claimId = String(claim.value.claimId);
    expect(await lab.state("payment-observation",claimId)).toMatchObject({status:"unverified"});
    const childB = await lab.state<Bill>("bill",b!);
    const verify = {billId:b!,expectedVersion:childB.version,amountMinor:childB.totalMinor,currency:"VND",reason:"seen in bank app",evidenceRef:"statement-0042",reference:{provider:"vcb",merchantId:"acct-1",transactionId:"FT123"},claimId};
    expect((await lab.command("cashier","Payment.VerifyManual",verify)).code).toBe("FORBIDDEN");
    expect((await lab.command("manager","Payment.VerifyManual",without(verify,"evidenceRef"))).code).toBe("EVIDENCE_REQUIRED");
    expect((await lab.command("manager","Payment.VerifyManual",{...verify,reason:""})).code).toBe("REASON_REQUIRED");
    expect((await lab.command("manager","Payment.VerifyManual",{...verify,reason:"   "})).code).toBe("REASON_REQUIRED");
    expect((await lab.command("manager","Payment.VerifyManual",{...verify,evidenceRef:" \t "})).code).toBe("EVIDENCE_REQUIRED");
    const verified = await lab.command("manager","Payment.VerifyManual",verify);
    accepted(verified);
    expect(await lab.state("payment",String(verified.value.paymentId))).toMatchObject({method:"transfer",verification:"manual",verifiedBy:"manager",reason:"seen in bank app",evidenceRef:"statement-0042",status:"captured",capturedMinor:childB.totalMinor,claimId});
    expect(await lab.state("payment-observation",claimId)).toMatchObject({status:"verified",paymentId:String(verified.value.paymentId)});
    // the same bank transaction cannot pay a second bill, however it is typed
    expect((await lab.command("manager","Payment.VerifyManual",{...without(verify,"claimId"),billId:a!,expectedVersion:billA.version})).code).toBe("PAYMENT_REFERENCE_CONFLICT");
    expect((await lab.command("manager","Payment.VerifyManual",{...without(verify,"claimId"),billId:a!,expectedVersion:billA.version,reference:{provider:"VCB ",merchantId:" Acct-1",transactionId:"ft 123"}})).code).toBe("PAYMENT_REFERENCE_CONFLICT");
    accepted(await lab.command("cashier","Bill.Close",{billId:b!,expectedVersion:childB.version+1}));
    expect(await lab.state("session","session-1")).toMatchObject({status:"closed"});
    expect(await lab.state("order",orderId)).toMatchObject({status:"closed"});
    expect(await lab.state("table","table-1")).toMatchObject({activeSessionId:null});
    expect(await lab.state("bill",billId)).toMatchObject({status:"split"});

    // ledger: applied money equals the original bill exactly; change, unapplied and fees are kept apart from gross sales
    const payments = [String(cash.value.paymentId), terminalPayment, String(verified.value.paymentId)];
    const states = await Promise.all(payments.map(id => lab.state<Record<string,string>>("payment",id)));
    expect(sum(states.map(p => p.appliedMinor))).toBe(BigInt(parent.totalMinor));
    expect(states.map(p => p.feeMinor ?? "0")).toEqual(["0","300","0"]);
    expect(states[1]).toMatchObject({capturedMinor:String(rest+5000n),refundedMinor:"5000",unappliedMinor:"0"});
  } finally { await lab.close(); }
});

test("merging prepared unpaid bills keeps every ref and the money; paid or mixed-currency bills are refused", async () => {
  const lab = await createRestaurantLab();
  try {
    const first = await preparedBill(lab);
    const parent = await lab.state<Bill>("bill",first.billId);
    const split = await lab.command("cashier","Bill.Split",{billId:first.billId,mode:"equal",parts:2,expectedVersion:1});
    accepted(split);
    const children = split.value.childBillIds as string[];
    expect((await lab.command("cashier","Bill.Merge",{bills:[{billId:children[0]!,expectedVersion:1}]})).code).toBe("INVALID_MERGE");
    const merged = await lab.command("cashier","Bill.Merge",{bills:children.map(billId => ({billId,expectedVersion:1}))});
    accepted(merged);
    const back = await lab.state<Bill>("bill",String(merged.value.billId));
    expect(back).toMatchObject({status:"prepared",totalMinor:parent.totalMinor,orderIds:parent.orderIds,mergedFrom:children});
    for (const key of KEYS) expect(back.summary[key]).toBe(parent.summary[key]);
    expect(back.lines).toHaveLength(parent.lines.length * 2);
    for (const id of children) expect(await lab.state("bill",id)).toMatchObject({status:"merged",mergedInto:String(merged.value.billId)});

    const second = await preparedBill(lab, "session-2", "table-2");
    const other = await lab.state<Bill>("bill",second.billId);
    const both = await lab.command("cashier","Bill.Merge",{bills:[{billId:String(merged.value.billId),expectedVersion:1},{billId:second.billId,expectedVersion:1}]});
    accepted(both);
    const combined = await lab.state<Bill>("bill",String(both.value.billId));
    expect(combined.totalMinor).toBe(String(BigInt(parent.totalMinor) + BigInt(other.totalMinor)));
    expect(combined.sessionIds).toEqual(["session-1","session-2"]);
    expect(combined.orderIds).toEqual([...parent.orderIds, ...other.orderIds]);
    accepted(await lab.command("cashier","Shift.Open",{shiftId:"shift-1",currency:"VND"}));
    accepted(await lab.command("cashier","Payment.RecordCash",{billId:String(both.value.billId),expectedVersion:1,amountMinor:"500000",currency:"VND",shiftId:"shift-1"}));
    accepted(await lab.command("cashier","Bill.Close",{billId:String(both.value.billId),expectedVersion:2}));
    for (const [session, table] of [["session-1","table-1"],["session-2","table-2"]]) {
      expect(await lab.state("session",session!)).toMatchObject({status:"closed"});
      expect(await lab.state("table",table!)).toMatchObject({activeSessionId:null});
    }
    expect((await lab.command("cashier","Bill.Merge",{bills:[{billId:String(both.value.billId),expectedVersion:3},{billId:second.billId,expectedVersion:2}]})).code).toBe("BILL_CLOSED");

    await lab.seed("bill","vnd",{status:"prepared",totalMinor:"10000",paidMinor:"0",refundedMinor:"0",currency:"VND",orderIds:[],lines:[],version:1});
    await lab.seed("bill","usd",{status:"prepared",totalMinor:"10000",paidMinor:"0",refundedMinor:"0",currency:"USD",orderIds:[],lines:[],version:1});
    await lab.seed("bill","paid",{status:"prepared",totalMinor:"10000",paidMinor:"5000",refundedMinor:"0",currency:"VND",orderIds:[],lines:[],version:1});
    expect((await lab.command("cashier","Bill.Merge",{bills:[{billId:"vnd",expectedVersion:1},{billId:"usd",expectedVersion:1}]})).code).toBe("CURRENCY_MISMATCH");
    expect((await lab.command("cashier","Bill.Merge",{bills:[{billId:"vnd",expectedVersion:1},{billId:"paid",expectedVersion:1}]})).code).toBe("BILL_HAS_PAYMENTS");
  } finally { await lab.close(); }
});

test("a card charge in unknown state blocks re-collection; duplicate observations never capture twice", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("bill","bill-1",{status:"prepared",totalMinor:"100000",paidMinor:"0",refundedMinor:"0",currency:"VND",orderIds:[],lines:[],version:1});
    await lab.seed("bill","bill-2",{status:"prepared",totalMinor:"100000",paidMinor:"0",refundedMinor:"0",currency:"VND",orderIds:[],lines:[],version:1});
    accepted(await lab.command("cashier","Shift.Open",{shiftId:"shift-1",currency:"VND"}));
    const reference = {provider:"acme-terminal",merchantId:"m-1",transactionId:"t-9"};
    const observe = (status: string, extra: JsonObject = {}) => lab.command("cashier","Payment.RecordTerminal",{billId:"bill-1",amountMinor:"100000",currency:"VND",status,reference,...extra});
    expect((await observe("approved")).code).toBe("INVALID_STATUS");
    expect((await lab.command("cashier","Payment.RecordTerminal",{billId:"bill-1",amountMinor:"100000",currency:"VND",status:"captured"})).code).toBe("REFERENCE_REQUIRED");
    accepted(await observe("unknown"));
    expect(await lab.state("bill","bill-1")).toMatchObject({externalPaymentState:"unknown",paidMinor:"0"});
    expect((await lab.command("cashier","Payment.RecordCash",{billId:"bill-1",expectedVersion:2,amountMinor:"100000",currency:"VND",shiftId:"shift-1"})).code).toBe("PAYMENT_UNRESOLVED");
    expect((await observe("captured",{reference:{...reference,transactionId:"t-10"}})).code).toBe("PAYMENT_UNRESOLVED");
    expect((await lab.command("manager","Bill.Void",{billId:"bill-1",reason:"x",expectedVersion:2})).code).toBe("PAYMENT_UNRESOLVED");
    const again = await observe("unknown");
    accepted(again);
    expect(again.value.duplicate).toBe(true);
    expect(await lab.count("CardPaymentUnknown")).toBe(1);
    const captured = await observe("captured");
    accepted(captured);
    expect(await lab.state("bill","bill-1")).toMatchObject({externalPaymentState:null,paidMinor:"100000"});
    // webhook-style replay with a new operation id: same reference, nothing captured twice
    const replay = await observe("captured");
    accepted(replay);
    expect(replay.value.duplicate).toBe(true);
    expect(await lab.count("CardPaymentCaptured")).toBe(1);
    expect(await lab.state("bill","bill-1")).toMatchObject({paidMinor:"100000"});
    expect((await observe("failed")).code).toBe("PAYMENT_ALREADY_FINAL");
    expect((await observe("captured",{amountMinor:"90000"})).code).toBe("PAYMENT_REFERENCE_CONFLICT");
    expect((await observe("captured",{billId:"bill-2"})).code).toBe("PAYMENT_REFERENCE_CONFLICT");
    // hand-typed variants of the same reference (case, spacing) are the same transaction: idempotent on its bill, a conflict elsewhere
    const variant = {provider:" ACME-Terminal ",merchantId:"M-1",transactionId:" t- 9"};
    const same = await observe("captured",{reference:variant});
    accepted(same);
    expect(same.value).toMatchObject({paymentId:captured.value.paymentId,duplicate:true});
    expect((await observe("captured",{billId:"bill-2",reference:variant})).code).toBe("PAYMENT_REFERENCE_CONFLICT");
    expect((await observe("captured",{reference:{...reference,transactionId:"   "}})).code).toBe("REFERENCE_REQUIRED");
    expect(await lab.count("CardPaymentCaptured")).toBe(1);
    expect(await lab.state("payment",String(captured.value.paymentId))).toMatchObject({method:"card-terminal",reference:{provider:"acme-terminal",merchantId:"m-1",transactionId:"T-9"},status:"captured",capturedMinor:"100000",refundedMinor:"0"});
    // the same transaction id at another merchant is a different payment
    accepted(await lab.command("cashier","Payment.RecordTerminal",{billId:"bill-2",amountMinor:"100000",currency:"VND",status:"failed",reference:{...reference,merchantId:"m-2"}}));
    expect(await lab.state("bill","bill-2")).toMatchObject({paidMinor:"0",externalPaymentState:null});
  } finally { await lab.close(); }
});

test("refunds take only the unrefunded captured part, record shift/reason/actor and never return stock; closed bills are not amended", async () => {
  const lab = await createRestaurantLab();
  try {
    const { billId, rice, orderId } = await preparedBill(lab);
    const bill = await lab.state<Bill>("bill",billId);
    accepted(await lab.command("cashier","Shift.Open",{shiftId:"shift-1",currency:"VND"}));
    const cash = await lab.command("cashier","Payment.RecordCash",{billId,expectedVersion:1,amountMinor:"150000",currency:"VND",shiftId:"shift-1"});
    accepted(cash);
    expect(cash.value.changeMinor).toBe(String(150000n - BigInt(bill.totalMinor)));
    accepted(await lab.command("cashier","Bill.Close",{billId,expectedVersion:2}));
    const paymentId = String(cash.value.paymentId);
    const before = { order: await lab.state("order",orderId), ticket: await lab.state("kitchen-ticket",rice), fulfillment: await lab.state("fulfillment",rice) };
    const refund = (actor: string, payload: JsonObject) => lab.command(actor,"Refund.Record",{paymentId,...payload});
    expect((await refund("cashier",{amountMinor:"50000",reason:"cold",expectedVersion:1})).code).toBe("FORBIDDEN");
    expect((await refund("manager",{amountMinor:"50000",expectedVersion:1})).code).toBe("REASON_REQUIRED");
    expect((await refund("manager",{amountMinor:"50000",reason:"  ",expectedVersion:1})).code).toBe("REASON_REQUIRED");
    expect((await refund("manager",{amountMinor:"0",reason:"cold",expectedVersion:1})).code).toBe("INVALID_AMOUNT");
    const r = await refund("manager",{amountMinor:"50000",reason:"cold food",expectedVersion:1});
    accepted(r);
    expect(await lab.state("refund",String(r.value.refundId))).toMatchObject({paymentId,billId,amountMinor:"50000",method:"cash",shiftId:"shift-1",reason:"cold food",actorRef:"manager"});
    expect(await lab.state("payment",paymentId)).toMatchObject({capturedMinor:bill.totalMinor,refundedMinor:"50000",status:"captured"});
    expect(await lab.state("shift","shift-1")).toMatchObject({cashRefundedMinor:"50000"});
    expect(await lab.state("bill",billId)).toMatchObject({status:"closed",refundedMinor:"50000",paidMinor:bill.totalMinor});
    expect((await refund("manager",{amountMinor:String(BigInt(bill.totalMinor) - 50000n + 1n),reason:"again",expectedVersion:2})).code).toBe("REFUND_EXCEEDS_CAPTURED");
    accepted(await refund("manager",{amountMinor:String(BigInt(bill.totalMinor) - 50000n),reason:"rest",expectedVersion:2}));
    expect((await refund("manager",{amountMinor:"1",reason:"more",expectedVersion:3})).code).toBe("REFUND_EXCEEDS_CAPTURED");
    // a refund is money only: no stock return, no kitchen or fulfillment change
    expect({ order: await lab.state("order",orderId), ticket: await lab.state("kitchen-ticket",rice), fulfillment: await lab.state("fulfillment",rice) }).toEqual(before);
    expect(await lab.count("PreparedFoodReturned")).toBe(0);
    // a closed bill is never amended in place; money corrections go through Refund.Record
    const closed = (await lab.state<Bill>("bill",billId)).version;
    for (const [type, payload] of [["Bill.Split",{mode:"equal",parts:2}],["Bill.Void",{reason:"late"}],["Payment.RecordCash",{amountMinor:"1",currency:"VND",shiftId:"shift-1"}]] as const)
      expect((await lab.command("manager",type,{billId,expectedVersion:closed,...payload})).code).toBe("BILL_CLOSED");
    expect((await lab.command("manager","Order.Amend",{lineId:rice,cancelQuantity:"1",reason:"late",expectedVersion:(before.order as {version:number}).version})).code).not.toBe("accepted");
  } finally { await lab.close(); }
});

test("void only an uncollected bill: it releases the orders for rebilling and never voids a captured payment", async () => {
  const lab = await createRestaurantLab();
  try {
    const { billId, orderId } = await preparedBill(lab);
    expect((await lab.command("cashier","Bill.Void",{billId,reason:"wrong table",expectedVersion:1})).code).toBe("FORBIDDEN");
    expect((await lab.command("manager","Bill.Void",{billId,expectedVersion:1})).code).toBe("REASON_REQUIRED");
    expect((await lab.command("manager","Bill.Void",{billId,reason:" ",expectedVersion:1})).code).toBe("REASON_REQUIRED");
    accepted(await lab.command("manager","Bill.Void",{billId,reason:"wrong table",expectedVersion:1}));
    expect(await lab.state("bill",billId)).toMatchObject({status:"voided",voidReason:"wrong table",voidedBy:"manager"});
    expect(await lab.state("session","session-1")).toMatchObject({status:"open",frozenBillId:null});
    expect(await lab.state("order",orderId)).toMatchObject({status:"open",billId:null});
    const again = await lab.command("cashier","Bill.Prepare",{sessionId:"session-1"});
    accepted(again);
    const rebilled = String(again.value.billId);
    accepted(await lab.command("cashier","Shift.Open",{shiftId:"shift-1",currency:"VND"}));
    const cash = await lab.command("cashier","Payment.RecordCash",{billId:rebilled,expectedVersion:1,amountMinor:"10000",currency:"VND",shiftId:"shift-1"});
    accepted(cash);
    expect((await lab.command("manager","Bill.Void",{billId:rebilled,reason:"mistake",expectedVersion:2})).code).toBe("BILL_HAS_PAYMENTS");
    expect(await lab.state("payment",String(cash.value.paymentId))).toMatchObject({status:"captured"});
    // a split child cannot be voided while its siblings hold the rest of the table: merge them back first
    const other = await preparedBill(lab, "session-2", "table-2");
    const split = await lab.command("cashier","Bill.Split",{billId:other.billId,mode:"equal",parts:2,expectedVersion:1});
    accepted(split);
    expect((await lab.command("manager","Bill.Void",{billId:(split.value.childBillIds as string[])[0]!,reason:"x",expectedVersion:1})).code).toBe("SPLIT_SIBLINGS_OPEN");
  } finally { await lab.close(); }
});

test("refunds and settling existing bills stay allowed with sales channels off; new tenders follow their feature", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("payment","pay-1",{capturedMinor:"100000"});
    await lab.seed("bill","bill-2",{status:"prepared",totalMinor:"100000",paidMinor:"0",refundedMinor:"0",currency:"VND",orderIds:[],lines:[],version:1});
    const reference = {provider:"acme-terminal",merchantId:"m-1",transactionId:"t-1"};
    accepted(await lab.command("cashier","Payment.RecordTerminal",{billId:"bill-2",amountMinor:"100000",currency:"VND",status:"pending",reference}));
    const features = { ...fixture.configuration.features } as Record<string,{status:string;revision:number}>;
    for (const key of ["pos.order","payment.cash","refund","payment.terminal","payment.transfer.manual"]) features[key] = { status: "disabled", revision: 1 };
    await lab.seed("configuration","applied",{ ...fixture.configuration, features } as JsonObject);
    accepted(await lab.command("manager","Refund.Record",{paymentId:"pay-1",amountMinor:"1000",reason:"goodwill",expectedVersion:1}));
    await lab.seed("bill","locked",{status:"prepared",totalMinor:"100000",paidMinor:"1000",refundedMinor:"0",currency:"VND",orderIds:[],lines:[],collectionLocked:true,grantId:"g-1",version:2});
    await lab.seed("payment","pay-locked",{billId:"locked",capturedMinor:"1000",shiftId:"shift-pay-1"});
    expect((await lab.command("manager","Refund.Record",{paymentId:"pay-locked",amountMinor:"1000",reason:"x",expectedVersion:1})).code).toBe("GRANT_UNRECONCILED");
    // the pending charge can still be resolved; a new one cannot be started
    accepted(await lab.command("cashier","Payment.RecordTerminal",{billId:"bill-2",amountMinor:"100000",currency:"VND",status:"captured",reference}));
    await lab.seed("bill","bill-3",{status:"prepared",totalMinor:"100000",paidMinor:"0",refundedMinor:"0",currency:"VND",orderIds:[],lines:[],version:1});
    expect((await lab.command("cashier","Payment.RecordTerminal",{billId:"bill-3",amountMinor:"100000",currency:"VND",status:"captured",reference:{...reference,transactionId:"t-2"}})).code).toBe("FEATURE_DISABLED");
    expect((await lab.command("manager","Payment.VerifyManual",{billId:"bill-3",expectedVersion:1,amountMinor:"100000",currency:"VND",reason:"r",evidenceRef:"e",reference:{provider:"vcb",merchantId:"a",transactionId:"x"}})).code).toBe("FEATURE_DISABLED");
  } finally { await lab.close(); }
});
