import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { createSimulator } from "../support/restaurant-journey";
import { dispatchRobotEffects, robotEventCommand } from "../../packages/robot-adapters/src/dispatch";
import type { RobotEvent } from "../../packages/robot-adapters/src/contract";
import type { Lab } from "../support/lab";
import fixture from "../fixtures/restaurant-v1.json";
import type { JsonObject } from "../../packages/contracts/src/index";

test("prepared food cancellation does not erase kitchen work", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("order-line","line-1",{ordered:"2",prepared:"1",allocated:"0",version:2});
    await lab.command("manager","Order.Amend",{lineId:"line-1",cancelQuantity:"1",reason:"guest",expectedVersion:2});
    expect(await lab.count("KitchenCancellationRequested")).toBe(1);
    expect(await lab.count("PreparedFoodDiscarded")).toBe(0);
  } finally { await lab.close(); }
});

const accepted = (r: { status: string; code?: string }) => { expect(r.code ?? r.status).toBe("accepted"); };
type Line = { quantity: string; cancelledQuantity?: string; totalMinor: string; charges: unknown; cancelled?: { totalMinor: string }; cancellations?: unknown[] };
type OrderState = { lines: Line[]; totalMinor: string; status: string; version: number; summary: Record<string, string>; sessionId: string; tableId: string };

test("unprepared quantity is cancelled outright, announced by a delta ticket the station must ACK", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("order-line","line-1",{ordered:"3",prepared:"0",version:1});
    const r = await lab.command("cashier","Order.Amend",{lineId:"line-1",cancelQuantity:"2",reason:"changed mind",expectedVersion:1});
    accepted(r);
    expect(r.value).toMatchObject({unprepared:"2",prepared:"0",reducedMinor:"100000",totalMinor:"50000"});
    expect(await lab.count("KitchenCancellationRequested")).toBe(0);
    expect(await lab.count("KitchenDeltaCreated")).toBe(1);
    const order = await lab.state<OrderState>("order","order-line-1");
    expect(order.lines[0]).toMatchObject({quantity:"3",cancelledQuantity:"2"});
    expect(order.lines[0]!.cancellations).toHaveLength(1);
    expect(await lab.state("kitchen-ticket","line-1")).toMatchObject({quantity:"1",cancelledQuantity:"2",status:"queued"});
    expect(await lab.state("fulfillment","line-1")).toMatchObject({quantity:"1",cancelledQuantity:"2"});
    // the station cannot be asked to prepare more than the reduced quantity
    expect((await lab.command("chef","Kitchen.Ready",{lineId:"line-1",stationId:"kitchen",quantity:"2",expectedVersion:2})).code).toBe("PREPARATION_EXCEEDS_ORDER");

    const deltaId = String(r.value.deltaId);
    expect(await lab.state("kitchen-delta",deltaId)).toMatchObject({status:"pending",kind:"cancel",quantity:"2",stationId:"kitchen"});
    expect((await lab.command("manager","Kitchen.AckDelta",{deltaId,stationId:"bar",expectedVersion:1})).code).toBe("STATION_FORBIDDEN");
    expect((await lab.command("chef","Kitchen.AckDelta",{deltaId,stationId:"bar",expectedVersion:1})).code).toBe("FORBIDDEN");
    accepted(await lab.command("chef","Kitchen.AckDelta",{deltaId,stationId:"kitchen",expectedVersion:1}));
    expect(await lab.state("kitchen-delta",deltaId)).toMatchObject({status:"acknowledged",acknowledgedBy:"chef"});
    expect((await lab.command("chef","Kitchen.AckDelta",{deltaId,stationId:"kitchen",expectedVersion:2})).code).toBe("DELTA_ACKNOWLEDGED");
  } finally { await lab.close(); }
});

test("prepared food leaves a cancelled line only through an explicit return / waste / manual choice", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("order-line","line-1",{ordered:"3",prepared:"2",allocated:"0",version:1});
    const r = await lab.command("cashier","Order.Amend",{lineId:"line-1",cancelQuantity:"2",reason:"guest",expectedVersion:1});
    accepted(r);
    expect(r.value).toMatchObject({prepared:"2",unprepared:"0"});
    expect(await lab.count("KitchenDeltaCreated")).toBe(0);
    // the cooked portions are held out of the ready pool: they cannot be allocated, the order cannot be cancelled around them
    expect(await lab.state("fulfillment","line-1")).toMatchObject({ready:"0",held:"2",cancelledQuantity:"2"});
    expect((await lab.command("cashier","Fulfillment.Allocate",{lineId:"line-1",quantity:"1",expectedVersion:2})).code).toBe("INSUFFICIENT_READY");
    expect((await lab.command("cashier","Order.Cancel",{orderId:"order-line-1",reason:"x",expectedVersion:2})).code).toBe("REQUIRES_DISPOSITION");
    expect(await lab.count("PreparedFoodDiscarded")).toBe(0);

    const cancellationId = String(r.value.cancellationId), base = {cancellationId,stationId:"kitchen",expectedVersion:1};
    expect((await lab.command("chef","Kitchen.DisposePrepared",{...base,disposition:"discard"})).code).toBe("INVALID_DISPOSITION");
    expect((await lab.command("chef","Kitchen.DisposePrepared",{...base,disposition:"manual"})).code).toBe("DISPOSITION_NOTE_REQUIRED");
    expect((await lab.command("manager","Kitchen.DisposePrepared",{...base,stationId:"bar",disposition:"waste"})).code).toBe("STATION_FORBIDDEN");
    expect(await lab.count("PreparedFoodDiscarded")).toBe(0);
    accepted(await lab.command("chef","Kitchen.DisposePrepared",{...base,disposition:"waste"}));
    expect(await lab.count("PreparedFoodDiscarded")).toBe(1);
    expect(await lab.state("fulfillment","line-1")).toMatchObject({held:"0",disposed:{waste:"2"}});
    // history stays: the ticket still counts what was cooked
    expect(await lab.state("kitchen-ticket","line-1")).toMatchObject({prepared:"2",cancelledPrepared:"2"});
    expect((await lab.command("chef","Kitchen.DisposePrepared",{...base,expectedVersion:2,disposition:"return"})).code).toBe("CANCELLATION_RESOLVED");
  } finally { await lab.close(); }
});

test("return and manual dispositions are recorded as such", async () => {
  const lab = await createRestaurantLab();
  try {
    for (const [id, disposition, extra, event] of [["a","return",{},"PreparedFoodReturned"],["b","manual",{note:"staff meal"},"PreparedFoodManuallyHandled"]] as const) {
      await lab.seed("order-line",`line-${id}`,{ordered:"1",prepared:"1",version:1});
      const r = await lab.command("manager","Order.Amend",{lineId:`line-${id}`,cancelQuantity:"1",reason:"guest",expectedVersion:1});
      accepted(r);
      accepted(await lab.command("manager","Kitchen.DisposePrepared",{cancellationId:String(r.value.cancellationId),stationId:"kitchen",disposition,expectedVersion:1,...extra}));
      expect(await lab.count(event)).toBe(1);
      expect(await lab.state("fulfillment",`line-${id}`)).toMatchObject({disposed:{[disposition]:"1"}});
    }
    expect(await lab.count("PreparedFoodDiscarded")).toBe(0);
  } finally { await lab.close(); }
});

test("allocated or served portions cannot be cancelled and quantities never go negative", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("order-line","line-1",{ordered:"3",prepared:"2",allocated:"1",served:"0",version:3});
    const cancel = (cancelQuantity: string, version: number, reason = "guest") => lab.command("manager","Order.Amend",{lineId:"line-1",cancelQuantity,reason,expectedVersion:version});
    expect((await cancel("3",3)).code).toBe("FULFILLMENT_ACTIVE");
    expect((await cancel("4",3)).code).toBe("CANCEL_EXCEEDS_ORDER");
    expect((await cancel("0",3)).code).toBe("INVALID_QUANTITY");
    expect((await cancel("-1",3)).code).toBe("INVALID_QUANTITY");
    expect((await cancel("1",3,"")).code).toBe("REASON_REQUIRED");
    expect((await cancel("1",2)).code).toBe("VERSION_CONFLICT");
    expect((await lab.command("manager","Order.Amend",{lineId:"line-1",cancelQuantity:"1",reason:"g"})).code).toBe("VERSION_REQUIRED");
    expect((await lab.command("manager","Order.Amend",{lineId:"line-1",cancelQuantity:"1",reason:"g",expectedVersion:3,items:[{itemId:"tea",quantity:"1"}]})).code).toBe("AMBIGUOUS_AMENDMENT");
    // 1 unprepared + 1 ready-unallocated may go; the allocated one may not
    accepted(await cancel("2",3));
    expect((await cancel("1",4)).code).toBe("FULFILLMENT_ACTIVE");
    expect(await lab.state("fulfillment","line-1")).toMatchObject({ready:"1",allocated:"1",held:"1"});
  } finally { await lab.close(); }
});

test("cancelled amounts come from the line snapshot and are exact, not re-priced from the menu", async () => {
  const lab = await createRestaurantLab();
  try {
    const pricing = { taxProfiles:[{id:"vat",name:"VAT",rateBps:800,inclusive:true}], defaultTaxProfileId:"vat", service:{rateBps:500,taxable:false}, discountOrder:"before_tax", discounts:[{id:"ten",name:"10%",kind:"percent",valueBps:1000}] };
    const menu = { ...fixture.menu, items: fixture.menu.items.map(i => i.id === "rice" ? { ...i, unitMinor: "33333" } : i), pricing } as JsonObject;
    await lab.seed("catalog","current",menu);
    accepted(await lab.command("manager","Session.Open",{sessionId:"s",tableId:"table-1"}));
    const placed = await lab.command("manager","Order.Place",{sessionId:"s",tableId:"table-1",menuVersion:1,items:[{itemId:"rice",quantity:"3"}],discountIds:["ten"]});
    accepted(placed);
    const lineId = String((placed.value.lineIds as string[])[0]), before = await lab.state<OrderState>("order",String(placed.value.orderId));
    const original = before.lines[0]!, startTotal = BigInt(before.totalMinor);
    expect(startTotal).toBeGreaterThan(0n);
    await lab.seed("catalog","current",{ ...menu, items: fixture.menu.items.map(i => ({ ...i, unitMinor: "1" })) } as JsonObject); // price changes afterwards must not matter
    let reducedTotal = 0n, steps = 0;
    for (; steps < 3; steps++) {
      const current = await lab.state<OrderState>("order",String(placed.value.orderId));
      const r = await lab.command("manager","Order.Amend",{lineId,cancelQuantity:"1",reason:"guest",expectedVersion:current.version});
      accepted(r);
      reducedTotal += BigInt(String(r.value.reducedMinor));
      expect(BigInt(String(r.value.reducedMinor))).toBeGreaterThanOrEqual(0n);
      const order = await lab.state<OrderState>("order",String(placed.value.orderId)), line = order.lines[0]!;
      expect(line.totalMinor).toBe(original.totalMinor); expect(line.charges).toEqual(original.charges); // snapshot untouched
      expect(BigInt(order.totalMinor)).toBe(startTotal - reducedTotal);
      expect(BigInt(order.totalMinor)).toBe(BigInt(line.totalMinor) - BigInt(line.cancelled!.totalMinor));
      const s = order.summary; // components stay self-consistent: total = subtotal - discount + service + exclusive tax
      expect(BigInt(s.subtotalMinor!) - BigInt(s.discountMinor!) + BigInt(s.serviceMinor!) + BigInt(s.taxMinor!)).toBe(BigInt(s.totalMinor!));
      expect(s.totalMinor).toBe(order.totalMinor);
    }
    expect(reducedTotal).toBe(startTotal);
    const done = await lab.state<OrderState>("order",String(placed.value.orderId));
    expect(done).toMatchObject({totalMinor:"0",status:"cancelled"});
    expect(done.lines[0]!.cancellations).toHaveLength(3);
  } finally { await lab.close(); }
});

test("a prepared bill blocks line cancellation, and an open disposition blocks closing the bill", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("order-line","line-1",{ordered:"2",prepared:"2",version:1});
    const r = await lab.command("cashier","Order.Amend",{lineId:"line-1",cancelQuantity:"1",reason:"guest",expectedVersion:1});
    accepted(r);
    accepted(await lab.command("cashier","Shift.Open",{shiftId:"shift-1",currency:"VND",openingMinor:"0"}));
    const bill = await lab.command("cashier","Bill.Prepare",{sessionId:"session-line-1"});
    accepted(bill);
    expect(bill.value.totalMinor).toBe("50000");
    expect((await lab.command("cashier","Order.Amend",{lineId:"line-1",cancelQuantity:"1",reason:"late",expectedVersion:3})).code).toBe("ORDER_FROZEN");
    accepted(await lab.command("cashier","Payment.RecordCash",{billId:String(bill.value.billId),expectedVersion:1,amountMinor:"50000",currency:"VND",shiftId:"shift-1"}));
    expect((await lab.command("cashier","Bill.Close",{billId:String(bill.value.billId),expectedVersion:2})).code).toBe("DISPOSITION_PENDING");
    accepted(await lab.command("chef","Kitchen.DisposePrepared",{cancellationId:String(r.value.cancellationId),stationId:"kitchen",disposition:"return",expectedVersion:1}));
    accepted(await lab.command("cashier","Bill.Close",{billId:String(bill.value.billId),expectedVersion:2}));
  } finally { await lab.close(); }
});

async function openWithOrder(lab: Lab, sessionId: string, tableId: string, items: JsonObject[]) {
  accepted(await lab.command("cashier","Session.Open",{sessionId,tableId}));
  const placed = await lab.command("cashier","Order.Place",{sessionId,tableId,menuVersion:1,items});
  accepted(placed);
  return placed;
}

test("moving a session carries the table, orders and revision, and refuses occupied or stale moves", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("table","table-3",{id:"table-3",name:"Bàn 03",activeSessionId:null});
    const placed = await openWithOrder(lab,"s1","table-1",[{itemId:"rice",quantity:"1"}]);
    await openWithOrder(lab,"s2","table-2",[{itemId:"tea",quantity:"1"}]);
    const session = await lab.state<{version:number;revision:number}>("session","s1");
    expect(session.revision).toBe(0);
    expect((await lab.command("cashier","Session.Move",{sessionId:"s1",toTableId:"table-2",expectedVersion:session.version})).code).toBe("TABLE_OCCUPIED");
    expect((await lab.command("cashier","Session.Move",{sessionId:"s1",toTableId:"table-1",expectedVersion:session.version})).code).toBe("SAME_TABLE");
    expect((await lab.command("cashier","Session.Move",{sessionId:"s1",toTableId:"ghost",expectedVersion:session.version})).code).toBe("NOT_FOUND");
    expect((await lab.command("cashier","Session.Move",{sessionId:"s1",toTableId:"table-3",expectedVersion:session.version-1})).code).toBe("VERSION_CONFLICT");
    accepted(await lab.command("cashier","Session.Move",{sessionId:"s1",toTableId:"table-3",expectedVersion:session.version}));
    expect(await lab.state("session","s1")).toMatchObject({tableId:"table-3",revision:1,tableHistory:[{from:"table-1",to:"table-3",by:"cashier"}]});
    expect(await lab.state("table","table-1")).toMatchObject({activeSessionId:null});
    expect(await lab.state("table","table-3")).toMatchObject({activeSessionId:"s1"});
    expect(await lab.state("order",String(placed.value.orderId))).toMatchObject({tableId:"table-3"});
    // the session now belongs to table-3: orders follow it, the old table is free to seat someone else
    expect((await lab.command("cashier","Order.Place",{sessionId:"s1",tableId:"table-1",menuVersion:1,items:[{itemId:"tea",quantity:"1"}]})).code).toBe("TABLE_SESSION_MISMATCH");
    accepted(await lab.command("cashier","Order.Place",{sessionId:"s1",tableId:"table-3",menuVersion:1,items:[{itemId:"tea",quantity:"1"}]}));
    accepted(await lab.command("cashier","Session.Open",{sessionId:"s3",tableId:"table-1"}));
  } finally { await lab.close(); }
});

/** Robot has loaded at the kitchen and is driving to table-1 with one portion: the state a table move must not ignore. */
async function missionEnRoute(lab: Lab) {
  await openWithOrder(lab,"s1","table-1",[{itemId:"rice",quantity:"1"}]);
  const order = await lab.state<{lines:{id:string}[]}>("order",(await lab.state<{orderIds:string[]}>("session","s1")).orderIds[0]!);
  const lineId = order.lines[0]!.id;
  accepted(await lab.command("chef","Kitchen.Ready",{lineId,quantity:"1",stationId:"kitchen",expectedVersion:1}));
  const allocation = await lab.command("cashier","Fulfillment.Allocate",{lineId,quantity:"1",expectedVersion:2,method:"robot"});
  const mission = await lab.command("cashier","Mission.Create",{allocationIds:[allocation.value.allocationId!],robotId:"sim-1"});
  accepted(mission);
  const missionId = String(mission.value.missionId), sim = await createSimulator(lab);
  const events: RobotEvent[] = [], unsubscribe = sim.observe(e => events.push(e));
  const drive = async () => {
    await dispatchRobotEffects(await lab.getStore("coordinator"),lab.scope,sim,lab.clock.nowMs);
    sim.advance(1000);
    const out = [];
    for (const event of events.splice(0)) out.push({event,result:await lab.command("owner","Robot.Observe",robotEventCommand(event),event.id)});
    return out;
  };
  for (const r of await drive()) accepted(r.result);
  let m = await lab.state<{version:number;revision:number;currentStopId:string}>("mission",missionId);
  accepted(await lab.command("cashier","Mission.ConfirmStop",{missionId,expectedVersion:m.version,missionRevision:m.revision,stopId:m.currentStopId}));
  await dispatchRobotEffects(await lab.getStore("coordinator"),lab.scope,sim,lab.clock.nowMs); // robot now genuinely driving to table-1
  m = await lab.state("mission",missionId);
  return {missionId,sim,drive,unsubscribe,before:m as typeof m & {commandId:string;stops:{action:string;targetId:string;status:string}[]}};
}

test("moving a table while the robot is en route retargets the mission under a bumped revision", async () => {
  const lab = await createRestaurantLab();
  try {
    const { missionId, drive, before, unsubscribe } = await missionEnRoute(lab);
    expect(before.stops.find(s => s.action === "handoff")).toMatchObject({targetId:"table-1",status:"travelling"});
    const session = await lab.state<{version:number}>("session","s1");
    const moved = await lab.command("cashier","Session.Move",{sessionId:"s1",toTableId:"table-2",expectedVersion:session.version});
    accepted(moved);
    const after = await lab.state<{revision:number;commandId:string;targetRevision:number;stops:{action:string;targetId:string;status:string}[]}>("mission",missionId);
    expect(after.stops.find(s => s.action === "handoff")).toMatchObject({targetId:"table-2",status:"travelling"});
    expect(after.revision).toBe(before.revision + 1);
    expect(after.targetRevision).toBe(1);
    expect(after.commandId).not.toBe(before.commandId);
    expect(await lab.state("robot-command",after.commandId)).toMatchObject({missionRevision:after.revision,target:{waypointId:"table-2"}});
    expect(await lab.state("robot-command",before.commandId)).toMatchObject({status:"superseded",supersededBy:after.commandId});
    const store = await lab.getStore("coordinator");
    expect((await store.effects(lab.scope,"robot.cancel")).length).toBe(1);
    // the old target can no longer be confirmed, and a late event for the old command is stale
    const old = await lab.command("cashier","Mission.ConfirmStop",{missionId,expectedVersion:(await lab.state<{version:number}>("mission",missionId)).version,missionRevision:before.revision,stopId:before.currentStopId});
    expect(old.code).toBe("STALE_STOP");
    const results = await drive();
    expect(results.filter(r => r.event.commandId === before.commandId).every(r => r.result.code === "STALE_ROBOT_EVENT")).toBe(true);
    const arrival = results.filter(r => r.event.commandId === after.commandId);
    expect(arrival.length).toBeGreaterThan(0); arrival.forEach(r => accepted(r.result));
    const arrived = await lab.state<{version:number;revision:number;currentStopId:string}>("mission",missionId);
    accepted(await lab.command("cashier","Mission.ConfirmStop",{missionId,expectedVersion:arrived.version,missionRevision:arrived.revision,stopId:arrived.currentStopId}));
    expect(await lab.state("mission",missionId)).toMatchObject({status:"completed"});
    unsubscribe();
  } finally { await lab.close(); }
});

test("a mission whose robot state is unknown blocks the move instead of being re-aimed", async () => {
  const lab = await createRestaurantLab();
  try {
    const { missionId, unsubscribe } = await missionEnRoute(lab);
    const mission = await lab.state<JsonObject & {version:number}>("mission",missionId);
    await lab.seed("mission",missionId,{...mission,status:"needs_attention"});
    const session = await lab.state<{version:number}>("session","s1");
    expect((await lab.command("cashier","Session.Move",{sessionId:"s1",toTableId:"table-2",expectedVersion:session.version})).code).toBe("MISSION_UNRESOLVED");
    expect(await lab.state("session","s1")).toMatchObject({tableId:"table-1"});
    unsubscribe();
  } finally { await lab.close(); }
});

test("a table without a robot waypoint binding cannot receive an en-route delivery, and table names are irrelevant to bindings", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("table","table-9",{id:"table-9",name:"Table 9",activeSessionId:null});
    const { missionId, unsubscribe } = await missionEnRoute(lab);
    const session = await lab.state<{version:number}>("session","s1");
    expect((await lab.command("cashier","Session.Move",{sessionId:"s1",toTableId:"table-9",expectedVersion:session.version})).code).toBe("TARGET_UNBOUND");
    // renaming a bound table changes nothing about where the robot goes: bindings are keyed by table id
    await lab.seed("table","table-2",{id:"table-2",name:"VIP room",activeSessionId:null});
    accepted(await lab.command("cashier","Session.Move",{sessionId:"s1",toTableId:"table-2",expectedVersion:session.version}));
    const after = await lab.state<{commandId:string}>("mission",missionId);
    expect(await lab.state("robot-command",after.commandId)).toMatchObject({target:{waypointId:"table-2",x:4}});
    unsubscribe();
  } finally { await lab.close(); }
});

test("merging keeps both sessions, conserves money and quantity, and moves kitchen work to the target", async () => {
  const lab = await createRestaurantLab();
  try {
    const a = await openWithOrder(lab,"s1","table-1",[{itemId:"rice",quantity:"2"}]);
    const b = await openWithOrder(lab,"s2","table-2",[{itemId:"tea",quantity:"1"},{itemId:"rice",quantity:"1"}]);
    const sv = await lab.state<{version:number}>("session","s1"), tv = await lab.state<{version:number}>("session","s2");
    const orderA = await lab.state<OrderState>("order",String(a.value.orderId)), orderB = await lab.state<OrderState>("order",String(b.value.orderId));
    const units = (o: OrderState) => o.lines.reduce((n, l) => n + BigInt(l.quantity), 0n);
    expect((await lab.command("cashier","Session.Merge",{sourceSessionId:"s2",targetSessionId:"s2",expectedSourceVersion:1,expectedTargetVersion:1})).code).toBe("SAME_SESSION");
    expect((await lab.command("cashier","Session.Merge",{sourceSessionId:"s2",targetSessionId:"s1",expectedSourceVersion:tv.version,expectedTargetVersion:sv.version+1})).code).toBe("VERSION_CONFLICT");
    expect((await lab.command("cashier","Session.Merge",{sourceSessionId:"s2",targetSessionId:"s1",expectedSourceVersion:tv.version})).code).toBe("VERSION_REQUIRED");
    accepted(await lab.command("cashier","Session.Merge",{sourceSessionId:"s2",targetSessionId:"s1",expectedSourceVersion:tv.version,expectedTargetVersion:sv.version}));
    expect(await lab.state("session","s2")).toMatchObject({status:"merged",mergedInto:"s1",orderIds:[b.value.orderId],revision:1});
    expect(await lab.state("session","s1")).toMatchObject({orderIds:[a.value.orderId,b.value.orderId],mergedFrom:["s2"],revision:1});
    expect(await lab.state("table","table-2")).toMatchObject({activeSessionId:null});
    expect(await lab.state("table","table-1")).toMatchObject({activeSessionId:"s1"});
    expect(await lab.state("order",String(b.value.orderId))).toMatchObject({sessionId:"s1",tableId:"table-1",originSessionId:"s2",status:"open"});
    expect(await lab.state("kitchen-ticket",String((b.value.lineIds as string[])[0]))).toMatchObject({sessionId:"s1",originSessionId:"s2"});
    expect((await lab.command("cashier","Order.Place",{sessionId:"s2",tableId:"table-2",menuVersion:1,items:[{itemId:"tea",quantity:"1"}]})).code).toBe("SESSION_CLOSED");
    accepted(await lab.command("cashier","Session.Open",{sessionId:"s9",tableId:"table-2"})); // freed table can seat new guests
    // one bill for the merged session covers exactly what both orders held
    accepted(await lab.command("cashier","Shift.Open",{shiftId:"sh",currency:"VND",openingMinor:"0"}));
    const bill = await lab.command("cashier","Bill.Prepare",{sessionId:"s1"});
    accepted(bill);
    expect(BigInt(String(bill.value.totalMinor))).toBe(BigInt(orderA.totalMinor) + BigInt(orderB.totalMinor));
    const stored = await lab.state<{lines:Line[]}>("bill",String(bill.value.billId));
    expect(stored.lines.reduce((n, l) => n + BigInt(l.quantity), 0n)).toBe(units(orderA) + units(orderB));
  } finally { await lab.close(); }
});

test("concurrent merges, and orders added after the versions were read, cannot both win", async () => {
  const lab = await createRestaurantLab();
  try {
    await openWithOrder(lab,"s1","table-1",[{itemId:"rice",quantity:"1"}]);
    await openWithOrder(lab,"s2","table-2",[{itemId:"tea",quantity:"1"}]);
    const v = async () => ({s1:(await lab.state<{version:number}>("session","s1")).version,s2:(await lab.state<{version:number}>("session","s2")).version});
    const { s1, s2 } = await v();
    // opposite directions with the same read versions: exactly one commits
    const raced = await Promise.all([
      lab.command("cashier","Session.Merge",{sourceSessionId:"s2",targetSessionId:"s1",expectedSourceVersion:s2,expectedTargetVersion:s1}),
      lab.command("manager","Session.Merge",{sourceSessionId:"s1",targetSessionId:"s2",expectedSourceVersion:s1,expectedTargetVersion:s2}),
    ]);
    expect(raced.filter(r => r.status === "accepted")).toHaveLength(1);
    expect(raced.find(r => r.status !== "accepted")!.code).toMatch(/VERSION_CONFLICT|SESSION_CLOSED/);
    expect(await lab.count("SessionMerged")).toBe(1);

    const lab2 = await createRestaurantLab();
    try {
      await openWithOrder(lab2,"s1","table-1",[{itemId:"rice",quantity:"1"}]);
      await openWithOrder(lab2,"s2","table-2",[{itemId:"tea",quantity:"1"}]);
      const read = { s1: (await lab2.state<{version:number}>("session","s1")).version, s2: (await lab2.state<{version:number}>("session","s2")).version };
      accepted(await lab2.command("cashier","Order.Place",{sessionId:"s2",tableId:"table-2",menuVersion:1,items:[{itemId:"tea",quantity:"2"}]})); // added while the waiter was choosing
      expect((await lab2.command("cashier","Session.Merge",{sourceSessionId:"s2",targetSessionId:"s1",expectedSourceVersion:read.s2,expectedTargetVersion:read.s1})).code).toBe("VERSION_CONFLICT");
      expect(await lab2.state("session","s2")).toMatchObject({status:"open"});
    } finally { await lab2.close(); }
  } finally { await lab.close(); }
});

test("an unreconciled settlement grant or a prepared bill blocks a merge and no bill is touched", async () => {
  const lab = await createRestaurantLab();
  try {
    await openWithOrder(lab,"s1","table-1",[{itemId:"rice",quantity:"1"}]);
    await openWithOrder(lab,"s2","table-2",[{itemId:"tea",quantity:"1"}]);
    const merge = async () => lab.command("cashier","Session.Merge",{sourceSessionId:"s2",targetSessionId:"s1",expectedSourceVersion:(await lab.state<{version:number}>("session","s2")).version,expectedTargetVersion:(await lab.state<{version:number}>("session","s1")).version});
    await lab.seed("bill","old-bill",{sessionId:"s2",status:"prepared",totalMinor:"20000",paidMinor:"0",currency:"VND"});
    for (const status of ["issued","partially_used","used","returned","unknown"]) {
      await lab.seed("grant","g1",{billId:"old-bill",status});
      expect((await merge()).code).toBe("GRANT_UNRECONCILED");
    }
    await lab.seed("grant","g1",{billId:"old-bill",status:"reconciled"});
    accepted(await merge());
    expect(await lab.state("bill","old-bill")).toMatchObject({sessionId:"s2",status:"prepared",totalMinor:"20000"}); // never deleted or rewritten
    // a frozen (bill prepared) session cannot be merged either
    await lab.seed("session","s5",{tableId:"table-2",status:"open",orderIds:[],revision:0,frozenBillId:"b",version:1});
    expect((await lab.command("cashier","Session.Merge",{sourceSessionId:"s5",targetSessionId:"s1",expectedSourceVersion:1,expectedTargetVersion:(await lab.state<{version:number}>("session","s1")).version})).code).toBe("SESSION_FROZEN");
  } finally { await lab.close(); }
});

test("merging retargets a delivery that was heading to the merged-away table", async () => {
  const lab = await createRestaurantLab();
  try {
    const { missionId, unsubscribe, before } = await missionEnRoute(lab); // s1 on table-1 is being served
    await openWithOrder(lab,"s2","table-2",[{itemId:"tea",quantity:"1"}]);
    const v = async (id: string) => (await lab.state<{version:number}>("session",id)).version;
    accepted(await lab.command("cashier","Session.Merge",{sourceSessionId:"s1",targetSessionId:"s2",expectedSourceVersion:await v("s1"),expectedTargetVersion:await v("s2")}));
    const after = await lab.state<{revision:number;commandId:string;stops:{action:string;targetId:string}[]}>("mission",missionId);
    expect(after.stops.find(s => s.action === "handoff")!.targetId).toBe("table-2");
    expect(after.revision).toBe(before.revision + 1);
    expect(after.commandId).not.toBe(before.commandId);
    unsubscribe();
  } finally { await lab.close(); }
});

test("courses hold later dishes, fire them per order, and kitchen and bar progress separately", async () => {
  const lab = await createRestaurantLab();
  try {
    accepted(await lab.command("cashier","Session.Open",{sessionId:"s1",tableId:"table-1"}));
    expect((await lab.command("cashier","Order.Place",{sessionId:"s1",tableId:"table-1",menuVersion:1,items:[{itemId:"rice",quantity:"1",course:10}]})).code).toBe("INVALID_COURSE");
    const placed = await lab.command("cashier","Order.Place",{sessionId:"s1",tableId:"table-1",menuVersion:1,items:[{itemId:"rice",quantity:"1"},{itemId:"tea",quantity:"1",course:2},{itemId:"rice",quantity:"2",course:2}]});
    accepted(placed);
    const [starter, drink, main] = placed.value.lineIds as string[], orderId = String(placed.value.orderId);
    const status = async (id: string) => (await lab.state<{status:string}>("kitchen-ticket",id)).status;
    expect([await status(starter!),await status(drink!),await status(main!)]).toEqual(["queued","held","held"]);
    expect((await lab.command("chef","Kitchen.Accept",{lineId:main!,stationId:"kitchen",expectedVersion:1})).code).toBe("TICKET_STATE_CONFLICT");
    expect((await lab.command("chef","Kitchen.Ready",{lineId:main!,stationId:"kitchen",quantity:"1",expectedVersion:1})).code).toBe("TICKET_STATE_CONFLICT");
    expect((await lab.command("cashier","Order.SendCourse",{orderId,course:3,expectedVersion:1})).code).toBe("NOTHING_TO_SEND");
    expect((await lab.command("cashier","Order.SendCourse",{orderId,course:2,action:"skip",expectedVersion:1})).code).toBe("INVALID_COURSE_ACTION");
    expect((await lab.command("cashier","Order.SendCourse",{orderId,course:2,expectedVersion:9})).code).toBe("VERSION_CONFLICT");
    const fired = await lab.command("cashier","Order.SendCourse",{orderId,course:2,expectedVersion:1});
    accepted(fired);
    expect((fired.value.stationIds as string[]).sort()).toEqual(["bar","kitchen"]);
    expect([await status(drink!),await status(main!)]).toEqual(["queued","queued"]);
    expect((await lab.command("cashier","Order.SendCourse",{orderId,course:2,expectedVersion:2})).code).toBe("NOTHING_TO_SEND"); // nothing held any more
    // partial ready at the kitchen leaves the bar ticket and bar portions alone
    accepted(await lab.command("chef","Kitchen.Ready",{lineId:main!,stationId:"kitchen",quantity:"1",expectedVersion:2})); // fire bumped the ticket to v2
    expect(await status(main!)).toBe("partially_ready");
    expect(await status(drink!)).toBe("queued");
    expect(await lab.state("fulfillment",drink!)).toMatchObject({ready:"0"});
    expect((await lab.command("chef","Kitchen.Ready",{lineId:drink!,stationId:"bar",quantity:"1",expectedVersion:1})).code).toBe("FORBIDDEN");
    // hold takes back only what the station has not started
    const held = await lab.command("cashier","Order.SendCourse",{orderId,course:2,action:"hold",expectedVersion:2});
    accepted(held);
    expect(held.value.lineIds).toEqual([drink]);
    expect([await status(main!),await status(drink!)]).toEqual(["partially_ready","held"]);
  } finally { await lab.close(); }
});
